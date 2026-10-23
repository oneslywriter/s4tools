'use strict';
// Torso S-4 MIDI implementation (OS 2.x), from the official
// "CC Mapping and MIDI Note Reference" appendix.
//   Track parameters  -> MIDI channel 1-4 (= track number)
//   MIX (+ MIX mods)  -> channel 16
//   PERFORM (+ mods)  -> channel 15
(function (S4) {
  // bi: bipolar (centre = 64). def: value RESET sends (s4params.js replaces it with the S-4's own default).
  // fmt: display units.
  // level: excluded from RANDOMIZE. safeMax: RANDOMIZE ceiling (avoid runaway feedback).
  const P = (name, cc, o = {}) => Object.assign({ name, cc, bi: false }, o);
  const D = (slot, params, wet) => {
    params.forEach(p => { if (p.def === undefined) p.def = p.bi ? 64 : 0; });
    return { slot, params, wet };
  };

  S4.DEVICES = {
    DISC: D('material', [
      P('SPEED', 46, { bi: true, fmt: 'oct' }), P('TEMPO', 47, { def: 64 }), P('START', 48), P('LENGTH', 49, { def: 127 }),
      P('OFFSET', 52, { bi: true }), P('XFADE', 53), P('GLIDE', 54), P('LEVEL', 56, { def: 100, level: true }),
      P('SOS', 57), P('DENSITY', 58),
    ], [56]),
    TAPE: D('material', [
      P('SPEED', 46, { bi: true, fmt: 'oct' }), P('ROTATE', 48, { bi: true }), P('LENGTH', 49, { def: 127 }),
      P('LEVEL', 50, { def: 100, level: true }), P('SOS', 51, { bi: true }), P('XFADE', 53),
    ], [50]),
    POLY: D('material', [
      P('PITCH', 46, { bi: true, fmt: 'st12' }), P('START', 48), P('LENGTH', 49, { def: 127 }), P('LEVEL', 50, { def: 100, level: true }),
      P('LOOP', 52), P('XFADE', 53), P('ATTACK', 54), P('DECAY', 55, { def: 64 }),
      P('SUSTAIN', 56, { def: 127 }), P('CURVE', 57, { bi: true }), P('VELOCITY', 58, { def: 64 }),
      P('FLTR AMOUNT', 60, { bi: true }), P('FLTR SHAPE', 61, { bi: true }),
    ], [50]),
    MOSAIC: D('granular', [
      P('PITCH', 62, { bi: true, fmt: 'fifths' }), P('RATE', 63, { def: 64 }), P('SIZE', 64, { def: 64 }), P('CONTOUR', 65, { bi: true }),
      P('SCAN', 66, { def: 64 }), P('SPRAY', 67), P('PATTERN', 68), P('WET', 69, { def: 64 }),
      P('RAND PITCH', 70), P('RAND RATE', 71), P('RAND SIZE', 72), P('RAND AMP', 73),
      P('RAND REV', 74), P('FEEDBACK', 77, { safeMax: 100 }),
    ], [69]),
    RING: D('filter', [
      P('CUTOFF', 78, { def: 127 }), P('RESONANCE', 79), P('DECAY', 80), P('PITCH', 81, { bi: true, fmt: 'st' }),
      P('SLOPE', 82, { bi: true }), P('TONE', 83, { bi: true }), P('SCALE', 84), P('WET', 85, { def: 64 }),
      P('WAVES', 86), P('NOISE', 87), P('TILT', 88, { bi: true }), P('DETUNE', 89),
      P('WAVES R.', 90), P('NOISE R.', 91),
    ], [85]),
    DEFORM: D('color', [
      P('DRIVE', 94), P('COMPRESS', 95), P('CRUSH', 96), P('TILT', 97, { bi: true }),
      P('NOISE', 98), P('NOISE DECAY', 99, { def: 64 }), P('NOISE TONE', 100, { def: 64 }), P('WET', 101, { def: 64 }),
    ], [101]),
    VAST: D('space', [
      P('DELAY', 110), P('TIME', 111, { def: 64 }), P('REVERB', 112), P('SIZE', 113, { def: 64 }),
      P('FEEDBACK', 114, { def: 40, safeMax: 105 }), P('SPREAD', 115), P('TONE', 116, { bi: true }), P('DECAY', 117, { def: 64 }),
    ], [110, 112]),
  };

  S4.SLOTS = [
    { id: 'material', label: 'MATERIAL', devices: ['DISC', 'TAPE', 'POLY', 'BYPASS'] }, // BYPASS: live input, no parameters
    { id: 'granular', label: 'GRANULAR', devices: ['MOSAIC'] },
    { id: 'filter', label: 'FILTER', devices: ['RING'] },
    { id: 'color', label: 'COLOR', devices: ['DEFORM'] },
    { id: 'space', label: 'SPACE', devices: ['VAST'] },
  ];
  S4.SLOT_LABEL = Object.fromEntries(S4.SLOTS.map(s => [s.id, s.label]));

  // Modulators: MOD n uses CC 14 + (n-1)*8 ... +7 on the track channel.
  // All four confirmed on the S-4 (calibration projects, stored fields per CC). CC 7 of FOLLOW is HOLD (sample & hold).
  S4.MOD_TYPES = {
    WAVE: ['RATE', 'AMOUNT', 'PHASE', 'OFFSET', 'SKEW', 'FOLD', 'CURVE', 'SPREAD'],
    RANDOM: ['RATE', 'AMOUNT', 'PHASE', 'OFFSET', 'LENGTH', 'VARIATION', 'SMOOTH', 'SPREAD'],
    ADSR: ['ATTACK', 'DECAY', 'SUSTAIN', 'RELEASE', 'ATT CURVE', 'DEC CURVE', 'REL CURVE', 'SPREAD'],
    FOLLOW: ['DELAY', 'AMOUNT', 'RISE', 'FALL', 'INPUT LVL', 'FILTER', 'HOLD', 'SPREAD'],
  };
  // stored -1..1 (or -36..36 dB for INPUT LVL); AMOUNT is stored 0..1
  S4.MOD_BI = new Set(['OFFSET', 'SKEW', 'CURVE', 'SPREAD', 'ATT CURVE', 'DEC CURVE', 'REL CURVE', 'INPUT LVL', 'FILTER']);
  S4.modCC = (m, i) => 14 + m * 8 + i;

  S4.CH_MIX = 16;
  S4.CH_PERFORM = 15;
  S4.MIX_CC = { lvl: 46, fltr: 50, pan: 54, comp: 58, main: 61 };
  S4.MACRO_CC = 46; // MACRO 1..8 = CC 46..53 on ch 15
  S4.NOTE = {
    START_STOP: 24, MUTE: 25, TRACK_PLAY: 29, MAIN_REC: 36, TRACK_REC: 37, MONITOR: 41, // ch 16
    MACRO9: 24, // MACRO 9..12 = notes 24..27 on ch 15
  };

  S4.param = (dev, cc) => (S4.DEVICES[dev] ? S4.DEVICES[dev].params.find(p => p.cc === cc) : null);

  // Display formatting. Pitches and speeds show semitones on the S-4's measured curves (s4params.js), in the
  // device's default mode (Live doesn't know the mode a project set); everything else shows the CC value.
  S4.fmtCC = function (v, bi, fmt) {
    const P = S4.params;
    if (fmt === 'oct') return S4.signed(P.scaleCurve('octaves').to(v)) + ' ST'; // DISC in SYNC, TAPE: OCTAVES
    if (fmt === 'fifths') return S4.signed(P.scaleCurve('fifths').to(v)) + ' ST'; // MOSAIC: FIFTHS
    if (fmt === 'st12') return S4.signed(Math.round(P.POLY_PITCH.to(v))) + ' ST'; // POLY: -12 to +12
    if (fmt === 'st') return S4.signed(Math.round(((v / 127) * 2 - 1) * 24)) + ' ST'; // RING: -24 to +24
    if (bi) return S4.signed(v - 64);
    return String(v);
  };
})(window.S4);
