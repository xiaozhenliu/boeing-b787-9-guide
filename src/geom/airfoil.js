// 翼型：CST（类函数/形函数变换）参数化的超临界翼型 + NACA 对称翼型
// 787 机翼采用超临界翼型：上表面平坦、后缘下表面后加载（带尖凹），可推迟激波、降低波阻。

function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function cst(A, x, te) {
  const n = A.length - 1;
  const C = Math.sqrt(x) * (1 - x);
  let S = 0;
  for (let i = 0; i <= n; i++) S += A[i] * binom(n, i) * Math.pow(x, i) * Math.pow(1 - x, n - i);
  return C * S + x * te;
}

/**
 * 创建翼型。返回 { upper(x,t), lower(x,t), thickness(x,t) }，x∈[0,1]，t 为目标相对厚度。
 * 形状按目标厚度整体缩放（保持翼型族形状）。
 */
export function makeAirfoil({ Au, Al, te = 0.0025 }) {
  // 预计算基准最大厚度
  let tmax = 0;
  for (let i = 1; i < 400; i++) {
    const x = i / 400;
    tmax = Math.max(tmax, cst(Au, x, te / 2) - cst(Al, x, -te / 2));
  }
  return {
    tmax,
    upper: (x, t) => cst(Au, x, te / 2) * (t / tmax),
    lower: (x, t) => cst(Al, x, -te / 2) * (t / tmax),
    camberLine: (x, t) => 0.5 * (cst(Au, x, te / 2) + cst(Al, x, -te / 2)) * (t / tmax),
  };
}

/** 787 主翼用超临界翼型（参照 NASA SC(2) 族特征手工拟合的 CST 系数） */
export const SUPERCRITICAL = makeAirfoil({
  Au: [0.13, 0.12, 0.15, 0.13, 0.2, 0.2],
  Al: [-0.13, -0.12, -0.2, -0.05, 0.02, 0.1],
  te: 0.003,
});

/** 尾翼/挂架/叶片用对称翼型 NACA 00xx（闭合后缘） */
export function nacaThickness(x, t) {
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
}
export const SYMMETRIC = {
  upper: (x, t) => nacaThickness(x, t) + 0.0012 * x,
  lower: (x, t) => -nacaThickness(x, t) - 0.0012 * x,
};

/** 弦向采样：前缘加密（半余弦），适合包含前缘的分段 */
export function chordSamples(a, b, n, mode = 'cos') {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let f;
    if (mode === 'cos') f = 0.5 - 0.5 * Math.cos(Math.PI * t);
    else if (mode === 'le') f = 1 - Math.cos((Math.PI / 2) * t);
    else if (mode === 'te') f = Math.sin((Math.PI / 2) * t);
    else f = t;
    out.push(a + (b - a) * f);
  }
  return out;
}
