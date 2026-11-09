// 尺寸标注：全长、翼展、全高、主轮距、前后轮距（ACAPS 数据），地面上的工程标注线 + 屏幕文字
import * as THREE from 'three';
import { h } from './dom.js';
import { SPEC, GEAR, VTAIL } from '../model/spec.js';

export class Dims {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'dimensions';
    this.group.visible = false;
    app.scene.add(this.group);
    this.labels = [];
    this.root = h('div', { class: 'dims' });
    document.getElementById('ui').append(this.root);
    this.build();
  }

  build() {
    const A = this.app.aircraft;
    A.ac.updateMatrixWorld(true);
    const W = (s, y, z) => new THREE.Vector3(s, y, z).applyMatrix4(A.ac.matrixWorld);
    const segs = [];
    const add = (a, b) => segs.push(a.clone(), b.clone());
    const G = 0.04; // 离地高度
    const dim = (a, b, text, normal, ext = []) => {
      // 主线 + 两端短横 + 引出线
      add(a, b);
      const tick = normal.clone().multiplyScalar(0.8);
      for (const p of [a, b]) add(p.clone().sub(tick), p.clone().add(tick));
      for (const [p, q] of ext) add(p, q);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const el = h('div', { class: 'dim' }, text);
      this.root.append(el);
      this.labels.push({ el, at: mid });
    };
    // 全长：机头至尾端，标在左侧地面（翼尖外侧）
    const zL = SPEC.span / 2 + 4;
    const n0 = W(0, 0, 0), n1 = W(SPEC.length, 0, 0);
    const a = new THREE.Vector3(n0.x, G, zL), b = new THREE.Vector3(n1.x, G, zL);
    dim(a, b, `全长 ${SPEC.length} m`, new THREE.Vector3(0, 0, 1), [[new THREE.Vector3(n0.x, G, 1), a], [new THREE.Vector3(n1.x, G, 1), b]]);
    // 翼展：机翼后方地面
    const sx = W(47.5, 0, 0).x, half = SPEC.span / 2;
    dim(new THREE.Vector3(sx, G, -half), new THREE.Vector3(sx, G, half), `翼展 ${SPEC.span} m`, new THREE.Vector3(1, 0, 0),
      [[W(42.9, 0, half), new THREE.Vector3(sx, G, half)], [W(42.9, 0, -half), new THREE.Vector3(sx, G, -half)]]);
    // 全高：垂尾后方竖线
    const tip = W(VTAIL.tipLE + VTAIL.tipChord * 0.5, 0, 0);
    const hx = W(SPEC.length + 3, 0, 0).x;
    dim(new THREE.Vector3(hx, 0, 0), new THREE.Vector3(hx, SPEC.height, 0), `全高 ${SPEC.height} m`, new THREE.Vector3(1, 0, 0),
      [[new THREE.Vector3(tip.x, SPEC.height, 0), new THREE.Vector3(hx, SPEC.height, 0)]]);
    // 主轮距：主轮架后方
    const gx = W(GEAR.mainS + 2.4, 0, 0).x;
    dim(new THREE.Vector3(gx, G, -GEAR.mainY), new THREE.Vector3(gx, G, GEAR.mainY), `主轮距 ${SPEC.track} m`, new THREE.Vector3(1, 0, 0));
    // 前后轮距（轴距）：左侧偏置
    const zw = GEAR.mainY + 2.2;
    const g0 = W(GEAR.noseS, 0, 0).x, g1 = W(GEAR.mainS, 0, 0).x;
    dim(new THREE.Vector3(g0, G, zw), new THREE.Vector3(g1, G, zw), `前后轮距 ${SPEC.wheelbase} m`, new THREE.Vector3(0, 0, 1),
      [[new THREE.Vector3(g0, G, 0.4), new THREE.Vector3(g0, G, zw)], [new THREE.Vector3(g1, G, GEAR.mainY), new THREE.Vector3(g1, G, zw)]]);
    const geo = new THREE.BufferGeometry().setFromPoints(segs);
    const mat = new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.85, depthTest: true });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.renderOrder = 3;
    this.group.add(this.lines);
  }

  setVisible(on) {
    this.group.visible = on;
    this.root.classList.toggle('on', on);
  }

  tick() {
    if (!this.group.visible) return;
    const { camera, renderer } = this.app;
    const Wd = renderer.domElement.clientWidth, Hd = renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      v.copy(l.at).applyMatrix4(camera.matrixWorldInverse);
      const behind = v.z > -0.5;
      v.copy(l.at).project(camera);
      l.el.style.display = behind ? 'none' : '';
      l.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * Wd).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * Hd).toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
}
