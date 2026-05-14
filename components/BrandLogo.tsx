import type { CSSProperties } from "react";
import Image from "next/image";

type BrandLogoSize = "sm" | "md" | "lg";

type BrandLogoProps = {
  size?: BrandLogoSize | number;
  compact?: boolean;
  tone?: "dark" | "light";
  subtitle?: string;
  showText?: boolean;
};

/**
 * Logo Grupo RR Cred — composicao hibrida (Fase 1.7):
 *   - PNG mark (RR + arco dourado, Cred recortado) servido em 3 tamanhos
 *     x 2 variantes (light/dark) — qualidade identica a arte original.
 *   - "GRUPO" + "CRED" renderizados ao lado via CSS (font-family,
 *     letter-spacing, cor controlados pelo tone).
 *
 * Tones:
 *   light  -> mark com RR azul + arco original; texto GRUPO azul, CRED dourado
 *   dark   -> mark com RR branco + arco dourado preservado; GRUPO branco, CRED amarelo
 *
 * API:
 *   - size: 'sm'|'md'|'lg' OU number (legacy compat).
 *           Number map: <=80 -> sm | 81-140 -> md | >140 -> lg.
 *   - compact: reduz uma tier (md->sm, lg->md).
 *   - tone: seleciona variante PNG + cores do texto + cor do subtitle.
 *   - subtitle: texto opcional renderizado a direita (fonte legibilidade).
 *   - showText: se false, oculta GRUPO+CRED (uso: sidebar collapsed).
 */
export default function BrandLogo({
  size = "md",
  compact = false,
  tone = "dark",
  subtitle,
  showText = true,
}: BrandLogoProps) {
  const tier = applyCompact(resolveSize(size), compact);
  const { markW, markH, grupo, cred, gap } = TIER_DIMENSIONS[tier];
  const variant = tone === "dark" ? "dark" : "light";

  const grupoColor = tone === "dark" ? "#FFFFFF" : "#0d4de3";
  const credColor = tone === "dark" ? "#fff000" : "#d6a13f";
  const subtitleColor =
    tone === "dark" ? "rgba(255,255,255,0.78)" : "var(--rr-muted)";

  return (
    <div style={{ ...styles.wrap, gap }}>
      <Image
        src={`/brand/logo-rr-cred-mark-${variant}-${markW}.png`}
        alt="Grupo RR Cred"
        width={markW}
        height={markH}
        priority
        style={styles.image}
      />

      {showText ? (
        <div style={styles.textStack}>
          <span
            style={{
              ...styles.grupoLabel,
              fontSize: grupo,
              color: grupoColor,
            }}
          >
            GRUPO
          </span>
          <span
            style={{
              ...styles.credLabel,
              fontSize: cred,
              color: credColor,
            }}
          >
            CRED
          </span>
        </div>
      ) : null}

      {subtitle ? (
        <span style={{ ...styles.subtitle, color: subtitleColor }}>
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}

const TIER_DIMENSIONS: Record<
  BrandLogoSize,
  { markW: number; markH: number; grupo: number; cred: number; gap: number }
> = {
  sm: { markW: 64, markH: 80, grupo: 9, cred: 13, gap: 6 },
  md: { markW: 120, markH: 150, grupo: 14, cred: 20, gap: 12 },
  lg: { markW: 200, markH: 250, grupo: 22, cred: 32, gap: 18 },
};

function resolveSize(size: BrandLogoSize | number): BrandLogoSize {
  if (typeof size === "number") {
    if (size <= 80) return "sm";
    if (size <= 140) return "md";
    return "lg";
  }
  return size;
}

function applyCompact(size: BrandLogoSize, compact: boolean): BrandLogoSize {
  if (!compact) return size;
  if (size === "lg") return "md";
  if (size === "md") return "sm";
  return "sm";
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "inline-flex",
    alignItems: "center",
  },
  image: {
    display: "block",
    height: "auto",
    objectFit: "contain",
    flexShrink: 0,
  },
  textStack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 2,
    lineHeight: 1,
  },
  grupoLabel: {
    fontFamily: "var(--font-heading)",
    fontWeight: 700,
    letterSpacing: "0.5px",
    lineHeight: 1,
  },
  credLabel: {
    fontFamily: "var(--font-heading)",
    fontWeight: 800,
    letterSpacing: "0.3px",
    lineHeight: 1,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 1.45,
    maxWidth: 240,
    marginLeft: 8,
  },
};
