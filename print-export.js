// 把排好的標籤頁匯出成檔案（給 ibon 等店家列印）：每頁 SVG → 300 dpi JPEG，A4 再包成 PDF。
// 純邏輯（buildPdf、sheetSvgs、pagePixels）不碰 DOM，Node 裡可以直接測；renderSheets 要在瀏覽器跑。

export const MM_TO_PT = 72 / 25.4;
export const IBON_MAX_BYTES = 15 * 1024 * 1024; // ibon 雲端列印單次上傳上限

const SVG_NS = 'http://www.w3.org/2000/svg';
// 頁面 SVG 單獨當圖片時讀不到 style.css，這裡放它需要的樣式（跟 style.css 的同名規則一致）
const SVG_CSS = [
  '.no-cover{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;padding:4px;box-sizing:border-box;font:4px/1.3 -apple-system,"PingFang TC",sans-serif;color:#555}',
  '.mark line{stroke:#000;stroke-width:0.2}',
].join('');

export function pagePixels(mm, dpi) {
  return { w: Math.round((mm.w / 25.4) * dpi), h: Math.round((mm.h / 25.4) * dpi) };
}

// sheetsHtml() 的結果 → 每頁一段獨立的 SVG 字串（白底、內嵌樣式）
export function sheetSvgs(html) {
  return [...html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)].map(([svg]) => {
    let s = svg.includes('xmlns=') ? svg : svg.replace('<svg', `<svg xmlns="${SVG_NS}"`);
    return s.replace(/^(<svg\b[^>]*>)/, `$1<style>${SVG_CSS}</style><rect width="100%" height="100%" fill="#fff"/>`);
  });
}

// pages：[{ mm: { w, h }, px: { w, h }, jpeg: Uint8Array }] → PDF bytes。每頁一張滿版圖。
export function buildPdf(pages) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); pos += b.length; };
  const obj = (num, body) => { offsets[num - 1] = pos; push(`${num} 0 obj\n`); body(); push('\nendobj\n'); };
  const num = (v) => +v.toFixed(3);

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageNums = pages.map((_, i) => 3 + i * 3);
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const n = pageNums[i];
    const w = num(p.mm.w * MM_TO_PT), h = num(p.mm.h * MM_TO_PT);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`));
    obj(n + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(n + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.px.w} /Height ${p.px.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
  });
  const xref = pos;
  const count = offsets.length + 1;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// ---------- 以下只在瀏覽器用 ----------

const dataUrlCache = new Map();
async function toDataUrl(url) {
  if (!dataUrlCache.has(url)) {
    dataUrlCache.set(url, (async () => {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`封面下載失敗（HTTP ${res.status}）`);
      const blob = await res.blob();
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    })().catch((e) => { dataUrlCache.delete(url); throw e; }));
  }
  return dataUrlCache.get(url);
}

// 外部封面網址換成 data URL：SVG 當圖片畫到 canvas 時不能載外部資源
async function inlineImages(svg) {
  const hrefs = [...new Set([...svg.matchAll(/<image href="([^"]+)"/g)].map((m) => m[1]))];
  for (const h of hrefs) {
    if (h.startsWith('data:')) continue;
    const data = await toDataUrl(h.replace(/&amp;/g, '&'));
    svg = svg.split(`href="${h}"`).join(`href="${data}"`);
  }
  return svg;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('排版轉圖片失敗'));
    im.src = src;
  });
}

// sheetsHtml() 的結果 → 每頁 { mm, px, blob(JPEG) }
export async function renderSheets(html, pageMm, { dpi = 300, quality = 0.92, onProgress } = {}) {
  const svgs = sheetSvgs(html);
  const px = pagePixels(pageMm, dpi);
  const out = [];
  for (let i = 0; i < svgs.length; i++) {
    onProgress?.(i + 1, svgs.length);
    const svg = await inlineImages(svgs[i]);
    const im = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement('canvas');
    canvas.width = px.w; canvas.height = px.h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px.w, px.h);
    ctx.drawImage(im, 0, 0, px.w, px.h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('JPEG 產生失敗');
    out.push({ mm: pageMm, px, blob });
  }
  return out;
}

export async function pdfBlob(rendered) {
  const pages = await Promise.all(rendered.map(async (r) => ({ ...r, jpeg: new Uint8Array(await r.blob.arrayBuffer()) })));
  return new Blob([buildPdf(pages)], { type: 'application/pdf' });
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
