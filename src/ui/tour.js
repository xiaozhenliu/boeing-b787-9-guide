// 导览播放器：每一步设置显示模式、操纵状态、机位与选中部件，并显示讲解卡片
import { h } from './dom.js';

/** 自动播放时每步停留时长（毫秒）：按文字长度估算阅读时间，可用 hold 覆盖 */
export const stepMs = (st) => st.hold ?? Math.max(9000, st.text.length * 170);

export class Tour {
  constructor(ctx, steps) {
    this.ctx = ctx;
    this.steps = steps;
    this.i = -1;
    this.timer = null;
    this.autoplay = false;
    this.title = h('h3');
    this.text = h('p');
    this.count = h('span', { class: 'count' });
    this.dots = h('div', { class: 'tour-dots' }, steps.map((_, k) => h('i', { onclick: () => this.go(k) })));
    this.autoBtn = h('button', { type: 'button', class: 'ic', title: '自动播放', onclick: () => this.setAuto(!this.autoplay) }, '▶');
    this.el = h('div', { class: 'tour' },
      h('div', { class: 'tour-top' }, h('span', { class: 'tour-kicker' }, '导览'), this.count, this.autoBtn,
        h('button', { type: 'button', class: 'ic', title: '退出导览（Esc）', onclick: () => this.stop() }, '×')),
      this.title, this.text,
      h('div', { class: 'tour-nav' },
        h('button', { type: 'button', class: 'btn', onclick: () => this.prev() }, '上一步'),
        this.dots,
        h('button', { type: 'button', class: 'btn primary', onclick: () => this.next() }, '下一步')));
    document.getElementById('ui').append(this.el);
  }

  get active() { return this.i >= 0; }

  start(i = 0) {
    document.body.classList.add('touring');
    this.go(i);
  }

  stop() {
    if (this.i < 0) return;
    this.i = -1;
    clearTimeout(this.timer);
    this.setAuto(false);
    document.body.classList.remove('touring');
    this.ctx.endTour?.();
  }

  setAuto(on) {
    this.autoplay = on;
    this.autoBtn.textContent = on ? '❚❚' : '▶';
    this.autoBtn.classList.toggle('on', on);
    clearTimeout(this.timer);
    if (on && this.i >= 0) this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    const st = this.steps[this.i];
    const ms = stepMs(st);
    this.timer = setTimeout(() => { if (this.i < this.steps.length - 1) this.next(); else this.setAuto(false); }, ms);
  }

  next() { if (this.i < this.steps.length - 1) this.go(this.i + 1); else this.stop(); }
  prev() { if (this.i > 0) this.go(this.i - 1); }

  go(i) {
    this.i = i;
    const st = this.steps[i];
    this.title.textContent = st.title;
    this.text.textContent = st.text;
    this.count.textContent = `${i + 1} / ${this.steps.length}`;
    [...this.dots.children].forEach((d, k) => { d.classList.toggle('on', k === i); d.classList.toggle('done', k < i); });
    this.el.classList.remove('in');
    void this.el.offsetWidth;
    this.el.classList.add('in');
    this.ctx.applyStep(st);
    if (this.autoplay) this.schedule();
  }
}
