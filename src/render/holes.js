// 蒙皮“开洞”：在漆面材质的片元着色器里丢弃落在指定盒子内的片元。
// 用于起落架舱门打开时露出轮舱——任意视角都正确，无需真的切割网格。
// 盒子在机体系中定义（中心 + 半尺寸），每帧换算为“世界 → 单位盒”矩阵。
import * as THREE from 'three';

const N = 4; // 0 前轮舱，1/2 左/右主轮舱，3 冲压空气涡轮（RAT）舱
export const HOLES = {
  mats: Array.from({ length: N }, () => new THREE.Matrix4()),
  on: new Array(N).fill(0),
  boxes: Array.from({ length: N }, () => new THREE.Matrix4()), // 机体系：单位盒 → 实际盒
};

/** 定义第 i 个洞（机体系轴对齐盒） */
export function setHoleBox(i, center, half) {
  HOLES.boxes[i].makeScale(half.x, half.y, half.z).setPosition(center);
}

/** 由机体组的世界矩阵刷新着色器用矩阵 */
export function updateHoles(acMatrixWorld) {
  for (let i = 0; i < N; i++) HOLES.mats[i].multiplyMatrices(acMatrixWorld, HOLES.boxes[i]).invert();
}

export function makeHoled(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uHoleM = { value: HOLES.mats };
    shader.uniforms.uHoleOn = { value: HOLES.on };
    shader.vertexShader = 'varying vec3 vHoleW;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = `varying vec3 vHoleW;\nuniform mat4 uHoleM[${N}];\nuniform float uHoleOn[${N}];\n` + shader.fragmentShader.replace(
      'void main() {',
      `void main() {
  for (int i = 0; i < ${N}; i++) {
    if (uHoleOn[i] > 0.5) {
      vec3 q = (uHoleM[i] * vec4(vHoleW, 1.0)).xyz;
      if (all(lessThan(abs(q), vec3(1.0)))) discard;
    }
  }`,
    );
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = () => key + '-holed';
  return mat;
}
