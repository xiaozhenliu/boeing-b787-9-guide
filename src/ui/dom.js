// 极简 DOM 工具：h(tag, props, ...children)
const SVG_TAGS = new Set(['svg', 'line', 'circle', 'path', 'g', 'rect', 'polygon', 'polyline', 'text', 'tspan', 'defs', 'marker', 'clipPath', 'linearGradient', 'stop', 'ellipse']);
export function h(tag, props = {}, ...kids) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(node(c));
  }
  return el;
}

/** 子节点归一化：DOM 节点原样；控件对象（widgets.js 返回的 { el, sync }）取其 el；其余转文字 */
const node = (c) => (c.nodeType ? c : c.el?.nodeType ? c.el : document.createTextNode(String(c)));

/** 数字格式：千分位 */
export const fmt = (n, d = 0) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });

/** 替换子节点：跳过 null/false（原生 replaceChildren 会把 null 渲染成文字 "null"） */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false).map(node));
  return el;
}
