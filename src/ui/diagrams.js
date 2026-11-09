// 讲解面板中的示意图（纯 SVG，代码绘制）：复合材料铺层、长桁/隔框截面、引气与无引气对比。
// diagramFor(partId) → { svg, caption } | null
import { h } from './dom.js';

const W = 312;
const f1 = (n) => n.toFixed(1);

/** 线段 p + t·d 裁剪到单位正方形 [0,1]²（Liang–Barsky），返回 [t0, t1] 或 null */
function clipUnit(px, py, dx, dy) {
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, d] of [[px, dx], [py, dy]]) {
    if (Math.abs(d) < 1e-9) { if (p < 0 || p > 1) return null; continue; }
    let a = (0 - p) / d, b = (1 - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t0 < t1 ? [t0, t1] : null;
}

/** 复合材料层合板：四个铺层分解叠放，纤维方向 0° / +45° / −45° / 90° */
function laminate() {
  const plies = [
    { a: 0, name: '0°', note: '轴向：承受弯曲引起的拉压', c: '#4cc3ff' },
    { a: 45, name: '+45°', note: '承受剪切与扭转', c: '#7ee081' },
    { a: -45, name: '−45°', note: '与 +45° 成对、保持对称', c: '#b48cff' },
    { a: 90, name: '90°', note: '周向：承受增压的环向力', c: '#ffae2b' },
  ];
  const A = [108, 0], B = [38, -26]; // 铺层平面在屏幕上的两条边（u：0° 方向，v：90° 方向）
  const H = 34 + plies.length * 30 + 10;
  const kids = [];
  plies.forEach((p, i) => {
    const ox = 14 + i * 7, oy = H - 14 - (plies.length - 1 - i) * 30; // 自上而下：0° 在最上
    const P = (u, v) => [ox + u * A[0] + v * B[0], oy + u * A[1] + v * B[1]];
    const quad = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)].map((q) => q.map(f1).join(',')).join(' ');
    const lines = [];
    const th = (p.a * Math.PI) / 180, dx = Math.cos(th), dy = Math.sin(th);
    const nx = -dy, ny = dx; // 法向：按间距平移
    for (let k = -1.6; k <= 1.6; k += 0.085) {
      const px = 0.5 + nx * k - dx * 2, py = 0.5 + ny * k - dy * 2;
      const r = clipUnit(px, py, dx * 4, dy * 4);
      if (!r) continue;
      const [x0, y0] = P(px + dx * 4 * r[0], py + dy * 4 * r[0]);
      const [x1, y1] = P(px + dx * 4 * r[1], py + dy * 4 * r[1]);
      lines.push(`M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`);
    }
    kids.push(h('g', {},
      h('polygon', { points: quad, fill: 'rgba(14,22,34,.92)', stroke: p.c, 'stroke-opacity': '.75', 'stroke-width': '1' }),
      h('path', { d: lines.join(''), stroke: p.c, 'stroke-opacity': '.55', 'stroke-width': '.8', fill: 'none' }),
      h('line', { x1: f1(P(1, 0.5)[0] + 6), y1: f1(P(1, 0.5)[1]), x2: '170', y2: f1(P(1, 0.5)[1]), stroke: 'rgba(160,190,230,.3)', 'stroke-dasharray': '2 2' }),
      h('text', { x: '174', y: f1(P(1, 0.5)[1] - 2), fill: p.c, 'font-size': '11.5', 'font-weight': '600' }, p.name),
      h('text', { x: '174', y: f1(P(1, 0.5)[1] + 11), fill: '#8b9bb4', 'font-size': '9.5' }, p.note)));
  });
  // 方向示意：机身轴线
  kids.push(h('text', { x: '14', y: '14', fill: '#8b9bb4', 'font-size': '10' }, '铺层分解示意（实际约数十层，按对称、均衡原则排列）'));
  return { svg: h('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'dia' }, kids), caption: '碳纤维预浸料按 0°/±45°/90° 交替铺放：纤维只在自身方向上强，不同方向的铺层组合起来，才能同时承受拉压、剪切和增压载荷。787 的机身筒段由自动铺丝机在旋转的模具上整体铺放，再送入热压罐固化成型。' };
}

/** 蒙皮—长桁—隔框截面（典型做法） */
function stiffened() {
  const H = 150, sy = 112; // 蒙皮外表面 y
  const hats = [62, 156, 250];
  const kids = [];
  // 隔框腹板（在长桁后方，带“鼠洞”）
  let d = `M14 ${sy - 4}`;
  for (const x of hats) d += `L${x - 30} ${sy - 4}L${x - 30} ${sy - 34}Q${x} ${sy - 50} ${x + 30} ${sy - 34}L${x + 30} ${sy - 4}`;
  d += `L298 ${sy - 4}L298 ${sy - 78}L14 ${sy - 78}Z`;
  kids.push(h('path', { d, fill: 'rgba(95,168,255,.16)', stroke: '#5fa8ff', 'stroke-width': '1.2' }));
  kids.push(h('rect', { x: '14', y: f1(sy - 86), width: '284', height: '8', fill: 'rgba(95,168,255,.35)', stroke: '#5fa8ff', 'stroke-width': '1' })); // 内缘条
  // 剪切角片：隔框与蒙皮之间
  for (const x of [109, 203]) kids.push(h('path', { d: `M${x - 10} ${sy - 3}L${x + 10} ${sy - 3}L${x + 10} ${sy - 7}L${x + 3} ${sy - 7}L${x + 3} ${sy - 44}L${x - 3} ${sy - 44}L${x - 3} ${sy - 7}L${x - 10} ${sy - 7}Z`, fill: 'rgba(255,174,43,.5)', stroke: '#ffae2b', 'stroke-width': '1' }));
  // 帽形长桁（与蒙皮共固化）
  for (const x of hats) kids.push(h('path', { d: `M${x - 26} ${sy}L${x - 16} ${sy}L${x - 9} ${sy - 26}L${x + 9} ${sy - 26}L${x + 16} ${sy}L${x + 26} ${sy}`, fill: 'none', stroke: '#9fd8ff', 'stroke-width': '3', 'stroke-linejoin': 'round' }));
  // 蒙皮
  kids.push(h('rect', { x: '8', y: f1(sy), width: '296', height: '7', rx: '1.5', fill: 'rgba(76,195,255,.55)', stroke: '#4cc3ff', 'stroke-width': '1' }));
  const tag = (x, y, x2, y2, s, c = '#c9d6e8') => [h('line', { x1: x, y1: y, x2, y2, stroke: 'rgba(200,215,235,.45)', 'stroke-width': '.8' }), h('text', { x: x2 + (x2 > x ? 3 : -3), y: y2 + 3.5, fill: c, 'font-size': '10', 'text-anchor': x2 > x ? 'start' : 'end' }, s)];
  kids.push(...tag(166, sy - 13, 200, sy + 28, '帽形长桁'));
  kids.push(...tag(30, sy + 5, 40, sy + 28, '蒙皮'));
  kids.push(...tag(80, sy - 60, 60, sy - 104, '隔框腹板'));
  kids.push(...tag(203, sy - 30, 238, sy - 104, '剪切角片'));
  kids.push(...tag(156, sy - 40, 120, sy - 104, '“鼠洞”'));
  return { svg: h('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'dia' }, kids), caption: '截面示意（沿机身轴线方向看）。长桁沿机身纵向布置，隔框沿周向成环。787 的帽形长桁与蒙皮在热压罐中一次共固化，省去了大量铆钉。隔框在长桁处开出“鼠洞”让长桁穿过，再通过剪切角片与蒙皮连接（示意为典型做法）。' };
}

/** 传统引气 vs 787 无引气 */
function bleedCompare() {
  const H = 150, bw = 60, gap = 20;
  const x = (i) => 6 + i * (bw + gap);
  const box = (i, y, s, c) => h('g', {},
    h('rect', { x: x(i), y, width: bw, height: 30, rx: 6, fill: 'rgba(14,22,34,.9)', stroke: c, 'stroke-width': '1.2' }),
    h('text', { x: x(i) + bw / 2, y: y + 19, fill: '#e6edf7', 'font-size': '10.5', 'text-anchor': 'middle' }, s));
  const arrow = (i, y, c) => h('path', { d: `M${x(i) + bw + 3} ${y + 15}L${x(i + 1) - 4} ${y + 15}M${x(i + 1) - 9} ${y + 11}L${x(i + 1) - 4} ${y + 15}L${x(i + 1) - 9} ${y + 19}`, stroke: c, 'stroke-width': '1.6', fill: 'none', 'stroke-linecap': 'round' });
  const kids = [
    h('text', { x: 6, y: 14, fill: '#ff8a50', 'font-size': '11', 'font-weight': '600' }, '传统客机：发动机引气'),
    ...['压气机引气', '预冷器', '空调组件', '客舱'].map((s, i) => box(i, 22, s, i === 0 ? '#ff7a3d' : 'rgba(160,190,230,.35)')),
    ...[0, 1, 2].map((i) => arrow(i, 22, '#ff7a3d')),
    h('text', { x: 6, y: 80, fill: '#5fe6ff', 'font-size': '11', 'font-weight': '600' }, '787：电动压缩机'),
    ...['冲压进气', '电动压缩机', '空调组件', '客舱'].map((s, i) => box(i, 88, s, i === 1 ? '#ffd23f' : i === 0 ? '#5fe6ff' : 'rgba(160,190,230,.35)')),
    ...[0, 1, 2].map((i) => arrow(i, 88, '#5fe6ff')),
    // 发电机 → 电动压缩机（电力）
    h('path', { d: `M${x(1) + bw / 2} 146L${x(1) + bw / 2} 123M${x(1) + bw / 2 - 4} 128L${x(1) + bw / 2} 123L${x(1) + bw / 2 + 4} 128`, stroke: '#ffd23f', 'stroke-width': '1.6', fill: 'none', 'stroke-linecap': 'round' }),
    h('text', { x: x(1) + bw / 2 + 8, y: 142, fill: '#ffd23f', 'font-size': '10' }, '电力（来自发动机驱动的发电机）'),
  ];
  return { svg: h('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'dia' }, kids), caption: '传统客机从发动机压气机抽出高温高压空气，经预冷器降温后送入空调组件。787 的座舱空气直接取自外界，由电动压缩机增压，发动机不再为此损失推力，空气中也不会混入发动机滑油的气味。' };
}

const MAP = {
  laminate: ['s41', 's43', 's44', 's46', 's47', 's48', 'wing', 'htail', 'vtail'],
  stiffened: ['stringers', 'frames'],
  bleedCompare: ['cacUnit', 'packs', 'flowAir', 'cac', 'flowBleed'],
};
const FN = { laminate, stiffened, bleedCompare };

export function diagramFor(partId) {
  for (const [k, ids] of Object.entries(MAP)) if (ids.includes(partId)) return FN[k]();
  return null;
}
