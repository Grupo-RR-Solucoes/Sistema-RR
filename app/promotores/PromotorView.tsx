"use client";

import { useEffect, useMemo, useState } from "react";

import { getSrccEstado } from "@/lib/proposalDetailing";

type PeriodOption = {
  key: string;
  label: string;
  year: number;
  month: number;
};

type ProposalRow = {
  id: string;
  contract_number: string;
  proposal_number: string;
  agency_code: string;
  j_key: string;
  promoter_name: string;
  product_description: string;
  status: string;
  movement_date?: string | null;
  contract_date?: string | null;
  interest_rate: number;
  installment_count: number;
  company_received_percent: number;
  company_commission_amount: number;
  srcc_restriction: string;
  net_value: number;
  gross_value: number;
  insurance_value: number;
  company_insurance_commission_amount: number;
  insurance_penetration_percent: number;
  promoter_commission_percent: number;
  promoter_commission_amount: number;
  insurance_commission_percent: number;
  insurance_commission_amount: number;
};

type PromoterSummaryRow = {
  promoter_id: string;
  promoter_name: string;
  production_value: number;
  target_value: number;
  insurance_penetration_percent: number;
  final_commission_value: number;
  payable_commission_value: number;
  // Produtos (M2a/M2b) — repasse ja incluso no final_commission_value.
  bbcap_commission_value?: number;
  conta_corrente_commission_value?: number;
  consorcio_commission_value?: number;
};

type ConsorcioParcela = {
  proposta: string;
  posicao: number;
  segmento_grupo: string | null;
  teto_parcelas: number;
  valor_bem: number;
  status: string;
  competencia_recebida: string | null;
  repasse: number;
  recebida: boolean;
};
type ConsorcioCarteira = {
  rows: ConsorcioParcela[];
  resumo: {
    parcelas_recebidas: number;
    parcelas_a_vir: number;
    propostas: number;
    repasse_recebido: number;
    repasse_a_vir: number;
  };
};

type PromotorPayload = {
  periods: PeriodOption[];
  selectedPeriod: PeriodOption;
  summaryRows: PromoterSummaryRow[];
  proposalRows: ProposalRow[];
  proposalSource?: "daily" | "cms"; // 'cms' = mes fechado (ground truth, somente leitura)
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatCurrency(value: number | null | undefined) {
  return currencyFormatter.format(Number(value ?? 0));
}

// CHAVE COLETIVA 552710 (JJ/JJJ): o VALOR conta normalmente, mas a identificacao
// (contrato) e ocultada SO nesta tela de carteira do promotor.
function isColetivaJKey(jKey: string | null | undefined) {
  return /^J+552710$/.test(
    String(jKey ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()
  );
}
const COLETIVA_MASK = "—";

function norm(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

// Regra de cor da carteira (Etapa 8):
//   red    = proposta com restricao SRCC ("Sim") -> sem comissao, nao paga.
//   orange = SRCC pendente ("Consulta nao realizada por problemas tecnicos")
//            -> pode cair em restricao depois e vir sem pagamento.
//   normal = paga normalmente.
//   dashed = a gestora nao mandou a coluna de SRCC (as 30 linhas da ADS).
//            Ausencia de informacao, nao negativa.
type SrccState = "red" | "orange" | "dashed" | "normal";

/**
 * Delega a lib/proposalDetailing, que e a casa da regra e atende as DUAS
 * gestoras. Esta tela tinha a sua propria classificacao por texto, que nao
 * conhecia os CODIGOS NUMERICOS da BBTS — a mesma linha da ADS saia "2" aqui e
 * "Não" em /comissoes/editar.
 *
 * As duas guardas antigas por texto ("RESTRITO", "COM RESTRICAO") ficam como
 * rede: sao variantes que a lib nao mapeia e que podem existir em dado velho.
 */
function classifySrcc(row: ProposalRow): SrccState {
  const estado = getSrccEstado({
    raw_payload: { "Restricao SRCC": row.srcc_restriction },
  });
  if (estado === "restrito") return "red";
  if (estado === "indefinido") return "orange";
  if (estado === "sem-info") return "dashed";
  const s = norm(row.srcc_restriction);
  if (s === "RESTRITO" || s === "COM RESTRICAO") return "red";
  return "normal";
}

export default function PromotorView() {
  const [data, setData] = useState<PromotorPayload | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [carteira, setCarteira] = useState<ConsorcioCarteira | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        // ISOLAMENTO: o fetch envia SO year/month. O servidor resolve o
        // promotor pela sessao (RLS + id forcado), nunca por promoterId.
        const params = new URLSearchParams();
        if (selectedKey) {
          const [year, month] = selectedKey.split("-");
          if (year) params.set("year", year);
          if (month) params.set("month", String(Number(month)));
        }

        const response = await fetch(
          `/api/promotores${params.toString() ? `?${params.toString()}` : ""}`
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Erro ao carregar seu relatório.");
        }

        if (!cancelled) {
          setData(payload as PromotorPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao carregar seu relatório.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  // Carteira de consorcio (a vida inteira da carteira, nao so a competencia): o
  // servidor resolve o promotor pela sessao. Falha silenciosa (produto opcional).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/promotores/consorcio-carteira")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ConsorcioCarteira | null) => {
        if (!cancelled && j) setCarteira(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = data?.summaryRows[0] ?? null;
  const proposals = data?.proposalRows ?? [];
  const currentKey = selectedKey || data?.selectedPeriod.key || "";
  const isClosed = data?.proposalSource === "cms";
  const periodLabel =
    data?.periods.find((p) => p.key === currentKey)?.label ||
    data?.selectedPeriod.label ||
    "";

  const totals = useMemo(() => {
    const comissaoPromotor = proposals.reduce(
      (sum, row) => sum + Number(row.promoter_commission_amount ?? 0),
      0
    );
    const comissaoSeguro = proposals.reduce(
      (sum, row) => sum + Number(row.insurance_commission_amount ?? 0),
      0
    );
    return {
      comissaoPromotor,
      comissaoSeguro,
      total: comissaoPromotor + comissaoSeguro,
    };
  }, [proposals]);

  const metaInfo = useMemo(() => {
    if (!summary) return null;
    if (!summary.target_value || summary.target_value <= 0) return null;
    const target = summary.target_value;
    const achieved = summary.production_value;
    const pct = target > 0 ? (achieved / target) * 100 : 0;
    return {
      target,
      achieved,
      pct,
      atingida: achieved >= target,
      diff: achieved - target,
    };
  }, [summary]);

  const periodShort = (() => {
    const m = periodLabel.match(/(\w+)\/(\d{4})/);
    return m ? `${m[1]}/${m[2]}` : periodLabel;
  })();

  return (
    <div className="rrcart">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        {/* HEADER */}
        <header className="header">
          <div className="header-top">
            <div>
              <p className="brand">GRUPO RR CRED</p>
              <h1>{summary?.promoter_name || "Minha carteira"}</h1>
              <p className="role">Minha carteira</p>
            </div>
            <div className="comp">
              <select
                aria-label="Competência"
                value={currentKey}
                onChange={(event) => setSelectedKey(event.target.value)}
              >
                {(data?.periods ?? []).map((period) => (
                  <option key={period.key} value={period.key}>
                    {period.label}
                  </option>
                ))}
              </select>
              <span className="chev">▾</span>
            </div>
          </div>
        </header>

        {error ? <div className="errbox">{error}</div> : null}

        {/* META BANNER */}
        {metaInfo ? (
          <section className={`meta ${metaInfo.atingida ? "ok" : "low"}`}>
            <div className="meta-top">
              <div className="status">
                <span className="dot" />
                {metaInfo.atingida ? "Meta atingida" : "Meta não atingida"}
              </div>
              <div className="vals">
                Produção <b className="num">{formatCurrency(metaInfo.achieved)}</b> · Meta{" "}
                <b className="num">{formatCurrency(metaInfo.target)}</b>
              </div>
            </div>
            <div className="track">
              <div
                className="fill"
                style={{ width: `${Math.min(100, Math.max(0, metaInfo.pct))}%` }}
              />
            </div>
            <div className="meta-foot">
              <span>{metaInfo.pct.toFixed(0)}% da meta</span>
              <span>
                {metaInfo.diff >= 0
                  ? `+${formatCurrency(metaInfo.diff)} acima`
                  : `${formatCurrency(metaInfo.diff)} abaixo`}
              </span>
            </div>
          </section>
        ) : null}

        {/* INFO BANNER (mes fechado) */}
        {isClosed ? (
          <div className="info">
            <span className="ic">i</span>
            <span>
              <b>Valores finais consolidados</b> — competência {periodShort} fechada. Sem
              alterações pendentes.
            </span>
          </div>
        ) : null}

        {/* PROPOSALS */}
        <section className="card">
          <div className="card-head">
            <h2>Minhas propostas{periodShort ? ` · ${periodShort}` : ""}</h2>
            <p className="csub">Comissão por contrato</p>
          </div>
          {loading ? (
            <div className="state">Carregando seu relatório…</div>
          ) : proposals.length === 0 ? (
            <div className="state">
              {isClosed
                ? "Sem produção no cms deste mês (mês fechado)."
                : "Nenhuma proposta encontrada nesta competência."}
            </div>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l sticky">Contrato</th>
                    <th className="l">Produto</th>
                    <th>Valor</th>
                    <th>Comissão PF</th>
                    <th>Comissão seguro</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((row) => {
                    const state = classifySrcc(row);
                    const coletiva = isColetivaJKey(row.j_key);
                    const contract = coletiva
                      ? COLETIVA_MASK
                      : row.contract_number || row.proposal_number || "-";
                    const pf = Number(row.promoter_commission_amount ?? 0);
                    const seg = Number(row.insurance_commission_amount ?? 0);
                    const total = pf + seg;
                    const rowClass =
                      state === "red" ? "r-red" : state === "orange" ? "r-orange" : "";
                    return (
                      <tr key={row.id} className={rowClass}>
                        <td className="l sticky ctr" data-l="Contrato">
                          {contract}
                          {state === "red" ? (
                            <span className="tag">sem comissão</span>
                          ) : state === "orange" ? (
                            <span className="tag">SRCC pendente</span>
                          ) : state === "dashed" ? (
                            // A gestora nao mandou a coluna de SRCC. Nao e
                            // negativa: e dado que nunca chegou.
                            <span
                              className="tag semsrcc"
                              title="A gestora não enviou a informação de restrição SRCC desta proposta."
                            >
                              sem SRCC
                            </span>
                          ) : null}
                        </td>
                        <td className="l" data-l="Produto">
                          {row.product_description || "-"}
                        </td>
                        <td className="num" data-l="Valor">
                          {formatCurrency(row.net_value)}
                        </td>
                        <td className={`num${pf > 0 ? "" : " dash"}`} data-l="Comissão PF">
                          {pf > 0 ? formatCurrency(pf) : "—"}
                        </td>
                        <td className={`num${seg > 0 ? "" : " dash"}`} data-l="Comissão seguro">
                          {seg > 0 ? formatCurrency(seg) : "—"}
                        </td>
                        <td className={`num pay${total > 0 ? "" : " dash"}`} data-l="Total">
                          {formatCurrency(total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="sumline">
                    <td className="l" colSpan={3} data-l="Comissões PF">
                      Comissões PF
                    </td>
                    <td className="num" data-l="">
                      {formatCurrency(totals.comissaoPromotor)}
                    </td>
                    <td className="num dash" data-l="">
                      —
                    </td>
                    <td className="num" data-l="Subtotal">
                      {formatCurrency(totals.comissaoPromotor)}
                    </td>
                  </tr>
                  <tr className="sumline">
                    <td className="l" colSpan={3} data-l="Comissões seguro">
                      Comissões seguro
                    </td>
                    <td className="num dash" data-l="">
                      —
                    </td>
                    <td className="num" data-l="">
                      {formatCurrency(totals.comissaoSeguro)}
                    </td>
                    <td className="num" data-l="Subtotal">
                      {formatCurrency(totals.comissaoSeguro)}
                    </td>
                  </tr>
                  <tr className="total">
                    <td className="l" colSpan={5} data-l="Total geral">
                      Total geral a receber
                    </td>
                    <td className="num" data-l="Total">
                      {formatCurrency(totals.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* LEGEND */}
        {proposals.length > 0 ? (
          <div className="legend">
            <div className="li">
              <span className="sw normal" />
              <span>Proposta paga normalmente.</span>
            </div>
            <div className="li">
              <span className="sw orange" />
              <span>
                <b>SRCC pendente</b> — consulta não realizada por problema técnico. Pode
                cair em restrição depois e vir sem pagamento.
              </span>
            </div>
            <div className="li">
              <span className="sw red" />
              <span>
                <b>Sem comissão</b> — proposta com restrição. Não houve pagamento.
              </span>
            </div>
          </div>
        ) : null}

        {/* PRODUTOS — repasse dos produtos (BBCAP / Conta Corrente / Consórcio) */}
        {summary &&
        ((summary.bbcap_commission_value ?? 0) > 0 ||
          (summary.conta_corrente_commission_value ?? 0) > 0 ||
          (summary.consorcio_commission_value ?? 0) > 0) ? (
          <section className="card">
            <div className="card-head">
              <h2>Meus produtos{periodShort ? ` · ${periodShort}` : ""}</h2>
              <p className="csub">Repasse de produtos (já somado no total do mês)</p>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l sticky">Produto</th>
                    <th>Repasse</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="l sticky" data-l="Produto">BBCAP (capitalização)</td>
                    <td className={`num${(summary.bbcap_commission_value ?? 0) > 0 ? "" : " dash"}`} data-l="Repasse">
                      {(summary.bbcap_commission_value ?? 0) > 0 ? formatCurrency(summary.bbcap_commission_value) : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="l sticky" data-l="Produto">Conta Corrente</td>
                    <td className={`num${(summary.conta_corrente_commission_value ?? 0) > 0 ? "" : " dash"}`} data-l="Repasse">
                      {(summary.conta_corrente_commission_value ?? 0) > 0 ? formatCurrency(summary.conta_corrente_commission_value) : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="l sticky" data-l="Produto">Consórcio</td>
                    <td className={`num${(summary.consorcio_commission_value ?? 0) > 0 ? "" : " dash"}`} data-l="Repasse">
                      {(summary.consorcio_commission_value ?? 0) > 0 ? formatCurrency(summary.consorcio_commission_value) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* CARTEIRA DE CONSÓRCIO — parcelas recebidas × a vir (diferido) */}
        {carteira && carteira.rows.length > 0 ? (
          <section className="card">
            <div className="card-head">
              <h2>Carteira de consórcio</h2>
              <p className="csub">
                {carteira.resumo.propostas} proposta(s) · {carteira.resumo.parcelas_recebidas} parcela(s)
                recebida(s) · {carteira.resumo.parcelas_a_vir} a vir · repasse recebido{" "}
                {formatCurrency(carteira.resumo.repasse_recebido)} · projetado a vir{" "}
                {formatCurrency(carteira.resumo.repasse_a_vir)}
              </p>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l sticky">Proposta</th>
                    <th className="l">Segmento</th>
                    <th>Parcela</th>
                    <th>Situação</th>
                    <th>Meu repasse</th>
                  </tr>
                </thead>
                <tbody>
                  {carteira.rows.map((p) => (
                    <tr key={`${p.proposta}|${p.posicao}`}>
                      <td className="l sticky ctr" data-l="Proposta">{p.proposta}</td>
                      <td className="l" data-l="Segmento">{p.segmento_grupo === "IMOVEL" ? "Imóvel" : "Geral"}</td>
                      <td className="num" data-l="Parcela">{p.posicao}ª / {p.teto_parcelas}</td>
                      <td className="l" data-l="Situação">
                        {p.status === "RECEBIDA" || p.status === "ENCERRADA"
                          ? `recebida${p.competencia_recebida ? ` (${p.competencia_recebida})` : ""}`
                          : p.status === "NAO_VEIO"
                            ? "não veio"
                            : "a vir"}
                      </td>
                      <td className={`num${p.repasse > 0 ? "" : " dash"}`} data-l="Meu repasse">
                        {p.repasse > 0 ? formatCurrency(p.repasse) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

const CSS = `
.rrcart{
  --navy:#0F1F4A; --navy-deep:#0B1838;
  --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A;
  --green:#3C9D6B; --green-soft:#5FB98A; --green-bg:#E9F5EE;
  --red:#C0443C; --red-bg:#FBECEB; --red-line:#FBF1F0;
  --orange:#C77A1A; --orange-bg:#FCF3E4; --orange-line:#FDF7EC;
  --amber:#B07A12; --amber-bg:#FBF1DC; --amber-bd:#EAD7A6;
  --info:#2A6FDB; --info-bg:#EAF1FC; --info-bd:#CFE0F7;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);
  font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrcart *{box-sizing:border-box;}
.rrcart .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrcart .wrap{max-width:920px;margin:0 auto;padding:34px 28px 56px;display:flex;flex-direction:column;gap:20px;}

.rrcart .header{background:var(--navy);border-radius:var(--r-lg);padding:28px 32px 30px;color:#fff;position:relative;overflow:hidden;}
.rrcart .header::after{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--gold),rgba(214,161,63,0));opacity:.55;}
.rrcart .header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;}
.rrcart .brand{font-size:11.5px;font-weight:600;letter-spacing:.18em;color:var(--yellow);margin:0 0 7px;}
.rrcart .header h1{font-size:25px;font-weight:600;letter-spacing:-.01em;margin:0;color:#fff;}
.rrcart .header .role{font-size:12.5px;color:#9DA9C6;margin:6px 0 0;}
.rrcart .comp{position:relative;}
.rrcart .comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 36px 8px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrcart .comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrcart .comp select option{color:#16203A;}
.rrcart .comp .chev{position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9DA9C6;font-size:11px;}

.rrcart .errbox{background:var(--red-bg);border:1px solid #E9B7B2;color:#8E2F28;border-radius:var(--r-md);padding:12px 16px;font-size:13px;}

.rrcart .meta{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:22px 26px;}
.rrcart .meta-top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;}
.rrcart .meta .status{display:flex;align-items:center;gap:9px;font-size:15.5px;font-weight:600;white-space:nowrap;}
.rrcart .meta .status .dot{width:9px;height:9px;border-radius:50%;}
.rrcart .meta.ok .status{color:var(--green);}
.rrcart .meta.ok .status .dot{background:var(--green);box-shadow:0 0 0 3px var(--green-bg);}
.rrcart .meta.low .status{color:var(--amber);}
.rrcart .meta.low .status .dot{background:var(--amber);box-shadow:0 0 0 3px var(--amber-bg);}
.rrcart .meta .vals{font-size:13px;color:var(--ink-3);}
.rrcart .meta .vals b{color:var(--ink);font-weight:600;}
.rrcart .track{height:12px;border-radius:999px;background:#EEF0F4;overflow:hidden;position:relative;}
.rrcart .fill{height:100%;border-radius:999px;}
.rrcart .meta.ok .fill{background:var(--green);}
.rrcart .meta.low .fill{background:var(--amber);}
.rrcart .meta-foot{display:flex;justify-content:space-between;font-size:11.5px;color:var(--ink-3);margin-top:8px;}

.rrcart .info{display:flex;align-items:center;gap:11px;background:var(--info-bg);border:1px solid var(--info-bd);border-radius:var(--r-md);padding:12px 16px;font-size:13px;color:#1E4E9E;}
.rrcart .info .ic{flex:none;width:20px;height:20px;border-radius:50%;background:#2A6FDB;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:700;}
.rrcart .info b{font-weight:600;}

.rrcart .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);}
.rrcart .card-head{padding:20px 24px 14px;}
.rrcart .card-head h2{font-size:15.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrcart .card-head .csub{font-size:12px;color:var(--ink-3);margin:4px 0 0;}
.rrcart .state{padding:26px 24px;font-size:13.5px;color:var(--ink-3);}

.rrcart .scroll{overflow-x:auto;}
.rrcart table{border-collapse:collapse;width:100%;min-width:680px;font-size:13.5px;}
.rrcart thead th{font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3);text-align:right;padding:0 16px 11px;border-bottom:1px solid var(--bd);white-space:nowrap;background:var(--card);}
.rrcart thead th.l{text-align:left;}
.rrcart tbody td{padding:13px 16px;border-bottom:1px solid var(--bd-soft);text-align:right;white-space:nowrap;color:var(--ink);}
.rrcart tbody td.l{text-align:left;}
.rrcart .sticky{position:sticky;left:0;z-index:2;background:var(--card);}
.rrcart thead th.sticky{z-index:3;}
.rrcart .sticky::after{content:"";position:absolute;top:0;right:0;width:14px;height:100%;transform:translateX(100%);background:linear-gradient(90deg,rgba(15,31,74,.06),rgba(15,31,74,0));pointer-events:none;}
.rrcart .ctr{font-weight:600;}
.rrcart .pay{font-weight:600;}
.rrcart .tag{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;margin-left:7px;vertical-align:middle;}
/* "sem SRCC" — tracejado, para nao passar por negativa conhecida nem gritar
   como o pendente. Mesmo tratamento visual da etiqueta em /comissoes/editar. */
.rrcart .tag.semsrcc{background:transparent;border:1px dashed var(--bd,#E4E7EC);color:var(--ink-3,#838B9C);font-style:italic;font-weight:500;cursor:help;}

.rrcart tr.r-red td{background:var(--red-line);}
.rrcart tr.r-red td.sticky{background:var(--red-line);}
.rrcart tr.r-red .ctr{color:var(--red);}
.rrcart tr.r-red .tag{color:var(--red);background:var(--red-bg);}
.rrcart tr.r-orange td{background:var(--orange-line);}
.rrcart tr.r-orange td.sticky{background:var(--orange-line);}
.rrcart tr.r-orange .ctr{color:var(--orange);}
.rrcart tr.r-orange .tag{color:var(--orange);background:var(--orange-bg);}
.rrcart .dash{color:var(--ink-3);}

.rrcart tfoot td{padding:12px 16px;text-align:right;white-space:nowrap;}
.rrcart tfoot tr.sumline td{border-top:1px solid var(--bd-soft);font-weight:500;color:var(--ink-2);}
.rrcart tfoot tr.total td{border-top:1.5px solid var(--bd);font-weight:700;color:var(--ink);font-size:15px;}
.rrcart tfoot td.l{text-align:left;}

.rrcart .legend{display:flex;gap:22px;flex-wrap:wrap;font-size:12px;color:var(--ink-2);padding:8px 4px 0;}
.rrcart .legend .li{display:flex;align-items:center;gap:8px;max-width:380px;}
.rrcart .legend .sw{flex:none;width:14px;height:14px;border-radius:4px;border:1px solid rgba(0,0,0,.07);}
.rrcart .legend .sw.red{background:var(--red-line);border-color:#F1CFCC;}
.rrcart .legend .sw.orange{background:var(--orange-line);border-color:#F0DFC0;}
.rrcart .legend .sw.normal{background:#fff;}

@media (max-width:720px){
  .rrcart .wrap{padding:18px 14px 40px;gap:16px;}
  .rrcart .header{padding:22px 18px 22px;}
  .rrcart .header h1{font-size:21px;}
  .rrcart .meta{padding:18px 18px;}
  .rrcart .card-head{padding:18px 16px 12px;}

  .rrcart table,.rrcart thead,.rrcart tbody,.rrcart tfoot,.rrcart tr,.rrcart th,.rrcart td{display:block;}
  .rrcart table{min-width:0;}
  .rrcart thead{display:none;}
  .rrcart tbody tr{border:1px solid var(--bd);border-radius:12px;margin-bottom:12px;padding:4px 14px;overflow:hidden;}
  .rrcart tbody tr.r-red{border-color:#EBC4C0;}
  .rrcart tbody tr.r-orange{border-color:#EAD4AC;}
  .rrcart tbody td{display:flex;justify-content:space-between;align-items:center;gap:16px;text-align:right;padding:10px 0;border-bottom:1px solid var(--bd-soft);white-space:normal;}
  .rrcart tbody td:last-child{border-bottom:none;}
  .rrcart tbody td.sticky{position:static;box-shadow:none!important;}
  .rrcart tbody td.sticky::after{display:none;}
  .rrcart tbody td::before{content:attr(data-l);font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-3);text-align:left;}
  .rrcart .tag{margin-left:0;}
  .rrcart tfoot{display:block;margin-top:4px;}
  .rrcart tfoot tr{display:flex;justify-content:space-between;padding:10px 2px;}
  .rrcart tfoot td{padding:0;border:none!important;}
  .rrcart tfoot td::before{content:attr(data-l);font-weight:600;color:var(--ink-2);}
  .rrcart tfoot tr.total{border-top:1.5px solid var(--bd);}
  .rrcart .legend{flex-direction:column;gap:11px;}
}
`;
