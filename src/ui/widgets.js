// 控件：分段按钮、滑块、开关。每个控件返回 { el, sync }，sync() 从状态源刷新显示
import { h } from './dom.js';

export function seg(options, get, set, { cls = '' } = {}) {
  const btns = options.map((o) => h('button', { type: 'button', title: o.title || '', onclick: () => { set(o.v); sync(); } }, o.label));
  const el = h('div', { class: `seg ${cls}` }, btns);
  const sync = () => { const v = get(); btns.forEach((b, i) => b.classList.toggle('on', options[i].v === v)); };
  sync();
  return { el, sync };
}

export function slider({ min, max, step = 0.01, get, set, change = null, format = (v) => v, ticks = null }) {
  const input = h('input', { type: 'range', min, max, step, value: get() });
  const out = h('output', {}, format(get()));
  input.addEventListener('input', () => { const v = +input.value; out.textContent = format(v); set(v); });
  if (change) input.addEventListener('change', () => change(+input.value));
  const el = h('div', { class: 'slider' }, input, out, ticks ? h('div', { class: 'ticks' }, ticks.map((t) => h('span', {}, t))) : null);
  const sync = () => { const v = get(); if (document.activeElement !== input) input.value = v; out.textContent = format(v); };
  return { el, sync, input };
}

export function toggle(label, get, set, { title = '' } = {}) {
  const btn = h('button', { type: 'button', class: 'tgl', title, onclick: () => { set(!get()); sync(); } }, h('i', {}), h('span', {}, label));
  const sync = () => btn.classList.toggle('on', !!get());
  sync();
  return { el: btn, sync };
}

/** 一行：标题 + 控件 */
export function row(title, ...controls) {
  return h('div', { class: 'row' }, h('label', {}, title), h('div', { class: 'ctl' }, controls.map((c) => c.el || c)));
}
