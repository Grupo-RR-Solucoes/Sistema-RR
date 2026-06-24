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
// CONFERÊNCIA MENSAL À VISTA (VIVA) — seção da Auditoria.
// FECHAMENTO-PRIMÁRIO: consome /api/auditoria/avista-viva (universo = CASH pago
// do mês, devido pela TRP). Não exige diária — audita todo mês. SRCC/não-pagos
// ficam fora por construção (não estão no fechamento). A diária, quando existe,
// enriquece (faixa exata + lane "produzido não pago" = reconciliação). Navy kit.
// ============================================================

type Divergencia = {
  contrato: string;
  empresa: string;
  produto: string | null;
  txJuros: number;
  prazo: number;
  valorLiquido: number;
  comissaoPaga: number;
  comissaoDevida: number;
  diferenca: number;
  pctDevido: number | null;
  regraTrp: string;
};

type Payload = {
  meta: { year: number; month: number; ym: string; regime: string; fonte: string };
  universo: {
    total: number;
    srccExcluidos: number;
    faixa: { faixa: string; base: "diaria" | "fechamento"; volume: number };
  };
  resumo: {
    totalAuditados: number;
    somaPaga: number;
    somaDevida: number;
    somaDivergencia: number;
    nSubpagamentos: number;
    porStatus: Record<string, number>;
    batimento: {
      somaCashFechamentoMes: number;
      fmeValorAvista: number | null;
      deltaAbs: number | null;
      deltaPct: number | null;
    };
  };
  reconciliacao: {
    diariaDisponivel: boolean;
    produzidoNaoPago: number;
    nMaduro: number;
    nRecente: number;
  };
  segmentoAConfirmar: {
    total: number;
    itens: {
      operacao: string;
      empresa: string;
      convenio: number | null;
      produto: string | null;
      valorLiquido: number;
      comissaoPaga: number;
    }[];
  };
  divergencias: Divergencia[];
};

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function brl(v?: number | null): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v || 0)
  );
}
function pct(v?: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(2)}%`;
}

const NOW = new Date();
const ANOS = [NOW.getUTCFullYear() - 1, NOW.getUTCFullYear()];

export default function ConferenciaAvistaSection() {
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
    fetch(`/api/auditoria/avista-viva?year=${year}&month=${month}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar conferência."))))
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

  const bat = data?.resumo.batimento;
  const batOk = bat?.deltaPct != null && Math.abs(bat.deltaPct) < 0.01;
  const semFechamento = data != null && data.universo.total === 0;
  const kpis: KpiStat[] = data
    ? [
        { label: "Pago à vista", value: brl(data.resumo.somaPaga) },
        { label: "Devido (TRP)", value: brl(data.resumo.somaDevida) },
        {
          label: "Divergência",
          value: brl(data.resumo.somaDivergencia),
          sub: `${data.resumo.nSubpagamentos} subpagamento(s)`,
          subTone: data.resumo.nSubpagamentos > 0 ? "gold" : "ok",
        },
        {
          label: "Batimento caixa",
          value: bat?.deltaAbs == null ? "—" : brl(bat.deltaAbs),
          sub: bat?.deltaPct == null ? "sem fechamento" : `Δ ${pct(bat.deltaPct)}`,
          subTone: batOk ? "ok" : "amber",
        },
      ]
    : [];

  return (
    <section className="rrcav">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <HeaderNavy
        brand="AUDITORIA"
        title="Conferência mensal à vista"
        actions={
          <div className="cav-comp">
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
        {data && !semFechamento ? (
          <KpiBand items={kpis} columns={4} />
        ) : (
          <p className="cav-navy-hint">
            Pago no fechamento × devido pela TRP da competência, por contrato — direto do fechamento
            (documento oficial do pago).
          </p>
        )}
      </HeaderNavy>

      {loading ? (
        <Card>
          <p className="cav-muted">Auditando {MES[month - 1]}/{year}…</p>
        </Card>
      ) : error ? (
        <Banner variant="warn">{error}</Banner>
      ) : !data ? null : semFechamento ? (
        // Sem fechamento do mês (ainda não importado) — aí sim não há base.
        <Card>
          <Banner variant="warn">
            Sem fechamento mensal de <b>{MES[month - 1]}/{year}</b> importado. A conferência à vista
            usa o fechamento (CASH) como base do pago — importe-o e volte.
          </Banner>
          <EmptyState
            title="Fechamento da competência ainda não disponível"
            description="Diferente da versão anterior, a conferência NÃO depende da diária — só do fechamento, que é a verdade do caixa."
          />
        </Card>
      ) : (
        <>
          {/* UNIVERSO + faixa */}
          <Card title={`Universo · ${MES[month - 1]}/${year} · regime ${data.meta.regime}`}>
            <div className="cav-chips">
              <Chip variant="ok">Fechamento (pago) {data.universo.total}</Chip>
              {data.universo.srccExcluidos > 0 ? (
                <Chip variant="neutral">SRCC excluídos {data.universo.srccExcluidos}</Chip>
              ) : null}
              <Chip variant="neutral">
                Faixa {data.universo.faixa.faixa} (base {data.universo.faixa.base})
              </Chip>
              {data.segmentoAConfirmar.total > 0 ? (
                <Chip variant="warn">Segmento a confirmar {data.segmentoAConfirmar.total}</Chip>
              ) : null}
              {data.reconciliacao.diariaDisponivel ? (
                <Chip variant={data.reconciliacao.nMaduro > 0 ? "warn" : "neutral"}>
                  Produzido não pago {data.reconciliacao.produzidoNaoPago}
                  {data.reconciliacao.produzidoNaoPago > 0
                    ? ` (${data.reconciliacao.nMaduro} maduro / ${data.reconciliacao.nRecente} recente)`
                    : ""}
                </Chip>
              ) : (
                <Chip variant="neutral">Sem diária (faixa via fechamento)</Chip>
              )}
            </div>
            <p className="cav-muted">
              Universo = o que a Promotiva pagou à vista no fechamento. SRCC e não-pagos ficam fora
              por construção (não estão no fechamento).
              {data.reconciliacao.diariaDisponivel && data.reconciliacao.produzidoNaoPago > 0 ? (
                <>
                  {" "}
                  Os {data.reconciliacao.produzidoNaoPago} "produzido não pago" são reconciliação
                  (timing/SRCC/cancelado), <b>não</b> subpagamento.
                </>
              ) : null}
            </p>
          </Card>

          {/* DIVERGÊNCIAS (subpagamentos reais) */}
          <Card title="Divergências — subpagamentos à vista">
            <div className="cav-divhead">
              <span className="cav-muted">
                Contratos onde a Promotiva pagou MENOS que a TRP da competência manda.
              </span>
              {data.divergencias.length > 0 ? (
                <a
                  className="cav-export"
                  href={`/api/auditoria/avista-viva?year=${year}&month=${month}&format=csv`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Exportar divergências (CSV)
                </a>
              ) : null}
            </div>

            {data.divergencias.length === 0 ? (
              <EmptyState
                title="Nenhum subpagamento à vista neste mês"
                description="A Promotiva pagou conforme a TRP da competência. Nada a questionar à vista."
              />
            ) : (
              <Table scrollable>
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Empresa</th>
                    <th>Produto</th>
                    <th className="cav-r">Líquido</th>
                    <th className="cav-r">Pago</th>
                    <th className="cav-r">Devido</th>
                    <th className="cav-r">Diferença</th>
                    <th className="cav-r">% devido</th>
                    <th>Regra TRP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.divergencias.map((d) => (
                    <tr key={d.contrato}>
                      <td>{d.contrato}</td>
                      <td>{d.empresa || "—"}</td>
                      <td>{d.produto ?? "—"}</td>
                      <Num>{brl(d.valorLiquido)}</Num>
                      <Num>{brl(d.comissaoPaga)}</Num>
                      <Num>{brl(d.comissaoDevida)}</Num>
                      <Num className="cav-neg">{brl(d.diferenca)}</Num>
                      <Num>{pct(d.pctDevido)}</Num>
                      <td>{d.regraTrp}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {/* SEGMENTO A CONFIRMAR — convênio fora da tabela, fora da cobrança */}
          {data.segmentoAConfirmar.total > 0 ? (
            <Card title={`Segmento a confirmar (${data.segmentoAConfirmar.total})`}>
              <Banner variant="info">
                Convênio fora da tabela de referência (segmento público/privado desconhecido). Estes
                contratos <b>não entram na cobrança</b> até o segmento ser confirmado — nunca
                presumimos público.
              </Banner>
              <Table scrollable>
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Empresa</th>
                    <th>Convênio</th>
                    <th>Produto</th>
                    <th className="cav-r">Líquido</th>
                    <th className="cav-r">Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {data.segmentoAConfirmar.itens.map((s) => (
                    <tr key={s.operacao}>
                      <td>{s.operacao}</td>
                      <td>{s.empresa || "—"}</td>
                      <td>{s.convenio ?? "—"}</td>
                      <td>{s.produto ?? "—"}</td>
                      <Num>{brl(s.valorLiquido)}</Num>
                      <Num>{brl(s.comissaoPaga)}</Num>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </>
      )}
    </section>
  );
}

const CSS = `
.rrcav{display:flex;flex-direction:column;gap:18px;}
.rrcav .cav-comp{display:flex;gap:8px;}
.rrcav .cav-comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 16px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrcav .cav-comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrcav .cav-navy-hint{color:#AEB8D4;font-size:13px;margin:6px 0 0;}
.rrcav .cav-muted{color:var(--ink-3,#838B9C);font-size:12.5px;margin:8px 0 0;line-height:1.5;}
.rrcav .cav-chips{display:flex;flex-wrap:wrap;gap:8px;}
.rrcav .cav-divhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap;}
.rrcav .cav-export{font-size:12.5px;font-weight:600;color:var(--navy,#0F1F4A);text-decoration:none;border:1px solid var(--bd,#E4E7EC);border-radius:8px;padding:7px 12px;background:#fff;}
.rrcav .cav-export:hover{border-color:var(--navy,#0F1F4A);}
.rrcav th.cav-r,.rrcav .cav-r{text-align:right;}
.rrcav .cav-neg{color:var(--red,#C0443C);}
`;
