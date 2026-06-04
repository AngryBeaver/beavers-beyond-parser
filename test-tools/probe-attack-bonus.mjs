import './env.mjs';
import { BeaversClient } from 'beavers-voice-transcript-client';

const FOUNDRY_URL  = process.env.FOUNDRY_URL;
const FOUNDRY_USER = process.env.FOUNDRY_USER;
const FOUNDRY_PASS = process.env.FOUNDRY_PASS;

const MONSTERS = [
  { name: 'Drider',           url: 'https://www.dndbeyond.com/monsters/16847-drider',           weapon: 'Bite' },
  { name: 'Gelatinous Cube',  url: 'https://www.dndbeyond.com/monsters/16869-gelatinous-cube',  weapon: 'Pseudopod' },
];

const client = new BeaversClient({ url: FOUNDRY_URL, userId: FOUNDRY_USER, password: FOUNDRY_PASS, timeout: 120_000 });
await client.connect();

function abilityMod(score) { return Math.floor((score - 10) / 2); }
function profBonusFromCr(cr) {
  if (cr <= 4)  return 2;
  if (cr <= 8)  return 3;
  if (cr <= 12) return 4;
  if (cr <= 16) return 5;
  if (cr <= 20) return 6;
  return 7;
}

function describeWeapon(actor, weaponName) {
  const item = (actor?.items ?? []).find(i => i.name === weaponName);
  if (!item) return `  ${weaponName}: NOT FOUND`;

  const sys = item.system ?? {};
  const abilities = actor?.system?.abilities ?? {};
  const cr = actor?.system?.details?.cr ?? 0;
  const prof = profBonusFromCr(cr);

  const lines = [];
  lines.push(`  ${weaponName}:`);
  lines.push(`    type: ${item.type}`);

  // Activities
  const acts = sys.activities ?? {};
  for (const [id, act] of Object.entries(acts)) {
    const atk = act.attack ?? {};
    lines.push(`    activity[${id.slice(0,8)}]: ability=${atk.ability ?? '(default)'}, flat=${atk.flat}, bonus=${JSON.stringify(atk.bonus)}`);
    if (atk.flat) {
      lines.push(`    → displayed to-hit: FLAT ${atk.bonus}`);
    } else {
      // Figure out which ability drives this weapon
      const abilityKey = atk.ability || (sys.properties?.fin ? 'str_or_dex' : (sys.type?.value === 'ranged' ? 'dex' : 'str'));
      const abilityScore = abilities[abilityKey]?.value;
      const mod = abilityScore !== undefined ? abilityMod(abilityScore) : '?';
      const extraBonus = Number(atk.bonus) || 0;
      const total = typeof mod === 'number' ? mod + prof + extraBonus : `${mod}+${prof}+${extraBonus}`;
      lines.push(`    → auto-calc: ${abilityKey} mod (${mod}) + prof (${prof}) + extra (${extraBonus}) = ${total}`);
    }
  }

  return lines.join('\n');
}

for (const { name, url, weapon } of MONSTERS) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(name);
  console.log('='.repeat(60));

  const ref = await client.queryCompendiumActor(name, 'dnd5e.monsters');
  const cr  = ref?.system?.details?.cr ?? '?';
  const str = ref?.system?.abilities?.str?.value ?? '?';
  const dex = ref?.system?.abilities?.dex?.value ?? '?';
  console.log(`CR=${cr}  STR=${str}  DEX=${dex}  prof=+${profBonusFromCr(cr)}`);

  console.log('\n── Compendium ──');
  console.log(describeWeapon(ref, weapon));

  const preview = (await client.previewMonsterImport(url, { skipAi: true }))?.actorData;
  console.log('\n── Parsed ──');
  console.log(describeWeapon(preview, weapon));
}

await client.disconnect();
