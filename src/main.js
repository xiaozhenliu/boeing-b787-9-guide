// 入口：渲染器、相机、控制器、环境与整机装配；UI 在 ui/app.js 中挂接
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironment } from './render/env.js';
import { createMaterials } from './render/materials.js';
import { createFuselageTextures } from './render/textures.js';
import { createTailTexture } from './render/tailTexture.js';
import { Aircraft } from './model/aircraft.js';

const params = new URLSearchParams(location.search);
const quality = params.get('q') || (Math.min(screen.width, screen.height) < 700 ? 'std' : 'high');

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.3, 3000);
camera.position.set(-62, 20, 58);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 4.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.5;
controls.maxDistance = 260;
controls.maxPolarAngle = Math.PI * 0.495;
controls.update();

const env = createEnvironment(renderer, scene);
const tex = { fus: createFuselageTextures(quality), tail: createTailTexture() };
const M = createMaterials(tex);
const aircraft = new Aircraft(M);
scene.add(aircraft.root);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // 竖屏时加大垂直视场角，让水平方向也能容下整机（横屏保持 32°）
  camera.fov = camera.aspect >= 1 ? 32 : Math.min(58, (2 * Math.atan((Math.tan((16 * Math.PI) / 180) * 0.78) / camera.aspect) * 180) / Math.PI);
  camera.updateProjectionMatrix();
  app.onResize?.(w, h);
}
window.addEventListener('resize', resize);

const timer = new THREE.Timer();
const app = { renderer, scene, camera, controls, env, M, aircraft, THREE, quality, tickers: [(dt) => aircraft.tick(dt)] };
window.__app = app;
resize(); // 初始按窗口比例设定视场角

function frame(ts) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.05);
  controls.update();
  for (const f of app.tickers) f(dt);
  if (app.render) app.render(dt); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// 测试/截图钩子：设置视角
app.view = (pos, target) => {
  camera.position.set(...pos);
  controls.target.set(...target);
  controls.maxPolarAngle = Math.PI * 0.85; // 俯仰限制由相机控制器每帧按离地高度重算
  controls.update();
};

import('./ui/app.js').then((m) => m.initUI(app)).catch((e) => console.warn('UI 未加载：', e.message)).finally(() => {
  requestAnimationFrame(frame);
  document.body.classList.add('ready');
});
