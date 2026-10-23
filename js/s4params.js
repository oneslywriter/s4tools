'use strict';
// The S-4's parameters in its own units (what project.json stores) and their MIDI CCs.
// Every conversion was measured on the S-4 (OS 2.x): each parameter was set over MIDI to 32 values across
// 0-127 in calibration projects, which were saved and read back. The curves below reproduce every reading
// (to float precision). The app keeps exact values in these units; MIDI only reaches the nearest of the
// 128 CC steps (e.g. OFFSET moves 126 ms per step), so the hardware preview is the nearest CC while the
// export writes the exact value.
(function (S4) {
  const P = S4.params = {};
  const E = k => Math.exp(k) - 1;
  // curves: to(cc) -> value, from(value) -> cc (continuous, not rounded). x = cc / 127. kind and the numbers
  // describe the curve (tools/make_ccref.js writes them out).
  const lin = (a, b) => ({ kind: 'lin', a, b, to: c => a + ((b - a) * c) / 127, from: v => ((v - a) / (b - a)) * 127 });
  const expo = (a, b, k) => ({ kind: 'expo', a, b, k, // a + (b - a)(e^kx - 1)/(e^k - 1): fine resolution at the low end
    to: c => a + ((b - a) * (Math.exp((k * c) / 127) - 1)) / E(k),
    from: v => (Math.log(1 + (Math.max(v, a) - a) / (b - a) * E(k)) / k) * 127,
  });
  const rexp = (a, b, k) => ({ kind: 'rexp', a, b, k, // mirrored: fine resolution at the top (levels in dB)
    to: c => b - ((b - a) * (Math.exp(k * (1 - c / 127)) - 1)) / E(k),
    from: v => (1 - Math.log(1 + (b - Math.min(v, b)) / (b - a) * E(k)) / k) * 127,
  });
  const geo = (a, b) => ({ kind: 'geo', a, b, to: c => a * Math.pow(b / a, c / 127), from: v => (Math.log(Math.max(v, a) / a) / Math.log(b / a)) * 127 });
  const steps = table => ({
    kind: 'steps', table,
    to: c => table[Math.round((S4.clamp(c, 0, 127) * (table.length - 1)) / 127)],
    from: v => { let k = 0; table.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(table[k] - v)) k = i; }); return (k * 127) / (table.length - 1); },
  });
  const seq = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const U = lin(0, 1), BI = lin(-1, 1);
  P.curves = { lin, expo, rexp, geo, steps };

  // [key, cc, curve, opts]. opts: unit ('s' | 'ms' | 'st' | 'dB' | '%' | '±' | 'x' | 'Hz' | 'beats' | 'idx' |
  // 'scale' | 'dj' | ''), int (stored as an integer), def (the S-4's default: the value fresh devices store, the
  // most common one across 43 saved projects), label, step (keyboard / wheel resolution in the unit), detent
  // (a value the fader snaps to), modes (below).
  const p = (key, cc, curve, o = {}) => {
    const sp = Object.assign({ key, cc, curve, unit: '%', def: 0 }, o);
    sp.modal = !!(sp.modes && sp.modes.some(m => m.curve)); // a mode changes what the value means
    return sp;
  };
  const pct = (key, cc, o) => p(key, cc, U, Object.assign({ unit: '%' }, o));
  const bi = (key, cc, o) => p(key, cc, BI, Object.assign({ unit: '±', detent: 0 }, o));

  // Parameter modes, as the S-4 stores them: its default mode as '', the others by their lower-case name.
  // A mode with its own curve / unit changes what the value means (calibration round 3: each mode preset in a
  // project, then swept over MIDI). The menu order is the S-4's. Names not yet seen in a saved project:
  // 'random' (RAND PITCH), 'redux' (CRUSH), and the scales other than chromatic, major, pentatonic and octaves.
  const M = (id, label, o) => Object.assign({ id, label }, o);
  const MIX_SEND = [M('', 'MIX'), M('send', 'SEND')];
  // Scales (manual appendix) by pitch class; RING's SCALE value is the index in this list (19 = FREE).
  const SCALES = [
    ['chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], ['major', [0, 2, 4, 5, 7, 9, 11]], ['minor', [0, 2, 3, 5, 7, 8, 10]],
    ['dorian', [0, 2, 3, 5, 7, 9, 10]], ['lydian', [0, 2, 4, 6, 7, 9, 11]], ['super locrian', [0, 1, 3, 4, 6, 8, 10]],
    ['mixolydian', [0, 2, 4, 5, 7, 9, 10]], ['hex aeolian', [0, 3, 5, 7, 8, 10]], ['hex dorian', [0, 2, 3, 5, 7, 10]],
    ['blues', [0, 3, 5, 6, 7, 10]], ['pentatonic', [0, 3, 5, 7, 10]], ['hirajoshi', [0, 2, 3, 7, 8]], ['kumoi', [0, 2, 3, 7, 9]],
    ['iwato', [0, 1, 5, 6, 10]], ['whole tone', [0, 2, 4, 6, 8, 10]], ['pelog', [0, 1, 3, 7, 8]], ['tetratonic', [0, 4, 7, 11]],
    ['fifths', [0, 7]], ['octaves', [0]],
  ];
  P.SCALES = SCALES.map(s => s[0].toUpperCase()).concat('FREE');
  P.SCALE_IDS = SCALES.map(s => s[0]);
  // a pitch in a scale over ±36 semitones: the knob steps evenly through the scale's notes
  const inScale = pcs => steps(seq(-36, 36).filter(v => pcs.includes(((v % 12) + 12) % 12)));
  P.scaleCurve = id => { const s = SCALES.find(x => x[0] === id); return s ? inScale(s[1]) : null; };
  const scaleModes = dflt => [M('', dflt.toUpperCase())].concat(SCALES.filter(s => s[0] !== dflt).map(s => M(s[0], s[0].toUpperCase(), { curve: inScale(s[1]) })));
  // Synced rates and times are a step index into note lengths: 8 = 1/8, 9 = 1/16 (read on the S-4's screen),
  // halving per step; TRIPLET / DOTTED keep the index and add T / D.
  P.DIVS = ['32/1', '16/1', '8/1', '4/1', '2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64'];
  const TRIP = M('triplet', 'TRIPLET', { suffix: 'T' }), DOT = M('dotted', 'DOTTED', { suffix: 'D' });
  // Launch / record quantisation (the METER settings) is its own list, every step read on the S-4's screen
  // (VERIFY4): 0 NONE ... 7 4 BAR, and the list wraps from 4 BAR to NONE.
  P.METER = ['NONE', '1/16', '1/8', '1/4', '1/2', '1 BAR', '2 BAR', '4 BAR'];
  const SYNC = (label, free) => [M('', label), TRIP, DOT, M('free', 'FREE', { curve: free, unit: 'Hz', int: false })];

  P.DEV = {
    MOSAIC: { slot: 'granular', key: 'mosaic', label: 'MOSAIC', params: [
      p('pitch', 62, inScale([0, 7]), { unit: 'st', int: true, label: 'PITCH', modes: scaleModes('fifths') }),
      p('rate', 63, steps(seq(5, 11)), { unit: 'div', int: true, def: 9, label: 'RATE', modes: SYNC('STRAIGHT', expo(0.02, 200, 8)) }),
      p('size', 64, expo(0.001, 10, 8), { unit: 'beats', def: 0.5, label: 'SIZE' }),
      bi('contour', 65, { label: 'CONTOUR' }),
      pct('scan', 66, { label: 'SCAN', modes: [M('', 'STRETCH'), M('position', 'POSITION'),
        M('delay sync', 'DELAY SYNC', { curve: steps(seq(5, 11)), unit: 'div', int: true }), M('delay free', 'DELAY FREE', { curve: lin(0, 3.8), unit: 's' })] }),
      pct('spray', 67, { label: 'SPRAY', modes: [M('', 'RANDOM'), M('rand mono', 'RANDOM MONO'), M('warp', 'WARP'), M('warp mono', 'WARP MONO')] }),
      pct('pattern', 68, { label: 'PATTERN' }), pct('wet', 69, { def: 1, label: 'WET', modes: MIX_SEND }),
      pct('rand_pitch', 70, { label: 'RAND PITCH', modes: [M('', 'DETUNE'), M('random', 'RANDOM'), M('random mono', 'RANDOM MONO')] }),
      pct('rand_rate', 71, { label: 'RAND RATE' }), pct('rand_size', 72, { label: 'RAND SIZE' }),
      p('feedback', 77, lin(0, 2), { unit: 'x', label: 'FEEDBACK', modes: [M('', 'GRAIN OUTPUT'), M('sos', 'SOS', { curve: rexp(-100, 0, 4), unit: 'dB' })] }),
      pct('rand_amp', 73, { label: 'RAND AMP' }), pct('rand_reverse', 74, { label: 'RAND REV' }),
    ] },
    RING: { slot: 'filter', key: 'ring', label: 'RING', params: [
      pct('cutoff', 78, { def: 1, label: 'CUTOFF' }), pct('resonance', 79, { label: 'RESONANCE' }),
      pct('decay', 80, { label: 'DECAY', modes: [M('', 'SUSTAIN'), M('choke', 'CHOKE')] }),
      p('pitch', 81, lin(-24, 24), { unit: 'st', detent: 0, label: 'PITCH' }), bi('slope', 82, { def: -1, label: 'SLOPE' }), bi('tone', 83, { label: 'TONE' }),
      p('scale', 84, steps(seq(0, 19)), { unit: 'scale', int: true, label: 'SCALE' }), pct('wet', 85, { def: 1, label: 'WET', modes: MIX_SEND }),
      pct('waves', 86, { label: 'WAVES' }), pct('noise', 87, { label: 'NOISE' }), bi('tilt', 88, { label: 'TILT' }), pct('detune', 89, { label: 'DETUNE' }),
      p('waves_rate', 90, steps(seq(0, 11)), { unit: 'div', int: true, def: 5, label: 'WAVES R.', modes: [M('', 'SYNC'), M('free', 'FREE', { curve: expo(0.02, 50, 8), unit: 'Hz', int: false })] }),
      p('noise_rate', 91, steps(seq(0, 11)), { unit: 'div', int: true, def: 5, label: 'NOISE R.', modes: [M('', 'SYNC'), M('free', 'FREE', { curve: expo(0.02, 50, 8), unit: 'Hz', int: false })] }),
    ] },
    DEFORM: { slot: 'color', key: 'deform', label: 'DEFORM', params: [
      pct('drive', 94, { label: 'DRIVE' }), pct('compress', 95, { label: 'COMPRESS' }),
      pct('crush', 96, { label: 'CRUSH', modes: [M('', 'BIT CRUSH'), M('redux', 'REDUX'), M('bit crush/redux', 'BIT CRUSH/REDUX')] }),
      bi('tilt', 97, { label: 'TILT', modes: [M('low', 'LOW'), M('', 'MID'), M('high', 'HIGH')] }),
      pct('noise', 98, { label: 'NOISE', modes: [M('white', 'WHITE'), M('', 'PINK'), M('dust', 'DUST')] }),
      pct('noise_decay', 99, { def: 0.5, label: 'NOISE DECAY' }),
      pct('noise_color', 100, { def: 0.7, label: 'NOISE TONE' }), pct('wet', 101, { def: 1, label: 'WET', modes: MIX_SEND }),
    ] },
    VAST: { slot: 'space', key: 'vast', label: 'VAST', params: [
      pct('delay_wet', 110, { label: 'DELAY', modes: MIX_SEND }),
      // TIME's default mode ('') is DOTTED: the default 8 is 1/8D. STRAIGHT is stored as 'straight' (the only
      // parameter that names it). Measured on the echo (VERIFY4); FREE is 0.1 .. 375 Hz.
      p('time', 111, steps(seq(3, 11)), { unit: 'div', int: true, def: 8, label: 'TIME', suffix: 'D',
        modes: [M('', 'DOTTED', { suffix: 'D' }), M('straight', 'STRAIGHT', { suffix: '' }), TRIP, M('free', 'FREE', { curve: expo(0.1, 375, 8), unit: 'Hz', int: false })] }),
      p('feedback', 114, lin(0, 2), { unit: 'x', def: 0.7, label: 'FEEDBACK' }),
      pct('spread', 115, { label: 'SPREAD', modes: [M('', 'PHASE SHIFT'), M('ping pong', 'PING PONG'), M('diffusion', 'DIFFUSION')] }),
      pct('reverb_wet', 112, { label: 'REVERB', modes: MIX_SEND }), pct('size', 113, { def: 0.5, label: 'SIZE' }),
      bi('tone', 116, { unit: 'dj', label: 'TONE' }),
      p('decay', 117, expo(0.1, 60, 8), { unit: 's', def: 5, label: 'DECAY' }),
    ] },
  };

  // Modulators: the 8 values of each type in CC order (cc = 14 + 8 * slot + n). `selected` is the type's index.
  // Measured in calibration rounds 2 and 3. FOLLOW's HOLD in its default mode ('') is off and does not move.
  const HOLD = steps(seq(5, 11));
  P.MOD = {
    WAVE: { key: 'wave', selected: 0, params: [
      p('rate', 0, steps(seq(0, 10)), { unit: 'div', int: true, def: 2, label: 'RATE', modes: SYNC('STRAIGHT', expo(0.02, 50, 8)) }),
      pct('amount', 1, { def: 1, label: 'AMOUNT' }), pct('phase', 2, { label: 'PHASE' }), bi('offset', 3, { label: 'OFFSET' }),
      bi('skew', 4, { label: 'SKEW' }), pct('fold', 5, { label: 'FOLD' }), bi('curve', 6, { label: 'CURVE' }), bi('spread', 7, { label: 'SPREAD' }),
    ] },
    RANDOM: { key: 'random', selected: 1, params: [
      p('rate', 0, steps(seq(2, 11)), { unit: 'div', int: true, def: 9, label: 'RATE', modes: SYNC('STRAIGHT', expo(0.02, 50, 8)) }),
      pct('amount', 1, { def: 1, label: 'AMOUNT' }), pct('phase', 2, { label: 'PHASE' }), bi('offset', 3, { label: 'OFFSET' }),
      p('length', 4, lin(1, 32), { unit: '', def: 16, label: 'LENGTH' }), pct('variation', 5, { label: 'VARIATION' }),
      pct('smoothing', 6, { def: 0.001, label: 'SMOOTH' }), bi('spread', 7, { label: 'SPREAD' }),
    ] },
    FOLLOW: { key: 'follow', selected: 2, params: [
      p('delay_time', 0, expo(0, 2, 8), { unit: 's', label: 'DELAY' }), pct('amount', 1, { def: 1, label: 'AMOUNT' }),
      p('rise', 2, geo(1, 1000), { unit: '', def: 5, label: 'RISE' }), p('fall', 3, geo(1, 1000), { unit: '', def: 100, label: 'FALL' }),
      // the INPUT source is this value's mode: MATERIAL (the default, ''), the rest as the S-4 saved them when set
      // on its screen (VERIFY3). Other names make it reset the input, or drop the rest of the scene.
      p('input_level', 4, lin(-36, 36), { unit: 'dB', detent: 0, label: 'INPUT LVL',
        modes: [M('', 'MATERIAL'), M('in1/in2', 'INPUT 1/2'), M('in1', 'INPUT 1'), M('in2', 'INPUT 2'),
          M('track 1', 'TRACK 1'), M('track 2', 'TRACK 2'), M('track 3', 'TRACK 3'), M('track 4', 'TRACK 4'), M('mix', 'MIX')] }),
      bi('filter_cutoff', 5, { label: 'FILTER' }),
      p('sample_hold_rate', 6, HOLD, { unit: 'div', int: true, label: 'HOLD',
        modes: [M('', 'OFF', { unit: 'off' }), M('triplet', 'TRIPLET', { curve: HOLD, suffix: 'T' }), M('dotted', 'DOTTED', { curve: HOLD, suffix: 'D' }), M('free', 'FREE', { curve: expo(0.02, 50, 8), unit: 'Hz', int: false })] }),
      bi('spread', 7, { label: 'SPREAD' }),
    ] },
    ADSR: { key: 'adsr', selected: 4, params: [
      p('attack', 0, lin(0.01, 2), { unit: 's', def: 0.01, label: 'ATTACK' }), p('decay', 1, lin(0.01, 2), { unit: 's', def: 0.5, label: 'DECAY' }),
      pct('sustain', 2, { def: 0.5, label: 'SUSTAIN' }), p('release', 3, lin(0.01, 2), { unit: 's', def: 0.5, label: 'RELEASE' }),
      bi('attack_curve', 4, { label: 'ATT CURVE' }), bi('decay_curve', 5, { label: 'DEC CURVE' }), bi('release_curve', 6, { label: 'REL CURVE' }),
      bi('spread', 7, { label: 'SPREAD' }),
    ] },
  };

  // A parameter as it is in one of its modes (the same spec when the mode keeps the units).
  P.modeOf = (spec, id) => (spec.modes ? spec.modes.find(m => m.id === (id || '')) || null : null);
  P.inMode = (spec, id) => {
    const m = P.modeOf(spec, id);
    if (!m || (!m.curve && !m.unit && m.suffix === undefined)) return spec;
    if (!m.curve && !m.unit) return Object.assign({}, spec, { suffix: m.suffix });
    const curve = m.curve || spec.curve;
    return Object.assign({}, spec, {
      curve, unit: m.unit != null ? m.unit : spec.unit, int: m.int != null ? m.int : spec.int, detent: m.curve ? undefined : spec.detent,
      def: m.curve ? curve.to(S4.clamp(spec.curve.from(spec.def), 0, 127)) : spec.def, base: spec, suffix: m.suffix,
    });
  };
  // A value carried into another mode: the knob stays where it is.
  P.convert = (spec, fromId, toId, v) => {
    const a = P.inMode(spec, fromId), b = P.inMode(spec, toId);
    if (a.curve === b.curve) return P.clampV(b, v); // (FOLLOW HOLD is 0 while OFF)
    const out = b.curve.to(S4.clamp(a.curve.from(v), 0, 127));
    return b.int ? Math.round(out) : out;
  };
  // Material parameters Build edits in S-4 units (the rest of the material is mapped in s4project.js).
  P.MAT = {
    DISC: [
      p('offset', 52, lin(-8, 8), { unit: 'ms', detent: 0, step: 0.001, label: 'OFFSET' }),
      p('glide', 54, expo(0, 4, 4), { unit: 's', label: 'GLIDE' }),
      pct('density', 58, { def: 0.7, label: 'DENSITY' }),
      p('sos', 57, rexp(-100, 0, 4), { unit: 'dB', label: 'SOS' }),
    ],
    TAPE: [bi('rotate', 48, { label: 'ROTATE' }), bi('sos', 51, { label: 'SOS' })],
    POLY: [
      p('attack', 54, expo(0, 4, 4), { unit: 's', def: 0.005, label: 'ATTACK' }), p('decay', 55, expo(0, 4, 4), { unit: 's', def: 0.2, label: 'DECAY' }),
      pct('sustain', 56, { def: 0.5, label: 'SUSTAIN' }), pct('loop', 52, { label: 'LOOP POINT' }), bi('curve', 57, { def: -0.25, label: 'CURVE' }),
      pct('velocity', 58, { def: 0.5, label: 'VELOCITY' }), bi('filter_amount', 60, { label: 'FLTR AMOUNT' }), bi('filter_shape', 61, { label: 'FLTR SHAPE' }),
    ],
  };
  // Levels in dB (DISC 56, TAPE 50, POLY 50) on the S-4's level curve.
  P.LEVEL = rexp(-100, 12, 4);
  // Calibration round 4 (S4T CAL4, 2026-10-22). DISC / TAPE SPEED in semitones in FREE (OCTAVES and the scales
  // step through their notes: P.scaleCurve); DISC TEMPO in BPM (whole BPM in SYNC); POLY PITCH in semitones in
  // both modes; the mixer's LEVEL in dB. START / LENGTH step through the sample's grid steps (follow.js).
  P.SPEED = lin(-36, 36);
  P.TEMPO = lin(20, 999);
  P.POLY_PITCH = lin(-12, 12);
  P.MIX_LEVEL = rexp(-100, 6, 3);

  // value -> nearest CC, and the value that CC really gives (what the S-4 plays during the hardware preview)
  P.cc = (spec, v) => Math.round(S4.clamp(spec.curve.from(v), 0, 127));
  P.atCC = (spec, v) => spec.curve.to(P.cc(spec, v));
  P.clampV = (spec, v) => {
    const a = spec.curve.to(0), b = spec.curve.to(127);
    return S4.clamp(v, Math.min(a, b), Math.max(a, b));
  };
  P.defaults = specs => Object.fromEntries(specs.map(s => [s.key, s.def]));

  // Display in the parameter's unit.
  const trim = (x, dp) => { const s = x.toFixed(dp); return dp ? s.replace(/\.?0+$/, '') : s; };
  P.fmt = (spec, v) => {
    if (v == null || Number.isNaN(v)) return '—';
    switch (spec.unit) {
      case '%': return trim(v * 100, Math.abs(v) < 0.1 ? 1 : 0) + '%';
      case '±': return (v > 0 ? '+' : '') + trim(v * 100, Math.abs(v) < 0.1 ? 1 : 0);
      case 'ms': return (v > 0 ? '+' : '') + (Math.abs(v) >= 1 ? trim(v, 3) + ' s' : trim(v * 1000, Math.abs(v) < 0.1 ? 1 : 0) + ' ms');
      case 's': return v < 1 ? trim(v * 1000, v < 0.01 ? 2 : v < 0.1 ? 1 : 0) + ' ms' : trim(v, 2) + ' s';
      case 'st': return (v > 0 ? '+' : '') + trim(v, Number.isInteger(v) ? 0 : 2) + ' st';
      case 'dB': return v <= -99.9 ? '-INF' : (v > 0 ? '+' : '') + trim(v, 1) + ' dB';
      case 'x': return '×' + trim(v, 2);
      case 'idx': return String(Math.round(v));
      case 'div': return (P.DIVS[Math.round(v)] || String(Math.round(v))) + (spec.suffix || '');
      case 'off': return 'OFF';
      case 'Hz': return trim(v, v < 10 ? 3 : v < 100 ? 2 : 1) + ' Hz'; // like the S-4's screen: 1.008 Hz
      case 'beats': return trim(v, v < 0.1 ? 3 : 2) + (v === 1 ? ' beat' : ' beats');
      case 'scale': return P.SCALES[Math.round(v)] || String(Math.round(v));
      case 'dj': return Math.abs(v) < 0.0005 ? 'OFF' : (v < 0 ? 'LP ' : 'HP ') + trim(Math.abs(v) * 100, Math.abs(v) < 0.1 ? 1 : 0) + '%';
      default: return trim(v, 2);
    }
  };
  // Typed input in the parameter's unit ("12", "-3.5 ms", "40%", "1.2s", "3 hz", a scale name), or null.
  P.parse = (spec, text) => {
    const t = String(text).trim().toLowerCase();
    if (spec.unit === 'scale') {
      const i = P.SCALES.findIndex(n => n.toLowerCase() === t);
      if (i >= 0) return i;
    }
    if (spec.unit === 'div') {
      const dv = t.match(/^(\d+\/\d+)\s*[td]?$/);
      if (dv) { const i = P.DIVS.indexOf(dv[1]); return i >= 0 ? P.clampV(spec, i) : null; }
    }
    if (spec.unit === 'dj') {
      const dj = t.match(/^(lp|hp)\s*(\d*\.?\d+)\s*%?$/);
      if (dj) return P.clampV(spec, (dj[1] === 'lp' ? -1 : 1) * parseFloat(dj[2]) / 100);
      if (t === 'off') return 0;
    }
    const m = t.match(/^([+-]?\d*\.?\d+)\s*(ms|s|%|st|db|x|hz|beats?|b)?$/);
    if (!m) return null;
    let v = parseFloat(m[1]);
    const u = m[2] || '';
    if (spec.unit === '%' || spec.unit === '±' || spec.unit === 'dj') v = u === '%' || !u ? v / 100 : v;
    else if (spec.unit === 'ms') v = u === 's' ? v : v / 1000;
    else if (spec.unit === 's') v = u === 'ms' || (!u && v > Math.max(spec.curve.to(0), spec.curve.to(127))) ? v / 1000 : v;
    return P.clampV(spec, v);
  };

  // Fader model for an exact value in S-4 units. The fader moves along the S-4's own knob curve (CC space,
  // but continuous), snaps to the detent, steps through the table for stepped values, and takes typed values.
  // get/set read and write the value; o: { label, disabled, onFine }.
  P.fader = (spec, get, set, o = {}) => ({
    label: o.label || spec.label, def: spec.def, bi: spec.detent != null, disabled: o.disabled,
    min: spec.curve.to(0), max: spec.curve.to(127), get, set,
    taper: { pos: v => S4.clamp(spec.curve.from(v) / 127, 0, 1), val: x => spec.curve.to(S4.clamp(x, 0, 1) * 127) },
    quant: v => (spec.int || spec.curve.table ? spec.curve.to(Math.round(spec.curve.from(v))) : P.clampV(spec, Math.round(v * 1e7) / 1e7)),
    detent: spec.detent,
    nudge: (v, dir, big) => {
      if (spec.int || spec.curve.table) return spec.curve.to(Math.round(spec.curve.from(v)) + dir * (big ? 2 : 1) * (127 / Math.max(1, (spec.curve.table || [0, 0]).length - 1)));
      if (spec.step) return P.clampV(spec, v + dir * spec.step * (big ? 10 : 1));
      return spec.curve.to(S4.clamp(spec.curve.from(v) + dir * (big ? 1 : 0.1), 0, 127));
    },
    parse: t => P.parse(spec, t),
    fmt: v => P.fmt(spec, v),
    spec,
  });

  // Live's knobs (js/ccmap.js) start and reset at the S-4's own defaults above, as the nearest CC. The material's
  // TEMPO (a sample's own tempo) resets to 120 BPM and its LEVEL to 0 dB.
  const MORE = { DISC: { 47: [P.TEMPO, 120], 56: [P.LEVEL, 0] }, TAPE: { 50: [P.LEVEL, 0] }, POLY: { 50: [P.LEVEL, 0] } };
  for (const [name, d] of Object.entries(S4.DEVICES)) {
    const specs = (P.DEV[name] ? P.DEV[name].params : P.MAT[name]) || [];
    d.params.forEach(p => {
      const sp = specs.find(s => s.cc === p.cc), more = MORE[name] && MORE[name][p.cc];
      if (sp) p.def = P.cc(sp, sp.def);
      else if (more) p.def = P.cc({ curve: more[0] }, more[1]);
    });
  }
})(window.S4);
