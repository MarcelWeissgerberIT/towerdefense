# Builds the looping music tracks (assets/music/<name>.mp3 + music.json) from the audio of the generated
# OpenArt music clips (<name>.mp4): finds a loop whose seam lines up rhythmically, crossfades the seam,
# normalises the loudness and writes the loop with a short wrap-around margin on both sides, so the
# game's loop points stay seamless even if a decoder adds or trims a few milliseconds of codec delay.
#   python3 -I tools/make_music.py <dir with build.mp4, battle.mp4, boss.mp4>
import json, os, subprocess, sys
import numpy as np

SR = 44100
RAW = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'music')
MARGIN = 0.5          # seconds of wrap-around audio before and after the loop
TARGET_LUFS = -17.0
# name: (skip at the start, cut before the end) in seconds - generated clips often swell in or end abruptly
SPEC = {'build': (2.5, 0.6), 'battle': (2.5, 0.6), 'battle2': (2.5, 0.6), 'boss': (2.5, 0.6)}
if len(sys.argv) > 2: SPEC = {k: v for k, v in SPEC.items() if k in sys.argv[2].split(',')}


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def onset_env(x, hop=512, n=2048):
    m = x.mean(axis=1)
    win = np.hanning(n)
    frames = [np.abs(np.fft.rfft(m[i:i + n] * win)) for i in range(0, len(m) - n, hop)]
    S = np.log1p(np.array(frames) * 10)
    flux = np.maximum(0, np.diff(S, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    flux -= flux.mean()
    return flux / (flux.std() + 1e-9), hop


def tempo(env, hop):
    # autocorrelation of the onset envelope, 70-180 BPM
    ac = np.correlate(env, env, 'full')[len(env) - 1:]
    fps = SR / hop
    lags = np.arange(len(ac))
    bpm = 60 * fps / np.maximum(lags, 1)
    ok = (bpm >= 70) & (bpm <= 180)
    lag = lags[ok][np.argmax(ac[ok])]
    return 60 * fps / lag, lag


def chroma_frames(x, hop, n=4096):
    m = x.mean(axis=1)
    win = np.hanning(n)
    f = np.fft.rfftfreq(n, 1 / SR)
    sel = (f > 80) & (f < 2000)
    pc = (np.round(12 * np.log2(f[sel] / 440)) % 12).astype(int)
    out = []
    for i in range(0, len(m) - n, hop):
        P = np.abs(np.fft.rfft(m[i:i + n] * win))[sel] ** 2
        c = np.bincount(pc, weights=P, minlength=12)
        out.append(c / (c.sum() + 1e-12))
    return np.array(out)


def ncorr(a, b):
    a = a - a.mean(); b = b - b.mean()
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def best_loop(x, s0, e_max, min_len=8.0):
    """Loop [s, e) of a whole number of bars: the audio leading into e must match the audio leading into s
    in rhythm (onset envelope) and harmony (chroma), so the crossfaded seam is not heard."""
    env, hop = onset_env(x)
    bpm, beat_lag = tempo(env, hop)
    fps = SR / hop
    # the tempo estimate may be a half/double of the real one: the bar is the multiple of the beat (2, 3, 4, 6, 8)
    # whose lag the rhythm repeats at best
    s_f = s0 // hop
    w = min(int(3.0 * fps), s_f - 2)
    ch = chroma_frames(x, hop)
    def seam(e_f):
        if e_f > len(ch) or e_f - w < 0: return -9, 0, 0
        r = ncorr(env[s_f - w:s_f], env[e_f - w:e_f])
        h = ncorr(ch[s_f - w:s_f].ravel(), ch[e_f - w:e_f].ravel())
        return r + h, r, h
    # refine the beat period on long lags (16 beats), where small tempo errors add up
    beat = 60 / bpm
    def sim(lag):
        return ncorr(env[:len(env) - lag], env[lag:]) if 0 < lag < len(env) - 10 else -1
    best_p = max(np.linspace(beat * 0.97, beat * 1.03, 121), key=lambda p: sim(int(round(16 * p * fps))))
    beat = best_p
    print(f'   tempo {60 / beat:.2f} BPM')
    cands = []
    max_bars = int((e_max - s0) / SR / beat)
    for nb in range(int(min_len / beat), max_bars + 1):            # loop length in beats
        L0 = nb * beat * fps
        bestv = None
        for d in range(-int(0.12 * fps), int(0.12 * fps) + 1):     # tempo drift tolerance
            e_f = s_f + int(round(L0)) + d
            if e_f * hop > e_max: continue
            v, r, h = seam(e_f)
            if bestv is None or v > bestv[0]: bestv = (v, e_f, r, h)
        if not bestv: continue
        v, e_f, r, h = bestv
        # whole bars only (4/4); a seam counts as clean when rhythm and harmony both line up well -
        # among the clean ones the longest wins (less repetition), otherwise the best match
        if nb % 4: continue
        clean = r >= 0.6 and h >= 0.55
        cands.append(((1 if clean else 0, nb if clean else v), e_f, nb, r, h))
    cands.sort(reverse=True)
    for v, e_f, nb, r, h in cands[:3]:
        print(f'   seam candidate {e_f * hop / SR:.2f}s: {nb} beats, rhythm {r:.2f}, harmony {h:.2f}')
    best, bv = cands[0][1], cands[0][3] + cands[0][4]
    # fine alignment (+- 2 hops) on the amplitude envelope, so the beats line up to a few samples
    e = best * hop
    mono = np.abs(x.mean(axis=1))
    c = np.cumsum(np.concatenate([[0], mono]))
    k2 = 88                                        # 2 ms smoothing
    env2 = (c[k2:] - c[:-k2]) / k2
    W = int(2.0 * SR)
    a = env2[s0 - W:s0:4]
    a = a - a.mean()
    bestk, bk = 0, -1e9
    for k in range(-2 * hop, 2 * hop + 1, 4):
        if e + k > len(env2): continue
        b = env2[e + k - W:e + k:4]
        if len(b) != len(a): continue
        cc = float(np.dot(a, b - b.mean()))
        if cc > bk: bk, bestk = cc, k
    return e + bestk, 60 / beat, bv


def loudness(x):
    p = subprocess.run(['ffmpeg', '-v', 'info', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', '-af', 'ebur128', '-f', 'null', '-'],
                       input=x.astype(np.float32).tobytes(), capture_output=True)
    for line in reversed(p.stderr.decode().splitlines()):
        if line.strip().startswith('I:'):
            return float(line.split()[1])
    return -20.0


meta = {}
os.makedirs(OUT, exist_ok=True)
for name, (skip, cut) in SPEC.items():
    src = os.path.join(RAW, name + '.mp4')
    if not os.path.exists(src):
        print('missing', src); continue
    x = load(src)
    s = int(max(skip, 2.5) * SR)
    e_max = len(x) - int(cut * SR)
    e, bpm, score = best_loop(x, s, e_max)
    L = e - s
    xf = int(1.2 * SR)                            # equal-power crossfade of the seam
    t = np.linspace(0, np.pi / 2, xf)[:, None]
    loop = x[s:e].copy()
    loop[-xf:] = loop[-xf:] * np.cos(t) + x[s - xf:s] * np.sin(t)
    gain = 10 ** ((TARGET_LUFS - loudness(np.tile(loop, (2, 1)))) / 20)
    loop *= gain
    peak = np.abs(loop).max()
    if peak > 0.97: loop *= 0.97 / peak           # simple safety (no limiter needed at this level)
    m = int(MARGIN * SR)
    full = np.concatenate([loop[-m:], loop, loop[:m]])
    out = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', '128k', out], input=full.astype(np.float32).tobytes(), check=True)
    meta[name] = {'start': MARGIN, 'len': round(L / SR, 6)}
    print(f'{name}: {len(x) / SR:.1f}s clip, loop {s / SR:.2f}-{e / SR:.2f}s ({L / SR:.2f}s), ~{bpm:.0f} BPM, seam score {score:.2f}, gain {20 * np.log10(gain):+.1f} dB, {os.path.getsize(out) // 1024} KB')

path = os.path.join(OUT, 'music.json')
old = json.load(open(path)) if os.path.exists(path) else {}
old.update(meta)
json.dump(old, open(path, 'w'), indent=1)
