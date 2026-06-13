import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** Ícone customizado; se omitido usa um placeholder neutro. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Ação opcional (ex.: <Button>…</Button> ou um link). */
  action?: ReactNode;
  className?: string;
}

const DEFAULT_ICON: ReactNode = (
  <svg
    className="rrui-empty__icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
    <path d="M14 2v6h6" />
    <path d="M9 13h6" />
    <path d="M9 17h3" />
  </svg>
);

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const cls = ["rrui-empty", className].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      {icon ?? DEFAULT_ICON}
      <div className="rrui-empty__title">{title}</div>
      {description != null ? (
        <div className="rrui-empty__desc">{description}</div>
      ) : null}
      {action != null ? (
        <div className="rrui-empty__action">{action}</div>
      ) : null}
    </div>
  );
}
