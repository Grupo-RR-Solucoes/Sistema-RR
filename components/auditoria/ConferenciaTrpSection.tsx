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
// CONFERÊNCIA TRP × REALIZADO — seção da Auditoria (sub-fase c).
// Consome /api/auditoria/trp-conferencia. A TRP versionada é a RÉGUA (o que
// DEVERIA ser); o realizado (comissaoPaga/valorLiquido do fechamento) é o FATO.
// TETO EMPRESA 6% LISO (NÃO BACEN) — distinta da à-vista viva (teto BACEN por
// categoria). As duas seções ficam lado a lado, cada uma rotulada com sua régua.
// READ-ONLY. Navy kit.
// ============================================================

type ConfStatus = "SUBPAGAMENTO" | "SOBREPAGAMENTO" | "OK" | "NAO_CONFERIVEL";

type Linha = {
  contrato: string;
  empresa: string;
  produto: string | null;
  tipo: string | null;
  prazo: number;
  txJuros: number;
  faixa: string | null;
  valorLiquido: number;
  pctRealizado: number;
  pctRegua: number | null;
  pctTabelaCru: number | null;
  comissaoPaga: number;
  comissaoDevida: number | null;
  diferenca: number | null;
  deltaPct: number | null;
  status: ConfStatus;
  celula: string | null;
  motivo: string | null;
};

type Payload = {
  ym: string;
  regua: {
    fonte: "db" | "json" | null;
    isFallback: boolean;
    competenciaFornecedora: string | null;
  };
  linhas: Linha[];
  resumo: {
    auditados: number;
    subpagamentos: number;
    somaSubpagamento: number;
    sobrepagamentos: number;
    naoConferiveis: number;
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

export default function ConferenciaTrpSection() {
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
    fetch(`/api/auditoria/trp-conferencia?year=${year}&month=${month}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar a conferência TRP."))))
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
  const naoConferiveis = data ? data.linhas.filter((l) => l.status === "NAO_CONFERIVEL") : [];
  const okCount = data
    ? data.resumo.auditados -
      data.resumo.subpagamentos -
      data.resumo.sobrepagamentos -
      data.resumo.naoConferiveis
    : 0;
  const semUniverso = data != null && data.resumo.auditados === 0;

  const fonteLabel =
    data?.regua.fonte === "db"
      ? "Régua versionada (trp_rule_versions)"
      : data?.regua.fonte === "json"
        ? "Régua histórica (JSON)"
        : "Sem régua";

  const kpis: KpiStat[] = data
    ? [
        {
          label: "Subpagamentos",
          value: brl(data.resumo.somaSubpagamento),
          sub: `${data.resumo.subpagamentos} contrato(s) · pagou < 6% devido`,
          subTone: data.resumo.subpagamentos > 0 ? "gold" : "ok",
        },
        {
          label: "Sobrepagamentos",
          value: String(data.resumo.sobrepagamentos),
          sub: "pagou acima do devido",
          subTone: data.resumo.sobrepagamentos > 0 ? "amber" : "ok",
        },
        {
          label: "Conformes (OK)",
          value: String(okCount),
          sub: "dentro da régua",
          subTone: "ok",
        },
        {
          label: "Não-conferíveis",
          value: String(data.resumo.naoConferiveis),
          sub: "sem célula na régua",
          subTone: data.resumo.naoConferiveis > 0 ? "amber" : "ok",
        },
      ]
    : [];

  return (
    <section className="rrctrp" id="conferencia-trp">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <HeaderNavy
        eyebrow="AUDITORIA"
        title="Conferência TRP × realizado"
        subtitle="Régua TRP × pago por competência → pagou menos que devido → R$ a cobrar."
        actions={
          <div className="ctrp-comp">
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
        <p className="ctrp-navy-hint">
          Régua = TRP versionada (o que <b>deveria</b> ser); realizado = o que a Promotiva pagou à
          vista. <b>Teto 6% liso (TRP/empresa)</b> — distinta da à-vista viva, que usa teto BACEN por
          categoria. O <i>% tabela cheia</i> é só referência (pode passar de 6% → diferido).
        </p>
        {data && !semUniverso ? <KpiBand items={kpis} columns={4} /> : null}
      </HeaderNavy>

      {loading ? (
        <Card>
          <p className="ctrp-muted">Conferindo {MES[month - 1]}/{year}…</p>
        </Card>
      ) : error ? (
        <Banner variant="warn">{error}</Banner>
      ) : !data ? null : (
        <>
          {/* RÉGUA + fallback */}
          <Card title={`Régua · ${ymLabel(data.ym)}`}>
            <div className="ctrp-chips">
              <Chip variant={data.regua.fonte === "db" ? "ok" : "neutral"}>{fonteLabel}</Chip>
              {data.regua.isFallback ? <Chip variant="warn">fallback</Chip> : null}
              <Chip variant="neutral">teto 6% liso (empresa)</Chip>
            </div>
            {data.regua.isFallback ? (
              <Banner variant="warn">
                Competência <b>{ymLabel(data.ym)}</b> conferida contra a régua de{" "}
                <b>{ymLabel(data.regua.competenciaFornecedora)}</b> — TRP própria ainda não publicada.
                Números provisórios até a TRP da competência ser confirmada.
              </Banner>
            ) : null}
          </Card>

          {semUniverso ? (
            <Card>
              <EmptyState
                title="Sem universo de fechamento nesta competência"
                description="A conferência usa o fechamento (CASH pago) como base do realizado. Sem fechamento importado do mês, não há o que conferir."
              />
            </Card>
          ) : (
            <>
              {/* DIVERGÊNCIAS (subpagamentos primeiro) */}
              <Card title="Divergências — realizado × régua TRP">
                <div className="ctrp-divhead">
                  <span className="ctrp-muted">
                    Subpagamento = pagou MENOS que o devido pela TRP (teto 6%). Sobrepagamento = pagou
                    a mais. {okCount} conforme(s) omitido(s) da lista.
                  </span>
                  <a
                    className="ctrp-export"
                    href={`/api/auditoria/trp-conferencia?year=${year}&month=${month}&format=csv`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Exportar tudo (CSV)
                  </a>
                </div>

                {divergentes.length === 0 ? (
                  <EmptyState
                    title="Nenhuma divergência nesta competência"
                    description="A Promotiva pagou à vista conforme a régua da TRP (dentro da tolerância). Nada a questionar."
                  />
                ) : (
                  <Table scrollable>
                    <thead>
                      <tr>
                        <th>Contrato</th>
                        <th>Produto</th>
                        <th className="ctrp-r">Prazo</th>
                        <th>Faixa</th>
                        <th className="ctrp-r">% Realiz.</th>
                        <th className="ctrp-r">% Régua</th>
                        <th className="ctrp-r">% Tabela (ref.)</th>
                        <th className="ctrp-r">Paga</th>
                        <th className="ctrp-r">Devida</th>
                        <th className="ctrp-r">Diferença</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {divergentes.map((l) => (
                        <tr key={l.contrato}>
                          <td>{l.contrato}</td>
                          <td>{l.produto ?? "—"}</td>
                          <Num>{l.prazo}</Num>
                          <td>{l.faixa ?? "—"}</td>
                          <Num>{pct(l.pctRealizado)}</Num>
                          <Num>{pct(l.pctRegua)}</Num>
                          <Num
                            className={l.pctTabelaCru != null && l.pctTabelaCru > 0.06 ? "ctrp-cap" : ""}
                            title={
                              l.pctTabelaCru != null && l.pctTabelaCru > 0.06
                                ? "tabela cheia > 6% → excedente vai para diferido/PRT"
                                : undefined
                            }
                          >
                            {pct(l.pctTabelaCru)}
                          </Num>
                          <Num>{brl(l.comissaoPaga)}</Num>
                          <Num>{brl(l.comissaoDevida)}</Num>
                          <Num className={l.status === "SUBPAGAMENTO" ? "ctrp-neg" : "ctrp-pos"}>
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

              {/* NÃO-CONFERÍVEIS (sub-lista separada) */}
              {naoConferiveis.length > 0 ? (
                <Card title={`Não-conferíveis (${naoConferiveis.length})`}>
                  <Banner variant="info">
                    Sem célula na régua para estes contratos (produto/taxa/prazo fora da matriz da
                    competência). <b>Não</b> contam como subpagamento — ficam à parte para
                    investigação.
                  </Banner>
                  <Table scrollable>
                    <thead>
                      <tr>
                        <th>Contrato</th>
                        <th>Produto</th>
                        <th className="ctrp-r">Prazo</th>
                        <th className="ctrp-r">% Realiz.</th>
                        <th className="ctrp-r">Paga</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {naoConferiveis.slice(0, 200).map((l) => (
                        <tr key={l.contrato}>
                          <td>{l.contrato}</td>
                          <td>{l.produto ?? "—"}</td>
                          <Num>{l.prazo}</Num>
                          <Num>{pct(l.pctRealizado)}</Num>
                          <Num>{brl(l.comissaoPaga)}</Num>
                          <td className="ctrp-motivo">{l.motivo ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {naoConferiveis.length > 200 ? (
                    <p className="ctrp-muted">
                      Mostrando 200 de {naoConferiveis.length}. Use o CSV para a lista completa.
                    </p>
                  ) : null}
                </Card>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}

const CSS = `
.rrctrp{display:flex;flex-direction:column;gap:18px;}
.rrctrp .ctrp-comp{display:flex;gap:8px;}
.rrctrp .ctrp-comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 16px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrctrp .ctrp-comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrctrp .ctrp-navy-hint{color:#AEB8D4;font-size:13px;margin:6px 0 14px;line-height:1.55;}
.rrctrp .ctrp-navy-hint b{color:#E4E9F4;}
.rrctrp .ctrp-muted{color:var(--ink-3,#838B9C);font-size:12.5px;margin:8px 0 0;line-height:1.5;}
.rrctrp .ctrp-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}
.rrctrp .ctrp-divhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap;}
.rrctrp .ctrp-export{font-size:12.5px;font-weight:600;color:var(--navy,#0F1F4A);text-decoration:none;border:1px solid var(--bd,#E4E7EC);border-radius:8px;padding:7px 12px;background:#fff;}
.rrctrp .ctrp-export:hover{border-color:var(--navy,#0F1F4A);}
.rrctrp th.ctrp-r,.rrctrp .ctrp-r{text-align:right;}
.rrctrp .ctrp-neg{color:var(--red,#C0443C);}
.rrctrp .ctrp-pos{color:var(--green,#2F855A);}
.rrctrp .ctrp-cap{color:#8A6D00;}
.rrctrp .ctrp-motivo{color:var(--ink-3,#838B9C);font-size:11.5px;max-width:320px;}
`;
