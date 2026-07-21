// FRENTE DE PRODUTO — Movimento 2b: AUDITORIA FORTE do consorcio.
//
// A carteira ja marca NAO_VEIO a posicao seguinte a maxRecebida quando o mes passou.
// Aqui persistimos esse fato como snapshot mensal com ciclo de vida (espelho do
// prt_inadimplencia_monitor): quem faltou, valor previsto pela TRP 210, cauda restante.
// resolucao_status e BLINDADA (nunca entra no upsert -> o motor nao a sobrescreve).
//
// Classificacao: cauda_restante >= 2 -> SUSPEITO (parou no meio); cauda 1 -> QUITACAO
// (so falta a ultima parcela; provavel quitacao/encerramento legitimo).
import type { SupabaseClient } from "@supabase/supabase-js";
import { materializarCarteiraConsorcio } from "./carteira.ts";
import type { CarteiraConsorcioRow } from "./carteira.ts";

type SupabaseLike = SupabaseClient;

export type ConsorcioMonitorSnapshot = {
  competencia: string;
  proposta: string;
  posicao: number;
  company_id: string | null;
  status: "PARCELA_NAO_VEIO_SUSPEITO" | "PARCELA_NAO_VEIO_QUITACAO";
  segmento_grupo: string | null;
  teto_parcelas: number;
  posicao_recebida_max: number;
  ultimo_mes_recebido: string | null;
  cauda_restante: number;
  valor_previsto: number;
  recuperavel_estimado: number;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

// Constroi os snapshots de inadimplencia (PURA) a partir das linhas da carteira de UMA
// competencia de referencia: uma linha por parcela NAO_VEIO.
export function buildConsorcioSnapshots(
  rows: CarteiraConsorcioRow[],
  competencia: string
): ConsorcioMonitorSnapshot[] {
  // agrupa por proposta para derivar ultimo mes recebido e cauda.
  const porProposta = new Map<string, CarteiraConsorcioRow[]>();
  for (const r of rows) {
    const k = `${r.company_id ?? "NULL"}|${r.proposta}`;
    (porProposta.get(k) || porProposta.set(k, []).get(k)!).push(r);
  }

  const out: ConsorcioMonitorSnapshot[] = [];
  for (const grupo of porProposta.values()) {
    const naoVeio = grupo.filter((r) => r.status === "NAO_VEIO");
    if (naoVeio.length === 0) continue;
    const recebidas = grupo.filter((r) => r.status === "RECEBIDA" || r.status === "ENCERRADA");
    const posicaoRecebidaMax = recebidas.reduce((mx, r) => Math.max(mx, r.posicao), 0);
    const ultimoMes = recebidas.reduce<string | null>(
      (mx, r) => (r.competencia_recebida && (!mx || r.competencia_recebida > mx) ? r.competencia_recebida : mx),
      null
    );
    for (const r of naoVeio) {
      const cauda = r.teto_parcelas - posicaoRecebidaMax; // esperadas ainda faltando
      const recuperavel = grupo
        .filter((x) => x.posicao > posicaoRecebidaMax && (x.status === "NAO_VEIO" || x.status === "ESPERADA"))
        .reduce((s, x) => s + Number(x.comissao_esperada || 0), 0);
      out.push({
        competencia,
        proposta: r.proposta,
        posicao: r.posicao,
        company_id: r.company_id,
        status: cauda >= 2 ? "PARCELA_NAO_VEIO_SUSPEITO" : "PARCELA_NAO_VEIO_QUITACAO",
        segmento_grupo: r.segmento_grupo,
        teto_parcelas: r.teto_parcelas,
        posicao_recebida_max: posicaoRecebidaMax,
        ultimo_mes_recebido: ultimoMes,
        cauda_restante: cauda,
        valor_previsto: round2(Number(r.comissao_esperada || 0)),
        recuperavel_estimado: round2(recuperavel),
      });
    }
  }
  return out;
}

// Persiste o snapshot de inadimplencia do consorcio da competencia. Le a carteira viva
// (materializada), extrai as parcelas NAO_VEIO e faz UPSERT por (competencia, proposta,
// posicao) SEM tocar resolucao_status/por/em (blindagem). Idempotente.
export async function persistConsorcioInadimplenciaSnapshot(
  supabase: SupabaseLike,
  params: { competencia: { year: number; month: number }; dryRun?: boolean }
): Promise<{ novos: number; total: number; snapshots: ConsorcioMonitorSnapshot[] }> {
  const dryRun = params.dryRun === true;
  const competencia = `${params.competencia.year}-${String(params.competencia.month).padStart(2, "0")}`;

  const mat = await materializarCarteiraConsorcio(supabase, { dryRun: true });
  const snapshots = buildConsorcioSnapshots(mat.rows, competencia);
  if (dryRun || snapshots.length === 0) {
    return { novos: 0, total: snapshots.length, snapshots };
  }

  // preserva primeira_deteccao/status_acompanhamento existentes.
  const { data: existing, error: selErr } = await supabase
    .from("consorcio_inadimplencia_monitor")
    .select("proposta, posicao, primeira_deteccao, status_acompanhamento")
    .eq("competencia", competencia);
  if (selErr) throw new Error(selErr.message);
  const prev = new Map<string, { primeira_deteccao: string; status_acompanhamento: string }>();
  for (const r of existing || []) prev.set(`${r.proposta}|${r.posicao}`, r as any);

  let novos = 0;
  const payload = snapshots.map((s) => {
    const p = prev.get(`${s.proposta}|${s.posicao}`);
    if (!p) novos += 1;
    return {
      competencia: s.competencia,
      proposta: s.proposta,
      posicao: s.posicao,
      company_id: s.company_id,
      status: s.status,
      segmento_grupo: s.segmento_grupo,
      teto_parcelas: s.teto_parcelas,
      posicao_recebida_max: s.posicao_recebida_max,
      ultimo_mes_recebido: s.ultimo_mes_recebido,
      cauda_restante: s.cauda_restante,
      valor_previsto: s.valor_previsto,
      recuperavel_estimado: s.recuperavel_estimado,
      primeira_deteccao: p?.primeira_deteccao ?? competencia,
      status_acompanhamento: p?.status_acompanhamento ?? "NOVO",
      atualizado_em: new Date().toISOString(),
      // resolucao_status/por/em NAO entram: blindagem estrutural.
    };
  });

  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await supabase
      .from("consorcio_inadimplencia_monitor")
      .upsert(payload.slice(i, i + 500), { onConflict: "competencia,proposta,posicao" });
    if (error) throw new Error(error.message);
  }
  return { novos, total: snapshots.length, snapshots };
}
