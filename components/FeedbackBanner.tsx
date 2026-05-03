import type { CSSProperties } from "react";
import Link from "next/link";

type FeedbackVariant = "error" | "success" | "info" | "warning";

type FeedbackBannerProps = {
  variant?: FeedbackVariant;
  eyebrow?: string;
  title: string;
  description?: string;
  helper?: string;
  actionLabel?: string;
  actionHref?: string;
};

const variantMap: Record<
  FeedbackVariant,
  {
    border: string;
    background: string;
    pillBackground: string;
    pillColor: string;
    titleColor: string;
  }
> = {
  error: {
    border: "rgba(204, 43, 73, 0.22)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(255,233,239,0.98) 100%)",
    pillBackground: "rgba(204, 43, 73, 0.12)",
    pillColor: "#a62345",
    titleColor: "#7f1734",
  },
  success: {
    border: "rgba(18, 142, 87, 0.2)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(233,255,245,0.98) 100%)",
    pillBackground: "rgba(18, 142, 87, 0.12)",
    pillColor: "#177954",
    titleColor: "#14533d",
  },
  info: {
    border: "rgba(13, 77, 227, 0.18)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(238,244,255,0.98) 100%)",
    pillBackground: "rgba(13, 77, 227, 0.1)",
    pillColor: "var(--rr-blue)",
    titleColor: "var(--rr-blue-deep)",
  },
  warning: {
    border: "rgba(214, 161, 63, 0.24)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(255,248,226,0.98) 100%)",
    pillBackground: "rgba(214, 161, 63, 0.12)",
    pillColor: "var(--rr-gold-deep)",
    titleColor: "#745114",
  },
};

export default function FeedbackBanner({
  variant = "info",
  eyebrow,
  title,
  description,
  helper,
  actionLabel,
  actionHref,
}: FeedbackBannerProps) {
  const theme = variantMap[variant];

  return (
    <article
      style={{
        ...styles.card,
        borderColor: theme.border,
        background: theme.background,
      }}
    >
      <div style={styles.header}>
        <span
          style={{
            ...styles.pill,
            background: theme.pillBackground,
            color: theme.pillColor,
          }}
        >
          {eyebrow || defaultEyebrow[variant]}
        </span>
        {helper ? <span style={styles.helper}>{helper}</span> : null}
      </div>

      <div style={styles.body}>
        <div style={{ ...styles.title, color: theme.titleColor }}>{title}</div>
        {description ? <div style={styles.description}>{description}</div> : null}
      </div>

      {actionLabel && actionHref ? (
        <Link href={actionHref} style={styles.link}>
          {actionLabel}
        </Link>
      ) : null}
    </article>
  );
}

const defaultEyebrow: Record<FeedbackVariant, string> = {
  error: "Ajuste necessario",
  success: "Tudo certo",
  info: "Contexto",
  warning: "Atencao",
};

const styles: Record<string, CSSProperties> = {
  card: {
    border: "1px solid",
    borderRadius: "22px",
    padding: "16px 18px",
    boxShadow: "var(--rr-shadow-soft)",
    display: "grid",
    gap: "10px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
  },
  helper: {
    fontSize: "12px",
    color: "var(--rr-muted)",
    lineHeight: 1.5,
  },
  body: {
    display: "grid",
    gap: "5px",
  },
  title: {
    fontSize: "16px",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
    lineHeight: 1.18,
  },
  description: {
    fontSize: "13px",
    color: "var(--rr-muted)",
    lineHeight: 1.6,
  },
  link: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "fit-content",
    padding: "10px 14px",
    borderRadius: "14px",
    border: "1px solid var(--rr-line-strong)",
    background: "rgba(255,255,255,0.74)",
    color: "var(--rr-blue-deep)",
    fontSize: "12px",
    fontWeight: 700,
    textDecoration: "none",
  },
};
