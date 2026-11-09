// 机身：参数化截面放样（雷达罩—驾驶舱—等截面客舱段—尾锥/APU）
// 截面采用上下两个半椭圆（787 截面略呈竖直蛋形：外宽 5.77 m、外高 5.94 m）。
// 参数 t∈[0,2π)：t=0 机腹 → π/2 左舷最宽处 → π 机顶 → 3π/2 右舷。
import * as THREE from 'three';
import { G } from './spec.js';
import { monotone, clamp, spow, mergeStations, range } from '../core/math.js';
import { grid } from '../geom/build.js';

const L = G.L;
const zb0 = G.hb;
const zt0 = G.hb + G.H;
const zw0 = G.hb + G.wFrac * G.H;
const hTip = G.hb + G.nose.top[0][1];

// —— 机头型线（雷达罩 + 平滑过渡到驾驶舱风挡，无台阶）——
// 在 σ=√s 空间做单调样条：σ→0 时型线斜率趋于无穷，得到圆润的抛物线钝头（曲率半径约 0.5 m）
const NOSE_END = G.nose.end;
function noseSpline(pts) {
  const f = monotone(pts.map(([s, v]) => [Math.sqrt(s), v]), [null, 0]);
  return (s) => f(Math.sqrt(Math.max(0, s)));
}
const NP = G.nose;
const noseTopRel = noseSpline(NP.top);
const noseBotRel = noseSpline(NP.bot);
const noseWf = noseSpline(NP.width);
const noseZwRel = noseSpline(NP.zw);
const noseTop = (s) => zb0 + noseTopRel(s);
const noseBot = (s) => zb0 + noseBotRel(s);
const noseW = (s) => noseWf(s);
const noseZw = (s) => zb0 + noseZwRel(s);

// —— 尾锥型线（机腹自 s≈44.6 起上翘，保证抬头离地时的擦尾余量；末端为 0.74×0.5 m 的椭圆 APU 排气口）——
const TP = G.tail;
const rel = (pts) => pts.map(([s, v]) => [s, zb0 + v]);
const tailTop = monotone(rel(TP.top), [0, null]);
const tailBot = monotone(rel(TP.bot), [0, null]);
const tailW = monotone(TP.width, [0, null]);
const tailZw = monotone(rel(TP.zw), [0, null]);
const TOP0 = TP.top[0][0], BOT0 = TP.bot[0][0], W0 = TP.width[0][0], ZW0 = TP.zw[0][0];
export const TAIL_START = Math.min(TOP0, BOT0, W0);

export const FUS = { L, zb0, zt0, zw0, hTip, floor: G.hb + G.floorAboveKeel };

/** 站位 s 处的截面参数：顶/底/最宽线高度、半宽 */
export function section(s, out = {}) {
  s = clamp(s, 0, L);
  let zt = zt0, zb = zb0, w = G.halfW, zw = zw0;
  if (s < NOSE_END) { zt = noseTop(s); zb = noseBot(s); w = noseW(s); zw = noseZw(s); }
  if (s > BOT0) zb = Math.max(zb, tailBot(s));
  if (s > TOP0) zt = Math.min(zt, tailTop(s));
  if (s > W0) w = Math.min(w, tailW(s));
  if (s > ZW0) zw = tailZw(s);
  zw = clamp(zw, zb + 0.02, zt - 0.02);
  out.zt = zt; out.zb = zb; out.w = w; out.zw = zw;
  return out;
}

const _sec = {};
/** 机身表面点 */
export function point(s, t, out = new THREE.Vector3()) {
  section(s, _sec);
  const st = Math.sin(t), ct = -Math.cos(t);
  out.x = s;
  out.z = _sec.w * st;
  out.y = ct >= 0 ? _sec.zw + (_sec.zt - _sec.zw) * ct : _sec.zw + (_sec.zw - _sec.zb) * ct;
  return out;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
/** 表面外法线（中心差分） */
export function normal(s, t, out = new THREE.Vector3()) {
  if (s < 1e-3) return out.set(-1, 0, 0);
  const hs = 0.01, ht = 0.002;
  point(Math.min(L, s + hs), t, _a); point(Math.max(0, s - hs), t, _b);
  point(s, t + ht, _c); point(s, t - ht, _d);
  _a.sub(_b); _c.sub(_d);
  out.crossVectors(_a, _c).normalize();
  if (!Number.isFinite(out.x)) out.set(-1, 0, 0);
  return out;
}

/** 由高度求参数 t（side: +1 左舷 / -1 右舷） */
export function tAtHeight(s, h, side = 1) {
  section(s, _sec);
  let ct;
  if (h >= _sec.zw) ct = clamp((h - _sec.zw) / (_sec.zt - _sec.zw), 0, 1);
  else ct = -clamp((_sec.zw - h) / (_sec.zw - _sec.zb), 0, 1);
  const t = Math.acos(-ct);
  return side > 0 ? t : Math.PI * 2 - t;
}

/** 表面某点沿 t 方向的弧长尺度（米/弧度） */
export function arcScale(s, t) {
  point(s, t + 0.001, _a); point(s, t - 0.001, _b);
  return _a.distanceTo(_b) / 0.002;
}

/** 截面周长 */
export function perimeter(s) {
  let p = 0;
  const N = 128;
  point(s, 0, _a);
  for (let i = 1; i <= N; i++) { point(s, (i / N) * Math.PI * 2, _b); p += _a.distanceTo(_b); _a.copy(_b); }
  return p;
}

// —— 生产分段（数据见 data/parts.js；边界取自框距网格与公开分段资料，误差约 ±0.3 m）——
export const SECTIONS = [
  { id: 'radome', from: 0, to: 1.25 },
  { id: 's41', from: 1.25, to: 13.69 },
  { id: 's43', from: 13.69, to: 23.2 },
  { id: 's44', from: 23.2, to: 31.7 },
  { id: 's46', from: 31.7, to: 45.41 },
  { id: 's47', from: 45.41, to: 52.1 },
  { id: 's48', from: 52.1, to: 56.4 },
  { id: 'tailcone', from: 56.4, to: L },
];

/** 全机身纵向采样站位（机头/机尾加密，并包含各分段边界） */
export function stations() {
  const nose = range(0, 10, 70, (u) => Math.pow(u, 1.9));
  const mid = range(10, 44, 68);
  const tail = range(44, L, 90);
  return mergeStations([nose, mid, tail, SECTIONS.map((s) => s.from), [L]]);
}

export const NT = 192; // 周向分段数

/** 某站位区间的蒙皮网格 */
export function skinGeometry(sa, sb, tRange = null) {
  const all = stations();
  const ss = all.filter((s) => s >= sa - 1e-6 && s <= sb + 1e-6);
  if (ss[0] > sa + 1e-6) ss.unshift(sa);
  if (ss[ss.length - 1] < sb - 1e-6) ss.push(sb);
  const t0 = tRange ? tRange[0] : 0, t1 = tRange ? tRange[1] : Math.PI * 2;
  const cols = tRange ? Math.max(8, Math.round((NT * (t1 - t0)) / (Math.PI * 2))) : NT;
  const g = grid(ss.length, tRange ? cols + 1 : cols, (i, j, out) => {
    const t = t0 + (t1 - t0) * (j / cols);
    point(ss[i], t, out);
  }, {
    closeCols: !tRange,
    uv: (i, j) => [ss[i] / L, (t0 + (t1 - t0) * (j / cols)) / (Math.PI * 2)],
  });
  // 解析法线，保证分段接缝处光顺
  const N = g.attributes.normal;
  const C = tRange ? cols + 1 : cols + 1;
  for (let i = 0; i < ss.length; i++) {
    for (let j = 0; j < C; j++) {
      const t = t0 + (t1 - t0) * (j / cols);
      normal(ss[i], t, _a);
      N.setXYZ(i * C + j, _a.x, _a.y, _a.z);
    }
  }
  return g;
}

// —— 舷窗/门的表面定位 ——
// 局部切平面坐标：u 沿站位（米），v 沿周向弧长（米，向上为正）
export function surfaceFrame(s, t) {
  const p = point(s, t, new THREE.Vector3());
  const n = normal(s, t, new THREE.Vector3());
  const k = arcScale(s, t);
  return { p, n, k };
}

/**
 * 在机身表面生成贴合曲面的小面片（窗、门窗等）。
 * shape(r, phi) → [u, v] 局部米坐标；offset 法向外移；side=+1 左舷/-1 右舷
 */
export function surfacePatch(sC, tC, shapeFn, { rings = 3, seg = 28, offset = 0.004, side = 1 } = {}) {
  const k = arcScale(sC, tC);
  const sign = side > 0 ? 1 : -1; // 左舷 t 增大向上；右舷 t 增大向下
  const pts = [];
  const nrm = [];
  const center = point(sC, tC, new THREE.Vector3());
  const cn = normal(sC, tC, new THREE.Vector3());
  pts.push(center.clone().addScaledVector(cn, offset)); nrm.push(cn.clone());
  for (let r = 1; r <= rings; r++) {
    for (let j = 0; j < seg; j++) {
      const phi = (j / seg) * Math.PI * 2;
      const [u, v] = shapeFn(r / rings, phi);
      const s = sC + u;
      const t = tC + (sign * v) / k;
      const p = point(s, t, new THREE.Vector3());
      const n = normal(s, t, new THREE.Vector3());
      pts.push(p.addScaledVector(n, offset)); nrm.push(n);
    }
  }
  const P = new Float32Array(pts.length * 3), N = new Float32Array(pts.length * 3), UV = new Float32Array(pts.length * 2);
  pts.forEach((p, i) => { P.set([p.x, p.y, p.z], i * 3); N.set([nrm[i].x, nrm[i].y, nrm[i].z], i * 3); });
  // UV：以局部坐标归一化（供窗框渐变使用）
  UV[0] = 0.5; UV[1] = 0.5;
  for (let r = 1; r <= rings; r++) for (let j = 0; j < seg; j++) {
    const idx = 1 + (r - 1) * seg + j;
    const phi = (j / seg) * Math.PI * 2;
    UV[idx * 2] = 0.5 + 0.5 * (r / rings) * Math.cos(phi);
    UV[idx * 2 + 1] = 0.5 + 0.5 * (r / rings) * Math.sin(phi);
  }
  const idx = [];
  for (let j = 0; j < seg; j++) {
    const a = 1 + j, b = 1 + ((j + 1) % seg);
    idx.push(0, a, b);
  }
  for (let r = 1; r < rings; r++) {
    for (let j = 0; j < seg; j++) {
      const a = 1 + (r - 1) * seg + j, b = 1 + (r - 1) * seg + ((j + 1) % seg);
      const c = 1 + r * seg + j, d = 1 + r * seg + ((j + 1) % seg);
      idx.push(a, c, d, a, d, b);
    }
  }
  // 绕序修正：确保三角形法线与表面法线同向
  const e1 = new THREE.Vector3(pts[1].x - pts[0].x, pts[1].y - pts[0].y, pts[1].z - pts[0].z);
  const e2 = new THREE.Vector3(pts[2].x - pts[0].x, pts[2].y - pts[0].y, pts[2].z - pts[0].z);
  if (new THREE.Vector3().crossVectors(e1, e2).dot(cn) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const x = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = x; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  g.setIndex(idx);
  return g;
}

/** 超椭圆（圆角矩形）形状函数，a/b 为半宽/半高，n 为指数 */
export function squircle(a, b, n = 4.2) {
  const e = 2 / n;
  return (r, phi) => [a * r * spow(Math.cos(phi), e), b * r * spow(Math.sin(phi), e)];
}

/** 由四角（s,t）参数定义的曲面四边形（驾驶舱风挡），Coons 双线性插值并贴合曲面 */
export function surfaceQuad(corners, { nu = 10, nv = 10, offset = 0.006, curveFn = null } = {}) {
  // corners: [[s,t] 左下, [s,t] 右下, [s,t] 右上, [s,t] 左上]（按参数域）
  const pos = (i, j, out) => {
    const u = i / nu, v = j / nv;
    let s = (1 - u) * (1 - v) * corners[0][0] + u * (1 - v) * corners[1][0] + u * v * corners[2][0] + (1 - u) * v * corners[3][0];
    let t = (1 - u) * (1 - v) * corners[0][1] + u * (1 - v) * corners[1][1] + u * v * corners[2][1] + (1 - u) * v * corners[3][1];
    if (curveFn) [s, t] = curveFn(s, t, u, v);
    point(s, t, out);
    normal(s, t, _d);
    out.addScaledVector(_d, offset);
  };
  const g = grid(nu + 1, nv + 1, pos, { uv: (i, j) => [i / nu, j / nv] });
  // 绕序校正：首个三角形法线须与机身外法线同向
  const P = g.attributes.position, I = g.index;
  const a = new THREE.Vector3().fromBufferAttribute(P, I.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(P, I.getX(1));
  const c = new THREE.Vector3().fromBufferAttribute(P, I.getX(2));
  const fn = b.clone().sub(a).cross(c.clone().sub(a));
  normal(corners[0][0], corners[0][1], _d);
  if (fn.dot(_d) < 0) {
    for (let k = 0; k < I.count; k += 3) { const x = I.getX(k + 1); I.setX(k + 1, I.getX(k + 2)); I.setX(k + 2, x); }
    I.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

export { zb0, zt0, zw0 };
