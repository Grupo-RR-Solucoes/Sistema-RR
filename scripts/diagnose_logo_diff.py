#!/usr/bin/env python3
"""
scripts/diagnose_logo_diff.py — Fase 1.6.3 diagnostico v2

Compara logo-rr-cred-full.png (apos transform_light) com
logo-rr-cred-mark-light-200.png (apos recorte Cred). Detecta pixels
DOURADOS (criterio largo, inclui antialiasing claro) presentes no full
que sumiram (alpha<50) no mark.

Diferenca do diagnostico v1:
  - Criterio dourado mais permissivo: R>130 AND R>B AND R>G*0.7
    Pega tons claros do gradiente do arco (regiao central do swoosh).
  - Limiar alpha: full alpha>100 (visivel), mark alpha<50 (invisivel).
  - Reporta se cluster sumido cai dentro da BB Cred atual.

Saida: stdout + _diff_overlay_2.png com pixels sumidos em magenta sobre o
full redimensionado.
"""

import sys
from pathlib import Path

from PIL import Image

SRC_JPEG = Path("public/brand/source/logo-rr-cred-original.jpeg")
FULL = Path("public/brand/logo-rr-cred-full.png")
MARK = Path("public/brand/logo-rr-cred-mark-light-200.png")
OVERLAY = Path("public/brand/_diff_overlay_2.png")
OVERLAY_JPEG_FULL = Path("public/brand/_diff_overlay_jpeg_to_full.png")
BG_THRESHOLD = 245  # mesmo do process_brand_logo.py

# BB atual do recorte Cred (espaco original 1024x1280, definida em
# scripts/process_brand_logo.py)
CRED_BB_ORIG = (625, 853, 810, 935)  # x_min, y_min, x_max, y_max


def is_gold_loose(r: int, g: int, b: int) -> bool:
    """Dourado permissivo: pega tons claros + antialiasing do gradiente."""
    return r > 130 and r > b and r > g * 0.7


def main() -> int:
    if not FULL.exists() or not MARK.exists():
        print("FATAL: arquivos de entrada nao encontrados.", file=sys.stderr)
        return 2

    full_full = Image.open(FULL).convert("RGBA")
    mark = Image.open(MARK).convert("RGBA")

    fw, fh = full_full.size
    mw, mh = mark.size
    print(f"Full PNG:  {fw}x{fh}")
    print(f"Mark PNG:  {mw}x{mh}")

    # Trabalhar no espaco do mark (200x250) — downscale do full
    full_resized = full_full.resize((mw, mh), Image.LANCZOS)
    print(f"Full redimensionado para {mw}x{mh} (LANCZOS).\n")

    full_px = full_resized.load()
    mark_px = mark.load()

    removed_xs: list[int] = []
    removed_ys: list[int] = []
    rgb_sum = [0, 0, 0]

    for y in range(mh):
        for x in range(mw):
            r0, g0, b0, a0 = full_px[x, y]
            _, _, _, a1 = mark_px[x, y]
            if a0 > 100 and is_gold_loose(r0, g0, b0) and a1 < 50:
                removed_xs.append(x)
                removed_ys.append(y)
                rgb_sum[0] += r0
                rgb_sum[1] += g0
                rgb_sum[2] += b0

    total = len(removed_xs)
    print(f"Pixels dourados (criterio permissivo) sumidos: {total}")

    if total == 0:
        print("Nenhum pixel dourado removido. Pipeline limpo nesse criterio.")
        return 0

    print(f"BB no espaco 200x250:")
    print(f"  x: {min(removed_xs)}-{max(removed_xs)}")
    print(f"  y: {min(removed_ys)}-{max(removed_ys)}")
    avg = tuple(c // total for c in rgb_sum)
    print(f"Cor RGB media dos sumidos: {avg}")

    # Mapear para espaco original 1024x1280
    scale_x = fw / mw
    scale_y = fh / mh
    ox_min = int(min(removed_xs) * scale_x)
    ox_max = int(max(removed_xs) * scale_x)
    oy_min = int(min(removed_ys) * scale_y)
    oy_max = int(max(removed_ys) * scale_y)
    print(f"BB no espaco original 1024x1280:")
    print(f"  x: {ox_min}-{ox_max}")
    print(f"  y: {oy_min}-{oy_max}")

    # Cruzar com BB Cred atual
    cred_xmin, cred_ymin, cred_xmax, cred_ymax = CRED_BB_ORIG
    inside = 0
    outside = 0
    for x, y in zip(removed_xs, removed_ys):
        ox = x * scale_x
        oy = y * scale_y
        if cred_xmin <= ox <= cred_xmax and cred_ymin <= oy <= cred_ymax:
            inside += 1
        else:
            outside += 1
    pct_inside = inside / total * 100 if total else 0.0
    pct_outside = outside / total * 100 if total else 0.0
    print(f"BB Cred atual (orig 1024x1280): x={cred_xmin}-{cred_xmax}, y={cred_ymin}-{cred_ymax}")
    print(f"  Dentro da BB: {inside} ({pct_inside:.1f}%)")
    print(f"  Fora da BB:   {outside} ({pct_outside:.1f}%)")

    # Overlay
    overlay = full_resized.copy()
    op = overlay.load()
    for x, y in zip(removed_xs, removed_ys):
        op[x, y] = (255, 0, 255, 255)
    overlay.save(OVERLAY, "PNG", optimize=True)
    print(f"\nOverlay salvo: {OVERLAY}")

    return 0


def diagnose_jpeg_to_full() -> int:
    """Investiga se a etapa JPEG → FULL (transform_light) absorve pixels
    dourados claros do meio do arco como background (R/G/B>=245).

    Procedimento: carrega JPEG original, percorre cada pixel. Se ele seria
    classificado como BG por transform_light (R,G,B>=245) mas tem cor
    dourada-clara (criterio permissivo + tolerancia para tons clarissimos),
    flagga como "potencialmente absorvido".
    """
    if not SRC_JPEG.exists():
        print("Source JPEG nao encontrado.", file=sys.stderr)
        return 2

    src = Image.open(SRC_JPEG).convert("RGB")
    w, h = src.size
    px = src.load()

    # Criterio adicional para tons "creme/dourado claro" — pixels mais claros
    # que o bg threshold mas com ligeira dominancia R>G>B (cromia dourada)
    absorbed_xs: list[int] = []
    absorbed_ys: list[int] = []
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            # Pixel quase bg (algum canal >= 245), mas com leve cromia dourada
            if r >= BG_THRESHOLD and g >= BG_THRESHOLD and b >= BG_THRESHOLD:
                # Por transform_light: pixel iria a alpha=0
                # Pergunta: era dourado-claro? Cromia r>=g>=b com diff minima
                if r >= g >= b and (r - b) >= 4 and r >= 250:
                    absorbed_xs.append(x)
                    absorbed_ys.append(y)

    total = len(absorbed_xs)
    print(f"\n=== Diagnostico JPEG -> FULL (etapa transform_light) ===")
    print(f"Pixels potencialmente absorvidos como bg mas com cromia dourada: {total}")
    if total > 0:
        print(f"BB no espaco original 1024x1280:")
        print(f"  x: {min(absorbed_xs)}-{max(absorbed_xs)}")
        print(f"  y: {min(absorbed_ys)}-{max(absorbed_ys)}")

        # Salva overlay no espaco original (downscaled para 200x250 para visualizacao)
        canvas = Image.new("RGBA", (w, h), (255, 255, 255, 255))
        canvas.paste(src, (0, 0))
        cp = canvas.load()
        for x, y in zip(absorbed_xs, absorbed_ys):
            cp[x, y] = (255, 0, 255, 255)
        canvas_small = canvas.resize((200, 250), Image.LANCZOS)
        canvas_small.save(OVERLAY_JPEG_FULL, "PNG", optimize=True)
        print(f"Overlay salvo: {OVERLAY_JPEG_FULL}")

    return 0


if __name__ == "__main__":
    rc = main()
    if rc == 0:
        rc = diagnose_jpeg_to_full()
    sys.exit(rc)
