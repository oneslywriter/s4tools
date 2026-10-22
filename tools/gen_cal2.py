"""Second calibration project: 32 scenes x 4 tracks, the mixer levels at -100 dB.
  scenes  1-8   DISC in SYNC (octaves speed, 1/1 grid)     factory sample BELLUX
  scenes  9-16  DISC in FREE (seconds, free speed)          factory sample BELLUX
  scenes 17-24  TAPE                                        factory sample BELLUX
  scenes 25-32  POLY                                        factory sample CD
Every track has MOD 1-4 = WAVE, RANDOM, FOLLOW, ADSR (selected 0-3; the S-4 fills in the values).
usage: gen_cal2.py out_dir/NAME.s4project"""
import json, os, sys

out = sys.argv[1]
V = lambda value, mode='': {'value': value, 'mode': mode}
T = lambda value: {'value': value}
LIB = '/tmp/S-4/browser/SAMPLES/01_FACTORY/01_MELODIC/'
BELLUX, CD = 'BELLUX_G#m_120BPM', 'CD_D#m_105BPM'


def disc(s, t, free=False, sample=True):
    d = {'speed': V(0, 'free' if free else 'octaves'), 'tempo': V(120, 'free' if free else 'sync'),
         'start': V(0, 'free' if free else '1/1'), 'length': V(8 if free else 16, 'free' if free else '1/1'),
         'zoom': V(0), 'offset': V(0), 'xfade': V(0), 'glide': V(0), 'density': V(0.7), 'level': V(0), 'sos': V(0),
         'reverse': T(0), 'freeze': T(0), 'loop': T(1), 'monitor': T(0)}
    if sample:
        d['library_sample_path'] = LIB + BELLUX + '.wav'
        d['sample_title'] = BELLUX
        d['default_sample_tempo'] = 120
    d.update({'freeze_position': 0, 'track_index': t, 'scene_index': s})
    return d


def tape(s, t):
    return {'speed': V(0), 'rotate': V(0), 'length': V(16, '1/1'), 'level': V(0), 'sos': V(0), 'xfade': V(0),
            'reverse': T(0), 'monitor': T(0), 'sample_path': LIB + BELLUX + '.wav', 'sample_title': BELLUX,
            'track_index': t, 'scene_index': s}


def poly(s, t):
    return {'pitch': V(0), 'start': V(0), 'length': V(1), 'level': V(0), 'loop': V(0), 'xfade': V(0),
            'attack': V(0.005), 'decay': V(0.2), 'sustain': V(0.5), 'curve': V(-0.25), 'velocity': V(0.5),
            'filter_amount': V(0), 'filter_shape': V(0), 'loop_mode': T(0),
            'sample_path': LIB + CD + '.wav', 'sample_title': CD, 'track_index': t, 'scene_index': s}


def track(s, t):
    g = s // 8
    if g == 0: m = {'selected': 0, 'disc': disc(s, t)}
    elif g == 1: m = {'selected': 0, 'disc': disc(s, t, free=True)}
    elif g == 2: m = {'selected': 1, 'disc': disc(s, t, sample=False), 'tape': tape(s, t)}
    else: m = {'selected': 2, 'disc': disc(s, t, sample=False), 'poly': poly(s, t)}
    return {'material': m, 'granular': {}, 'filter': {}, 'color': {}, 'space': {},
            'modulator1': {'selected': 0}, 'modulator2': {'selected': 1}, 'modulator3': {'selected': 2}, 'modulator4': {'selected': 3},
            'track_output': {}, 'modulator_mappings': {}}


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
print('wrote', out, os.path.getsize(os.path.join(out, 'project.json')), 'bytes, 32 scenes')
