/**
 * Try socket auth with Cookie header via extraHeaders instead of query param.
 * Foundry v14 may look at the HTTP cookie rather than ?session= query param.
 */
import './env.mjs';
import { io } from 'socket.io-client';

const FOUNDRY_URL = process.env.FOUNDRY_URL;
const USER_ID     = process.env.FOUNDRY_USER;
const PASSWORD    = process.env.FOUNDRY_PASS;

const init = await fetch(`${FOUNDRY_URL}/join`);
const initCookie = init.headers.get('set-cookie').split(';')[0].trim();

const loginRes = await fetch(`${FOUNDRY_URL}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: initCookie },
  body: JSON.stringify({ userid: USER_ID, password: PASSWORD, action: 'join' }),
  redirect: 'manual',
});
const loginBody = await loginRes.json().catch(() => ({}));
console.log('Login:', loginRes.status, JSON.stringify(loginBody));

const setCookie = loginRes.headers.get('set-cookie');
const cookie = setCookie ? setCookie.split(';')[0].trim() : initCookie;
const sessionId = cookie.split('=')[1];
console.log('Cookie:', cookie);
console.log('Session ID:', sessionId);

function tryConnect(label, opts) {
  return new Promise((resolve) => {
    console.log(`\n--- ${label} ---`);
    const socket = io(FOUNDRY_URL, {
      path: '/socket.io',
      transports: opts.transports ?? ['websocket'],
      upgrade: false,
      ...opts,
    });
    socket.on('connect', () => console.log('✓ connected id:', socket.id));
    socket.on('connect_error', e => console.log('✗ error:', e.message));
    socket.onAny((ev, ...args) => {
      console.log(`← "${ev}":`, JSON.stringify(args).slice(0, 300));
      if (ev === 'session') { setTimeout(() => { socket.disconnect(); resolve(); }, 500); }
    });
    setTimeout(() => { socket.disconnect(); resolve(); }, 4000);
  });
}

// Attempt 1: query param only (baseline)
await tryConnect('query param only', { query: { session: sessionId } });

// Attempt 2: Cookie in extraHeaders only
await tryConnect('extraHeaders Cookie only', { extraHeaders: { Cookie: cookie } });

// Attempt 3: Both query param AND cookie header
await tryConnect('query + extraHeaders', {
  query: { session: sessionId },
  extraHeaders: { Cookie: cookie },
});

// Attempt 4: Polling transport with cookie header
await tryConnect('polling + cookie header', {
  transports: ['polling'],
  extraHeaders: { Cookie: cookie },
});

// Attempt 5: Polling + query param
await tryConnect('polling + query param', {
  transports: ['polling'],
  query: { session: sessionId },
});

process.exit(0);
