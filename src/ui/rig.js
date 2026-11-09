// 相机：平滑飞行、预设机位、第一人称（驾驶舱/客舱）模式、按包围盒聚焦
import * as THREE from 'three';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const FLOOR = 0.45; // 舱外视角下相机离地的最低高度（米）

/** 机体系点 → 世界坐标（世界 x = s − 31，停机俯仰 0.8°） */
export function bodyToWorld(app, s, y, z) {
  return new THREE.Vector3(s, y, z).applyMatrix4(app.aircraft.ac.matrixWorld);
}

// 预设机位（机体系：s 站位 / y 高度 / z 左舷为正）。inside：第一人称（近裁剪面缩小、可仰视）
export const PRESETS = [
  { id: 'overview', label: '总览', eye: [-31, 20, 58], look: [31, 4.5, 0] },
  { id: 'side', label: '左侧', eye: [32, 6.5, 98], look: [32, 6.5, 0] },
  { id: 'front', label: '正前', eye: [-75, 6, 0], look: [31, 6, 0] },
  { id: 'top', label: '俯视', eye: [31, 128, 0.01], look: [31, 0, 0] },
  { id: 'rear', label: '后方', eye: [112, 12, -26], look: [31, 6, 0] },
  { id: 'belly', label: '低角度', eye: [12, 0.9, 26], look: [30, 3.2, 0] },
  { id: 'engine', label: '发动机', eye: [9, 3.6, 21], look: [22.5, 2.6, 9.9] },
  { id: 'gear', label: '主起落架', eye: [40.5, 1.6, 12.5], look: [31.0, 1.6, 4.4] }, // 自后外侧低位看主起落架（避开发动机遮挡）
  { id: 'wing', label: '机翼', eye: [44, 21, 33], look: [31, 4.5, 14] },
  { id: 'tail', label: '尾翼', eye: [76, 15, 26], look: [55, 9, 0] },
  // 驾驶舱：观察员位置（两名飞行员身后、中线上），视线下俯 15°，5 块显示器、HUD、MCP 与油门台同在画面内
  { id: 'cockpit', label: '驾驶舱', eye: [3.5, 5.9, 0], look: [-29.5, -6.11, 0], inside: true }, // 中央观察员座位，俯视 20°：风挡、遮光罩、5 块屏与油门台同框
  // 客舱：站在 2 号门横向通道、左侧过道口（眼高约 1.55 m），沿过道向后看经济舱（身后 s 16.95–17.8 是厨房模块）
  { id: 'cabin', label: '客舱', eye: [18.6, 6.35, 0.925], look: [60, 3.6, 0.925], inside: true, cabin: true },
];

export class Rig {
  constructor(app) {
    this.app = app;
    this.tween = null;
    this.insideMode = false;
    this.onPreset = null; // (preset) => void
    this.onInside = null; // (inside) => void
    this.defaults = { near: app.camera.near, minD: app.controls.minDistance, maxPolar: app.controls.maxPolarAngle };
    app.controls.addEventListener('start', () => { this.endTween(); });
  }

  /** 平滑飞到世界坐标机位 */
  fly(pos, target, { dur = 1.5, inside = false } = {}) {
    const { camera, controls } = this.app;
    this.setInside(inside);
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const p1 = pos.clone(), t1 = target.clone();
    // 远距离飞行时抬高中段弧线，避免穿过机身
    const lift = Math.min(p0.distanceTo(p1) * 0.12, 18) * (inside ? 0 : 1);
    // 视场角随飞行过渡（舱外 32° ↔ 第一人称 58°），避免进出驾驶舱时画面突跳
    const f0 = camera.fov, f1 = this.app.fovFor ? this.app.fovFor(camera.aspect, inside) : f0;
    this.tween = { t: 0, dur, p0, p1, t0, t1, lift, f0, f1 };
    return new Promise((res) => { this.tween.done = res; });
  }

  preset(id, opts = {}) {
    const p = PRESETS.find((q) => q.id === id);
    if (!p) return Promise.resolve();
    const app = this.app;
    let look = bodyToWorld(app, ...p.look);
    const eye = bodyToWorld(app, ...p.eye);
    if (!p.inside) this.portrait(eye, look);
    if (p.inside) look = eye.clone().add(look.sub(eye).normalize().multiplyScalar(0.35));
    this.onPreset?.(p);
    return this.fly(eye, look, { dur: opts.dur ?? (p.inside ? 2.0 : 1.6), inside: !!p.inside });
  }

  /** 中止当前飞行（用户开始拖动时），视场角直接取目标值 */
  endTween() {
    const tw = this.tween;
    if (!tw) return;
    this.tween = null;
    if (tw.f0 !== tw.f1) { this.app.camera.fov = tw.f1; this.app.camera.updateProjectionMatrix(); }
  }

  /** 竖屏（手机）时把舱外机位沿视线拉远，整机不被左右裁掉（原地修改 eye） */
  portrait(eye, look) {
    const a = this.app.camera.aspect;
    if (a < 0.8) eye.sub(look).multiplyScalar(1 + (0.8 - a) * 1.1).add(look);
    return eye;
  }

  /** 第一人称：缩小近裁剪面，允许贴近目标与仰视 */
  setInside(on) {
    const { camera, controls } = this.app, d = this.defaults;
    if (on === this.insideMode) return;
    this.insideMode = on;
    camera.near = on ? 0.03 : d.near;
    camera.updateProjectionMatrix();
    controls.minDistance = on ? 0.05 : d.minD;
    controls.maxPolarAngle = on ? Math.PI * 0.98 : d.maxPolar;
    controls.rotateSpeed = on ? 0.45 : 1;
    controls.zoomSpeed = on ? 0.4 : 1;
    this.onInside?.(on);
  }

  /** 聚焦到包围盒：保持当前观察方向，距离按包围球与视场角确定 */
  focusBox(box, { dur = 1.3, pad = 1.35, dir = null } = {}) {
    const { camera, controls } = this.app;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.4);
    const fov = (camera.fov * Math.PI) / 180;
    const fit = Math.min(fov, fov * camera.aspect);
    const dist = Math.max((r * pad) / Math.sin(fit / 2), 3.2);
    const d = (dir || camera.position.clone().sub(controls.target)).normalize();
    if (d.y < 0.08) d.y = 0.08; // 不钻到地面以下
    d.normalize();
    const pos = sphere.center.clone().addScaledVector(d, dist);
    pos.y = Math.max(pos.y, 0.6);
    return this.fly(pos, sphere.center, { dur, inside: false });
  }

  tick(dt) {
    const { camera, controls } = this.app;
    if (!this.insideMode) {
      // 地面感知的俯仰限制：允许从目标点下方仰视（机腹、RAT、轮舱），但相机始终高于地面 FLOOR。
      // 固定的 maxPolarAngle（≈89°）会把低机位强行抬到目标点高度；这里按当前距离反算允许的最大极角。
      const r = Math.max(camera.position.distanceTo(controls.target), 1e-3);
      const c = THREE.MathUtils.clamp((FLOOR - controls.target.y) / r, -1, 1);
      controls.maxPolarAngle = Math.max(this.defaults.maxPolar, Math.min(Math.acos(c), Math.PI * 0.85));
    }
    const tw = this.tween;
    if (!tw) return;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const k = easeInOut(tw.t);
    camera.position.lerpVectors(tw.p0, tw.p1, k);
    camera.position.y += Math.sin(Math.PI * k) * tw.lift;
    controls.target.lerpVectors(tw.t0, tw.t1, k);
    if (tw.f0 !== tw.f1) { camera.fov = tw.f0 + (tw.f1 - tw.f0) * k; camera.updateProjectionMatrix(); }
    if (tw.t >= 1) { this.tween = null; tw.done?.(); }
  }
}
