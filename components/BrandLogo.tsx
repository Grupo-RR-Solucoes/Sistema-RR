"use client";

import Image from "next/image";

interface BrandLogoProps {
  size?: "sm" | "md" | "lg" | number;
  tone?: "light" | "dark";
  compact?: boolean;
  subtitle?: string;
}

/**
 * BrandLogo — arte unica do Grupo RR Cred (marca RR + arco + texto "GRUPO RR /
 * CRED" ja embutidos na imagem, sobre fundo navy #0F1F4A normalizado).
 *
 * Nao ha mais texto recriado em CSS: o nome do grupo vem dentro da arte. O
 * fundo da imagem e exatamente o navy da sidebar (#0F1F4A), entao no menu
 * lateral ela funde sem borda; no card branco do login vira um tile navy
 * arredondado (as cores do texto da arte sao calibradas para navy).
 *
 * Tiers:
 *   sm  -> marca isolada (RR + arco), para a sidebar RECOLHIDA (64px)
 *   md  -> lockup completo, para a sidebar EXPANDIDA
 *   lg  -> lockup completo, para o login
 *
 * `tone` e mantido por compatibilidade de API (a arte ja e navy); so muda a
 * cor do subtitle opcional. `subtitle` nao faz parte da arte — entra como
 * legenda abaixo (usado no login).
 */
const ASSETS = {
  full: { src: "/brand/logo-grupo-rr-cred-full.png", w: 1177, h: 696 },
  mark: { src: "/brand/logo-grupo-rr-cred-mark.png", w: 618, h: 638 },
} as const;

const WIDTHS: Record<"sm" | "md" | "lg", number> = {
  sm: 40,
  md: 150,
  lg: 300,
};

export default function BrandLogo({
  size = "md",
  tone = "dark",
  compact,
  subtitle,
}: BrandLogoProps) {
  const tier = resolveTier(size, compact);
  const asset = tier === "sm" ? ASSETS.mark : ASSETS.full;
  const w = WIDTHS[tier];
  const h = Math.round((w * asset.h) / asset.w);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: tier === "lg" ? "center" : "flex-start",
        gap: 8,
        maxWidth: "100%",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <Image
        src={asset.src}
        alt="Grupo RR Cred"
        width={w}
        height={h}
        sizes={`${w}px`}
        priority
        quality={92}
        style={{
          display: "block",
          width: w,
          height: h,
          maxWidth: "100%",
          flexShrink: 0,
          objectFit: "contain",
          borderRadius: tier === "sm" ? 10 : 14,
        }}
      />
      {subtitle ? (
        <span
          style={{
            fontSize: 12,
            color: tone === "dark" ? "rgba(255,255,255,0.6)" : "#5A6B82",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "100%",
            fontWeight: 400,
            letterSpacing: 0,
          }}
        >
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}

function resolveTier(
  size: BrandLogoProps["size"],
  compact?: boolean
): "sm" | "md" | "lg" {
  if (typeof size === "number") {
    if (size <= 60) return "sm";
    if (size <= 100) return compact ? "sm" : "md";
    return compact ? "md" : "lg";
  }
  if (compact && size === "md") return "sm";
  if (compact && size === "lg") return "md";
  return size ?? "md";
}
