// 整机装配：机身、机翼、尾翼、发动机、起落架、内部结构，并维护可动部件状态
import * as THREE from 'three';
import { SECTIONS, skinGeometry, surfacePatch, squircle, tAtHeight, FUS } from './fuselage.js';
import { windowStations, WINDOW, DOORS, PAX_DOOR } from './layout.js';
import { buildCockpitWindows, buildProbes } from './cockpit.js';
import { merge } from '../geom/build.js';
import { arcFromHeight, tFromArc } from '../render/textures.js';
import { G, ATTITUDE } from './spec.js';
import { Wing } from './wing.js';
import { fairingGeometry } from './fairing.js';
import { Empennage } from './empennage.js';
import { Engine } from './engine.js';
import { DEG } from '../core/math.js';
import { Gear } from './gear.js';
import { Systems } from './systems.js';
import { buildInterior } from './interior.js';
import { updateHoles } from '../render/holes.js';

export class Aircraft {
  constructor(M) {
    this.M = M;
    this.root = new THREE.Group();
    this.root.name = 'B787-9';
    this.ac = new THREE.Group(); // 机体坐标系（x=站位，y=离地高度，z=左舷为正）
    this.ac.position.x = -G.L / 2;
    // 停机姿态：轻载时机头下俯约 0.8°，绕 s=16 m 旋转（主轮与前轮同时接地）
    const th = ATTITUDE.pitchDeg * DEG;
    this.ac.rotation.z = th;
    this.ac.position.y = -ATTITUDE.pivotS * Math.sin(th);
    this.root.add(this.ac);
    this.parts = new Map(); // partId → Mesh[]
    this.meshes = [];
    this.build();
  }

  /** 注册网格：partId 用于点击识别；comp 为材料类别；section 为生产分段；role 区分外观/结构 */
  reg(mesh, partId, { comp = 'compOther', section = null, role = 'exterior', matKey = null } = {}) {
    mesh.userData.partId = partId;
    mesh.userData.comp = comp;
    mesh.userData.section = section;
    mesh.userData.role = role;
    mesh.userData.baseMaterial = mesh.material;
    mesh.userData.matKey = matKey;
    if (role === 'exterior' || role === 'skin' || role === 'skinDetail') { mesh.castShadow = true; mesh.receiveShadow = true; }
    if (!this.parts.has(partId)) this.parts.set(partId, []);
    this.parts.get(partId).push(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  build() {
    const M = this.M;
    const fus = new THREE.Group();
    fus.name = 'fuselage';
    this.ac.add(fus);
    this.fusGroup = fus;
    this.sectionGroups = {};

    // 机身蒙皮：按生产分段分别成网格，便于分解展示
    for (const sec of SECTIONS) {
      const grp = new THREE.Group();
      grp.name = sec.id;
      fus.add(grp);
      this.sectionGroups[sec.id] = grp;
      const mesh = new THREE.Mesh(skinGeometry(sec.from, sec.to), sec.id === 'radome' ? M.radome : M.paint);
      this.reg(mesh, sec.id, { comp: sec.id === 'radome' ? 'compGlass' : 'compCFRP', section: sec.id, role: 'skin' });
      mesh.castShadow = true; mesh.receiveShadow = true;
      grp.add(mesh);
    }

    // 客舱舷窗（贴合曲面的圆角矩形玻璃）
    const winGeoms = { };
    const hWin = FUS.floor + WINDOW.centerAboveFloor;
    for (const s of windowStations()) {
      for (const side of [1, -1]) {
        const t = tAtHeight(s, hWin, side);
        const g = surfacePatch(s, t, squircle(WINDOW.w / 2, WINDOW.h / 2, 4.6), { side, offset: 0.004, rings: 2, seg: 32 });
        const sec = SECTIONS.find((q) => s >= q.from && s < q.to).id;
        (winGeoms[sec] ||= []).push(g);
      }
    }
    // 舱门小窗
    for (const d of DOORS) {
      for (const side of [1, -1]) {
        const a0 = arcFromHeight(d.s, FUS.zb0 + PAX_DOOR.sill);
        const t = tFromArc(d.s, a0 + 1.42, side);
        const g = surfacePatch(d.s, t, squircle(0.1, 0.14, 3.2), { side, offset: 0.004, rings: 2, seg: 28 });
        const sec = SECTIONS.find((q) => d.s >= q.from && d.s < q.to).id;
        (winGeoms[sec] ||= []).push(g);
      }
    }
    for (const [sec, list] of Object.entries(winGeoms)) {
      const mesh = new THREE.Mesh(merge(list), M.glass);
      this.reg(mesh, 'windows', { comp: 'compGlass', section: sec, role: 'skinDetail' });
      this.sectionGroups[sec].add(mesh);
    }

    // 驾驶舱风挡与探头
    const cw = buildCockpitWindows(M);
    cw.children.forEach((m) => this.reg(m, 'cockpit', { comp: m.userData.comp, section: 's41', role: 'skinDetail' }));
    this.sectionGroups.s41.add(cw);
    const probes = buildProbes(M);
    probes.children.forEach((m) => this.reg(m, 'probes', { comp: 'compSteel', section: 's41', role: 'skinDetail' }));
    this.sectionGroups.s41.add(probes);

    // 翼身整流罩
    const fairing = new THREE.Mesh(fairingGeometry(), M.paint);
    this.reg(fairing, 'fairing', { comp: 'compGlass', section: 'fairing', role: 'skin' });
    fus.add(fairing);
    this.fairing = fairing;

    // 内部结构总组（默认隐藏，结构模式下显示）
    this.structure = new THREE.Group();
    this.structure.name = 'structure';
    this.structure.visible = false;
    this.ac.add(this.structure);

    // 主翼（左 +1 / 右 -1）
    this.wings = [1, -1].map((side) => {
      const w = new Wing(side, M, (mesh, id, opts) => this.reg(mesh, id, opts));
      w.onRemove = (o) => this.unreg(o);
      w.build(0);
      this.ac.add(w.group);
      this.structure.add(w.structGroup);
      return w;
    });
    // 尾翼
    this.tail = new Empennage(M, (mesh, id, opts) => this.reg(mesh, id, opts));
    this.ac.add(this.tail.group);
    this.structure.add(this.tail.structGroup);
    // 发动机与吊挂（左 +1 / 右 -1，两台同向旋转）
    this.engines = this.wings.map((w) => {
      const e = new Engine(M, (mesh, id, opts) => this.reg(mesh, id, opts), w.side, w);
      this.ac.add(e.group, e.pylon);
      return e;
    });
    // 机身内部结构与客舱布置
    const inner = buildInterior(M, (mesh, id, opts) => this.reg(mesh, id, opts));
    this.structure.add(inner.structure);
    this.structBySec = inner.structBySec;
    this.cabin = inner.cabin;
    this.cabin.visible = false;
    this.ac.add(this.cabin);
    this.cabinCounts = inner.counts;
    // 起落架
    this.gear = new Gear(M, (mesh, id, opts) => this.reg(mesh, id, opts));
    this.ac.add(this.gear.group);
    // 外部系统细节（信标、天线、进气口、RAT…）与系统模式示意（发电机、E/E 舱、压缩机、能量流）
    this.systems = new Systems(M, (mesh, id, opts) => this.reg(mesh, id, opts), { engines: this.engines });
    const parentOf = (sec) => (sec === 'fairing' ? this.fairing : sec === 'tailcone' ? this.tail.group : this.sectionGroups[sec] || this.ac);
    for (const [sec, g] of Object.entries(this.systems.ext)) parentOf(sec).add(g);
    for (const [sec, g] of Object.entries(this.systems.dia)) parentOf(sec).add(g);

    this.applyControls();
  }

  /** 从注册表移除（几何重建时调用） */
  unreg(obj) {
    obj.traverse((m) => {
      if (!m.isMesh) return;
      const list = this.parts.get(m.userData.partId);
      if (list) { const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); }
      const k = this.meshes.indexOf(m);
      if (k >= 0) this.meshes.splice(k, 1);
    });
  }

  /** 可动翼面状态（角度单位：度） */
  applyControls(st = this.ctl) {
    this.ctl = st || (this.ctl = { slat: 0, krueger: 0, flapIn: 0, flapOut: 0, flaperon: 0, aileron: 0, spoilers: [0, 0, 0, 0, 0, 0, 0], rudder: 0, elevator: 0, stab: 0, apuDoor: 0, gear: 0, roll: 0, rat: 0 });
    // 横滚 roll（-1..1，正 = 向右压盘）：左右副翼/襟副翼反向偏转，下沉一侧的扰流板升起
    const c = this.ctl, roll = c.roll || 0;
    for (const w of this.wings) {
      const r = roll * w.side;
      w.apply({
        ...c,
        aileron: c.aileron + r * 20,
        flaperon: c.flaperon + r * 10,
        spoilers: c.spoilers.map((v, i) => Math.max(v, r < 0 && i >= 1 && i <= 5 ? -r * 30 : 0)),
      });
    }
    this.tail?.apply(this.ctl);
    this.gear?.set(this.ctl.gear || 0);
    this.systems?.setRAT(this.ctl.rat || 0);
  }

  /** 机翼弯曲（翼尖上弯量，米）：重建几何并恢复舵面状态 */
  setFlex(f) {
    for (const w of this.wings) w.build(f);
    for (const e of this.engines) {
      const parent = e.pylon.parent || this.ac; // 保持原父节点（分解视图会把吊挂包进中间组）
      this.unreg(e.pylon);
      e.pylon.removeFromParent();
      e.pylon.geometry.dispose();
      e.follow();
      parent.add(e.pylon);
    }
    this.systems.rebuildFlows(this.engines, f, (o) => this.unreg(o));
    this.applyControls();
    this.onRebuild?.();
  }

  /** 每帧更新（发动机转子等） */
  tick(dt) {
    for (const e of this.engines) e.tick(dt);
    this.systems.tick(dt);
    this.ac.updateMatrixWorld();
    updateHoles(this.ac.matrixWorld);
  }
}
