"""Write a calibration project for the S-4: N scenes x 4 empty DISC tracks (the S-4's own empty-track
state, as the app's exporter writes it) and the mixer track levels at -100 dB so nothing is heard.
usage: gen_cal.py out_dir/NAME.s4project scenes"""
import json, os, sys

out, n = sys.argv[1], int(sys.argv[2])
V = lambda value, mode='': {'value': value, 'mode': mode}
T = lambda value: {'value': value}


def disc(s, t):
    return {'speed': V(0, 'octaves'), 'tempo': V(120, 'sync'), 'start': V(0, '1/1'), 'length': V(4, '1/1'),
            'zoom': V(0), 'offset': V(0), 'xfade': V(0), 'glide': V(0), 'density': V(0.7), 'level': V(0), 'sos': V(0),
            'reverse': T(0), 'freeze': T(0), 'loop': T(1), 'monitor': T(0), 'freeze_position': 0, 'track_index': t, 'scene_index': s}


def track(s, t):
    return {'material': {'selected': 0, 'disc': disc(s, t)}, 'granular': {}, 'filter': {}, 'color': {}, 'space': {},
            'modulator1': {}, 'modulator2': {}, 'modulator3': {}, 'modulator4': {}, 'track_output': {}, 'modulator_mappings': {}}


mix = {}
for i in range(1, 5): mix[f'level{i}'] = V(-100)
for i in range(1, 5): mix[f'cutoff{i}'] = V(0)
for i in range(1, 5): mix[f'pan{i}'] = V(0)
mix['compress_amount'] = V(0)
for i in range(1, 5): mix[f'mute{i}'] = T(0)
data = {
    'tempo': 120, 'selected_page': 0, 'selected_modulator': 0, 'selected_track': 0, 'selected_scene': 0,
    'scenes': {str(s): {'tracks': [track(s, t) for t in range(4)]} for s in range(n)},
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
print('wrote', out, os.path.getsize(os.path.join(out, 'project.json')), 'bytes,', n, 'scenes')
