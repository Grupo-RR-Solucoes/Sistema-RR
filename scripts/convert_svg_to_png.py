#!/usr/bin/env python3
"""Etapa 0 — Converte logo_grupo_cred_coreldraw.svg para PNG 1024px.

A SVG contem (a) PNG embutido base64 (RR + arco dourado) e (b) <text>
GRUPO/CRED em vetor sobreposto. Como o pipeline da Fase 1.7 quer
*so* o mark (sem texto, pois GRUPO/CRED viram CSS no BrandLogo.tsx),
extraimos diretamente o PNG embutido e compomos sobre fundo branco
no tamanho 1024x1280 (viewBox da SVG).

Saida: public/brand/source/logo-rr-cred-mark-original.png
"""

import base64
import io
import re
import sys
from pathlib import Path

from PIL import Image

SVG_SRC = Path(r"C:/Users/diego/Downloads/logo_grupo_cred_coreldraw.svg")
PNG_DST = Path("public/brand/source/logo-rr-cred-mark-original.png")
TARGET_W = 1024


def main() -> int:
    if not SVG_SRC.exists():
        print(f"FATAL: SVG nao encontrado: {SVG_SRC}", file=sys.stderr)
        return 2

    svg_text = SVG_SRC.read_text(encoding="utf-8")

    # Dimensoes do viewBox
    m_vb = re.search(r'viewBox="([\d.\s\-]+)"', svg_text)
    if not m_vb:
        print("FATAL: viewBox nao encontrado na SVG", file=sys.stderr)
        return 2
    vb_parts = m_vb.group(1).split()
    vb_w, vb_h = float(vb_parts[2]), float(vb_parts[3])
    print(f"SVG viewBox: {vb_w:.0f} x {vb_h:.0f}")

    # Extrai o primeiro <image href="data:image/png;base64,...">
    m_img = re.search(
        r'<image[^>]+href="data:image/png;base64,([A-Za-z0-9+/=]+)"',
        svg_text,
        re.DOTALL,
    )
    if not m_img:
        print("FATAL: <image href=data:...> nao encontrado", file=sys.stderr)
        return 2

    b64 = m_img.group(1)
    raw_png = base64.b64decode(b64)
    print(f"PNG embutido: {len(raw_png) / 1024:.1f} KB")

    embedded = Image.open(io.BytesIO(raw_png))
    print(f"PNG embutido dimensoes: {embedded.size} mode={embedded.mode}")

    # Composicao final: canvas branco no tamanho do viewBox, com PNG
    # embutido colado em (0,0). Se o PNG embutido ja for 1024x1280
    # bate exato com o viewBox e cobre tudo.
    canvas = Image.new("RGB", (int(vb_w), int(vb_h)), (255, 255, 255))
    if embedded.mode == "RGBA":
        canvas.paste(embedded, (0, 0), embedded)
    else:
        canvas.paste(embedded, (0, 0))

    # Redimensiona para TARGET_W mantendo aspect
    aspect = canvas.size[1] / canvas.size[0]
    target_h = round(TARGET_W * aspect)
    if canvas.size[0] != TARGET_W:
        canvas = canvas.resize((TARGET_W, target_h), Image.LANCZOS)

    PNG_DST.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(PNG_DST, "PNG", optimize=True)
    size_kb = PNG_DST.stat().st_size / 1024
    print(f"\nSaida: {PNG_DST}")
    print(f"Dimensoes: {canvas.size[0]} x {canvas.size[1]} px")
    print(f"Tamanho: {size_kb:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
