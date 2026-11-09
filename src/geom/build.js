// 几何构建工具：参数网格、分段放样（带硬边）、绕 X 轴回转体、端盖三角化
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3();

/**
 * 规则网格曲面。rows × cols，pos(i,j,out) 写入点坐标。
 * closeCols: 列方向闭合（复制接缝列，法线取平均以消除接缝）。
 * 默认绕序：行沿 +a、列沿 +b 时法线 = a × b。
 */
export function grid(rows, cols, pos, opts = {}) {
  const { closeCols = false, uv = null, flip = false } = opts;
  const C = closeCols ? cols + 1 : cols;
  const P = new Float32Array(rows * C * 3);
  const UV = new Float32Array(rows * C * 2);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < C; j++) {
      const jj = closeCols && j === cols ? 0 : j;
      pos(i, jj, _v);
      const k = i * C + j;
      P[k * 3] = _v.x; P[k * 3 + 1] = _v.y; P[k * 3 + 2] = _v.z;
      if (uv) {
        const r = uv(i, j);
        UV[k * 2] = r[0]; UV[k * 2 + 1] = r[1];
      } else {
        UV[k * 2] = rows > 1 ? i / (rows - 1) : 0;
        UV[k * 2 + 1] = C > 1 ? j / (C - 1) : 0;
      }
    }
  }
  const idx = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < C - 1; j++) {
      const a = i * C + j, b = (i + 1) * C + j, c = (i + 1) * C + j + 1, d = i * C + j + 1;
      if (flip) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closeCols) {
    const N = g.attributes.normal;
    for (let i = 0; i < rows; i++) {
      const a = i * C, b = i * C + cols;
      _v.set(N.getX(a) + N.getX(b), N.getY(a) + N.getY(b), N.getZ(a) + N.getZ(b)).normalize();
      N.setXYZ(a, _v.x, _v.y, _v.z); N.setXYZ(b, _v.x, _v.y, _v.z);
    }
  }
  return g;
}

/** 平面多边形端盖（Newell 法求平面法线后投影到 2D，earcut 三角化）。facing: 期望法线方向 */
export function capPolygon(points, facing) {
  const n = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  if (n.lengthSq() < 1e-14) n.copy(facing);
  n.normalize();
  const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1);
  const pts2 = points.map((p) => new THREE.Vector2(p.dot(t1), p.dot(t2)));
  let tris = THREE.ShapeUtils.triangulateShape(pts2, []);
  const P = new Float32Array(points.length * 3);
  points.forEach((p, i) => { P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z; });
  const idx = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), tn = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    e1.subVectors(points[b], points[a]); e2.subVectors(points[c], points[a]);
    tn.crossVectors(e1, e2);
    if (tn.dot(facing) < 0) idx.push(a, c, b); else idx.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  const nn = facing.clone().normalize();
  const N = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) { N[i * 3] = nn.x; N[i * 3 + 1] = nn.y; N[i * 3 + 2] = nn.z; }
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(points.length * 2), 2));
  g.setIndex(idx);
  return g;
}

/**
 * 分段放样实体。stations[i] = 该站位的截面，由若干段组成（segments[k] = Vector3[]），
 * 各站位段数与每段点数一致。段内平滑，段间硬边。可选首尾端盖。
 * 自动根据有符号体积纠正绕序，保证法线朝外。
 */
export function loftSolid(stations, opts = {}) {
  const { capStart = true, capEnd = true, uvScale = null } = opts;
  const nS = stations.length;
  const nSeg = stations[0].length;
  const loopAt = (i) => {
    const pts = [];
    for (let k = 0; k < nSeg; k++) {
      const seg = stations[i][k];
      for (let j = 0; j < seg.length - 1; j++) pts.push(seg[j]);
    }
    return pts;
  };
  const axis = new THREE.Vector3().subVectors(centroid(loopAt(nS - 1)), centroid(loopAt(0))).normalize();
  // 截面环绕方向：Newell 法线与放样轴同向（从 +轴方向看为逆时针）时，默认绕序法线朝内，需要翻转
  const flip = newell(loopAt(0)).dot(axis) > 0;
  const parts = [];
  for (let k = 0; k < nSeg; k++) {
    const cols = stations[0][k].length;
    parts.push(grid(nS, cols, (i, j, out) => out.copy(stations[i][k][j]), {
      flip,
      uv: uvScale ? (i, j) => uvScale(i, k, j) : null,
    }));
  }
  if (capStart) parts.push(capPolygon(loopAt(0), axis.clone().negate()));
  if (capEnd) parts.push(capPolygon(loopAt(nS - 1), axis.clone()));
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function centroid(pts) {
  const c = new THREE.Vector3();
  pts.forEach((p) => c.add(p));
  return c.multiplyScalar(1 / pts.length);
}

export function newell(points) {
  const n = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n;
}

export function flipGeometry(g) {
  const I = g.index;
  for (let t = 0; t < I.count; t += 3) {
    const x = I.getX(t + 1);
    I.setX(t + 1, I.getX(t + 2));
    I.setX(t + 2, x);
  }
  I.needsUpdate = true;
  const N = g.attributes.normal;
  if (N) {
    for (let i = 0; i < N.count; i++) N.setXYZ(i, -N.getX(i), -N.getY(i), -N.getZ(i));
    N.needsUpdate = true;
  }
}

/**
 * 绕 X 轴回转体。profile: 若干段，每段为 [[x, r], ...]；段内平滑、段间硬边。
 * 约定：沿轮廓行进方向右侧为实体（在 x-r 平面顺时针），此时法线朝外。
 */
export function revolve(profile, opts = {}) {
  const { segments = 64, phi0 = 0, phi1 = Math.PI * 2, uvLen = null } = opts;
  const full = Math.abs(phi1 - phi0 - Math.PI * 2) < 1e-6;
  const segs = Array.isArray(profile[0][0]) ? profile : [profile];
  const parts = segs.map((seg) => {
    const cols = full ? segments : segments + 1;
    return grid(seg.length, cols, (i, j, out) => {
      const phi = phi0 + (phi1 - phi0) * (j / segments);
      const [x, r] = seg[i];
      out.set(x, r * Math.cos(phi), r * Math.sin(phi));
    }, {
      closeCols: full,
      flip: true,
      uv: (i, j) => [uvLen ? seg[i][0] / uvLen : i / (seg.length - 1), j / segments],
    });
  });
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (parts.length > 1) parts.forEach((p) => p.dispose());
  return g;
}

/** 合并几何（统一属性：position/normal/uv） */
export function merge(geoms) {
  const list = geoms.filter(Boolean).map((h) => {
    if (!h.attributes.uv) h.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
    if (!h.attributes.normal) h.computeVertexNormals();
    for (const k of Object.keys(h.attributes)) if (!['position', 'normal', 'uv'].includes(k)) h.deleteAttribute(k);
    if (!h.index) {
      const n = h.attributes.position.count;
      const idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i;
      h.setIndex(idx);
    }
    return h;
  });
  if (!list.length) return new THREE.BufferGeometry();
  const m = mergeGeometries(list, false);
  return m;
}

/** 沿折线扫掠圆管（用于液压管、电缆、起落架撑杆等） */
export function tube(points, radius, radial = 10, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal', 0.5);
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 8), radius, radial, closed);
}

/** 两点之间的圆柱（端点 a→b） */
export function cylinderBetween(a, b, r0, r1 = r0, radial = 16, capped = true) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, !capped);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

/** 两点之间的方盒（截面 w×h，h 方向尽量朝 up） */
export function boxBetween(a, b, w, h, up = new THREE.Vector3(0, 1, 0)) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.BoxGeometry(len, h, w);
  g.translate(len / 2, 0, 0);
  const x = dir.clone().normalize();
  let z = new THREE.Vector3().crossVectors(x, up);
  if (z.lengthSq() < 1e-8) z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 0, 1));
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(a);
  g.applyMatrix4(m);
  return g;
}
