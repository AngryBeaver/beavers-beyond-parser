/**
 * Probe Foundry auth endpoints to understand the v14 session flow.
 */
import './env.mjs';

const FOUNDRY_URL = process.env.FOUNDRY_URL;
const USER_ID     = process.env.FOUNDRY_USER;
const PASSWORD    = process.env.FOUNDRY_PASS;

async function tryEndpoint(url, cookie, method = 'GET', body = null) {
  const opts = { method, headers: { Cookie: cookie } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const text = await r.text();
  console.log(`${method} ${url} → ${r.status}:`, text.slice(0, 200));
  return { status: r.status, text };
}

const init = await fetch(`${FOUNDRY_URL}/join`);
const cookie = init.headers.get('set-cookie').split(';')[0].trim();

const loginRes = await fetch(`${FOUNDRY_URL}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ userid: USER_ID, password: PASSWORD, action: 'join' }),
  redirect: 'manual',
});
const setCookie = loginRes.headers.get('set-cookie');
const authCookie = setCookie ? setCookie.split(';')[0].trim() : cookie;
console.log('Auth cookie:', authCookie, '\n');

// Try various API endpoints
await tryEndpoint(`${FOUNDRY_URL}/api/status`, authCookie);
await tryEndpoint(`${FOUNDRY_URL}/api/setup`, authCookie);
await tryEndpoint(`${FOUNDRY_URL}/api/users`, authCookie);
await tryEndpoint(`${FOUNDRY_URL}/api/game`, authCookie);

// Check what users exist — GET /join shows user list
const joinHtml = (await tryEndpoint(`${FOUNDRY_URL}/join`, authCookie)).text;
const userMatches = [...joinHtml.matchAll(/data-user-id="([^"]+)"[^>]*>([^<]+)</g)];
console.log('\nUsers on /join page:', userMatches.map(m => `${m[2]} (${m[1]})`));
