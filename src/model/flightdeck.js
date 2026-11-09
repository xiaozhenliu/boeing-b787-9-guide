// 驾驶舱（41 段上层）——按 787 布局程序化生成：代码几何 + Canvas 贴图，无外部模型。
// 机体系：s 自机头向后、y 高度、z 左舷为正；机长坐左座（z > 0）。
// 布局推算：风挡下缘 y≈5.38 → 设计眼位 (2.85, 5.71, ±0.58)，越过遮光罩经风挡下缘可俯视约 16°；
// 遮光罩后立面 = MCP（方式控制板）+ 两侧 EFIS/显示选择板；主仪表板并排 4 块 15.1 in（4:3）液晶屏，
// 操纵台前端斜置第 5 块（下中央屏）；787 标配双 HUD：合像玻璃在眼前约 0.3 m，投影组件在头顶；
// 波音保留柱式驾驶盘（非侧杆）。受风挡高度约束，驾驶舱地板比客舱低约 0.31 m，门内设两级台阶。
import * as THREE from 'three';
import { point, normal, tAtHeight, FUS } from './fuselage.js';
import { tAtLateralUpper, COCKPIT, windowTrimGeometry } from './cockpit.js';
import { capPolygon, grid, cylinderBetween, boxBetween } from '../geom/build.js';
import { FD_ATLAS, FD_PANELS, MCP_W, MCP_KNOBS } from '../render/cockpitTextures.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;
const hb = FUS.zb0;
export const FD_FLOOR = hb + 2.64;
/** 机长设计眼位 [s, y, z]（副驾驶 z 取负） */
export const FD_EYE = [2.85, FD_FLOOR + 1.22, 0.58];

const UP = V(0, 1, 0);
const RIGHT = V(0, 0, -1); // 面向机头时的右手方向（副驾驶侧）
const _N = V(), _P = V();
function inner(s, t, d, out) { point(s, t, out); normal(s, t, _N); return out.addScaledVector(_N, -d); }
/** 蒙皮内侧（偏移 d）在高度 y 处的半宽 */
const wallZ = (s, y, d = 0.006) => inner(s, tAtHeight(s, y, 1), d, _P).z;
/** 蒙皮内侧（偏移 d）在横向 |z| 处的顶高 */
const ceilY = (s, z, d = 0.006) => inner(s, tAtLateralUpper(s, Math.abs(z)), d, _P).y;

/** 贴图平板：中心 c、法线 n、宽 w、高 h；rect = 图集 A 中的像素区域 [x, y, w, h]（贴图 flipY = false）；
 *  xAxis = 图像向右的方向（缺省为 竖直轴 × n，适合立面；水平面须显式给出） */
function plate(c, n, w, h, rect, A, xAxis = null) {
  const nn = n.clone().normalize();
  const x = (xAxis ? xAxis.clone() : UP.clone().cross(nn)).normalize();
  const y = nn.clone().cross(x).normalize();
  const [rx, ry, rw, rh] = rect;
  const P = [], N = [], UV = [];
  for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const p = c.clone().addScaledVector(x, (u - 0.5) * w).addScaledVector(y, (v - 0.5) * h);
    P.push(p.x, p.y, p.z); N.push(nn.x, nn.y, nn.z);
    UV.push((rx + u * rw) / A.W, (ry + (1 - v) * rh) / A.H);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
/** 定向方盒：中心 c，局部轴 x、y（第三轴 = x × y），三向尺寸 sx、sy、sz */
function obox(c, x, y, sx, sy, sz) {
  const z = x.clone().cross(y).normalize();
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(c));
  return g;
}
const abox = (cx, cy, cz, sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz);
/** 侧面轮廓（[s, y] 点列）沿 z 拉伸 */
function prismZ(profile, z0, z1) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([s, y]) => new THREE.Vector2(s, y))), { depth: z1 - z0, bevelEnabled: false });
  return g.translate(0, 0, z0);
}
/** 贴墙柜体：内侧面在 |z| = zi，外侧顺着蒙皮；s∈[s0,s1]、y∈[y0,y1]；sg = 1 左舷 / −1 右舷 */
function wallBox(s0, s1, zi, y0, y1, sg) {
  const out = [];
  const W = (s, y) => sg * Math.max(zi + 0.01, wallZ(s, y));
  const ns = Math.max(2, Math.ceil((s1 - s0) / 0.12)), ny = Math.max(2, Math.ceil((y1 - y0) / 0.15));
  out.push(capPolygon([V(s0, y0, sg * zi), V(s1, y0, sg * zi), V(s1, y1, sg * zi), V(s0, y1, sg * zi)], V(0, 0, -sg)));
  const top = [V(s0, y1, sg * zi), V(s1, y1, sg * zi)];
  for (let k = ns; k >= 0; k--) { const s = s0 + ((s1 - s0) * k) / ns; top.push(V(s, y1, W(s, y1))); }
  out.push(capPolygon(top, UP));
  for (const [s, f] of [[s0, -1], [s1, 1]]) {
    const pts = [V(s, y0, sg * zi), V(s, y1, sg * zi)];
    for (let k = ny; k >= 0; k--) { const y = y0 + ((y1 - y0) * k) / ny; pts.push(V(s, y, W(s, y))); }
    out.push(capPolygon(pts, V(f, 0, 0)));
  }
  return out;
}
/** 顺着两侧蒙皮的水平地板/台面（y 处，s0→s1） */
function floorPoly(s0, s1, y, inset = 0.006) {
  const n = Math.max(2, Math.ceil((s1 - s0) / 0.12)), l = [], r = [];
  for (let k = 0; k <= n; k++) { const s = s0 + ((s1 - s0) * k) / n, z = wallZ(s, y + 0.004, inset); l.push(V(s, y, z)); r.push(V(s, y, -z)); }
  return capPolygon([...l, ...r.reverse()], UP);
}
/** 横跨机身的竖直隔板（站位 s，y0→y1，两侧顺着蒙皮）；facing = ±1（朝后 / 朝前） */
function crossPanel(s, y0, y1, facing) {
  const n = Math.max(2, Math.ceil((y1 - y0) / 0.1)), l = [], r = [];
  for (let k = 0; k <= n; k++) { const y = y0 + ((y1 - y0) * k) / n, z = wallZ(s, y); l.push(V(s, y, z)); r.push(V(s, y, -z)); }
  return capPolygon([...l, ...r.reverse()], V(facing, 0, 0));
}

/** 生成驾驶舱几何，按材质名分组返回 { fdBody: [...], fdGlare: [...], ... } */
export function buildFlightDeck() {
  const L = {};
  const add = (k, ...g) => { (L[k] ||= []).push(...g); };
  const F = FD_FLOOR;
  const [, EYE_Y, EYE_Z] = FD_EYE;
  const A = FD_ATLAS, R = A.rects;

  // ———————— 遮光罩：顶面从风挡下缘向后抬到 MCP 上沿（哑光黑防眩） ————————
  const GS = { s: 2.30, y: F + 1.01 }; // 后上沿 (2.30, 5.50)：位于“眼位—风挡下缘”视线之下约 5 cm
  const [fq0, fq1] = COCKPIT.front.quad; // 前风挡内下角、外下角（正视坐标：横向、距机腹高度）
  const sillY = (lat) => hb + fq0[1] + (fq1[1] - fq0[1]) * THREE.MathUtils.clamp((lat - fq0[0]) / (fq1[0] - fq0[0]), 0, 1);
  const sAtWall = (lat, y, lo = 1.2, hi = GS.s) => { // 蒙皮内侧在高度 y、横向 lat 处的站位（半宽随 s 单调增）
    for (let k = 0; k < 32; k++) { const m = (lo + hi) / 2; if (wallZ(m, y) < lat + 0.004) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const zA = wallZ(GS.s, GS.y) - 0.004;
  const NZ = 37, NU = 10;
  add('fdGlare', grid(NZ, NU, (i, j, out) => {
    const z = -zA + (2 * zA * i) / (NZ - 1);
    const yf = sillY(Math.abs(z)) - 0.008;
    const sf = Math.min(sAtWall(Math.abs(z), yf), GS.s);
    const u = j / (NU - 1), e = 1 - (1 - u) * (1 - u); // 前端陡、后部平
    out.set(sf + (GS.s - sf) * u, yf + (GS.y - yf) * e, 0);
    const zw = Math.max(0, wallZ(out.x, out.y) - 0.004);
    out.z = THREE.MathUtils.clamp(z, -zw, zw);
  }));

  // MCP 立面：后仰 18°，贴图宽 MCP_W，高按贴图比例（≈0.13 m）
  const [, , MW, MH] = R.mcp;
  const MCP_H = (MCP_W * MH) / MW;
  const tilt = 18 * D2R;
  const mcpN = V(Math.cos(tilt), Math.sin(tilt), 0), mcpUp = V(-Math.sin(tilt), Math.cos(tilt), 0);
  const mcpTop = V(GS.s, GS.y, 0), mcpBot = mcpTop.clone().addScaledVector(mcpUp, -MCP_H);
  const zB = wallZ(mcpBot.x, mcpBot.y) - 0.004;
  add('fdGlare', capPolygon([V(GS.s, GS.y, zA), V(GS.s, GS.y, -zA), V(mcpBot.x, mcpBot.y, -zB), V(mcpBot.x, mcpBot.y, zB)], mcpN));
  const mcpC = mcpTop.clone().lerp(mcpBot, 0.5);
  add('fdMcp', plate(mcpC.clone().addScaledVector(mcpN, 0.002), mcpN, MCP_W, MCP_H, R.mcp, A));
  for (const [px, py, pr] of MCP_KNOBS) { // 立体旋钮：速度、航向、高度、EFIS 最低标准/气压
    const p = mcpC.clone().addScaledVector(RIGHT, (px / MW - 0.5) * MCP_W).addScaledVector(mcpUp, (0.5 - py / MH) * MCP_H).addScaledVector(mcpN, 0.002);
    const r = (pr * MCP_W) / MW;
    add('fdKnob', cylinderBetween(p, p.clone().addScaledVector(mcpN, 0.005), r + 0.004, r + 0.004, 24));
    add('fdKnob', cylinderBetween(p, p.clone().addScaledVector(mcpN, 0.021), r, r * 0.9, 24));
  }

  // ———————— 主仪表板（MIP）：上沿缩进遮光罩檐下，后仰 12° 正对眼位 ————————
  const MIP = { sT: 2.215, yT: F + 0.88, sB: 2.285, yB: F + 0.55 }; // 上沿 y 5.37、下沿 y 5.04
  const mipUp = V(MIP.sT - MIP.sB, MIP.yT - MIP.yB, 0).normalize();
  const mipN = RIGHT.clone().cross(mipUp);
  const mipP = (z, v) => V(MIP.sB + (MIP.sT - MIP.sB) * v, MIP.yB + (MIP.yT - MIP.yB) * v, z);
  const zT = wallZ(MIP.sT, MIP.yT) - 0.004;
  add('fdGlare', capPolygon([V(mcpBot.x, mcpBot.y, zB), V(mcpBot.x, mcpBot.y, -zB), V(MIP.sT, MIP.yT, -zT), V(MIP.sT, MIP.yT, zT)], V(0, -1, 0))); // 檐下
  {
    const l = [], r = [];
    for (let k = 0; k <= 8; k++) { const p = mipP(0, k / 8), z = wallZ(p.x, p.y) - 0.004; l.push(p.clone().setZ(z)); r.push(p.clone().setZ(-z)); }
    add('fdBody', capPolygon([...l, ...r.reverse()], mipN));
  }
  // 4 块 15.1 in 显示器（可视区 0.307 × 0.230 m）：外侧屏 PFD 正对飞行员、AUX 在外侧 1/3
  const BZ = { w: 0.355, h: 0.285, d: 0.018 }, SCR = { w: 0.307, h: 0.230 };
  for (const [key, z] of [['lob', 0.64], ['lib', 0.195], ['rib', -0.195], ['rob', -0.64]]) {
    const base = mipP(z, 0.5);
    add('fdGlare', obox(base.clone().addScaledVector(mipN, BZ.d / 2), RIGHT, mipUp, BZ.w, BZ.h, BZ.d));
    add('fdDisplay', plate(base.clone().addScaledVector(mipN, BZ.d + 0.0015), mipN, SCR.w, SCR.h, R[key], A));
  }
  // 左缝：备用飞行显示器（ISFD，取 PFD 姿态仪区域）；右缝：起落架手柄（轮形握把，收上位）与自动刹车旋钮
  {
    const zs = (0.195 + BZ.w / 2 + 0.64 - BZ.w / 2) / 2;
    const p = mipP(zs, 0.62);
    add('fdGlare', obox(p.clone().addScaledVector(mipN, 0.007), RIGHT, mipUp, 0.082, 0.082, 0.014));
    add('fdDisplay', plate(p.clone().addScaledVector(mipN, 0.0155), mipN, 0.066, 0.066, [264.5, 95, 150, 150], A));
    const g0 = mipP(-zs, 0.6);
    add('fdBody', obox(g0.clone().addScaledVector(mipN, 0.005), RIGHT, mipUp, 0.07, 0.17, 0.01));
    const a = mipP(-zs, 0.74).addScaledVector(mipN, 0.01), b = a.clone().addScaledVector(mipN, 0.075);
    add('fdKnob', boxBetween(a, b, 0.012, 0.012));
    add('fdLever', cylinderBetween(b, b.clone().addScaledVector(mipN, 0.018), 0.027, 0.027, 24));
    const ab = mipP(-zs, 0.2);
    add('fdKnob', cylinderBetween(ab, ab.clone().addScaledVector(mipN, 0.022), 0.015, 0.013, 18));
  }

  // ———————— 膝部空间：仪表板下方的搁板与下面板 ————————
  const KS = 1.96;
  add('fdBody', floorPoly(KS, MIP.sB, MIP.yB));
  add('fdBody', crossPanel(KS, F, MIP.yB, 1));

  // ———————— 中央操纵台：前端斜置下中央屏，其后为油门台与后操纵台 ————————
  const PW = 0.21;
  const ldT = 58 * D2R;
  const ldUp = V(-Math.sin(ldT), Math.cos(ldT), 0), ldN = V(Math.cos(ldT), Math.sin(ldT), 0);
  const ldTop = V(MIP.sB + 0.005, MIP.yB, 0), ldBot = ldTop.clone().addScaledVector(ldUp, -0.262);
  const [, , PWpx, PHpx] = FD_PANELS.rects.ped;
  const PED = { y: F + 0.5, s0: 2.545, w: 2 * PW };
  PED.len = (PED.w * PHpx) / PWpx;
  PED.s1 = PED.s0 + PED.len;
  add('fdBody', prismZ([
    [MIP.sB - 0.01, F], [PED.s1 + 0.012, F], [PED.s1 + 0.012, PED.y - 0.012], [PED.s1, PED.y], [PED.s0, PED.y],
    [ldBot.x + 0.018, ldBot.y + 0.004], [ldBot.x, ldBot.y], [ldTop.x, ldTop.y], [MIP.sB - 0.01, ldTop.y],
  ], -PW, PW));
  {
    const c = ldTop.clone().lerp(ldBot, 0.5);
    add('fdGlare', obox(c.clone().addScaledVector(ldN, 0.006), RIGHT, ldUp, 0.345, 0.262, 0.012));
    add('fdDisplay', plate(c.clone().addScaledVector(ldN, 0.0135), ldN, SCR.w, SCR.h, R.lcd, A));
  }
  add('fdPanel', plate(V((PED.s0 + PED.s1) / 2, PED.y + 0.0015, 0), UP, PED.w, PED.len, FD_PANELS.rects.ped, FD_PANELS, RIGHT));
  const pk = PED.w / PWpx;
  const pedPt = (px, py) => V(PED.s0 + py * pk, PED.y, (PWpx / 2 - px) * pk); // 台面贴图像素 → 机体系
  // 油门杆（巡航推力，约前推 70%）+ 骑背式反推手柄
  for (const px of [172, 244]) {
    const base = pedPt(px, 81), lean = 18 * D2R;
    const dir = V(-Math.sin(lean), Math.cos(lean), 0), fwd = V(-Math.cos(lean), -Math.sin(lean), 0);
    const top = base.clone().addScaledVector(dir, 0.17);
    add('fdKnob', boxBetween(base, top, 0.014, 0.02));
    add('fdYoke', cylinderBetween(top.clone().setZ(top.z + 0.027), top.clone().setZ(top.z - 0.027), 0.017, 0.017, 18));
    add('fdKnob', boxBetween(base.clone().addScaledVector(dir, 0.08).addScaledVector(fwd, 0.016), base.clone().addScaledVector(dir, 0.155).addScaledVector(fwd, 0.02), 0.012, 0.01));
  }
  // 减速板手柄（DOWN 位，左）与襟翼手柄（UP 位，右）
  const lever = (px, py, len, handle) => {
    const base = pedPt(px, py), top = base.clone().add(V(-Math.sin(10 * D2R) * len, Math.cos(10 * D2R) * len, 0));
    add('fdKnob', boxBetween(base, top, 0.012, 0.016));
    add('fdLever', handle(top));
  };
  lever(53, 46, 0.12, (t) => cylinderBetween(t.clone().setZ(t.z + 0.04), t.clone().setZ(t.z - 0.035), 0.011, 0.011, 14));
  lever(PWpx - 53, 32, 0.12, (t) => abox(t.x, t.y, t.z, 0.04, 0.022, 0.066));
  // 燃油控制电门（RUN）与停留刹车手柄
  for (const px of [168, 248]) {
    const b = pedPt(px, 281);
    add('fdLever', cylinderBetween(b, b.clone().add(V(0, 0.03, 0)), 0.006, 0.006, 10), cylinderBetween(b.clone().add(V(0, 0.026, 0)), b.clone().add(V(0, 0.04, 0)), 0.01, 0.01, 12));
  }
  {
    const b = pedPt(PWpx - 60, 274), t = b.clone().add(V(0.01, 0.035, 0));
    add('fdKnob', cylinderBetween(b, t, 0.006, 0.006, 10));
    add('fdLever', cylinderBetween(t.clone().setZ(t.z + 0.025), t.clone().setZ(t.z - 0.025), 0.008, 0.008, 12));
  }

  // ———————— 方向舵脚蹬与驾驶盘（柱式，“公羊角”形盘体） ————————
  const pu = V(-Math.sin(16 * D2R), Math.cos(16 * D2R), 0);
  for (const sg of [1, -1]) {
    const zc = sg * EYE_Z;
    for (const dz of [0.11, -0.11]) {
      const z = zc + dz;
      add('fdKnob', obox(V(2.10, F + 0.2, z), RIGHT, pu, 0.085, 0.2, 0.022));
      add('fdKnob', boxBetween(V(2.085, F + 0.29, z), V(KS - 0.005, F + 0.42, z), 0.03, 0.03));
    }
    const base = V(2.37, F, zc), hub = V(2.47, F + 0.62, zc);
    add('fdYoke', cylinderBetween(base, hub, 0.036, 0.03, 16));
    add('fdKnob', cylinderBetween(base, base.clone().setY(F + 0.07), 0.075, 0.055, 20)); // 地板防尘套
    add('fdYoke', abox(hub.x + 0.01, hub.y + 0.02, zc, 0.07, 0.09, 0.11));
    const sb = hub.x + 0.03, yb = hub.y + 0.02;
    add('fdYoke', cylinderBetween(V(sb, yb, zc + 0.15), V(sb, yb, zc - 0.15), 0.017, 0.017, 14));
    for (const s2 of [1, -1]) add('fdYoke', cylinderBetween(V(sb, yb - 0.025, zc + s2 * 0.15), V(sb + 0.012, yb + 0.115, zc + s2 * 0.172), 0.02, 0.017, 14));
    add('fdBody', plate(V(sb + 0.021, yb + 0.005, zc), V(1, 0.25, 0), 0.075, 0.05, [0, 0, 1, 1], { W: 1, H: 1 })); // 检查单夹
  }

  // ———————— 飞行员座椅（可前后、上下调节）与侧操纵台 ————————
  for (const sg of [1, -1]) {
    const z = sg * EYE_Z;
    add('fdKnob', abox(2.95, F + 0.012, z + 0.13, 0.9, 0.024, 0.04), abox(2.95, F + 0.012, z - 0.13, 0.9, 0.024, 0.04)); // 座椅滑轨
    add('fdSeat', abox(2.96, F + 0.18, z, 0.3, 0.32, 0.3)); // 基座（升降机构）
    add('fdSeat', abox(2.87, F + 0.41, z, 0.5, 0.14, 0.5)); // 坐垫：面高 0.48 m
    add('fdSeat', boxBetween(V(3.1, F + 0.5, z), V(3.25, F + 1.2, z), 0.48, 0.12)); // 靠背后仰 12°
    add('fdSeat', boxBetween(V(3.235, F + 1.15, z), V(3.265, F + 1.36, z), 0.3, 0.13)); // 头枕
    for (const dz of [0.27, -0.27]) {
      add('fdSeat', abox(2.96, F + 0.7, z + dz, 0.3, 0.045, 0.055), abox(3.08, F + 0.585, z + dz, 0.05, 0.2, 0.04)); // 扶手
    }
    // 侧操纵台：顶面高 0.66 m；前端为前轮转弯手轮（舵柄），后部为氧气面罩盒
    const yt = F + 0.66;
    add('fdBody', ...wallBox(2.6, 3.55, 1.02, F, yt, sg));
    const tc = V(2.74, yt, sg * 1.13);
    add('fdKnob', cylinderBetween(tc, tc.clone().add(V(0, 0.022, 0)), 0.055, 0.055, 28));
    add('fdLever', cylinderBetween(tc.clone().add(V(-0.04, 0.022, 0)), tc.clone().add(V(-0.04, 0.06, 0)), 0.009, 0.009, 10));
    add('fdBody', abox(3.3, yt + 0.04, sg * 1.36, 0.2, 0.08, 0.16));
    // 电子飞行包（EFB）：装在侧壁上，屏幕转向飞行员
    const ec = V(2.52, F + 0.86, sg * 1.16), en = V(0.45, 0.22, -sg * 0.86).normalize();
    const ex = UP.clone().cross(en).normalize(), ey = en.clone().cross(ex);
    add('fdGlare', obox(ec.clone().addScaledVector(en, -0.01), ex, ey, 0.245, 0.19, 0.02));
    add('fdDisplay', plate(ec.clone().addScaledVector(en, 0.0015), en, 0.211, 0.158, R.efb, A));
    add('fdKnob', boxBetween(ec.clone().addScaledVector(en, -0.02), V(2.56, F + 0.84, sg * (wallZ(2.56, F + 0.84) - 0.035)), 0.03, 0.03));
  }

  // ———————— 平视显示器（HUD）：合像玻璃 + 吊架 + 头顶投影组件 ————————
  const ht = 26 * D2R;
  const hUp = V(-Math.sin(ht), Math.cos(ht), 0), hN = V(Math.cos(ht), Math.sin(ht), 0);
  const HW = 0.24, HH = 0.18;
  const ohuX = V(Math.cos(30 * D2R), Math.sin(30 * D2R), 0), ohuY = V(-Math.sin(30 * D2R), Math.cos(30 * D2R), 0);
  for (const sg of [1, -1]) {
    const z = sg * EYE_Z;
    const hc = V(2.56, EYE_Y + 0.005, z);
    add('fdHudGlass', plate(hc, hN, HW, HH, [0, 0, 1, 1], { W: 1, H: 1 }));
    add('fdHud', plate(hc.clone().addScaledVector(hN, 0.0015), hN, HW * 0.96, HH * 0.96, R.hud, A));
    const topC = hc.clone().addScaledVector(hUp, HH / 2);
    add('fdKnob', boxBetween(topC.clone().setZ(z + HW / 2 + 0.01), topC.clone().setZ(z - HW / 2 - 0.01), 0.022, 0.03));
    const my = ceilY(2.56, Math.abs(z) + 0.08, 0.012) - 0.03; // 吊架盒：按前缘外侧角的舱顶高度定位（舱顶向前、向外都在下降）
    add('fdBody', abox(2.61, my, z, 0.1, 0.05, 0.16));
    for (const sz of [1, -1]) add('fdKnob', boxBetween(topC.clone().setZ(z + sz * (HW / 2 - 0.01)), V(2.61, my - 0.02, z + sz * 0.07), 0.008, 0.008));
    const oc = V(3.0, ceilY(3.0, Math.abs(z) + 0.1, 0.02) - 0.085, z);
    add('fdBody', obox(oc, ohuX, ohuY, 0.26, 0.1, 0.2));
    add('fdGlare', obox(oc.clone().addScaledVector(ohuX, -0.131).addScaledVector(ohuY, -0.015), ohuX, ohuY, 0.004, 0.05, 0.12)); // 投影窗口
  }

  // ———————— 顶板：随舱顶后仰 22°；四周用侧板封到舱顶 ————————
  const [, , OWpx, OHpx] = FD_PANELS.rects.ovh;
  const OV = { w: 0.6, s0: 2.52, y0: 6.03, ang: 22 * D2R };
  OV.len = (OV.w * OHpx) / OWpx;
  const ovDir = V(Math.cos(OV.ang), Math.sin(OV.ang), 0);
  const ovN = RIGHT.clone().cross(ovDir);
  add('fdPanel', plate(V(OV.s0, OV.y0, 0).addScaledVector(ovDir, OV.len / 2), ovN, OV.w, OV.len, FD_PANELS.rects.ovh, FD_PANELS, RIGHT));
  {
    const ovPt = (u, v) => V(OV.s0, OV.y0, (0.5 - u) * OV.w).addScaledVector(ovDir, v * OV.len);
    const skirt = (pts) => grid(pts.length, 2, (i, j, out) => { out.copy(pts[i]); if (j === 1) out.y = ceilY(out.x, out.z, 0.012); });
    const n = 8, edge = (f) => Array.from({ length: n + 1 }, (_, k) => f(k / n));
    add('fdBody', skirt(edge((t) => ovPt(0, t))), skirt(edge((t) => ovPt(1, 1 - t))), skirt(edge((t) => ovPt(1 - t, 0))), skirt(edge((t) => ovPt(t, 1))));
  }
  // 风挡内侧窗框（侧壁 + 压边）
  add('fdBody', windowTrimGeometry());
  // 备用磁罗盘：挂在中央窗柱顶端
  const cTop = ceilY(2.39, 0.035, 0.012);
  add('fdBody', abox(2.42, cTop - 0.025, 0, 0.06, 0.05, 0.07));
  add('fdGlare', abox(2.452, cTop - 0.028, 0, 0.004, 0.026, 0.044));

  // ———————— 地板、门内台阶、后隔板与驾驶舱门 ————————
  const CF = FUS.floor, hS = (CF - F) / 2;
  const ST1 = 4.25, ST2 = 4.4, BH = 4.55;
  add('fdCarpet', floorPoly(KS, ST1, F + 0.002), floorPoly(ST1, ST2, F + hS), floorPoly(ST2, 5.21, CF + 0.004));
  add('fdBody', crossPanel(ST1, F, F + hS, -1), crossPanel(ST2, F + hS, CF, -1));
  const DW = 0.42, DT = CF + 1.95;
  const wallUp = (y0, y1, sg) => Array.from({ length: 11 }, (_, k) => { const y = y0 + ((y1 - y0) * k) / 10; return V(BH, y, sg * wallZ(BH, y)); });
  add('fdLining', capPolygon([V(BH, CF, DW), ...wallUp(CF, DT, 1), V(BH, DT, DW)], V(-1, 0, 0)));
  add('fdLining', capPolygon([V(BH, CF, -DW), ...wallUp(CF, DT, -1), V(BH, DT, -DW)], V(-1, 0, 0)));
  {
    const tL = tAtHeight(BH, DT, 1), arc = [];
    for (let k = 0; k <= 20; k++) arc.push(inner(BH, tL + ((2 * Math.PI - 2 * tL) * k) / 20, 0.006, V()));
    add('fdLining', capPolygon(arc, V(-1, 0, 0)));
  }
  add('fdDoor', abox(BH, (CF + DT) / 2, 0, 0.05, DT - CF - 0.01, 2 * DW - 0.012)); // 加固驾驶舱门（关闭）
  add('fdBody', abox(BH - 0.03, (CF + DT) / 2, DW + 0.02, 0.03, DT - CF, 0.04), abox(BH - 0.03, (CF + DT) / 2, -DW - 0.02, 0.03, DT - CF, 0.04), abox(BH - 0.03, DT + 0.02, 0, 0.03, 0.04, 2 * DW + 0.08));
  add('fdKnob', abox(BH - 0.04, CF + 1.02, -DW + 0.09, 0.03, 0.03, 0.14));
  add('fdKnob', cylinderBetween(V(BH - 0.026, CF + 1.55, 0), V(BH - 0.034, CF + 1.55, 0), 0.012, 0.012, 12)); // 门镜
  // 观察员座椅（中央）与左后衣帽柜
  add('fdSeat', abox(3.8, F + 0.21, 0, 0.26, 0.42, 0.3), abox(3.79, F + 0.475, 0, 0.42, 0.11, 0.48));
  add('fdSeat', boxBetween(V(4.0, F + 0.53, 0), V(4.06, F + 1.16, 0), 0.46, 0.1));
  add('fdLining', ...wallBox(3.9, BH - 0.01, 1.25, F, F + 1.56, 1));
  return L;
}
