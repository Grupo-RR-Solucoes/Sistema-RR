import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// FRENTE C — Core do importador de METAS + seed da ESCALA de repasse.
// Lib REAL chamada tanto pela rota POST /api/metas/import quanto pelo
// runner scripts/run_metas_import_maio.cjs (mesma logica, sem duplicar).
//
// Le Alteracoes_de_Metas.xlsx (dois blocos a partir da linha 70):
//   AL: cols A-F   |  PE: cols H-M
//   META | BONUS1 | BONUS2 | PROMOTOR | Valor | FALTA
// So usa META/BONUS1/BONUS2/NOME.
//
// METAS EM VALOR -> UPSERT monthly_targets (meta/meta_1/meta_2), competencia
//   2026-05 = year 2026 / month 5 (fonte unica do motor de comissao).
// ESCALA DE % -> seed promoter_goal_repasse (competencia 2026-05-01).
//
// Mapeia NOME -> promoter_id com matching tolerante (acento, sobrenome extra,
// letra dobrada). NAO cria promoter; NAO silencia: lista os nao mapeados.
// dryRun=true so calcula o relatorio, NAO escreve nada.
// ============================================================

export const METAS_COMPETENCIA = "2026-05-01";
export const METAS_YEAR = 2026;
export const METAS_MONTH = 5;
const DATA_START_ROW_1BASED = 70; // "a partir da linha 70"
const EXCLUDE_TOKEN = "552710"; // excluir esta chave/linha
const PE_CNPJ = "51.457.289/0001-03";

// Escala nomeada (faixa 5,80%). tokens = nome normalizado/sem conectores.
// O matching escolhe a entrada com MAIS tokens contidos no NOME (a mais
// especifica), evitando que "Lilian" (CLT) capture "Erika Lilian".
// SO os promotores NOMEADOS recebem linha em promoter_goal_repasse. Quem
// nao bate aqui NAO recebe escala -> motor cai no acordo atual intacto
// (elimina o risco de PADRAO sobrescrever perfis CLT/fixo/entrante).
const ESCALA_NOMEADA: Array<{
  tokens: string[];
  pct: { pct_base: number; pct_meta1: number; pct_meta2: number };
}> = [
  { tokens: ["adriana", "maria"], pct: { pct_base: 0.6666, pct_meta1: 0.6779, pct_meta2: 0.6996 } },
  { tokens: ["aldalene"], pct: { pct_base: 0.612, pct_meta1: 0.6224, pct_meta2: 0.6327 } },
  { tokens: ["erika", "lilian"], pct: { pct_base: 0.625, pct_meta1: 0.6355, pct_meta2: 0.6465 } },
  { tokens: ["luciana", "matias"], pct: { pct_base: 0.6666, pct_meta1: 0.6779, pct_meta2: 0.6996 } },
  { tokens: ["thaynara"], pct: { pct_base: 0.75, pct_meta1: 0.7627, pct_meta2: 0.7758 } },
  { tokens: ["jarles", "marlon"], pct: { pct_base: 0.625, pct_meta1: 0.6355, pct_meta2: 0.6465 } },
  { tokens: ["jennyfer"], pct: { pct_base: 0.5833, pct_meta1: 0.5932, pct_meta2: 0.6034 } },
  { tokens: ["lilian"], pct: { pct_base: 0.1666, pct_meta1: 0.1695, pct_meta2: 0.1725 } },
  { tokens: ["maria", "fatima"], pct: { pct_base: 0.1666, pct_meta1: 0.1695, pct_meta2: 0.1725 } },
];

// Aliases CONFIRMADOS por Diego (2026-06-04), chaveados por promoter_id FIXO
// (robusto a renomeacao). A planilha trouxe grafias/abreviacoes que o matching
// tolerante nao pega sozinho; aqui forcamos o vinculo de forma deterministica.
//
// PROMOTER_ALIAS: NOME normalizado da planilha -> promoter_id (forca o match).
const PROMOTER_ALIAS: Record<string, string> = {
  // nomeados (escala) — grafia divergente
  "erika liliam": "9286ee24-e1fd-4b4b-b650-5ca322af9279",
  "jeniffer milena": "cb4a0e39-6f82-4071-809f-c381d6439db9",
  "maria de fatima t da costa": "bf872c4a-7288-40f8-b53f-43b79218d643",
  "lilian crislayne": "c8925313-09fb-49c1-b677-e00402181a9a",
  // so-meta — abreviacao/grafia
  "cassia caroline da s soares": "74f8d6ed-8a01-40cb-a2aa-5bfccc21d281",
  "monaliza maria": "0eb9f10e-080b-4fa1-9214-0ac4e5a87c32",
  "clarisse oliveira c de araujo": "db998f96-1482-4a07-8d3f-6e9bb5a3c4f0",
  "mayanne shirlley": "fc2a1884-aa1f-4997-8a78-1a8e020aadd7",
};

// ESCALA por promoter_id (precede o matching por token). So os NOMEADOS que
// erraram a grafia entram aqui; os 4 so-meta NAO recebem escala.
const ESCALA_BY_PROMOTER_ID: Record<
  string,
  { pct_base: number; pct_meta1: number; pct_meta2: number }
> = {
  // Erika Lilian
  "9286ee24-e1fd-4b4b-b650-5ca322af9279": { pct_base: 0.625, pct_meta1: 0.6355, pct_meta2: 0.6465 },
  // Jennyfer
  "cb4a0e39-6f82-4071-809f-c381d6439db9": { pct_base: 0.5833, pct_meta1: 0.5932, pct_meta2: 0.6034 },
  // Maria de Fatima
  "bf872c4a-7288-40f8-b53f-43b79218d643": { pct_base: 0.1666, pct_meta1: 0.1695, pct_meta2: 0.1725 },
  // Lilian (CLT)
  "c8925313-09fb-49c1-b677-e00402181a9a": { pct_base: 0.1666, pct_meta1: 0.1695, pct_meta2: 0.1725 },
};

const CONNECTORS = new Set(["de", "da", "do", "dos", "das", "e", "di", "del"]);

// Colapsa letras consecutivas iguais: "jarlles" -> "jarles" (Jarles 1 L).
function collapseDoubles(token: string): string {
  return token.replace(/(.)\1+/g, "$1");
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameTokens(value: unknown): string[] {
  return normalizeName(value)
    .split(" ")
    .filter((t) => t && !CONNECTORS.has(t))
    .map(collapseDoubles);
}

// Numero em formato BR ("1.234,56") ou simples.
function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Decide o % de escala pela correspondencia mais especifica do NOME.
function resolveEscalaPct(nome: string) {
  const tokens = new Set(nameTokens(nome));
  let best: (typeof ESCALA_NOMEADA)[number] | null = null;
  for (const entry of ESCALA_NOMEADA) {
    const allPresent = entry.tokens.every((t) => tokens.has(t));
    if (!allPresent) continue;
    if (!best || entry.tokens.length > best.tokens.length) best = entry;
  }
  return best ? { pct: best.pct, source: best.tokens.join(" ") } : null;
}

type PromoterRow = { id: string; name: string; company_id: string | null };

type MatchResult =
  | { status: "mapped"; promoter: PromoterRow }
  | { status: "ambiguous"; candidates: PromoterRow[] }
  | { status: "unmatched"; candidates: PromoterRow[] };

// Matching tolerante: exato normalizado, senao subconjunto de tokens em
// qualquer direcao compartilhando o primeiro nome. Prefere candidatos do
// proprio estado (scoped); cai para global se nao achar.
function matchPromoter(
  nome: string,
  scoped: PromoterRow[],
  all: PromoterRow[]
): MatchResult {
  const run = (candidates: PromoterRow[]): MatchResult | null => {
    const exN = normalizeName(nome);
    const exT = nameTokens(nome);
    if (exT.length === 0) return null;
    const exFirst = exT[0];
    const exSet = new Set(exT);

    const exact = candidates.filter((c) => normalizeName(c.name) === exN);
    if (exact.length === 1) return { status: "mapped", promoter: exact[0] };

    const scored = candidates
      .map((c) => {
        const cT = nameTokens(c.name);
        const cSet = new Set(cT);
        const shared = exT.filter((t) => cSet.has(t)).length;
        const exSubset = exT.every((t) => cSet.has(t));
        const cSubset = cT.every((t) => exSet.has(t));
        const firstMatch = cT[0] === exFirst;
        return { c, shared, viable: (exSubset || cSubset) && firstMatch };
      })
      .filter((s) => s.viable && s.shared >= 1)
      .sort((a, b) => b.shared - a.shared);

    if (scored.length === 0) return null;
    const top = scored[0].shared;
    const winners = scored.filter((s) => s.shared === top);
    const distinct = Array.from(new Set(winners.map((w) => w.c.id)));
    if (distinct.length === 1) return { status: "mapped", promoter: winners[0].c };
    return { status: "ambiguous", candidates: winners.map((w) => w.c) };
  };

  const scopedResult = run(scoped);
  if (scopedResult && scopedResult.status === "mapped") return scopedResult;
  const globalResult = run(all);
  if (globalResult) return globalResult;
  if (scopedResult) return scopedResult;

  // Nada: lista candidatos por tokens compartilhados como sugestao.
  const exT = nameTokens(nome);
  const suggestions = all
    .map((c) => {
      const cSet = new Set(nameTokens(c.name));
      return { c, shared: exT.filter((t) => cSet.has(t)).length };
    })
    .filter((s) => s.shared >= 1)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, 5)
    .map((s) => s.c);
  return { status: "unmatched", candidates: suggestions };
}

type ParsedRow = {
  block: "AL" | "PE";
  rowNumber: number;
  nome: string;
  meta: number;
  bonus1: number;
  bonus2: number;
};

function parseBlocks(grid: any[][]): ParsedRow[] {
  const out: ParsedRow[] = [];
  // AL: A=0(meta) B=1(b1) C=2(b2) D=3(nome) ; PE: H=7 I=8 J=9 K=10(nome)
  const blocks: Array<{ block: "AL" | "PE"; cMeta: number; cB1: number; cB2: number; cNome: number }> = [
    { block: "AL", cMeta: 0, cB1: 1, cB2: 2, cNome: 3 },
    { block: "PE", cMeta: 7, cB1: 8, cB2: 9, cNome: 10 },
  ];
  for (let r = DATA_START_ROW_1BASED - 1; r < grid.length; r++) {
    const row = grid[r] || [];
    for (const b of blocks) {
      const nome = String(row[b.cNome] ?? "").trim();
      if (!nome) continue;
      const norm = normalizeName(nome);
      if (!norm) continue;
      // Pula cabecalhos ("PROMOTOR (A) AL/PE", "NOME") e linhas de OUTRAS
      // tabelas que aparecem abaixo do bloco de metas (ex.: "Codigo Produto",
      // "2881"). Mantem o token de exclusao p/ a contagem de excluidas.
      if (
        norm === "nome" ||
        norm.startsWith("promotor") ||
        norm.includes("codigo") ||
        norm.includes("produto")
      )
        continue;
      const soDigitos = /^\d+$/.test(norm.replace(/\s+/g, ""));
      if (soDigitos && !nome.includes(EXCLUDE_TOKEN)) continue;
      out.push({
        block: b.block,
        rowNumber: r + 1,
        nome,
        meta: parseNumber(row[b.cMeta]),
        bonus1: parseNumber(row[b.cB1]),
        bonus2: parseNumber(row[b.cB2]),
      });
    }
  }
  return out;
}

function rowExcluded(grid: any[][], rowNumber: number): boolean {
  const row = grid[rowNumber - 1] || [];
  return row.some((cell) => String(cell ?? "").includes(EXCLUDE_TOKEN));
}

export type MetasImportReport = {
  sheet: string;
  competencia: string;
  dryRun: boolean;
  counts: {
    al_rows: number;
    pe_rows: number;
    excluded: number;
    mapped: number;
    unmatched: number;
    ambiguous: number;
    only_meta: number;
    targets_upserted: number;
    repasse_upserted: number;
  };
  mapped: any[];
  unmatched: any[];
  ambiguous: any[];
  excluded: any[];
  // Mapeados que receberam meta (monthly_targets) mas NAO escala — nome nao
  // esta na lista do Acordo Comercial. Motor mantem o acordo atual intacto.
  only_meta: any[];
  backup: { monthly_targets: any[]; promoter_goal_repasse: any[] };
};

export async function importMetasWorkbook(opts: {
  supabase: SupabaseClient;
  fileBuffer: Buffer;
  dryRun: boolean;
  sheetName?: string;
}): Promise<MetasImportReport> {
  const { supabase, fileBuffer, dryRun, sheetName } = opts;

  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const chosenSheet =
    (sheetName && workbook.Sheets[sheetName] && sheetName) ||
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[chosenSheet];
  if (!sheet) throw new Error(`Aba '${chosenSheet}' nao encontrada.`);
  const grid = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
  });

  // Empresas: PE = CNPJ fixo; AL = todas com group_code 'AL'.
  const { data: companies, error: compErr } = await supabase
    .from("companies")
    .select("id, cnpj, group_code");
  if (compErr) throw compErr;
  const peCompanyIds = new Set(
    (companies || []).filter((c: any) => c.cnpj === PE_CNPJ).map((c: any) => c.id)
  );
  const alCompanyIds = new Set(
    (companies || []).filter((c: any) => c.group_code === "AL").map((c: any) => c.id)
  );

  const { data: promotersData, error: promErr } = await supabase
    .from("promoters")
    .select("id, name, company_id");
  if (promErr) throw promErr;
  const promoters: PromoterRow[] = (promotersData || []) as PromoterRow[];
  const promotersById = new Map(promoters.map((p) => [p.id, p]));
  const alPromoters = promoters.filter((p) => p.company_id && alCompanyIds.has(p.company_id));
  const pePromoters = promoters.filter((p) => p.company_id && peCompanyIds.has(p.company_id));

  const parsed = parseBlocks(grid);

  const report: MetasImportReport = {
    sheet: chosenSheet,
    competencia: METAS_COMPETENCIA,
    dryRun,
    counts: {
      al_rows: parsed.filter((r) => r.block === "AL").length,
      pe_rows: parsed.filter((r) => r.block === "PE").length,
      excluded: 0,
      mapped: 0,
      unmatched: 0,
      ambiguous: 0,
      only_meta: 0,
      targets_upserted: 0,
      repasse_upserted: 0,
    },
    mapped: [],
    unmatched: [],
    ambiguous: [],
    excluded: [],
    only_meta: [],
    backup: { monthly_targets: [], promoter_goal_repasse: [] },
  };

  const targetUpserts: any[] = [];
  const repasseUpserts: any[] = [];

  for (const row of parsed) {
    if (rowExcluded(grid, row.rowNumber)) {
      report.counts.excluded++;
      report.excluded.push({ block: row.block, row: row.rowNumber, nome: row.nome });
      continue;
    }

    // Alias confirmado por id vence o matching tolerante.
    const aliasId = PROMOTER_ALIAS[normalizeName(row.nome)];
    const aliasPromoter = aliasId ? promotersById.get(aliasId) : null;
    const scoped = row.block === "PE" ? pePromoters : alPromoters;
    const match: MatchResult = aliasPromoter
      ? { status: "mapped", promoter: aliasPromoter }
      : matchPromoter(row.nome, scoped, promoters);

    if (match.status === "mapped") {
      const p = match.promoter;
      const viaAlias = !!aliasPromoter;
      const stateMismatch =
        row.block === "PE"
          ? !(p.company_id && peCompanyIds.has(p.company_id))
          : !(p.company_id && alCompanyIds.has(p.company_id));
      // Escala por id (alias confirmado) precede o matching por token.
      const escalaById = ESCALA_BY_PROMOTER_ID[p.id];
      const escala = escalaById
        ? { pct: escalaById, source: "ALIAS_ID" }
        : resolveEscalaPct(row.nome); // {pct, source} | null (so nomeados)
      report.counts.mapped++;
      report.mapped.push({
        block: row.block,
        row: row.rowNumber,
        nome: row.nome,
        promoter_id: p.id,
        promoter_name: p.name,
        meta: row.meta,
        bonus1: row.bonus1,
        bonus2: row.bonus2,
        escala_source: escala?.source ?? null,
        escala_pct: escala?.pct ?? null,
        seeded_repasse: !!escala,
        via_alias: viaAlias || undefined,
        state_mismatch: stateMismatch || undefined,
      });
      // Meta em valor: SEMPRE grava (cadastro de meta, nao mexe em repasse).
      targetUpserts.push({
        promoter_id: p.id,
        company_id: p.company_id,
        year: METAS_YEAR,
        month: METAS_MONTH,
        meta: row.meta,
        meta_1: row.bonus1,
        meta_2: row.bonus2,
      });
      // Escala: SO os nomeados no Acordo Comercial recebem linha.
      if (escala) {
        repasseUpserts.push({
          promoter_id: p.id,
          competencia: METAS_COMPETENCIA,
          ...escala.pct,
        });
      } else {
        report.counts.only_meta++;
        report.only_meta.push({
          block: row.block,
          row: row.rowNumber,
          nome: row.nome,
          promoter_id: p.id,
          promoter_name: p.name,
        });
      }
    } else if (match.status === "ambiguous") {
      report.counts.ambiguous++;
      report.ambiguous.push({
        block: row.block,
        row: row.rowNumber,
        nome: row.nome,
        candidates: match.candidates.map((c) => ({ id: c.id, name: c.name })),
      });
    } else {
      report.counts.unmatched++;
      report.unmatched.push({
        block: row.block,
        row: row.rowNumber,
        nome: row.nome,
        meta: row.meta,
        bonus1: row.bonus1,
        bonus2: row.bonus2,
        sugestoes: match.candidates.map((c) => ({ id: c.id, name: c.name })),
      });
    }
  }

  // Dedup por promoter (ultima linha vence) — evita conflito no upsert batch.
  const dedup = (arr: any[], key: (r: any) => string) => {
    const m = new Map<string, any>();
    for (const r of arr) m.set(key(r), r);
    return Array.from(m.values());
  };
  const targetUpsertsU = dedup(targetUpserts, (r) => r.promoter_id);
  const repasseUpsertsU = dedup(repasseUpserts, (r) => r.promoter_id);

  // Backup do estado atual (sempre, mesmo em dryRun) dos promotores afetados.
  const affectedIds = targetUpsertsU.map((r) => r.promoter_id);

  if (affectedIds.length > 0) {
    const { data: curTargets } = await supabase
      .from("monthly_targets")
      .select("promoter_id, company_id, year, month, meta, meta_1, meta_2")
      .eq("year", METAS_YEAR)
      .eq("month", METAS_MONTH)
      .in("promoter_id", affectedIds);
    report.backup.monthly_targets = curTargets || [];
    const { data: curRepasse } = await supabase
      .from("promoter_goal_repasse")
      .select("promoter_id, competencia, pct_base, pct_meta1, pct_meta2")
      .eq("competencia", METAS_COMPETENCIA)
      .in("promoter_id", affectedIds);
    report.backup.promoter_goal_repasse = curRepasse || [];
  }

  if (!dryRun) {
    if (targetUpsertsU.length > 0) {
      const { error } = await supabase
        .from("monthly_targets")
        .upsert(targetUpsertsU, { onConflict: "promoter_id,year,month" });
      if (error) throw error;
      report.counts.targets_upserted = targetUpsertsU.length;
    }
    if (repasseUpsertsU.length > 0) {
      const { error } = await supabase
        .from("promoter_goal_repasse")
        .upsert(repasseUpsertsU, { onConflict: "promoter_id,competencia" });
      if (error) throw error;
      report.counts.repasse_upserted = repasseUpsertsU.length;
    }
  }

  return report;
}
