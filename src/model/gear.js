// 起落架：前起落架（双轮，向前收起）+ 左右主起落架（四轮小车，向内侧收起）。
// 含减震支柱、扭力臂、可折叠撑杆（两连杆 IK 求膝点）、刹车、舱门与轮舱，并按收放进度联动。
// 数据：ACAPS §7.2（轮距 9.80 m、轴距 25.83 m、主轮 54×21.0R23、前轮 40×16.0R16）。
// 787 是首款采用电刹车的民航客机：每个主轮刹车由 4 个机电作动器（EBAC）压紧碳刹车盘。
import * as THREE from 'three';
import { GEAR, ATTITUDE, G } from './spec.js';
import { section, point, normal } from './fuselage.js';
import { fairingOffset } from './fairing.js';
import { merge, cylinderBetween as cyl, boxBetween, grid, flipGeometry } from '../geom/build.js';
import { clamp, smoothstep, DEG } from '../core/math.js';
import { setHoleBox, HOLES } from '../render/holes.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAN = Math.tan(ATTITUDE.pitchDeg * DEG);
/** 机体系中的地面高度（停机姿态机头下俯 0.8°） */
export const groundY = (s) => -(s - ATTITUDE.pivotS) * TAN;
const hb = G.hb;

// —— 关键几何（机体系：x=站位 s，y=高度，z=左舷为正）——
export const GEO = {
  main: { sT: 30.85, yT: 3.75, defl: 0.035, swing: 89 }, // 耳轴位于后梁之后的起落架梁上，内收 89°
  nose: { sT: 5.55, yT: hb + 0.95, defl: 0.035, swing: 92 }, // 前收 92°
  noseWell: { s0: 2.8, s1: 6.15, sDoor: 5.0, half: 0.62, top: hb + 1.78 },
  mainWell: { s0: 29.65, s1: 32.85, z0: 0.12, z1: 2.88, top: 4.78, tauIn: 0.05, tauMid: 0.5, tauOut: 0.92 },
};

// ———————————————— 几何工具 ————————————————
const _p = V(), _n = V();
function fairingP(s, tau, extra = 0, out = V()) {
  point(s, tau, out);
  normal(s, tau, _n);
  return out.addScaledVector(_n, fairingOffset(s, tau) + extra);
}
/** 整流罩表面在 (s, |z|) 处的高度（二分 τ） */
function fairingYAt(s, z) {
  let a = 0, b = 1.4;
  for (let k = 0; k < 30; k++) { const m = (a + b) / 2; if (fairingP(s, m, 0, _p).z < Math.abs(z)) a = m; else b = m; }
  return fairingP(s, (a + b) / 2, 0, _p).y;
}
/** 机头下表面在 (s, z) 处的参数 t 与高度 */
function noseT(s, z) { const q = section(s); return Math.asin(clamp(z / q.w, -0.999, 0.999)); }
function noseYAt(s, z) { const q = section(s); const t = noseT(s, z); return q.zw - (q.zw - q.zb) * Math.cos(t); }

/** 统一绕序：首个三角形的几何法线与给定外法线同向 */
function orient(g, outward) {
  const P = g.attributes.position, I = g.index;
  const a = V().fromBufferAttribute(P, I.getX(0)), b = V().fromBufferAttribute(P, I.getX(1)), c = V().fromBufferAttribute(P, I.getX(2));
  if (b.sub(a).cross(c.sub(a)).dot(outward) < 0) flipGeometry(g);
  return g;
}

/** 轮胎：带胎肩圆角与 4 条周向花纹槽的回转体（轴向 = z） */
function tyreGeometry(D, W, rimD, seg = 64) {
  const R = D / 2, rb = rimD / 2, hw = W / 2, h = R - rb;
  const g = Math.max(0.008, D * 0.009);
  const pts = [];
  const side = [[0.0, 0.8], [0.12, 0.93], [0.35, 1.0], [0.6, 0.99], [0.82, 0.93], [0.93, 0.84], [0.985, 0.75]];
  for (const [f, x] of side) pts.push(new THREE.Vector2(rb + 0.01 + f * (h - 0.01), -x * hw));
  const grooves = [-0.46, -0.13, 0.13, 0.46], gw = 0.04;
  const NT = 56;
  for (let i = 0; i <= NT; i++) {
    const x = -0.7 + (1.4 * i) / NT;
    let d = 0;
    for (const c of grooves) d = Math.max(d, smoothstep(-0.012, 0.012, gw - Math.abs(x - c)));
    pts.push(new THREE.Vector2(R - g * d, x * hw));
  }
  for (const [f, x] of side.slice().reverse()) pts.push(new THREE.Vector2(rb + 0.01 + f * (h - 0.01), x * hw));
  const geo = new THREE.LatheGeometry(pts, seg);
  geo.rotateX(Math.PI / 2);
  return geo;
}
/** 轮毂：外侧带轮辋凸缘、碟形辐板、螺栓圈与轮毂盖（外侧朝 +z） */
function rimGeometry(W, rimD, nBolts = 12, seg = 48) {
  const rb = rimD / 2, hw = W / 2;
  const prof = [[0.0, -0.82], [rb * 0.7, -0.82], [rb - 0.02, -0.88], [rb + 0.03, -0.86], [rb + 0.03, -0.8], [rb - 0.004, -0.78],
    [rb - 0.004, 0.78], [rb + 0.03, 0.8], [rb + 0.03, 0.86], [rb - 0.02, 0.88], [rb * 0.78, 0.8], [rb * 0.55, 0.74], [0.11 * rimD / 0.584, 0.76], [0.08 * rimD / 0.584, 0.86], [0.0, 0.88]];
  const geo = new THREE.LatheGeometry(prof.map(([r, x]) => new THREE.Vector2(r, x * hw)), seg);
  geo.rotateX(Math.PI / 2);
  const parts = [geo];
  const rB = (rb * 0.55 + 0.11 * rimD / 0.584) / 2;
  for (let k = 0; k < nBolts; k++) {
    const a = (k / nBolts) * Math.PI * 2;
    const p = V(Math.cos(a) * rB, Math.sin(a) * rB, 0.77 * hw);
    parts.push(cyl(p, p.clone().add(V(0, 0, 0.03)), 0.011, 0.011, 6));
  }
  return merge(parts);
}

/** 动态连杆：单位圆柱，每帧按两端点更新姿态与长度 */
class Link {
  constructor(mat, r, seg = 12) {
    const g = new THREE.CylinderGeometry(r, r, 1, seg);
    g.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.castShadow = true;
  }
  set(a, b) {
    const d = V().subVectors(b, a);
    const L = Math.max(1e-4, d.length());
    this.mesh.position.copy(a);
    this.mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.divideScalar(L));
    this.mesh.scale.set(1, L, 1);
  }
}
/** 两连杆膝点（bend 为弯折方向偏好） */
function knee(A, B, l1, l2, bend) {
  const d = V().subVectors(B, A);
  const D = Math.min(d.length(), l1 + l2 - 1e-6);
  const u = d.normalize();
  const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const perp = bend.clone().addScaledVector(u, -bend.dot(u)).normalize();
  return A.clone().addScaledVector(u, a).addScaledVector(perp, h);
}

/** 铰接舱门：矩阵 = T(P)·R(a,θ)·T(−P)；sign 使正角度向下打开 */
class Door {
  constructor(mesh, p, a, max) {
    this.mesh = mesh; this.p = p.clone(); this.a = a.clone().normalize(); this.max = max;
    mesh.matrixAutoUpdate = false;
    // 判定方向：以几何中心试转，取使其下降的方向
    mesh.geometry.computeBoundingBox();
    const c = mesh.geometry.boundingBox.getCenter(V());
    const test = c.clone().sub(this.p).applyAxisAngle(this.a, 0.3).add(this.p);
    this.sign = test.y < c.y ? 1 : -1;
    this.angle = 0;
  }
  set(theta) {
    this.angle = theta;
    const m = this.mesh.matrix;
    m.makeTranslation(this.p.x, this.p.y, this.p.z);
    m.multiply(new THREE.Matrix4().makeRotationAxis(this.a, this.sign * theta));
    m.multiply(new THREE.Matrix4().makeTranslation(-this.p.x, -this.p.y, -this.p.z));
    this.mesh.matrixWorldNeedsUpdate = true;
  }
}

/** 轮舱内壁：底边贴合外表面，顶为平板（双面深色） */
function wellGeometry(corners, ySurf, top) {
  const parts = [];
  const n = corners.length, NS = 14;
  for (let i = 0; i < n; i++) {
    const [s0, z0] = corners[i], [s1, z1] = corners[(i + 1) % n];
    parts.push(grid(2, NS + 1, (r, j, out) => {
      const u = j / NS, s = s0 + (s1 - s0) * u, z = z0 + (z1 - z0) * u;
      out.set(s, r === 0 ? ySurf(s, z) - 0.02 : top, z);
    }));
  }
  const c = corners;
  parts.push(grid(2, 2, (r, j, out) => { const p = r === 0 ? (j === 0 ? c[0] : c[1]) : (j === 0 ? c[3] : c[2]); out.set(p[0], top, p[1]); }));
  return merge(parts);
}

export class Gear {
  constructor(M, reg) {
    this.M = M;
    this.reg = reg;
    this.group = new THREE.Group();
    this.group.name = 'landingGear';
    // 主起落架（随 44/45 段）与前起落架（随 41 段）分组，便于分解视图分别移动
    this.mainGroup = new THREE.Group();
    this.mainGroup.name = 'mainGear';
    this.noseGroup = new THREE.Group();
    this.noseGroup.name = 'noseGear';
    this.group.add(this.mainGroup, this.noseGroup);
    this.mains = [1, -1].map((S) => this.buildMain(S));
    this.nose = this.buildNose();
    this.buildMainDoorsAndWells();
    this.buildNoseDoorsAndWell();
    // 开洞盒：0 前轮舱，1/2 左/右主轮舱
    const NW = GEO.noseWell, MW = GEO.mainWell;
    setHoleBox(0, V((NW.s0 + NW.s1) / 2, hb + 0.55, 0), V((NW.s1 - NW.s0) / 2 - 0.01, 0.75, NW.half - 0.01));
    for (const [k, S] of [[1, 1], [2, -1]]) {
      setHoleBox(k, V((MW.s0 + MW.s1) / 2, 2.3, S * (MW.z0 + MW.z1) / 2), V((MW.s1 - MW.s0) / 2 - 0.01, 1.0, (MW.z1 - MW.z0) / 2 - 0.01));
    }
    this.set(0);
  }

  r(mesh, id, comp, role = 'exterior') {
    this.reg(mesh, id, { comp, section: 'gear', role });
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  // ———————————————— 主起落架 ————————————————
  buildMain(S) {
    const M = this.M, C = GEO.main;
    const T = V(C.sT, C.yT, S * GEAR.mainY);
    const R = GEAR.mainTire.d / 2, dA = GEAR.mainAxleSpacing / 2, sC = GEAR.mainS;
    const aF = groundY(sC - dA) + R - C.defl, aR = groundY(sC + dA) + R - C.defl;
    const P = V(sC, (aF + aR) / 2, T.z);
    const pitch = Math.atan2(aR - aF, 2 * dA);
    const strut = new THREE.Group();
    strut.position.copy(T);
    this.mainGroup.add(strut);
    const Pl = P.clone().sub(T), Ls = Pl.length(), u = Pl.clone().normalize();
    const fwd = V(u.y, -u.x, 0); // 垂直于支柱、指向前方
    const inb = V(0, 0, -S); // 指向机身
    const at = (k) => u.clone().multiplyScalar(k);

    const steel = [], chrome = [], dark = [];
    // 耳轴横梁（顺航向，收放转轴）与外筒
    steel.push(cyl(V(-0.6, 0, 0), V(0.55, 0, 0), 0.12, 0.12, 16));
    steel.push(cyl(at(-0.18), at(2.05), 0.2, 0.19, 24));
    steel.push(cyl(at(1.95), at(2.12), 0.215, 0.215, 24)); // 外筒下端密封环
    chrome.push(cyl(at(2.0), at(Ls - 0.3), 0.135, 0.135, 24)); // 活塞杆（镀铬）
    steel.push(cyl(at(Ls - 0.42), at(Ls + 0.02), 0.16, 0.13, 18)); // 下端叉形接头
    steel.push(cyl(V(0, 0, -0.26).add(Pl), V(0, 0, 0.26).add(Pl), 0.085, 0.085, 14)); // 小车枢轴销
    // 阻力撑杆：上端位于耳轴轴线前方（与支柱一同转动），下端连外筒
    const dTop = V(-1.45, 0.02, 0), dBot = at(1.15).addScaledVector(fwd, 0.18);
    steel.push(cyl(dTop, dBot, 0.075, 0.07, 14));
    steel.push(cyl(dTop.clone().add(V(0, 0, -0.12)), dTop.clone().add(V(0, 0, 0.12)), 0.06, 0.06, 10));
    // 扭力臂（剪刀式，位于支柱前侧）
    const tu = at(1.98).addScaledVector(fwd, 0.17), tl = at(Ls - 0.38).addScaledVector(fwd, 0.17);
    const tk = tu.clone().add(tl).multiplyScalar(0.5).addScaledVector(fwd, 0.38);
    for (const dz of [-0.06, 0.06]) {
      steel.push(boxBetween(tu.clone().add(V(0, 0, dz)), tk.clone().add(V(0, 0, dz)), 0.035, 0.09));
      steel.push(boxBetween(tk.clone().add(V(0, 0, dz)), tl.clone().add(V(0, 0, dz)), 0.035, 0.09));
    }
    steel.push(cyl(tk.clone().add(V(0, 0, -0.1)), tk.clone().add(V(0, 0, 0.1)), 0.03, 0.03, 8));
    // 液压管路（沿外筒后侧）
    const back = fwd.clone().negate();
    dark.push(cyl(at(0.1).addScaledVector(back, 0.23).addScaledVector(inb, 0.08), at(Ls - 0.5).addScaledVector(back, 0.17).addScaledVector(inb, 0.08), 0.018, 0.018, 6));
    // 俯仰配平作动筒：外筒后侧 → 小车后段
    const pa = at(Ls - 0.75).addScaledVector(back, 0.2);
    const pb = Pl.clone().add(V(0.62, 0.12, 0));
    steel.push(cyl(pa, pa.clone().lerp(pb, 0.55), 0.055, 0.055, 12));
    chrome.push(cyl(pa.clone().lerp(pb, 0.5), pb, 0.03, 0.03, 10));

    strut.add(this.r(new THREE.Mesh(merge(steel), M.gear), 'mainGear', 'compSteel'));
    strut.add(this.r(new THREE.Mesh(merge(chrome), M.chrome), 'mainGear', 'compSteel'));
    strut.add(this.r(new THREE.Mesh(merge(dark), M.gearDark), 'mainGear', 'compOther'));

    // 支柱舱门：固定在支柱外侧，收起后与机翼下表面齐平
    const dp = [];
    const d0 = 0.12, d1 = 1.95, f0 = -0.5, f1 = 0.5;
    const plate = grid(2, 2, (i, j, out) => out.copy(at(i === 0 ? d0 : d1)).addScaledVector(fwd, j === 0 ? f0 : f1).add(V(0, 0, S * 0.27)));
    dp.push(orient(plate, V(0, 0, S)));
    const plateIn = grid(2, 2, (i, j, out) => out.copy(at(i === 0 ? d0 : d1)).addScaledVector(fwd, j === 0 ? f0 : f1).add(V(0, 0, S * 0.245)));
    dp.push(orient(plateIn, V(0, 0, -S)));
    // 门框加强筋（内侧）与连接支架
    const ribs = [];
    for (const k of [0.4, 1.1, 1.75]) ribs.push(boxBetween(at(k).addScaledVector(fwd, f0 + 0.05).add(V(0, 0, S * 0.23)), at(k).addScaledVector(fwd, f1 - 0.05).add(V(0, 0, S * 0.23)), 0.03, 0.05, u));
    for (const k of [0.55, 1.5]) ribs.push(cyl(at(k).add(V(0, 0, S * 0.19)), at(k).add(V(0, 0, S * 0.25)), 0.03, 0.03, 8));
    strut.add(this.r(new THREE.Mesh(merge(dp), M.wing), 'gearDoors', 'compCFRP'));
    strut.add(this.r(new THREE.Mesh(merge(ribs), M.gearDark), 'gearDoors', 'compAl'));

    // 小车（四轮）：可绕枢轴俯仰
    const bogie = new THREE.Group();
    bogie.position.copy(Pl);
    bogie.rotation.z = pitch;
    strut.add(bogie);
    const bSteel = [], bDark = [];
    bSteel.push(cyl(V(-dA - 0.32, 0, 0), V(dA + 0.32, 0, 0), 0.115, 0.115, 18)); // 小车梁（钛合金 Ti-5553）
    const zw = GEAR.mainWheelSpanY / 2;
    for (const x of [-dA, dA]) bSteel.push(cyl(V(x, 0, -zw - 0.12), V(x, 0, zw + 0.12), 0.078, 0.078, 14)); // 轮轴
    // 刹车拉杆
    for (const dz of [-0.17, 0.17]) bDark.push(cyl(V(-dA + 0.1, -0.2, dz), V(dA - 0.1, -0.2, dz), 0.022, 0.022, 6));
    bogie.add(this.r(new THREE.Mesh(merge(bSteel), M.gear), 'mainGear', 'compTi'));
    bogie.add(this.r(new THREE.Mesh(merge(bDark), M.gearDark), 'brakes', 'compSteel'));
    // 机轮：轮胎 + 轮毂 + 碳刹车（含 4 个机电作动器）
    const W = GEAR.mainTire.w, rimD = 0.584;
    const tyre = tyreGeometry(GEAR.mainTire.d, W, rimD);
    const rim = rimGeometry(W, rimD, 12);
    const brk = [];
    const z0 = -0.78 * W / 2;
    brk.push(cyl(V(0, 0, z0), V(0, 0, z0 - 0.2), 0.245, 0.245, 28));
    brk.push(cyl(V(0, 0, z0 - 0.2), V(0, 0, z0 - 0.24), 0.2, 0.2, 24));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const p = V(Math.cos(a) * 0.19, Math.sin(a) * 0.19, z0 - 0.2);
      brk.push(cyl(p, p.clone().add(V(0, 0, -0.17)), 0.045, 0.045, 12));
    }
    const brake = merge(brk);
    const tyres = [], rims = [], brakes = [];
    for (const x of [-dA, dA]) {
      for (const zs of [-1, 1]) {
        const place = (g) => { const c = g.clone(); if (zs < 0) c.rotateY(Math.PI); c.translate(x, 0, zs * zw); return c; };
        tyres.push(place(tyre)); rims.push(place(rim)); brakes.push(place(brake));
      }
    }
    bogie.add(this.r(new THREE.Mesh(merge(tyres), M.rubber), 'wheels', 'compOther'));
    bogie.add(this.r(new THREE.Mesh(merge(rims), M.wheel), 'wheels', 'compAl'));
    bogie.add(this.r(new THREE.Mesh(merge(brakes), M.gearDark), 'brakes', 'compOther'));
    [tyre, rim, brake].forEach((g) => g.dispose());

    // 可折叠侧撑杆：支柱中部内侧 → 机翼/机身接合处固定点；放下时两连杆共线锁定
    const aLocal = at(1.3).addScaledVector(inb, 0.18);
    const B = V(C.sT + 0.05, 3.6, S * 3.25);
    strut.updateMatrix();
    const A0 = aLocal.clone().applyMatrix4(strut.matrix);
    const lb = A0.distanceTo(B) / 2;
    const l1 = new Link(M.gear, 0.07), l2 = new Link(M.gear, 0.07);
    for (const l of [l1, l2]) { this.mainGroup.add(l.mesh); this.r(l.mesh, 'mainGear', 'compTi'); }
    const kneeBall = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), M.gearDark);
    this.mainGroup.add(kneeBall); this.r(kneeBall, 'mainGear', 'compSteel');
    const mount = new THREE.Mesh(cyl(B.clone().add(V(-0.12, 0, 0)), B.clone().add(V(0.12, 0, 0)), 0.08, 0.08, 10), M.gearDark);
    this.mainGroup.add(mount); this.r(mount, 'mainGear', 'compSteel');
    return { S, strut, bogie, aLocal, B, lb, l1, l2, kneeBall, bend: V(-1, -0.25, 0).normalize() }; // 收起时向前折叠，躺在翼根厚度之内
  }

  // ———————————————— 前起落架 ————————————————
  buildNose() {
    const M = this.M, C = GEO.nose;
    const T = V(C.sT, C.yT, 0);
    const R = GEAR.noseTire.d / 2;
    const P = V(GEAR.noseS, groundY(GEAR.noseS) + R - C.defl, 0);
    const strut = new THREE.Group();
    strut.position.copy(T);
    this.noseGroup.add(strut);
    const Pl = P.clone().sub(T), Ls = Pl.length(), u = Pl.clone().normalize();
    const fwd = V(u.y, -u.x, 0);
    const at = (k) => u.clone().multiplyScalar(k);
    const steel = [], chrome = [];
    steel.push(cyl(V(0, 0, -0.36), V(0, 0, 0.36), 0.085, 0.085, 14)); // 耳轴（横向，前收转轴）
    steel.push(cyl(at(-0.12), at(1.2), 0.145, 0.14, 22)); // 外筒
    steel.push(cyl(at(0.92), at(1.08), 0.19, 0.19, 22)); // 转弯套环
    for (const dz of [-1, 1]) { // 两个转弯作动筒
      const a = at(0.7).add(V(0, 0, dz * 0.2)).addScaledVector(fwd, -0.08), b = at(1.0).add(V(0, 0, dz * 0.17)).addScaledVector(fwd, 0.08);
      steel.push(cyl(a, b, 0.04, 0.04, 10));
    }
    chrome.push(cyl(at(1.15), at(Ls - 0.12), 0.095, 0.095, 20)); // 活塞杆
    steel.push(cyl(at(Ls - 0.2), at(Ls + 0.05), 0.11, 0.1, 16)); // 轴座
    steel.push(cyl(Pl.clone().add(V(0, 0, -0.5)), Pl.clone().add(V(0, 0, 0.5)), 0.055, 0.055, 12)); // 轮轴
    // 扭力臂
    const tu = at(1.12).addScaledVector(fwd, 0.13), tl = at(Ls - 0.18).addScaledVector(fwd, 0.12);
    const tk = tu.clone().add(tl).multiplyScalar(0.5).addScaledVector(fwd, 0.25);
    steel.push(boxBetween(tu, tk, 0.05, 0.06), boxBetween(tk, tl, 0.05, 0.06));
    // 滑行灯/跑道转弯灯支架（支柱前侧）
    const lb = at(0.5).addScaledVector(fwd, 0.15);
    steel.push(boxBetween(lb.clone().add(V(0, 0, -0.2)), lb.clone().add(V(0, 0, 0.2)), 0.12, 0.08, V(1, 0, 0)));
    const lamps = [];
    for (const dz of [-0.13, 0, 0.13]) {
      const c = lb.clone().add(V(0, 0, dz)).addScaledVector(fwd, 0.06);
      lamps.push(cyl(c, c.clone().addScaledVector(fwd, 0.02), 0.045, 0.045, 14));
    }
    strut.add(this.r(new THREE.Mesh(merge(steel), M.gear), 'noseGear', 'compSteel'));
    strut.add(this.r(new THREE.Mesh(merge(chrome), M.chrome), 'noseGear', 'compSteel'));
    const lampMesh = new THREE.Mesh(merge(lamps), M.lightWhite);
    strut.add(this.r(lampMesh, 'gearLights', 'compOther'));
    // 前轮（无刹车）
    const W = GEAR.noseTire.w, rimD = 0.406, zw = GEAR.noseWheelSpan / 2;
    const tyre = tyreGeometry(GEAR.noseTire.d, W, rimD, 56), rim = rimGeometry(W, rimD, 8, 40);
    const tyres = [], rims = [];
    for (const zs of [-1, 1]) {
      const place = (g) => { const c = g.clone(); if (zs < 0) c.rotateY(Math.PI); c.translate(Pl.x, Pl.y, zs * zw); return c; };
      tyres.push(place(tyre)); rims.push(place(rim));
    }
    strut.add(this.r(new THREE.Mesh(merge(tyres), M.rubber), 'wheels', 'compOther'));
    strut.add(this.r(new THREE.Mesh(merge(rims), M.wheel), 'wheels', 'compAl'));
    tyre.dispose(); rim.dispose();
    // 后舱门连杆不建模；A 字形可折叠阻力撑杆：支柱 → 前方机身两点
    const aLocal = at(0.88).addScaledVector(fwd, 0.13);
    const Bs = [V(4.0, hb + 0.95, 0.3), V(4.0, hb + 0.95, -0.3)];
    strut.updateMatrix();
    const A0 = aLocal.clone().applyMatrix4(strut.matrix);
    const links = Bs.map((B) => {
      const l = A0.distanceTo(B) / 2;
      const l1 = new Link(M.gear, 0.055), l2 = new Link(M.gear, 0.055);
      for (const q of [l1, l2]) { this.noseGroup.add(q.mesh); this.r(q.mesh, 'noseGear', 'compSteel'); }
      return { B, l, l1, l2 };
    });
    return { strut, aLocal, links };
  }

  // ———————————————— 舱门与轮舱 ————————————————
  buildMainDoorsAndWells() {
    const M = this.M, MW = GEO.mainWell;
    this.mainDoors = [];
    this.wells = [];
    for (const S of [1, -1]) {
      const patch = (t0, t1) => {
        const rows = 16, cols = 12;
        const g = grid(rows, cols, (i, j, out) => {
          const s = MW.s0 + ((MW.s1 - MW.s0) * i) / (rows - 1);
          const tau = S * (t0 + ((t1 - t0) * j) / (cols - 1));
          fairingP(s, tau, 0.004, out);
        }, { uv: (i, j) => [(MW.s0 + ((MW.s1 - MW.s0) * i) / (rows - 1)) / G.L, (S * (t0 + ((t1 - t0) * j) / (cols - 1))) / (Math.PI * 2)] });
        const mid = (t0 + t1) / 2;
        return orient(g, normal(31, S * mid, V()));
      };
      // 内侧门：铰链在靠机身中线一侧；外侧门：铰链在外缘
      const inner = new THREE.Mesh(patch(MW.tauIn, MW.tauMid - 0.006), M.panel);
      const outer = new THREE.Mesh(patch(MW.tauMid + 0.006, MW.tauOut), M.panel);
      for (const m of [inner, outer]) { this.mainGroup.add(m); this.r(m, 'gearDoors', 'compCFRP', 'skinDetail'); }
      const hp = (tau) => [fairingP(MW.s0, S * tau, 0.004), fairingP(MW.s1, S * tau, 0.004)];
      const [a0, a1] = hp(MW.tauIn), [b0, b1] = hp(MW.tauOut);
      this.mainDoors.push(new Door(inner, a0, a1.clone().sub(a0), 84 * DEG));
      this.mainDoors.push(new Door(outer, b0, b1.clone().sub(b0), 80 * DEG));
      // 轮舱
      const z0 = S * MW.z0, z1 = S * MW.z1;
      const well = new THREE.Mesh(wellGeometry([[MW.s0, z0], [MW.s1, z0], [MW.s1, z1], [MW.s0, z1]], fairingYAt, MW.top), M.wellDark);
      this.mainGroup.add(well); this.r(well, 'wheelWell', 'compCFRP', 'exterior');
      this.wells.push({ mesh: well, hole: S > 0 ? 1 : 2 });
    }
  }
  buildNoseDoorsAndWell() {
    const M = this.M, NW = GEO.noseWell;
    this.noseDoorsFwd = []; this.noseDoorsAft = [];
    for (const S of [1, -1]) {
      const patch = (s0, s1) => {
        const rows = 12, cols = 8;
        const zAt = (j) => S * (0.004 + ((NW.half - 0.004) * j) / (cols - 1));
        const g = grid(rows, cols, (i, j, out) => {
          const s = s0 + ((s1 - s0) * i) / (rows - 1), t = noseT(s, zAt(j));
          point(s, t, out); normal(s, t, _n); out.addScaledVector(_n, 0.004);
        }, { uv: (i, j) => { const s = s0 + ((s1 - s0) * i) / (rows - 1); return [s / G.L, noseT(s, zAt(j)) / (Math.PI * 2)]; } });
        return orient(g, V(0, -1, 0));
      };
      const hinge = (s0, s1) => { const p0 = V(s0, noseYAt(s0, S * NW.half), S * NW.half), p1 = V(s1, noseYAt(s1, S * NW.half), S * NW.half); return [p0, p1.sub(p0)]; };
      const f = new THREE.Mesh(patch(NW.s0, NW.sDoor - 0.01), M.panel);
      const a = new THREE.Mesh(patch(NW.sDoor + 0.01, NW.s1), M.panel);
      for (const m of [f, a]) { this.noseGroup.add(m); this.r(m, 'gearDoors', 'compCFRP', 'skinDetail'); }
      this.noseDoorsFwd.push(new Door(f, ...hinge(NW.s0, NW.sDoor), 88 * DEG));
      this.noseDoorsAft.push(new Door(a, ...hinge(NW.sDoor, NW.s1), 82 * DEG));
    }
    const h = NW.half;
    const well = new THREE.Mesh(wellGeometry([[NW.s0, -h], [NW.s1, -h], [NW.s1, h], [NW.s0, h]], noseYAt, NW.top), M.wellDark);
    this.noseGroup.add(well); this.r(well, 'wheelWell', 'compCFRP', 'exterior');
    this.wells.push({ mesh: well, hole: 0 });
  }

  /** 收放进度 v：0 = 放下锁定，1 = 收上锁定。顺序：开舱门 → 收放作动 → 关舱门 */
  set(v) {
    v = clamp(v, 0, 1);
    this.v = v;
    const door = smoothstep(0, 0.16, v) * (1 - smoothstep(0.84, 1, v));
    const k = smoothstep(0.14, 0.86, v);
    for (const m of this.mains) {
      m.strut.rotation.x = m.S * k * GEO.main.swing * DEG;
      m.strut.updateMatrix();
      const A = m.aLocal.clone().applyMatrix4(m.strut.matrix);
      const K = knee(A, m.B, m.lb, m.lb, m.bend);
      m.l1.set(A, K); m.l2.set(K, m.B); m.kneeBall.position.copy(K);
    }
    for (const d of this.mainDoors) d.set(door * d.max);
    const n = this.nose;
    n.strut.rotation.z = -k * GEO.nose.swing * DEG;
    n.strut.updateMatrix();
    const A = n.aLocal.clone().applyMatrix4(n.strut.matrix);
    for (const q of n.links) {
      const Aq = A.clone().setZ(q.B.z * 0.33);
      const K = knee(Aq, q.B, q.l, q.l, V(0, 1, 0));
      q.l1.set(Aq, K); q.l2.set(K, q.B);
    }
    for (const d of this.noseDoorsFwd) d.set(door * d.max);
    const aft = 1 - smoothstep(0.62, 0.92, v);
    for (const d of this.noseDoorsAft) d.set(Math.max(door, aft) * d.max);
    // 开洞与轮舱显隐
    HOLES.on[0] = Math.max(door, aft) > 1e-3 ? 1 : 0;
    HOLES.on[1] = HOLES.on[2] = door > 1e-3 ? 1 : 0;
    for (const w of this.wells) w.mesh.visible = HOLES.on[w.hole] > 0.5;
  }
}

/** 舱门分缝线（供机身纹理绘制）：[[s, t], …] 闭合折线，t 为机身周向参数 */
export function gearDoorOutlines() {
  const out = [];
  const NW = GEO.noseWell, MW = GEO.mainWell;
  for (const S of [1, -1]) {
    for (const [s0, s1] of [[NW.s0, NW.sDoor], [NW.sDoor, NW.s1]]) {
      const pts = [];
      for (let k = 0; k <= 8; k++) { const s = s0 + ((s1 - s0) * k) / 8; pts.push([s, noseT(s, S * 0.004)]); }
      for (let k = 0; k <= 8; k++) { const s = s1 - ((s1 - s0) * k) / 8; pts.push([s, noseT(s, S * NW.half)]); }
      out.push(pts);
    }
    for (const [t0, t1] of [[MW.tauIn, MW.tauMid], [MW.tauMid, MW.tauOut]]) {
      out.push([[MW.s0, S * t0], [MW.s1, S * t0], [MW.s1, S * t1], [MW.s0, S * t1]]);
    }
  }
  return out;
}
