/**
 * Monster Import Validation Script
 *
 * For each monster in the dnd5e.monsters SRD compendium:
 *  1. Search D&D Beyond for the monster name (via proxy)
 *  2. Find the "Basic Rules (2014)" entry → get the /monsters/ href
 *  3. Ask beavers-beyond-parser to preview-parse the monster (no Actor.create)
 *  4. Compare the parsed actor data against the compendium reference
 *  5. Report differences
 *
 * Prerequisites:
 *   - Foundry running at localhost:14636 with beavers-ai-assistant + beavers-beyond-parser active
 *   - Proxy running at localhost:3001 with a valid CobaltSession
 *   - dnd5e.monsters compendium pack loaded
 *
 * Usage:
 *   node validate-monsters.mjs [--pack dnd5e.monsters] [--limit 10] [--name Goblin]
 *
 * Output:
 *   Prints a summary table; writes full JSON to validation-report.json
 */

import './env.mjs';
import { BeaversClient } from 'beavers-voice-transcript-client';
import { writeFileSync, readFileSync } from 'fs';

// ── Known compendium issues (false positives) ─────────────────────────────────
const knownIssuesPath = new URL('./validation-known-issues.json', import.meta.url);
const KNOWN_ISSUES = JSON.parse(readFileSync(knownIssuesPath, 'utf8')).knownIssues;

function filterKnownIssues(name, diffs) {
  const knownFields = new Set(
    KNOWN_ISSUES
      .filter(k => k.monster.toLowerCase() === name.toLowerCase())
      .map(k => k.field),
  );
  if (knownFields.size === 0) return diffs;
  return diffs.filter(d => !knownFields.has(d.field));
}

// ── Config ────────────────────────────────────────────────────────────────────

const FOUNDRY_URL  = process.env.FOUNDRY_URL;
const FOUNDRY_USER = process.env.FOUNDRY_USER;
const FOUNDRY_PASS = process.env.FOUNDRY_PASS;
const PROXY_URL    = process.env.PROXY_URL;
const DDB_BASE     = 'https://www.dndbeyond.com';

const args        = process.argv.slice(2);
const packArg     = argVal(args, '--pack')  ?? 'dnd5e.monsters';
const limitArg    = parseInt(argVal(args, '--limit') ?? '9999', 10);
const singleName  = argVal(args, '--name');   // validate just one monster

function argVal(arr, flag) {
  const i = arr.indexOf(flag);
  return i !== -1 ? arr[i + 1] : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function proxyFetch(url) {
  const resp = await fetch(`${PROXY_URL}/fetch?url=${encodeURIComponent(url)}`);
  if (!resp.ok) throw new Error(`Proxy ${resp.status} fetching ${url}`);
  return resp.text();
}

/**
 * Search D&D Beyond for a monster name and return the href of the entry whose
 * source is "Basic Rules (2014)".  Returns null if not found.
 */
async function findDdbHref(monsterName) {
  const searchUrl = `${DDB_BASE}/monsters?filter-type=0&filter-search=${encodeURIComponent(monsterName)}`;
  let html;
  try {
    html = await proxyFetch(searchUrl);
  } catch (err) {
    return { href: null, error: err.message };
  }

  // Find all monster-name rows and match on source "Basic Rules (2014)"
  // Pattern: <div class="row monster-name">...<a class="link" href="/monsters/...">NAME</a>...
  //          <span class="source">Basic Rules (2014)</span>
  const rowRe = /<div[^>]*class="row monster-name"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let match;
  while ((match = rowRe.exec(html)) !== null) {
    const block = match[1];
    if (!block.includes('Basic Rules (2014)')) continue;
    const hrefMatch = block.match(/href="(\/monsters\/[^"]+)"/);
    if (!hrefMatch) continue;
    const nameMatch = block.match(/<a[^>]*class="link"[^>]*>([^<]+)<\/a>/);
    const foundName = nameMatch ? nameMatch[1].trim() : '';
    // Verify the name matches (case-insensitive)
    if (foundName.toLowerCase() === monsterName.toLowerCase()) {
      return { href: hrefMatch[1], error: null };
    }
  }

  return { href: null, error: `No "Basic Rules (2014)" entry found for "${monsterName}"` };
}

// ── Comparison ────────────────────────────────────────────────────────────────

// dnd5e 6.0 stores speeds in movement.speeds, older versions directly on movement.
function speed(sys, type) {
  const movement = sys?.attributes?.movement;
  return movement?.speeds?.[type] ?? movement?.[type] ?? 0;
}

function setDiff(a, b) {
  const setA = new Set(Array.isArray(a) ? a : []);
  const setB = new Set(Array.isArray(b) ? b : []);
  const missing = [...setB].filter(x => !setA.has(x));
  const extra   = [...setA].filter(x => !setB.has(x));
  return { missing, extra };
}

function compareActors(preview, reference) {
  const diffs = [];
  const prevSys = preview?.system ?? {};
  const refSys  = reference?.system ?? {};

  // ── Ability scores ──────────────────────────────────────────────────────────
  for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const p = prevSys?.abilities?.[ab]?.value;
    const r = refSys?.abilities?.[ab]?.value;
    if (p !== r) diffs.push({ field: `abilities.${ab}`, parsed: p, reference: r });
  }

  // ── HP ──────────────────────────────────────────────────────────────────────
  const pHp = prevSys?.attributes?.hp?.value;
  const rHp = refSys?.attributes?.hp?.value;
  if (pHp !== rHp) diffs.push({ field: 'hp', parsed: pHp, reference: rHp });

  // ── AC ── skip: dnd5e 5.x computes ac.flat dynamically from equipped armor

  // ── CR ──────────────────────────────────────────────────────────────────────
  const pCr = prevSys?.details?.cr;
  const rCr = refSys?.details?.cr;
  if (pCr !== rCr) diffs.push({ field: 'cr', parsed: pCr, reference: rCr });

  // ── Movement ────────────────────────────────────────────────────────────────
  for (const mv of ['walk', 'fly', 'swim', 'burrow', 'climb']) {
    const p = Number(speed(prevSys, mv));
    const r = Number(speed(refSys, mv));
    if (p !== r) diffs.push({ field: `movement.${mv}`, parsed: p, reference: r });
  }

  // ── Senses ──────────────────────────────────────────────────────────────────
  for (const s of ['darkvision', 'blindsight', 'tremorsense', 'truesight']) {
    const p = prevSys?.attributes?.senses?.ranges?.[s] ?? 0;
    const r = refSys?.attributes?.senses?.ranges?.[s] ?? 0;
    if (p !== r) diffs.push({ field: `senses.${s}`, parsed: p, reference: r });
  }

  // ── Damage / condition traits ───────────────────────────────────────────────
  for (const trait of ['di', 'dr', 'dv', 'ci']) {
    const { missing, extra } = setDiff(
      prevSys?.traits?.[trait]?.value ?? [],
      refSys?.traits?.[trait]?.value  ?? [],
    );
    if (missing.length) diffs.push({ field: `traits.${trait}.missing`, parsed: null, reference: missing });
    if (extra.length)   diffs.push({ field: `traits.${trait}.extra`,   parsed: extra, reference: null });
  }

  // ── Languages ───────────────────────────────────────────────────────────────
  const { missing: langMissing, extra: langExtra } = setDiff(
    prevSys?.traits?.languages?.value ?? [],
    refSys?.traits?.languages?.value  ?? [],
  );
  if (langMissing.length) diffs.push({ field: 'languages.missing', parsed: null, reference: langMissing });
  if (langExtra.length)   diffs.push({ field: 'languages.extra',   parsed: langExtra, reference: null });

  // ── Items (by name, case-insensitive, strip parentheticals for comparison) ───
  // Normalise for comparison: lowercase, strip parentheticals, singular/plural
  const normaliseItemName = n =>
    n.toLowerCase().replace(/\s*\([^)]+\)/g, '').trim().replace(/s$/, '');
  const prevItems = (preview?.items  ?? []).map(i => normaliseItemName(i.name)).sort();
  const refItems  = (reference?.items ?? []).map(i => normaliseItemName(i.name)).sort();
  const { missing: itemMissing, extra: itemExtra } = setDiff(prevItems, refItems);
  if (itemMissing.length) diffs.push({ field: 'items.missing', parsed: null, reference: itemMissing });
  if (itemExtra.length)   diffs.push({ field: 'items.extra',   parsed: itemExtra, reference: null });

  // ── Attack bonus per weapon ─────────────────────────────────────────────────
  const refWeapons = (reference?.items ?? []).filter(i => i.type === 'weapon');
  const prevWeapons = (preview?.items  ?? []).filter(i => i.type === 'weapon');
  for (const rw of refWeapons) {
    const pw = prevWeapons.find(w => w.name === rw.name);
    if (!pw) continue; // already reported as missing above
    const rBonus = firstActivityAttackBonus(rw);
    const pBonus = firstActivityAttackBonus(pw);
    if (rBonus !== null && pBonus !== null && rBonus !== pBonus) {
      diffs.push({ field: `weapon[${rw.name}].attackBonus`, parsed: pBonus, reference: rBonus });
    }
  }

  return diffs;
}

function firstActivityAttackBonus(item) {
  const acts = item?.system?.activities ?? {};
  for (const act of Object.values(acts)) {
    if (act?.attack?.bonus !== undefined) return Number(act.attack.bonus) || 0;
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const client = new BeaversClient({ url: FOUNDRY_URL, userId: FOUNDRY_USER, password: FOUNDRY_PASS, timeout: 120_000 });

try {
  process.stdout.write('Connecting to Foundry… ');
  await client.connect();
  console.log('OK');

  process.stdout.write(`Listing actors in ${packArg}… `);
  const allActors = await client.listCompendiumActors(packArg);
  console.log(`${allActors.length} actors`);

  const targets = singleName
    ? allActors.filter(a => a.name.toLowerCase() === singleName.toLowerCase())
    : allActors.slice(0, limitArg);

  if (targets.length === 0) {
    console.error(`No actors found${singleName ? ` named "${singleName}"` : ''} in ${packArg}`);
    process.exit(1);
  }

  const results = [];
  let passed = 0, failed = 0, skipped = 0;

  for (let i = 0; i < targets.length; i++) {
    const { name } = targets[i];
    const pct = `[${i + 1}/${targets.length}]`;
    process.stdout.write(`${pct} ${name}… `);

    // Step 1: find D&D Beyond URL
    const { href, error: searchErr } = await findDdbHref(name);
    if (!href) {
      console.log(`SKIP (${searchErr})`);
      results.push({ name, status: 'skipped', reason: searchErr, diffs: [] });
      skipped++;
      continue;
    }

    const ddbUrl = `${DDB_BASE}${href}`;

    // Step 2: preview import via beavers-beyond-parser socket
    let preview = null;
    try {
      const previewResult = await client.previewMonsterImport(ddbUrl, { skipAi: true });
      preview = previewResult?.actorData ?? null;
    } catch (err) {
      console.log(`FAIL (preview: ${err.message})`);
      results.push({ name, ddbUrl, status: 'error', reason: err.message, diffs: [] });
      failed++;
      continue;
    }

    if (!preview) {
      console.log('FAIL (preview returned null)');
      results.push({ name, ddbUrl, status: 'error', reason: 'preview returned null', diffs: [] });
      failed++;
      continue;
    }

    // Step 3: get reference from compendium
    let reference = null;
    try {
      reference = await client.queryCompendiumActor(name, packArg);
    } catch (err) {
      console.log(`FAIL (reference: ${err.message})`);
      results.push({ name, ddbUrl, status: 'error', reason: err.message, diffs: [] });
      failed++;
      continue;
    }

    if (!reference) {
      console.log('FAIL (compendium reference returned null)');
      results.push({ name, ddbUrl, status: 'error', reason: 'compendium reference null', diffs: [] });
      failed++;
      continue;
    }

    // Step 4: compare (filter out known compendium data errors)
    const diffs = filterKnownIssues(name, compareActors(preview, reference));
    if (diffs.length === 0) {
      console.log('PASS');
      results.push({ name, ddbUrl, status: 'pass', diffs: [] });
      passed++;
    } else {
      const summary = diffs.map(d => d.field).join(', ');
      console.log(`DIFF [${diffs.length}] — ${summary}`);
      results.push({ name, ddbUrl, status: 'diff', diffs });
      failed++;
    }

    // Small delay to avoid hammering the proxy
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n── Summary ──────────────────────────────────────────────────');
  console.log(`Passed:  ${passed}`);
  console.log(`Diffs:   ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total:   ${targets.length}`);

  // ── Write report ─────────────────────────────────────────────────────────────
  const reportPath = new URL('./validation-report.json', import.meta.url).pathname.replace(/^\//, '');
  writeFileSync(reportPath, JSON.stringify({ packId: packArg, results }, null, 2), 'utf8');
  console.log(`\nFull report written to ${reportPath}`);

} catch (err) {
  console.error('\nFatal error:', err.message);
  process.exit(1);
} finally {
  await client.disconnect();
}
