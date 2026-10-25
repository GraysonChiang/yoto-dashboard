// 列印標籤的產生（純字串，不碰 DOM）。
// 每頁是一張 SVG，viewBox 以 mm 為單位：Chrome 列印 SVG 時座標不會對齊螢幕像素，
// 位置可以精準到 0.02 mm；一般 HTML 方塊會被吸到 0.26 mm 的像素格上。
import { CARD, DOT, layoutGeometry } from './print-layout.js';

export const BLEED = 1;      // 一般 A4 預設出血
export const MARK = 4;       // 裁切標記長度
export const SAFE = 2;       // 安全區：校正頁上建議內容離貼紙邊緣的距離

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => +v.toFixed(3);
const XHTML = 'http://www.w3.org/1999/xhtml';

// 出血只在間距放得下時才加；放不下會蓋到隔壁那張
const bleedFor = (o, gap) => (o.bleed && gap >= 2 * o.bleed ? o.bleed : 0);

// 封面，畫在原點的直式框裡（w × h 已含出血 b）；沒封面時印標題文字
function faceSvg(p, x, y, w, h) {
  return p.cover
    ? `<image href="${esc(p.cover)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"/>`
    : `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="#eee"/>`
      + `<foreignObject x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"><div xmlns="${XHTML}" class="no-cover">${esc(p.title)}</div></foreignObject>`;
}

// 一格標籤：圖片 = 貼紙 + 四周出血 b（沿貼紙邊線剪 / 模切）
// geom 省略時用一般 A4 卡片尺寸（相容舊呼叫）
export function labelHtml(p, slot, o, geom = { label: CARD, rotate: false, gap: o.gap }) {
  if (!p) return '';
  const b = bleedFor(o, geom.gap);
  const w = geom.label.w + 2 * b;
  const h = geom.label.h + 2 * b;
  const x = slot.x - b, y = slot.y - b;
  if (!geom.rotate) return `<g class="label">${faceSvg(p, x, y, w, h)}</g>`;
  // 橫的格子：直式內容（h × w）畫在原點，平移到格子右上角再轉 90°（封面上緣朝右）
  return `<g class="label"><g transform="translate(${n(x + w)} ${n(y)}) rotate(90)">${faceSvg(p, 0, 0, h, w)}</g></g>`;
}

// 在格子外圍印短線，對準每一條裁切線（只給自己剪的版型用）
// g.margin：紙張四周印不到的寬度（ibon 4×6 約 5 mm），標記會縮到這圈內側
export function marksHtml(g) {
  const L = g.label || CARD;
  const m = g.margin || 0;
  const page = g.page || { w: Infinity, h: Infinity };
  const xs = new Set(), ys = new Set();
  g.slots.forEach((s) => { xs.add(s.x); xs.add(s.x + L.w); ys.add(s.y); ys.add(s.y + L.h); });
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const line = (x1, y1, x2, y2) => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`;
  const out = [];
  for (const x of xs) {
    out.push(line(x, Math.max(top - MARK - 1, m), x, top - 1), line(x, bottom + 1, x, Math.min(bottom + MARK + 1, page.h - m)));
  }
  for (const y of ys) {
    out.push(line(Math.max(left - MARK - 1, m), y, left - 1, y), line(right + 1, y, Math.min(right + MARK + 1, page.w - m), y));
  }
  return `<g class="mark">${out.join('')}</g>`;
}

const rect = (cls, x, y, w, h, r) => `<rect class="${cls}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}"/>`;

export function outlineHtml(g) {
  const L = g.label || CARD;
  // 有印不到的邊（ibon 4×6）就畫出可列印範圍，提醒外面那圈會被切掉
  const m = g.margin && g.page ? rect('printable', g.margin, g.margin, g.page.w - 2 * g.margin, g.page.h - 2 * g.margin, 0) : '';
  return m + g.slots.map((s) => rect('outline', s.x, s.y, L.w, L.h, L.r)).join('');
}

function safeSvg(g) {
  const L = g.label;
  return g.slots.map((s) => rect('safe', s.x + SAFE, s.y + SAFE, L.w - 2 * SAFE, L.h - 2 * SAFE, Math.max(0, L.r - SAFE))).join('');
}

function dotsSvg(g) {
  return g.dots.map((d) => `<circle class="dot" cx="${n(d.x + DOT / 2)}" cy="${n(d.y + DOT / 2)}" r="${n(DOT / 2)}"/>`).join('');
}

function sheet(g, i, body, cls = '') {
  const { w, h } = g.page;
  return `<div class="sheet${cls}" data-page="${i + 1}" style="width:${w}mm;height:${h}mm">`
    + `<svg class="sheet-svg" xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${body}</svg></div>`;
}

// pages：paginate() 的結果；byId：cardId → { title, cover }
// o：{ layout, gap, bleed, offsetX, offsetY, marks, outline, interactive }
export function sheetsHtml(pages, byId, o) {
  const g = layoutGeometry(o.layout || 'a4-3x3', o);
  return pages.map((page, i) => sheet(g, i,
    page.map((id, k) => labelHtml(byId.get(id), g.slots[k], o, g)).join('')
    + (o.outline ? outlineHtml(g) : '')
    + (o.marks && !g.die ? marksHtml(g) : '')
    + (o.interactive ? hitsHtml(g, page, i) : ''))).join('');
}

// 預覽用：每一格蓋一個透明感應區，拖曳換位置。data-cell 是跨頁連號的格子編號
function hitsHtml(g, page, pageIndex) {
  const L = g.label;
  return g.slots.map((s, k) => {
    const id = page[k];
    return `<rect class="slot-hit" data-cell="${pageIndex * g.perPage + k}"${id ? ` data-id="${esc(id)}"` : ''}`
      + ` x="${n(s.x)}" y="${n(s.y)}" width="${n(L.w)}" height="${n(L.h)}" rx="${n(L.r)}"/>`;
  }).join('');
}

// 校正頁：只印貼紙框線、安全區與定位點。用一般紙印出來疊在貼紙上對光檢查。
export function calibrationHtml(layoutId, o = {}) {
  const g = layoutGeometry(layoutId, o);
  const cx = g.page.w / 2, cy = g.page.h / 2;
  const info = `${g.name}｜位移 X ${o.offsetX || 0} mm、Y ${o.offsetY || 0} mm｜請用 100% 實際大小列印`;
  const ry = g.page.h - 6;
  return sheet(g, 0,
    outlineHtml(g) + safeSvg(g) + dotsSvg(g)
    + `<g class="cal"><line x1="${n(cx - 3)}" y1="${n(cy)}" x2="${n(cx + 3)}" y2="${n(cy)}"/><line x1="${n(cx)}" y1="${n(cy - 3)}" x2="${n(cx)}" y2="${n(cy + 3)}"/>`
    + `<line x1="${n(cx - 50)}" y1="${n(ry)}" x2="${n(cx + 50)}" y2="${n(ry)}"/>`
    + `<line x1="${n(cx - 50)}" y1="${n(ry - 1.5)}" x2="${n(cx - 50)}" y2="${n(ry + 1.5)}"/><line x1="${n(cx + 50)}" y1="${n(ry - 1.5)}" x2="${n(cx + 50)}" y2="${n(ry + 1.5)}"/></g>`
    + `<text class="cal-text" x="${n(cx)}" y="${n(ry + 4)}">100 mm（拿尺量，不是 100 mm 就是縮放沒選 100%）</text>`
    + `<text class="cal-text" x="${n(cx)}" y="7">${esc(info)}</text>`,
    ' calibration');
}

// 列印前要等這些圖載入完
export function imageUrls(html) {
  return [...new Set([...html.matchAll(/<image href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')))];
}
