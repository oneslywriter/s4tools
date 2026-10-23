// Writes the MIDI CC reference, schema/S4-CC.md and schema/s4cc.json, from the tables the app itself uses
// (js/ccmap.js, js/s4params.js): what each CC sets on the S-4 over 0-127, in the units project.json stores.
// Run in the app page like verify_build.js; it uploads both files to /upload/, to be copied into schema/.
(async () => {
  const P = S4.params, { lin } = P.curves;
  const CCS = Array.from({ length: 128 }, (_, c) => c), POINTS = [0, 32, 64, 96, 127];
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const U = lin(0, 1), BI = lin(-1, 1);

  // ---- how values and curves read ----
  const UNIT = {
    '%': '0 to 1', '±': '-1 to +1', st: 'semitones', s: 'seconds', ms: 'seconds', dB: 'dB', x: 'multiplier', Hz: 'Hz',
    beats: 'beats', div: 'note length (index)', scale: 'scale (index)', dj: '-1 (low-pass) to +1 (high-pass), 0 = off', '': 'number', BPM: 'BPM', none: '',
  };
  const short = v => {
    if (Number.isInteger(v)) return String(v);
    const a = Math.abs(v), s = v.toFixed(a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4);
    return s.replace(/\.?0+$/, '');
  };
  const named = (unit, v, suffix = '') =>
    unit === 'div' ? `${v} (${P.DIVS[v]}${suffix})` : unit === 'scale' ? `${v} (${P.SCALES[v]})` : short(v);
  const curveText = cv => {
    const n = short;
    switch (cv.kind) {
      case 'lin': return `lin ${n(cv.a)} to ${n(cv.b)}`;
      case 'expo': return `expo ${n(cv.a)} to ${n(cv.b)}, k = ${cv.k}`;
      case 'rexp': return `rexp ${n(cv.a)} to ${n(cv.b)}, k = ${cv.k}`;
      case 'geo': return `geo ${n(cv.a)} to ${n(cv.b)}`;
      case 'steps': return `${cv.table.length} steps`;
      default: return '';
    }
  };
  const curveJson = cv => (cv.kind === 'steps' ? { kind: 'steps', values: cv.table } : Object.fromEntries(['kind', 'a', 'b', 'k'].filter(k => cv[k] !== undefined).map(k => [k, cv[k]])));
  // the CC ranges of each step of a stepped curve (the app's own to(), so the edges are exact)
  const ranges = (to, unit, suffix) => {
    const out = [];
    CCS.forEach(c => { const v = to(c), last = out[out.length - 1]; if (last && last.v === v) last.b = c; else out.push({ v, a: c, b: c }); });
    return out.map(x => `${x.a === x.b ? x.a : x.a + '-' + x.b} = ${named(unit, x.v, suffix)}`).join(' · ');
  };

  // ---- rows ----
  // { section, channel, cc, name, field, mode: { label, stored } | null, also: [mode labels with the same values],
  //   unit, to (cc -> value) | null, curve, def, note, steps (list the step ranges) }
  const sections = [];
  const section = (title, intro, channel, field) => { const s = { title, intro, channel, field, rows: [], notes: [] }; sections.push(s); return s; };
  const mlabel = m => `${m.label} (${m.id ? `'${m.id}'` : "''"})`;
  const isScale = m => m.curve && P.SCALE_IDS.includes(m.id);

  // a parameter spec from s4params.js, with a row per mode that changes its values
  function specRows(sec, sp, cc, key, extra = {}) {
    const modes = sp.modes || [];
    const plain = modes.filter(m => !m.curve && m.unit !== 'off'), off = modes.find(m => m.unit === 'off');
    const curved = modes.filter(m => m.curve);
    // several note-length modes on one row (STRAIGHT / TRIPLET / DOTTED): the index alone, the modes say T or D
    const base = { cc, name: sp.label || key, key, unit: sp.unit, suffix: plain.length > 1 ? '' : sp.suffix || '' };
    if (off) sec.rows.push(Object.assign({}, base, { mode: mlabel(off), modeId: off.id, to: null, note: 'off: the value stays where it is' }));
    const defMode = !modes.length || plain.some(m => m.id === '');
    if (plain.length || !off) {
      sec.rows.push(Object.assign({}, base, {
        mode: plain.length ? plain.map(mlabel).join(' / ') : null, modeId: plain.length ? plain.map(m => m.id) : null, to: c => sp.curve.to(c), curve: sp.curve,
        def: defMode ? sp.def : undefined, steps: sp.curve.kind === 'steps' && sp.curve.table.length <= 25,
      }, extra));
    }
    // scale modes: the app's own scale curves, shown here as the default, CHROMATIC and the rest in one row
    const scales = curved.filter(isScale), others = curved.filter(m => !isScale(m));
    scales.forEach(m => {
      const ms = P.inMode(sp, m.id);
      const shown = m.id === 'chromatic' || m.id === 'octaves';
      sec.rows.push(Object.assign({}, base, { mode: mlabel(m), modeId: m.id, to: c => ms.curve.to(c), curve: ms.curve, unit: ms.unit, hidden: !shown, def: m.id === '' ? sp.def : undefined, steps: ms.curve.table.length <= 25 }));
    });
    if (scales.some(m => m.id !== 'chromatic' && m.id !== 'octaves')) {
      sec.rows.push(Object.assign({}, base, { mode: 'other scales (by name)', to: null, summary: true,
        note: "the knob steps evenly through the scale's notes from -36 to +36 (see Scales); every scale is in s4cc.json" }));
    }
    others.forEach(m => {
      const ms = P.inMode(sp, m.id);
      sec.rows.push(Object.assign({}, base, { mode: mlabel(m), modeId: m.id, to: c => ms.curve.to(c), curve: ms.curve, unit: ms.unit, suffix: ms.suffix || '', steps: ms.curve.kind === 'steps' && ms.curve.table.length <= 25 }));
    });
  }
  const row = (sec, o) => sec.rows.push(Object.assign({ mode: null, unit: '' }, o));
  const M = (label, id) => `${label} ('${id}')`;

  // MATERIAL
  const disc = section('MATERIAL: DISC', '', 'track (1-4)', 'material.disc');
  const oct = P.scaleCurve('octaves'), chrom = P.scaleCurve('chromatic');
  row(disc, { cc: 46, name: 'SPEED', key: 'speed', mode: `${M('OCTAVES', 'octaves')}, SYNC's default`, unit: 'st', to: c => oct.to(c), curve: oct, steps: true, def: 0 });
  row(disc, { cc: 46, name: 'SPEED', key: 'speed', mode: `${M('FREE', 'free')}, AS RECORDED's default`, unit: 'st', to: c => P.SPEED.to(c), curve: P.SPEED });
  row(disc, { cc: 46, name: 'SPEED', key: 'speed', mode: `${M('CHROMATIC', 'chromatic')}; with TEMPO STRETCH the field is PITCH`, unit: 'st', to: c => chrom.to(c), curve: chrom });
  row(disc, { cc: 46, name: 'SPEED', key: 'speed', mode: 'other scales (by name)', unit: 'st', summary: true, note: "the knob steps evenly through the scale's notes from -36 to +36 (see Scales)" });
  row(disc, { cc: 47, name: 'TEMPO', key: 'tempo', mode: M('SYNC', 'sync'), unit: 'BPM', to: c => Math.round(P.TEMPO.to(c)), curve: P.TEMPO, note: "the sample's own tempo, whole BPM" });
  row(disc, { cc: 47, name: 'TEMPO', key: 'tempo', mode: `${M('AS RECORDED', 'free')} / ${M('STRETCH', 'stretch')}`, unit: 'BPM', to: c => P.TEMPO.to(c), curve: P.TEMPO, note: "the sample's own tempo" });
  row(disc, { cc: 48, name: 'START', key: 'start', mode: 'a grid (SYNC, STRETCH)', unit: 'beats', formula: 'g · round(x · (n - 1))', note: 'g = the grid in beats (1/4 = 1), n = the sample\'s length in grid steps: 0 to the last step' });
  row(disc, { cc: 48, name: 'START', key: 'start', mode: M('FREE', 'free') + ' (AS RECORDED)', unit: 's', formula: 'x · T', note: 'T = the sample\'s length in seconds' });
  row(disc, { cc: 49, name: 'LENGTH', key: 'length', mode: 'a grid (SYNC, STRETCH)', unit: 'beats', formula: 'g · (round(x · (n - 1)) + 1)', note: 'one grid step to the whole sample' });
  row(disc, { cc: 49, name: 'LENGTH', key: 'length', mode: M('FREE', 'free') + ' (AS RECORDED)', unit: 's', formula: 'x · T', note: '0 to the whole sample' });
  P.MAT.DISC.forEach(sp => specRows(disc, sp, sp.cc, sp.key));
  row(disc, { cc: 53, name: 'XFADE', key: 'xfade', unit: '%', to: c => U.to(c), curve: U, def: 0 });
  row(disc, { cc: 56, name: 'LEVEL', key: 'level', unit: 'dB', to: c => P.LEVEL.to(c), curve: P.LEVEL, def: 0 });
  disc.notes.push('START and LENGTH depend on the sample. For a sample 8 beats long, grid 1/4 (n = 8): START 0 to 7 beats, LENGTH 1 to 8; grid 1/16 (n = 32): START 0 to 7.75, LENGTH 0.25 to 8 (calibration round 4).');

  const tape = section('MATERIAL: TAPE', '', 'track (1-4)', 'material.tape');
  row(tape, { cc: 46, name: 'SPEED', key: 'speed', mode: M('OCTAVES', '') + ', the default', unit: 'st', to: c => oct.to(c), curve: oct, steps: true, def: 0 });
  row(tape, { cc: 46, name: 'SPEED', key: 'speed', mode: M('CHROMATIC', 'chromatic'), unit: 'st', to: c => chrom.to(c), curve: chrom });
  row(tape, { cc: 46, name: 'SPEED', key: 'speed', mode: 'other scales (by name)', unit: 'st', summary: true, note: "the knob steps evenly through the scale's notes from -36 to +36 (see Scales)" });
  row(tape, { cc: 46, name: 'SPEED', key: 'speed', mode: M('FREE', 'free'), unit: 'st', to: c => P.SPEED.to(c), curve: P.SPEED });
  P.MAT.TAPE.forEach(sp => specRows(tape, sp, sp.cc, sp.key));
  row(tape, { cc: 49, name: 'LENGTH', key: 'length', mode: M('1/1', '1/1') + ', at 120 BPM', unit: 'beats', to: c => 4 * (1 + Math.round((14 * c) / 127)), curve: { kind: 'steps', table: Array.from({ length: 15 }, (_, i) => 4 * (i + 1)) }, steps: true,
    note: '1 to 15 bars: the 30 s a TAPE holds. Measured at 120 BPM only' });
  row(tape, { cc: 50, name: 'LEVEL', key: 'level', unit: 'dB', to: c => P.LEVEL.to(c), curve: P.LEVEL, def: 0 });
  row(tape, { cc: 53, name: 'XFADE', key: 'xfade', unit: '%', to: c => U.to(c), curve: U, def: 0 });

  const poly = section('MATERIAL: POLY', '', 'track (1-4)', 'material.poly');
  row(poly, { cc: 46, name: 'PITCH', key: 'pitch', mode: `${M('CHROMATIC', '')} / ${M('FREE', 'free')}`, unit: 'st', to: c => P.POLY_PITCH.to(c), curve: P.POLY_PITCH, def: 0, note: 'stored unrounded in CHROMATIC too' });
  row(poly, { cc: 48, name: 'START', key: 'start', unit: '%', to: c => U.to(c), curve: U, def: 0, note: 'a fraction of the sample' });
  row(poly, { cc: 49, name: 'LENGTH', key: 'length', unit: '%', to: c => U.to(c), curve: U, def: 1, note: 'a fraction of the sample' });
  row(poly, { cc: 50, name: 'LEVEL', key: 'level', unit: 'dB', to: c => P.LEVEL.to(c), curve: P.LEVEL, def: 0 });
  row(poly, { cc: 53, name: 'XFADE', key: 'xfade', unit: '%', to: c => U.to(c), curve: U, def: 0 });
  P.MAT.POLY.forEach(sp => specRows(poly, sp, sp.cc, sp.key));

  // effects
  for (const [name, d] of Object.entries(P.DEV)) {
    const sec = section(`${S4.SLOT_LABEL[d.slot]}: ${name}`, '', 'track (1-4)', `${d.slot}.${d.key}`);
    d.params.forEach(sp => specRows(sec, sp, sp.cc, sp.key));
  }

  // modulators
  for (const [type, d] of Object.entries(P.MOD)) {
    const sec = section(`Modulator: ${type}`, `CC 14 + 8 · (n - 1) + i for MOD n: MOD 1 = CC 14-21, MOD 2 = 22-29, MOD 3 = 30-37, MOD 4 = 38-45. Below: MOD 1's CC, then MOD 2-4's.`, 'track (1-4)', `modulator1-4.${d.key}`);
    d.params.forEach(sp => specRows(sec, sp, `${14 + sp.cc} / ${22 + sp.cc} / ${30 + sp.cc} / ${38 + sp.cc}`, sp.key));
  }

  // mixer and Perform
  const mix = section('Mixer', 'Project-wide: the S-4 sets these when it opens a project, not on a scene change.', '16', 'global_slots.mixer.mix.mix');
  row(mix, { cc: '46-49', name: 'LEVEL T1-T4', key: 'level1-4', unit: 'dB', to: c => P.MIX_LEVEL.to(c), curve: P.MIX_LEVEL, def: 0 });
  row(mix, { cc: '50-53', name: 'FILTER T1-T4', key: 'cutoff1-4', unit: '±', to: c => BI.to(c), curve: BI, def: 0, note: '0 = open' });
  row(mix, { cc: '54-57', name: 'PAN T1-T4', key: 'pan1-4', unit: '±', to: c => BI.to(c), curve: BI, def: 0, note: '-1 = left' });
  row(mix, { cc: 58, name: 'COMPRESS', key: 'compress_amount', unit: '%', to: c => U.to(c), curve: U, def: 0 });
  row(mix, { cc: 61, name: 'MAIN', key: null, unit: 'none', note: 'not stored in a project, so its scale can\'t be read from a save' });
  const perf = section('Perform', 'Project-wide, like the mixer. MACRO 9-12 are notes 24-27 on channel 15, not CCs.', '15', 'global_slots.perform.perform');
  row(perf, { cc: '46-53', name: 'MACRO 1-8', key: 'macro1-8', unit: '±', to: c => BI.to(c), curve: BI, def: 0, note: 'measured on macros without routings; the screen shows a macro as uni- or bipolar depending on its routings' });

  // ---- the JSON: every value of every row ----
  const json = {
    about: 'What each MIDI CC sets on the Torso S-4 (OS 2.x), for CC 0-127, in the units its project.json stores. Measured: CCs sent at known values in calibration projects, the project saved on the S-4 and read back. Generated by s4tools (tools/make_ccref.js) from js/s4params.js and js/ccmap.js.',
    x: 'x = cc / 127',
    note_lengths: P.DIVS, scales: P.SCALES,
    parameters: [],
  };
  sections.forEach(s => s.rows.sort((a, b) => parseInt(a.cc, 10) - parseInt(b.cc, 10)));
  for (const sec of sections) {
    for (const r of sec.rows) {
      if (r.summary) continue;
      json.parameters.push({
        section: sec.title, channel: sec.channel, cc: r.cc, parameter: r.name, field: r.key ? `${sec.field}.${r.key}` : null,
        mode: r.mode, stored_as: UNIT[r.unit] != null ? UNIT[r.unit] : r.unit,
        curve: r.curve ? curveJson(r.curve) : null, formula: r.formula || null,
        values: r.to ? CCS.map(c => r6(r.to(c))) : null,
        default: r.def !== undefined ? r.def : null, note: r.note || null,
      });
    }
  }
  // every scale mode in full (the tables show CHROMATIC and OCTAVES)
  const scaleIds = P.SCALE_IDS;
  json.scale_modes = Object.fromEntries(scaleIds.map(id => { const cv = P.scaleCurve(id); return [id, CCS.map(c => cv.to(c))]; }));

  // ---- the Markdown ----
  const L = [];
  L.push('# S-4 MIDI CC reference', '');
  L.push('What every MIDI CC sets on the Torso S-4 (OS 2.x), across its whole 0-127 range, in the units the S-4 stores in a project ([project.json](S4-PROJECT.md)).', '');
  L.push('The CC numbers are the S-4\'s MIDI implementation, as Torso documents it. The ranges and curves were measured with s4tools: each CC was sent at known values in calibration projects, the S-4 saved the project, and its file was read back. The curves below reproduce every reading to float precision ([VERIFY.md](../VERIFY.md), calibration rounds 1-4).', '');
  L.push('[s4cc.json](s4cc.json) has every value: `parameters` holds one entry per row below, with `values`, the 128 stored values for CC 0 to 127 (or a `formula` where the value depends on the sample), and `scale_modes` holds each scale\'s 128 steps. Both files are generated by `tools/make_ccref.js` from the tables s4tools itself uses.', '');
  L.push('## Reading the tables', '');
  L.push('- **Channels:** a track\'s parameters on channels 1-4 (the track number), the mixer on 16, Perform on 15.');
  L.push('- **x = CC / 127.** The columns CC 0 ... CC 127 give the stored value at those CCs.');
  L.push('- **Modes:** a parameter\'s mode is stored next to its value (`{"value": ..., "mode": ...}`). A mode that changes what the CC means has its own row; modes listed together share the values.');
  L.push('- **Curves:**');
  L.push('  - lin a to b: a + (b - a) · x');
  L.push('  - expo a to b, k: a + (b - a) · (e^(k·x) - 1) / (e^k - 1), with fine steps at the low end');
  L.push('  - rexp a to b, k: b - (b - a) · (e^(k·(1 - x)) - 1) / (e^k - 1), with fine steps at the top');
  L.push('  - geo a to b: a · (b / a)^x');
  L.push('  - n steps: the knob moves evenly through a list of n values, value = list[round(x · (n - 1))]. The CC range of each step is listed under the table.');
  L.push(`- **Note lengths** (rates and times in a synced mode) are stored as an index: ${P.DIVS.map((d, i) => `${i} = ${d}`).join(', ')}. TRIPLET and DOTTED keep the index and add T or D.`);
  L.push(`- **Scales** (RING's SCALE is the index): ${P.SCALES.map((s, i) => `${i} ${s}`).join(', ')}. A pitch or speed in a scale mode steps evenly through that scale's notes from -36 to +36 semitones.`);
  L.push('- **Default:** the value a fresh device stores, and the CC nearest to it.', '');
  const cell = s => String(s).replace(/\|/g, '\\|');
  let lastGroup = '';
  for (const sec of sections) {
    const group = sec.channel === 'track (1-4)' ? 'Tracks (channels 1-4)' : sec.title === 'Mixer' ? 'Mixer (channel 16)' : 'Perform (channel 15)';
    if (group !== lastGroup) { L.push(`## ${group}`, ''); lastGroup = group; }
    L.push(`### ${sec.title}`, '');
    L.push(`Fields: \`${sec.field}.*\`.${sec.intro ? ' ' + sec.intro : ''}`, '');
    L.push(`| CC | Parameter | Mode | Stored as | ${POINTS.map(c => 'CC ' + c).join(' | ')} | Curve | Default |`);
    L.push(`|---|---|---|---|${POINTS.map(() => '---').join('|')}|---|---|`);
    const stepsNotes = [];
    for (const r of sec.rows) {
      if (r.hidden) continue;
      const pts = r.to ? POINTS.map(c => named(r.unit, r.to(c), r.suffix)) : POINTS.map(() => '');
      const curve = r.formula ? r.formula : r.curve ? curveText(r.curve) : '';
      let def = '';
      if (r.def !== undefined && r.def !== null && r.to && r.curve && r.curve.from) def = `${named(r.unit, r.def, r.suffix)} (CC ${S4.clamp(Math.round(r.curve.from(r.def)), 0, 127)})`;
      const unit = UNIT[r.unit] != null ? UNIT[r.unit] : r.unit;
      const mode = r.mode || '';
      const name = r.key ? `${r.name} \`${r.key}\`` : r.name;
      if (!r.to && !r.formula) {
        L.push(`| ${r.cc} | ${cell(name)} | ${cell(mode)} | ${cell(unit)} | ${cell(r.note || '')} ${POINTS.slice(1).map(() => '|').join(' ')} | | |`);
        continue;
      }
      if (r.formula) {
        L.push(`| ${r.cc} | ${cell(name)} | ${cell(mode)} | ${cell(unit)} | ${cell(r.note || '')} ${POINTS.slice(1).map(() => '|').join(' ')} | ${cell(curve)} | |`);
        continue;
      }
      L.push(`| ${r.cc} | ${cell(name)} | ${cell(mode)} | ${cell(unit)} | ${pts.map(cell).join(' | ')} | ${cell(curve)}${r.note ? '; ' + cell(r.note) : ''} | ${cell(def)} |`);
      if (r.steps) stepsNotes.push(`- **${r.name}${r.mode ? ', ' + r.mode : ''}:** CC ${ranges(r.to, r.unit, r.suffix)}`);
    }
    L.push('');
    if (stepsNotes.length) L.push('Steps:', '', ...stepsNotes, '');
    sec.notes.forEach(n => L.push(n, ''));
  }
  L.push('## Not covered', '');
  L.push('- MAIN (CC 61, channel 16): not stored in a project.');
  L.push("- The mixer's and Perform's own modulators.");
  L.push('- Notes (transport, mutes, track play, record and monitor, MACRO 9-12) and program changes (scenes): switches, not ranges.');
  L.push('');

  const md = L.join('\n');
  const put = async (name, body) => (await fetch('/upload/' + name, { method: 'PUT', body })).text();
  return { md: await put('S4-CC.md', md), json: await put('s4cc.json', JSON.stringify(json, null, 1)), rows: json.parameters.length, lines: L.length };
})();
