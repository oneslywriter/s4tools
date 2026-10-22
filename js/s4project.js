'use strict';
// Native Torso S-4 projects (<NAME>.s4project folders), learned from projects saved by S-4 OS 2.x
// ("version": "v14"):
//   project.json                      minified JSON: tempo, scenes{"<index>": {tracks[4]}}, global_slots, settings
//   discs/scene<N>_track<T>.wav       DISC sample owned by the project (N, T are 1-based); used when the
//                                     DISC entry has a sample_title but no library_sample_path
//   tapes/scene<N>_track<T>_tape.wav  TAPE buffer
//   tapes/scene<N>_track<T>_poly.wav  POLY sample (material.selected 2; 0 = DISC, 1 = TAPE, 4 = BYPASS)
//   granular_buffers/                 MOSAIC buffers (may be empty)
// N and T come from the block's own scene_index / track_index, which is not always the scene it sits in
// (the S-4 carries a track into other scenes with KEEP SAMPLE / KEEP PARAMS).
// DISC start/length are beats (grid in "mode") in sync/stretch tempo, seconds in free; level is dB;
// speed is semitones (mode "octaves" = multiples of 12). TAPE length is beats at the project tempo on a
// grid ("1/1", "4/1"...), seconds in "free". A bypassed device keeps its settings, with "selected" set to
// the slot's BYPASS entry (BYPASS below). The mixer is project-wide (global_slots.mixer), not per scene.
//
// Import keeps each track's original JSON (tr.s4raw) and the project-level blocks (proj.s4raw), and export
// starts from them, so fields Build does not model (modulators, effects, sends...) survive a round trip.
(function (S4) {
  const A = S4.audio;
  const V = (value, mode = '') => ({ value, mode });
  const T = value => ({ value });
  const clone = o => JSON.parse(JSON.stringify(o));
  const r6 = x => Math.round(x * 1e6) / 1e6;
  const GRID_BEATS = { '8/1': 32, '4/1': 16, '2/1': 8, '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125, '1/64': 0.0625 };
  const TAPE_MAX_SECONDS = 30;
  // "selected" of each slot's BYPASS entry (measured on the S-4)
  const BYPASS = { material: 4, granular: 2, filter: 3, color: 2, space: 2 };
  // file name part of a track's audio: scene<N>_track<T> from the block that owns it
  const fileTag = (blk, s, t) => `scene${(blk && blk.scene_index != null ? blk.scene_index : s) + 1}_track${(blk && blk.track_index != null ? blk.track_index : t) + 1}`;

  const SETTINGS = () => ({
    audio_settings: { input_source: 0, mic_gain: 50, track1_input: 0, track2_input: 0, track3_input: 0, track4_input: 0, monitor_on_record: true },
    perform_settings: {
      macro1_name: 'MACRO 1', macro2_name: 'MACRO 2', macro3_name: 'MACRO 3', macro4_name: 'MACRO 4',
      macro5_name: 'MACRO 5', macro6_name: 'MACRO 6', macro7_name: 'MACRO 7', macro8_name: 'MACRO 8',
      action1_name: 'MACRO 9', action2_name: 'MACRO 10', action3_name: 'MACRO 11', action4_name: 'MACRO 12',
    },
    midi_settings: { track1_midi_channel: 1, track2_midi_channel: 2, track3_midi_channel: 3, track4_midi_channel: 4 },
    meter_settings: { track_play_quantization: 5, track_record_quantization: 5, mix_record_quantization: 5, modulators_running: 1, fx_running: 1, post_record_action: 0 },
    scene_settings: { tracks: [0, 1, 2, 3].map(() => ({ sample: false, params: false })) },
  });
  const GLOBAL_SLOTS = () => ({
    mixer: { mix: {}, modulator1: {}, modulator2: {}, modulator3: {}, modulator4: {}, track_playing: [true, true, true, true], modulator_mappings: {} },
    perform: {}, scene: {}, modulator1: {}, modulator2: {}, modulator3: {}, modulator4: {},
    track_mappings: [{}, {}, {}, {}], mix_mappings: {}, modulator_mappings: {}, scene_list_state: {},
  });

  // DISC entry in the S-4's key order. extra = { library_sample_path?, sample_title?, default_sample_tempo? }
  function disc(s, t, f = {}, extra = {}) {
    const o = {
      speed: f.speed || V(0, 'octaves'), tempo: f.tempo || V(120, 'sync'),
      start: f.start || V(0, '1/1'), length: f.length || V(4, '1/1'),
      zoom: V(0), offset: f.offset || V(0), xfade: f.xfade || V(0), glide: f.glide || V(0), density: f.density || V(0.7), level: f.level || V(0), sos: f.sos || V(0),
      reverse: T(0), freeze: T(0), loop: T(1), monitor: T(0),
    };
    for (const k of ['library_sample_path', 'sample_title', 'default_sample_tempo']) if (extra[k] != null) o[k] = extra[k];
    o.freeze_position = 0;
    o.track_index = t;
    o.scene_index = s;
    return o;
  }
  const emptyTrack = (s, t) => ({
    material: { selected: 0, disc: disc(s, t) },
    granular: {}, filter: {}, color: {}, space: {}, modulator1: {}, modulator2: {}, modulator3: {}, modulator4: {},
    track_output: {}, modulator_mappings: {},
  });

  // Names on the S-4 are short and upper case.
  S4.s4p = { BYPASS };
  const projectName = S4.s4p.projectName = n => (String(n || '').toUpperCase().replace(/[^A-Z0-9 _-]+/g, '_').trim().slice(0, 12) || 'S4TOOLS');

  // Build fields that the export maps; if they still equal the import snapshot, the original JSON is kept.
  // ctxKey: the project key of the project being imported/exported (the key shift depends on it).
  let ctxKey = 'NONE';
  const mapped = tr => JSON.stringify({
    d: tr.device, s: tr.sample && tr.sample.id, b: tr.sample && tr.sample.bpm, lib: tr.libRef && tr.libRef.path,
    t: tr.tempo, sp: tr.speed, st: tr.start, ln: tr.length, g: tr.grid, x: tr.xfade, l: tr.lvl,
    ps: tr.pitchSt || 0, ks: tr.tempo === 'stretch' ? S4.analysis.trackShift(tr, ctxKey) : 0,
    // warp settings only when they matter, so snapshots taken before they existed still match
    w: tr.tempo === 'stretch' && A.warpMode(tr) !== 's4' ? A.warpMode(tr) : undefined, c: tr.cents || undefined,
    f: tr.fx ? fxKey(tr.fx) : undefined,
    m: tr.mx ? JSON.stringify(tr.mx) : undefined,
    e: [tr.trimIn, tr.trimOut, tr.fadeIn, tr.fadeOut],
    p: [tr.pitch, tr.pStart, tr.pLen, tr.loopMode],
    sm: spModes(tr),
  });
  // SPEED / PITCH modes (only when set, so snapshots taken before them still match):
  //   dspMode + speedSt  DISC SPEED in a scale or FREE (semitones); unset = OCTAVES (tr.speed in octaves)
  //   pitchMode          DISC STRETCH PITCH scale (unset = CHROMATIC); POLY PITCH 'free' (unset = CHROMATIC)
  //   tspMode            TAPE SPEED mode as the S-4 stores it ('' = OCTAVES); unset = picked from the value
  function spModes(tr) {
    const a = [tr.dspMode, tr.speedSt, tr.pitchMode, tr.tspMode];
    return a.some(x => x !== undefined) ? a : undefined;
  }

  const LOOP_MODES = ['off', 'loop', 'pingpong'];
  S4.s4p.snapshot = tr => { tr.s4in = mapped(tr); };
  // The Build's project mixer (proj.mix) <-> global_slots.mixer.mix on the S-4. Solo is preview-only.
  const mixKey = mix => JSON.stringify([mix.tracks.map(t => [t.lvl, t.pan, t.fltr, !!t.mute]), mix.comp || 0]);

  // ---------------- export ----------------
  // Returns { name, dir, files: [{name, data}], warnings: [] } ready for S4.zip.write.
  S4.s4p.build = async function (proj) {
    ctxKey = proj.key || 'NONE';
    const name = projectName(proj.name);
    const dir = name + '.s4project/';
    const files = [], warnings = [], scenes = {};
    let first = -1;
    for (let i = 0; i < 128; i++) {
      const sc = proj.scenes[i];
      // a scene counts when a track has audio, came from the S-4, or uses TAPE / POLY / BYPASS (e.g. an
      // empty TAPE to record on, live input through the effects)
      if (!sc || !sc.tracks.some(t => t.sample || t.libRef || t.s4raw || (t.device && t.device !== 'DISC'))) continue;
      if (first < 0) first = i;
      const tracks = [];
      for (let t = 0; t < 4; t++) tracks.push(applyEx(await exportTrack(proj, sc.tracks[t], i, t, dir, files, warnings), sc.tracks[t]));
      scenes[String(i)] = { tracks };
    }
    if (first < 0) throw new Error('Nothing to export yet: put a sample in a scene first');

    const raw = proj.s4raw ? clone(proj.s4raw) : null;
    const global = proj.exG ? clone(proj.exG) : raw && raw.global_slots ? raw.global_slots : GLOBAL_SLOTS();
    // Project mixer: written when it differs from what was imported (or, for a new project, from the
    // S-4's defaults, which it leaves as an empty block).
    const pm = proj.mix;
    if (pm && mixKey(pm) !== proj.s4mix) {
      const isDefault = pm.tracks.every(t => !t.lvl && !t.pan && !t.fltr && !t.mute) && !pm.comp;
      const prev = (global.mixer.mix && global.mixer.mix.mix) || null;
      if (!isDefault || prev) {
        // Values the user did not touch keep the S-4's own numbers exactly.
        const inn = proj.s4mixIn;
        const keep = (i, k, key) => (prev && inn && prev[key] && inn.tracks[i][k] === pm.tracks[i][k] ? prev[key] : null);
        const mix = {};
        pm.tracks.forEach((t, i) => { mix['level' + (i + 1)] = keep(i, 'lvl', 'level' + (i + 1)) || V(t.lvl <= -95 ? -100 : r6(S4.clamp(t.lvl, -100, 6))); });
        pm.tracks.forEach((t, i) => { mix['cutoff' + (i + 1)] = keep(i, 'fltr', 'cutoff' + (i + 1)) || V(r6(S4.clamp(t.fltr / 64, -1, 1))); });
        pm.tracks.forEach((t, i) => { mix['pan' + (i + 1)] = keep(i, 'pan', 'pan' + (i + 1)) || V(r6(S4.clamp(t.pan / 64, -1, 1))); });
        mix.compress_amount = (prev && inn && prev.compress_amount && inn.comp === pm.comp && prev.compress_amount) || V(r6(S4.clamp(pm.comp || 0, 0, 1)));
        pm.tracks.forEach((t, i) => { mix['mute' + (i + 1)] = keep(i, 'mute', 'mute' + (i + 1)) || T(t.mute ? 1 : 0); });
        global.mixer.mix = { selected: 0, mix };
      }
    }
    const data = {
      tempo: projTempo(proj),
      selected_page: raw ? raw.selected_page || 0 : 0,
      selected_modulator: raw ? raw.selected_modulator || 0 : 0,
      selected_track: raw ? raw.selected_track || 0 : 0,
      selected_scene: raw && scenes[String(raw.selected_scene)] ? raw.selected_scene : first,
      scenes,
      global_slots: global,
      settings: proj.exS ? clone(proj.exS) : raw && raw.settings ? raw.settings : SETTINGS(),
    };
    files.unshift({ name: dir + 'project.json', data: JSON.stringify({ version: (proj.s4version || 'v14'), data }) });
    // audio from the imported project that no track wrote (locked grains, inactive devices' audio)
    for (const x of proj.s4extra || []) {
      if (files.some(f => f.name === dir + x.path)) continue;
      const rec = await S4.idb.get(x.id);
      if (rec) files.push({ name: dir + x.path, data: new Uint8Array(rec.bytes) });
      else warnings.push(`${x.path} from the imported project is missing from this browser and was left out`);
    }
    // TAPE and POLY share the project's sample pool of 36 buffers
    const pool = files.filter(f => f.name.startsWith(dir + 'tapes/') && f.name.endsWith('.wav')).length;
    if (pool > POOL_MAX) warnings.push(`${pool} TAPE / POLY samples: the S-4 holds ${POOL_MAX} per project, so it may not load them all`);
    if (!files.some(f => f.name.startsWith(dir + 'tapes/'))) files.push({ name: dir + 'tapes/', data: new Uint8Array(0) });
    if (!files.some(f => f.name.startsWith(dir + 'granular_buffers/'))) files.push({ name: dir + 'granular_buffers/', data: new Uint8Array(0) });
    return { name, dir, files, warnings };
  };

  // ---- S-4 blocks Build edits in place ----
  // Project: settings and global_slots (scene rules, chain / lock, perform, mappings, mixer modulators...),
  // made from the imported project (or the S-4's defaults) the first time something is changed.
  S4.s4p.settings = proj => proj.exS || (proj.exS = clone((proj.s4raw && proj.s4raw.settings) || SETTINGS()));
  S4.s4p.global = proj => proj.exG || (proj.exG = clone((proj.s4raw && proj.s4raw.global_slots) || GLOBAL_SLOTS()));
  S4.s4p.peekSettings = proj => proj.exS || (proj.s4raw && proj.s4raw.settings) || SETTINGS();
  S4.s4p.peekGlobal = proj => proj.exG || (proj.s4raw && proj.s4raw.global_slots) || GLOBAL_SLOTS();
  // Track (per scene): whole blocks such as track_output (sends), modulator1-4 and modulator_mappings, kept in
  // tr.ex; and the material's switches, tr.ex.mat = { disc: { reverse, freeze, loop, monitor }, tape: {...} }.
  // They go on top of whatever the export makes, so they never make a track count as changed.
  S4.s4p.block = (tr, key) => (tr.ex = tr.ex || {})[key] || (tr.ex[key] = clone((tr.s4raw && tr.s4raw[key]) || {}));
  S4.s4p.peek = (tr, key) => (tr.ex && tr.ex[key]) || (tr.s4raw && tr.s4raw[key]) || null;
  function applyEx(out, tr) {
    if (!tr || !tr.ex) return out;
    for (const [k, v] of Object.entries(tr.ex)) if (k !== 'mat') out[k] = clone(v);
    const mt = tr.ex.mat, m = out.material;
    if (mt && m) for (const dev of ['disc', 'tape']) if (mt[dev] && m[dev]) for (const [k, v] of Object.entries(mt[dev])) m[dev][k] = T(v ? 1 : 0);
    return out;
  }
  const POOL_MAX = 36;
  // SPEED / PITCH as Build models them; while they are as imported, the S-4's own entry (any scale mode,
  // exact value) is written back instead of Build's octaves / chromatic version.
  const spKey = tr => JSON.stringify([tr.device, tr.tempo, tr.speed || 0, tr.pitchSt || 0,
    tr.tempo === 'stretch' ? S4.analysis.trackShift(tr, ctxKey) : 0, tr.tempo === 'stretch' ? A.warpMode(tr) : ''].concat(spModes(tr) ? [spModes(tr)] : []));
  const keepSpeed = (tr, prev, made) => (prev && prev.speed && tr.spIn && tr.spIn === spKey(tr) ? prev.speed : made);
  // DISC SPEED: OCTAVES (tr.speed, stored as semitones), or semitones in a scale / FREE (dspMode, speedSt).
  // As recorded (FREE tempo) the default is the semitone FREE mode.
  const discSpeed = (tr, dflt) => (tr.dspMode && tr.dspMode !== 'octaves'
    ? V(tr.dspMode === 'free' ? r6(tr.speedSt || 0) : Math.round(tr.speedSt || 0), tr.dspMode)
    : V(Math.round(tr.speed || 0) * 12, dflt));
  // DISC STRETCH by the S-4: PITCH in semitones in its scale; the shift into the project key is chromatic
  const stretchSpeed = tr => {
    const shift = S4.analysis.trackShift(tr, ctxKey);
    return V((tr.pitchSt || 0) + shift, shift ? 'chromatic' : tr.pitchMode || 'chromatic');
  };

  // The tempo written to the project: the S-4's exact value when the project came from one and the
  // Build's (whole-number) tempo still matches it.
  const projTempo = proj => (proj.s4tempo != null && Math.round(proj.s4tempo) === proj.bpm ? proj.s4tempo : proj.bpm);

  // STRETCH rendered by the app (any warp mode but s4): the sample warped to the project tempo and
  // transposed by PITCH + FINE + key shift, ready to play at 1:1.
  const appWarped = tr => tr.tempo === 'stretch' && tr.sample && tr.sample.bpm && A.canStretch(tr) && A.warpMode(tr) !== 's4';
  const renderWarp = (proj, tr) => S4.warp.renderAsync(A.derived(tr), { stretch: tr.sample.bpm / projTempo(proj), semis: A.stretchSemis(tr), mode: A.warpMode(tr) });

  async function exportTrack(proj, tr, s, t, dir, files, warnings) {
    const out = tr.s4raw ? clone(tr.s4raw) : emptyTrack(s, t);
    const unchanged = tr.s4raw && tr.s4in === mapped(tr);
    const where = `scene ${S4.pad3(s + 1)} T${t + 1}`;
    const m = out.material || (out.material = { selected: 0, disc: disc(s, t) });

    const usesSample = tr.sample && tr.device !== 'BYPASS';
    if (usesSample && !(await S4.idb.get(tr.sample.id))) {
      warnings.push(`${where}: sample "${tr.sample.file}" is missing from this browser, the track was left as it was`);
      return out;
    }
    if (usesSample && !unchanged) await A.need(tr.sample.id);

    if (unchanged) {
      // Keep the S-4's own entry; only (re)write the files it points to, under the names it uses.
      if (m.selected === 1 && tr.sample) await writeAudio(tr, `${dir}tapes/${fileTag(m.tape, s, t)}_tape.wav`, files, false, 0, true);
      else if (m.selected === 2 && tr.sample) await writeAudio(tr, `${dir}tapes/${fileTag(m.poly, s, t)}_poly.wav`, files, true, 0, true);
      else if (m.selected === 0 && tr.sample && m.disc && !m.disc.library_sample_path) await writeAudio(tr, `${dir}discs/${fileTag(m.disc, s, t)}.wav`, files, true, 0, true);
      return out;
    }

    const sb = (tr.sample && tr.sample.bpm) || proj.bpm;
    const warn = msg => warnings.push(`${where}: ${msg}`);
    const mx = (device, prev, key) => mxOut(tr, device, prev, MAT[device].find(sp => sp.key === key), warn);

    // without a sample: TAPE / POLY stay selected and empty (the S-4 writes no TAPE entry for an empty tape)
    const noSample = (key, sel) => {
      m.selected = sel;
      if (!m.disc) m.disc = disc(s, t);
      if (m[key]) { delete m[key].sample_title; delete m[key].sample_path; }
    };
    if (tr.device === 'BYPASS') {
      // live input through the track's effects; any sample stays in Build only
      m.selected = BYPASS.material;
      if (!m.disc) m.disc = disc(s, t);
    } else if (tr.device === 'TAPE' && !tr.sample) noSample('tape', 1);
    else if (tr.device === 'POLY' && !tr.sample) noSample('poly', 2);
    else if (tr.device === 'POLY' && tr.sample) {
      // POLY keeps its sample in the project's sample pool: tapes/scene<N>_track<T>_poly.wav
      const prev = m.poly || {};
      m.selected = 2;
      if (!m.disc) m.disc = disc(s, t);
      m.poly = {
        pitch: tr.pitchMode === 'free' ? V(r6(tr.pitch || 0), 'free') : V(Math.round(tr.pitch || 0)),
        start: V(r6((tr.pStart || 0) / 100)),
        length: V(r6((tr.pLen != null ? tr.pLen : 100) / 100)),
        level: V(r6(S4.clamp(tr.lvl, -100, 12))),
        loop: mx('POLY', prev, 'loop'),
        xfade: V(r6(tr.xfade / 127)),
        attack: mx('POLY', prev, 'attack'),
        decay: mx('POLY', prev, 'decay'),
        sustain: mx('POLY', prev, 'sustain'),
        curve: mx('POLY', prev, 'curve'),
        velocity: mx('POLY', prev, 'velocity'),
        filter_amount: mx('POLY', prev, 'filter_amount'),
        filter_shape: mx('POLY', prev, 'filter_shape'),
        loop_mode: T(Math.max(0, LOOP_MODES.indexOf(tr.loopMode))),
        sample_title: tr.sample.name,
        track_index: t,
        scene_index: s,
      };
      await writeAudio(tr, `${dir}tapes/scene${s + 1}_track${t + 1}_poly.wav`, files, true);
    } else if (tr.device === 'TAPE' && tr.sample) {
      // STRETCH: the app renders the warped audio, which the TAPE then plays at its normal speed.
      const warp = appWarped(tr), PT = projTempo(proj);
      const d = warp ? await renderWarp(proj, tr) : A.derived(tr);
      if (d.duration > TAPE_MAX_SECONDS + 0.01) warnings.push(`${where}: TAPE holds ${TAPE_MAX_SECONDS} s, the sample was cut to fit`);
      // The S-4's TAPE plays at a fixed speed; express SYNC as a speed offset in free semitones.
      const syncSemis = tr.tempo === 'sync' && tr.sample.bpm ? 12 * Math.log2(proj.bpm / tr.sample.bpm) : 0;
      const semis = warp ? 0 : r6(syncSemis + (tr.speed || 0));
      const secs = Math.min(TAPE_MAX_SECONDS, tr.length ? (tr.length * 60) / (warp ? PT : sb) : d.duration);
      const prev = m.tape || {};
      m.selected = 1;
      if (!m.disc) m.disc = disc(s, t);
      // TAPE SPEED's default mode is OCTAVES; other whole semitones are CHROMATIC, the rest FREE, unless a mode
      // was chosen (and the value fits it: no tempo correction on top)
      const auto = !Number.isInteger(semis) ? 'free' : semis % 12 ? 'chromatic' : '';
      const tm = tr.tspMode;
      const spMode = tm !== undefined && !syncSemis && !warp && (tm === 'free' || (Number.isInteger(semis) && !(tm === '' && semis % 12))) ? tm : auto;
      m.tape = {
        speed: keepSpeed(tr, prev, V(semis, spMode)), rotate: mx('TAPE', prev, 'rotate'),
        length: V(r6((secs * proj.bpm) / 60), '1/1'), level: V(r6(S4.clamp(tr.lvl, -100, 12))),
        sos: mx('TAPE', prev, 'sos'), xfade: V(r6(tr.xfade / 127)), reverse: prev.reverse || T(0), monitor: prev.monitor || T(0),
        track_index: t, scene_index: s,
      };
      await writeAudio(tr, `${dir}tapes/scene${s + 1}_track${t + 1}_tape.wav`, files, false, TAPE_MAX_SECONDS, false, warp ? d : null);
    } else if (tr.sample) {
      const d = A.derived(tr);
      // SYNC: speed in octaves (stored as semitones). STRETCH by the S-4: the same field holds PITCH in
      // semitones, here PITCH + the shift into the project key. STRETCH rendered by the app: the file is
      // already at the project tempo and pitch, so the S-4 plays it in SYNC at that tempo with no
      // correction (start and length in beats are unchanged). AS RECORDED: the S-4's FREE mode.
      const warp = appWarped(tr), PT = projTempo(proj);
      const stretch = !warp && tr.tempo === 'stretch' && tr.sample.bpm && tr.device === 'DISC';
      const sync = (tr.tempo === 'sync' || tr.tempo === 'stretch') && tr.sample.bpm && tr.device !== 'POLY';
      const total = Math.round(((d.duration * sb) / 60) * 1e4) / 1e4;
      const prevD = m.disc || {};
      const f = {
        speed: keepSpeed(tr, prevD, stretch ? stretchSpeed(tr) : sync ? (warp ? V(0, 'octaves') : discSpeed(tr, 'octaves')) : discSpeed(tr, 'free')),
        tempo: V(r6(warp ? PT : sb), stretch ? 'stretch' : sync ? 'sync' : 'free'),
        start: sync ? V(r6(tr.start || 0), tr.grid) : V(0, 'free'),
        length: sync ? V(r6(tr.length || total - (tr.start || 0)), tr.grid) : V(r6(d.duration), 'free'),
        xfade: V(r6(tr.xfade / 127)),
        level: V(r6(S4.clamp(tr.lvl, -100, 12))),
      };
      for (const k of ['offset', 'glide', 'density', 'sos']) f[k] = mx('DISC', prevD, k);
      m.selected = 0;
      m.disc = disc(s, t, f, { sample_title: tr.sample.name, default_sample_tempo: r6(warp ? PT : sb) });
      // what Build does not edit stays as the S-4 had it
      for (const k of ['zoom', 'reverse', 'freeze', 'loop', 'monitor', 'freeze_position']) if (prevD[k] != null) m.disc[k] = prevD[k];
      await writeAudio(tr, `${dir}discs/scene${s + 1}_track${t + 1}.wav`, files, true, 0, false, warp ? await renderWarp(proj, tr) : null);
    } else if (tr.libRef && tr.s4raw) {
      // Sample lives in the S-4's library and was not available here: keep the reference as it was.
    }
    // (a new track without a sample keeps the empty DISC it was made with)

    // GRANULAR / FILTER / COLOR / SPACE set in Build. Not set: an imported track keeps what the S-4 had;
    // a track made here gets the S-4's defaults written out, because an empty slot ({}) keeps the on / bypass
    // state of whatever scene played before it (measured, VERIFY2), so a scene would sound different
    // depending on the order scenes are played in. The defaults written out are transparent (VERIFY2).
    for (const dev of Object.keys(DEVS)) {
      const e = tr.fx && tr.fx[dev], slot = DEVS[dev].slot;
      const warn = msg => warnings.push(`${where} ${S4.SLOT_LABEL[slot]}: ${msg}`);
      if (!e) {
        if (!tr.s4raw) out[slot] = fxOut(dev, { on: true, n: S4.params.defaults(DEVS[dev].params) }, null, warn);
        continue;
      }
      if (e.inN && !fxChanged(e)) continue;
      const prev = out[slot] && out[slot][DEVS[dev].key] ? out[slot] : null;
      out[slot] = fxOut(dev, e, prev, warn);
    }
    // Modulator slots likewise: an empty one takes over the previous scene's modulator (measured, VERIFY2),
    // so a track made here gets each slot's default modulator written out (Build's own, tr.ex, go on top).
    if (!tr.s4raw) {
      for (let n = 1; n <= 4; n++) {
        if (out['modulator' + n] && Object.keys(out['modulator' + n]).length) continue;
        const blk = {};
        S4.mods.ensure(blk, n - 1);
        out['modulator' + n] = blk;
      }
    }
    return out;
  }

  // Write a track's audio. Files that came from an S-4 project and were not edited are copied byte for byte
  // (the S-4 itself keeps e.g. 44.1 kHz files it trimmed); anything else becomes 48 kHz / 24-bit like the
  // S-4's own recordings, unless it already is. rendered: audio to write instead (a warped render).
  async function writeAudio(tr, path, files, stereo, maxSeconds, fromProject, rendered) {
    if (files.some(f => f.name === path)) return;
    const edited = rendered || tr.trimIn !== 0 || tr.trimOut !== 1 || tr.fadeIn || tr.fadeOut;
    if (!edited) {
      const rec = await S4.idb.get(tr.sample.id);
      const info = rec && wavInfo(rec.bytes);
      if (info && (fromProject || (info.tag === 1 && info.sr === 48000 && info.bits === 24 && info.ch === 2)) && (!maxSeconds || info.secs <= maxSeconds + 0.01)) {
        files.push({ name: path, data: new Uint8Array(rec.bytes) });
        return;
      }
    }
    await A.need(tr.sample.id);
    let buf = rendered || A.derived(tr);
    if (maxSeconds && buf.duration > maxSeconds) {
      const n = Math.round(maxSeconds * buf.sampleRate);
      const cut = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
      for (let c = 0; c < buf.numberOfChannels; c++) cut.getChannelData(c).set(buf.getChannelData(c).subarray(0, n));
      buf = cut;
    }
    files.push({ name: path, data: await A.renderWav(buf, 48000, stereo ? 2 : undefined) });
  }

  function wavInfo(bytes) {
    try {
      const dv = new DataView(bytes instanceof ArrayBuffer ? bytes : bytes.buffer);
      if (dv.getUint32(0, false) !== 0x52494646 || dv.getUint32(8, false) !== 0x57415645) return null;
      let p = 12, fmt = null;
      while (p + 8 <= dv.byteLength) {
        const id = dv.getUint32(p, false), len = dv.getUint32(p + 4, true);
        if (id === 0x666d7420) fmt = { tag: dv.getUint16(p + 8, true), ch: dv.getUint16(p + 10, true), sr: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) };
        if (id === 0x64617461 && fmt) return Object.assign(fmt, { secs: len / (fmt.sr * fmt.ch * (fmt.bits / 8)) });
        p += 8 + len + (len & 1);
      }
    } catch (e) { /* not a wav */ }
    return null;
  }

  // ---- effect devices and material parameters, exact values in S-4 units (s4params.js) ----
  // Build state per effect device: tr.fx[DEV] = { on, n: {key: value}, md: {key: mode}, inN, inOn, inMd }
  // (in*: as imported). on = false is the S-4's BYPASS: the device keeps its settings and the slot's "selected"
  // is its BYPASS entry. md holds the parameter modes that are not the default ('' is not stored); a value is in
  // its mode's units (S4.params.inMode).
  // Material parameters beyond the basics: tr.mx = { DISC: {offset, glide, density, sos}, TAPE: {rotate, sos},
  // POLY: {attack, decay, sustain, loop, curve, velocity, filter_amount, filter_shape} } and tr.mxIn as imported.
  const DEVS = S4.params.DEV, MAT = S4.params.MAT;
  function fxIn(dev, block) {
    const m = DEVS[dev], d = block && block[m.key];
    const bypassed = !!(block && block.selected);
    if (!d && !bypassed) return null;
    const n = {}, md = {};
    for (const sp of m.params) {
      const x = d && d[sp.key];
      n[sp.key] = x && typeof x.value === 'number' ? x.value : sp.def;
      if (x && x.mode) md[sp.key] = x.mode;
    }
    const on = !bypassed;
    return { on, n, md, inN: Object.assign({}, n), inOn: on, inMd: Object.assign({}, md) };
  }
  const sameMd = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  const fxChanged = e => !e.inN || e.on !== e.inOn || Object.keys(e.n).some(k => e.n[k] !== e.inN[k]) || (e.md && !sameMd(e.md, e.inMd));
  // Writes a value back: as the S-4 wrote it when value and mode are unchanged since import (exact digits),
  // otherwise the exact value (6 decimals) in the given mode. mode undefined (tracks from before modes were
  // modelled): the S-4's mode stays, unless it changes the units, as the value here is in the default's.
  function keepOr(old, inVal, v, sp, warn, mode) {
    const oldMode = (old && old.mode) || '';
    const same = old && inVal !== undefined && inVal === v && old.value === v;
    if (mode === undefined) {
      if (same) return old;
      mode = oldMode;
      const om = S4.params.modeOf(sp, oldMode);
      if (oldMode && sp.modal && (!om || om.curve)) { mode = ''; warn(`${sp.label} was changed here, so its S-4 mode "${oldMode}" went back to the default`); }
    } else if (same && oldMode === mode) return old;
    const ms = S4.params.inMode(sp, mode);
    return V(ms.int ? Math.round(v) : r6(v), mode);
  }
  // A device's block for export; an off device is bypassed with its settings kept.
  function fxOut(dev, e, prev, warn) {
    const m = DEVS[dev], pd = (prev && prev[m.key]) || {}, inN = e.inN || {}, o = {};
    for (const sp of m.params) {
      const mode = e.md ? e.md[sp.key] || '' : undefined;
      o[sp.key] = keepOr(pd[sp.key], inN[sp.key], e.n[sp.key] != null ? e.n[sp.key] : S4.params.inMode(sp, mode).def, sp, warn, mode);
    }
    if (dev === 'MOSAIC') {
      o.lock = pd.lock || T(0);
      o.random_pattern_buffer = pd.random_pattern_buffer || Array.from({ length: 8 }, () => r6(Math.random() * 2 - 1));
    }
    if (dev === 'VAST') o.freeze = pd.freeze || T(0);
    return { selected: e.on ? 0 : BYPASS[m.slot], [m.key]: o };
  }
  // (modes only when set, so snapshots taken before modes existed still match)
  const fxKey = fx => JSON.stringify(Object.keys(DEVS).map(d => (fx[d] ? [fx[d].on, fx[d].n].concat(fx[d].md && Object.keys(fx[d].md).length ? [fx[d].md] : []) : null)));
  // material extras from a stored block
  const mxIn = (device, block) => {
    if (!block) return null;
    const o = {};
    for (const sp of MAT[device]) if (block[sp.key] && typeof block[sp.key].value === 'number') o[sp.key] = block[sp.key].value;
    return o;
  };
  // a material extra for export: Build value, else the stored one, else the S-4 default
  const mxOut = (tr, device, prev, sp, warn) => {
    const v = tr.mx && tr.mx[device] && tr.mx[device][sp.key] != null ? tr.mx[device][sp.key] : prev[sp.key] ? prev[sp.key].value : sp.def;
    const inV = tr.mxIn && tr.mxIn[device] ? tr.mxIn[device][sp.key] : undefined;
    return keepOr(prev[sp.key], inV, v, sp, warn);
  };
  S4.s4p.mxIn = mxIn;
  S4.s4p.fxIn = fxIn;

  // ---- projects saved before exact values ----
  // Effect knobs were kept as 0-127 MIDI values (tr.fx[d].v, tr.vast) and the POLY envelope as 0-127 knobs.
  // The knobs were sent to the S-4 as CCs, so they convert through the measured curves; tracks from an
  // imported project take their exact values from the stored S-4 entry where they were unchanged.
  const OLD_VAST = { delay: 0, time: 64, reverb: 0, size: 64, feedback: 89, spread: 0, tone: 0, decay: 64 };
  const VAST_KNOB = { delay: 'delay_wet', time: 'time', reverb: 'reverb_wet', size: 'size', feedback: 'feedback', spread: 'spread', tone: 'tone', decay: 'decay' };
  const oldMapped = tr => JSON.stringify({
    d: tr.device, s: tr.sample && tr.sample.id, b: tr.sample && tr.sample.bpm, lib: tr.libRef && tr.libRef.path,
    t: tr.tempo, sp: tr.speed, st: tr.start, ln: tr.length, g: tr.grid, x: tr.xfade, l: tr.lvl,
    ps: tr.pitchSt || 0, ks: tr.tempo === 'stretch' ? S4.analysis.trackShift(tr, ctxKey) : 0,
    w: tr.tempo === 'stretch' && A.warpMode(tr) !== 's4' ? A.warpMode(tr) : undefined, c: tr.cents || undefined,
    f: tr.fx ? JSON.stringify(['MOSAIC', 'RING', 'DEFORM'].map(d => (tr.fx[d] ? [tr.fx[d].on, tr.fx[d].v] : null))) : undefined,
    e: [tr.trimIn, tr.trimOut, tr.fadeIn, tr.fadeOut], v: tr.vast,
    p: [tr.pitch, tr.pStart, tr.pLen, tr.loopMode, tr.attack, tr.decay, tr.sustain],
  });
  S4.s4p.migrate = function (tr, projKey) {
    if (!tr || (!tr.vast && tr.attack === undefined && !(tr.fx && Object.values(tr.fx).some(e => e && e.v)))) return false;
    ctxKey = projKey || 'NONE';
    const wasSame = tr.s4raw && tr.s4in === oldMapped(tr);
    const raw = tr.s4raw || {};
    const knobs = (dev, get) => Object.fromEntries(DEVS[dev].params.map(sp => [sp.key, get(sp)]));
    for (const dev of ['MOSAIC', 'RING', 'DEFORM']) {
      const e = tr.fx && tr.fx[dev];
      if (!e || !e.v) continue;
      const fromRaw = e.inV && fxIn(dev, raw[DEVS[dev].slot]);
      const same = e.inV && Object.keys(e.v).every(c => e.v[c] === e.inV[c]) && e.on === e.inOn;
      if (fromRaw && same) tr.fx[dev] = fromRaw;
      else tr.fx[dev] = Object.assign({ on: e.on, n: knobs(dev, sp => (e.v[sp.cc] != null ? sp.curve.to(e.v[sp.cc]) : sp.def)) },
        fromRaw ? { inN: fromRaw.inN, inOn: fromRaw.inOn } : {});
    }
    if (tr.vast) {
      const fromRaw = raw.space && raw.space.vast ? fxIn('VAST', raw.space) : null;
      const unchanged = tr.s4vast ? Object.keys(OLD_VAST).every(k => tr.vast[k] === tr.s4vast[k]) : Object.keys(OLD_VAST).every(k => tr.vast[k] === OLD_VAST[k] || (k === 'feedback' && tr.vast[k] === 40));
      if (fromRaw && unchanged) (tr.fx = tr.fx || {}).VAST = fromRaw;
      else if (!unchanged) {
        const spec = k => DEVS.VAST.params.find(s => s.key === VAST_KNOB[k]);
        const n = {};
        // a knob still at the old Build default stood for the S-4's default (FEEDBACK 89 = 0.7, TIME 8, DECAY 5 s)
        for (const k of Object.keys(VAST_KNOB)) {
          n[VAST_KNOB[k]] = tr.vast[k] === OLD_VAST[k] || (k === 'feedback' && tr.vast[k] === 40) ? spec(k).def
            : spec(k).curve.to(S4.clamp(tr.vast[k] + (k === 'tone' ? 64 : 0), 0, 127));
        }
        (tr.fx = tr.fx || {}).VAST = Object.assign({ on: true, n }, fromRaw ? { inN: fromRaw.inN, inOn: true } : {});
      }
      delete tr.vast;
      delete tr.s4vast;
    }
    if (tr.attack !== undefined) {
      const rp = raw.material && raw.material.poly ? mxIn('POLY', raw.material.poly) : null;
      const k = v => (v != null ? v : 64);
      // the exported values these knobs stood for
      const fromKnobs = { attack: r6(0.005 * Math.pow(400, (tr.attack || 0) / 127)), decay: r6(0.2 * Math.pow(10, (k(tr.decay) - 64) / 63)), sustain: tr.sustain === 64 ? 0.5 : r6(k(tr.sustain) / 127) };
      tr.mx = tr.mx || {};
      tr.mx.POLY = Object.assign({}, rp || {}, wasSame && rp ? {} : fromKnobs);
      if (rp) (tr.mxIn = tr.mxIn || {}).POLY = rp;
      delete tr.attack; delete tr.decay; delete tr.sustain;
    }
    // imported tracks: their other material extras, exactly as stored
    for (const device of ['DISC', 'TAPE']) {
      const blk = raw.material && raw.material[device.toLowerCase()];
      if (blk && !(tr.mx && tr.mx[device])) { const o = mxIn(device, blk); (tr.mx = tr.mx || {})[device] = o; (tr.mxIn = tr.mxIn || {})[device] = Object.assign({}, o); }
    }
    if (wasSame) tr.s4in = mapped(tr);
    return true;
  };

  // Tracks imported before bypass, empty TAPE / POLY and TAPE FREE lengths were read: a bypassed device came in
  // as on (and a dry one as off), BYPASS / empty material as DISC, a FREE tape length (seconds) as beats.
  // Corrected from the stored S-4 entry, leaving alone what was changed here since. Returns true if it ran.
  S4.s4p.repair = function (tr, projKey) {
    const raw = tr && tr.s4raw;
    if (!raw || tr.s4fix >= 3) return false;
    ctxKey = projKey || 'NONE';
    const wasSame = tr.s4in === mapped(tr);
    if (!(tr.s4fix >= 1)) repair1(tr, raw);
    // SPEED / PITCH as imported (only knowable while the track is unchanged)
    if (!tr.spIn && wasSame) tr.spIn = spKey(tr);
    // parameter modes, from the stored entry; a value changed here back then was in the default mode's units
    for (const dev of Object.keys(DEVS)) {
      const e = tr.fx && tr.fx[dev];
      if (!e || e.md) continue;
      const f = fxIn(dev, raw[DEVS[dev].slot]);
      e.md = f ? Object.assign({}, f.md) : {};
      e.inMd = f ? Object.assign({}, f.md) : {};
      for (const sp of DEVS[dev].params) {
        const mode = S4.params.modeOf(sp, e.md[sp.key]);
        if (e.md[sp.key] && (!mode || mode.curve) && e.inN && e.n[sp.key] !== e.inN[sp.key]) delete e.md[sp.key];
      }
    }
    tr.s4fix = 3;
    if (wasSame) tr.s4in = mapped(tr);
    return true;
  };
  function repair1(tr, raw) {
    for (const dev of Object.keys(DEVS)) {
      const blk = raw[DEVS[dev].slot], e = tr.fx && tr.fx[dev];
      if (!blk) continue;
      if (!e) { const f = fxIn(dev, blk); if (f && !f.on) (tr.fx = tr.fx || {})[dev] = f; continue; }
      if (e.on !== e.inOn || !e.inN) continue;
      const f = fxIn(dev, blk);
      if (!f || f.on === e.inOn) continue;
      // a dry device had its WET reset to the default when it came in as off: back to the stored WET
      if (f.on && f.inN.wet !== e.inN.wet) { if (e.n.wet === e.inN.wet) e.n.wet = f.inN.wet; e.inN.wet = f.inN.wet; }
      e.on = e.inOn = f.on;
    }
    const m = raw.material || {};
    if (tr.device === 'DISC' && !tr.sample && !tr.libRef) tr.device = { 1: 'TAPE', 2: 'POLY', [BYPASS.material]: 'BYPASS' }[m.selected] || 'DISC';
    const ln = m.selected === 1 && m.tape && m.tape.length;
    if (tr.device === 'TAPE' && tr.sample && ln && ln.mode === 'free' && tr.length === ln.value) tr.length = r6((ln.value * (tr.sample.bpm || 120)) / 60);
  }

  // ---------------- import ----------------
  // entries: Map(path -> { size, read(): Promise<ArrayBuffer> }) with '/' separators.
  // Returns [{ name, prefix, entries }] for every *.s4project folder found.
  S4.s4p.find = function (entries) {
    const found = new Map();
    for (const p of entries.keys()) {
      const m = p.match(/^(.*?)([^/]+)\.s4project\/project\.json$/i);
      if (m) found.set(m[1] + m[2] + '.s4project/', { name: m[2], prefix: m[1] + m[2] + '.s4project/' });
    }
    return [...found.values()];
  };

  // Index files under any SAMPLES/ folder that came along, for library_sample_path lookups.
  function samplesIndex(entries) {
    const idx = new Map();
    for (const p of entries.keys()) {
      const m = p.match(/(?:^|\/)SAMPLES\/(.+)$/i);
      if (m) idx.set(m[1].toLowerCase(), p);
    }
    return idx;
  }
  function libLookup(path, idx) {
    // /tmp/S-4/browser/SAMPLES/02_USER/<rel> and /data/SAMPLES/<rel> are the S-4's own SAMPLES folder.
    const m = path.match(/\/SAMPLES\/02_USER\/(.+)$/i) || path.match(/^\/data\/SAMPLES\/(.+)$/i);
    return m ? idx.get(m[1].toLowerCase()) || null : null;
  }

  // Builds a Build project from one S-4 project. Sample bytes go to IndexedDB.
  S4.s4p.parse = async function (found, entries, make) {
    const pj = entries.get(found.prefix + 'project.json');
    const raw = JSON.parse(new TextDecoder().decode(await pj.read()));
    if (!raw || !raw.data || typeof raw.data.scenes !== 'object') throw new Error('project.json has no scenes');
    const warnings = [], missing = [];
    if (raw.version !== 'v14') warnings.push(`made with project format ${raw.version}; this app knows v14, imported anyway`);
    const d = raw.data;
    const proj = make.project();
    ctxKey = proj.key || 'NONE';
    proj.name = found.name;
    proj.bpm = Math.round(d.tempo || 120);
    proj.s4tempo = d.tempo; // exact value (e.g. 60.02072), written back while the BPM is left as it was
    proj.s4version = raw.version;
    proj.s4raw = clone(Object.assign({}, d, { scenes: undefined }));
    delete proj.s4raw.scenes;
    const lib = samplesIndex(entries);
    const ids = new Map();
    const store = async (path, title) => {
      if (ids.has(path)) return ids.get(path);
      const e = entries.get(path);
      if (!e) return null;
      const bytes = await e.read();
      const id = 'P' + hash(found.name + '|' + path + '|' + e.size);
      const file = path.split('/').pop();
      await S4.idb.put({ id, name: file, folder: '', bytes, type: 'audio/wav' });
      const meta = { id, file, name: title || file.replace(/\.[^.]+$/, ''), folder: '', dur: null, sr: null, ch: null };
      ids.set(path, meta);
      return meta;
    };

    const mix = (d.global_slots && d.global_slots.mixer && d.global_slots.mixer.mix && d.global_slots.mixer.mix.mix) || null;
    for (const [key, sc] of Object.entries(d.scenes)) {
      const si = +key;
      if (!(si >= 0 && si < 128) || !sc || !Array.isArray(sc.tracks)) continue;
      const scene = make.scene();
      for (let t = 0; t < 4; t++) {
        const rt = sc.tracks[t] || emptyTrack(si, t);
        const tr = scene.tracks[t];
        tr.s4raw = rt;
        const m = rt.material || {};
        const where = `scene ${S4.pad3(si + 1)} T${t + 1}`;
        // a track's file, under the name its block gives (or, failing that, where the block sits)
        const fileOf = (blk, folder, suffix) => [`${found.prefix}${folder}/${fileTag(blk, si, t)}${suffix}.wav`, `${found.prefix}${folder}/scene${si + 1}_track${t + 1}${suffix}.wav`].find(p => entries.has(p)) || null;
        const sel = m.selected == null ? 0 : m.selected;
        if (sel === 1) {
          // TAPE; an empty tape has no entry
          tr.device = 'TAPE';
          tr.tempo = 'recorded';
          const tp = m.tape;
          if (tp) {
            const sm = tp.speed ? tp.speed.mode || '' : '';
            tr.tspMode = sm;
            tr.speed = tp.speed ? (sm === 'free' ? tp.speed.value : Math.round(tp.speed.value)) : 0;
            tr.lvl = S4.clamp(tp.level ? tp.level.value : 0, -100, 12);
            tr.xfade = Math.round((tp.xfade ? tp.xfade.value : 0) * 127);
            const path = fileOf(tp, 'tapes', '_tape');
            const meta = path && (await store(path, tp.sample_title || 'tape'));
            if (meta) {
              tr.sample = Object.assign({}, meta, { bpm: proj.bpm, bpmSrc: 'user', key: null });
              // beats at the project tempo; FREE holds seconds
              const ln = tp.length;
              tr.length = ln ? (ln.mode === 'free' ? r6((ln.value * proj.bpm) / 60) : ln.value) : null;
            }
          }
        } else if (sel === 2) {
          tr.device = 'POLY';
          tr.tempo = 'recorded';
        }
        if (sel === 2 && m.poly) {
          const pl = m.poly, val = (k, d) => (pl[k] && typeof pl[k].value === 'number' ? pl[k].value : d);
          const pfree = pl.pitch && pl.pitch.mode === 'free';
          if (pfree) tr.pitchMode = 'free';
          tr.pitch = pfree ? val('pitch', 0) : Math.round(val('pitch', 0));
          tr.pStart = Math.round(val('start', 0) * 100);
          tr.pLen = Math.max(1, Math.round(val('length', 1) * 100));
          tr.lvl = S4.clamp(val('level', 0), -100, 12);
          tr.xfade = Math.round(val('xfade', 0) * 127);
          tr.loopMode = LOOP_MODES[pl.loop_mode ? pl.loop_mode.value : 0] || 'off';
          const path = fileOf(pl, 'tapes', '_poly') || (pl.sample_path ? libLookup(pl.sample_path, lib) : null);
          if (path) {
            const meta = await store(path, pl.sample_title);
            tr.sample = Object.assign({}, meta, { bpm: null, bpmSrc: null, key: keyFrom(meta.name) });
          } else if (pl.sample_title) {
            missing.push(`${where}: POLY sample ${pl.sample_title} (tapes/${fileTag(pl, si, t)}_poly.wav)`);
          }
        } else if (sel === 0) {
          const ds = m.disc;
          if (ds) {
            const free = ds.tempo && ds.tempo.mode === 'free';
            const bpm = (ds.tempo && ds.tempo.value) || proj.bpm;
            tr.device = 'DISC';
            const stretch = ds.tempo && ds.tempo.mode === 'stretch';
            tr.tempo = free ? 'recorded' : stretch ? 'stretch' : 'sync';
            if (stretch) tr.warp = 's4'; // the S-4 stretches it: keep it that way unless changed here
            // In STRETCH the speed field is PITCH (semitones); in SYNC it is octaves stored as semitones.
            tr.pitchSt = stretch && ds.speed ? Math.round(ds.speed.value) : 0;
            tr.speed = !stretch && ds.speed && ds.speed.mode === 'octaves' ? S4.clamp(Math.round(ds.speed.value / 12), -3, 3) : 0;
            const sm = ds.speed ? ds.speed.mode || '' : '';
            if (stretch && sm && sm !== 'chromatic') tr.pitchMode = sm;
            if (!stretch && sm && sm !== 'octaves') { tr.dspMode = sm; tr.speedSt = sm === 'free' ? ds.speed.value : Math.round(ds.speed.value); }
            tr.grid = GRID_BEATS[ds.length && ds.length.mode] ? ds.length.mode : '1/4';
            const toBeats = v => (free ? (v * bpm) / 60 : v);
            tr.start = ds.start ? toBeats(ds.start.value) : 0;
            tr.length = ds.length ? toBeats(ds.length.value) : null;
            tr.xfade = Math.round((ds.xfade ? ds.xfade.value : 0) * 127);
            tr.lvl = S4.clamp(ds.level ? ds.level.value : 0, -100, 12);
            let path = null;
            if (ds.library_sample_path) {
              path = libLookup(ds.library_sample_path, lib);
              if (!path) {
                tr.libRef = { path: ds.library_sample_path, title: ds.sample_title || ds.library_sample_path.split('/').pop() };
                missing.push(`${where}: ${tr.libRef.title} (S-4 library, ${ds.library_sample_path.replace(/^\/tmp\/S-4\/browser\/SAMPLES\//, '')})`);
              }
            } else if (ds.sample_title) {
              path = fileOf(ds, 'discs', '');
              if (!path) missing.push(`${where}: discs/${fileTag(ds, si, t)}.wav`);
            }
            if (path) {
              const meta = await store(path, ds.sample_title);
              tr.sample = Object.assign({}, meta, { bpm, bpmSrc: 'user', key: keyFrom(meta.name) });
            }
          }
        } else if (sel === BYPASS.material) {
          tr.device = 'BYPASS';
        } else if (sel !== 1 && sel !== 2) {
          warnings.push(`${where}: material device #${sel} is not supported yet; it is kept as-is on export`);
        }
        // effects and material extras, exact as stored (every material block the track keeps)
        for (const dev of Object.keys(DEVS)) {
          const e = fxIn(dev, rt[DEVS[dev].slot]);
          if (e) (tr.fx = tr.fx || {})[dev] = e;
        }
        for (const device of Object.keys(MAT)) {
          const o = mxIn(device, m[device.toLowerCase()]);
          if (o) { (tr.mx = tr.mx || {})[device] = o; (tr.mxIn = tr.mxIn || {})[device] = Object.assign({}, o); }
        }
        tr.s4fix = 3;
        tr.spIn = spKey(tr);
        S4.s4p.snapshot(tr);
      }
      proj.scenes[si] = scene;
    }
    if (!proj.mix) proj.mix = make.mix();
    if (mix) {
      const val = (k, d) => (mix[k] && typeof mix[k].value === 'number' ? mix[k].value : d);
      proj.mix.tracks.forEach((mt, t) => {
        const n = t + 1;
        Object.assign(mt, {
          lvl: val('level' + n, 0),
          pan: Math.round(S4.clamp(val('pan' + n, 0), -1, 1) * 64),
          fltr: Math.round(S4.clamp(val('cutoff' + n, 0), -1, 1) * 64),
          mute: !!val('mute' + n, 0),
          solo: false,
        });
      });
      proj.mix.comp = val('compress_amount', 0);
    }
    proj.s4mix = mixKey(proj.mix);
    proj.s4mixIn = { tracks: proj.mix.tracks.map(t => ({ lvl: t.lvl, pan: t.pan, fltr: t.fltr, mute: t.mute })), comp: proj.mix.comp };
    // Audio the tracks above did not take in: locked GRANULAR buffers (granular_buffers/trackN.wav) and the
    // stored audio of each track's inactive material devices. Kept and written back on export.
    proj.s4extra = [];
    for (const [path, e] of entries) {
      if (!path.startsWith(found.prefix) || ids.has(path)) continue;
      const rel = path.slice(found.prefix.length);
      if (!/^(granular_buffers|tapes|discs)\/[^/]+\.wav$/i.test(rel)) continue;
      const id = 'X' + hash(found.name + '|' + rel + '|' + e.size);
      await S4.idb.put({ id, name: rel.split('/').pop(), folder: '', bytes: await e.read(), type: 'audio/wav' });
      proj.s4extra.push({ path: rel, id });
    }
    return { proj, warnings, missing, selected: d.selected_scene || 0 };
  };

  function keyFrom(name) {
    const m = /(?:^|[_\-\s])key([A-G][#b]?m?)(?:[_\-\s]|$)/.exec(name || '');
    return m ? m[1] : null;
  }
  function hash(str) {
    let x = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193); }
    return (x >>> 0).toString(36);
  }

  // Wrap a zip's Map(name -> Uint8Array) or a picked folder's File[] as import entries.
  S4.s4p.entriesFromZip = map => new Map([...map].map(([k, v]) => [k, { size: v.length, read: async () => v.slice().buffer }]));
  S4.s4p.entriesFromFiles = files => new Map(files.map(f => [(f._rel || f.webkitRelativePath || f.name).replace(/\\/g, '/'), { size: f.size, read: () => f.arrayBuffer() }]));
})(window.S4);
