"""Shared input selection/fallback tests using a fake PortAudio API; no recording."""
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from audio_devices import InputDeviceError, candidates, device_list, identity, open_input


class Stream:
    def __init__(self, api, options):
        self.api, self.options = api, options
        self.closed = False
        api.streams.append(self)

    def start(self):
        self.api.events.append(('start', self.options['device']))
        if self.options['device'] in self.api.fail_open:
            raise RuntimeError('PortAudio -9999 test failure')

    def stop(self):
        self.api.events.append(('stop', self.options['device']))

    def close(self):
        self.closed = True
        self.api.events.append(('close', self.options['device']))


class AudioApi:
    def __init__(self):
        self.apis = [{'name': 'Windows WASAPI', 'default_input_device': 0},
                     {'name': 'MME', 'default_input_device': 2},
                     {'name': 'Windows WDM-KS', 'default_input_device': 4},
                     {'name': 'Windows DirectSound', 'default_input_device': 5}]
        self.devices = [self.row('Mikrofon (4- ROG CARNYX)', 0, 2, 48000),
                        self.row('Virtual Cable Input', 0),
                        self.row('Mikrofon (4- ROG CARNYX)', 1, 2, 44100),
                        self.row('USB Mic only MME', 1),
                        self.row('Mikrofon (ROG CARNYX)', 2, 2),
                        self.row('Mikrofon (4- ROG CARNYX)', 3, 2),
                        self.row('Speakers', 0, 0),
                        self.row('Missing Kernel Mic', 2)]
        self.formats, self.fail_open = {}, set()
        self.streams, self.events, self.checked, self.wasapi = [], [], [], []

    @staticmethod
    def row(name, hostapi, channels=1, rate=48000):
        return {'name': name, 'hostapi': hostapi, 'max_input_channels': channels, 'default_samplerate': rate}

    def query_hostapis(self): return self.apis
    def query_devices(self): return self.devices
    def WasapiSettings(self, **options): self.wasapi.append(options); return options

    def check_input_settings(self, **options):
        self.checked.append(options)
        if options['device'] in self.formats and (options['channels'], options['samplerate']) not in self.formats[options['device']]:
            raise RuntimeError('Unsupported test format')

    def RawInputStream(self, **options): return Stream(self, options)


class AudioDeviceTests(unittest.TestCase):
    def test_enumeration_includes_mme_only_virtual_and_kernel_inputs_without_opening(self):
        api = AudioApi();rows = device_list(api)
        self.assertEqual(len(rows), 7)
        self.assertTrue(next(r for r in rows if r['name'] == 'USB Mic only MME')['available'])
        self.assertTrue(next(r for r in rows if r['name'] == 'Virtual Cable Input')['available'])
        kernel = next(r for r in rows if r['name'] == 'Missing Kernel Mic')
        self.assertFalse(kernel['available']);self.assertIn('Kernel', kernel['reason'])
        self.assertEqual(api.streams, [])
        self.assertFalse(any(api.devices[c['device']]['hostapi'] == 2 for c in api.checked))

    def test_legacy_kernel_index_maps_only_to_same_shared_endpoint(self):
        api = AudioApi();selected = candidates(4, api)
        self.assertEqual([r['index'] for r in selected], [0, 2, 5])
        with open_input(4, lambda *args: None, api) as (_, info):
            self.assertEqual(info['index'], 0)
        self.assertTrue(all(s.closed for s in api.streams))
        self.assertTrue(all(o['exclusive'] is False for o in api.wasapi))
        self.assertTrue(all(o['auto_convert'] is True for o in api.wasapi))

    def test_default_fallback_does_not_follow_a_different_mme_default_microphone(self):
        api = AudioApi();api.apis[1]['default_input_device'] = 3
        self.assertEqual([r['index'] for r in candidates(None, api)], [0, 2, 5])

    def test_stable_identity_survives_device_index_reordering(self):
        api = AudioApi();saved = {'name':'Mikrofon (4- ROG CARNYX)', 'hostapi':'Windows WASAPI'}
        api.devices[0], api.devices[1] = api.devices[1], api.devices[0]
        self.assertEqual(candidates(saved, api)[0]['index'], 1)
        self.assertEqual(identity(candidates(saved, api)[0]), saved)

    def test_explicit_shared_driver_is_respected_then_same_device_fallbacks_are_available(self):
        api = AudioApi()
        selected = candidates({'name':'Mikrofon (4- ROG CARNYX)', 'hostapi':'MME'}, api)
        self.assertEqual([r['index'] for r in selected], [2, 0, 5])

    def test_bad_old_index_and_missing_selection_do_not_fall_back_to_an_unrelated_mic(self):
        api = AudioApi()
        for saved in [6, 99, {'name':'Other absent mic','hostapi':'Windows WASAPI'}]:
            with self.subTest(saved=saved), self.assertRaises(InputDeviceError):candidates(saved, api)
        self.assertEqual(api.streams, [])

    def test_duplicate_stable_identity_refuses_ambiguous_input(self):
        api = AudioApi();api.devices.append(dict(api.devices[0]))
        saved = {'name':'Mikrofon (4- ROG CARNYX)', 'hostapi':'Windows WASAPI'}
        with self.assertRaisesRegex(InputDeviceError, 'denselben Namen'):candidates(saved, api)
        self.assertFalse(next(r for r in device_list(api) if r['index'] == 0)['available'])

    def test_same_named_usb_siblings_are_not_merged_by_instance_number(self):
        api = AudioApi();api.devices.append(api.row('Mikrofon (5- ROG CARNYX)', 0, 2))
        with self.assertRaises(InputDeviceError):candidates(4, api)

    def test_unique_truncated_mme_alias_can_use_full_wasapi_name(self):
        api = AudioApi();api.devices = [api.row('Kopfhörer (DJI Mic Mini 2-AD92B8 Hands-Free)', 0, 1, 16000),
            api.row('Kopfhörer (DJI Mic Mini 2-AD92B', 1, 1, 44100),
            api.row('Kopfhörer (@System32\\drivers\\bthhfenum.sys,#2;%1 Hands-Free%0\r\n;(DJI Mic Mini 2-AD92B8))', 2, 1, 16000)]
        self.assertEqual([r['index'] for r in candidates(1, api)], [0, 1])
        self.assertEqual(candidates(2, api)[0]['index'], 0)

    def test_ambiguous_truncated_prefix_does_not_select_one_of_two_different_headsets(self):
        api = AudioApi();api.devices = [api.row('A very long microphone device A', 1),
            api.row('A very long microphone device AA full', 0),api.row('A very long microphone device AB full', 0)]
        self.assertEqual([r['index'] for r in candidates(0, api)], [0])

    def test_bluetooth_resource_name_with_parentheses_matches_only_its_full_endpoint_name(self):
        api = AudioApi();api.devices = [api.row('Kopfhörer (Galaxy Watch8 (TVTX) Hands-Free)', 0, 1, 16000),
            api.row('Kopfhörer (@System32\\drivers\\bthhfenum.sys,#2;%1 Hands-Free%0\r\n;(Galaxy Watch8 (TVTX)))', 2, 1, 16000)]
        self.assertEqual([r['index'] for r in candidates(1, api)], [0])

    def test_format_negotiation_uses_supported_stereo_rate_when_mono_is_rejected(self):
        api = AudioApi();api.formats[0] = {(2, 44100)}
        with open_input(0, lambda *args: None, api) as (_, info):
            self.assertEqual(info['samplerate'], 44100);self.assertEqual(info['captureChannels'], 2)
        self.assertEqual(len(api.streams), 1)

    def test_startup_failure_closes_each_attempt_before_trying_same_device_mme(self):
        api = AudioApi();api.fail_open.add(0)
        with open_input(4, lambda *args: None, api) as (_, info):
            self.assertEqual(info['index'], 2)
            self.assertTrue(all(s.closed for s in api.streams[:-1]))
        self.assertTrue(all(s.closed for s in api.streams))
        self.assertNotIn(('start', 1), api.events);self.assertNotIn(('start', 3), api.events)

    def test_all_failed_routes_produce_friendly_error_without_trying_other_microphones(self):
        api = AudioApi();api.fail_open.update({0, 2, 5})
        with self.assertRaisesRegex(InputDeviceError, 'kein anderes Mikrofon'):
            with open_input(4, lambda *args: None, api):pass
        self.assertEqual({s.options['device'] for s in api.streams}, {0,2,5})
        self.assertTrue(all(s.closed for s in api.streams))

    def test_kernel_only_input_is_never_opened_exclusively(self):
        api = AudioApi()
        with self.assertRaisesRegex(InputDeviceError, 'Kernel-Treiber'):
            with open_input(7, lambda *args: None, api):pass
        self.assertEqual(api.streams, [])

    def test_cancellation_prevents_opening_and_exception_inside_capture_does_not_trigger_fallback(self):
        api = AudioApi();cancelled = threading.Event();cancelled.set()
        with self.assertRaises(InterruptedError):
            with open_input(0, lambda *args: None, api, cancelled):pass
        self.assertEqual(api.streams, [])
        with self.assertRaisesRegex(ValueError,'test consumer'):
            with open_input(0, lambda *args: None, api):raise ValueError('test consumer')
        self.assertEqual(len(api.streams),1);self.assertTrue(api.streams[0].closed)


if __name__ == '__main__':unittest.main()
