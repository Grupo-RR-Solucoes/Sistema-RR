// ============================================================================
// convenio_segmento — FONTE DE VERDADE do segmento (público/privado) e da
// categoria TRP por convênio. Seed só de VERDADE: convenio_segment do banco
// (diária) + convenios_oficiais.json (TRP23). Convênio ausente da tabela e cujo
// roteamento depende de público/privado → "a confirmar" (a auditoria decide),
// NUNCA chute de público.
//
// convenio_code: APENAS dígitos, sem zeros à esquerda (ex.: "1640").
// ============================================================================

import { CONVENIOS_OFICIAIS } from "./regrasData.ts";

type SupabaseLike = { from: (t: string) => any };

export type CategoriaTrp =
  | "INSS"
  | "MPDG"
  | "SP_MG"
  | "EXERCITO"
  | "CONSIG_PUBLICO"
  | "CONSIG_PRIVADO"
  | "FGTS"
  | "NAO_CONSIGNADO";

export type Segmento = "PUBLICO" | "PRIVADO" | null;

export interface ConvenioSegmentoRow {
  convenio_code: string;
  categoria_trp: CategoriaTrp;
  segmento: Segmento;
  fonte: "daily" | "convenios_oficiais" | "sp_mg_set" | "manual";
  confirmado: boolean;
}
export interface ConvenioRef {
  categoriaTrp: CategoriaTrp;
  segmento: Segmento;
}

/** convênio → só dígitos, sem zeros à esquerda. "000001640" → "1640". */
export function normConvenio(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return d || null;
}

const PAGE = 1000;
async function fetchAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAll: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

/**
 * Deriva linhas convenio_segmento da DIÁRIA (convenio_segment do banco):
 * por convênio, o segmento majoritário → seg 1 = CONSIG_PUBLICO/PUBLICO,
 * seg 2 = CONSIG_PRIVADO/PRIVADO. fonte='daily', confirmado=true. Segmento
 * que não é 1/2 → não gera linha (não inventa). Reusado pelo seed e pelo hook
 * de auto-crescimento do import diário.
 */
export function deriveDailySegmentRows(
  records: Array<{ convenio_code?: string | number | null; convenio_segment?: string | number | null }>
): ConvenioSegmentoRow[] {
  const segCount = new Map<string, Record<string, number>>();
  for (const d of records) {
    const code = normConvenio(d.convenio_code);
    if (!code) continue;
    const seg = String(d.convenio_segment ?? "");
    const m = segCount.get(code) ?? {};
    m[seg] = (m[seg] ?? 0) + 1;
    segCount.set(code, m);
  }
  const out: ConvenioSegmentoRow[] = [];
  for (const [code, m] of segCount) {
    const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    if (top === "1") {
      out.push({
        convenio_code: code,
        categoria_trp: "CONSIG_PUBLICO",
        segmento: "PUBLICO",
        fonte: "daily",
        confirmado: true,
      });
    } else if (top === "2") {
      out.push({
        convenio_code: code,
        categoria_trp: "CONSIG_PRIVADO",
        segmento: "PRIVADO",
        fonte: "daily",
        confirmado: true,
      });
    }
  }
  return out;
}

/**
 * Constrói o seed da tabela SÓ de verdade:
 *  - convenios_oficiais.json (TRP23): INSS 1640, MPDG 1078, EXERCITO 14661, SP/MG
 *    (SP_MG_CONVENIOS do motor = a MESMA lista). fonte='convenios_oficiais'.
 *  - diária (convenio_segment do banco) p/ os DEMAIS convênios: seg 1 =
 *    CONSIG_PUBLICO/PUBLICO, seg 2 = CONSIG_PRIVADO/PRIVADO. fonte='daily'.
 * Oficiais têm precedência (não sobrescritos pela diária).
 */
export async function buildConvenioSegmentoSeed(
  sb: SupabaseLike
): Promise<ConvenioSegmentoRow[]> {
  const byCode = new Map<string, ConvenioSegmentoRow>();

  // 1) oficiais (autoritativo, categorias especiais).
  const oficiais: Array<[string[], CategoriaTrp]> = [
    [CONVENIOS_OFICIAIS.INSS ?? [], "INSS"],
    [CONVENIOS_OFICIAIS.MPDG ?? [], "MPDG"],
    [CONVENIOS_OFICIAIS.EXERCITO ?? [], "EXERCITO"],
    [CONVENIOS_OFICIAIS.SP ?? [], "SP_MG"],
    [CONVENIOS_OFICIAIS.MG ?? [], "SP_MG"],
  ];
  for (const [codes, cat] of oficiais) {
    for (const raw of codes) {
      const code = normConvenio(raw);
      if (!code) continue;
      byCode.set(code, {
        convenio_code: code,
        categoria_trp: cat,
        segmento: null,
        fonte: "convenios_oficiais",
        confirmado: true,
      });
    }
  }

  // 2) diária — segmento majoritário p/ os demais (público/privado).
  const daily = await fetchAll<{ convenio_code: string | null; convenio_segment: string | number | null }>(
    () => sb.from("daily_production_records").select("convenio_code, convenio_segment")
  );
  for (const r of deriveDailySegmentRows(daily)) {
    if (byCode.has(r.convenio_code)) continue; // oficial tem precedência.
    byCode.set(r.convenio_code, r);
  }

  return [...byCode.values()];
}

/** Seed rows → Map<convenio_code, ConvenioRef> (override p/ sim/teste). */
export function seedToRefMap(rows: ConvenioSegmentoRow[]): Map<string, ConvenioRef> {
  return new Map(
    rows.map((r) => [r.convenio_code, { categoriaTrp: r.categoria_trp, segmento: r.segmento }])
  );
}

/**
 * Carrega o mapa da TABELA convenio_segmento. Se a tabela ainda não existe
 * (migration não aplicada) → Map VAZIO (comportamento SEGURO: genéricos viram
 * "a confirmar", nunca chute de público).
 */
export async function loadConvenioSegmentoRef(
  sb: SupabaseLike
): Promise<Map<string, ConvenioRef>> {
  try {
    const rows = await fetchAll<{
      convenio_code: string;
      categoria_trp: CategoriaTrp;
      segmento: Segmento;
    }>(() => sb.from("convenio_segmento").select("convenio_code, categoria_trp, segmento"));
    return new Map(
      rows.map((r) => [r.convenio_code, { categoriaTrp: r.categoria_trp, segmento: r.segmento }])
    );
  } catch {
    return new Map();
  }
}
