// UI 入口：组装显示管理、拾取、相机、标注、讲解面板、控制坞与导览
import * as THREE from 'three';
import * as KB from '../data/parts.js';
import { HOTSPOTS } from '../data/hotspots.js';
import { SYS_PARTS, SYSTEMS_LEGEND } from '../data/systems-kb.js';
import { FD_PARTS, FD_SPOTS, FD_VIEWS, FD_AFT } from '../data/cockpit-kb.js';
import { CUT } from '../render/materials.js';
import { TOUR, TOUR_DEFAULTS } from '../data/tour.js';
import { h, fill } from './dom.js';
import { Display } from './display.js';
import { Picker } from './picker.js';
import { Rig, bodyToWorld } from './rig.js';
import { FlightControls, FLAP_DETENTS } from './controls.js';
import { Labels } from './labels.js';
import { Panel, CAT_COLORS } from './panel.js';
import { buildDock } from './dock.js';
import { Tour, stepMs } from './tour.js';
import { Ambience } from './ambience.js';
import { Dims } from './dims.js';

const MODES = [
  { id: 'exterior', label: '外观', key: '1', display: { scheme: 'paint', skin: 'solid', structure: false, cabin: false, systems: false, cut: 'none' }, spots: 'exterior' },
  { id: 'structure', label: '结构', key: '2', display: { scheme: 'paint', skin: 'ghost', structure: true, cabin: false, systems: false, cut: 'none' }, spots: 'structure' },
  { id: 'materials', label: '材料', key: '3', display: { scheme: 'materials', skin: 'solid', structure: false, cabin: false, systems: false, cut: 'none' }, spots: 'exterior', legend: 'materials' },
  { id: 'sections', label: '分段', key: '4', display: { scheme: 'sections', skin: 'solid', structure: false, cabin: false, systems: false, cut: 'none' }, spots: 'exterior', legend: 'sections' },
  { id: 'cabin', label: '客舱', key: '5', display: { scheme: 'paint', skin: 'solid', structure: false, cabin: true, systems: false, cut: 'y', cutPos: 0.5 }, spots: 'cabin' },
  { id: 'systems', label: '系统', key: '6', display: { scheme: 'paint', skin: 'ghost', structure: false, cabin: false, systems: true, cut: 'none', explode: 0 }, spots: 'systems', legend: 'systems' },
];

export function initUI(app) {
  const A = app.aircraft;
  const PARTS = { ...SYS_PARTS, ...(KB.PARTS || {}), ...FD_PARTS }; // 系统条目作补充，主知识库优先；驾驶舱分仪表条目单列
  const FD_SPOT_OF = Object.fromEntries(FD_SPOTS.map((q) => [q.part, q]));
  const ui = document.getElementById('ui');
  const display = new Display(app);
  const picker = new Picker(app, display);
  const rig = new Rig(app);
  const fc = new FlightControls(app);
  const amb = new Ambience(app);
  const dims = new Dims(app);
  const state = { mode: 'exterior', sel: null, flex: 0, inside: false, saved: null };
  const ctx = { app, display, picker, rig, fc, amb, dims, state };

  // ———————————————— 选择与聚焦 ————————————————
  const meshesOf = (id) => A.parts.get(id) || [];
  // 选中高亮；第一人称时不叠加（身处驾驶舱/客舱之中，整片高亮只会遮挡视线）
  function hlSel() {
    if (state.sel && !state.inside) display.highlight(meshesOf(state.sel).filter((m) => picker.visible(m)), 'selection');
    else display.clearOverlays('selection');
  }
  function select(id, { focus = false } = {}) {
    if (!id) { clearSel(); return; }
    state.sel = id;
    hlSel();
    panel.showPart(id);
    labels.setSelected(id);
    if (focus) focusPart(id);
  }
  function clearSel() {
    state.sel = null;
    display.clearOverlays('selection');
    labels.setSelected(null);
    panel.showOverview();
    if (display.state.isolate?.key === 'partId') display.set({ isolate: null });
  }
  // 驾驶舱仪表：飞到对应眼位（机长 / 副驾驶 / 中央 / 观察员）并转向该仪表；舱外选中风挡等有网格的部件时仍按舱外方式聚焦
  function focusCockpit(spot) {
    const eye = bodyToWorld(app, ...(FD_VIEWS[spot.view] || FD_VIEWS.O));
    const at = bodyToWorld(app, ...spot.at.body);
    const look = eye.clone().addScaledVector(at.sub(eye).normalize(), 0.35);
    const far = !state.inside;
    rig.fly(eye, look, { inside: true, dur: far ? 2.0 : 1.1 });
    if (far) dock.markPreset('cockpit');
  }
  function focusPart(id) {
    const fs = FD_SPOT_OF[id];
    if (fs && (state.inside || !meshesOf(id).length)) { focusCockpit(fs); return; }
    const meshes = meshesOf(id).filter((m) => picker.visible(m));
    const box = new THREE.Box3();
    if (meshes.length) {
      // 左右成对的部件只取靠近镜头的一侧
      const sides = [[], []];
      for (const m of meshes) {
        const b = new THREE.Box3().setFromObject(m);
        const z = b.getCenter(new THREE.Vector3()).z;
        if (Math.abs(z) < 0.6) { sides[0].push(b); sides[1].push(b); } else sides[z > 0 ? 0 : 1].push(b);
      }
      const pick = sides[0].length && sides[1].length ? (app.camera.position.z >= 0 ? 0 : 1) : sides[0].length ? 0 : 1;
      for (const b of sides[pick]) box.union(b);
    } else {
      const w = labels.worldOf(id);
      if (!w) return;
      box.setFromCenterAndSize(w, new THREE.Vector3(4, 4, 4));
    }
    rig.focusBox(box);
  }
  function isolate(id) {
    const cur = display.state.isolate;
    display.set({ isolate: cur && cur.value === id ? null : { key: 'partId', value: id } });
    picker.refreshSolid();
    hlSel();
  }

  // ———————————————— 讲解面板与标注 ————————————————
  const panel = new Panel(app, {
    kb: { ...KB, PARTS, SYSTEMS_LEGEND }, display,
    actions: {
      focus: focusPart,
      isolate,
      clear: clearSel,
      legendPick: (kind, key) => {
        const cur = display.state.isolate;
        display.set({ isolate: cur && cur.key === kind && cur.value === key ? null : { key: kind, value: key } });
        picker.refreshSolid();
      },
      legendHover: (kind, key) => {
        if (!kind) display.clearOverlays('group');
        else display.highlight(display.meshesWhere(kind, key).filter((m) => picker.visible(m)), 'group');
      },
    },
  });
  const labels = new Labels(app, {
    picker, display, parts: PARTS,
    onPick: (id, o) => select(id, o),
    onEnter: (id) => display.highlight(meshesOf(id).filter((m) => picker.visible(m)), 'group'),
    onLeave: () => display.clearOverlays('group'),
  });
  labels.load(HOTSPOTS);
  ctx.labels = labels;

  // ———————————————— 模式 ————————————————
  const modeBtns = {};
  function setMode(id) {
    const m = MODES.find((q) => q.id === id) || MODES[0];
    if (state.inside) { leaveInside(); ctx.goPreset('overview'); } // 在舱内切换视图：先回到舱外
    state.mode = m.id;
    display.set({ ...m.display, isolate: null });
    labels.setSet(m.spots);
    panel.setLegend(m.legend || null);
    for (const [k, b] of Object.entries(modeBtns)) b.classList.toggle('on', k === m.id);
    picker.refreshSolid();
    hlSel();
  }
  ctx.setMode = setMode;

  // 第一人称机位：临时显示客舱、取消剖切；离开时恢复
  function enterInside() {
    if (state.inside) return;
    state.inside = true;
    state.saved = { ...display.state };
    display.set({ cabin: true, structure: false, cut: 'none', skin: 'solid', explode: 0, systems: false, isolate: null }); // 隔框会穿出内饰板，舱内不显示
    CUT.inside.value = 1; // 蒙皮背面画成内饰板，并开出风挡窗洞
    labels.setSet('cabin');
    hlSel();
    document.body.classList.add('inside');
  }
  function leaveInside() {
    if (!state.inside) return;
    state.inside = false;
    const s = state.saved;
    display.set({ cabin: s.cabin, structure: s.structure, cut: s.cut, skin: s.skin, explode: s.explode, systems: s.systems });
    CUT.inside.value = 0;
    labels.setSet(MODES.find((q) => q.id === state.mode).spots);
    hlSel();
    document.body.classList.remove('inside');
  }
  rig.onInside = (on) => { if (on) enterInside(); else leaveInside(); };
  ctx.goPreset = (id) => { rig.preset(id); dock.markPreset(id); };

  function setFlex(v) {
    if (Math.abs(v - state.flex) < 1e-3) return;
    state.flex = v;
    A.setFlex(v);
    labels.invalidate();
    picker.prebuild();
    picker.refreshSolid();
    ctx.syncFlex?.(v);
    hlSel();
  }
  ctx.setFlex = setFlex;

  // ———————————————— 顶栏 ————————————————
  const search = buildSearch();
  const top = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('b', {}, 'BOEING 787-9'), h('span', {}, 'Dreamliner 结构科普交互模型')),
    h('nav', { class: 'modes' }, MODES.map((m) => (modeBtns[m.id] = h('button', { type: 'button', title: `${m.label}（${m.key}）`, onclick: () => setMode(m.id) }, m.label)))),
    search.el,
    h('button', { type: 'button', class: 'ic help-btn', title: '快捷键与说明（?）', onclick: () => help.classList.toggle('on') }, '?'),
  );
  ui.append(top);

  const help = h('div', { class: 'help', onclick: (e) => { if (e.target === help) help.classList.remove('on'); } },
    h('div', { class: 'help-card' },
      h('h3', {}, '操作说明'),
      h('dl', {}, [
        ['左键拖动', '旋转'], ['右键拖动 / 双指', '平移'], ['滚轮 / 捏合', '缩放'], ['单击部件', '查看讲解'], ['双击部件', '聚焦'],
        ['1 – 6', '外观 / 结构 / 材料 / 分段 / 客舱 / 系统'], ['G', '收放起落架'], ['F', '襟翼下一档'], ['X', '蒙皮透视'], ['E', '分解视图'],
        ['L', '标注：自动 → 全部 → 关闭'], ['D', '尺寸标注'], ['N', '夜景'], ['T', '开始导览'], ['R', '回到总览'], ['Esc', '取消选择 / 退出导览'],
      ].map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('p', { class: 'src' }, '本模型完全由代码程序化生成（Three.js），未使用任何图片、扫描或建模软件。几何依据波音《787 机场规划手册》（D6-58333 Rev Q）、EASA/FAA 型号合格证数据单及公开资料；内部结构与系统布置为科普示意。'),
      h('details', { class: 'refs' }, h('summary', {}, '主要资料来源'),
        h('ul', {}, KB.SOURCES.map(([title, url]) => h('li', {}, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, title))))),
      h('button', { type: 'button', class: 'btn primary', onclick: () => help.classList.remove('on') }, '知道了')));
  ui.append(help);

  // 部件搜索 / 目录
  function buildSearch() {
    const input = h('input', { type: 'search', placeholder: '搜索部件，如“襟翼”“隔框”', 'aria-label': '搜索部件' });
    const list = h('div', { class: 'results' });
    const el = h('div', { class: 'search' }, input, list);
    const cats = KB.CATEGORIES || {};
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const items = Object.entries(PARTS).filter(([id, p]) => !q || id.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q) || p.en?.toLowerCase().includes(q) || p.summary?.includes(q));
      const groups = {};
      for (const [id, p] of items) (groups[p.cat] ||= []).push([id, p]);
      list.replaceChildren(...Object.entries(groups).map(([cat, arr]) => h('div', { class: 'grp' },
        h('div', { class: 'grp-h', style: { '--c': CAT_COLORS[cat] || '#8aa' } }, cats[cat] || cat),
        arr.map(([id, p]) => h('button', { type: 'button', onclick: () => { select(id, { focus: true }); list.classList.remove('on'); input.blur(); } }, p.name, h('small', {}, p.en || ''))))));
      if (!items.length) list.replaceChildren(h('div', { class: 'empty' }, '没有匹配的部件'));
    };
    input.addEventListener('focus', () => { render(); list.classList.add('on'); });
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { list.querySelector('button')?.click(); }
      if (e.key === 'Escape') { input.blur(); list.classList.remove('on'); }
    });
    document.addEventListener('pointerdown', (e) => { if (!el.contains(e.target)) list.classList.remove('on'); });
    return { el, input };
  }

  // ———————————————— 控制坞与导览 ————————————————
  const dock = buildDock(ctx);
  const tour = new Tour(ctx, TOUR);
  ctx.tour = tour;
  ctx.startTour = () => { help.classList.remove('on'); tour.start(0); };
  ctx.applyStep = (raw) => {
    const st = { ...TOUR_DEFAULTS, ...raw, ctl: { ...TOUR_DEFAULTS.ctl, ...(raw.ctl || {}) }, display: { ...TOUR_DEFAULTS.display, ...(raw.display || {}) } };
    if (state.inside && !st.inside) leaveInside();
    setMode(st.mode);
    display.set(st.display);
    fc.setFlaps(st.flaps);
    fc.set(st.ctl);
    setFlex(st.flex);
    if (amb.night !== st.night) amb.setNight(st.night);
    amb.setTint(st.tint);
    if (st.select) select(st.select); else clearSel();
    if (st.preset) { rig.preset(st.preset); dock.markPreset(st.preset); }
    else if (st.eye) {
      const eye = bodyToWorld(app, ...st.eye), look = bodyToWorld(app, ...st.look);
      if (!st.inside) rig.portrait(eye, look);
      rig.fly(eye, look, { inside: !!st.inside, dur: st.dur ?? 1.8 });
    }
    st.run?.(ctx);
    dock.syncAll();
  };
  ctx.endTour = () => {
    setMode('exterior');
    fc.reset();
    setFlex(0);
    amb.setNight(false);
    amb.setTint(0);
    clearSel();
    rig.preset('overview');
    dock.syncAll();
  };

  // ———————————————— 指针交互 ————————————————
  const canvas = app.renderer.domElement;
  const tip = h('div', { class: 'tip' });
  ui.append(tip);
  const ndc = new THREE.Vector2();
  const toNdc = (e) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); return ndc; };
  let down = null, hoverEvt = null, hoverId = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; tip.classList.remove('on'); });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (down.b === 0 && moved < 6 && performance.now() - down.t < 650) {
      const hit = picker.pick(toNdc(e));
      if (hit) select(hit.partId); else if (state.sel) clearSel();
    }
    down = null;
  });
  canvas.addEventListener('dblclick', (e) => {
    const hit = picker.pick(toNdc(e));
    if (hit) select(hit.partId, { focus: true });
  });
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons) hoverEvt = e; });
  canvas.addEventListener('pointerleave', () => { hoverEvt = null; tip.classList.remove('on'); hoverId = null; canvas.style.cursor = ''; });

  function hoverTick() {
    if (!hoverEvt || rig.tween) return;
    const e = hoverEvt;
    hoverEvt = null;
    const hit = picker.pick(toNdc(e));
    const id = hit?.partId || null;
    if (id !== hoverId) {
      hoverId = id;
      canvas.style.cursor = id ? 'pointer' : '';
      if (id) {
        const p = PARTS[id];
        fill(tip, h('b', {}, p?.name || id), p?.en ? h('small', {}, p.en) : null);
        tip.style.setProperty('--c', CAT_COLORS[p?.cat] || '#8aa');
      }
      tip.classList.toggle('on', !!id);
    }
    if (id) tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`;
  }

  // ———————————————— 键盘 ————————————————
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const mode = MODES.find((m) => m.key === k);
    if (mode) { setMode(mode.id); dock.syncAll(); return; }
    switch (k) {
      case 'escape':
        if (help.classList.contains('on')) help.classList.remove('on');
        else if (tour.active) tour.stop();
        else if (state.sel) clearSel();
        else if (state.inside) ctx.goPreset('overview');
        break;
      case 'g': fc.set({ gear: fc.tgt.gear > 0.5 ? 0 : 1 }); break;
      case 'f': {
        const i = FLAP_DETENTS.findIndex((d) => d.id === fc.detent);
        fc.setFlaps(FLAP_DETENTS[(i + 1) % FLAP_DETENTS.length].id);
        break;
      }
      case 'x': display.set({ skin: display.state.skin === 'ghost' ? 'solid' : 'ghost' }); break;
      case 'e': display.set({ explode: display.state.explode > 0 ? 0 : 0.7 }); break;
      case 'l': labels.setMode({ auto: 'all', all: 'off', off: 'auto' }[labels.mode]); break;
      case 'd': dims.setVisible(!dims.group.visible); break;
      case 'n': amb.setNight(!amb.night); break;
      case 't': ctx.startTour(); break;
      case 'r': ctx.goPreset('overview'); break;
      case '?': help.classList.toggle('on'); break;
      default: return;
    }
    dock.syncAll();
  });

  // ———————————————— 每帧 ————————————————
  display.on((what) => { if (what === 'refresh') picker.refreshSolid(); });
  // 窄屏视图偏移：导览卡或讲解面板盖住下半屏时，把投影中心上移，让目标落在可见区域（平滑过渡）
  const vo = { x: 0, y: 0 };
  const viewOffsetTick = (dt) => {
    const cam = app.camera, W = window.innerWidth, H = window.innerHeight;
    let gx = 0, gy = 0;
    if (!state.inside) {
      const touring = document.body.classList.contains('touring'), open = !panel.el.classList.contains('collapsed');
      if (W <= 820) {
        if (touring) gy = H * 0.2; // 导览时面板已让位，只需避开导览卡
        else if (open) gy = H * 0.17;
      } else {
        if (touring) gy = H * 0.07; // 导览卡在底部居中：画面中心略上移
        if (open) gx = Math.min(panel.el.offsetWidth * 0.3, W * 0.08); // 讲解面板在右侧：画面中心略左移
      }
    }
    const k = Math.min(1, dt * 6);
    vo.x += (gx - vo.x) * k;
    vo.y += (gy - vo.y) * k;
    if (gx === 0 && gy === 0 && Math.abs(vo.x) < 0.5 && Math.abs(vo.y) < 0.5) { vo.x = vo.y = 0; if (cam.view?.enabled) cam.clearViewOffset(); return; }
    cam.setViewOffset(W, H, vo.x, vo.y, W, H);
  };
  // 舱内标注集随镜头位置切换：驾驶舱后隔板之前用分仪表标注，之后用客舱标注
  const _cam = new THREE.Vector3();
  const insideSetTick = () => {
    if (!state.inside) return;
    const want = A.ac.worldToLocal(_cam.copy(app.camera.position)).x < FD_AFT ? 'cockpit' : 'cabin';
    if (labels.set !== want) labels.setSet(want);
  };
  app.tickers.push((dt) => {
    viewOffsetTick(dt);
    fc.tick(dt);
    rig.tick(dt);
    amb.tick(dt);
    display.tick(dt);
    insideSetTick();
    labels.tick(dt);
    dims.tick();
    hoverTick();
  });

  setMode('exterior');
  dock.markPreset('overview');
  // 初始机位写在 main.js 里（与“总览”预设相同），竖屏时它没有经过 portrait() 拉远：这里补一次
  if (app.camera.aspect < 0.8) rig.preset('overview', { dur: 0.01 });
  app.ui = { display, picker, rig, fc, amb, dims, labels, panel, tour, select, setMode, setFlex, focusPart, ctx };
  // 首次访问提示导览
  if (!new URLSearchParams(location.search).has('shot')) {
    const intro = h('div', { class: 'intro' },
      h('p', {}, `第一次来？跟着 ${TOUR.length} 步导览，约 ${Math.round(TOUR.reduce((t, st) => t + stepMs(st), 0) / 60000)} 分钟看懂 787 的结构与系统。`),
      h('div', {}, h('button', { type: 'button', class: 'btn primary', onclick: () => { intro.remove(); ctx.startTour(); } }, '开始导览'),
        h('button', { type: 'button', class: 'btn', onclick: () => intro.remove() }, '自由探索')));
    ui.append(intro);
    setTimeout(() => intro.classList.add('in'), 600);
  }
}
