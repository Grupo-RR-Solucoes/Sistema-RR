import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// FRENTE DE PRODUTO — M3 PARTE A2: cadastro do gestor de consorcio (vigencia).
// O USUARIO gestor (role gestor_consorcio) e criado no fluxo padrao /admin/usuarios.
// Aqui o socio define QUEM e o gestor vigente por competencia (consorcio_gestor).
// socio-only. GET lista usuarios gestor_consorcio + vigencias; POST define a vigencia.
// ============================================================

const COMP_RE = /^\d{4}-\d{2}$/;

export async function GET() {
  try {
    const { supabase } = await withSocioAdmin();
    const [users, vigencias] = await Promise.all([
      supabase
        .from("app_users")
        .select("id, full_name, email, active")
        .eq("role", "gestor_consorcio"),
      supabase.from("consorcio_gestor").select("competencia, app_user_id, ativo").order("competencia", { ascending: false }),
    ]);
    if (users.error) throw new Error(users.error.message);
    if (vigencias.error) throw new Error(vigencias.error.message);

    const nameOf = new Map((users.data || []).map((u: any) => [u.id, u.full_name || u.email]));
    return NextResponse.json({
      gestores: (users.data || []).map((u: any) => ({
        id: u.id,
        nome: u.full_name || u.email,
        email: u.email,
        active: u.active !== false,
      })),
      vigencias: (vigencias.data || []).map((v: any) => ({
        competencia: v.competencia,
        app_user_id: v.app_user_id,
        nome: nameOf.get(v.app_user_id) ?? "(usuário removido)",
        ativo: v.ativo !== false,
      })),
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase } = await withSocioAdmin();
    const body = await req.json();
    const competencia = String(body.competencia || "");
    const app_user_id = String(body.app_user_id || "");
    if (!COMP_RE.test(competencia)) {
      return NextResponse.json({ error: "Competência inválida (YYYY-MM)." }, { status: 400 });
    }
    if (!app_user_id) {
      return NextResponse.json({ error: "Selecione o usuário gestor." }, { status: 400 });
    }

    // defesa: o app_user tem que ser mesmo um gestor_consorcio.
    const { data: u, error: uErr } = await supabase
      .from("app_users")
      .select("id, role")
      .eq("id", app_user_id)
      .maybeSingle();
    if (uErr) throw new Error(uErr.message);
    if (!u || u.role !== "gestor_consorcio") {
      return NextResponse.json({ error: "O usuário escolhido não é um gestor de consórcio." }, { status: 400 });
    }

    // 1 gestor por competencia (unique(competencia)). Upsert = trocar o vigente.
    const { error } = await supabase
      .from("consorcio_gestor")
      .upsert({ competencia, app_user_id, ativo: true }, { onConflict: "competencia" });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
