import './env.mjs';
import { BeaversClient } from 'beavers-voice-transcript-client';

const FOUNDRY_URL  = process.env.FOUNDRY_URL;
const FOUNDRY_USER = process.env.FOUNDRY_USER;
const FOUNDRY_PASS = process.env.FOUNDRY_PASS;
const PROXY_URL    = process.env.PROXY_URL;

const client = new BeaversClient({ url: FOUNDRY_URL, userId: FOUNDRY_USER, password: FOUNDRY_PASS, timeout: 120_000 });
await client.connect();

// ── Issue 6: Mephit innate spells ─────────────────────────────────────────────
console.log('\n══ Issue 6: Mephit innate spells ══');
const MEPHITS = [
  { name: 'Dust Mephit',  url: 'https://www.dndbeyond.com/monsters/16851-dust-mephit',  spell: 'sleep' },
  { name: 'Ice Mephit',   url: 'https://www.dndbeyond.com/monsters/16932-ice-mephit',   spell: 'fog cloud' },
  { name: 'Steam Mephit', url: 'https://www.dndbeyond.com/monsters/17022-steam-mephit', spell: 'blur' },
  { name: 'Magma Mephit', url: 'https://www.dndbeyond.com/monsters/16948-magma-mephit', spell: 'heat metal' },
];
for (const { name, url, spell } of MEPHITS) {
  const preview = (await client.previewMonsterImport(url, { skipAi: true }))?.actorData;
  const spellItems = (preview?.items ?? []).filter(i => i.type === 'spell');
  const featItems  = (preview?.items ?? []).filter(i => i.type === 'feat');
  console.log(`\n${name}:`);
  console.log(`  spells: ${spellItems.map(i => i.name).join(', ') || '(none)'}`);
  console.log(`  feats:  ${featItems.map(i => i.name).join(', ')}`);
  console.log(`  looking for: "${spell}"`);
}

// ── Issue 7: Language "custom" key ───────────────────────────────────────────
console.log('\n\n══ Issue 7: Language custom key ══');

// Check what DDB text looks like for a "custom" case (Worg) and an "extra" case (Pegasus)
const LANG_PROBES = [
  { name: 'Worg',   url: 'https://www.dndbeyond.com/monsters/17063-worg' },
  { name: 'Pegasus', url: 'https://www.dndbeyond.com/monsters/16977-pegasus' },
  { name: 'Gnoll',   url: 'https://www.dndbeyond.com/monsters/16904-gnoll' },
  { name: 'Kraken',  url: 'https://www.dndbeyond.com/monsters/16940-kraken' },
];
for (const { name, url } of LANG_PROBES) {
  // Get raw DDB text for Languages line
  const html = await fetch(`${PROXY_URL}/fetch?url=${encodeURIComponent(url)}`).then(r => r.text());
  const langIdx = html.indexOf('Languages');
  const chunk = langIdx >= 0 ? html.slice(langIdx, langIdx + 200) : 'NOT FOUND';
  // Get what our parser produces
  const preview = (await client.previewMonsterImport(url, { skipAi: true }))?.actorData;
  const parsedLangs = preview?.system?.traits?.languages ?? {};
  // Get compendium reference
  const ref = await client.queryCompendiumActor(name, 'dnd5e.monsters');
  const refLangs = ref?.system?.traits?.languages ?? {};
  console.log(`\n${name}:`);
  console.log(`  DDB raw:      ${chunk.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120)}`);
  console.log(`  parsed value: ${JSON.stringify(parsedLangs.value)}  custom: "${parsedLangs.custom ?? ''}"`);
  console.log(`  ref value:    ${JSON.stringify(refLangs.value)}  custom: "${refLangs.custom ?? ''}"`);
}

await client.disconnect();
