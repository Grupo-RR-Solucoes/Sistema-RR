#!/usr/bin/env python3
"""
scripts/compare_logo_stages.py — Fase 1.6.3 comparacao visual

Gera /public/brand/_comparison.png com 3 colunas lado a lado:
  ORIGINAL JPEG  |  FULL PNG (transform_light)  |  MARK LIGHT (Cred recortado)
Cada coluna 300x375, com label embaixo. Util para Diego comparar
visualmente onde o "swoosh inferior" pode estar sumindo no pipeline.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC_JPEG = Path("public/brand/source/logo-rr-cred-original.jpeg")
FULL_PNG = Path("public/brand/logo-rr-cred-full.png")
MARK_PNG = Path("public/brand/logo-rr-cred-mark-light-200.png")
OUT = Path("public/brand/_comparison.png")

COL_W, COL_H = 300, 375
GAP = 24
PADDING = 32
LABEL_H = 40


def load_and_fit(path: Path, target_w: int, target_h: int) -> Image.Image:
    """Carrega imagem e redimensiona para target preservando aspect com pad."""
    img = Image.open(path).convert("RGBA")
    iw, ih = img.size
    scale = min(target_w / iw, target_h / ih)
    nw, nh = int(iw * scale), int(ih * scale)
    resized = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (target_w, target_h), (255, 255, 255, 255))
    offset = ((target_w - nw) // 2, (target_h - nh) // 2)
    canvas.paste(resized, offset, resized)
    return canvas


def main() -> int:
    for p in (SRC_JPEG, FULL_PNG, MARK_PNG):
        if not p.exists():
            print(f"FATAL: missing {p}", file=sys.stderr)
            return 2

    cols = [
        ("ORIGINAL JPEG", SRC_JPEG),
        ("FULL PNG (transform_light)", FULL_PNG),
        ("MARK LIGHT (Cred recortado)", MARK_PNG),
    ]

    total_w = PADDING * 2 + COL_W * 3 + GAP * 2
    total_h = PADDING * 2 + COL_H + LABEL_H
    composite = Image.new("RGBA", (total_w, total_h), (244, 246, 251, 255))
    draw = ImageDraw.Draw(composite)

    try:
        font = ImageFont.truetype("arial.ttf", 14)
    except OSError:
        font = ImageFont.load_default()

    for idx, (label, path) in enumerate(cols):
        col_x = PADDING + idx * (COL_W + GAP)
        col_y = PADDING

        # Frame branco com borda sutil
        frame_box = (col_x - 1, col_y - 1, col_x + COL_W + 1, col_y + COL_H + 1)
        draw.rectangle(frame_box, outline=(208, 215, 226, 255), width=1)

        img = load_and_fit(path, COL_W, COL_H)
        composite.paste(img, (col_x, col_y), img)

        # Label embaixo
        bbox = draw.textbbox((0, 0), label, font=font)
        text_w = bbox[2] - bbox[0]
        text_x = col_x + (COL_W - text_w) // 2
        text_y = col_y + COL_H + 12
        draw.text((text_x, text_y), label, fill=(15, 31, 74, 255), font=font)

    composite.save(OUT, "PNG", optimize=True)
    print(f"Composite salvo em {OUT}")
    print(f"Dimensoes: {total_w}x{total_h}")
    print(f"URL local: http://localhost:3000/brand/_comparison.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
