/**
 * Raw probe for the module.beavers-beyond-parser socket channel.
 * Logs every socket event to diagnose why previewMonsterImport times out.
 */
import './env.mjs';
import { io } from 'socket.io-client';

const FOUNDRY_URL = process.env.FOUNDRY_URL;
const USER_ID     = process.env.FOUNDRY_USER;
const PASSWORD    = process.env.FOUNDRY_PASS;
const BBP         = 'module.beavers-beyond-parser';

const init = await fetch(`${FOUNDRY_URL}/join`);
const initCookie = init.headers.get('set-cookie').split(';')[0].trim();

const loginRes = await fetch(`${FOUNDRY_URL}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: initCookie },
  body: JSON.stringify({ userid: USER_ID, password: PASSWORD, action: 'join' }),
  redirect: 'manual',
});
const cookie = loginRes.headers.get('set-cookie')?.split(';')[0].trim() ?? initCookie;

const socket = io(FOUNDRY_URL, {
  path: '/socket.io',
  transports: ['websocket'],
  upgrade: false,
  extraHeaders: { Cookie: cookie },
  withCredentials: false,
});

socket.on('connect', () => console.log('✓ Connected, id:', socket.id));
socket.on('connect_error', e => { console.error('✗ connect_error:', e.message); process.exit(1); });

// Log every single event
socket.onAny((event, ...args) => {
  console.log(`← "${event}":`, JSON.stringify(args).slice(0, 500));
});

// Wait for session event, then emit test request
socket.once('session', (sess) => {
  console.log('\nSession:', JSON.stringify(sess));
  if (!sess?.sessionId) { console.error('No session — aborting'); process.exit(1); }

  const id = crypto.randomUUID();
  console.log(`\nEmitting to ${BBP}: { id: "${id}", action: "previewMonsterImport", args: ["..."] }`);
  socket.emit(BBP, {
    id,
    action: 'previewMonsterImport',
    args: ['https://www.dndbeyond.com/monsters/16907-goblin'],
  });
  console.log('(waiting up to 15s for response…)');
});

setTimeout(() => {
  console.log('\nTimeout — no response received on', BBP);
  socket.disconnect();
  process.exit(0);
}, 15000);
