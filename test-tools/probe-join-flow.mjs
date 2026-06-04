/**
 * Probe the full Foundry join flow — follow all redirects and cookies,
 * then try socket with the final session. Also check the /join page HTML
 * to see the login form action and how the browser actually submits it.
 */
import './env.mjs';
import { io } from 'socket.io-client';

const FOUNDRY_URL = process.env.FOUNDRY_URL;
const USER_ID     = process.env.FOUNDRY_USER;
const PASSWORD    = process.env.FOUNDRY_PASS;

// Step 1: GET /join — capture initial cookie and inspect form
const init = await fetch(`${FOUNDRY_URL}/join`);
const initCookie = init.headers.get('set-cookie')?.split(';')[0] ?? '';
const joinHtml = await init.text();
// Find the form action and any hidden fields
const formAction = joinHtml.match(/<form[^>]*action="([^"]+)"/)?.[1] ?? '/join';
const hiddenFields = [...joinHtml.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)]
  .map(m => `${m[1]}=${m[2]}`);
console.log('Form action:', formAction);
console.log('Hidden fields:', hiddenFields);
console.log('Init cookie:', initCookie);

// Step 2: POST login — follow redirects manually
console.log('\n--- Login POST ---');
const loginRes = await fetch(`${FOUNDRY_URL}${formAction}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: initCookie },
  body: JSON.stringify({ userid: USER_ID, password: PASSWORD, action: 'join' }),
  redirect: 'manual',
});
console.log('Status:', loginRes.status);
console.log('All response headers:');
for (const [k, v] of loginRes.headers) console.log(` ${k}: ${v}`);
const loginBody = await loginRes.text();
console.log('Body:', loginBody.slice(0, 200));

// Collect cookies
const setCookie = loginRes.headers.get('set-cookie');
const authCookie = setCookie ? setCookie.split(';')[0] : initCookie;
const sessionId = authCookie.split('=')[1];
console.log('\nFinal session ID:', sessionId);

// Step 3: Try to GET /game with auth cookie (follow any redirects)
console.log('\n--- GET /game ---');
const gameRes = await fetch(`${FOUNDRY_URL}/game`, {
  headers: { Cookie: authCookie },
  redirect: 'follow',
});
console.log('Status:', gameRes.status, 'URL:', gameRes.url);
console.log('Set-Cookie:', gameRes.headers.get('set-cookie'));
const newCookie = gameRes.headers.get('set-cookie')?.split(';')[0] ?? authCookie;
const finalSession = (newCookie || authCookie).split('=')[1];
console.log('Session after /game:', finalSession);

// Step 4: Socket with final session
console.log('\n--- Socket.io with session:', finalSession, '---');
const socket = io(FOUNDRY_URL, {
  path: '/socket.io',
  transports: ['websocket'],
  upgrade: false,
  query: { session: finalSession },
  withCredentials: false,
});

socket.on('connect', () => console.log('✓ Connected, id:', socket.id));
socket.on('connect_error', e => { console.log('✗ Error:', e.message); process.exit(1); });
socket.onAny((event, ...args) => console.log(`← "${event}":`, JSON.stringify(args).slice(0, 300)));

setTimeout(() => { socket.disconnect(); process.exit(0); }, 5000);
