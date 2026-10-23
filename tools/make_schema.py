"""Generate the S-4 project.json schema and its reference from one set of tables:
  schema/s4project.schema.json   JSON Schema (2020-12): every field with its description, values, units, defaults
  schema/S4-PROJECT.md           the same as a readable reference
Everything here was learned from projects saved by the S-4 (OS 2.x, "version": "v14"), the calibration rounds and
the hardware checks in VERIFY.md. Ranges are the knob's full range (what a CC 0..127 reaches) unless noted.
usage: make_schema.py   (run from the repo root or tools/)"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'schema')

# ---------------------------------------------------------------- shared lists
DIVS = ['32/1', '16/1', '8/1', '4/1', '2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64']
DIVS_TXT = 'note-length step, a whole number: ' + ', '.join(f'{i} = {d}' for i, d in enumerate(DIVS)) + ' (every step timed on the S-4, VERIFY4-6)'
GRIDS = ['8/1', '4/1', '2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64']
METER = ['NONE', '1/16', '1/8', '1/4', '1/2', '1 BAR', '2 BAR', '4 BAR']
SCALES = [
    ('chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), ('major', [0, 2, 4, 5, 7, 9, 11]), ('minor', [0, 2, 3, 5, 7, 8, 10]),
    ('dorian', [0, 2, 3, 5, 7, 9, 10]), ('lydian', [0, 2, 4, 6, 7, 9, 11]), ('super locrian', [0, 1, 3, 4, 6, 8, 10]),
    ('mixolydian', [0, 2, 4, 5, 7, 9, 10]), ('hex aeolian', [0, 3, 5, 7, 8, 10]), ('hex dorian', [0, 2, 3, 5, 7, 10]),
    ('blues', [0, 3, 5, 6, 7, 10]), ('pentatonic', [0, 3, 5, 7, 10]), ('hirajoshi', [0, 2, 3, 7, 8]), ('kumoi', [0, 2, 3, 7, 9]),
    ('iwato', [0, 1, 5, 6, 10]), ('whole tone', [0, 2, 4, 6, 8, 10]), ('pelog', [0, 1, 3, 7, 8]), ('tetratonic', [0, 4, 7, 11]),
    ('fifths', [0, 7]), ('octaves', [0]),
]
SCALE_NAMES = [s for s, _ in SCALES]


def in_scale(name):
    pcs = dict(SCALES)[name]
    return [v for v in range(-36, 37) if v % 12 in pcs]


# ---------------------------------------------------------------- schema builders
def num(lo=None, hi=None, integer=False, **kw):
    s = {'type': 'integer' if integer else 'number'}
    if lo is not None: s['minimum'] = lo
    if hi is not None: s['maximum'] = hi
    s.update(kw)
    return s


def mode(mid, label, desc='', value=None, unit=None):
    return {'id': mid, 'label': label, 'desc': desc, 'value': value, 'unit': unit}


def param(label, desc, value, unit=None, default=None, cc=None, modes=None, dmode=''):
    """a {value, mode} pair as the S-4 stores it. modes: list of mode(); a mode with its own value schema makes the
    pair an anyOf over the modes. Without modes the S-4 writes mode ''."""
    s = {'type': 'object', 'description': desc, 'x-label': label}
    if unit: s['x-unit'] = unit
    if cc is not None: s['x-cc'] = cc
    if default is not None: s['default'] = {'value': default, 'mode': dmode}
    if not modes:
        s['properties'] = {'value': dict(value), 'mode': {'const': '', 'description': 'always "" (this parameter has no modes)'}}
    elif not any(m['value'] for m in modes):
        s['properties'] = {'value': dict(value), 'mode': {'enum': [m['id'] for m in modes], 'description': mode_txt(modes)}}
    else:
        s['properties'] = {'value': {'type': 'number'}, 'mode': {'enum': [m['id'] for m in modes], 'description': mode_txt(modes)}}
        s['anyOf'] = [{'description': f"mode {m['id']!r} = {m['label']}" + (f": {m['desc']}" if m['desc'] else ''),
                       'properties': {'mode': {'const': m['id']}, 'value': m['value'] or value}} if m['id'] != '' else
                      {'description': f"mode '' = {m['label']} (the default)" + (f": {m['desc']}" if m['desc'] else ''),
                       'properties': {'mode': {'const': ''}, 'value': m['value'] or value}}
                      for m in modes]
    s['required'] = ['value']
    s['additionalProperties'] = False
    s['x-modes'] = [{'id': m['id'], 'label': m['label'], 'desc': m['desc'], 'unit': m['unit']} for m in modes] if modes else None
    if s['x-modes'] is None: del s['x-modes']
    return s


def mode_txt(modes):
    return 'mode, as the S-4 stores it (its default as ""; a name the S-4 does not know is reset to ""): ' + '; '.join(
        f"{m['id']!r} = {m['label']}" + (f" ({m['desc']})" if m['desc'] else '') for m in modes)


def toggle(label, desc, default=0):
    return {'type': 'object', 'description': desc, 'x-label': label, 'default': {'value': default},
            'properties': {'value': {'enum': [0, 1], 'description': '0 = off, 1 = on'}}, 'required': ['value'], 'additionalProperties': False}


def obj(desc, props, required=(), extra=False, **kw):
    s = {'type': 'object', 'description': desc, 'properties': props}
    if required: s['required'] = list(required)
    s['additionalProperties'] = extra
    s.update(kw)
    return s


def pct(label, cc, desc='', default=0, modes=None):
    return param(label, desc or f'{label}, 0 to 1 (0-100 %).', num(0, 1), '%', default, cc, modes)


def bi(label, cc, desc='', default=0, modes=None):
    return param(label, desc or f'{label}, -1 to +1 (centre 0).', num(-1, 1), '±', default, cc, modes)


MIX_SEND = [mode('', 'MIX', 'the device output is mixed with the dry signal'), mode('send', 'SEND', 'the device runs as a send: only the wet signal')]
SYNC_RATE = lambda lo, hi, free_hi, what='rate': [
    mode('', 'STRAIGHT', f'{what} as a straight note length, value = {DIVS_TXT}', num(lo, hi, True)),
    mode('triplet', 'TRIPLET', 'the same step as a triplet (2/3 of the length)', num(lo, hi, True)),
    mode('dotted', 'DOTTED', 'the same step dotted (1.5 x the length)', num(lo, hi, True)),
    mode('free', 'FREE', f'free rate in Hz, 0.02 to {free_hi}, exponential knob', num(0.02, free_hi), 'Hz')]

# ---------------------------------------------------------------- effect devices (GRANULAR / FILTER / COLOR / SPACE)
MOSAIC = {
    'pitch': param('PITCH', 'Grain pitch in semitones over ±36, stepping through the notes of the chosen scale (the knob steps evenly through them). Verified on the 440 Hz sine: chromatic +7, minor -4, fifths +7 and 0 within 10 cents (VERIFY4).',
                   num(-36, 36, True), 'st', 0, 62,
                   [mode('', 'FIFTHS', 'the default scale (stored as ""; "fifths" by name is reset to "")', {'enum': in_scale('fifths')})] +
                   [mode(n, n.upper(), '', {'enum': in_scale(n)}) for n in SCALE_NAMES if n != 'fifths']),
    'rate': param('RATE', 'Grain rate. The default 9 is 1/16 straight: grain lines exactly 8.0 Hz apart at 120 BPM (VERIFY4).', num(5, 11, True), 'div', 9, 63, SYNC_RATE(5, 11, 200)),
    'size': param('SIZE', 'Grain size in beats, 0.001 to 10 (exponential knob).', num(0.001, 10), 'beats', 0.5, 64),
    'contour': bi('CONTOUR', 65, 'Grain envelope contour, -1 to +1.'),
    'scan': param('SCAN', 'Where grains read from.', num(0, 1), '%', 0, 66,
                  [mode('', 'STRETCH', 'scan speed, 0 to 1'), mode('position', 'POSITION', 'fixed position, 0 to 1'),
                   mode('delay sync', 'DELAY SYNC', f'delay as a note length, value = {DIVS_TXT}', num(5, 11, True)),
                   mode('delay free', 'DELAY FREE', 'delay in seconds, 0 to 3.8, linear', num(0, 3.8), 's')]),
    'spray': pct('SPRAY', 67, 'Grain position randomness, 0 to 1.', 0,
                 [mode('', 'RANDOM'), mode('rand mono', 'RANDOM MONO'), mode('warp', 'WARP'), mode('warp mono', 'WARP MONO')]),
    'pattern': pct('PATTERN', 68, 'Grain pattern, 0 to 1.'),
    'wet': pct('WET', 69, 'Wet amount, 0 to 1. A fresh MOSAIC is at 1.', 1, MIX_SEND),
    'rand_pitch': pct('RAND PITCH', 70, 'Random pitch amount, 0 to 1.', 0, [mode('', 'DETUNE'), mode('random', 'RANDOM'), mode('random mono', 'RANDOM MONO')]),
    'rand_rate': pct('RAND RATE', 71, 'Random rate amount, 0 to 1.'),
    'rand_size': pct('RAND SIZE', 72, 'Random size amount, 0 to 1.'),
    'feedback': param('FEEDBACK', 'Feedback.', num(0, 2), 'x', 0, 77,
                      [mode('', 'GRAIN OUTPUT', 'feedback of the grain output, 0 to 2 (x), linear'),
                       mode('sos', 'SOS', 'sound-on-sound level in dB, -100 to 0 (fine near 0 dB)', num(-100, 0), 'dB')]),
    'rand_amp': pct('RAND AMP', 73, 'Random amplitude amount, 0 to 1.'),
    'rand_reverse': pct('RAND REV', 74, 'Random reverse amount, 0 to 1.'),
    'lock': toggle('LOCK', "MOSAIC's LOCK switch (0 off, 1 on)."),
    'random_pattern_buffer': {'type': 'array', 'description': 'The random pattern MOSAIC uses: 8 numbers from -1 to 1. Written by the S-4 and kept as stored (float32); a new device gets random values.',
                              'items': num(-1, 1), 'minItems': 8, 'maxItems': 8},
}
RING = {
    'cutoff': pct('CUTOFF', 78, 'Filter cutoff, 0 to 1. A fresh RING is at 1.', 1),
    'resonance': pct('RESONANCE', 79, 'Resonance, 0 to 1.'),
    'decay': pct('DECAY', 80, 'Decay, 0 to 1.', 0, [mode('', 'SUSTAIN', 'read on the S-4 screen (VERIFY5)'), mode('choke', 'CHOKE')]),
    'pitch': param('PITCH', 'Pitch in semitones, -24 to +24, linear (fractional values allowed).', num(-24, 24), 'st', 0, 81),
    'slope': bi('SLOPE', 82, 'Slope, -1 to +1. A fresh RING is at -1.', -1),
    'tone': bi('TONE', 83, 'Tone, -1 to +1.'),
    'scale': param('SCALE', 'Scale the resonators are tuned to: index into the scale list, ' + ', '.join(f'{i} = {n.upper()}' for i, n in enumerate(SCALE_NAMES)) + ', 19 = FREE.', num(0, 19, True), 'scale', 0, 84),
    'wet': pct('WET', 85, 'Wet amount, 0 to 1. A fresh RING is at 1.', 1, MIX_SEND),
    'waves': pct('WAVES', 86, 'Waves amount, 0 to 1.'),
    'noise': pct('NOISE', 87, 'Noise amount, 0 to 1.'),
    'tilt': bi('TILT', 88, 'Tilt, -1 to +1.'),
    'detune': pct('DETUNE', 89, 'Detune, 0 to 1.'),
    'waves_rate': param('WAVES R.', 'Rate of the waves modulation.', num(0, 11, True), 'div', 5, 90,
                        [mode('', 'SYNC', f'value = {DIVS_TXT}', num(0, 11, True)), mode('free', 'FREE', 'Hz, 0.02 to 50, exponential knob', num(0.02, 50), 'Hz')]),
    'noise_rate': param('NOISE R.', 'Rate of the noise modulation.', num(0, 11, True), 'div', 5, 91,
                        [mode('', 'SYNC', f'value = {DIVS_TXT}', num(0, 11, True)), mode('free', 'FREE', 'Hz, 0.02 to 50, exponential knob', num(0.02, 50), 'Hz')]),
}
DEFORM = {
    'drive': pct('DRIVE', 94, 'Drive, 0 to 1. Drive 0.5 measures THD -13 dB, +4.6 dB on a sine (VERIFY).'),
    'compress': pct('COMPRESS', 95, 'Compression, 0 to 1.'),
    'crush': pct('CRUSH', 96, 'Crush amount, 0 to 1.', 0, [mode('', 'BIT CRUSH'), mode('redux', 'REDUX'), mode('bit crush/redux', 'BIT CRUSH/REDUX')]),
    'tilt': bi('TILT', 97, 'Tilt EQ, -1 to +1.', 0, [mode('low', 'LOW'), mode('', 'MID', 'read on the S-4 screen (VERIFY5)'), mode('high', 'HIGH')]),
    'noise': pct('NOISE', 98, 'Noise amount, 0 to 1.', 0, [mode('white', 'WHITE'), mode('', 'PINK'), mode('dust', 'DUST')]),
    'noise_decay': pct('NOISE DECAY', 99, 'Noise decay, 0 to 1.', 0.5),
    'noise_color': pct('NOISE TONE', 100, 'Noise tone, 0 to 1. A fresh DEFORM is at 0.7.', 0.7),
    'wet': pct('WET', 101, 'Wet amount, 0 to 1. A fresh DEFORM is at 1. At its defaults DEFORM is +1.46 dB on a 440 Hz sine (VERIFY3).', 1, MIX_SEND),
}
VAST = {
    'delay_wet': pct('DELAY', 110, 'Delay level, 0 to 1.', 0, MIX_SEND),
    'time': param('TIME', 'Delay time. The default mode "" is DOTTED: the default 8 is 1/8D. Every step and mode timed on the echo of a click (VERIFY4/5); no limit up to 12 s. When a scene changes the time, the delay glides to it over about a second.',
                  num(3, 11, True), 'div', 8, 111,
                  [mode('', 'DOTTED', f'value = {DIVS_TXT}, dotted', num(3, 11, True)),
                   mode('straight', 'STRAIGHT', 'the same steps straight ("straight" is stored by name; VAST TIME is the only parameter that names it)', num(3, 11, True)),
                   mode('triplet', 'TRIPLET', 'the same steps as triplets', num(3, 11, True)),
                   mode('free', 'FREE', 'repeats per second in Hz, 0.1 to 375 (the delay is 1 / Hz), exponential knob', num(0.1, 375), 'Hz')]),
    'feedback': param('FEEDBACK', 'Delay feedback, 0 to 2 (x), linear. A fresh VAST is at 0.7.', num(0, 2), 'x', 0.7, 114),
    'spread': pct('SPREAD', 115, 'Stereo spread, 0 to 1.', 0, [mode('', 'PHASE SHIFT'), mode('ping pong', 'PING PONG'), mode('diffusion', 'DIFFUSION')]),
    'reverb_wet': pct('REVERB', 112, 'Reverb level, 0 to 1.', 0, MIX_SEND),
    'size': pct('SIZE', 113, 'Reverb size, 0 to 1. A fresh VAST is at 0.5.', 0.5),
    'tone': bi('TONE', 116, 'Tone as a DJ filter: below 0 low-pass, above 0 high-pass, 0 = flat.'),
    'decay': param('DECAY', 'Reverb decay in seconds, 0.1 to 60, exponential knob.', num(0.1, 60), 's', 5, 117),
    'freeze': toggle('FREEZE', "VAST's FREEZE switch (0 off, 1 on)."),
}
DEVICES = {  # slot: (device key, label, params, bypass "selected")
    'granular': ('mosaic', 'MOSAIC', MOSAIC, 2),
    'filter': ('ring', 'RING', RING, 3),
    'color': ('deform', 'DEFORM', DEFORM, 2),
    'space': ('vast', 'VAST', VAST, 2),
}

# ---------------------------------------------------------------- modulators
MODS = {
    'wave': (0, 'WAVE', {
        'rate': param('RATE', 'LFO rate: one cycle per note length (1/4 = 0.500 s at 120 BPM, VERIFY5/6).', num(0, 10, True), 'div', 2, 0, SYNC_RATE(0, 10, 50)),
        'amount': pct('AMOUNT', 1, 'Amount, 0 to 1.', 1), 'phase': pct('PHASE', 2, 'Phase, 0 to 1.'), 'offset': bi('OFFSET', 3, 'Offset, -1 to +1.'),
        'skew': bi('SKEW', 4, 'Skew, -1 to +1.'), 'fold': pct('FOLD', 5, 'Fold, 0 to 1.'), 'curve': bi('CURVE', 6, 'Curve, -1 to +1.'), 'spread': bi('SPREAD', 7, 'Stereo spread, -1 to +1.'),
        'shape': {'type': 'object', 'description': 'SHAPE: 0 = SINE, 1 = TRIANGLE, 2 = SQUARE (measured on the pitch trace, read on the screen; VERIFY5).', 'x-label': 'SHAPE',
                  'default': {'value': 0}, 'properties': {'value': {'enum': [0, 1, 2]}}, 'required': ['value'], 'additionalProperties': False},
        'midi_trig': toggle('MIDI TRIG', 'Stored with every WAVE modulator, but the S-4 has no setting for it (checked on the screen, 2026-10-22). 0 in every save; kept as stored.'),
    }),
    'random': (1, 'RANDOM', {
        'rate': param('RATE', 'Step rate of the random sequence.', num(2, 11, True), 'div', 9, 0, SYNC_RATE(2, 11, 50)),
        'amount': pct('AMOUNT', 1, 'Amount, 0 to 1.', 1), 'phase': pct('PHASE', 2, 'Phase, 0 to 1.'), 'offset': bi('OFFSET', 3, 'Offset, -1 to +1.'),
        'length': param('LENGTH', 'Sequence length in steps, 1 to 32, linear.', num(1, 32), '', 16, 4),
        'variation': pct('VARIATION', 5, 'Variation, 0 to 1.'), 'smoothing': pct('SMOOTH', 6, 'Smoothing, 0 to 1. A fresh RANDOM is at 0.001.', 0.001),
        'spread': bi('SPREAD', 7, 'Stereo spread, -1 to +1.'),
        'buffer': {'type': 'array', 'description': 'The random sequence: 32 numbers from -1 to 1. Written by the S-4 and kept as stored (float32); a new modulator gets random values.', 'items': num(-1, 1), 'minItems': 32, 'maxItems': 32},
        'midi_trig': toggle('MIDI TRIG', 'Stored with every RANDOM modulator, but the S-4 has no setting for it (checked on the screen, 2026-10-22). 0 in every save; kept as stored.'),
    }),
    'follow': (2, 'FOLLOW', {
        'delay_time': param('DELAY', 'Delay in seconds, 0 to 2, exponential knob.', num(0, 2), 's', 0, 0),
        'amount': pct('AMOUNT', 1, 'Amount, 0 to 1.', 1),
        'rise': param('RISE', 'Rise time, 1 to 1000 (geometric knob).', num(1, 1000), '', 5, 2),
        'fall': param('FALL', 'Fall time, 1 to 1000 (geometric knob).', num(1, 1000), '', 100, 3),
        'input_level': param('INPUT LVL', 'Input level in dB, -36 to +36; the mode is the INPUT source. An invalid name in MOD 1 is reset to MATERIAL; in MOD 2-4 it makes the S-4 drop the rest of the scene (it keeps playing the scene before, and a save overwrites the scene; VERIFY4).',
                             num(-36, 36), 'dB', 0, 4,
                             [mode('', 'MATERIAL', 'the track\'s own material (default)'), mode('in1/in2', 'INPUT 1/2'), mode('in1', 'INPUT 1'), mode('in2', 'INPUT 2'),
                              mode('track 1', 'TRACK 1'), mode('track 2', 'TRACK 2'), mode('track 3', 'TRACK 3'), mode('track 4', 'TRACK 4'), mode('mix', 'MIX')]),
        'filter_cutoff': bi('FILTER', 5, 'Filter on the followed signal, -1 to +1.'),
        'sample_hold_rate': param('HOLD', 'Sample and hold.', num(0, 11), 'div', 0, 6,
                                  [mode('', 'OFF', 'no sample and hold; the value is ignored (the CC does not move it)', num(0, 11)),
                                   mode('triplet', 'TRIPLET', f'value = {DIVS_TXT}, triplet', num(5, 11, True)),
                                   mode('dotted', 'DOTTED', 'the same steps dotted', num(5, 11, True)),
                                   mode('free', 'FREE', 'Hz, 0.02 to 50, exponential knob', num(0.02, 50), 'Hz')]),
        'spread': bi('SPREAD', 7, 'Stereo spread, -1 to +1.'),
        'stereo_input': toggle('STEREO', 'Follow left and right separately (0 off, 1 on).'),
    }),
    'adsr': (4, 'ADSR', {
        'attack': param('ATTACK', 'Attack in seconds, 0.01 to 2, linear.', num(0.01, 2), 's', 0.01, 0),
        'decay': param('DECAY', 'Decay in seconds, 0.01 to 2, linear.', num(0.01, 2), 's', 0.5, 1),
        'sustain': pct('SUSTAIN', 2, 'Sustain level, 0 to 1.', 0.5),
        'release': param('RELEASE', 'Release in seconds, 0.01 to 2, linear.', num(0.01, 2), 's', 0.5, 3),
        'attack_curve': bi('ATT CURVE', 4, 'Attack curve, -1 to +1.'), 'decay_curve': bi('DEC CURVE', 5, 'Decay curve, -1 to +1.'),
        'release_curve': bi('REL CURVE', 6, 'Release curve, -1 to +1.'), 'spread': bi('SPREAD', 7, 'Stereo spread, -1 to +1.'),
    }),
}

# ---------------------------------------------------------------- materials
LEVEL = lambda label, cc: param(label, 'Level in dB, -100 (off) to +12, exponential knob with fine steps near the top. 0 dB = unity (VERIFY: -6 dB measures -6.00 dB).', num(-100, 12), 'dB', 0, cc)
XFADE = lambda cc: param('XFADE', 'Crossfade at the loop point, 0 to 1.', num(0, 1), '%', 0, cc)
DISC = {
    'speed': param('SPEED', 'Varispeed in semitones (pitch and tempo move together; verified to 0.1 cent, VERIFY). With TEMPO "stretch" this field is the stretch PITCH instead. In SYNC the S-4 offers no scale and moves in octaves, but a scale stored here still sets the knob\'s steps (VERIFY5). CC 46 covers -36 to +36 linearly; OCTAVES and the scales take the nearest step, STRETCH whole semitones (CAL4).',
                   num(-36, 36), 'st', 0, 46,
                   [mode('octaves', 'OCTAVES', 'whole octaves (the S-4\'s own SYNC saves always use it)', {'enum': in_scale('octaves')})] +
                   [mode(n, n.upper(), 'semitones on this scale\'s notes', {'enum': in_scale(n)}) for n in SCALE_NAMES if n != 'octaves'] +
                   [mode('free', 'FREE', 'continuous semitones, -36 to +36 (offered with TEMPO "free")', num(-36, 36))], 'octaves'),
    'tempo': param('TEMPO', 'value = the sample\'s own tempo in BPM (what SYNC and STRETCH scale from). mode = the tempo mode. CC 47 covers 20 to 999 BPM linearly, in whole BPM in SYNC (CAL4).', num(0), 'BPM', 120, 47,
                   [mode('sync', 'SYNC', 'varispeed to the project tempo: rate = project / sample tempo (pitch follows)'),
                    mode('stretch', 'STRETCH', 'the S-4 time-stretches to the project tempo (granular, grains ~24 ms at 83.6 Hz); SPEED holds the PITCH'),
                    mode('free', 'AS RECORDED', 'plays at its own speed; START and LENGTH are in seconds')], 'sync'),
    'start': param('START', 'Start of the loop region: beats from the sample start (mode = the grid it snaps to), or seconds when mode is "free" (TEMPO "free"). CC 48 steps evenly through the grid steps in the sample (0 to the last one), or 0 to the sample\'s seconds in FREE (CAL4).', num(0), 'beats', 0, 48,
                   [mode(g, g, f'grid {g}; value in beats') for g in GRIDS] + [mode('free', 'FREE', 'seconds', num(0), 's')], '1/1'),
    'length': param('LENGTH', 'Length of the loop region: beats (mode = grid), or seconds when mode is "free". With LOOP off and a LENGTH longer than the sample, the sample plays once and then silence. CC 49 steps evenly from one grid step to the whole sample, or 0 to the sample\'s seconds in FREE (CAL4).', num(0), 'beats', 4, 49,
                    [mode(g, g, f'grid {g}; value in beats') for g in GRIDS] + [mode('free', 'FREE', 'seconds', num(0), 's')], '1/1'),
    'zoom': param('ZOOM', 'Waveform zoom on the S-4\'s screen (display only); only 0 seen.', num(0), '', 0, None),
    'offset': param('OFFSET', 'Playback offset in seconds (verified: +0.6 moves the content 0.600 s, VERIFY). MIDI reaches -8 to +8 s (126 ms per CC step); larger values set on the S-4 are stored too (10.88 seen).', num(), 's', 0, 52),
    'xfade': XFADE(53),
    'glide': param('GLIDE', 'Speed glide in seconds, 0 to 4, exponential knob.', num(0, 4), 's', 0, 54),
    'density': param('DENSITY', 'Density, 0 to 1. A fresh DISC is at 0.7.', num(0, 1), '%', 0.7, 58),
    'level': LEVEL('LEVEL', 56),
    'sos': param('SOS', 'Sound-on-sound level in dB, -100 to 0 (fine near 0 dB).', num(-100, 0), 'dB', 0, 57),
    'reverse': toggle('REVERSE', 'Play backwards (verified: beats 7..0, VERIFY).'),
    'freeze': toggle('FREEZE', 'Freeze the playhead at freeze_position: the S-4 loops grains there (the STRETCH engine, lines 83.6 Hz apart; VERIFY5).'),
    'loop': toggle('LOOP', 'Loop within LENGTH. Only matters when LENGTH is longer than the sample: off plays the sample once, then silence until the region comes round (VERIFY6).', 1),
    'monitor': toggle('MONITOR', 'Monitor the input on this track.'),
    'library_sample_path': {'type': 'string', 'pattern': '^/(data|tmp/S-4/browser)/SAMPLES/', 'description': 'A sample in the S-4\'s library: /data/SAMPLES/... (e.g. /data/SAMPLES/BOUNCES/RECS/2_disc_track1_114bpm.wav) or /tmp/S-4/browser/SAMPLES/01_FACTORY | 02_USER | 03_USB_DRIVE/... When present the DISC plays this file; otherwise discs/scene<scene_index+1>_track<track_index+1>.wav in the project folder.'},
    'sample_title': {'type': 'string', 'description': 'The sample\'s name as the S-4 shows it.'},
    'default_sample_tempo': num(0, description='The sample\'s tempo in BPM as first loaded (filled in by the S-4 on save when missing).'),
    'freeze_position': num(0, integer=True, description='Frozen playhead position in samples at 48 kHz (1152 = 0.024 s, 105600 = 2.2 s; VERIFY5).'),
    'track_index': num(0, 3, True, description='Track (0-3) of the scene that owns the sample file. With KEEP SAMPLE / KEEP PARAMS a track carries another scene\'s block.'),
    'scene_index': num(0, 127, True, description='Scene (0-127) that owns the sample file: discs/scene<scene_index+1>_track<track_index+1>.wav (verified up to scene 128, VERIFY2).'),
}
TAPE = {
    'speed': param('SPEED', 'Varispeed in semitones. CC 46 covers -36 to +36 linearly; OCTAVES and the scales take the nearest step (CAL4).', num(-36, 36), 'st', 0, 46,
                   [mode('', 'OCTAVES', 'whole octaves (the default; verified -12 = 220.00 Hz from 440, VERIFY)', {'enum': in_scale('octaves')})] +
                   [mode(n, n.upper(), 'semitones on this scale\'s notes', {'enum': in_scale(n)}) for n in SCALE_NAMES if n != 'octaves'] +
                   [mode('free', 'FREE', 'continuous semitones', num(-36, 36))]),
    'rotate': bi('ROTATE', 48, 'Rotate the tape loop, -1 to +1.'),
    'length': param('LENGTH', 'Tape length in beats at the project tempo, counted in tape time (VERIFY: a 100 BPM tape at 120 needs 9.6 beats), on the grid in mode; seconds in "free" (8.749521 s matched a recorded tape of 8.7495 s). On the 1/1 grid, CC 49 goes from 1 bar to the 30 s a TAPE holds at the project tempo, in whole bars: round(1 + x (B - 1)) bars, B = 30 s in bars, not rounded (15 at 120 BPM, 11.25 at 90; CAL4, CAL5).', num(0), 'beats', None, 49,
                    [mode(g, g, f'grid {g}; value in beats') for g in GRIDS] + [mode('free', 'FREE', 'seconds', num(0), 's')]),
    'level': LEVEL('LEVEL', 50),
    'sos': bi('SOS', 51, 'Sound-on-sound, -1 to +1.'),
    'xfade': XFADE(53),
    'reverse': toggle('REVERSE', 'Play backwards.'),
    'monitor': toggle('MONITOR', 'Monitor the input on this track.'),
    'sample_path': {'type': 'string', 'description': 'Where the tape was loaded from on the S-4 (e.g. /tmp/S-4/browser/SAMPLES/...); informational. The audio is tapes/scene<scene_index+1>_track<track_index+1>_tape.wav.'},
    'sample_title': {'type': 'string', 'description': 'The tape\'s name as the S-4 shows it ("*" marks an edited tape).'},
    'track_index': num(0, 3, True, description='Track (0-3) that owns the tape file.'),
    'scene_index': num(0, 127, True, description='Scene (0-127) that owns the tape file: tapes/scene<scene_index+1>_track<track_index+1>_tape.wav.'),
}
POLY = {
    'pitch': param('PITCH', 'Pitch in semitones. MIDI note 60 plays the sample at its own pitch (VERIFY). CC 46 covers -12 to +12 linearly in both modes (CAL4).', num(), 'st', 0, 46,
                   [mode('', 'CHROMATIC', 'whole semitones (verified +3 = +300.1 cents); set over MIDI, the S-4 stores the value unrounded (CAL4)', num()), mode('free', 'FREE', 'continuous semitones, -12 to +12, linear (verified +2.5 = +250.0 cents)', num(-12, 12))]),
    'start': param('START', 'Start as a fraction of the sample, 0 to 1, linear on CC 48 (CAL4).', num(0, 1), '%', 0, 48),
    'length': param('LENGTH', 'Length as a fraction of the sample, 0 to 1 (1 = to the end), linear on CC 49 (CAL4).', num(0, 1), '%', 1, 49),
    'level': LEVEL('LEVEL', 50),
    'loop': param('LOOP', 'Loop point as a fraction, 0 to 1.', num(0, 1), '%', 0, 52),
    'loop_mode': {'type': 'object', 'description': 'LOOP MODE: 0 = off, 1 = loop, 2 = ping-pong.', 'x-label': 'LOOP MODE', 'default': {'value': 0},
                  'properties': {'value': {'enum': [0, 1, 2]}}, 'required': ['value'], 'additionalProperties': False},
    'xfade': XFADE(53),
    'attack': param('ATTACK', 'Attack in seconds, 0 to 4, exponential knob.', num(0, 4), 's', 0.005, 54),
    'decay': param('DECAY', 'Decay in seconds, 0 to 4, exponential knob.', num(0, 4), 's', 0.2, 55),
    'sustain': param('SUSTAIN', 'Sustain level, 0 to 1.', num(0, 1), '%', 0.5, 56),
    'curve': param('CURVE', 'Envelope curve, -1 to +1.', num(-1, 1), '±', -0.25, 57),
    'velocity': param('VELOCITY', 'Velocity sensitivity, 0 to 1.', num(0, 1), '%', 0.5, 58),
    'filter_amount': param('FLTR AMOUNT', 'Filter envelope amount, -1 to +1.', num(-1, 1), '±', 0, 60),
    'filter_shape': param('FLTR SHAPE', 'Filter shape, -1 to +1.', num(-1, 1), '±', 0, 61),
    'sample_path': {'type': 'string', 'description': 'Where the sample was loaded from on the S-4; informational. The audio is tapes/scene<scene_index+1>_track<track_index+1>_poly.wav.'},
    'sample_title': {'type': 'string', 'description': 'The sample\'s name as the S-4 shows it.'},
    'track_index': num(0, 3, True, description='Track (0-3) that owns the sample file.'),
    'scene_index': num(0, 127, True, description='Scene (0-127) that owns the sample file: tapes/scene<scene_index+1>_track<track_index+1>_poly.wav.'),
}

# ---------------------------------------------------------------- routings
REF = lambda name, desc=None: dict({'$ref': f'#/$defs/{name}'}, **({'description': desc} if desc else {}))
MOD_TARGETS = lambda params: [k for k, v in params.items() if v.get('type') == 'object' and 'x-cc' in v]
MAT_TARGETS = {
    'disc': ['speed', 'tempo', 'start', 'length', 'offset', 'xfade', 'glide', 'level', 'sos', 'density'],
    'tape': ['speed', 'rotate', 'length', 'level', 'sos', 'xfade'],
    'poly': ['pitch', 'start', 'length', 'level', 'loop', 'xfade', 'attack', 'decay', 'sustain', 'curve', 'velocity', 'filter_amount', 'filter_shape'],
}
MIX_TARGETS = [f'{k}{n}' for k in ('level', 'pan', 'cutoff') for n in range(1, 5)] + ['compress_amount', 'main_level']


def target_tree(routes, sends=False):
    """slot -> device -> parameter -> routings: every parameter of a track that can be modulated"""
    leaf = REF(routes)
    tree = {'material': obj('Material parameters.', {d: obj(f'{d.upper()} parameters.', {k: leaf for k in ks}) for d, ks in MAT_TARGETS.items()})}
    for slot_name, (dev, label, params, _) in DEVICES.items():
        tree[slot_name] = obj(f'{label}.', {dev: obj(f'{label} parameters.', {k: leaf for k in MOD_TARGETS(params)})})
    if sends:
        tree['track_output'] = obj('Sends.', {'track_output': obj('SEND 1-4.', {f'send{n}': leaf for n in range(1, 5)})})
    mod_values = obj("A modulator's values, keyed by the type in that slot (modulator to modulator; a modulator may modulate itself).",
                     {key: obj(f'{label} values.', {k: leaf for k in MOD_TARGETS(params)}) for key, (_, label, params) in MODS.items()})
    for n in range(1, 5):
        tree[f'modulator{n}'] = mod_values
    return tree


# ---------------------------------------------------------------- the project
def slot(slot_name):
    dev, label, params, byp = DEVICES[slot_name]
    return {'type': 'object',
            'description': f"{slot_name.upper()} slot ({label}). Empty ({{}}): the S-4 keeps the previous scene's on / bypass state for this slot and resets the values to its defaults (VERIFY2); the app writes every slot out in full for that reason. A bypassed device keeps its settings.",
            'properties': {'selected': {'enum': [0, byp], 'description': f'0 = {label} on, {byp} = BYPASS (measured on the S-4).'}, dev: REF(dev)},
            'additionalProperties': False}


MIX_PARAMS = {}
for n in range(1, 5):
    MIX_PARAMS[f'level{n}'] = param(f'T{n} LEVEL', f"Track {n} mixer level in dB, -100 (off) to +6, exponential knob with fine steps near the top (CC {45 + n} on channel 16: 64 = -13.04 dB, 100 = +1.04 dB; CAL4). Post-fader on the master and on the track's own USB return (VERIFY2).", num(-100, 6), 'dB', 0)
    MIX_PARAMS[f'pan{n}'] = param(f'T{n} PAN', f'Track {n} pan, -1 (left) to +1 (right), linear on CC {53 + n}, channel 16 (CAL4). Pan law (VERIFY3/4): exactly 0 = unity on both sides; otherwise L = 2 cos t, R = 2 sin t with t = (pan + 1) pi / 4.', num(-1, 1), '±', 0)
    MIX_PARAMS[f'cutoff{n}'] = param(f'T{n} FLTR', f'Track {n} filter, -1 to +1 (0 = open), linear on CC {49 + n}, channel 16 (CAL4).', num(-1, 1), '±', 0)
    MIX_PARAMS[f'mute{n}'] = {'type': 'object', 'description': f'Track {n} mute: 0 = playing, 1 = muted.', 'x-label': f'T{n} MUTE', 'default': {'value': 0},
                              'properties': {'value': {'enum': [0, 1]}}, 'required': ['value'], 'additionalProperties': False}
MIX_PARAMS['compress_amount'] = param('COMPRESSOR', 'Master compressor amount, 0 to 1, linear on CC 58, channel 16 (CAL4).', num(0, 1), '%', 0)

QUANT = param('QUANTIZE', 'When a launched scene starts (saved on the S-4, 2026-10-20). The S-4\'s default is "" with 5 (1/1).', num(), '', 5, None,
              [mode('', 'STRAIGHT', f'value = {DIVS_TXT}', num(0, 11, True)), mode('triplet', 'TRIPLET', 'the same steps as triplets', num(0, 11, True)),
               mode('dotted', 'DOTTED', 'the same steps dotted (e.g. {6, "dotted"} = 1/2D)', num(0, 11, True)),
               mode('free', 'FREE', 'launches per second in Hz, 0.020 to 50 (read on the S-4; 0.500 Hz on the screen = 0.49999997)', num(0.02, 50), 'Hz'),
               mode('sample end', 'SAMPLE END', "at the end of a track's sample; value = the track counted from 0 (TRACK 2 = 1)", num(0, 3, True)),
               mode('off', 'OFF', 'no quantisation; also stops chained scenes from launching. value 0', {'const': 0})])
SCENE_KEY = '^(\\d|[1-9]\\d|1[01]\\d|12[0-7])$'

SEND_DESC = "Send into track {n}'s input in dB, -100 (off) to 0 (the highest value the S-4 allows). Verified: -6 dB into a track with input SENDS ONLY measures -6.00 dB (VERIFY). No MIDI CC reaches it."
DEFS = {
    'track': {
        'type': 'object', 'description': 'One track of a scene (four per scene, T1-T4).',
        'properties': {
            'material': {'type': 'object', 'description': 'MATERIAL slot: the sound source. The S-4 keeps the blocks of devices used before next to the active one. Samples are not inherited from the scene before: an empty track is silent (VERIFY2).',
                         'properties': {'selected': {'enum': [0, 1, 2, 4], 'description': "Active material: 0 = DISC, 1 = TAPE, 2 = POLY, 4 = BYPASS (live input through the track's effects)."},
                                        'disc': REF('disc'), 'tape': REF('tape'), 'poly': REF('poly')},
                         'additionalProperties': False},
            **{s: slot(s) for s in DEVICES},
            **{f'modulator{n}': REF('modulator', f"MOD {n}. Empty ({{}}): the previous scene's modulator is carried over (and saved into this scene; VERIFY2). Default types per slot: RANDOM, RANDOM, WAVE, WAVE.") for n in range(1, 5)},
            'track_output': {'type': 'object', 'description': 'Sends from this track. Empty: no sends (not inherited from the scene before; VERIFY2).',
                             'properties': {'track_output': obj('SEND 1-4 into the inputs of tracks 1-4 (this track included).',
                                                                {f'send{n}': param(f'SEND {n}', SEND_DESC.format(n=n), num(-100, 0), 'dB', -100) for n in range(1, 5)})},
                             'additionalProperties': False},
            'modulator_mappings': REF('mod_targets', "This track's modulator routings (per scene). Verified: a WAVE routed to DISC SPEED moves the pitch by the amount x the target's full range (VERIFY5)."),
        },
        'required': ['material'], 'additionalProperties': False,
    },
    'modulator': {'type': 'object', 'description': 'A modulator slot (track MOD 1-4, a mix modulator or a perform modulator).',
                  'properties': dict({'selected': {'enum': [0, 1, 2, 4], 'description': "The type in this slot: 0 = WAVE, 1 = RANDOM, 2 = FOLLOW, 4 = ADSR (3 is not a type: the S-4 makes nothing of it). Missing: the slot's default type. The S-4 may keep an earlier type's block next to the active one."}},
                                     **{key: REF(key) for key in MODS}),
                  'additionalProperties': False},
    **{key: obj(f"{label} modulator values (the S-4's defaults where missing). x-cc is n in cc = 14 + 8 x (slot - 1) + n.", params) for key, (_, label, params) in MODS.items()},
    **{dev: obj(f"{label} ({slot_name.upper()} slot) parameters; the S-4's defaults where missing. CC numbers are on the track's MIDI channel.", params) for slot_name, (dev, label, params, _) in DEVICES.items()},
    'disc': obj('DISC: sample playback streamed from disk.', DISC),
    'tape': obj('TAPE: a recordable tape loop.', TAPE),
    'poly': obj('POLY: the sample played polyphonically from MIDI notes.', POLY),
    'route': {'type': 'object', 'description': "One routing: value = amount, -1 to +1, as a fraction of the target's full knob range (0.1 on DISC SPEED = ±7.2 semitones of its ±36); mode = polarity.",
              'properties': {'value': num(-1, 1, description='Amount, -1 to +1 (negative inverts).'),
                             'mode': {'enum': [0, 1], 'description': '0 = BIPOLAR (both ways), 1 = UNIPOLAR (upward only; 0.1 gave 0 to +7.3 st on DISC SPEED). Verified VERIFY5.'}},
              'required': ['value', 'mode'], 'additionalProperties': False},
    'routes_mod': {'type': 'object', 'description': 'Routings onto one parameter, keyed by modulator slot as a string: "0"-"3" = MOD 1-4.',
                   'propertyNames': {'pattern': '^[0-3]$'}, 'additionalProperties': REF('route')},
    'routes_macro': {'type': 'object', 'description': 'Routings onto one parameter, keyed by macro as a string: "0"-"7" = MACRO 1-8, "8"-"11" = the action macros (MACRO 9-12).',
                     'propertyNames': {'pattern': '^([0-9]|1[01])$'}, 'additionalProperties': REF('route')},
    'mod_targets': obj("Routing targets of a track's modulators: slot -> device -> parameter -> {modulator slot: route}.", target_tree('routes_mod')),
    'macro_targets': obj('Routing targets of the macros on one track: slot -> device -> parameter -> {macro: route}, plus the sends.', target_tree('routes_macro', sends=True)),
}

settings = obj("The project's settings pages.", {
    'audio_settings': obj('AUDIO settings.', {
        'input_source': {'enum': [0, 1, 2, 3], 'description': 'INPUT: 0 = IN1/IN2, 1 = MIC, 2 = IN1/MIC, 3 = HEADSET (as named on the screen).', 'default': 0},
        'mic_gain': num(0, 100, True, description='MIC GAIN, 0 to 100.', default=50),
        **{f'track{n}_input': {'enum': [0, 1, 2, 3], 'description': f'TRACK {n} INPUT: 0 = STEREO, 1 = IN1, 2 = IN2, 3 = SENDS ONLY.', 'default': 0} for n in range(1, 5)},
        'monitor_on_record': {'type': 'boolean', 'description': 'MONITOR ON RECORD.', 'default': True},
    }),
    'perform_settings': obj('PERFORM names, as typed on the S-4 (upper case).', {
        **{f'macro{k}_name': {'type': 'string', 'description': f'Name of macro {k}.', 'default': f'MACRO {k}'} for k in range(1, 9)},
        **{f'action{k}_name': {'type': 'string', 'description': f'Name of action macro {k} (MACRO {k + 8}).', 'default': f'MACRO {k + 8}'} for k in range(1, 5)},
    }),
    'midi_settings': obj('MIDI settings.', {f'track{n}_midi_channel': num(1, 16, True, description=f"Track {n}'s MIDI channel, 1-16 (1-based).", default=n) for n in range(1, 5)}),
    'meter_settings': obj('METER settings.', {
        'track_play_quantization': {'enum': list(range(8)), 'description': 'TRACK PLAY quantisation: ' + ', '.join(f'{i} = {m}' for i, m in enumerate(METER)) + ' (every step read on the S-4; the list wraps from 4 BAR to NONE).', 'default': 5},
        'track_record_quantization': {'enum': list(range(8)), 'description': 'TRACK RECORD quantisation, same list.', 'default': 5},
        'mix_record_quantization': {'enum': list(range(8)), 'description': 'MAIN RECORD quantisation, same list.', 'default': 5},
        'modulators_running': {'enum': [0, 1], 'description': 'MODULATORS RUNNING: 0 = ALWAYS, 1 = WHEN PLAYING.', 'default': 1},
        'fx_running': {'enum': [0, 1], 'description': 'MOSAIC RUNNING: 0 = ALWAYS, 1 = WHEN PLAYING.', 'default': 1},
        'post_record_action': {'enum': [0, 1], 'description': 'POST RECORD ACTION: 0 = PLAY, 1 = OVERDUB.', 'default': 0},
    }),
    'scene_settings': obj('SCENE settings.', {
        'tracks': {'type': 'array', 'description': "KEEP SAMPLE / KEEP PARAMS per track (T1-T4). On the next save the S-4 copies a kept track's state into the other scenes.",
                   'minItems': 4, 'maxItems': 4, 'items': obj('One track.', {'sample': {'type': 'boolean', 'description': 'KEEP SAMPLE.'}, 'params': {'type': 'boolean', 'description': 'KEEP PARAMS.'}})},
    }),
})


def mix_targets(routes):
    return obj('Mixer targets.', {'mix': obj('Mixer targets: ' + ', '.join(MIX_TARGETS) + '.', {k: REF(routes) for k in MIX_TARGETS})})


MACRO_DESC = "Macro {k}'s value, -1 to +1, linear on its CC (45 + {k}, channel 15), with UNIPOLAR, BIPOLAR or no routings (CAL4, CAL5). Its polarity on the screen follows its routings' modes; this field's mode is a leftover (\"\" or \"unipolar\") that does not decide it."
global_slots = obj('Project-wide state (not per scene).', {
    'mixer': obj('The MIX view: one mixer for all scenes.', {
        'mix': {'type': 'object', 'description': 'Mixer values. Empty: all at their defaults (0 dB, centre, open, unmuted, no compression).',
                'properties': {'selected': {'const': 0, 'description': 'Always 0.'}, 'mix': obj('Per-track level, pan, filter and mute, and the master compressor.', MIX_PARAMS)},
                'additionalProperties': False},
        **{f'modulator{n}': REF('modulator', f'Mix modulator {n} (default types RANDOM, RANDOM, WAVE, WAVE).') for n in range(1, 5)},
        'track_playing': {'type': 'array', 'description': 'Which tracks play when the project loads (T1-T4).', 'items': {'type': 'boolean'}, 'minItems': 4, 'maxItems': 4, 'default': [True] * 4},
        'modulator_mappings': {'type': 'object', 'description': 'Mix modulator routings: mix -> mix -> mixer parameter -> {modulator slot: route}.',
                               'properties': {'mix': mix_targets('routes_mod')}, 'additionalProperties': False},
    }),
    'perform': {'type': 'object', 'description': 'PERFORM macro values. Empty: all at 0.',
                'properties': {'perform': obj('Macros 1-8 and the action macros.', {
                    **{f'macro{k}': param(f'MACRO {k}', MACRO_DESC.format(k=k), num(-1, 1), '', 0, None, [mode('', '(none)'), mode('unipolar', 'UNIPOLAR')]) for k in range(1, 9)},
                    **{f'action{k}': {'type': 'object', 'description': f'Action macro {k} (MACRO {k + 8}): 0 = released, 1 = held / toggled on.', 'properties': {'value': {'enum': [0, 1]}}, 'required': ['value'], 'additionalProperties': False} for k in range(1, 5)},
                })}, 'additionalProperties': False},
    'scene': {'type': 'object', 'description': "How scenes follow each other (Scene view settings). Empty: the S-4's defaults (NEXT, 100 %, QUANTIZE 1/1).",
              'properties': {'scene': obj('RULE, CHANCE and QUANTIZE.', {
                  'chance': param('CHANCE', 'Chance that a chained scene moves on, 0 to 1 (0.598 = 60 %).', num(0, 1), '%', 1),
                  'rule': param('RULE', 'Where a chain moves next: 0 = NEXT, 1 = PREV, 2 = WALK, 3 = RANDOM, 4 = SAME (as named on the screen).', {'enum': [0, 1, 2, 3, 4]}, '', 0),
                  'quantize': QUANT})}, 'additionalProperties': False},
    **{f'modulator{n}': REF('modulator', f'Perform modulator {n} (routed onto the macros; default types RANDOM, RANDOM, WAVE, WAVE).') for n in range(1, 5)},
    'track_mappings': {'type': 'array', 'description': "Macro routings onto each track's parameters (T1-T4), the same in every scene.",
                       'minItems': 4, 'maxItems': 4, 'items': REF('macro_targets')},
    'mix_mappings': {'type': 'object', 'description': 'Macro routings onto the mixer: mix -> mix -> parameter -> {macro: route}.',
                     'properties': {'mix': mix_targets('routes_macro')}, 'additionalProperties': False},
    'modulator_mappings': {'type': 'object', 'description': 'Perform modulator routings onto the macros: perform -> perform -> macroN -> {modulator slot: route}.',
                           'properties': {'perform': obj('Macro targets.', {'perform': obj('MACRO 1-8.', {f'macro{k}': REF('routes_mod') for k in range(1, 9)})})}, 'additionalProperties': False},
    'scene_list_state': {'type': 'object', 'description': 'CHAIN and LOCK per scene, keyed by the scene index as a string ("0"-"127"); scenes not listed are neither.',
                         'propertyNames': {'pattern': SCENE_KEY},
                         'additionalProperties': obj('One scene.', {'is_chained': {'type': 'boolean', 'description': 'CHAIN: the scene plays on into the next by RULE and CHANCE.'},
                                                                    'is_locked': {'type': 'boolean', 'description': 'LOCK.'}})},
})

SCHEMA = {
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    '$id': 's4project.schema.json',
    'title': 'Torso S-4 project.json',
    'description': ('The project.json inside a <NAME>.s4project folder, as saved by the Torso S-4 (OS 2.x, "version": "v14"). '
                    'Learned from S-4 saves, calibration projects and hardware checks (VERIFY.md in s4tools). '
                    "Most parameters are {value, mode} pairs in the S-4's own units; mode \"\" is the default mode, other modes by their lower-case name. "
                    "x-label = the name on the S-4's screen, x-unit = the unit of value, x-cc = the MIDI CC that moves it (on the track's channel), "
                    'default = what a fresh device stores. The folder also holds discs/scene<N>_track<T>.wav (DISC samples), '
                    'tapes/scene<N>_track<T>_tape.wav and _poly.wav (TAPE / POLY), and granular_buffers/.'),
    'type': 'object',
    'properties': {
        'version': {'const': 'v14', 'description': 'File format version written by S-4 OS 2.x.'},
        'data': obj('The project.', {
            'tempo': num(exclusiveMinimum=0, description="Project tempo in BPM (24 to 180 seen; the S-4's limits are not measured)."),
            'scenes': {'type': 'object', 'description': 'Scenes keyed by index as a string ("0"-"127" = scenes 1-128). Only scenes in use are present; keys can have gaps.',
                       'propertyNames': {'pattern': SCENE_KEY},
                       'additionalProperties': obj('One scene.', {'tracks': {'type': 'array', 'description': 'T1-T4.', 'minItems': 4, 'maxItems': 4, 'items': REF('track')}}, ['tracks'])},
            'global_slots': global_slots,
            'settings': settings,
            'selected_scene': num(0, 127, True, description='The scene that was selected when saved (0-127).'),
            'selected_track': num(0, 3, True, description='The track that was selected when saved (0-3).'),
            'selected_page': num(0, integer=True, description='UI page when saved (only 0 seen).'),
            'selected_modulator': num(0, integer=True, description='Selected modulator when saved (only 0 seen).'),
        }, ['tempo', 'scenes', 'global_slots', 'settings']),
    },
    'required': ['version', 'data'],
    'additionalProperties': False,
    '$defs': DEFS,
}


# ---------------------------------------------------------------- markdown reference
def md_value(s):
    if '$ref' in s:
        n = s['$ref'].split('/')[-1]
        return f'see [{n}](#{n.replace("_", "-")})'
    if 'const' in s: return f'`{json.dumps(s["const"])}`'
    if 'enum' in s:
        e = s['enum']
        return ', '.join(f'`{json.dumps(v)}`' for v in e) if len(e) <= 16 else f'{len(e)} values: `{e[0]}`, `{e[1]}` … `{e[-1]}`'
    t = s.get('type', '')
    if t in ('number', 'integer'):
        lo, hi = s.get('minimum', s.get('exclusiveMinimum')), s.get('maximum')
        return t + ('' if lo is None and hi is None else f' {lo if lo is not None else "…"} to {hi if hi is not None else "…"}')
    if t == 'array': return f'array[{s.get("minItems", "")}] of ' + md_value(s.get('items', {}))
    return t or 'any'


def is_param(v):
    return v.get('type') == 'object' and 'x-label' in v and 'value' in v.get('properties', {})


def md_rows(L, s, path):
    for k, v in s.get('properties', {}).items():
        p = f'{path}.{k}' if path else k
        if '$ref' in v:
            L.append(f"| `{p}` | | {md_value(v)} | {v.get('description', '')} |")
        elif is_param(v):
            unit = v.get('x-unit') or ''
            cc = f"<br>CC {v['x-cc']}" if v.get('x-cc') is not None else ''
            dflt = ''
            if 'default' in v:
                dflt = f"<br>default `{json.dumps(v['default']['value'])}`" + (f" `{json.dumps(v['default']['mode'])}`" if v['default'].get('mode') else '')
            L.append(f"| `{p}` | **{v['x-label']}**{cc} | {md_value(v['properties']['value'])} {unit}{dflt} | {v['description']} |")
            for alt in v.get('anyOf', []):
                L.append(f"| | mode `{json.dumps(alt['properties']['mode']['const'])}` | {md_value(alt['properties']['value'])} | {alt['description']} |")
            mo = v['properties'].get('mode')
            if 'anyOf' not in v and isinstance(mo, dict) and 'enum' in mo:
                L.append(f"| | modes | {', '.join('`' + json.dumps(m) + '`' for m in mo['enum'])} | {mo['description']} |")
        elif v.get('type') == 'object':
            L.append(f"| `{p}` | | object | {v.get('description', '')} |")
            md_rows(L, v, p)
            ap = v.get('additionalProperties')
            if isinstance(ap, dict):
                if '$ref' in ap:
                    L.append(f"| `{p}.<key>` | | {md_value(ap)} | keys match `{v.get('propertyNames', {}).get('pattern', '')}` |")
                elif ap.get('properties'):
                    L.append(f"| `{p}.<key>` | | object | {ap.get('description', '')} Keys match `{v.get('propertyNames', {}).get('pattern', '')}`. |")
                    md_rows(L, ap, p + '.<key>')
        else:
            L.append(f"| `{p}` | {v.get('x-label', '')} | {md_value(v)} | {v.get('description', '')} |")


HEAD = ['| Field | On the S-4 | Values | Description |', '|---|---|---|---|']


def reference():
    L = ['# S-4 project.json reference', '',
         'Generated by `tools/make_schema.py` together with `schema/s4project.schema.json`; edit the generator, not this file. '
         'Check a project against it with `python tools/check_schema.py <project.json ...>`. '
         'What each MIDI CC sets, over its whole 0-127 range: [S4-CC.md](S4-CC.md).', '',
         SCHEMA['description'], '',
         '- **Note lengths** (rates, times, QUANTIZE): ' + DIVS_TXT + '.',
         '- **Scales** (pitch classes; a scale mode steps through its notes over ±36 semitones): ' + '; '.join(f'{n} {dict(SCALES)[n]}' for n in SCALE_NAMES) + '.',
         "- **Empty blocks** (`{}`) in a scene: an effect slot keeps the scene before's on / bypass state with its values reset; a modulator is carried over from the scene before; sends are not inherited; samples are not inherited (VERIFY2).",
         '', '## Project', ''] + HEAD
    md_rows(L, SCHEMA, '')
    order = ['track', 'disc', 'tape', 'poly', 'mosaic', 'ring', 'deform', 'vast', 'modulator', 'wave', 'random', 'follow', 'adsr', 'route', 'routes_mod', 'routes_macro']
    for name in order:
        d = DEFS[name]
        L += ['', f'## {name}', '', d.get('description', ''), ''] + HEAD
        if d.get('properties'):
            md_rows(L, d, name)
        else:
            L.append(f"| `{name}.<key>` | | {md_value(d.get('additionalProperties', {}))} | keys match `{d.get('propertyNames', {}).get('pattern', '')}` |")
    L += ['', '## Routing targets', '',
          "A track's `modulator_mappings` ([mod_targets], keyed by modulator slot) and each `global_slots.track_mappings[t]` ([macro_targets], keyed by macro) share one tree: "
          'slot -> device -> parameter -> routings.', '']
    for slot_k, v in DEFS['macro_targets']['properties'].items():
        if slot_k.startswith('modulator'):
            continue
        for dev_k, d in v['properties'].items():
            L.append(f"- `{slot_k}.{dev_k}`: " + ', '.join(f'`{k}`' for k in d['properties']))
    L.append("- `modulator1`-`modulator4` . `wave` / `random` / `follow` / `adsr`: that type's eight values")
    L.append('- `track_output.track_output.send1`-`send4`: macro routings only')
    L.append('- the mixer, `mix.mix` (mix modulators and macros): ' + ', '.join(f'`{k}`' for k in MIX_TARGETS))
    return '\n'.join(L) + '\n'


os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 's4project.schema.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(SCHEMA, f, indent=1, ensure_ascii=False)
    f.write('\n')
with open(os.path.join(OUT, 'S4-PROJECT.md'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(reference())
print('wrote schema/s4project.schema.json and schema/S4-PROJECT.md')
