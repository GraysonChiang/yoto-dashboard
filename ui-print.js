// 「Print」分頁：選版型 + 勾選 playlist（每個印一張）→ 依版型排好 → 瀏覽器列印
import { listMine, getContent } from './yoto-api.js';
import { LAYOUTS, layoutGeometry } from './print-layout.js';
import { addCard, removeCard, moveCard, compact, toPages } from './print-arrange.js';
import { BLEED, sheetsHtml, calibrationHtml, imageUrls } from './print-render.js';
import { renderSheets, pdfBlob, download, IBON_MAX_BYTES } from './print-export.js';
import { LOCAL_SERVER } from './config.js';
import { onAuthChange } from './ui-auth.js';
import { $, $$, toast, esc, show } from './ui-common.js';

let playlists = [];          // [{ cardId, title, cover }]
// 每一格放哪張卡（跨頁連號，null = 空格）。勾選放進第一個空格，預覽上可以拖曳換位置
let cells = [];
const isSelected = (id) => cells.includes(id);
const selectedCount = () => cells.filter(Boolean).length;
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
      <input type="checkbox" ${isSelected(p.cardId) ? 'checked' : ''} aria-label="列印">
      ${p.cover ? `<img class="thumb" src="${esc(p.cover)}" alt="">` : '<span class="thumb empty"></span>'}
      <span class="name">${esc(p.title)}${p.cover ? '' : ' <span class="muted">（沒有封面）</span>'}</span>
      <span class="order" title="排在第幾格"></span>
    </li>`).join('');
  markOrder();
  $$('li[data-id]', ul).forEach((li) => {
    const id = li.dataset.id;
    const box = $('input', li);
    const sync = () => {
      cells = box.checked ? addCard(cells, id) : removeCard(cells, id);
      render();
    };
    box.addEventListener('change', sync);
    // 點整列都能勾
    li.addEventListener('click', (e) => { if (e.target !== box) { box.checked = !box.checked; sync(); } });
  });
}

// 勾選的列標上排在第幾格（跨頁連號）
function markOrder() {
  $$('#print-list li[data-id]').forEach((li) => {
    const n = cells.indexOf(li.dataset.id) + 1;
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
  // 位移
  const off = offsetOf(id);
  $('#print-offx').value = off.x;
  $('#print-offy').value = off.y;
  // 紙張方向：@page 只能用樣式表設定，依版型換一份
  let st = $('#print-page-style');
  if (!st) { st = document.createElement('style'); st.id = 'print-page-style'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${g.page.w}mm ${g.page.h}mm; margin: 0; }`; // 明確給 mm，不靠 A4 關鍵字
  const orient = g.page.w > g.page.h ? '橫向' : '直向';
  const paper = id === 'ibon-4x6' ? '4×6（這個版型是給 ibon 的，頁面 138 × 90 mm 會置中在 4×6 紙上）' : 'A4';
  $('#print-hint').textContent = `自己的印表機列印時請選：紙張 ${paper}、方向「${orient}」、縮放「實際大小／100%」、邊界「無」、勾選「背景圖形」。`;
  $('#export-hint').innerHTML = EXPORT_HINTS[g.die ? 'die' : id];
  // 模切貼紙要自備紙，ibon 不適用；有本機 server 時直接代傳，否則開 ibon 網頁自己上傳
  show($('#btn-ibon-upload'), !g.die && LOCAL_SERVER);
  show($('#btn-export-ibon'), !g.die && !LOCAL_SERVER);
  show($('#ibon-result'), false);
}

const IBON_UPLOAD_URL = 'https://print.ibon.com.tw/ibonprinter';

// ibon 只能印店裡的紙：4×6 有背膠貼紙，A4 是一般紙；模切貼紙要自備紙，ibon 不適用
const EXPORT_HINTS = {
  'ibon-4x6': `${LOCAL_SERVER ? '按下方按鈕直接上傳（300 dpi，已預選 <strong>4×6 貼紙</strong>），拿到取件編號' : '按下方按鈕會下載 JPG（300 dpi）並打開 ibon 上傳頁，把檔案拖進去、規格選 <strong>4×6 貼紙</strong>，取得取件編號'} → 到 7-11 先請店員換成貼紙用紙再列印。印好沿裁切標記剪下。ibon 會把圖等比縮放到 4×6 的最大可列印範圍 13.8 × 9 cm，這個版型已經直接做成這個大小，印出來卡片就是 54 × 85.6 mm（ibon 官方標示誤差 ±1 mm）。`,
  'a4-3x3': `${LOCAL_SERVER ? '按下方按鈕直接上傳 PDF（A4、300 dpi，已預選 A4 彩色），拿到取件編號' : '按下方按鈕會下載 PDF（A4、300 dpi）並打開 ibon 上傳頁，把檔案拖進去、規格選 A4 彩色，取得取件編號'} → 到 7-11 列印。ibon 只能用店裡的一般紙／厚紙，印好沿裁切標記剪下，再用雙面膠貼到卡片上。想直接印成貼紙請改用「ibon 4×6 貼紙」版型。`,
  die: '模切貼紙要放自己買的貼紙紙，ibon 不能自備紙張，請用自己的印表機。下載的 PDF 可以拿到能自備紙張的影印店印（請對方用 100% 原尺寸）。',
};

function options() {
  const layout = currentLayout();
  const g = layoutGeometry(layout);
  const off = offsetOf(layout);
  return {
    layout,
    gap: Number($('#print-gap').value),
    bleed: g.die ? Number($('#print-bleed-mm').value) : ($('#print-bleed').checked ? BLEED : 0),
    marks: $('#print-marks').checked,
    outline: false, // 框線只在預覽與校正頁出現，正式列印不畫，免得模切偏一點就露灰邊
    offsetX: off.x,
    offsetY: off.y,
  };
}

function render() {
  const o = options();
  const g = layoutGeometry(o.layout, o);
  markOrder();
  const pages = currentPages(g);
  const total = pages.flat().filter(Boolean).length;
  $('#print-summary').textContent = total ? `${total} 張 · ${pages.length} 頁 ${o.layout === 'ibon-4x6' ? '4×6' : 'A4'}（每頁 ${g.perPage} 格）` : '還沒選任何 playlist';
  $('#btn-print').disabled = !total;
  $('#btn-export-pdf').disabled = !total;
  $('#btn-export-jpg').disabled = !total;
  $('#btn-export-ibon').disabled = !total;
  $('#btn-ibon-upload').disabled = !total;
  const byId = new Map(playlists.map((p) => [p.cardId, p]));
  const html = pages.length ? sheetsHtml(pages, byId, o) : '';
  // 預覽一律加上貼紙框線，方便看位置；正式列印不畫
  const preview = pages.length ? sheetsHtml(pages, byId, { ...o, outline: true, interactive: true }) : '';
  $('#print-preview').innerHTML = preview
    || `<div class="sheet empty-sheet" style="width:${g.page.w}mm;height:${g.page.h}mm"><span class="muted">勾選左邊的 playlist，卡片會排在這裡</span></div>`;
  $('#print-sheets').innerHTML = html;
  fitPreview();
}

// 目前的排列切成頁（playlist 被刪掉的格子當空格）
function currentPages(g) {
  const known = new Set(playlists.map((p) => p.cardId));
  return toPages(cells.map((c) => (c && known.has(c) ? c : null)), g.perPage);
}

// ---------- 畫布：自動縮放到畫布寬度，拖曳卡片換格子 ----------
const MM_PX = 96 / 25.4;
function fitPreview() {
  const canvas = $('#print-preview');
  const sheets = $$('.sheet', canvas);
  if (!sheets.length) return;
  const g = layoutGeometry(currentLayout());
  const width = canvas.clientWidth - 48;
  // 小張的 4×6 兩頁並排，A4 一頁一排
  const cols = g.page.w < 200 && sheets.length > 1 && width > 900 ? 2 : 1;
  canvas.style.setProperty('--cols', cols);
  const zoom = Math.min(1.4, (width - (cols - 1) * 24) / cols / (g.page.w * MM_PX));
  sheets.forEach((s) => { s.style.zoom = String(Math.max(0.3, zoom)); });
}

let drag = null;
function onPreviewPointerDown(e) {
  const hit = e.target.closest?.('.slot-hit[data-id]');
  if (!hit || e.button !== 0) return;
  e.preventDefault();
  const p = playlists.find((x) => x.cardId === hit.dataset.id);
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = p?.cover ? `<img src="${esc(p.cover)}" alt="">` : `<span>${esc(p?.title || '')}</span>`;
  document.body.appendChild(ghost);
  drag = { from: Number(hit.dataset.cell), hit, ghost, over: null };
  hit.classList.add('from');
  $('#print-preview').classList.add('dragging');
  moveGhost(e);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd, { once: true });
  window.addEventListener('pointercancel', onDragEnd, { once: true });
}
function moveGhost(e) { drag.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; }
function onDragMove(e) {
  if (!drag) return;
  moveGhost(e);
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#print-preview .slot-hit') || null;
  if (over !== drag.over) {
    drag.over?.classList.remove('over');
    if (over && over !== drag.hit) over.classList.add('over');
    drag.over = over;
  }
}
function onDragEnd() {
  if (!drag) return;
  window.removeEventListener('pointermove', onDragMove);
  const { from, over, ghost, hit } = drag;
  drag = null;
  ghost.remove();
  hit.classList.remove('from');
  over?.classList.remove('over');
  $('#print-preview').classList.remove('dragging');
  if (over && Number(over.dataset.cell) !== from) {
    cells = moveCard(cells, from, Number(over.dataset.cell));
    render();
  }
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

// 匯出給別台印表機用：不套用自己印表機的校正位移，也不畫框線
async function renderSelected(status) {
  const o = { ...options(), offsetX: 0, offsetY: 0, outline: false };
  const g = layoutGeometry(o.layout, o);
  const pages = currentPages(g);
  const byId = new Map(playlists.map((p) => [p.cardId, p]));
  const rendered = await renderSheets(sheetsHtml(pages, byId, o), g.page, {
    onProgress: (i, n) => { status.textContent = `產生第 ${i}／${n} 頁…`; },
  });
  const base = `yoto-labels-${o.layout}-${new Date().toISOString().slice(0, 10)}`;
  return { o, rendered, base };
}

const blobBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// 經本機 server 上傳到 ibon（非官方流程），拿到取件編號
async function doIbonUpload() {
  if (exporting) return;
  exporting = true;
  const status = $('#export-status');
  const box = $('#ibon-result');
  const buttons = [$('#btn-export-pdf'), $('#btn-export-jpg'), $('#btn-ibon-upload')];
  buttons.forEach((b) => { b.disabled = true; });
  show(box, false);
  status.classList.remove('err');
  try {
    const { o, rendered, base } = await renderSelected(status);
    const sticker = o.layout === 'ibon-4x6';
    const files = sticker
      ? rendered.map((r, i) => ({ name: rendered.length > 1 ? `${base}-${i + 1}.jpg` : `${base}.jpg`, blob: r.blob }))
      : [{ name: `${base}.pdf`, blob: await pdfBlob(rendered) }];
    const bytes = files.reduce((s, f) => s + f.blob.size, 0);
    if (bytes > IBON_MAX_BYTES) throw new Error(`檔案共 ${(bytes / 1048576).toFixed(1)} MB，超過 ibon 15 MB 上限，請分批勾選`);
    if (files.length > 8) throw new Error('ibon 一次最多 8 個檔案，請分批勾選');
    status.textContent = `上傳到 ibon…（${(bytes / 1048576).toFixed(1)} MB）`;
    const res = await fetch('/api/ibon-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectType: sticker ? 'F4X6S1' : 'FA4CN1',
        files: await Promise.all(files.map(async (f) => ({ name: f.name, base64: await blobBase64(f.blob) }))),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `上傳失敗（HTTP ${res.status}）`);
    status.textContent = '';
    box.innerHTML = `<div class="small muted">取件編號</div>
      <div class="pincode">${esc(data.pincode)}</div>
      <div class="small">${sticker ? '4×6 貼紙、彩色、單面' : 'A4、彩色、單面'}・${files.length} 個檔案・期限 ${esc(data.deadLine)}</div>
      ${data.files?.length ? `<div class="small muted">ibon 端：${data.files.map((f) => esc(f.status)).join('、')}</div>` : ''}
      <div class="small muted">到 7-11 ibon 選「列印」→「取件編號列印」輸入這組號碼。${sticker ? '貼紙要先請店員換成貼紙用紙。' : ''}</div>`;
    show(box, true);
  } catch (e) {
    status.textContent = e.message;
    status.classList.add('err');
  } finally {
    exporting = false;
    buttons.forEach((b) => { b.disabled = !selectedCount(); });
  }
}

let exporting = false;
async function doExport(kind) {
  if (exporting) return;
  exporting = true;
  const status = $('#export-status');
  const buttons = [$('#btn-export-pdf'), $('#btn-export-jpg'), $('#btn-export-ibon'), $('#btn-ibon-upload')];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const { o, rendered, base } = await renderSelected(status);
    let bytes = 0;
    if (kind === 'pdf') {
      const blob = await pdfBlob(rendered);
      bytes = blob.size;
      download(blob, `${base}.pdf`);
    } else {
      rendered.forEach((r, i) => { bytes += r.blob.size; download(r.blob, rendered.length > 1 ? `${base}-${i + 1}.jpg` : `${base}.jpg`); });
    }
    const mb = (bytes / 1024 / 1024).toFixed(1);
    const tooBig = bytes > IBON_MAX_BYTES;
    const tooMany = kind === 'jpg' && rendered.length > 8;
    status.textContent = `已下載 ${rendered.length} 頁，共 ${mb} MB。`
      + (tooBig ? ' 超過 ibon 單次上傳 15 MB 上限，請分批勾選匯出。' : '')
      + (tooMany ? ' ibon 一次最多上傳 8 個檔案，請分兩次上傳。' : '');
    status.classList.toggle('err', tooBig || tooMany);
  } catch (e) {
    status.textContent = '';
    toast(e.message, { error: true, ms: 6000 });
  } finally {
    exporting = false;
    buttons.forEach((b) => { b.disabled = !selectedCount(); });
  }
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
  // 換版型：照目前順序重新排（每頁格數變了，原本的位置沒有意義）
  $('#print-layout').addEventListener('change', () => {
    prefs.layout = currentLayout(); savePrefs();
    applyLayoutUi();
    cells = compact(cells);
    render();
  });
  $('#print-preview').addEventListener('pointerdown', onPreviewPointerDown);
  new ResizeObserver(() => fitPreview()).observe($('#print-preview'));
  ['#print-gap', '#print-bleed', '#print-bleed-mm', '#print-marks']
    .forEach((s) => $(s).addEventListener('change', render));
  ['#print-offx', '#print-offy'].forEach((s) => $(s).addEventListener('input', onOffsetChange));
  $('#btn-print').addEventListener('click', doPrint);
  $('#btn-calib').addEventListener('click', doCalibration);
  $('#btn-export-pdf').addEventListener('click', () => doExport('pdf'));
  $('#btn-export-jpg').addEventListener('click', () => doExport('jpg'));
  // 公開版沒有本機 server 可以代傳：先開 ibon 上傳頁再下載，使用者把檔案拖進去即可。
  // 分頁要在點擊當下同步開，放到 await 之後會被擋彈出視窗
  $('#btn-ibon-upload').addEventListener('click', doIbonUpload);
  $('#btn-export-ibon').addEventListener('click', () => {
    window.open(IBON_UPLOAD_URL, '_blank', 'noopener');
    doExport(currentLayout() === 'ibon-4x6' ? 'jpg' : 'pdf');
  });
  onAuthChange((v) => { loggedIn = v; loadPlaylists(); });
  // 切到這個分頁時重新抓（可能剛在別的分頁新增或換了封面）
  $('.tabs button[data-tab="print"]').addEventListener('click', () => { if (loggedIn) loadPlaylists(); });
  applyLayoutUi();
  render();
}
