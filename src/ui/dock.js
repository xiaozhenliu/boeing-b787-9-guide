// 底部控制坞：视角 / 操纵 / 剖视 / 显示
import { h } from './dom.js';
import { seg, slider, toggle, row } from './widgets.js';
import { PRESETS } from './rig.js';
import { FLAP_DETENTS } from './controls.js';

export function buildDock(ctx) {
  const { app, display, fc, amb, dims, labels } = ctx;
  const syncers = [];
  const S = (w) => { syncers.push(w.sync); return w; };
  const D = display.state;

  // ———— 视角 ————
  const presetBtns = PRESETS.map((p) => h('button', { type: 'button', class: 'pbtn', 'data-id': p.id, onclick: () => ctx.goPreset(p.id) }, p.label));
  const auto = S(toggle('自动环绕', () => app.controls.autoRotate, (v) => { app.controls.autoRotate = v; app.controls.autoRotateSpeed = 0.6; }));
  const paneView = h('div', { class: 'pane', 'data-tab': 'view' },
    h('div', { class: 'presets' }, presetBtns),
    h('div', { class: 'pane-foot' }, auto.el, h('span', { class: 'note' }, '驾驶舱/客舱为第一人称视角：拖动环视，滚轮前后移动')));

  // ———— 操纵 ————
  const gearSeg = S(seg([{ v: 0, label: '放下' }, { v: 1, label: '收起' }], () => fc.tgt.gear, (v) => fc.set({ gear: v })));
  const gearBar = h('div', { class: 'progress' }, h('i'));
  syncers.push(() => { gearBar.firstChild.style.width = `${(fc.cur.gear * 100).toFixed(1)}%`; });
  const flapSeg = S(seg(FLAP_DETENTS.map((d) => ({ v: d.id, label: d.id })), () => fc.detent, (v) => fc.setFlaps(v), { cls: 'small' }));
  const sb = S(slider({ min: 0, max: 1, step: 0.01, get: () => fc.tgt.speedbrake, set: (v) => fc.set({ speedbrake: v }), format: (v) => (v < 0.01 ? '收起' : v > 0.99 ? '地面全开' : `${Math.round(v * 100)}%`) }));
  const roll = S(slider({ min: -1, max: 1, step: 0.01, get: () => fc.tgt.roll, set: (v) => fc.set({ roll: v }), format: (v) => (Math.abs(v) < 0.02 ? '中立' : v > 0 ? `右滚 ${Math.round(v * 100)}%` : `左滚 ${Math.round(-v * 100)}%`) }));
  const pitch = S(slider({ min: -25, max: 25, step: 0.5, get: () => fc.tgt.elevator, set: (v) => fc.set({ elevator: v }), format: (v) => (Math.abs(v) < 0.3 ? '中立' : v > 0 ? `抬头 ${v.toFixed(0)}°` : `低头 ${(-v).toFixed(0)}°`) }));
  const yaw = S(slider({ min: -27, max: 27, step: 0.5, get: () => fc.tgt.rudder, set: (v) => fc.set({ rudder: v }), format: (v) => (Math.abs(v) < 0.3 ? '中立' : v > 0 ? `左偏 ${v.toFixed(0)}°` : `右偏 ${(-v).toFixed(0)}°`) }));
  const n1 = S(slider({ min: 0, max: 1, step: 0.01, get: () => fc.tgt.n1, set: (v) => fc.set({ n1: v }), format: (v) => `${Math.round(v * 100)}% N1` }));
  const rev = S(toggle('反推', () => fc.tgt.reverser > 0.5, (v) => fc.set({ reverser: v ? 1 : 0 })));
  const apu = S(toggle('APU 进气门', () => fc.tgt.apuDoor > 0.5, (v) => fc.set({ apuDoor: v ? 1 : 0 })));
  const rat = S(toggle('冲压空气涡轮', () => fc.tgt.rat > 0.5, (v) => fc.set({ rat: v ? 1 : 0 })));
  let flexVal = 0;
  const flex = S(slider({
    min: 0, max: 7.6, step: 0.1, get: () => flexVal, set: (v) => { flexVal = v; },
    change: (v) => ctx.setFlex(v), format: (v) => `${v.toFixed(1)} m`,
  }));
  ctx.syncFlex = (v) => { flexVal = v; flex.sync(); };
  const resetBtn = h('button', { type: 'button', class: 'btn', onclick: () => { fc.reset(); ctx.setFlex(0); syncAll(); } }, '全部复位');
  const paneCtl = h('div', { class: 'pane grid', 'data-tab': 'ctl' },
    h('div', { class: 'card' }, h('h4', {}, '起落架'), row('收放', gearSeg), gearBar, h('h4', {}, '襟翼手柄'), flapSeg, h('p', { class: 'note' }, '1–20 档前缘缝翼在中间（密封）位，25/30 档全伸出')),
    h('div', { class: 'card' }, h('h4', {}, '飞行操纵'), row('横滚（副翼）', roll), row('俯仰（升降舵）', pitch), row('偏航（方向舵）', yaw), row('扰流板', sb)),
    h('div', { class: 'card' }, h('h4', {}, '发动机与 APU'), row('风扇转速', n1), h('div', { class: 'tgls' }, rev.el, apu.el, rat.el),
      h('h4', {}, '机翼弯曲（翼尖上弯）'), flex, h('p', { class: 'note' }, '静力试验中 787 翼尖上弯约 7.6 m；松开滑块后重建几何'), resetBtn),
  );

  // ———— 剖视 ————
  const skin = S(seg([{ v: 'solid', label: '实体' }, { v: 'ghost', label: '透视' }, { v: 'hidden', label: '隐藏' }], () => D.skin, (v) => display.set({ skin: v })));
  const struct = S(toggle('内部结构', () => D.structure, (v) => display.set({ structure: v })));
  const cabin = S(toggle('客舱布置', () => D.cabin, (v) => display.set({ cabin: v })));
  const cut = S(seg([{ v: 'none', label: '无' }, { v: 'x', label: '横剖' }, { v: 'z', label: '纵剖' }, { v: 'y', label: '俯剖' }], () => D.cut, (v) => display.set({ cut: v })));
  const cutPos = S(slider({ min: 0, max: 1, step: 0.002, get: () => D.cutPos, set: (v) => { D.cutPos = v; display.updatePlane(); }, format: (v) => (D.cut === 'x' ? `站位 ${(-1 + v * 65).toFixed(1)} m` : D.cut === 'y' ? `高度 ${(v * 100).toFixed(0)}%` : '—') }));
  const explode = S(slider({ min: 0, max: 1, step: 0.01, get: () => D.explode, set: (v) => display.set({ explode: v }), format: (v) => `${Math.round(v * 100)}%` }));
  const ecut = S(toggle('发动机剖视', () => D.engineCut, (v) => display.set({ engineCut: v })));
  const sys = S(toggle('系统示意', () => D.systems, (v) => display.set({ systems: v })));
  const paneCut = h('div', { class: 'pane grid', 'data-tab': 'cut' },
    h('div', { class: 'card' }, h('h4', {}, '图层'), row('蒙皮', skin), h('div', { class: 'tgls' }, struct.el, cabin.el, sys.el, ecut.el)),
    h('div', { class: 'card' }, h('h4', {}, '剖切'), cut, row('位置', cutPos), h('p', { class: 'note' }, '横剖：沿机身逐站切片；纵剖：沿对称面剖开；俯剖：揭开客舱顶部')),
    h('div', { class: 'card' }, h('h4', {}, '分解视图'), row('分解', explode), h('p', { class: 'note' }, '机身按生产分段拉开，机翼、发动机、尾翼依次分离')),
  );

  // ———— 显示 ————
  const lbl = S(seg([{ v: 'auto', label: '自动' }, { v: 'all', label: '全部' }, { v: 'off', label: '关闭' }], () => labels.mode, (v) => labels.setMode(v)));
  const dimT = S(toggle('尺寸标注', () => dims.group.visible, (v) => dims.setVisible(v)));
  const night = S(toggle('夜景', () => amb.night, (v) => amb.setNight(v)));
  const gridT = S(toggle('地面网格', () => app.env.gridMesh.visible, (v) => { app.env.gridMesh.visible = v; }));
  const tint = S(seg([0, 1, 2, 3, 4].map((v) => ({ v, label: v === 0 ? '透明' : v === 4 ? '最暗' : String(v) })), () => amb.tint, (v) => amb.setTint(v), { cls: 'small' }));
  const paneDisp = h('div', { class: 'pane grid', 'data-tab': 'disp' },
    h('div', { class: 'card' }, h('h4', {}, '标注'), lbl, h('div', { class: 'tgls' }, dimT.el, gridT.el)),
    h('div', { class: 'card' }, h('h4', {}, '灯光'), h('div', { class: 'tgls' }, night.el), h('p', { class: 'note' }, '夜景下可见航行灯、防撞灯闪烁与客舱灯光')),
    h('div', { class: 'card' }, h('h4', {}, '电致变色舷窗'), tint, h('p', { class: 'note' }, '787 舷窗没有遮光板，乘客按键调节透光度')),
  );

  const tabs = [['view', '视角'], ['ctl', '操纵'], ['cut', '剖视'], ['disp', '显示']];
  const panes = { view: paneView, ctl: paneCtl, cut: paneCut, disp: paneDisp };
  const dock = h('div', { class: 'dock' });
  const tabBar = h('nav', { class: 'dock-tabs' });
  let open = null;
  const setTab = (id) => {
    open = open === id ? null : id;
    for (const [k] of tabs) panes[k].classList.toggle('on', k === open);
    [...tabBar.children].forEach((b) => b.classList.toggle('on', b.dataset.id === open));
    dock.classList.toggle('open', !!open);
  };
  for (const [id, label] of tabs) tabBar.append(h('button', { type: 'button', 'data-id': id, onclick: () => setTab(id) }, label));
  tabBar.append(h('button', { type: 'button', class: 'tour-btn', onclick: () => ctx.startTour() }, h('span', { class: 'play' }), '导览'));
  dock.append(h('div', { class: 'dock-panes' }, Object.values(panes)), tabBar);
  document.getElementById('ui').append(dock);

  const syncAll = () => { for (const f of syncers) f(); };
  display.on(syncAll);
  fc.on(syncAll);
  // 起落架进度条、舵面滑块需要随动画刷新
  app.tickers.push(() => { if (fc.dirty) gearBar.firstChild.style.width = `${(fc.cur.gear * 100).toFixed(1)}%`; });
  return { el: dock, syncAll, setTab, markPreset: (id) => presetBtns.forEach((b) => b.classList.toggle('on', b.dataset.id === id)) };
}
