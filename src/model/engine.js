// 发动机：GEnx-1B 风格短舱（V 形锯齿降噪外涵喷口、平移套筒反推）+ 18 片复合材料宽弦风扇叶片
// + 可剖切核心机（1+4 级风扇/增压级、10 级高压压气机、TAPS 贫油燃烧室、2 级高压涡轮、7 级低压涡轮）+ 吊挂
// 局部坐标：x 沿发动机轴线自进气唇口向后，y 向上，z 向左舷（两台发动机同向，不镜像——真实发动机转向相同）
// 尺寸依据：GEnx-1B 风扇直径 2.822 m、发动机长 4.95 m（FAA TCDS E00078NE）；短舱外形取自 ACAPS 总图。
import * as THREE from 'three';
import { revolve, merge, grid, loftSolid } from '../geom/build.js';
import { nacaThickness } from '../geom/airfoil.js';
import { makeCuttable } from '../render/materials.js';
import { monotone, clamp, smoothstep, lerp, DEG } from '../core/math.js';
import { WING } from './spec.js';

export const ENG = {
  lipS: 20.8, // 进气唇口站位
  cy: 2.55, // 轴线高度（机身轴线水平时；停机姿态下短舱底部离地约 0.72 m，ACAPS 为 0.69–0.76 m）
  y: WING.engineY, // 发动机中心线 BL 9.905（两发间距 19.81 m）
  Rh: 1.55, // 唇口（highlight）半径
  Rmax: 1.9, // 短舱最大半径
  Rfan: 1.411, // 风扇叶尖半径（直径 2.822 m / 111.1 in）
  fanX: 1.75, // 风扇叶片中弦位置
  sleeveX: 3.25, // 反推平移套筒前缘
  sleeveTravel: 0.66,
  chevX: 5.6, // 外涵喷口（锯齿尖）
  chevDepth: 0.24,
  nChev: 16,
  coreExitX: 6.73, // 内涵（核心）喷口
  plugTipX: 7.8, // 尾锥尖
  blades: 18,
  n1Max: 2560, // 100% N1 转速（rpm，近似）
  n2Max: 11377,
};

/** 核心机轴向站位：以核心机自身坐标（风扇位于 1.62）描述，再按 1.1 倍映射到短舱坐标 */
const X = (x) => ENG.fanX + (x - 1.62) * 1.1;

// —— 型线（x, r）——
const rOut = monotone([[0.38, 1.73], [0.9, 1.81], [1.4, 1.865], [2.0, 1.9], [2.6, 1.897], [3.25, 1.88], [3.8, 1.848], [4.3, 1.79], [4.8, 1.69], [5.2, 1.58], [5.6, 1.45], [5.9, 1.33]]);
const rDuct = monotone([[3.25, 1.465], [3.8, 1.462], [4.4, 1.45], [5.0, 1.432], [5.6, 1.41], [5.9, 1.39]]);
const rCore = monotone([[2.2, 0.7], [2.26, 0.745], [2.5, 0.81], [3.27, 0.875], [4.15, 0.905], [5.03, 0.872], [5.8, 0.79], [6.13, 0.745], [6.73, 0.64]]);
export const ENGINE_PROFILE = { rOut, rDuct, rCore };

let SHARED = null;
function sharedMats() {
  if (SHARED) return SHARED;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  SHARED = {
    // 剖切展示配色（按部件分区，便于讲解）
    eLPC: std({ color: 0x5fb4ff, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
    eHPC: std({ color: 0x3fd08a, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
    eComb: std({ color: 0xff7b2e, emissive: 0xff4a00, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.45, side: THREE.DoubleSide }),
    eHPT: std({ color: 0xff4d5e, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
    eLPT: std({ color: 0xb07cff, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
    eStator: std({ color: 0x8a939e, metalness: 0.75, roughness: 0.4, side: THREE.DoubleSide }),
    eShaft: std({ color: 0xd8dde3, metalness: 0.9, roughness: 0.25 }),
    eDisk: std({ color: 0x6e7782, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }),
    cascade: std({ color: 0x6b737e, metalness: 0.45, roughness: 0.5, side: THREE.DoubleSide }),
  };
  return SHARED;
}

/** 克隆材质（保留剖面着色特性），用于每台发动机独立设置剖切平面 */
function cloneMat(m) {
  const c = m.clone();
  if (m.customProgramCacheKey && m.customProgramCacheKey() === 'cuttable') makeCuttable(c);
  return c;
}

/** 一圈叶片（平板四边形，双面材质），用于核心机各级 */
function bladeRing({ x, rHub, rTip, chord, n, stagger, phase = 0, lean = 0 }) {
  const P = new Float32Array(n * 4 * 3), N = new Float32Array(n * 4 * 3);
  const idx = [];
  const cb = Math.cos(stagger), sb = Math.sin(stagger);
  for (let k = 0; k < n; k++) {
    const phi0 = phase + (k / n) * Math.PI * 2;
    const corners = [[-0.5, rHub], [0.5, rHub], [0.5, rTip], [-0.5, rTip]];
    corners.forEach(([sc, r], q) => {
      const ax = x + sc * chord * cb;
      const tau = sc * chord * sb + (r - rHub) * lean;
      const phi = phi0 + tau / r;
      const o = (k * 4 + q) * 3;
      P[o] = ax; P[o + 1] = r * Math.cos(phi); P[o + 2] = r * Math.sin(phi);
      // 法线：切向与轴向的叉积近似
      const nx = -sb, nt = cb;
      N[o] = nx; N[o + 1] = -Math.sin(phi) * nt; N[o + 2] = Math.cos(phi) * nt;
    });
    const b = k * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 8), 2));
  g.setIndex(idx);
  return g;
}

/** 圆盘/环（x 处，r0→r1 的平面环） */
function annulus(x, r0, r1, seg = 48) {
  const g = new THREE.RingGeometry(r0, r1, seg, 1);
  g.rotateY(Math.PI / 2);
  g.translate(x, 0, 0);
  return g;
}

/** 风扇叶片：沿径向放样的扭转、后掠薄翼型（GEnx 第三代复合材料宽弦叶片，叶尖前掠—后掠复合） */
function fanBlade(phi0) {
  const nr = 12, nc = 14;
  const st = [];
  for (let i = 0; i <= nr; i++) {
    const e = i / nr;
    const r = lerp(0.47, ENG.Rfan - 0.004, e);
    const c = 0.32 + 0.25 * Math.pow(e, 0.8);
    const beta = (30 + 33 * e) * DEG; // 安装角（与轴线夹角）由根部到叶尖增大
    const tc = lerp(0.085, 0.028, e);
    const xm = ENG.fanX + 0.08 * e * e - 0.035 * Math.sin(Math.PI * e); // 叶尖后掠
    const cam = 0.035 * c;
    const pt = (xi, side) => {
      const sc = (xi - 0.5) * c;
      const nn = side * nacaThickness(xi, tc) * c + cam * 4 * xi * (1 - xi);
      const x = xm + sc * Math.cos(beta) - nn * Math.sin(beta);
      const tau = sc * Math.sin(beta) + nn * Math.cos(beta);
      const phi = phi0 + tau / r;
      return new THREE.Vector3(x, r * Math.cos(phi), r * Math.sin(phi));
    };
    const upper = [], lower = [];
    for (let j = 0; j <= nc; j++) {
      const xi = 1 - Math.sin((Math.PI / 2) * (j / nc)); // 1 → 0，前缘加密
      upper.push(pt(xi, 1));
    }
    for (let j = 1; j <= nc; j++) {
      const xi = 1 - Math.cos((Math.PI / 2) * (j / nc)); // 0 → 1
      lower.push(pt(xi, -1));
    }
    const seg = upper.concat(lower);
    st.push([seg, [seg[seg.length - 1], seg[0]]]);
  }
  return loftSolid(st);
}

/** 外涵道上/下分叉整流（反推 C 形涵道的连接处）：径向薄板，前后缘圆钝 */
function bifurcation(up) {
  const x0 = 2.95, x1 = 5.25, n = 18;
  const st = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = lerp(x0, x1, u);
    const w = 0.02 + 0.07 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.25)), 0.6) * (1 - 0.7 * smoothstep(0.75, 1, u));
    const r0 = rCore(x) - 0.03;
    const r1 = (x < ENG.sleeveX ? 1.46 : rDuct(x)) + 0.02;
    const s = up ? 1 : -1;
    const loop = [
      new THREE.Vector3(x, s * r0, -w), new THREE.Vector3(x, s * r1, -w),
      new THREE.Vector3(x, s * r1, w), new THREE.Vector3(x, s * r0, w), new THREE.Vector3(x, s * r0, -w),
    ];
    st.push([loop.slice(0, 2), loop.slice(1, 3), loop.slice(2, 4), loop.slice(3, 5)]);
  }
  return loftSolid(st);
}

export class Engine {
  constructor(M, register, side, wing) {
    this.M = M;
    this.register = register;
    this.side = side;
    this.wing = wing;
    this.group = new THREE.Group();
    this.group.name = side > 0 ? 'engineL' : 'engineR';
    this.group.position.set(ENG.lipS, ENG.cy, side * ENG.y);
    this.mats = {
      nacelle: cloneMat(M.nacelle), lip: cloneMat(M.metal), duct: cloneMat(M.duct), acoustic: cloneMat(M.acoustic),
      hot: cloneMat(M.hot), core: cloneMat(M.duct), fanCase: cloneMat(M.darkMetal),
    };
    this.mats.core.color.set(0x8d949c);
    this.cutPlanes = [new THREE.Plane(), new THREE.Plane()];
    this.n1 = 0; // 0..1
    this.lpAngle = 0; this.hpAngle = 0;
    this.build();
  }

  reg(mesh, id, comp, role = 'skin') {
    this.register(mesh, id, { comp, section: 'engine', role });
    return mesh;
  }

  build() {
    const { mats } = this, S = sharedMats(), M = this.M;
    const G = this.group;
    // —— 固定段：进气道内壁、唇口、风扇整流罩外壁、风扇机匣 ——
    const lipIn = [], lipOut = [];
    for (let i = 0; i <= 10; i++) { const th = (i / 10) * (Math.PI / 2); lipIn.push([0.32 - 0.32 * Math.cos(th), ENG.Rh - 0.12 * Math.sin(th)]); }
    for (let i = 0; i <= 12; i++) { const th = (i / 12) * (Math.PI / 2); lipOut.push([0.38 - 0.38 * Math.cos(th), ENG.Rh + 0.18 * Math.sin(th)]); }
    const lipProfile = lipIn.slice().reverse().concat(lipOut.slice(1)); // 内→唇缘→外：材料在右侧
    const inlet = revolve([[[1.38, 1.428], [0.8, 1.429], [0.32, 1.43]]], { segments: 72 });
    const lip = revolve([lipProfile], { segments: 72 });
    const outerPts = [];
    for (let i = 0; i <= 16; i++) { const x = 0.38 + (ENG.sleeveX - 0.38) * (i / 16); outerPts.push([x, rOut(x)]); }
    const cowl = revolve([outerPts], { segments: 72 });
    const fanCase = revolve([[[ENG.sleeveX, 1.465], [2.4, 1.45], [1.38, 1.428]]], { segments: 72 });
    G.add(this.reg(new THREE.Mesh(inlet, mats.acoustic), 'inlet', 'compAl'));
    G.add(this.reg(new THREE.Mesh(lip, mats.lip), 'inlet', 'compAl'));
    G.add(this.reg(new THREE.Mesh(cowl, mats.nacelle), 'nacelle', 'compCFRP'));
    G.add(this.reg(new THREE.Mesh(fanCase, mats.fanCase), 'fanCase', 'compCFRP'));

    // —— 反推平移套筒（带 V 形锯齿喷口）——
    this.sleeve = new THREE.Group();
    G.add(this.sleeve);
    const nC = ENG.nChev, per = 8, cols = nC * per;
    const xEnd = (phi) => {
      const f = ((phi / (Math.PI * 2)) * nC) % 1; // 12 点（吊挂）与 6 点（下分叉）处为锯齿谷
      const tri = 1 - 2 * Math.abs(f - 0.5); // 1 = 锯齿尖
      return [ENG.chevX - ENG.chevDepth * (1 - tri), tri];
    };
    const rows = 22;
    const sleeveSurf = (rf, inward, flip) => grid(rows + 1, cols + 1, (i, j, out) => {
      const phi = (j / cols) * Math.PI * 2;
      const [xe, tri] = xEnd(phi);
      const u = i / rows;
      const x = lerp(ENG.sleeveX, xe, u);
      let r = rf(x);
      r -= inward * tri * smoothstep(0.75, 1, u); // 锯齿尖略向内收（伸入射流）
      out.set(x, r * Math.cos(phi), r * Math.sin(phi));
    }, { flip, uv: (i, j) => [i / rows, j / cols] });
    const sOuter = sleeveSurf(rOut, 0.03, true);
    const sInner = sleeveSurf(rDuct, 0.018, false);
    const edge = grid(2, cols + 1, (i, j, out) => {
      const phi = (j / cols) * Math.PI * 2;
      const [xe, tri] = xEnd(phi);
      const r = i === 0 ? rOut(xe) - 0.03 * tri : rDuct(xe) - 0.018 * tri;
      out.set(xe, r * Math.cos(phi), r * Math.sin(phi));
    }, { flip: true });
    this.sleeve.add(this.reg(new THREE.Mesh(merge([sOuter, edge]), mats.nacelle), 'reverser', 'compCFRP'));
    this.sleeve.add(this.reg(new THREE.Mesh(sInner, mats.duct), 'reverser', 'compCFRP'));
    // 叶栅（套筒后移时露出）
    const casc = [];
    const nv = 64;
    for (let k = 0; k < 6; k++) casc.push(bladeRing({ x: ENG.sleeveX + 0.06 + k * 0.1, rHub: 1.47, rTip: 1.78, chord: 0.075, n: nv, stagger: 55 * DEG }));
    casc.push(revolve([[[ENG.sleeveX + 0.64, 1.47], [ENG.sleeveX, 1.47]]], { segments: 64 }));
    G.add(this.reg(new THREE.Mesh(merge(casc), S.cascade), 'reverser', 'compAl'));
    // 外涵道上/下分叉
    G.add(this.reg(new THREE.Mesh(merge([bifurcation(true), bifurcation(false)]), mats.duct), 'reverser', 'compCFRP'));

    // —— 核心机整流罩、核心喷口、尾锥 ——
    const corePts = [[2.75, 0.6], [2.45, 0.655], [2.28, 0.685], [2.2, 0.7]];
    for (let i = 1; i <= 22; i++) { const x = 2.2 + (6.13 - 2.2) * (i / 22); corePts.push([x, rCore(x)]); }
    G.add(this.reg(new THREE.Mesh(revolve([corePts], { segments: 64 }), mats.core), 'coreCowl', 'compOther'));
    const nozPts = [];
    for (let i = 0; i <= 8; i++) { const x = 6.13 + (ENG.coreExitX - 6.13) * (i / 8); nozPts.push([x, rCore(x)]); }
    nozPts.push([ENG.coreExitX, 0.622], [6.3, 0.61]);
    G.add(this.reg(new THREE.Mesh(revolve([nozPts], { segments: 64 }), mats.hot), 'exhaust', 'compTi'));
    const plug = revolve([[[6.24, 0.47], [6.73, 0.46], [7.12, 0.4], [7.48, 0.27], [7.68, 0.13], [ENG.plugTipX, 0.0]]], { segments: 48 });
    G.add(this.reg(new THREE.Mesh(plug, mats.hot), 'exhaust', 'compTi'));

    // —— 低压转子（风扇 + 整流锥 + 增压级 + 低压涡轮 + 低压轴）——
    this.lp = new THREE.Group();
    this.lp.name = 'lpRotor';
    G.add(this.lp);
    const spinnerPts = [[0.95, 0.0], [0.99, 0.07], [1.06, 0.165], [1.17, 0.255], [1.32, 0.35], [1.48, 0.425], [1.66, 0.465], [1.85, 0.475], [2.15, 0.495], [2.55, 0.485]].map(([x, r]) => [X(x), r]);
    this.lp.add(this.reg(new THREE.Mesh(revolve([spinnerPts], { segments: 56 }), M.spinner), 'spinner', 'compAl'));
    // 整流锥上的白色螺旋标记（地勤用于判断风扇是否转动）
    const mark = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 24, Math.PI * 0.9), M.white);
    mark.rotation.y = Math.PI / 2;
    mark.position.x = X(1.1);
    mark.scale.set(1, 1, 0.6);
    this.lp.add(mark);
    const blades = [];
    for (let k = 0; k < ENG.blades; k++) blades.push(fanBlade((k / ENG.blades) * Math.PI * 2));
    this.lp.add(this.reg(new THREE.Mesh(merge(blades), M.fanBlade), 'fan', 'compCFRP'));
    // 内部（剖切时可见）
    this.internals = new THREE.Group();
    this.internals.visible = false;
    G.add(this.internals);
    const lpInt = [], lptInt = [], hpcInt = [], hptInt = [], stat = [], disks = [];
    for (let k = 0; k < 4; k++) { // 增压级（4 级）
      const x = X(2.14 + k * 0.1);
      lpInt.push(bladeRing({ x, rHub: 0.5, rTip: 0.655 - k * 0.02, chord: 0.055, n: 64, stagger: 45 * DEG }));
      stat.push(bladeRing({ x: x + 0.055, rHub: 0.5, rTip: 0.65 - k * 0.02, chord: 0.044, n: 72, stagger: -25 * DEG }));
    }
    for (let k = 0; k < 7; k++) { // 低压涡轮（7 级）
      const x = X(4.72 + k * 0.17);
      const rh = lerp(0.43, 0.5, k / 6), rt = lerp(0.6, 0.74, k / 6);
      lptInt.push(bladeRing({ x, rHub: rh, rTip: rt, chord: 0.077, n: 90, stagger: -50 * DEG }));
      stat.push(bladeRing({ x: x - 0.088, rHub: rh, rTip: rt, chord: 0.066, n: 80, stagger: 45 * DEG }));
      disks.push(annulus(x, 0.1, rh, 40));
    }
    this.lpInternal = new THREE.Group();
    this.lpInternal.add(this.reg(new THREE.Mesh(merge(lpInt), S.eLPC), 'booster', 'compTi', 'engineCore'));
    this.lpInternal.add(this.reg(new THREE.Mesh(merge(lptInt), S.eLPT), 'lpt', 'compTi', 'engineCore'));
    const lpLen = X(6.0) - X(1.6);
    const lpShaft = new THREE.CylinderGeometry(0.07, 0.07, lpLen, 20);
    lpShaft.rotateZ(Math.PI / 2);
    lpShaft.translate(X(1.6) + lpLen / 2, 0, 0);
    this.lpInternal.add(this.reg(new THREE.Mesh(merge([lpShaft, ...disks]), S.eShaft), 'lpt', 'compTi', 'engineCore'));
    this.internals.add(this.lpInternal);
    // 高压转子（与低压转子反向旋转）
    const hdisks = [];
    for (let k = 0; k < 10; k++) { // 高压压气机（10 级）
      const x = X(2.66 + k * 0.115);
      const rh = lerp(0.3, 0.385, k / 9), rt = lerp(0.53, 0.435, k / 9);
      hpcInt.push(bladeRing({ x, rHub: rh, rTip: rt, chord: 0.055, n: 56, stagger: 42 * DEG }));
      stat.push(bladeRing({ x: x + 0.063, rHub: rh, rTip: rt, chord: 0.044, n: 64, stagger: -28 * DEG }));
      hdisks.push(annulus(x, 0.17, rh, 36));
    }
    for (let k = 0; k < 2; k++) { // 高压涡轮（2 级）
      const x = X(4.36 + k * 0.17);
      hptInt.push(bladeRing({ x, rHub: 0.4, rTip: 0.53 + k * 0.03, chord: 0.077, n: 70, stagger: -55 * DEG }));
      stat.push(bladeRing({ x: x - 0.094, rHub: 0.4, rTip: 0.53 + k * 0.03, chord: 0.066, n: 48, stagger: 50 * DEG }));
      hdisks.push(annulus(x, 0.17, 0.4, 36));
    }
    this.hpInternal = new THREE.Group();
    this.hpInternal.add(this.reg(new THREE.Mesh(merge(hpcInt), S.eHPC), 'hpc', 'compTi', 'engineCore'));
    this.hpInternal.add(this.reg(new THREE.Mesh(merge(hptInt), S.eHPT), 'hpt', 'compTi', 'engineCore'));
    const hpLen = X(4.6) - X(2.6);
    const hpShaft = new THREE.CylinderGeometry(0.17, 0.17, hpLen, 24, 1, true);
    hpShaft.rotateZ(Math.PI / 2);
    hpShaft.translate(X(2.6) + hpLen / 2, 0, 0);
    this.hpInternal.add(this.reg(new THREE.Mesh(merge([hpShaft, ...hdisks]), S.eDisk), 'hpc', 'compTi', 'engineCore'));
    this.internals.add(this.hpInternal);
    // 静子、燃烧室、出口导向叶片
    const comb = revolve([[[3.8, 0.42], [3.86, 0.6], [4.1, 0.62], [4.28, 0.56], [4.28, 0.44], [4.1, 0.39], [3.86, 0.4], [3.8, 0.42]].map(([x, r]) => [X(x), r])], { segments: 56 });
    this.internals.add(this.reg(new THREE.Mesh(comb, S.eComb), 'combustor', 'compOther', 'engineCore'));
    this.internals.add(this.reg(new THREE.Mesh(merge(stat), S.eStator), 'hpc', 'compTi', 'engineCore'));
    const ogv = bladeRing({ x: X(2.42), rHub: rCore(X(2.42)) - 0.01, rTip: 1.445, chord: 0.28, n: 44, stagger: 12 * DEG, lean: 0.12 });
    G.add(this.reg(new THREE.Mesh(ogv, S.eStator), 'ogv', 'compAl'));

    this.buildPylon();
  }

  /** 吊挂：上沿贴机翼下表面并向前延伸至短舱顶部；后段为覆盖核心喷流的整流罩（止于襟副翼之前） */
  buildPylon() {
    const S = this.side;
    const em = this.wing.engineMount();
    const f = em.f;
    const lip = ENG.lipS;
    const sF = lip + 1.6, sLE = em.le.x, sAft = f.xLE + 0.7 * f.c;
    const cy = ENG.cy + (this.dh || 0);
    const top = (s) => {
      if (s <= sLE) return lerp(cy + rOut(1.6) - 0.12, em.le.y - 0.02, (s - sF) / (sLE - sF));
      const xi = clamp((s - f.xLE) / f.c, 0, 1);
      return em.lowerAt(xi).y + 0.06;
    };
    const coreEnd = lip + ENG.coreExitX + 0.3;
    const bottom = (s) => {
      const x = s - lip;
      if (x < ENG.chevX - 0.05) return cy + rOut(clamp(x, 0.38, 5.9)) - 0.08;
      if (s < coreEnd) return cy + rCore(clamp(x, 2.2, ENG.coreExitX)) + 0.05 * smoothstep(ENG.chevX, ENG.chevX + 0.6, x);
      const u = (s - coreEnd) / (sAft - coreEnd);
      return lerp(cy + rCore(ENG.coreExitX) + 0.05, top(sAft) - 0.02, smoothstep(0.08, 1, u) ** 1.25);
    };
    // 吊挂宽度：前端圆头 → 吊挂盒段约 0.5 m 宽 → 后整流罩（隔热罩）逐渐收窄成刀形尾
    const halfW = (s) => {
      const u = (s - sF) / (sAft - sF);
      const nose = Math.sqrt(clamp(u / 0.1, 0, 1));
      const box = 1 - 0.22 * smoothstep(0.3, 0.62, u);
      const tail = Math.pow(1 - smoothstep(0.72, 1, u), 0.65);
      return 0.025 + 0.235 * nose * box * tail;
    };
    const N = 48, K = 32;
    const st = [];
    const z0 = this.wing.W.toWorld(ENG.y, 0, 0, S).z; // 机翼在该展向的 z（含上反角修正）
    for (let i = 0; i <= N; i++) {
      const s = sF + (sAft - sF) * (i / N);
      const yt = top(s), yb = Math.min(bottom(s), yt - 0.04);
      const ym = (yt + yb) / 2, hh = (yt - yb) / 2, w = halfW(s);
      const ring = [];
      for (let k = 0; k <= K; k++) {
        const a = (k / K) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        const zz = w * Math.sign(c) * Math.pow(Math.abs(c), 0.78);
        const yy = hh * Math.sign(sn) * Math.pow(Math.abs(sn), 0.7);
        ring.push(new THREE.Vector3(s, ym + yy, z0 + zz));
      }
      ring[K].copy(ring[0]);
      st.push([ring]);
    }
    const pylon = new THREE.Mesh(loftSolid(st), this.M.white);
    this.register(pylon, 'pylon', { comp: 'compTi', section: 'engine', role: 'skin' });
    this.pylon = pylon;
  }

  /** 机翼弯曲后跟随：发动机随吊挂所在展向位置的挠度平移，并重建吊挂 */
  follow() {
    const h0 = WING.hRoot + ENG.y * Math.tan(WING.dihedral * DEG);
    this.dh = this.wing.W.frame(ENG.y).h - h0;
    this.group.position.y = ENG.cy + this.dh;
    this.buildPylon();
  }

  /** 反推（0..1） */
  setReverser(v) {
    this.sleeve.position.x = v * ENG.sleeveTravel;
  }

  setCutaway(on) {
    this.internals.visible = on;
    const list = Object.values(this.mats);
    for (const m of list) {
      m.clippingPlanes = on ? this.cutPlanes : null;
      m.clipIntersection = true;
      m.needsUpdate = true;
    }
    this.cutOn = on;
    if (on) this.updateCutPlanes();
  }

  /** 剖切平面：去掉朝外侧上方的四分之一（世界坐标） */
  updateCutPlanes() {
    const mw = this.group.matrixWorld;
    const o = new THREE.Vector3().setFromMatrixPosition(mw);
    const ny = new THREE.Vector3(0, -1, 0).transformDirection(mw);
    const nz = new THREE.Vector3(0, 0, -this.side).transformDirection(mw);
    this.cutPlanes[0].setFromNormalAndCoplanarPoint(ny, o);
    this.cutPlanes[1].setFromNormalAndCoplanarPoint(nz, o);
  }

  tick(dt) {
    // 视觉转速：真实转速按比例缩放（真实 100% N1 ≈ 43 转/秒，人眼无法分辨）
    const vis = 0.06;
    const lpRate = (this.n1 * ENG.n1Max) / 60 * vis * Math.PI * 2;
    const hpRate = (this.n1 > 0 ? 0.6 + 0.4 * this.n1 : 0) * ENG.n2Max / 60 * vis * 0.25 * Math.PI * 2;
    this.lpAngle -= lpRate * dt; // 低压转子：自后向前看顺时针
    this.hpAngle += hpRate * dt; // 高压转子：反向旋转
    this.lp.rotation.x = this.lpAngle;
    this.lpInternal.rotation.x = this.lpAngle;
    this.hpInternal.rotation.x = this.hpAngle;
    if (this.cutOn) this.updateCutPlanes();
  }
}
