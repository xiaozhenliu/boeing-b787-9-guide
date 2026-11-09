// 环境与灯光：昼夜切换、电致变色舷窗调光（五档）、航行灯/防撞灯/频闪灯
import * as THREE from 'three';

// 舷窗外观（从外向里看）：调光越深越接近墨蓝；夜间客舱灯光透出暖色
const TINT = [0x2b4a66, 0x1d3854, 0x132a44, 0x0b1c31, 0x050c18];
const GLOW = [1, 0.62, 0.34, 0.14, 0.03];

export class Ambience {
  constructor(app) {
    this.app = app;
    this.M = app.M;
    this.night = false;
    this.tint = 0; // 0..4
    this.tintCur = 0;
    this.cabinLights = true;
    this.t = 0;
    this.flashers = []; // { mat, pattern(t) → 0..1, base, peak }
    this.M.glass.emissive = new THREE.Color(0xffd7a0);
    this.M.glass.emissiveIntensity = 0;
    this.addFlasher(this.M.strobe, STROBE, 0.3, 9);
    this.addFlasher(this.M.beacon, BEACON, 0.35, 7);
    this.apply();
  }

  setNight(on) {
    this.night = on;
    this.app.env.setNight(on);
    this.app.renderer.toneMappingExposure = on ? 1.25 : 1.0;
    this.apply();
  }

  setTint(level) { this.tint = level; }

  /** 注册闪烁灯（频闪 / 防撞信标） */
  addFlasher(mat, pattern, base = 0.6, peak = 6) { this.flashers.push({ mat, pattern, base, peak }); }

  apply() {
    const M = this.M, n = this.night;
    for (const m of [M.lightRed, M.lightGreen, M.lightWhite]) m.emissiveIntensity = n ? 3.2 : 0.6;
    M.landingLens.emissiveIntensity = n ? 2.4 : 0; // 夜间着陆灯点亮
  }

  tick(dt) {
    this.t += dt;
    // 舷窗调光：真实电致变色需一两分钟才完全变暗，这里加速到约 3 秒
    if (this.tintCur !== this.tint) {
      const d = this.tint - this.tintCur, step = dt / 0.75;
      this.tintCur = Math.abs(d) <= step ? this.tint : this.tintCur + Math.sign(d) * step;
    }
    const i = Math.min(3, Math.floor(this.tintCur)), f = this.tintCur - i;
    const c0 = new THREE.Color(TINT[i]), c1 = new THREE.Color(TINT[Math.min(4, i + 1)]);
    this.M.glass.color.copy(c0.lerp(c1, f));
    const glow = GLOW[i] + (GLOW[Math.min(4, i + 1)] - GLOW[i]) * f;
    this.M.glass.emissiveIntensity = this.night && this.cabinLights ? 1.15 * glow : 0;
    for (const fl of this.flashers) fl.mat.emissiveIntensity = fl.base + (fl.peak - fl.base) * fl.pattern(this.t) * (this.night ? 1 : 0.6);
  }
}

/** 闪光节律：频闪（白，约每秒 1 次，双闪）与防撞信标（红，约每秒 1 次） */
export const STROBE = (t) => { const p = t % 1.2; return p < 0.06 || (p > 0.14 && p < 0.2) ? 1 : 0; };
export const BEACON = (t) => { const p = (t + 0.4) % 1.0; return Math.max(0, 1 - Math.abs(p - 0.1) / 0.1); };
