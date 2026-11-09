// 程序化贴图：全部由 Canvas 2D 代码绘制（涂装、蒙皮分缝线、舱门轮廓、凹凸贴图）
import * as THREE from 'three';
import { point, tAtHeight, section, SECTIONS, FUS } from '../model/fuselage.js';
import { DOORS, PAX_DOOR, CARGO_DOORS, WINDOW, windowStations } from '../model/layout.js';
import { gearDoorOutlines } from '../model/gear.js';
import { G } from '../model/spec.js';
import { clamp, smoothstep } from '../core/math.js';

const TAU = Math.PI * 2;
const _p = { x: 0, y: 0, z: 0 };
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

// —— 周向弧长表：把“展开面”坐标（站位 s，自最宽线起沿表面的弧长 a）映射到参数 t ——
const arcCache = new Map();
function arcTable(s) {
  const key = Math.round(s * 20);
  let tab = arcCache.get(key);
  if (tab) return tab;
  const sq = key / 20;
  const N = 720;
  const ts = new Float32Array(N + 1), ar = new Float32Array(N + 1);
  point(sq, 0, _v1);
  for (let i = 1; i <= N; i++) {
    const t = (i / N) * Math.PI;
    point(sq, t, _v2);
    ar[i] = ar[i - 1] + _v1.distanceTo(_v2);
    ts[i] = t;
    _v1.copy(_v2);
  }
  // 参考点：最宽线 t = π/2
  const ref = ar[N / 2];
  tab = { ts, ar, ref, N };
  arcCache.set(key, tab);
  return tab;
}

/** 展开坐标 → t。a 为自最宽线起沿表面向上的弧长（米）；side +1 左 / -1 右 */
export function tFromArc(s, a, side = 1) {
  const { ts, ar, ref, N } = arcTable(s);
  const target = clamp(ref + a, 0, ar[N]);
  let lo = 0, hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ar[m] <= target) lo = m; else hi = m; }
  const f = (target - ar[lo]) / Math.max(1e-9, ar[hi] - ar[lo]);
  const t = ts[lo] + (ts[hi] - ts[lo]) * f;
  return side > 0 ? t : TAU - t;
}

/** 高度 → 展开弧长坐标 */
export function arcFromHeight(s, h) {
  const t = tAtHeight(s, h, 1);
  const { ts, ar, ref, N } = arcTable(s);
  const i = clamp(Math.round((t / Math.PI) * N), 0, N);
  return ar[i] - ref;
}

/** 圆角矩形轮廓（展开坐标），返回 [s,a] 点列 */
function roundRectPts(sC, aC, w, h, r, n = 10) {
  const pts = [];
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw, hh);
  const corners = [
    [sC + hw - r, aC + hh - r, 0],
    [sC - hw + r, aC + hh - r, Math.PI / 2],
    [sC - hw + r, aC - hh + r, Math.PI],
    [sC + hw - r, aC - hh + r, Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

export function createFuselageTextures(quality = 'high') {
  const W = quality === 'high' ? 8192 : 4096;
  const H = W / 4;
  const L = G.L;
  const X = (s) => (s / L) * W;
  const Y = (t) => (t / TAU) * H;
  const pxPerM_s = W / L;

  const color = document.createElement('canvas');
  color.width = W; color.height = H;
  const c = color.getContext('2d');
  const bump = document.createElement('canvas');
  bump.width = W / 2; bump.height = H / 2;
  const b = bump.getContext('2d');
  b.scale(0.5, 0.5);

  // 基础白漆
  c.fillStyle = '#f3f5f7';
  c.fillRect(0, 0, W, H);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, W, H);

  // 机腹浅灰色涂装 + 深蓝/浅蓝饰线：分界高度沿机身变化
  const hBelly = (s) => {
    const base = FUS.zb0 + 2.25;
    const front = smoothstep(1.2, 9, s);
    const rear = 1 - smoothstep(48, 61.5, s) * 0.6;
    return FUS.zb0 + (base - FUS.zb0) * front * rear + (1 - front) * 0.6;
  };
  const bellyPoly = (side, offset = 0) => {
    const pts = [];
    for (let s = 1.0; s <= L - 0.4; s += 0.25) {
      const sec = point(s, 0, _v1);
      const h = Math.max(sec.y + 0.05, hBelly(s) + offset);
      pts.push([s, tAtHeight(s, h, side)]);
    }
    return pts;
  };
  const fillBelly = (ctx, fill, offset) => {
    ctx.fillStyle = fill;
    for (const side of [1, -1]) {
      const pts = bellyPoly(side, offset);
      ctx.beginPath();
      if (side > 0) {
        ctx.moveTo(X(pts[0][0]), 0);
        for (const [s, t] of pts) ctx.lineTo(X(s), Y(t));
        ctx.lineTo(X(pts[pts.length - 1][0]), 0);
      } else {
        ctx.moveTo(X(pts[0][0]), H);
        for (const [s, t] of pts) ctx.lineTo(X(s), Y(t));
        ctx.lineTo(X(pts[pts.length - 1][0]), H);
      }
      ctx.closePath();
      ctx.fill();
    }
  };
  fillBelly(c, '#1c4f8f', 0.2); // 深蓝饰线（上沿）
  fillBelly(c, '#f3f5f7', 0.09);
  fillBelly(c, '#5fa8e8', 0.06); // 浅蓝细线
  fillBelly(c, '#d5dbe2', 0.0); // 机腹浅灰

  // —— 分缝线工具 ——
  const lineSA = (ctx, pts, side, width, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([s, a], i) => {
      const t = tFromArc(s, a, side);
      if (i === 0) ctx.moveTo(X(s), Y(t)); else ctx.lineTo(X(s), Y(t));
    });
    ctx.closePath();
    ctx.stroke();
  };
  const ring = (s, width, cStyle, bStyle) => {
    c.fillStyle = cStyle; c.fillRect(X(s) - width / 2, 0, width, H);
    b.fillStyle = bStyle; b.fillRect(X(s) - width / 2, 0, width * 1.4, H);
  };

  // 分段对接缝（一体化复合材料筒段之间的环向对接）
  for (const sec of SECTIONS.slice(1)) ring(sec.from, 2.2, 'rgba(70,80,92,0.55)', '#3a3a3a');

  // 旅客门（两侧）
  const sillA = (s) => arcFromHeight(s, FUS.zb0 + PAX_DOOR.sill);
  for (const d of DOORS) {
    for (const side of [1, -1]) {
      const a0 = sillA(d.s);
      const aC = a0 + PAX_DOOR.h / 2;
      const pts = roundRectPts(d.s, aC, PAX_DOOR.w, PAX_DOOR.h, PAX_DOOR.r);
      lineSA(c, pts, side, 2.6, 'rgba(60,70,82,0.85)');
      lineSA(b, pts, side, 4, '#202020');
      // 门把手凹槽 + 门上小窗由几何体生成
      const hp = roundRectPts(d.s, a0 + 0.95, 0.32, 0.07, 0.03, 4);
      lineSA(c, hp, side, 1.6, 'rgba(60,70,82,0.6)');
      lineSA(b, hp, side, 2.5, '#303030');
      // 舱门边红色警示标记（外部开门指示）
      const mark = roundRectPts(d.s, a0 + PAX_DOOR.h + 0.12, 0.6, 0.06, 0.02, 3);
      c.fillStyle = 'rgba(190,40,40,0.75)';
      c.beginPath();
      mark.forEach(([s, a], i) => { const t = tFromArc(s, a, side); i ? c.lineTo(X(s), Y(t)) : c.moveTo(X(s), Y(t)); });
      c.closePath(); c.fill();
    }
  }

  // 货舱门（前/后货舱门在右舷，散货舱门在左舷）
  for (const d of CARGO_DOORS) {
    const aB = arcFromHeight(d.s, FUS.zb0 + d.bottom);
    const pts = roundRectPts(d.s, aB + d.h / 2, d.w, d.h, d.r);
    lineSA(c, pts, d.side, 2.6, 'rgba(60,70,82,0.85)');
    lineSA(b, pts, d.side, 4, '#202020');
    const hp = roundRectPts(d.s, aB + 0.2, 0.36, 0.08, 0.03, 4);
    lineSA(c, hp, d.side, 1.6, 'rgba(60,70,82,0.6)');
    if (d.hinge === 'top') {
      // 铰链线（门上沿外侧的整流条）
      const hl = roundRectPts(d.s, aB + d.h + 0.06, d.w * 0.92, 0.04, 0.01, 2);
      lineSA(c, hl, d.side, 1.4, 'rgba(60,70,82,0.5)');
    }
  }

  // 舷窗凹框（几何玻璃覆盖其中心）
  const winA = (s) => arcFromHeight(s, FUS.floor + WINDOW.centerAboveFloor);
  for (const s of windowStations()) {
    for (const side of [1, -1]) {
      const pts = roundRectPts(s, winA(s), WINDOW.w + 0.07, WINDOW.h + 0.07, 0.12, 6);
      lineSA(c, pts, side, 2, 'rgba(120,130,140,0.55)');
      lineSA(b, pts, side, 5, '#4a4a4a');
    }
  }

  // 机头：雷达罩对接线、驾驶舱下方检修口、静压孔
  const accessPanel = (s, h, w, hh, side, r = 0.05) => {
    const pts = roundRectPts(s, arcFromHeight(s, h), w, hh, r, 4);
    lineSA(c, pts, side, 1.6, 'rgba(70,80,92,0.55)');
    lineSA(b, pts, side, 2.4, '#3a3a3a');
  };
  for (const side of [1, -1]) {
    accessPanel(5.0, FUS.zb0 + 1.45, 0.6, 0.45, side);
    accessPanel(9.2, FUS.zb0 + 1.2, 0.9, 0.55, side);
    accessPanel(23.4, FUS.zb0 + 1.6, 0.5, 0.4, side);
    accessPanel(49.2, FUS.zb0 + 1.9, 0.55, 0.45, side);
    accessPanel(57.0, FUS.zb0 + 3.3, 0.7, 0.5, side); // APU 舱检修门
    // 静压孔（小圆）
    for (const ds of [0, 0.18]) {
      const s = 4.15 + ds;
      const t = tAtHeight(s, FUS.zb0 + 2.55, side);
      c.fillStyle = 'rgba(80,90,100,0.9)';
      c.beginPath(); c.arc(X(s), Y(t), 3, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(160,170,180,0.9)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(X(s), Y(t), 6, 0, TAU); c.stroke();
    }
  }
  // 起落架舱门分缝线（前轮舱 2×2 块、主轮舱每侧内外 2 块）；跨越 t=0 接缝时在两端各画一次
  const lineST = (ctx, pts, width, style) => {
    for (const shift of [0, TAU]) {
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([s, t], i) => { const y = Y(t + shift); if (i === 0) ctx.moveTo(X(s), y); else ctx.lineTo(X(s), y); });
      ctx.closePath(); ctx.stroke();
    }
  };
  for (const pts of gearDoorOutlines()) {
    lineST(c, pts, 2.2, 'rgba(60,70,82,0.75)');
    lineST(b, pts, 3.2, '#2a2a2a');
  }
  // APU 舱门（尾锥下部两侧的大面板）
  for (const side of [1, -1]) {
    const pts = [];
    const lo = (s) => { const q = section(s); return q.zb + 0.28; };
    const hi = (s) => { const q = section(s); return q.zw + 0.22; };
    for (let s = 56.7; s <= 60.6; s += 0.2) pts.push([s, arcFromHeight(s, lo(s))]);
    for (let s = 60.6; s >= 56.7; s -= 0.2) pts.push([s, arcFromHeight(s, hi(s))]);
    lineSA(c, pts, side, 1.8, 'rgba(70,80,92,0.6)');
    lineSA(b, pts, side, 2.6, '#353535');
  }

  // 机身文字：787-9（深蓝），位于 1、2 号门之间窗线上方
  const drawText = (txt, s, h, side, sizeM, colorStr, font = '700') => {
    const t = tAtHeight(s, h, side);
    const pxPerM_t = H / (TAU * 2.95);
    c.save();
    c.translate(X(s), Y(t));
    // 让文字在表面上保持正确比例，右舷需镜像方向
    // 左舷画布 +y 对应机身向上，需上下翻转；右舷画布 +x 在观察者左侧，需水平镜像
    c.scale((side > 0 ? 1 : -1) * (pxPerM_s / pxPerM_t), side > 0 ? -1 : 1);
    c.fillStyle = colorStr;
    c.font = `${font} ${sizeM * pxPerM_t}px "Helvetica Neue", Arial, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(txt, 0, 0);
    c.restore();
  };
  drawText('787-9', 12.3, FUS.floor + 2.05, 1, 0.5, '#123a6e');
  drawText('787-9', 12.3, FUS.floor + 2.05, -1, 0.5, '#123a6e');
  drawText('DREAMLINER', 26.5, FUS.floor + 2.02, 1, 0.42, '#1c4f8f', '600');
  drawText('DREAMLINER', 26.5, FUS.floor + 2.02, -1, 0.42, '#1c4f8f', '600');

  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.anisotropy = 8;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.RepeatWrapping;
  const bumpMap = new THREE.CanvasTexture(bump);
  bumpMap.flipY = false;
  bumpMap.anisotropy = 8;
  bumpMap.wrapT = THREE.RepeatWrapping;
  return { map, bumpMap, canvas: color };
}

/** 通用：带接缝线与检修口的机翼贴图（u 沿展向，v 沿弦向表面参数） */
export function createPanelTexture({ w = 2048, h = 512, base = '#c9cfd6', lines = [], panels = [] } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(60,66,74,0.45)';
  g.lineWidth = 2;
  for (const [u0, v0, u1, v1] of lines) { g.beginPath(); g.moveTo(u0 * w, v0 * h); g.lineTo(u1 * w, v1 * h); g.stroke(); }
  for (const [u, v, pw, ph] of panels) { g.strokeRect((u - pw / 2) * w, (v - ph / 2) * h, pw * w, ph * h); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
