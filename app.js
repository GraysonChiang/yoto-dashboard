// 進入點：分頁切換 + 初始化各分頁
import { $, $$ } from './ui-common.js';
import { HARDWARE } from './config.js';
import { initAuth } from './ui-auth.js';
import { initPlaylistTab } from './ui-playlist.js';
import { initPrintTab } from './ui-print.js';

function initTabs() {
  const key = 'ycs.tab';
  const activate = (name) => {
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`));
    try { localStorage.setItem(key, name); } catch {}
  };
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  activate(saved && $(`#tab-${saved}`) ? saved : 'playlists');
}

if (HARDWARE) {
  // 讀卡機分頁要先初始化，製作卡片分頁會訂閱它的連線狀態
  const [{ initReaderTab }, { initCardsTab }] = await Promise.all([import('./ui-reader.js'), import('./ui-cards.js')]);
  initReaderTab();
  initCardsTab();
} else {
  $$('[data-hardware]').forEach((el) => el.remove());
}
initTabs();
initPlaylistTab(); // 會訂閱登入狀態，所以要在 initAuth 之前
initPrintTab();
initAuth();
