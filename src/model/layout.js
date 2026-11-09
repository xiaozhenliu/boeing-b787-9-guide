// 机身开口布局：舱门、货舱门、舷窗（站位 s 为距机头米数，高度均相对等截面段机腹线）
// 站位取自 Boeing D6-58333 Rev Q §2.7.1（787-9 列），尺寸取自 §2.7.2–2.7.4 门区图。
import { G } from './spec.js';

export const FLOOR = G.floorAboveKeel; // 客舱地板距机腹

// A 型旅客门（向外向前平移的塞式门）：净开口约 1.07 m × 1.85 m；外蒙皮门板轮廓略大
export const PAX_DOOR = { w: 1.14, h: 1.98, r: 0.25, sill: FLOOR - 0.02 };

// 1–4 号门左右成对：左舷为登机门，右舷为服务门（ACAPS 注 1）
export const DOORS = [
  { id: 'door1', label: '1 号门', s: 6.3 },
  { id: 'door2', label: '2 号门', s: 18.36 },
  { id: 'door3', label: '3 号门', s: 35.43 },
  { id: 'door4', label: '4 号门', s: 49.66 },
];

// 下舱货舱门。side：+1 左舷 / -1 右舷。bottom 为门槛距机腹参考线高度
// 前/后货舱门：上铰链、向外上翻，净开口 2.69 m × 1.70 m；散货舱门：位于左舷，向内上收，蒙皮开口 1.02 m × 1.56 m（后缘 1.51 m）
export const CARGO_DOORS = [
  { id: 'fwdCargo', label: '前货舱门', s: 11.0, side: -1, w: 2.69, h: 1.7, bottom: 1.0, r: 0.16, hinge: 'top' },
  { id: 'aftCargo', label: '后货舱门', s: 43.31, side: -1, w: 2.69, h: 1.7, bottom: 0.85, r: 0.16, hinge: 'top' },
  { id: 'bulkCargo', label: '散货舱门', s: 47.75, side: 1, w: 1.02, h: 1.56, bottom: 0.76, r: 0.13, hinge: 'inward' },
];

// 舷窗：27 cm × 47 cm（民航客机中最大的舷窗之一），电致变色五档调光
export const WINDOW = { w: 0.27, h: 0.47, centerAboveFloor: 1.1, pitch: 0.61 };

// 舷窗位于机身框距网格 s_k = 8.20 + 0.61·k 上（框距 24 in）。
// k=9（s 13.69，41/43 段对接框）与 k=61（s 45.41，46/47 段对接框）为空窗位；4 号门之后无窗。
const WINDOW_BAYS = [[0, 8], [10, 14], [19, 42], [47, 60], [62, 65]];
export const FRAME0 = 8.2;

/** 舷窗站位列表 */
export function windowStations() {
  const out = [];
  for (const [a, b] of WINDOW_BAYS) for (let k = a; k <= b; k++) out.push(FRAME0 + WINDOW.pitch * k);
  return out;
}
