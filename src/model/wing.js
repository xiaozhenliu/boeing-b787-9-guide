// 主翼：超临界翼型放样 + 可动翼面（缝翼、克鲁格襟翼、内/外襟翼、襟副翼、副翼、扰流板）
// 可动翼面均为刚体，绕真实铰链轴（三维直线）旋转；机翼弯曲变形通过重建几何实现。
import * as THREE from 'three';
import { WING } from './spec.js';
import { SUPERCRITICAL as AF } from '../geom/airfoil.js';
import { loftSolid, merge, boxBetween } from '../geom/build.js';
import { clamp, lerp, DEG, mergeStations, smoothstep } from '../core/math.js';

const SPAN = WING.semiSpan;
const Y_SOB = WING.breaks[1].y; // 机身侧边
const TAN_DIH = Math.tan(WING.dihedral * DEG);

// ———————————————— 平面形状与坐标框架 ————————————————
export function planform(y) {
  const B = WING.breaks;
  y = clamp(y, 0, SPAN);
  let i = 0;
  while (i < B.length - 2 && y > B[i + 1].y) i++;
  const a = B[i], b = B[i + 1];
  const t = (y - a.y) / (b.y - a.y);
  return { xLE: lerp(a.xLE, b.xLE, t), c: lerp(a.c, b.c, t), tc: lerp(a.tc, b.tc, t), tw: lerp(a.tw, b.tw, t) };
}

/** 均布载荷悬臂梁挠度形状 g(η)=η²(6−4η+η²)/3，g(1)=1 */
function flexShape(y) {
  const L = SPAN - Y_SOB;
  const e = clamp((y - Y_SOB) / L, 0, 1);
  const g = (e * e * (6 - 4 * e + e * e)) / 3;
  const dg = ((12 * e - 12 * e * e + 4 * e * e * e) / 3) / L;
  return [g, y < Y_SOB ? 0 : dg];
}

export class WingFrame {
  constructor(flex = 0) { this.flex = flex; } // flex：翼尖上弯量（米）
  frame(y) {
    const p = planform(y);
    const [g, dg] = flexShape(y);
    p.h = WING.hRoot + y * TAN_DIH + this.flex * g;
    p.gamma = Math.atan(TAN_DIH + this.flex * dg); // 当地上反角（含弯曲）
    return p;
  }
  /** 截面局部归一化坐标 (ξ, η)（以弦长为单位）→ 三维；side=+1 左翼，-1 右翼 */
  toWorld(y, xi, eta, side, out = new THREE.Vector3(), f = this.frame(y)) {
    const th = f.tw * DEG;
    const x = xi * f.c, v = eta * f.c;
    const xr = x * Math.cos(th) + v * Math.sin(th);
    const vr = -x * Math.sin(th) + v * Math.cos(th);
    out.set(f.xLE + xr, f.h + vr * Math.cos(f.gamma), side * (y - vr * Math.sin(f.gamma)));
    return out;
  }
}

// ———————————————— 翼面布局（左翼；右翼镜像） ————————————————
const EY = WING.engineY;
export const LAYOUT = {
  // 前缘缝翼：每侧 6 块（内侧 1 块 + 发动机外侧 5 块）；cu/cl 为缝翼在上/下表面覆盖的弦长比例
  slats: (() => {
    const list = [{ id: 'slat1', y0: 3.55, y1: 8.3, cu: 0.14, cl: 0.075 }];
    const a = 10.45, b = 27.4, n = 5, gap = 0.05;
    const w = (b - a - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) list.push({ id: `slat${i + 2}`, y0: a + i * (w + gap), y1: a + i * (w + gap) + w, cu: 0.14, cl: 0.075 });
    return list;
  })(),
  // 克鲁格密封襟翼：内侧缝翼与发动机吊挂之间（宽约 23 in），自下表面向前下方翻出
  krueger: { id: 'krueger', y0: 8.34, y1: 8.92, x0: 0.016, x1: 0.12 },
  // 后缘装置：chord0/chord1 为装置弦长（米），在两端之间线性变化 → 铰链线为直线。
  // 襟副翼位于发动机正后方、止于后缘转折处（BL 11.08），外襟翼自转折处起
  te: [
    { id: 'flapIn', type: 'flap', y0: 3.0, y1: 9.0, chord0: 2.7, chord1: 2.3 },
    { id: 'flaperon', type: 'flaperon', y0: 9.05, y1: 11.08, chord0: 1.9, chord1: 1.76 },
    { id: 'flapOut', type: 'flap', y0: 11.13, y1: 21.4, chord0: 1.76, chord1: 1.05 },
    { id: 'aileron', type: 'aileron', y0: 21.45, y1: 26.0, chord0: 1.0, chord1: 0.7 },
  ],
  // 扰流板：每侧 7 块（内襟翼上方 3 块、外襟翼上方 4 块）；chordM 为板弦长（米）
  spoilers: [
    [3.2, 5.1, 1.25], [5.15, 7.05, 1.18], [7.1, 8.95, 1.1],
    [11.55, 13.95, 0.98], [14.0, 16.4, 0.92], [16.45, 18.85, 0.86], [18.9, 21.3, 0.8],
  ].map(([y0, y1, chordM], i) => ({ id: `spoiler${i + 1}`, y0, y1, chordM })),
  // 襟翼滑轨整流罩（每侧 3 个：内襟翼外端 1 个、外襟翼 2 个）
  flapFairings: [8.8, 14.7, 19.1],
};

/** 扰流板在 y 处的归一化弦长 */
function spChord(sp, y) { return sp.chordM / planform(y).c; }

function teAt(dev, y) {
  const c = planform(y).c;
  const ch = lerp(dev.chord0, dev.chord1, (y - dev.y0) / (dev.y1 - dev.y0));
  const xl = 1 - ch / c; // 装置下表面前缘
  return { xl, xu: xl + 0.012 };
}
function slatAt(y) { return LAYOUT.slats.find((s) => y >= s.y0 - 1e-6 && y <= s.y1 + 1e-6); }
function teDevAt(y) { return LAYOUT.te.find((d) => y >= d.y0 - 1e-6 && y <= d.y1 + 1e-6); }
function spoilerAt(y) { return LAYOUT.spoilers.find((s) => y >= s.y0 - 1e-6 && y <= s.y1 + 1e-6); }

// ———————————————— 二维截面构造 ————————————————
const up = (xi, tc) => [xi, AF.upper(xi, tc)];
const lo = (xi, tc) => [xi, AF.lower(xi, tc)];

function surf(fn, a, b, n, tc, mode = 'lin') {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let f = t;
    if (mode === 'le') f = 1 - Math.cos((Math.PI / 2) * t); // 靠近 a 端加密
    if (mode === 'leRev') f = Math.sin((Math.PI / 2) * t); // 靠近 b 端加密
    pts.push(fn(a + (b - a) * f, tc));
  }
  return pts;
}
/** 二次贝塞尔闭合曲线 p0→p1，bulge>0 表示向前缘方向（-ξ）鼓出 */
function closure(p0, p1, bulge, n) {
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  let nx = -(p1[1] - p0[1]), ny = p1[0] - p0[0];
  const l = Math.hypot(nx, ny) || 1;
  nx /= l; ny /= l;
  if (nx > 0) { nx = -nx; ny = -ny; } // 指向 -ξ
  const cx = mx + nx * bulge, cy = my + ny * bulge;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * cx + t * t * p1[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * cy + t * t * p1[1]]);
  }
  return pts;
}

const NU = 26, NF = 8; // 弦向点数

/**
 * 通用翼段截面环：从上表面后端出发 → 前部闭合 → 下表面 → 后部闭合。
 * spec: { xu0, xu1, xl0, xl1, front: 'LE'|{bulge}, rear: 'TE'|{bulge} }
 */
function sectionLoop(tc, spec) {
  const segs = [];
  const { xu0, xu1, xl0, xl1, front, rear } = spec;
  if (front === 'LE') {
    const u = surf(up, xu1, 0, NU + 10, tc, 'leRev');
    const l = surf(lo, 0, xl1, NU + 10, tc, 'le');
    segs.push(u.concat(l.slice(1)));
  } else {
    segs.push(surf(up, xu1, xu0, NU, tc, 'lin'));
    segs.push(closure(up(xu0, tc), lo(xl0, tc), front.bulge, NF));
    segs.push(surf(lo, xl0, xl1, NU, tc, 'lin'));
  }
  if (rear === 'TE') {
    segs.push([lo(1, tc), up(1, tc)]);
  } else {
    segs.push(closure(lo(xl1, tc), up(xu1, tc), rear.bulge, NF));
  }
  return segs;
}

/** 扰流板截面：沿上表面的薄板，后缘渐薄 */
function spoilerLoop(tc, x0, x1) {
  const top = surf(up, x1, x0, 14, tc);
  const th = (xi) => lerp(0.007, 0.0018, (xi - x0) / (x1 - x0));
  const bot = top.slice().reverse().map(([x, y]) => [x, y - th(x)]);
  return [top, [top[top.length - 1], bot[0]], bot, [bot[bot.length - 1], top[0]]];
}

/** 克鲁格襟翼截面：贴合下表面的薄板 */
function kruegerLoop(tc, x0, x1) {
  const outer = surf(lo, x0, x1, 10, tc).map(([x, y]) => [x, y - 0.0035]);
  const inner = outer.slice().reverse().map(([x, y]) => [x, y + 0.004]);
  return [outer, [outer[outer.length - 1], inner[0]], inner, [inner[inner.length - 1], outer[0]]];
}

// ———————————————— 刚体铰链 ————————————————
export class Hinge {
  constructor(obj, p, axis) {
    this.obj = obj;
    this.p = p.clone();
    this.a = axis.clone().normalize();
    if (this.a.z < 0) this.a.negate(); // 约定：机翼铰链轴 z 分量为正，左右翼同号角度即镜像运动
    obj.matrixAutoUpdate = false;
    this.angle = 0;
    this.set(0);
  }
  set(angle) {
    this.angle = angle;
    const m = this.obj.matrix;
    m.makeRotationAxis(this.a, angle);
    const rp = this.p.clone().applyMatrix4(m);
    m.setPosition(this.p.x - rp.x, this.p.y - rp.y, this.p.z - rp.z);
    this.obj.matrixWorldNeedsUpdate = true;
  }
}

// ———————————————— 机翼构建 ————————————————
export class Wing {
  constructor(side, M, register) {
    this.side = side; // +1 左翼 / -1 右翼
    this.M = M;
    this.register = register;
    this.group = new THREE.Group();
    this.group.name = side > 0 ? 'wingL' : 'wingR';
    this.structGroup = new THREE.Group();
    this.structGroup.name = 'wingStructure';
    this.hinges = {};
    this.flex = 0;
  }

  /** 生成某站位区间的翼段实体 */
  part(y0, y1, loopFn, { step = 0.55, extra = [] } = {}) {
    const W = this.W;
    const breaks = WING.breaks.map((b) => b.y).filter((y) => y > y0 + 1e-4 && y < y1 - 1e-4);
    const n = Math.max(1, Math.ceil((y1 - y0) / step));
    const ys = mergeStations([Array.from({ length: n + 1 }, (_, i) => y0 + ((y1 - y0) * i) / n), breaks, extra]);
    const stations = ys.map((y) => {
      const f = W.frame(y);
      const segs = loopFn(y, f.tc);
      return segs.map((seg) => seg.map(([xi, eta]) => W.toWorld(y, xi, eta, this.side, new THREE.Vector3(), f)));
    });
    const g = loftSolid(stations, {
      uvScale: (i, k, j) => {
        const p = stations[i][k][j];
        const f = W.frame(ys[i]);
        const xi = clamp((p.x - f.xLE) / f.c, 0, 1);
        const upper = p.y > f.h - xi * f.c * Math.sin(f.tw * DEG);
        return [ys[i] / SPAN, upper ? 0.5 + 0.5 * xi : 0.5 - 0.5 * xi];
      },
    });
    return g;
  }

  build(flex = 0) {
    this.flex = flex;
    this.W = new WingFrame(flex);
    this.clear();
    const M = this.M, S = this.side;
    const reg = (mesh, id, opts) => { this.register(mesh, id, opts); return mesh; };

    // —— 固定翼盒：按所有装置边界分段 ——
    const yStart = 1.7;
    const cuts = new Set([yStart, SPAN]);
    LAYOUT.slats.forEach((s) => { cuts.add(s.y0); cuts.add(s.y1); });
    LAYOUT.te.forEach((d) => { cuts.add(d.y0); cuts.add(d.y1); });
    LAYOUT.spoilers.forEach((s) => { cuts.add(s.y0); cuts.add(s.y1); });
    const ys = [...cuts].filter((y) => y >= yStart && y <= SPAN).sort((a, b) => a - b);
    const fixed = [];
    for (let i = 0; i < ys.length - 1; i++) {
      const ya = ys[i], yb = ys[i + 1];
      if (yb - ya < 1e-3) continue;
      const ym = (ya + yb) / 2;
      const sl = slatAt(ym), dev = teDevAt(ym), sp = spoilerAt(ym);
      const isTip = ya >= WING.breaks[3].y - 1e-3;
      const loop = (y, tc) => {
        const spec = { xu0: 0, xl0: 0, xu1: 1, xl1: 1, front: 'LE', rear: 'TE' };
        if (sl) { spec.xu0 = sl.cu; spec.xl0 = sl.cl; spec.front = { bulge: 0.022 }; }
        if (dev) {
          const t = teAt(dev, y);
          spec.xl1 = t.xl;
          spec.xu1 = sp ? t.xl - spChord(sp, y) + 0.012 : t.xu;
          spec.rear = { bulge: sp ? 0.012 : 0.034 };
        }
        return sectionLoop(tc, spec);
      };
      fixed.push(this.part(ya, yb, loop, { step: isTip ? 0.4 : 0.6 }));
    }
    const box = reg(new THREE.Mesh(merge(fixed), M.wing), 'wing', { comp: 'compCFRP', section: 'wing', role: 'skin' });
    this.group.add(box);
    this.box = box;

    // —— 前缘缝翼 ——
    for (const s of LAYOUT.slats) {
      const g = this.part(s.y0, s.y1, (y, tc) => {
        const segsU = surf(up, s.cu, 0, NU, tc, 'leRev');
        const segsL = surf(lo, 0, s.cl, NU, tc, 'le');
        // 缝翼后缘为内凹的“缝翼凹槽”，包住固定前缘的圆鼻（比固定段多鼓出 0.004c 留出缝隙）
        return [segsU.concat(segsL.slice(1)), closure(lo(s.cl, tc), up(s.cu, tc), 0.026, NF)];
      });
      const mesh = reg(new THREE.Mesh(g, M.wingDark), s.id === 'slat1' ? 'slatIn' : 'slats', { comp: 'compAl', section: 'fixedLE', role: 'skin' });
      this.group.add(mesh);
      // 缝翼沿圆弧滑轨伸出：等效为绕翼下后方轴线旋转
      const p0 = this.W.toWorld(s.y0, 0.33, -0.27, S), p1 = this.W.toWorld(s.y1, 0.33, -0.27, S);
      this.hinges[s.id] = new Hinge(mesh, p0, p1.clone().sub(p0));
    }

    // —— 克鲁格襟翼 ——
    {
      const k = LAYOUT.krueger;
      const g = this.part(k.y0, k.y1, (y, tc) => kruegerLoop(tc, k.x0, k.x1), { step: 0.5 });
      const mesh = reg(new THREE.Mesh(g, M.wingDark), 'krueger', { comp: 'compAl', section: 'fixedLE', role: 'skin' });
      this.group.add(mesh);
      const f0 = this.W.frame(k.y0), f1 = this.W.frame(k.y1);
      const p0 = this.W.toWorld(k.y0, k.x0, AF.lower(k.x0, f0.tc) - 0.004, S), p1 = this.W.toWorld(k.y1, k.x0, AF.lower(k.x0, f1.tc) - 0.004, S);
      this.hinges.krueger = new Hinge(mesh, p0, p1.clone().sub(p0));
    }

    // —— 后缘装置 ——
    for (const d of LAYOUT.te) {
      // 扰流板后缘搭在襟翼上表面：襟翼前部上表面下沉一个板厚，避免与扰流板重面
      const spEdges = LAYOUT.spoilers.filter((s) => s.y1 > d.y0 && s.y0 < d.y1).flatMap((s) => [s.y0 - 0.02, s.y0, s.y1, s.y1 + 0.02]);
      const g = this.part(d.y0, d.y1, (y, tc) => {
        const t = teAt(d, y);
        const sp = d.type === 'flap' ? spoilerAt(y) : null;
        const xEnd = t.xu + 0.042;
        const dep = (xi) => (sp && xi < xEnd ? 0.0042 * Math.min(1, (xEnd - xi) / 0.012) : 0);
        const u = surf(up, 1, t.xu, NU, tc, 'leRev').map(([x, v]) => [x, v - dep(x)]);
        const nose = closure(u[u.length - 1], lo(t.xl, tc), 0.024, NF);
        const l = surf(lo, t.xl, 1, NU, tc, 'lin');
        return [u, nose, l, [lo(1, tc), up(1, tc)]];
      }, { extra: spEdges.filter((y) => y > d.y0 && y < d.y1) });
      const id = d.type === 'flap' ? d.id : d.type;
      const mesh = reg(new THREE.Mesh(g, M.wing), id, { comp: 'compCFRP', section: 'movableTE', role: 'skin' });
      this.group.add(mesh);
      // 铰链：襟翼/襟副翼为“简单铰链（下垂铰链）”，铰链点位于翼下方；副翼铰链在前缘圆心
      const hingePt = (y) => {
        const f = this.W.frame(y), t = teAt(d, y);
        if (d.type === 'aileron') return this.W.toWorld(y, t.xl + 0.02, (AF.upper(t.xl + 0.02, f.tc) + AF.lower(t.xl + 0.02, f.tc)) / 2, S);
        const depth = d.type === 'flaperon' ? 0.045 : 0.085;
        return this.W.toWorld(y, t.xl + 0.03, AF.lower(t.xl, f.tc) - depth, S);
      };
      const p0 = hingePt(d.y0), p1 = hingePt(d.y1);
      this.hinges[d.id] = new Hinge(mesh, p0, p1.clone().sub(p0));
    }

    // —— 扰流板 ——
    for (const sp of LAYOUT.spoilers) {
      const dev = teDevAt((sp.y0 + sp.y1) / 2);
      const g = this.part(sp.y0, sp.y1, (y, tc) => {
        const t = teAt(dev, y);
        return spoilerLoop(tc, t.xl - spChord(sp, y) + 0.012, t.xu + 0.03);
      }, { step: 0.7 });
      const mesh = reg(new THREE.Mesh(g, M.wing), 'spoilers', { comp: 'compCFRP', section: 'movableTE', role: 'skin' });
      this.group.add(mesh);
      const hp = (y) => {
        const f = this.W.frame(y), t = teAt(dev, y);
        const x0 = t.xl - spChord(sp, y) + 0.012;
        return this.W.toWorld(y, x0 + 0.004, AF.upper(x0, f.tc) - 0.004, S);
      };
      const p0 = hp(sp.y0), p1 = hp(sp.y1);
      this.hinges[sp.id] = new Hinge(mesh, p0, p1.clone().sub(p0));
    }

    // —— 襟翼滑轨整流罩（前段固定，后段随襟翼转动）——
    this.buildFlapFairings();
    // —— 翼尖：航行灯与静电放电刷 ——
    this.buildTipDetails();
    // —— 内部结构 ——
    this.buildStructure();
  }

  buildFlapFairings() {
    const M = this.M, S = this.side;
    for (const y of LAYOUT.flapFairings) {
      const dev = teDevAt(y);
      const f = this.W.frame(y);
      const t = teAt(dev, y);
      // 独木舟形整流罩（容纳襟翼铰链/作动筒）：窄而深的龙骨截面，最深处位于襟翼前缘下方；
      // 自襟翼前 0.3c 起，向后伸出后缘约 0.27c 收成尖尾（后段随襟翼一同转动）
      const xi0 = t.xl - 0.3, xi1 = 1.27;
      const D = 0.1 * f.c + 0.05; // 最大深度
      const HW = 0.03 * f.c + 0.05; // 最大半宽
      const pk = Math.log(0.5) / Math.log(clamp((t.xl - xi0) / (xi1 - xi0), 0.2, 0.8)); // 最深点落在襟翼前缘
      const N = 34, K = 36, EXP = 2 / 2.6; // 超椭圆截面（n=2.6，侧壁较直）
      const front = [], aft = [];
      const splitXi = t.xl + 0.02;
      const base = new THREE.Vector3();
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const xi = xi0 + (xi1 - xi0) * u;
        // 基线：机翼下表面；后缘之后沿（扭转后的）弦线外推
        this.W.toWorld(y, xi, AF.lower(clamp(xi, 0, 1), f.tc), S, base, f);
        const env = Math.sin(Math.PI * Math.pow(u, pk));
        const dl = D * Math.pow(env, 0.85) + 0.004; // 下垂深度
        const hw = HW * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.6) * (1 - 0.35 * smoothstep(0.55, 1, u)) + 0.004;
        // 后缘之后露出上半部，形成完整的流线尾锥；尾尖略低于后缘线
        const ex = smoothstep(0.93, 1.06, xi);
        const du = 0.03 + ex * 0.42 * dl;
        const yc = base.y - ex * 0.18 * dl;
        const ring = [];
        for (let q = 0; q <= K; q++) {
          const a = (q / K) * Math.PI * 2;
          const sn = Math.sin(a), cs = Math.cos(a);
          const yy = (sn < 0 ? dl : du) * Math.sign(sn) * Math.pow(Math.abs(sn), EXP);
          const zz = hw * Math.sign(cs) * Math.pow(Math.abs(cs), EXP);
          ring.push(new THREE.Vector3(base.x, yc + yy, base.z + zz * S));
        }
        ring[K].copy(ring[0]);
        (xi < splitXi ? front : aft).push([ring]);
        if (xi >= splitXi && aft.length === 1) front.push([ring.map((p) => p.clone())]);
      }
      const mf = new THREE.Mesh(loftSolid(front), M.wing);
      const ma = new THREE.Mesh(loftSolid(aft), M.wing);
      this.register(mf, 'flapFairing', { comp: 'compGlass', section: 'movableTE', role: 'skin' });
      this.register(ma, 'flapFairing', { comp: 'compGlass', section: 'movableTE', role: 'skin' });
      this.group.add(mf, ma);
      (this.fairingHinges ||= []).push({ obj: ma, dev });
    }
    // 整流罩后段与所属襟翼共用铰链
    for (const fh of this.fairingHinges) {
      const h = this.hinges[fh.dev.id];
      fh.hinge = new Hinge(fh.obj, h.p, h.a);
    }
  }

  buildTipDetails() {
    const M = this.M, S = this.side;
    const yT = SPAN - 0.02;
    const tip = this.W.toWorld(yT, 0.5, 0, S);
    // 航行灯：左红右绿（位于翼尖前缘处），翼尖后缘有白色航行灯与频闪灯
    const navPos = this.W.toWorld(SPAN - 0.12, 0.08, 0.0, S);
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), S > 0 ? M.lightRed : M.lightGreen);
    nav.position.copy(navPos);
    const aftPos = this.W.toWorld(SPAN - 0.1, 0.97, 0.0, S);
    const aft = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), M.strobe || M.lightWhite);
    aft.position.copy(aftPos);
    this.register(nav, 'navLights', { comp: 'compOther', section: 'wingtip', role: 'skinDetail' });
    this.register(aft, 'strobes', { comp: 'compOther', section: 'wingtip', role: 'skinDetail' });
    this.group.add(nav, aft);
    this.lights = { nav: navPos.clone(), strobe: aftPos.clone(), tip };
    // 静电放电刷：沿翼尖/副翼后缘的细杆
    const wicks = [];
    const wickYs = [22.6, 24.2, 25.8, 27.6, 28.9, 29.8];
    for (const y of wickYs) {
      const f = this.W.frame(y);
      const a = this.W.toWorld(y, 0.985, (AF.upper(0.985, f.tc) + AF.lower(0.985, f.tc)) / 2, S);
      const b = a.clone().add(new THREE.Vector3(0.24, -0.01, 0));
      const g = new THREE.CylinderGeometry(0.006, 0.009, a.distanceTo(b), 6);
      g.rotateZ(Math.PI / 2);
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      wicks.push(g);
    }
    const wm = new THREE.Mesh(merge(wicks), M.blackPaint);
    this.register(wm, 'wingtip', { comp: 'compOther', section: 'wingtip', role: 'skinDetail' });
    this.group.add(wm);
  }

  /** 内部结构：前/后梁、翼肋、长桁、油箱 */
  buildStructure() {
    const M = this.M, S = this.side, W = this.W;
    const g = this.structGroup;
    const fs = WING.frontSpar, rs = WING.rearSpar;
    const skinIn = 0.006; // 蒙皮厚度（归一化近似）
    const yEnd = SPAN - 1.3;
    // 梁：腹板薄片，从中心线延伸到翼尖附近
    const sparGeom = (xi, th) => this.part(0.02, yEnd, (y, tc) => {
      const u = AF.upper(xi, tc) - skinIn, l = AF.lower(xi, tc) + skinIn;
      const d = th / planform(y).c;
      return [[[xi - d, u], [xi - d, l]], [[xi - d, l], [xi + d, l]], [[xi + d, l], [xi + d, u]], [[xi + d, u], [xi - d, u]]];
    }, { step: 0.8 });
    const front = new THREE.Mesh(sparGeom(fs, 0.02), M.sSpar);
    const rear = new THREE.Mesh(sparGeom(rs, 0.02), M.sSpar);
    this.register(front, 'frontSpar', { comp: 'compCFRP', section: 'wing', role: 'structure' });
    this.register(rear, 'rearSpar', { comp: 'compCFRP', section: 'wing', role: 'structure' });
    g.add(front, rear);

    // 翼肋：外翼段垂直于后梁，内翼段顺气流方向
    const ribs = [];
    const rearLine = (y) => { const p = planform(y); return p.xLE + rs * p.c; };
    const ribYs = [];
    for (let y = Y_SOB; y <= yEnd; y += 0.68) ribYs.push(y);
    for (const y0 of ribYs) {
      // 后梁方向（平面内）
      const dx = (rearLine(y0 + 0.5) - rearLine(y0 - 0.5));
      const perp = y0 > WING.breaks[2].y ? Math.atan2(dx, 1) : 0; // 垂直于后梁时，肋线相对顺流方向的偏角
      const N = 16;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        // 沿肋线从后梁向前推进；肋线方向 = (cos, -sin) 在 (x, y) 平面
        const u = i / N;
        const p = planform(y0);
        const xr = rearLine(y0);
        const len = (rs - fs) * p.c * 1.05;
        const xx = xr - u * len * Math.cos(perp);
        const yy = y0 + u * len * Math.sin(perp);
        const q = planform(yy);
        const xi = (xx - q.xLE) / q.c;
        pts.push([yy, xi]);
      }
      const valid = pts.filter(([, xi]) => xi >= fs - 1e-3 && xi <= rs + 1e-3);
      if (valid.length < 3) continue;
      const th = 0.012;
      const loopAt = (off) => {
        const upper = valid.map(([yy, xi]) => { const f = W.frame(yy); return W.toWorld(yy + off, xi, AF.upper(xi, f.tc) - skinIn, S); });
        const lower = valid.slice().reverse().map(([yy, xi]) => { const f = W.frame(yy); return W.toWorld(yy + off, xi, AF.lower(xi, f.tc) + skinIn, S); });
        return [upper, [upper[upper.length - 1], lower[0]], lower, [lower[lower.length - 1], upper[0]]];
      };
      ribs.push(loftSolid([loopAt(-th), loopAt(th)]));
    }
    const ribMesh = new THREE.Mesh(merge(ribs), M.sRib);
    this.register(ribMesh, 'ribs', { comp: 'compAl', section: 'wing', role: 'structure' });
    g.add(ribMesh);

    // 长桁：上下壁板内侧的纵向加强条（按翼盒弦向等分）
    const str = [];
    const nUp = 14, nLo = 12;
    const stringer = (frac, upper) => {
      const xiAt = () => fs + (rs - fs) * frac;
      const run = Math.min(yEnd, Y_SOB + (SPAN - Y_SOB) * (1 - Math.abs(frac - 0.5) * 0.7));
      return this.part(0.05, run, (y, tc) => {
        const xi = xiAt();
        const w = 0.035 / planform(y).c, h = 0.07 / planform(y).c;
        const s0 = upper ? AF.upper(xi, tc) - skinIn : AF.lower(xi, tc) + skinIn;
        const s1 = upper ? s0 - h : s0 + h;
        return [[[xi - w, s0], [xi - w, s1]], [[xi - w, s1], [xi + w, s1]], [[xi + w, s1], [xi + w, s0]], [[xi + w, s0], [xi - w, s0]]];
      }, { step: 1.2 });
    };
    for (let i = 1; i <= nUp; i++) str.push(stringer(i / (nUp + 1), true));
    for (let i = 1; i <= nLo; i++) str.push(stringer(i / (nLo + 1), false));
    const strMesh = new THREE.Mesh(merge(str), M.sWingStringer);
    this.register(strMesh, 'wingStringers', { comp: 'compCFRP', section: 'wing', role: 'structure' });
    g.add(strMesh);

    // 油箱：主油箱（翼根至约 70% 半展）、通气/缓冲油箱（翼尖附近）
    const tank = (y0, y1, mat, id) => {
      const geo = this.part(y0, y1, (y, tc) => {
        const a = fs + 0.012, b = rs - 0.012;
        const u = surf(up, b, a, 12, tc).map(([x, v]) => [x, v - 0.014]);
        const l = surf(lo, a, b, 12, tc).map(([x, v]) => [x, v + 0.014]);
        return [u, [u[u.length - 1], l[0]], l, [l[l.length - 1], u[0]]];
      }, { step: 1.0 });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2;
      this.register(m, id, { comp: 'compOther', section: 'wing', role: 'structure' });
      g.add(m);
    };
    tank(Y_SOB + 0.1, 21.2, M.sFuel, 'mainTank');
    tank(25.0, 26.9, M.sSurge, 'surgeTank');
  }

  clear() {
    for (const grp of [this.group, this.structGroup]) {
      for (let i = grp.children.length - 1; i >= 0; i--) {
        const o = grp.children[i];
        grp.remove(o);
        o.traverse((q) => { if (q.geometry) q.geometry.dispose(); });
        if (this.onRemove) this.onRemove(o);
      }
    }
    this.hinges = {};
    this.fairingHinges = [];
  }

  /** 设置可动翼面角度（度）。state: { slat, krueger, flapIn, flapOut, flaperon, aileron, spoilers[] } */
  apply(st) {
    const H = this.hinges;
    for (const s of LAYOUT.slats) H[s.id]?.set(st.slat * DEG);
    H.krueger?.set(-st.krueger * DEG);
    H.flapIn?.set(-st.flapIn * DEG);
    H.flapOut?.set(-st.flapOut * DEG);
    H.flaperon?.set(-st.flaperon * DEG);
    H.aileron?.set(-st.aileron * DEG);
    LAYOUT.spoilers.forEach((sp, i) => H[sp.id]?.set((st.spoilers[i] || 0) * DEG));
    for (const fh of this.fairingHinges) fh.hinge.set(fh.dev.id === 'flapIn' ? -st.flapIn * DEG : -st.flapOut * DEG);
  }

  /** 发动机吊挂连接参考：发动机中心线处的前缘点与下表面 */
  engineMount() {
    const y = EY, f = this.W.frame(y);
    return {
      y,
      f,
      le: this.W.toWorld(y, 0, 0, this.side),
      lowerAt: (xi) => this.W.toWorld(y, xi, AF.lower(xi, f.tc), this.side),
      upperAt: (xi) => this.W.toWorld(y, xi, AF.upper(xi, f.tc), this.side),
    };
  }

  /** 主起落架连接点（后梁后方） */
  gearMount() {
    const y = WING.mainGearY, f = this.W.frame(y);
    return { y, f, at: (xi, eta) => this.W.toWorld(y, xi, eta, this.side) };
  }
}

export { boxBetween };
