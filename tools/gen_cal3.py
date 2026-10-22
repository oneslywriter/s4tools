"""Third calibration project: parameter MODES. MIDI can't switch a mode, so the project presets them and the
CC sweeps (same as CAL2) measure each parameter's values in that mode. 32 scenes x 4 tracks, mixer at -100 dB.
  scenes  1-8   G1  DISC sync, SPEED 'major'      MOSAIC pitch 'chromatic' rate 'triplet' scan 'delay sync'
                    feedback 'sos'; RING waves/noise rate 'free'; VAST time 'triplet'; WAVE / RANDOM rate and
                    FOLLOW hold 'triplet'
  scenes  9-16  G2  TAPE, SPEED 'pentatonic'      MOSAIC pitch 'major' rate 'dotted' scan 'delay free';
                    VAST time 'dotted'; rates / hold 'dotted'; TAPE also gets CC 50, 54, 55, 56 (find LEVEL)
  scenes 17-24  G3  POLY, PITCH 'free'            MOSAIC pitch 'octaves' rate 'free' scan 'position';
                    VAST time 'free'; rates / hold 'free'
  scenes 25-32  G4  DISC STRETCH, SPEED 'chromatic'  MOSAIC pitch 'pentatonic'; everything else default ('')
Every track: MOD 1-4 = WAVE, RANDOM, FOLLOW, ADSR (selected 0, 1, 2, 4).
Track k = (scene % 8) * 4 + track gets, for the i-th CC of its list, round(((A[i % 16] * k + 7 * (i // 16)) % 32) * 127 / 31)
with A = 1, 3, 5 ... 31: a different permutation of the 32 levels for every CC.
usage: gen_cal3.py out_dir/NAME.s4project plan.json"""
import json, os, sys

out, plan_out = sys.argv[1], sys.argv[2]
V = lambda value, mode='': {'value': value, 'mode': mode}
T = lambda value: {'value': value}
LIB = '/tmp/S-4/browser/SAMPLES/01_FACTORY/01_MELODIC/'
BELLUX, CD = 'BELLUX_G#m_120BPM', 'CD_D#m_105BPM'

GROUPS = [
    {'mat': 'disc', 'tempo': 'sync', 'speed': 'major',
     'mosaic': {'pitch': ('chromatic', 0), 'rate': ('triplet', 8), 'scan': ('delay sync', 11), 'feedback': ('sos', -50)},
     'ring': {'waves_rate': ('free', 0.25), 'noise_rate': ('free', 0.25)}, 'vast': {'time': ('triplet', 8)},
     'rate': ('triplet', 8), 'hold': ('triplet', 10)},
    {'mat': 'tape', 'speed': 'pentatonic',
     'mosaic': {'pitch': ('major', 0), 'rate': ('dotted', 8), 'scan': ('delay free', 0.4)},
     'ring': {}, 'vast': {'time': ('dotted', 8)}, 'rate': ('dotted', 8), 'hold': ('dotted', 10)},
    {'mat': 'poly', 'pitch': 'free',
     'mosaic': {'pitch': ('octaves', 0), 'rate': ('free', 9), 'scan': ('position', 0.1)},
     'ring': {}, 'vast': {'time': ('free', 8)}, 'rate': ('free', 2), 'hold': ('free', 10)},
    {'mat': 'disc', 'tempo': 'stretch', 'speed': 'chromatic',
     'mosaic': {'pitch': ('pentatonic', 0)}, 'ring': {}, 'vast': {}, 'rate': ('', 2), 'hold': ('', 0)},
]
CC = {
    'disc': [46, 47, 48, 49, 52, 53, 54, 56, 57, 58],
    'tape': [46, 48, 49, 50, 51, 52, 53, 54, 55, 56],
    'poly': [46, 48, 49, 50, 52, 53, 54, 55, 56, 57, 58, 60, 61],
}
TAIL = list(range(62, 75)) + [77] + list(range(78, 92)) + list(range(110, 118)) + list(range(14, 46))
A = list(range(1, 32, 2))
level = lambda k, i: round(((A[i % 16] * k + 7 * (i // 16)) % 32) * 127 / 31)


def disc(s, t, g=None):
    g = g or {}
    tempo, speed = g.get('tempo', 'sync'), g.get('speed', 'octaves')
    d = {'speed': V(0, speed), 'tempo': V(120, tempo), 'start': V(0, '1/1'), 'length': V(16, '1/1'),
         'zoom': V(0), 'offset': V(0), 'xfade': V(0), 'glide': V(0), 'density': V(0.7), 'level': V(0), 'sos': V(0),
         'reverse': T(0), 'freeze': T(0), 'loop': T(1), 'monitor': T(0)}
    if g.get('mat') == 'disc':
        d.update({'library_sample_path': LIB + BELLUX + '.wav', 'sample_title': BELLUX, 'default_sample_tempo': 120})
    d.update({'freeze_position': 0, 'track_index': t, 'scene_index': s})
    return d


def tape(s, t, g):
    return {'speed': V(0, g['speed']), 'rotate': V(0), 'length': V(16, '1/1'), 'level': V(0), 'sos': V(0), 'xfade': V(0),
            'reverse': T(0), 'monitor': T(0), 'sample_path': LIB + BELLUX + '.wav', 'sample_title': BELLUX,
            'track_index': t, 'scene_index': s}


def poly(s, t, g):
    return {'pitch': V(0, g['pitch']), 'start': V(0), 'length': V(1), 'level': V(0), 'loop': V(0), 'xfade': V(0),
            'attack': V(0.005), 'decay': V(0.2), 'sustain': V(0.5), 'curve': V(-0.25), 'velocity': V(0.5),
            'filter_amount': V(0), 'filter_shape': V(0), 'loop_mode': T(0),
            'sample_path': LIB + CD + '.wav', 'sample_title': CD, 'track_index': t, 'scene_index': s}


def modes(defaults, preset):
    return {k: (V(preset[k][1], preset[k][0]) if k in preset else (V(*v) if isinstance(v, tuple) else T(v) if k in ('lock', 'freeze', 'shape', 'midi_trig', 'stereo_input') else v))
            for k, v in defaults.items()}


def mosaic(g, s, t):
    o = modes({'pitch': (0,), 'rate': (9,), 'size': (0.5,), 'contour': (0,), 'scan': (0,), 'spray': (0,), 'pattern': (0,),
               'wet': (1,), 'rand_pitch': (0,), 'rand_rate': (0,), 'rand_size': (0,), 'feedback': (0,), 'rand_amp': (0,),
               'rand_reverse': (0,), 'lock': 0}, g['mosaic'])
    o['random_pattern_buffer'] = [round(((s * 4 + t) * 0.137 + j * 0.291) % 2 - 1, 6) for j in range(8)]
    return o


def ring(g):
    return modes({'cutoff': (1,), 'resonance': (0,), 'decay': (0,), 'pitch': (0,), 'slope': (-1,), 'tone': (0,), 'scale': (0,),
                  'wet': (1,), 'waves': (0,), 'noise': (0,), 'tilt': (0,), 'detune': (0,), 'waves_rate': (5,), 'noise_rate': (5,)}, g['ring'])


def vast(g):
    return modes({'delay_wet': (0,), 'time': (8,), 'feedback': (0.7,), 'spread': (0,), 'reverb_wet': (0,), 'size': (0.5,),
                  'tone': (0,), 'decay': (5,), 'freeze': 0}, g['vast'])


def mods(g, s, t):
    rate = {'rate': g['rate']}
    wave = modes({'rate': (2,), 'amount': (1,), 'phase': (0,), 'offset': (0,), 'skew': (0,), 'fold': (0,), 'curve': (0,),
                  'spread': (0,), 'shape': 0, 'midi_trig': 0}, rate)
    rnd = modes({'rate': (9,), 'amount': (1,), 'phase': (0,), 'offset': (0,), 'length': (16,), 'variation': (0,),
                 'smoothing': (0.001,), 'spread': (0,)}, rate)
    rnd['buffer'] = [round(((s * 4 + t) * 0.173 + j * 0.377) % 2 - 1, 6) for j in range(32)]
    rnd['midi_trig'] = T(0)
    follow = modes({'delay_time': (0,), 'amount': (1,), 'rise': (5,), 'fall': (100,), 'input_level': (0,), 'filter_cutoff': (0,),
                    'sample_hold_rate': (0,), 'spread': (0,), 'stereo_input': 0}, {'sample_hold_rate': g['hold']})
    adsr = modes({'attack': (0.01,), 'decay': (0.5,), 'sustain': (0.5,), 'release': (0.5,), 'attack_curve': (0,),
                  'decay_curve': (0,), 'release_curve': (0,), 'spread': (0,)}, {})
    return {'modulator1': {'selected': 0, 'wave': wave}, 'modulator2': {'selected': 1, 'random': rnd},
            'modulator3': {'selected': 2, 'follow': follow}, 'modulator4': {'selected': 4, 'adsr': adsr}}


def track(s, t):
    g = GROUPS[s // 8]
    if g['mat'] == 'disc': m = {'selected': 0, 'disc': disc(s, t, g)}
    elif g['mat'] == 'tape': m = {'selected': 1, 'disc': disc(s, t), 'tape': tape(s, t, g)}
    else: m = {'selected': 2, 'disc': disc(s, t), 'poly': poly(s, t, g)}
    o = {'material': m, 'granular': {'selected': 0, 'mosaic': mosaic(g, s, t)}, 'filter': {'selected': 0, 'ring': ring(g)},
         'color': {}, 'space': {'selected': 0, 'vast': vast(g)}}
    o.update(mods(g, s, t))
    o.update({'track_output': {}, 'modulator_mappings': {}})
    return o


mix = {}
for i in range(1, 5): mix[f'level{i}'] = V(-100)
for i in range(1, 5): mix[f'cutoff{i}'] = V(0)
for i in range(1, 5): mix[f'pan{i}'] = V(0)
mix['compress_amount'] = V(0)
for i in range(1, 5): mix[f'mute{i}'] = T(0)
data = {
    'tempo': 120, 'selected_page': 0, 'selected_modulator': 0, 'selected_track': 0, 'selected_scene': 0,
    'scenes': {str(s): {'tracks': [track(s, t) for t in range(4)]} for s in range(32)},
    'global_slots': {
        'mixer': {'mix': {'selected': 0, 'mix': mix}, 'modulator1': {}, 'modulator2': {}, 'modulator3': {}, 'modulator4': {},
                  'track_playing': [True, True, True, True], 'modulator_mappings': {}},
        'perform': {}, 'scene': {}, 'modulator1': {}, 'modulator2': {}, 'modulator3': {}, 'modulator4': {},
        'track_mappings': [{}, {}, {}, {}], 'mix_mappings': {}, 'modulator_mappings': {}, 'scene_list_state': {},
    },
    'settings': {
        'audio_settings': {'input_source': 0, 'mic_gain': 50, 'track1_input': 0, 'track2_input': 0, 'track3_input': 0, 'track4_input': 0, 'monitor_on_record': True},
        'perform_settings': {'macro1_name': 'MACRO 1', 'macro2_name': 'MACRO 2', 'macro3_name': 'MACRO 3', 'macro4_name': 'MACRO 4',
                             'macro5_name': 'MACRO 5', 'macro6_name': 'MACRO 6', 'macro7_name': 'MACRO 7', 'macro8_name': 'MACRO 8',
                             'action1_name': 'MACRO 9', 'action2_name': 'MACRO 10', 'action3_name': 'MACRO 11', 'action4_name': 'MACRO 12'},
        'midi_settings': {'track1_midi_channel': 1, 'track2_midi_channel': 2, 'track3_midi_channel': 3, 'track4_midi_channel': 4},
        'meter_settings': {'track_play_quantization': 5, 'track_record_quantization': 5, 'mix_record_quantization': 5, 'modulators_running': 1, 'fx_running': 1, 'post_record_action': 0},
        'scene_settings': {'tracks': [{'sample': False, 'params': False} for _ in range(4)]},
    },
}
os.makedirs(os.path.join(out, 'tapes'), exist_ok=True)
os.makedirs(os.path.join(out, 'granular_buffers'), exist_ok=True)
with open(os.path.join(out, 'project.json'), 'w', encoding='utf-8', newline='') as f:
    f.write(json.dumps({'version': 'v14', 'data': data}, separators=(',', ':')))
lists = [CC[g['mat']] + TAIL for g in GROUPS]
plan = {'groups': [g['mat'] for g in GROUPS], 'lists': lists,
        'levels': [[[level(k, i) for i in range(len(lst))] for k in range(32)] for lst in lists]}
json.dump(plan, open(plan_out, 'w'))
print('wrote', out, os.path.getsize(os.path.join(out, 'project.json')), 'bytes; CCs per track', [len(l) for l in lists])
