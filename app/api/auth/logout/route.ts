import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "../../../../lib/auth/supabaseServerClient";

/**
 * POST /api/auth/logout
 * Faz signOut e redireciona para /login. signOut limpa cookies de sessão via
 * o helper @supabase/ssr.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const url = new URL("/login", request.url);
  return NextResponse.redirect(url, { status: 303 });
}
