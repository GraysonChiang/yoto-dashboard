// 右上角的登入狀態：Client ID 設定、登入、登出
import { login, logout, hasSession, getClientId, setClientId, getAccessToken, NeedLogin, redirectUri, AUTH } from './yoto-auth.js';
import { $, toast, show, esc } from './ui-common.js';

const listeners = [];
export function onAuthChange(fn) { listeners.push(fn); }
function notify(loggedIn) { for (const fn of listeners) fn(loggedIn); }

function render(loggedIn) {
  $('#account-status').textContent = loggedIn ? '已登入 Yoto' : '尚未登入 Yoto';
  show($('#btn-login'), !loggedIn);
  show($('#btn-logout'), loggedIn);
  notify(loggedIn);
}

// 設定 Client ID 的說明視窗。回傳 Promise<boolean>：有填就是 true。
function askClientId() {
  const redirect = redirectUri();
  const scopes = AUTH.scope.split(' ');
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal setup">
        <h3>設定你的 Yoto Client ID</h3>
        <p class="muted">這個工具不內建 Client ID，每個人要用自己的。只需要設定一次，之後會記在這個瀏覽器裡。</p>
        <ol>
          <li>到 <a href="https://dashboard.yoto.dev" target="_blank" rel="noopener">dashboard.yoto.dev</a> 用你的 Yoto 帳號登入，建立一個 <strong>Public</strong> client。</li>
          <li>Redirect URL 填這個（一字不差）：
            <div class="copy-row"><code>${esc(redirect)}</code><button class="small" data-copy>複製</button></div></li>
          <li>Scopes 勾選 ${scopes.map((s) => `<code>${esc(s)}</code>`).join('、')}，然後按<strong>儲存</strong>。</li>
          <li>把 Client ID 貼在下面。</li>
        </ol>
        <input type="text" data-id placeholder="例如 tpc_xxxxxxxxxxxx" value="${esc(getClientId())}">
        <div class="row between">
          <span class="muted small">Client ID 只存在你的瀏覽器，不會傳到別的地方。</span>
          <span class="row gap"><button class="ghost" data-cancel>取消</button><button class="primary" data-ok>儲存</button></span>
        </div>
      </div>`;
    document.body.appendChild(back);
    const input = back.querySelector('[data-id]');
    const done = (ok) => { back.remove(); resolve(ok); };
    back.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(redirect); toast('已複製回呼網址'); } catch { toast('複製失敗，請手動選取', { error: true }); }
    });
    back.querySelector('[data-cancel]').addEventListener('click', () => done(false));
    back.querySelector('[data-ok]').addEventListener('click', () => {
      const id = input.value.trim();
      if (!id) { input.focus(); return; }
      setClientId(id); done(true);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') back.querySelector('[data-ok]').click(); });
    input.focus();
  });
}

export async function ensureLoggedIn() {
  try { await getAccessToken(); return true; } catch (e) {
    if (e instanceof NeedLogin) return false;
    throw e;
  }
}

export function initAuth() {
  $('#btn-login').addEventListener('click', async () => {
    if (!getClientId() && !(await askClientId())) return;
    try {
      toast('已開啟登入分頁，請在那裡完成 Yoto 登入…', { ms: 6000 });
      await login();
      render(true);
      toast('登入成功');
    } catch (e) {
      toast(e.message, { error: true, ms: 6000 });
    }
  });
  $('#btn-login').addEventListener('contextmenu', (e) => { e.preventDefault(); askClientId(); }); // 右鍵可重設 Client ID
  $('#btn-logout').addEventListener('click', () => { logout(); render(false); });

  if (hasSession()) {
    ensureLoggedIn().then(render).catch((e) => { toast(e.message, { error: true }); render(false); });
  } else {
    render(false);
  }
}
