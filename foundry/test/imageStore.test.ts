import { describe, expect, it } from 'vitest';
import {
  imageBaseName,
  isImageUrl,
  monsterEntity,
  remoteUrl,
  sourceEntity,
  spellImageTarget,
} from '../src/modules/ImageStore.js';

describe('remoteUrl', () => {
  it('resolves D&D Beyond references to absolute URLs', () => {
    expect(remoteUrl('/avatars/1/2/3.png')).toBe('https://www.dndbeyond.com/avatars/1/2/3.png');
    expect(remoteUrl('//media.dndbeyond.com/a.jpg')).toBe('https://media.dndbeyond.com/a.jpg');
    expect(remoteUrl('https://media.dndbeyond.com/a.jpg')).toBe(
      'https://media.dndbeyond.com/a.jpg',
    );
  });

  it('leaves local and inline images alone', () => {
    expect(remoteUrl('beyond/monsters/16907-goblin/portrait.png')).toBeNull();
    expect(remoteUrl('icons/svg/mystery-man.svg')).toBeNull();
    expect(remoteUrl('data:image/png;base64,AAAA')).toBeNull();
  });
});

describe('monsterEntity', () => {
  it('follows the D&D Beyond id, so every version of a creature is its own entity', () => {
    expect(monsterEntity('/monsters/16907-goblin', 'Goblin')).toBe('monsters/16907-goblin');
    expect(
      monsterEntity('https://www.dndbeyond.com/monsters/5195047-goblin-warrior?x=1', 'Goblin'),
    ).toBe('monsters/5195047-goblin-warrior');
  });

  it('falls back to the name when there is no monster link', () => {
    expect(monsterEntity('', 'Young Red Dragon')).toBe('monsters/young-red-dragon');
    expect(monsterEntity('https://www.dndbeyond.com/sources/lmop/goblin-arrows', 'Klarg')).toBe(
      'monsters/klarg',
    );
  });
});

describe('sourceEntity', () => {
  it('maps both URL forms of a book to the same folder', () => {
    expect(sourceEntity('https://www.dndbeyond.com/sources/dnd/lmop', 'x')).toBe('sources/lmop');
    expect(sourceEntity('https://www.dndbeyond.com/sources/lmop/', 'x')).toBe('sources/lmop');
  });

  it('falls back to the title', () => {
    expect(sourceEntity('', 'Lost Mine of Phandelver')).toBe('sources/lost-mine-of-phandelver');
  });
});

describe('journal image names', () => {
  const a =
    'https://media.dndbeyond.com/compendium-images/lmop/M14LHJMMQhUuZ46S/map-1.1-Cragmaw-Hideout.jpg';
  const b =
    'https://media.dndbeyond.com/compendium-images/lmop/zzNEWHASHzz/map-1.1-Cragmaw-Hideout.jpg';

  it('ignore the hashed folder that changes when D&D Beyond replaces an image', () => {
    expect(imageBaseName(a)).toBe('map-1-1-cragmaw-hideout');
    expect(imageBaseName(b)).toBe(imageBaseName(a));
  });

  it('detect links to image files', () => {
    expect(isImageUrl(a)).toBe(true);
    expect(isImageUrl(`${a}?width=100`)).toBe(true);
    expect(isImageUrl('/monsters/16907-goblin')).toBe(false);
    expect(isImageUrl('/sources/lmop/goblin-arrows#map.jpg')).toBe(false);
  });
});

describe('spellImageTarget', () => {
  it('stores the shared school icon once', () => {
    const url =
      'https://www.dndbeyond.com/content/1-0-2352-0/skins/waterdeep/images/spell-schools/35/evocation.png';
    expect(spellImageTarget('Fire Bolt', url)).toEqual({
      entity: 'spells/schools',
      name: 'evocation',
    });
    expect(spellImageTarget('Fireball', url)).toEqual(spellImageTarget('Fire Bolt', url));
  });

  it('stores a spell specific image under the spell', () => {
    expect(spellImageTarget("Tasha's Hideous Laughter", '/avatars/1/2/3.png')).toEqual({
      entity: 'spells/tasha-s-hideous-laughter',
      name: 'icon',
    });
  });
});
