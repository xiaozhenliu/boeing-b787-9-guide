// 操纵面动画：所有操纵量都有“目标值”，每帧按真实感速率逼近，再统一写回飞机模型
// 角度单位：度。gear 0 = 放下，1 = 收上。
const RATE = {
  slat: 8, krueger: 60, flapIn: 6, flapOut: 6, flaperon: 8, aileron: 40, roll: 1.6, spoiler: 45,
  rudder: 30, elevator: 30, stab: 0.8, apuDoor: 0.5, gear: 1 / 7.5, n1: 0.22, reverser: 0.6, rat: 0.45,
};

// 襟翼手柄卡位 → 各装置角度（前缘：1–20 档缝翼在“密封”中间位，25/30 档全伸出并开缝）
export const FLAP_DETENTS = [
  { id: 'UP', flap: 0, slat: 0, krueger: 0 },
  { id: '1', flap: 0, slat: 17, krueger: 95 },
  { id: '5', flap: 5, slat: 17, krueger: 95 },
  { id: '15', flap: 15, slat: 17, krueger: 95 },
  { id: '17', flap: 17, slat: 17, krueger: 95 },
  { id: '18', flap: 18, slat: 17, krueger: 95 },
  { id: '20', flap: 20, slat: 17, krueger: 95 },
  { id: '25', flap: 25, slat: 25, krueger: 95 },
  { id: '30', flap: 30, slat: 25, krueger: 95 },
];

const approach = (cur, tgt, rate, dt) => {
  const d = tgt - cur, step = rate * dt;
  return Math.abs(d) <= step ? tgt : cur + Math.sign(d) * step;
};

export class FlightControls {
  constructor(app) {
    this.app = app;
    this.A = app.aircraft;
    const z = { slat: 0, krueger: 0, flapIn: 0, flapOut: 0, flaperon: 0, aileron: 0, roll: 0, speedbrake: 0, rudder: 0, elevator: 0, stab: 0, apuDoor: 0, gear: 0, n1: 0, reverser: 0, rat: 0 };
    this.cur = { ...z };
    this.tgt = { ...z };
    this.detent = 'UP';
    this.listeners = new Set();
    this.dirty = true;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** 设置目标值（instant=true 时立即到位，用于导览跳步） */
  set(patch, instant = false) {
    Object.assign(this.tgt, patch);
    if (instant) Object.assign(this.cur, patch);
    this.dirty = true;
    for (const f of this.listeners) f(this.tgt);
  }

  setFlaps(id, instant = false) {
    const d = FLAP_DETENTS.find((q) => q.id === String(id)) || FLAP_DETENTS[0];
    this.detent = d.id;
    // 襟副翼随襟翼下垂（约为襟翼角的 2/3，上限 20°）
    this.set({ flapIn: d.flap, flapOut: d.flap, flaperon: Math.min(d.flap * 0.66, 20), slat: d.slat, krueger: d.krueger }, instant);
  }

  reset(instant = false) {
    this.detent = 'UP';
    this.set({ slat: 0, krueger: 0, flapIn: 0, flapOut: 0, flaperon: 0, aileron: 0, roll: 0, speedbrake: 0, rudder: 0, elevator: 0, stab: 0, apuDoor: 0, gear: 0, n1: 0, reverser: 0, rat: 0 }, instant);
  }

  /** 是否仍在运动 */
  get moving() {
    for (const k in this.tgt) if (this.tgt[k] !== this.cur[k]) return true;
    return false;
  }

  tick(dt) {
    if (!this.dirty) return;
    const c = this.cur, t = this.tgt;
    let still = true;
    for (const k in t) {
      if (c[k] === t[k]) continue;
      const rate = k === 'speedbrake' ? 1.2 : RATE[k] ?? 1;
      c[k] = approach(c[k], t[k], rate, dt);
      if (c[k] !== t[k]) still = false;
    }
    this.write();
    if (still) this.dirty = false;
  }

  write() {
    const c = this.cur, A = this.A, ctl = A.ctl;
    Object.assign(ctl, {
      slat: c.slat, krueger: c.krueger, flapIn: c.flapIn, flapOut: c.flapOut, flaperon: c.flaperon, aileron: c.aileron,
      roll: c.roll, rudder: c.rudder, elevator: c.elevator, stab: c.stab, apuDoor: c.apuDoor, gear: c.gear, rat: c.rat,
      spoilers: ctl.spoilers.map(() => c.speedbrake * 55),
    });
    A.applyControls();
    for (const e of A.engines) { e.n1 = c.n1; e.setReverser(c.reverser); }
  }
}
