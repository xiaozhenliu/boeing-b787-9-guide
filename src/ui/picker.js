// 拾取：three-mesh-bvh 加速射线检测。BVH 在空闲时分批预建，避免首次悬停卡顿。
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { HIDE_LAYER } from './display.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 30));

export class Picker {
  constructor(app, display) {
    this.app = app;
    this.display = display;
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.ray.layers.set(0);
    this.queue = [];
    this.prebuild();
  }

  /** 空闲时预建 BVH（几何重建后再次调用即可补齐） */
  prebuild() {
    const seen = new Set(this.queue);
    for (const m of this.app.aircraft.meshes) {
      const g = m.geometry;
      if (!g.boundsTree && !seen.has(g) && g.attributes.position.count > 60) { this.queue.push(g); seen.add(g); }
    }
    const step = (dl) => {
      while (this.queue.length && dl.timeRemaining() > 2) {
        const g = this.queue.shift();
        if (!g.boundsTree && g.attributes?.position) g.computeBoundsTree({ targetLeafSize: 12 });
      }
      if (this.queue.length) idle(step);
    };
    if (this.queue.length) idle(step);
  }

  /** 当前可拾取的网格：自身可见、所有祖先可见、未被图层隐藏 */
  visible(m) {
    if (m.layers.isEnabled(HIDE_LAYER) && !m.layers.isEnabled(0)) return false;
    for (let o = m; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  candidates({ skipGhost = true } = {}) {
    const { M } = this.app, d = this.display;
    return this.app.aircraft.meshes.filter((m) => {
      if (!this.visible(m)) return false;
      if (skipGhost && (m.material === M.ghost || m.material === M.ghostWing || m.material === d.faint)) return false;
      return true;
    });
  }

  /** ndc：归一化设备坐标。返回最近命中 { mesh, point, distance, partId }（透视层下优先内部部件） */
  pick(ndc, camera = this.app.camera) {
    this.ray.setFromCamera(ndc, camera);
    const cut = this.display.state.cut !== 'none' ? this.display.plane : null;
    const test = (list) => {
      const hits = this.ray.intersectObjects(list, false);
      for (const h of hits) {
        if (cut && cut.distanceToPoint(h.point) < 0) continue; // 被剖切掉的部分不响应
        return h;
      }
      return null;
    };
    let h = test(this.candidates());
    if (!h) h = test(this.candidates({ skipGhost: false }));
    if (!h) return null;
    return { mesh: h.object, point: h.point, distance: h.distance, partId: h.object.userData.partId };
  }

  /** 遮挡测试：从相机到点之间是否有可见实体（用于标注淡化） */
  // ownPart：锚点所属部件。锚点附近（2 m 内）命中自身部件不算遮挡——起落架这类锚点落在支柱/机轮之间的部件，
  // 射线总会先擦到自身；离锚点更远的自身表面（如从下方看机翼上表面的锚点）仍算遮挡。
  occluded(world, camera = this.app.camera, list = null, ownPart = null) {
    const o = camera.position;
    const dir = world.clone().sub(o);
    const dist = dir.length();
    this.ray.set(o, dir.multiplyScalar(1 / dist));
    this.ray.far = dist - 0.12;
    const hits = this.ray.intersectObjects(list || this.solidList || this.candidates(), false);
    this.ray.far = Infinity;
    const cut = this.display.state.cut !== 'none' ? this.display.plane : null;
    for (const h of hits) {
      if (ownPart && h.object.userData.partId === ownPart && dist - h.distance < 2) continue;
      if (!cut || cut.distanceToPoint(h.point) >= 0) return true;
    }
    return false;
  }

  /** 遮挡测试用的实体列表（每次显示状态变化时刷新） */
  refreshSolid() {
    const { M } = this.app;
    this.solidList = this.candidates().filter((m) => !m.material.transparent || m.material === M.glass || m.material === M.cockpitGlass);
  }
}
