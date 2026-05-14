"use client";

import Image from "next/image";

import dimensions from "../public/brand/logo-dimensions.json";

interface BrandLogoProps {
  size?: "sm" | "md" | "lg" | number;
  tone?: "light" | "dark";
  compact?: boolean;
  subtitle?: string;
}

const SIZE_MAP: Record<"sm" | "md" | "lg", number> = {
  sm: 48,
  md: 80,
  lg: 140,
};

const TEXT_GAP: Record<"sm" | "md" | "lg", number> = {
  sm: 2,
  md: 4,
  lg: 6,
};

const BRAND_FONT_SIZE: {
  grupo: Record<"sm" | "md" | "lg", number>;
  cred: Record<"sm" | "md" | "lg", number>;
} = {
  grupo: { sm: 10, md: 14, lg: 22 },
  cred: { sm: 13, md: 20, lg: 30 },
};

const COLORS = {
  light: { grupo: "#0d4de3", cred: "#d6a13f" },
  dark: { grupo: "#FFFFFF", cred: "#FFF000" },
} as const;

type DimsMap = Record<string, { width: number; height: number }>;
const dims = dimensions as DimsMap;

export default function BrandLogo({
  size = "md",
  tone = "dark",
  compact,
  subtitle,
}: BrandLogoProps) {
  const tier = resolveTier(size, compact);
  const w = SIZE_MAP[tier];

  const variant = tone === "dark" ? "mark-dark" : "mark-light";
  const sourceKey = `${variant}-200`;
  const sourceDims = dims[sourceKey];
  const aspect = sourceDims.height / sourceDims.width;
  const h = Math.round(w * aspect);

  const palette = COLORS[tone];
  const fontSizeGrupo = BRAND_FONT_SIZE.grupo[tier];
  const fontSizeCred = BRAND_FONT_SIZE.cred[tier];
  const textGap = TEXT_GAP[tier];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: textGap + 4,
        maxWidth: "100%",
        overflow: "hidden",
      }}
    >
      <Image
        src={`/brand/logo-rr-cred-${variant}-200.png`}
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
          flexShrink: 0,
          objectFit: "contain",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          lineHeight: 1,
          gap: textGap,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: fontSizeGrupo,
            fontWeight: 800,
            color: palette.grupo,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          GRUPO
        </span>
        <span
          style={{
            fontSize: fontSizeCred,
            fontWeight: 800,
            color: palette.cred,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          CRED
        </span>
        {subtitle ? (
          <span
            style={{
              marginTop: textGap + 2,
              fontSize: Math.max(10, Math.round(fontSizeCred * 0.5)),
              color: tone === "dark" ? "rgba(255,255,255,0.6)" : "#5A6B82",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontWeight: 400,
              letterSpacing: 0,
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
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
