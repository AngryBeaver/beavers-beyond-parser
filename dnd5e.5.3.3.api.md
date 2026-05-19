# dnd5e 5.3.3 API Reference (Foundry VTT v14)

Gathered from: `C:\vtts\v14.361\Data\systems\dnd5e\dnd5e.mjs`

---

## NPC Actor System Data

### HP
```js
system.attributes.hp = { value, min, max, formula }
```

### Armor Class
```js
system.attributes.ac = { flat: 13, calc: "flat" }
// calc must be "flat" to override; default is "default" (uses equipped armor)
```

### Movement
```js
system.attributes.movement = {
  walk: 30,   // number or formula string
  fly: 40,
  swim: 0,
  burrow: 0,
  climb: 0,
  units: "ft",
  hover: false,
  special: "",
}
```

### Senses
```js
// NOTE: in dnd5e 5.3+, senses moved from senses.darkvision → senses.ranges.darkvision
system.attributes.senses = {
  ranges: {
    darkvision: 60,    // number (ft)
    blindsight: 0,
    tremorsense: 0,
    truesight: 0,
  },
  units: "ft",
  special: "blind beyond this radius",  // free-text remainder
}
```
Compatibility shim: `senses.darkvision` still works but logs a deprecation warning.

### Abilities
```js
system.abilities = {
  str: { value: 10 },
  dex: { value: 10 },
  con: { value: 10 },
  int: { value: 10 },
  wis: { value: 10 },
  cha: { value: 10 },
}
```

### Skills
```js
system.skills = {
  acr: { value: 1, ability: "dex" },  // value: 0=none, 0.5=half, 1=prof, 2=expertise
  // ... one entry per proficient skill
}
```
Key → ability mapping:
| Key | Skill            | Ability |
|-----|-----------------|---------|
| acr | Acrobatics      | dex     |
| ani | Animal Handling | wis     |
| arc | Arcana          | int     |
| ath | Athletics       | str     |
| dec | Deception       | cha     |
| his | History         | int     |
| ins | Insight         | wis     |
| itm | Intimidation    | cha     |
| inv | Investigation   | int     |
| med | Medicine        | wis     |
| nat | Nature          | int     |
| prc | Perception      | wis     |
| prf | Performance     | cha     |
| per | Persuasion      | cha     |
| rel | Religion        | int     |
| slt | Sleight of Hand | dex     |
| ste | Stealth         | dex     |
| sur | Survival        | wis     |

### Details
```js
system.details = {
  cr: 1,              // number (0.125, 0.25, 0.5, 1, 2, ...)
  biography: { value: "<html>" },
  type: { value: "undead", subtype: "", swarm: "", custom: "" },
}
```

### Traits
```js
system.traits = {
  size: "med",   // tiny | sm | med | lg | huge | grg
  di: { value: ["fire", "poison"],  custom: "",  bypasses: ["mgc"] },  // damage immunities
  dr: { value: ["cold"],            custom: "",  bypasses: ["sil"] },  // damage resistances
  dv: { value: ["fire"],            custom: "" },                       // damage vulnerabilities
  ci: { value: ["charmed", "exhaustion"], custom: "" },                 // condition immunities
  languages: { value: ["common", "infernal"], custom: "" },
}
```

`bypasses` values: `"mgc"` (magical), `"sil"` (silvered), `"ada"` (adamantine).

DamageTraitField: `{ value: Set<string>, custom: string, bypasses: Set<string> }`
SimpleTraitField: `{ value: Set<string>, custom: string }`
When creating via API, pass arrays; Foundry converts to Sets.

---

## Damage Type Keys (`CONFIG.DND5E.damageTypes`)
`acid`, `bludgeoning`, `cold`, `fire`, `force`, `lightning`, `necrotic`,
`piercing`, `poison`, `psychic`, `radiant`, `slashing`, `thunder`

Physical types (have `isPhysical: true`): `bludgeoning`, `piercing`, `slashing`

---

## Condition Keys (`CONFIG.DND5E.conditionTypes`)
`blinded`, `charmed`, `deafened`, `diseased`, `exhaustion`, `frightened`,
`grappled`, `incapacitated`, `invisible`, `paralyzed`, `petrified`, `poisoned`,
`prone`, `restrained`, `stunned`, `unconscious`

Pseudo-conditions (not real immunities): `bleeding`, `burning`, `cursed`,
`dehydration`, `falling`, `malnutrition`, `silenced`, `suffocation`, `surprised`,
`transformed`

---

## Language Keys (`CONFIG.DND5E.languages`)
Standard: `common`, `draconic`, `dwarvish`, `elvish`, `giant`, `gnomish`,
`goblin`, `halfling`, `orc`, `sign` (Common Sign Language)

Exotic: `aarakocra`, `abyssal`, `cant` (Thieves' Cant), `celestial`,
`deep` (Deep Speech), `druidic`, `gith`, `gnoll`, `infernal`, `sylvan`, `undercommon`

Primordial children: `aquan`, `auran`, `ignan`, `terran`

---

## Items (dnd5e v4 Activities System)

Both `weapon` and `feat` item types use `ActivitiesTemplate`.
Activities live in `system.activities` as a MappingField keyed by random IDs.

### Weapon Item
```js
{
  name: "Book Club",
  type: "weapon",
  system: {
    description: { value: "<p>HTML</p>" },
    equipped: true,
    proficient: null,
    type: { value: "natural" },   // simpleM | simpleR | martialM | martialR | natural
    damage: {
      base: {
        custom: { enabled: true, formula: "2d4 + 1" },
        types: ["bludgeoning"],
      },
      versatile: {}
    },
    range: {
      reach: 5,     // melee reach in ft
      value: null,  // ranged normal range
      long: null,   // ranged long range
      units: "ft",
    },
    activities: {
      [foundry.utils.randomID()]: {
        type: "attack",
        activation: { type: "action", value: 1 },
        attack: {
          bonus: "3",   // total attack modifier from stat block
          flat: true,   // true = use bonus as the ENTIRE modifier (no ability/prof added)
          type: {
            value: "melee",    // "melee" | "ranged"
            classification: "weapon",  // "weapon" | "spell" | "unarmed"
          },
        },
        damage: {
          includeBase: true,  // include weapon's base damage
          parts: [],          // additional damage parts
        },
      },
    },
  },
}
```

`attack.flat: true` source: line 28214 — `if ( this.attack.flat ) return CONFIG.Dice.BasicRoll.constructParts({ toHit: this.attack.bonus }, rollData);`
This means only the bonus value is used, proficiency and ability mod are NOT added.

### DamageData (for `damage.base` and activity `damage.parts[]`)
```js
{
  number: 2,           // number of dice (mutually exclusive with custom.enabled)
  denomination: 4,     // die size
  bonus: "1",          // flat bonus formula
  types: ["bludgeoning"],
  custom: { enabled: true, formula: "2d4 + 1" },  // use formula string instead
  scaling: { mode: "", number: 1, formula: "" }
}
```

### Feat Item (Trait or Action)
```js
{
  name: "Invisibility",
  type: "feat",
  system: {
    description: { value: "<p>HTML</p>" },
    // activities omitted → passive trait
    activities: {
      [foundry.utils.randomID()]: {
        type: "utility",
        activation: { type: "action", value: 1 },
      },
    },
  },
}
```

### Activation Types
`action`, `bonus` (bonus action), `reaction`, `legendary`, `lair`,
`minute`, `hour`, `day`, `special`, `none`

---

## Proficiency Bonus
Auto-calculated from CR — do not set manually.
`profBonus` in stat block (e.g. "+2") is informational only.

---

## Key Class References
- `NPCData` (line 72978) extends `CreatureTemplate` (line 71590)
- `TraitsField` (line 26740): `common` = di/dr/dv/ci/size; `creature` = languages
- `AttributesFields` (line 25775): `common` = ac/init/movement; `creature` = senses/exhaustion
- `MovementField` (line 25607): walk/burrow/climb/fly/swim as FormulaFields
- `SensesField` (line 25693): `ranges` MappingField keyed by `CONFIG.DND5E.senses`
- `DamageTraitField` (line 26721) extends `SimpleTraitField` (line 26704) — adds `bypasses`
- `WeaponData` (line 76553): damage.base + range + type + activities
- `FeatData` (line 75440): prerequisites + properties + type + activities
- `BaseActivityData` (line 11825): _id/type/name/activation/damage/range/target/uses
- `BaseAttackActivityData` (line 27973): attack.ability/bonus/flat/type + damage.parts
- `AttackActivity` (line 28382): type="attack", actionType computed from attack.type.value/classification
- `ActivationField` (line 11153): type/value/condition; default type="action"

---

## Spell Items

### SpellData Schema (line 21911)
```js
{
  name: "Fireball",
  type: "spell",
  folder: folderId,   // null for actor-embedded spells
  system: {
    level: 3,                   // 0 = cantrip, 1–9 = spell level
    school: "evo",              // see Spell Schools below
    method: "innate",           // see Preparation Methods below
    description: { value: "<p>HTML</p>" },
    activation: { type: "action", value: 1 },
    properties: ["vocal", "somatic", "material"],  // spell components
    uses: {                     // omit entirely for at-will; UsesField (line 11510)
      max: "3",                 // string formula
      spent: 0,
      recovery: [{ period: "day", type: "recoverAll" }],
    },
    // Spell attack activity (same Activities system as weapons):
    activities: {
      [foundry.utils.randomID()]: {
        type: "attack",
        activation: { type: "action", value: 1 },
        attack: {
          bonus: "6",
          flat: true,
          type: { value: "melee", classification: "spell" },
        },
        damage: { includeBase: true, parts: [] },
      },
    },
  },
}
```

### Preparation Methods (`CONFIG.DND5E.spellcasting`)
| Key       | Meaning                              |
|-----------|--------------------------------------|
| `atwill`  | At-will cantrip / innate at-will     |
| `innate`  | Innate spellcasting (N/day limits)   |
| `ritual`  | Ritual-only casting                  |
| `pact`    | Pact magic (Warlock)                 |
| `spell`   | Prepared/known spell list            |

### Spell Schools
| Key   | School        |
|-------|---------------|
| `abj` | Abjuration    |
| `con` | Conjuration   |
| `div` | Divination    |
| `enc` | Enchantment   |
| `evo` | Evocation     |
| `ill` | Illusion      |
| `nec` | Necromancy    |
| `trs` | Transmutation |

### UsesField Recovery Periods (`CONFIG.DND5E.limitedUsePeriods`)
`lr` (long rest), `sr` (short rest), `day`, `dawn`, `dusk`, `turn`, `turnStart`, `turnEnd`

### Spell Components (properties array)
`"vocal"`, `"somatic"`, `"material"`

### Compendium Lookup Pattern
```typescript
// Preferred: search known spell packs by name
const PRIORITY_PACKS = ['dnd5e.spells', 'dnd-players-handbook.spells'];

for (const packId of PRIORITY_PACKS) {
  const pack = game.packs.get(packId);
  if (!pack) continue;
  const index = await pack.getIndex();
  const entry = index.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (entry) {
    const doc = await pack.getDocument(entry._id);
    if (doc.type === 'spell') return doc.toObject();
  }
}
```

### At-Will vs N/day Usage Override
When cloning a compendium spell for actor embedding:
```typescript
const cloned = foundry.utils.deepClone(spellData);
delete cloned._id;
cloned.system.method = 'atwill';             // or 'innate'
cloned.system.uses = { max: null, spent: 0, recovery: [] };  // at-will: clear uses
// OR for N/day:
cloned.system.uses = {
  max: "3",
  spent: 0,
  recovery: [{ period: "day", type: "recoverAll" }],
};
```

### World Item Folder Creation
Create a folder hierarchy in Items directory for non-compendium spells:
```typescript
// "CampaignName > Spells" folder path
const parent = game.folders.find(f => f.type === 'Item' && f.name === campaignName && !f.folder)
  ?? await Folder.create({ name: campaignName, type: 'Item' });
const spellFolder = game.folders.find(f => f.type === 'Item' && f.name === 'Spells' && f.folder?.id === parent.id)
  ?? await Folder.create({ name: 'Spells', type: 'Item', folder: parent.id });
```

### Spell Attack Classification
For weapon items that are spell attacks (cantrips like Shocking Grasp):
```js
attack: {
  bonus: "6",
  flat: true,
  type: { value: "melee", classification: "spell" },   // "spell" not "weapon"
}
```

---

## Full SpellData Schema (line 21911) — all top-level fields

```js
{
  name: "Fireball",
  type: "spell",
  img: "https://…/fireball.png",   // spell image URL
  folder: folderId,
  system: {
    level: 3,                    // 0=cantrip, 1–9
    school: "evo",               // see Spell Schools above
    method: "",                  // preparation method key (empty for world items)
    description: { value: "<p>HTML</p>" },

    // ActivationField (line 11153): type + value + condition
    activation: { type: "action", value: 1 },
    // type keys: "action" | "bonus" | "reaction" | "minute" | "hour" | "day" | "special" | "none"
    // scalar types (minute/hour/day) accept numeric value; reaction/bonus/action: value=1

    // RangeField (line 11288): value (formula, nullable) + units + special
    range: { value: "60", units: "ft" },
    // units: "ft" | "mi" | "m" | "km" | "self" | "touch" | "spec" | "any"
    // value is null for self/touch/spec; string formula for numeric ranges

    // DurationField (line 11216): value (formula, nullable) + units + special
    duration: { value: "1", units: "minute" },
    // units: "inst" | "round" | "minute" | "hour" | "day" | "week" | "month" | "year" | "disp" | "dstr" | "perm" | "spec"
    // value is null for inst/disp/dstr/perm/spec; numeric string for scalar units

    // SchemaField: materials
    materials: {
      value: "a tiny ball of bat guano and sulfur",  // material component description
      consumed: false,
      cost: 0,
      supply: 0,
    },

    // SetField<StringField>: spell properties
    properties: ["vocal", "somatic", "material", "concentration", "ritual"],
    // valid keys: "vocal" | "somatic" | "material" | "concentration" | "ritual"
    // pass as array on creation; stored as Set<string>

    // TargetField (line 11344)
    target: {
      template: {
        type: "cone",    // area target type key (see Area Target Types below)
        size: "15",      // formula string (ft radius/length/etc.)
        width: "",
        height: "",
        units: "ft",
      },
      affects: {
        count: "1",      // formula string — number of creatures affected
        type: "creature",  // individual target type key (see below)
        choice: false,
        special: "",
      },
    },

    // Activities (same system as weapons/feats)
    activities: { [id]: { … } },

    // UsesField — for innate/limited spells embedded in actors
    uses: { max: "3", spent: 0, recovery: [{ period: "day", type: "recoverAll" }] },
  },
}
```

### Save Activity (BaseSaveActivityData line 31224)
```js
{
  type: "save",
  activation: { type: "action", value: 1 },
  save: {
    ability: ["dex"],     // SetField → pass array; ability abbreviation
    dc: {
      calculation: "spellcasting",  // "spellcasting" | "flat" | ability key
      formula: "",
    },
  },
  damage: {
    parts: [{ number: 8, denomination: 6, bonus: "", types: ["fire"] }],
    onSave: "half",   // "half" | "none" | "full"
  },
}
```

### Area Target Types (`CONFIG.DND5E.areaTargetTypes`, line 46327)
| Key        | Template Shape | Measured Dimensions  |
|------------|---------------|----------------------|
| `circle`   | circle        | radius               |
| `cone`     | cone          | length               |
| `cube`     | rect          | width                |
| `cylinder` | circle        | radius + height      |
| `line`     | ray           | length + width       |
| `radius`   | circle        | (emanation)          |
| `sphere`   | circle        | radius               |
| `square`   | rect          | width                |
| `wall`     | ray           | length + thickness + height |

### Individual Target Types (`CONFIG.DND5E.individualTargetTypes`, line 46281)
`self`, `ally`, `enemy`, `creature`, `object`, `space`, `creatureOrObject`, `any`, `willing`

### Range/Distance Unit Keys (`CONFIG.DND5E.distanceUnits`, line 46143)
Movement: `ft`, `mi`, `m`, `km`
Special: `self`, `touch`, `spec`, `any`

### Duration Unit Keys
Scalar (accept numeric value): `round`, `minute`, `hour`, `day`, `week`, `month`, `year`
Non-scalar: `inst` (instantaneous), `disp` (until dispelled), `dstr` (until triggered), `perm` (permanent), `spec` (special)

### Key Additional References
- `SpellData.defineSchema` (line 21925): full field list
- `ActivationField` (line 11153): type/value/condition
- `DurationField` (line 11216): value formula + units; concentration derived from `properties.has("concentration")`
- `RangeField` (line 11288): value formula + units + special
- `TargetField` (line 11344): template (area) + affects (count/type)
- `BaseSaveActivityData` (line 31224): save.ability (Set) + save.dc + damage.parts + damage.onSave
- `BaseAttackActivityData` (line 27973): attack.ability/bonus/flat/type + damage.parts
