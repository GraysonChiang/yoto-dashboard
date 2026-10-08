// 「列印標籤」分頁：選版型 + 勾選 playlist（每個印一張）→ 依版型排好 → 瀏覽器列印
import { listMine, getContent } from './yoto-api.js';
import { LAYOUTS, layoutGeometry, paginate } from './print-layout.js';
import { BLEED, sheetsHtml, calibrationHtml, imageUrls } from './print-render.js';
import { onAuthChange } from './ui-auth.js';
import { $, $$, toast, esc } from './ui-common.js';

let playlists = [];          // [{ cardId, title, cover }]
const selected = new Set();  // 要印的 cardId，每個一張；Set 保留插入順序 = 列印順序
let loggedIn = false;

// ---------- 設定記憶（每個版型各自記位移） ----------
const PREF_KEY = 'ycs.print';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} };
const offsetOf = (layout) => prefs.offsets?.[layout] || { x: 0, y: 0 };

// ---------- 清單 ----------
async function loadPlaylists() {
  const ul = $('#print-list');
  if (!loggedIn) { ul.innerHTML = '<li class="muted">登入後會列出你的 playlist。</li>'; return; }
  ul.innerHTML = '<li class="muted">載入中…</li>';
  try {
    const cards = await listMine();
    playlists = cards.map((c) => ({ cardId: c.cardId, title: c.title || '(未命名)', cover: c.metadata?.cover?.imageL || null }));
    // 列表 API 可能沒帶封面，缺的補查一次
    await Promise.all(playlists.filter((p) => !p.cover).map(async (p) => {
      try { p.cover = (await getContent(p.cardId)).metadata?.cover?.imageL || null; } catch {}
    }));
    renderList();
    render();
  } catch (e) {
    ul.innerHTML = '';
    toast(e.message, { error: true, ms: 6000 });
  }
}

function renderList() {
  const ul = $('#print-list');
  if (!playlists.length) { ul.innerHTML = '<li class="muted">還沒有 playlist。</li>'; return; }
  ul.innerHTML = playlists.map((p) => `
    <li data-id="${esc(p.cardId)}">
      <input type="checkbox" ${selected.has(p.cardId) ? 'checked' : ''} aria-label="列印">
      ${p.cover ? `<img class="thumb" src="${esc(p.cover)}" alt="">` : '<span class="thumb empty"></span>'}
      <span class="name">${esc(p.title)}${p.cover ? '' : ' <span class="muted">（沒有封面）</span>'}</span>
      <span class="order" title="列印順序"></span>
    </li>`).join('');
  markOrder();
  $$('li[data-id]', ul).forEach((li) => {
    const id = li.dataset.id;
    const box = $('input', li);
    const sync = () => {
      if (box.checked) selected.add(id); else selected.delete(id);
      render();
    };
    box.addEventListener('change', sync);
    // 點整列都能勾
    li.addEventListener('click', (e) => { if (e.target !== box) { box.checked = !box.checked; sync(); } });
  });
}

// 勾選的列標上列印順序（第幾張）
function markOrder() {
  const order = [...selected];
  $$('#print-list li[data-id]').forEach((li) => {
    const n = order.indexOf(li.dataset.id) + 1;
    li.classList.toggle('selected', n > 0);
    $('.order', li).textContent = n ? String(n) : '';
  });
}

// ---------- 版型 ----------
function currentLayout() { return $('#print-layout').value; }

function applyLayoutUi() {
  const id = currentLayout();
  const g = layoutGeometry(id);
  $$('#tab-print .cut-only').forEach((el) => el.classList.toggle('hidden', g.die));
  $$('#tab-print .die-only').forEach((el) => el.classList.toggle('hidden', !g.die));
  // 起始格選單
  const cols = new Set(g.slots.map((s) => s.x)).size;
  const prev = Number($('#print-start').value) || 0;
  $('#print-start').innerHTML = Array.from({ length: g.perPage }, (_, i) =>
    `<option value="${i}">第 ${i + 1} 格（第 ${Math.floor(i / cols) + 1} 列第 ${(i % cols) + 1} 欄）</option>`).join('');
  $('#print-start').value = String(Math.min(prev, g.perPage - 1));
  // 位移
  const off = offsetOf(id);
  $('#print-offx').value = off.x;
  $('#print-offy').value = off.y;
  // 紙張方向：@page 只能用樣式表設定，依版型換一份
  let st = $('#print-page-style');
  if (!st) { st = document.createElement('style'); st.id = 'print-page-style'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${g.page.w}mm ${g.page.h}mm; margin: 0; }`; // 明確給 mm，不靠 A4 關鍵字
  const orient = g.pageSize.includes('landscape') ? '橫向' : '直向';
  $('#print-hint').textContent = `列印時請選：紙張 A4、方向「${orient}」、縮放「實際大小／100%」、邊界「無」、勾選「背景圖形」。`;
}

function options() {
  const layout = currentLayout();
  const g = layoutGeometry(layout);
  const off = offsetOf(layout);
  return {
    layout,
    gap: Number($('#print-gap').value),
    startSlot: Number($('#print-start').value),
    bleed: g.die ? Number($('#print-bleed-mm').value) : ($('#print-bleed').checked ? BLEED : 0),
    marks: $('#print-marks').checked,
    outline: false, // 框線只在預覽與校正頁出現，正式列印不畫，免得模切偏一點就露灰邊
    titles: $('#print-titles').checked,
    offsetX: off.x,
    offsetY: off.y,
  };
}

function render() {
  const o = options();
  const g = layoutGeometry(o.layout, o);
  markOrder();
  const items = [...selected].filter((id) => playlists.some((p) => p.cardId === id)).map((id) => ({ id, copies: 1 }));
  const pages = paginate(items, { startSlot: o.startSlot, perPage: g.perPage });
  const total = items.reduce((s, it) => s + it.copies, 0);
  $('#print-summary').textContent = total ? `${total} 張 · ${pages.length} 頁 A4（每頁 ${g.perPage} 格）` : '還沒選任何 playlist';
  $('#btn-print').disabled = !total;
  const byId = new Map(playlists.map((p) => [p.cardId, p]));
  const html = pages.length ? sheetsHtml(pages, byId, o) : '';
  // 預覽一律加上貼紙框線，方便看位置；正式列印不畫
  const preview = pages.length ? sheetsHtml(pages, byId, { ...o, outline: true }) : '';
  $('#print-preview').innerHTML = preview
    || `<div class="sheet empty-sheet" style="width:${g.page.w}mm;height:${g.page.h}mm"><span class="muted">選好 playlist 後這裡會出現預覽</span></div>`;
  $('#print-sheets').innerHTML = html;
}

// SVG 裡的 <image> 沒有 load 事件可等，先用 Image 預載，回傳失敗張數
async function waitImages() {
  const urls = imageUrls($('#print-sheets').innerHTML);
  const ok = await Promise.all(urls.map((u) => new Promise((r) => { const im = new Image(); im.onload = () => r(true); im.onerror = () => r(false); im.src = u; })));
  return ok.filter((v) => !v).length;
}

async function doPrint() {
  render();
  // 等所有封面載入完再列印，避免印出空白格
  const broken = await waitImages();
  if (broken) toast(`${broken} 張封面載入失敗，會印成空白`, { error: true, ms: 6000 });
  window.print();
}

function doCalibration() {
  const o = options();
  $('#print-sheets').innerHTML = calibrationHtml(o.layout, o);
  window.print();
  render(); // 印完換回正式內容
}

function onOffsetChange() {
  const x = Number($('#print-offx').value) || 0;
  const y = Number($('#print-offy').value) || 0;
  prefs.offsets = { ...(prefs.offsets || {}), [currentLayout()]: { x, y } };
  savePrefs();
  render();
}

export function initPrintTab() {
  $('#print-layout').innerHTML = Object.entries(LAYOUTS)
    .map(([id, l]) => `<option value="${id}">${esc(l.name)}</option>`).join('');
  $('#print-layout').value = LAYOUTS[prefs.layout] ? prefs.layout : 'easycard-8';
  $('#print-layout').addEventListener('change', () => {
    prefs.layout = currentLayout(); savePrefs();
    applyLayoutUi(); render();
  });
  ['#print-start', '#print-gap', '#print-bleed', '#print-bleed-mm', '#print-marks', '#print-titles']
    .forEach((s) => $(s).addEventListener('change', render));
  ['#print-offx', '#print-offy'].forEach((s) => $(s).addEventListener('input', onOffsetChange));
  $('#btn-print').addEventListener('click', doPrint);
  $('#btn-calib').addEventListener('click', doCalibration);
  onAuthChange((v) => { loggedIn = v; loadPlaylists(); });
  // 切到這個分頁時重新抓（可能剛在別的分頁新增或換了封面）
  $('.tabs button[data-tab="print"]').addEventListener('click', () => { if (loggedIn) loadPlaylists(); });
  applyLayoutUi();
  render();
}
