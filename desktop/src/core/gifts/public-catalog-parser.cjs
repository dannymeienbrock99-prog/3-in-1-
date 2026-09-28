'use strict';
// Parse the public calculator's server-rendered JSON data, never execute remote code.
function parsePublicCatalog(html) {
  if (typeof html !== 'string' || html.length > 5 * 1024 * 1024) throw new Error('Gift catalog response too large or invalid.');
  const chunks = [];
  const pattern = /self\.__next_f\.push\((\[.*?\])\)<\/script>/gs;
  for (const match of html.matchAll(pattern)) {
    let payload;
    try { payload = JSON.parse(match[1]); } catch { continue; }
    if (Array.isArray(payload) && payload[0] === 1 && typeof payload[1] === 'string') chunks.push(payload[1]);
  }
  let gifts = null;
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 80) return;
    if (!Array.isArray(value) && Array.isArray(value.initialGifts)) gifts = value.initialGifts;
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  for (const line of chunks.join('').split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    try { visit(JSON.parse(line.slice(separator + 1))); } catch { /* Non-JSON RSC records. */ }
  }
  if (!gifts || gifts.length < 1 || gifts.length > 10000) throw new Error('Public gift catalog format changed or is empty.');
  const ids = new Set();
  return gifts.map(row => {
    if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200) throw new Error('Invalid public gift catalog row.');
    ids.add(row.id);
    let imageUrl = '';
    try { const url = new URL(row.imageUrl); if (url.protocol === 'https:' && !url.username && !url.password) imageUrl = url.href; } catch {}
    return { giftId: String(row.id), name: row.name.trim(), coins: Number.isSafeInteger(row.diamondCount) && row.diamondCount >= 0 ? row.diamondCount : null, imageUrl, source: 'https://www.eulerstream.com/tools/tiktok-gifts-calculator' };
  });
}
module.exports = { parsePublicCatalog };

