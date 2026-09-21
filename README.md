# babble-lab

Text in, video-game voice out.

You type a line. It comes back as a *representation* of speech — the babble a
character makes in a text box: the right number of syllables, the rise of a
question, the shove of an exclamation mark, a swallowed "the", a voice that is
recognisably *that* character — without a single recorded sample, and without
saying a word anyone could be asked to translate.

No dependencies. No samples. Same text + same voice + same seed → the same
audio samples, in Node and in the browser.

```bash
node bin/babble.mjs "Who goes there?" --voice gruff --play
```

```bash
node tools/audition.mjs
```

The second writes `audition/index.html`: every preset saying the same lines,
one page of players. **Start there** — see "What has not been verified" below.

---

## Three ways in

### 1. The workbench

`dist/babble-lab.html` — double-click it. No server, no install.
(Working on the source instead: `node tools/serve.mjs`, then <http://127.0.0.1:4719/>.)

Type a line, pick or roll a voice, move sliders. The **score** under the text is
the engine showing its work: a wideband spectrogram (dark bands = formants =
mouth shape; vertical striations = glottal pulses), the syllables *as said*, and
the pitch line in semitones. Click anywhere on it to play from there. "As a game
would show it" reveals the text in step with the voice, the way a text box would.

When a voice is right, open **this voice as JSON** — that blob is the whole
voice. Paste it into a game, or **keep** it in the cast and export `cast.json`.

### 2. The command line

```bash
node bin/babble.mjs "Welcome, stranger!" --voice pixie --tongue 7 -o welcome.wav
```

```bash
node bin/babble.mjs script lines.txt --cast cast.json -o out
```

`script` renders a whole dialogue file (`name: what they say`, one per line)
through a cast, and writes `manifest.json` with each clip's duration and its
**reveal schedule** — `[seconds, charactersShown]` pairs a text box can play
back without running the engine at all. `node bin/babble.mjs --help` lists every knob.

### 3. Inside a game

```js
import { createSpeaker } from './babble-lab/src/runtime.mjs';

const speaker = createSpeaker(audioContext);           // create the context inside a user gesture
const line = speaker.say('Who goes there?', 'gruff', {
  onReveal: (chars, shown) => { textBox.textContent = shown; },
});
await line.done;                                        // or line.skip() to jump to the end
```

Not using ES modules (Twine/SugarCube, a plain page)? `dist/babble.global.js` is
the same engine as one classic script: `Babble.render(...)`, `Babble.createSpeaker(...)`.

A 4.5-second line renders in ~25 ms (the first line in a new voice ~120 ms: it
calibrates the voice's loudness once) and is cached, so barks cost nothing the second time.

---

## What a voice is

| mode | what it does | the archetype |
|---|---|---|
| `syllable` | formant synthesis of real syllables, with real prosody | a creature that *talks* |
| `letter` | one even micro-syllable per letter | sped-up, pitched-up letter patter |
| `blip` | one chip tone per letter; the mouth is bypassed | the classic text-box blip |

On top of the mode: **body** (pitch, vocal-tract size, speed), **melody** (how far
pitch moves, sing-song lilt, how hard `!` `?` CAPS land), **timbre** (brightness,
tension, breath, roughness, growl, nasality, wobble), **mouth** (how much
consonants bite, how far vowels open, pauses), **language** (tongue, seed) and
**effects** (bit-crush, sample-hold, ring-mod, radio band, tremolo, echo).

15 presets: `narrator villager blip bigblip gruff pixie elder robot mumble ghost
imp beast radio wah grunt`. `roll` makes a whole character from one number.

A voice can also carry a **syllabary** — a small bank of syllables it says
*instead of* the text's own sounds (`wah`: every syllable is "wah"; `grunt`: five
grunts). The text still supplies the rhythm, the melody and the choice: the bank
entry is picked by `hash(word, syllable)`, so the same word always says the same thing.

### What the text does to the voice

| in the text | in the sound |
|---|---|
| `.` | the last syllable falls |
| `?` | it rises (and the phrase stops drifting down) |
| `!` | wider pitch range, louder, a high fall |
| `,` | a small rise, a short pause |
| `...` | trails off: slower, quieter, a long pause |
| `CAPS` | higher, louder, longer |
| `sooooo` | the word stretches |
| `the`, `of`, `to`… | shorter, quieter, vowel pulled toward "uh" |
| `42`, `&`, `HP` | "forty two", "and", "aitch pee" |
| `東京`, `привет` | one stable pseudo-syllable per character, so the rhythm is right |

Nothing is appended after the last sound: a clip ends when the voice does. How
long to wait before the next line is the game's decision.

---

## The tongue: keep manner, permute place

`tongue: 0` says (roughly) the English it is given. Any other number is a
*cipher over the phoneme inventory*, and the rule it obeys is the one thing here
worth carrying to another project:

> **A sound may change its place, never its manner.** A stop stays a stop, a
> nasal a nasal, a vowel a vowel.

The sonority contour — the rise and fall of openness that makes a stream of noise
read as syllables, as *speech* — is carried by manner. The *words* are carried by
place. So a bijection within each manner class gives an invented language with
English's exact cadence and none of its vocabulary:

```
            Welcome to the village, stranger!
tongue 0    wel kəm  too dhə vi lij   strayn jer
tongue 42   rooy təng pi  və  zhah yahj thplohm je
tongue 7    yew pəng tah və  zi wij   strohn joo
```

Same text → same sounds, always, so a player learns a character's "hello"
without ever parsing it. Two characters of one species can share a tongue and
differ in voice. Schwa is pinned in place so that swallowed function words stay
swallowed in every tongue.

---

## Speaking with a recording: voice banks

The synth is one mouth. The other is a **bank**: any recording, cut into
one-second pieces and *arranged by how each piece looks*.

```bash
node bin/babble.mjs bank song.mp3 -o banks/song.bank.wav
```

```bash
node bin/babble.mjs "Who goes there?" --bank banks/song.bank.wav --set pitch=280 --play
```

In the workbench: **load audio…** takes a bank made earlier *or any audio file*,
which it cuts and arranges in the page (a four-minute song takes ~8 s).

"How it looks" is literal. Every second's spectrogram is measured as a picture
(`src/look.mjs`) — how dark its darkest pixels are, where the ink sits from
bottom to top, how far its sharpest *thin vertical line* stands out, how *grainy*
the ink is along each row — and sorted into three looks a voice can use:

| look | the picture | stands in for |
|---|---|---|
| `struck` | a thin vertical line: a pluck, a hit | syllables that open with a stop (`t`, `k`, `b`, `ch`…) |
| `wash` | grain, speckle: shaker, breath, cymbal | syllables that open with a hiss (`s`, `f`, `sh`, `h`…) |
| `tonal` | smooth horizontal stripes: a held note | everything that opens softly |
| `quiet` | nearly blank | never used |

Within a look, pieces are ordered by **where their ink sits**, dull to bright,
and a syllable reaches along that order by the brightness of its vowel ("ee" has
ink high in the picture, "oo" low). So *manner picks the look and place picks
within it* — the tongue's rule, applied to somebody else's audio. A small
`hash(word, syllable)` nudge keeps one vowel from always being the same second;
the same word still always comes out the same.

Everything else is unchanged, because the plan never knew what mouth it had:
timing, pauses, emphasis and the text reveal are identical. **Pitch becomes tape
speed** (`140` plays the recording as it is, `280` an octave up and twice as
fast), and the melody of the line bends that speed — measured on a bank of pure
tones, `Oh?` rises and `Oh.` falls exactly as the synth does. A `struck` piece is
read from just before its edge, found in the waveform to within 20 ms, so the hit
lands on the syllable.

The bank is **one file, and an ordinary WAV**: play it and you hear the
recording re-arranged look by look; load it and the index inside (a `bblb` RIFF
chunk) says which second is which. Beside it goes `<name>.sheet.png`, every
piece's picture in arranged order — the way to check the arrangement by eye.
It is PCM on purpose: compressed decoders differ between platforms, and "same in,
same samples out" has to hold for bank voices too.

The looking was wrong three times before it was right, and each time a
*synthetic recording with known contents* caught it (held tones, clicks at known
instants, hiss, silence, shuffled — `test/bank.test.mjs`); the real song had
hidden all three. A lone click on a pale ground was called quiet (mean ink);
a tone fading in was called struck (any darkening, where a strike is a *thin*
line); dull hiss was called tonal (a band of noise low in the picture *is* a dark
horizontal band — what separates it from a held note is its grain).

**Banks are not committed.** A bank is a derivative of its recording and carries
that recording's licence, not this repository's. `banks/` is gitignored; the
Glades of Arcadia bank is cut from that game's score (the owner's own track, made
with Suno, non-commercial) and stays local.

## It consumes `tts-weights`

`../tts-weights` builds per-word weight tables for a TTS voice and lists under
*Not done*: "No pronunciation layer" and "No audio". This is a consumer for it.

```bash
node bin/babble.mjs "the dragon of the north" --weights ../tts-weights/weights-mine.json
```

The table's `dur` column shortens each word and `centralize` pulls its vowels
toward schwa — the measured version of "frequent words are swallowed". Without
a table, a built-in function-word list does the same job at a similar floor. If
the table's `dur` column was dropped (tts-weights refuses to emit it when Zipf's
law of abbreviation does not hold in the corpus), there is nothing to use, and
babble-lab falls back rather than inventing a reduction. (Checked against the real
`weights-mine.json`: 6,172 usable rows; `the` → 0.60, `of` → 0.70, `mountain` → 1.00.)

`src/lexicon.mjs` exists for the reason that README measured: English's most
frequent words are its most irregular, so letter-to-sound rules fail hardest
exactly where the traffic is. Rules carry the open tail — including every
invented fantasy name — and ~440 hand-written entries carry the head.

---

## How it works

```
text.mjs     tokenise · numbers → words · syllabify (maximal onset) · stress
g2p.mjs      letter-to-sound rules + lexicon.mjs for the irregular head
tongue.mjs   the cipher
prosody.mjs  phrases → pitch, loudness, duration per unit → timed segments  (the "plan")
synth.mjs    voiced source ─┐
             breath noise ──┴─► tilt ─► F1 ► F2 ► F3 ► F4 ► F5 ──┐
             frication noise ─────────► band 1 ‖ band 2 ─────────┼─► DC block ─► fx ─► limiter
             chip source (blips) ────────────────────────────────┘
```

A small source-filter synthesizer in the Klatt (1980) family. The voiced source
is the derivative of a KLGLOTT88 flow pulse with a polyBLEP at the closure
discontinuity (that jump is what excites the formants, so it is the one place
aliasing would be loud); vowel formants are Peterson & Barney (1952) means,
consonant loci after Klatt's tables. It is written as plain arithmetic into a
`Float32Array` rather than as a WebAudio node graph **so that Node and the
browser produce the same samples** — which is what lets the tests measure the
audio a game will actually play, and lets a build-time render match run time.

The **plan** is the other half of the output: every unit carries its character
span in the original string, so `revealAt(plan, t)` tells a typewriter how many
characters to show at audio-time `t`.

---

## What is measured, and what is not

The author cannot hear. Every claim the engine makes about its own sound is
therefore measured from rendered samples (`tools/analyze.mjs`: autocorrelation
pitch, LPC formants, RMS, spectral centroid), and wherever a knob is supposed to
cause an effect, the test also renders with the knob at neutral and demands the
effect be **absent**.

| claim | measured |
|---|---|
| a flat voice sits on its pitch | within 1.5 % at 90 / 140 / 220 / 330 Hz |
| vowels land on their formant targets; `size` scales the mouth | F1, F2 within 15 % at size 0.8 / 1 / 1.25 |
| `?` rises, `.` falls | end/start f0 > 1.12 and < 0.93; with melody 0, both within 2 % of flat |
| `!` and CAPS are louder | > 1 dB and > 1.5 dB; with emphasis 0, under 0.6 dB |
| the plan and the audio agree in time | every planned syllable audible, every pause silent |
| /s/ is high hiss, /sh/ lower, both under the vowel | centroid > 4.5 kHz; /sh/ > 1.2 kHz lower; 5–24 dB down |
| rough and growl do what they say | periodicity drops; a +15 dB subharmonic at f0/2; both absent at 0 |
| vowels average the same loudness for any voice body | spread < 4 dB across 9 bodies |
| same in → same samples | byte-identical, and `dist/babble.global.js` identical to `src/` |
| the text box keeps up even when `requestAnimationFrame` never fires | ≥ 8 intermediate reveals; the test fails with the timer pump removed |

**Syllable count** is the front end's grade, because rhythm is what a player hears:

| list | score | what it is worth |
|---|---|---|
| running dialogue (357 tokens) | 100 % | a regression suite — see below |
| hard list (371 words) | 99.7 % | a regression suite — see below |
| **held-out** (203 game words and invented names) | **99.0 % on the first, untuned run** | the accuracy figure |

The first two were written before the rules, but I then traced nearly every word
in them by hand while writing the rules and patched what failed; by their first
run they measured my patching. The held-out list was written afterwards, untraced,
and run once. It is "seen" now; re-measure on fresh words before quoting better.

Vowel *quality* is best-effort and not graded: a wrong vowel is still the same
wrong vowel every time, and consistency is what makes babble feel like a language.

### What has not been verified

**That it sounds good.** The spectrograms show what speech shows — formants that
glide rather than jump, fricative noise where it belongs, stop bursts on the beat —
and the numbers above hold. None of that is an ear. `node tools/audition.mjs` is
the terminal verification, and it has not been run by anyone who can hear it.

Known soft spots, from reading the code rather than hearing it: nasals are a
damped murmur with no true anti-formant; /l/ and /r/ are steady targets without
their characteristic timing; stress placement is heuristic; the glottal source
has one shape parameter where real voices have three.

---

```bash
npm test
```

```bash
npm run build
```

`npm run build` regenerates `dist/`; a test fails if `dist/` is stale.
