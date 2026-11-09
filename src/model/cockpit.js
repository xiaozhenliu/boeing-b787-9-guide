// 驾驶舱风挡（787 为 4 块窗：2 块前风挡 + 2 块侧窗）与机头探头
// 轮廓依据 ACAPS 总图平面/正视图数字化（≈36 px/m），角点代入机身曲面复核：
// 前风挡下缘为等高线（距机腹约 3.52 m），上缘 4.04→4.17 m；侧窗前高后低、向后收窄。
import * as THREE from 'three';
import { section, point, normal, FUS } from './fuselage.js';
import { merge } from '../geom/build.js';
import { clamp } from '../core/math.js';

const _s = {};
const TAU = Math.PI * 2;
/** 上半截面上给定横向坐标 z 对应的参数 t（左舷 z>0） */
export function tAtLateralUpper(s, z) {
  section(s, _s);
  const sn = clamp(Math.abs(z) / _s.w, 0, 0.9999);
  const t = Math.PI - Math.asin(sn);
  return z >= 0 ? t : TAU - t;
}
/** 给定高度的参数 t（侧面） */
export function tAtH(s, h, side) {
  section(s, _s);
  let ct;
  if (h >= _s.zw) ct = clamp((h - _s.zw) / (_s.zt - _s.zw), 0, 1);
  else ct = -clamp((_s.zw - h) / (_s.zw - _s.zb), 0, 1);
  const t = Math.acos(-ct);
  return side > 0 ? t : TAU - t;
}
/**
 * 正视投影坐标 (横向 lat, 高度 h) → 机头上半曲面参数 (s, t)。
 * 机头截面随 s 单调增大，F(s) = (lat/w)² + ((h−zw)/(zt−zw))² − 1 单调递减，二分即可。
 */
export function stAtLatH(lat, h, side = 1) {
  lat = Math.max(0.002, lat);
  const F = (s) => {
    section(s, _s);
    const x = lat / Math.max(_s.w, 1e-6), y = (h - _s.zw) / (_s.zt - _s.zw);
    return x * x + y * y - 1;
  };
  let a = 0, b = 8;
  for (let k = 0; k < 44; k++) { const m = (a + b) / 2; if (F(m) > 0) a = m; else b = m; }
  const s = (a + b) / 2;
  section(s, _s);
  const sn = clamp(lat / _s.w, 0, 1), cs = clamp((h - _s.zw) / (_s.zt - _s.zw), -1, 1);
  const t = Math.atan2(sn, -cs); // sin t = sn，−cos t = cs → t∈[π/2, π]
  return [s, side > 0 ? t : TAU - t];
}

const hb = FUS.zb0;

/** 风挡定义（左舷；右舷镜像）。前风挡用正视坐标 [横向, 高度]，侧窗用侧视坐标 [s, 高度]（高度相对机腹线） */
export const COCKPIT = {
  front: { // 内下、外下、外上、内上
    quad: [[0.05, 3.522], [0.94, 3.55], [0.865, 4.16], [0.05, 4.1]],
    r: 0.09,
  },
  side: { // 前下、后下、后上、前上
    quad: [[2.37, 3.62], [3.5, 3.76], [3.47, 4.08], [2.75, 4.12]],
    r: 0.11,
  },
  frame: 0.045, // 黑色窗框（密封胶条 + 漆边）宽度
};

// —— 二维轮廓工具（参数平面内）——
const lerp2 = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
const dist2 = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
/** 凸多边形各边向外平移 g（交点法），用于生成窗框外轮廓 */
function offsetPoly(c, g) {
  const n = c.length;
  let A = 0;
  for (let i = 0; i < n; i++) { const p = c[i], q = c[(i + 1) % n]; A += p[0] * q[1] - q[0] * p[1]; }
  const sg = A > 0 ? 1 : -1;
  const lines = c.map((p, i) => {
    const q = c[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
    return { x: p[0] + (sg * dy / L) * g, y: p[1] - (sg * dx / L) * g, dx, dy };
  });
  return c.map((_, i) => {
    const l0 = lines[(i + n - 1) % n], l1 = lines[i];
    const det = l0.dx * l1.dy - l0.dy * l1.dx;
    const u = ((l1.x - l0.x) * l1.dy - (l1.y - l0.y) * l1.dx) / det;
    return [l0.x + l0.dx * u, l0.y + l0.dy * u];
  });
}
/** 圆角轮廓：每个角用二次 Bézier 过渡，边上均匀加点 */
function roundedOutline(c, r, nEdge = 7, nCorner = 8) {
  const n = c.length, out = [];
  const cut = (i, j) => Math.min(r, dist2(c[i], c[j]) * 0.42) / dist2(c[i], c[j]);
  for (let i = 0; i < n; i++) {
    const ip = (i + n - 1) % n, inx = (i + 1) % n;
    const A = lerp2(c[i], c[ip], cut(i, ip));
    const B = lerp2(c[i], c[inx], cut(i, inx));
    for (let k = 0; k <= nCorner; k++) {
      const u = k / nCorner, w0 = (1 - u) ** 2, w1 = 2 * u * (1 - u), w2 = u * u;
      out.push([w0 * A[0] + w1 * c[i][0] + w2 * B[0], w0 * A[1] + w1 * c[i][1] + w2 * B[1]]);
    }
    const A2 = lerp2(c[inx], c[i], cut(inx, i));
    for (let k = 1; k < nEdge; k++) out.push(lerp2(B, A2, k / nEdge));
  }
  return out;
}
/** 把参数平面内的凸轮廓贴到机身曲面上（质心放射环三角化，法线取解析曲面法线） */
function surfaceWindow(outline, map, { rings = 4, offset = 0.01 } = {}) {
  const N = outline.length;
  const c = outline.reduce((a, p) => [a[0] + p[0] / N, a[1] + p[1] / N], [0, 0]);
  const pos = [], nrm = [], uv = [], idx = [];
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (const p of outline) { minA = Math.min(minA, p[0]); maxA = Math.max(maxA, p[0]); minB = Math.min(minB, p[1]); maxB = Math.max(maxB, p[1]); }
  const P = new THREE.Vector3(), Nn = new THREE.Vector3();
  const push = (a, b) => {
    const [s, t] = map(a, b);
    point(s, t, P); normal(s, t, Nn);
    P.addScaledVector(Nn, offset);
    pos.push(P.x, P.y, P.z); nrm.push(Nn.x, Nn.y, Nn.z);
    uv.push((a - minA) / (maxA - minA), (b - minB) / (maxB - minB));
  };
  push(c[0], c[1]);
  for (let k = 1; k <= rings; k++) {
    const f = k / rings;
    for (const p of outline) push(c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f);
  }
  for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N));
  for (let k = 1; k < rings; k++) {
    const r0 = 1 + (k - 1) * N, r1 = 1 + k * N;
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; idx.push(r0 + i, r1 + i, r1 + j, r0 + i, r1 + j, r0 + j); }
  }
  // 绕序校正：首个三角形几何法线须与曲面外法线同向
  const v = (k) => new THREE.Vector3(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]);
  const i0 = idx[N * 3], i1 = idx[N * 3 + 1], i2 = idx[N * 3 + 2];
  const fn = v(i1).sub(v(i0)).cross(v(i2).sub(v(i0)));
  if (fn.dot(new THREE.Vector3(nrm[3 * i0], nrm[3 * i0 + 1], nrm[3 * i0 + 2])) < 0)
    for (let k = 0; k < idx.length; k += 3) { const x = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = x; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const frontMap = (side) => (lat, h) => stAtLatH(lat, hb + h, side);
const sideMap = (side) => (s, h) => [s, tAtH(s, hb + h, side)];

/** 单块窗的玻璃与窗框几何 */
export function windowGeometry(kind, side, grow = 0, offset = 0.01) {
  const def = COCKPIT[kind];
  const quad = grow ? offsetPoly(def.quad, grow) : def.quad;
  const outline = roundedOutline(quad, def.r + grow);
  return surfaceWindow(outline, kind === 'front' ? frontMap(side) : sideMap(side), { offset });
}

export function buildCockpitWindows(M) {
  const group = new THREE.Group();
  group.name = 'cockpitWindows';
  const glass = [], frames = [];
  for (const side of [1, -1]) {
    for (const kind of ['front', 'side']) {
      glass.push(windowGeometry(kind, side, 0, 0.011));
      frames.push(windowGeometry(kind, side, COCKPIT.frame, 0.005));
    }
  }
  const gm = new THREE.Mesh(merge(glass), M.cockpitGlass);
  const fm = new THREE.Mesh(merge(frames), M.frameDark);
  gm.userData.partId = 'cockpit'; fm.userData.partId = 'cockpit';
  gm.userData.comp = 'compGlass'; fm.userData.comp = 'compOther';
  group.add(fm, gm);
  return group;
}

/** 机头探头：皮托管（3 个）、迎角传感器（2 个）、总温探头 */
export function buildProbes(M) {
  const group = new THREE.Group();
  const parts = [];
  const add = (s, h, side, len, angleDown, r = 0.022) => {
    const t = tAtH(s, h, side);
    const p = point(s, t, new THREE.Vector3());
    const n = normal(s, t, new THREE.Vector3());
    // 探头沿法线伸出后向前弯折（L 形皮托管）
    const base = p.clone();
    const elbow = p.clone().addScaledVector(n, len);
    const tip = elbow.clone().add(new THREE.Vector3(-0.22, -Math.sin(angleDown) * 0.05, 0));
    const mast = new THREE.CylinderGeometry(r * 0.7, r * 1.6, len, 10);
    mast.translate(0, len / 2, 0);
    mast.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n));
    mast.translate(base.x, base.y, base.z);
    const head = new THREE.CylinderGeometry(r * 0.55, r * 0.75, 0.24, 10);
    head.rotateZ(Math.PI / 2);
    head.translate((elbow.x + tip.x) / 2, elbow.y, elbow.z);
    parts.push(mast, head);
  };
  add(3.55, hb + 2.75, 1, 0.13, 0);
  add(3.85, hb + 2.45, 1, 0.13, 0);
  add(3.55, hb + 2.75, -1, 0.13, 0);
  // 迎角传感器（小叶片）
  const vane = (s, h, side) => {
    const t = tAtH(s, h, side);
    const p = point(s, t, new THREE.Vector3());
    const n = normal(s, t, new THREE.Vector3());
    const g = new THREE.BoxGeometry(0.16, 0.12, 0.012);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(0.18, 0); shape.lineTo(0.1, 0.11); shape.lineTo(0.03, 0.11); shape.closePath();
    const ex = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
    ex.translate(-0.09, 0, -0.006);
    // 叶片平面包含法线与机身纵轴
    const xAxis = new THREE.Vector3(1, 0, 0);
    const yAxis = n.clone();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
    const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(p);
    ex.applyMatrix4(m);
    g.dispose();
    parts.push(ex);
  };
  vane(4.6, hb + 2.15, 1);
  vane(4.6, hb + 2.15, -1);
  const mesh = new THREE.Mesh(merge(parts), M.titanium);
  mesh.castShadow = true;
  mesh.userData.partId = 'probes';
  mesh.userData.comp = 'compSteel';
  group.add(mesh);
  return group;
}
