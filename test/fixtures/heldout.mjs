// HELD-OUT syllable counts: game vocabulary and invented names.
//
// Why this file exists: syllables.mjs was written before the rules, but while
// writing the rules I traced nearly every word in it by hand and patched what
// failed. It scored 100.0 % / 99.7 % on its first run — which by then measured
// my patching, not the rules. It is a regression suite now, not a measurement.
//
// This list was written AFTER the rules, without tracing any word through them,
// and run once. The first-run score is recorded in FIRST_RUN below and in the
// README; it is the honest number. Anything fixed afterwards is a fix, and this
// list is "seen" from then on — re-measure on fresh words before quoting better.

const R = (a, b) => [a, b];

export const FIRST_RUN = { date: '2026-09-20', correct: 201, total: 203 }; // 99.0 %. Missed: soldier (3, want 2), alliance (2, want 3).
// After that run "soldier" went into the lexicon (it is a game word); "alliance" is left failing on purpose.

export const HELDOUT = {
  sword: 1, shield: 1, armor: 2, helmet: 2, potion: 2, dungeon: 2, merchant: 2, blacksmith: 2, tavern: 2,
  innkeeper: 3, soldier: 2, princess: 2, prince: 1, queen: 1, kingdom: 2, emperor: 3, empire: R(2, 3),
  battle: 2, victory: R(2, 3), defeat: 2, enemy: 3, alliance: 3, betrayal: 3, revenge: 2, justice: 2,
  freedom: 2, prisoner: R(2, 3), secret: 2, ruins: 2, temple: 2, shrine: 1, altar: 2, sacrifice: 3,
  ritual: 3, curse: 1, blessing: 2, spirit: 2, skeleton: 3, zombie: 2, vampire: R(2, 3), werewolf: 2,
  demon: 2, angel: 2, heaven: 2, underworld: 3, darkness: 2, shadow: 2, light: 1, water: 2, wind: 1,
  thunder: 2, lightning: 2, emerald: R(2, 3), ruby: 2, silver: 2, golden: 2, copper: 2, steel: 1,
  leather: 2, feather: 2, arrow: 2, quiver: 2, dagger: 2, hammer: 2, axe: 1, spear: 1, staff: 1,
  wand: 1, scroll: 1, spell: 1, enchanted: 3, forbidden: 3, legendary: 4, powerful: R(2, 3),
  terrible: 3, horrible: 3, hideous: 3, enormous: 3, tiny: 2, beast: 1, serpent: 2, spider: 2,
  scorpion: 3, wolf: 1, eagle: 2, raven: 2, owl: 1, horse: 1, stable: 2, saddle: 2, quest: 1,
  mission: 2, bounty: 2, hunter: 2, thief: 1, assassin: 3, guardian: R(2, 3), villain: 2, traitor: 2,
  traveler: R(2, 3), wanderer: 3, pilgrim: 2, hermit: 2, elder: 2, apprentice: 3, master: 2,
  student: 2, teacher: 2, lesson: 2, wisdom: 2, knowledge: 2, memory: R(2, 3), forgotten: 3, glory: 2,
  destiny: 3, prophecy: 3, chosen: 2, fate: 1, doom: 1, death: 1, life: 1, heal: 1, health: 1,
  poison: 2, antidote: 3, medicine: R(2, 3), herb: 1, flower: R(1, 2), mushroom: 2, river: 2,
  valley: 2, desert: 2, island: 2, harbor: 2, gate: 1, wall: 1, cellar: 2, attic: 2, bedroom: 2,
  market: 2, coin: 1, price: 1, expensive: 3, bargain: 2, purchase: 2, inventory: 4, equipment: 3,
  upgrade: 2, ability: 4, level: 2, damage: 2, defense: 2, attack: 2, critical: 3, status: 2,
  journal: 2, map: 1, compass: 2, north: 1, southern: 2, eastern: 2, western: 2, direction: 3,
  distance: 2, nearby: 2, faraway: 3, tonight: 2, midnight: 2, evening: R(2, 3), afternoon: 3,
  forever: 3, never: 2, sometimes: 2, usually: R(3, 4), suddenly: 3, quickly: 2, slowly: 2,
  carefully: 3, quietly: 3, alone: 2,
  // invented names, read the way a player would
  zarkoth: 2, eldrin: 2, morwen: 2, thalia: R(2, 3), aurelia: R(3, 4), bromir: 2, seraphina: 4,
  grimnar: 2, draven: 2, lysandra: 3, orin: 2, fenwick: 2, mirabel: 3, tobias: 3, caspian: 3,
  evangeline: 4, gwendolyn: 3, alaric: 3, beatrix: R(2, 3), cedric: 2, dorian: 3, elowen: 3,
  finnegan: 3,
};
