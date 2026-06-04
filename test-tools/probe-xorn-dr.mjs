import './env.mjs';

const PROXY = process.env.PROXY_URL;
const URL   = 'https://www.dndbeyond.com/monsters/17066-xorn';

const html = await fetch(`${PROXY}/fetch?url=${encodeURIComponent(URL)}`).then(r => r.text());

// Print 600 chars around "Damage Resistances"
const idx = html.indexOf('Damage Resistances');
if (idx >= 0) {
  console.log('--- Context around "Damage Resistances" ---');
  console.log(html.slice(Math.max(0, idx - 100), idx + 600));
} else {
  console.log('NOT FOUND in page');
  // Print a slice of the page to see what we got
  console.log(html.slice(0, 2000));
}
