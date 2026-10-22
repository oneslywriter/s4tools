# s4tools: TODO list

What's still open, then what's done. The S-4 project format is documented in [schema/S4-PROJECT.md](schema/S4-PROJECT.md); every hardware measurement is in [VERIFY.md](VERIFY.md).

## Open

### Not yet confirmed on the S-4

None of these affects exports: imports keep the stored values, and new projects get the S-4's defaults. Items 2 and 3 only decide the names the app shows.

1. **MIDI TRIG** (WAVE and RANDOM `midi_trig`): written as {value 1} for on, but never seen on. One save settles it: turn MIDI TRIG on for one modulator, save, read the file.
2. **RULE names** (`global_slots.scene.scene.rule`): 0 NEXT, 1 PREV, 2 WALK, 3 RANDOM, 4 SAME follows the manual's menu order. All five values occur in the S-4's own saves, but none was matched to its name on the screen.
3. **INPUT source names** (`audio_settings.input_source`): 0 IN1/IN2, 1 MIC, 2 IN1/MIC, 3 HEADSET follows the menu order. Only 0 and 1 occur in saves; not read on the screen.
4. **UI state fields** `zoom`, `selected_page` and `selected_modulator`: only 0 seen, assumed to be display state only. The app copies them as stored.
5. **KEEP PARAMS editing quirk** (3rd TST save, 2026-10-14): with KEEP SAMPLE / PARAMS on for T1, settings made on scene 1 (DISC MONITOR, FOLLOW STEREO, FILTER and GRANULAR WET 'send') were stored in scene 2's T1 entry. The likely explanation is that a kept track keeps editing the entry of the scene it came from. The app doesn't depend on it. Related, and confirmed: turning KEEP on makes the next save copy the track's whole state into the other scenes (it wiped scene 2's sends).
6. **Dead MIDI port:** whether the app's fresh MIDI access (after an unanswered START / STOP) revives a dead port. Reloading the page fixed it both times it was seen (2026-10-16). On 2026-10-21 a USB storage mode round trip and a cable replug both left the port working, so it couldn't be tried. On 2026-10-22, after two storage-mode round trips, the S-4 came back without its audio and then dropped off USB altogether; a power cycle fixed it. A controlled run afterwards (idle, MIDI, its audio input, its 10-channel output, 10 output reopenings, 14 count-ins) never dropped it, so storage mode is the likely trigger.

7. **CC curves Live still lacks** (for showing a project's values, js/follow.js): the mixer's LEVEL, PAN and FILTER, COMPRESS, MAIN, the Perform macros, DISC SPEED / TEMPO / START / LENGTH, TAPE SPEED / LENGTH / LEVEL, POLY PITCH / START / LENGTH. A calibration round (CCs sent at known values, the S-4 saves, the file is read) settles them.

### To do

1. **Name the recorder's parts properly:** THRESHOLD (the take that sound starts, now "On sound"), PRE-CLICK (the count-in, now "Count-in") and CLICK (where it plays: here, on the S-4, or none).

### Ideas

1. None at the moment.

## Done

- **2026-10-12 to 10-14:** first hardware tests (S4T TEST to TEST4: DISC sync and free tempo, TAPE, POLY, level, pan, mixer, key shifting). The TST re-saves showed sends, device bypass, ADSR, scenes, mixer, Perform, config fields and the modes TST used. Bugs found with them, all fixed: bypassed effects showing as on, TAPE FREE length in seconds, the empty-TAPE warning, tape / POLY file names from `scene_index` / `track_index`, scenes without a sample being dropped.
- **2026-10-15:** calibration rounds 1-3 (S4T CAL, CAL2, CAL3): every CC's stored units and curve, scale steps, TRIPLET / DOTTED steps, FREE ranges (expo k = 8), ADSR, RANDOM LENGTH, TAPE LEVEL on CC 50.
- **2026-10-15 to 10-20, in the app:** modes on every effect parameter; modulators with routings; Perform (macros, action macros, Perform modulators); Mix modulators; scenes (CHAIN, LOCK, RULE, CHANCE, all six QUANTIZE modes in Project settings and the Scene launch panel); sends; track inputs and MIDI channels; material switches; SPEED / PITCH modes in the material panel; FOLLOW INPUT picker; Project settings; the 36-buffer sample pool warning; the hardware preview.
- **2026-10-22, on the S-4:** Live (start / stop and the S-4's replies, levels, mute / solo, pan, filter, MAIN, COMPRESS, all four effects, material level, track play), scene changes, Learn with an OXI E16 (a knob with Catch, a pad), the recorder (Record to PC, on sound to the PC and into T1, count-in), and Build's export to and import from the S-4's drive. Count-in timing, measured with a click at the very start of bar 1 (S4T TIMING): with the click on the S-4, its bar 1 lands about 7 ms after the click's beat (-8 to +30 ms over 6 runs). The click on the S-4 now goes to its main-out USB pair (9/10, no BYPASS track), and PC takes run 120 ms past the bar. Keeping the click's audio connection open between count-ins was tried and dropped: bar 1 then landed about 20 ms later on average (+23 vs +3 ms over 12 runs).
- **2026-10-22, the updated interface:** Live (lanes, tiles, inspector), Build (scene pads, Library, lanes, inspector tabs), Learn from a right-click and Control maps, colour themes (Paper, Night, Mono, Chalk, Slate, Meadow), the guide and README rewritten. tools/selftest.js: 1131 checks pass at 1180 and 1440 px in every theme; two random runs (about 10,600 actions) raised no errors; the export round trip of VERIFY5 is identical, and rebuilding VERIFY4 / 5 / 6 gives byte-identical WAVs and the same project.json (random buffers aside).
- **2026-10-15 to 10-20, measured (VERIFY to VERIFY6):** export timing and position, levels, pan law, DISC OFFSET in seconds, VAST TIME (DOTTED is the default ''), note-length steps 0-11 = 32/1 to 1/64, the meter quantisation list, WAVE shapes and rates, routing modes and amounts, `freeze_position` in samples, random buffers kept as written, DISC LOOP (matters only with LENGTH past the sample), DISC SPEED in SYNC (octaves only), scene QUANTIZE (FREE 0.020-50 Hz, SAMPLE END + track from 0).
- **Decided against:** material parameters and modulators in Play on S-4 (it needs MATERIAL in BYPASS, and MIDI can't set a modulator's type or routings); exact mixer pan / filter units (untouched values already export exactly).
- **2026-10-20:** an updated look (name, mark, fonts, collapsible scene list).
- **2026-10-21:**
  - the schema and reference ([schema/](schema/)), checked against 62 projects;
  - the "No answer" warning when the S-4 doesn't answer a START / STOP (the S-4 answers in 29-40 ms);
  - test projects moved off the S-4 into tools/uploads/removed-from-s4-2026-10-21 (not in git).
  - the recorder in Live: main out to WAV on the PC, and a threshold recorder that starts a PC take (0.5 s pre-roll) or the S-4's REC on T1-T4 or MAIN. Chrome offers only 2 of the S-4's 10 USB channels, and they are the main pair (matched against a 10-channel Windows capture); no helper (decided 2026-10-21).
  - measured: a threshold REC on the S-4 misses about the first 45 ms of the sound (one take; VERIFY.md).
  - the recorder's count-in (1 or 2 bars at the project's BPM; click local, on an S-4 track in BYPASS, or visual; START + REC timestamped for the downbeat; takes of N bars), and Live showing the Build project's values when a scene is launched (998 values checked against TST's project.json).
