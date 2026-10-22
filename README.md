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

17 presets: `narrator villager blip bigblip gruff pixie elder robot mumble ghost
imp beast radio hen hen-radio wah grunt`. `roll` makes a whole character from one number.

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

## Cutscene timing and animal voices

`hen` is a small cluck syllabary that keeps the text's syllable count, stress
and punctuation. `hen-radio` is the **same character** through the radio band,
without added bit crushing. These are stylized synthetic game voices, not
recordings or models of a real chicken. Existing presets are unchanged.

The workbench now has **fit score to**, **load timing.json**, **reset timing**,
and **save cues.json**. Fitting changes the score before synthesis, so shortening
a line does not raise its pitch. A timing file can set a duration or give one
`[start, end]` pair per syllable (per letter in letter/blip mode), in seconds
relative to the clip. Gaps between cues become pauses. Invalid cue counts,
overlaps, and backwards times report an error instead of guessing. Reset timing
returns to natural delivery. A saved cues file can be loaded again, alongside
its text and voice.

```js
import { render, mouthAt, mouthCues } from './src/index.mjs';

// A one-second score, keeping the character's pitch and mouth size.
const short = render('Who goes there?', 'hen', { timing: { duration: 1 } });

// Two syllables, with a pause between them. Cues override natural word gaps.
const timed = render('Hello', 'hen', {
  timing: { cues: [[0.1, 0.3], [0.5, 0.8]] },
});
const open = mouthAt(timed.plan, 0.2);  // 0..1, closes during pauses
const track = mouthCues(timed.plan);  // serializable openings for another engine
```

`timing.duration` is the **score duration**, including its release. Synthesis
adds 40 ms of filter settling; echo can add a longer tail. Exports report
`audioDuration` separately so a cutscene can leave enough room. With explicit
cues and no duration, the score retains the original release after the last
cue (normally 30 ms). If both are given, duration must reach the final cue.
These controls work with sample banks too; they do not time-stretch a recording,
so a bank still needs enough original audio after its chosen starting point.

```bash
node bin/babble.mjs "Hello" --voice hen --duration 1 -o hello.wav --plan hello.json
node bin/babble.mjs "Your mission is to take out the central relay station." --voice hen-radio --timing examples/animal-factory/handler.timing.json -o handler.wav --plan handler.json
```

CLI plans and script manifests include `mouth` cues. In the browser runtime,
`say` and `prepare` accept `timing`; `say` also accepts an absolute AudioContext
`when` and `onMouth(open, clipTime, plan)` callback. The returned handle exposes
`startAt`. Use that audio clock to drive a cutscene. Stopping a speaker stops
**all** its overlapping lines, disconnects their audio nodes, and closes their
mouth callbacks. A normal non-overlapping `say` also stops all older lines.
Cache entries distinguish timing, weights, gain, effects and recording identity;
replace a bank object or call `clearCache()` after editing its samples in place.

### Audition against Animal Factory Tactics

```bash
npm run audition:animal-factory
# Include the actual chicken shot from a local game checkout:
npm run audition:animal-factory -- --game ../AnimalFactory3D/game
# Include the existing sliced-audio engine with a locally built bank:
npm run audition:animal-factory -- --game ../AnimalFactory3D/game --bank banks/glades-of-arcadia.bank.wav
```

Open `audition/animal-factory/index.html`. With `--bank`, 22 **adjustable timbre
morphs** appear first: 12 **Character morphs** (Gruff, Pixie, Elder, Robot,
Mumble, Ghost, Imp, Beast, Radio, Wah, Grunt and Narrator) and ten **Hen morphs**.
The hen set includes all eight higher speech voices plus the original clucking
hen and radio hen, fitted to the beak. The original six morph pairings remain.
`examples/animal-factory/morph-pairs.json` records each speech/slices pairing.
The **Voice morph** slider starts at 70% and runs from
0% speech tone to 100% sliced-audio tone. Both sliders work while the line is
playing: changes blend in at its current position without restarting the line.
**Beeps & boops volume** independently adds the original sampled
performance over that voice. It starts at 18% of the voice's RMS amplitude
(about −15 dB). At 0% it is muted, recovering the previous pure morph; at 100%
it matches the morphed voice's RMS level. **Mute slices** silences only this
extra layer. `examples/animal-factory/slice-layer.json` sets its starting level.
Both sliders keep their positions across voice changes, including returning
to a voice heard earlier. Reloading restores the 70% / 18% starting balance.
The Voice WAV, morph recipe and game cues downloads use the settled settings.
Beeps update immediately using the current morph. Tone changes render in a
worker; playback continues while they catch up, and downloads wait until the
requested tone is ready. Continuous dragging coalesces the next render without
cancelling the one in progress. Changes while paused leave playback paused.
Reset to 70% restores the preferred morph
amount while keeping the slice volume; the button follows the morph default.

The worker and exact Float32 tracks for all comparisons are embedded in the page,
so playback works offline without a server or fetching local audio files.
A silent WAV provides the native player's transport clock; Web Audio plays
the selected voice at that position. Sound updates crossfade over 20 ms without
reloading the transport. Pause, seek, mute and volume remain available.
The current worker caches the source spectra and envelopes so tone adjustments
only repeat the inverse transform. It stops on voice changes, page hiding,
page exit or 15 seconds of inactivity. Cached PCM lets volume adjustments run
immediately even after the worker stops. Audio nodes disconnect after fading
out, and the audio context closes on page exit.
The embedded recordings increase the local HTML size by about 26 MB;
they remain in ignored `audition/`, alongside the generated recordings.

Morphs interpolate smooth spectral envelopes in log
amplitude, retaining the speech track's phase, harmonic structure and timing.
At 50%, the target envelope is `sqrt(E_speech * E_slices)`; the speech spectrum
is reshaped toward it. This is a tone-colour midpoint, not a pitch midpoint
or a guarantee of a perceptually halfway voice. This stage does not add the tracks;
the separate Beeps & boops layer adds the sampler waveform after the morph.
At 100%, the speech keeps its pitch and timing while taking the sliced track's
tone colour. Choose a **Music slices** take to hear the sliced recording itself.

`tools/morph-audio.mjs` uses centered STFT windows and cepstral smoothing, following
the [spectral-envelope and cross-synthesis methods described by Julius O. Smith III](https://www.dsprelated.com/freebooks/sasp/Applications_STFT.html).
`examples/animal-factory/morph.json` sets the amount (0.7), window/hop
(2048/256 samples), and envelope smoothing (1 ms). Each frame retains the
speech energy; silent donor frames retain the carrier. Normalized overlap-add
adds no frame delay. The animation cues gate the result with 2 ms edge fades,
and a common gain leaves peaks at or below 0.9. Longer rests or effects tails
(notably Ghost's echo) are aligned by padding the shorter source with silence;
neither source is stretched. The cue gate still silences pauses and the end
of the line, including any echo there. The unmodified Ghost speech take retains
its full echo for comparison.

The `.morph.json` recipe records the source voices and all settings. For recipes
with `sourceAlignment: "pad-end-with-silence"`, render the two sources and call
`const [carrier, colour] = padMorphSources(speech.samples, slices.samples)`
to obtain equal-length tracks. Then call
`morphTimbre(carrier, colour, sampleRate, { ...recipe.settings,
cues: recipe.timing.cues })` to obtain the pure morph. Version 1 recipes end
there. Version 2 (`babbleMorph: 2`) then adds the separate layer:

```js
import { mixSliceLayer } from './tools/mix-slice-layer.mjs';
const mixed = mixSliceLayer(
  morph.samples, colour, recipe.sliceLayer.level, recipe.settings.peakLimit,
);
```

The `rms-overlay-v1` layer gain is `level * RMS(morph) / RMS(colour)`.
The helper adds the unchanged sampled waveform, preserving its timing, and
attenuates both layers together only if needed to keep the peak at or below
the configured limit (0.9). Silent slices add nothing. No extra cue gate is
applied to this layer, so the sampler's own tails remain intact.
Morph recipes describe both sources and are not single-voice presets.
The original synth and sampler remain unchanged.

Six **layered** takes follow: the sliced voices over the earlier speech voices, using their
existing performances and identical speech cues. The pairs are bright/bright,
chirpy/chirpy, tiny/small, clucking/throaty, radio/radio and original-speed/clear.
`examples/animal-factory/layers.json` sets these pairings and `slicesDb` (default
−6): each sliced layer is matched to its speech layer's RMS, then reduced by
6 dB. Both layers receive the same final attenuation if needed to keep the mix
peak at or below 0.9. This preserves the balance without clipping. Neither
engine is changed, and all original recordings remain available below.

The six **music-slice** takes follow: bright (2×), chirpy (2.5×), tiny (3×), clucking, radio clucking,
and original speed. These call the existing sampler unchanged, with the same
14 animation cues. No formant voice is mixed into them. Their settings are in
`examples/animal-factory/bank-voices.json`. Without `--bank`, the page contains
only the formant comparisons; a missing or invalid requested bank is an error.

Eight higher **formant** speech voices keep the
original English phonemes while exploring pitch (290–420 Hz), brighter resonance,
nasality, rasp, breath and a radio filter. Each follows the same animation cues.
They are stored in `examples/animal-factory/voices.json`: Clear hen, Bright hen,
Chirpy hen, Small hen, Throaty hen, Nasal hen, Soft hen and Bright hen · radio.
The original four comparisons remain below them: narrator, natural clucks,
clucks fitted to the beak, and the fitted radio hen.

The 12 **Character speech** takes use the existing syllable-mode presets with
the same 14 animation cues. `examples/animal-factory/character-voices.json`
selects these presets; their pitch, timbre and effects are retained. These
single-source comparisons also appear when generating without a sample bank.

Click a voice to play it with the shot, or use Previous / Next voice. Playback
can match average signal level across takes so volume alone does not decide
the comparison. Downloaded WAVs retain their exported level. Each single-source take also
exports a standalone voice JSON, ready for the workbench's voice JSON editor
or `--voice file.json`; `cast.json` contains these single-source presets. Layered
takes export the finished WAV and a `.mix.json` recipe with both voices, source
WAV names, timing and the actual linear gain for each layer. Reproduce a mix
by rendering those voices at the recorded sample rate and timing, multiplying
by their gains, and adding sample by sample. Mix recipes describe two voices;
they are not single-voice presets for `--voice` or the workbench JSON editor. A sliced
voice also needs its recording: the page offers the exact bank as
`voice.bank.wav`, and its JSON names that bank. Load both in the workbench, or
pass the downloaded bank with `--bank` on the command line. The page labels
each take's source; `report.json` and the sampled takes' cue files include the
selected pieces and their positions in the original recording. The bank and
all generated recordings stay in the ignored audition folder.

To build the Glades bank using the existing tool (MP3 decoding needs FFmpeg):

```bash
node bin/babble.mjs bank ../glades-of-arcadia/audio/glades-of-arcadia.mp3 -o banks/glades-of-arcadia.bank.wav
```

The example uses the handler's line at scene time 4.95 s and its 14 syllables,
including a 100 ms pause. With `--game`, the generator verifies the game's
speech cues before copying the `room-02` sprite sequence into the ignored
audition folder. It reads the game without changing it. Without a game checkout,
the page works as an audio-only audition. Artwork is never added to the bundle.

The original narrator differs from those animation boundaries by up to **266 ms**;
the natural hen by **469 ms**; the cue-fitted versions have **zero scheduled
boundary error**. These are timing measurements, not a listening verdict.
`report.json` records peak, RMS, duration and cue error. Tests check finite,
unclipped samples, an audible signal in every slot, a quiet pause, measured
pitch preservation, and module/bundle parity. Listen to the takes to judge
character and sound quality; this example does not claim to reproduce an
existing game soundtrack.

---

### Weapon and explosion audition

The voice audition links to **Weapons & explosions** at
`audition/animal-factory/sfx/index.html`. Its 11 effects use actual recordings:
TT-33, Mosin M38, AK-47 burst, shotgun blast and pump, two explosions,
falling debris, and Kenney metal, glass and tin impacts.
The long recordings are trimmed to individual shots or bursts, converted to
44.1 kHz mono and levelled. The original source files are retained separately.

The starting treatment is **70% timbre morph plus a 20% music-slice layer**.
It uses the same `cepstral-envelope-v1` and `rms-overlay-v1` processing as the
voices. The source recording is the carrier. `tools/sfx-audio.mjs` uses the
existing bank sampler for the colour track, with its slice choices, speed and
event timing recorded in the recipe. A 10 ms RMS envelope makes the music
follow the effect's own attack and decay. The morph keeps the source timing;
the extra layer is at 20% of the morphed effect's RMS amplitude.

**Original / Treated** compares the selected effect at the same playback
position. Both sliders work during playback and carry across effect changes.
The WAV and recipe downloads use the settled slider settings. Recipes include
the source archive member, checksums, trim, level adjustment, bank checksum,
sampler events and source licence.
`showcase.wav` plays the 11 treated effects in sequence at the starting 70/20
balance; `showcase.json` identifies their positions in the reel.

To reproduce the audition, supply FFmpeg on PATH or its executable path:

```sh
node tools/fetch-animal-factory-sfx.mjs --ffmpeg /path/to/ffmpeg
npm run audition:animal-factory-sfx
```

The fetcher reads only selected ZIP members from the Sonniss archive mirror,
checks ZIP CRC and SHA-256, and downloads the small Kenney pack. It records
provenance in `out/sfx-assets/sources.json`. The source manifest and code are
committed; the recordings, converted files and finished audition remain in
ignored `out/` and `audition/` folders. Sonniss assets retain their
[GDC licence](https://sonniss.com/gdc-bundle-license/), including restrictions
on standalone redistribution. Kenney Impact Sounds is
[CC0](https://kenney.nl/assets/impact-sounds). The music bank retains its own
recorded source and licence note.

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

The synth is one mouth. The other is a **bank**: any recording, cut into equal
pieces — a **quarter of a second** each unless you say otherwise — and *arranged
by how each piece looks*.

```bash
node bin/babble.mjs bank song.mp3 -o banks/song.bank.wav
```

```bash
node bin/babble.mjs "Who goes there?" --bank banks/song.bank.wav --set pitch=280 --play
```

In the workbench: **load audio…** takes a bank made earlier *or any audio file*,
which it cuts and arranges in the page (a four-minute song takes ~8 s). **cut**
switches between whole-, half- and quarter-second pieces; changing it un-arranges
the recording and cuts it again. `--segment 0.5` does the same on the command line.

"How it looks" is literal. Every piece's spectrogram is measured as a picture
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

**The piece only says where to start.** From there the read follows the
*original* recording, straight into whatever piece came next in it. A quarter of a
second is shorter than many syllables, and the alternatives are all worse: falling
silent, looping, or jumping to whatever piece happens to sit next in the arranged
order. This way a long syllable simply plays more of the song, and a pluck caught
at the end of its piece keeps its own decay. (Tested on a recording that climbs 20 Hz
every quarter second: 0.06, 0.20 and 0.34 s into a long syllable, the pitch heard is
the pitch the recording holds there, to 3 %.) Every piece remembers its `origin`, so
a bank can also be un-arranged and cut again at another length.

Everything else is unchanged, because the plan never knew what mouth it had:
timing, pauses, emphasis and the text reveal are identical. **Pitch becomes tape
speed** (`140` plays the recording as it is, `280` an octave up and twice as
fast), and the melody of the line bends that speed — measured on a bank of pure
tones, `Oh?` rises and `Oh.` falls exactly as the synth does. A `struck` piece is
read from just before its edge, found in the waveform to within 20 ms, so the hit
lands on the syllable.

The bank is **one file, and an ordinary WAV**: play it and you hear the
recording re-arranged look by look; load it and the index inside (a `bblb` RIFF
chunk) says which piece is which. Beside it goes `<name>.sheet.png`, every
piece's picture in arranged order — the way to check the arrangement by eye.
It is PCM on purpose: compressed decoders differ between platforms, and "same in,
same samples out" has to hold for bank voices too.

The looking was wrong **six** times before it was right, and every time a
*synthetic recording with known contents* caught it (held tones, clicks at known
instants, hiss, silence, shuffled, built at one second and again at a quarter —
`test/bank.test.mjs`); the real song hid all six behind a plausible-looking sheet.

- A lone click on a pale ground was called quiet (mean ink), then a loud pure tone
  was (darkest *columns*). Now: darkest *pixels*.
- A tone fading in was called struck (any darkening). A strike is a *thin* line:
  each column's darkening, less its neighbours'.
- Dull hiss was called tonal: a band of noise low in the picture *is* a dark
  horizontal band. What separates it from a held note is **grain**.
- Grain as distance from a long running median worked at one second and failed at a
  quarter, where a tone's own fade-in and fade-out counted as grain. Grain is
  *flicker*: each cell against its neighbours two columns either side.
- Sorting by "how far from the recording's median" goes blind whenever a whole
  population **sits on the median**: a third of the fixture is hiss, so the median
  grain *was* the hiss, every hiss piece scored 0.00 for wash and 0.00 for tonal, and
  rounding error chose. The bars are now put at the **natural break** in each
  measure (Otsu's threshold on its logarithm).
- Logs of exact zeros: a perfectly steady tone has an edge of 0, which on a log
  scale is infinitely far from everything, and *that* gap became the natural break.
  Values are floored at a hundredth of the recording's largest.

On the Glades of Arcadia score (913 quarter-second pieces): 138 tonal, 590 struck,
175 wash, 10 quiet. Struck dominates honestly — the song's pulse is one hit every
0.30 s (measured from its onset envelope; ~99 BPM in eighth notes), so about five
quarter-second windows in six contain one. A quarter of a second is *not* a note of
this song: cutting on its own eighth note would be `--segment 0.302`, and cutting
*on the beat* rather than on the clock is the obvious next step.

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
