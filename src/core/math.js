// 通用数学工具：插值、平滑函数、单调样条、超椭圆型线
export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (x - a) / (b - a);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 分段线性插值。pts = [[x0,y0],[x1,y1],...]，x 递增；超出范围取端值 */
export function pwl(pts, x) {
  const n = pts.length;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pts[m][0] <= x) lo = m; else hi = m;
  }
  const [x0, y0] = pts[lo], [x1, y1] = pts[hi];
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

/**
 * 单调三次 Hermite 样条（Fritsch–Carlson），无过冲，适合型线。
 * endSlopes: [s0, s1] 可选，强制端点斜率（如与等截面段相切时为 0）。
 */
export function monotone(pts, endSlopes) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  if (endSlopes) {
    if (endSlopes[0] != null) m[0] = endSlopes[0];
    if (endSlopes[1] != null) m[n - 1] = endSlopes[1];
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] +
      (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
  };
}

/** 超椭圆过渡函数 F(u) = (1-(1-u)^p)^(1/q)：u=0 处竖直切线（q>1 时钝头），u=1 处与常值相切 */
export function superRamp(u, p, q) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return Math.pow(1 - Math.pow(1 - u, p), 1 / q);
}

/** 带符号幂 */
export const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

/** 生成 [a,b] 内 n+1 个点，按给定函数分布（默认均匀） */
export function range(a, b, n, dist = (t) => t) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(a + (b - a) * dist(i / n));
  return out;
}

/** 余弦分布（两端加密） */
export const cosDist = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/** 合并多个有序数组并去掉过近的重复值 */
export function mergeStations(arrays, eps = 1e-4) {
  const all = arrays.flat().sort((a, b) => a - b);
  const out = [];
  for (const v of all) if (!out.length || v - out[out.length - 1] > eps) out.push(v);
  return out;
}

/** 确定性伪随机（mulberry32），保证每次生成的细节一致 */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
