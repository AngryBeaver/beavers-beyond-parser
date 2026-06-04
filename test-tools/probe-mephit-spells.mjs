import './env.mjs';

const PROXY = process.env.PROXY_URL;
const URL = 'https://www.dndbeyond.com/monsters/16851-dust-mephit';

const html = await fetch(`${PROXY}/fetch?url=${encodeURIComponent(URL)}`).then(r => r.text());

// Find the Innate Spellcasting block
const idx = html.indexOf('Innate Spellcasting');
if (idx < 0) { console.log('NOT FOUND'); process.exit(1); }
console.log(html.slice(Math.max(0, idx - 50), idx + 800));
