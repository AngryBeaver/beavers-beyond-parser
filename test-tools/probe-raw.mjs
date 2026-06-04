/**
 * Raw Foundry socket probe — logs every event Foundry sends on connect.
 * Use this to debug auth issues / inspect the session event format.
 *
 * Usage:
 *   node probe-raw.mjs
 */

import './env.mjs';
import { io } from 'socket.io-client';

const FOUNDRY_URL = process.env.FOUNDRY_URL;
const USER_ID     = process.env.FOUNDRY_USER;
const PASSWORD    = process.env.FOUNDRY_PASS;

// Step 1 — get initial session cookie
const init = await fetch(`${FOUNDRY_URL}/join`);
const initCookie = init.headers.get('set-cookie').split(';')[0].trim();
console.log('Init cookie:', initCookie);

// Step 2 — login
const loginRes = await fetch(`${FOUNDRY_URL}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: initCookie },
  body: JSON.stringify({ userid: USER_ID, password: PASSWORD, action: 'join' }),
  redirect: 'manual',
});
const loginBody = await loginRes.json().catch(() => ({}));
console.log('Login:', loginRes.status, JSON.stringify(loginBody));

// Step 3 — get cookie + sessionId to use for socket
const setCookie = loginRes.headers.get('set-cookie');
const cookie    = setCookie ? setCookie.split(';')[0].trim() : initCookie;
const sessionId = cookie.split('=')[1];
console.log('Session ID for socket:', sessionId);

// Step 4 — fetch /game page to see if there is a different sessionId in the page data
const gamePage = await fetch(`${FOUNDRY_URL}/game`, { headers: { Cookie: cookie } });
const gameHtml = await gamePage.text();
const pageSessionMatch = gameHtml.match(/"sessionId"\s*:\s*"([^"]+)"/);
const pageSession = pageSessionMatch?.[1];
console.log('/game page sessionId:', pageSession ?? 'not found in page');
console.log('/game status:', gamePage.status);

const socketSession = pageSession ?? sessionId;
console.log('\nConnecting socket with session:', socketSession, '\n');

// Step 5 — raw socket.io connect
const socket = io(FOUNDRY_URL, {
  path: '/socket.io',
  transports: ['websocket'],
  upgrade: false,
  query: { session: socketSession },
  withCredentials: false,
});

socket.on('connect', () => console.log('✓ Socket connected, id:', socket.id));
socket.on('connect_error', e => { console.log('✗ Connect error:', e.message); process.exit(1); });
socket.onAny((event, ...args) => {
  console.log(`← "${event}":`, JSON.stringify(args).slice(0, 400));
});

setTimeout(() => {
  console.log('\nTimeout — disconnecting');
  socket.disconnect();
  process.exit(0);
}, 6000);
