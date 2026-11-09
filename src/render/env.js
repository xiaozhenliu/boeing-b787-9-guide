// 展厅环境：渐变背景、程序化影棚环境贴图（PMREM）、主光阴影、地面与蓝图网格
import * as THREE from 'three';

export const THEME = {
  day: { top: '#1d2a3f', mid: '#2b3a52', bottom: '#0d131d', ground: 0x1a2230, grid: 0x6f8db5 },
  night: { top: '#03060b', mid: '#08101c', bottom: '#020407', ground: 0x0a0f17, grid: 0x2f4a6e },
};

function gradientTexture(c) {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 512;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, c.top);
  gr.addColorStop(0.55, c.mid);
  gr.addColorStop(1, c.bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 程序化影棚：渐变穹顶 + 若干柔光箱，生成 PMREM 环境贴图用于漆面反射 */
function studioEnvironment(renderer, intensity = 1) {
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { k: { value: intensity } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform float k;
        void main(){
          float y = vP.y;
          vec3 sky = mix(vec3(0.55,0.62,0.72), vec3(0.85,0.9,0.98), smoothstep(0.0,0.9,y));
          vec3 hor = vec3(0.62,0.66,0.72);
          vec3 gnd = vec3(0.16,0.17,0.19);
          vec3 c = y > 0.0 ? mix(hor, sky, smoothstep(0.0,0.35,y)) : mix(hor, gnd, smoothstep(0.0,0.25,-y));
          gl_FragColor = vec4(c*k, 1.0);
        }`,
    }),
  );
  scene.add(dome);
  const box = (w, h, x, y, z, e) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(e, e, e), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  // 顶部长条柔光（在机身上形成纵向高光带）
  box(60, 6, 0, 30, 0, 6 * intensity);
  box(40, 4, 10, 22, 22, 3.2 * intensity);
  box(40, 4, -10, 22, -22, 2.2 * intensity);
  box(14, 10, -32, 10, 18, 2.6 * intensity);
  box(14, 10, 32, 8, -18, 1.6 * intensity);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt.texture;
}

export function createEnvironment(renderer, scene) {
  const env = {};
  env.bgDay = gradientTexture(THEME.day);
  env.bgNight = gradientTexture(THEME.night);
  scene.background = env.bgDay;
  env.envDay = studioEnvironment(renderer, 1.0);
  env.envNight = studioEnvironment(renderer, 0.12);
  scene.environment = env.envDay;
  scene.environmentIntensity = 1.0;

  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2a2f38, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff6ea, 2.6);
  sun.position.set(-38, 62, 30);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 10; sc.far = 160;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0xb8ccff, 0.55);
  fill.position.set(40, 20, -35);
  scene.add(fill);

  // 地面：径向渐隐的深色圆盘 + 接收阴影
  const gCanvas = document.createElement('canvas');
  gCanvas.width = gCanvas.height = 512;
  const gc = gCanvas.getContext('2d');
  const rg = gc.createRadialGradient(256, 256, 0, 256, 256, 256);
  rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.55, '#ffffff'); rg.addColorStop(1, '#000000');
  gc.fillStyle = rg; gc.fillRect(0, 0, 512, 512);
  const alpha = new THREE.CanvasTexture(gCanvas);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(150, 96),
    new THREE.MeshStandardMaterial({ color: THEME.day.ground, roughness: 0.92, metalness: 0, transparent: true, alphaMap: alpha, depthWrite: true }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.renderOrder = -2;
  scene.add(ground);

  // 蓝图网格（1 m 细线 / 5 m 粗线，随距离淡出）
  const gridMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(THEME.day.grid) }, uFade: { value: 95 }, uOpacity: { value: 0.55 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `varying vec3 vW; uniform vec3 uColor; uniform float uFade; uniform float uOpacity;
      float line(vec2 p, float s, float w){ vec2 g = abs(fract(p/s - 0.5) - 0.5)/fwidth(p/s); return 1.0 - min(min(g.x,g.y)/w, 1.0); }
      void main(){
        vec2 p = vW.xz;
        float a = line(p, 1.0, 1.0)*0.18 + line(p, 5.0, 1.2)*0.45 + line(p, 25.0, 1.6)*0.5;
        float d = length(p);
        a *= 1.0 - smoothstep(uFade*0.45, uFade, d);
        gl_FragColor = vec4(uColor, a*uOpacity);
      }`,
  });
  const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), gridMat);
  gridMesh.rotation.x = -Math.PI / 2;
  gridMesh.position.y = 0.005;
  gridMesh.renderOrder = -1;
  scene.add(gridMesh);

  Object.assign(env, { hemi, sun, fill, ground, gridMesh, gridMat });

  env.setNight = (night) => {
    scene.background = night ? env.bgNight : env.bgDay;
    scene.environment = night ? env.envNight : env.envDay;
    hemi.intensity = night ? 0.06 : 0.55;
    sun.intensity = night ? 0.12 : 2.6;
    fill.intensity = night ? 0.05 : 0.55;
    ground.material.color.setHex(night ? THEME.night.ground : THEME.day.ground);
    gridMat.uniforms.uColor.value.setHex(night ? THEME.night.grid : THEME.day.grid);
  };
  return env;
}
