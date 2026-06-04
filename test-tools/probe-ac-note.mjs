import './env.mjs';

const PROXY = process.env.PROXY_URL;
const MONSTERS = [
  { name: 'Erinyes',               url: 'https://www.dndbeyond.com/monsters/16858-erinyes' },
  { name: 'Fire Giant',            url: 'https://www.dndbeyond.com/monsters/16862-fire-giant' },
  { name: 'Half-Red Dragon Veteran', url: 'https://www.dndbeyond.com/monsters/16918-half-red-dragon-veteran' },
];

for (const { name, url } of MONSTERS) {
  const html = await fetch(`${PROXY}/fetch?url=${encodeURIComponent(url)}`).then(r => r.text());

  // Look for Armor Class block
  const acIdx = html.indexOf('Armor Class');
  if (acIdx < 0) { console.log(`${name}: NOT FOUND`); continue; }
  const chunk = html.slice(acIdx, acIdx + 400);
  console.log(`\n=== ${name} ===`);
  console.log(chunk);
}
