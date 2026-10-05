"""Bounded literal pronunciation replacements; never change chat or commands."""
import re

def pronunciation(text, entries):
    if not isinstance(entries, list):
        return text
    words = {}
    for item in entries[:100]:
        if not isinstance(item, dict):
            continue
        word, spoken = item.get('word'), item.get('spoken')
        if isinstance(word, str) and isinstance(spoken, str) and 0 < len(word.strip()) <= 80 and 0 < len(spoken.strip()) <= 160:
            words[word.strip().casefold()] = re.sub(r'[\x00-\x1f<>]', ' ', spoken.strip())
    if not words:
        return text
    pattern = re.compile(r'(?<!\w)(?:' + '|'.join(re.escape(word) for word in sorted(words, key=len, reverse=True)) + r')(?!\w)', re.IGNORECASE)
    return pattern.sub(lambda match: words.get(match.group().casefold(), match.group()), text)

def profile_settings(value):
    value = value if isinstance(value, dict) else {}
    style = value.get('style', 'synthetic')
    pause = value.get('pauseMs', 180)
    return {'voice_style': style if style in ('natural', 'controlled', 'synthetic') else 'synthetic',
            'sentence_pause_ms': max(0, min(1500, int(pause))) if isinstance(pause, (int, float)) else 180,
            'pronunciation_dictionary': value.get('dictionary', []) if isinstance(value.get('dictionary', []), list) else []}
