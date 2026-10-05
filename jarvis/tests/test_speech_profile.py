import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from speech_profile import pronunciation, profile_settings

class SpeechProfileTests(unittest.TestCase):
    def test_literal_words_preserve_whole_words_and_do_not_cascade(self):
        words=[{'word':'Crazy_Batto','spoken':'Kräisi Batto'},{'word':'CNG','spoken':'Ce En Ge'},{'word':'Li','spoken':'Lian'}]
        self.assertEqual(pronunciation('Crazy_Batto sagt CNG. Licht bleibt. Li.',words),'Kräisi Batto sagt Ce En Ge. Licht bleibt. Lian.')
    def test_longest_phrase_and_regex_characters_are_literal(self):
        self.assertEqual(pronunciation('Lian Li + Test(1)',[{'word':'Lian Li','spoken':'Li An Li'},{'word':'Li','spoken':'Eins'},{'word':'Test(1)','spoken':'Test Eins'}]),'Li An Li + Test Eins')
    def test_dictionary_and_pause_are_bounded(self):
        self.assertEqual(profile_settings({'pauseMs':2000})['sentence_pause_ms'],1500)
        self.assertEqual(pronunciation('CNG',None),'CNG')
        self.assertEqual(profile_settings(None)['voice_style'],'synthetic')
