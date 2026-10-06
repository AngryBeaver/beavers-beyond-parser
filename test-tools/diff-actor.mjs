/**
 * Compare two actor JSON files and print their differences.
 *
 * Usage:
 *   node diff-actor.mjs preview.json reference.json
 *
 * Both files should be actor.toObject() JSON as returned by the socket API.
 */

import { readFileSync } from 'fs';

const [, , previewPath, referencePath] = process.argv;
if (!previewPath || !referencePath) {
  console.error('Usage: node diff-actor.mjs preview.json reference.json');
  process.exit(1);
}

const preview   = JSON.parse(readFileSync(previewPath,   'utf8'));
const reference = JSON.parse(readFileSync(referencePath, 'utf8'));

// dnd5e 6.0 stores speeds in movement.speeds, older versions directly on movement.
function speed(sys, type) {
  const movement = sys?.attributes?.movement;
  return movement?.speeds?.[type] ?? movement?.[type] ?? 0;
}

function setDiff(a, b) {
  const sa = new Set(Array.isArray(a) ? a : []);
  const sb = new Set(Array.isArray(b) ? b : []);
  return {
    missing: [...sb].filter(x => !sa.has(x)),
    extra:   [...sa].filter(x => !sb.has(x)),
  };
}

function firstActivityAttackBonus(item) {
  const acts = item?.system?.activities ?? {};
  for (const act of Object.values(acts)) {
    if (act?.attack?.bonus !== undefined) return act.attack.bonus;
  }
  return null;
}

const diffs = [];
const pSys = preview?.system   ?? {};
const rSys = reference?.system ?? {};

for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
  const p = pSys?.abilities?.[ab]?.value;
  const r = rSys?.abilities?.[ab]?.value;
  if (p !== r) diffs.push({ field: `abilities.${ab}`, parsed: p, reference: r });
}

const checks = [
  ['hp',    pSys?.attributes?.hp?.value,    rSys?.attributes?.hp?.value],
  ['ac',    pSys?.attributes?.ac?.flat,     rSys?.attributes?.ac?.flat],
  ['cr',    pSys?.details?.cr,              rSys?.details?.cr],
];
for (const [field, p, r] of checks) {
  if (p !== r) diffs.push({ field, parsed: p, reference: r });
}

for (const mv of ['walk', 'fly', 'swim', 'burrow', 'climb']) {
  const p = Number(speed(pSys, mv));
  const r = Number(speed(rSys, mv));
  if (p !== r) diffs.push({ field: `movement.${mv}`, parsed: p, reference: r });
}

for (const s of ['darkvision', 'blindsight', 'tremorsense', 'truesight']) {
  const p = pSys?.attributes?.senses?.ranges?.[s] ?? 0;
  const r = rSys?.attributes?.senses?.ranges?.[s] ?? 0;
  if (p !== r) diffs.push({ field: `senses.${s}`, parsed: p, reference: r });
}

for (const trait of ['di', 'dr', 'dv', 'ci']) {
  const { missing, extra } = setDiff(pSys?.traits?.[trait]?.value, rSys?.traits?.[trait]?.value);
  if (missing.length) diffs.push({ field: `traits.${trait}.missing`, parsed: null, reference: missing });
  if (extra.length)   diffs.push({ field: `traits.${trait}.extra`,   parsed: extra,  reference: null });
}

const { missing: lm, extra: le } = setDiff(pSys?.traits?.languages?.value, rSys?.traits?.languages?.value);
if (lm.length) diffs.push({ field: 'languages.missing', parsed: null, reference: lm });
if (le.length) diffs.push({ field: 'languages.extra',   parsed: le,   reference: null });

const pItems = (preview?.items  ?? []).map(i => i.name).sort();
const rItems = (reference?.items ?? []).map(i => i.name).sort();
const { missing: im, extra: ie } = setDiff(pItems, rItems);
if (im.length) diffs.push({ field: 'items.missing', parsed: null, reference: im });
if (ie.length) diffs.push({ field: 'items.extra',   parsed: ie,   reference: null });

for (const rw of (reference?.items ?? []).filter(i => i.type === 'weapon')) {
  const pw = (preview?.items ?? []).find(w => w.name === rw.name);
  if (!pw) continue;
  const rBonus = firstActivityAttackBonus(rw);
  const pBonus = firstActivityAttackBonus(pw);
  if (rBonus !== null && pBonus !== null && rBonus !== pBonus) {
    diffs.push({ field: `weapon[${rw.name}].attackBonus`, parsed: pBonus, reference: rBonus });
  }
}

if (diffs.length === 0) {
  console.log('No differences found.');
} else {
  console.log(`${diffs.length} difference(s):\n`);
  for (const d of diffs) {
    console.log(`  ${d.field}`);
    if (d.parsed    !== null) console.log(`    parsed:    ${JSON.stringify(d.parsed)}`);
    if (d.reference !== null) console.log(`    reference: ${JSON.stringify(d.reference)}`);
  }
}
