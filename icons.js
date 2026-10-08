// 圖示工具：任意圖片 → 16×16 PNG（nearest-neighbor，保留像素感）；dataURL 轉換。
// 只在瀏覽器用（需要 canvas / Image）。

export const ICON_SIZE = 16;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張圖片')); };
    img.src = url;
  });
}

// 置中裁切成正方形後縮到 16×16。小於等於 16 的圖用 nearest-neighbor，大圖用平滑縮放避免糊成一團。
export async function imageTo16x16Png(blob) {
  const img = await loadImage(blob);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = side > ICON_SIZE * 2;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, ICON_SIZE, ICON_SIZE);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// Yoto App 的封面格子是直式 5:8（跟實體卡 54×85.6mm 一樣），Yoto 會把上傳的圖轉成 638×1011。
// 不合比例的圖會被拉伸，所以先把圖「完整放進」5:8 畫布：比例接近的置中裁切，其他的用模糊放大的本圖補滿。
export const COVER_W = 638;
export const COVER_H = 1011;
export async function imageToCover(blob) {
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const ctx = canvas.getContext('2d');
  const target = COVER_W / COVER_H;
  const ratio = img.naturalWidth / img.naturalHeight;
  if (Math.abs(ratio - target) < 0.08) {
    // 已經接近 5:8：置中裁切
    let sw = img.naturalWidth, sh = img.naturalHeight;
    if (ratio > target) sw = sh * target; else sh = sw / target;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, COVER_W, COVER_H);
  } else {
    ctx.filter = 'blur(40px) saturate(0.8)';
    ctx.drawImage(img, -COVER_W * 0.1, -COVER_H * 0.1, COVER_W * 1.2, COVER_H * 1.2); // 放大一點避免模糊邊緣露黑
    ctx.filter = 'none';
    const s = Math.min(COVER_W / img.naturalWidth, COVER_H / img.naturalHeight);
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    ctx.drawImage(img, (COVER_W - w) / 2, (COVER_H - h) / 2, w, h);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
