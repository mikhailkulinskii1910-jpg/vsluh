#!/usr/bin/env python3
"""Записывает озвучку игры нейросетевым голосом (Piper, «Ирина», офлайн) и встраивает её в HTML.

  python3 voice.py game.html                     # записать все фразы и встроить в game.html
  python3 voice.py game.html --pron pron.json    # с правками произношения
  python3 voice.py --check Недоросль Милон       # показать, как голос произнесёт слова (фонемы, ˈ = ударение)

pron.json:
  {"replace": {"Милон": "Мило́н"},                       # ударение: знак U+0301 после ударной гласной
   "phonemes": [{"from": ["n","ʲ","ˈ","e","d","ʌ","r","ʌ","s","ɭ"],
                 "to":   ["n","ʲ","i","d","ʌ","r","ˈ","o","s","ʲ","ɭ"], "soft_after": true}]}
  «soft_after» добавляет мягкость (ʲ) после замены, если её нет (нужно для «-сль» → мягкое «ль»).

Нужно: pip install --break-system-packages piper-tts; ffmpeg; node.
Голос скачивается с GitHub (rhasspy/piper, релиз v0.0.2) в tools/.voice/.
"""
import base64, hashlib, json, os, re, subprocess, sys, tarfile, urllib.request, wave
HERE = os.path.dirname(os.path.abspath(__file__))
VD = os.path.join(HERE, '.voice'); MODEL = os.path.join(VD, 'ru-irinia-medium.onnx')
URL = 'https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-ru-irinia-medium.tar.gz'

def ensure_model():
    if os.path.exists(MODEL): return
    os.makedirs(VD, exist_ok=True); tgz = os.path.join(VD, 'v.tgz')
    subprocess.run(['curl', '-sSL', '-m', '300', '-o', tgz, URL], check=True)
    with tarfile.open(tgz) as t: t.extractall(VD)

def load():
    ensure_model()
    from piper import PiperVoice, SynthesisConfig
    return PiperVoice.load(MODEL), SynthesisConfig(length_scale=1.06)

args = sys.argv[1:]
if args and args[0] == '--check':
    v, _ = load()
    for w in args[1:]: print(f'{w:20}', ''.join(v.phonemize(w)[0]))
    sys.exit()

html = args[0]; pron = {}
if '--pron' in args: pron = json.load(open(args[args.index('--pron') + 1], encoding='utf-8'))
v, cfg = load(); SR = v.config.sample_rate
import numpy as np
work = os.path.join(VD, 'clips'); os.makedirs(work, exist_ok=True)
tj = os.path.join(VD, 'texts.json')
subprocess.run(['node', os.path.join(HERE, 'voice_texts.js'), html, tj], check=True)
items = json.load(open(tj, encoding='utf-8'))
PV = hashlib.md5(json.dumps(pron, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:6]

def patch(ph):
    for rule in pron.get('phonemes', []):
        P, R = rule['from'], rule['to']; out = []; i = 0
        while i < len(ph):
            if ph[i:i + len(P)] == P:
                out += R; i += len(P)
                if rule.get('soft_after') and (i >= len(ph) or ph[i] != 'ʲ'): out.append('ʲ')
            else: out.append(ph[i]); i += 1
        ph = out
    return ph

def synth(text, wav):
    for a, b in pron.get('replace', {}).items(): text = text.replace(a, b)
    chunks = []
    for ph in v.phonemize(text):
        a = np.asarray(v.phoneme_ids_to_audio(v.phonemes_to_ids(patch(ph)), cfg), dtype=np.float32).flatten()
        chunks += [a, np.zeros(int(SR * .22), np.float32)]
    audio = np.concatenate(chunks); audio = audio / max(1e-6, np.abs(audio).max()) * .9
    with wave.open(wav, 'wb') as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SR); wf.writeframes((audio * 32767).astype('<i2').tobytes())

VOICE = {}
for it in items:
    h = hashlib.md5((it['key'] + PV).encode()).hexdigest()[:14]
    wav, mp3 = os.path.join(work, h + '.wav'), os.path.join(work, h + '.mp3')
    if not os.path.exists(mp3):
        synth(it['text'], wav)
        word = it['key'].startswith('w:')
        trim = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse'
        af = trim + ('' if word else ',apad=pad_dur=0.15') + ',loudnorm=I=-16:TP=-1.5:LRA=11'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-af', af, '-ac', '1', '-ar', '22050', '-b:a', '40k', mp3], check=True)
    VOICE[it['key']] = base64.b64encode(open(mp3, 'rb').read()).decode()

s = open(html, encoding='utf-8').read()
m = re.search(r'const VOICE=(\{.*?\});\n</script>', s, re.S)
s = s[:m.start(1)] + json.dumps(VOICE, ensure_ascii=False, separators=(',', ':')) + s[m.end(1):]
open(html, 'w', encoding='utf-8').write(s)
print(len(VOICE), 'записей встроено,', round(sum(map(len, VOICE.values())) / 1048576, 2), 'МБ')
