// Syllable-count ground truth, written BEFORE the letter-to-sound rules so the
// rules could not be fitted to it. Counts are mine, by ear, General American.
// A [min,max] pair means the word is honestly said both ways (syncope:
// "every", "family") and either count passes.
//
// Two lists, because they answer different questions:
//   RUNNING — dialogue-shaped sentences. Token-weighted accuracy here is what a
//             player hears: is the rhythm of the line right?
//   HARD    — words chosen because English spelling lies about them. Accuracy
//             here says how far the rules reach past the lexicon.

export const RUNNING = [
  ['Welcome to the village, stranger.', [2, 1, 1, 2, 2]],
  ['I have been waiting for you.', [1, 1, 1, 2, 1, 1]],
  ['The old bridge is broken again.', [1, 1, 1, 1, 2, 2]],
  ['Could you bring me seven apples?', [1, 1, 1, 1, 2, 2]],
  ['Thank you so much!', [1, 1, 1, 1]],
  ['Be careful out there, the forest is dangerous at night.', [1, 2, 1, 1, 1, 2, 1, 3, 1, 1]],
  ['My grandfather built this house with his own hands.', [1, 3, 1, 1, 1, 1, 1, 1, 1]],
  ['Have you seen my little brother anywhere?', [1, 1, 1, 1, 2, 2, 3]],
  ['The king wants to speak with you immediately.', [1, 1, 1, 1, 1, 1, 1, 5]],
  ['I found this strange key inside the cave.', [1, 1, 1, 1, 1, 2, 1, 1]],
  ['Nobody knows what happened to the miners.', [3, 1, 1, 2, 1, 1, 2]],
  ['Please take this letter to the captain.', [1, 1, 1, 2, 1, 1, 2]],
  ['Hmm, that is a very good question.', [1, 1, 1, 1, 2, 1, 2]],
  ['We should hurry before the storm arrives.', [1, 1, 2, 2, 1, 1, 2]],
  ['Do not touch anything in the laboratory!', [1, 1, 1, 3, 1, 1, [4, 5]]],
  ['She always sings while she works in the garden.', [1, 2, 1, 1, 1, 1, 1, 1, 2]],
  ['The monster was defeated by a brave young hero.', [1, 2, 1, 3, 1, 1, 1, 1, 2]],
  ['Your reward is three hundred gold coins.', [1, 2, 1, 1, 2, 1, 1]],
  ['I used to be an adventurer like you.', [1, 1, 1, 1, 1, 4, 1, 1]],
  ['Something smells delicious in the kitchen today.', [2, 1, 3, 1, 1, 2, 2]],
  ['They closed the gates because of the sickness.', [1, 1, 1, 1, 2, 1, 1, 2]],
  ['Are you sure about that?', [1, 1, 1, 2, 1]],
  ['Wait, I almost forgot to give you these potions.', [1, 1, 2, 2, 1, 1, 1, 1, 2]],
  ['The machine stopped working yesterday morning.', [1, 2, 1, 2, 3, 2]],
  ['Legends say a dragon sleeps beneath the mountain.', [2, 1, 1, 2, 1, 2, 1, 2]],
  ['Our people have lived here for a thousand years.', [[1, 2], 2, 1, 1, 1, 1, 1, 2, 1]],
  ['You look tired, maybe you should rest a while.', [1, 1, [1, 2], 2, 1, 1, 1, 1, 1]],
  ['The shop opens when the sun comes up.', [1, 1, 2, 1, 1, 1, 1, 1]],
  ['Nothing makes sense anymore.', [2, 1, 1, 3]],
  ['I would rather stay home and read my books.', [1, 1, 2, 1, 1, 1, 1, 1, 1]],
  ['Those pirates stole our treasure and escaped across the ocean.', [1, 2, 1, [1, 2], 2, 1, 2, 2, 1, 2]],
  ['Listen closely, this is important.', [2, 2, 1, 1, 3]],
  ['He promised he would come back someday.', [1, 2, 1, 1, 1, 1, 2]],
  ['There are too many of them!', [1, 1, 1, 2, 1, 1]],
  ['What a beautiful day for fishing.', [1, 1, 3, 1, 1, 2]],
  ['The wizard lives in a tall tower near the lake.', [1, 2, 1, 1, 1, 1, [1, 2], 1, 1, 1]],
  ['Use the purple crystal to open the ancient door.', [1, 1, 2, 2, 1, 2, 1, 2, 1]],
  ['Goodbye, and good luck on your journey.', [2, 1, 1, 1, 1, 1, 2]],
  ['My stomach hurts, I ate too much cheese.', [1, 2, 1, 1, 1, 1, 1, 1]],
  ['Everything changed after the war.', [[3, 4], 1, 2, 1, 1]],
  ["I don't know, maybe it's under the table?", [1, 1, 1, 2, 1, 2, 1, 2]],
  ["We're almost there, just a little further.", [1, 2, 1, 1, 1, 2, 2]],
  ['Bring me the head of the goblin chief.', [1, 1, 1, 1, 1, 1, 2, 1]],
  ['The elevator is out of order again.', [1, 4, 1, 1, 1, 2, 2]],
  ['Pigs are smarter than most people think.', [1, 1, 2, 1, 1, 2, 1]],
  ['Quiet! Someone is coming.', [2, 2, 1, 2]],
  ['It was a dark and stormy night.', [1, 1, 1, 1, 1, 2, 1]],
  ['Remember, the password is moonlight.', [3, 1, 2, 1, 2]],
  ['Why would anyone build a castle here?', [1, 1, 3, 1, 1, 2, 1]],
  ['Finally, some peace and quiet.', [[2, 3], 1, 1, 1, 2]],
];

const R = (a, b) => [a, b];

export const HARD = {
  // silent e before a suffix
  lately: 2, homeless: 2, careful: 2, movement: 2, statement: 2, lonely: 2, safety: 2, ninety: 2,
  useful: 2, hopeless: 2, basement: 2, lovely: 2, likely: 2, surely: 2, excitement: 3, engagement: 3,
  // -ed
  walked: 1, wanted: 2, needed: 2, played: 1, jumped: 1, created: 3, loved: 1, ended: 2, asked: 1,
  decided: 3, tried: 1, carried: 2, hundred: 2, naked: 2, wicked: 2,
  // -es
  boxes: 2, makes: 1, wishes: 2, faces: 2, pages: 2, houses: 2, loves: 1, horses: 2, times: 1,
  churches: 2, changes: 2, babies: 2, flies: 1, stories: 2, heroes: 2, goes: 1, potatoes: 3,
  // consonant + le
  table: 2, little: 2, apple: 2, people: 2, castle: 2, simple: 2, middle: 2, trouble: 2, whistle: 2,
  muscle: 2, impossible: 4, vegetable: R(3, 4),
  // hiatus and the -ion family
  idea: 3, create: 2, piano: 3, radio: 3, video: 3, lion: 2, quiet: 2, science: 2, poem: 2, being: 2,
  going: 2, ruin: 2, fluid: 2, chaos: 2, area: 3, museum: 3, theater: R(2, 3), reality: 4, giant: 2,
  diamond: R(2, 3), violin: 3, usual: R(2, 3), actually: R(3, 4), situation: 4, experience: 4,
  serious: 3, curious: 3, previous: 3, period: 3, champion: 3, audio: 3, studio: 3, medium: 3,
  genius: R(2, 3), million: 2, onion: 2, opinion: 3, union: 2, region: 2, religion: 3, question: 2,
  nation: 2, special: 2, social: 2, ancient: 2, patient: 2, delicious: 3, precious: 2, conscious: 2,
  ocean: 2, musician: 3, initial: 3, partial: 2, cautious: 2,
  // y
  my: 1, happy: 2, flying: 2, studying: 3, rhythm: 2, mystery: R(2, 3), system: 2, crystal: 2, yes: 1,
  beyond: 2, lawyer: 2, canyon: 2, player: 2, royal: 2, yesterday: 3, dying: 2, dryer: 2, hyena: 3,
  // digraph traps
  beautiful: 3, queue: 1, through: 1, though: 1, thought: 1, enough: 2, laugh: 1, daughter: 2,
  neighbor: 2, eight: 1, weight: 1, height: 1, friend: 1, field: 1, piece: 1, believe: 2, receive: 2,
  either: 2, guess: 1, guide: 1, guitar: 2, tongue: 1, league: 1, unique: 2, antique: 2, argue: 2,
  rescue: 2, continue: 3, value: 2, blue: 1, cruel: R(1, 2), fuel: R(1, 2), fruit: 1, juice: 1,
  build: 1, biscuit: 2, language: 2, penguin: 2, guard: 1, aunt: 1, because: 2, sauce: 1, awful: 2,
  drawing: 2, saw: 1, law: 1, toe: 1, shoe: 1, does: 1, canoe: 2, poet: 2, boat: 1, road: 1, oil: 1,
  boy: 1, enjoy: 2, noise: 1, voice: 1, choice: 1, moon: 1, blood: 1, door: 1, cooperate: 4, zoo: 1,
  zoology: 4,
  // r-coloured
  bird: 1, world: 1, girl: 1, work: 1, earth: 1, early: 2, heart: 1, bear: 1, near: 1, here: 1,
  there: 1, where: 1, care: 1, share: 1, more: 1, store: 1, pure: 1, sure: 1, secure: 2, nature: 2,
  future: 2, picture: 2, adventure: 3, measure: 2, treasure: 2, doctor: 2, color: 2, dollar: 2,
  sugar: 2, iron: 2, squirrel: R(1, 2), warrior: R(2, 3), mirror: 2, error: 2, terror: 2, horror: 2,
  // consonant oddities
  knight: 1, know: 1, write: 1, wrong: 1, lamb: 1, climb: 1, thumb: 1, autumn: 2, ghost: 1, school: 1,
  christmas: 2, character: 3, machine: 2, chef: 1, stomach: 2, echo: 2, psychology: 4, phone: 1,
  elephant: 3, photograph: 3, whole: 1, who: 1, what: 1, quick: 1, square: 1, equal: 2, box: 1,
  exam: 2, exactly: 3, xylophone: 3, success: 2, accept: 2, city: 2, cycle: 2, bicycle: 3, magic: 2,
  energy: 3, general: R(2, 3), gentle: 2, get: 1, give: 1, bridge: 1, judge: 1, edge: 1, singer: 2,
  finger: 2, danger: 2, stranger: 2, orange: 2, change: 1, strange: 1, think: 1, thank: 1,
  // long words
  understand: 3, information: 4, important: 3, remember: 3, tomorrow: 3, together: 3, another: 3,
  beginning: 3, mysterious: 4, unbelievable: 5, congratulations: 5, unfortunately: 5,
  responsibility: 6, imagination: 5, civilization: 5, temperature: R(3, 4), comfortable: R(3, 4),
  interesting: R(3, 4), dictionary: 4, necessary: 4, secretary: R(3, 4), military: R(3, 4),
  ordinary: R(3, 4), library: R(2, 3), february: R(3, 4), january: 4, animal: 3, hospital: 3,
  capital: 3, several: R(2, 3), president: 3, government: 3, environment: 4, development: 4,
  element: 3, implement: 3, cement: 2, moment: 2, monument: 3, instrument: 3, argument: 3,
  document: 3,
  // the irregular head
  a: 1, i: 1, the: 1, of: 1, to: 1, you: 1, are: 1, were: 1, one: 1, once: 1, two: 1, said: 1,
  says: 1, have: 1, live: 1, love: 1, come: 1, some: 1, done: 1, gone: 1, none: 1, move: 1,
  prove: 1, lose: 1, whose: 1, eye: 1, eyes: 1, their: 1, "they're": 1, "we're": 1, "you're": 1,
  "i'm": 1, "i'll": 1, "isn't": 2, "didn't": 2, "doesn't": 2, "wouldn't": 2, "couldn't": 2,
  "shouldn't": 2, "won't": 1, "can't": 1, "let's": 1, "that's": 1,
};
