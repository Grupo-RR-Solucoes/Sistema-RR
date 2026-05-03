import type { CSSProperties } from "react";
import Image from "next/image";

type BrandLogoProps = {
  size?: number;
  compact?: boolean;
  tone?: "dark" | "light";
  subtitle?: string;
};

export default function BrandLogo({
  size = 84,
  compact = false,
  tone = "dark",
  subtitle,
}: BrandLogoProps) {
  const textColor = tone === "light" ? "#ffffff" : "var(--rr-ink)";
  const subtitleColor = tone === "light" ? "rgba(255,255,255,0.78)" : "var(--rr-muted)";
  const markSize = compact ? Math.round(size * 0.92) : size;
  const groupSize = compact ? 11 : 12;
  const credSize = compact ? 16 : 21;

  return (
    <div
      style={{
        ...styles.wrap,
        gap: compact ? "8px" : "10px",
      }}
    >
      <div style={styles.row}>
        <Image
          src="/brand/rr-mark.svg"
          alt="RR Cred"
          width={markSize}
          height={markSize}
          style={styles.mark}
        />

        <div style={styles.textStack}>
          <span
            style={{
              ...styles.groupLabel,
              color: textColor,
              fontSize: `${groupSize}px`,
            }}
          >
            GRUPO
          </span>
          <span
            style={{
              ...styles.credLabel,
              color: textColor,
              fontSize: `${credSize}px`,
            }}
          >
            Cred
          </span>
        </div>
      </div>

      {subtitle ? (
        <div
          style={{
            ...styles.subtitle,
            color: subtitleColor,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "grid",
    alignItems: "center",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "nowrap",
  },
  mark: {
    width: "auto",
    height: "auto",
    maxWidth: "100%",
    objectFit: "contain",
    filter: "drop-shadow(0 10px 24px rgba(11, 22, 51, 0.14))",
  },
  textStack: {
    display: "grid",
    gap: "1px",
    lineHeight: 1,
  },
  groupLabel: {
    fontFamily: "var(--font-heading)",
    fontWeight: 800,
    letterSpacing: "0.24em",
    lineHeight: 1,
  },
  credLabel: {
    fontFamily: "var(--font-heading)",
    fontWeight: 700,
    lineHeight: 1,
  },
  subtitle: {
    marginTop: "2px",
    fontSize: "12px",
    lineHeight: 1.45,
    maxWidth: 320,
  },
};
