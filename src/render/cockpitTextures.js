// 驾驶舱程序化贴图（全部 Canvas 2D 绘制）：5 块显示器画面、HUD、EFB、遮光罩 MCP、顶板、中央操纵台面板，
// 以及第一人称时给蒙皮内表面开窗洞用的风挡遮罩。
// 显示器内容为“巡航中”的示意状态（M 0.85 / FL370 / 航向 285°）。配色沿用波音显示规范：
// 白 = 当前值与刻度，品红 = 目标值与现用航路，绿 = 已接通的模式，青 = 标签，琥珀 = 警戒。
import * as THREE from 'three';
import { FUS } from '../model/fuselage.js';
import { windowOutlinesST } from '../model/cockpit.js';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

/** 遮罩覆盖的机头站位范围 s ∈ [0, MASK_S]（m） */
export const MASK_S = 4.5;

/** 显示器图集（逻辑像素）：各画面区域 [x, y, w, h]；u 向右、v 向下（贴图 flipY = false） */
export const FD_ATLAS = {
  W: 2048, H: 1024,
  rects: {
    lob: [0, 0, 512, 384], // 机长外侧屏：AUX + PFD
    lib: [512, 0, 512, 384], // 机长内侧屏：ND + EICAS
    rib: [1024, 0, 512, 384], // 副驾驶内侧屏：电源简图 + ND
    rob: [1536, 0, 512, 384], // 副驾驶外侧屏：PFD + AUX
    lcd: [0, 384, 512, 384], // 下中央屏：CDU 航段页
    hud: [512, 384, 512, 384], // 平视显示器符号（黑底，叠加混合）
    efb: [1024, 384, 512, 384], // 电子飞行包：航路图
    mcp: [0, 768, 2048, 128], // 遮光罩后立面：EFIS/DSP + MCP + DSP/EFIS
  },
};
/** MCP 立面贴图对应的实际宽度（m，z 从 +MCP_W/2 到 −MCP_W/2） */
export const MCP_W = 2.08;
/** MCP 上的旋钮（贴图坐标 x, y, 半径 px），由模型生成立体旋钮 */
export const MCP_KNOBS = [[86, 66, 19], [262, 66, 19], [800, 88, 17], [1046, 86, 20], [1288, 88, 17], [1786, 66, 19], [1962, 66, 19]];

/** 面板图集：顶板与中央操纵台台面 */
export const FD_PANELS = { W: 1024, H: 800, rects: { ovh: [0, 0, 600, 786], ped: [604, 0, 416, 776] } };

const C = {
  w: '#eef2f6', mag: '#ff4dff', grn: '#38f06a', cyan: '#36dcff', amb: '#ffb21e', red: '#ff3c3c',
  grey: '#8e98a4', dim: '#4a525c', bg: '#04070b', tape: '#424953', sky: '#1677e4', gnd: '#8c5526',
};
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = 'Menlo, Consolas, "DejaVu Sans Mono", monospace';

function canvas(W, H, k) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  const g = cv.getContext('2d');
  g.scale(k, k);
  return { cv, g };
}
function T(g, s, x, y, c = C.w, px = 12, al = 'left', w = 600, font = SANS) {
  g.fillStyle = c; g.font = `${w} ${px}px ${font}`; g.textAlign = al; g.textBaseline = 'middle';
  g.fillText(s, x, y);
}
function L(g, pts, c = C.w, lw = 1.5) {
  g.strokeStyle = c; g.lineWidth = lw; g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}
function R(g, x, y, w, h, { fill = null, stroke = null, lw = 1.2, r = 0 } = {}) {
  g.beginPath();
  if (r && g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function poly(g, pts, { fill = null, stroke = null, lw = 1.4 } = {}) {
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function circle(g, x, y, r, { fill = null, stroke = null, lw = 1.4 } = {}) {
  g.beginPath(); g.arc(x, y, r, 0, TAU);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
const at = (g, x, y, fn) => { g.save(); g.translate(x, y); fn(); g.restore(); };
const clipRect = (g, x, y, w, h) => { g.beginPath(); g.rect(x, y, w, h); g.clip(); };

// ———————————————————— 主飞行显示器 PFD ————————————————————
function pfd(g, w, h) {
  R(g, 0, 0, w, h, { fill: C.bg });
  const cx = w / 2 - 2, cy = 170, ppd = 6.4, pitch = 2.5;
  // 飞行方式通告（FMA）：自动油门 | 横向 | 纵向；下面一行是自动驾驶状态
  L(g, [[w * 0.36, 6], [w * 0.36, 30]], C.grey, 1); L(g, [[w * 0.64, 6], [w * 0.64, 30]], C.grey, 1);
  T(g, 'SPD', w * 0.18, 18, C.grn, 15, 'center'); T(g, 'LNAV', w * 0.5, 18, C.grn, 15, 'center'); T(g, 'VNAV PTH', w * 0.82, 18, C.grn, 15, 'center');
  T(g, 'A/P', cx, 44, C.grn, 16, 'center', 700);
  // 姿态仪：蓝天棕地
  const ax0 = 62, ax1 = w - 70, ay0 = 58, ay1 = 288;
  g.save();
  g.beginPath(); g.roundRect ? g.roundRect(ax0, ay0, ax1 - ax0, ay1 - ay0, 22) : g.rect(ax0, ay0, ax1 - ax0, ay1 - ay0); g.clip();
  const hy = cy + pitch * ppd;
  g.fillStyle = C.sky; g.fillRect(ax0, ay0, ax1 - ax0, hy - ay0);
  g.fillStyle = C.gnd; g.fillRect(ax0, hy, ax1 - ax0, ay1 - hy);
  L(g, [[ax0, hy], [ax1, hy]], C.w, 2);
  g.save(); clipRect(g, cx - 72, cy - 84, 144, 168);
  for (let p = -20; p <= 25; p += 2.5) {
    if (p === 0) continue;
    const y = hy - p * ppd, half = p % 10 === 0 ? 34 : p % 5 === 0 ? 21 : 9;
    L(g, [[cx - half, y], [cx + half, y]], C.w, 1.7);
    if (p % 10 === 0) { T(g, String(Math.abs(p)), cx - half - 13, y, C.w, 13, 'center'); T(g, String(Math.abs(p)), cx + half + 13, y, C.w, 13, 'center'); }
  }
  g.restore();
  g.restore();
  // 坡度刻度与指针
  const rb = 96;
  g.strokeStyle = C.w; g.lineWidth = 1.8;
  g.beginPath(); g.arc(cx, cy, rb, -Math.PI / 2 - 60 * D2R, -Math.PI / 2 + 60 * D2R); g.stroke();
  for (const b of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
    const a = -Math.PI / 2 + b * D2R, l = Math.abs(b) === 30 || Math.abs(b) === 60 ? 13 : 7;
    L(g, [[cx + Math.cos(a) * rb, cy + Math.sin(a) * rb], [cx + Math.cos(a) * (rb + l), cy + Math.sin(a) * (rb + l)]], C.w, 1.8);
  }
  poly(g, [[cx, cy - rb], [cx - 7, cy - rb - 11], [cx + 7, cy - rb - 11]], { stroke: C.w, lw: 1.6 });
  poly(g, [[cx, cy - rb + 1], [cx - 7, cy - rb + 12], [cx + 7, cy - rb + 12]], { fill: C.w });
  // 飞行指引（品红十字）与飞机符号
  L(g, [[cx - 50, cy + 1], [cx + 50, cy + 1]], C.mag, 3.2); L(g, [[cx, cy - 50], [cx, cy + 50]], C.mag, 3.2);
  for (const sg of [-1, 1]) {
    poly(g, [[cx + sg * 64, cy - 3.5], [cx + sg * 22, cy - 3.5], [cx + sg * 22, cy + 13], [cx + sg * 29, cy + 13], [cx + sg * 29, cy + 3.5], [cx + sg * 64, cy + 3.5]], { fill: '#000', stroke: C.w, lw: 1.6 });
  }
  R(g, cx - 4, cy - 4, 8, 8, { fill: '#000', stroke: C.w, lw: 1.6 });
  // 空速带
  const sx = 6, sw = 50, ias = 271, ppk = 3.1;
  g.save(); clipRect(g, sx, ay0, sw, ay1 - ay0);
  R(g, sx, ay0, sw, ay1 - ay0, { fill: C.tape });
  for (let v = Math.floor((ias - 45) / 10) * 10; v <= ias + 45; v += 10) {
    const y = cy - (v - ias) * ppk;
    L(g, [[sx + sw - 9, y], [sx + sw, y]], C.w, 1.6);
    if (v % 20 === 0) T(g, String(v), sx + sw - 12, y, C.w, 14, 'right');
  }
  poly(g, [[sx + sw, cy - 8], [sx + sw - 9, cy - 8], [sx + sw - 9, cy + 8], [sx + sw, cy + 8]], { fill: C.mag }); // 速度游标
  g.restore();
  poly(g, [[sx - 2, cy - 15], [sx + sw - 8, cy - 15], [sx + sw - 8, cy - 6], [sx + sw, cy], [sx + sw - 8, cy + 6], [sx + sw - 8, cy + 15], [sx - 2, cy + 15]], { fill: '#000', stroke: C.w, lw: 1.6 });
  T(g, String(ias), sx + sw / 2 - 2, cy + 1, C.w, 21, 'center', 700);
  T(g, '.850', sx + sw / 2, ay0 - 11, C.mag, 15, 'center', 700);
  T(g, '.850', sx + sw / 2, ay1 + 15, C.w, 17, 'center', 700);
  // 高度带
  const hx = w - 64, hw = 46, alt = 37000, ppf = 0.3;
  g.save(); clipRect(g, hx, ay0, hw, ay1 - ay0);
  R(g, hx, ay0, hw, ay1 - ay0, { fill: C.tape });
  for (let a = alt - 400; a <= alt + 400; a += 100) {
    const y = cy - (a - alt) * ppf;
    L(g, [[hx, y], [hx + 8, y]], C.w, 1.6);
    if (a % 200 === 0) T(g, String(a), hx + 10, y, C.w, 12, 'left');
  }
  R(g, hx, cy - 7, 6, 14, { fill: C.mag }); // 高度游标（选定 37000）
  g.restore();
  poly(g, [[hx + hw + 2, cy - 15], [hx + 8, cy - 15], [hx + 8, cy - 6], [hx, cy], [hx + 8, cy + 6], [hx + 8, cy + 15], [hx + hw + 2, cy + 15]], { fill: '#000', stroke: C.w, lw: 1.6 });
  T(g, '37', hx + 27, cy + 1, C.w, 20, 'right', 700); T(g, '000', hx + 27, cy + 2, C.w, 14, 'left', 700);
  T(g, '37000', hx + hw / 2, ay0 - 11, C.mag, 14, 'center', 700);
  T(g, 'STD', hx + hw / 2, ay1 + 15, C.grn, 16, 'center', 700);
  // 升降速度表（平飞，指针指 0）
  const vx = w - 14;
  poly(g, [[vx, ay0 + 30], [vx + 12, ay0 + 52], [vx + 12, ay1 - 52], [vx, ay1 - 30]], { fill: C.tape });
  for (const [dv, l] of [[0, 8], [-40, 5], [40, 5], [-70, 5], [70, 5]]) L(g, [[vx, cy + dv], [vx + l, cy + dv]], C.w, 1.4);
  L(g, [[vx + 2, cy], [vx + 12, cy]], C.w, 2.4);
  // 航向（罗盘弧）
  const hcy = h + 64, rh = 120, hdg = 285;
  g.save(); clipRect(g, 0, 300, w, h - 300);
  circle(g, cx, hcy, rh, { fill: '#2b3139' });
  // 小地图（mini-map）：罗盘弧内显示前方航路——现用航段（品红）指向 OMBAX，方位 289°，比航向偏右 4°
  const mm = (d, r) => [cx + Math.sin(d * D2R) * r, hcy - Math.cos(d * D2R) * r];
  L(g, [mm(4, 40), mm(4, rh - 34)], C.mag, 2.4);
  for (let d = -40; d <= 40; d += 5) {
    const a = -Math.PI / 2 + d * D2R, brg = hdg + d, l = brg % 10 === 0 ? 10 : 6;
    L(g, [[cx + Math.cos(a) * rh, hcy + Math.sin(a) * rh], [cx + Math.cos(a) * (rh - l), hcy + Math.sin(a) * (rh - l)]], C.w, 1.5);
    if (brg % 10 === 0 && Math.abs(d) <= 30) {
      g.save(); g.translate(cx + Math.cos(a) * (rh - 21), hcy + Math.sin(a) * (rh - 21)); g.rotate(d * D2R);
      T(g, String((brg / 10) % 36), 0, 0, C.w, 13, 'center'); g.restore();
    }
  }
  g.restore();
  poly(g, [[cx - 9, hcy - rh - 1], [cx + 9, hcy - rh - 1], [cx + 9, hcy - rh + 5], [cx + 3, hcy - rh + 5], [cx, hcy - rh + 1], [cx - 3, hcy - rh + 5], [cx - 9, hcy - rh + 5]], { fill: C.mag }); // 航向游标
  R(g, cx - 24, hcy - rh - 26, 48, 22, { fill: '#000', stroke: C.w, lw: 1.5 });
  T(g, '285', cx, hcy - rh - 14, C.w, 17, 'center', 700);
  T(g, 'MAG', cx + 44, hcy - rh - 14, C.grn, 13, 'center', 700);
  T(g, 'H 285', cx - 66, hcy - rh - 14, C.mag, 13, 'center', 700);
}

// ———————————————————— AUX 辅助信息 ————————————————————
function aux(g, w, h) {
  R(g, 0, 0, w, h, { fill: '#05080d' });
  T(g, 'FLIGHT INFO', 12, 20, C.w, 13, 'left', 700);
  L(g, [[10, 34], [w - 10, 34]], C.dim, 1);
  const rows = [['UTC', '03:42z'], ['DATE', '09NOV'], ['FLT NO', 'DRM789'], ['XPDR', '2341'], ['SAT', '−56°C'], ['GW', '213.6'], ['FUEL', '42.8']];
  rows.forEach(([k, v], i) => { const y = 54 + i * 24; T(g, k, 12, y, C.cyan, 12, 'left', 600); T(g, v, w - 12, y, C.w, 15, 'right', 700); });
  L(g, [[10, 228], [w - 10, 228]], C.dim, 1);
  T(g, 'COMM', 12, 246, C.w, 13, 'left', 700);
  T(g, 'ATC', 12, 272, C.cyan, 12); T(g, 'CTR 132.850', w - 12, 272, C.w, 13, 'right');
  T(g, 'CPDLC', 12, 296, C.cyan, 12); T(g, 'LOGGED ON', w - 12, 296, C.grn, 13, 'right');
  T(g, 'NO NEW MSG', w / 2, 340, C.grey, 12, 'center');
}

// ———————————————————— 导航显示器 ND（MAP · 扇形） ————————————————————
function star(g, x, y, r, c) {
  poly(g, [[x, y - r], [x + r * 0.28, y - r * 0.28], [x + r, y], [x + r * 0.28, y + r * 0.28], [x, y + r], [x - r * 0.28, y + r * 0.28], [x - r, y], [x - r * 0.28, y - r * 0.28]], { stroke: c, lw: 1.6 });
}
function nd(g, w, h) {
  R(g, 0, 0, w, h, { fill: C.bg });
  g.save(); clipRect(g, 0, 0, w, h);
  const ax = w / 2, ay = h - 60, r0 = 236, hdg = 285, ppn = r0 / 320; // 全量程 320 NM
  // 罗盘弧
  g.strokeStyle = C.w; g.lineWidth = 1.8;
  g.beginPath(); g.arc(ax, ay, r0, -Math.PI / 2 - 0.8, -Math.PI / 2 + 0.8); g.stroke();
  for (let brg = 240; brg <= 330; brg += 5) {
    const d = brg - hdg, a = -Math.PI / 2 + d * D2R, l = brg % 10 === 0 ? 11 : 6;
    L(g, [[ax + Math.cos(a) * r0, ay + Math.sin(a) * r0], [ax + Math.cos(a) * (r0 - l), ay + Math.sin(a) * (r0 - l)]], C.w, 1.6);
    if (brg % 10 === 0) {
      g.save(); g.translate(ax + Math.cos(a) * (r0 - 22), ay + Math.sin(a) * (r0 - 22)); g.rotate(d * D2R);
      T(g, String(brg / 10), 0, 0, C.w, brg % 30 === 0 ? 16 : 12, 'center'); g.restore();
    }
  }
  // 半量程距离环（虚线）
  g.setLineDash([4, 6]); g.strokeStyle = C.w; g.lineWidth = 1.2;
  g.beginPath(); g.arc(ax, ay, r0 / 2, -Math.PI / 2 - 0.95, -Math.PI / 2 + 0.95); g.stroke(); g.setLineDash([]);
  T(g, '160', ax - Math.sin(0.95) * r0 / 2 - 4, ay - Math.cos(0.95) * r0 / 2 - 8, C.w, 11, 'center');
  // 航路：现用航段品红，后续白色
  const leg = (p, brg, nm) => [p[0] + Math.sin((brg - hdg) * D2R) * nm * ppn, p[1] - Math.cos((brg - hdg) * D2R) * nm * ppn];
  const A = [ax, ay], P1 = leg(A, 289, 126), P2 = leg(P1, 296, 84), P3 = leg(P2, 270, 152);
  L(g, [A, P1], C.mag, 2.6); L(g, [P1, P2, P3], C.w, 1.6);
  star(g, ...P1, 8, C.mag); T(g, 'OMBAX', P1[0] + 11, P1[1] + 1, C.mag, 12, 'left', 700);
  star(g, ...P2, 7, C.w); T(g, 'TIKOS', P2[0] + 10, P2[1] + 1, C.w, 12);
  star(g, ...P3, 7, C.w); T(g, 'RAMAN', P3[0] + 10, P3[1] + 1, C.w, 12);
  // 空中交通（TCAS）：相对高度 +10（高 1000 ft），上升箭头
  poly(g, [[78, 228], [85, 235], [78, 242], [71, 235]], { stroke: C.w, lw: 1.5 });
  T(g, '+10', 78, 219, C.w, 11, 'center'); L(g, [[92, 241], [92, 229]], C.w, 1.4); L(g, [[89, 232], [92, 228], [95, 232]], C.w, 1.4);
  // 本机符号
  poly(g, [[ax, ay - 15], [ax - 9, ay + 9], [ax + 9, ay + 9]], { stroke: C.w, lw: 2 });
  g.restore();
  // 顶部信息：地速/真空速/风、航向、下一航路点
  T(g, 'GS', 6, 14, C.w, 11); T(g, '448', 26, 14, C.w, 17, 'left', 700);
  T(g, 'TAS', 6, 34, C.w, 11); T(g, '488', 32, 34, C.w, 15, 'left', 700);
  T(g, '300°/45', 6, 54, C.w, 13, 'left', 700);
  L(g, [[70, 47], [60, 61]], C.w, 1.6); L(g, [[60, 61], [61, 55]], C.w, 1.6); L(g, [[60, 61], [66, 58]], C.w, 1.6);
  T(g, 'HDG', ax - 38, 16, C.grn, 12, 'right', 700);
  R(g, ax - 25, 5, 50, 23, { fill: '#000', stroke: C.w, lw: 1.5 }); T(g, '285', ax, 17, C.w, 18, 'center', 700);
  T(g, 'MAG', ax + 38, 16, C.grn, 12, 'left', 700);
  poly(g, [[ax, ay - r0 + 1], [ax - 7, ay - r0 - 10], [ax + 7, ay - r0 - 10]], { fill: C.w });
  T(g, 'OMBAX', w - 6, 14, C.mag, 14, 'right', 700);
  T(g, '0358.9z', w - 6, 34, C.w, 13, 'right', 700);
  T(g, '126 NM', w - 6, 54, C.w, 13, 'right', 700);
  T(g, 'TCAS', 8, h - 16, C.cyan, 11); T(g, 'MAP', w - 8, h - 16, C.grn, 11, 'right', 700);
}

// ———————————————————— 发动机指示与机组告警 EICAS ————————————————————
function dial(g, x, y, r, frac, txt, { ref = null, red = 1 } = {}) {
  const a0 = Math.PI, sweep = 210 * D2R, a = a0 + sweep * Math.min(frac, 1.05);
  g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a0, a); g.closePath(); g.fillStyle = '#5a636e'; g.fill();
  g.strokeStyle = C.w; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, a0, a0 + sweep * red); g.stroke();
  const ar = a0 + sweep * red;
  L(g, [[x + Math.cos(ar) * (r - 4), y + Math.sin(ar) * (r - 4)], [x + Math.cos(ar) * (r + 6), y + Math.sin(ar) * (r + 6)]], C.red, 3);
  for (let k = 0; k <= 10; k += 2) { const ak = a0 + sweep * (k / 10) * red; L(g, [[x + Math.cos(ak) * r, y + Math.sin(ak) * r], [x + Math.cos(ak) * (r - 6), y + Math.sin(ak) * (r - 6)]], C.w, 1.4); }
  if (ref != null) { const ak = a0 + sweep * ref; L(g, [[x + Math.cos(ak) * (r + 2), y + Math.sin(ak) * (r + 2)], [x + Math.cos(ak) * (r + 9), y + Math.sin(ak) * (r + 9)]], C.grn, 3); }
  L(g, [[x, y], [x + Math.cos(a) * r, y + Math.sin(a) * r]], C.w, 2.4);
  R(g, x + 2, y - r - 2, r + 10, 22, { fill: '#000', stroke: C.w, lw: 1.4 });
  T(g, txt, x + r + 8, y - r + 9, C.w, 16, 'right', 700);
}
function eicas(g, w, h) {
  R(g, 0, 0, w, h, { fill: C.bg });
  T(g, 'TAT −28c', 8, 14, C.w, 12, 'left', 600);
  T(g, 'CRZ', 128, 14, C.grn, 14, 'center', 700); T(g, '88.6', 176, 14, C.grn, 14, 'center', 700);
  dial(g, 64, 96, 38, 86.9 / 110, '86.9', { ref: 88.6 / 110 });
  dial(g, 188, 96, 38, 86.7 / 110, '86.7', { ref: 88.6 / 110 });
  T(g, 'N1', 128, 96, C.cyan, 14, 'center', 700);
  dial(g, 64, 196, 30, 612 / 1060, '612');
  dial(g, 188, 196, 30, 606 / 1060, '606');
  T(g, 'EGT', 128, 196, C.cyan, 14, 'center', 700);
  const rows = [['N2', '96.4', '96.2'], ['FF', '2.86', '2.84'], ['OIL P', '62', '61'], ['OIL T', '104', '103'], ['VIB', '0.4', '0.3']];
  rows.forEach(([k, a, b], i) => { const y = 248 + i * 19; T(g, a, 82, y, C.w, 15, 'right', 700); T(g, k, 128, y, C.cyan, 12, 'center', 700); T(g, b, 206, y, C.w, 15, 'right', 700); });
  L(g, [[8, 346], [w - 8, 346]], C.dim, 1);
  T(g, 'TOTAL FUEL', 10, 362, C.cyan, 12, 'left', 700); T(g, '42.8', 150, 362, C.w, 17, 'right', 700); T(g, 'KGS X 1000', 156, 363, C.cyan, 10, 'left', 600);
}

// ———————————————————— 多功能显示：电源系统简图 ————————————————————
function elec(g, w, h) {
  R(g, 0, 0, w, h, { fill: C.bg });
  T(g, 'ELEC', w / 2, 16, C.w, 15, 'center', 700);
  const gx = [24, 66, 110, 146, 190, 232];
  T(g, 'ENG L', 45, 40, C.cyan, 10, 'center', 700); T(g, 'APU', 128, 40, C.cyan, 10, 'center', 700); T(g, 'ENG R', 211, 40, C.cyan, 10, 'center', 700);
  ['L1', 'L2', 'APU L', 'APU R', 'R1', 'R2'].forEach((n, i) => {
    const on = i !== 2 && i !== 3;
    R(g, gx[i] - 18, 50, 36, 24, { fill: '#000', stroke: on ? C.grn : C.w, lw: 1.6 });
    T(g, n.replace('APU ', ''), gx[i], 62, on ? C.grn : C.w, 11, 'center', 700);
    if (on) L(g, [[gx[i], 74], [gx[i], 116]], C.grn, 2);
  });
  T(g, 'VFSG 250 kVA', 45, 86, C.grey, 9, 'center'); T(g, 'VFSG 250 kVA', 211, 86, C.grey, 9, 'center'); T(g, 'OFF', 128, 86, C.w, 10, 'center');
  // 235 VAC 交流汇流条
  for (const [x0, x1, n] of [[8, 40, 'L1'], [50, 84, 'L2'], [172, 206, 'R1'], [216, 248, 'R2']]) {
    L(g, [[x0, 118], [x1, 118]], C.grn, 4); T(g, n, (x0 + x1) / 2, 130, C.w, 10, 'center', 700);
  }
  T(g, '235 VAC', 128, 120, C.cyan, 11, 'center', 700);
  // ATRU → ±270 VDC
  for (const x of [24, 66, 190, 232]) {
    L(g, [[x, 138], [x, 158]], C.grn, 2);
    R(g, x - 17, 158, 34, 20, { fill: '#000', stroke: C.w, lw: 1.3 }); T(g, 'ATRU', x, 168, C.w, 9, 'center', 700);
    L(g, [[x, 178], [x, 198]], C.grn, 2);
    L(g, [[x - 16, 200], [x + 16, 200]], C.grn, 4);
  }
  T(g, '±270 VDC', 128, 200, C.cyan, 11, 'center', 700);
  // TRU → 28 VDC
  for (const x of [45, 211]) {
    L(g, [[x, 236], [x, 252]], C.grn, 2);
    R(g, x - 17, 252, 34, 20, { fill: '#000', stroke: C.w, lw: 1.3 }); T(g, 'TRU', x, 262, C.w, 9, 'center', 700);
    L(g, [[x, 272], [x, 290]], C.grn, 2);
  }
  L(g, [[18, 292], [100, 292]], C.grn, 4); L(g, [[156, 292], [238, 292]], C.grn, 4);
  T(g, 'L 28V DC', 59, 304, C.w, 10, 'center', 700); T(g, 'R 28V DC', 197, 304, C.w, 10, 'center', 700);
  T(g, '28 VDC', 128, 293, C.cyan, 11, 'center', 700);
  R(g, 22, 326, 74, 24, { fill: '#000', stroke: C.w, lw: 1.3 }); T(g, 'MAIN BAT', 59, 338, C.w, 10, 'center', 700);
  R(g, 160, 326, 74, 24, { fill: '#000', stroke: C.w, lw: 1.3 }); T(g, 'APU BAT', 197, 338, C.w, 10, 'center', 700);
  L(g, [[59, 310], [59, 326]], C.grn, 2); L(g, [[197, 310], [197, 326]], C.grn, 2);
  T(g, 'LI-ION 32V', 128, 362, C.grey, 9, 'center');
}

// ———————————————————— 下中央屏：左右两个 CDU 窗口（开机默认：左归机长、右归副驾驶） ————————————————————
function cdu(g, w, h, page) {
  R(g, 0, 0, w, h, { fill: C.bg });
  const big = (t, x, y, c = C.w, al = 'left') => T(g, t, x, y, c, 15, al, 600, MONO);
  const small = (t, x, y, c = C.w, al = 'left') => T(g, t, x, y, c, 11, al, 500, MONO);
  const x0 = 9, x1 = w - 9, lh = 22;
  const lsk = (i) => 44 + i * lh * 2; // 第 i 行选键：小字标签在 lsk(i)，大字数据在 lsk(i) + lh
  if (page === 'legs') {
    big('ACT RTE 1 LEGS', w / 2 - 8, 18, C.w, 'center'); small('1/3', x1, 18, C.w, 'right');
    const legs = [['289°', '126NM', 'OMBAX', C.mag], ['296°', '84NM', 'TIKOS'], ['270°', '152NM', 'RAMAN'], ['265°', '96NM', 'ELVUS'], ['262°', '118NM', 'POKAN']];
    legs.forEach(([crs, dist, wpt, c = C.w], i) => {
      small(` ${crs}`, x0, lsk(i)); small(dist, w * 0.52, lsk(i), C.w, 'right');
      big(wpt, x0, lsk(i) + lh, c); big('.850/FL370', x1, lsk(i) + lh, c === C.mag ? C.mag : C.w, 'right');
    });
    small('- - - - - - - - - - - - -', x0, lsk(5) - 2, C.dim);
    big('<RTE 2 LEGS', x0, lsk(5) + lh); big('RTE DATA>', x1, lsk(5) + lh, C.w, 'right');
  } else {
    // 进度页：时间、油量与 AUX（03:42z、42.8 t）、EICAS 燃油流量（2 × 2.85 t/h）、ND 地速 448 kt 相互一致
    big('DRM789 PROGRESS', w / 2 - 10, 18, C.w, 'center'); small('1/4', x1, 18, C.w, 'right');
    const cols = [w * 0.57, w * 0.79, x1];
    const rowS = (y, k, a, b, c) => { small(k, x0, y); [a, b, c].forEach((t, j) => small(t, cols[j], y, C.w, 'right')); };
    const rowB = (y, k, a, b, c, kc = C.w) => { big(k, x0, y, kc); [a, b, c].forEach((t, j) => big(t, cols[j], y, C.w, 'right')); };
    rowS(lsk(0), ' FROM', 'ALT', 'ATA', 'FUEL');
    rowB(lsk(0) + lh, 'ESPAN', 'FL370', '0326z', '44.3');
    rowS(lsk(1), '', 'DTG', 'ETA', 'FUEL');
    rowB(lsk(1) + lh, 'OMBAX', '126', '0359z', '41.2', C.mag);
    rowB(lsk(2) + lh, 'TIKOS', '210', '0410z', '40.1');
    small(' TO T/D', x0, lsk(3)); big('1268NM', x0, lsk(3) + lh); big('0632z', cols[1], lsk(3) + lh, C.w, 'right');
    small(' SPD', x0, lsk(4)); small('TOTAL FUEL', x1, lsk(4), C.w, 'right');
    big('.850', x0, lsk(4) + lh, C.grn); big('42.8', x1, lsk(4) + lh, C.w, 'right');
    small('- - - - - - - - - - - - -', x0, lsk(5) - 2, C.dim);
    big('<POS REPORT', x0, lsk(5) + lh);
  }
  R(g, 8, h - 26, w - 16, 18, { stroke: C.dim, lw: 1 }); // 草稿行
}

// ———————————————————— 平视显示器符号（绿色，黑底叠加） ————————————————————
function hud(g, w, h) {
  R(g, 0, 0, w, h, { fill: '#000' });
  const c = '#58ff86', cx = w / 2, cy = h / 2 - 6, ppd = 8.5, hy = cy + 2.5 * ppd;
  g.lineCap = 'round';
  // 地平线 + 航向刻度
  L(g, [[24, hy], [cx - 46, hy]], c, 2.2); L(g, [[cx + 46, hy], [w - 24, hy]], c, 2.2);
  for (let d = -20; d <= 20; d += 5) {
    const x = cx + d * 7.2, brg = 285 + d;
    if (Math.abs(x - cx) < 46) continue;
    L(g, [[x, hy], [x, hy - (brg % 10 === 0 ? 9 : 5)]], c, 1.8);
    if (brg % 10 === 0) T(g, String(brg / 10), x, hy - 18, c, 13, 'center', 600);
  }
  // 俯仰梯
  for (const p of [-5, 5, 10]) {
    const y = hy - p * ppd;
    g.setLineDash(p < 0 ? [8, 6] : []);
    L(g, [[cx - 92, y], [cx - 40, y]], c, 2); L(g, [[cx + 40, y], [cx + 92, y]], c, 2);
    g.setLineDash([]);
    L(g, [[cx - 92, y], [cx - 92, y + (p > 0 ? 7 : -7)]], c, 2); L(g, [[cx + 92, y], [cx + 92, y + (p > 0 ? 7 : -7)]], c, 2);
    T(g, String(Math.abs(p)), cx - 106, y, c, 13, 'center', 600); T(g, String(Math.abs(p)), cx + 106, y, c, 13, 'center', 600);
  }
  // 飞行航迹矢量（平飞：落在地平线上）与机体基准符号
  circle(g, cx, hy, 8, { stroke: c, lw: 2.2 });
  L(g, [[cx - 8, hy], [cx - 26, hy]], c, 2.2); L(g, [[cx + 8, hy], [cx + 26, hy]], c, 2.2); L(g, [[cx, hy - 8], [cx, hy - 16]], c, 2.2);
  L(g, [[cx - 22, cy], [cx - 10, cy], [cx - 5, cy + 7], [cx, cy], [cx + 5, cy + 7], [cx + 10, cy], [cx + 22, cy]], c, 2);
  // 空速 / 高度
  R(g, 46, cy - 14, 64, 28, { stroke: c, lw: 2 }); T(g, '271', 78, cy + 1, c, 20, 'center', 700);
  for (let k = -3; k <= 3; k++) if (k) L(g, [[112, cy + k * 26], [122, cy + k * 26]], c, 1.6);
  R(g, w - 122, cy - 14, 80, 28, { stroke: c, lw: 2 }); T(g, '37000', w - 82, cy + 1, c, 19, 'center', 700);
  for (let k = -3; k <= 3; k++) if (k) L(g, [[w - 134, cy + k * 26], [w - 124, cy + k * 26]], c, 1.6);
  T(g, '.850', 78, cy + 36, c, 15, 'center', 600); T(g, 'STD', w - 82, cy + 36, c, 15, 'center', 600);
  // FMA 与坡度刻度
  T(g, 'SPD', cx - 110, 24, c, 15, 'center', 600); T(g, 'LNAV', cx, 24, c, 15, 'center', 600); T(g, 'VNAV PTH', cx + 118, 24, c, 15, 'center', 600);
  T(g, 'A/P', cx, 46, c, 14, 'center', 700);
  g.strokeStyle = c; g.lineWidth = 1.8; g.beginPath(); g.arc(cx, h - 120, 80, Math.PI / 2 - 0.55, Math.PI / 2 + 0.55); g.stroke();
  for (const b of [-30, -20, -10, 0, 10, 20, 30]) { const a = Math.PI / 2 + b * D2R; L(g, [[cx + Math.cos(a) * 80, h - 120 + Math.sin(a) * 80], [cx + Math.cos(a) * (b ? 88 : 92), h - 120 + Math.sin(a) * (b ? 88 : 92)]], c, 1.8); }
  poly(g, [[cx, h - 42], [cx - 7, h - 31], [cx + 7, h - 31]], { stroke: c, lw: 1.8 });
}

// ———————————————————— 电子飞行包：航路图（日间模式） ————————————————————
function efb(g, w, h) {
  R(g, 0, 0, w, h, { fill: '#1b222b' });
  ['DOCS', 'CHARTS', 'PERF', 'NOTAM', 'VIDEO'].forEach((t, i) => {
    const x = 8 + i * 84;
    if (t === 'CHARTS') R(g, x, 4, 78, 24, { fill: '#2f6fbf', r: 4 });
    T(g, t, x + 39, 16.5, '#e6edf5', 12, 'center', 700);
  });
  at(g, 0, 32, () => {
    const H = h - 32;
    R(g, 0, 0, w, H, { fill: '#eef0e7' });
    g.strokeStyle = '#c3d3e6'; g.lineWidth = 1;
    for (let x = 32; x < w; x += 96) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 40; y < H; y += 96) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    // 航路图正北朝上、比例 96 px = 50 NM；现用航路与 ND/CDU 一致：本机 → OMBAX（289°，126 NM）→ TIKOS（296°，84 NM）→ RAMAN（270°）
    const ppn = 96 / 50;
    const go = (p, brg, nm) => [p[0] + Math.sin(brg * D2R) * nm * ppn, p[1] - Math.cos(brg * D2R) * nm * ppn];
    const AC = [452, 300], OMB = go(AC, 289, 126), TIK = go(OMB, 296, 84), RAM = go(TIK, 270, 152), ESP = go(AC, 109, 120);
    const DKX = [330, 96], NIP = [176, 34], EVL = [118, 318], SOK = [478, 168];
    const ways = [[ESP, OMB, 'A593', 0.65], [OMB, TIK, 'A593'], [TIK, RAM, 'A593', 0.16], [DKX, OMB, 'W45'], [OMB, EVL, 'W45'], [NIP, DKX, 'B208'], [DKX, SOK, 'R343'], [NIP, TIK, 'G471']];
    for (const [a, b] of ways) L(g, [a, b], '#6f87a3', 2);
    L(g, [ESP, OMB, TIK, RAM], '#d23ad2', 3.2);
    for (const [a, b, id, f = 0.5] of ways) {
      const m = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      R(g, m[0] - 17, m[1] - 8, 34, 15, { fill: '#eef0e7', stroke: '#6f87a3', lw: 1 }); T(g, id, m[0], m[1], '#3d5675', 10, 'center', 700);
    }
    for (const [p, n] of [[OMB, 'OMBAX'], [TIK, 'TIKOS'], [NIP, 'NIPAL'], [EVL, 'EVLUK'], [SOK, 'SOKMA']]) {
      poly(g, [[p[0], p[1] - 7], [p[0] - 6, p[1] + 4], [p[0] + 6, p[1] + 4]], { fill: '#eef0e7', stroke: '#24324a', lw: 1.5 });
      T(g, n, p[0] + 9, p[1] - 9, '#24324a', 10, 'left', 700);
    }
    const [vx, vy] = DKX;
    circle(g, vx, vy, 30, { stroke: '#3a7bd5', lw: 1.2 });
    for (let a = 0; a < 360; a += 30) L(g, [[vx + Math.sin(a * D2R) * 30, vy - Math.cos(a * D2R) * 30], [vx + Math.sin(a * D2R) * 24, vy - Math.cos(a * D2R) * 24]], '#3a7bd5', 1.2);
    poly(g, [0, 1, 2, 3, 4, 5].map((k) => [vx + Math.cos(k * Math.PI / 3) * 7, vy + Math.sin(k * Math.PI / 3) * 7]), { stroke: '#3a7bd5', lw: 1.6 });
    R(g, vx + 30, vy - 48, 74, 30, { fill: '#ffffff', stroke: '#3a7bd5', lw: 1.2 }); T(g, 'DKX', vx + 67, vy - 39, '#24324a', 11, 'center', 700); T(g, '115.30', vx + 67, vy - 26, '#24324a', 10, 'center', 600);
    // 本机：在 ESPAN—OMBAX 航段上，航向 285°
    at(g, AC[0], AC[1], () => { g.rotate(-75 * D2R); poly(g, [[0, -11], [3, -3], [11, 2], [11, 4], [3, 2], [2, 8], [5, 11], [-5, 11], [-2, 8], [-3, 2], [-11, 4], [-11, 2], [-3, -3]].map(([x, y]) => [x * 1.2, y * 1.2]), { fill: '#d23ad2' }); });
    L(g, [[16, H - 16], [112, H - 16]], '#24324a', 2); T(g, '50 NM', 64, H - 26, '#24324a', 10, 'center', 700);
    T(g, 'NOT FOR NAVIGATION', w - 10, H - 14, '#8a8f99', 10, 'right', 700);
  });
}

// ———————————————————— 遮光罩立面：EFIS 控制板、显示选择板与方式控制板（MCP） ————————————————————
function knob(g, x, y, r) {
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  gr.addColorStop(0, '#5a616a'); gr.addColorStop(1, '#14171b');
  circle(g, x, y, r + 4, { fill: '#23272d', stroke: '#6f7782', lw: 1 });
  circle(g, x, y, r, { fill: gr });
}
function btn(g, x, y, w, h, label, { lit = false, c = '#d9dee4' } = {}) {
  R(g, x, y, w, h, { fill: '#1a1d22', stroke: '#626a75', lw: 1, r: 2 });
  if (lit) L(g, [[x + 5, y + h - 4], [x + w - 5, y + h - 4]], C.grn, 2);
  T(g, label, x + w / 2, y + h / 2 - (lit ? 1 : 0), c, label.length > 5 ? 8 : 9, 'center', 700);
}
function window7(g, x, y, w, h, s) {
  R(g, x, y, w, h, { fill: '#050607', stroke: '#7c848e', lw: 1.2 });
  T(g, s, x + w - 6, y + h / 2 + 1, '#f4f1e8', h - 6, 'right', 700, MONO);
}
function efisDsp(g, flip) {
  // EFIS 控制板：最低标准（MINS）与气压（BARO）旋钮，中间是地图选项按钮
  const X = (x) => (flip ? 2048 - x : x);
  R(g, Math.min(X(28), X(552)), 8, 524, 112, { fill: '#30353c', stroke: '#1b1e22', lw: 2, r: 4 });
  L(g, [[X(330), 12], [X(330), 116]], '#1b1e22', 2);
  const k1 = MCP_KNOBS[flip ? 6 : 0], k2 = MCP_KNOBS[flip ? 5 : 1];
  knob(g, k1[0], k1[1], k1[2]); knob(g, k2[0], k2[1], k2[2]);
  T(g, 'MINS', k1[0], 22, C.w, 10, 'center', 700); T(g, 'BARO', k2[0], 22, C.w, 10, 'center', 700);
  T(g, 'RADIO', k1[0] - 26, 104, C.w, 8, 'center', 700); T(g, 'RST', k1[0] + 22, 104, C.w, 8, 'center', 700);
  T(g, 'IN', k2[0] - 24, 104, C.w, 8, 'center', 700); T(g, 'STD', k2[0] + 24, 104, C.w, 8, 'center', 700);
  const keys = [['WXR', 'STA', 'WPT'], ['ARPT', 'DATA', 'POS'], ['TERR', 'TFC', 'CTR']];
  const mx = (k1[0] + k2[0]) / 2;
  keys.forEach((row, j) => row.forEach((k, i) => btn(g, mx - 46 + i * 31, 30 + j * 28, 28, 22, k)));
  // 显示选择板（DSP）：选择显示器 + 格式键（787 独有的窗口化显示）
  const dx = flip ? 1500 : 348;
  ['L INBD', 'LWR CTR', 'R INBD'].forEach((k, i) => btn(g, dx + 14 + i * 64, 26, 58, 24, k));
  ['SYS', 'CDU', 'INFO', 'CHKL', 'COMM', 'ND'].forEach((k, i) => btn(g, dx + 6 + i * 33, 66, 30, 24, k, { lit: k === 'CDU' }));
  T(g, 'DISPLAY SELECT', dx + 105, 106, C.grey, 8, 'center', 700);
}
function mcpStrip(g, w, h) {
  R(g, 0, 0, w, h, { fill: '#1d2126' });
  efisDsp(g, false); efisDsp(g, true);
  const x0 = 588, x1 = 1460;
  R(g, x0, 6, x1 - x0, 116, { fill: '#343a42', stroke: '#16191d', lw: 2, r: 4 });
  // 左端：自动驾驶接通、飞行指引、自动油门预位
  btn(g, 600, 18, 40, 30, 'A/P'); T(g, 'F/D', 620, 64, C.w, 9, 'center', 700);
  circle(g, 620, 82, 7, { fill: '#c9ced5' }); L(g, [[620, 82], [620, 70]], '#c9ced5', 3);
  T(g, 'A/T ARM', 676, 18, C.w, 9, 'center', 700);
  for (const x of [662, 690]) { circle(g, x, 40, 6, { fill: '#c9ced5' }); L(g, [[x, 40], [x, 29]], '#c9ced5', 3); }
  T(g, 'L', 662, 56, C.w, 8, 'center', 700); T(g, 'R', 690, 56, C.w, 8, 'center', 700);
  btn(g, 648, 76, 58, 26, 'CLB/CON'); btn(g, 716, 76, 40, 26, 'A/T', { lit: true });
  // 速度
  T(g, 'IAS/MACH', 806, 16, C.w, 9, 'center', 700); window7(g, 770, 24, 76, 30, '.850');
  knob(g, ...MCP_KNOBS[2]); btn(g, 824, 104, 30, 14, 'SEL');
  btn(g, 866, 22, 50, 26, 'LNAV', { lit: true }); btn(g, 922, 22, 50, 26, 'VNAV', { lit: true });
  btn(g, 866, 60, 50, 26, 'FLCH'); btn(g, 922, 60, 50, 26, 'TO/GA');
  // 航向
  T(g, 'HDG/TRK', 1046, 16, C.w, 9, 'center', 700); window7(g, 1008, 24, 76, 30, '285');
  knob(g, ...MCP_KNOBS[3]); btn(g, 978, 98, 40, 18, 'SEL'); btn(g, 1074, 98, 44, 18, 'HOLD');
  T(g, 'BANK', 1096, 70, C.grey, 8, 'center', 700);
  // 升降速度（指轮）
  T(g, 'V/S FPA', 1166, 16, C.w, 9, 'center', 700); window7(g, 1128, 24, 76, 30, '');
  R(g, 1152, 64, 26, 46, { fill: '#121417', stroke: '#6b737d', lw: 1 });
  for (let y = 68; y < 108; y += 5) L(g, [[1154, y], [1176, y]], '#4d545d', 1.5);
  btn(g, 1186, 74, 30, 24, 'V/S');
  // 高度
  T(g, 'ALTITUDE', 1288, 16, C.w, 9, 'center', 700); window7(g, 1238, 24, 100, 30, '37000');
  knob(g, ...MCP_KNOBS[4]); btn(g, 1320, 98, 44, 18, 'HOLD'); T(g, 'AUTO  1000', 1288, 114, C.grey, 8, 'center', 700);
  // 进近与右端自动驾驶
  btn(g, 1372, 22, 36, 26, 'LOC'); btn(g, 1372, 60, 36, 26, 'APP');
  btn(g, 1416, 18, 36, 30, 'A/P'); T(g, 'F/D', 1434, 64, C.w, 9, 'center', 700);
  circle(g, 1434, 82, 7, { fill: '#c9ced5' }); L(g, [[1434, 82], [1434, 70]], '#c9ced5', 3);
  R(g, 1370, 98, 86, 16, { fill: '#bfc4ca', r: 2 }); T(g, 'A/P DISENGAGE', 1413, 106, '#1a1d22', 8, 'center', 800);
}

// ———————————————————— 顶板（图像上方 = 机尾方向，便于抬头阅读） ————————————————————
function overhead(g, w, h) {
  R(g, 0, 0, w, h, { fill: '#3a4048' });
  const pb = (x, y, top = '', bot = 'ON', amberTop = false) => {
    R(g, x, y, 30, 26, { fill: '#16191d', stroke: '#7c858f', lw: 1, r: 2 });
    if (top) T(g, top, x + 15, y + 8, amberTop ? C.amb : '#606872', 7, 'center', 800);
    T(g, bot, x + 15, y + 18, '#6b737d', 7, 'center', 800);
  };
  const rot = (x, y, lbl) => { knob(g, x, y, 9); L(g, [[x, y], [x, y - 8]], '#e6e9ec', 2); if (lbl) T(g, lbl, x, y + 20, C.w, 7, 'center', 700); };
  const guard = (x, y, lbl) => { R(g, x, y, 34, 30, { fill: '#7a1d1d', stroke: '#e04848', lw: 1.2, r: 3 }); for (let k = 0; k < 4; k++) L(g, [[x + 4 + k * 8, y + 2], [x + k * 8 - 4, y + 28]], '#d9b14a', 2); T(g, lbl, x + 17, y + 40, C.w, 7, 'center', 700); };
  const mod = (x, y, mw, mh, title, fn) => {
    R(g, x, y, mw, mh, { stroke: '#c3cad2', lw: 1, r: 4 });
    R(g, x + mw / 2 - title.length * 3.6 - 6, y - 7, title.length * 7.2 + 12, 14, { fill: '#3a4048' });
    T(g, title, x + mw / 2, y, C.w, 10, 'center', 700);
    at(g, x, y, fn);
  };
  const col = [14, 210, 406], mw = 180;
  // 第一列（左舷）
  mod(col[0], 18, mw, 70, 'FLIGHT CONTROL', () => { pb(14, 18, 'FAIL', 'PRI'); pb(52, 18, '', 'ALTN'); pb(90, 18, '', 'DISC'); rot(150, 32, 'STAB'); });
  mod(col[0], 104, mw, 150, 'ELECTRICAL', () => {
    [['L1', 12], ['L2', 48], ['R1', 108], ['R2', 144]].forEach(([n, x]) => { pb(x - 3, 18, 'OFF', 'GEN'); T(g, n, x + 12, 54, C.w, 8, 'center', 700); });
    pb(75, 18, 'OFF', 'APU'); T(g, 'APU GEN', 90, 54, C.w, 7, 'center', 700);
    pb(30, 70, '', 'FWD'); pb(66, 70, '', 'AFT'); T(g, 'EXT PWR', 63, 106, C.w, 8, 'center', 700);
    pb(120, 70, 'OFF', 'BAT'); T(g, 'BATTERY', 135, 106, C.w, 8, 'center', 700);
    rot(30, 128, ''); T(g, 'STBY PWR', 64, 130, C.w, 7, 'left', 700);
  });
  mod(col[0], 270, mw, 150, 'HYDRAULIC', () => {
    [['L ENG', 12], ['C1 ELEC', 50], ['C2 ELEC', 88], ['R ENG', 126]].forEach(([n, x]) => { pb(x, 18, 'FAULT', 'ON', true); T(g, n, x + 15, 54, C.w, 7, 'center', 700); });
    [['L ELEC', 30], ['R ELEC', 110]].forEach(([n, x]) => { rot(x + 15, 82, n); });
    guard(66, 70, 'RAM AIR TURBINE');
  });
  mod(col[0], 436, mw, 104, 'ENGINE START', () => { rot(44, 40, 'L START'); rot(136, 40, 'R START'); pb(75, 62, '', 'AUTO'); T(g, 'IGN', 90, 96, C.w, 7, 'center', 700); });
  mod(col[0], 556, mw, 112, 'EQUIP COOLING', () => { pb(20, 20, '', 'AUTO'); pb(60, 20, '', 'OVRD'); rot(130, 34, 'EE BAY'); pb(20, 64, '', 'FWD'); pb(60, 64, '', 'AFT'); T(g, 'CARGO HEAT', 130, 82, C.w, 7, 'center', 700); });
  mod(col[0], 684, mw, 90, 'EMER LIGHTS', () => { guard(20, 18, 'ARM'); pb(80, 22, '', 'ON'); T(g, 'PASS SIGNS', 140, 30, C.w, 7, 'center', 700); rot(140, 56, ''); });
  // 第二列（中央）
  mod(col[1], 18, mw, 90, 'WINDOW HEAT', () => { [12, 50, 88, 126].forEach((x, i) => { pb(x + 4, 22, 'INOP', 'ON', true); T(g, ['L SIDE', 'L FWD', 'R FWD', 'R SIDE'][i], x + 19, 60, C.w, 7, 'center', 700); }); });
  mod(col[1], 124, mw, 74, 'WIPERS', () => { rot(50, 32, 'L'); rot(130, 32, 'R'); T(g, 'OFF INT LO HI', 90, 58, C.grey, 7, 'center', 700); });
  mod(col[1], 214, mw, 230, 'FUEL', () => {
    [['FWD', 12], ['AFT', 48]].forEach(([n, x]) => { pb(x, 20, 'PRESS', 'ON', true); T(g, `L ${n}`, x + 15, 56, C.w, 7, 'center', 700); });
    [['FWD', 104], ['AFT', 140]].forEach(([n, x]) => { pb(x, 20, 'PRESS', 'ON', true); T(g, `R ${n}`, x + 15, 56, C.w, 7, 'center', 700); });
    pb(54, 76, 'PRESS', 'L', true); pb(98, 76, 'PRESS', 'R', true); T(g, 'CENTER', 90, 112, C.w, 7, 'center', 700);
    pb(76, 128, 'VALVE', 'X FEED', true);
    guard(20, 172, 'JETTISON ARM'); rot(140, 186, 'NOZZLE');
  });
  mod(col[1], 460, mw, 150, 'ANTI-ICE', () => {
    pb(20, 22, '', 'AUTO'); T(g, 'WING', 35, 58, C.w, 7, 'center', 700);
    pb(75, 22, '', 'AUTO'); T(g, 'ENG L', 90, 58, C.w, 7, 'center', 700);
    pb(130, 22, '', 'AUTO'); T(g, 'ENG R', 145, 58, C.w, 7, 'center', 700);
    rot(50, 120, ''); rot(130, 120, ''); T(g, 'PROBE HEAT', 90, 122, C.w, 7, 'center', 700);
  });
  mod(col[1], 626, mw, 148, 'LIGHTS', () => {
    [['L', 14], ['N', 46], ['R', 78]].forEach(([n, x]) => { circle(g, x + 12, 30, 6, { fill: '#c9ced5' }); L(g, [[x + 12, 30], [x + 12, 18]], '#c9ced5', 3); T(g, n, x + 12, 46, C.w, 7, 'center', 700); });
    T(g, 'LANDING', 58, 58, C.w, 7, 'center', 700);
    [['TAXI', 120], ['TURNOFF', 156]].forEach(([n, x]) => { circle(g, x, 30, 6, { fill: '#c9ced5' }); L(g, [[x, 30], [x, 18]], '#c9ced5', 3); T(g, n, x, 46, C.w, 7, 'center', 700); });
    [['BEACON', 20], ['NAV', 56], ['LOGO', 92], ['WING', 128], ['STROBE', 164]].forEach(([n, x]) => { circle(g, x, 92, 6, { fill: '#c9ced5' }); L(g, [[x, 92], [x, 80]], '#c9ced5', 3); T(g, n, x, 108, C.w, 7, 'center', 700); });
    rot(56, 130, ''); rot(124, 130, ''); T(g, 'PANEL', 90, 132, C.w, 7, 'center', 700);
  });
  // 第三列（右舷）
  mod(col[2], 18, mw, 104, 'CARGO FIRE', () => { pb(24, 22, '', 'FWD'); pb(64, 22, '', 'AFT'); T(g, 'ARM', 59, 58, C.w, 7, 'center', 700); guard(122, 18, 'DISCH'); T(g, 'APU FIRE', 59, 84, C.amb, 8, 'center', 700); });
  mod(col[2], 138, mw, 196, 'AIR CONDITIONING', () => {
    pb(24, 20, 'FAULT', 'AUTO', true); T(g, 'PACK L', 39, 56, C.w, 7, 'center', 700);
    pb(126, 20, 'FAULT', 'AUTO', true); T(g, 'PACK R', 141, 56, C.w, 7, 'center', 700);
    pb(75, 20, '', 'ON'); T(g, 'TRIM AIR', 90, 56, C.w, 7, 'center', 700);
    rot(36, 96, 'FLT DECK'); rot(90, 96, 'CABIN'); rot(144, 96, 'CARGO');
    pb(24, 132, '', 'ON'); pb(64, 132, '', 'ON'); T(g, 'RECIRC FANS', 59, 168, C.w, 7, 'center', 700);
    pb(126, 132, '', 'ON'); T(g, 'CAC', 141, 168, C.w, 7, 'center', 700);
  });
  mod(col[2], 350, mw, 150, 'PRESSURIZATION', () => {
    pb(24, 22, '', 'AUTO'); T(g, 'OUTFLOW FWD', 39, 58, C.w, 7, 'center', 700);
    pb(126, 22, '', 'AUTO'); T(g, 'OUTFLOW AFT', 141, 58, C.w, 7, 'center', 700);
    rot(90, 40, ''); T(g, 'LDG ALT', 90, 62, C.w, 7, 'center', 700);
    rot(50, 124, ''); rot(130, 124, '');
  });
  mod(col[2], 516, mw, 110, 'OXYGEN', () => { pb(24, 22, '', 'NORM'); T(g, 'PASS OXY', 39, 58, C.w, 7, 'center', 700); guard(118, 18, 'DEPLOY'); rot(90, 84, 'CREW'); });
  mod(col[2], 642, mw, 132, 'ADIRU / SAARU', () => { pb(28, 24, 'ON BAT', 'ON', true); pb(120, 24, '', 'ON'); rot(50, 92, 'NAV'); rot(130, 92, 'DISPLAY'); });
}

// ———————————————————— 中央操纵台台面（图像上方 = 机头方向） ————————————————————
function pedestal(g, w, h) {
  R(g, 0, 0, w, h, { fill: '#2c3138' });
  // 油门台：两根油门杆槽 + 减速板手柄槽（左）+ 襟翼手柄槽（右）
  R(g, 8, 8, w - 16, 236, { fill: '#33383f', stroke: '#1a1d21', lw: 2, r: 6 });
  for (const x of [172, 244]) { R(g, x - 9, 22, 18, 196, { fill: '#0c0e10', r: 8 }); } // 两槽关于台面中线对称（模型按此放置油门杆）
  T(g, 'FWD', 208, 30, C.w, 9, 'center', 700); T(g, 'IDLE', 208, 210, C.w, 9, 'center', 700);
  T(g, 'ENG 1', 172, 232, C.w, 8, 'center', 700); T(g, 'ENG 2', 244, 232, C.w, 8, 'center', 700);
  R(g, 46, 22, 14, 196, { fill: '#0c0e10', r: 6 });
  ['UP', 'FLT', 'ARMED', 'DOWN'].forEach((t, i) => T(g, t, 72, 214 - i * 56, C.w, 8, 'left', 700));
  T(g, 'SPEEDBRAKE', 53, 232, C.w, 8, 'center', 700);
  R(g, w - 60, 22, 14, 196, { fill: '#0c0e10', r: 6 });
  // 波音襟翼手柄向后拉为放出：UP 在最前；10 个卡位含起飞用的 10、17、18；20 处有复飞止动卡槽
  ['UP', '1', '5', '10', '15', '17', '18', '20', '25', '30'].forEach((t, i) => { const y = 30 + i * 20; L(g, [[w - 70, y], [w - 62, y]], C.w, 1.5); T(g, t, w - 74, y, C.w, 8, 'right', 700); });
  R(g, w - 61, 168, 3, 5, { fill: '#c9ced5' }); R(g, w - 49, 168, 3, 5, { fill: '#c9ced5' }); // 20 档止动卡槽
  T(g, 'FLAPS', w - 53, 232, C.w, 8, 'center', 700);
  // 燃油控制电门
  R(g, 108, 252, 200, 46, { fill: '#33383f', stroke: '#1a1d21', lw: 2, r: 4 });
  T(g, 'FUEL CONTROL', 208, 262, C.w, 8, 'center', 700);
  for (const x of [168, 248]) { R(g, x - 12, 270, 24, 22, { fill: '#7a1d1d', r: 3 }); T(g, 'RUN', x, 281, C.w, 7, 'center', 800); }
  T(g, 'STAB', 60, 268, C.w, 8, 'center', 700); T(g, 'CUTOUT', 60, 280, C.w, 7, 'center', 700);
  T(g, 'PARK BRAKE', w - 60, 274, C.w, 8, 'center', 700);
  // 两个多功能键盘（MFK）
  const mfk = (x0) => {
    R(g, x0, 312, 190, 196, { fill: '#33383f', stroke: '#1a1d21', lw: 2, r: 5 });
    R(g, x0 + 8, 320, 174, 34, { fill: '#05080b', stroke: '#5b636d', lw: 1 });
    T(g, 'MFK', x0 + 14, 330, C.cyan, 9, 'left', 700); T(g, 'FL370/.850', x0 + 176, 344, C.w, 11, 'right', 700, MONO);
    const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) {
      const k = keys[j * 6 + i] || ['SP', 'DEL', 'CLR', '/'][j * 6 + i - 26] || '';
      if (k) btn(g, x0 + 10 + i * 29, 362 + j * 28, 25, 23, k);
    }
  };
  mfk(10); mfk(w - 200);
  // 两个调谐控制面板（TCP）与光标控制器（CCD）
  const tcp = (x0) => {
    R(g, x0, 516, 190, 160, { fill: '#33383f', stroke: '#1a1d21', lw: 2, r: 5 });
    R(g, x0 + 8, 524, 174, 52, { fill: '#05080b', stroke: '#5b636d', lw: 1 });
    T(g, 'VHF L', x0 + 14, 536, C.cyan, 9, 'left', 700); T(g, '132.850', x0 + 176, 536, C.w, 12, 'right', 700, MONO);
    T(g, 'VHF R', x0 + 14, 552, C.cyan, 9, 'left', 700); T(g, '121.500', x0 + 176, 552, C.w, 12, 'right', 700, MONO);
    T(g, 'XPDR', x0 + 14, 568, C.cyan, 9, 'left', 700); T(g, '2341', x0 + 176, 568, C.w, 12, 'right', 700, MONO);
    ['VHF', 'HF', 'SAT', 'XPDR', 'NAV', 'MENU'].forEach((k, i) => btn(g, x0 + 10 + (i % 3) * 58, 584 + Math.floor(i / 3) * 28, 52, 22, k));
    knob(g, x0 + 160, 652, 12);
  };
  tcp(10); tcp(w - 200);
  const ccd = (x0) => {
    R(g, x0, 684, 190, 84, { fill: '#33383f', stroke: '#1a1d21', lw: 2, r: 5 });
    R(g, x0 + 44, 692, 102, 56, { fill: '#1b1f24', stroke: '#6b737d', lw: 1, r: 8 });
    btn(g, x0 + 8, 700, 30, 40, 'SEL'); btn(g, x0 + 152, 700, 30, 40, 'MENU');
    T(g, 'CURSOR CONTROL', x0 + 95, 758, C.grey, 8, 'center', 700);
  };
  ccd(10); ccd(w - 200);
}

/** 生成驾驶舱图集。quality='std' 时按一半分辨率绘制（UV 不变） */
export function createCockpitTextures(quality = 'high') {
  const k = quality === 'high' ? 1 : 0.5;
  const A = canvas(FD_ATLAS.W, FD_ATLAS.H, k);
  const g = A.g;
  g.fillStyle = '#000'; g.fillRect(0, 0, FD_ATLAS.W, FD_ATLAS.H);
  const r = FD_ATLAS.rects;
  const inRect = (key, fn) => { const [x, y, w, h] = r[key]; g.save(); g.translate(x, y); clipRect(g, 0, 0, w, h); fn(w, h); g.restore(); };
  // 外侧屏：PFD 在靠内 2/3、AUX 在靠外 1/3（机长屏 AUX 在左，副驾驶屏 AUX 在右）
  inRect('lob', (w, h) => { aux(g, 168, h); at(g, 171, 0, () => pfd(g, w - 171, h)); L(g, [[169.5, 0], [169.5, h]], '#2a3038', 3); });
  inRect('rob', (w, h) => { pfd(g, w - 171, h); at(g, w - 168, 0, () => aux(g, 168, h)); L(g, [[w - 169.5, 0], [w - 169.5, h]], '#2a3038', 3); });
  inRect('lib', (_, h) => { nd(g, 254, h); at(g, 258, 0, () => eicas(g, 254, h)); L(g, [[256, 0], [256, h]], '#2a3038', 3); });
  inRect('rib', (_, h) => { elec(g, 254, h); at(g, 258, 0, () => nd(g, 254, h)); L(g, [[256, 0], [256, h]], '#2a3038', 3); });
  inRect('lcd', (_, h) => { cdu(g, 254, h, 'legs'); at(g, 258, 0, () => cdu(g, 254, h, 'prog')); L(g, [[256, 0], [256, h]], '#2a3038', 3); });
  inRect('hud', (w, h) => hud(g, w, h));
  inRect('efb', (w, h) => efb(g, w, h));
  inRect('mcp', (w, h) => mcpStrip(g, w, h));
  const atlas = new THREE.CanvasTexture(A.cv);
  atlas.flipY = false; atlas.colorSpace = THREE.SRGBColorSpace;

  const P = canvas(FD_PANELS.W, FD_PANELS.H, k);
  const pr = FD_PANELS.rects;
  P.g.fillStyle = '#2c3138'; P.g.fillRect(0, 0, FD_PANELS.W, FD_PANELS.H);
  for (const [key, fn] of [['ovh', overhead], ['ped', pedestal]]) {
    const [x, y, w, h] = pr[key];
    P.g.save(); P.g.translate(x, y); clipRect(P.g, 0, 0, w, h); fn(P.g, w, h); P.g.restore();
  }
  const panels = new THREE.CanvasTexture(P.cv);
  panels.flipY = false; panels.colorSpace = THREE.SRGBColorSpace;
  return { atlas, panels };
}

/** 风挡窗洞遮罩：机头 s∈[0, MASK_S] × t∈[0, 2π] 的展开图，窗内为白。返回贴图与 u 方向缩放（机身 u = s / FUS.L） */
export function createCockpitMask() {
  const W = 512, H = 1024;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  // 窗洞向外膨胀约 2 px（≈18–25 mm）：栅格台阶全部落在 45 mm 宽的内压边 U 形槽背后，
  // 否则洞比玻璃轮廓小的地方会露出一圈锯齿状的内饰板颜色
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 4; g.lineJoin = 'round';
  for (const pts of windowOutlinesST()) {
    g.beginPath();
    pts.forEach(([s, t], i) => { const x = (s / MASK_S) * W, y = (t / TAU) * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath(); g.fill(); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false; tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  return { tex, scale: FUS.L / MASK_S };
}
