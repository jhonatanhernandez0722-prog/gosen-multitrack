"""Genera archivos de prueba en test-fixtures/ (WAV sintéticos y ZIPs válidos e inválidos).

Uso: python scripts/make-fixtures.py
"""
import io
import math
import struct
import wave
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "test-fixtures"
RATE = 44100


def wav_bytes(seconds: float, freq: float) -> bytes:
    """Tono estéreo 16-bit con un clic al inicio de cada segundo (útil para comprobar sincronía de oído)."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        frames = bytearray()
        for i in range(int(seconds * RATE)):
            t = i / RATE
            v = 0.25 * math.sin(2 * math.pi * freq * t)
            if (i % RATE) < 200:
                v = 0.8
            s = int(v * 32767)
            frames += struct.pack("<hh", s, s)
        w.writeframes(bytes(frames))
    return buf.getvalue()


def make_zip(name: str, entries: dict) -> None:
    with zipfile.ZipFile(OUT / name, "w", zipfile.ZIP_DEFLATED) as z:
        for path, data in entries.items():
            z.writestr(path, data)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    drums = wav_bytes(6.0, 110)
    bass = wav_bytes(6.0, 55)
    guitar = wav_bytes(5.5, 330)  # más corta a propósito
    vocals = wav_bytes(6.0, 440)

    make_zip("Cancion_Eres_Todopoderoso.zip", {
        "Eres Todopoderoso/bateria.wav": drums,
        "Eres Todopoderoso/bajo.wav": bass,
        "Eres Todopoderoso/guitarra.wav": guitar,
        "Eres Todopoderoso/voces.wav": vocals,
        "Eres Todopoderoso/notas.txt": b"no es audio",
        "__MACOSX/Eres Todopoderoso/._bateria.wav": b"basura",
    })
    make_zip("Tracks_Folder.zip", {"tracks/drums.wav": drums, "tracks/bass.wav": bass})
    make_zip("Flat_Song.zip", {"click.wav": drums, "piano.wav": guitar})
    make_zip("Traversal.zip", {
        "../evil.wav": drums,
        "ok/../../evil2.wav": drums,
        "/abs.wav": drums,
        "C:/win.wav": drums,
        "good/voz.wav": vocals,
    })
    make_zip("No_Audio.zip", {"readme.txt": b"hola", "cover.jpg": b"\xff\xd8\xff"})
    make_zip("Fake_Audio.zip", {"Fake/bateria.wav": b"esto no es un wav de verdad"})
    with zipfile.ZipFile(OUT / "Empty.zip", "w"):
        pass
    (OUT / "Corrupt.zip").write_bytes(b"PK\x03\x04 esto no es un zip valido" * 10)
    (OUT / "single.wav").write_bytes(bass)
    print(f"Fixtures generados en {OUT}")


if __name__ == "__main__":
    main()
