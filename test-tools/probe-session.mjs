import './env.mjs';
import pkg from './node_modules/beavers-voice-transcript-client/node_modules/socket.io-client/dist/socket.io.esm.min.js';
const { io } = pkg;

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
console.log('Session ID:', sessionId);

const socket = io(FOUNDRY_URL, {
  path: '/socket.io',
  transports: ['websocket'],
  upgrade: false,
  query: { session: sessionId },
  withCredentials: false,
});

socket.on('connect', () => console.log('Connected, socket.id:', socket.id));
socket.on('connect_error', e => { console.log('Connect error:', e.message); process.exit(1); });
socket.onAny((event, ...args) => {
  console.log(`← event: "${event}"`, JSON.stringify(args).slice(0, 300));
});

setTimeout(() => { socket.disconnect(); process.exit(0); }, 8000);
