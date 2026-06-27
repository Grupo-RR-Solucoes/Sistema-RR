import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/auth/supabaseServerClient";

/**
 * GET /auth/callback?code=...
 *
 * Aterrissagem dos links de e-mail (convite e recuperação de senha) gerados
 * pelo Supabase Auth. Fluxo PKCE: troca o `code` por uma sessão (grava os
 * cookies via @supabase/ssr) e encaminha para /definir-senha.
 *
 * Precisa ser PÚBLICA no middleware: ao chegar aqui ainda NÃO há sessão — é
 * exatamente este handler que a cria.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?erro=link_invalido`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?erro=link_invalido`);
  }

  return NextResponse.redirect(`${origin}/definir-senha`);
}
