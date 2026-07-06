import { NextResponse } from "next/server";

import { ApiGuardError, apiGuardErrorResponse, requireSocio } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchEquipesModel } from "@/lib/equipes/model";
import { buildGestorMetaEditor } from "@/lib/equipe/gestorMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// META DO GESTOR (Entrega 2) — escrita/leitura do override. SÓCIO-ONLY
// (requireSocio → 403 para funcionário, gestor e promotor). O editor vive em
// /admin/equipes; a /equipe apenas exibe a meta efetiva (read-only).
//
// GET  ?year&month → lista de gestores com meta_derivada + meta_override.
// PATCH { user_id, year, month, meta } → upsert; meta null/"" → DELETE (volta à
//        derivada). Grava created_by e registra em audit_logs.
// ============================================================

const TABLE = "gestor_targets";

async function writeAuditLog(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string,
) {
  try {
    await getSupabaseAdmin().from("audit_logs").insert({
      entity_name: "gestor_targets",
      action: "META_GESTOR",
      description,
      payload,
      created_by: createdBy,
    });
  } catch {
    // silencioso de propósito.
  }
}

function validComp(year: number, month: number): boolean {
  return Number.isInteger(year) && year >= 2000 && Number.isInteger(month) && month >= 1 && month <= 12;
}

export async function GET(req: Request) {
  try {
    await requireSocio();
    const supabase = getSupabaseAdmin();

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    if (!validComp(year, month)) {
      throw new ApiGuardError(400, "year/month obrigatórios (YYYY, 1-12).");
    }

    const model = await fetchEquipesModel(supabase);
    const [targetsRes, overridesRes] = await Promise.all([
      supabase.from("monthly_targets").select("promoter_id, meta").eq("year", year).eq("month", month),
      supabase.from(TABLE).select("user_id, meta").eq("year", year).eq("month", month),
    ]);
    if (targetsRes.error) throw new Error(targetsRes.error.message);
    if (overridesRes.error) throw new Error(overridesRes.error.message);

    const metaByPromoter = new Map<string, number>();
    for (const t of (targetsRes.data ?? []) as Array<{ promoter_id: string; meta: number | null }>) {
      metaByPromoter.set(t.promoter_id, Number(t.meta ?? 0));
    }
    const overrideByUser = new Map<string, number>();
    for (const o of (overridesRes.data ?? []) as Array<{ user_id: string; meta: number | null }>) {
      overrideByUser.set(o.user_id, Number(o.meta ?? 0));
    }

    const gestores = buildGestorMetaEditor(model, metaByPromoter, overrideByUser);
    return NextResponse.json({ year, month, gestores });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const { session } = await requireSocio();
    const supabase = getSupabaseAdmin();

    const body = (await req.json().catch(() => ({}))) as {
      user_id?: unknown;
      year?: unknown;
      month?: unknown;
      meta?: unknown;
    };
    const userId = String(body.user_id ?? "").trim();
    const year = Number(body.year);
    const month = Number(body.month);
    if (!userId) throw new ApiGuardError(400, "user_id obrigatório.");
    if (!validComp(year, month)) throw new ApiGuardError(400, "year/month inválidos (YYYY, 1-12).");

    // meta null/undefined/"" → limpar o override (volta à derivada).
    const clear = body.meta === null || body.meta === undefined || body.meta === "";
    if (clear) {
      const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq("user_id", userId)
        .eq("year", year)
        .eq("month", month);
      if (error) throw new Error(error.message);
      await writeAuditLog(
        `Removeu override de meta do gestor ${userId} (${year}-${String(month).padStart(2, "0")})`,
        { user_id: userId, year, month, cleared: true },
        session.appUser.email,
      );
      return NextResponse.json({ ok: true, cleared: true });
    }

    const meta = Number(body.meta);
    if (!Number.isFinite(meta) || meta < 0) throw new ApiGuardError(400, "meta deve ser um número >= 0.");

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        { user_id: userId, year, month, meta, created_by: session.appUser.id },
        { onConflict: "user_id,year,month" },
      )
      .select("user_id, year, month, meta");

    if (error) {
      // A trigger de papel devolve mensagem em PT (ex.: user_id não é gestor) —
      // repassa como 400 amigável.
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await writeAuditLog(
      `Ajustou meta do gestor ${userId} (${year}-${String(month).padStart(2, "0")}) = ${meta}`,
      { user_id: userId, year, month, meta },
      session.appUser.email,
    );
    return NextResponse.json({ ok: true, row: data?.[0] });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}
