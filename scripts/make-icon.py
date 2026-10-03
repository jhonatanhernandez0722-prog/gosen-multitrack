"""Genera los iconos de la app sin dependencias externas.

  build/icon.png  1024×1024 (macOS: electron-builder genera el .icns a partir de él)
  build/icon.ico  256×256   (Windows)

Diseño: cuadrado redondeado con degradado azul→violeta y cinco barras verticales (pistas).
Uso: python scripts/make-icon.py
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "build"
BASE = 256  # las medidas del diseño están pensadas a 256 px y se escalan


def lerp(a, b, t):
    return a + (b - a) * t


def inside_rounded(x, y, r, size):
    cx = min(max(x, r), size - 1 - r)
    cy = min(max(y, r), size - 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def make_pixel(size):
    k = size / BASE
    margin, radius = 8 * k, 52 * k
    heights = [70 * k, 120 * k, 150 * k, 100 * k, 60 * k]
    bar_w, gap = 22 * k, 14 * k
    total = len(heights) * bar_w + (len(heights) - 1) * gap
    x0 = (size - total) / 2
    bars = []
    for i, h in enumerate(heights):
        bx = x0 + i * (bar_w + gap)
        bars.append((bx, (size - h) / 2, (size + h) / 2))

    def pixel(x, y):
        if not (margin <= x < size - margin and margin <= y < size - margin):
            return (0, 0, 0, 0)
        if not inside_rounded(x - margin, y - margin, radius, size - 2 * margin):
            return (0, 0, 0, 0)
        for bx, top, bottom in bars:
            if bx <= x < bx + bar_w and top <= y < bottom:
                cx, r = bx + bar_w / 2, bar_w / 2
                if y < top + r and (x - cx) ** 2 + (y - (top + r)) ** 2 > r * r:
                    break
                if y >= bottom - r and (x - cx) ** 2 + (y - (bottom - r)) ** 2 > r * r:
                    break
                return (255, 255, 255, 255)
        t = (x + y) / (2 * size)
        return (int(lerp(0x4F, 0x8A, t)), int(lerp(0x8C, 0x5C, t)), 0xFF, 255)

    return pixel


def png_bytes(size):
    pixel = make_pixel(size)
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "icon.png").write_bytes(png_bytes(1024))
    png256 = png_bytes(256)
    # ICO con una imagen PNG de 256×256 (formato admitido desde Windows Vista).
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png256), 6 + 16)
    (OUT / "icon.ico").write_bytes(header + entry + png256)
    print(f"Iconos generados en {OUT}")


if __name__ == "__main__":
    main()
