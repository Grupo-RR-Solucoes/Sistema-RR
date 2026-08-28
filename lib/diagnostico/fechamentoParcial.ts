import type { SupabaseClient } from "@supabase/supabase-js";

import { BBTS_COMPANY_ID } from "@/lib/bbtsCompanyId";

// ============================================================================
// lib/diagnostico/fechamentoParcial.ts — O QUE NAO CHEGOU.
//
// O sistema sabia dizer se o que chegou estava certo. Nao sabia dizer se chegou
// TUDO. Sao coisas diferentes, e a segunda nao tem quem responda:
//
//   ADS  — o fechamento sao DOIS PDFs (credito + seguro). As ancoras saem do
//          PROPRIO arquivo, entao "nao mandaram o PDF de seguro" e "mandaram e
//          o mes nao teve seguro" produzem o MESMO gate verde. Medido em
//          27/08/2026 com julho/2026: importar so o credito dava ancora_ok=true.
//   RR   — o fechamento se monta com a nota "Todos" mais avulsas, e nao existe
//          manifesto do que deveria ter vindo. Uma aba vazia dentro do "Todos" e
//          uma aba AUSENTE do "Todos" chegam iguais aqui: zero.
//
// POR ISSO OS DOIS CHECKS SAO 'alerta', NUNCA 'erro'. Nenhum deles PROVA falta —
// os dois apontam uma DESCONTINUIDADE que so uma pessoa pode resolver olhando a
// origem. Chamar de erro treinaria o leitor a ignorar o vigia.
//
// SO LEITURA.
// ============================================================================

export interface ChecagemParcial {
  id: string;
  severity: "alerta";
  count: number;
  descricao: string;
  detalhe: unknown;
}

/** competencias anteriores olhadas na regra de descontinuidade do RR. */
const JANELA_RR = 6;
/** em quantas delas o produto precisa ter tido valor para o zero virar suspeita. */
const MINIMO_PRESENCAS = 3;
/** ruido de centavo: abaixo disto o valor conta como zero. */
const EPS = 0.005;
/** tolerancia da ancora de totais: a mesma 0,01 que o extrator usa. */
const EPS_MOEDA = 0.01;

/** as colunas de produto de fechamento_mensal_empresa, com o rotulo humano. */
const PRODUTOS_RR: Array<{ coluna: string; rotulo: string }> = [
  { coluna: "valor_credito", rotulo: "Credito (nota avulsa)" },
  { coluna: "valor_consorcio", rotulo: "Consorcio" },
  { coluna: "valor_bbcap", rotulo: "BBCAP" },
  { coluna: "valor_conta_corrente", rotulo: "Conta Corrente" },
  { coluna: "valor_dental", rotulo: "Dental" },
  { coluna: "valor_lob", rotulo: "LOB" },
];

const num = (v: unknown) => (Number(v) || 0);
const compKey = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`;

type AdsRow = {
  movement_date: string | null;
  bbts_pag_avista: number | null;
  bbts_seguro_pago: number | null;
  insurance_value: number | null;
};

/**
 * ADS: competencia com PDF de CREDITO importado e sem sinal do PDF de SEGURO.
 *
 * A linha de fechamento se reconhece por `bbts_pag_avista is not null`: essa
 * coluna nao esta em CREDIT_COLUMNS nem em INSURANCE_COLUMNS, entao SO o dono
 * FULL (o fechamento) a escreve — a diaria nao alcanca. Medido em 27/08/2026:
 * 19 linhas em 2026-06 (Sigma 7.707,03) e 43 em 2026-07 (Sigma 18.737,33), contra
 * 36 linhas de agosto vindas da diaria, todas com a coluna NULL.
 */
async function checarAds(admin: SupabaseClient): Promise<ChecagemParcial[]> {
  const { data, error } = await admin
    .from("daily_production_records")
    .select("movement_date, bbts_pag_avista, bbts_seguro_pago, insurance_value")
    .eq("company_id", BBTS_COMPANY_ID)
    .not("bbts_pag_avista", "is", null);
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as AdsRow[];

  // cabecalho da NF por competencia (tolera a tabela inexistente: migration
  // pendente nao pode derrubar o vigia; qualquer OUTRO erro sobe).
  const comCabecalho = new Set<string>();
  try {
    const { data: cab, error: cabErr } = await admin
      .from("bbts_fechamento_cabecalho")
      .select("competencia")
      .eq("company_id", BBTS_COMPANY_ID);
    if (cabErr) throw new Error(cabErr.message);
    for (const r of cab ?? []) comCabecalho.add(String(r.competencia ?? "").slice(0, 7));
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (!/schema cache|does not exist|PGRST205/i.test(msg)) throw e;
  }

  type Balde = { linhas: number; avista: number; seguro: number; base: number };
  const porComp = new Map<string, Balde>();
  for (const r of linhas) {
    const comp = String(r.movement_date ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(comp)) continue;
    let b = porComp.get(comp);
    if (!b) { b = { linhas: 0, avista: 0, seguro: 0, base: 0 }; porComp.set(comp, b); }
    b.linhas += 1;
    b.avista += num(r.bbts_pag_avista);
    b.seguro += num(r.bbts_seguro_pago);
    b.base += num(r.insurance_value);
  }

  const semSeguro: unknown[] = [];
  const semCabecalho: unknown[] = [];
  for (const [comp, b] of [...porComp].sort()) {
    if (b.seguro <= EPS && b.base <= EPS) {
      semSeguro.push({
        competencia: comp,
        propostas_credito: b.linhas,
        pago_avista: Math.round(b.avista * 100) / 100,
        seguro_pago: 0,
        base_segurada: 0,
      });
    }
    if (!comCabecalho.has(comp)) {
      semCabecalho.push({ competencia: comp, propostas_credito: b.linhas });
    }
  }

  // ------------------------------------------------------------------------
  // ANCORA PERMANENTE. O extrator ja compara Sigma das linhas contra o declarado no
  // MOMENTO da importacao (bbtsPdfExtract.ts:484 para o AVT, :515 para o PRT,
  // :570 para o seguro) e ABORTA se nao fechar. Mas aquilo e um evento: passou,
  // acabou. Depois disso, qualquer coisa que mexa nas linhas — uma reimportacao
  // parcial, um merge da diaria, um UPDATE manual — pode afastar a soma do que a
  // BBTS declarou, e nada percebe.
  //
  // Com o cabecalho GRAVADO, a mesma conferencia vira permanente: o declarado
  // fica no banco e pode ser confrontado a qualquer momento. E exatamente o que
  // faltou quando o PDF de seguro de uma competencia nao foi importado e a
  // ausencia so apareceu porque alguem somou a mao.
  //
  // Sem a tabela (migration pendente) o check nao acusa nada — nao ha declarado
  // com que comparar. Ele NASCE mudo e passa a falar quando a migration rodar.
  // ------------------------------------------------------------------------
  const desvios: unknown[] = [];
  if (comCabecalho.size > 0) {
    const { data: cab, error: cabErr } = await admin
      .from("bbts_fechamento_cabecalho")
      .select("competencia, pagamento_avt, pagamento_prt, abertura_conta, pagamento_total")
      .eq("company_id", BBTS_COMPANY_ID);
    if (cabErr) throw new Error(cabErr.message);

    // Sigma das parcelas PRT por competencia (tabela propria, competencia LITERAL)
    const { data: prt, error: prtErr } = await admin
      .from("bbts_prt_parcelas")
      .select("competencia, valor_parcela")
      .eq("company_id", BBTS_COMPANY_ID);
    if (prtErr) throw new Error(prtErr.message);
    const prtPorComp = new Map<string, number>();
    for (const r of prt ?? []) {
      const k = String(r.competencia ?? "").slice(0, 7);
      prtPorComp.set(k, (prtPorComp.get(k) ?? 0) + num(r.valor_parcela));
    }

    for (const c of cab ?? []) {
      const comp = String(c.competencia ?? "").slice(0, 7);
      const b = porComp.get(comp);
      // Sigma das linhas de credito da competencia (a coluna que so o fechamento escreve)
      const somaAvt = b ? b.avista : 0;
      const somaPrt = prtPorComp.get(comp) ?? 0;
      const dAvt = Math.round((somaAvt - num(c.pagamento_avt)) * 100) / 100;
      const dPrt = Math.round((somaPrt - num(c.pagamento_prt)) * 100) / 100;
      if (Math.abs(dAvt) > EPS_MOEDA) {
        desvios.push({
          competencia: comp, ancora: "Pagamento AVT",
          declarado_pela_bbts: num(c.pagamento_avt), soma_das_linhas: somaAvt, diferenca: dAvt,
        });
      }
      if (Math.abs(dPrt) > EPS_MOEDA) {
        desvios.push({
          competencia: comp, ancora: "Pagamento PRT",
          declarado_pela_bbts: num(c.pagamento_prt), soma_das_linhas: somaPrt, diferenca: dPrt,
        });
      }
    }
  }

  return [
    {
      id: "ads_ancora_totais",
      severity: "alerta",
      count: desvios.length,
      descricao:
        "ADS: a soma das linhas gravadas nao bate mais com o total que a BBTS DECLAROU no " +
        "cabecalho da NF daquela competencia. O extrator ja confere isso na importacao e " +
        "aborta; este check e a versao PERMANENTE — pega o que mudou DEPOIS (reimportacao " +
        "parcial, merge da diaria, UPDATE manual). Enquanto nao houver linha em " +
        "bbts_fechamento_cabecalho para a competencia, nao ha declarado com que comparar " +
        "e o check fica calado (ver ads_cabecalho_nf_ausente).",
      detalhe: desvios,
    },
    {
      id: "ads_fechamento_sem_seguro",
      severity: "alerta",
      count: semSeguro.length,
      descricao:
        "ADS: competencia com o PDF de CREDITO importado e NENHUM sinal do PDF de SEGURO " +
        "(zero em bbts_seguro_pago e em insurance_value). O gate NAO detecta isto sozinho: " +
        "a ancora do seguro sai do proprio arquivo, entao ausencia e zero sao indistinguiveis. " +
        "Pode ser mes realmente sem seguro — quem confere e a pessoa, na origem.",
      detalhe: semSeguro,
    },
    {
      id: "ads_cabecalho_nf_ausente",
      severity: "alerta",
      count: semCabecalho.length,
      descricao:
        "ADS: competencia com fechamento de credito gravado e SEM linha em " +
        "bbts_fechamento_cabecalho — a Abertura de Conta e a Glosa daquela competencia " +
        "nao entraram no caixa. Competencia importada ANTES da captura do cabecalho: " +
        "resolve reimportando o PDF de credito.",
      detalhe: semCabecalho,
    },
  ];
}

type FechRow = Record<string, unknown> & { empresa_cnpj: string; ano: number; mes: number };

/**
 * RR: produto que vinha tendo valor e ZEROU na ultima competencia da empresa.
 *
 * NAO prova que faltou arquivo — Conta Corrente e BBCAP vem de ABAS dentro do
 * proprio "Todos", entao o zero tanto pode ser aba vazia quanto aba ausente. O
 * check existe justamente porque o sistema nao distingue os dois: ele levanta a
 * mao, a pessoa decide.
 */
async function checarRr(admin: SupabaseClient): Promise<ChecagemParcial[]> {
  const cols = PRODUTOS_RR.map((p) => p.coluna).join(", ");
  const { data, error } = await admin
    .from("fechamento_mensal_empresa")
    .select(`empresa_cnpj, ano, mes, ${cols}`);
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as unknown as FechRow[];

  const { data: comps } = await admin.from("companies").select("cnpj, name");
  const nome = new Map((comps ?? []).map((c) => [String(c.cnpj), String(c.name)]));

  const porEmpresa = new Map<string, FechRow[]>();
  for (const r of linhas) {
    const arr = porEmpresa.get(r.empresa_cnpj) ?? [];
    arr.push(r);
    porEmpresa.set(r.empresa_cnpj, arr);
  }

  const achados: unknown[] = [];
  for (const [cnpj, rows] of porEmpresa) {
    rows.sort((a, b) => a.ano - b.ano || a.mes - b.mes);
    const ultima = rows[rows.length - 1];
    if (!ultima) continue;
    const anteriores = rows.slice(Math.max(0, rows.length - 1 - JANELA_RR), rows.length - 1);
    if (anteriores.length < MINIMO_PRESENCAS) continue; // historico curto: nao opina
    for (const { coluna, rotulo } of PRODUTOS_RR) {
      const presencas = anteriores.filter((r) => Math.abs(num(r[coluna])) > EPS).length;
      const agora = Math.abs(num(ultima[coluna])) > EPS;
      if (presencas >= MINIMO_PRESENCAS && !agora) {
        achados.push({
          empresa: nome.get(cnpj) ?? cnpj,
          competencia: compKey(ultima.ano, ultima.mes),
          produto: rotulo,
          coluna,
          presencas_anteriores: `${presencas} de ${anteriores.length}`,
          ultimo_valor: Math.round(num(anteriores[anteriores.length - 1][coluna]) * 100) / 100,
        });
      }
    }
  }

  return [
    {
      id: "rr_produto_descontinuado",
      severity: "alerta",
      count: achados.length,
      descricao:
        `RR: produto que teve valor em pelo menos ${MINIMO_PRESENCAS} das ultimas ${JANELA_RR} ` +
        "competencias e ficou ZERO na mais recente. Nao ha manifesto do que deveria ter " +
        "chegado, entao isto e uma DESCONTINUIDADE a conferir na origem — nota avulsa que " +
        "nao veio, ou aba vazia dentro do arquivo 'Todos'. Nao e prova de falta.",
      detalhe: achados,
    },
  ];
}

/** Os dois lados juntos. Nao lanca por tabela ausente da ADS; erro real sobe. */
export async function detectFechamentoParcial(
  admin: SupabaseClient
): Promise<ChecagemParcial[]> {
  const [ads, rr] = await Promise.all([checarAds(admin), checarRr(admin)]);
  return [...ads, ...rr];
}
