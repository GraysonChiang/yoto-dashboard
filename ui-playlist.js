// 「我的 Playlist」分頁：列表、編輯、拖放 mp3、排序、圖示、上傳
import { listMine, getContent, saveContent, deleteContent, uploadAudio, uploadIcon, uploadCover, listPublicIcons, listMyIcons } from './yoto-api.js';
import { buildContentBody, tracksFromContent, metaFromContent, fileSha256, CATEGORIES } from './playlist.js';
import { imageTo16x16Png, imageToCover, blobToDataUrl } from './icons.js';
import { onAuthChange } from './ui-auth.js';
import { $, $$, toast, esc, show } from './ui-common.js';

// ---- 本機上傳快取：檔案 sha256 → { sha256(轉檔後), info } ----
const CACHE_KEY = 'ycs.uploads';
const uploadCache = {
  all() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } },
  get(k) { return this.all()[k]; },
  set(k, v) { const a = this.all(); a[k] = v; try { localStorage.setItem(CACHE_KEY, JSON.stringify(a)); } catch {} },
};

// ---- 編輯中的狀態 ----
// track: { id, title, file?, sha256?, info?, mediaId?, iconUrl?, iconBlob?, state, error }
// meta:  { description, category, author, coverUrl, coverBlob? }
let editing = null; // { cardId, title, tracks, meta }
let publicIconsCache = null;
let loggedIn = false;
let seq = 0;

const views = { list: () => $('#playlist-list-view'), edit: () => $('#playlist-edit-view') };

// ---------- 列表 ----------
async function refreshList() {
  const ul = $('#playlist-list');
  const hint = $('#playlist-list-hint');
  if (!loggedIn) { ul.innerHTML = ''; hint.textContent = '登入後會列出你帳號裡的 MYO playlist。'; return; }
  hint.textContent = '載入中…';
  try {
    const cards = await listMine();
    hint.textContent = cards.length ? '' : '還沒有任何 playlist，按「新增 playlist」開始。';
    ul.innerHTML = cards
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .map((c) => `<li data-id="${esc(c.cardId)}">
          <span class="row gap">
            ${c.metadata?.cover?.imageL ? `<img class="thumb" src="${esc(c.metadata.cover.imageL)}" alt="">` : '<span class="thumb empty"></span>'}
            <span><strong>${esc(c.title || '(未命名)')}</strong>
            <span class="muted"> · ${esc(c.cardId)}</span></span>
          </span>
          <span class="actions">
            <span class="muted">${c.metadata?.media?.duration ? Math.round(c.metadata.media.duration / 60) + ' 分鐘' : ''}</span>
            <button class="small ghost danger" data-action="delete" title="刪除這個 playlist">刪除</button>
          </span>
        </li>`).join('');
    $$('li', ul).forEach((li) => {
      li.addEventListener('click', () => openExisting(li.dataset.id));
      $('[data-action=delete]', li).addEventListener('click', (e) => {
        e.stopPropagation();
        removePlaylist(li.dataset.id, $('strong', li).textContent);
      });
    });
  } catch (e) {
    hint.textContent = '';
    toast(e.message, { error: true, ms: 6000 });
  }
}

async function removePlaylist(cardId, title) {
  if (!confirm(`確定要刪除「${title}」？\n\n已綁定這個 playlist 的卡片會變成沒有內容。這個動作無法復原。`)) return;
  try {
    await deleteContent(cardId);
    toast(`已刪除「${title}」`);
    refreshList();
  } catch (e) {
    toast(e.message, { error: true, ms: 6000 });
  }
}

async function openExisting(cardId) {
  try {
    const card = await getContent(cardId);
    editing = {
      cardId: card.cardId,
      title: card.title || '',
      tracks: tracksFromContent(card).map((t) => ({ ...t, id: ++seq, state: 'done', iconUrl: null })),
      meta: metaFromContent(card),
    };
    showEdit();
    hydrateIconUrls();
  } catch (e) {
    toast(e.message, { error: true, ms: 6000 });
  }
}

function openNew() {
  editing = { cardId: null, title: '', tracks: [], meta: metaFromContent(null) };
  showEdit();
}

// 既有曲目的 mediaId 要查圖示庫才有 URL 可以預覽
async function hydrateIconUrls() {
  const need = editing.tracks.filter((t) => t.mediaId && !t.iconUrl);
  if (!need.length) return;
  try {
    const [mine, pub] = await Promise.all([listMyIcons(), getPublicIcons()]);
    const byId = new Map([...mine, ...pub].map((i) => [i.mediaId, i.url]));
    for (const t of need) t.iconUrl = byId.get(t.mediaId) || null;
    renderTracks();
  } catch { /* 預覽拿不到不影響功能 */ }
}

async function getPublicIcons() {
  if (!publicIconsCache) publicIconsCache = await listPublicIcons();
  return publicIconsCache;
}

// ---------- 編輯畫面 ----------
function showEdit() {
  show(views.list(), false);
  show(views.edit(), true);
  $('#edit-title').value = editing.title;
  $('#edit-card-id').textContent = editing.cardId ? `cardId：${editing.cardId}（更新既有 playlist）` : '新的 playlist';
  $('#edit-description').value = editing.meta.description;
  $('#edit-category').value = editing.meta.category;
  $('#edit-author').value = editing.meta.author;
  renderCover();
  show($('#upload-log'), false);
  $('#upload-log').textContent = '';
  renderTracks();
}

function renderCover() {
  const img = $('#edit-cover');
  const url = editing.meta.coverUrl;
  img.hidden = !url;
  if (url) img.src = url;
  show($('#edit-cover-empty'), !url);
}

function readMetaFromForm() {
  editing.meta.description = $('#edit-description').value.trim();
  editing.meta.category = $('#edit-category').value;
  editing.meta.author = $('#edit-author').value.trim();
}

function showList() {
  editing = null;
  show(views.edit(), false);
  show(views.list(), true);
  refreshList();
}

function fmtDuration(s) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

const STATE_TEXT = {
  pending: '待上傳',
  hashing: '檢查中…',
  upload: '上傳中',
  transcode: '轉檔中…',
  icon: '上傳圖示…',
  done: '✓ 完成',
  error: '✖ 失敗',
};

function renderTracks() {
  const ol = $('#track-list');
  ol.innerHTML = editing.tracks.map((t, i) => `
    <li class="track" draggable="true" data-id="${t.id}">
      <span class="num">${i + 1}</span>
      <img class="icon" src="${t.iconUrl || blankIcon()}" title="點擊更換圖示" alt="">
      <div>
        <input type="text" value="${esc(t.title)}" placeholder="曲名" data-field="title">
        <div class="file">${esc(t.file?.name || (t.sha256 ? '已在 Yoto 上' : ''))} ${t.info?.duration ? '· ' + fmtDuration(t.info.duration) : ''}</div>
      </div>
      <span class="state ${t.state === 'done' ? 'ok' : t.state === 'error' ? 'err' : ''}" title="${esc(t.error || '')}">
        ${t.state === 'upload' && t.progress != null ? `上傳 ${Math.round(t.progress * 100)}%` : STATE_TEXT[t.state] || ''}
      </span>
      <button class="small ghost danger" data-action="remove" title="移除">✕</button>
    </li>`).join('');

  $$('.track', ol).forEach((li) => {
    const t = editing.tracks.find((x) => x.id === Number(li.dataset.id));
    $('[data-field=title]', li).addEventListener('input', (e) => { t.title = e.target.value; });
    $('[data-action=remove]', li).addEventListener('click', () => { editing.tracks = editing.tracks.filter((x) => x !== t); renderTracks(); });
    $('.icon', li).addEventListener('click', () => pickIcon(t));
    li.addEventListener('dragstart', (e) => { li.classList.add('dragging'); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromId = Number(e.dataTransfer.getData('text/plain'));
      if (!fromId || fromId === t.id) return;
      const from = editing.tracks.findIndex((x) => x.id === fromId);
      const to = editing.tracks.findIndex((x) => x === t);
      const [moved] = editing.tracks.splice(from, 1);
      editing.tracks.splice(to, 0, moved);
      renderTracks();
    });
  });

  const n = editing.tracks.length;
  const total = editing.tracks.reduce((s, t) => s + (t.info?.duration || 0), 0);
  $('#edit-summary').textContent = n ? `${n} 首${total ? ' · 共 ' + fmtDuration(total) : ''}` : '還沒有歌曲';
  $('#btn-upload').disabled = n === 0;
}

function blankIcon() {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#222"/><text x="8" y="12" font-size="10" text-anchor="middle" fill="#888">?</text></svg>');
}

// 「01 曲名.mp3」→「曲名」；排序已經照檔名，編號不用留在曲名裡
const titleFromFile = (name) => name.replace(/\.mp3$/i, '').replace(/^\d+[\s._-]+/, '').trim() || name;

function addFiles(files) {
  const mp3s = [...files].filter((f) => /\.mp3$/i.test(f.name) || f.type === 'audio/mpeg');
  if (!mp3s.length) { toast('只接受 mp3 檔案', { error: true }); return; }
  for (const f of mp3s.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }))) {
    editing.tracks.push({ id: ++seq, title: titleFromFile(f.name), file: f, state: 'pending', mediaId: null, iconUrl: null });
  }
  renderTracks();
}

async function setCover(f) {
  if (f.size > 20 * 1048576) { toast('封面圖請小於 20 MB', { error: true }); return; }
  try {
    const fitted = await imageToCover(f); // 轉成 5:8，避免被 Yoto 拉伸
    editing.meta.coverBlob = fitted;
    editing.meta.coverUrl = URL.createObjectURL(fitted); // 先用本機預覽，上傳時換成 Yoto 的網址
    renderCover();
  } catch (err) { toast(err.message, { error: true }); }
}

// 選一整個資料夾：mp3 照檔名排序加入；資料夾裡有 cover.* 或其他圖片就當封面（沒有封面時）
async function addFolder(files) {
  const list = [...files].filter((f) => !f.name.startsWith('.'));
  const top = list.filter((f) => (f.webkitRelativePath || f.name).split('/').length <= 2); // 只看第一層
  addFiles(top.length ? top : list);
  if (!editing.meta.coverUrl) {
    const imgs = top.filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name));
    const cover = imgs.find((f) => /^cover/i.test(f.name)) || imgs[0];
    if (cover) await setCover(cover);
  }
  if (!editing.title) {
    const dir = (list[0]?.webkitRelativePath || '').split('/')[0];
    if (dir) { editing.title = dir; $('#edit-title').value = dir; }
  }
}

// ---------- 圖示選擇 ----------
async function pickIcon(track) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="row between">
        <h3>選擇圖示</h3>
        <button class="ghost small" data-close>關閉</button>
      </div>
      <p class="muted">上傳自己的圖片（會自動縮成 16×16），或從 Yoto 官方圖示庫挑一個。</p>
      <label class="link">上傳圖片<input type="file" accept="image/*" hidden data-upload></label>
      <input type="text" placeholder="搜尋官方圖示…" data-search style="margin-left:12px;padding:6px 10px;border:1px solid var(--line);border-radius:6px">
      <div class="icon-grid" data-grid><span class="muted">載入中…</span></div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  $('[data-close]', backdrop).addEventListener('click', close);

  $('[data-upload]', backdrop).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const png = await imageTo16x16Png(f);
      track.iconBlob = png;
      track.iconName = f.name.replace(/\.[^.]+$/, '');
      track.iconUrl = await blobToDataUrl(png);
      track.mediaId = null; // 等上傳時再換成 mediaId
      if (track.state === 'done') track.state = 'pending'; // 已上傳過的歌要重新送圖示
      renderTracks();
      close();
    } catch (err) { toast(err.message, { error: true }); }
  });

  const grid = $('[data-grid]', backdrop);
  let icons = [];
  const renderGrid = (q = '') => {
    const needle = q.trim().toLowerCase();
    const list = needle ? icons.filter((i) => `${i.title || ''} ${(i.publicTags || []).join(' ')}`.toLowerCase().includes(needle)) : icons;
    grid.innerHTML = list.slice(0, 400).map((i) => `<img src="${esc(i.url)}" title="${esc(i.title || '')}" data-media="${esc(i.mediaId)}" loading="lazy">`).join('') || '<span class="muted">沒有符合的圖示</span>';
    $$('img', grid).forEach((img) => img.addEventListener('click', () => {
      track.mediaId = img.dataset.media;
      track.iconUrl = img.src;
      track.iconBlob = null;
      renderTracks();
      close();
    }));
  };
  $('[data-search]', backdrop).addEventListener('input', (e) => renderGrid(e.target.value));
  try {
    const [mine, pub] = await Promise.all([listMyIcons().catch(() => []), getPublicIcons()]);
    icons = [...mine.map((i) => ({ ...i, title: i.title || '我的圖示' })), ...pub];
    renderGrid();
  } catch (e) {
    grid.innerHTML = `<span style="color:var(--err)">${esc(e.message)}</span>`;
  }
}

// ---------- 上傳 ----------
function log(line) {
  const el = $('#upload-log');
  show(el, true);
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}

async function processTrack(t) {
  const set = (state, extra = {}) => { t.state = state; Object.assign(t, extra); renderTracks(); };
  try {
    if (t.file && !t.sha256) {
      set('hashing');
      const localHash = await fileSha256(t.file);
      const cached = uploadCache.get(localHash);
      if (cached) {
        log(`  ${t.title}：這個檔案之前上傳過，直接沿用`);
        t.sha256 = cached.sha256; t.info = cached.info;
      } else {
        const r = await uploadAudio(t.file, {
          onStage: (s) => set(s, { progress: null }),
          onProgress: (p) => set('upload', { progress: p }),
        });
        t.sha256 = r.sha256; t.info = r.info;
        uploadCache.set(localHash, r);
        log(`  ${t.title}：音檔上傳完成（${fmtDuration(r.info.duration)}）`);
      }
    }
    if (t.iconBlob && !t.mediaId) {
      set('icon');
      const icon = await uploadIcon(t.iconBlob, t.iconName || t.title);
      t.mediaId = icon.mediaId;
      t.iconBlob = null;
      log(`  ${t.title}：圖示上傳完成`);
    }
    set('done', { error: null });
  } catch (e) {
    set('error', { error: e.message });
    log(`  ✖ ${t.title}：${e.message}`);
  }
}

let uploading = false; // 防止重複觸發（連點、或自動化腳本同時操作）而建立兩個 playlist

async function uploadAll() {
  if (uploading) return;
  uploading = true;
  try { await doUploadAll(); } finally { uploading = false; }
}

async function doUploadAll() {
  editing.title = $('#edit-title').value.trim();
  if (!editing.title) { toast('請先填 playlist 名稱', { error: true }); $('#edit-title').focus(); return; }
  if (!loggedIn) { toast('請先登入 Yoto', { error: true }); return; }
  const btn = $('#btn-upload');
  btn.disabled = true;
  $('#upload-log').textContent = '';
  log(`開始處理 ${editing.tracks.length} 首…`);

  // 只處理還沒完成的（失敗重試也走這裡）
  for (const t of editing.tracks) {
    if (t.state !== 'done') await processTrack(t);
  }
  const failed = editing.tracks.filter((t) => t.state !== 'done');
  if (failed.length) {
    log(`有 ${failed.length} 首失敗，playlist 尚未送出。修正後再按一次「上傳到 Yoto」只會重試失敗的。`);
    toast(`${failed.length} 首失敗，請查看下方記錄`, { error: true, ms: 6000 });
    btn.disabled = false;
    return;
  }

  try {
    readMetaFromForm();
    if (editing.meta.coverBlob) {
      log('上傳封面…');
      const cover = await uploadCover(editing.meta.coverBlob, editing.title); // coverBlob 已是 13:10 JPEG
      editing.meta.coverUrl = cover.mediaUrl;
      editing.meta.coverBlob = null;
    }
    log(editing.cardId ? '更新 playlist…' : '建立 playlist…');
    const card = await saveContent(buildContentBody({
      cardId: editing.cardId,
      title: editing.title,
      tracks: editing.tracks.map((t) => ({ title: t.title, sha256: t.sha256, info: t.info, mediaId: t.mediaId })),
      meta: editing.meta,
    }));
    const isNew = !editing.cardId;
    editing.cardId = card.cardId || editing.cardId;
    $('#edit-card-id').textContent = `cardId：${editing.cardId}（更新既有 playlist）`;
    log(`✅ 完成！cardId = ${editing.cardId}`);
    if (isNew) log('下一步：打開 Yoto App → Library → Playlists，找到這個 playlist →「Link to a card」→ 感應 MYO 卡。');
    else log('已綁定這個 playlist 的卡片會自動更新，不用重新綁定。');
    toast(isNew ? 'Playlist 已建立' : 'Playlist 已更新');
  } catch (e) {
    log(`✖ ${e.message}`);
    toast(e.message, { error: true, ms: 8000 });
  } finally {
    btn.disabled = false;
  }
}

// ---------- init ----------
export function initPlaylistTab() {
  onAuthChange((v) => { loggedIn = v; if (!editing) refreshList(); });

  $('#btn-new-playlist').addEventListener('click', () => {
    if (!loggedIn) { toast('請先登入 Yoto', { error: true }); return; }
    openNew();
  });
  $('#btn-back-list').addEventListener('click', () => {
    const busy = editing?.tracks.some((t) => ['hashing', 'upload', 'transcode', 'icon'].includes(t.state));
    if (busy && !confirm('還在上傳中，確定要離開嗎？')) return;
    showList();
  });
  $('#btn-upload').addEventListener('click', uploadAll);
  $('#edit-title').addEventListener('input', (e) => { if (editing) editing.title = e.target.value; });
  $('#edit-category').innerHTML = CATEGORIES.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('');
  $('#cover-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f && editing) await setCover(f);
  });
  $('#folder-input').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length && editing) await addFolder(files);
  });

  const dz = $('#dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });
  $('#file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
}
