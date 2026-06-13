import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primario" | "acao" | "secundario" | "perigo";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  /** primario (navy) | acao (azul) | secundario (contorno) | perigo (risk). */
  variant?: ButtonVariant;
  children?: ReactNode;
  className?: string;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primario: "rrui-btn--primario",
  acao: "rrui-btn--acao",
  secundario: "rrui-btn--secundario",
  perigo: "rrui-btn--perigo",
};

/**
 * Botão do kit. Estado "Em breve" = `disabled` (estilo já cobre: opacidade +
 * not-allowed); passe também `title="Em breve"` se quiser o tooltip. `onClick`,
 * `type`, `disabled`, `title`, `aria-*` etc. são repassados nativamente.
 */
export default function Button({
  variant = "primario",
  children,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = ["rrui-btn", VARIANT_CLASS[variant], className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
