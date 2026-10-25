// 列印標籤的卡片排列（純邏輯）。cells 是扁平陣列：索引 = 第幾格（跨頁連號），值 = cardId 或 null（空格）。
// 都回傳新陣列，不改傳入的那個。

const trimEnd = (cells) => {
  const out = [...cells];
  while (out.length && out[out.length - 1] == null) out.pop();
  return out;
};

// 勾選：放進起始格之後第一個空格，沒有就接在最後
export function addCard(cells, id, start = 0) {
  if (cells.includes(id)) return [...cells];
  const out = [...cells];
  while (out.length < start) out.push(null);
  const empty = out.findIndex((c, i) => i >= start && c == null);
  if (empty >= 0) out[empty] = id; else out.push(id);
  return out;
}

// 取消勾選：那一格變空格，其他卡片不動
export function removeCard(cells, id) {
  return cells.map((c) => (c === id ? null : c));
}

// 拖曳：目標格有卡就交換，空格就直接移過去
export function moveCard(cells, from, to) {
  if (from === to) return [...cells];
  const out = [...cells];
  while (out.length <= Math.max(from, to)) out.push(null);
  [out[from], out[to]] = [out[to], out[from]];
  return trimEnd(out);
}

// 換版型、改起始格時重新排：保留順序、去掉空格，前面留 start 個空格
export function compact(cells, start = 0) {
  return [...Array(start).fill(null), ...cells.filter((c) => c != null)];
}

// 切成每頁 perPage 格；最後一頁補空格，結尾整頁空白的不算
export function toPages(cells, perPage) {
  const used = trimEnd(cells);
  const pages = [];
  for (let i = 0; i < used.length; i += perPage) {
    const page = used.slice(i, i + perPage);
    while (page.length < perPage) page.push(null);
    pages.push(page);
  }
  return pages;
}
