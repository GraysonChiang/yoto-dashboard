// 列印標籤的純排版邏輯（單位 mm）。不碰 DOM，Node 裡可以直接測。

// ISO/IEC 7810 ID-1（信用卡、NFC 卡）
export const CARD = { w: 54, h: 85.6, r: 3.18 };
export const A4 = { w: 210, h: 297 };
export const COLS = 3;
export const ROWS = 3;
export const PER_PAGE = COLS * ROWS;
// 一般印表機四周約 3～5 mm 印不到
export const MIN_MARGIN = 5;

// 3×3 格子在 A4 上置中。gap = 卡片之間的間距。
export function gridGeometry({ gap = 0 } = {}) {
  const width = COLS * CARD.w + (COLS - 1) * gap;
  const height = ROWS * CARD.h + (ROWS - 1) * gap;
  if (width > A4.w - 2 * MIN_MARGIN || height > A4.h - 2 * MIN_MARGIN) {
    throw new Error(`間距 ${gap} mm 太大，3×3 放不下 A4（四周需留 ${MIN_MARGIN} mm）`);
  }
  const x0 = (A4.w - width) / 2;
  const y0 = (A4.h - height) / 2;
  const slots = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      slots.push({ x: x0 + c * (CARD.w + gap), y: y0 + r * (CARD.h + gap) });
    }
  }
  return { width, height, x0, y0, gap, slots };
}

// ---- 紙張版型 ----
// 「悠遊卡 8 格」座標取自廠商 AI 版型（8554.zip）的向量模切線：貼紙 54×85.6 mm、圓角 3.09 mm、
// 間距 10 mm，四角 5 mm 定位圓點。同一張紙有直放 / 橫放兩種擺法。
const EASYCARD = { w: 54, h: 85.6, r: 3.09 };
export const LAYOUTS = {
  'a4-3x3': {
    name: '一般 A4 貼紙（3×3，自己剪）',
    page: A4, pageSize: 'A4', perPage: PER_PAGE, die: false, rotate: false,
  },
  'easycard-8': {
    name: '悠遊卡模切貼紙 8 格（A4 橫放，建議）',
    page: { w: 297, h: 210 }, pageSize: 'A4 landscape', perPage: 8, die: true, rotate: false,
    label: EASYCARD,
    xs: [25.5, 89.5, 153.5, 217.5], ys: [14.4, 110],
    dots: [[7.5, 7.5], [284.5, 7.5], [7.5, 197.5], [284.5, 197.5]],
  },
  'easycard-8-portrait': {
    name: '悠遊卡模切貼紙 8 格（A4 直放，封面轉 90°）',
    page: A4, pageSize: 'A4', perPage: 8, die: true, rotate: true,
    label: { w: EASYCARD.h, h: EASYCARD.w, r: EASYCARD.r },
    xs: [14.4, 110], ys: [25.5, 89.5, 153.5, 217.5],
    dots: [[7.5, 7.5], [197.5, 7.5], [7.5, 284.5], [197.5, 284.5]],
  },
};
export const DOT = 5; // 定位圓點直徑

// 回傳某個版型實際的排版：格子左上角、貼紙尺寸、間距、定位點（都已套用印表機位移）
export function layoutGeometry(id, { gap = 3, offsetX = 0, offsetY = 0 } = {}) {
  const L = LAYOUTS[id];
  if (!L) throw new Error(`未知的紙張版型：${id}`);
  const shift = (p) => ({ x: +(p.x + offsetX).toFixed(4), y: +(p.y + offsetY).toFixed(4) });
  let label, slots, spacing;
  if (L.die) {
    label = { ...L.label };
    slots = L.ys.flatMap((y) => L.xs.map((x) => shift({ x, y })));
    const dx = L.xs[1] - L.xs[0] - label.w;
    const dy = L.ys[1] - L.ys[0] - label.h;
    spacing = Math.min(dx, dy);
  } else {
    const g = gridGeometry({ gap });
    label = { ...CARD };
    slots = g.slots.map(shift);
    spacing = gap;
  }
  const dots = (L.dots || []).map(([x, y]) => shift({ x, y }));
  return { id, name: L.name, page: L.page, pageSize: L.pageSize, perPage: L.perPage, die: L.die, rotate: L.rotate,
    label, slots, gap: spacing, dots };
}

// items: [{ id, copies }] → 每頁 perPage 格的陣列，空格為 null。
// startSlot：第一頁從第幾格開始（0 起算），前面留空，方便接著用印過一半的標籤紙。
export function paginate(items, { startSlot = 0, perPage = PER_PAGE } = {}) {
  const queue = [];
  for (const it of items) {
    for (let i = 0; i < Math.max(0, it.copies | 0); i++) queue.push(it.id);
  }
  if (!queue.length) return [];
  const start = Math.min(perPage - 1, Math.max(0, startSlot | 0));
  const cells = [...Array(start).fill(null), ...queue];
  const pages = [];
  for (let i = 0; i < cells.length; i += perPage) {
    const page = cells.slice(i, i + perPage);
    while (page.length < perPage) page.push(null);
    pages.push(page);
  }
  return pages;
}
