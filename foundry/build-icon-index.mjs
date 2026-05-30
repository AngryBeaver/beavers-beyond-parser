#!/usr/bin/env node
// build-icon-index.mjs — scan a Foundry VTT icons directory and write vtt14-icons.json
// Usage: node build-icon-index.mjs [--source <path>]
//   --source <path>  skip the prompt and use this path directly
//   Output: vtt14-icons.json (sibling of this file)

import { readdirSync, writeFileSync, existsSync } from 'fs';
import { join, relative, sep, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALID_EXTS = new Set(['.webp', '.png']);

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

function detectVersion(iconPath) {
  const m = iconPath.replace(/\\/g, '/').match(/\/v(\d+)\./i);
  return m ? parseInt(m[1], 10) : null;
}

async function getArgs() {
  const sourceArgIdx = process.argv.indexOf('--source');
  const versionArgIdx = process.argv.indexOf('--version');
  if (sourceArgIdx >= 0 && versionArgIdx >= 0) {
    return {
      iconsRoot: process.argv[sourceArgIdx + 1],
      major: parseInt(process.argv[versionArgIdx + 1], 10),
    };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const iconsRoot = sourceArgIdx >= 0
    ? process.argv[sourceArgIdx + 1]
    : await ask(rl, 'Path to Foundry VTT icons directory\n  (e.g. C:\\foundry\\Data\\systems\\dnd5e\\icons): ');

  const detected = detectVersion(iconsRoot);
  const versionPrompt = detected
    ? `Foundry major version [detected: ${detected}, press Enter to confirm]: `
    : 'Foundry major version (e.g. 14): ';
  const versionAnswer = await ask(rl, versionPrompt);
  rl.close();

  const major = versionAnswer ? parseInt(versionAnswer, 10) : detected;
  return { iconsRoot, major };
}

const { iconsRoot: ICONS_ROOT, major: MAJOR } = await getArgs();

if (!MAJOR || isNaN(MAJOR)) {
  console.error('Could not determine Foundry major version.');
  process.exit(1);
}

if (!ICONS_ROOT) {
  console.error('No path provided.');
  process.exit(1);
}

if (!existsSync(ICONS_ROOT)) {
  console.error(`Icons source not found: ${ICONS_ROOT}`);
  process.exit(1);
}

const OUTPUT = join(__dirname, `vtt${MAJOR}-icons.json`);

function collect(dir, results) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, results);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      const dot = lower.lastIndexOf('.');
      if (dot >= 0 && VALID_EXTS.has(lower.slice(dot))) {
        // Store path relative to ICONS_ROOT with forward slashes
        results.push(relative(ICONS_ROOT, full).replaceAll(sep, '/'));
      }
    }
  }
}

const paths = [];
collect(ICONS_ROOT, paths);
paths.sort();

writeFileSync(OUTPUT, JSON.stringify(paths, null, 0), 'utf8');
console.log(`[icon-index] ${paths.length} icons → ${OUTPUT}`);