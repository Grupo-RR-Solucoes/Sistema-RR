/**
 * lib/trp/vigencia.ts — cálculo de vigência holiday-aware (calendário bancário
 * NACIONAL), reusável fora do painel de projeção.
 *
 * Fonte da verdade do algoritmo: extraído VERBATIM de lib/projecaoMetas.ts
 * (productionBusinessWindow e primitivas). projecaoMetas passa a RE-IMPORTAR
 * daqui — mesma função, um único lugar. NÃO duplicar/hardcodar a regra de
 * vigência: quem precisar de valid_from/valid_until usa este util.
 *
 * REGRA RR (mesma que o motor usa para a competência):
 *   valid_from  = ÚLTIMO dia útil do mês ANTERIOR.
 *   valid_until = PENÚLTIMO dia útil do mês NOMINAL.
 *   Dias úteis descontam fins de semana E feriados nacionais (fixos + móveis
 *   via Páscoa). Ex.: 2026-06 → 2026-05-29 .. 2026-06-29.
 *
 * Uso na Fase 2 (TRP self-service): o resolvedor DB (resolveTrpRegraDb) e o
 * gerador de seed computam valid_from/valid_until da competência-alvo com
 * vigenciaDaCompetencia() — nunca com datas cravadas.
 */

// ---------- Primitivas de data (UTC) ----------
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// ---------- Feriados nacionais ----------
// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC.
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=março, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// Feriados NACIONAIS do ano (estaduais AL/PE ficam de backlog).
export function nationalHolidays(year: number): Set<string> {
  const s = new Set<string>();
  // Fixos
  for (const md of ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"]) {
    s.add(`${year}-${md}`);
  }
  // Móveis (derivados da Páscoa)
  const easter = easterSunday(year);
  s.add(ymd(addDays(easter, -48))); // Carnaval (segunda)
  s.add(ymd(addDays(easter, -47))); // Carnaval (terça)
  s.add(ymd(addDays(easter, -2))); // Sexta-feira Santa
  s.add(ymd(addDays(easter, 60))); // Corpus Christi
  return s;
}

export function holidaysForYears(...years: number[]): Set<string> {
  const s = new Set<string>();
  for (const y of new Set(years)) for (const h of nationalHolidays(y)) s.add(h);
  return s;
}

function isBusinessDay(d: Date, holidays: Set<string>): boolean {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !holidays.has(ymd(d));
}

function lastBusinessDayOfMonth(year: number, month: number, holidays: Set<string>): Date {
  // dia 0 do mês seguinte = último dia do mês (month aqui é 1-based).
  let d = new Date(Date.UTC(year, month, 0));
  while (!isBusinessDay(d, holidays)) d = addDays(d, -1);
  return d;
}

function penultimateBusinessDayOfMonth(year: number, month: number, holidays: Set<string>): Date {
  const last = lastBusinessDayOfMonth(year, month, holidays);
  let d = addDays(last, -1);
  while (!isBusinessDay(d, holidays)) d = addDays(d, -1);
  return d;
}

export function countBusinessDays(start: Date, end: Date, holidays: Set<string>): number {
  if (end < start) return 0;
  let n = 0;
  let d = new Date(start.getTime());
  while (d <= end) {
    if (isBusinessDay(d, holidays)) n++;
    d = addDays(d, 1);
  }
  return n;
}

// ---------- Janela de produção (holiday-aware) da competência ----------
export function productionBusinessWindow(year: number, month: number) {
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const holidays = holidaysForYears(prev.y, year);
  const start = lastBusinessDayOfMonth(prev.y, prev.m, holidays);
  const end = penultimateBusinessDayOfMonth(year, month, holidays);
  const total = countBusinessDays(start, end, holidays);
  return { start, end, total, holidays };
}

// ---------- API de vigência para a TRP versionada (Fase 2) ----------

export interface CompetenciaYM {
  year: number;
  month: number; // 1-based
}

/**
 * Aceita "YYYY-MM", "YYYY-MM-DD" ou { year, month } e devolve { year, month }.
 * Lança em formato inválido — o caller (resolvedor/seed) deve passar competência
 * bem-formada.
 */
export function parseCompetencia(competencia: string | CompetenciaYM): CompetenciaYM {
  if (typeof competencia !== "string") {
    if (
      !Number.isInteger(competencia.year) ||
      !Number.isInteger(competencia.month) ||
      competencia.month < 1 ||
      competencia.month > 12
    ) {
      throw new Error(`competência inválida: ${JSON.stringify(competencia)}`);
    }
    return { year: competencia.year, month: competencia.month };
  }
  const m = competencia.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) throw new Error(`competência inválida: '${competencia}' (esperado YYYY-MM)`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`mês inválido em competência '${competencia}'`);
  return { year, month };
}

/** Chave canônica de competência "YYYY-MM". */
export function competenciaKey(competencia: string | CompetenciaYM): string {
  const { year, month } = parseCompetencia(competencia);
  return `${year}-${pad2(month)}`;
}

/** 1º dia do mês nominal da competência, em ISO "YYYY-MM-01" (coluna competencia do banco). */
export function competenciaFirstDay(competencia: string | CompetenciaYM): string {
  const { year, month } = parseCompetencia(competencia);
  return `${year}-${pad2(month)}-01`;
}

export interface Vigencia {
  /** Último dia útil do mês anterior (holiday-aware), ISO "YYYY-MM-DD". */
  validFrom: string;
  /** Penúltimo dia útil do mês nominal (holiday-aware), ISO "YYYY-MM-DD". */
  validUntil: string;
}

/**
 * Vigência holiday-aware da competência (REGRA RR). É a MESMA janela que o motor
 * usa (productionBusinessWindow) — só formatada em ISO string para persistir.
 *
 * Ex.: vigenciaDaCompetencia("2026-06") → { validFrom: "2026-05-29", validUntil: "2026-06-29" }.
 */
export function vigenciaDaCompetencia(competencia: string | CompetenciaYM): Vigencia {
  const { year, month } = parseCompetencia(competencia);
  const win = productionBusinessWindow(year, month);
  return { validFrom: ymd(win.start), validUntil: ymd(win.end) };
}

// ---------- Vigência intra-mês: o override que vem de FORA do PDF ----------

/**
 * Veredito de `validarOverrideNaJanela`. Discriminado por `ok`.
 *
 * POR QUE NÃO LANÇA. `TrpValidationError` mora em lib/trp/parseTrpDraft.ts, que
 * IMPORTA este arquivo (`import { vigenciaDaCompetencia, competenciaKey } from
 * "@/lib/trp/vigencia"`). Importá-lo de volta fecharia um ciclo. Então esta
 * função devolve VEREDITO e quem tem contexto de API (commitTrpVersion) lança o
 * erro tipado. Efeito colateral bom: dá para exercitar as 4 recusas no portão
 * sem try/catch, e a mutação aparece como veredito diferente, não como exceção
 * que sumiu.
 */
export type OverrideVerdict =
  | { ok: true; validFrom: string; validUntil: string }
  | { ok: false; motivo: string; detalhe: string };

/**
 * O override de início de vigência cai DENTRO da janela da competência e de fato
 * PARTE o mês?
 *
 * A data de início da TRP39 (05/08/2026) só existe no e-mail da Promotiva —
 * decisão do Diego (31/08): nunca vai estar no PDF. Esta é a única porta por
 * onde ela entra, e é aqui que ela é conferida contra a régua da casa
 * (`vigenciaDaCompetencia`, holiday-aware), que continua valendo para todo o
 * resto.
 *
 * AS TRÊS RECUSAS:
 *
 *   fora da janela (antes de validFrom ou depois de validUntil)
 *       -> RECUSA. Um override fora da janela não descreve esta competência.
 *          Depois do fim seria régua que nunca vale; antes do início seria
 *          régua valendo em competência alheia.
 *
 *   IGUAL a validFrom
 *       -> RECUSA, e esta é a sutil. `>` ESTRITO, decisão do Diego (01/09):
 *          override igual ao início não PARTE nada — no RPC ele cai na SAÍDA 1
 *          (SUBSTITUI), que é o re-upload de sempre. Aceitá-lo em silêncio
 *          gravaria em trp_rule_uploads.valid_from_override uma data que não
 *          produziu efeito nenhum, e a próxima pessoa a ler aquela linha
 *          concluiria que a competência foi partida quando não foi. Não se
 *          normaliza para NULL em silêncio: quem digitou a data do início da
 *          janela ou errou a data, ou queria substituir e não sabe — nos dois
 *          casos a resposta certa é dizer, não adivinhar.
 *
 *   formato inválido
 *       -> RECUSA. Só "YYYY-MM-DD".
 *
 * O QUE ESTA FUNÇÃO **NÃO** RESPONDE: se existe fatia ativa cobrindo o início da
 * janela. Isso é estado do BANCO, não da régua de datas, e é conferido em
 * commitTrpVersion — sem aquela conferência, subir a PRIMEIRA régua de uma
 * competência já com override deixa a fatia inicial do mês DESCOBERTA, e o
 * resolvedor lança TrpVigenciaGapError no primeiro contrato daquele pedaço
 * (/promotores, /recebiveis e o motor). O EXCLUDE do banco pega SOBREPOSIÇÃO,
 * nunca BURACO.
 *
 * @param competencia "YYYY-MM" | "YYYY-MM-DD" | { year, month }
 * @param override    "YYYY-MM-DD" — o início declarado por fora do PDF.
 */
export function validarOverrideNaJanela(
  competencia: string | CompetenciaYM,
  override: string,
): OverrideVerdict {
  const comp = competenciaKey(competencia);
  const { validFrom, validUntil } = vigenciaDaCompetencia(comp);

  if (typeof override !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(override)) {
    return {
      ok: false,
      motivo: "data de início de vigência inválida",
      detalhe: `formato esperado AAAA-MM-DD, recebido '${String(override)}'`,
    };
  }
  // Data real (rejeita 2026-02-31, que casa no regex e não existe no calendário).
  const d = parseIsoDateOnly(override);
  if (!d || ymd(d) !== override) {
    return {
      ok: false,
      motivo: "data de início de vigência inexistente no calendário",
      detalhe: `'${override}'`,
    };
  }

  if (override < validFrom) {
    return {
      ok: false,
      motivo: "a data de início é ANTERIOR à janela da competência",
      detalhe: `${override} < ${validFrom} — a janela de ${comp} é ${validFrom} a ${validUntil}`,
    };
  }
  if (override > validUntil) {
    return {
      ok: false,
      motivo: "a data de início é POSTERIOR ao fim da janela da competência",
      detalhe: `${override} > ${validUntil} — a régua nunca chegaria a valer em ${comp}`,
    };
  }
  if (override === validFrom) {
    return {
      ok: false,
      motivo: "esta data não PARTE a competência — é o próprio início da janela",
      detalhe:
        `${override} é o primeiro dia de ${comp}. Sem partir, o commit SUBSTITUI a régua ` +
        `ativa, que é o caminho normal: suba sem informar data de início. Se a intenção era ` +
        `partir o mês, informe o primeiro dia em que a régua NOVA passa a valer ` +
        `(entre ${somaUmDia(validFrom)} e ${validUntil}).`,
    };
  }
  return { ok: true, validFrom, validUntil };
}

/** Dia seguinte, em ISO. Usado nas mensagens e no cálculo do fim da fatia anterior. */
export function somaUmDia(iso: string): string {
  const d = parseIsoDateOnly(iso);
  if (!d) throw new Error(`data inválida: '${iso}'`);
  d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}

/** Dia anterior, em ISO. É onde a fatia ANTERIOR passa a terminar quando o mês é partido. */
export function subtraiUmDia(iso: string): string {
  const d = parseIsoDateOnly(iso);
  if (!d) throw new Error(`data inválida: '${iso}'`);
  d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
}

/**
 * Competência (YYYY-MM) cuja janela de vigência holiday-aware CONTÉM a data.
 *
 * Regra real da Promotiva (mesma do portão de paridade da Frente 2): a
 * competência de um contrato = a TRP cuja [validFrom .. validUntil] (inclusivo)
 * contém a contract_date. Testa o mês seguinte antes do corrente porque o
 * validFrom de um mês é o último dia útil do mês anterior — dias de fronteira
 * pertencem ao mês seguinte. Fallback: mês-calendário da própria data.
 *
 * @param dateLike "YYYY-MM-DD" (ou Date). Só a parte de data é considerada (UTC).
 */
export function competenciaDaData(dateLike: string | Date): string {
  const date =
    dateLike instanceof Date
      ? new Date(Date.UTC(dateLike.getUTCFullYear(), dateLike.getUTCMonth(), dateLike.getUTCDate()))
      : parseIsoDateOnly(dateLike);
  if (!date) throw new Error(`data inválida: '${String(dateLike)}'`);

  const dateKey = ymd(date);
  const current: CompetenciaYM = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  const next = addMonthsYM(current, 1);

  for (const cand of [next, current]) {
    const { validFrom, validUntil } = vigenciaDaCompetencia(cand);
    if (dateKey >= validFrom && dateKey <= validUntil) return competenciaKey(cand);
  }
  return competenciaKey(current);
}

function addMonthsYM(period: CompetenciaYM, monthsToAdd: number): CompetenciaYM {
  const d = new Date(Date.UTC(period.year, period.month - 1 + monthsToAdd, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function parseIsoDateOnly(value: string): Date | null {
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
