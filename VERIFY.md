# Hardware verification

The app's export checked on the S-4 itself. `tools/verify_build.js` builds **S4T VERIFY** through the app's real export. It uses test samples with known content from `tools/verify_gen.py`: 8 beats, each a click plus a tone at 400 + 100·k Hz, and a seamless 440 Hz sine. `tools/verify_play.js` plays the 10 scenes over MIDI. `tools/record10.ps1` records the S-4's 10 USB returns (master and T1–T4), and `tools/verify_analyze.py` measures them. The analyzer passes its own self-test on the source samples with known changes applied.

Run 2026-10-16 (`verify_rec2.wav`), S-4 OS 2.x, project tempo 120. Effects were bypassed on every track except in the effects test.

| What | Set in the app | Measured on the S-4 | |
|---|---|---|---|
| DISC SYNC, sample at 120 | — | clicks every 0.500 s, beats 0–7 in order | ✓ |
| Material LEVEL | −6 dB | −6.00 dB | ✓ |
| REVERSE | on | beats 7…0 | ✓ |
| START / LENGTH (grid 1/4) | 2 / 4 beats | beats 2,3,4,5 looping | ✓ |
| OFFSET | +0.6 s | content 0.600 s further into the sample: unit is seconds | ✓ |
| AS RECORDED (FREE tempo) | — | 0.500 s, in order | ✓ |
| DISC SPEED | +1 oct | 879.96 Hz (−0.1 c) | ✓ |
| DISC SPEED MAJOR | +4 | 554.33 Hz (−0.1 c); on the clicks ×1.2599 and 0.397 s: varispeed (pitch and tempo move together) | ✓ |
| DISC SPEED | −1 oct | ×0.5, clicks every 1.0 s | ✓ |
| S-4 STRETCH, chromatic | +7 | 658.79 Hz (−1.2 c)¹ | ✓ |
| S-4 STRETCH, pentatonic | +5 | 587.35 Hz (+0.1 c)¹ | ✓ |
| S-4 STRETCH, 100 BPM sample at 120 | 0 | clicks every 0.500 s, ×1.0001¹ | ✓ |
| S-4 STRETCH on the clicks | −5 | ×0.7498 (+1.4 c)¹, 0.500 s | ✓ |
| DISC SYNC, 100 BPM sample at 120 | — | 0.500 s, ×1.2 | ✓ |
| TAPE SYNC, 100 BPM sample at 120 (FREE speed correction +3.156 st, LENGTH 9.6 beats) | — | 0.500 s, ×1.2, no gap at the loop point: TAPE LENGTH counts tape time | ✓² |
| TAPE / DISC stretched by the app (BEATS) | — | 0.500 s, ×1.0 | ✓ |
| TAPE SPEED chromatic | +5 | 587.28 Hz (−0.1 c) | ✓ |
| TAPE SPEED octaves ('') | −12 | 220.00 Hz | ✓ |
| POLY, note 60, PITCH 0 | — | 439.96 Hz: note 60 plays the sample at its own pitch | ✓ |
| POLY PITCH | +3 | +300.1 c against PITCH 0 | ✓ |
| POLY PITCH FREE | +2.5 | +250.0 c against PITCH 0 | ✓ |
| DISC AS RECORDED, SPEED FREE | +2 | 493.85 Hz (−0.1 c) | ✓ |
| DISC SYNC, SPEED MINOR | −4 | 349.19 Hz (−0.2 c) | ✓ |
| DISC AS RECORDED, SPEED | +1 oct | 879.93 Hz (−0.1 c) | ✓ |
| SEND T1 → T2 (T2 BYPASS, input SENDS ONLY) | −6 dB | −6.00 dB | ✓ |
| Effects left at the S-4's defaults vs bypassed | — | not a valid test: that track's empty effect slots inherited "bypassed" from the scene before (see VERIFY2) | ✗ |
| COLOR (DEFORM) DRIVE | 0.5 | THD −13 dB, +4.6 dB | ✓ |
| Mixer T4 −6 dB, pan −0.5, on T4's own return | — | L −0.66 dB, R −8.32 dB against a centred track at 0 dB | open³ |
| Scene 10 (T4 alone) | — | T4 silent; T2 and T3 kept scene 9's sound | open⁴ |

¹ The S-4's STRETCH is granular, with grains of about 24 ms at 83.6 Hz. A pure tone comes out as a comb of lines 83.6 Hz apart. The pitch is the comb's centre, solved from the two strongest lines with a Hann-grain model. That model predicts the measured line ratios exactly (−6.4 dB against −6.1 dB measured, and −14.8 dB against −14.8 dB measured).
² The TAPE softens the very first click at transport start. The analyzer misses that click, but the beat-0 tone plays at full level.
³ Pan is applied on the per-track returns. Whether the mixer LEVEL is, and what the pan law is, needs a track alone on the master (VERIFY2).
⁴ Under investigation: the file naming of two-digit scenes (`scene10_track4.wav`), and what an empty track in a scene does (VERIFY2).

## VERIFY2 (2026-10-16)

`tools/verify2_build.js`, `verify2_play.js`, `verify2_analyze.py` and `verify2_saved.py` (the saved project read back).

| What | Measured | |
|---|---|---|
| Scenes 10, 11, 12, 20, 99, 100, 128 (own samples `discs/scene<N>_track<T>.wav`) | each plays its own pitch (−0.1 … +0.1 c): two- and three-digit scene file names are right | ✓ |
| DISC / BYPASS / TAPE / POLY without a sample, right after a scene where all four play | silent: samples are not inherited | ✓ |
| All four effects on at the S-4's defaults, written out (554 Hz tone) | +0.03 dB, THD −77.6 dB against bypassed (at 440 Hz it is −1.09 dB: see VERIFY3) | ✓ |
| COLOR (DEFORM) DRIVE 0.5 | THD −13.2 dB, +4.6 dB | ✓ |
| Mixer LEVEL −6 dB, centre | −6.00 dB on the master and on the track's own return (both post-fader) | ✓ |
| Mixer pan +1 (0 dB) | R +6.02 dB, L silent, on master and return | ✓ |
| Mixer −6 dB, pan −0.5 | L −0.67 dB, R −8.32 dB on master and return | law open¹ |
| Mode names kept after a save | all 13 other scales (dorian … tetratonic), RAND PITCH 'random', CRUSH 'redux', FOLLOW 'track 4' and 'mix'; 'fifths' is MOSAIC's default and comes back as '' | ✓ |
| FOLLOW 'input 1/2', 'input 1' | reset to '' (MATERIAL); the scene still loads | not valid names |
| Effect slots left empty (`{}`) after a scene | the on / bypass state is carried over, the values reset: a DEFORM-drive track came back undistorted but +1.46 dB louder than bypassed² | ✗ for the app |
| Modulator slots left empty | the previous scene's modulators are carried over (and saved into the scene) | ✗ for the app |
| Sends left empty | not carried over | ✓ |

¹ Hard pan doubles the side (+6.02 dB) but the centre is 0 dB, so it isn't a plain sin / cos law. VERIFY3 pans −1, −0.5 and +0.5 at 0 dB.
² VERIFY3 measures each effect alone at its defaults.

**Consequence for the app:** in scenes it creates, it must write every effect and modulator slot out in full: the S-4's defaults when nothing is set. Otherwise a scene sounds different depending on the scene played before it. Imported S-4 projects keep their own blocks.

## VERIFY3 (2026-10-16)

`tools/verify3_build.js` (built before the exporter change, so scenes 10–13 are VERIFY's scenes 9 / 10 byte for byte), `verify3_play.js`, `verify3_analyze.py`.

| What | Measured (440 Hz sine, against all bypassed) | |
|---|---|---|
| MOSAIC alone at its defaults | +0.00 dB, clean | ✓ |
| RING alone at its defaults | −2.55 dB (a filterbank: depends on the note) | ✓ |
| DEFORM alone at its defaults | +1.46 dB, clean: the "+1.46 dB" of VERIFY2 | ✓ |
| VAST alone at its defaults | +0.00 dB | ✓ |
| All four at their defaults | −1.09 dB (= −2.55 + 1.46) | ✓ |
| Pan −1 / −0.5 / +0.5 at 0 dB | L +6.02 / R off; L +5.33 R −2.32; L −2.32 R +5.33 dB (return and master alike) | ✓ |
| VERIFY's scene 9 → 10, replayed | fails again the same way (T1 silent, T2 / T3 keep scene 9, T4 silent) | reproduced |
| The same scene 10 without its FOLLOW modulators | plays correctly (T4 alone) | ✓ |

**Pan law** (now in the app's preview, `A.panGains`): at exactly 0, unity on both sides; otherwise L = 2·cos θ, R = 2·sin θ with θ = (pan + 1)·π/4. This fits all five measured points, including VERIFY2's −6 dB / −0.5 (L −0.67, R −8.32). Pans between 0 and ±0.5 have not been measured.

**A fresh S-4 track is not perfectly neutral:** RING and DEFORM at their defaults change the level. The export writes the S-4's defaults out for anything not set, which matches a fresh S-4 track. Bypass is the cleanest option.

**VERIFY scene 10:** the FOLLOW modulators the test put there make the S-4 drop the rest of that scene (T1 had four FOLLOWs with input names 'input 1/2', 'input 1', 'input 2', 'track 1'; T2 had four with 'track 2', 'track 3', 'mix', 'material'). A single invalid name does not do it (VERIFY2); VERIFY4 isolates it.

**FOLLOW INPUT names**, read from VERIFY3 after setting them on the S-4's screen and saving: MATERIAL = '' (default), INPUT 1/2 = 'in1/in2', INPUT 1 = 'in1', INPUT 2 = 'in2', TRACK 1–4 = 'track 1' … 'track 4', MIX = 'mix'. All are offered in the app.

## VERIFY4 (2026-10-16)

`tools/verify4_build.js`, `verify4_play.js`, `verify4_analyze.py` (`verify4_rec1.wav`), and `verify4_replay.js` / `verify4_replay_analyze.py` (`verify4_rec2.wav`: scene 2 three times, then scene 1 twice).

| What | Measured | |
|---|---|---|
| VAST TIME, mode '' (the default), steps 5 / 6 / 7 / 8 / 9 / 10 / 11 at 120 BPM, on a single click | echo after 2.999 / 1.500 / 0.751 / 0.377 / 0.190 / 0.096 / 0.049 s = 1/1 … 1/64 **dotted** | ✓¹ |
| VAST TIME 'triplet', step 8 | 0.169 s = 1/8T | ✓¹ |
| MOSAIC PITCH chromatic +7 / MINOR −4 / FIFTHS (default) +7 / 0 | 658.08 / 350.99 / 658.08 / 440.11 Hz (−3.1 / +8.7 / −3.1 / +0.4 c)² | ✓ |
| Mixer pan +1/64, +6/64, ±0.25 at 0 dB, on the returns | L +2.90 R +3.12; L +2.32 R +3.60; L +0.91 R +4.42 (mirrored for −0.25) dB: the pan law to ±0.01 dB | ✓ |
| FOLLOW names that are valid, in T1 and T2 (all four slots) | the scene loads | ✓ |
| VERIFY's T2 FOLLOW blocks ('track 2', 'track 3', 'mix', 'material') | loads ('material' alone too: reset to '') | ✓ |
| VERIFY's T1 FOLLOW blocks ('input 1/2', 'input 1', 'input 2', 'track 1') | scene dropped: the previous scene keeps playing | ✗ |
| T1 'input 1/2' in MOD 1 + 'input 1' in MOD 2 | dropped | ✗ |
| T1 'input 1' in MOD 2 only (MOD 1 untouched) | dropped | ✗ |
| METER TRACK PLAY / TRACK RECORD / MAIN RECORD stored 3 / 4 / 5, read on the screen | 1/4, 1/2, 1 BAR; after 4 BAR (7) the list goes back to NONE, so there is no 8 BAR | ✓ |

¹ The echoes land 0–3 ms after the note length: the envelope runs in 1 ms steps, and VAST softens the repeat. Tolerance is 4 ms or 1 %, still far apart from the other modes (1/64: dotted 46.9 ms, straight 31.3, triplet 20.8). The S-4's backups store VAST TIME modes '', 'straight' and 'triplet'. VAST TIME is the only parameter with a 'straight', and its default 8 shows as 1/8D. So **VAST TIME's default mode '' is DOTTED and STRAIGHT is stored as 'straight'**. That also explains CAL3: 'dotted' is not a name, it was reset to '', and the screen showed 1/8D. The app now offers DOTTED (''), STRAIGHT ('straight'), TRIPLET and FREE.
² MOSAIC's grain comb, measured at its centre.

**VAST glides to a new TIME:** when a scene changes the delay time, the delay slides to it over about a second. The first play of scene 2 after scene 1 gave 0.39 s for 1/16D (0.1875 s), 0.25 s for 1/32D and 0.069 s for 1/64D. The second play gave the exact values.

**An invalid FOLLOW INPUT name in modulator slot 2 or later makes the S-4 drop the whole scene.** It keeps playing the previous scene. In MOD 1 the same name is reset to MATERIAL and the scene loads (VERIFY2). The app only offers the nine names the S-4 saves itself, and an imported project keeps the S-4's own names.

**VERIFY4 saved on the S-4 and read back** (`tools/uploads/S4T_VERIFY4.zip` against the saved project.json):
- MOSAIC PITCH kept 'chromatic' and 'minor'; VAST TIME kept '' and 'triplet'. The screen showed scene 1's VAST TIME as 1/1D, 1/2D, 1/4D, 1/8D.
- The scenes that loaded (5, 9, 11) came back as exported, with 'material' reset to ''. The S-4 also fills in `default_sample_tempo`.
- **The dropped scenes (7, 13, 15) lose their data on save.** T2–T4 are byte-for-byte copies of the scene before. T1 has its own (empty) material, and its modulators are only partly read: an invalid name comes back as '', and the slots after it are the S-4's defaults. This is an S-4 bug worth reporting to Torso: one bad name silently overwrites three tracks of a scene.

## VERIFY5 (2026-10-16)

`tools/verify5_build.js`, `verify5_play.js` and `verify5_analyze.py` (`verify5_rec1.wav`, plus `verify5_rec2.wav`: scenes 1, 2, 1 replayed). The saved project was read back against the export.

| What | Measured | |
|---|---|---|
| VAST TIME 'straight' 1/8, 1/16, 1/1 | echo after 0.253, 0.128, 2.003 s | ✓ |
| VAST TIME FREE 2 Hz | 0.503 s: the delay is 1 / Hz | ✓ |
| VAST TIME steps 4 and 3: straight 2/1, 4/1; dotted 2/1D, 4/1D | 4.002, 8.002, 6.002, 12.001 s: no cap up to 12 s | ✓ |
| MOD 1 WAVE → DISC SPEED, routed by the app, RATE 7 in mode '' | 0.4994 s per cycle = 1/4 **straight** | ✓ |
| WAVE RATE 7 'dotted', and FREE 1.5 | 0.7497 s (1/4D), 0.6675 s (1.5 Hz) | ✓ |
| WAVE SHAPE 0 / 1 / 2 | sine / triangle / square, from the pitch trace (fit 0.993 / 0.996 / 0.989); the screen shows SINE, TRIANGLE, SQUARE | ✓ |
| Routing amount +0.1, bipolar (mode 0) | ±7.2 st on DISC SPEED FREE: a tenth of its full ±36 st range | ✓ |
| Routing amount +0.1, unipolar (mode 1) | 0 … +7.3 st (mean +3.6): upward only | ✓ |
| Routing amount −0.1, bipolar | the mirror image of +0.1 (correlation −0.98) | ✓ |
| DISC FREEZE, freeze_position 1152 / 105600 | a steady grain loop (the STRETCH engine) on the tone at 0.024 s / 2.2 s (400.55 / 799.12 Hz): **freeze_position is in samples** | ✓ |
| Scale modes in the scene active at load (DISC SPEED 'major' / 'minor' in SYNC, MOSAIC 'minor', FREE +2) | right pitches, and kept after a save: CAL3's fallback to 'octaves' did not happen again | ✓ |
| DISC LOOP off with the region = the whole sample | the click came back after 8 s, as with LOOP on: this test can't tell (needs a region shorter than the sample) | open |
| Read on the screen | DEFORM TILT '' = MID, RING DECAY '' = SUSTAIN, VAST TIME 'straight' 8 = STRAIGHT 1/8 | ✓ |
| Saved and read back | equal to the export apart from float32 rounding of the random buffers; 'straight', 'major' in SYNC, shapes, routings and freeze positions kept | ✓ |

**Recording note:** the first seconds of any capture run sharp. It starts at +5 c and falls to +1 c over 4 s, the same on every track. Scene 1 replayed later in the same capture is at 0 c. So start the recorder about 10 s before the first play.

**MOSAIC RATE** '' is STRAIGHT. In VERIFY4's recording, MOSAIC at its default (step 9) gives grain lines exactly 8.0 Hz apart, which is 1/16 at 120 BPM.

**DISC SPEED in SYNC:** the S-4's screen offers no scale there, and one turn of the knob on a SYNC track stored as 'octaves' moves it +12. The S-4's own saves always store SYNC speeds as 'octaves' with whole octaves (354 of 354). A scale mode written by the app is kept and played (+4 MAJOR = 554 Hz), and it still sets the knob's steps: on a SYNC track stored as MAJOR +4, one turn went to +5. Decided (2026-10-16): the app offers OCTAVES only in SYNC. A scale already stored on a SYNC track (imported, or carried over from FREE) is shown and kept as it is.

## VERIFY6 (2026-10-20)

`tools/verify6_build.js`, `verify6_play.js` and `verify6_analyze.py` (`verify6_rec1.wav`). The recorder was started 10 s before the first scene.

| What | Measured | |
|---|---|---|
| DISC SYNC, region START 2 LENGTH 2 (beats), LOOP on | beats 2 3 2 3 … every 0.500 s for 12 s | ✓ |
| The same region, LOOP off | identical: 2 3 2 3 … for 12 s | ✓¹ |
| START 0 LENGTH 2, LOOP off | 0 1 0 1 … for 12 s | ✓¹ |
| START 6 LENGTH 2 (the sample's last beats), LOOP off | 6 7 6 7 … for 12 s | ✓¹ |
| WAVE RATE 3 / 2 / 1 / 0 (mode '') on DISC SPEED | 8.00 / 16.00 / 32.00 / 64.00 s per cycle = 4/1, 8/1, 16/1, 32/1 at 120 BPM | ✓ |

With VERIFY4–6, every note-length step from 0 to 11 is now timed on the S-4 (32/1 … 1/64).

¹ As expected. LOOP only matters when the DISC's LENGTH is longer than the sample: with LOOP off the sample plays once, then silence until the region comes round (observed on the S-4, 2026-10-20). Here the regions were shorter than the sample. The S-4 showed LOOP off on T2 and on on T1, so the stored value was taken. The app caps LENGTH at the sample, so LOOP only matters for imported tracks; the switch carries this as a hint.

## Scene QUANTIZE (2026-10-20)

Set on the S-4's screen and saved, then read from the saved project.json:

| Set on the S-4 | Stored in `global_slots.scene.scene.quantize` |
|---|---|
| FREE, screen 0.500 Hz | `{value: 0.49999997, mode: 'free'}`: the value is in Hz, 0.020 to 50 (the knob's ends, read on the screen) |
| OFF | `{value: 0, mode: 'off'}` |
| SAMPLE END, TRACK 2 | `{value: 1, mode: 'sample end'}`: the track counted from 0 (saves with 0 for T1 and 3 for T4) |

STRAIGHT ('') / TRIPLET / DOTTED keep a step of the note-length list (VERIFY4–6).

The app's QUANTIZE control offers all six modes, in Project settings and in the scene list's Scene launch panel:
- TRACK 1–4 under SAMPLE END;
- a value in Hz under FREE;
- nothing under OFF.

Imported, the S-4's own SAMPLE END / TRACK 2 save shows as such and exports unchanged.

## USB audio in Chrome and the threshold recorder (2026-10-21)

- **Chrome gets 2 of the S-4's 10 USB channels**: `getUserMedia` reports `channelCount` max 2, and `exact: 10` is refused. The 2 are the main pair. With MON on T1 and T2, their input noise in Chrome matched a 10-channel Windows capture (record10.ps1): Chrome L to main L at 0.905 and Chrome R to main R at 0.900 (16-bit rounding of very quiet noise keeps it below 1), the T1 / T2 returns at 0.54-0.66 (they are part of the main mix), T3 / T4 at 0. Chrome reports 7-10 ms of input latency and delivers 10 ms blocks.
- **A track passes USB or input audio only with MON on (or while recording)** (observed on the S-4). Tones sent to every USB input with no track monitoring came back as silence.
- **Threshold REC on the S-4 misses about 45 ms**. Setup: TAPE on T1 with MON on, TRACK RECORD quantisation NONE, threshold -15 dB, one sharp sound into the input. The app sent T1's REC on the first 10 ms block above the threshold, and the S-4's tape (scene1_track1_tape.wav, 2.07 s) was lined up against a separate capture of the main out. Three windows of the tape agree on the same point within 0.8 ms.

  | In the main-out capture | ms |
  |---|---|
  | sound starts (4x the noise floor) | 2988.9 |
  | crosses -15 dB | 2991.2 |
  | REC sent (Chrome's sample count at that moment) | about 3000 |
  | the S-4's tape starts | 3034.4 |

  So the tape starts 45 ms into the sound, already at -13 dB. About 11 ms of that is before the REC goes out (the rise to the threshold and the rest of Chrome's 10 ms block); the rest is the audio reaching the PC, the note reaching the S-4 and the S-4 starting to record, which the app can't shorten. One take, so expect a few ms either way. A PC take with pre-roll keeps the whole sound.

## Calibration round 4: the CC curves Live lacked (2026-10-22)

**S4T CAL4** (`tools/cal4_build.js`) has 32 scenes of a 4 s, 220 Hz sine (8 beats at 120 BPM), with the material in each tempo and speed mode. `tools/cal4_send.js` set one or two parameters per track over MIDI, scene by scene, at CC 0, 18, 36, 54, 73, 91, 109 and 127. It then set the mixer, COMPRESS, MAIN and macros 1–8, and the S-4 saved the project. `tools/cal4_fit.py` checks each curve against the saved project.json: every value matches to float precision. x = CC / 127.

| Parameter (CC) | Stored value |
|---|---|
| DISC / TAPE SPEED (46) | −36 + 72x semitones; OCTAVES and the scales take the nearest step, DISC STRETCH whole semitones |
| DISC TEMPO (47) | 20 + 979x BPM in every tempo mode; whole BPM in SYNC |
| DISC START (48), SYNC | grid step round(x (n − 1)) of the n steps in the sample (grid 1/4: 0–7 beats; grid 1/16: 0–7.75) |
| DISC LENGTH (49), SYNC | grid steps round(x (n − 1)) + 1 (1/4: 1–8 beats; 1/16: 0.25–8) |
| DISC START / LENGTH, AS RECORDED | x times the sample's length in seconds (0–4 s) |
| TAPE LENGTH (49), grid 1/1 | 1 + round(14x) bars, 4–60 beats at 120 BPM (60 beats = the 30 s a TAPE holds) |
| TAPE LEVEL (50) | the material LEVEL curve: −100 to +12 dB (−50.63 dB at 18, +2.64 dB at 73) |
| POLY PITCH (46) | −12 + 24x semitones, unrounded in CHROMATIC too |
| POLY START / LENGTH (48 / 49) | x |
| Mixer LEVEL (46–49, ch 16) | −100 to +6 dB, the same exponential shape with k = 3: 0 → −100, 64 → −13.04, 100 → +1.04, 127 → +6 |
| Mixer PAN (54–57) / FILTER (50–53) | −1 + 2x |
| COMPRESS (58) | x (64 → 0.504) |
| MACRO 1–8 (46–53, ch 15) | −1 + 2x |
| MAIN (61) | not stored in the project |

The save also showed two things the app doesn't depend on. The S-4 added `default_sample_tempo` to the unused DISC entry of TAPE and POLY tracks. After TEMPO or SPEED was set on a STRETCH DISC, it changed that DISC's START / LENGTH grid (to 1/1 and 1/16).

Fed back into Live (`S4.follow.apply` on the imported save), every followed CC gives back the stored value. Stepped values come back as a different CC in the same step.

## Not verified on the S-4

Nothing is left open from the sanity check (VERIFY to VERIFY6, 2026-10-16 to 2026-10-20).

