import fs from "node:fs/promises";
import path from "node:path";

import {
  buildHistoricalClosingCoverage,
  groupHistoricalClosingCandidates,
  scanHistoricalClosingCandidates,
  selectOfficialHistoricalClosingFiles,
} from "@/lib/historicalClosingFiles";
import { resolveKnownCompanyIdentity } from "@/lib/knownCompanies";
import { importMonthlyClosingWorkbook } from "@/lib/monthlyClosingImport";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinRange(
  year: number,
  month: number,
  filters: {
    yearFrom?: number | null;
    monthFrom?: number | null;
    yearTo?: number | null;
    monthTo?: number | null;
  }
) {
  const current = year * 100 + month;
  const lower =
    filters.yearFrom && filters.monthFrom
      ? filters.yearFrom * 100 + filters.monthFrom
      : null;
  const upper =
    filters.yearTo && filters.monthTo ? filters.yearTo * 100 + filters.monthTo : null;

  if (lower && current < lower) {
    return false;
  }

  if (upper && current > upper) {
    return false;
  }

  return true;
}

function hasMeaningfulClosingPayload(payload: {
  processedEntries?: number;
  totals?: Record<string, unknown>;
}) {
  if ((payload.processedEntries || 0) > 0) {
    return true;
  }

  const totals = payload.totals || {};
  return Object.values(totals).some((value) => Number(value || 0) !== 0);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedCnpjs = Array.isArray(body.cnpjs)
      ? body.cnpjs.map((value: unknown) => String(value).replace(/\D/g, ""))
      : [];

    const filters = {
      yearFrom: toNumber(body.yearFrom),
      monthFrom: toNumber(body.monthFrom),
      yearTo: toNumber(body.yearTo),
      monthTo: toNumber(body.monthTo),
    };
    const execute = Boolean(body.execute);

    const candidates = await scanHistoricalClosingCandidates();
    let groupedCandidates = groupHistoricalClosingCandidates(candidates);
    let officialFiles = selectOfficialHistoricalClosingFiles(candidates);

    if (requestedCnpjs.length > 0) {
      const allowed = new Set(requestedCnpjs);
      officialFiles = officialFiles.filter((file) => allowed.has(file.companyCnpj));
      groupedCandidates = new Map(
        Array.from(groupedCandidates.entries()).filter(([key]) =>
          allowed.has(String(key).split(":")[0])
        )
      );
    }

    officialFiles = officialFiles.filter((file) =>
      isWithinRange(file.year, file.month, filters)
    );
    groupedCandidates = new Map(
      Array.from(groupedCandidates.entries()).filter(([, bucket]) =>
        bucket.some((file) => isWithinRange(file.year, file.month, filters))
      )
    );

    const coverage = buildHistoricalClosingCoverage(officialFiles);

    if (!execute) {
      return Response.json({
        success: true,
        execute: false,
        filesFound: officialFiles.length,
        coverage,
        files: officialFiles.map((file) => ({
          companyCnpj: file.companyCnpj,
          year: file.year,
          month: file.month,
          fileName: file.fileName,
          fullPath: file.fullPath,
          lastWriteTime: file.lastWriteTime,
        })),
      });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const companies = await supabaseAdmin
      .from("companies")
      .select("id, name, cnpj")
      .order("name", { ascending: true });

    if (companies.error) {
      throw new Error(companies.error.message);
    }

    const companyIdByCnpj = new Map<string, string>(
      (companies.data || []).map((company) => [
        String(company.cnpj || "").replace(/\D/g, ""),
        String(company.id),
      ])
    );

    const identifiers = await supabaseAdmin
      .from("company_identifiers")
      .select("company_id, mci, coban_code")
      .eq("active", true);

    if (identifiers.error) {
      throw new Error(identifiers.error.message);
    }

    const companyIdByMci = new Map<string, string>();
    const companyIdByCoban = new Map<string, string>();

    for (const identifier of identifiers.data || []) {
      const companyId = String(identifier.company_id || "");
      const mci = String(identifier.mci || "").replace(/\D/g, "");
      const coban = String(identifier.coban_code || "").replace(/\D/g, "");

      if (mci) {
        companyIdByMci.set(mci, companyId);
      }

      if (coban) {
        companyIdByCoban.set(coban, companyId);
      }
    }

    const imported: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];

    for (const file of officialFiles) {
      const periodKey = `${file.companyCnpj}:${String(file.year).padStart(4, "0")}-${String(
        file.month
      ).padStart(2, "0")}`;
      const bucket = groupedCandidates.get(periodKey) || [file];
      const knownIdentity = resolveKnownCompanyIdentity({ cnpj: file.companyCnpj });
      const companyId =
        companyIdByCnpj.get(file.companyCnpj) ||
        (knownIdentity?.mci ? companyIdByMci.get(knownIdentity.mci) : undefined) ||
        (knownIdentity?.coban ? companyIdByCoban.get(knownIdentity.coban) : undefined);

      if (!companyId) {
        errors.push({
          companyCnpj: file.companyCnpj,
          year: file.year,
          month: file.month,
          fileName: file.fileName,
          error: "Empresa nao encontrada na tabela companies.",
        });
        continue;
      }

      let importedPayload: Record<string, unknown> | null = null;
      let importedFileName = file.fileName;
      let lastError = "";

      for (const candidate of bucket) {
        try {
          const buffer = await fs.readFile(candidate.fullPath);
          const payload = await importMonthlyClosingWorkbook({
            fileBase64: buffer.toString("base64"),
            fileName: path.basename(candidate.fullPath),
            year: candidate.year,
            month: candidate.month,
            companyId,
          });

          if (hasMeaningfulClosingPayload(payload) || candidate === bucket[bucket.length - 1]) {
            importedPayload = payload as unknown as Record<string, unknown>;
            importedFileName = candidate.fileName;
            break;
          }
        } catch (error: any) {
          lastError = error?.message || "Falha ao importar fechamento historico.";
        }
      }

      if (importedPayload) {
        imported.push({
          companyCnpj: file.companyCnpj,
          year: file.year,
          month: file.month,
          fileName: importedFileName,
          totals: importedPayload.totals,
          processedEntries: importedPayload.processedEntries,
        });
        continue;
      }

      errors.push({
        companyCnpj: file.companyCnpj,
        year: file.year,
        month: file.month,
        fileName: file.fileName,
        error: lastError || "Falha ao importar fechamento historico.",
      });
    }

    return Response.json({
      success: errors.length === 0,
      execute: true,
      filesFound: officialFiles.length,
      importedCount: imported.length,
      errorsCount: errors.length,
      coverage,
      imported,
      errors,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao importar historico de fechamentos." },
      { status: 500 }
    );
  }
}
