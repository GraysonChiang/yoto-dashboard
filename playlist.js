// 純邏輯：POST /content 的 body 組裝、既有 card 反解、SHA-256。
// 不碰 DOM，Node 裡可以直接測。

const YOTO_PREFIX = 'yoto:#';

function keyOf(index, total) {
  const width = Math.max(2, String(total).length);
  return String(index + 1).padStart(width, '0');
}

// Yoto 的 metadata.category 可用值
export const CATEGORIES = [
  { value: '', label: '（不指定）' },
  { value: 'stories', label: '故事' },
  { value: 'music', label: '音樂' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'radio', label: '廣播' },
  { value: 'sfx', label: '音效／白噪音' },
  { value: 'activities', label: '活動' },
];

// 既有 card → 編輯用的 metadata
export function metaFromContent(card) {
  const m = card?.metadata || {};
  return {
    description: m.description || '',
    category: m.category || '',
    author: m.author || '',
    coverUrl: m.cover?.imageL || null,
  };
}

// tracks: [{ title, sha256, info: { format, duration, fileSize, channels }, mediaId }]
// meta:   { description, category, author, coverUrl }（都可省略）
export function buildContentBody({ cardId, title, tracks, meta = {} }) {
  let duration = 0;
  let fileSize = 0;
  const chapters = tracks.map((t, i) => {
    const key = keyOf(i, tracks.length);
    const label = String(i + 1);
    const display = t.mediaId ? { icon16x16: `${YOTO_PREFIX}${t.mediaId}` } : null;
    const info = t.info || {};
    duration += info.duration || 0;
    fileSize += info.fileSize || 0;
    const track = {
      key: '01',
      title: t.title,
      trackUrl: `${YOTO_PREFIX}${t.sha256}`,
      type: 'audio',
      format: info.format,
      duration: info.duration,
      fileSize: info.fileSize,
      channels: info.channels,
      overlayLabel: label,
      ...(display ? { display } : {}),
    };
    return { key, title: t.title, overlayLabel: label, ...(display ? { display } : {}), tracks: [track] };
  });

  return {
    ...(cardId ? { cardId } : {}),
    title,
    content: { chapters },
    metadata: {
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.category ? { category: meta.category } : {}),
      ...(meta.author ? { author: meta.author } : {}),
      ...(meta.coverUrl ? { cover: { imageL: meta.coverUrl } } : {}),
      media: {
        duration,
        fileSize,
        readableFileSize: Math.round((fileSize / 1048576) * 10) / 10,
      },
    },
  };
}

function stripPrefix(s) {
  return typeof s === 'string' && s.startsWith(YOTO_PREFIX) ? s.slice(YOTO_PREFIX.length) : null;
}

// 既有 card（GET /content/{id}）→ 編輯用 tracks。每個 chapter 取第一個 track。
export function tracksFromContent(card) {
  const chapters = card?.content?.chapters || [];
  const out = [];
  for (const ch of chapters) {
    const tr = (ch.tracks || [])[0];
    if (!tr) continue;
    const sha256 = stripPrefix(tr.trackUrl);
    if (!sha256) continue; // 串流或其他來源，這個工具不處理
    const mediaId = stripPrefix(ch.display?.icon16x16) || stripPrefix(tr.display?.icon16x16) || null;
    out.push({
      title: ch.title || tr.title || '',
      sha256,
      info: { format: tr.format, duration: tr.duration, fileSize: tr.fileSize, channels: tr.channels },
      mediaId,
    });
  }
  return out;
}

export async function bytesSha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fileSha256(file) {
  return bytesSha256(await file.arrayBuffer());
}
