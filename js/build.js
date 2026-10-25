'use strict';
// Build: a project for the S-4 from your own samples. Scene pads on top, a Library of samples on the left, the four
// tracks of the selected scene as lanes, and an inspector for the selected track. Previewed here, exported for the S-4.
(function (S4) {
  const h = S4.h, A = S4.audio;
  const GRIDS = [['8/1', 32], ['4/1', 16], ['2/1', 8], ['1/1', 4], ['1/2', 2], ['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['1/64', 0.0625]];
  const gridBeats = g => (GRIDS.find(x => x[0] === g) || GRIDS[4])[1];
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const KEYS = ['NONE', ...NOTES, ...NOTES.map(n => n + 'm')];
  const AUDIO_EXT = /\.(wav|wave|aif|aiff|mp3|flac|ogg|m4a|aac|opus|webm)$/i;
  const LAUNCH = [
    { value: 'NOW', label: 'At once' }, { value: 'BEAT', label: 'On the beat' },
    { value: 'BAR', label: 'On the bar' }, { value: '2BAR', label: 'Every 2 bars' },
  ];

  // The mixer is project-wide, like the S-4's MIX view: LVL (dB), PAN and FLTR (-64..63), mute per track,
  // plus the master compressor (0-1). Solo only affects the preview.
  const newMix = () => ({ tracks: [0, 1, 2, 3].map(() => ({ lvl: 0, pan: 0, fltr: 0, mute: false, solo: false })), comp: 0 });
  const newProject = () => ({ v: 1, name: 'Untitled', bpm: 120, key: 'NONE', launch: 'BAR', loop: true, mix: newMix(), scenes: new Array(128).fill(null) });
  // lvl here is the material device's own LEVEL (dB), which the S-4 keeps per scene.
  const newTrack = () => ({
    device: 'DISC', sample: null, lvl: 0,
    // tempo: 'sync' | 'stretch' | 'recorded'. STRETCH: warp algorithm (beats | tones | complex | s4), PITCH
    // (pitchSt, semitones) and FINE (cents). followKey: shift into the project key.
    tempo: 'sync', grid: '1/4', speed: 0, start: 0, length: null, xfade: 0, pitchSt: 0, cents: 0, warp: 'beats', followKey: true,
    pitch: 0, pStart: 0, pLen: 100, loopMode: 'off',
    fadeIn: 0, fadeOut: 0, trimIn: 0, trimOut: 1,
    // effects (fx) and further material parameters (mx) appear when set, in S-4 units (s4params.js)
  });
  const newScene = () => ({ name: '', tracks: [0, 1, 2, 3].map(newTrack) });
  // libRef: a sample in the S-4's own library that an imported project uses but this computer does not have.
  // A track set to TAPE / POLY / BYPASS without a sample still counts (an empty tape, live input).
  const isEmpty = sc => !sc || sc.tracks.every(t => !t.sample && !t.libRef && (!t.device || t.device === 'DISC'));
  const MATERIALS = ['DISC', 'TAPE', 'POLY', 'BYPASS'];

  function loadProject() {
    const p = S4.store.get('project', null);
    if (!(p && p.v === 1 && Array.isArray(p.scenes) && p.scenes.length === 128)) return newProject();
    // effect and POLY envelope knobs (0-127) became exact values in S-4 units; imported tracks get what
    // earlier imports misread (bypass, empty TAPE / POLY, TAPE FREE lengths)
    p.scenes.forEach(sc => sc && sc.tracks.forEach(t => { S4.s4p.migrate(t, p.key); S4.s4p.repair(t, p.key); }));
    migrateMix(p);
    return p;
  }

  // Projects saved before the mixer was project-wide kept PAN/FLTR/mute/solo per scene. The S-4 export
  // used the first scene's values, so that scene becomes the project mixer (track levels stay per scene).
  function migrateMix(p) {
    if (p.mix) return;
    p.mix = newMix();
    const first = p.scenes.find(sc => sc && sc.tracks.some(t => t.sample || t.libRef));
    if (first) first.tracks.forEach((t, i) => Object.assign(p.mix.tracks[i], { pan: t.pan || 0, fltr: t.fltr || 0, mute: !!t.mute, solo: !!t.solo }));
    p.scenes.forEach(sc => sc && sc.tracks.forEach(t => { delete t.pan; delete t.fltr; delete t.mute; delete t.solo; }));
  }

  const CR = S4.cr = {
    proj: loadProject(),
    sel: { scene: 0, track: 0, row: 'sample' },
    missing: new Set(),
    expand: false,
    make: { project: newProject, scene: newScene, mix: newMix },
  };
  const saveProj = S4.debounce(() => S4.store.set('project', CR.proj), 400);
  const scene = () => CR.proj.scenes[CR.sel.scene] || (CR.proj.scenes[CR.sel.scene] = newScene());

  let root, padsEl, padGrid, padCount, libEl, libList, lanesEl, inspEl;
  const bar = {};
  let visible = false;

  // Redraw canvases whenever their box changes size.
  const observed = new Set();
  const ro = new ResizeObserver(es => es.forEach(e => e.target._draw && e.target._draw()));
  const observe = c => { observed.add(c); ro.observe(c); };
  const gcObserved = () => observed.forEach(c => { if (!c.isConnected) { ro.unobserve(c); observed.delete(c); } });

  S4.build = {
    mount(el, toolbar) {
      root = h('div', { class: 'bd' + (S4.store.get('build.libOff', false) ? ' lib-off' : '') });
      el.append(root);
      buildToolbar(toolbar);
      root.append(
        padsEl = h('div', { class: 'bd-pads' + (S4.store.get('build.padsShort', innerHeight < 900) ? ' short' : '') }),
        libEl = h('aside', { class: 'bd-lib' }),
        lanesEl = h('div', { class: 'bd-lanes' }),
        inspEl = h('aside', { class: 'bd-insp' }));
      buildPads();
      buildLibrary();
      renderAll();
      S4.on('sample-ready', id => {
        CR.missing.delete(id);
        root.querySelectorAll(`canvas[data-sid="${id}"]`).forEach(c => c._draw && c._draw());
      });
      S4.on('audio-scene', renderSceneStates);
      S4.on('audio-transport', () => { renderToolbar(); renderSceneStates(); updateHear(); });
      S4.on('hw', () => { renderToolbar(); renderLanes(); renderInsp(); });
      // waveforms take their colours from the theme
      const redraw = () => requestAnimationFrame(() => root.querySelectorAll('canvas').forEach(c => c._draw && c._draw()));
      S4.on('theme', redraw);
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
      requestAnimationFrame(frame);
    },
    show(on) {
      visible = on;
      if (on) root.querySelectorAll('canvas').forEach(c => c._draw && c._draw());
      else stopAudition();
    },
    togglePlay,
  };

  // ---------- toolbar (under the header) ----------
  function buildToolbar(tb) {
    bar.name = h('input', { class: 'proj-name', spellcheck: 'false', title: 'Name of the project (the S-4 shows it in capitals)', oninput: e => { CR.proj.name = e.target.value; saveProj(); } });
    bar.play = h('button', { class: 'btn icon-only', title: 'Play the selected scene here, or stop (Space)', onclick: togglePlay });
    bar.loop = h('button', { class: 'btn', title: 'On: the scene keeps repeating. Off: when it ends, the next scene plays.', onclick: () => { CR.proj.loop = !CR.proj.loop; saveProj(); renderToolbar(); } }, 'Loop');
    bar.bpm = h('span', { class: 'bpm-val', title: 'Tempo of the project. Click to type it, or scroll.', onclick: editBpm });
    bar.bpm.addEventListener('wheel', e => { e.preventDefault(); setBpm(CR.proj.bpm + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1)); }, { passive: false });
    bar.key = h('button', { class: 'btn', title: 'Key of the project: loops whose key is known can be moved into it', onclick: e => keyMenu(e.currentTarget) });
    bar.where = h('span', { class: 'hw-where' });
    bar.hw = h('button', { class: 'btn hw', title: 'Where the preview plays: the S-4\'s tracks (through its own effects), its main out, or an output on this computer', onclick: e => playMenu(e.currentTarget) },
      h('span', { class: 'dot' }), h('span', { class: 'lbl' }, 'Play on'), bar.where, S4.icon('chev'));
    tb.append(
      h('button', { class: 'btn', onclick: e => projectMenu(e.currentTarget) }, S4.icon('folder'), 'Project', S4.icon('chev')),
      bar.name,
      h('span', { class: 'tbar-sep' }),
      h('div', { class: 'bpm' },
        h('button', { class: 'ib', title: 'Slower (Shift: by 10)', onclick: e => setBpm(CR.proj.bpm - (e.shiftKey ? 10 : 1)) }, '−'),
        bar.bpm, h('span', { class: 'lbl' }, 'bpm'),
        h('button', { class: 'ib', title: 'Faster (Shift: by 10)', onclick: e => setBpm(CR.proj.bpm + (e.shiftKey ? 10 : 1)) }, '+')),
      h('span', { class: 'lbl' }, 'Key'), bar.key,
      h('span', { class: 'sp' }),
      bar.play, bar.loop,
      h('span', { class: 'tbar-sep' }),
      bar.hw,
      h('button', {
        class: 'btn primary',
        title: S4.drive.supported ? 'Write the project straight into the S-4\'s PROJECTS folder (the S-4 in USB storage mode)' : 'Download the project for the S-4 (a NAME.s4project folder in a zip)',
        onclick: () => (S4.drive.supported ? exportToS4() : exportProject()),
      }, S4.icon('export'), 'Export'));
    S4.drive.init();
  }

  function renderToolbar() {
    if (document.activeElement !== bar.name) bar.name.value = CR.proj.name;
    bar.play.replaceChildren(S4.icon(A.playing ? 'stop' : 'play'));
    bar.play.classList.toggle('on', A.playing);
    bar.loop.classList.toggle('on', !!CR.proj.loop);
    bar.bpm.textContent = CR.proj.bpm;
    bar.key.replaceChildren(CR.proj.key === 'NONE' ? 'None' : CR.proj.key, S4.icon('chev'));
    const HW = S4.hw;
    bar.hw.classList.toggle('on', HW.mode !== 'here');
    bar.where.textContent = HW.mode === 'tracks' ? 'S-4 tracks' : HW.mode === 'main' ? 'S-4 main out'
      : HW.settings.hereId ? outputName(HW.settings.hereLabel) || 'an output here' : 'This computer';
  }

  // ---------- Play on (hwpreview.js): the S-4's tracks, its main out, or an output on this computer ----------
  const outputName = label => (label || '').replace(/^Default - /, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '');
  async function playMenu(anchor) {
    const HW = S4.hw, mode = HW.mode;
    let outs = [];
    try { outs = await HW.listOutputs(false); } catch (e) { /* none listed */ }
    const named = outs.some(d => d.label), def = outs.find(d => d.deviceId === 'default');
    const s4There = !named || outs.some(d => HW.looksLikeS4(d.label));
    // (without names, the browser lists outputs without ids either: nothing to choose)
    // (the default is listed once more under its own name: one entry)
    const here = outs.filter(d => d.deviceId && d.deviceId !== 'default' && !HW.looksLikeS4(d.label) && !(def && outputName(def.label) === outputName(d.label)));
    const go = (m, dev) => async () => {
      try {
        await HW.playOn(m, dev);
        if (m === 'tracks') S4.toast('Playing on the S-4\'s tracks. Set all four to BYPASS: each plays its own USB input through the S-4\'s effects and mixer.');
        if (m === 'main') S4.toast('Playing on the S-4\'s main out: the mix as you hear it here.');
      } catch (e) { S4.toast(e.message, 'err'); }
    };
    const s4hint = s4There ? null : 'not connected';
    S4.menu(anchor, [
      { head: 'The S-4' },
      { label: 'Its tracks', hint: s4hint || 'through its own effects', checked: mode === 'tracks', disabled: !s4There, action: go('tracks') },
      { label: 'Its main out', hint: s4hint || 'the mix as heard here', checked: mode === 'main', disabled: !s4There, action: go('main') },
      { head: 'This computer' },
      { label: def && def.label ? outputName(def.label) : 'The default output', hint: def && HW.looksLikeS4(def.label) ? 'the S-4: its track 1' : 'default', checked: mode === 'here' && !HW.settings.hereId, action: go('here', null) },
      ...here.map(d => ({ label: outputName(d.label) || 'Output without a name', checked: mode === 'here' && HW.settings.hereId === d.deviceId, action: go('here', d) })),
      ...(named ? [] : [{ label: 'Show every output by name', hint: 'the browser asks for the microphone once', action: async () => {
        try { await HW.listOutputs(true); } catch (e) { return S4.toast('The outputs could not be named: ' + e.message, 'err'); }
        playMenu(anchor);
      } }]),
      ...(mode === 'here' ? [] : [
        { sep: true },
        ...(mode === 'tracks' ? [{ label: 'Send each scene\'s effects over MIDI', hint: 'GRANULAR FILTER COLOR SPACE', checked: HW.settings.pushFx, action: () => HW.setPushFx(!HW.settings.pushFx) }] : []),
        { label: mode === 'tracks' ? 'Test: a beep on T1 to T4, then the main out' : 'Test: a beep on the main out', action: () => HW.testAll() },
        { head: 'If the beeps land on the wrong tracks' },
        ...Object.entries(HW.ORDERS).map(([k, o]) => ({ label: o.label, checked: HW.order() === k, action: () => HW.setOrder(k) })),
      ]),
    ]);
  }

  function togglePlay() {
    if (A.playing) A.stop();
    else A.play(CR.sel.scene);
  }
  function setBpm(v) {
    v = S4.clamp(Math.round(v), 20, 300);
    if (v === CR.proj.bpm) return;
    CR.proj.bpm = v;
    saveProj();
    renderToolbar();
    renderInsp();
    A.tempoChanged();
  }
  function editBpm() {
    const v = parseFloat(prompt('Tempo of the project, in BPM:', CR.proj.bpm));
    if (v) setBpm(v);
  }
  // Setting a project key moves loops with a known key into it. Pitch can only change without the tempo
  // in STRETCH, so DISC and TAPE tracks that need a shift switch from SYNC to STRETCH.
  function keyMenu(anchor) {
    S4.menu(anchor, KEYS.map(k => ({ label: k === 'NONE' ? 'None' : k, checked: k === CR.proj.key, value: k })), v => {
      CR.proj.key = v;
      let switched = 0;
      if (v !== 'NONE') {
        CR.proj.scenes.forEach(sc => sc && sc.tracks.forEach(t => {
          if (A.canStretch(t) && t.tempo === 'sync' && t.sample && t.sample.bpm && S4.analysis.trackShift(t, v)) { t.tempo = 'stretch'; switched++; }
        }));
      }
      saveProj();
      renderToolbar();
      renderLanes();
      renderInsp();
      A.tempoChanged();
      if (switched) S4.toast(`${v}: ${switched} track${switched === 1 ? ' is' : 's are'} now in Stretch, so they can move into the key`);
    });
  }
  // ---------- project settings: the S-4 project's own settings, exported with it ----------
  // Stored values (measured): INPUT 0-3 as named on the screen; track inputs STEREO / IN1 / IN2 / SENDS ONLY = 0-3;
  // RUNNING settings ALWAYS = 0, WHEN PLAYING = 1; POST RECORD PLAY = 0, OVERDUB = 1; METER quantisation is a
  // step of S4.params.METER (0 NONE ... 7 4 BAR, read on the S-4); RULE 0-4 as named on the screen; CHANCE 0-1.
  // Scene QUANTIZE (saved on the S-4, 2026-10-20): '' STRAIGHT / 'triplet' / 'dotted' with a step of
  // S4.params.DIVS (6 = 1/2 read on the S-4); 'free' in Hz, 0.020 .. 50; 'sample end' with the track counted from 0;
  // 'off' (value 0).
  const SCN_RULES = ['NEXT', 'PREV', 'WALK', 'RANDOM', 'SAME'];
  const SCN_QMODES = [{ value: '', label: 'STRAIGHT' }, { value: 'triplet', label: 'TRIPLET' }, { value: 'dotted', label: 'DOTTED' },
    { value: 'free', label: 'FREE' }, { value: 'sample end', label: 'SAMPLE END' }, { value: 'off', label: 'OFF' }];
  const QNOTE = { '': '', triplet: 'T', dotted: 'D' }; // note-length modes and their suffix
  const QFREE = { key: 'quantize', curve: S4.params.curves.expo(0.02, 50, 8), unit: 'Hz', def: 0.5, label: '' }; // FREE: 0.020 .. 50 Hz
  // rows and controls of the settings panels; changed() saves
  function setHelpers(changed) {
    const row = (label, ...ctl) => h('div', { class: 'set-row' }, h('span', { class: 'lbl' }, label), h('div', { class: 'set-ctl' }, ...ctl));
    const head = text => h('div', { class: 'set-head lbl bright' }, text);
    const seg = (opts, val, set) => S4.seg(opts, val, v => { set(v); changed(); }, 'mini');
    const pick = (items, val, set) => {
      const b = h('button', { class: 'btn sm' }, (items.find(x => x.value === val) || { label: String(val) }).label, S4.icon('chev'));
      b.onclick = () => S4.menu(b, items.map(x => Object.assign({ checked: x.value === val }, x)), v => { set(v); val = v; b.firstChild.textContent = (items.find(x => x.value === v) || { label: String(v) }).label; changed(); });
      return b;
    };
    return { row, head, seg, pick, changed };
  }
  // the S-4's scene block (global_slots.scene.scene), made at the S-4's defaults when first edited
  const scnBlock = () => {
    const g = S4.s4p.global(CR.proj);
    g.scene = g.scene || {};
    return g.scene.scene || (g.scene.scene = { chance: { value: 1, mode: '' }, rule: { value: 0, mode: '' }, quantize: { value: 5, mode: '' } });
  };
  const peekScn = () => ((S4.s4p.peekGlobal(CR.proj).scene || {}).scene) || {};
  // RULE, CHANCE and QUANTIZE: in Project settings and in the scene list's Scene launch panel
  function sceneLaunchRows(ui) {
    const scn = peekScn();
    const beatsOf = i => 4 * eval(S4.params.DIVS[i]); // a note length in beats (4/4)
    const factor = m => (m === 'triplet' ? 2 / 3 : m === 'dotted' ? 1.5 : 1);
    const valBox = h('span', { class: 'set-pair' });
    const renderVal = () => {
      const q = peekScn().quantize || { value: 5, mode: '' }, m = q.mode || '';
      valBox.innerHTML = '';
      if (m in QNOTE) {
        valBox.append(ui.pick(S4.params.DIVS.map((d, i) => ({ label: d + QNOTE[m], value: i })), q.value, v => { scnBlock().quantize.value = v; }));
      } else if (m === 'sample end') {
        valBox.append(ui.seg([0, 1, 2, 3].map(t => ({ label: `TRACK ${t + 1}`, value: t })), q.value, v => { scnBlock().quantize.value = v; }));
      } else if (m === 'free') {
        // 0.020 .. 50 Hz (read on the S-4); exponential here for fine control at the low end
        valBox.append(S4.fader(S4.params.fader(QFREE, () => peekScn().quantize.value, v => { scnBlock().quantize.value = Math.round(v * 1e6) / 1e6; ui.changed(); }, { label: '' }), { layout: 'row', cls: 'qfree' }));
      }
    };
    // a new mode keeps the timing where it can: note length <-> Hz at the project tempo
    const setMode = m => {
      const q = scnBlock().quantize, was = q.mode || '';
      const hz = was in QNOTE ? CR.proj.bpm / 60 / (beatsOf(q.value) * factor(was)) : was === 'free' ? q.value : null;
      if (m in QNOTE) {
        if (!(was in QNOTE)) {
          const beats = hz ? CR.proj.bpm / 60 / hz / factor(m) : 4;
          q.value = S4.params.DIVS.reduce((b, _, i) => (Math.abs(Math.log(beatsOf(i) / beats)) < Math.abs(Math.log(beatsOf(b) / beats)) ? i : b), 5);
        }
      } else if (m === 'free') q.value = Math.round(S4.clamp(hz || CR.proj.bpm / 240, 0.02, 50) * 1e6) / 1e6;
      else if (m === 'sample end') q.value = was === 'sample end' ? q.value : 0;
      else q.value = 0;
      q.mode = m;
      renderVal();
    };
    renderVal();
    return [
      ui.row('RULE', ui.seg(SCN_RULES.map((l, i) => ({ label: l, value: i })), scn.rule ? scn.rule.value : 0, v => { scnBlock().rule = { value: v, mode: '' }; })),
      ui.row('CHANCE', S4.fader({
        get: () => { const b = peekScn(); return b.chance ? b.chance.value : 1; },
        set: v => { scnBlock().chance = { value: Math.round(v * 1000) / 1000, mode: '' }; ui.changed(); }, min: 0, max: 1, step: 0.01, def: 1, label: '', fmt: v => Math.round(v * 100) + '%',
      }, { layout: 'row' })),
      ui.row('QUANTIZE', ui.seg(SCN_QMODES, scn.quantize ? scn.quantize.mode || '' : '', setMode), valBox),
    ];
  }
  function settingsModal() {
    const S = () => S4.s4p.settings(CR.proj), G = () => S4.s4p.global(CR.proj);
    const ps = S4.s4p.peekSettings(CR.proj), pg = S4.s4p.peekGlobal(CR.proj);
    const changed = () => { saveProj(); };
    const ui = setHelpers(changed), { row, head, seg, pick } = ui;
    // METER quantisation and scene QUANTIZE use different lists (both read on the S-4's screen)
    const divs = S4.params.METER.map((d, i) => ({ label: d, value: i }));
    const T4 = [0, 1, 2, 3];
    const a = ps.audio_settings || {}, mi = ps.midi_settings || {}, me = ps.meter_settings || {}, sc = (ps.scene_settings || {}).tracks || [], pf = ps.perform_settings || {};
    const playing = (pg.mixer && pg.mixer.track_playing) || [true, true, true, true];
    const nameInput = key => h('input', {
      class: 'set-name', value: pf[key] || '', maxlength: 12, spellcheck: 'false',
      oninput: e => { (S().perform_settings = S().perform_settings || {})[key] = e.target.value.toUpperCase(); changed(); },
    });
    const body = h('div', { class: 'set-body' },
      h('div', { class: 'note' }, 'The S-4 project\'s own settings, written into the export. An imported project brings its own.'),
      head('Audio'),
      row('INPUT', seg(['IN1/IN2', 'MIC', 'IN1/MIC', 'HEADSET'].map((l, i) => ({ label: l, value: i })), a.input_source || 0, v => { S().audio_settings.input_source = v; })),
      row('MIC GAIN', S4.fader({ get: () => S4.s4p.peekSettings(CR.proj).audio_settings.mic_gain, set: v => { S().audio_settings.mic_gain = v; changed(); }, min: 0, max: 100, step: 1, def: 50, label: '' }, { layout: 'row' })),
      row('MONITOR ON RECORD', S4.onoff(!!a.monitor_on_record, v => { S().audio_settings.monitor_on_record = v; changed(); })),
      ...T4.map(t => row(`TRACK ${t + 1} INPUT`, seg(['STEREO', 'IN1', 'IN2', 'SENDS ONLY'].map((l, i) => ({ label: l, value: i })), a[`track${t + 1}_input`] || 0, v => { S().audio_settings[`track${t + 1}_input`] = v; }))),
      head('MIDI'),
      row('TRACK MIDI CHANNELS', ...T4.map(t => h('span', { class: 'set-pair' }, h('span', { class: 'dim small' }, `T${t + 1}`),
        pick(Array.from({ length: 16 }, (_, c) => ({ label: String(c + 1), value: c + 1 })), mi[`track${t + 1}_midi_channel`] || t + 1, v => { S().midi_settings[`track${t + 1}_midi_channel`] = v; })))),
      head('Meter'),
      row('TRACK PLAY', pick(divs, me.track_play_quantization, v => { S().meter_settings.track_play_quantization = v; })),
      row('TRACK RECORD', pick(divs, me.track_record_quantization, v => { S().meter_settings.track_record_quantization = v; })),
      row('MAIN RECORD', pick(divs, me.mix_record_quantization, v => { S().meter_settings.mix_record_quantization = v; })),
      row('MODULATORS RUNNING', seg([{ label: 'WHEN PLAYING', value: 1 }, { label: 'ALWAYS', value: 0 }], me.modulators_running == null ? 1 : me.modulators_running, v => { S().meter_settings.modulators_running = v; })),
      row('MOSAIC RUNNING', seg([{ label: 'WHEN PLAYING', value: 1 }, { label: 'ALWAYS', value: 0 }], me.fx_running == null ? 1 : me.fx_running, v => { S().meter_settings.fx_running = v; })),
      row('POST RECORD ACTION', seg([{ label: 'PLAY', value: 0 }, { label: 'OVERDUB', value: 1 }], me.post_record_action || 0, v => { S().meter_settings.post_record_action = v; })),
      head('Scenes'),
      ...sceneLaunchRows(ui),
      // KEEP SAMPLE / KEEP PARAMS: two independent switches per track
      ...T4.map(t => row(`TRACK ${t + 1} KEEP`, ...['sample', 'params'].map(key => h('button', {
        class: 'tb' + (sc[t] && sc[t][key] ? ' on' : ''), title: key === 'sample' ? 'KEEP SAMPLE: the track keeps its sample from scene to scene' : 'KEEP PARAMS: the track keeps its settings from scene to scene',
        onclick: e => {
          const s = S();
          s.scene_settings = s.scene_settings || { tracks: T4.map(() => ({ sample: false, params: false })) };
          const tt = s.scene_settings.tracks[t] || (s.scene_settings.tracks[t] = { sample: false, params: false });
          tt[key] = !tt[key];
          e.currentTarget.classList.toggle('on', tt[key]);
          changed();
        },
      }, key.toUpperCase())))),
      head('Mix'),
      row('TRACKS PLAYING ON LOAD', ...T4.map(t => h('button', {
        class: 'tb sq' + (playing[t] ? ' on' : ''), title: `T${t + 1} plays as soon as the project is loaded`,
        onclick: e => { const g = G(); g.mixer.track_playing = g.mixer.track_playing || [true, true, true, true]; g.mixer.track_playing[t] = !g.mixer.track_playing[t]; e.currentTarget.classList.toggle('on', g.mixer.track_playing[t]); changed(); },
      }, String(t + 1)))),
      head('Perform names'),
      h('div', { class: 'set-names' }, ...Array.from({ length: 8 }, (_, k) => h('label', null, h('span', { class: 'dim small' }, String(k + 1)), nameInput(`macro${k + 1}_name`))),
        ...Array.from({ length: 4 }, (_, k) => h('label', null, h('span', { class: 'dim small' }, String(k + 9)), nameInput(`action${k + 1}_name`)))),
    );
    S4.modal('Project settings', body, { cls: 'wide' });
  }

  function launchModal() {
    const ui = setHelpers(() => saveProj());
    S4.modal('Scene changes', h('div', { class: 'set-body' },
      h('div', { class: 'note' }, 'How the S-4 moves from one scene to the next (exported with the project; right-click a scene pad to CHAIN or LOCK it), and when the preview here switches.'),
      ui.head('On the S-4'),
      ...sceneLaunchRows(ui),
      ui.head('Here'),
      ui.row('Switch', ui.seg(LAUNCH, CR.proj.launch, v => { CR.proj.launch = v; }))), { cls: 'mid' });
  }
  function projectMenu(anchor) {
    const drive = S4.drive.supported ? [
      { head: 'S-4 drive (USB storage mode)' },
      { label: 'Export to the S-4', hint: S4.drive.label, action: exportToS4 },
      { label: 'Open a project from the S-4…', action: openFromS4 },
      { label: 'Choose the S-4 folder…', action: chooseS4Folder },
      { sep: true },
    ] : [];
    S4.menu(anchor, [
      ...drive,
      { label: 'New project', action: newProjectAction },
      { label: 'Project settings…', hint: 'S-4', action: settingsModal },
      { label: 'Perform: macros and modulators…', hint: 'S-4', action: performModal },
      { label: 'Mix modulators…', hint: 'S-4', action: mixModsModal },
      { sep: true },
      { label: 'Import an S-4 project folder…', hint: '.s4project', action: importS4Folder },
      { label: 'Import a project zip…', hint: '.zip', action: importProject },
      { sep: true },
      { label: 'Export as a zip for the S-4…', hint: '.zip', action: exportProject },
      { label: 'Back up for s4tools…', hint: '.zip', action: exportBackup },
      { sep: true },
      { label: 'Clear out unused samples', action: cleanCache },
    ]);
  }

  // ---------- render ----------
  function renderAll() {
    renderToolbar();
    renderPads();
    renderLanes();
    renderInsp();
  }

  function sceneName(sc) {
    if (!sc) return '';
    if (sc.name) return sc.name;
    const t = sc.tracks.find(x => x.sample || x.libRef);
    return t ? (t.sample ? t.sample.name : t.libRef.title) : '';
  }

  // The S-4's CHAIN and LOCK per scene (global_slots.scene_list_state), exported with the project.
  const sceneState = i => (S4.s4p.peekGlobal(CR.proj).scene_list_state || {})[String(i)] || { is_chained: false, is_locked: false };
  function setSceneState(i, key, v) {
    const g = S4.s4p.global(CR.proj);
    g.scene_list_state = g.scene_list_state || {};
    g.scene_list_state[String(i)] = Object.assign({ is_chained: false, is_locked: false }, g.scene_list_state[String(i)], { [key]: v });
    saveProj();
    renderPads();
  }
  function sceneMenu(e, i) {
    e.preventDefault();
    const ss = sceneState(i);
    S4.menu(e.currentTarget, [
      { head: `Scene ${S4.pad3(i + 1)}` },
      { label: 'Chain', hint: 'S-4: plays on into the next', checked: ss.is_chained, action: () => setSceneState(i, 'is_chained', !ss.is_chained) },
      { label: 'Lock', hint: 'S-4', checked: ss.is_locked, action: () => setSceneState(i, 'is_locked', !ss.is_locked) },
      { sep: true },
      { label: 'Rename…', action: () => renameScene(i) },
      { label: 'Copy to the next empty scene', action: () => { selectScene(i); dupScene(); } },
      { label: 'Clear…', danger: true, action: () => { selectScene(i); clearScene(); } },
    ]);
  }

  // ---------- scene pads: 16 x 8, or only the selected scene's row ----------
  function buildPads() {
    const short = () => padsEl.classList.contains('short');
    const fold = h('button', { class: 'ib' });
    const showFold = () => {
      fold.replaceChildren(S4.icon(short() ? 'down' : 'up'));
      fold.title = short() ? 'Show all eight rows' : 'Show only the row of the selected scene';
    };
    fold.addEventListener('click', () => {
      padsEl.classList.toggle('short', !short());
      S4.store.set('build.padsShort', short());
      showFold();
    });
    showFold();
    padsEl.append(
      h('div', { class: 'pads-head' },
        h('span', { class: 'lbl bright' }, 'Scenes'), padCount = h('span', { class: 'lbl' }),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn sm', title: 'Jump to the next empty scene', onclick: newSceneAction }, S4.icon('plus'), 'New'),
        h('button', { class: 'btn sm', title: 'Copy the selected scene into the next empty one', onclick: dupScene }, 'Copy'),
        h('button', { class: 'btn sm', title: 'Empty the selected scene', onclick: clearScene }, 'Clear'),
        h('button', { class: 'ib', title: 'Scene changes: RULE, CHANCE and QUANTIZE on the S-4, and when the preview switches', onclick: launchModal }, S4.icon('gear')),
        fold),
      padGrid = h('div', { class: 'padgrid' }));
  }

  function renderPads() {
    padGrid.innerHTML = '';
    let used = 0;
    CR.proj.scenes.forEach((sc, i) => {
      const empty = isEmpty(sc), ss = sceneState(i), nm = sceneName(sc);
      if (!empty) used++;
      padGrid.append(h('button', {
        class: 'pad' + (empty ? '' : ' used'),
        title: `${S4.pad3(i + 1)}${nm ? ' · ' + nm : ''}\nClick to edit it (while playing, it switches when the time comes). Double-click to rename; right-click for more.`,
        onclick: () => selectScene(i),
        ondblclick: () => renameScene(i),
        oncontextmenu: e => sceneMenu(e, i),
      },
      h('span', null, i + 1),
      h('span', { class: 'bars' }, [0, 1, 2, 3].map(t => h('i', { class: sc && (sc.tracks[t].sample || sc.tracks[t].libRef) ? 'on' + t : '' }))),
      ss.is_chained || ss.is_locked ? h('span', { class: 'marks' }, ss.is_chained ? S4.icon('chain') : null, ss.is_locked ? S4.icon('lock') : null) : null));
    });
    padCount.textContent = `${used} of 128 in use`;
    renderSceneStates();
  }

  function renderSceneStates() {
    if (!padGrid) return;
    const playingNow = A.playing && A.ctx && A.ctx.currentTime >= A.curStart - 0.02 ? A.cur : -1;
    const row = Math.floor(CR.sel.scene / 16);
    [...padGrid.children].forEach((p, i) => {
      p.classList.toggle('cur', i === CR.sel.scene);
      p.classList.toggle('playing', i === playingNow);
      p.classList.toggle('queued', !!(A.pending && A.pending.idx === i));
      p.classList.toggle('inrow', Math.floor(i / 16) === row);
    });
  }

  function selectScene(i) {
    if (CR.sel.scene !== i) {
      CR.sel.scene = i;
      if (A.hearing >= 0) A.stopHear();
      renderLanes();
      renderInsp();
    }
    if (A.playing && A.cur !== i) A.queue(i);
    renderSceneStates();
  }

  function renameScene(i) {
    const sc = CR.proj.scenes[i] || (CR.proj.scenes[i] = newScene());
    const v = prompt('Name of the scene (empty: its first sample\'s name):', sc.name || '');
    if (v == null) return;
    sc.name = v.trim();
    saveProj();
    renderPads();
  }

  function findEmptyAfter(i) {
    for (let k = 1; k < 128; k++) { const j = (i + k) % 128; if (isEmpty(CR.proj.scenes[j]) && !(CR.proj.scenes[j] && CR.proj.scenes[j].name)) return j; }
    return -1;
  }
  function newSceneAction() {
    const j = findEmptyAfter(CR.sel.scene);
    if (j < 0) return S4.toast('No empty scene left', 'err');
    selectScene(j);
  }
  function dupScene() {
    const from = CR.sel.scene;
    if (isEmpty(CR.proj.scenes[from])) return S4.toast('Nothing in this scene to copy');
    const j = findEmptyAfter(from);
    if (j < 0) return S4.toast('No empty scene left', 'err');
    CR.proj.scenes[j] = JSON.parse(JSON.stringify(CR.proj.scenes[from]));
    saveProj();
    renderPads();
    selectScene(j);
    S4.toast(`Scene ${S4.pad3(from + 1)} copied to ${S4.pad3(j + 1)}`);
  }
  function clearScene() {
    const i = CR.sel.scene;
    if (isEmpty(CR.proj.scenes[i]) && !(CR.proj.scenes[i] && CR.proj.scenes[i].name)) return;
    if (!confirm(`Empty scene ${S4.pad3(i + 1)}?`)) return;
    CR.proj.scenes[i] = null;
    saveProj();
    renderPads();
    renderLanes();
    renderInsp();
    if (A.playing && A.cur === i) [0, 1, 2, 3].forEach(t => A.restartTrack(t));
  }

  // ---------- lanes: the selected scene's four tracks ----------
  function renderLanes() {
    lanesEl.innerHTML = '';
    lanesEl.classList.toggle('expand', !!CR.expand);
    const sc = scene();
    sc.tracks.forEach((tr, i) => lanesEl.append(laneEl(tr, i)));
    if (CR.expand) lanesEl.append(editor(sc.tracks[CR.sel.track], CR.sel.track, true));
    gcObserved();
  }

  function selectTrack(i) {
    if (CR.sel.track === i) return;
    CR.sel.track = i;
    lanesEl.querySelectorAll('.blane').forEach((c, k) => c.classList.toggle('sel', k === i));
    if (CR.expand) renderLanes();
    renderInsp();
  }

  function mixChanged() { saveProj(); A.mixChanged(); }
  function structChanged(i) { saveProj(); A.trackChanged(CR.sel.scene, i, true); }

  function laneEl(tr, i) {
    const mx = CR.proj.mix.tracks[i];
    const anySolo = CR.proj.mix.tracks.some(t => t.solo);
    const s = tr.sample;
    const lane = h('div', { class: `blane tc${i}` + (CR.sel.track === i ? ' sel' : '') + (mx.mute || (anySolo && !mx.solo) ? ' muted' : '') });
    lane.addEventListener('pointerdown', () => selectTrack(i));

    const mat = h('button', { class: 'mat', title: 'What the track plays: DISC, TAPE or POLY, or BYPASS for live input' }, tr.device, S4.icon('chev'));
    mat.addEventListener('click', () => S4.menu(mat, MATERIALS.map(d => ({ label: d, value: d, checked: d === tr.device, hint: d === 'BYPASS' ? 'live input' : null })), v => {
      tr.device = v;
      if (!A.canStretch(tr) && tr.tempo === 'stretch') tr.tempo = 'sync'; // POLY plays notes, no tempo
      tr.tempo = tr.tempo === 'recorded' && v !== 'POLY' && tr.sample && tr.sample.bpm ? 'sync' : v === 'POLY' ? 'recorded' : tr.tempo;
      structChanged(i);
      renderLanes();
      renderInsp();
    }));
    const ms = (k, label) => h('button', {
      class: 'tb sq' + (mx[k] ? ' on' : ''),
      title: k === 'mute' ? 'Mute, in every scene (exported to the S-4)' : 'Solo, here only (the preview)',
      onclick: () => { mx[k] = !mx[k]; renderLanes(); mixChanged(); },
    }, label);

    let wave;
    if (tr.device === 'BYPASS') {
      wave = h('div', { class: 'bl-wave empty', title: 'BYPASS: the S-4 track plays its input through its effects (which input: Project settings)' },
        S4.icon('wave'), s ? 'Live input · the sample stays here, it isn\'t exported' : 'Live input');
    } else if (s) {
      const c = h('canvas', { 'data-sid': s.id });
      c._draw = () => {
        const tm = A.bufs.has(s.id) && tr.device !== 'POLY' ? loopFractions(tr) : null;
        A.draw(c, s.id, tm || { hiFrom: tr.trimIn, hiTo: tr.trimOut });
      };
      observe(c);
      ensureLoaded(tr, i);
      wave = h('div', { class: 'bl-wave' }, c, h('div', { class: 'ph', 'data-t': i }));
    } else if (tr.libRef) {
      wave = h('div', { class: 'bl-wave empty libref', title: tr.libRef.path, onclick: () => chooseFiles(i) },
        S4.icon('wave'), 'In the S-4\'s own library, not on this computer · exported as it is · drop a file to replace it');
    } else {
      wave = h('div', { class: 'bl-wave empty', title: 'Drop audio here, drag it from the Library, or click to pick a file', onclick: () => chooseFiles(i) },
        S4.icon('plus'), 'Drop a sample, or click to pick one');
    }

    const missing = s && CR.missing.has(s.id);
    lane.append(
      h('div', { class: 'bl-head' },
        h('span', { class: 'lane-name' }, 'T' + (i + 1)),
        mat,
        h('div', { class: 'lane-btns' }, ms('mute', 'M'), ms('solo', 'S'))),
      h('div', { class: 'bl-main' },
        wave,
        h('div', { class: 'bl-info' },
          h('span', { class: 'bl-name' + (missing ? ' missing' : ''), title: s ? (s.folder ? s.folder + '/' : '') + s.file : '' },
            missing ? `Missing: ${s.file}` : s ? s.name : tr.libRef ? tr.libRef.title : 'No sample'),
          s ? h('button', { class: 'tag tag-btn', title: bpmTitle(s), onclick: e => tempoMenu(e.currentTarget, tr, i) }, bpmMark(s) + (s.bpm ? fmtBpm(s.bpm) + ' bpm' : 'No tempo')) : null,
          s ? keyTag(tr, i) : null,
          h('span', { class: 'sp' }),
          s || tr.libRef ? h('button', { class: 'ib', title: 'Take the sample off this track', onclick: () => { tr.sample = null; tr.libRef = null; structChanged(i); renderLanes(); renderInsp(); renderPads(); } }, S4.icon('x')) : null)),
      h('div', { class: 'bl-mix', title: S4.hw.on ? 'Mixer, the same in every scene. You hear the S-4\'s own mixer now; these go into the export.' : 'Mixer, the same in every scene (the S-4\'s MIX page)' },
        S4.knob({
          get: () => A.dbToPos(mx.lvl), set: p => { mx.lvl = Math.round(A.posToDb(p) * 10) / 10; mixChanged(); },
          min: 0, max: 1, step: 0.005, def: 0.5, label: 'LVL', fmt: () => (mx.lvl <= -95 ? '-INF' : mx.lvl.toFixed(1)),
        }, { size: 'sm' }),
        S4.knob(mixModel(mx, 'pan', 'PAN'), { size: 'sm' }),
        S4.knob(mixModel(mx, 'fltr', 'FLTR'), { size: 'sm' })));

    lane.addEventListener('dragover', e => { e.preventDefault(); lane.classList.add('drag'); });
    lane.addEventListener('dragleave', e => { if (!lane.contains(e.relatedTarget)) lane.classList.remove('drag'); });
    lane.addEventListener('drop', e => {
      e.preventDefault();
      lane.classList.remove('drag');
      const k = e.dataTransfer.getData(LIB_TYPE);
      if (k !== '' && lib.files[+k]) loadInto(i, lib.files[+k]);
      else handleDrop(e, i);
    });
    return lane;
  }

  // Key tag: the sample's key (≈ when detected from the audio), with the move into the project key when it
  // is applied (STRETCH). Click for the key menu.
  const keySrcText = s => (s.keySrc === 'audio' ? `heard in the audio (tonal ${s.keyConf})` : s.keySrc === 'user' ? 'set by you' : 'read from the file name');
  function keyTag(tr, i) {
    const s = tr.sample;
    const open = e => keyMenuFor(e.currentTarget, tr, i);
    if (!s.key) return h('button', { class: 'tag tag-btn', title: 'No key, so it is never shifted (percussive). Click to detect or set one.', onclick: open }, 'No key');
    const d = S4.analysis.trackShift(tr, CR.proj.key);
    const on = d && tr.tempo === 'stretch' && A.canStretch(tr);
    const mark = s.keySrc === 'audio' ? '≈ ' : '';
    return h('button', {
      class: 'tag tag-btn' + (on ? ' on-key' : ''),
      title: `Key ${keySrcText(s)}` + (!d ? '' : on ? ` · shifted ${S4.signed(d)} semitones into ${CR.proj.key}` : ` · needs ${S4.signed(d)} st for ${CR.proj.key}: switch to STRETCH to shift it`) + ' · click to change',
      onclick: open,
    }, mark + (on ? `${s.key}→${CR.proj.key}` : s.key));
  }

  function setSampleKey(tr, i, key, src) {
    const s = tr.sample;
    s.key = key;
    s.keySrc = key ? src : null;
    // a key that now needs a shift: SYNC can't transpose without changing the tempo, STRETCH can
    if (key && tr.tempo === 'sync' && A.canStretch(tr) && S4.analysis.trackShift(tr, CR.proj.key)) tr.tempo = 'stretch';
    structChanged(i);
    renderLanes();
    renderInsp();
  }
  function keyMenuFor(anchor, tr, i) {
    const s = tr.sample;
    const items = [
      { head: s.key ? `${s.key} · ${keySrcText(s)}` : 'No key (percussive)' },
      { label: 'Listen for the key', action: () => {
        const buf = A.bufs.get(s.id), k = buf && S4.analysis.key(buf);
        if (!k) return S4.toast('This sample couldn\'t be analysed', 'err');
        s.keyConf = k.tonal;
        if (k.tuningStrength >= 0.6) s.tune = k.tuning;
        if (k.tonal < KEY_TONAL) S4.toast(`No clear key (tonal ${k.tonal}, at best ${k.key}), so it stays as it was`, 'err');
        else { setSampleKey(tr, i, k.key, 'audio'); S4.toast(`${k.key} (tonal ${k.tonal}${s.tune ? `, ${S4.signed(s.tune)} cents off A440` : ''})`); }
      } },
      { label: 'No key (percussive)', checked: !s.key, action: () => setSampleKey(tr, i, null, null) },
    ];
    if (s.tune && A.canStretch(tr)) {
      items.push({ label: `Tune it to A440 (FINE ${S4.signed(-s.tune)} c)`, disabled: tr.tempo !== 'stretch' || A.warpMode(tr) === 's4', action: () => { tr.cents = S4.clamp(-s.tune, -50, 50); structChanged(i); renderInsp(); } });
    }
    items.push({ sep: true }, { head: 'Its key is' });
    KEYS.slice(1).forEach(k => items.push({ label: k, checked: k === s.key, action: () => setSampleKey(tr, i, k, 'user') }));
    S4.menu(anchor, items);
  }

  function mixModel(mx, key, label) {
    return { get: () => mx[key], set: v => { mx[key] = v; mixChanged(); }, min: -64, max: 63, step: 1, def: 0, bi: true, center: 0, label, fmt: v => S4.signed(v) };
  }

  // Loop region of a DISC/TAPE track as fractions of the whole sample, for the waveform highlight.
  function loopFractions(tr) {
    const r = A.loopRegion(tr), raw = A.bufs.get(tr.sample.id);
    if (!r || !raw) return null;
    const base = tr.trimIn * raw.duration;
    return { hiFrom: (base + r.ls) / raw.duration, hiTo: Math.min(tr.trimOut, (base + r.le) / raw.duration) };
  }

  function ensureLoaded(tr, i) {
    const s = tr.sample;
    if (A.bufs.has(s.id) || CR.missing.has(s.id)) return;
    A.need(s.id).then(buf => {
      if (s.dur == null) { s.dur = buf.duration; s.sr = buf.sampleRate; s.ch = buf.numberOfChannels; saveProj(); }
      if (CR.sel.track === i) renderInsp();
    }).catch(() => {
      if (CR.missing.has(s.id)) return;
      CR.missing.add(s.id);
      S4.toast(`${s.file} is missing (scene ${S4.pad3(CR.sel.scene + 1)}, T${i + 1}): this browser no longer has a copy. Drop the file on the track again.`, 'err');
      renderLanes();
    });
  }

  const fmtBpm = b => (Math.round(b * 10) / 10).toString();
  // ● from the file name or set by you, ≈ detected from the audio, ~ guessed from the length
  const bpmMark = s => (s.bpmSrc === 'audio' ? '≈ ' : s.bpmSrc === 'est' ? '~ ' : '● ');
  const bpmTitle = s => (!s.bpm ? 'No tempo found, so the sample plays as recorded'
    : s.bpmSrc === 'name' ? 'Tempo read from the file name'
      : s.bpmSrc === 'user' ? 'Tempo set by you'
        : s.bpmSrc === 'audio' ? `Tempo heard in the audio (confidence ${s.bpmConf})`
          : 'Tempo guessed from the length (whole bars), as the audio has no clear beat') + '. Click to double, halve or change it.';

  function setSampleBpm(tr, i, bpm, src) {
    tr.sample.bpm = Math.round(bpm * 10) / 10;
    tr.sample.bpmSrc = src;
    tr.length = null;
    if (tr.tempo === 'recorded' && tr.device !== 'POLY') tr.tempo = 'sync';
    structChanged(i);
    renderLanes();
    renderInsp();
  }
  function tempoMenu(anchor, tr, i) {
    const s = tr.sample, b = s.bpm;
    S4.menu(anchor, [
      { head: b ? `${fmtBpm(b)} bpm` : 'No tempo' },
      { label: `Double it: ${b ? fmtBpm(b * 2) : '—'}`, disabled: !b || b * 2 > 300, action: () => setSampleBpm(tr, i, b * 2, 'user') },
      { label: `Halve it: ${b ? fmtBpm(b / 2) : '—'}`, disabled: !b || b / 2 < 30, action: () => setSampleBpm(tr, i, b / 2, 'user') },
      { label: 'Listen for the beat', action: () => {
        const buf = A.bufs.get(s.id), det = buf && S4.analysis.tempo(buf, { near: CR.proj.bpm });
        if (!det) return S4.toast('No clear beat in this sample', 'err');
        s.bpmConf = det.confidence;
        setSampleBpm(tr, i, det.bpm, 'audio');
        S4.toast(`${fmtBpm(det.bpm)} bpm (confidence ${det.confidence}${det.loop ? ', whole bars' : ''})`);
      } },
      { label: 'Type it…', action: () => { const v = parseFloat(prompt('Tempo of the sample, in BPM:', b || CR.proj.bpm)); if (v >= 30 && v <= 300) setSampleBpm(tr, i, v, 'user'); } },
    ]);
  }

  // ---------- loading samples ----------
  function hashStr(str) {
    let x = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193); }
    return (x >>> 0).toString(36);
  }
  const relPath = f => f._rel || f.webkitRelativePath || f.name;

  function analyse(fname, buf) {
    const base = fname.replace(/\.[^.]+$/, '');
    const dur = buf.duration;
    let bpm = null, bpmSrc = null, bpmConf = null;
    const m = base.match(/(\d{2,3}(?:[.,]\d+)?)\s*[-_ ]?bpm/i) || base.match(/bpm\s*[-_ ]?(\d{2,3}(?:[.,]\d+)?)/i);
    if (m) { bpm = parseFloat(m[1].replace(',', '.')); bpmSrc = 'name'; }
    if (!bpm && dur >= 1.5) {
      // From the audio, unless there is no clear beat. (Benchmarked on real loops and drummers: a
      // weak detection is still right far more often than a guess from the length.)
      const det = S4.analysis.tempo(buf, { near: CR.proj.bpm });
      if (det && det.confidence >= 2.5) { bpm = det.bpm; bpmSrc = 'audio'; bpmConf = det.confidence; }
    }
    if (!bpm && dur >= 1) {
      // Assume a loop of whole bars; pick the bar count whose tempo is nearest the project's.
      let best = null;
      for (const beats of [4, 8, 16, 32, 64, 128]) {
        const b = (beats * 60) / dur;
        if (b < 60 || b > 200) continue;
        if (!best || Math.abs(Math.log(b / CR.proj.bpm)) < Math.abs(Math.log(best / CR.proj.bpm))) best = b;
      }
      if (best) { bpm = Math.round(best * 10) / 10; bpmSrc = 'est'; }
    }
    // Key from the name, else from the audio when it has a clear pitch centre (a tuned kick counts);
    // otherwise percussive. Tuning (cents from A440) is kept when it is consistent.
    let key = keyFromName(base), keySrc = key ? 'name' : null, keyConf = null, tune = null;
    if (!key && dur >= 0.5) {
      const k = S4.analysis.key(buf);
      if (k && k.tonal >= KEY_TONAL) { key = k.key; keySrc = 'audio'; keyConf = k.tonal; }
      if (k && k.tuningStrength >= 0.6 && Math.abs(k.tuning) >= 5) tune = k.tuning;
    }
    return { name: base, dur, sr: buf.sampleRate, ch: buf.numberOfChannels, bpm, bpmSrc, bpmConf, key, keySrc, keyConf, tune };
  }
  // Chroma peakiness above which a detected key is used (benchmark: keyed modular drum loops 4.0-12,
  // acoustic drum kits mostly 1.7-3.3).
  const KEY_TONAL = 4;

  function keyFromName(base) {
    for (const tok of base.split(/[_\-\s.()[\]]+/)) {
      const m = tok.match(/^(key)?([A-Ga-g])(#|b|s|sharp|flat)?(m|min|minor|maj|major|M)?$/i);
      if (!m) continue;
      if (!m[1] && !m[3] && !m[4]) continue; // a bare letter is too ambiguous
      let idx = NOTES.indexOf(m[2].toUpperCase());
      if (m[3]) idx += /^(#|s|sharp)$/i.test(m[3]) ? 1 : -1;
      const minor = m[4] && m[4] !== 'M' && /^m(in|inor)?$/i.test(m[4]);
      return NOTES[(idx + 12) % 12] + (minor ? 'm' : '');
    }
    return null;
  }

  // Tempo mode for a newly loaded sample: STRETCH when it has to move into the project key (or the
  // track is already in STRETCH), SYNC when its tempo is known, otherwise AS RECORDED.
  function defaultTempo(tr) {
    const s = tr.sample;
    if (tr.device === 'POLY' || !s || !s.bpm) return 'recorded';
    if (A.canStretch(tr) && (tr.tempo === 'stretch' || S4.analysis.trackShift(tr, CR.proj.key))) return 'stretch';
    return 'sync';
  }

  async function loadInto(i, file) {
    const sceneIdx = CR.sel.scene;
    const sc = CR.proj.scenes[sceneIdx] || (CR.proj.scenes[sceneIdx] = newScene());
    const tr = sc.tracks[i];
    try {
      const bytes = await file.arrayBuffer();
      const id = 'S' + hashStr(file.name + '|' + file.size + '|' + file.lastModified);
      const rel = relPath(file);
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      await S4.idb.put({ id, name: file.name, folder, bytes, type: file.type });
      const buf = await A.decode(id, bytes);
      CR.missing.delete(id);
      tr.sample = Object.assign({ id, file: file.name, folder }, analyse(file.name, buf));
      tr.libRef = null;
      Object.assign(tr, { start: 0, length: null, trimIn: 0, trimOut: 1, pStart: 0, pLen: 100, fadeIn: 0, fadeOut: 0 });
      tr.tempo = defaultTempo(tr);
      structChanged(i);
      if (CR.sel.scene === sceneIdx) { renderLanes(); renderInsp(); }
      renderPads();
    } catch (e) {
      console.error(e);
      S4.toast(`${file.name} didn't load: ${e.message || 'this browser can\'t read that audio format'}`, 'err');
    }
  }

  async function chooseFiles(i) {
    const files = (await S4.pickFiles({ accept: 'audio/*,.wav,.aif,.aiff,.flac,.mp3', multiple: true })).filter(f => AUDIO_EXT.test(f.name));
    if (!files.length) return;
    if (files.length > 1) { setLibrary(files, 'Picked files'); S4.toast(`The other ${files.length - 1} are in the Library`); }
    loadInto(i, files[0]);
  }

  // files (or whole folders) dropped from the computer
  async function droppedFiles(e) {
    const items = [...(e.dataTransfer.items || [])];
    const entries = items.map(it => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    const dir = entries.find(en => en.isDirectory);
    const files = (dir ? await readEntries(entries) : [...e.dataTransfer.files]).filter(f => AUDIO_EXT.test(f.name));
    return { files, name: dir ? dir.name : 'Dropped files' };
  }
  async function handleDrop(e, i) {
    const { files, name } = await droppedFiles(e);
    if (!files.length) return S4.toast('Nothing in there is audio', 'err');
    if (files.length > 1) { setLibrary(files, name); S4.toast(`The other ${files.length - 1} are in the Library`); }
    loadInto(i, files[0]);
  }

  // ---------- Library: a folder of samples to listen to and drag onto the lanes ----------
  // Browsers can't keep a folder between visits without asking again, so it is picked each time.
  const LIB_TYPE = 'application/x-s4tools-sample';
  const LIB_MAX = 400; // rows drawn at once; the search narrows the rest
  const lib = { files: [], name: '', q: '', dur: new Map() };
  let aud = null; // the file being listened to: { el, url, k }

  function buildLibrary() {
    const toggle = h('button', { class: 'ib lib-toggle' }, S4.icon('library'));
    const showToggle = () => { toggle.title = root.classList.contains('lib-off') ? 'Show the Library' : 'Hide the Library'; };
    toggle.addEventListener('click', () => {
      const off = !root.classList.contains('lib-off');
      root.classList.toggle('lib-off', off);
      S4.store.set('build.libOff', off);
      showToggle();
      if (off) stopAudition();
      root.querySelectorAll('canvas').forEach(c => c._draw && c._draw());
    });
    showToggle();
    const search = h('input', { type: 'search', placeholder: 'Search', spellcheck: 'false', oninput: e => { lib.q = e.target.value; renderLibrary(); } });
    libEl.append(
      h('div', { class: 'lib-head' }, toggle, h('span', { class: 'lbl bright' }, 'Library'), h('span', { class: 'sp' }),
        h('button', { class: 'btn sm', title: 'Pick a folder of samples on this computer', onclick: chooseLibFolder }, S4.icon('folder'), 'Folder…')),
      h('div', { class: 'lib-search' }, S4.icon('search'), search),
      libList = h('div', { class: 'lib-list' }));
    libEl.addEventListener('dragover', e => { if (!e.dataTransfer.types.includes(LIB_TYPE)) e.preventDefault(); });
    libEl.addEventListener('drop', async e => {
      if (e.dataTransfer.types.includes(LIB_TYPE)) return;
      e.preventDefault();
      const { files, name } = await droppedFiles(e);
      if (files.length) setLibrary(files, name); else S4.toast('Nothing in there is audio', 'err');
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && aud) stopAudition(); });
    renderLibrary();
  }

  async function chooseLibFolder() {
    const files = (await S4.pickFiles({ directory: true })).filter(f => AUDIO_EXT.test(f.name))
      .sort((a, b) => relPath(a).localeCompare(relPath(b)));
    if (!files.length) return S4.toast('That folder has no audio files in it', 'err');
    setLibrary(files);
  }
  function setLibrary(files, name) {
    stopAudition();
    lib.files = files;
    lib.name = name || relPath(files[0]).split('/')[0];
    lib.dur.clear();
    renderLibrary();
  }

  const fmtDur = d => (d < 60 ? d.toFixed(1) + ' s' : `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`);
  function renderLibrary() {
    libList.innerHTML = '';
    if (!lib.files.length) {
      libList.append(h('div', { class: 'lib-empty' },
        h('p', null, 'Pick a folder of samples (or drop one here) to browse it. Click a file to listen, then drag it onto a track, or use the 1–4 buttons that show when you point at it.'),
        h('p', null, 'Browsers don\'t let a page keep a folder between visits, so you pick it again next time.')));
      return;
    }
    const q = lib.q.trim().toLowerCase(), hits = [];
    lib.files.forEach((f, k) => { if (!q || relPath(f).toLowerCase().includes(q)) hits.push(k); });
    libList.append(h('div', { class: 'lib-count' }, `${lib.name} · ${q ? `${hits.length} of ${lib.files.length}` : lib.files.length} files`));
    hits.slice(0, LIB_MAX).forEach(k => libList.append(libItem(k)));
    if (hits.length > LIB_MAX) libList.append(h('div', { class: 'lib-empty' }, `${hits.length - LIB_MAX} more. Search to narrow the list.`));
  }
  function libItem(k) {
    const f = lib.files[k], rel = relPath(f), sub = rel.split('/').slice(1, -1).join('/'), d = lib.dur.get(k);
    return h('div', {
      class: 'lib-item' + (aud && aud.k === k ? ' playing' : ''), draggable: 'true', 'data-k': k,
      title: `${rel}\nClick to listen; drag onto a track to load it`,
      onclick: () => audition(k),
      ondragstart: e => { e.dataTransfer.setData(LIB_TYPE, String(k)); e.dataTransfer.effectAllowed = 'copy'; },
    },
    h('div', { class: 'lib-txt' }, h('div', { class: 'lib-name' }, f.name.replace(/\.[^.]+$/, '')), sub ? h('div', { class: 'lib-sub' }, sub) : null),
    h('div', { class: 'lib-right' },
      d != null ? h('span', { class: 'lib-dur' }, fmtDur(d)) : null,
      h('div', { class: 'lib-to' }, [0, 1, 2, 3].map(t => h('button', {
        style: { background: `var(--t${t + 1})` }, title: `Load into track ${t + 1} of the selected scene`,
        onclick: e => { e.stopPropagation(); loadInto(t, f); },
      }, t + 1)))));
  }
  function audition(k) {
    const again = aud && aud.k === k;
    stopAudition();
    if (again) return;
    if (A.hearing >= 0) A.stopHear();
    const f = lib.files[k], url = URL.createObjectURL(f), el = new Audio(url);
    aud = { el, url, k };
    el.addEventListener('loadedmetadata', () => {
      if (!isFinite(el.duration)) return;
      lib.dur.set(k, el.duration);
      const row = libList.querySelector(`.lib-item[data-k="${k}"]`);
      if (row) row.replaceWith(libItem(k));
    });
    el.addEventListener('ended', () => { if (aud && aud.el === el) stopAudition(); });
    el.play().catch(() => { if (aud && aud.el === el) { stopAudition(); S4.toast(`${f.name} can't be played in this browser`, 'err'); } });
    markPlaying();
  }
  function stopAudition() {
    if (!aud) return;
    aud.el.pause();
    aud.el.removeAttribute('src'); // stop loading before the file's URL goes
    aud.el.load();
    URL.revokeObjectURL(aud.url);
    aud = null;
    markPlaying();
  }
  const markPlaying = () => libList && libList.querySelectorAll('.lib-item').forEach(el => el.classList.toggle('playing', !!aud && aud.k === +el.dataset.k));

  async function readEntries(entries) {
    const out = [];
    for (const en of entries) {
      if (en.isFile) {
        const f = await new Promise((res, rej) => en.file(res, rej));
        f._rel = en.fullPath.replace(/^\//, '');
        out.push(f);
      } else if (en.isDirectory) {
        const r = en.createReader(), kids = [];
        let batch;
        do { batch = await new Promise((res, rej) => r.readEntries(res, rej)); kids.push(...batch); } while (batch.length);
        out.push(...await readEntries(kids));
      }
    }
    return out.sort((a, b) => relPath(a).localeCompare(relPath(b)));
  }

  // ---------- bottom: scene/track info, parameters, sample editor ----------
  const beatsStr = b => {
    const bars = Math.floor(b / 4 + 1e-9);
    const rest = Math.round((b - bars * 4) * 1000) / 1000;
    return `${bars}:${rest}`;
  };

  function totalBeats(tr) {
    const s = tr.sample;
    if (!s || !s.bpm) return 0;
    const d = A.derived(tr);
    const dur = d ? d.duration : (s.dur || 0) * (tr.trimOut - tr.trimIn);
    return Math.max(gridBeats(tr.grid), Math.round((dur * s.bpm) / 60 * 1000) / 1000);
  }

  function gridLabel(tr, text, i) {
    const b = h('button', { class: 'gridsel', title: 'The step START and LENGTH move in' }, tr.grid);
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', e => {
      e.stopPropagation();
      S4.menu(b, GRIDS.map(g => ({ label: g[0], value: g[0], checked: g[0] === tr.grid })), v => {
        tr.grid = v;
        const g = gridBeats(v);
        tr.start = Math.round(tr.start / g) * g;
        if (tr.length) tr.length = Math.max(g, Math.round(tr.length / g) * g);
        structChanged(i);
        renderInsp();
      });
    });
    return h('span', null, b, ' ' + text);
  }

  // GRANULAR / FILTER / COLOR / SPACE: exact values in the S-4's own units (s4params.js). The hardware
  // preview sends the nearest of the 128 MIDI steps; the export writes the exact value.
  const P = S4.params;
  const FX_ROWS = [
    { row: 'granular', slot: 'granular', dev: 'MOSAIC', label: 'GRANULAR' },
    { row: 'filter', slot: 'filter', dev: 'RING', label: 'FILTER' },
    { row: 'color', slot: 'color', dev: 'DEFORM', label: 'COLOR' },
    { row: 'space', slot: 'space', dev: 'VAST', label: 'SPACE' },
  ];
  const fxRow = () => FX_ROWS.find(f => f.row === CR.sel.row);
  // A track's settings for one device, { on, n: { key: value } }; created with the S-4's defaults when asked
  // (VAST on, its two wets are its levels). Off is the S-4's BYPASS: the settings stay.
  function fxOf(tr, dev, create) {
    const cur = tr.fx && tr.fx[dev];
    if (cur || !create) return cur || null;
    tr.fx = tr.fx || {};
    return (tr.fx[dev] = { on: dev === 'VAST', n: P.defaults(P.DEV[dev].params) });
  }
  const fxOn = (tr, dev) => !!(tr.fx && tr.fx[dev] && tr.fx[dev].on);
  // set on the S-4 in a project imported before exact values, and not changed here: exported as it was
  const fxImported = (tr, f) => !fxOf(tr, f.dev) && !!(tr.s4raw && tr.s4raw[f.slot] && Object.keys(tr.s4raw[f.slot]).length);
  // SPEED / PITCH in the S-4's modes: a scale steps through its notes over ±36 semitones, FREE is continuous.
  // The mode is exported with the value (s4project.js: dspMode / speedSt, pitchMode, tspMode).
  const SCALE_ITEMS = P.SCALE_IDS.map(id => ({ value: id, label: id.toUpperCase() }));
  const FREE36 = P.curves.lin(-36, 36);
  const stSpec = (curve, label, o) => Object.assign({ key: 'st', curve, unit: 'st', def: 0, label, detent: 0 }, o);
  function chip(text, items, cur, onPick, title) {
    const b = h('button', { class: 'gridsel', title }, (items.find(x => x.value === cur) || { label: String(cur).toUpperCase() }).label);
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', e => { e.stopPropagation(); S4.menu(b, items.map(x => Object.assign({ checked: x.value === cur }, x)), v => { if (v !== cur) onPick(v); }); });
    return h('span', null, b, ' ' + text);
  }
  const snapTo = (curve, v) => curve.to(curve.from(S4.clamp(v, -36, 36)));
  const modeChanged = () => { saveProj(); renderInsp(); };
  // a fader for semitones on a scale's steps (or FREE)
  const stFader = (curve, free, get, set, label) => P.fader(stSpec(curve, typeof label === 'string' ? label : 'SPEED', free ? { step: 0.01 } : { int: true }), get, set, { label });
  // DISC SPEED: as recorded OCTAVES, a scale or FREE. In SYNC the S-4 offers no choice and moves it in octaves
  // (a scale stored there still sets its steps, VERIFY5: kept only when imported or carried over from FREE).
  function discSpeed(tr, after) {
    const cur = tr.dspMode || 'octaves';
    const items = tr.tempo === 'recorded'
      ? [{ value: 'octaves', label: 'OCTAVES' }, ...SCALE_ITEMS.filter(x => x.value !== 'octaves'), { value: 'free', label: 'FREE' }]
      : [{ value: 'octaves', label: 'OCTAVES' }].concat(cur !== 'octaves' ? [{ value: cur, label: cur.toUpperCase(), hint: 'as stored; the S-4 has no choice in SYNC' }] : []);
    const label = items.length === 1 ? 'SPEED' : chip('SPEED', items, cur, v => {
      if (v === 'octaves') { tr.speed = S4.clamp(Math.round((tr.speedSt || 0) / 12), -3, 3); delete tr.dspMode; delete tr.speedSt; }
      else { const st = cur === 'octaves' ? (tr.speed || 0) * 12 : tr.speedSt || 0; tr.dspMode = v; tr.speedSt = v === 'free' ? st : snapTo(P.scaleCurve(v), st); }
      after(); modeChanged();
    }, 'DISC SPEED mode on the S-4: OCTAVES, a scale (semitones on its notes) or FREE');
    if (cur === 'octaves') return { label, get: () => tr.speed || 0, set: v => { tr.speed = v; after(); }, min: -3, max: 3, step: 1, def: 0, bi: true, center: 0, ticks: true, fmt: v => (v ? S4.signed(v) + ' OCT' : '0') };
    return stFader(cur === 'free' ? FREE36 : P.scaleCurve(cur), cur === 'free', () => tr.speedSt || 0, v => { tr.speedSt = v; after(); }, label);
  }
  function stretchPitch(tr, after) {
    const cur = tr.pitchMode || 'chromatic';
    const label = chip('PITCH', SCALE_ITEMS, cur, v => {
      tr.pitchMode = v === 'chromatic' ? undefined : v;
      if (!tr.pitchMode) delete tr.pitchMode;
      tr.pitchSt = snapTo(P.scaleCurve(v), tr.pitchSt || 0);
      after(); modeChanged();
    }, 'PITCH mode of the S-4\'s stretch: a scale it steps through (the shift into the project key stays chromatic)');
    return stFader(P.scaleCurve(cur), false, () => tr.pitchSt || 0, v => { tr.pitchSt = v; after(); }, label);
  }
  function tapeSpeed(tr, after) {
    const items = [{ value: 'auto', label: 'AUTO', hint: 'mode from the value' }, { value: 'octaves', label: 'OCTAVES' },
      ...SCALE_ITEMS.filter(x => x.value !== 'octaves'), { value: 'free', label: 'FREE' }];
    const cur = tr.tspMode === undefined ? 'auto' : tr.tspMode === '' ? 'octaves' : tr.tspMode;
    const label = chip('SPEED', items, cur, v => {
      const st = tr.speed || 0;
      if (v === 'auto') { delete tr.tspMode; tr.speed = Math.round(st); }
      else { tr.tspMode = v === 'octaves' ? '' : v; tr.speed = v === 'free' ? st : snapTo(P.scaleCurve(v), st); }
      after(); modeChanged();
    }, 'TAPE SPEED mode on the S-4. AUTO picks OCTAVES / CHROMATIC / FREE from the value (SYNC adds a FREE tempo correction)');
    if (cur === 'auto') return { label, get: () => tr.speed || 0, set: v => { tr.speed = v; after(); }, min: -24, max: 24, step: 1, def: 0, bi: true, center: 0, fmt: v => S4.signed(v) + ' ST' };
    return stFader(cur === 'free' ? FREE36 : P.scaleCurve(cur), cur === 'free', () => tr.speed || 0, v => { tr.speed = v; after(); }, label);
  }
  function polyPitch(tr, after) {
    const cur = tr.pitchMode === 'free' ? 'free' : 'chromatic';
    const label = chip('PITCH', [{ value: 'chromatic', label: 'CHROMATIC' }, { value: 'free', label: 'FREE' }], cur, v => {
      if (v === 'free') tr.pitchMode = 'free'; else { delete tr.pitchMode; tr.pitch = Math.round(tr.pitch || 0); }
      after(); modeChanged();
    }, 'POLY PITCH mode on the S-4: CHROMATIC (semitones) or FREE');
    if (cur === 'chromatic') return { label, get: () => tr.pitch || 0, set: v => { tr.pitch = v; after(); }, min: -12, max: 12, step: 1, def: 0, bi: true, center: 0, fmt: v => S4.signed(v) + ' ST' };
    return stFader(P.curves.lin(-12, 12), true, () => tr.pitch || 0, v => { tr.pitch = v; after(); }, label);
  }

  // SENDS: this track into the inputs of tracks 1-4 (itself included), dB per scene (track_output on the S-4;
  // −100 is off). Not reachable over MIDI, so the hardware preview doesn't hear them; the export writes them.
  const SEND_SPEC = n => ({ key: 'send' + n, curve: P.curves.rexp(-100, 0, 4), unit: 'dB', def: -100, label: `TO T${n}` });
  const sendOf = (tr, n) => { const b = S4.s4p.peek(tr, 'track_output'), x = b && b.track_output && b.track_output['send' + n]; return x && typeof x.value === 'number' ? x.value : -100; };
  function sendModels(tr) {
    return [1, 2, 3, 4].map(n => exact(SEND_SPEC(n), () => sendOf(tr, n), v => {
      const b = S4.s4p.block(tr, 'track_output');
      if (!b.track_output) b.track_output = Object.fromEntries([1, 2, 3, 4].map(k => ['send' + k, { value: sendOf(tr, k), mode: '' }]));
      b.track_output['send' + n] = { value: Math.round(v * 1e6) / 1e6, mode: '' };
      saveProj();
      const r = inspEl.querySelector('.itab[data-tab="sends"]');
      if (r) r.classList.toggle('lit', sendsOn(tr).length > 0);
    }));
  }
  const sendsOn = tr => [1, 2, 3, 4].filter(n => sendOf(tr, n) > -100);
  // MODULATORS: the track's 4 modulators in this scene and their routings (mods.js), as the S-4 stores them.
  const Mods = S4.mods;
  const modSel = { n: 1 };
  const modBlock = (tr, n) => S4.s4p.peek(tr, 'modulator' + n);
  const modRoutes = tr => [0, 1, 2, 3].reduce((a, k) => a + Mods.routes(S4.s4p.peek(tr, 'modulator_mappings'), String(k)).length, 0);
  const trackRoutes = tr => ({
    peek: () => S4.s4p.peek(tr, 'modulator_mappings'),
    edit: () => S4.s4p.block(tr, 'modulator_mappings'),
    targets: () => Mods.trackTargets(tr.device, n => Mods.typeOf(modBlock(tr, n), n - 1)),
  });
  function modPanel(tr) {
    const holder = h('div', { class: 'mod-holder' });
    const draw = () => {
      holder.replaceChildren(Mods.editor({
        sel: modSel, peek: n => modBlock(tr, n), edit: n => S4.s4p.block(tr, 'modulator' + n), routes: trackRoutes(tr),
        changed: () => {
          saveProj();
          const r = inspEl.querySelector('.itab[data-tab="mods"]');
          if (r) r.classList.toggle('lit', modRoutes(tr) > 0);
        },
        rerender: draw,
      }));
    };
    draw();
    return holder;
  }

  // PERFORM: the 8 macros and 4 action macros (values, routings into the tracks and the mix) and the 4 Perform
  // modulators, which route into the macros. Project-wide on the S-4 (global_slots).
  const macroName = k => {
    const pf = S4.s4p.peekSettings(CR.proj).perform_settings || {};
    return pf[k < 8 ? `macro${k + 1}_name` : `action${k - 7}_name`] || `MACRO ${k + 1}`;
  };
  function performModal() {
    const sel = { macro: 0, mod: { n: 1 } };
    const body = h('div', { class: 'set-body' });
    const G = () => S4.s4p.global(CR.proj);
    const changed = () => saveProj();
    const render = () => {
      const pg = S4.s4p.peekGlobal(CR.proj), k = sel.macro, sc = scene();
      const perf = (pg.perform && pg.perform.perform) || {};
      const key = k < 8 ? 'macro' + (k + 1) : 'action' + (k - 7);
      const liveMacro = () => { const g = G(); g.perform = g.perform || {}; g.perform.perform = g.perform.perform || {}; return g.perform.perform; };
      const value = k < 8
        ? S4.fader({
          get: () => { const p = (S4.s4p.peekGlobal(CR.proj).perform || {}).perform || {}; return p[key] ? p[key].value : 0; },
          set: v => { const p = liveMacro(); p[key] = { value: Math.round(v * 1e6) / 1e6, mode: p[key] ? p[key].mode || '' : '' }; changed(); },
          min: -1, max: 1, step: 0.002, def: 0, bi: true, label: '', fmt: v => (v > 0 ? '+' : '') + Math.round(v * 1000) / 10 + '%',
        }, { layout: 'row' })
        : h('button', {
          class: 'tb sm' + (perf[key] && perf[key].value ? ' on' : ''), title: 'On (held) when the project loads',
          onclick: e => { const p = liveMacro(), v = !(p[key] && p[key].value); p[key] = { value: v ? 1 : 0 }; e.currentTarget.classList.toggle('on', v); changed(); },
        }, 'On');
      const trackRouteList = t => Mods.routeList({
        peek: () => (S4.s4p.peekGlobal(CR.proj).track_mappings || [])[t],
        edit: () => { const g = G(); g.track_mappings = g.track_mappings || [{}, {}, {}, {}]; return g.track_mappings[t] || (g.track_mappings[t] = {}); },
        targets: () => Mods.trackTargets(sc.tracks[t].device, n => Mods.typeOf(modBlock(sc.tracks[t], n), n - 1)),
      }, String(k), changed, render, `Nothing on T${t + 1}.`);
      const mixRouteList = Mods.routeList({
        peek: () => S4.s4p.peekGlobal(CR.proj).mix_mappings,
        edit: () => G().mix_mappings || (G().mix_mappings = {}),
        targets: Mods.mixTargets,
      }, String(k), changed, render, 'Nothing in the mix.');
      body.replaceChildren(
        h('div', { class: 'note' }, 'The S-4\'s PERFORM page, written into the export. Routings are for the whole project; MATERIAL targets follow the device the track has in the selected scene. The names are in Project settings.'),
        h('div', { class: 'set-head lbl bright' }, 'Macros'),
        S4.seg(Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), value: i })), k, v => { sel.macro = v; render(); }, 'mini'),
        h('div', { class: 'set-row' }, h('span', { class: 'lbl' }, `${macroName(k)} · ${k < 8 ? 'value' : 'action'}`), h('div', { class: 'set-ctl' }, value)),
        ...[0, 1, 2, 3].map(t => h('div', { class: 'perf-dest' }, h('div', { class: 'lbl' }, `T${t + 1}`), trackRouteList(t))),
        h('div', { class: 'perf-dest' }, h('div', { class: 'lbl' }, 'Mix'), mixRouteList),
        h('div', { class: 'set-head lbl bright' }, 'Perform modulators'),
        Mods.editor({
          sel: sel.mod,
          peek: n => S4.s4p.peekGlobal(CR.proj)['modulator' + n],
          edit: n => { const g = G(); return g['modulator' + n] || (g['modulator' + n] = {}); },
          routes: { peek: () => S4.s4p.peekGlobal(CR.proj).modulator_mappings, edit: () => G().modulator_mappings || (G().modulator_mappings = {}), targets: () => Mods.macroTargets(macroName) },
          changed, rerender: render,
        }));
    };
    render();
    S4.modal('Perform', body, { cls: 'wide' });
  }
  // MIX modulators: 4 slots routed into the mixer (levels, pans, filters, compressor, main level).
  function mixModsModal() {
    const sel = { n: 1 };
    const body = h('div', { class: 'set-body' });
    const G = () => S4.s4p.global(CR.proj);
    const render = () => body.replaceChildren(
      h('div', { class: 'note' }, 'The S-4\'s MIX modulators, written into the export. They run on the S-4.'),
      Mods.editor({
        sel,
        peek: n => (S4.s4p.peekGlobal(CR.proj).mixer || {})['modulator' + n],
        edit: n => { const m = G().mixer; return m['modulator' + n] || (m['modulator' + n] = {}); },
        routes: { peek: () => (S4.s4p.peekGlobal(CR.proj).mixer || {}).modulator_mappings, edit: () => { const m = G().mixer; return m.modulator_mappings || (m.modulator_mappings = {}); }, targets: Mods.mixTargets },
        changed: () => saveProj(), rerender: render,
      }));
    render();
    S4.modal('Mix modulators', body, { cls: 'wide' });
  }

  // the material's switches on the S-4 (tr.ex.mat), as the S-4 stored them until changed here
  const MAT_SWITCHES = { DISC: [['reverse', 0], ['freeze', 0], ['loop', 1], ['monitor', 0]], TAPE: [['reverse', 0], ['monitor', 0]] };
  const MAT_HINT = { loop: 'counts only when LENGTH is longer than the sample: off plays it once, then it is quiet until the loop starts again' };
  function matSwitch(tr, dev, key, def) {
    const d = dev.toLowerCase(), ex = tr.ex && tr.ex.mat && tr.ex.mat[d];
    if (ex && ex[key] != null) return !!ex[key];
    const blk = tr.s4raw && tr.s4raw.material && tr.s4raw.material[d];
    return blk && blk[key] ? !!blk[key].value : !!def;
  }
  function matSwitches(tr) {
    const list = MAT_SWITCHES[tr.device];
    if (!list) return [];
    return list.map(([key, def]) => h('button', {
      class: 'tb sm' + (matSwitch(tr, tr.device, key, def) ? ' on' : ''),
      title: `${key.toUpperCase()} on the S-4: exported, not heard in the preview` + (MAT_HINT[key] ? `. ${key.toUpperCase()} ${MAT_HINT[key]}` : ''),
      onclick: e => {
        const v = !matSwitch(tr, tr.device, key, def);
        tr.ex = tr.ex || {};
        tr.ex.mat = tr.ex.mat || {};
        (tr.ex.mat[tr.device.toLowerCase()] = tr.ex.mat[tr.device.toLowerCase()] || {})[key] = v ? 1 : 0;
        e.currentTarget.classList.toggle('on', v);
        saveProj();
      },
    }, key.toUpperCase()));
  }

  // A parameter's S-4 mode: the label with a chip that picks the mode. A mode that changes the units carries the
  // value over at the same knob position. The hardware preview can't switch modes (MIDI has no way to).
  function modeLabel(tr, i, fr, sp, mode) {
    const cur = P.modeOf(sp, mode);
    const b = h('button', { class: 'gridsel', title: `${sp.label} mode on the S-4, exported. MIDI can't change modes, so playing on the S-4's tracks uses whatever the S-4 has.` },
      cur ? cur.label : mode.toUpperCase());
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      S4.menu(b, sp.modes.map(x => ({ label: x.label, value: x.id, checked: x.id === mode, hint: x.curve || x.unit ? 'other units' : null })), id => {
        if (id === mode) return;
        const e = fxOf(tr, fr.dev, true);
        const v = e.n[sp.key] != null ? e.n[sp.key] : P.inMode(sp, mode).def;
        e.n[sp.key] = P.convert(sp, mode, id, v);
        e.md = Object.assign({}, e.md);
        if (id) e.md[sp.key] = id; else delete e.md[sp.key];
        e.on = true;
        saveProj();
        S4.emit('build-fx', CR.sel.scene, i);
        renderInsp();
      });
    });
    return h('span', null, b, ' ' + sp.label);
  }
  // further material parameters, tr.mx[device][key]; the S-4's default until set
  const mxGet = (tr, device, sp) => (tr.mx && tr.mx[device] && tr.mx[device][sp.key] != null ? tr.mx[device][sp.key] : sp.def);
  const mxSet = (tr, device, sp, v) => { tr.mx = tr.mx || {}; (tr.mx[device] = tr.mx[device] || {})[sp.key] = v; };
  // fader for an exact value; randomizing stays within the parameter's safe range
  const exact = (sp, get, set, o) => Object.assign(P.fader(sp, get, set, o), { safePos: ((S4.param(o && o.dev, sp.cc) || {}).safeMax || 127) / 127 });

  function paramModels(tr, i) {
    const after = () => { structChanged(i); redrawTrack(i); };
    const m = (obj, key, o) => Object.assign({ get: () => obj[key], set: v => { obj[key] = v; after(); }, step: 1, def: 0 }, o);
    if (CR.sel.row === 'sends') return sendModels(tr);
    if (CR.sel.row === 'mods') return [];
    const fr = fxRow();
    if (fr) {
      // moving any knob switches the device on; a parameter with modes shows its mode, the value is in its units
      return P.DEV[fr.dev].params.map(sp => {
        const e0 = fxOf(tr, fr.dev), mode = (e0 && e0.md && e0.md[sp.key]) || '', ms = P.inMode(sp, mode);
        return exact(ms,
          () => { const e = fxOf(tr, fr.dev); return e && e.n[sp.key] != null ? e.n[sp.key] : ms.def; },
          v => {
            const e = fxOf(tr, fr.dev, true);
            e.n[sp.key] = v;
            if (!e.on) { e.on = true; showFxOn(fr, true); }
            saveProj();
            S4.emit('build-fx', CR.sel.scene, i);
          }, { dev: fr.dev, label: sp.modes ? modeLabel(tr, i, fr, sp, mode) : undefined });
      });
    }
    const s = tr.sample;
    const xfade = m(tr, 'xfade', { label: 'XFADE', min: 0, max: 127 });
    // The device's own LEVEL in dB on the S-4's level curve: per scene on the S-4 (the mixer LVL is project-wide).
    const level = exact({ key: 'level', curve: P.LEVEL, unit: 'dB', def: 0, label: 'LEVEL' },
      () => S4.clamp(tr.lvl, -100, 12), v => { tr.lvl = v; saveProj(); A.trackChanged(CR.sel.scene, i, false); });
    // further material parameters (exported; POLY's envelope is also heard in the preview)
    const extras = device => P.MAT[device].map(sp => exact(sp, () => mxGet(tr, device, sp), v => {
      mxSet(tr, device, sp, v);
      if (device === 'POLY') structChanged(i); else saveProj();
    }));
    if (tr.device === 'BYPASS') return [];
    if (tr.device === 'POLY') {
      return [
        polyPitch(tr, after),
        m(tr, 'pStart', { label: 'START', min: 0, max: 99, fmt: v => v + '%' }),
        m(tr, 'pLen', { label: 'LENGTH', min: 1, max: 100, def: 100, fmt: v => v + '%' }),
        { label: 'LOOP', min: 0, max: 2, step: 1, def: 0, ticks: true, get: () => ['off', 'loop', 'pingpong'].indexOf(tr.loopMode), set: v => { tr.loopMode = ['off', 'loop', 'pingpong'][v]; after(); }, fmt: v => ['OFF', 'LOOP', 'PING-PONG'][v] },
        xfade,
        ...extras('POLY'),
        level,
      ];
    }
    const total = totalBeats(tr);
    const g = gridBeats(tr.grid);
    const noTempo = !s || !s.bpm;
    const out = [];
    if (A.canStretch(tr) && tr.tempo === 'stretch') {
      // STRETCH: pitch moves without the tempo. The key shift is added on top (shown under KEY). FINE is
      // rendered by the app; the S-4's own stretch only takes whole semitones.
      out.push(tr.device === 'DISC' && A.warpMode(tr) === 's4' ? stretchPitch(tr, after)
        : m(tr, 'pitchSt', { label: 'PITCH', min: -24, max: 24, bi: true, center: 0, fmt: v => S4.signed(v) + ' ST' }));
      out.push(m(tr, 'cents', { label: 'FINE', min: -50, max: 50, bi: true, center: 0, disabled: A.warpMode(tr) === 's4', fmt: v => S4.signed(v) + ' C' }));
    } else out.push(tr.device === 'DISC' ? discSpeed(tr, after) : tapeSpeed(tr, after));
    if (A.canStretch(tr)) {
      out.push({
        label: (s ? bpmMark(s).replace('●', '◆') : '') + 'TEMPO', min: 40, max: 300, step: 1, def: s && s.bpm ? Math.round(s.bpm) : 120, disabled: !s,
        get: () => (s && s.bpm ? Math.round(s.bpm) : 120),
        set: v => { if (!s) return; s.bpm = v; s.bpmSrc = 'user'; if (tr.length) tr.length = null; after(); },
        fmt: v => (s && s.bpm ? fmtBpm(s.bpm) : '—'),
      });
    }
    if (tr.device === 'DISC') {
      out.push({
        label: gridLabel(tr, 'START', i), min: 0, max: Math.max(0, total - g), step: g, def: 0, disabled: noTempo,
        get: () => tr.start, set: v => { tr.start = v; if (tr.length && tr.start + tr.length > total) tr.length = null; after(); },
        fmt: v => (noTempo ? '—' : beatsStr(v)),
      });
    }
    out.push({
      label: gridLabel(tr, 'LENGTH', i), min: g, max: Math.max(g, total - (tr.device === 'DISC' ? tr.start : 0)), step: g, def: total, disabled: noTempo,
      get: () => (tr.length || Math.max(g, total - (tr.device === 'DISC' ? tr.start : 0))),
      set: v => { const full = total - (tr.device === 'DISC' ? tr.start : 0); tr.length = v >= full - 1e-6 ? null : v; after(); },
      fmt: v => (noTempo ? '—' : beatsStr(v)),
    });
    out.push(xfade, level, ...extras(tr.device));
    return out;
  }

  const WARP_HELP = 'BEATS cuts at the hits and keeps each attack (drums, percussion). TONES uses grains (single notes, bass). '
    + 'COMPLEX works on the spectrum (chords, pads, whole mixes). S-4 renders nothing: the S-4 stretches the original itself (whole semitones only).';

  function tempoNote(tr) {
    const s = tr.sample;
    if (!s) return 'No sample on this track.';
    if (tr.device === 'POLY') return 'POLY plays it as notes; the tempo isn\'t matched.';
    if (!s.bpm) return 'No tempo found, so it plays as recorded.';
    if (tr.tempo === 'recorded') return `Plays as recorded (${fmtBpm(s.bpm)} bpm).`;
    const r = CR.proj.bpm / s.bpm, fits = Math.abs(r - 1) < 0.001;
    if (tr.tempo === 'stretch') {
      const long = s.dur > A.STRETCH_MAX_SECONDS, w = A.warpMode(tr);
      return (fits ? 'Already at tempo; ' : `${fmtBpm(s.bpm)} → ${CR.proj.bpm} bpm, `) + 'pitch stays. '
        + (w === 's4' ? 'The S-4 stretches it as it plays (the preview uses TONES).' : `${S4.warp.LABELS[w]}, rendered into the export.`)
        + (long ? ' Too long to render here, so the preview changes its speed.' : '');
    }
    return fits ? 'Already at tempo.' : `${fmtBpm(s.bpm)} → ${CR.proj.bpm} bpm: speed ×${r.toFixed(3)}, and the pitch moves with it.`;
  }

  function keyNote(tr) {
    const s = tr.sample;
    if (!s || tr.device === 'POLY') return null;
    if (!s.key) return 'No key, so it isn\'t shifted. The "No key" tag on the lane detects or sets one.';
    const k = (s.keySrc === 'audio' ? '≈ ' : '') + s.key;
    if (CR.proj.key === 'NONE') return `${k}. Give the project a key (toolbar) to move loops into it.`;
    const d = S4.analysis.trackShift(tr, CR.proj.key);
    if (tr.followKey === false) return `${k}, left as it is (the project is in ${CR.proj.key}).`;
    if (!d) return `${k}: already in ${CR.proj.key}.`;
    return A.canStretch(tr) && tr.tempo === 'stretch' ? `${k} → ${CR.proj.key}, ${S4.signed(d)} semitones.` : `${k} → ${CR.proj.key} takes ${S4.signed(d)} semitones, which only Stretch can do.`;
  }

  // ---------- inspector: the selected track, in tabs ----------
  const TABS = [['sample', 'Sample'], ['fx', 'Effects'], ['sends', 'Sends'], ['mods', 'Mods']];
  let lastFx = 'granular';
  const HELP = 'Values are in the S-4\'s own units. Click a value to type it, Shift-drag for fine moves, double-click for the default. '
    + 'Playing on the S-4\'s tracks sends the nearest of the 128 MIDI steps; the export writes the exact value.';

  function renderInsp() {
    inspEl.innerHTML = '';
    const i = CR.sel.track, tr = scene().tracks[i];
    const tab = FX_ROWS.some(f => f.row === CR.sel.row) ? 'fx' : CR.sel.row;
    inspEl.className = 'bd-insp tc' + i;
    const lit = { fx: FX_ROWS.some(f => fxOn(tr, f.dev)), sends: sendsOn(tr).length > 0, mods: modRoutes(tr) > 0 };
    const body = h('div', { class: 'ibody' },
      h('div', { class: 'ihead' }, h('span', { class: 'lbl bright' }, `Scene ${S4.pad3(CR.sel.scene + 1)} · Track ${i + 1}`), h('span', { class: 'lbl' }, tr.device)));
    inspEl.append(h('div', { class: 'itabs' }, TABS.map(([k, label]) => h('button', {
      class: 'itab' + (tab === k ? ' on' : '') + (lit[k] ? ' lit' : ''), 'data-tab': k,
      onclick: () => { CR.sel.row = k === 'fx' ? lastFx : k; renderInsp(); },
    }, label))), body);
    if (tab === 'fx') fxTab(body, tr, i);
    else if (tab === 'sends') sendsTab(body, tr);
    else if (tab === 'mods') modsTab(body, tr);
    else sampleTab(body, tr, i);
    gcObserved();
  }

  const knobGrid = models => h('div', { class: 'kgrid' }, models.map(md => S4.knob(md)));
  // Reset and Randomize for a tab's knobs; an effect resets to a fresh device (on, the S-4's defaults)
  function actions(models, fr, tr, i) {
    return h('div', { class: 'ihead' },
      h('button', {
        class: 'btn sm', title: 'Back to the S-4\'s defaults',
        onclick: () => {
          if (fr) {
            const e = fxOf(tr, fr.dev, true);
            e.n = P.defaults(P.DEV[fr.dev].params);
            e.md = {};
            e.on = true;
            saveProj();
            S4.emit('build-fx', CR.sel.scene, i);
          } else models.forEach(md => !md.disabled && md.def != null && md.set(md.def));
          renderInsp();
        },
      }, S4.icon('reset'), 'Reset'),
      h('button', {
        class: 'btn sm', title: 'Roll random values (tempo, levels and offsets stay)',
        onclick: () => {
          models.forEach(md => {
            if (md.disabled || /TEMPO|LEVEL|OFFSET/.test(typeof md.label === 'string' ? md.label : '')) return;
            if (md.taper) return md.set(md.quant(md.taper.val(Math.random() * (md.safePos || 1))));
            const hi = md.safeMax != null ? md.safeMax : md.max;
            const n = Math.round((hi - md.min) / (md.step || 1));
            md.set(md.min + Math.floor(Math.random() * (n + 1)) * (md.step || 1));
          });
          renderInsp();
        },
      }, S4.icon('random'), 'Randomize'));
  }

  function sampleTab(body, tr, i) {
    CR.sel.row = 'sample';
    const s = tr.sample;
    const canSync = s && s.bpm && tr.device !== 'POLY';
    const setTempo = v => { tr.tempo = v; structChanged(i); redrawTrack(i); renderLanes(); renderInsp(); };
    const modes = [{ label: 'Sync to ' + CR.proj.bpm, value: 'sync', disabled: !canSync }];
    if (A.canStretch(tr)) modes.push({ label: 'Stretch', value: 'stretch', disabled: !canSync });
    modes.push({ label: 'As recorded', value: 'recorded' });
    const kn = keyNote(tr);
    const needsStretch = s && s.key && A.canStretch(tr) && tr.tempo !== 'stretch' && canSync && S4.analysis.trackShift(tr, CR.proj.key);
    // how the stretch is rendered; S-4 leaves it to the hardware (DISC only)
    const warps = S4.warp.MODES.map(w => ({ label: S4.warp.LABELS[w], value: w }));
    if (tr.device === 'DISC') warps.push({ label: 'S-4', value: 's4' });
    if (tr.device === 'BYPASS') {
      body.append(h('p', { class: 'note' }, 'BYPASS plays the track\'s live input through its effects, so there is no sample to set up. ' + (s ? 'The sample stays here but isn\'t exported.' : '')));
      return;
    }
    if (tr.device !== 'POLY') body.append(h('div', { class: 'lbl' }, 'Tempo'), S4.seg(modes, canSync ? tr.tempo : 'recorded', setTempo, 'wide'));
    if (canSync && A.canStretch(tr) && tr.tempo === 'stretch') {
      body.append(h('div', { class: 'keyrow', title: WARP_HELP }, h('span', { class: 'lbl' }, 'Warp'),
        S4.seg(warps, A.warpMode(tr), v => { tr.warp = v; structChanged(i); renderInsp(); }, 'mini')));
    }
    body.append(h('div', { class: 'note' }, tempoNote(tr)));
    if (kn) {
      body.append(
        h('div', { class: 'keyrow' },
          h('span', { class: 'lbl' }, 'Key'),
          s && s.key && CR.proj.key !== 'NONE' ? S4.seg([{ label: 'Follow', value: true }, { label: 'Leave', value: false }], tr.followKey !== false,
            v => { tr.followKey = v; structChanged(i); renderLanes(); renderInsp(); }, 'mini') : null,
          needsStretch && tr.followKey !== false ? h('button', { class: 'btn sm', onclick: () => setTempo('stretch') }, 'Use Stretch') : null),
        h('div', { class: 'note' }, kn));
    }
    const models = paramModels(tr, i);
    body.append(
      h('div', { class: 'ihead isec', title: HELP }, h('span', { class: 'lbl bright' }, tr.device), h('span', { class: 'sp' }), h('div', { class: 'sw-row' }, matSwitches(tr))),
      knobGrid(models),
      actions(models, null, tr, i));
    if (CR.expand) body.append(h('div', { class: 'ed' }, h('p', { class: 'note' }, 'The sample editor is open in the middle.')));
    else body.append(editor(tr, i, false));
  }

  function fxTab(body, tr, i) {
    const fr = fxRow() || FX_ROWS[0];
    lastFx = CR.sel.row = fr.row;
    const e = fxOf(tr, fr.dev), sending = S4.hw.on && S4.hw.settings.pushFx;
    const note = fxImported(tr, fr) ? 'As it came from the S-4. It is written back unchanged unless you change it here.'
      : !e ? (sending ? 'Not set: the S-4 gets its defaults, as in the export.' : 'Not set: the export leaves the S-4\'s defaults.')
        : e.on ? (sending ? 'Sent to the S-4 while the scene plays, and exported exactly.' : 'Exported exactly.')
          : (sending ? 'Bypassed: WET goes to 0 on the S-4 while previewing. The export bypasses it and keeps the settings.' : 'Bypassed: the export bypasses it and keeps the settings.');
    const models = paramModels(tr, i);
    body.append(
      S4.seg(FX_ROWS.map(f => ({ label: f.dev, value: f.row })), fr.row, v => { CR.sel.row = lastFx = v; renderInsp(); }, 'mini wide'),
      h('div', { class: 'ihead', title: HELP },
        h('span', { class: 'lbl bright' }, `${fr.label} · ${fr.dev}`),
        h('span', { class: 'sp' }),
        // not set: the S-4's default device, which is on
        S4.seg([{ label: 'On', value: true }, { label: 'Bypass', value: false }], !e || e.on, v => {
          fxOf(tr, fr.dev, true).on = v;
          saveProj();
          S4.emit('build-fx', CR.sel.scene, i);
          renderInsp();
        }, 'mini fx-onoff')),
      h('div', { class: 'note' }, note),
      knobGrid(models),
      actions(models, fr, tr, i));
  }

  function sendsTab(body, tr) {
    const models = sendModels(tr);
    body.append(
      h('div', { class: 'note' }, 'How much of this track goes into the inputs of tracks 1–4 (itself too), per scene. MIDI can\'t reach the sends, so only the export has them; the preview doesn\'t.'),
      knobGrid(models),
      actions(models, null, tr, CR.sel.track));
  }

  function modsTab(body, tr) {
    body.append(
      h('div', { class: 'note' }, 'The track\'s four modulators in this scene and where they go. They run on the S-4; the preview doesn\'t play them.'),
      modPanel(tr));
  }

  // A knob switched an effect on: update its On / Bypass switch and the tab without rebuilding the panel
  // (that would end the drag).
  function showFxOn(f, on) {
    const seg = inspEl.querySelector('.fx-onoff');
    if (seg) { seg.children[0].classList.toggle('on', on); seg.children[1].classList.toggle('on', !on); }
    const t = inspEl.querySelector('.itab[data-tab="fx"]');
    if (t && on) t.classList.add('lit');
  }

  function redrawTrack(i) {
    const lane = lanesEl.querySelectorAll('.blane')[i];
    const c = lane && lane.querySelector('canvas');
    if (c && c._draw) c._draw();
  }

  // the sample editor: trims, fades and Audition. big: in place of the lanes
  function editor(tr, i, big) {
    const s = tr.sample;
    const wave = h('div', { class: 'ed-wave' });
    if (!s) wave.append(h('div', { class: 'note padded' }, `Track ${i + 1} has no sample in this scene.`));
    else {
      const c = h('canvas', { 'data-sid': s.id });
      const mkIn = h('div', { class: 'mk mk-in', title: 'Where the sample starts (drag)' }, h('span', null, 'IN'));
      const mkOut = h('div', { class: 'mk mk-out', title: 'Where the sample ends (drag)' }, h('span', null, 'OUT'));
      const place = () => { mkIn.style.left = tr.trimIn * 100 + '%'; mkOut.style.left = tr.trimOut * 100 + '%'; };
      c._draw = () => { A.draw(c, s.id, { hiFrom: tr.trimIn, hiTo: tr.trimOut }); drawFades(c, tr); };
      observe(c);
      place();
      wave.append(c, mkIn, mkOut, h('div', { class: 'ph', 'data-t': i }));
      const drag = (mk, which) => mk.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        S4.capture(mk, e.pointerId);
        const r = wave.getBoundingClientRect();
        const move = ev => {
          const f = S4.clamp((ev.clientX - r.left) / r.width, 0, 1);
          if (which === 'in') tr.trimIn = Math.min(f, tr.trimOut - 0.002);
          else tr.trimOut = Math.max(f, tr.trimIn + 0.002);
          place();
          c._draw();
        };
        const up = () => {
          mk.removeEventListener('pointermove', move);
          mk.removeEventListener('pointerup', up);
          tr.start = 0;
          tr.length = null;
          structChanged(i);
          redrawTrack(i);
          if (big) renderLanes();
          renderInsp();
        };
        mk.addEventListener('pointermove', move);
        mk.addEventListener('pointerup', up);
      });
      drag(mkIn, 'in');
      drag(mkOut, 'out');
    }
    const fadeModel = (k, label) => ({
      get: () => tr[k], set: v => { tr[k] = v; structChanged(i); const c = wave.querySelector('canvas'); if (c) c._draw(); },
      min: 0, max: 2000, step: 5, def: 0, label, fmt: v => v + ' ms', disabled: !s,
    });
    const hear = h('button', { class: 'btn sm hear', title: 'Hear this track of the scene on its own', disabled: !s || null, onclick: () => A.hear(i) });
    const el = h('div', { class: big ? `ed big-ed tc${i}` : 'ed' },
      h('div', { class: 'ihead' },
        h('span', { class: 'lbl bright' }, 'Trim and fades'),
        big ? S4.seg([0, 1, 2, 3].map(t => ({ label: 'T' + (t + 1), value: t })), i, v => selectTrack(v), 'mini') : null,
        s && s.dur ? h('span', { class: 'lbl' }, `${s.dur.toFixed(2)} s · ${s.sr / 1000} kHz · ${s.ch === 1 ? 'mono' : 'stereo'}`) : null,
        h('span', { class: 'sp' }),
        h('button', { class: 'ib', title: big ? 'Back to the lanes' : 'Open the editor big, in place of the lanes', onclick: () => { CR.expand = !CR.expand; renderLanes(); renderInsp(); } }, S4.icon(big ? 'x' : 'expand'))),
      wave,
      h('div', { class: 'ed-row' }, hear, h('span', { class: 'sp' }), S4.knob(fadeModel('fadeIn', 'Fade in'), { size: 'sm' }), S4.knob(fadeModel('fadeOut', 'Fade out'), { size: 'sm' })));
    el._hear = hear;
    showHear(el);
    return el;
  }

  function showHear(el) {
    const on = A.hearing === CR.sel.track;
    el._hear.replaceChildren(S4.icon(on ? 'stop' : 'play'), on ? 'Stop' : 'Audition');
    el._hear.classList.toggle('on', on);
  }
  const updateHear = () => root && root.querySelectorAll('.ed').forEach(el => el._hear && showHear(el));

  function drawFades(c, tr) {
    const raw = A.bufs.get(tr.sample.id);
    if (!raw || (!tr.fadeIn && !tr.fadeOut)) return;
    const g = c.getContext('2d'), w = c.clientWidth, ht = c.clientHeight;
    g.strokeStyle = getComputedStyle(c).getPropertyValue('--ink').trim() || '#333';
    g.lineWidth = 1;
    g.beginPath();
    if (tr.fadeIn) {
      const x0 = tr.trimIn * w, x1 = Math.min(tr.trimOut, tr.trimIn + tr.fadeIn / 1000 / raw.duration) * w;
      g.moveTo(x0, ht); g.lineTo(x1, 1);
    }
    if (tr.fadeOut) {
      const x1 = tr.trimOut * w, x0 = Math.max(tr.trimIn, tr.trimOut - tr.fadeOut / 1000 / raw.duration) * w;
      g.moveTo(x0, 1); g.lineTo(x1, ht);
    }
    g.stroke();
  }

  // ---------- playheads ----------
  function frame() {
    requestAnimationFrame(frame);
    if (!visible || !root) return;
    const active = A.playing || A.hearing >= 0;
    root.querySelectorAll('.ph').forEach(ph => {
      const i = +ph.dataset.t;
      const showing = (A.playing && A.cur === CR.sel.scene) || A.hearing === i;
      const p = active && showing ? A.position(i) : null;
      if (p == null) ph.style.display = 'none';
      else { ph.style.display = 'block'; ph.style.left = p * 100 + '%'; }
    });
  }

  // ---------- project: new / export / import ----------
  function newProjectAction() {
    if (CR.proj.scenes.some(sc => !isEmpty(sc)) && !confirm('Start a new project? This one is replaced, so export it first if you want to keep it.')) return;
    A.stop();
    A.stopHear();
    CR.proj = newProject();
    CR.sel.scene = 0;
    saveProj();
    renderAll();
  }

  const safe = s => (s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Untitled';

  // Native S-4 project: <NAME>.s4project/ zipped, ready to copy into the S-4's PROJECTS folder.
  async function exportProject() {
    if (!CR.proj.scenes.some(sc => !isEmpty(sc))) return S4.toast('Nothing to export yet: put a sample in a scene first', 'err');
    S4.toast('Putting the project together…');
    try {
      const r = await S4.s4p.build(CR.proj);
      S4.download(S4.zip.write(r.files), r.name + '.s4project.zip');
      S4.follow.fresh();
      const n = r.files.filter(f => /\.wav$/.test(f.name)).length;
      report('Ready for the S-4', [
        `${r.name}.s4project · ${Object.keys(JSON.parse(r.files[0].data).data.scenes).length} scenes · ${n} audio file${n === 1 ? '' : 's'}`,
        `Unzip it and put the ${r.name}.s4project folder in the S-4's PROJECTS folder (USB storage mode), then open it on the S-4. If the S-4 already has a project with that name, rename one of them first.`,
      ], r.warnings, []);
    } catch (e) {
      console.error(e);
      S4.toast('The export stopped: ' + e.message, 'err');
    }
  }

  // ---------- straight to / from the S-4's drive ----------
  async function exportToS4() {
    if (!CR.proj.scenes.some(sc => !isEmpty(sc))) return S4.toast('Nothing to export yet: put a sample in a scene first', 'err');
    try {
      const dir = await S4.drive.projects(); // first: Chrome only asks for permission right after a click
      if (!dir) return;
      S4.toast('Writing onto the S-4…');
      const r = await S4.s4p.build(CR.proj);
      const name = await S4.drive.write(r, dir);
      if (!name) return S4.toast('Cancelled, nothing was written');
      S4.follow.fresh();
      const n = r.files.filter(f => /\.wav$/.test(f.name)).length;
      report('On the S-4', [
        `${dir.name}/${name}.s4project · ${Object.keys(JSON.parse(r.files[0].data).data.scenes).length} scenes · ${n} audio file${n === 1 ? '' : 's'}`,
        'Eject the drive, leave USB storage mode, and open the project on the S-4.',
      ], r.warnings, []);
    } catch (e) { driveError(e, 'Nothing was exported'); }
  }

  async function openFromS4() {
    try {
      const dir = await S4.drive.projects();
      if (!dir) return;
      const names = await S4.drive.list(dir);
      if (!names.length) return S4.toast(`${dir.name} has no S-4 projects in it`, 'err');
      const pick = await chooseProject(names.map(n => ({ name: n, prefix: n + '.s4project/' })));
      if (!pick) return;
      S4.toast(`Opening ${pick.name}…`);
      await importNative(await S4.drive.entries(dir, pick.name), { name: pick.name });
    } catch (e) { driveError(e, 'Nothing was opened'); }
  }

  async function chooseS4Folder() {
    try {
      const r = await S4.drive.pick();
      if (r) S4.toast(`Using ${r.projects.name}${r.samples ? ', and the samples in its SAMPLES folder' : ''}`);
    } catch (e) { driveError(e, 'No folder was chosen'); }
  }

  function driveError(e, what) {
    // Chrome reports both "Cancel" in the folder dialog and a closed permission prompt as AbortError.
    if (e && e.name === 'AbortError') {
      S4.toast(`${what || 'Nothing was done'}: the folder window, or Chrome's question about editing files, was closed. Try again.`, 'err');
      return;
    }
    console.error(e);
    if (e && (e.name === 'NotFoundError' || e.name === 'NotReadableError' || e.name === 'InvalidStateError')) {
      S4.toast('The S-4 folder can\'t be reached. Is the S-4 in USB storage mode? Project › Choose the S-4 folder… finds it again.', 'err');
    } else if (e && e.name === 'SecurityError') {
      S4.toast('Chrome won\'t open that folder. Choose the S-4\'s PROJECTS folder instead.', 'err');
    } else {
      S4.toast('S-4 drive: ' + (e && e.message), 'err');
    }
  }

  // Short report after import/export: lines, then warnings and missing files.
  function report(title, lines, warnings, missing) {
    S4.modal(title, h('div', { class: 'report' },
      lines.map(l => h('p', null, l)),
      warnings.length ? [h('div', { class: 'lbl' }, 'Notes'), h('ul', null, warnings.map(w => h('li', null, w)))] : null,
      missing.length ? [h('div', { class: 'lbl' }, 'Not found'), h('ul', { class: 'missing' }, missing.map(w => h('li', null, w)))] : null));
  }

  // App backup: samples as plain WAVs plus this app's project.json, for re-importing here.
  async function exportBackup() {
    const p = CR.proj;
    const used = p.scenes.map((sc, i) => [sc, i]).filter(([sc]) => !isEmpty(sc));
    if (!used.length) return S4.toast('Nothing to export yet: put a sample in a scene first', 'err');
    const root = safe(p.name);
    S4.toast('Backing up: the samples become 48 kHz, 24-bit WAVs…');
    const files = [], paths = new Map(), names = new Set(), missing = [], scenes = [];
    for (const [sc, i] of used) {
      const tracks = [];
      for (let t = 0; t < 4; t++) {
        const tr = sc.tracks[t];
        let path = null;
        if (tr.sample) {
          try {
            await A.need(tr.sample.id);
            const key = [tr.sample.id, tr.trimIn, tr.trimOut, tr.fadeIn, tr.fadeOut].join('|');
            path = paths.get(key);
            if (!path) {
              const dir = 'samples/' + (tr.sample.folder ? tr.sample.folder.split('/').map(safe).join('/') + '/' : '');
              const base = safe(tr.sample.name);
              let nm = dir + base + '.wav', k = 2;
              while (names.has(nm)) nm = dir + base + '_' + (k++) + '.wav';
              names.add(nm);
              paths.set(key, nm);
              files.push({ name: root + '/' + nm, data: await A.renderWav(A.derived(tr)) });
              path = nm;
            }
          } catch (e) {
            missing.push(`${tr.sample.file} (scene ${S4.pad3(i + 1)}, T${t + 1})`);
          }
        }
        tracks.push(exportTrack(tr, path));
      }
      scenes.push({ scene: i + 1, name: sc.name || '', tracks });
    }
    const json = {
      format: 's4tools', version: 1, name: p.name, bpm: p.bpm, key: p.key, launch: p.launch, loop: p.loop,
      mix: p.mix,
      // the S-4 project's settings and global blocks, as set here or imported (S-4 format)
      s4: p.exS || p.exG ? { settings: p.exS || null, global: p.exG || null } : null,
      sampleFormat: 'WAV 48 kHz 24-bit, trims and fades applied', scenes,
    };
    files.unshift(
      { name: root + '/project.json', data: JSON.stringify(json, null, 2) },
      { name: root + '/README.txt', data: README(p, used.length, paths.size) });
    S4.download(S4.zip.write(files), root + '.zip');
    if (missing.length) S4.toast('Backed up, but these samples were missing: ' + missing.join(', '), 'err');
    else S4.toast(`Backed up ${used.length} scene${used.length === 1 ? '' : 's'} and ${paths.size} sample${paths.size === 1 ? '' : 's'}`);
  }

  function exportTrack(tr, path) {
    const s = tr.sample;
    return {
      device: tr.device,
      sample: path,
      sampleFile: s ? s.file : null,
      sampleBpm: s ? s.bpm : null,
      sampleKey: s ? s.key : null,
      tempoMode: tr.device === 'POLY' ? null : tr.tempo === 'sync' ? 'SYNC' : tr.tempo === 'stretch' && A.canStretch(tr) ? 'STRETCH' : 'FREE',
      stretch: tr.tempo === 'stretch' && A.canStretch(tr) ? { warp: A.warpMode(tr), pitch: tr.pitchSt || 0, cents: tr.cents || 0, followKey: tr.followKey !== false } : null,
      speed: tr.device === 'DISC' ? { octaves: tr.speed } : tr.device === 'TAPE' ? { semitones: tr.speed } : null,
      grid: tr.grid,
      startBeats: tr.device === 'DISC' ? tr.start : 0,
      lengthBeats: tr.length,
      xfade: tr.xfade,
      poly: tr.device === 'POLY' ? { pitch: tr.pitch, startPct: tr.pStart, lengthPct: tr.pLen, loop: tr.loopMode } : null,
      levelDb: tr.lvl,
      // effects and further material parameters, exact values in the S-4's units
      fx: tr.fx ? Object.fromEntries(Object.entries(tr.fx).map(([d, e]) => [d, Object.assign({ on: e.on, n: e.n }, e.md && Object.keys(e.md).length ? { md: e.md } : {})])) : null,
      material: tr.mx || null,
      // S-4 blocks set here (sends, modulators, routings, material switches), in the S-4's own format
      s4: tr.ex || null,
      edit: { trimIn: tr.trimIn, trimOut: tr.trimOut, fadeInMs: tr.fadeIn, fadeOutMs: tr.fadeOut },
    };
  }

  const README = (p, nScenes, nSamples) => [
    `${p.name} — exported by s4tools`,
    '',
    `Tempo ${p.bpm} BPM · key ${p.key} · ${nScenes} scenes · ${nSamples} samples`,
    '',
    'samples/      WAV, 48 kHz, 24-bit, with trims and fades applied. Copy this folder to the',
    "              S-4's SAMPLES folder (USB mass storage mode) to load them on the hardware.",
    'project.json  Scenes, devices and settings. Open it again in s4tools: Project > Import a project zip.',
    '',
    'This is a backup for s4tools. For a project the S-4 can open, use Export,',
    'which writes a NAME.s4project folder.',
    '',
  ].join('\r\n');

  async function importProject() {
    const [file] = await S4.pickFiles({ accept: '.zip,.json,application/zip,application/json' });
    if (!file) return;
    try {
      let json, entries = null, prefix = '';
      if (/\.json$/i.test(file.name)) {
        json = JSON.parse(await file.text());
        if (json.version && json.data && json.data.scenes) {
          // A bare S-4 project.json: settings and scenes, but no audio.
          const bytes = new TextEncoder().encode(JSON.stringify(json));
          return importNative(new Map([['IMPORTED.s4project/project.json', { size: bytes.length, read: async () => bytes.buffer }]]));
        }
      } else {
        entries = await S4.zip.read(file);
        const ne = S4.s4p.entriesFromZip(entries);
        if (S4.s4p.find(ne).length) return importNative(ne);
        const pj = [...entries.keys()].find(n => /(^|\/)project\.json$/.test(n));
        if (!pj) throw new Error('there is no project.json in it. Choose a zipped S-4 project or an s4tools backup.');
        prefix = pj.slice(0, pj.length - 'project.json'.length);
        json = JSON.parse(new TextDecoder().decode(entries.get(pj)));
      }
      if (json.format !== 's4tools') throw new Error('it isn\'t an s4tools backup');
      A.stop();
      A.stopHear();
      const p = newProject();
      Object.assign(p, { name: json.name || 'Imported', bpm: json.bpm || 120, key: json.key || 'NONE', launch: json.launch || 'BAR', loop: json.loop !== false });
      const idByPath = new Map(), missing = [];
      for (const js of json.scenes || []) {
        const sc = newScene();
        sc.name = js.name || '';
        for (let t = 0; t < 4; t++) {
          const jt = (js.tracks || [])[t];
          if (!jt) continue;
          const tr = sc.tracks[t];
          importTrack(tr, jt);
          if (!jt.sample) continue;
          let id = idByPath.get(jt.sample);
          if (!id && entries) {
            const bytes = entries.get(prefix + jt.sample);
            if (bytes) {
              id = 'S' + hashStr(jt.sample + '|' + bytes.length + '|' + p.name);
              const fname = jt.sample.split('/').pop();
              const folder = jt.sample.replace(/^samples\/?/, '').split('/').slice(0, -1).join('/');
              await S4.idb.put({ id, name: fname, folder, bytes: bytes.slice().buffer, type: 'audio/wav' });
              idByPath.set(jt.sample, id);
            }
          }
          if (!id) { missing.push(`${jt.sample} (scene ${S4.pad3(js.scene)}, T${t + 1})`); continue; }
          const fname = jt.sample.split('/').pop();
          tr.sample = {
            id, file: fname, name: fname.replace(/\.[^.]+$/, ''),
            folder: jt.sample.replace(/^samples\/?/, '').split('/').slice(0, -1).join('/'),
            dur: null, sr: null, ch: null, bpm: jt.sampleBpm || null, bpmSrc: jt.sampleBpm ? 'user' : null, key: jt.sampleKey || null,
          };
        }
        p.scenes[S4.clamp((js.scene || 1) - 1, 0, 127)] = sc;
      }
      if (json.s4) { if (json.s4.settings) p.exS = json.s4.settings; if (json.s4.global) p.exG = json.s4.global; }
      if (json.mix && Array.isArray(json.mix.tracks)) p.mix = json.mix;
      else {
        // Older backups kept pan/filter/mute per scene; the first scene becomes the project mixer.
        const first = (json.scenes || [])[0];
        if (first) (first.tracks || []).forEach((jt, t) => { if (jt && jt.mix) Object.assign(p.mix.tracks[t], { pan: jt.mix.pan || 0, fltr: jt.mix.filter || 0, mute: !!jt.mix.mute }); });
      }
      CR.proj = p;
      CR.missing.clear();
      CR.sel.scene = Math.max(0, p.scenes.findIndex(sc => !isEmpty(sc)));
      saveProj();
      renderAll();
      if (missing.length) S4.toast('Opened, but these samples weren\'t in the file: ' + missing.join(', '), 'err');
      else S4.toast(`"${p.name}" is open`);
    } catch (e) {
      console.error(e);
      S4.toast('Not opened: ' + e.message, 'err');
    }
  }

  // S-4 project straight from the S-4's drive (or a copy): pick a NAME.s4project folder, the PROJECTS
  // folder, or the whole drive (then samples it uses from the drive's SAMPLES folder are found too).
  async function importS4Folder() {
    const files = (await S4.pickFiles({ directory: true }))
      .filter(f => /\.s4project\/(project\.json|discs\/|tapes\/)/i.test(relPath(f)) || /(^|\/)SAMPLES\//i.test(relPath(f)));
    if (files.length) await importNative(S4.s4p.entriesFromFiles(files));
  }

  async function importNative(entries, opts = {}) {
    const found = S4.s4p.find(entries);
    if (!found.length) return S4.toast('There is no NAME.s4project folder with a project.json in what you chose', 'err');
    const pick = opts.name ? found.find(f => f.name === opts.name) : found.length === 1 ? found[0] : await chooseProject(found);
    if (!pick) return;
    if (!opts.noConfirm && CR.proj.scenes.some(sc => !isEmpty(sc)) && !confirm(`Open "${pick.name}"? It replaces the current project, so export that first if you want to keep it.`)) return;
    S4.toast(`Opening ${pick.name}…`);
    try {
      const r = await S4.s4p.parse(pick, entries, CR.make);
      A.stop();
      A.stopHear();
      CR.proj = r.proj;
      CR.missing.clear();
      CR.sel.scene = !isEmpty(r.proj.scenes[r.selected]) ? r.selected : Math.max(0, r.proj.scenes.findIndex(sc => !isEmpty(sc)));
      saveProj();
      renderAll();
      S4.follow.fresh(); // the next scene launched from Live takes this project's mixer and macros
      const used = r.proj.scenes.filter(sc => !isEmpty(sc)).length;
      if (!opts.quiet) {
        report('S-4 project opened', [
          `${pick.name} · ${r.proj.bpm} BPM · ${used} scene${used === 1 ? '' : 's'}`,
          'Some of the project isn\'t shown in Build (its MIDI and audio settings, routings and more). Those parts stay in the project, and Export puts them back on the S-4 exactly as they were.',
        ], r.warnings, r.missing);
      }
      return r;
    } catch (e) {
      console.error(e);
      S4.toast('Not opened: ' + e.message, 'err');
    }
  }
  S4.build.importEntries = importNative;

  function chooseProject(found) {
    return new Promise(resolve => {
      let done = false;
      const list = h('div', { class: 'choose' }, found.sort((a, b) => a.name.localeCompare(b.name)).map(f => h('button', {
        class: 'menu-item',
        onclick: () => { done = true; m.close(); resolve(f); },
      }, f.name)));
      const m = S4.modal('Which project?', list, { onClose: () => { if (!done) resolve(null); } });
    });
  }

  function importTrack(tr, jt) {
    tr.device = MATERIALS.includes(jt.device) ? jt.device : 'DISC';
    tr.tempo = jt.tempoMode === 'SYNC' ? 'sync' : jt.tempoMode === 'STRETCH' ? 'stretch' : 'recorded';
    if (jt.stretch) Object.assign(tr, { warp: jt.stretch.warp || 'beats', pitchSt: jt.stretch.pitch || 0, cents: jt.stretch.cents || 0, followKey: jt.stretch.followKey !== false });
    if (jt.speed) tr.speed = jt.speed.octaves != null ? jt.speed.octaves : jt.speed.semitones || 0;
    tr.grid = jt.grid || '1/4';
    tr.start = jt.startBeats || 0;
    tr.length = jt.lengthBeats || null;
    tr.xfade = jt.xfade || 0;
    if (jt.poly) Object.assign(tr, { pitch: jt.poly.pitch || 0, pStart: jt.poly.startPct || 0, pLen: jt.poly.lengthPct || 100, loopMode: jt.poly.loop || 'off' });
    // backups made before exact values kept 0-127 knobs: the migration converts them
    if (jt.poly && jt.poly.attack !== undefined) Object.assign(tr, { attack: jt.poly.attack || 0, decay: jt.poly.decay != null ? jt.poly.decay : 64, sustain: jt.poly.sustain != null ? jt.poly.sustain : 127 });
    tr.lvl = jt.levelDb != null ? jt.levelDb : (jt.mix && jt.mix.levelDb) || 0;
    if (jt.vast) tr.vast = Object.assign({ delay: 0, time: 64, reverb: 0, size: 64, feedback: 89, spread: 0, tone: 0, decay: 64 }, jt.vast);
    if (jt.fx) tr.fx = JSON.parse(JSON.stringify(jt.fx));
    if (jt.material) tr.mx = JSON.parse(JSON.stringify(jt.material));
    if (jt.s4) tr.ex = JSON.parse(JSON.stringify(jt.s4));
    S4.s4p.migrate(tr, CR.proj.key);
    // trims and fades were baked into the exported WAV
  }

  async function cleanCache() {
    const used = new Set();
    CR.proj.scenes.forEach(sc => sc && sc.tracks.forEach(t => t.sample && used.add(t.sample.id)));
    (CR.proj.s4extra || []).forEach(x => used.add(x.id)); // audio an imported S-4 project carries along
    const keys = await S4.idb.keys();
    const stale = keys.filter(k => !used.has(k));
    if (!stale.length) return S4.toast('No unused samples to clear out');
    if (!confirm(`Clear out ${stale.length} sample${stale.length === 1 ? '' : 's'} that no scene uses? They are removed from this browser.`)) return;
    for (const k of stale) await S4.idb.del(k);
    S4.toast(`Cleared out ${stale.length} unused sample${stale.length === 1 ? '' : 's'}`);
  }
})(window.S4);
