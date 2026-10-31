# Builds the sound-effect sprite (assets/audio/sfx.mp3 + sfx.json) from the audio tracks of the
# OpenArt (Veo 3.1) sound clips: cut, fade, loudness-normalise, crossfade loops, pack with gaps.
#   python3 -I tools/make_sfx.py <dir with the downloaded .mp4 clips>
import json, os, subprocess, sys, wave
import numpy as np

SR = 44100
RAW = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'audio')

# name: (clip, start, end, fade in, fade out, loudness target, flags)  -  times in seconds.
# The loudness target is measured in the 300-6000 Hz band (what a phone speaker actually plays), on the
# loud part of the sound, in dBFS at runtime gain 1. 'boom' = bass-heavy sound: sub-bass trimmed and turned
# into audible harmonics plus a presence lift, so explosions punch through on small speakers.
SPEC = {
    'nuke':        ('nuke', 0.30, 8.00, 0.01, 2.6, -13, 'boom'),
    'boomBig1':    ('boom4', 0.12, 2.05, 0.005, 0.7, -18, 'boom'),
    'boomBig2':    ('boom4', 2.00, 4.90, 0.005, 1.0, -18, 'boom'),
    'boomBig3':    ('boom4', 5.05, 8.00, 0.005, 1.0, -18, 'boom'),
    'boomSmall1':  ('boom_small', 0.00, 1.60, 0.005, 0.6, -22, 'boom'),
    'boomSmall2':  ('boom_small', 4.38, 5.24, 0.005, 0.3, -22, 'boom'),
    'boomSmall3':  ('boom_small', 5.25, 5.86, 0.005, 0.2, -22, 'boom'),
    'boomSmall4':  ('boom_small', 5.87, 6.50, 0.005, 0.2, -22, 'boom'),
    'boomSmall5':  ('boom_small', 6.51, 7.60, 0.005, 0.4, -22, 'boom'),
    'orbital':     ('orbital', 1.97, 6.00, 0.08, 1.4, -18, 'boom'),
    'holeLoop':    ('hole_loop', 0.30, 7.90, 0, 0, -24, 'boom loop'),
    'holeCollapse': ('hole_collapse', 0.80, 4.00, 0.3, 0.6, -18, 'boom'),
    'siren':       ('siren', 0.00, 4.00, 0.05, 0.4, -21, ''),
    'gatling':     ('gatling', 0.10, 3.10, 0.01, 0.05, -31, ''),
    'missile1':    ('missile', 0.08, 2.50, 0.005, 0.8, -27, ''),
    'missile2':    ('missile', 2.52, 4.00, 0.005, 0.5, -27, ''),
    'plasma1':     ('plasma', 0.00, 1.12, 0.005, 0.35, -27, 'boom'),
    'plasma2':     ('plasma', 1.16, 2.08, 0.005, 0.3, -27, 'boom'),
    'plasma3':     ('plasma', 2.10, 3.15, 0.005, 0.35, -27, 'boom'),
    'rail1':       ('rail', 0.62, 2.15, 0.01, 0.6, -25, 'boom'),
    'rail2':       ('rail', 2.12, 3.60, 0.01, 0.6, -25, 'boom'),
    'flak1':       ('flak', 0.05, 1.10, 0.005, 0.6, -29, 'boom'),
    'flak2':       ('flak', 2.20, 3.25, 0.005, 0.6, -29, 'boom'),
    'mortar1':     ('mortar', 0.00, 1.80, 0.005, 1.0, -26, 'boom'),
    'mortar2':     ('mortar', 2.45, 3.95, 0.005, 0.9, -26, 'boom'),
    'flame':       ('flame', 0.05, 2.40, 0.02, 0.1, -30, ''),
    'emp1':        ('emp', 0.00, 0.55, 0.005, 0.2, -29, ''),
    'emp2':        ('emp', 0.78, 1.12, 0.005, 0.12, -29, ''),
    'emp3':        ('emp', 1.38, 1.70, 0.005, 0.12, -29, ''),
    'emp4':        ('emp', 2.40, 2.72, 0.005, 0.12, -29, ''),
    'cryo':        ('cryo', 0.00, 1.20, 0.05, 0.4, -33, ''),
    'freeze':      ('cryo', 2.55, 3.50, 0.01, 0.3, -29, ''),
    'acid1':       ('acid', 0.00, 1.10, 0.005, 0.5, -30, ''),
    'acid2':       ('acid', 2.55, 3.50, 0.005, 0.4, -30, ''),
    'horn':        ('horn', 0.25, 4.00, 0.03, 1.2, -23, 'boom'),
}
if os.path.exists(os.path.join(RAW, 'victory.mp4')):
    SPEC['victory'] = ('victory', 0.00, 4.00, 0.01, 0.8, -21, '')
    SPEC['defeat'] = ('defeat', 0.00, 4.00, 0.01, 0.8, -21, 'boom')

# ---- frequency-domain helpers (offline, whole segment) ----
def eq(x, curve):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * curve(np.maximum(f, 1e-3)), len(x)).astype(np.float32)
def hp(fc, n=2): return lambda f: 1 / np.sqrt(1 + (fc / f) ** (2 * n))
def lp(fc, n=2): return lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * n))
def bell(f0, db, oct_w): return lambda f: 10 ** (db / 20 * np.exp(-np.log2(f / f0) ** 2 / (2 * (oct_w / 2.355) ** 2)))
def shelf_lo(fc, db): return lambda f: 10 ** (db / 20 / (1 + (f / fc) ** 2))
def chain(*cs): return lambda f: np.prod([c(f) for c in cs], axis=0)

def band_level(x):
    """dBFS of the 300-6000 Hz band over the loudest 30 % of 50 ms frames"""
    n = SR // 20
    if len(x) < n: x = np.pad(x, (0, n - len(x)))
    f = np.fft.rfftfreq(n, 1 / SR); m = (f > 300) & (f < 6000); w = np.hanning(n)
    pw = []
    for i in range(0, len(x) - n + 1, n // 2):
        sp = np.abs(np.fft.rfft(x[i:i + n] * w)) ** 2
        pw.append(sp[m].sum() / (w ** 2).sum() / n * 2)
    pw = np.sort(np.array(pw))[::-1]
    top = pw[:max(1, int(len(pw) * 0.3))]
    return 10 * np.log10(top.mean() + 1e-12)

def boomify(x):
    # trim rumble a phone can't play (it only eats headroom), lift crack and crunch
    x = eq(x, chain(hp(55, 2), shelf_lo(110, -5), bell(900, 3, 1.5), bell(2600, 5, 2)))
    # psychoacoustic bass: saturate the low band, keep only the generated harmonics (150-1500 Hz)
    low = eq(x, lp(170, 4))
    k = 3 / (np.abs(low).max() + 1e-9)
    harm = eq(np.tanh(low * k), chain(hp(160, 3), lp(1500, 2)))
    harm *= np.sqrt((low ** 2).mean() / ((harm ** 2).mean() + 1e-12)) * 0.8
    return x + harm

cache = {}
def clip(name):
    if name not in cache:
        wav = os.path.join(RAW, name + '.wav')
        if not os.path.exists(wav):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(RAW, name + '.mp4'), '-vn', '-ac', '1', '-ar', str(SR), wav], check=True)
        w = wave.open(wav)
        cache[name] = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return cache[name]

parts, meta, pos, report = [np.zeros(int(0.1 * SR), np.float32)], {}, 0.1, []
gap = np.zeros(int(0.25 * SR), np.float32)
for name, sp in SPEC.items():
    src, a, b, fi, fo, target, flags = sp
    x = clip(src)[int(a * SR):int(b * SR)].copy()
    x -= x.mean()
    x = boomify(x) if 'boom' in flags else eq(x, hp(45, 2))
    if 'loop' in flags:
        # seamless loop: crossfade the last second into the start
        n = SR
        head, tail = x[:n].copy(), x[-n:]
        t = np.linspace(0, 1, n, dtype=np.float32)
        x = x[:-n]
        x[:n] = head * np.sqrt(t) + tail * np.sqrt(1 - t)
    # loudness as heard on a phone speaker; if the bass would push the peaks way over, trim more low end first
    for cut in (0, 1, 2, 3):
        y = x * 10 ** ((target - band_level(x)) / 20)
        if np.abs(y).max() <= 1.4: break
        x = eq(x, hp(80 + 40 * cut, 2))
    x = y
    pk = np.abs(x).max()
    if pk > 0.9: x = np.tanh(x / pk * 1.4) / np.tanh(1.4) * min(0.97, pk) if pk > 1 else np.tanh(x / 0.9) * 0.9
    report.append((name, target, band_level(x), np.abs(x).max()))
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
for r in report:
    if abs(r[2] - r[1]) > 1.5: print('  %-13s target %5.1f got %5.1f peak %.2f' % r)
print(f'{len(meta)} sounds, {pos:.1f} s, {os.path.getsize(os.path.join(OUT, "sfx.mp3")) // 1024} KB')
