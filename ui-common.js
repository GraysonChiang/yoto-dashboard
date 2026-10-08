// 小工具：DOM 查詢、toast、HTML escape

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, { error = false, ms = 3500 } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', error);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function show(el, on = true) { el.classList.toggle('hidden', !on); }
