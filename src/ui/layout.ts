/** Fixed design-space geometry for the table stage (scaled as a whole to fit the window). */
export const STAGE_W = 1100;
export const STAGE_H = 640;

export interface Pt {
  x: number;
  y: number;
}

/** Six layout slots, clockwise starting from the hero at the bottom. */
const SLOTS: { seat: Pt; bet: Pt; button: Pt }[] = [
  { seat: { x: 550, y: 560 }, bet: { x: 550, y: 432 }, button: { x: 668, y: 470 } },
  { seat: { x: 150, y: 462 }, bet: { x: 305, y: 404 }, button: { x: 262, y: 470 } },
  { seat: { x: 150, y: 168 }, bet: { x: 305, y: 222 }, button: { x: 262, y: 156 } },
  { seat: { x: 550, y: 70 }, bet: { x: 550, y: 168 }, button: { x: 668, y: 118 } },
  { seat: { x: 950, y: 168 }, bet: { x: 795, y: 222 }, button: { x: 838, y: 156 } },
  { seat: { x: 950, y: 462 }, bet: { x: 795, y: 404 }, button: { x: 838, y: 470 } },
];

const SLOT_MAP: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 2, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

/** Geometry for physical seat `seat` at a table with `tableSize` seats. */
export function slotFor(seat: number, tableSize: number) {
  const map = SLOT_MAP[tableSize] ?? SLOT_MAP[6];
  return SLOTS[map[seat] ?? seat];
}

export const POT_PT: Pt = { x: 550, y: 262 };
export const BOARD_PT: Pt = { x: 550, y: 330 };
export const DEALER_PT: Pt = { x: 550, y: 200 };
