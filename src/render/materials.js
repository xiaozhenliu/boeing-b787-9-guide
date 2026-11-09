// 材质库：外观 PBR 材质 + 结构/材料/分段模式配色 + X 光幽灵材质 + 剖切面着色
import * as THREE from 'three';
import { makeHoled } from './holes.js';

// 剖切时的“截面色”（背面着色），全局共享 uniform
export const CUT = {
  on: { value: 0 },
  color: { value: new THREE.Color('#c9d3dc') }, // 剖开后看到的蒙皮内表面（底漆色）
  // 第一人称（驾驶舱/客舱）时：蒙皮背面画成内饰板颜色，并按风挡轮廓开出窗洞
  inside: { value: 0 },
  lining: { value: new THREE.Color().setRGB(0.8, 0.825, 0.85) }, // 直接写入输出（不经色调映射），按显示值取色
  winMask: { value: null },
  winScale: { value: 1 },
};

/** 让材质在剖切时以醒目颜色显示背面，形成“实心截面”的视觉；第一人称时背面显示为内饰板 */
export function makeCuttable(mat) {
  mat.side = THREE.DoubleSide;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uCutOn = CUT.on;
    shader.uniforms.uCutColor = CUT.color;
    shader.uniforms.uInside = CUT.inside;
    shader.uniforms.uLining = CUT.lining;
    shader.fragmentShader = 'uniform float uCutOn;\nuniform vec3 uCutColor;\nuniform float uInside;\nuniform vec3 uLining;\n' + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
  if (!gl_FrontFacing) {
    if (uInside > 0.5) gl_FragColor = vec4(uLining * (0.62 + 0.38 * clamp(normal.z, 0.0, 1.0)), 1.0);
    else gl_FragColor = uCutOn > 0.5 ? vec4(uCutColor * (0.42 + 0.5 * clamp(normal.z, 0.0, 1.0)), 1.0) : vec4(gl_FragColor.rgb * 0.25, 1.0);
  }`,
    );
  };
  mat.customProgramCacheKey = () => 'cuttable';
  return mat;
}

/**
 * 机身漆面专用：第一人称时，蒙皮背面落在风挡遮罩（机头展开图）白色区域内的片元直接丢弃，
 * 于是从舱内透过窗洞能看到外景。遮罩 u = s / MASK_S = 机身 u × winScale。
 * 着色器与普通可剖切材质不同，必须使用不同的程序缓存键，否则会被共用的已编译程序顶替。
 */
function makeLined(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uWinMask = CUT.winMask;
    shader.uniforms.uWinScale = CUT.winScale;
    shader.fragmentShader = 'uniform sampler2D uWinMask;\nuniform float uWinScale;\n' + shader.fragmentShader.replace(
      'void main() {',
      `void main() {
  #ifdef USE_MAP
  if (uInside > 0.5 && !gl_FrontFacing) {
    vec2 wm = vec2(vMapUv.x * uWinScale, vMapUv.y);
    if (wm.x < 1.0 && texture2D(uWinMask, wm).r > 0.5) discard;
  }
  #endif`,
    );
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = () => key + '-lined';
  return mat;
}

/** X 光幽灵材质：菲涅尔边缘发光，半透明 */
export function ghostMaterial(color = '#7cc4ff', opacity = 0.5) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vV = -mvPosition.xyz; vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV;
      void main(){
        #include <clipping_planes_fragment>
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        f = pow(f, 2.2);
        gl_FragColor = vec4(uColor * (0.6 + 0.9 * f), uOpacity * (0.05 + 0.95 * f));
      }`,
  });
}

export function createMaterials(tex) {
  const M = {};
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const std = (o) => new THREE.MeshStandardMaterial(o);

  // 机身漆面（清漆层 → 锐利环境反射）
  const paintOpts = {
    color: 0xffffff, map: tex.fus.map, bumpMap: tex.fus.bumpMap, bumpScale: 1.2,
    roughness: 0.3, metalness: 0.0, clearcoat: 0.65, clearcoatRoughness: 0.14,
  };
  M.paint = makeLined(makeHoled(makeCuttable(phys(paintOpts)))); // 机身蒙皮/整流罩：支持起落架舱开洞、第一人称风挡窗洞
  if (tex.cockpit?.mask) { CUT.winMask.value = tex.cockpit.mask.tex; CUT.winScale.value = tex.cockpit.mask.scale; }
  M.panel = makeCuttable(phys(paintOpts)); // 舱门面板：同一涂装纹理，但不开洞
  M.white = makeCuttable(phys({ color: 0xf2f4f6, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.15 }));
  M.radome = makeCuttable(phys({ color: 0xeef1f4, roughness: 0.36, clearcoat: 0.45, clearcoatRoughness: 0.2 }));
  // 机翼：波音标准灰
  M.wing = makeCuttable(phys({ color: 0xc3c9d0, roughness: 0.42, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.3 }));
  M.wingDark = makeCuttable(phys({ color: 0xaab1b9, roughness: 0.45, metalness: 0.05, clearcoat: 0.25 }));
  M.walkway = std({ color: 0x8e959d, roughness: 0.7 });
  M.tail = makeCuttable(phys({ color: 0xffffff, map: tex.tail, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15 }));
  M.metal = std({ color: 0xe2e6ea, metalness: 1.0, roughness: 0.16 }); // 抛光铝（进气道唇口）
  M.brushed = std({ color: 0xc9ced4, metalness: 0.95, roughness: 0.32 });
  M.darkMetal = std({ color: 0x3c4148, metalness: 0.75, roughness: 0.45 });
  M.titanium = std({ color: 0x9b9fa6, metalness: 1.0, roughness: 0.3 });
  M.hot = std({ color: 0x5b4c42, metalness: 0.8, roughness: 0.5 }); // 尾喷管耐热合金
  M.chrome = std({ color: 0xf4f6f8, metalness: 1.0, roughness: 0.06 });
  M.gear = std({ color: 0xd9dce0, metalness: 0.2, roughness: 0.45 });
  M.gearDark = std({ color: 0x6c727a, metalness: 0.5, roughness: 0.5 });
  M.rubber = std({ color: 0x17181b, roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide });
  M.wheel = std({ color: 0xb4bac1, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
  M.wellDark = std({ color: 0x59606a, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }); // 轮舱内壁（底漆灰）
  M.glass = phys({ color: 0x0a1522, roughness: 0.03, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 1.8 });
  M.cockpitGlass = phys({ color: 0x0d1b26, roughness: 0.02, metalness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.01, envMapIntensity: 2.0 });
  M.frameDark = std({ color: 0x1d2228, roughness: 0.5, metalness: 0.2 });
  M.fanBlade = phys({ color: 0x2c3038, roughness: 0.28, metalness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  M.spinner = phys({ color: 0xa7adb5, metalness: 0.9, roughness: 0.22, clearcoat: 0.5 });
  M.nacelle = makeCuttable(phys({ color: 0xf2f4f6, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.14 }));
  M.duct = makeCuttable(std({ color: 0x4d535b, metalness: 0.35, roughness: 0.62 }));
  M.acoustic = std({ color: 0x5d636b, metalness: 0.3, roughness: 0.75 });
  M.lightRed = std({ color: 0xff3030, emissive: 0xff1010, emissiveIntensity: 0.6, roughness: 0.3 });
  M.lightGreen = std({ color: 0x30ff60, emissive: 0x10ff40, emissiveIntensity: 0.6, roughness: 0.3 });
  M.lightWhite = std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.3 });
  M.antenna = std({ color: 0xe8ebee, roughness: 0.45 });
  M.strobe = std({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 0.6, roughness: 0.25 }); // 频闪灯（由环境模块驱动闪烁）
  M.beacon = std({ color: 0xff2a1a, emissive: 0xff1800, emissiveIntensity: 0.6, roughness: 0.2 }); // 红色防撞信标
  M.landingLens = phys({ color: 0xb9c3cc, roughness: 0.14, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0xfff3dc, emissiveIntensity: 0 });
  // —— 系统模式 ——
  M.sysElec = std({ color: 0xffb02e, emissive: 0x8a4a00, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.2 }); // 电气设备
  M.sysAir = std({ color: 0x46c8ff, emissive: 0x0a4a70, emissiveIntensity: 0.35, roughness: 0.45, metalness: 0.3 }); // 空调/压缩机
  M.sysBattery = std({ color: 0x7ee081, emissive: 0x1d6b25, emissiveIntensity: 0.4, roughness: 0.5 });
  M.sysRack = std({ color: 0x3a4250, roughness: 0.6, metalness: 0.4 });
  M.blackPaint = std({ color: 0x15181c, roughness: 0.55 });

  // —— 结构透视模式配色 ——
  M.sFrame = std({ color: 0x4f9dff, roughness: 0.5, metalness: 0.1 });
  M.sStringer = std({ color: 0x7fd3ff, roughness: 0.5, metalness: 0.1 });
  M.sFloor = std({ color: 0xffc25a, roughness: 0.55, metalness: 0.1 });
  M.sFloorPanel = std({ color: 0xffd99a, roughness: 0.7, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  M.sBulkhead = std({ color: 0xff8a4c, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
  M.sSpar = std({ color: 0xff5d6c, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
  M.sRib = std({ color: 0x9ce37d, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
  M.sWingStringer = std({ color: 0x6fe0c8, roughness: 0.5 });
  M.sFuel = std({ color: 0x3aa0ff, roughness: 0.3, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  M.sFuelCenter = std({ color: 0x7a6bff, roughness: 0.3, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  M.sSurge = std({ color: 0x55e0ff, roughness: 0.3, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  M.sKeel = std({ color: 0xffa64d, roughness: 0.5 });
  M.seat = std({ color: 0x3b4f6e, roughness: 0.8 });
  M.seatBiz = std({ color: 0x6b5a46, roughness: 0.75 });
  M.cabinWall = std({ color: 0xe9edf2, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  M.bin = std({ color: 0xf4f6f8, roughness: 0.6 });
  M.container = std({ color: 0xaab4bf, metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide });
  M.screen = std({ color: 0x0b1626, emissive: 0x2a6fd0, emissiveIntensity: 0.55, roughness: 0.2 }); // 客舱娱乐屏
  // —— 驾驶舱（图集由 render/cockpitTextures.js 程序化绘制）——
  const ck = tex.cockpit || {};
  M.fdBody = std({ color: 0x2b3037, roughness: 0.62, metalness: 0.15, side: THREE.DoubleSide }); // 仪表板、操纵台壳体
  M.fdGlare = std({ color: 0x15181c, roughness: 0.93, side: THREE.DoubleSide }); // 遮光罩顶面（防眩哑光黑）
  M.fdDisplay = std({ color: 0x000000, emissive: 0xffffff, emissiveMap: ck.atlas || null, emissiveIntensity: 1.0, roughness: 0.3, metalness: 0 }); // 液晶屏
  M.fdMcp = std({ color: 0xffffff, map: ck.atlas || null, emissive: 0xffffff, emissiveMap: ck.atlas || null, emissiveIntensity: 0.14, roughness: 0.6, metalness: 0.1 });
  M.fdPanel = std({ color: 0xffffff, map: ck.panels || null, emissive: 0xffffff, emissiveMap: ck.panels || null, emissiveIntensity: 0.14, roughness: 0.62, metalness: 0.1 });
  M.fdHud = new THREE.MeshBasicMaterial({ map: ck.atlas || null, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  M.fdHudGlass = phys({ color: 0xa8f0cc, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  M.fdSeat = std({ color: 0x30353c, roughness: 0.78 });
  M.fdKnob = std({ color: 0x1a1d21, roughness: 0.38, metalness: 0.35 });
  M.fdLever = std({ color: 0xe4e7ea, roughness: 0.4, metalness: 0.1 });
  M.fdYoke = std({ color: 0x2b2e33, roughness: 0.48, metalness: 0.3 });
  M.fdLining = std({ color: 0xc9cfd6, roughness: 0.86, side: THREE.DoubleSide });
  M.fdDoor = std({ color: 0x8c959d, roughness: 0.55, metalness: 0.25 });
  M.fdCarpet = std({ color: 0x3a4250, roughness: 0.96 });
  M.carpet = std({ color: 0x55607a, roughness: 0.95 });
  M.galley = std({ color: 0xc9cfd6, metalness: 0.3, roughness: 0.5 });

  // —— 材料分布模式（参照波音公开的 787 材料分布图配色习惯）——
  M.compCFRP = std({ color: 0x2f6fd6, roughness: 0.45, metalness: 0.05 });
  M.compSandwich = std({ color: 0x77b9ff, roughness: 0.5 });
  M.compGlass = std({ color: 0x3fbf86, roughness: 0.5 });
  M.compAl = std({ color: 0xc3cad3, roughness: 0.35, metalness: 0.6 });
  M.compTi = std({ color: 0xd19a54, roughness: 0.35, metalness: 0.6 });
  M.compSteel = std({ color: 0x7c828b, roughness: 0.35, metalness: 0.7 });
  M.compOther = std({ color: 0xb08ad9, roughness: 0.5 });

  M.ghost = ghostMaterial('#7cc4ff', 0.42);
  M.ghostWing = ghostMaterial('#9fd6ff', 0.35);
  M.highlight = std({ color: 0xffb547, emissive: 0xff8a00, emissiveIntensity: 0.35, roughness: 0.4 });
  return M;
}

/** 供应商/分段配色（分段模式） */
export const SECTION_COLORS = {
  radome: '#e8e2d0',
  s41: '#f2a541',
  s43: '#e4572e',
  s44: '#29a19c',
  s46: '#3fb8af',
  s47: '#7b6cf6',
  s48: '#a685e2',
  tailcone: '#c9b8f0',
  s11: '#e9c46a',
  s45: '#f4a261',
  wing: '#4f86f7',
  fixedLE: '#8ecae6',
  movableTE: '#90be6d',
  wingtip: '#f28482',
  hstab: '#43aa8b',
  vfin: '#577590',
  fairing: '#c08497',
  nacelle: '#9aa5b1',
  engine: '#606c76',
  gear: '#b56576',
  doors: '#ffd166',
  cargoDoors: '#ef476f',
};
