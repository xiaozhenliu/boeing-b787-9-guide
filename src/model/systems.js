// 外部系统细节与“多电”系统示意。
// 外部：防撞信标（机背/机腹）、天线、翼根着陆灯、座舱空气压缩机（CAC）冲压进气口、冲压空气涡轮（RAT，可放出）。
// 系统模式（role = 'systems'，默认隐藏）：变频起动发电机与附件齿轮箱、APU 与其起动发电机、前/后电子电气设备舱、
// 锂离子电池、电动座舱空气压缩机、空调组件，以及三种能量流（电力：黄；座舱空气：青；发动机引气：橙）。
// 位置依据：ACAPS（TWLU 天线 s 7.1 m）、Avio Aero（GEnx-1B 附件齿轮箱装在核心机高压压气机下方）、
// NTSB/JTSB 2013 电池事件报告（主电池在前 E/E 舱、APU 电池在后 E/E 舱）。设备外形与管路走向为科普示意。
import * as THREE from 'three';
import { point, normal, arcScale, FUS } from './fuselage.js';
import { fairingOffset, cacInletFrames } from './fairing.js';
import { merge } from '../geom/build.js';
import { G } from './spec.js';
import { WingFrame } from './wing.js';
import { SUPERCRITICAL as AF } from '../geom/airfoil.js';
import { setHoleBox, HOLES } from '../render/holes.js';
import { smoothstep } from '../core/math.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const hb = G.hb;
const RAT_HOLE = 3;
const CEIL = hb + 5.1; // 客舱顶部送风总管高度

/** 外表面点：机身表面沿法向外推（整流罩范围内取整流罩表面） */
function fp(s, t, extra = 0, out = V()) {
  point(s, t, out);
  const n = normal(s, t, V());
  return out.addScaledVector(n, Math.max(0, fairingOffset(s, t)) + extra);
}

const spowE = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

/** 曲面上的超椭圆贴片：中心 (s0,t0)，半尺寸 a（沿站位，米）× b（周向弧长，米） */
function curvedPatch(surf, s0, t0, a, b, { n = 4, extra = 0.006, rings = 4, seg = 40 } = {}) {
  const k = arcScale(s0, t0), e = 2 / n, TAU = Math.PI * 2;
  const pos = [...surf(s0, t0, extra).toArray()], uv = [s0 / FUS.L, t0 / TAU], idx = [];
  for (let r = 1; r <= rings; r++) {
    const f = r / rings;
    for (let j = 0; j < seg; j++) {
      const ph = (j / seg) * Math.PI * 2;
      const s = s0 + a * f * spowE(Math.cos(ph), e), t = t0 + (b * f * spowE(Math.sin(ph), e)) / k;
      pos.push(...surf(s, t, extra).toArray());
      uv.push(s / FUS.L, t / TAU); // 与整流罩/蒙皮同一涂装 UV 约定（站位/L，带符号周向角/2π）
    }
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + j, 1 + ((j + 1) % seg));
  for (let r = 1; r < rings; r++) {
    const o0 = 1 + (r - 1) * seg, o1 = 1 + r * seg;
    for (let j = 0; j < seg; j++) { const j1 = (j + 1) % seg; idx.push(o0 + j, o1 + j, o1 + j1, o0 + j, o1 + j1, o0 + j1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n0 = normal(s0, t0, V()), nr = g.attributes.normal;
  if (nr.getX(0) * n0.x + nr.getY(0) * n0.y + nr.getZ(0) * n0.z < 0) { // 统一朝外
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** 有厚度的曲面面板（舱门）：外表面 + 内表面（翻转）+ 侧边条带，打开时能看到板厚 */
function curvedSlab(surf, s0, t0, a, b, { n = 4, extra = 0.004, thick = 0.035, rings = 4, seg = 40 } = {}) {
  const outer = curvedPatch(surf, s0, t0, a, b, { n, extra, rings, seg });
  const inner = curvedPatch(surf, s0, t0, a, b, { n, extra: extra - thick, rings, seg });
  const ii = inner.index.array;
  for (let i = 0; i < ii.length; i += 3) [ii[i + 1], ii[i + 2]] = [ii[i + 2], ii[i + 1]];
  inner.computeVertexNormals();
  const k = arcScale(s0, t0), e = 2 / n, pos = [], idx = [];
  for (let j = 0; j <= seg; j++) {
    const ph = (j / seg) * Math.PI * 2;
    const s = s0 + a * spowE(Math.cos(ph), e), t = t0 + (b * spowE(Math.sin(ph), e)) / k;
    pos.push(...surf(s, t, extra).toArray(), ...surf(s, t, extra - thick).toArray());
  }
  for (let j = 0; j < seg; j++) { const o = 2 * j; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  const edge = new THREE.BufferGeometry();
  edge.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  edge.setIndex(idx);
  edge.computeVertexNormals();
  // 侧边法线应背离面板中心
  const c = surf(s0, t0, extra), p0 = V().fromArray(pos, 0), en = V().fromBufferAttribute(edge.attributes.normal, 0);
  if (en.dot(p0.sub(c)) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    edge.setIndex(idx);
    edge.computeVertexNormals();
  }
  return merge([outer, inner, edge]);
}

/** 贴片外缘的凸起唇口（闭合圆管） */
function lipRing(surf, s0, t0, a, b, { n = 4, extra = 0.012, r = 0.018 } = {}) {
  const k = arcScale(s0, t0), e = 2 / n, pts = [];
  for (let j = 0; j < 48; j++) {
    const ph = (j / 48) * Math.PI * 2;
    pts.push(surf(s0 + a * spowE(Math.cos(ph), e), t0 + (b * spowE(Math.sin(ph), e)) / k, extra));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, r, 8, true);
}

/** 刀形天线：底边长 L、高 H、厚 T；局部 +y 竖立、前缘在 -x 端并向后上方后掠 */
function bladeGeometry(L, H, T, sweep = 0.55) {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.lineTo(L, 0);
  sh.lineTo(L * 0.55 + H * sweep, H);
  sh.lineTo(H * sweep, H);
  sh.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: true, bevelThickness: T * 0.35, bevelSize: T * 0.3, bevelSegments: 2, curveSegments: 4 });
  g.translate(-L / 2, 0, -T / 2);
  return g;
}

/** 把局部 +y 朝上、+x 朝后的几何放到表面 (s, t) 处（显式正交基，机腹处不会翻转） */
function placeOnSkin(g, s, t, lift = 0, surf = null) {
  const n = normal(s, t, V());
  const p = surf ? surf(s, t, 0) : point(s, t, V());
  const ex = V(1, 0, 0).addScaledVector(n, -n.x).normalize();
  const ez = V().crossVectors(ex, n);
  return g.applyMatrix4(new THREE.Matrix4().makeBasis(ex, n, ez).setPosition(p.addScaledVector(n, lift)));
}

/** 沿 x 轴的圆柱（设备外形） */
function cylX(r, len, c, seg = 20) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  g.translate(c.x, c.y, c.z);
  return g;
}

/** 无盖浅盒（RAT 舱）：局部 +z 为开口方向 */
function tub(w, h, d) {
  const parts = [];
  const plane = (pw, ph, rot, pos) => { const p = new THREE.PlaneGeometry(pw, ph); p.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot)); p.translate(...pos); parts.push(p); };
  plane(w, h, new THREE.Euler(0, 0, 0), [0, 0, -d / 2]);
  plane(w, d, new THREE.Euler(Math.PI / 2, 0, 0), [0, h / 2, 0]);
  plane(w, d, new THREE.Euler(-Math.PI / 2, 0, 0), [0, -h / 2, 0]);
  plane(d, h, new THREE.Euler(0, Math.PI / 2, 0), [-w / 2, 0, 0]);
  plane(d, h, new THREE.Euler(0, -Math.PI / 2, 0), [w / 2, 0, 0]);
  return merge(parts);
}

/** 流向管：沿折线的光顺圆管，uv.x 为沿程长度（米），着色器据此做流动光斑 */
function flowTube(pts, r, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  const len = curve.getLength();
  const g = new THREE.TubeGeometry(curve, Math.max(24, Math.round(len * 4)), r, 8, closed);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len);
  return g;
}

export function flowMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, clipping: true,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uSpeed: { value: 2.4 } },
    vertexShader: `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vV = -mvPosition.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uTime; uniform float uSpeed;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        #include <clipping_planes_fragment>
        float ph = fract((vUv.x - uTime * uSpeed) / 1.6);
        float pulse = smoothstep(0.0, 0.16, ph) * (1.0 - smoothstep(0.3, 0.62, ph));
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
        gl_FragColor = vec4(uColor * (0.6 + 1.2 * pulse + 0.35 * rim), 0.45 + 0.5 * pulse);
      }`,
  });
}

export class Systems {
  /** reg(mesh, partId, opts)：飞机注册函数；engines：两台 Engine（用于挂装发电机） */
  constructor(M, reg, { engines }) {
    this.M = M;
    this.reg = reg;
    this.ext = {}; // 分段 → 外部细节组（随分解视图移动）
    this.dia = {}; // 分段 → 系统示意组（'flow' 为整机流向管）
    this.flowMats = { elec: flowMaterial('#ffd23f'), air: flowMaterial('#5fe6ff'), bleed: flowMaterial('#ff7a3d') };
    this.WF = new WingFrame(0);
    this.buildLights();
    this.buildAntennas();
    this.buildInlets();
    this.buildRAT();
    this.buildEquipment(engines);
    this.buildFlows(engines);
  }

  grp(map, key) {
    if (!map[key]) { map[key] = new THREE.Group(); map[key].name = `systems-${key}`; }
    return map[key];
  }

  /** 外部细节：注册并放入对应分段组 */
  addExt(mesh, sec, id, comp, role = 'skinDetail') {
    this.reg(mesh, id, { comp, section: sec, role });
    this.grp(this.ext, sec).add(mesh);
    return mesh;
  }

  /** 系统示意：仅在系统模式显示 */
  addSys(mesh, sec, id, comp = 'compOther', parent = null) {
    this.reg(mesh, id, { comp, section: sec === 'flow' ? null : sec, role: 'systems' });
    (parent || this.grp(this.dia, sec)).add(mesh);
    return mesh;
  }

  /** 机翼截面中弧线上的点（ξ 弦向比例；dEta 相对弦长的上移量） */
  wm(bl, xi, side, dEta = 0) {
    const f = this.WF.frame(bl);
    return this.WF.toWorld(bl, xi, (AF.upper(xi, f.tc) + AF.lower(xi, f.tc)) / 2 + dEta, side, V(), f);
  }

  // ———————————————— 灯光 ————————————————
  buildLights() {
    const M = this.M;
    const dome = () => { const g = new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(0.13, 0.075, 0.085); return g; };
    const base = () => { const g = new THREE.CylinderGeometry(0.11, 0.125, 0.025, 24); g.scale(1.25, 1, 0.82); g.translate(0, 0.012, 0); return g; };
    // 防撞信标：机背位于中央翼上方，机腹位于翼身整流罩前端
    this.addExt(new THREE.Mesh(placeOnSkin(dome(), 27.6, Math.PI, 0.022), M.beacon), 's44', 'beacon', 'compOther');
    this.addExt(new THREE.Mesh(placeOnSkin(base(), 27.6, Math.PI, 0), M.white), 's44', 'beacon', 'compAl');
    this.addExt(new THREE.Mesh(placeOnSkin(dome(), 19.9, 0, 0.022, fp), M.beacon), 'fairing', 'beacon', 'compOther');
    this.addExt(new THREE.Mesh(placeOnSkin(base(), 19.9, 0, 0, fp), M.white), 'fairing', 'beacon', 'compAl');
    // 着陆灯：翼根前方的透明灯罩（左右各一）
    const lens = [1, -1].map((S) => curvedPatch(fp, 21.2, S * 1.12, 0.24, 0.13, { n: 2.6, extra: 0.012 }));
    const rims = [1, -1].map((S) => lipRing(fp, 21.2, S * 1.12, 0.25, 0.14, { n: 2.6, extra: 0.01, r: 0.012 }));
    this.addExt(new THREE.Mesh(merge(lens), M.landingLens), 'fairing', 'landingLights', 'compGlass');
    this.addExt(new THREE.Mesh(merge(rims), M.wingDark), 'fairing', 'landingLights', 'compAl');
  }

  // ———————————————— 天线 ————————————————
  buildAntennas() {
    const top = Math.PI, bot = 0, by = { s41: [], s43: [], s46: [] };
    const blade = (sec, s, t, L, H, T, sw) => by[sec].push(placeOnSkin(bladeGeometry(L, H, T, sw), s, t, -0.004));
    blade('s41', 7.1, top, 0.2, 0.12, 0.03, 0.4); // 航站楼无线局域网（TWLU，ACAPS 标注）
    blade('s41', 8.3, bot, 0.3, 0.12, 0.035, 0.6); // ATC 应答机
    blade('s41', 9.2, top, 0.42, 0.07, 0.05, 0.6); // TCAS（顶部）
    blade('s41', 10.6, bot, 0.42, 0.07, 0.05, 0.6); // TCAS（底部）
    blade('s43', 15.4, top, 0.38, 0.32, 0.03, 0.7); // VHF 1
    blade('s43', 16.6, bot, 0.38, 0.3, 0.03, 0.7); // VHF 2
    blade('s46', 36.8, top, 0.38, 0.32, 0.03, 0.7); // VHF 3
    for (const dz of [0.32, -0.32]) { // GPS：机背两枚扁平圆盘
      const g = new THREE.CylinderGeometry(0.075, 0.09, 0.025, 20);
      g.translate(0, 0.012, 0);
      const s = 11.2, w = 2.885;
      by.s41.push(placeOnSkin(g, s, Math.PI - Math.asin(dz / w), -0.004));
    }
    for (const [sec, list] of Object.entries(by)) this.addExt(new THREE.Mesh(merge(list), this.M.antenna), sec, 'antennas', 'compGlass');
  }

  // ———————————————— 空调冲压进气口：上方热交换器方口 + 下方压缩机进气斗 ————————————————
  buildInlets() {
    const mouths = [], lips = [];
    for (const f of cacInletFrames()) {
      if (f.kind === 'ram') { // 方形口（近似矩形的超椭圆），唇边较薄
        mouths.push(curvedPatch(fp, f.s, f.t, 0.25, 0.1, { n: 6, extra: 0.006 }));
        lips.push(lipRing(fp, f.s, f.t, 0.25, 0.1, { n: 6, extra: 0.01, r: 0.014 }));
      } else { // 压缩机进气斗：圆角口，唇边加厚、略离开表面
        mouths.push(curvedPatch(fp, f.s, f.t, 0.27, 0.115, { n: 3.2, extra: 0.01 }));
        lips.push(lipRing(fp, f.s, f.t, 0.27, 0.115, { n: 3.2, extra: 0.02, r: 0.026 }));
      }
    }
    this.addExt(new THREE.Mesh(merge(mouths), this.M.blackPaint), 'fairing', 'cac', 'compOther');
    this.addExt(new THREE.Mesh(merge(lips), this.M.wingDark), 'fairing', 'cac', 'compAl');
  }

  // ———————————————— 冲压空气涡轮（右侧整流罩） ————————————————
  buildRAT() {
    const M = this.M;
    const s0 = 35.25, t0 = -0.86, a = 0.8, b = 0.3; // 舱门半长（沿站位）× 半宽（周向弧长）
    const k = arcScale(s0, t0);
    // 舱门：铰链在上缘（右舷 τ 更负 = 更靠上），向外下方打开
    const door = new THREE.Mesh(curvedSlab(fp, s0, t0, a, b, { n: 7, extra: 0.004, thick: 0.032, rings: 5, seg: 56 }), M.panel);
    this.addExt(door, 'fairing', 'ram', 'compCFRP');
    const tTop = t0 - b / k;
    const h0 = fp(s0 - a, tTop, 0.004), h1 = fp(s0 + a, tTop, 0.004);
    door.matrixAutoUpdate = false;
    this.ratDoor = { mesh: door, p: h0, axis: h1.clone().sub(h0).normalize() };
    // 舱体（无盖浅盒，沿表面切平面摆放）
    const n0 = normal(s0, t0, V()), ex = V(1, 0, 0).addScaledVector(n0, -n0.x).normalize(), ey = V().crossVectors(n0, ex);
    const c = fp(s0, t0, -0.235);
    const bayG = tub(2 * a - 0.04, 2 * b - 0.03, 0.46);
    bayG.applyMatrix4(new THREE.Matrix4().makeBasis(ex, ey, n0).setPosition(c));
    const bay = new THREE.Mesh(bayG, M.wellDark);
    bay.visible = false;
    this.addExt(bay, 'fairing', 'ram', 'compOther', 'exterior');
    this.ratBay = bay;
    // 开洞盒（机体系轴对齐）：覆盖舱门在整流罩上的投影
    const sc = fp(s0, t0, 0);
    setHoleBox(RAT_HOLE, sc, V(a - 0.02, Math.abs(ey.y) * b + 0.12 * Math.abs(n0.y) - 0.01, Math.abs(ey.z) * b + 0.12 * Math.abs(n0.z) - 0.01));
    // 涡轮组件：枢轴在舱后上部，支柱向前收起、放出时向下并略向外
    const up = ey.y > 0 ? ey : ey.clone().negate();
    const pivot = c.clone().addScaledVector(ex, a - 0.2).addScaledVector(up, 0.06).addScaledVector(n0, 0.05);
    const arm = new THREE.Group();
    arm.position.copy(pivot);
    const L = 0.95;
    const strutG = new THREE.CylinderGeometry(0.04, 0.05, L, 12);
    strutG.translate(0, -L / 2, 0);
    const podG = new THREE.CapsuleGeometry(0.085, 0.3, 6, 16);
    podG.rotateZ(Math.PI / 2);
    podG.translate(-0.06, -L, 0);
    const parts = [new THREE.Mesh(strutG, M.gear), new THREE.Mesh(podG, M.gear)];
    const hub = new THREE.Group();
    hub.position.set(-0.32, -L, 0);
    const spinG = new THREE.ConeGeometry(0.085, 0.2, 18);
    spinG.rotateZ(Math.PI / 2);
    const spin = new THREE.Mesh(spinG, M.spinner);
    spin.position.x = -0.05;
    hub.add(spin);
    const blades = [];
    for (const sgn of [1, -1]) {
      const bg = new THREE.BoxGeometry(0.018, 0.46, 0.085);
      const p = bg.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.23; p.setZ(i, p.getZ(i) * (1 - 0.45 * (y / 0.46))); } // 叶尖收窄
      bg.computeVertexNormals();
      const bl = new THREE.Mesh(bg, M.fanBlade);
      bl.position.y = sgn * 0.3;
      bl.rotation.set(0, sgn * 0.38, sgn < 0 ? Math.PI : 0);
      hub.add(bl);
      blades.push(bl);
    }
    arm.add(...parts, hub);
    arm.visible = false;
    this.grp(this.ext, 'fairing').add(arm);
    for (const m of [...parts, spin, ...blades]) this.reg(m, 'ram', { comp: 'compAl', section: 'fairing', role: 'exterior' });
    this.rat = { arm, hub, v: -1, spin: 0 };
    this.setRAT(0);
  }

  /** RAT 放出进度 0..1：先开舱门，再摆出涡轮 */
  setRAT(v) {
    const R = this.rat, D = this.ratDoor;
    if (v === R.v) return;
    R.v = v;
    const door = smoothstep(0, 0.3, v), swing = smoothstep(0.25, 1, v);
    const m = D.mesh.matrix.makeRotationAxis(D.axis, door * 1.45);
    const rp = D.p.clone().applyMatrix4(m);
    m.setPosition(D.p.x - rp.x, D.p.y - rp.y, D.p.z - rp.z);
    D.mesh.matrixWorldNeedsUpdate = true;
    R.arm.rotation.set(0.42 * swing, 0, -1.5 * (1 - swing));
    R.arm.visible = v > 0.22;
    this.ratBay.visible = v > 0.005;
    HOLES.on[RAT_HOLE] = v > 0.005 ? 1 : 0;
  }

  // ———————————————— 系统设备 ————————————————
  buildEquipment(engines) {
    const M = this.M;
    const rbox = (sz, c, r = 0.04) => { const g = new RoundedBoxGeometry(sz[0], sz[1], sz[2], 2, r); g.translate(c.x, c.y, c.z); return g; };
    // 前电子电气设备舱：前轮舱之后、客舱地板下（左右两排机柜，中间通道）
    const fwd = V(6.65, hb + 0.95, 0), aft = V(33.2, hb + 1.1, 0);
    const racks = (c, len, h, sec) => {
      const g = [], fronts = [];
      for (const S of [1, -1]) {
        g.push(rbox([len, h, 0.55], V(c.x, c.y, S * 0.6), 0.03));
        fronts.push(rbox([0.03, h * 0.82, 0.48], V(c.x - len / 2 - 0.012, c.y, S * 0.6), 0.01));
      }
      this.addSys(new THREE.Mesh(merge(g), M.sysRack), sec, 'eeBay');
      this.addSys(new THREE.Mesh(merge(fronts), M.sysElec), sec, 'eeBay');
    };
    racks(fwd, 0.8, 1.1, 's41');
    racks(aft, 0.6, 1.2, 's46');
    // 锂离子电池：主电池（前 E/E 舱）、APU 电池（后 E/E 舱）
    this.addSys(new THREE.Mesh(rbox([0.34, 0.22, 0.27], V(6.95, hb + 0.53, 0.98), 0.02), M.sysBattery), 's41', 'battery');
    this.addSys(new THREE.Mesh(rbox([0.34, 0.22, 0.27], V(33.25, hb + 0.6, -1.05), 0.02), M.sysBattery), 's46', 'battery');
    // 电动座舱空气压缩机（4 台）：中央翼盒下方前部，左右各两台串列
    const cacG = [];
    for (const S of [1, -1]) {
      for (const s of [22.4, 23.4]) {
        cacG.push(cylX(0.15, 0.42, V(s + 0.04, 2.0, S * 0.72)));
        const vol = new THREE.TorusGeometry(0.115, 0.05, 10, 24); // 压气机蜗壳
        vol.rotateY(Math.PI / 2);
        vol.translate(s - 0.2, 2.0, S * 0.72);
        cacG.push(vol);
      }
    }
    this.addSys(new THREE.Mesh(merge(cacG), M.sysAir), 'fairing', 'cacUnit');
    // 空调组件（2 套）：压缩机之后、整流罩内龙骨梁两侧
    const packs = [1, -1].map((S) => rbox([1.6, 0.36, 0.7], V(25.4, 1.92, S * 0.62), 0.06));
    this.addSys(new THREE.Mesh(merge(packs), M.sysAir), 'fairing', 'packs');
    // 发动机：核心机下方的附件齿轮箱 + 两台变频起动发电机（局部坐标，随发动机移动）
    for (const e of engines) {
      this.addSys(new THREE.Mesh(rbox([1.0, 0.12, 0.62], V(3.55, -0.6, 0), 0.03), M.sysRack), 'engine', 'agb', 'compAl', e.group);
      const gens = [0.2, -0.2].map((dz) => cylX(0.11, 0.4, V(3.62, -0.72, dz), 18));
      this.addSys(new THREE.Mesh(merge(gens), M.sysElec), 'engine', 'vfsg', 'compOther', e.group);
    }
    // APU（尾锥内）及其两台起动发电机、排气管
    this.grp(this.dia, 'tailcone').userData.section = 'tailcone';
    const body = new THREE.CapsuleGeometry(0.34, 1.9, 8, 24);
    body.rotateZ(Math.PI / 2);
    body.translate(58.55, 5.45, 0);
    const exhaust = new THREE.CylinderGeometry(0.15, 0.19, 2.5, 18);
    exhaust.rotateZ(Math.PI / 2 + Math.atan2(0.11, 2.5));
    exhaust.translate(61.05, 5.5, 0);
    this.addSys(new THREE.Mesh(merge([body, exhaust]), M.sysRack), 'tailcone', 'apu', 'compTi');
    this.addSys(new THREE.Mesh(merge([0.26, -0.26].map((dz) => cylX(0.12, 0.32, V(57.15, 5.2, dz), 18))), M.sysElec), 'tailcone', 'asg');
  }

  // ———————————————— 能量流 ————————————————
  buildFlows(engines) {
    const elec = [], air = [], bleed = [];
    const E = (pts) => elec.push(flowTube(pts, 0.045));
    const A = (pts) => air.push(flowTube(pts, 0.075));
    const wm = (bl, xi, S, d) => this.wm(bl, xi, S, d);
    for (const e of engines) {
      const S = e.side, E0 = e.group.position.clone();
      const L = (x, y, z) => V(E0.x + x, E0.y + y, E0.z + z);
      // 发电机 → 绕核心机至上分叉面 → 吊挂 → 前梁 → 中央翼盒 → 后 E/E 舱（主电源馈线）
      E([L(3.55, -0.62, 0), L(3.66, -0.55, -S * 0.42), L(3.76, -0.05, -S * 0.8), L(3.84, 0.5, -S * 0.6), L(3.86, 0.82, -S * 0.1),
        L(3.7, 1.5, 0), L(3.3, 2.1, 0), wm(9.6, 0.15, S), wm(7.0, 0.15, S), wm(4.6, 0.15, S), wm(3.0, 0.16, S),
        V(23.4, 3.15, S * 1.8), V(28.2, 3.15, S * 1.6), V(29.4, 2.95, S * 0.9), V(31.4, 2.75, S * 0.35), V(32.85, 2.85, S * 0.45)]);
      // 后 E/E 舱 → 电动座舱空气压缩机（沿压缩机顶部的母线）
      E([V(32.85, 2.45, S * 0.3), V(31.6, 2.1, S * 0.2), V(28.5, 2.02, S * 0.19), V(24.4, 2.0, S * 0.19), V(23.75, 2.12, S * 0.5),
        V(23.45, 2.2, S * 0.72), V(22.4, 2.22, S * 0.72)]);
      // 机翼电加热防冰：沿外侧缝翼
      E([V(23.6, 3.27, S * 1.9), wm(3.2, 0.14, S, 0.015), wm(7.5, 0.13, S, 0.012), wm(10.2, 0.11, S, 0.01), wm(10.8, 0.035, S),
        wm(16, 0.03, S), wm(22, 0.03, S), wm(27.1, 0.03, S)]);
      // 电刹车：后 E/E 舱 → 主起落架
      E([V(33.1, 2.6, S * 0.7), V(32.4, 3.0, S * 2.0), V(31.2, 3.55, S * 3.6), V(30.9, 3.75, S * 4.6)]);
      // 压缩机进气斗 → 分两路进入两台压缩机前端（上方热交换器冲压空气只用于冷却、不进客舱，不画）
      for (const q of cacInletFrames().filter((f) => f.side === S && f.kind === 'cac')) {
        const start = q.p.clone().addScaledVector(q.n, -0.05);
        A([start, V(22.4, 2.62, S * 1.62), V(22.2, 2.15, S * 0.95), V(22.12, 2.0, S * 0.72)]);
        A([start, V(22.55, 2.6, S * 1.6), V(23.1, 2.32, S * 1.12), V(23.12, 2.0, S * 0.72)]);
      }
      // 压缩机 → 空调组件
      A([V(23.68, 2.0, S * 0.72), V(24.2, 1.97, S * 0.7), V(24.62, 1.92, S * 0.72)]);
      A([V(22.68, 2.0, S * 0.72), V(22.95, 1.95, S * 0.44), V(24.2, 1.93, S * 0.42), V(24.62, 1.9, S * 0.45)]);
      // 空调组件 → 后梁之后沿侧壁上行 → 客舱顶部送风总管（前后两路）
      A([V(26.22, 1.95, S * 0.62), V(27.0, 2.02, S * 0.45), V(28.85, 2.2, S * 0.5), V(29.05, 3.0, S * 1.9), V(29.15, 4.4, S * 2.5),
        V(29.2, 5.7, S * 2.6), V(29.2, 6.6, S * 2.05), V(29.0, CEIL, S * 0.9)]);
      A([V(29.0, CEIL, S * 0.9), V(28.4, CEIL, S * 0.55), V(20, CEIL, S * 0.55), V(8.6, CEIL, S * 0.55)]);
      A([V(29.0, CEIL, S * 0.9), V(29.6, CEIL, S * 0.55), V(40, CEIL, S * 0.55), V(50.3, CEIL - 0.07, S * 0.55)]);
      // 发动机进气道防冰：787 保留的两项引气用途之一（另一项为液压油箱增压，未画） —— 高压压气机引气 → 上分叉面 → 风扇整流罩内 → 唇口环形腔
      bleed.push(flowTube([L(3.35, 0.84, 0), L(3.55, 1.5, 0), L(3.15, 1.7, 0), L(2.0, 1.68, 0), L(0.75, 1.62, 0), L(0.24, 1.575, 0)], 0.04));
      const ring = [];
      for (let j = 0; j < 48; j++) { const ph = (j / 48) * Math.PI * 2; ring.push(L(0.2, 1.57 * Math.cos(ph), 1.57 * Math.sin(ph))); }
      bleed.push(flowTube(ring, 0.03, true));
    }
    // APU 起动发电机 → 后 E/E 舱
    E([V(57.15, 5.2, 0), V(55.6, 4.95, 0.25), V(52.6, 4.4, 0.3), V(50.5, 3.6, 0.35), V(47, 2.6, 0.38), V(40, 2.15, 0.35), V(35, 2.2, 0.3), V(33.55, 2.55, 0.15)]);
    // 后 E/E 舱 → 前 E/E 舱（主配电干线，沿机腹）
    E([V(32.85, 2.3, -0.15), V(31.5, 2.06, -0.02), V(26, 2.06, 0), V(22, 2.08, 0), V(18, 2.1, 0), V(12, 2.1, 0), V(8.2, 2.2, 0), V(7.1, 2.45, 0)]);
    this.addSys(new THREE.Mesh(merge(elec), this.flowMats.elec), 'flow', 'flowElec');
    this.addSys(new THREE.Mesh(merge(air), this.flowMats.air), 'flow', 'flowAir');
    this.addSys(new THREE.Mesh(merge(bleed), this.flowMats.bleed), 'flow', 'flowBleed');
    for (const m of this.grp(this.dia, 'flow').children) m.renderOrder = 3;
  }

  /** 机翼弯曲后重建能量流：沿机翼与吊挂的管路需跟随新的翼面和发动机位置 */
  rebuildFlows(engines, flex, unreg) {
    const g = this.grp(this.dia, 'flow');
    for (const m of [...g.children]) { unreg(m); m.removeFromParent(); m.geometry.dispose(); }
    this.WF = new WingFrame(flex);
    this.buildFlows(engines);
  }

  tick(dt) {
    for (const m of Object.values(this.flowMats)) m.uniforms.uTime.value += dt;
    const R = this.rat;
    if (R.v > 0.6) { R.spin += dt * 16 * smoothstep(0.6, 1, R.v); R.hub.rotation.x = R.spin; }
  }
}
