// Yoto OAuth2：Authorization Code + PKCE。
// 登入在新分頁完成，callback.html 透過 BroadcastChannel 把 code 送回來。
// refresh token 存 localStorage（只能用一次，每次 refresh 都要存新的）。
// 這個模組在 Node 測試裡也會被 import，所以不能在頂層碰 window / localStorage。

export const AUTH = {
  api: 'https://api.yotoplay.com',
  login: 'https://login.yotoplay.com',
  // 四個 scope 都要在 dashboard.yoto.dev 的 app 裡預先勾選並儲存
  scope: 'user:content:view user:content:manage user:icons:manage offline_access',
  channel: 'yoto-auth',
};

const KEY_CLIENT_ID = 'ycs.clientId';
const KEY_REFRESH = 'ycs.refreshToken';

export class NeedLogin extends Error {
  constructor(msg = '請先登入 Yoto') { super(msg); this.name = 'NeedLogin'; }
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

// OAuth 回呼網址：本機 server（port 8787）沿用 /callback；部署在別處（GitHub Pages）則是同一層的 callback.html。
// 這個網址必須事先登記在 dashboard.yoto.dev 的 client 上。
export function redirectUriFor(loc) {
  if (/^http:\/\/(127\.0\.0\.1|localhost):8787$/.test(loc.origin)) return `${loc.origin}/callback`;
  const dir = loc.pathname.replace(/[^/]*$/, '');
  return `${loc.origin}${dir}callback.html`;
}
export const redirectUri = () => redirectUriFor(window.location);

export function buildAuthorizeUrl(clientId, challenge, state, redirect = redirectUri()) {
  const u = new URL(`${AUTH.login}/authorize`);
  u.search = new URLSearchParams({
    audience: AUTH.api,
    scope: AUTH.scope,
    response_type: 'code',
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirect,
    state,
  }).toString();
  return u.toString();
}

// ---- 儲存 ----
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
// 不內建 Client ID：每個人要到 dashboard.yoto.dev 建自己的 Public client，第一次登入時輸入，存在 localStorage。
export const getClientId = () => store.get(KEY_CLIENT_ID) || '';
export const setClientId = (id) => store.set(KEY_CLIENT_ID, id.trim());
export const hasSession = () => !!store.get(KEY_REFRESH);

let cached = { token: null, exp: 0 };

async function tokenRequest(params) {
  const res = await fetch(`${AUTH.login}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `token HTTP ${res.status}`);
  if (data.refresh_token) store.set(KEY_REFRESH, data.refresh_token);
  cached = { token: data.access_token, exp: Date.now() + ((data.expires_in || 3600) - 60) * 1000 };
  return data.access_token;
}

// 開新分頁登入；等 callback 回傳 code 後換 token
export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new NeedLogin('請先在設定裡填入 Yoto Client ID');
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = buildAuthorizeUrl(clientId, challenge, state);

  const code = await new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(AUTH.channel);
    const timer = setTimeout(() => { ch.close(); reject(new Error('登入逾時，請再試一次')); }, 5 * 60 * 1000);
    ch.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.state !== state) return; // 不是這次的登入
      clearTimeout(timer);
      ch.close();
      if (m.error) reject(new Error(`${m.error}: ${m.error_description || ''}`.trim()));
      else resolve(m.code);
    };
    const w = window.open(url, '_blank');
    if (!w) { clearTimeout(timer); ch.close(); reject(new Error('瀏覽器擋住了登入視窗，請允許彈出視窗後重試')); }
  });

  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: clientId,
    code_verifier: verifier,
    code,
    redirect_uri: redirectUri(),
  });
}

export async function getAccessToken() {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const refresh = store.get(KEY_REFRESH);
  if (!refresh) throw new NeedLogin();
  try {
    return await tokenRequest({ grant_type: 'refresh_token', client_id: getClientId(), refresh_token: refresh });
  } catch (e) {
    store.del(KEY_REFRESH);
    cached = { token: null, exp: 0 };
    throw new NeedLogin(`登入已失效（${e.message}），請重新登入`);
  }
}

export function logout() {
  store.del(KEY_REFRESH);
  cached = { token: null, exp: 0 };
}
