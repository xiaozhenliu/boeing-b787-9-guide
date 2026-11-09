// 翼身整流罩（机腹整流罩）：沿机身法线外凸的光顺曲面，包覆翼根下表面、主起落架舱与空调组件舱。
// 曲面以机身参数 (s, τ) 为底，外凸量 d(s,τ) 在边缘处略小于零 → 与机身干净相交，无重面闪烁。
// UV 与机身蒙皮一致（u=s/L, v=τ/2π），可直接复用机身涂装纹理。
import * as THREE from 'three';
import { point, normal, FUS } from './fuselage.js';
import { grid } from '../geom/build.js';
import { smoothstep, clamp } from '../core/math.js';

export const FAIRING = { s0: 18.8, s1: 42.0, tMax: 1.62 }; // 前端在 2 号门之后、后端止于后货舱门（s 41.96）之前

/** 纵向包络：前端较陡、后端细长收敛 */
function longi(s) {
  const { s0, s1 } = FAIRING;
  const a = smoothstep(s0, s0 + 6.2, s);
  const b = 1 - smoothstep(s1 - 10.5, s1, s);
  return a * b;
}

/** 翼根区域权重（侧向鼓包只在翼根前后缘之间饱满） */
function rootW(s) {
  return smoothstep(21.2, 24.6, s) * (1 - smoothstep(34.0, 40.0, s));
}

/** 外凸量（米） */
export function fairingOffset(s, tau) {
  const at = Math.abs(tau);
  const L = longi(s), R = rootW(s);
  const belly = 0.3 * L; // 机腹下凸
  const side = 0.42 * R * Math.exp(-(((at - 0.86) / 0.36) ** 2)); // 翼根下方侧向鼓包
  const lim = 1 - smoothstep(0.95 + 0.25 * R, 1.25 + 0.33 * R, at); // 周向收敛
  return (belly + side) * lim - 0.014;
}

export function fairingGeometry() {
  const { s0, s1, tMax } = FAIRING;
  const rows = Math.ceil((s1 - s0) / 0.2) + 1;
  const cols = 150;
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  const g = grid(rows, cols, (i, j, out) => {
    const s = s0 + ((s1 - s0) * i) / (rows - 1);
    const tau = -tMax + (2 * tMax * j) / (cols - 1);
    point(s, tau, P);
    normal(s, tau, N);
    out.copy(P).addScaledVector(N, fairingOffset(s, tau));
  }, {
    uv: (i, j) => [(s0 + ((s1 - s0) * i) / (rows - 1)) / FUS.L, (-tMax + (2 * tMax * j) / (cols - 1)) / (Math.PI * 2)],
  });
  // grid 的默认绕序：行沿 +s、列沿 +τ（左舷向上）→ 法线 = ds × dτ，在机腹处指向下方（朝外）——无需翻转
  return g;
}

/**
 * 整流罩上的空调冲压进气口（每侧上下两个，位于翼根前缘下方）：
 * kind 'ram' —— 上方方形口，给空调组件热交换器提供冷却空气（用后排出机外，不进客舱）；
 * kind 'cac' —— 下方凸出的固定进气斗，后接两台电动座舱空气压缩机（全机 4 台）。
 */
export function cacInletFrames() {
  const out = [];
  for (const side of [1, -1]) {
    for (const [kind, s, tau] of [['ram', 22.15, 1.0], ['cac', 22.45, 0.85]]) {
      const t = side * tau;
      const p = point(s, t, new THREE.Vector3());
      const n = normal(s, t, new THREE.Vector3());
      p.addScaledVector(n, fairingOffset(s, t));
      out.push({ kind, s, t, p, n, side });
    }
  }
  return out;
}

export { clamp };
