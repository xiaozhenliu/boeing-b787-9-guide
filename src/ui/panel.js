// 右侧讲解面板：整机概览 / 部件讲解 / 材料与分段图例
import { h, fmt, fill } from './dom.js';
import { SPEC } from '../model/spec.js';
import { SECTION_COLORS } from '../render/materials.js';
import { sectionKey } from './display.js';
import { diagramFor } from './diagrams.js';

const CAT_COLORS = {
  fuselage: '#4cc3ff', wing: '#7ee081', tail: '#b48cff', engine: '#ff9f43', gear: '#ff6b8b',
  structure: '#5fa8ff', cabin: '#ffd166', systems: '#3fe0c5', cockpit: '#f5a3d8',
};
const CAT_NAMES = { fuselage: '机身', wing: '机翼', tail: '尾翼', engine: '发动机', gear: '起落架', structure: '结构', cabin: '客舱', systems: '机载系统', cockpit: '驾驶舱' };
export { CAT_COLORS };

/** 波音材料占比的类别名 → 材料图例键（颜色取自该材料） */
const SHARE_COMP = { 复合材料: 'compCFRP', 铝合金: 'compAl', 钛合金: 'compTi', 钢: 'compSteel', 其他: 'compOther' };

export class Panel {
  constructor(app, { kb, display, actions }) {
    this.app = app;
    this.kb = kb;
    this.display = display;
    this.actions = actions; // { focus(part), isolate(part), clear(), legendPick(kind, key) }
    this.el = h('aside', { class: 'panel' });
    this.body = h('div', { class: 'panel-body' });
    this.legend = h('div', { class: 'legend' });
    this.toggleBtn = h('button', { class: 'panel-toggle', type: 'button', title: '收起/展开讲解面板', onclick: () => this.el.classList.toggle('collapsed') }, h('span', {}, '讲解'));
    this.el.append(this.toggleBtn, this.body, this.legend);
    if (window.matchMedia?.('(max-width: 820px)').matches) this.el.classList.add('collapsed'); // 手机竖屏：先让出画面，选中部件时再展开
    document.getElementById('ui').append(this.el);
    this.factIdx = 0;
    this.factTimer = null;
    this.current = null;
    this.showOverview();
  }

  chip(cat) {
    const c = this.kb.CATEGORIES?.[cat];
    const name = (typeof c === 'string' ? c : c?.name) || CAT_NAMES[cat] || cat || '';
    return name ? h('span', { class: 'chip', style: { '--c': CAT_COLORS[cat] || '#8aa' } }, name) : null;
  }

  showOverview() {
    this.current = null;
    clearInterval(this.factTimer);
    const S = SPEC;
    const specs = [
      ['全长', `${S.length} m`], ['翼展', `${S.span} m`], ['全高', `${S.height} m`],
      ['机身宽×高', `${S.fusWidth}×${S.fusHeight} m`], ['最大起飞重量', [`${fmt(S.mtow / 1000, 1)} t`, S.mtowNew ? h('sup', {}, '*') : null]], ['最大燃油', `${fmt(S.fuelL)} L`],
      ['典型座位', `${S.seats}（两舱）`], ['航程', `${fmt(S.rangeKm)} km`], ['巡航速度', `M ${S.cruiseMach}`],
    ];
    const facts = this.kb.FACTS || [];
    const factEl = h('p', { class: 'dyk-text' }, facts[0] || '');
    const dots = h('div', { class: 'dyk-dots' }, facts.map((_, i) => h('i', { class: i === 0 ? 'on' : '' })));
    const show = (i) => {
      this.factIdx = (i + facts.length) % facts.length;
      factEl.classList.remove('in');
      void factEl.offsetWidth;
      factEl.textContent = facts[this.factIdx];
      factEl.classList.add('in');
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === this.factIdx));
    };
    fill(this.body,
      h('div', { class: 'ov-kicker' }, 'BOEING 787-9 DREAMLINER'),
      h('h2', {}, '波音 787-9 梦想客机'),
      h('p', { class: 'lead' }, '787-9 是 787 家族的加长型，机身比 787-8 长约 6 米。按波音的说法，它是第一种以复合材料作为主结构的民航客机（按重量约占 50%），并用“多电”系统取代了绝大部分发动机引气。'),
      h('div', { class: 'spec-grid' }, specs.map(([k, v]) => h('div', { class: 'spec' }, h('b', {}, v), h('span', {}, k)))),
      S.mtowNew ? h('p', { class: 'spec-note' }, `* 另有 ${fmt(S.mtowNew / 1000, 1)} t（571,500 lb）的加大起飞重量选项（机场规划手册 Rev Q，2025-10）。`) : null,
      facts.length ? h('div', { class: 'dyk' },
        h('div', { class: 'dyk-head' }, h('span', {}, '你知道吗'),
          h('button', { class: 'ic', type: 'button', title: '上一条', onclick: () => show(this.factIdx - 1) }, '‹'),
          h('button', { class: 'ic', type: 'button', title: '下一条', onclick: () => show(this.factIdx + 1) }, '›')),
        factEl, dots) : null,
      h('p', { class: 'hint' }, '单击机上任意部件查看讲解，双击聚焦；拖动旋转、右键平移、滚轮缩放。'),
      h('p', { class: 'src' }, '数据：Boeing D6-58333 机场规划手册 Rev Q（2025-10）、EASA TCDS IM.A.115 等。模型为程序化生成的科普示意，非工程图纸。'),
    );
    if (facts.length > 1) this.factTimer = setInterval(() => { if (!document.hidden) show(this.factIdx + 1); }, 9000);
    this.el.classList.remove('has-part');
  }

  showPart(id) {
    clearInterval(this.factTimer);
    const p = this.kb.PARTS?.[id];
    this.current = id;
    const facts = p?.facts || [];
    const meshes = this.app.aircraft.parts.get(id) || [];
    const dia = diagramFor(id);
    fill(this.body,
      h('div', { class: 'part-head' }, this.chip(p?.cat),
        h('button', { class: 'ic close', type: 'button', title: '返回概览（Esc）', onclick: () => this.actions.clear() }, '×')),
      h('h2', {}, p?.name || id, p?.en ? h('small', {}, p.en) : null),
      p?.summary ? h('p', { class: 'lead' }, p.summary) : null,
      p?.body ? h('p', { class: 'body' }, p.body) : h('p', { class: 'body muted' }, '（暂无讲解）'),
      facts.length ? h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
      dia ? h('figure', { class: 'diagram' }, dia.svg, h('figcaption', {}, dia.caption)) : null,
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => this.actions.focus(id) }, '聚焦'),
        meshes.length ? h('button', { type: 'button', class: this.display.state.isolate?.value === id ? 'on' : '', onclick: (e) => { this.actions.isolate(id); e.currentTarget.classList.toggle('on', this.display.state.isolate?.value === id); } }, '单独显示') : null,
        meshes.length ? h('span', { class: 'meta' }, this.matLine(meshes)) : null),
    );
    this.el.classList.add('has-part');
    this.el.classList.remove('collapsed');
    this.body.scrollTop = 0;
  }

  /** 部件材料/分段的小字说明 */
  matLine(meshes) {
    const comps = [...new Set(meshes.map((m) => m.userData.comp))];
    const names = comps.map((c) => this.kb.MATERIALS?.[c]?.name).filter(Boolean);
    return names.length ? `模型材料分类：${names.join('、')}` : '';
  }

  /** 图例：materials | sections | systems | null */
  setLegend(kind) {
    this.legendKind = kind;
    if (!kind) { fill(this.legend); this.legend.classList.remove('on'); return; }
    const A = this.app.aircraft;
    const rows = [];
    if (kind === 'materials') {
      const used = new Set(A.meshes.map((m) => m.userData.comp));
      for (const [key, info] of Object.entries(this.kb.MATERIALS || {})) {
        if (!used.has(key)) continue;
        rows.push({ key, color: info.color, name: info.name, sub: info.desc });
      }
      // 占比按波音公开的五大类给出（“复合材料”含碳纤维、玻璃纤维与夹层结构），不挂到单一材料行上
      const SH = this.kb.MATERIAL_SHARE || [];
      const colorOf = (n) => this.kb.MATERIALS?.[SHARE_COMP[n]]?.color || '#666';
      const bar = SH.length
        ? h('div', { class: 'share' },
          h('div', { class: 'share-bar' }, SH.map(([n, v]) => h('i', { style: { width: `${v}%`, background: colorOf(n) }, title: `${n} ${v}%` }))),
          h('div', { class: 'share-cap' }, SH.map(([n, v], i) => [i ? ' · ' : null, h('span', {}, `${n} ${v}%`)]), h('br'), '787 结构重量占比（波音公开数据；复合材料以碳纤维为主）'))
        : null;
      fill(this.legend, h('h3', {}, '材料分布'), bar, this.rowList(rows, 'comp'));
    } else if (kind === 'systems') {
      for (const [key, color, name, sub] of this.kb.SYSTEMS_LEGEND || []) rows.push({ key, color, name: this.kb.PARTS?.[key]?.name || name, sub });
      fill(this.legend, h('h3', {}, '“多电”系统'), h('p', { class: 'legend-note' }, '787 几乎取消了发动机引气：增压、机翼防冰、发动机起动都改由电力完成。光带流动方向即能量传递方向。'), this.rowList(rows, 'partId'));
    } else {
      const used = new Set(A.meshes.map((m) => sectionKey(m.userData)));
      const info = this.kb.SECTION_INFO || {};
      for (const [key, color] of Object.entries({ ...SECTION_COLORS, pylon: '#d8a25e' })) {
        if (!used.has(key)) continue;
        const it = info[key] || {};
        rows.push({ key, color, name: it.name || key, sub: it.supplier || '' });
      }
      fill(this.legend, h('h3', {}, '生产分段与供应商'), this.rowList(rows, 'section'));
    }
    this.legend.classList.add('on');
  }

  rowList(rows, key) {
    return h('ul', { class: 'rows' }, rows.map((r) => h('li', {
      class: this.display.state.isolate?.value === r.key ? 'on' : '',
      onclick: (e) => {
        this.actions.legendPick(key, r.key);
        const on = this.display.state.isolate?.value === r.key;
        [...e.currentTarget.parentNode.children].forEach((li) => li.classList.remove('on'));
        e.currentTarget.classList.toggle('on', on);
      },
      onpointerenter: () => this.actions.legendHover?.(key, r.key),
      onpointerleave: () => this.actions.legendHover?.(null),
    },
    h('i', { class: 'sw', style: { background: r.color } }),
    h('span', { class: 'nm' }, r.name, r.sub ? h('small', {}, r.sub) : null),
    r.val != null ? h('b', {}, `${r.val}%`) : null)));
  }
}
