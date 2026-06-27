import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidCPF, onlyDigits } from "@/lib/validators/cpf";

/**
 * POST /api/auth/resolve-cpf  { cpf: string }
 *
 * Resolve um CPF (funcionário/promotor) para o e-mail interno usado no login
 * Supabase Auth. Roda SEMPRE server-side com service_role — o client anônimo
 * não tem acesso a app_users (RLS só p/ authenticated).
 *
 * Resposta UNIFORME contra enumeração: se o CPF é inválido, não existe ou está
 * inativo, devolve sempre { email: null } (200) — nunca revela se o CPF está
 * cadastrado. Só retorna o e-mail quando há row ativa.
 *
 * NUNCA loga o CPF em texto. Rate-limit básico em memória (best-effort) para
 * frear varredura; o gate real de credencial é o signInWithPassword seguinte.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rate-limit em memória (por instância). Janela deslizante simples por IP.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 15;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  // Limpeza oportunista para não crescer indefinidamente.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= RL_WINDOW_MS)) hits.delete(k);
    }
  }
  return arr.length > RL_MAX;
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request) {
  try {
    if (rateLimited(clientIp(req))) {
      return NextResponse.json(
        { error: "Muitas tentativas. Aguarde alguns instantes." },
        { status: 429 }
      );
    }

    let body: { cpf?: unknown };
    try {
      body = (await req.json()) as { cpf?: unknown };
    } catch {
      return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
    }

    const cpf = onlyDigits(typeof body.cpf === "string" ? body.cpf : "");
    // CPF inválido → 400 genérico (sem detalhar o motivo).
    if (!isValidCPF(cpf)) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("app_users")
      .select("email, active")
      .eq("cpf", cpf)
      .limit(1)
      .maybeSingle();

    // Erro de infra ou não encontrado/inativo → resposta uniforme { email: null }.
    if (error || !data || data.active === false || !data.email) {
      return NextResponse.json({ email: null });
    }

    return NextResponse.json({ email: data.email });
  } catch {
    // Falha inesperada também responde uniforme (não vaza estado).
    return NextResponse.json({ email: null });
  }
}
