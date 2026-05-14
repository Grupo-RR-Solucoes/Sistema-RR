#!/usr/bin/env python3
"""scripts/process_brand_logo.py — Fase 1.7

Processa o PNG novo (Grupo RR Cred — so RR + arco, sem texto "Cred")
em 2 variantes, cada uma em 3 tamanhos.

Source: public/brand/source/logo-rr-cred-mark-original.png  (1024x1280)

Variantes:
  MARK-LIGHT  — bg branco removido, RR azul + arco dourado preservados
  MARK-DARK   — bg removido, RR vira branco, arco dourado preservado
                (correcoes 1.6.4 chroma<=3 + 1.6.5 gold_light_antialias)

Saidas em public/brand/:
  logo-rr-cred-mark-light-{64,120,200}.png + .webp   (6 arquivos)
  logo-rr-cred-mark-dark-{64,120,200}.png + .webp    (6 arquivos)
  logo-dimensions.json                               (metadata)

Uso: python scripts/process_brand_logo.py
"""

import json
import sys
from pathlib import Path
from typing import Callable

from PIL import Image

SRC = Path("public/brand/source/logo-rr-cred-mark-original.png")
OUT_DIR = Path("public/brand")
METADATA_PATH = OUT_DIR / "logo-dimensions.json"

BG_THRESHOLD = 245
WIDTHS = (200, 120, 64)
CROP_MARGIN = 20  # Fase 1.7 — margem 20px ao redor da BB do conteudo


def is_background(r: int, g: int, b: int) -> bool:
    """BG = branco neutro (claro + chroma<=3). Fase 1.6.4."""
    if r < BG_THRESHOLD or g < BG_THRESHOLD or b < BG_THRESHOLD:
        return False
    chroma = max(r, g, b) - min(r, g, b)
    return chroma <= 3


def is_blue_rr(r: int, g: int, b: int) -> bool:
    """Pixels azuis das letras RR."""
    return b > r + 30 and b > g + 30 and b >= 120


def is_gold(r: int, g: int, b: int) -> bool:
    """Pixels dourados centrais do arco."""
    return r > 150 and 100 <= g <= 220 and b < r - 20


def is_gold_light_antialias(r: int, g: int, b: int) -> bool:
    """Fase 1.6.5 — pixels claros antialiased do gradiente dourado.

    Tons creme/dourado-claro (ex. 250,240,230) com vies dourado estrito
    (R > G AND R > B AND chroma >= 6) para evitar capturar pixels
    cinza-neutros que viram halo branco fantasma sobre navy.
    """
    return r >= 200 and r > g and r > b and (r - b) >= 6


def ink_alpha(r: int, g: int, b: int) -> int:
    brightness = max(r, g, b)
    return max(0, 255 - brightness)


# ---------- Transforms ----------

def transform_light(r: int, g: int, b: int, _x: int, _y: int) -> tuple[int, int, int, int]:
    if is_background(r, g, b):
        return (255, 255, 255, 0)
    return (r, g, b, 255)


def transform_dark(r: int, g: int, b: int, _x: int, _y: int) -> tuple[int, int, int, int]:
    if is_background(r, g, b):
        return (255, 255, 255, 0)
    if is_gold(r, g, b):
        return (r, g, b, 255)
    # Fase 1.6.5 — preservar gradiente claro dourado antialiased
    if is_gold_light_antialias(r, g, b):
        return (r, g, b, 255)
    if is_blue_rr(r, g, b):
        return (255, 255, 255, 255)
    a = ink_alpha(r, g, b)
    # Fase 1.6.5 — threshold elevado (25) elimina halo branco fantasma de
    # pixels cinza-claros antialiased em fundo navy. Texto/RR centrais
    # tem alpha bem maior, nao sao afetados.
    if a < 25:
        return (255, 255, 255, 0)
    return (255, 255, 255, a)


def apply_transform(
    img: Image.Image,
    fn: Callable[[int, int, int, int, int], tuple[int, int, int, int]],
) -> Image.Image:
    rgb = img.convert("RGB")
    result = Image.new("RGBA", rgb.size, (0, 0, 0, 0))
    src = rgb.load()
    dst = result.load()
    w, h = rgb.size
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            dst[x, y] = fn(r, g, b, x, y)
    return result


def crop_with_margin(img: Image.Image, margin: int) -> Image.Image:
    """Crop pela BB dos pixels visiveis + margem."""
    bbox = img.getbbox()
    if bbox is None:
        return img
    x0, y0, x1, y1 = bbox
    w, h = img.size
    expanded = (
        max(0, x0 - margin),
        max(0, y0 - margin),
        min(w, x1 + margin),
        min(h, y1 + margin),
    )
    return img.crop(expanded)


def save_variants(processed: Image.Image, variant: str, dims_acc: dict) -> None:
    """Cropa, redimensiona e salva. Atualiza dims_acc com dimensoes finais."""
    cropped = crop_with_margin(processed, CROP_MARGIN)
    cw, ch = cropped.size
    aspect = ch / cw
    print(f"  crop+margin: {cw}x{ch} (aspect {aspect:.3f})")
    for w in WIDTHS:
        h = round(w * aspect)
        resized = cropped.resize((w, h), Image.LANCZOS)
        png_path = OUT_DIR / f"logo-rr-cred-{variant}-{w}.png"
        webp_path = OUT_DIR / f"logo-rr-cred-{variant}-{w}.webp"
        resized.save(png_path, "PNG", optimize=True)
        resized.save(webp_path, "WEBP", quality=92, method=6)
        dims_acc[f"{variant}-{w}"] = {"width": w, "height": h}
        print(
            f"  {png_path.name:42s} {png_path.stat().st_size / 1024:6.1f} KB  ({w}x{h})"
        )
        print(
            f"  {webp_path.name:42s} {webp_path.stat().st_size / 1024:6.1f} KB  ({w}x{h})"
        )


def main() -> int:
    if not SRC.exists():
        print(f"FATAL: source not found: {SRC}", file=sys.stderr)
        return 2

    original = Image.open(SRC)
    print(f"Loaded {SRC} -> {original.size} mode={original.mode}\n")

    dimensions: dict = {}

    print("=== MARK-LIGHT (RR azul + arco dourado, bg transparente) ===")
    light = apply_transform(original, transform_light)
    save_variants(light, "mark-light", dimensions)

    print("\n=== MARK-DARK (RR branco + arco dourado, bg transparente) ===")
    dark = apply_transform(original, transform_dark)
    save_variants(dark, "mark-dark", dimensions)

    METADATA_PATH.write_text(
        json.dumps(dimensions, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nMetadata salva: {METADATA_PATH}")
    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
