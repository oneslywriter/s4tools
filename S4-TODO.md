# s4tools: TODO list

What's still open, then what's done. The S-4 project format is documented in [schema/S4-PROJECT.md](schema/S4-PROJECT.md); every hardware measurement is in [VERIFY.md](VERIFY.md).

## Open

### Not yet confirmed on the S-4

1. None at the moment.

### To do

1. None at the moment.

### Keep in mind

- **Dead MIDI port:** whether the app's fresh MIDI access (after an unanswered START / STOP) revives a dead port. Reloading the page fixed it both times it was seen (2026-10-16). On 2026-10-21 a USB storage mode round trip and a cable replug both left the port working, so it couldn't be tried. On 2026-10-22, after two storage-mode round trips, the S-4 came back without its audio and then dropped off USB altogether; a power cycle fixed it. A controlled run afterwards (idle, MIDI, its audio input, its 10-channel output, 10 output reopenings, 14 count-ins) never dropped it, so storage mode is the likely trigger.

### Ideas

1. None at the moment.

## Done

- **2026-10-12 to 10-14:** first hardware tests (S4T TEST to TEST4: DISC sync and free tempo, TAPE, POLY, level, pan, mixer, key shifting). The TST re-saves showed sends, device bypass, ADSR, scenes, mixer, Perform, config fields and the modes TST used. Bugs found with them, all fixed: bypassed effects showing as on, TAPE FREE length in seconds, the empty-TAPE warning, tape / POLY file names from `scene_index` / `track_index`, scenes without a sample being dropped.
- **2026-10-15:** calibration rounds 1-3 (S4T CAL, CAL2, CAL3): every CC's stored units and curve, scale steps, TRIPLET / DOTTED steps, FREE ranges (expo k = 8), ADSR, RANDOM LENGTH, TAPE LEVEL on CC 50.
- **2026-10-15 to 10-20, in the app:** modes on every effect parameter; modulators with routings; Perform (macros, action macros, Perform modulators); Mix modulators; scenes (CHAIN, LOCK, RULE, CHANCE, all six QUANTIZE modes in Project settings and the Scene launch panel); sends; track inputs and MIDI channels; material switches; SPEED / PITCH modes in the material panel; FOLLOW INPUT picker; Project settings; the 36-buffer sample pool warning; the hardware preview.
- **2026-10-22, on the S-4:** Live (start / stop and the S-4's replies, levels, mute / solo, pan, filter, MAIN, COMPRESS, all four effects, material level, track play), scene changes, Learn with an OXI E16 (a knob with Catch, a pad), the recorder (Record to PC, Threshold to the PC and into T1, Pre-click), and Build's export to and import from the S-4's drive. Pre-click timing, measured with a click at the very start of bar 1 (S4T TIMING): with the click on the S-4, its bar 1 lands about 7 ms after the click's beat (-8 to +30 ms over 6 runs). The click on the S-4 now goes to its main-out USB pair (9/10, no BYPASS track), and PC takes run 120 ms past the bar. Keeping the click's audio connection open between pre-clicks was tried and dropped: bar 1 then landed about 20 ms later on average (+23 vs +3 ms over 12 runs).
- **2026-10-22, the updated interface:** Live (lanes, tiles, inspector), Build (scene pads, Library, lanes, inspector tabs), Learn from a right-click and Control maps, colour themes (Paper, Night, Mono, Chalk, Slate, Meadow), the guide and README rewritten. tools/selftest.js: 1131 checks pass at 1180 and 1440 px in every theme; two random runs (about 10,600 actions) raised no errors; the export round trip of VERIFY5 is identical, and rebuilding VERIFY4 / 5 / 6 gives byte-identical WAVs and the same project.json (random buffers aside).
- **2026-10-22, settled:** RULE (0 NEXT, 1 PREV, 2 WALK, 3 RANDOM, 4 SAME) and INPUT (0 IN1/IN2, 1 MIC, 2 IN1/MIC, 3 HEADSET) are named as on the S-4's screen. The S-4 has no MIDI TRIG setting for WAVE or RANDOM, so the app no longer shows one; `midi_trig` is kept as imported (0 in every save) and is 0 in a new modulator. `zoom`, `selected_page` and `selected_modulator` are display state: kept when imported, 0 in a new project, never shown. The KEEP PARAMS editing quirk (3rd TST save, 2026-10-14: settings made on scene 1 were stored in scene 2's T1 entry) is put down to the S-4 itself; the app doesn't depend on it. Confirmed alongside it: turning KEEP on makes the next save copy the track's whole state into the other scenes. The recorder's parts are now called Threshold, Pre-click and Click.
- **2026-10-23, Play on:** one menu in Build's toolbar for where the preview plays: the S-4's tracks (each track into its own, through its effects), the S-4's main out (the browser's mix on the pair that goes straight to the master, no BYPASS needed) or any output on this computer, listed by name. The S-4's options (effects over MIDI, a test beep on each track, the channel order) show only while it plays on the S-4.
- **2026-10-23, real units in Live:** Live's knobs show the S-4's units (dB, Hz, seconds, note lengths, semitones, %, BPM, bars) on the measured curves, in the mode the followed Build project sets, else the S-4's default (S4.ctl.spec). Values can be typed in those units ("-6 dB", "1/16", "3 bars"). A knob shows the exact value the followed project set (or a fresh device's default) until Live sends it a CC, then what that CC sets (S4.ctl.exact); its pointer is hollow while the value is exact. The shared formatter no longer writes "+0" for values that round to zero, and knobs in a grid use the whole column for their value.
- **2026-10-23, calibration round 5 (S4T CAL5, 90 BPM):** TAPE LENGTH follows the tempo. It runs from 1 bar to the 30 s a TAPE holds (11.25 bars at 90 BPM, 15 at 120) and rounds to whole bars; Live's follow and the CC reference use that. Macros map CC 0-127 to -1..+1 with UNIPOLAR, BIPOLAR or no routings alike (VERIFY.md).
- **2026-10-23, the update notice:** the deploy writes the commit into index.html and into version.json, which it uploads last. A page left open checks version.json every 5 minutes and when it comes back into view. When the site is newer, a green bar under the header asks for a reload with Ctrl+Shift+R (Cmd+Shift+R on a Mac). It never reloads by itself, and **Later** hides it for half an hour. A copy run from the repo ("dev") doesn't check.
- **2026-10-23:** schema/S4-CC.md and schema/s4cc.json, the CC reference: what every CC sets across 0-127 (tools/make_ccref.js, from the app's own tables). Live's knobs now start and reset at the S-4's own defaults, from s4params.js, for every device, modulator type and the mixer. Before, these were guesses: DISC TEMPO reset to 513 BPM and the material LEVELs to +9 dB. TAPE SPEED, POLY PITCH and MOSAIC PITCH now show their real ranges.
- **2026-10-22, calibration round 4 (S4T CAL4):** the CC curves Live lacked, all exact against the saved file (tools/cal4_fit.py, VERIFY.md). Live now follows DISC SPEED / TEMPO / START / LENGTH, TAPE SPEED / LENGTH / LEVEL and POLY PITCH / START / LENGTH per scene. It takes the mixer, COMPRESS and the macros once, on the first scene launched after an export or an import, since they belong to the whole project. MAIN isn't stored in a project. An imported track nobody changed is shown from the S-4's own values; imported samples get their length from the file's header.
- **2026-10-15 to 10-20, measured (VERIFY to VERIFY6):** export timing and position, levels, pan law, DISC OFFSET in seconds, VAST TIME (DOTTED is the default ''), note-length steps 0-11 = 32/1 to 1/64, the meter quantisation list, WAVE shapes and rates, routing modes and amounts, `freeze_position` in samples, random buffers kept as written, DISC LOOP (matters only with LENGTH past the sample), DISC SPEED in SYNC (octaves only), scene QUANTIZE (FREE 0.020-50 Hz, SAMPLE END + track from 0).
- **Decided against:** material parameters and modulators when playing on the S-4's tracks (it needs MATERIAL in BYPASS, and MIDI can't set a modulator's type or routings); exact mixer pan / filter units (untouched values already export exactly).
- **2026-10-20:** an updated look (name, mark, fonts, collapsible scene list).
- **2026-10-21:**
  - the schema and reference ([schema/](schema/)), checked against 62 projects;
  - the "No answer" warning when the S-4 doesn't answer a START / STOP (the S-4 answers in 29-40 ms);
  - test projects moved off the S-4 into tools/uploads/removed-from-s4-2026-10-21 (not in git).
  - the recorder in Live: main out to WAV on the PC, and a threshold recorder that starts a PC take (0.5 s pre-roll) or the S-4's REC on T1-T4 or MAIN. Chrome offers only 2 of the S-4's 10 USB channels, and they are the main pair (matched against a 10-channel Windows capture); no helper (decided 2026-10-21).
  - measured: a threshold REC on the S-4 misses about the first 45 ms of the sound (one take; VERIFY.md).
  - the recorder's count-in (now Pre-click; 1 or 2 bars at the project's BPM; click local, on an S-4 track in BYPASS, or visual; START + REC timestamped for the downbeat; takes of N bars), and Live showing the Build project's values when a scene is launched (998 values checked against TST's project.json).
