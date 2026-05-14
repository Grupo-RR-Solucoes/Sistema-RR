#!/usr/bin/env python3
"""
scripts/process_brand_logo.py — Fase 1.5/1.6/1.7

Processa o JPEG original da logo Grupo RR Cred em 4 variantes:

  LIGHT       (PNG com RR azul + arco dourado + texto "Cred" original, bg transparente)
  DARK        (PNG com RR branco + arco dourado preservado + texto branco antialiased)
  MARK-LIGHT  (Light SEM o texto "Cred" recortado — para composicao com texto via CSS)
  MARK-DARK   (Dark SEM o texto "Cred" recortado)

Saidas em public/brand/:
  logo-rr-cred-full.png                          (canonical 1024px, light)
  logo-rr-cred-light-{64,120,200}.png + .webp
  logo-rr-cred-dark-{64,120,200}.png + .webp
  logo-rr-cred-mark-light-{64,120,200}.png + .webp
  logo-rr-cred-mark-dark-{64,120,200}.png + .webp

Uso: python scripts/process_brand_logo.py
"""

import sys
from pathlib import Path
from typing import Callable

from PIL import Image

SRC = Path("public/brand/source/logo-rr-cred-original.jpeg")
OUT_DIR = Path("public/brand")

BG_THRESHOLD = 245
WIDTHS = (200, 120, 64)

# Bounding box do texto "Cred" na arte original (1024x1280).
# Confirmada por inspecao de runs/segmentos pixel-por-pixel:
#   - Letras Cred ("C","r","e","d") vivem em x=628-797, y=855-919
#   - Pixel azul puro do RR (B>=210) tem cor saturada vs Cred azul tipografico
#
# Estrategia: BB geografica + filtro de cor. Dentro da BB, recortamos APENAS
# pixels que NAO sao azul-RR-puro (B<210). Pixels do RR (B>=210 saturado)
# preservados mesmo dentro da BB — evita comer a perna direita do 2o R.
CRED_X_MIN = 625
CRED_X_MAX = 810
CRED_Y_MIN = 853
CRED_Y_MAX = 935
RR_BLUE_B_THRESHOLD = 210  # B>=210 = RR puro saturado, preservar


def is_background(r: int, g: int, b: int) -> bool:
    """Pixel BG = branco NEUTRO (claro + sem cromia detectavel).

    Fase 1.6.4: criterio anterior (R,G,B >= 245) absorvia pixels do
    gradiente claro do arco dourado (RGB tipo 250,248,245) — criando
    'falhas' no meio do swoosh. Agora exigimos tambem chroma<=3 (sem vies
    de cor) para distinguir branco puro de antialiasing tonalizado.
    """
    if r < BG_THRESHOLD or g < BG_THRESHOLD or b < BG_THRESHOLD:
        return False
    chroma = max(r, g, b) - min(r, g, b)
    return chroma <= 3


def is_blue_rr(r: int, g: int, b: int) -> bool:
    """Pixels azuis das letras RR — B dominante sobre R e G."""
    return b > r + 30 and b > g + 30 and b >= 120


def is_gold(r: int, g: int, b: int) -> bool:
    """Pixels dourados do arco (faixa larga para antialiasing)."""
    return r > 150 and 100 <= g <= 220 and b < r - 20


def is_cred_text(_r: int, _g: int, b: int, x: int, y: int) -> bool:
    """Pixel pertence ao texto 'Cred' por BB + filtro de cor.

    Filtro: dentro da BB, recortar APENAS pixels com B<RR_BLUE_B_THRESHOLD
    (210). Isso pega o Cred (azul tipografico nao-saturado) e antialiasing
    claro, mas preserva pixels do RR saturado (B>=210) caso a BB pegue
    parte da perna inferior do 2o R.
    """
    if not (CRED_X_MIN <= x <= CRED_X_MAX and CRED_Y_MIN <= y <= CRED_Y_MAX):
        return False
    return b < RR_BLUE_B_THRESHOLD


def ink_alpha(r: int, g: int, b: int) -> int:
    """Quantidade de 'tinta' do pixel para conversao para branco proporcional."""
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
    if is_blue_rr(r, g, b):
        return (255, 255, 255, 255)
    a = ink_alpha(r, g, b)
    if a < 8:
        return (255, 255, 255, 0)
    return (255, 255, 255, a)


def transform_mark_light(r: int, g: int, b: int, x: int, y: int) -> tuple[int, int, int, int]:
    if is_background(r, g, b):
        return (255, 255, 255, 0)
    if is_cred_text(r, g, b, x, y):
        return (255, 255, 255, 0)
    return (r, g, b, 255)


def transform_mark_dark(r: int, g: int, b: int, x: int, y: int) -> tuple[int, int, int, int]:
    if is_background(r, g, b):
        return (255, 255, 255, 0)
    if is_cred_text(r, g, b, x, y):
        return (255, 255, 255, 0)
    if is_gold(r, g, b):
        return (r, g, b, 255)
    if is_blue_rr(r, g, b):
        return (255, 255, 255, 255)
    a = ink_alpha(r, g, b)
    if a < 8:
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


def save_variants(processed: Image.Image, variant: str) -> None:
    aspect = processed.size[1] / processed.size[0]
    for w in WIDTHS:
        h = round(w * aspect)
        resized = processed.resize((w, h), Image.LANCZOS)
        png_path = OUT_DIR / f"logo-rr-cred-{variant}-{w}.png"
        webp_path = OUT_DIR / f"logo-rr-cred-{variant}-{w}.webp"
        resized.save(png_path, "PNG", optimize=True)
        resized.save(webp_path, "WEBP", quality=92, method=6)
        print(
            f"  {png_path.name:38s} {png_path.stat().st_size / 1024:6.1f} KB  ({w}x{h})"
        )
        print(
            f"  {webp_path.name:38s} {webp_path.stat().st_size / 1024:6.1f} KB  ({w}x{h})"
        )


def main() -> int:
    if not SRC.exists():
        print(f"FATAL: source not found: {SRC}", file=sys.stderr)
        return 2

    original = Image.open(SRC)
    print(f"Loaded {SRC} -> {original.size} mode={original.mode}\n")

    # LIGHT (full art)
    print("=== LIGHT variant (RR + arco + Cred original) ===")
    light = apply_transform(original, transform_light)
    full_path = OUT_DIR / "logo-rr-cred-full.png"
    light.save(full_path, "PNG", optimize=True)
    print(
        f"  {full_path.name:38s} {full_path.stat().st_size / 1024:6.1f} KB  ({light.size[0]}x{light.size[1]})"
    )
    save_variants(light, "light")

    # DARK
    print("\n=== DARK variant (RR branco + arco + texto branco) ===")
    dark = apply_transform(original, transform_dark)
    save_variants(dark, "dark")

    # MARK-LIGHT
    print("\n=== MARK-LIGHT variant (sem Cred, light) ===")
    mark_light = apply_transform(original, transform_mark_light)
    save_variants(mark_light, "mark-light")

    # MARK-DARK
    print("\n=== MARK-DARK variant (sem Cred, dark) ===")
    mark_dark = apply_transform(original, transform_mark_dark)
    save_variants(mark_dark, "mark-dark")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
