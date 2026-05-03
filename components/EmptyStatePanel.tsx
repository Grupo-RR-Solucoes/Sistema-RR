import type { CSSProperties } from "react";
import Link from "next/link";

type EmptyStatePanelProps = {
  eyebrow?: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  compact?: boolean;
};

export default function EmptyStatePanel({
  eyebrow = "Sem conteudo",
  title,
  description,
  actionLabel,
  actionHref,
  compact = false,
}: EmptyStatePanelProps) {
  return (
    <div
      style={{
        ...styles.card,
        padding: compact ? "14px 16px" : "18px 18px",
      }}
    >
      <div style={styles.kicker}>{eyebrow}</div>
      <div style={styles.title}>{title}</div>
      <div style={styles.description}>{description}</div>
      {actionLabel && actionHref ? (
        <Link href={actionHref} style={styles.link}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  card: {
    borderRadius: "22px",
    border: "1px dashed rgba(13, 77, 227, 0.22)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(246,249,255,0.94) 100%)",
    boxShadow: "var(--rr-shadow-soft)",
    display: "grid",
    gap: "8px",
    alignContent: "start",
  },
  kicker: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  title: {
    fontSize: "16px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    fontFamily: "var(--font-heading)",
    lineHeight: 1.18,
  },
  description: {
    fontSize: "13px",
    color: "var(--rr-muted)",
    lineHeight: 1.58,
  },
  link: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "fit-content",
    padding: "9px 13px",
    borderRadius: "14px",
    border: "1px solid var(--rr-line-strong)",
    background: "rgba(255,255,255,0.72)",
    color: "var(--rr-blue-deep)",
    fontSize: "12px",
    fontWeight: 700,
    textDecoration: "none",
  },
};
