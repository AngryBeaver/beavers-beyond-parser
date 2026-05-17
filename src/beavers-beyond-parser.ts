import { NAMESPACE, SETTINGS } from './definitions.js';
import { ImportAdventureWindow } from './apps/ImportAdventureWindow.js';

Hooks.once('init', () => {
  game.settings.register(NAMESPACE, SETTINGS.COBALT_TOKEN, {
    name: 'D&D Beyond cobalt-token',
    hint: 'Open D&D Beyond in your browser → DevTools (F12) → Application → Cookies → dndbeyond.com → copy the cobalt-token value.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });
});

Hooks.once('ready', () => {
  console.log(`${NAMESPACE} | Ready`);
});

Hooks.on(
  'getSceneControlButtons',
  (controls: Record<string, foundry.applications.ui.SceneControls.Control>) => {
    if (!game.user.isGM) return;
    const tokenLayer = controls['tokens'];
    if (!tokenLayer) return;
    tokenLayer.tools['beyond-parser'] = {
      name: 'beyond-parser',
      order: 98,
      title: "Beaver's Beyond Parser — Import Adventure",
      icon: 'fas fa-book-open',
      button: true,
      visible: true,
      onChange: () => ImportAdventureWindow.open(),
    };
  },
);
