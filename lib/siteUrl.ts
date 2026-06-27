// Resolve a URL base do app para montar redirectTo de links de convite/reset.
// Prefere NEXT_PUBLIC_SITE_URL; cai para o origin da request quando ausente.

/** Server-side: usa a env, senão o origin da request. Sem barra final. */
export function resolveSiteUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

/** Client-side: env, senão window.location.origin. Sem barra final. */
export function clientSiteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
