# Builds the sound-effect sprite (assets/audio/sfx.mp3 + sfx.json) from the audio tracks of the
# OpenArt (Veo 3.1) sound clips: cut, fade, loudness-normalise, crossfade loops, pack with gaps.
#   python3 -I tools/make_sfx.py <dir with the downloaded .mp4 clips>
import json, os, subprocess, sys, wave
import numpy as np

SR = 44100
RAW = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'audio')

# name: (clip, start, end, fade in, fade out, loudness target dBFS RMS)  -  times in seconds
SPEC = {
    'nuke':        ('nuke', 0.30, 8.00, 0.01, 2.6, -11),
    'boomBig1':    ('boom4', 0.12, 2.05, 0.005, 0.7, -14),
    'boomBig2':    ('boom4', 2.00, 4.90, 0.005, 1.0, -14),
    'boomBig3':    ('boom4', 5.05, 8.00, 0.005, 1.0, -14),
    'boomSmall1':  ('boom_small', 0.00, 1.60, 0.005, 0.6, -17),
    'boomSmall2':  ('boom_small', 4.38, 5.24, 0.005, 0.3, -17),
    'boomSmall3':  ('boom_small', 5.25, 5.86, 0.005, 0.2, -17),
    'boomSmall4':  ('boom_small', 5.87, 6.50, 0.005, 0.2, -17),
    'boomSmall5':  ('boom_small', 6.51, 7.60, 0.005, 0.4, -17),
    'orbital':     ('orbital', 1.97, 6.00, 0.08, 1.4, -14),
    'holeLoop':    ('hole_loop', 0.30, 7.90, 0, 0, -15, 'loop'),
    'holeCollapse': ('hole_collapse', 0.80, 4.00, 0.3, 0.6, -14),
    'siren':       ('siren', 0.00, 4.00, 0.05, 0.4, -18),
    'gatling':     ('gatling', 0.10, 3.10, 0.01, 0.05, -19),
    'missile1':    ('missile', 0.08, 2.50, 0.005, 0.8, -19),
    'missile2':    ('missile', 2.52, 4.00, 0.005, 0.5, -19),
    'plasma1':     ('plasma', 0.00, 1.12, 0.005, 0.35, -19),
    'plasma2':     ('plasma', 1.16, 2.08, 0.005, 0.3, -19),
    'plasma3':     ('plasma', 2.10, 3.15, 0.005, 0.35, -19),
    'rail1':       ('rail', 0.62, 2.15, 0.01, 0.6, -17),
    'rail2':       ('rail', 2.12, 3.60, 0.01, 0.6, -17),
    'flak1':       ('flak', 0.05, 1.10, 0.005, 0.6, -21),
    'flak2':       ('flak', 2.20, 3.25, 0.005, 0.6, -21),
    'mortar1':     ('mortar', 0.00, 1.80, 0.005, 1.0, -17),
    'mortar2':     ('mortar', 2.45, 3.95, 0.005, 0.9, -17),
    'flame':       ('flame', 0.05, 2.40, 0.02, 0.1, -20),
    'emp1':        ('emp', 0.00, 0.55, 0.005, 0.2, -20),
    'emp2':        ('emp', 0.78, 1.12, 0.005, 0.12, -20),
    'emp3':        ('emp', 1.38, 1.70, 0.005, 0.12, -20),
    'emp4':        ('emp', 2.40, 2.72, 0.005, 0.12, -20),
    'cryo':        ('cryo', 0.00, 1.20, 0.05, 0.4, -24),
    'freeze':      ('cryo', 2.55, 3.50, 0.01, 0.3, -21),
    'acid1':       ('acid', 0.00, 1.10, 0.005, 0.5, -20),
    'acid2':       ('acid', 2.55, 3.50, 0.005, 0.4, -20),
    'horn':        ('horn', 0.25, 4.00, 0.03, 1.2, -15),
}
if os.path.exists(os.path.join(RAW, 'victory.mp4')):
    SPEC['victory'] = ('victory', 0.00, 4.00, 0.01, 0.8, -15)
    SPEC['defeat'] = ('defeat', 0.00, 4.00, 0.01, 0.8, -15)

cache = {}
def clip(name):
    if name not in cache:
        wav = os.path.join(RAW, name + '.wav')
        if not os.path.exists(wav):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(RAW, name + '.mp4'), '-vn', '-ac', '1', '-ar', str(SR), wav], check=True)
        w = wave.open(wav)
        cache[name] = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return cache[name]

def rms_db(x): return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)

parts, meta, pos = [np.zeros(int(0.1 * SR), np.float32)], {}, 0.1
gap = np.zeros(int(0.25 * SR), np.float32)
for name, sp in SPEC.items():
    src, a, b, fi, fo, target = sp[:6]
    x = clip(src)[int(a * SR):int(b * SR)].copy()
    x -= x.mean()
    if len(sp) > 6 and sp[6] == 'loop':
        # seamless loop: crossfade the last second into the start
        n = SR
        head, tail = x[:n].copy(), x[-n:]
        t = np.linspace(0, 1, n, dtype=np.float32)
        x = x[:-n]
        x[:n] = head * np.sqrt(t) + tail * np.sqrt(1 - t)
    # loudness: RMS over the loud part, then a soft peak limit
    loud = x[np.abs(x) > np.abs(x).max() * 0.05]
    x *= 10 ** ((target - rms_db(loud if len(loud) else x)) / 20)
    pk = np.abs(x).max()
    if pk > 0.97: x = np.tanh(x / pk * 1.6) / np.tanh(1.6) * 0.97
    if fi: x[:int(fi * SR)] *= np.linspace(0, 1, int(fi * SR), dtype=np.float32)
    if fo: x[-int(fo * SR):] *= np.linspace(1, 0, int(fo * SR), dtype=np.float32) ** 1.5
    meta[name] = [round(pos, 4), round(len(x) / SR, 4)]
    parts += [x, gap]
    pos += len(x) / SR + len(gap) / SR

y = np.concatenate(parts)
os.makedirs(OUT, exist_ok=True)
tmp = os.path.join(OUT, '_sfx.wav')
w = wave.open(tmp, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes()); w.close()
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', '96k', os.path.join(OUT, 'sfx.mp3')], check=True)
os.remove(tmp)
json.dump(meta, open(os.path.join(OUT, 'sfx.json'), 'w'), separators=(',', ':'))
print(f'{len(meta)} sounds, {pos:.1f} s, {os.path.getsize(os.path.join(OUT, "sfx.mp3")) // 1024} KB')
