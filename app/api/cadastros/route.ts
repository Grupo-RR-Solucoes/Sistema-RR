import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { clearMemoryCache, withMemoryCache } from "@/lib/memoryCache";

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
  hired_at?: string | null;
  dismissed_at?: string | null;
  notes?: string | null;
};

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

async function writeAudit(description: string, payload: Record<string, unknown>) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    await supabaseAdmin.from("audit_logs").insert({
      entity_name: "cadastros",
      action: "MANUAL_CHANGE",
      description,
      payload,
      created_by: "sistema",
    });
  } catch {
    // Nao interrompe o fluxo principal se a trilha falhar.
  }
}

export async function GET() {
  try {
    const payload = await withMemoryCache("route:cadastros", 20_000, async () => {
      const supabaseAdmin = getSupabaseAdmin();

      const [companies, identifiers, promoters, jKeys] = await Promise.all([
        fetchAllRows<CompanyRow>(() =>
          supabaseAdmin
            .from("companies")
            .select("id, name, legal_name, cnpj, group_name, group_code, active")
            .order("name", { ascending: true })
        ),
        fetchAllRows<IdentifierRow>(() =>
          supabaseAdmin
            .from("company_identifiers")
            .select("id, company_id, mci, coban_code, identifier_type, active")
            .order("created_at", { ascending: false })
        ),
        fetchAllRows<PromoterRow>(() =>
          supabaseAdmin
            .from("promoters")
            .select("id, company_id, name, status, active, hired_at, dismissed_at, notes")
            .order("name", { ascending: true })
        ),
        fetchAllRows<JKeyRow>(() =>
          supabaseAdmin
            .from("j_keys")
            .select("id, company_id, promoter_id, j_key, key_type, active, display_name")
            .order("j_key", { ascending: true })
        ),
      ]);

      const companyById = new Map(companies.map((company) => [company.id, company]));
      const promoterById = new Map(promoters.map((promoter) => [promoter.id, promoter]));

      return {
        summary: {
          companies: companies.length,
          activeCompanies: companies.filter((company) => company.active !== false).length,
          promoters: promoters.length,
          activePromoters: promoters.filter((promoter) => promoter.active !== false).length,
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
    });

    return Response.json(payload);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao carregar cadastros." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const supabaseAdmin = getSupabaseAdmin();

    if (action === "company_upsert") {
      const id = body.id ? String(body.id) : null;
      const name = String(body.name || "").trim();
      const cnpj = String(body.cnpj || "").replace(/\D/g, "");

      if (!name || !cnpj) {
        return Response.json(
          { error: "Informe nome e CNPJ da empresa." },
          { status: 400 }
        );
      }

      if (id) {
        const { error } = await supabaseAdmin
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

        clearMemoryCache("route:cadastros");
        await writeAudit("Atualizacao manual de empresa", { company_id: id, cnpj });
        return Response.json({ success: true, id, updated: true });
      }

      const { data, error } = await supabaseAdmin
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

      clearMemoryCache("route:cadastros");
      await writeAudit("Criacao manual de empresa", { company_id: data.id, cnpj });
      return Response.json({ success: true, id: data.id, updated: false });
    }

    if (action === "identifier_upsert") {
      const id = body.id ? String(body.id) : null;
      const companyId = String(body.companyId || "");
      const mci = body.mci ? String(body.mci).trim() : null;
      const cobanCode = body.cobanCode ? String(body.cobanCode).trim() : null;
      const identifierType = String(body.identifierType || "PRIMARY").toUpperCase();

      if (!companyId || (!mci && !cobanCode)) {
        return Response.json(
          { error: "Informe empresa e pelo menos um identificador." },
          { status: 400 }
        );
      }

      if (id) {
        const { error } = await supabaseAdmin
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

        clearMemoryCache("route:cadastros");
        await writeAudit("Atualizacao manual de identificador", {
          identifier_id: id,
          company_id: companyId,
        });
        return Response.json({ success: true, id, updated: true });
      }

      const { data, error } = await supabaseAdmin
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

      clearMemoryCache("route:cadastros");
      await writeAudit("Criacao manual de identificador", {
        identifier_id: data.id,
        company_id: companyId,
      });
      return Response.json({ success: true, id: data.id, updated: false });
    }

    if (action === "promoter_upsert") {
      const id = body.id ? String(body.id) : null;
      const companyId = body.companyId ? String(body.companyId) : null;
      const name = String(body.name || "").trim();
      const status = String(body.status || "ACTIVE").toUpperCase();

      if (!name) {
        return Response.json(
          { error: "Informe o nome do promotor." },
          { status: 400 }
        );
      }

      const payload = {
        company_id: companyId,
        name,
        status,
        active: body.active !== false,
        hired_at: body.hiredAt || null,
        dismissed_at: body.dismissedAt || null,
        notes: body.notes || null,
        updated_at: new Date().toISOString(),
      };

      if (id) {
        const { error } = await supabaseAdmin
          .from("promoters")
          .update(payload)
          .eq("id", id);

        if (error) throw error;

        clearMemoryCache("route:cadastros");
        await writeAudit("Atualizacao manual de promotor", {
          promoter_id: id,
          company_id: companyId,
          status,
        });
        return Response.json({ success: true, id, updated: true });
      }

      const { data, error } = await supabaseAdmin
        .from("promoters")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw error;

      clearMemoryCache("route:cadastros");
      await writeAudit("Criacao manual de promotor", {
        promoter_id: data.id,
        company_id: companyId,
        status,
      });
      return Response.json({ success: true, id: data.id, updated: false });
    }

    if (action === "jkey_upsert") {
      const id = body.id ? String(body.id) : null;
      const companyId = body.companyId ? String(body.companyId) : null;
      const promoterId = body.promoterId ? String(body.promoterId) : null;
      const jKey = String(body.jKey || "").trim();
      const keyType = String(body.keyType || "INDIVIDUAL").toUpperCase();

      if (!jKey) {
        return Response.json(
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
        const { error } = await supabaseAdmin
          .from("j_keys")
          .update(payload)
          .eq("id", id);

        if (error) throw error;

        clearMemoryCache("route:cadastros");
        await writeAudit("Atualizacao manual de Chave J", {
          j_key_id: id,
          company_id: companyId,
          promoter_id: promoterId,
        });
        return Response.json({ success: true, id, updated: true });
      }

      const { data, error } = await supabaseAdmin
        .from("j_keys")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw error;

      clearMemoryCache("route:cadastros");
      await writeAudit("Criacao manual de Chave J", {
        j_key_id: data.id,
        company_id: companyId,
        promoter_id: promoterId,
      });
      return Response.json({ success: true, id: data.id, updated: false });
    }

    if (action === "toggle_company") {
      const id = String(body.id || "");
      const active = Boolean(body.active);

      if (!id) {
        return Response.json({ error: "Informe a empresa." }, { status: 400 });
      }

      const { error } = await supabaseAdmin
        .from("companies")
        .update({
          active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;

      clearMemoryCache("route:cadastros");
      await writeAudit("Alteracao de status de empresa", { company_id: id, active });
      return Response.json({ success: true });
    }

    if (action === "toggle_promoter") {
      const id = String(body.id || "");
      const active = Boolean(body.active);

      if (!id) {
        return Response.json({ error: "Informe o promotor." }, { status: 400 });
      }

      const { error } = await supabaseAdmin
        .from("promoters")
        .update({
          active,
          status: active ? "ACTIVE" : "DISMISSED",
          dismissed_at: active ? null : body.dismissedAt || new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;

      clearMemoryCache("route:cadastros");
      await writeAudit("Alteracao de status de promotor", { promoter_id: id, active });
      return Response.json({ success: true });
    }

    if (action === "toggle_jkey") {
      const id = String(body.id || "");
      const active = Boolean(body.active);

      if (!id) {
        return Response.json({ error: "Informe a Chave J." }, { status: 400 });
      }

      const { error } = await supabaseAdmin
        .from("j_keys")
        .update({
          active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;

      clearMemoryCache("route:cadastros");
      await writeAudit("Alteracao de status de Chave J", { j_key_id: id, active });
      return Response.json({ success: true });
    }

    return Response.json({ error: "Acao invalida." }, { status: 400 });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao salvar cadastro." },
      { status: 500 }
    );
  }
}
