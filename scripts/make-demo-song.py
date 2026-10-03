"""Genera un multitrack de demostración libre de derechos (síntesis propia) y lo empaqueta en ZIP.

Balada en Re mayor, 76 BPM, progresión I–V–vi–IV (D–A–Bm–G).
Estructura: Intro (4 compases) · Verso (8) · Coro (8) · Verso (8) · Coro (8) · Final (4).
Pistas: Click, Batería, Bajo, Pad, Piano, Melodía.

Uso: python scripts/make-demo-song.py [carpeta_destino]
"""
import io
import sys
import wave
import zipfile
from pathlib import Path

import numpy as np

SR = 44100
BPM = 76
BEAT = 60 / BPM
BAR = 4 * BEAT
SECTIONS = [("intro", 4), ("verso", 8), ("coro", 8), ("verso", 8), ("coro", 8), ("final", 4)]
TOTAL_BARS = sum(n for _, n in SECTIONS)
LENGTH = int((TOTAL_BARS * BAR + 3.0) * SR)  # 3 s de cola para que suene el último acorde
rng = np.random.default_rng(7)

# Acordes (notas MIDI) por compás: D, A, Bm, G
CHORDS = [[62, 66, 69], [61, 64, 69], [62, 66, 71], [62, 67, 71]]
BASS = [38, 33, 35, 31]


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def section_at(bar):
    acc = 0
    for name, n in SECTIONS:
        if bar < acc + n:
            return name, bar - acc
        acc += n
    return "final", 0


def add(track, start_s, sig, gain=1.0):
    i = int(start_s * SR)
    if i >= len(track):
        return
    end = min(len(track), i + len(sig))
    track[i:end] += sig[: end - i] * gain


def env_adsr(n, a, d, s, r):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    e = np.full(n, s, dtype=np.float64)
    e[: min(a, n)] = np.linspace(0, 1, a)[: min(a, n)]
    if a < n:
        k = min(d, n - a)
        e[a : a + k] = np.linspace(1, s, d)[:k]
    if r > 0 and n > r:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def lowpass(x, k):
    """Media móvil sencilla como filtro paso bajo."""
    kernel = np.ones(k) / k
    return np.convolve(x, kernel, mode="same")


def t_axis(seconds):
    return np.arange(int(seconds * SR)) / SR


# --- Instrumentos ------------------------------------------------------------

def kick():
    t = t_axis(0.45)
    freq = 45 + 90 * np.exp(-t * 35)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    return np.sin(phase) * np.exp(-t * 7)


def snare():
    t = t_axis(0.3)
    noise = rng.uniform(-1, 1, len(t)) * np.exp(-t * 18)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 25)
    return 0.7 * noise + 0.5 * tone


def hat(open_=False):
    t = t_axis(0.25 if open_ else 0.08)
    noise = np.diff(rng.uniform(-1, 1, len(t) + 1))  # derivada ≈ paso alto
    return noise * np.exp(-t * (12 if open_ else 60)) * 0.5


def bass_note(midi, dur):
    t = t_axis(dur)
    f = hz(midi)
    sig = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.15 * np.sin(2 * np.pi * 3 * f * t)
    return sig * env_adsr(len(t), 0.01, 0.3, 0.7, 0.08)


def pad_chord(notes, dur):
    t = t_axis(dur)
    sig = np.zeros(len(t))
    for m in notes:
        for detune in (-0.12, 0.0, 0.12):
            f = hz(m) * 2 ** (detune / 12)
            saw = 2 * ((t * f) % 1) - 1
            sig += saw
    sig = lowpass(sig / (len(notes) * 3), 24)
    return sig * env_adsr(len(t), 0.9, 0.5, 0.8, 0.9)


def piano_note(midi, dur):
    t = t_axis(dur)
    f = hz(midi)
    sig = sum(np.sin(2 * np.pi * f * k * t) * (0.6 ** (k - 1)) * np.exp(-t * (2.5 + k)) for k in range(1, 6))
    return sig * env_adsr(len(t), 0.003, 0.1, 1.0, 0.05)


def lead_note(midi, dur):
    t = t_axis(dur)
    f = hz(midi) * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t * 2, 0, 1))  # vibrato
    phase = 2 * np.pi * np.cumsum(f) / SR
    sig = np.sin(phase) + 0.3 * np.sin(2 * phase) + 0.1 * np.sin(3 * phase)
    return sig * env_adsr(len(t), 0.06, 0.2, 0.75, 0.15)


def click(accent):
    t = t_axis(0.03)
    return np.sin(2 * np.pi * (1600 if accent else 1000) * t) * np.exp(-t * 150)


# Melodía del coro (grados sobre la progresión), en corcheas/negras: (nota MIDI, duración en tiempos)
CHORUS_MELODY = [
    [(74, 1), (76, 1), (78, 1.5), (76, 0.5)],
    [(76, 2), (73, 1), (71, 1)],
    [(74, 1), (76, 1), (78, 1), (81, 1)],
    [(79, 2), (78, 1), (76, 1)],
]
VERSE_MELODY = [
    [(66, 1), (69, 1), (71, 2)],
    [(69, 2), (66, 1), (64, 1)],
    [(66, 1), (69, 1), (71, 1), (73, 1)],
    [(71, 3), (69, 1)],
]


def render():
    tracks = {name: np.zeros(LENGTH) for name in ["click", "bateria", "bajo", "pad", "piano", "melodia"]}
    for bar in range(TOTAL_BARS):
        sec, local = section_at(bar)
        t0 = bar * BAR
        ci = bar % 4
        chord, root = CHORDS[ci], BASS[ci]
        last = bar == TOTAL_BARS - 1

        for b in range(4):
            add(tracks["click"], t0 + b * BEAT, click(b == 0), 0.6)

        # Pad: siempre; acorde final largo
        add(tracks["pad"], t0, pad_chord(chord, BAR + (3 if last else 0.4)), 0.35)

        # Piano: arpegio en corcheas (intro/verso suave, coro más presente)
        arp = [chord[0], chord[1], chord[2], chord[1] + 12, chord[2], chord[1], chord[0] + 12, chord[2]]
        pgain = 0.22 if sec in ("intro", "verso", "final") else 0.3
        steps = 8 if not last else 1
        for i in range(steps):
            add(tracks["piano"], t0 + i * BEAT / 2, piano_note(arp[i], 1.2 if not last else 3.5), pgain)

        if sec in ("verso", "coro"):
            # Bajo: blancas en verso, negras con octava en coro
            if sec == "verso":
                for b in (0, 2):
                    add(tracks["bajo"], t0 + b * BEAT, bass_note(root, BEAT * 1.9), 0.5)
            else:
                for b, octave in ((0, 0), (1, 0), (2, 12), (3, 0)):
                    add(tracks["bajo"], t0 + b * BEAT, bass_note(root + octave, BEAT * 0.95), 0.5)

            # Batería
            if sec == "verso":
                add(tracks["bateria"], t0, kick(), 0.8)
                add(tracks["bateria"], t0 + 2.5 * BEAT, kick(), 0.6)
                add(tracks["bateria"], t0 + 2 * BEAT, snare(), 0.35)  # cross-stick suave
                for b in range(4):
                    add(tracks["bateria"], t0 + b * BEAT, hat(), 0.25)
            else:
                for b in (0, 1.5, 2.5):
                    add(tracks["bateria"], t0 + b * BEAT, kick(), 0.9)
                for b in (1, 3):
                    add(tracks["bateria"], t0 + b * BEAT, snare(), 0.6)
                for i in range(8):
                    add(tracks["bateria"], t0 + i * BEAT / 2, hat(open_=(i == 7)), 0.3)
                if local == 7:  # redoble al final del coro
                    for i in range(4):
                        add(tracks["bateria"], t0 + 3 * BEAT + i * BEAT / 4, snare(), 0.3 + 0.1 * i)

            # Melodía
            phrase = (CHORUS_MELODY if sec == "coro" else VERSE_MELODY)[ci]
            pos = 0.0
            for note, beats in phrase:
                add(tracks["melodia"], t0 + pos * BEAT, lead_note(note, beats * BEAT * 0.95), 0.3)
                pos += beats

        if last:
            add(tracks["bajo"], t0, bass_note(BASS[0], 3.5), 0.5)
            add(tracks["bateria"], t0, kick(), 0.9)
            add(tracks["bateria"], t0, hat(open_=True), 0.4)

    # Normalización común: la mezcla de todas las pistas no supera -1 dBFS.
    mix_peak = np.max(np.abs(sum(tracks.values())))
    scale = 0.89 / mix_peak
    return {k: v * scale for k, v in tracks.items()}


def to_wav(mono, pan=0.0):
    left = mono * np.cos((pan + 1) * np.pi / 4)
    right = mono * np.sin((pan + 1) * np.pi / 4)
    stereo = np.stack([left, right], axis=1) * np.sqrt(2)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def main():
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads"
    dest.mkdir(parents=True, exist_ok=True)
    tracks = render()
    folder = "Demo Gosen - Balada en Re"
    pans = {"click": 0.0, "bateria": 0.0, "bajo": 0.0, "pad": -0.3, "piano": 0.3, "melodia": 0.0}
    names = {"click": "click.wav", "bateria": "bateria.wav", "bajo": "bajo.wav", "pad": "pad.wav", "piano": "piano.wav", "melodia": "voz guia melodia.wav"}
    out = dest / "Demo_Gosen_Multitrack.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for key, data in tracks.items():
            z.writestr(f"{folder}/{names[key]}", to_wav(data, pans[key]))
        z.writestr(f"{folder}/LEEME.txt", "Multitrack de demostración generado por Gosen Multitrack. Libre de derechos.\n"
                   f"Re mayor, {BPM} BPM. Estructura: Intro 4 · Verso 8 · Coro 8 · Verso 8 · Coro 8 · Final 4 compases.\n")
    print(f"{out}  ({out.stat().st_size / 1e6:.1f} MB, {LENGTH / SR:.0f} s)")


if __name__ == "__main__":
    main()
