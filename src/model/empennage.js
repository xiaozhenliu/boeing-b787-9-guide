// 尾翼：垂直安定面（含背鳍）+ 方向舵、水平安定面（可配平）+ 升降舵、APU 排气口与进气门、尾锥灯
// 787 尾翼主体为碳纤维复合材料（CFRP）结构；水平安定面整体偏转用于俯仰配平。
// 787-9 垂尾前缘采用混合层流控制（HLFC）：前缘蒙皮布满微孔，抽吸边界层以延长层流区。
import * as THREE from 'three';
import { VTAIL, HTAIL, G, FUS_AXIS } from './spec.js';
import { SYMMETRIC as AF } from '../geom/airfoil.js';
import { loftSolid, merge, grid, capPolygon } from '../geom/build.js';
import { Hinge } from './wing.js';
import { DEG, lerp, clamp } from '../core/math.js';
import { section, point } from './fuselage.js';

const up = (x, t) => [x, AF.upper(x, t)];
const lo = (x, t) => [x, AF.lower(x, t)];

function surf(fn, a, b, n, t, mode) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    let f = u;
    if (mode === 'le') f = 1 - Math.cos((Math.PI / 2) * u);
    if (mode === 'leRev') f = Math.sin((Math.PI / 2) * u);
    out.push(fn(a + (b - a) * f, t));
  }
  return out;
}
function closure(p0, p1, bulge, n) {
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  let nx = -(p1[1] - p0[1]), ny = p1[0] - p0[0];
  const l = Math.hypot(nx, ny) || 1;
  nx /= l; ny /= l;
  if (nx > 0) { nx = -nx; ny = -ny; }
  const cx = mx + nx * bulge, cy = my + ny * bulge;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * cx + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * cy + t * t * p1[1]]);
  }
  return pts;
}

/** 固定段截面（含前缘，后部为凹形舵面槽） */
function fixedLoop(t, xd) {
  const u = surf(up, xd, 0, 30, t, 'leRev');
  const l = surf(lo, 0, xd, 30, t, 'le');
  return [u.concat(l.slice(1)), closure(lo(xd, t), up(xd, t), 0.03, 8)];
}
/** 舵面截面（圆鼻 + 尖后缘） */
function surfaceLoop(t, xd) {
  const x0 = xd + 0.008;
  const u = surf(up, 1, x0, 18, t, 'leRev');
  const nose = closure(up(x0, t), lo(x0, t), 0.024, 10);
  const l = surf(lo, x0, 1, 18, t);
  return [u, nose, l, [lo(1, t), up(1, t)]];
}
/** 完整截面 */
function fullLoop(t) {
  const u = surf(up, 1, 0, 34, t, 'leRev');
  const l = surf(lo, 0, 1, 34, t, 'le');
  return [u.concat(l.slice(1)), [lo(1, t), up(1, t)]];
}

/** 通用升力面框架：e 为展向参数，le(e)、chord(e)、厚度方向 nrm(e)；rise(e) 使弦线后端抬高（翼尖斜切） */
class Surface {
  constructor({ le, chord, nrm, tc, uv, rise = null }) { Object.assign(this, { le, chord, nrm, tc, uv, rise }); }
  toWorld(e, xi, eta, out = new THREE.Vector3()) {
    const c = this.chord(e);
    const dy = this.rise ? xi * this.rise(e) : 0;
    return out.copy(this.le(e)).add(new THREE.Vector3(xi * c, dy, 0)).addScaledVector(this.nrm(e), eta * c);
  }
  loft(e0, e1, n, loopFn, opts = {}) {
    const es = Array.from({ length: n + 1 }, (_, i) => e0 + ((e1 - e0) * i) / n);
    const st = es.map((e) => loopFn(e, this.tc(e)).map((seg) => seg.map(([xi, eta]) => this.toWorld(e, xi, eta))));
    const uvFn = this.uv;
    return loftSolid(st, {
      ...opts,
      uvScale: uvFn ? (i, k, j) => {
        const e = es[i];
        const p = st[i][k][j];
        const xi = clamp((p.x - this.le(e).x) / this.chord(e), 0, 1);
        const side = p.clone().sub(this.le(e)).dot(this.nrm(e)) >= 0 ? 1 : -1;
        return uvFn(e, xi, side);
      } : null,
    });
  }
}

// ———————— 垂尾几何（侧视真实外形）————————
const V = VTAIL;
export const FIN = (() => {
  const zTop = V.zTip - V.tipRise / 2; // 翼尖前缘角高度（相对机身轴线）
  const Hf = zTop - V.zRoot;
  const zAt = (e) => V.zRoot + e * Hf;
  const eMin = (1.48 - V.zRoot) / Hf; // 向下延伸埋入机身，保证与尾锥干净相交
  const R_LE = 0.5, E_R = 1 - 0.65 / Hf; // 翼尖前缘圆角
  const leShift = (e) => {
    if (e <= E_R) return 0;
    const u = Math.min(1, (e - E_R) / (1 - E_R));
    return R_LE * (1 - Math.sqrt(1 - u * u));
  };
  const leX = (e) => V.finLE(zAt(e)) + leShift(e);
  const chord = (e) => V.finTE(zAt(e)) - leX(e);
  // 背鳍前缘：二次贝塞尔 P0(s0,z0) → P1(前缘@z0, z0) → P2(前缘@z1, z1)，两端分别与机身顶线、垂尾前缘相切
  const F = V.fillet;
  const filletX = (z) => {
    if (z >= F.z1) return null;
    if (z <= F.z0) return F.s0;
    const t = Math.sqrt((z - F.z0) / (F.z1 - F.z0));
    const p1 = V.finLE(F.z0), p2 = V.finLE(F.z1);
    return (1 - t) ** 2 * F.s0 + 2 * (1 - t) * t * p1 + t * t * p2;
  };
  const xsAt = (e) => { const xf = filletX(zAt(e)); return xf == null ? 0 : Math.min(0, (xf - leX(e)) / chord(e)); };
  // 方向舵铰链：按未修圆的真实弦长取 (1 − rudderFrac) 处，保证铰链轴为直线
  const xdAt = (e) => {
    const z = zAt(e);
    const xh = V.finLE(z) + (1 - V.rudderFrac) * (V.finTE(z) - V.finLE(z));
    return (xh - leX(e)) / chord(e);
  };
  return { zTop, Hf, zAt, eMin, leX, chord, xsAt, xdAt, filletX };
})();

const WF = 0.085; // 背鳍半厚（米）：背鳍是薄整流片，不改变垂尾主翼型
/** 带背鳍的半厚度分布（归一化）：翼型厚度与背鳍薄片取光滑最大值 */
function finHalfT(xi, tc, xs, c) {
  const a = xi > 0 ? AF.upper(Math.min(xi, 1), tc) : 0;
  if (xs >= -1e-6) return a;
  const u = clamp(((xi - xs) * c) / 0.55, 0, 1);
  const b = (WF / c) * Math.sqrt(1 - (1 - u) ** 2);
  return Math.pow(a ** 6 + b ** 6, 1 / 6);
}
const NFIN = 44;
function finSide(e, tc, x1, sgn) {
  const xs = FIN.xsAt(e), c = FIN.chord(e);
  const pts = [];
  for (let i = 0; i <= NFIN; i++) {
    const g = 1 - Math.cos((Math.PI / 2) * (i / NFIN));
    const xi = xs + (x1 - xs) * g;
    pts.push([xi, sgn * finHalfT(xi, tc, xs, c)]);
  }
  return pts;
}
function finFullLoop(e, tc) {
  const u = finSide(e, tc, 1, 1).reverse();
  const l = finSide(e, tc, 1, -1);
  return [u.concat(l.slice(1)), [l[l.length - 1], u[0]]];
}
function finFixedLoop(e, tc) {
  const xd = FIN.xdAt(e);
  const u = finSide(e, tc, xd, 1).reverse();
  const l = finSide(e, tc, xd, -1);
  return [u.concat(l.slice(1)), closure(l[l.length - 1], u[0], 0.03, 8)];
}

export class Empennage {
  constructor(M, register) {
    this.M = M;
    this.register = register;
    this.group = new THREE.Group();
    this.group.name = 'empennage';
    this.structGroup = new THREE.Group();
    this.structGroup.name = 'tailStructure';
    this.hinges = {};
    this.build();
  }

  build() {
    const M = this.M, reg = this.register;
    // ———— 垂直安定面 ————
    const fin = new Surface({
      le: (e) => new THREE.Vector3(FIN.leX(e), FUS_AXIS + FIN.zAt(e), 0),
      chord: FIN.chord,
      nrm: () => new THREE.Vector3(0, 0, 1),
      tc: (e) => lerp(V.tc, V.tc * 0.92, clamp(e, 0, 1)),
      rise: (e) => V.tipRise * Math.max(0, e),
      uv: (e, xi, side) => [side > 0 ? 0.5 * xi : 1 - 0.5 * xi, e],
    });
    this.fin = fin;
    // 方向舵：下端离尾锥顶线约 0.1 m，上端止于翼尖圆角之下
    const eR0 = (2.4 - V.zRoot) / FIN.Hf, eR1 = 1 - 0.3 / FIN.Hf;
    const finParts = [
      fin.loft(FIN.eMin, eR0, 22, finFullLoop),
      fin.loft(eR0, eR1, 26, finFixedLoop, { capStart: false, capEnd: false }),
      fin.loft(eR1, 1, 5, finFullLoop),
    ];
    const finMesh = new THREE.Mesh(merge(finParts), M.tail);
    reg(finMesh, 'vtail', { comp: 'compCFRP', section: 'empennage', role: 'skin' });
    this.group.add(finMesh);

    const rudder = new THREE.Mesh(fin.loft(eR0 + 0.003, eR1 - 0.003, 26, (e, t) => surfaceLoop(t, FIN.xdAt(e))), M.tail);
    reg(rudder, 'rudder', { comp: 'compCFRP', section: 'empennage', role: 'skin' });
    this.group.add(rudder);
    const rp0 = fin.toWorld(eR0, FIN.xdAt(eR0) + 0.03, 0), rp1 = fin.toWorld(eR1, FIN.xdAt(eR1) + 0.03, 0);
    this.hinges.rudder = new Hinge(rudder, rp0, rp1.clone().sub(rp0));
    // 方向舵铰链轴向上（a.y>0）：绕 +y 正转时后缘偏向右舷
    if (this.hinges.rudder.a.y < 0) this.hinges.rudder.a.negate();
    this.rudderSpan = [eR0, eR1];

    // ———— 水平安定面（左右两侧 + 中央段），整体绕枢轴配平 ————
    const H = HTAIL;
    const stab = new THREE.Group();
    stab.name = 'stabilizer';
    this.group.add(stab);
    this.stab = stab;
    const tanS = Math.tan(H.sweepLE * DEG), tanD = Math.tan(H.dihedral * DEG);
    const xe = 1 - H.elevFrac;
    this.hs = [];
    for (const side of [1, -1]) {
      const hs = new Surface({
        le: (e) => { const y = e * H.semiSpan; return new THREE.Vector3(H.rootLE + y * tanS, H.rootH + y * tanD, side * y); },
        chord: (e) => lerp(H.rootChord, H.tipChord, e),
        nrm: () => new THREE.Vector3(0, Math.cos(H.dihedral * DEG), -side * Math.sin(H.dihedral * DEG)),
        tc: (e) => lerp(H.tc, H.tc * 0.85, e),
        uv: null,
      });
      this.hs.push(hs);
      const eE0 = 1.5 / H.semiSpan, eE1 = 0.965;
      const parts = [
        hs.loft(0, eE0, 3, (e, t) => fullLoop(t)),
        hs.loft(eE0, eE1, 18, (e, t) => fixedLoop(t, xe), { capStart: false, capEnd: false }),
        hs.loft(eE1, 1, 1, (e, t) => fullLoop(t)),
      ];
      const m = new THREE.Mesh(merge(parts), M.wing);
      reg(m, 'htail', { comp: 'compCFRP', section: 'empennage', role: 'skin' });
      stab.add(m);
      const el = new THREE.Mesh(hs.loft(eE0 + 0.003, eE1 - 0.003, 18, (e, t) => surfaceLoop(t, xe)), M.wing);
      reg(el, 'elevator', { comp: 'compCFRP', section: 'empennage', role: 'skin' });
      stab.add(el);
      const p0 = hs.toWorld(eE0, xe + 0.03, 0), p1 = hs.toWorld(eE1, xe + 0.03, 0);
      this.hinges[side > 0 ? 'elevL' : 'elevR'] = new Hinge(el, p0, p1.clone().sub(p0));
      // 静电放电刷
      const wick = [];
      for (const e of [0.72, 0.86, 0.99]) {
        const a = hs.toWorld(e, 0.99, 0), b = a.clone().add(new THREE.Vector3(0.2, -0.008, 0));
        const g = new THREE.CylinderGeometry(0.005, 0.008, a.distanceTo(b), 6);
        g.rotateZ(Math.PI / 2);
        g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        wick.push(g);
      }
      const wm = new THREE.Mesh(merge(wick), M.blackPaint);
      reg(wm, 'elevator', { comp: 'compOther', section: 'empennage', role: 'skinDetail' });
      el.add(wm);
      // 标志灯（安定面上表面外侧，向内照亮垂尾涂装）
      const lp = hs.toWorld(0.82, 0.18, AF.upper(0.18, hs.tc(0.82)) + 0.004);
      const logo = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), M.lightWhite);
      logo.position.copy(lp);
      reg(logo, 'navLights', { comp: 'compOther', section: 'empennage', role: 'skinDetail' });
      stab.add(logo);
    }
    // 配平枢轴：位于安定面中央翼盒后梁附近（s≈56.5）
    const pivot = new THREE.Vector3(H.rootLE + 0.62 * H.rootChord, H.rootH, 0);
    this.hinges.stab = new Hinge(stab, pivot, new THREE.Vector3(0, 0, 1));
    this.stabPivot = pivot;

    this.buildAPU();
    this.buildStructure();
  }

  /** APU 排气口（尾锥末端 0.74×0.5 m 椭圆口）、APU 进气门（尾锥右上侧）、尾锥航行灯/频闪灯 */
  buildAPU() {
    const M = this.M, reg = this.register;
    const L = G.L;
    const sec = section(L);
    const c = new THREE.Vector3(L, sec.zw, 0);
    const NT = 64;
    const ring = (s, k) => (j, out) => {
      point(L, (j / NT) * Math.PI * 2, out);
      out.set(s, c.y + (out.y - c.y) * k, out.z * k);
      return out;
    };
    // 薄唇口（约 1 cm 厚的耐热合金喷口）+ 向内收的排气管道；管道深处为黑色
    const rings = [ring(L - 0.015, 1.006), ring(L + 0.008, 0.985), ring(L + 0.01, 0.955), ring(L - 0.02, 0.94), ring(L - 0.5, 0.88)];
    const lip = grid(4, NT, (i, j, out) => rings[i](j, out), { closeCols: true });
    const duct = grid(2, NT, (i, j, out) => rings[i + 3](j, out), { closeCols: true });
    const capPts = Array.from({ length: NT }, (_, j) => rings[4](j, new THREE.Vector3()));
    const cap = capPolygon(capPts, new THREE.Vector3(1, 0, 0));
    const exMesh = new THREE.Mesh(merge([lip, duct]), M.darkMetal);
    reg(exMesh, 'apu', { comp: 'compTi', section: 'tailcone', role: 'skinDetail' });
    const capMesh = new THREE.Mesh(cap, M.blackPaint);
    reg(capMesh, 'apu', { comp: 'compTi', section: 'tailcone', role: 'skinDetail' });
    this.group.add(exMesh, capMesh);

    // APU 进气门：右舷上侧、方向舵后缘正下方附近；后缘铰接，前缘外翻形成冲压进气斗
    const sD = 59.0;
    const qs = section(sD);
    const hD = qs.zw + 0.62 * (qs.zt - qs.zw);
    const corner = (ds, dh) => {
      const s = sD + ds;
      const q = section(s);
      const h = hD + dh;
      const ct = clamp((h - q.zw) / (q.zt - q.zw), 0, 1);
      const t = 2 * Math.PI - Math.acos(-ct);
      return point(s, t, new THREE.Vector3());
    };
    const nu = 8, nv = 6;
    const doorG = grid(nu + 1, nv + 1, (i, j, out) => {
      const p = corner(-0.3 + 0.6 * (i / nu), -0.2 + 0.4 * (j / nv));
      const n = new THREE.Vector3(0, p.y - qs.zw, p.z).normalize();
      out.copy(p).addScaledVector(n, 0.012);
    });
    // 绕序校正：法线朝外（右舷外侧 −z）
    const nz = doorG.attributes.normal.getZ(Math.floor(doorG.attributes.normal.count / 2));
    if (nz > 0) { const I = doorG.index; for (let k = 0; k < I.count; k += 3) { const x = I.getX(k + 1); I.setX(k + 1, I.getX(k + 2)); I.setX(k + 2, x); } doorG.computeVertexNormals(); }
    const door = new THREE.Mesh(doorG, M.paint);
    reg(door, 'apuDoor', { comp: 'compCFRP', section: 'tailcone', role: 'skinDetail' });
    this.group.add(door);
    const h0 = corner(0.3, -0.2), h1 = corner(0.3, 0.2);
    this.hinges.apuDoor = new Hinge(door, h0, h1.clone().sub(h0));
    this.apuDoorSign = -1; // 铰链轴 a=(0,+,+)：负角使前缘向右舷外侧翻出

    // 尾锥：两侧白色航行灯 + 顶部白色频闪灯
    const lights = [];
    for (const side of [1, -1]) {
      const p = point(61.0, side > 0 ? Math.PI / 2 : Math.PI * 1.5, new THREE.Vector3());
      p.z += side * 0.03;
      lights.push(p);
    }
    const strobe = point(61.4, Math.PI, new THREE.Vector3());
    strobe.y += 0.03;
    lights.push(strobe);
    lights.forEach((p, k) => {
      const isStrobe = k === lights.length - 1;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), isStrobe ? M.strobe || M.lightWhite : M.lightWhite);
      m.position.copy(p);
      reg(m, isStrobe ? 'strobes' : 'navLights', { comp: 'compOther', section: 'tailcone', role: 'skinDetail' });
      this.group.add(m);
    });
    this.tailLights = lights;
  }

  buildStructure() {
    const M = this.M, reg = this.register;
    const g = this.structGroup;
    const sparGeo = (surface, xi, e0, e1) => surface.loft(e0, e1, 6, (e, t) => {
      const d = 0.018 / surface.chord(e);
      const u = AF.upper(xi, t) - 0.004, l = AF.lower(xi, t) + 0.004;
      return [[[xi - d, u], [xi - d, l]], [[xi - d, l], [xi + d, l]], [[xi + d, l], [xi + d, u]], [[xi + d, u], [xi - d, u]]];
    });
    const ribGeo = (surface, e, xa, xb) => {
      const loop = (de) => {
        const ee = e + de;
        const t = surface.tc(ee);
        const n = 10;
        const upper = [], lower = [];
        for (let i = 0; i <= n; i++) {
          const xi = xa + ((xb - xa) * i) / n;
          upper.push(surface.toWorld(ee, xi, AF.upper(xi, t) - 0.004));
          lower.push(surface.toWorld(ee, xb - ((xb - xa) * i) / n, AF.lower(xb - ((xb - xa) * i) / n, t) + 0.004));
        }
        return [upper, [upper[n], lower[0]], lower, [lower[n], upper[0]]];
      };
      return loftSolid([loop(-0.0012), loop(0.0012)]);
    };
    const spars = [], ribs = [];
    spars.push(sparGeo(this.fin, 0.15, -0.05, 0.98), sparGeo(this.fin, 0.62, -0.05, 0.98));
    for (let e = 0.0; e <= 0.96; e += 0.065) ribs.push(ribGeo(this.fin, e, 0.15, 0.62));
    for (const hs of this.hs) {
      spars.push(sparGeo(hs, 0.14, 0, 0.98), sparGeo(hs, 0.66, 0, 0.98));
      for (let e = 0.2; e <= 0.97; e += 0.075) ribs.push(ribGeo(hs, e, 0.14, 0.66));
    }
    const sm = new THREE.Mesh(merge(spars), M.sSpar);
    const rm = new THREE.Mesh(merge(ribs), M.sRib);
    reg(sm, 'tailSpars', { comp: 'compCFRP', section: 'empennage', role: 'structure' });
    reg(rm, 'tailRibs', { comp: 'compCFRP', section: 'empennage', role: 'structure' });
    g.add(sm, rm);
  }

  /** 舵面状态（度）：rudder 正 = 后缘偏向左舷（机头左偏）；elevator 正 = 后缘上偏（抬头）；stab 正 = 前缘下偏（抬头配平）；apuDoor 0..1 */
  apply({ rudder = 0, elevator = 0, stab = 0, apuDoor = 0 } = {}) {
    this.hinges.rudder.set(-rudder * DEG);
    this.hinges.elevL.set(elevator * DEG);
    this.hinges.elevR.set(elevator * DEG);
    this.hinges.stab.set(stab * DEG);
    this.hinges.apuDoor.set(this.apuDoorSign * apuDoor * 28 * DEG);
  }
}
