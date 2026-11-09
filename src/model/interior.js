// 机身内部：结构（隔框、长桁、地板梁、压力隔板、龙骨梁、中央翼盒）+ 客舱/驾驶舱/货舱布置。
// 787 机身为一体化缠绕成型的碳纤维筒段，框距 24 in（0.61 m）；客舱地板距机腹 2.95 m。
// 典型两舱布局（ACAPS §2.1）：28 公务（1-2-1）+ 262 经济（3-3-3 / 尾段 2-3-2）；下货舱 20 + 16 个 LD3。
import * as THREE from 'three';
import { SECTIONS, section, point, normal, tAtHeight, FUS } from './fuselage.js';
import { FRAME0, DOORS } from './layout.js';
import { WING } from './spec.js';
import { WingFrame } from './wing.js';
import { SUPERCRITICAL as AF } from '../geom/airfoil.js';
import { merge, grid, loftSolid, capPolygon } from '../geom/build.js';
import { buildFlightDeck } from './flightdeck.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const hb = FUS.zb0;
export const CABIN_FLOOR = FUS.floor; // 客舱地板面
export const CARGO_FLOOR = hb + 0.78; // 下货舱地板面（滚棒顶面）

const secOf = (s) => (SECTIONS.find((q) => s >= q.from && s < q.to) || SECTIONS[SECTIONS.length - 1]).id;
const _P = V(), _N = V();
/** 蒙皮内侧向内偏移 d 的点 */
function inner(s, t, d, out = V()) {
  point(s, t, out); normal(s, t, _N);
  return out.addScaledVector(_N, -d);
}
/** 截面在高度 h 处的半宽（内侧偏移 d） */
function halfWidthAt(s, h, d = 0) {
  const t = tAtHeight(s, h, 1);
  return inner(s, t, d, _P).z;
}
/** 轴对齐盒（中心 + 尺寸） */
function box(cx, cy, cz, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  return g;
}

/** 一圈隔框：矩形截面（深 depth、宽 th）沿截面周向扫掠 */
function frameRing(s, depth, th, d0 = 0.012, n = 96) {
  const loop = (ds) => {
    const o = [], i = [];
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * TAU;
      o.push(inner(s + ds, t, d0));
      i.push(inner(s + ds, t, d0 + depth));
    }
    return { o, i };
  };
  const a = loop(-th / 2), b = loop(th / 2);
  const C = n + 1;
  // 四个面：外/内/前/后
  const faces = [[a.o, b.o], [b.i, a.i], [a.i, a.o], [b.o, b.i]];
  return merge(faces.map(([r0, r1]) => grid(2, C, (row, j, out) => out.copy((row === 0 ? r0 : r1)[j]))));
}

export function buildInterior(M, reg) {
  const structure = new THREE.Group(); structure.name = 'fuselageStructure';
  const cabin = new THREE.Group(); cabin.name = 'cabin';
  const bySec = {};
  const put = (sec, key, g) => { ((bySec[sec] ||= {})[key] ||= []).push(g); };

  // —— 隔框：框距 0.61 m；门框处加强（双框）——
  const frameS = [];
  for (let k = -9; FRAME0 + 0.61 * k < 56.2; k++) frameS.push(FRAME0 + 0.61 * k);
  const doorS = DOORS.map((d) => d.s);
  for (const s of frameS) {
    if (s < 1.6) continue;
    const nearDoor = doorS.some((ds) => Math.abs(s - ds) < 0.75);
    const g = frameRing(s, nearDoor ? 0.2 : 0.15, nearDoor ? 0.07 : 0.04);
    put(secOf(s), nearDoor ? 'doorFrames' : 'frames', g);
  }
  // —— 长桁：沿周向约 0.3 m 一根（帽形截面简化为扁条）——
  const NSTR = 60;
  for (const sec of SECTIONS) {
    if (sec.id === 'radome') continue;
    const s0 = Math.max(sec.from, 1.6) + 0.02, s1 = Math.min(sec.to, 56.0) - 0.02;
    if (s1 <= s0) continue;
    const ns = Math.max(2, Math.ceil((s1 - s0) / 0.6) + 1);
    for (let j = 0; j < NSTR; j++) {
      const t0 = ((j + 0.5) / NSTR) * TAU;
      const w = 0.045;
      const g = grid(ns, 4, (i, c, out) => {
        const s = s0 + ((s1 - s0) * i) / (ns - 1);
        const dt = w / Math.max(0.5, section(s).w);
        const t = t0 + (c === 0 || c === 3 ? -dt : dt);
        inner(s, t, c === 0 || c === 3 ? 0.012 : 0.05, out);
      });
      put(sec.id, 'stringers', g);
    }
  }
  // —— 客舱地板梁 / 货舱地板梁 / 支柱 ——
  for (const s of frameS) {
    if (s < 5.2 || s > 52.0) continue;
    const sec = secOf(s);
    const inWingBox = s > 21.6 && s < 28.6; // 中央翼盒处地板梁搭在翼盒上表面
    const zf = halfWidthAt(s, CABIN_FLOOR - 0.12, 0.05);
    put(sec, 'floorBeams', box(s, CABIN_FLOOR - 0.13, 0, 0.05, 0.24, 2 * zf));
    if (!inWingBox && !(s > 28.6 && s < 33.2) && s > 7.0 && s < 49.0) {
      const zc = halfWidthAt(s, CARGO_FLOOR - 0.08, 0.05);
      put(sec, 'cargoFloor', box(s, CARGO_FLOOR - 0.08, 0, 0.04, 0.12, 2 * zc));
      for (const z of [-1.05, 1.05]) put(sec, 'floorBeams', box(s, (CABIN_FLOOR + CARGO_FLOOR) / 2 - 0.12, z, 0.04, CABIN_FLOOR - CARGO_FLOOR - 0.2, 0.05));
    }
  }
  // 座椅滑轨（6 条）与地板面板
  for (const sec of SECTIONS) {
    const s0 = Math.max(sec.from, 5.6), s1 = Math.min(sec.to, 51.6);
    if (s1 <= s0) continue;
    for (const z of [-2.15, -1.35, -0.7, 0.7, 1.35, 2.15]) put(sec.id, 'seatTracks', box((s0 + s1) / 2, CABIN_FLOOR - 0.005, z, s1 - s0 - 0.02, 0.03, 0.05));
    const ns = Math.ceil((s1 - s0) / 0.5) + 1;
    put(sec.id, 'floorPanels', grid(ns, 2, (i, j, out) => {
      const s = s0 + ((s1 - s0) * i) / (ns - 1);
      const z = halfWidthAt(s, CABIN_FLOOR, 0.06);
      out.set(s, CABIN_FLOOR + 0.002, j === 0 ? z : -z);
    }));
  }
  // 龙骨梁：贯穿主轮舱，把机身弯矩从前段传到后段
  put('s44', 'keel', box(28.0, hb + 0.22, 0, 11.0, 0.32, 0.22));
  // 前/后压力隔板
  {
    const s = 1.6, pts = [];
    for (let k = 0; k < 72; k++) pts.push(inner(s, (k / 72) * TAU, 0.01));
    put('s41', 'bulkheads', capPolygon(pts, V(-1, 0, 0)));
    for (const h of [0.6, 1.5, 2.4]) { // 加强筋
      const y = hb + 0.3 + h;
      const z = halfWidthAt(s, y, 0.02);
      put('s41', 'bulkheads', box(s + 0.06, y, 0, 0.1, 0.06, 2 * z));
    }
    // 后压力隔板：球面穹顶（向后凸 0.85 m），位于 47/48 段对接处
    const s1 = 52.1, depth = 0.85, NR = 14, NT = 72;
    const dome = grid(NR + 1, NT + 1, (i, j, out) => {
      const r = i / NR, t = (j / NT) * TAU;
      const p = inner(s1, t, 0.02, _P);
      const q = section(s1);
      const cy = (q.zt + q.zb) / 2;
      out.set(s1 + depth * (1 - r * r) * 0.98, cy + (p.y - cy) * r, p.z * r);
    });
    put('s47', 'bulkheads', dome);
  }
  // 中央翼盒（第 11 段）：前后梁之间、贯穿机身的盒形结构，内为中央油箱
  {
    const W = new WingFrame(0), fs = WING.frontSpar, rs = WING.rearSpar;
    const loopAt = (y) => {
      const f = W.frame(y), N = 10, up = [], lo = [];
      for (let i = 0; i <= N; i++) {
        const xi = fs + ((rs - fs) * i) / N;
        up.push(W.toWorld(y, xi, AF.upper(xi, f.tc) - 0.004, 1));
        lo.push(W.toWorld(y, xi, AF.lower(xi, f.tc) + 0.004, 1));
      }
      lo.reverse();
      return [up, [up[N], lo[0]], lo, [lo[N], up[0]]];
    };
    const stations = [];
    for (let y = -2.88; y <= 2.881; y += 0.48) {
      const l = loopAt(Math.abs(y));
      stations.push(l.map((seg) => seg.map((p) => V(p.x, p.y, y))));
    }
    const wb = loftSolid(stations);
    put('s11', 'centerTank', wb);
    // 翼盒前后梁腹板与展向肋
    for (const xi of [fs, rs]) {
      const f0 = W.frame(0);
      const pU = W.toWorld(0, xi, AF.upper(xi, f0.tc), 1), pL = W.toWorld(0, xi, AF.lower(xi, f0.tc), 1);
      put('s11', 'centerSpars', box(pU.x, (pU.y + pL.y) / 2, 0, 0.05, pU.y - pL.y, 5.76));
    }
  }

  // ———————— 注册结构网格 ————————
  const MAT = {
    frames: [M.sFrame, 'frames', 'compCFRP'], doorFrames: [M.sBulkhead, 'doorFrames', 'compCFRP'], stringers: [M.sStringer, 'stringers', 'compCFRP'],
    floorBeams: [M.sFloor, 'floorBeams', 'compCFRP'], cargoFloor: [M.sFloor, 'cargoFloor', 'compAl'], seatTracks: [M.sKeel, 'seatTracks', 'compTi'],
    floorPanels: [M.sFloorPanel, 'floorPanels', 'compSandwich'], keel: [M.sKeel, 'keel', 'compCFRP'], bulkheads: [M.sBulkhead, 'bulkheads', 'compCFRP'],
    centerTank: [M.sFuelCenter, 'centerTank', 'compOther'], centerSpars: [M.sSpar, 'centerWingBox', 'compCFRP'],
  };
  const structBySec = {};
  for (const [sec, groups] of Object.entries(bySec)) {
    const grp = new THREE.Group(); grp.name = 'struct-' + sec;
    structure.add(grp); structBySec[sec] = grp;
    for (const [key, list] of Object.entries(groups)) {
      const [mat, id, comp] = MAT[key];
      const mesh = new THREE.Mesh(merge(list), mat);
      reg(mesh, id, { comp, section: sec, role: 'structure' });
      grp.add(mesh);
    }
  }

  // ———————————————— 客舱 ————————————————
  const seatE = [], seatB = [], cushion = [], bins = [], mon = [], galley = [], cargo = [], walls = [];
  // 经济舱座椅（3-3-3）：座垫宽 0.42 m + 扶手 0.04 m → 座距 0.46 m；排距 0.81 m（32 in）。
  // 九座排宽 3 × 1.42 m，两条过道各 0.43 m（17 in，扶手高度处），靠窗座外侧扶手贴着侧壁
  const PZ = 0.46;
  const ecoSeat = (s, z) => {
    const y = CABIN_FLOOR;
    seatE.push(box(s, y + 0.42, z, 0.46, 0.1, 0.42)); // 坐垫
    const back = box(0, 0.38, 0, 0.09, 0.76, 0.42); back.rotateZ(-0.16); back.translate(s + 0.24, y + 0.46, z); seatE.push(back);
    cushion.push(box(s + 0.2, y + 0.92, z, 0.1, 0.18, 0.38)); // 头枕
    seatE.push(box(s + 0.02, y + 0.18, z, 0.36, 0.36, 0.06)); // 椅腿
    // 椅背娱乐屏：嵌在靠背后侧（朝向后排乘客），随靠背后倾
    const scr = box(0.053, 0.36, 0, 0.02, 0.17, 0.26); scr.rotateZ(-0.16); scr.translate(s + 0.24, y + 0.46, z); mon.push(scr);
  };
  const ecoRow = (s, layout) => {
    // 2-3-2 排的靠过道座与 3-3-3 排对齐，靠窗座向内收（尾段侧壁开始收窄）
    const blocks = layout === 9 ? [[-2.31, 3], [-0.46, 3], [1.39, 3]] : [[-1.85, 2], [-0.46, 3], [1.39, 2]];
    for (const [z0, n] of blocks) for (let k = 0; k < n; k++) ecoSeat(s, z0 + k * PZ);
    // 扶手：每个座位块 n + 1 根（两端 + 座间）
    for (const [z0, n] of blocks) for (let k = 0; k <= n; k++) seatE.push(box(s - 0.02, CABIN_FLOOR + 0.58, z0 + (k - 0.5) * PZ, 0.42, 0.05, 0.04));
  };
  // 公务舱（1-2-1 平躺座椅隔间）：排距 1.17 m
  const bizSeat = (s, z, dir) => {
    const y = CABIN_FLOOR;
    seatB.push(box(s, y + 0.55, z, 1.05, 1.1, 0.06).translate(0, 0, dir * 0.38)); // 隔断外壳
    seatB.push(box(s - 0.35, y + 0.4, z, 0.35, 0.8, 0.8)); // 脚踏/储物
    cushion.push(box(s + 0.12, y + 0.48, z, 0.62, 0.12, 0.56)); // 坐垫
    const back = box(0, 0.42, 0, 0.12, 0.84, 0.56); back.rotateZ(-0.22); back.translate(s + 0.44, y + 0.5, z); cushion.push(back);
    mon.push(box(s - 0.52, y + 1.0, z, 0.03, 0.32, 0.52));
  };
  const S_BIZ0 = 8.35, NBIZ = 7, PB = 1.17;
  for (let r = 0; r < NBIZ; r++) {
    const s = S_BIZ0 + r * PB;
    bizSeat(s, 1.95, 1); bizSeat(s, -1.95, -1); bizSeat(s, 0.42, -1); bizSeat(s, -0.42, 1);
  }
  // 经济舱：2 号门后 16 排、3 号门后 14 排（最后 4 排为 2-3-2）
  const PE = 0.81;
  let nEco = 0;
  for (let r = 0; r < 16; r++) { ecoRow(19.75 + r * PE, 9); nEco += 9; }
  for (let r = 0; r < 14; r++) { const lay = r >= 10 ? 7 : 9; ecoRow(36.75 + r * PE, lay); nEco += lay; }
  // 行李箱：两侧 + 中央（枢转式 Space bins 简化为连续壳体）
  for (const [s0, s1] of [[7.8, 17.0], [19.5, 34.4], [36.5, 48.4]]) {
    const L = s1 - s0, sc = (s0 + s1) / 2;
    const yb = CABIN_FLOOR + 1.62;
    const zw = halfWidthAt(sc, yb + 0.25, 0.12);
    for (const sg of [-1, 1]) bins.push(box(sc, yb + 0.22, sg * (zw - 0.32), L, 0.44, 0.62));
    if (s0 > 19) bins.push(box(sc, yb + 0.3, 0, L, 0.4, 1.3));
  }
  // 厨房/盥洗室模块（门区附近）
  for (const [s0, s1, zs] of [[5.0, 5.9, [[-1.1, 1.6]]], [6.9, 7.7, [[-1.5, 1.2], [1.0, 1.4]]], [16.95, 17.8, [[-1.7, 1.3], [1.6, 1.3]]], [18.9, 19.45, [[-0.9, 1.0]]],
    [34.7, 34.95, [[0, 1.6]]], [36.05, 36.4, [[-1.9, 1.0], [1.9, 1.0]]], [48.4, 48.95, [[-1.8, 1.2], [1.8, 1.2]]], [50.35, 51.7, [[0, 2.6]]]]) {
    for (const [zc, wz] of zs) galley.push(box((s0 + s1) / 2, CABIN_FLOOR + 1.0, zc, s1 - s0, 2.0, wz));
  }
  // 下货舱：前舱 10 排 ×2 = 20 个 LD3，后舱 8 排 ×2 = 16 个 LD3
  const ld3 = (s, sg) => {
    const y = CARGO_FLOOR;
    // 轮廓：底宽 1.56 m，顶宽 2.01 m（一侧斜切），高 1.63 m；纵向 1.53 m
    const pts = [[0, 0], [1.56, 0], [1.56, 0.6], [2.01, 1.1], [2.01, 1.63], [0, 1.63]].map(([z, yy]) => new THREE.Vector2(sg * (0.04 + z), yy));
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 1.5, bevelEnabled: false });
    // Shape 位于 (x=z, y) 平面 → 机体系：x→z、z→s（基变换含镜像，材质为双面）
    g.applyMatrix4(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(1, 0, 0)));
    g.translate(s, y + 0.01, 0);
    cargo.push(g);
  };
  for (let r = 0; r < 10; r++) for (const sg of [-1, 1]) ld3(7.1 + r * 1.56, sg);
  for (let r = 0; r < 8; r++) for (const sg of [-1, 1]) ld3(33.6 + r * 1.56, sg);
  // 客舱侧壁内饰（半透明，带舷窗开口感的浅色壳）
  for (const [s0, s1] of [[7.6, 51.8]]) {
    for (const sg of [-1, 1]) {
      const ns = Math.ceil((s1 - s0) / 0.6) + 1;
      walls.push(grid(ns, 6, (i, j, out) => {
        const s = s0 + ((s1 - s0) * i) / (ns - 1);
        const h = CABIN_FLOOR + 0.1 + (j / 5) * 1.75;
        const t = tAtHeight(s, h, sg);
        inner(s, t, 0.17, out);
      }));
    }
  }
  const cab = (list, mat, id, comp) => {
    if (!list.length) return null;
    const m = new THREE.Mesh(merge(list), mat);
    reg(m, id, { comp, section: 'cabin', role: 'cabin' });
    m.castShadow = true; m.receiveShadow = true;
    cabin.add(m);
    return m;
  };
  cab(seatE, M.seat, 'seatsEco', 'compOther');
  cab(seatB, M.seatBiz, 'seatsBiz', 'compOther');
  cab(cushion, M.seat, 'seatsEco', 'compOther');
  cab(mon, M.frameDark, 'ife', 'compOther');
  cab(bins, M.bin, 'bins', 'compSandwich');
  cab(galley, M.galley, 'galleys', 'compAl');
  // 驾驶舱：几何见 flightdeck.js，按材质分组注册为同一部件
  for (const [key, list] of Object.entries(buildFlightDeck())) {
    const m = cab(list, M[key], 'flightDeck', 'compOther');
    if (m && (key === 'fdHud' || key === 'fdHudGlass')) { m.castShadow = false; m.receiveShadow = false; }
  }
  cab(cargo, M.container, 'cargo', 'compAl');
  cab(walls, M.cabinWall, 'cabinWall', 'compSandwich');
  // 客舱地板实体面（座椅模式下可见）
  const ns = 120;
  cab([grid(ns, 2, (i, j, out) => { const s = 5.2 + (46.6 * i) / (ns - 1); const z = halfWidthAt(s, CABIN_FLOOR, 0.17); out.set(s, CABIN_FLOOR + 0.004, j === 0 ? -z : z); })], M.carpet, 'cabinFloor', 'compSandwich');
  cab([grid(80, 2, (i, j, out) => { const s = 7.0 + (42 * i) / 79; const z = halfWidthAt(s, CARGO_FLOOR, 0.1); out.set(s, CARGO_FLOOR, j === 0 ? -z : z); })], M.galley, 'cargoFloorPanel', 'compAl');

  return { structure, structBySec, cabin, counts: { biz: NBIZ * 4, eco: nEco, ld3: 36 } };
}

