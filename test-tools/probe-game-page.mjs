/**
 * Fetches the Foundry /game page after login and prints the first 3000 chars.
 * Used to locate where Foundry v14 puts the socket sessionId.
 */
import './env.mjs';

const FOUNDRY_URL = process.env.FOUNDRY_URL;
const USER_ID     = process.env.FOUNDRY_USER;
const PASSWORD    = process.env.FOUNDRY_PASS;

const init = await fetch(`${FOUNDRY_URL}/join`);
const cookie = init.headers.get('set-cookie').split(';')[0].trim();

await fetch(`${FOUNDRY_URL}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ userid: USER_ID, password: PASSWORD, action: 'join' }),
  redirect: 'manual',
});

const gamePage = await fetch(`${FOUNDRY_URL}/game`, { headers: { Cookie: cookie } });
console.log('Status:', gamePage.status);
const html = await gamePage.text();
console.log('\n--- First 3000 chars ---');
console.log(html.slice(0, 3000));
console.log('\n--- sessionId occurrences ---');
const matches = [...html.matchAll(/session[Ii][dD][^"']{0,5}["': ]+([a-zA-Z0-9_-]{16,})/g)];
matches.forEach(m => console.log(' ', m[0].slice(0, 80)));
