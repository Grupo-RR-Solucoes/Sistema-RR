import type { ReactNode } from "react";

export type BannerVariant = "info" | "ok";

export interface BannerProps {
  /** info (azul) | ok (verde). */
  variant?: BannerVariant;
  children?: ReactNode;
  /** Ícone customizado; se omitido usa o padrão da variante. */
  icon?: ReactNode;
  /** Ação opcional à direita (ex.: <Button variant="secundario">…</Button>). */
  action?: ReactNode;
  className?: string;
}

const DEFAULT_ICON: Record<BannerVariant, ReactNode> = {
  info: (
    <svg
      className="rrui-banner__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  ),
  ok: (
    <svg
      className="rrui-banner__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.8 10A10 10 0 1 1 17 3.3" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  ),
};

export default function Banner({
  variant = "info",
  children,
  icon,
  action,
  className,
}: BannerProps) {
  const cls = ["rrui-banner", `rrui-banner--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} role="status">
      {icon ?? DEFAULT_ICON[variant]}
      <div className="rrui-banner__body">{children}</div>
      {action != null ? (
        <div className="rrui-banner__action">{action}</div>
      ) : null}
    </div>
  );
}
