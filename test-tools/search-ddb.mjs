/**
 * Standalone D&D Beyond monster search helper.
 *
 * Usage:
 *   node search-ddb.mjs "Goblin"
 *   node search-ddb.mjs "Adult Black Dragon"
 *
 * Prints the href for the "Basic Rules (2014)" entry, or all entries if none
 * match that source.
 */

import './env.mjs';

const PROXY_URL = process.env.PROXY_URL;
const DDB_BASE  = 'https://www.dndbeyond.com';
const name      = process.argv[2];

if (!name) {
  console.error('Usage: node search-ddb.mjs "Monster Name"');
  process.exit(1);
}

const searchUrl = `${DDB_BASE}/monsters?filter-type=0&filter-search=${encodeURIComponent(name)}`;
const resp = await fetch(`${PROXY_URL}/fetch?url=${encodeURIComponent(searchUrl)}`);
if (!resp.ok) { console.error(`Proxy ${resp.status}`); process.exit(1); }
const html = await resp.text();

const rowRe = /<div[^>]*class="row monster-name"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
const entries = [];
let match;
while ((match = rowRe.exec(html)) !== null) {
  const block = match[1];
  const hrefM  = block.match(/href="(\/monsters\/[^"]+)"/);
  const nameM  = block.match(/<a[^>]*class="link"[^>]*>([^<]+)<\/a>/);
  const srcM   = block.match(/<span[^>]*class="source"[^>]*>([^<]+)<\/span>/);
  if (!hrefM) continue;
  entries.push({
    name:   nameM  ? nameM[1].trim()  : '?',
    source: srcM   ? srcM[1].trim()   : '?',
    href:   hrefM[1],
    url:    `${DDB_BASE}${hrefM[1]}`,
  });
}

if (entries.length === 0) {
  console.log('No results found.');
  process.exit(0);
}

const basic = entries.filter(e => e.source === 'Basic Rules (2014)');
const display = basic.length > 0 ? basic : entries;

for (const e of display) {
  console.log(`${e.name} [${e.source}]`);
  console.log(`  href: ${e.href}`);
  console.log(`  url:  ${e.url}`);
}
