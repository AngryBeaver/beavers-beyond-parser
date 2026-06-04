import './env.mjs';

const PROXY = process.env.PROXY_URL;
const URL = 'https://www.dndbeyond.com/monsters/16778-ancient-bronze-dragon';

const html = await fetch(`${PROXY}/fetch?url=${encodeURIComponent(URL)}`).then(r => r.text());

// Dump the full actions description block
const actionIdx = html.indexOf('description-block-heading">Actions');
if (actionIdx < 0) { console.log('Actions heading NOT FOUND'); process.exit(1); }
console.log(html.slice(actionIdx, actionIdx + 3000));
