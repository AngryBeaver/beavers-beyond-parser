import './env.mjs';
import { BeaversClient } from 'beavers-voice-transcript-client';

const FOUNDRY_URL  = process.env.FOUNDRY_URL;
const FOUNDRY_USER = process.env.FOUNDRY_USER;
const FOUNDRY_PASS = process.env.FOUNDRY_PASS;
const PROXY_URL    = process.env.PROXY_URL;

const DRAGONS = [
  { name: 'Ancient Bronze Dragon', url: 'https://www.dndbeyond.com/monsters/16778-ancient-bronze-dragon' },
  { name: 'Adult White Dragon',    url: 'https://www.dndbeyond.com/monsters/16773-adult-white-dragon' },
];

const client = new BeaversClient({ url: FOUNDRY_URL, userId: FOUNDRY_USER, password: FOUNDRY_PASS, timeout: 120_000 });
await client.connect();

for (const { name, url } of DRAGONS) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${name}`);
  console.log('='.repeat(60));

  // Reference items from compendium
  const ref = await client.queryCompendiumActor(name, 'dnd5e.monsters');
  console.log('\n── Compendium items ──');
  for (const item of (ref?.items ?? [])) {
    console.log(`  [${item.type}] ${item.name}`);
  }

  // Parsed items
  const previewResult = await client.previewMonsterImport(url, { skipAi: true });
  const preview = previewResult?.actorData;
  console.log('\n── Parsed items ──');
  for (const item of (preview?.items ?? [])) {
    console.log(`  [${item.type}] ${item.name}`);
  }
}

await client.disconnect();
