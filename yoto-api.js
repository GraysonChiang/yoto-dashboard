// Yoto API 呼叫層。每個函式自己拿 access token。
// 端點與回傳格式依 https://yoto.dev/api/ 文件（2026-10 查核）。
import { AUTH, getAccessToken } from './yoto-auth.js';

async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${AUTH.api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Yoto API ${method} ${path} 失敗：HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return raw ? res : res.json();
}

// ---- content ----
export async function listMine() {
  const data = await api('/content/mine');
  return (data.cards || []).filter((c) => !c.deleted);
}

export async function getContent(cardId) {
  const data = await api(`/content/${encodeURIComponent(cardId)}`);
  return data.card || data;
}

export async function saveContent(body) {
  const data = await api('/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return data.card || data;
}

export async function deleteContent(cardId) {
  return api(`/content/${encodeURIComponent(cardId)}`, { method: 'DELETE' });
}

// ---- cover（App 裡顯示的大圖）----
// body 要是 raw 圖片（2026-10 實測：multipart 回 400）。回 { mediaId, mediaUrl }，mediaUrl 放進 metadata.cover.imageL
// 不要帶 coverType=myo：那會存成 520×400 橫式，App 顯示時被拉伸。不帶 coverType 會存成 638×1011（5:8，= 實體卡 54×85.6mm @300dpi）。
export async function uploadCover(imageBlob, name = 'cover') {
  const data = await api(`/media/coverImage/user/me/upload?autoconvert=true&filename=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': imageBlob.type || 'image/png' },
    body: imageBlob,
  });
  return data.coverImage;
}

// ---- icons ----
export async function listPublicIcons() {
  const data = await api('/media/displayIcons/user/yoto');
  return data.displayIcons || [];
}

export async function listMyIcons() {
  const data = await api('/media/displayIcons/user/me');
  return data.displayIcons || [];
}

// body 要是 raw PNG（不是 multipart）
export async function uploadIcon(pngBlob, name = 'icon') {
  const data = await api(`/media/displayIcons/user/me/upload?autoConvert=true&filename=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: pngBlob,
  });
  return data.displayIcon;
}

// ---- audio ----
const POLL_INTERVAL_MS = 1000;

function putWithProgress(url, file, onProgress) {
  // fetch 沒有上傳進度，用 XHR
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'audio/mpeg');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`音檔上傳失敗：HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('音檔上傳失敗：連線錯誤（可能是上傳網址不允許瀏覽器直接上傳）'));
    xhr.send(file);
  });
}

// 上傳 + 等轉檔。回 { sha256, info: { format, duration, fileSize, channels } }
export async function uploadAudio(file, { onProgress, onStage } = {}) {
  onStage?.('upload');
  const { upload } = await api('/media/transcode/audio/uploadUrl');
  await putWithProgress(upload.uploadUrl, file, onProgress);

  onStage?.('transcode');
  // 轉檔時間跟檔案長度有關；每 MB 給 30 秒，至少 5 分鐘
  const maxWaitMs = Math.max(300_000, (file.size / 1_048_576) * 30_000);
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const data = await api(`/media/upload/${encodeURIComponent(upload.uploadId)}/transcoded?loudnorm=false`).catch(() => null);
    const t = data?.transcode;
    if (t?.transcodedSha256) {
      const i = t.transcodedInfo || {};
      return { sha256: t.transcodedSha256, info: { format: i.format, duration: i.duration, fileSize: i.fileSize, channels: i.channels } };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('轉檔逾時，請稍後再試');
}
