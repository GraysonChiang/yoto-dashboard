// 列印標籤的產生（純字串，不碰 DOM）。
// 每頁是一張 SVG，viewBox 以 mm 為單位：Chrome 列印 SVG 時座標不會對齊螢幕像素，
// 位置可以精準到 0.02 mm；一般 HTML 方塊會被吸到 0.26 mm 的像素格上。
import { CARD, DOT, layoutGeometry } from './print-layout.js';

export const BLEED = 1;      // 一般 A4 預設出血
export const MARK = 4;       // 裁切標記長度
export const TITLE_H = 9;    // 標題列高度（勾選「加上標題」時）
export const SAFE = 2;       // 安全區：文字離貼紙邊緣的距離

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => +v.toFixed(3);
const XHTML = 'http://www.w3.org/1999/xhtml';

// 出血只在間距放得下時才加；放不下會蓋到隔壁那張
const bleedFor = (o, gap) => (o.bleed && gap >= 2 * o.bleed ? o.bleed : 0);

// 封面＋標題，畫在原點的直式框裡（w × h 已含出血 b）
function faceSvg(p, x, y, w, h, b, o) {
  const imgH = o.titles ? h - TITLE_H - b : h; // 有標題時，圖片只到標題列上緣
  const img = p.cover
    ? `<image href="${esc(p.cover)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(imgH)}" preserveAspectRatio="none"/>`
    : `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(imgH)}" fill="#eee"/>`
      + `<foreignObject x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(imgH)}"><div xmlns="${XHTML}" class="no-cover">${esc(p.title)}</div></foreignObject>`;
  if (!o.titles) return img;
  const ty = y + imgH;
  return img
    + `<rect x="${n(x)}" y="${n(ty)}" width="${n(w)}" height="${n(TITLE_H + b)}" fill="#fff"/>`
    + `<foreignObject x="${n(x + b + SAFE)}" y="${n(ty)}" width="${n(w - 2 * (b + SAFE))}" height="${n(TITLE_H)}">`
    + `<div xmlns="${XHTML}" class="label-title">${esc(p.title)}</div></foreignObject>`;
}

// 一格標籤：圖片 = 貼紙 + 四周出血 b（沿貼紙邊線剪 / 模切）
// geom 省略時用一般 A4 卡片尺寸（相容舊呼叫）
export function labelHtml(p, slot, o, geom = { label: CARD, rotate: false, gap: o.gap }) {
  if (!p) return '';
  const b = bleedFor(o, geom.gap);
  const w = geom.label.w + 2 * b;
  const h = geom.label.h + 2 * b;
  const x = slot.x - b, y = slot.y - b;
  if (!geom.rotate) return `<g class="label">${faceSvg(p, x, y, w, h, b, o)}</g>`;
  // 橫的格子：直式內容（h × w）畫在原點，平移到格子右上角再轉 90°（封面上緣朝右）
  return `<g class="label"><g transform="translate(${n(x + w)} ${n(y)}) rotate(90)">${faceSvg(p, 0, 0, h, w, b, o)}</g></g>`;
}

// 在格子外圍印短線，對準每一條裁切線（只給自己剪的版型用）
export function marksHtml(g) {
  const L = g.label || CARD;
  const xs = new Set(), ys = new Set();
  g.slots.forEach((s) => { xs.add(s.x); xs.add(s.x + L.w); ys.add(s.y); ys.add(s.y + L.h); });
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const line = (x1, y1, x2, y2) => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`;
  const out = [];
  for (const x of xs) out.push(line(x, top - MARK - 1, x, top - 1), line(x, bottom + 1, x, bottom + MARK + 1));
  for (const y of ys) out.push(line(left - MARK - 1, y, left - 1, y), line(right + 1, y, right + MARK + 1, y));
  return `<g class="mark">${out.join('')}</g>`;
}

const rect = (cls, x, y, w, h, r) => `<rect class="${cls}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}"/>`;

export function outlineHtml(g) {
  const L = g.label || CARD;
  return g.slots.map((s) => rect('outline', s.x, s.y, L.w, L.h, L.r)).join('');
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
// o：{ layout, gap, bleed, offsetX, offsetY, marks, outline, titles }
export function sheetsHtml(pages, byId, o) {
  const g = layoutGeometry(o.layout || 'a4-3x3', o);
  return pages.map((page, i) => sheet(g, i,
    page.map((id, k) => labelHtml(byId.get(id), g.slots[k], o, g)).join('')
    + (o.outline ? outlineHtml(g) : '')
    + (o.marks && !g.die ? marksHtml(g) : ''))).join('');
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
