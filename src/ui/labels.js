// 三维标注：锚点跟随部件（含铰链运动、分解、机翼弯曲），引线 + 标签，遮挡时隐去（全部模式下淡化），屏幕空间避让
import * as THREE from 'three';
import { h } from './dom.js';

const _w = new THREE.Vector3(), _v = new THREE.Vector3();
const NEAR_DIST = 32; // prio 2 标注在镜头距离小于此值时出现

export class Labels {
  constructor(app, { picker, display, parts, onPick, onEnter, onLeave }) {
    this.app = app;
    this.A = app.aircraft;
    this.picker = picker;
    this.display = display;
    this.parts = parts;
    this.onPick = onPick;
    this.onEnter = onEnter;
    this.onLeave = onLeave;
    this.root = h('div', { class: 'labels' });
    this.svg = h('svg', { class: 'leaders' });
    this.root.append(this.svg);
    document.getElementById('ui').append(this.root);
    this.items = [];
    this.set = 'exterior';
    this.mode = 'auto'; // auto | all | off
    this.selected = null;
    this.rr = 0;
    this.ray = new THREE.Raycaster();
    this.ray.layers.enableAll();
    this.ray.firstHitOnly = true;
  }

  load(spots) {
    for (const spot of spots) {
      const info = this.parts[spot.part] || {};
      const text = spot.label || info.name || spot.part;
      const el = h('button', { class: 'lbl', type: 'button', 'data-cat': info.cat || '' }, h('i', { class: 'dot' }), h('span', { class: 't' }, text));
      const pin = h('i', { class: 'pin', 'data-cat': info.cat || '' });
      const line = h('line', { 'data-cat': info.cat || '' });
      el.style.display = pin.style.display = line.style.display = 'none'; // 与 shown:false 一致，避免未激活集合的标签堆在左上角
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onPick?.(spot.part, { focus: e.detail > 1 }); });
      el.addEventListener('pointerenter', () => this.onEnter?.(spot.part));
      el.addEventListener('pointerleave', () => this.onLeave?.(spot.part));
      this.root.append(pin, el);
      this.svg.append(line);
      this.items.push({ spot, el, pin, line, anchor: null, shown: false, occ: false, x: 0, y: 0, lx: null, ly: null, w: 0, h: 0 });
    }
  }

  setSet(name) { this.set = name; }
  setMode(mode) { this.mode = mode; this.root.classList.toggle('off', mode === 'off'); }
  setSelected(part) {
    this.selected = part;
    for (const it of this.items) it.el.classList.toggle('sel', it.spot.part === part);
  }

  /** 部件网格重建（机翼弯曲）后，重新解析失效锚点 */
  invalidate() {
    const live = new Set(this.A.meshes);
    for (const it of this.items) if (it.anchor?.mesh && !live.has(it.anchor.mesh)) it.anchor = null;
  }

  /** 解析锚点：返回 { obj, local, mesh } —— world = local × obj.matrixWorld */
  resolve(spot) {
    const A = this.A, at = spot.at;
    A.ac.updateMatrixWorld(true);
    if (at.body) {
      const obj = (at.follow && (at.follow === 'fairing' ? A.fairing : A.sectionGroups[at.follow])) || A.ac;
      const local = obj.worldToLocal(new THREE.Vector3(...at.body).applyMatrix4(A.ac.matrixWorld));
      return { obj, local, mesh: null };
    }
    let meshes = (A.parts.get(spot.part) || []).filter((m) => m.geometry.attributes.position.count > 0);
    if (at.sec) meshes = meshes.filter((m) => m.userData.section === at.sec);
    if (!meshes.length) return null;
    const side = at.side ?? 1;
    const all = meshes.map((m) => { const b = new THREE.Box3().setFromObject(m); return { m, b, c: b.getCenter(new THREE.Vector3()) }; });
    let cand = all.filter((o) => o.c.z * side > -0.35);
    if (!cand.length) cand = all;
    const box = new THREE.Box3();
    cand.forEach((o) => box.union(o.b));
    const C = box.getCenter(new THREE.Vector3());
    cand.sort((a, b) => a.c.distanceTo(C) - b.c.distanceTo(C));
    const dir = new THREE.Vector3(...at.dir).normalize().transformDirection(A.ac.matrixWorld);
    for (const o of cand.slice(0, 5)) {
      const r = o.b.getSize(_v).length();
      this.ray.set(o.c.clone().addScaledVector(dir, r + 2), dir.clone().negate());
      const hit = this.ray.intersectObject(o.m, false)[0];
      if (hit) return { obj: o.m, local: o.m.worldToLocal(hit.point.clone().addScaledVector(dir, 0.02)), mesh: o.m };
    }
    const o = cand[0];
    return { obj: o.m, local: o.m.worldToLocal(o.c.clone()), mesh: o.m };
  }

  /** 锚点世界坐标 */
  worldOf(part) {
    const it = this.items.find((q) => q.spot.part === part);
    if (!it) return null;
    if (!it.anchor) it.anchor = this.resolve(it.spot);
    if (!it.anchor) return null;
    it.anchor.obj.updateWorldMatrix(true, false);
    return it.anchor.local.clone().applyMatrix4(it.anchor.obj.matrixWorld);
  }

  tick(dt) {
    if (this.mode === 'off') return;
    const { camera, renderer } = this.app;
    const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
    camera.updateMatrixWorld();
    const cut = this.display.state.cut !== 'none' ? this.display.plane : null;
    const active = [];
    for (const it of this.items) {
      let show = it.spot.set === this.set;
      if (show && !it.anchor) { it.anchor = this.resolve(it.spot); if (!it.anchor) show = false; }
      if (show) {
        _w.copy(it.anchor.local).applyMatrix4(it.anchor.obj.matrixWorld);
        it.world = it.world || new THREE.Vector3();
        it.world.copy(_w);
        const dist = camera.position.distanceTo(_w);
        if (this.mode === 'auto' && it.spot.prio > 1 && dist > NEAR_DIST && it.spot.part !== this.selected) show = false;
        if (show && it.anchor.mesh && !this.picker.visible(it.anchor.mesh)) show = false;
        if (show && cut && cut.distanceToPoint(_w) < -0.05) show = false;
        if (show) {
          _v.copy(_w).applyMatrix4(camera.matrixWorldInverse);
          if (_v.z > -camera.near * 2) show = false;
        }
        if (show) {
          _v.copy(_w).project(camera);
          it.x = (_v.x * 0.5 + 0.5) * W;
          it.y = (-_v.y * 0.5 + 0.5) * H;
          if (it.x < -40 || it.x > W + 40 || it.y < -40 || it.y > H + 40) show = false;
        }
      }
      if (show !== it.shown) {
        it.shown = show;
        if (it.gone) { it.gone = false; it.el.classList.remove('gone'); it.pin.classList.remove('gone'); it.line.classList.remove('gone'); }
        it.el.style.display = it.pin.style.display = it.line.style.display = show ? '' : 'none';
        if (show) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; it.lx = null; }
      }
      if (show) active.push(it);
    }
    // 遮挡检测：每帧轮询少量标注
    if (active.length) {
      if (!this.picker.solidList) this.picker.refreshSolid();
      for (let k = 0; k < Math.min(6, active.length); k++) {
        const it = active[(this.rr + k) % active.length];
        it.occ = this.picker.occluded(it.world, camera, null, it.spot.part);
      }
      this.rr = (this.rr + 6) % Math.max(1, active.length);
    }
    this.layout(active, W, H, dt);
  }

  /** 屏幕空间避让：按期望位置排序，逐个向上/下推开重叠的标签 */
  layout(active, W, H, dt) {
    const placed = [];
    const order = active.slice().sort((a, b) => (a.spot.prio - b.spot.prio) || (a.y - b.y));
    for (const it of order) {
      // 自动模式下，被遮挡的标注直接隐去、不参与避让：看不见的部件不该有标签（例如从机尾看时的“驾驶舱”）。
      // 选中部件的标注始终保留；“全部”模式下被遮挡的标注仍以淡化方式显示。
      const gone = this.mode === 'auto' && it.occ && it.spot.part !== this.selected;
      if (gone !== !!it.gone) {
        it.gone = gone;
        it.el.classList.toggle('gone', gone); it.pin.classList.toggle('gone', gone); it.line.classList.toggle('gone', gone);
        if (!gone) it.lx = null; // 重新出现时直接落位，不从旧位置滑过来
      }
      if (gone) continue;
      const [ox, oy] = it.spot.off || [0, -56];
      let x = it.x + ox - it.w / 2, y = it.y + oy - it.h / 2;
      x = Math.min(Math.max(x, 8), W - it.w - 8);
      y = Math.min(Math.max(y, 8), H - it.h - 8);
      for (let iter = 0; iter < 12; iter++) {
        const hit = placed.find((p) => x < p.x + p.w + 6 && x + it.w + 6 > p.x && y < p.y + p.h + 4 && y + it.h + 4 > p.y);
        if (!hit) break;
        const up = hit.y - it.h - 4, down = hit.y + hit.h + 4;
        y = Math.abs(up - y) < Math.abs(down - y) && up > 8 ? up : down;
      }
      placed.push({ x, y, w: it.w, h: it.h });
      const k = it.lx == null ? 1 : Math.min(1, dt * 14);
      it.lx = it.lx == null ? x : it.lx + (x - it.lx) * k;
      it.ly = it.ly == null ? y : it.ly + (y - it.ly) * k;
      it.el.style.transform = `translate(${it.lx.toFixed(1)}px, ${it.ly.toFixed(1)}px)`;
      it.pin.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`;
      // 引线连到标签矩形上离锚点最近的点
      const cx = Math.min(Math.max(it.x, it.lx), it.lx + it.w), cy = Math.min(Math.max(it.y, it.ly), it.ly + it.h);
      it.line.setAttribute('x1', it.x.toFixed(1)); it.line.setAttribute('y1', it.y.toFixed(1));
      it.line.setAttribute('x2', cx.toFixed(1)); it.line.setAttribute('y2', cy.toFixed(1));
      const occ = it.occ && it.spot.part !== this.selected;
      it.el.classList.toggle('occ', occ);
      it.pin.classList.toggle('occ', occ);
      it.line.classList.toggle('occ', occ);
    }
  }
}
