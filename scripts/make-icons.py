#!/usr/bin/env python3
"""Builds the app icons from public/logo.png using only the Python standard library.

Outputs (all cropped to the drawing and made square):
  public/logo-mark.png      256px, transparent  - shown on a white tile in the UI
  src/app/icon.png          64px on white       - browser tab icon (Next.js picks it up)
  src/app/apple-icon.png    180px on white      - iPhone "Add to Home Screen"
  public/icon-192.png, public/icon-512.png      - Android / installable app (manifest)

Run again after replacing public/logo.png:  python3 scripts/make-icons.py
"""
import struct
import zlib

SRC = "public/logo.png"


def read_png(path):
    data = open(path, "rb").read()
    pos, idat, width, height = 8, b"", 0, 0
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and color == 6, "expects an 8-bit RGBA PNG"
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw, stride, rows, prev = zlib.decompress(idat), width * 4 + 1, [], bytearray(width * 4)
    for y in range(height):
        f, line = raw[y * stride], bytearray(raw[y * stride + 1 : (y + 1) * stride])
        for i in range(len(line)):
            a = line[i - 4] if i >= 4 else 0
            b = prev[i]
            c = prev[i - 4] if i >= 4 else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return width, height, rows


def write_png(path, size, pixels):
    """pixels: list of rows of (r, g, b, a) floats 0-255."""
    raw = b"".join(b"\x00" + bytes(int(round(v)) for px in row for v in px) for row in pixels)
    chunk = lambda kind, body: struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(png)


width, height, rows = read_png(SRC)

# Tight bounding box of the drawing, then a square around it with a little breathing room.
xs, ys = [], []
for y in range(height):
    r = rows[y]
    for x in range(width):
        if r[x * 4 + 3] > 16:
            xs.append(x)
            ys.append(y)
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
side = int(max(x1 - x0, y1 - y0) * 1.08)
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
left, top = cx - side / 2, cy - side / 2


def render(size, background=None, padding=0.0):
    """Area-average downscale of the square crop; optional solid background and inner padding."""
    inner = size * (1 - 2 * padding)
    scale = side / inner
    out = []
    for oy in range(size):
        row = []
        for ox in range(size):
            # Source rectangle for this output pixel.
            sx0 = left + (ox - size * padding) * scale
            sy0 = top + (oy - size * padding) * scale
            r = g = b = a = n = 0.0
            steps = max(1, int(scale))
            for j in range(steps):
                yy = int(sy0 + (j + 0.5) * scale / steps)
                for i in range(steps):
                    xx = int(sx0 + (i + 0.5) * scale / steps)
                    n += 1
                    if 0 <= xx < width and 0 <= yy < height:
                        p = rows[yy][xx * 4 : xx * 4 + 4]
                        alpha = p[3] / 255
                        r += p[0] * alpha
                        g += p[1] * alpha
                        b += p[2] * alpha
                        a += alpha
            alpha = a / n
            if background:
                br, bg, bb = background
                # Premultiplied colour over the solid background.
                row.append(((r / n) + br * (1 - alpha), (g / n) + bg * (1 - alpha), (b / n) + bb * (1 - alpha), 255))
            else:
                row.append(((r / a) if a else 0, (g / a) if a else 0, (b / a) if a else 0, alpha * 255))
        out.append(row)
    return out


WHITE = (255, 255, 255)
write_png("public/logo-mark.png", 256, render(256))
write_png("src/app/icon.png", 64, render(64, WHITE, 0.04))
write_png("src/app/apple-icon.png", 180, render(180, WHITE, 0.10))
write_png("public/icon-192.png", 192, render(192, WHITE, 0.10))
write_png("public/icon-512.png", 512, render(512, WHITE, 0.12))
print("icons written")
