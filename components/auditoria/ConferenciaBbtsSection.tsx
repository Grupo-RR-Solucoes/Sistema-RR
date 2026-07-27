"use client";

import { useEffect, useState } from "react";

import {
  Banner,
  Card,
  Chip,
  EmptyState,
  HeaderNavy,
  KpiBand,
  Num,
  Table,
  UiStyles,
  type KpiStat,
} from "@/components/ui";

// ============================================================
// CONFERÊNCIA BBTS × REALIZADO — seção da Auditoria (ADS).
//
// ESPELHO da Conferência TRP do RR, mesmo contrato mental e mesmos rótulos:
//   RR  : régua = TRP (Promotiva)   · realizado = o que a Promotiva PAGOU
//   ADS : régua = tabela da BBTS    · realizado = o que a BBTS PAGOU
//
// A diferença de conceito: aqui a régua é lida na FAIXA 4 (o acordo comercial do
// Grupo RR/ADS, todos os convênios) e o pagamento tem DUAS pernas — AVT (teto 6%)
// e PRT (o excedente, pago a prazo). A conferência contrato-a-contrato é a do AVT;
// o PRT gerado no mês aparece como direito a receber.
//
// Consome /api/auditoria/bbts-conferencia. READ-ONLY. Navy kit (sem estilo novo).
// ============================================================

type StatusBbts =
  | "SUBPAGAMENTO"
  | "SOBREPAGAMENTO"
  | "OK"
  | "FORA_DA_TABELA"
  | "NAO_PAGO_SRCC"
  | "CANCELADO";

type Linha = {
  contrato: string;
  status: StatusBbts;
  grupo: string | null;
  valorFinanciado: number;
  parcelas: number;
  prazoUsado: number;
  juros: number;
  faixa: string;
  pctTabela: number | null;
  pctAvista: number | null;
  pctDiferido: number | null;
  pctRealizado: number | null;
  devidoAvista: number | null;
  pagoAvista: number;
  diferenca: number | null;
  devidoPrtTotal: number | null;
  devidoPrtMensal: number | null;
  motivo: string | null;
};

type Payload = {
  ym: string;
  regua: {
    competenciaUsada: string;
    isFallback: boolean;
    direcao: "anterior" | "posterior" | null;
    versionNo: number | null;
    aviso: string | null;
  } | null;
  linhas: Linha[];
  prtSemContratoNoUniverso: Array<{ contrato: string; valor: number; n_parcela: number }>;
  resumo: {
    auditados: number;
    ok: number;
    subpagamentos: number;
    sobrepagamentos: number;
    foraDaTabela: number;
    srcc: number;
    cancelados: number;
    somaPagoAvista: number;
    somaDevidoAvista: number;
    somaSubpagamento: number;
    somaSobrepagamento: number;
    somaDevidoPrtGerado: number;
    somaPrtPagoNoMes: number;
  };
};

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function brl(v?: number | null): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0));
}
function pct(v?: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(2).replace(".", ",")}%`;
}
function ymLabel(ym: string | null): string {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  return `${MES[Number(m) - 1]}/${y}`;
}

const NOW = new Date();
const ANOS = [NOW.getUTCFullYear() - 1, NOW.getUTCFullYear()];

export default function ConferenciaBbtsSection() {
  const init = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 1, 1));
  const [year, setYear] = useState(init.getUTCFullYear());
  const [month, setMonth] = useState(init.getUTCMonth() + 1);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    setData(null);
    fetch(`/api/auditoria/bbts-conferencia?year=${year}&month=${month}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar a conferência BBTS."))))
      .then((j) => {
        if (!cancel) setData(j as Payload);
      })
      .catch((e) => {
        if (!cancel) setError(e.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [year, month]);

  const divergentes = data
    ? data.linhas.filter((l) => l.status === "SUBPAGAMENTO" || l.status === "SOBREPAGAMENTO")
    : [];
  const fora = data ? data.linhas.filter((l) => l.status === "FORA_DA_TABELA") : [];
  const conformes = data ? data.linhas.filter((l) => l.status === "OK") : [];

  // Os TRÊS estados vazios que esta tela precisa tratar sem quebrar:
  const semUniverso = data != null && data.resumo.auditados === 0; // fechamento ADS não importado
  const semRegua = data != null && data.regua === null; // tabela da BBTS nunca subida
  const semProduto =
    data != null &&
    !semUniverso &&
    !semRegua &&
    data.resumo.foraDaTabela === data.resumo.auditados; // fechamento antigo, sem produto -> nada roteia

  const kpis: KpiStat[] = data
    ? [
        {
          label: "Deixou de pagar",
          value: brl(Math.abs(data.resumo.somaSubpagamento)),
          sub: `${data.resumo.subpagamentos} contrato(s) · pagou < Faixa 4`,
          subTone: data.resumo.subpagamentos > 0 ? "gold" : "ok",
        },
        {
          label: "Pago × devido",
          value: brl(data.resumo.somaPagoAvista),
          sub: `devido ${brl(data.resumo.somaDevidoAvista)} (à vista, teto 6%)`,
          subTone: data.resumo.somaSubpagamento < 0 ? "amber" : "ok",
        },
        {
          label: "Conformes (OK)",
          value: String(data.resumo.ok),
          sub: "pagou o que a tabela manda",
          subTone: "ok",
        },
        {
          label: "PRT gerado no mês",
          value: brl(data.resumo.somaDevidoPrtGerado),
          sub: "excedente do teto → a receber a prazo",
          subTone: "neutral",
        },
      ]
    : [];

  return (
    <section className="rrcbb" id="conferencia-bbts">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <HeaderNavy
        eyebrow="AUDITORIA · ADS"
        title="Conferência BBTS × realizado"
        subtitle="Tabela da BBTS × pago por competência → pagou menos que o acordo → R$ a cobrar."
        actions={
          <div className="cbb-comp">
            <select aria-label="Mês" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MES.map((l, i) => (
                <option key={i} value={i + 1}>
                  {l}
                </option>
              ))}
            </select>
            <select aria-label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {ANOS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <p className="cbb-navy-hint">
          Espelho da Conferência TRP, do outro lado: régua = <b>tabela da BBTS</b> (o que{" "}
          <b>deveria</b> ser), realizado = o que a <b>BBTS pagou</b>. Lida na <b>Faixa 4</b> — o acordo
          do Grupo RR/ADS, em todos os convênios. Pagamento em duas pernas:{" "}
          <b>à vista (teto 6%)</b> + <b>PRT</b> (o excedente, diluído no prazo). Isto é{" "}
          <b>caixa da empresa</b> — não muda a comissão do promotor, que segue a TRP.
        </p>
        {data && !semUniverso && !semRegua ? <KpiBand items={kpis} columns={4} /> : null}
      </HeaderNavy>

      {loading ? (
        <Card>
          <p className="cbb-muted">
            Conferindo {MES[month - 1]}/{year}…
          </p>
        </Card>
      ) : error ? (
        <Banner variant="warn">{error}</Banner>
      ) : !data ? null : (
        <>
          {/* RÉGUA + fallback */}
          <Card title={`Régua · ${ymLabel(data.ym)}`}>
            <div className="cbb-chips">
              <Chip variant={data.regua ? "ok" : "neutral"}>
                {data.regua
                  ? `Tabela BBTS versionada (v${data.regua.versionNo ?? "?"})`
                  : "Sem tabela BBTS no banco"}
              </Chip>
              {data.regua?.isFallback ? <Chip variant="warn">fallback</Chip> : null}
              <Chip variant="neutral">Faixa 4 (acordo)</Chip>
              <Chip variant="neutral">teto 6% à vista + PRT</Chip>
            </div>
            {data.regua?.isFallback && data.regua.aviso ? (
              <Banner variant="warn">
                Competência <b>{ymLabel(data.ym)}</b> conferida com a tabela de{" "}
                <b>{ymLabel(data.regua.competenciaUsada)}</b>
                {data.regua.direcao === "posterior"
                  ? " — a tabela desta competência não foi subida, então usamos a seguinte."
                  : " — a tabela desta competência não foi subida, então usamos a anterior."}{" "}
                Números provisórios até a tabela da própria competência ser confirmada.
              </Banner>
            ) : null}
          </Card>

          {/* Ordem dos vazios: primeiro o universo (sem fechamento não há o que conferir,
              nem que a régua existisse), depois a régua. */}
          {semUniverso ? (
            <Card>
              <EmptyState
                title="Sem fechamento da ADS nesta competência"
                description="A conferência usa o fechamento da BBTS (o que ela pagou por contrato) como base do realizado. Sem o fechamento importado do mês, não há o que conferir."
              />
            </Card>
          ) : semRegua ? (
            <Card>
              <EmptyState
                title="Nenhuma tabela da BBTS foi subida ainda"
                description="A conferência precisa da régua (a tabela de pagamento da BBTS) para saber o que era devido. Suba o PDF da tabela em Importações → Tabela de pagamento da BBTS (ADS). Sem ela, nada é conferível — e nada aqui vira cobrança."
              />
            </Card>
          ) : (
            <>
              {semProduto ? (
                <Banner variant="warn">
                  Todos os contratos saíram <b>fora da tabela</b>. O sintoma clássico é o fechamento ter
                  sido importado <b>antes</b> da captura do produto — sem <i>produto/convênio</i> não há
                  como rotear o contrato para o grupo da tabela. Reimporte o fechamento da competência e
                  confira de novo.
                </Banner>
              ) : null}

              {/* DIVERGÊNCIAS (subpagamentos primeiro) */}
              <Card title="Divergências — realizado × tabela BBTS (Faixa 4)">
                <div className="cbb-divhead">
                  <span className="cbb-muted">
                    Subpagamento = a BBTS pagou MENOS que o acordo manda (Faixa 4, à vista, teto 6%).
                    Sobrepagamento = pagou a mais. {conformes.length} conforme(s) omitido(s) da lista.
                  </span>
                  <a
                    className="cbb-export"
                    href={`/api/auditoria/bbts-conferencia?year=${year}&month=${month}&format=csv`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Exportar tudo (CSV)
                  </a>
                </div>

                {divergentes.length === 0 ? (
                  <EmptyState
                    title="Nenhuma divergência nesta competência"
                    description="A BBTS pagou conforme a tabela, na Faixa 4 do acordo (dentro da tolerância). Nada a questionar."
                  />
                ) : (
                  <Table scrollable>
                    <thead>
                      <tr>
                        <th>Contrato</th>
                        <th>Grupo</th>
                        <th className="cbb-r">Prazo</th>
                        <th className="cbb-r">% Pago</th>
                        <th className="cbb-r">% Devido (F4)</th>
                        <th className="cbb-r">% Tabela cheia</th>
                        <th className="cbb-r">Financiado</th>
                        <th className="cbb-r">Pago</th>
                        <th className="cbb-r">Devido</th>
                        <th className="cbb-r">Diferença</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {divergentes.map((l) => (
                        <tr key={l.contrato}>
                          <td>{l.contrato}</td>
                          <td>{l.grupo ?? "—"}</td>
                          <Num>{l.prazoUsado}</Num>
                          <Num>{pct(l.pctRealizado)}</Num>
                          <Num>{pct(l.pctAvista)}</Num>
                          <Num
                            className={l.pctTabela != null && l.pctTabela > 0.06 ? "cbb-cap" : ""}
                            title={
                              l.pctTabela != null && l.pctTabela > 0.06
                                ? "tabela cheia > 6% → o excedente é pago a prazo (PRT)"
                                : undefined
                            }
                          >
                            {pct(l.pctTabela)}
                          </Num>
                          <Num>{brl(l.valorFinanciado)}</Num>
                          <Num>{brl(l.pagoAvista)}</Num>
                          <Num>{brl(l.devidoAvista)}</Num>
                          <Num className={l.status === "SUBPAGAMENTO" ? "cbb-neg" : "cbb-pos"}>
                            {brl(l.diferenca)}
                          </Num>
                          <td>
                            <Chip variant={l.status === "SUBPAGAMENTO" ? "warn" : "neutral"}>
                              {l.status === "SUBPAGAMENTO" ? "subpagamento" : "sobrepagamento"}
                            </Chip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>

              {/* FORA DA TABELA — não é alarme */}
              {fora.length > 0 ? (
                <Card title={`Fora da tabela (${fora.length})`}>
                  <Banner variant="info">
                    Sem célula na tabela da BBTS para estes contratos (produto/taxa/prazo fora da
                    matriz da competência). <b>Não</b> contam como subpagamento — ficam à parte para
                    investigação.
                  </Banner>
                  <Table scrollable>
                    <thead>
                      <tr>
                        <th>Contrato</th>
                        <th>Grupo</th>
                        <th className="cbb-r">Prazo</th>
                        <th className="cbb-r">Juros</th>
                        <th className="cbb-r">Pago</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fora.slice(0, 200).map((l) => (
                        <tr key={l.contrato}>
                          <td>{l.contrato}</td>
                          <td>{l.grupo ?? "—"}</td>
                          <Num>{l.prazoUsado}</Num>
                          <Num>{pct(l.juros)}</Num>
                          <Num>{brl(l.pagoAvista)}</Num>
                          <td className="cbb-motivo">{l.motivo ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {fora.length > 200 ? (
                    <p className="cbb-muted">
                      Mostrando 200 de {fora.length}. Use o CSV para a lista completa.
                    </p>
                  ) : null}
                </Card>
              ) : null}

              {/* PRT — a 2a perna */}
              <Card title="PRT — a segunda perna do pagamento">
                <p className="cbb-muted">
                  Pela tabela (pág. 8), o que passa do teto de 6% <b>não</b> se perde: é pago a prazo,
                  &quot;diferença percentual dividida pelo prazo da operação&quot;. Os contratos desta
                  competência geraram <b>{brl(data.resumo.somaDevidoPrtGerado)}</b> de direito a
                  receber. As parcelas que a BBTS pagou no mês (
                  <b>{brl(data.resumo.somaPrtPagoNoMes)}</b>) são de contratos de competências
                  anteriores — {data.prtSemContratoNoUniverso.length} delas sem contrato no universo
                  deste mês. Elas <b>nunca</b> viram subpagamento aqui; a conferência do PRT pago
                  contra a agenda é frente própria.
                </p>
              </Card>
            </>
          )}
        </>
      )}
    </section>
  );
}

const CSS = `
.rrcbb{display:flex;flex-direction:column;gap:18px;}
.rrcbb .cbb-comp{display:flex;gap:8px;}
.rrcbb .cbb-comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 16px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrcbb .cbb-comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrcbb .cbb-navy-hint{color:#AEB8D4;font-size:13px;margin:6px 0 14px;line-height:1.55;}
.rrcbb .cbb-navy-hint b{color:#E4E9F4;}
.rrcbb .cbb-muted{color:var(--ink-3,#838B9C);font-size:12.5px;margin:8px 0 0;line-height:1.5;}
.rrcbb .cbb-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}
.rrcbb .cbb-divhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap;}
.rrcbb .cbb-export{font-size:12.5px;font-weight:600;color:var(--navy,#0F1F4A);text-decoration:none;border:1px solid var(--bd,#E4E7EC);border-radius:8px;padding:7px 12px;background:#fff;}
.rrcbb .cbb-export:hover{border-color:var(--navy,#0F1F4A);}
.rrcbb th.cbb-r,.rrcbb .cbb-r{text-align:right;}
.rrcbb .cbb-neg{color:var(--red,#C0443C);}
.rrcbb .cbb-pos{color:var(--green,#2F855A);}
.rrcbb .cbb-cap{color:#8A6D00;}
.rrcbb .cbb-motivo{color:var(--ink-3,#838B9C);font-size:11.5px;max-width:320px;}
`;
