// 标注点定义。part：知识库 partId；set：所属标注集（exterior / structure / cabin / systems）
// 定位方式（at）：
//   { dir:[x,y,z], side, sec }  自动：在该部件网格上，从 dir 方向（机体系）射向部件找表面点；side 选左(+1)/右(-1)侧那一组网格；sec 限定分段
//   { body:[s,y,z], follow }    显式：机体系坐标；follow 为跟随的组（分段 id，如 's41'，或 'fairing'；缺省跟随机体）
// prio：1 = 常显；2 = 镜头靠近（< near，缺省 32 m）或“全部”模式才显示。off：标签相对锚点的屏幕偏移（像素）
import * as THREE from 'three';
import { point, tAtHeight, FUS } from '../model/fuselage.js';
import { FRAME0, WINDOW, DOORS, CARGO_DOORS, PAX_DOOR } from '../model/layout.js';
import { CABIN_FLOOR, CARGO_FLOOR } from '../model/interior.js';
import { FD_SPOTS } from './cockpit-kb.js';

/** 机身表面点：站位 s、离地高度 y（机体系）、侧别 */
function skin(s, y, side = 1, out = 0.02) {
  const t = tAtHeight(s, y, side);
  const p = point(s, t, new THREE.Vector3());
  p.z += side * out;
  return [p.x, p.y, p.z];
}
const secOf = (s) => (s < 1.25 ? 'radome' : s < 13.69 ? 's41' : s < 23.2 ? 's43' : s < 31.7 ? 's44' : s < 45.41 ? 's46' : s < 52.1 ? 's47' : s < 56.4 ? 's48' : 'tailcone');

const doorSpots = DOORS.map((d, i) => ({
  part: d.id, set: 'exterior', prio: i === 0 ? 1 : 2,
  at: { body: skin(d.s, FUS.floor + PAX_DOOR.h * 0.55), follow: secOf(d.s) }, off: [-10, -64],
}));
const cargoSpots = CARGO_DOORS.map((d) => ({
  part: d.id, set: 'exterior', prio: 2,
  at: { body: skin(d.s, 1.85 + d.bottom + d.h * 0.5, d.side), follow: secOf(d.s) }, off: [0, 56],
}));

export const HOTSPOTS = [
  // ———————— 外观 ————————
  { part: 'radome', set: 'exterior', prio: 1, at: { dir: [-1, 0.15, 0.35] }, off: [-70, -36] },
  { part: 'cockpit', set: 'exterior', prio: 1, at: { dir: [-0.55, 0.55, 0.65] }, off: [-40, -70] },
  { part: 'probes', set: 'exterior', prio: 2, at: { dir: [-0.2, -0.1, 1] }, off: [-60, 44] },
  ...doorSpots,
  ...cargoSpots,
  { part: 'windows', set: 'exterior', prio: 1, at: { body: skin(FRAME0 + WINDOW.pitch * 22, FUS.floor + WINDOW.centerAboveFloor), follow: 's43' }, off: [0, -70] },
  { part: 'fairing', set: 'exterior', prio: 2, at: { dir: [0.1, -0.5, 1] }, off: [30, 58] },
  { part: 'wing', set: 'exterior', prio: 1, at: { dir: [0, 1, 0] }, off: [40, -60] },
  { part: 'wingtip', set: 'exterior', prio: 1, at: { dir: [0, 1, 0.2] }, off: [30, -56] },
  { part: 'navLights', set: 'exterior', prio: 2, at: { dir: [-0.6, 0.3, 1] }, off: [56, 30] },
  { part: 'slats', set: 'exterior', prio: 2, at: { dir: [-0.4, 1, 0] }, off: [-70, -30] },
  { part: 'krueger', set: 'exterior', prio: 2, at: { dir: [-1, -0.4, 0] }, off: [-70, 36] },
  { part: 'flapIn', set: 'exterior', prio: 2, at: { dir: [0.3, 1, 0] }, off: [60, 26] },
  { part: 'flaperon', set: 'exterior', prio: 2, at: { dir: [0.3, 1, 0] }, off: [64, 34] },
  { part: 'flapOut', set: 'exterior', prio: 2, at: { dir: [0.3, 1, 0] }, off: [60, 30] },
  { part: 'aileron', set: 'exterior', prio: 2, at: { dir: [0.3, 1, 0] }, off: [56, 30] },
  { part: 'spoilers', set: 'exterior', prio: 2, at: { dir: [0, 1, 0] }, off: [40, -48] },
  { part: 'flapFairing', set: 'exterior', prio: 2, at: { dir: [0.4, -1, 0.3] }, off: [50, 40] },
  { part: 'inlet', set: 'exterior', prio: 1, at: { dir: [-1, 0.35, 0.35] }, off: [-70, -40] },
  { part: 'reverser', set: 'exterior', prio: 2, at: { dir: [0.2, 0.6, 1] }, off: [40, -52], label: '反推与锯齿形喷口' },
  { part: 'exhaust', set: 'exterior', prio: 2, at: { dir: [1, 0.2, 0.6] }, off: [60, 30] },
  { part: 'pylon', set: 'exterior', prio: 2, at: { dir: [0, 0.5, 1] }, off: [30, -60] },
  { part: 'noseGear', set: 'exterior', prio: 1, at: { dir: [-0.3, -0.2, 1] }, off: [-40, 56] },
  { part: 'mainGear', set: 'exterior', prio: 1, at: { dir: [0, -0.1, 1] }, off: [-30, 60] },
  { part: 'wheels', set: 'exterior', prio: 2, at: { dir: [0.4, -0.2, 1] }, off: [60, 40] },
  { part: 'brakes', set: 'exterior', prio: 2, at: { dir: [0.2, 0.1, 1] }, off: [70, 10] },
  { part: 'gearDoors', set: 'exterior', prio: 2, at: { dir: [0, -1, 0.3] }, off: [40, 50] },
  { part: 'vtail', set: 'exterior', prio: 1, at: { dir: [0, 0.2, 1] }, off: [-50, -50] },
  { part: 'rudder', set: 'exterior', prio: 2, at: { dir: [0.2, 0, 1] }, off: [56, -30] },
  { part: 'htail', set: 'exterior', prio: 1, at: { dir: [0, 1, 0.25] }, off: [-40, -46] },
  { part: 'elevator', set: 'exterior', prio: 2, at: { dir: [0.3, 1, 0.2] }, off: [56, 26] },
  { part: 'apu', set: 'exterior', prio: 1, at: { dir: [1, 0, 0.4] }, off: [60, 30] },
  { part: 'apuDoor', set: 'exterior', prio: 2, at: { dir: [0, 0.6, -1] }, off: [50, -40] },

  // ———————— 内部结构 ————————
  { part: 'frames', set: 'structure', prio: 1, at: { dir: [0, 0.5, 1], sec: 's43' }, off: [-30, -64] },
  { part: 'stringers', set: 'structure', prio: 1, at: { dir: [0, 0.9, 0.4], sec: 's46' }, off: [20, -64] },
  { part: 'doorFrames', set: 'structure', prio: 2, at: { body: skin(DOORS[1].s - 0.75, FUS.floor + 1.2, 1, -0.05), follow: 's43' }, off: [-40, -50] },
  { part: 'floorBeams', set: 'structure', prio: 1, at: { dir: [0, 0.2, 1], sec: 's46' }, off: [50, 30] },
  { part: 'seatTracks', set: 'structure', prio: 2, at: { dir: [0, 1, 0.1], sec: 's43' }, off: [-60, -30] },
  { part: 'floorPanels', set: 'structure', prio: 2, at: { dir: [0, 1, 0], sec: 's47' }, off: [40, -40] },
  { part: 'cargoFloor', set: 'structure', prio: 2, at: { dir: [0, 0.3, 1], sec: 's43' }, off: [-50, 44] },
  { part: 'keel', set: 'structure', prio: 1, at: { dir: [0, -0.4, 1] }, off: [-40, 56] },
  { part: 'bulkheads', set: 'structure', prio: 1, at: { dir: [1, 0.3, 0.5], sec: 's47' }, off: [50, -44] },
  { part: 'centerWingBox', set: 'structure', prio: 1, at: { dir: [0, 1, 0.3] }, off: [-30, -60] },
  { part: 'centerTank', set: 'structure', prio: 2, at: { dir: [0, 0.4, 1] }, off: [-60, 40] },
  { part: 'frontSpar', set: 'structure', prio: 1, at: { dir: [-1, 0.5, 0] }, off: [-60, -36] },
  { part: 'rearSpar', set: 'structure', prio: 1, at: { dir: [1, 0.5, 0] }, off: [56, 30] },
  { part: 'ribs', set: 'structure', prio: 1, at: { dir: [0, 1, 0] }, off: [40, -50] },
  { part: 'wingStringers', set: 'structure', prio: 2, at: { dir: [0, 1, 0.2] }, off: [56, -26] },
  { part: 'mainTank', set: 'structure', prio: 1, at: { dir: [0, 1, 0] }, off: [-30, -56] },
  { part: 'surgeTank', set: 'structure', prio: 2, at: { dir: [0, 1, 0] }, off: [40, -40] },
  { part: 'tailSpars', set: 'structure', prio: 2, at: { dir: [0, 0.2, 1] }, off: [-60, -30] },
  { part: 'tailRibs', set: 'structure', prio: 2, at: { dir: [0.3, 0.2, 1] }, off: [56, -26] },

  // ———————— 客舱与货舱 ————————
  { part: 'flightDeck', set: 'cabin', prio: 1, at: { dir: [0, 1, 0.2] }, off: [-40, -60] },
  { part: 'seatsBiz', set: 'cabin', prio: 1, at: { dir: [0, 1, 0.3] }, off: [-30, -64] },
  { part: 'seatsEco', set: 'cabin', prio: 1, at: { dir: [0, 1, 0.3] }, off: [30, -64] },
  { part: 'galleys', set: 'cabin', prio: 1, at: { dir: [0, 1, 0] }, off: [20, -60] },
  { part: 'bins', set: 'cabin', prio: 2, at: { dir: [0, 1, 0.4] }, off: [40, -40] },
  { part: 'ife', set: 'cabin', prio: 2, at: { dir: [-1, 0.5, 0.2] }, off: [-50, -40] },
  { part: 'cabinWall', set: 'cabin', prio: 2, at: { dir: [0, 0.3, 1] }, off: [50, 40] },
  { part: 'cargo', set: 'cabin', prio: 1, at: { body: [12, CARGO_FLOOR + 1.0, 1.1] }, off: [-40, 60] },
  { part: 'cargoFloorPanel', set: 'cabin', prio: 2, at: { body: [40, CARGO_FLOOR + 0.02, 1.2] }, off: [40, 56] },
  { part: 'cabinFloor', set: 'cabin', prio: 2, at: { body: [27, CABIN_FLOOR + 0.02, 0.85] }, off: [-50, 40] },

  // ———————— 外观：灯光、天线、进气口、RAT ————————
  { part: 'beacon', set: 'exterior', prio: 2, at: { body: [27.6, 7.9, 0], follow: 's44' }, off: [30, -50] },
  { part: 'antennas', set: 'exterior', prio: 2, at: { body: [15.45, 8.05, 0], follow: 's43' }, off: [-30, -56] },
  { part: 'landingLights', set: 'exterior', prio: 2, at: { body: [21.2, 3.5, 2.66], follow: 'fairing' }, off: [-60, 30] },
  { part: 'cac', set: 'exterior', prio: 2, at: { body: [22.45, 2.64, 2.42], follow: 'fairing' }, off: [-50, 50] },
  { part: 'strobes', set: 'exterior', prio: 2, at: { dir: [1, 0.3, 0.4], side: 1 }, off: [60, -30] },
  { part: 'ram', set: 'exterior', prio: 2, at: { body: [35.25, 2.5, -2.62], follow: 'fairing' }, off: [40, 56] },

  // ———————— 系统（多电架构） ————————
  { part: 'vfsg', set: 'systems', prio: 1, at: { dir: [0.2, -1, 0.4], side: 1 }, off: [-50, 60] },
  { part: 'agb', set: 'systems', prio: 2, at: { dir: [0, -1, 0.2], side: 1 }, off: [40, 64] },
  { part: 'flowBleed', set: 'systems', prio: 2, at: { body: [21.0, 4.12, 9.9] }, off: [-60, -50] },
  { part: 'flowElec', set: 'systems', prio: 1, at: { body: [32.4, 5.6, 18] }, off: [40, -56] },
  { part: 'flowAir', set: 'systems', prio: 1, at: { body: [16, 6.95, 0.55] }, off: [-20, -64] },
  { part: 'eeBay', set: 'systems', prio: 1, at: { body: [6.65, 3.4, 0.6], follow: 's41' }, off: [-40, -60], label: '前电子电气舱' },
  { part: 'eeBay', set: 'systems', prio: 1, at: { body: [33.2, 3.55, 0.6], follow: 's46' }, off: [40, -66], label: '后电子电气舱' },
  { part: 'battery', set: 'systems', prio: 2, at: { body: [6.95, 2.5, 0.98], follow: 's41' }, off: [-50, 50], label: '主电池' },
  { part: 'battery', set: 'systems', prio: 2, at: { body: [33.25, 2.57, -1.05], follow: 's46' }, off: [50, 50], label: 'APU 电池' },
  { part: 'cacUnit', set: 'systems', prio: 1, at: { body: [22.9, 2.18, 0.72] }, off: [-50, 64] },
  { part: 'packs', set: 'systems', prio: 2, at: { body: [25.4, 2.1, 0.62] }, off: [30, 70] },
  { part: 'cac', set: 'systems', prio: 2, at: { body: [22.45, 2.64, 2.42] }, off: [-64, -30] },
  { part: 'apu', set: 'systems', prio: 2, at: { body: [58.55, 5.8, 0], follow: 'tailcone' }, off: [30, -56] },
  { part: 'asg', set: 'systems', prio: 2, at: { body: [57.15, 5.33, 0.26], follow: 'tailcone' }, off: [-50, 50] },
  { part: 'ram', set: 'systems', prio: 2, at: { body: [35.25, 2.5, -2.62] }, off: [40, 56] },

  // ———————— 驾驶舱内：分仪表标注（镜头在驾驶舱内时启用） ————————
  ...FD_SPOTS,
];

/** 标注集合 → 中文名 */
export const SPOT_SETS = { exterior: '外观', structure: '结构', cabin: '客舱', systems: '系统', cockpit: '驾驶舱' };
