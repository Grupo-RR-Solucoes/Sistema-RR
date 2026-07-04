import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAnon } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CompanyRow = {
  id: string;
  name: string;
  legal_name?: string | null;
  cnpj: string;
  group_name?: string | null;
  group_code?: string | null;
  active?: boolean | null;
};

type IdentifierRow = {
  id: string;
  company_id: string;
  mci?: string | null;
  coban_code?: string | null;
  identifier_type?: string | null;
  active?: boolean | null;
};

type PromoterRow = {
  id: string;
  company_id?: string | null;
  name: string;
  status?: string | null;
  active?: boolean | null;
  is_master?: boolean | null;
  hired_at?: string | null;
  dismissed_at?: string | null;
  notes?: string | null;
  estado?: string | null;
  estado_confirmado?: boolean | null;
};

// Estado gerencial valido (espelha o CHECK da migration 20260704_000001). Defesa
// server-side: qualquer coisa fora de AL/SE/PE/BA vira null ("nao classificado").
const ESTADOS_VALIDOS = new Set(["AL", "SE", "PE", "BA"]);
function normalizeEstado(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return ESTADOS_VALIDOS.has(s) ? s : null;
}

type JKeyRow = {
  id: string;
  company_id?: string | null;
  promoter_id?: string | null;
  j_key: string;
  key_type?: string | null;
  active?: boolean | null;
  display_name?: string | null;
};

async function fetchAllRows<T>(queryFactory: () => any) {
  const pageSize = 1000;
  let from = 0;
  const rows: T[] = [];

  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const currentRows = (data || []) as T[];
    rows.push(...currentRows);

    if (currentRows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

// audit_logs RLS bloqueia INSERT via PostgREST para todos os roles
// (Dia 3 grupo G). writeAudit usa service_role para escrever, idem
// pattern Dia 4.1 (/api/admin/usuarios). createdBy recebe o email do
// usuario autenticado vindo do guard (T5 do mapa de decisoes).
async function writeAudit(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    await supabaseAdmin.from("audit_logs").insert({
      entity_name: "cadastros",
      action: "MANUAL_CHANGE",
      description,
      payload,
      created_by: createdBy,
    });
  } catch {
    // Nao interrompe o fluxo principal se a trilha falhar.
  }
}

export async function GET() {
  try {
    const { supabase } = await withSocioOrFuncionarioAnon();

    const [companies, identifiers, promoters, jKeys] = await Promise.all([
      fetchAllRows<CompanyRow>(() =>
        supabase
          .from("companies")
          .select("id, name, legal_name, cnpj, group_name, group_code, active")
          .order("name", { ascending: true })
      ),
      fetchAllRows<IdentifierRow>(() =>
        supabase
          .from("company_identifiers")
          .select("id, company_id, mci, coban_code, identifier_type, active")
          .order("created_at", { ascending: false })
      ),
      fetchAllRows<PromoterRow>(() =>
        supabase
          .from("promoters")
          .select("id, company_id, name, status, active, is_master, hired_at, dismissed_at, notes, estado, estado_confirmado")
          .order("name", { ascending: true })
      ),
      fetchAllRows<JKeyRow>(() =>
        supabase
          .from("j_keys")
          .select("id, company_id, promoter_id, j_key, key_type, active, display_name")
          .order("j_key", { ascending: true })
      ),
    ]);

    const companyById = new Map(companies.map((company) => [company.id, company]));
    const promoterById = new Map(promoters.map((promoter) => [promoter.id, promoter]));

    const payload = {
      summary: {
        companies: companies.length,
        activeCompanies: companies.filter((company) => company.active !== false).length,
        promoters: promoters.length,
        // Disc.12: KPI conta promotores reais (pessoa-fisica) — exclui
        // chaves master operacionais (is_master=true). Master continua
        // ativa por necessidade do importador (fluxo MASTER_REASSIGNED).
        activePromoters: promoters.filter(
          (promoter) => promoter.active !== false && promoter.is_master !== true
        ).length,
        jKeys: jKeys.length,
        activeJKeys: jKeys.filter((jKey) => jKey.active !== false).length,
        masterKeys: jKeys.filter((jKey) => jKey.key_type === "MASTER").length,
        identifiers: identifiers.length,
      },
      companies: companies.map((company) => ({
        ...company,
        identifiers: identifiers.filter((identifier) => identifier.company_id === company.id),
        promoters_count: promoters.filter((promoter) => promoter.company_id === company.id).length,
        active_promoters_count: promoters.filter(
          (promoter) => promoter.company_id === company.id && promoter.active !== false
        ).length,
      })),
      promoters: promoters.map((promoter) => ({
        ...promoter,
        company_name: companyById.get(promoter.company_id || "")?.name || "-",
        company_cnpj: companyById.get(promoter.company_id || "")?.cnpj || "",
        keys: jKeys.filter((jKey) => jKey.promoter_id === promoter.id),
      })),
      jKeys: jKeys.map((jKey) => ({
        ...jKey,
        company_name: companyById.get(jKey.company_id || "")?.name || "-",
        promoter_name: promoterById.get(jKey.promoter_id || "")?.name || "",
      })),
    };

    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();
    const auditActor = user.session.appUser.email;

    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "company_upsert") {
      const id = body.id ? String(body.id) : null;
      const name = String(body.name || "").trim();
      const cnpj = String(body.cnpj || "").replace(/\D/g, "");

      if (!name || !cnpj) {
        return NextResponse.json(
          { error: "Informe nome e CNPJ da empresa." },
          { status: 400 }
        );
      }

      if (id) {
        const { error } = await supabase
          .from("companies")
          .update({
            name,
            legal_name: body.legalName || null,
            cnpj,
            group_name: body.groupName || null,
            group_code: body.groupCode || null,
            active: body.active !== false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);

        if (error) throw error;

        await writeAudit("Atualizacao manual de empresa", { company_id: id, cnpj }, auditActor);
        return NextResponse.json({ success: true, id, updated: true });
      }

      const { data, error } = await supabase
        .from("companies")
        .insert({
          name,
          legal_name: body.legalName || null,
          cnpj,
          group_name: body.groupName || null,
          group_code: body.groupCode || null,
          active: body.active !== false,
        })
        .select("id")
        .single();

      if (error) throw error;

      await writeAudit("Criacao manual de empresa", { company_id: data.id, cnpj }, auditActor);
      return NextResponse.json({ success: true, id: data.id, updated: false });
    }

    if (action === "identifier_upsert") {
      const id = body.id ? String(body.id) : null;
      const companyId = String(body.companyId || "");
      const mci = body.mci ? String(body.mci).trim() : null;
      const cobanCode = body.cobanCode ? String(body.cobanCode).trim() : null;
      const identifierType = String(body.identifierType || "PRIMARY").toUpperCase();

      if (!companyId || (!mci && !cobanCode)) {
        return NextResponse.json(
          { error: "Informe empresa e pelo menos um identificador." },
          { status: 400 }
        );
      }

      if (id) {
        const { error } = await supabase
          .from("company_identifiers")
          .update({
            company_id: companyId,
            mci,
            coban_code: cobanCode,
            identifier_type: identifierType,
            active: body.active !== false,
          })
          .eq("id", id);

        if (error) throw error;

        await writeAudit(
          "Atualizacao manual de identificador",
          { identifier_id: id, company_id: companyId },
          auditActor
        );
        return NextResponse.json({ success: true, id, updated: true });
      }

      const { data, error } = await supabase
        .from("company_identifiers")
        .insert({
          company_id: companyId,
          mci,
          coban_code: cobanCode,
          identifier_type: identifierType,
          active: body.active !== false,
        })
        .select("id")
        .single();

      if (error) throw error;

      await writeAudit(
        "Criacao manual de identificador",
        { identifier_id: data.id, company_id: companyId },
        auditActor
      );
      return NextResponse.json({ success: true, id: data.id, updated: false });
    }

    if (action === "promoter_upsert") {
      const id = body.id ? String(body.id) : null;
      const companyId = body.companyId ? String(body.companyId) : null;
      const name = String(body.name || "").trim();
      const status = String(body.status || "ACTIVE").toUpperCase();

      if (!name) {
        return NextResponse.json(
          { error: "Informe o nome do promotor." },
          { status: 400 }
        );
      }

      const payload: Record<string, unknown> = {
        company_id: companyId,
        name,
        status,
        active: body.active !== false,
        // Disc.16 — expoe is_master no upsert (a UI agora tem o toggle Master).
        // Default false; o KPI "Promotores ativos" continua excluindo master.
        is_master: body.isMaster === true,
        hired_at: body.hiredAt || null,
        dismissed_at: body.dismissedAt || null,
        notes: body.notes || null,
        updated_at: new Date().toISOString(),
      };
      // Estado gerencial: o form lateral (novo/edicao) envia `estado`. Save via form
      // e deliberado -> confirma (estado_confirmado=true). Se `estado` nao vier no
      // body (chamador que nao mexe em estado), as colunas ficam INTOCADAS. A
      // varredura inline dos 62 usa a action dedicada `promoter_estado_upsert`.
      if (body.estado !== undefined) {
        payload.estado = normalizeEstado(body.estado);
        payload.estado_confirmado = true;
      }

      if (id) {
        const { error } = await supabase
          .from("promoters")
          .update(payload)
          .eq("id", id);

        if (error) throw error;

        await writeAudit(
          "Atualizacao manual de promotor",
          { promoter_id: id, company_id: companyId, status },
          auditActor
        );
        return NextResponse.json({ success: true, id, updated: true });
      }

      const { data, error } = await supabase
        .from("promoters")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw error;

      await writeAudit(
        "Criacao manual de promotor",
        { promoter_id: data.id, company_id: companyId, status },
        auditActor
      );
      return NextResponse.json({ success: true, id: data.id, updated: false });
    }

    // Edicao INLINE do estado gerencial (varredura dos 62). Atualiza SO estado +
    // estado_confirmado (nao toca nome/empresa/etc. -> sem risco de clobber de campo
    // stale). estado_confirmado=true porque editar inline e o ato de confirmar.
    if (action === "promoter_estado_upsert") {
      const id = body.id ? String(body.id) : null;
      if (!id) {
        return NextResponse.json({ error: "Informe o promotor." }, { status: 400 });
      }
      const estado = normalizeEstado(body.estado);
      const { error } = await supabase
        .from("promoters")
        .update({ estado, estado_confirmado: true, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;

      await writeAudit(
        "Atualizacao de estado gerencial de promotor",
        { promoter_id: id, estado },
        auditActor
      );
      return NextResponse.json({ success: true });
    }

    // Confirmacao em LOTE: SO flipa estado_confirmado=true nos ids dados. NAO altera
    // nenhum valor de estado. A UI so passa os ids visiveis/filtrados nao-confirmados.
    if (action === "promoter_estado_confirmar_lote") {
      const ids = Array.isArray(body.ids)
        ? body.ids.map((x: unknown) => String(x)).filter(Boolean)
        : [];
      if (ids.length === 0) {
        return NextResponse.json({ error: "Nenhum promotor selecionado." }, { status: 400 });
      }
      const { error } = await supabase
        .from("promoters")
        .update({ estado_confirmado: true, updated_at: new Date().toISOString() })
        .in("id", ids);

      if (error) throw error;

      await writeAudit(
        "Confirmacao em lote de estado gerencial",
        { promoter_ids: ids, total: ids.length },
        auditActor
      );
      return NextResponse.json({ success: true, total: ids.length });
    }

    if (action === "jkey_upsert") {
      const id = body.id ? String(body.id) : null;
      const companyId = body.companyId ? String(body.companyId) : null;
      const promoterId = body.promoterId ? String(body.promoterId) : null;
      const jKey = String(body.jKey || "").trim();
      const keyType = String(body.keyType || "INDIVIDUAL").toUpperCase();

      if (!jKey) {
        return NextResponse.json(
          { error: "Informe a Chave J." },
          { status: 400 }
        );
      }

      const payload = {
        company_id: companyId,
        promoter_id: promoterId,
        j_key: jKey,
        key_type: keyType,
        display_name: body.displayName || null,
        active: body.active !== false,
        updated_at: new Date().toISOString(),
      };

      if (id) {
        const { error } = await supabase
          .from("j_keys")
          .update(payload)
          .eq("id", id);

        if (error) throw error;

        await writeAudit(
          "Atualizacao manual de Chave J",
          { j_key_id: id, company_id: companyId, promoter_id: promoterId },
          auditActor
        );
        return NextResponse.json({ success: true, id, updated: true });
      }

      const { data, error } = await supabase
        .from("j_keys")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw error;

      await writeAudit(
        "Criacao manual de Chave J",
        { j_key_id: data.id, company_id: companyId, promoter_id: promoterId },
        auditActor
      );
      return NextResponse.json({ success: true, id: data.id, updated: false });
    }

    if (action === "toggle_company") {
      const id = String(body.id || "");
      const active = Boolean(body.active);

      if (!id) {
        return NextResponse.json({ error: "Informe a empresa." }, { status: 400 });
      }

      const { error } = await supabase
        .from("companies")
        .update({
          active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;

      await writeAudit(
        "Alteracao de status de empresa",
        { company_id: id, active },
        auditActor
      );
      return NextResponse.json({ success: true });
    }

    if (action === "toggle_promoter") {
      const id = String(body.id || "");
      const active = Boolean(body.active);

      if (!id) {
        return NextResponse.json({ error: "Informe o promotor." }, { status: 400 });
      }

      const { error } = await supabase
        .from("promoters")
        .update({
          active,
          status: active ? "ACTIVE" : "DISMISSED",
          dismissed_at: active ? null : body.dismissedAt || new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;

      await writeAudit(
        "Alteracao de status de promotor",
        { promoter_id: id, active },
        auditActor
      );
      return NextResponse.json({ success: true });
    }

    if (action === "toggle_jkey") {
      const id = String(body.id || "");
      const active = Boolean(body.active);

      if (!id) {
        return NextResponse.json({ error: "Informe a Chave J." }, { status: 400 });
      }

      const { error } = await supabase
        .from("j_keys")
        .update({
          active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;

      await writeAudit(
        "Alteracao de status de Chave J",
        { j_key_id: id, active },
        auditActor
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
