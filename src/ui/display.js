// 显示管理：配色方案（真实涂装/材料/分段）、蒙皮（实体/透视/隐藏）、内部图层、分解、剖切、隔离、高亮。
// 所有“隐藏”都通过图层（layers）实现，不改 mesh.visible——起落架等模块自己会切换 visible。
import * as THREE from 'three';
import { SECTION_COLORS, CUT } from '../render/materials.js';
import { HOLES } from '../render/holes.js';

export const HIDE_LAYER = 7;
const FUS_SECS = new Set(['radome', 's41', 's43', 's44', 's46', 's47', 's48', 'tailcone', 'fairing']);
const CORE_SECS = new Set([...FUS_SECS, 's11', 'cabin']); // “俯剖客舱”只切机身相关
// 分解位移（米，乘以分解系数）：以 44 段（中央翼盒所在）为基准，前后各段依次拉开
export const EXPLODE = { radome: -7.5, s41: -5, s43: -2.5, s44: 0, s11: 0, s46: 2.5, s47: 5, s48: 7.5, tailcone: 10 };
// partId → 分段配色键（模型的 section 字段较粗，这里细分到供应商工作包）
const PART_SECTION = {
  vtail: 'vfin', rudder: 'vfin', htail: 'hstab', elevator: 'hstab', tailSpars: 'vfin', tailRibs: 'vfin',
  pylon: 'pylon', inlet: 'nacelle', nacelle: 'nacelle', reverser: 'nacelle', fanCase: 'nacelle',
  gearDoors: 'gear', wheelWell: 's45', apu: 'tailcone', apuDoor: 'tailcone',
};
const EXTRA_COLORS = { pylon: '#d8a25e', cabin: null };

export function sectionKey(ud) {
  if (PART_SECTION[ud.partId]) return PART_SECTION[ud.partId];
  if (ud.section === 'empennage') return 'vfin';
  return ud.section;
}

/** 选中高亮：菲涅尔描边 + 呼吸，叠加在原网格上（共享几何） */
function highlightMaterial(color = '#ffae2b') {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, clipping: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    vertexShader: `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vV = -mvPosition.xyz; vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uTime;
      varying vec3 vN; varying vec3 vV;
      void main(){
        #include <clipping_planes_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float pulse = 0.82 + 0.18 * sin(uTime * 3.2);
        gl_FragColor = vec4(uColor * (0.9 + 0.6 * f), (0.16 + 0.62 * f) * pulse);
      }`,
  });
}

/** 隔离显示时其他部件的淡化材质 */
function faintMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, clipping: true,
    uniforms: { uColor: { value: new THREE.Color('#8fb8e0') } },
    vertexShader: `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
      void main(){
        #include <clipping_planes_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
        gl_FragColor = vec4(uColor, 0.02 + 0.2 * f);
      }`,
  });
}

export class Display {
  constructor(app) {
    this.app = app;
    this.A = app.aircraft;
    this.M = app.M;
    this.state = {
      scheme: 'paint', // paint | materials | sections
      skin: 'solid', // solid | ghost | hidden
      structure: false,
      cabin: false,
      explode: 0,
      cut: 'none', // none | x（横剖）| z（纵剖）| y（俯剖）
      cutPos: 0.5,
      engineCut: false,
      systems: false, // 系统示意（发电机、E/E 舱、压缩机、能量流）
      isolate: null, // { key, value } 例如 { key: 'partId', value: 'mainGear' }
    };
    this.listeners = new Set();
    this.sectionMats = {};
    this.hl = highlightMaterial();
    this.hlGroup = highlightMaterial('#5fd0ff');
    this.faint = faintMaterial();
    this.overlays = [];
    this.plane = new THREE.Plane();
    this.planes = [this.plane];
    this.clipped = new Set();
    this.holeBase = HOLES.boxes.map((m) => m.clone());
    this.buildExplodeRig();
    this.A.onRebuild = () => { this.refresh(); this.emit('rebuild'); };
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) { for (const f of this.listeners) f(what, this.state); }

  // ———————————————— 分解视图 ————————————————
  /** 把需要整体移动的部件包进中间组（铰链部件使用局部矩阵，套一层组不影响其运动） */
  buildExplodeRig() {
    const A = this.A;
    const wrap = (parent, children, name) => {
      const g = new THREE.Group();
      g.name = name;
      parent.add(g);
      for (const c of children) g.add(c);
      return g;
    };
    this.engineWraps = A.engines.map((e) => wrap(A.ac, [e.group], 'explode-engine'));
    this.pylonWraps = A.engines.map((e) => wrap(A.ac, [e.pylon], 'explode-pylon'));
    const tailKids = [...A.tail.group.children];
    const isCone = (o) => o.userData?.section === 'tailcone';
    this.tailFin = wrap(A.tail.group, tailKids.filter((o) => !isCone(o)), 'explode-fin');
    this.tailCone = wrap(A.tail.group, tailKids.filter(isCone), 'explode-cone');
  }

  setExplode(e) {
    const A = this.A, X = EXPLODE;
    this.state.explode = e;
    for (const [sec, g] of Object.entries(A.sectionGroups)) g.position.x = (X[sec] || 0) * e;
    for (const [sec, g] of Object.entries(A.structBySec || {})) g.position.x = (X[sec] || 0) * e;
    A.fairing.position.y = -1.3 * e;
    A.wings.forEach((w) => { w.group.position.z = w.side * 4.5 * e; w.structGroup.position.z = w.side * 4.5 * e; });
    A.engines.forEach((en, i) => {
      this.engineWraps[i].position.set(0, -2.4 * e, en.side * 4.5 * e);
      this.pylonWraps[i].position.set(0, -1.1 * e, en.side * 4.5 * e);
    });
    this.tailFin.position.set(X.s48 * e + 0.8 * e, 2.8 * e, 0);
    A.tail.structGroup.position.copy(this.tailFin.position);
    this.tailCone.position.set(X.tailcone * e, 0, 0);
    A.gear.noseGroup.position.x = X.s41 * e;
    // 前轮舱开洞随 41 段移动（主轮舱位于 44 段，基准不动）
    HOLES.boxes[0].copy(this.holeBase[0]).premultiply(new THREE.Matrix4().makeTranslation(X.s41 * e, 0, 0));
    HOLES.boxes[3].copy(this.holeBase[3]).premultiply(new THREE.Matrix4().makeTranslation(0, -1.3 * e, 0)); // RAT 舱随整流罩下移
    this.emit('explode');
  }

  /** 机翼弯曲重建后吊挂是新网格：重新放回分解组 */
  rewrapPylons() {
    this.A.engines.forEach((e, i) => { if (e.pylon.parent !== this.pylonWraps[i]) this.pylonWraps[i].add(e.pylon); });
  }

  // ———————————————— 材质分配 ————————————————
  sectionMaterial(key) {
    if (!(key in this.sectionMats)) {
      const c = SECTION_COLORS[key] || EXTRA_COLORS[key];
      this.sectionMats[key] = c ? new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }) : null;
    }
    return this.sectionMats[key];
  }

  isSkin(ud) { return ud.role === 'skin' || ud.role === 'skinDetail'; }

  matchIsolate(ud) {
    const iso = this.state.isolate;
    if (!iso) return true;
    if (iso.key === 'section') return sectionKey(ud) === iso.value;
    return ud[iso.key] === iso.value;
  }

  materialFor(mesh) {
    const ud = mesh.userData, S = this.state, M = this.M;
    if (S.isolate && !this.matchIsolate(ud)) return this.faint;
    if (ud.role === 'systems') return ud.baseMaterial; // 系统示意始终用自身配色
    if (S.systems && ud.role === 'engineCore' && !S.isolate) return M.ghostWing; // 系统视图里核心机只留轮廓，不与能量流配色抢眼
    if (S.skin === 'ghost' && this.isSkin(ud) && !S.isolate) return FUS_SECS.has(ud.section) ? M.ghost : M.ghostWing;
    if (S.scheme === 'materials' && ud.role !== 'cabin') return M[ud.comp] || M.compOther;
    if (S.scheme === 'sections' && ud.role !== 'cabin' && ud.role !== 'engineCore') return this.sectionMaterial(sectionKey(ud)) || ud.baseMaterial;
    return ud.baseMaterial;
  }

  /** 是否显示（图层）：蒙皮隐藏模式下隐去外表面 */
  shown(mesh) {
    const ud = mesh.userData, S = this.state;
    const isoHit = S.isolate && this.matchIsolate(ud);
    if (S.skin === 'hidden' && this.isSkin(ud) && !isoHit) return false;
    if (ud.role === 'systems' && !S.systems && !isoHit) return false;
    return true;
  }

  refresh() {
    const A = this.A, S = this.state;
    this.rewrapPylons();
    const iso = S.isolate;
    // 隔离对象若在内部图层中，自动打开该图层
    const isoRoles = new Set();
    if (iso) for (const m of A.meshes) if (this.matchIsolate(m.userData)) isoRoles.add(m.userData.role);
    A.structure.visible = S.structure || isoRoles.has('structure');
    A.cabin.visible = S.cabin || isoRoles.has('cabin');
    const showCore = S.engineCut || S.skin !== 'solid' || isoRoles.has('engineCore');
    for (const e of A.engines) {
      if (S.engineCut !== !!e.cutOn) e.setCutaway(S.engineCut);
      e.internals.visible = showCore;
    }
    for (const m of A.meshes) {
      const mat = this.materialFor(m);
      if (m.material !== mat) m.material = mat;
      const vis = this.shown(m);
      if (vis) m.layers.set(0); else m.layers.set(HIDE_LAYER);
    }
    this.applyCut();
    this.syncOverlays();
    this.emit('refresh');
  }

  set(patch) {
    const before = { ...this.state };
    Object.assign(this.state, patch);
    if (patch.engineCut && this.state.cut !== 'none') this.state.cut = 'none'; // 发动机剖视与整机剖切互斥
    if (patch.cut && patch.cut !== 'none') this.state.engineCut = false;
    if ('explode' in patch && patch.explode !== before.explode) this.setExplode(patch.explode);
    this.refresh();
  }

  // ———————————————— 剖切 ————————————————
  /** 剖切平面（世界坐标，随机体姿态）。x：保留站位 > s 的部分；z：保留右半机；y：去掉机身上部 */
  updatePlane() {
    const S = this.state, A = this.A;
    const mw = A.ac.matrixWorld;
    const n = new THREE.Vector3(), p = new THREE.Vector3();
    if (S.cut === 'x') { n.set(1, 0, 0); p.set(-1 + S.cutPos * 65, 0, 0); }
    else if (S.cut === 'z') { n.set(0, 0, -1); p.set(0, 0, 0); }
    else if (S.cut === 'y') { n.set(0, -1, 0); p.set(0, 1.85 + 2.95 + 0.9 + (S.cutPos - 0.5) * 2.4, 0); }
    else return;
    n.transformDirection(mw);
    p.applyMatrix4(mw);
    this.plane.setFromNormalAndCoplanarPoint(n, p);
  }

  cutTargets() {
    const S = this.state, out = new Set();
    if (S.cut === 'none') return out;
    for (const m of this.A.meshes) {
      if (S.cut === 'y' && !CORE_SECS.has(m.userData.section) && m.userData.role !== 'structure') continue;
      if (S.cut === 'y' && m.userData.section === 'empennage') continue;
      out.add(m.material);
    }
    out.add(this.hl); out.add(this.hlGroup); out.add(this.faint);
    return out;
  }

  applyCut() {
    const targets = this.cutTargets();
    for (const mat of this.clipped) {
      if (!targets.has(mat) && mat.clippingPlanes === this.planes) { mat.clippingPlanes = null; mat.needsUpdate = true; }
    }
    for (const mat of targets) {
      if (mat.clippingPlanes !== this.planes) { mat.clippingPlanes = this.planes; mat.clipIntersection = false; mat.needsUpdate = true; }
    }
    this.clipped = targets;
    CUT.on.value = this.state.cut !== 'none' ? 1 : 0;
    this.updatePlane();
  }

  // ———————————————— 高亮 ————————————————
  /** 高亮一组网格（selection：主选择，橙色；group：图例/分组，青色） */
  highlight(meshes, kind = 'selection') {
    this.clearOverlays(kind);
    const mat = kind === 'selection' ? this.hl : this.hlGroup;
    for (const m of meshes) {
      const o = new THREE.Mesh(m.geometry, mat);
      o.raycast = () => {};
      o.userData.overlayKind = kind;
      o.renderOrder = 5;
      o.matrixAutoUpdate = false;
      m.add(o);
      this.overlays.push(o);
    }
    this.syncOverlays();
  }

  clearOverlays(kind) {
    this.overlays = this.overlays.filter((o) => {
      if (kind && o.userData.overlayKind !== kind) return true;
      o.removeFromParent();
      return false;
    });
  }

  /** 覆盖层跟随宿主的显示图层 */
  syncOverlays() {
    for (const o of this.overlays) o.layers.mask = o.parent ? o.parent.layers.mask : 0;
  }

  tick(dt) {
    this.hl.uniforms.uTime.value += dt;
    this.hlGroup.uniforms.uTime.value += dt;
    if (this.state.cut !== 'none') this.updatePlane();
  }

  /** 按条件收集网格 */
  meshesWhere(key, value) {
    return this.A.meshes.filter((m) => (key === 'section' ? sectionKey(m.userData) === value : m.userData[key] === value));
  }
}
