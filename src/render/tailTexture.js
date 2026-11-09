// 垂尾涂装贴图：先在“物理坐标”画布上作画（保证文字不随后掠剪切变形），再逐像素映射到参数域 (ξ, η)
import * as THREE from 'three';
import { VTAIL } from '../model/spec.js';
import { FIN } from '../model/empennage.js';

export function createTailTexture() {
  const TW = 2048, TH = 1024; // 参数域贴图：左半 = 左舷（前缘→后缘），右半 = 右舷（后缘→前缘）
  const { rootLE, rootChord, tipLE, tipChord, tipRise } = VTAIL;
  const height = FIN.Hf; // 翼根至翼尖前缘角的高度
  // 物理画布：覆盖整片垂尾侧视外形（含翼尖斜切抬高量）
  const x0 = rootLE - 0.5, x1 = Math.max(rootLE + rootChord, tipLE + tipChord) + 0.5;
  const PW = 1600, PH = Math.round((PW * (height + tipRise + 1)) / (x1 - x0));
  const pc = document.createElement('canvas');
  pc.width = PW; pc.height = PH;
  const g = pc.getContext('2d');
  const sx = PW / (x1 - x0), sy = PH / (height + tipRise + 1);
  const P = (x, y) => [(x - x0) * sx, PH - (y + 0.5) * sy]; // 物理 (x 站位, y 高于翼根) → 画布

  // 底色：深蓝 → 中蓝渐变
  const base = g.createLinearGradient(0, PH, PW * 0.6, 0);
  base.addColorStop(0, '#0b2e5c');
  base.addColorStop(0.55, '#134a8e');
  base.addColorStop(1, '#1d63b8');
  g.fillStyle = base;
  g.fillRect(0, 0, PW, PH);
  // 扫掠飘带（自前下方向后上方）
  const ribbon = (offset, width, color, alpha) => {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const x = rootLE - 1 + u * (rootChord + 6);
      const y = height * (0.05 + 0.95 * Math.pow(u, 1.6)) + offset;
      pts.push(P(x, y));
    }
    g.moveTo(...pts[0]);
    pts.forEach((p) => g.lineTo(...p));
    for (let i = 40; i >= 0; i--) {
      const u = i / 40;
      const x = rootLE - 1 + u * (rootChord + 6);
      const y = height * (0.05 + 0.95 * Math.pow(u, 1.6)) + offset - width * (0.4 + u);
      g.lineTo(...P(x, y));
    }
    g.closePath();
    g.fill();
    g.restore();
  };
  ribbon(0.2, 1.2, '#3d8ee6', 0.55);
  ribbon(-0.9, 0.7, '#6fb6ff', 0.45);
  ribbon(-1.9, 0.35, '#a9d6ff', 0.35);
  // 文字 787（白色，保持竖直）。右舷从另一侧观看，需在物理坐标中水平镜像书写才能正读
  const pcS = document.createElement('canvas');
  pcS.width = PW; pcS.height = PH;
  const gS = pcS.getContext('2d');
  gS.drawImage(pc, 0, 0);
  const [tx, ty] = P(rootLE + 0.52 * rootChord + 0.32 * height * Math.tan((VTAIL.sweepLE * Math.PI) / 180), height * 0.62);
  for (const [ctx, mirror] of [[g, false], [gS, true]]) {
    ctx.save();
    ctx.translate(tx, ty);
    if (mirror) ctx.scale(-1, 1);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(1.55 * sy)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText('787', 0, 0);
    ctx.font = `600 ${Math.round(0.42 * sy)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText('DREAMLINER', 0, 1.15 * sy);
    ctx.restore();
  }

  // 逐像素映射到参数域
  const srcP = g.getImageData(0, 0, PW, PH).data;
  const srcS = gS.getImageData(0, 0, PW, PH).data;
  const out = document.createElement('canvas');
  out.width = TW; out.height = TH;
  const o = out.getContext('2d');
  const img = o.createImageData(TW, TH);
  const d = img.data;
  for (let py = 0; py < TH; py++) {
    const eta = 1 - (py + 0.5) / TH;
    const le = FIN.leX(eta);
    const ch = FIN.chord(eta);
    const yb = eta * height;
    for (let px = 0; px < TW; px++) {
      const u = (px + 0.5) / TW;
      const xi = u < 0.5 ? u * 2 : (1 - u) * 2;
      const x = le + xi * ch;
      const y = yb + xi * tipRise * eta; // 与几何一致的翼尖斜切
      let cx = Math.round((x - x0) * sx), cy = Math.round(PH - (y + 0.5) * sy);
      cx = Math.min(PW - 1, Math.max(0, cx)); cy = Math.min(PH - 1, Math.max(0, cy));
      const src = u < 0.5 ? srcP : srcS;
      const si = (cy * PW + cx) * 4, di = (py * TW + px) * 4;
      d[di] = src[si]; d[di + 1] = src[si + 1]; d[di + 2] = src[si + 2]; d[di + 3] = 255;
    }
  }
  o.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
