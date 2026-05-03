import * as XLSX from "xlsx";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CompanyRow = {
  id: string;
  name: string;
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

type DailyUsage = {
  companyId?: string | null;
  count: number;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizeJKey(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeName(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function pickField(row: Record<string, unknown>, aliases: string[]) {
  const wanted = aliases.map((alias) => normalizeText(alias));

  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (wanted.includes(normalizeText(key))) {
      return value;
    }
  }

  return null;
}

async function fetchAllRows<T>(queryFactory: () => any) {
  const rows: T[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const current = (data || []) as T[];
    rows.push(...current);

    if (current.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

function buildPlaceholderCompanyName(mci?: string | null, coban?: string | null) {
  if (mci && coban) {
    return `Operacao MCI ${mci} / Coban ${coban}`;
  }

  if (mci) {
    return `Operacao MCI ${mci}`;
  }

  if (coban) {
    return `Operacao Coban ${coban}`;
  }

  return "Operacao sem identificador";
}

function buildPlaceholderCompanyCnpj(mci?: string | null, coban?: string | null) {
  return `TEMP-${mci || "SEM-MCI"}-${coban || "SEM-COBAN"}`;
}

function getPreferredCompanyId(usageMap?: Map<string, DailyUsage>) {
  if (!usageMap || usageMap.size === 0) {
    return null;
  }

  return Array.from(usageMap.entries()).sort((left, right) => right[1].count - left[1].count)[0]?.[0] || null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const keysFile = body.keysFile ? String(body.keysFile) : "";
    const dailyFile = body.dailyFile ? String(body.dailyFile) : "";

    if (!keysFile && !dailyFile) {
      return Response.json(
        { error: "Envie a planilha de Chaves J ou a planilha diaria de referencia." },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const [companies, identifiers, promoters, jKeys] = await Promise.all([
      fetchAllRows<CompanyRow>(() =>
        supabaseAdmin
          .from("companies")
          .select("id, name, cnpj, group_name, group_code, active")
          .order("name", { ascending: true })
      ),
      fetchAllRows<IdentifierRow>(() =>
        supabaseAdmin
          .from("company_identifiers")
          .select("id, company_id, mci, coban_code, identifier_type, active")
          .order("created_at", { ascending: true })
      ),
      fetchAllRows<PromoterRow>(() =>
        supabaseAdmin
          .from("promoters")
          .select("id, company_id, name, status, active")
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
    const identifierByMci = new Map(
      identifiers
        .filter((identifier) => identifier.mci)
        .map((identifier) => [String(identifier.mci).trim(), identifier])
    );
    const identifierByCoban = new Map(
      identifiers
        .filter((identifier) => identifier.coban_code)
        .map((identifier) => [String(identifier.coban_code).trim(), identifier])
    );
    const promoterByNormalizedName = new Map<string, PromoterRow[]>();

    for (const promoter of promoters) {
      const normalized = normalizeName(promoter.name);
      promoterByNormalizedName.set(normalized, [
        ...(promoterByNormalizedName.get(normalized) || []),
        promoter,
      ]);
    }

    const jKeyByValue = new Map(
      jKeys.map((jKey) => [normalizeJKey(jKey.j_key), jKey])
    );

    const summary = {
      companiesCreated: 0,
      identifiersCreated: 0,
      promotersCreated: 0,
      promotersUpdated: 0,
      jKeysCreated: 0,
      jKeysUpdated: 0,
      masterKeysCreated: 0,
      dailyReferenceRows: 0,
      linkedKeysFromDaily: 0,
      ambiguousKeys: 0,
    };

    const dailyUsageByKey = new Map<string, Map<string, DailyUsage>>();
    const importedKeyValues = new Set<string>();

    async function ensureCompanyFromIdentifiers(mci?: string | null, coban?: string | null) {
      const normalizedMci = mci ? String(mci).trim() : "";
      const normalizedCoban = coban ? String(coban).trim() : "";

      let companyId =
        (normalizedMci && identifierByMci.get(normalizedMci)?.company_id) ||
        (normalizedCoban && identifierByCoban.get(normalizedCoban)?.company_id) ||
        null;

      if (!companyId) {
        const { data, error } = await supabaseAdmin
          .from("companies")
          .insert({
            name: buildPlaceholderCompanyName(normalizedMci || null, normalizedCoban || null),
            legal_name: null,
            cnpj: buildPlaceholderCompanyCnpj(normalizedMci || null, normalizedCoban || null),
            group_name: "Grupo RR",
            group_code: null,
            active: true,
          })
          .select("id, name, cnpj, group_name, group_code, active")
          .single();

        if (error || !data) {
          throw new Error(error?.message || "Nao foi possivel criar a empresa operacional.");
        }

        companyId = data.id;
        companyById.set(data.id, data);
        summary.companiesCreated += 1;
      }

      async function createIdentifierIfMissing() {
        const hasMci =
          !normalizedMci ||
          (identifierByMci.has(normalizedMci) &&
            identifierByMci.get(normalizedMci)?.company_id === companyId);
        const hasCoban =
          !normalizedCoban ||
          (identifierByCoban.has(normalizedCoban) &&
            identifierByCoban.get(normalizedCoban)?.company_id === companyId);

        if (hasMci && hasCoban) {
          return;
        }

        const { data, error } = await supabaseAdmin
          .from("company_identifiers")
          .insert({
            company_id: companyId,
            mci: normalizedMci || null,
            coban_code: normalizedCoban || null,
            identifier_type: "PRIMARY",
            active: true,
          })
          .select("id, company_id, mci, coban_code, identifier_type, active")
          .single();

        if (error || !data) {
          throw new Error(error?.message || "Nao foi possivel salvar o identificador.");
        }

        if (data.mci) {
          identifierByMci.set(String(data.mci).trim(), data);
        }

        if (data.coban_code) {
          identifierByCoban.set(String(data.coban_code).trim(), data);
        }

        summary.identifiersCreated += 1;
      }

      if (normalizedMci || normalizedCoban) {
        await createIdentifierIfMissing();
      }

      return companyId;
    }

    async function ensurePromoter(name: string, companyId?: string | null) {
      const normalized = normalizeName(name);
      const candidates = promoterByNormalizedName.get(normalized) || [];
      const matching =
        candidates.find((candidate) => candidate.company_id === companyId) ||
        candidates.find((candidate) => !candidate.company_id) ||
        candidates[0];

      if (matching) {
        if (companyId && matching.company_id !== companyId) {
          const { error } = await supabaseAdmin
            .from("promoters")
            .update({
              company_id: companyId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", matching.id);

          if (error) {
            throw new Error(error.message);
          }

          matching.company_id = companyId;
          summary.promotersUpdated += 1;
        }

        return matching;
      }

      const { data, error } = await supabaseAdmin
        .from("promoters")
        .insert({
          company_id: companyId || null,
          name: name.trim(),
          status: "ACTIVE",
          active: true,
          updated_at: new Date().toISOString(),
        })
        .select("id, company_id, name, status, active")
        .single();

      if (error || !data) {
        throw new Error(error?.message || "Nao foi possivel criar o promotor.");
      }

      promoterByNormalizedName.set(normalized, [...candidates, data]);
      summary.promotersCreated += 1;
      return data;
    }

    async function upsertJKey(input: {
      jKey: string;
      companyId?: string | null;
      promoterId?: string | null;
      keyType: "INDIVIDUAL" | "MASTER";
      displayName?: string | null;
    }) {
      const normalized = normalizeJKey(input.jKey);
      const existing = jKeyByValue.get(normalized);

      const payload = {
        company_id: input.companyId || null,
        promoter_id: input.promoterId || null,
        j_key: normalized,
        key_type: input.keyType,
        display_name: input.displayName || null,
        active: true,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const shouldUpdate =
          existing.company_id !== payload.company_id ||
          existing.promoter_id !== payload.promoter_id ||
          String(existing.key_type || "").toUpperCase() !== payload.key_type ||
          String(existing.display_name || "") !== String(payload.display_name || "") ||
          existing.active === false;

        if (shouldUpdate) {
          const { error } = await supabaseAdmin
            .from("j_keys")
            .update(payload)
            .eq("id", existing.id);

          if (error) {
            throw new Error(error.message);
          }

          existing.company_id = payload.company_id;
          existing.promoter_id = payload.promoter_id;
          existing.key_type = payload.key_type;
          existing.display_name = payload.display_name;
          existing.active = true;
          summary.jKeysUpdated += 1;
        }

        return existing;
      }

      const { data, error } = await supabaseAdmin
        .from("j_keys")
        .insert(payload)
        .select("id, company_id, promoter_id, j_key, key_type, active, display_name")
        .single();

      if (error || !data) {
        throw new Error(error?.message || "Nao foi possivel salvar a Chave J.");
      }

      jKeyByValue.set(normalized, data);
      summary.jKeysCreated += 1;

      if (payload.key_type === "MASTER") {
        summary.masterKeysCreated += 1;
      }

      return data;
    }

    if (dailyFile) {
      const workbook = XLSX.read(Buffer.from(dailyFile, "base64"), { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      for (const row of rows) {
        const mci = String(pickField(row, ["MCI"]) || "").trim();
        const coban = String(
          pickField(row, ["Cód. Coban", "Cod. Coban", "Codigo Coban", "Código Coban", "Coban"]) || ""
        ).trim();
        const jKey = normalizeJKey(
          pickField(row, ["ChaveJ", "Chave J", "Login", "Usuario", "Usuário"]) || ""
        );

        if (!mci && !coban && !jKey) {
          continue;
        }

        const companyId = await ensureCompanyFromIdentifiers(mci || null, coban || null);
        summary.dailyReferenceRows += 1;

        if (!jKey) {
          continue;
        }

        const usageMap = dailyUsageByKey.get(jKey) || new Map<string, DailyUsage>();
        const current = usageMap.get(companyId || "") || { companyId, count: 0 };
        current.count += 1;
        usageMap.set(companyId || "", current);
        dailyUsageByKey.set(jKey, usageMap);
      }
    }

    if (keysFile) {
      const workbook = XLSX.read(Buffer.from(keysFile, "base64"), { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      for (const row of rows) {
        const jKey = normalizeJKey(pickField(row, ["CHAVE J", "Chave J", "ChaveJ"]) || "");
        const promoterName = String(
          pickField(row, ["PROMOTOR(A)", "PROMOTOR", "Promotor(a)", "Promotor"]) || ""
        ).trim();

        if (!jKey || !promoterName) {
          continue;
        }

        importedKeyValues.add(jKey);

        const usageMap = dailyUsageByKey.get(jKey);
        const preferredCompanyId = getPreferredCompanyId(usageMap);

        if (usageMap && usageMap.size > 1) {
          summary.ambiguousKeys += 1;
        }

        const promoter = await ensurePromoter(promoterName, preferredCompanyId);

        await upsertJKey({
          jKey,
          companyId: preferredCompanyId,
          promoterId: promoter.id,
          keyType: "INDIVIDUAL",
          displayName: promoterName,
        });

        if (preferredCompanyId) {
          summary.linkedKeysFromDaily += 1;
        }
      }
    }

    for (const [jKey, usageMap] of dailyUsageByKey.entries()) {
      if (importedKeyValues.has(jKey)) {
        continue;
      }

      const preferredCompanyId = getPreferredCompanyId(usageMap);
      const existing = jKeyByValue.get(jKey);

      if (existing) {
        if (!existing.company_id && preferredCompanyId) {
          await upsertJKey({
            jKey,
            companyId: preferredCompanyId,
            promoterId: existing.promoter_id || null,
            keyType:
              existing.promoter_id || String(existing.key_type || "").toUpperCase() === "INDIVIDUAL"
                ? "INDIVIDUAL"
                : "MASTER",
            displayName: existing.display_name || null,
          });
          summary.linkedKeysFromDaily += 1;
        }

        continue;
      }

      await upsertJKey({
        jKey,
        companyId: preferredCompanyId,
        promoterId: null,
        keyType: "MASTER",
        displayName: "Chave identificada via diaria",
      });
    }

    try {
      await supabaseAdmin.from("audit_logs").insert({
        entity_name: "cadastros",
        action: "IMPORT_BASE",
        description: "Importacao inteligente de Chaves J e base cadastral",
        payload: {
          keysFileName: body.keysFileName || null,
          dailyFileName: body.dailyFileName || null,
          summary,
        },
        created_by: "sistema",
      });
    } catch {
      // Nao bloqueia o fluxo principal.
    }

    return Response.json({
      success: true,
      summary,
      message:
        "Base cadastral atualizada com sucesso a partir da planilha de Chaves J e da diaria de referencia.",
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao importar base cadastral." },
      { status: 500 }
    );
  }
}
