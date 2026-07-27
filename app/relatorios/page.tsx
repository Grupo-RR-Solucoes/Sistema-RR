"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "../../lib/auth/useUser";
import { UiStyles, HeaderNavy } from "@/components/ui";

type ReportType = "financeiro" | "fechamento" | "auditoria" | "promotores" | "seguro";
type Visao = "geral" | "individual" | "lote";
type TeamOrder = "percent" | "receber" | "producao";
type LoteMode = "zip" | "abas";

type PeriodOption = { key: string; label: string; year: number; month: number };
type LookupOption = { id: string; name: string };

type ReportPreviewPayload = {
  reportType: ReportType;
  title: string;
  description: string;
  periods: PeriodOption[];
  selectedPeriod: PeriodOption | null;
  selectedCompanyId: string;
  selectedPromoterId: string;
  companies: LookupOption[];
  promoters: LookupOption[];
  sections: string[];
};

const emptyPayload: ReportPreviewPayload = {
  reportType: "financeiro",
  title: "",
  description: "",
  periods: [],
  selectedPeriod: null,
  selectedCompanyId: "",
  selectedPromoterId: "",
  companies: [],
  promoters: [],
  sections: [],
};

type TypeDef = { id: ReportType; label: string; desc: string; icon: JSX.Element };

const TYPE_DEFS: TypeDef[] = [
  {
    id: "financeiro",
    label: "Financeiro",
    desc: "Caixa, despesas e recebido consolidado",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.2 9a2.4 2.4 0 0 1 2.8-1.6c1.3 0 2 .8 2 1.7 0 2.2-4 1.3-4 3.5 0 .9.8 1.7 2 1.7a2.4 2.4 0 0 0 2.4-1.4" />
      </svg>
    ),
  },
  {
    id: "fechamento",
    label: "Fechamento",
    desc: "Previsto vs. recebido por empresa",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h16v14H4z" />
        <path d="M4 9h16" />
        <path d="M9 13l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: "auditoria",
    label: "Auditoria",
    desc: "Recuperável e divergências PRT",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
    ),
  },
  {
    id: "promotores",
    label: "Promotores",
    desc: "Metas, produção e comissões",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path d="M16 8.5a3 3 0 0 1 0 5.5M21 19a5 5 0 0 0-3.5-4.8" />
      </svg>
    ),
  },
  {
    id: "seguro",
    label: "Seguro / Seguridade",
    desc: "Comissão de seguro por promotor, empresa e contrato",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
];

function isClosedPeriod(p: { year: number; month: number }) {
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  return p.year < cy || (p.year === cy && p.month < cm);
}

export default function RelatoriosPage() {
  const { user } = useUser();
  const isFunc = user?.role === "funcionario";

  const [reportType, setReportType] = useState<ReportType>("financeiro");
  const [selectedKey, setSelectedKey] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [promoterId, setPromoterId] = useState("");
  const [visao, setVisao] = useState<Visao>("geral");
  const [order, setOrder] = useState<TeamOrder>("percent");
  const [loteMode, setLoteMode] = useState<LoteMode>("zip");
  const [data, setData] = useState<ReportPreviewPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // Func só pode ver/gerar Promotores (financeiro/fechamento/auditoria = dados da
  // empresa, socio-only). Força o tipo e esconde os demais.
  useEffect(() => {
    if (isFunc && reportType !== "promotores") {
      setReportType("promotores");
    }
  }, [isFunc, reportType]);

  // troca de tipo limpa o recorte específico de promotores
  useEffect(() => {
    setCompanyId("");
    setPromoterId("");
    setVisao("geral");
  }, [reportType]);

  const apiScope = visao === "lote" ? "individual" : visao;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const params = new URLSearchParams({ type: reportType });
        if (selectedKey) {
          const [year, month] = selectedKey.split("-");
          params.set("year", year);
          params.set("month", month);
        }
        if (reportType === "promotores") {
          params.set("scope", apiScope);
          if (companyId) params.set("companyId", companyId);
          if (promoterId) params.set("promoterId", promoterId);
        }
        const response = await fetch(`/api/relatorios?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Erro ao carregar relatórios.");
        if (!cancelled) setData(payload || emptyPayload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar relatórios.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reportType, selectedKey, companyId, promoterId, apiScope]);

  // DEFAULT de competência = último mês FECHADO (heurística de data: mês corrente
  // = aberto/parcial; o relatório abre no último consolidado).
  useEffect(() => {
    if (selectedKey || data.periods.length === 0) return;
    const closed = data.periods.filter(isClosedPeriod);
    const pick = closed.reduce<PeriodOption | null>((best, p) => {
      if (!best) return p;
      return p.year > best.year || (p.year === best.year && p.month > best.month) ? p : best;
    }, null);
    const target = pick?.key || data.selectedPeriod?.key || "";
    if (target) setSelectedKey(target);
  }, [data.periods, data.selectedPeriod?.key, selectedKey]);

  useEffect(() => {
    if (reportType !== "promotores") return;
    if (!companyId && data.selectedCompanyId) setCompanyId(data.selectedCompanyId);
    if (!promoterId && data.selectedPromoterId && visao === "individual") {
      setPromoterId(data.selectedPromoterId);
    }
  }, [reportType, companyId, promoterId, visao, data.selectedCompanyId, data.selectedPromoterId]);

  const periodKey = selectedKey || data.selectedPeriod?.key || "";
  const selectedPeriod = data.periods.find((p) => p.key === periodKey) || data.selectedPeriod;
  const periodOpen = selectedPeriod ? !isClosedPeriod(selectedPeriod) : false;
  const visibleTypes = isFunc ? TYPE_DEFS.filter((t) => t.id === "promotores") : TYPE_DEFS;

  function exportHref(format: "pdf" | "xlsx", scope?: "geral" | "individual") {
    const params = new URLSearchParams({ type: reportType, format });
    if (periodKey) {
      const [year, month] = periodKey.split("-");
      params.set("year", year);
      params.set("month", month);
    }
    if (reportType === "promotores") {
      if (companyId) params.set("companyId", companyId);
      if (scope) params.set("scope", scope);
      if (scope === "individual" && promoterId) params.set("promoterId", promoterId);
      if (scope === "geral") params.set("order", order);
    }
    return `/api/relatorios/export?${params.toString()}`;
  }

  function loteHref() {
    const params = new URLSearchParams();
    if (periodKey) {
      const [year, month] = periodKey.split("-");
      params.set("ano", year);
      params.set("mes", month);
    }
    if (companyId) params.set("companyId", companyId);
    params.set("modo", loteMode);
    return `/api/relatorios/export-lote?${params.toString()}`;
  }

  // ---- conteúdo do passo Conferir (título/descrição reais do export) ----
  const conf = useMemo(() => {
    if (reportType === "promotores" && visao === "lote") {
      return {
        title: "Relatório de Promotores · Lote",
        desc:
          "Gera o extrato individual de todos os promotores do filtro de uma vez — pronto para envio. Quem não produziu sai com relatório zerado.",
        sections: data.sections,
      };
    }
    return { title: data.title, desc: data.description, sections: data.sections };
  }, [reportType, visao, data.title, data.description, data.sections]);

  const scopeWord = (() => {
    if (reportType !== "promotores") return "Grupo";
    const emp = companyId ? data.companies.find((c) => c.id === companyId)?.name || "Empresa" : "Todas as empresas";
    if (visao === "geral") return `Equipe · ${emp}`;
    if (visao === "individual") {
      const nome = data.promoters.find((p) => p.id === promoterId)?.name;
      return `Individual · ${nome || "—"}`;
    }
    return `Lote · ${data.promoters.length || "todos"} promotores`;
  })();

  const formatWord = (() => {
    if (reportType !== "promotores") return "PDF + Excel";
    if (visao === "geral") return "PDF paisagem + Excel";
    if (visao === "individual") return "PDF + Excel · 7 abas";
    return loteMode === "zip" ? "ZIP · 1 arquivo por promotor" : "Excel único · 1 aba por promotor";
  })();

  const individualReady = !(reportType === "promotores" && visao === "individual" && !promoterId);

  function fireToast(label: string) {
    setToast(`Gerando ${label} — ${scopeWord} · ${selectedPeriod?.label || ""}…`);
    window.clearTimeout((fireToast as unknown as { _t?: number })._t);
    (fireToast as unknown as { _t?: number })._t = window.setTimeout(() => setToast(""), 2600);
  }

  return (
    <div className="rrrel">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <a href="/dashboard">Dashboard</a>
          <span className="sep">/</span>
          <span>Relatórios</span>
        </nav>

        {/* HEADER navy (kit) — sem KPI (wizard); só marca + título + lead */}
        <HeaderNavy
          eyebrow="GRUPO RR CRED"
          title="Relatórios"
          subtitle="Central de geração. Monte o relatório, confira o que vai sair e baixe o arquivo certo."
        />

        {error ? <div className="banner err">{error}</div> : null}

        {/* STEP 1 — MONTAR */}
        <section className="step">
          <div className="step-head">
            <span className="step-no">1</span>
            <h2>Montar</h2>
            <span className="ht">· escolha o relatório</span>
          </div>

          <div className={`types${visibleTypes.length < 4 ? " few" : ""}`}>
            {visibleTypes.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`type${reportType === t.id ? " active" : ""}`}
                onClick={() => setReportType(t.id)}
              >
                <span className="ti">{t.icon}</span>
                <span className="tn">{t.label}</span>
                <span className="td">{t.desc}</span>
              </button>
            ))}
          </div>

          <div className="frow">
            <div className="fld">
              <label>Competência</label>
              <div className="selwrap">
                <select value={periodKey} onChange={(e) => setSelectedKey(e.target.value)}>
                  {data.periods.length === 0 ? <option value="">Sem competência</option> : null}
                  {data.periods.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} · {isClosedPeriod(p) ? "fechado" : "em andamento"}
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>
            </div>
          </div>

          {reportType === "promotores" ? (
            <div className="promo-extra">
              <div className="frow" style={{ marginTop: 0 }}>
                <div className="fld">
                  <label>Empresa</label>
                  <div className="selwrap">
                    <select
                      value={companyId}
                      onChange={(e) => {
                        setCompanyId(e.target.value);
                        setPromoterId("");
                      }}
                    >
                      <option value="">Todas as empresas</option>
                      {data.companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <span className="chev">▾</span>
                  </div>
                </div>

                <div className="fld">
                  <label>Visão</label>
                  <div className="seg">
                    {([
                      ["geral", "Geral da equipe"],
                      ["individual", "Individual"],
                      ["lote", "Lote"],
                    ] as Array<[Visao, string]>).map(([v, lbl]) => (
                      <button
                        key={v}
                        type="button"
                        className={visao === v ? "on" : ""}
                        onClick={() => setVisao(v)}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {visao === "individual" ? (
                  <div className="fld grow">
                    <label>Promotor</label>
                    <div className="selwrap">
                      <select value={promoterId} onChange={(e) => setPromoterId(e.target.value)}>
                        <option value="">Selecione o promotor…</option>
                        {data.promoters.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <span className="chev">▾</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {/* STEP 2 — CONFERIR */}
        <section className="step">
          <div className="step-head">
            <span className="step-no">2</span>
            <h2>Conferir</h2>
            <span className="ht">· o que vai sair no arquivo</span>
          </div>
          <div className="conf">
            <h3 className="conf-title">{loading ? "Carregando…" : conf.title || "—"}</h3>
            <p className="conf-desc">{loading ? "" : conf.desc}</p>
            <p className="sec-label">Seções do arquivo</p>
            <div className="secs">
              {conf.sections.map((s) => (
                <div key={s} className="sec">
                  <span className="ck">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  </span>
                  {s}
                </div>
              ))}
            </div>
            <div className="scope">
              <span className="pill">{scopeWord}</span>
              <span className="pill">
                <span className="num">{selectedPeriod?.label || "—"}</span>
              </span>
              <span className="pill fmt">{formatWord}</span>
            </div>
            <div className={`src ${periodOpen ? "open" : "closed"}`}>
              <span className="d" />
              <span>
                {periodOpen ? (
                  <>
                    <b>Mês em andamento</b> — valores parciais, sujeitos a alteração até o fechamento.
                  </>
                ) : (
                  <>
                    <b>Dados consolidados</b> do mês fechado.
                  </>
                )}
              </span>
            </div>
          </div>
        </section>

        {/* STEP 3 — BAIXAR */}
        <section className="step">
          <div className="step-head">
            <span className="step-no">3</span>
            <h2>Baixar</h2>
            <span className="ht">· gerar o arquivo</span>
          </div>

          {/* opções dinâmicas */}
          {reportType === "promotores" && visao === "geral" ? (
            <div className="dl-opts">
              <span className="ol">Ordenar por</span>
              <div className="seg">
                {([
                  ["percent", "% atingido"],
                  ["receber", "Total a pagar"],
                  ["producao", "Produção"],
                ] as Array<[TeamOrder, string]>).map(([o, lbl]) => (
                  <button key={o} type="button" className={order === o ? "on" : ""} onClick={() => setOrder(o)}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {reportType === "promotores" && visao === "lote" ? (
            <div className="dl-opts">
              <span className="ol">Modo</span>
              <div className="seg">
                <button type="button" className={loteMode === "zip" ? "on" : ""} onClick={() => setLoteMode("zip")}>
                  ZIP · 1 por promotor
                </button>
                <button type="button" className={loteMode === "abas" ? "on" : ""} onClick={() => setLoteMode("abas")}>
                  Arquivo único
                </button>
              </div>
            </div>
          ) : null}

          {/* botões */}
          <div className="dlbtns">
            {reportType !== "promotores" ? (
              <>
                <a className="dl primary" href={exportHref("pdf")} target="_blank" rel="noreferrer" onClick={() => fireToast("PDF")}>
                  <span className="fi pdf">PDF</span>PDF
                </a>
                <a className="dl" href={exportHref("xlsx")} target="_blank" rel="noreferrer" onClick={() => fireToast("Excel")}>
                  <span className="fi xls">XLS</span>Excel
                </a>
              </>
            ) : visao === "geral" ? (
              <>
                <a className="dl primary" href={exportHref("pdf", "geral")} target="_blank" rel="noreferrer" onClick={() => fireToast("PDF paisagem")}>
                  <span className="fi pdf">PDF</span>PDF <span className="sub">paisagem</span>
                </a>
                <a className="dl" href={exportHref("xlsx", "geral")} target="_blank" rel="noreferrer" onClick={() => fireToast("Excel")}>
                  <span className="fi xls">XLS</span>Excel <span className="sub">5 abas</span>
                </a>
              </>
            ) : visao === "individual" ? (
              <>
                {individualReady ? (
                  <a className="dl primary" href={exportHref("pdf", "individual")} target="_blank" rel="noreferrer" onClick={() => fireToast("PDF individual")}>
                    <span className="fi pdf">PDF</span>PDF
                  </a>
                ) : (
                  <button className="dl primary" type="button" disabled>
                    <span className="fi pdf">PDF</span>PDF
                  </button>
                )}
                {individualReady ? (
                  <a className="dl" href={exportHref("xlsx", "individual")} target="_blank" rel="noreferrer" onClick={() => fireToast("Excel individual")}>
                    <span className="fi xls">XLS</span>Excel <span className="sub">7 abas</span>
                  </a>
                ) : (
                  <button className="dl" type="button" disabled>
                    <span className="fi xls">XLS</span>Excel <span className="sub">7 abas</span>
                  </button>
                )}
              </>
            ) : loteMode === "zip" ? (
              <a className="dl primary" href={loteHref()} target="_blank" rel="noreferrer" onClick={() => fireToast("lote ZIP")}>
                <span className="fi zip">ZIP</span>Baixar lote <span className="sub">ZIP · 1 por promotor</span>
              </a>
            ) : (
              <a className="dl primary" href={loteHref()} target="_blank" rel="noreferrer" onClick={() => fireToast("Excel único")}>
                <span className="fi xls">XLS</span>Excel único <span className="sub">1 aba por promotor</span>
              </a>
            )}
          </div>

          {reportType === "promotores" && visao === "individual" && !individualReady ? (
            <div className="locknote">
              <span className="lk">⚠</span> Selecione um promotor no passo 1 para liberar o download individual.
            </div>
          ) : null}
        </section>
      </main>

      <div className={`toast${toast ? " show" : ""}`}>
        <span className="td" />
        <span>{toast}</span>
      </div>
    </div>
  );
}

const CSS = `
.rrrel{
  --navy:#0F1F4A; --navy-deep:#0B1838;
  --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A;
  --green:#3C9D6B; --green-bg:#E9F5EE;
  --red:#C0443C; --red-bg:#FBECEB;
  --amber:#B07A12; --amber-bg:#FBF1DC; --amber-bd:#EAD7A6;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --r-lg:20px; --r-md:16px; --r-sm:11px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);
  font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrrel *{box-sizing:border-box;}
.rrrel .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrrel .wrap{max-width:980px;margin:0 auto;padding:34px 28px 56px;display:flex;flex-direction:column;gap:20px;}

.rrrel .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:-6px 2px -2px;}
.rrrel .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rrrel .crumb a:hover{color:var(--navy);}
.rrrel .crumb .sep{color:#C2C8D2;}


.rrrel .banner{border-radius:var(--r-md);padding:12px 16px;font-size:13px;background:var(--red-bg);border:1px solid #E9B7B2;color:#8E2F28;}

.rrrel .step{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:24px 26px;position:relative;}
.rrrel .step-head{display:flex;align-items:center;gap:13px;margin-bottom:20px;}
.rrrel .step-no{flex:none;width:28px;height:28px;border-radius:50%;background:var(--navy);color:#fff;font-size:13px;font-weight:600;display:grid;place-items:center;}
.rrrel .step-head h2{font-size:16px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrrel .step-head .ht{font-size:12.5px;color:var(--ink-3);margin-left:2px;}

.rrrel .types{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.rrrel .types.few{grid-template-columns:repeat(2,minmax(0,240px));}
.rrrel .type{appearance:none;text-align:left;background:#FAFBFC;border:1.5px solid var(--bd);border-radius:var(--r-md);padding:16px;cursor:pointer;transition:.15s;display:flex;flex-direction:column;gap:10px;font-family:inherit;}
.rrrel .type:hover{border-color:#BFC6D2;background:#fff;}
.rrrel .type.active{border-color:var(--navy);background:#fff;box-shadow:0 0 0 3px rgba(15,31,74,.07);}
.rrrel .type .ti{width:34px;height:34px;border-radius:9px;background:#EFF1F6;border:1px solid var(--bd);display:grid;place-items:center;color:var(--navy);}
.rrrel .type.active .ti{background:var(--navy);border-color:var(--navy);color:var(--yellow);}
.rrrel .type .tn{font-size:14px;font-weight:600;color:var(--ink);}
.rrrel .type .td{font-size:11.5px;color:var(--ink-3);line-height:1.4;}

.rrrel .frow{display:flex;flex-wrap:wrap;gap:16px;margin-top:20px;}
.rrrel .fld{display:flex;flex-direction:column;gap:7px;min-width:190px;}
.rrrel .fld.grow{flex:1;}
.rrrel .fld label{font-size:12px;font-weight:600;color:var(--ink-2);letter-spacing:.01em;}
.rrrel .selwrap{position:relative;}
.rrrel .selwrap select{width:100%;appearance:none;-webkit-appearance:none;background:#F6F7FA;border:1px solid var(--bd);color:var(--ink);padding:10px 34px 10px 13px;border-radius:10px;font-family:inherit;font-size:13.5px;font-weight:500;cursor:pointer;}
.rrrel .selwrap select:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rrrel .selwrap .chev{position:absolute;right:13px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--ink-3);font-size:10px;}

.rrrel .seg{display:inline-flex;background:#F1F3F7;border:1px solid var(--bd);border-radius:10px;padding:3px;gap:3px;}
.rrrel .seg button{appearance:none;border:none;background:none;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--ink-3);padding:7px 14px;border-radius:7px;cursor:pointer;transition:.15s;white-space:nowrap;}
.rrrel .seg button:hover{color:var(--ink-2);}
.rrrel .seg button.on{background:#fff;color:var(--navy);box-shadow:0 1px 2px rgba(15,31,74,.1);}

.rrrel .promo-extra{margin-top:4px;border-top:1px dashed var(--bd);padding-top:18px;}

.rrrel .conf-title{font-size:18px;font-weight:600;letter-spacing:-.01em;color:var(--ink);margin:0;}
.rrrel .conf-desc{font-size:13px;color:var(--ink-2);margin:8px 0 0;line-height:1.55;max-width:600px;}
.rrrel .sec-label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3);margin:22px 0 12px;}
.rrrel .secs{display:grid;grid-template-columns:1fr 1fr;gap:9px 18px;}
.rrrel .sec{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--ink);}
.rrrel .sec .ck{flex:none;width:18px;height:18px;border-radius:6px;background:var(--green-bg);color:var(--green);display:grid;place-items:center;}
.rrrel .scope{margin-top:22px;padding-top:18px;border-top:1px solid var(--bd-soft);display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.rrrel .scope .pill{font-size:12px;font-weight:600;color:var(--ink-2);background:#F1F3F7;border:1px solid var(--bd);padding:6px 12px;border-radius:999px;}
.rrrel .scope .pill .num{color:var(--ink);}
.rrrel .scope .pill.fmt{color:var(--navy);background:#EEF1FA;border-color:#D7DEF1;}
.rrrel .src{display:flex;align-items:center;gap:9px;font-size:12.5px;margin-top:16px;}
.rrrel .src .d{flex:none;width:7px;height:7px;border-radius:50%;}
.rrrel .src.closed{color:var(--ink-3);}
.rrrel .src.closed .d{background:var(--green);box-shadow:0 0 0 3px var(--green-bg);}
.rrrel .src.open{color:var(--amber);}
.rrrel .src.open .d{background:var(--amber);box-shadow:0 0 0 3px var(--amber-bg);}
.rrrel .src b{color:var(--ink-2);font-weight:600;}
.rrrel .src.open b{color:var(--amber);}

.rrrel .dl-opts{margin-bottom:18px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;}
.rrrel .dl-opts .ol{font-size:12px;font-weight:600;color:var(--ink-2);}
.rrrel .dlbtns{display:flex;flex-wrap:wrap;gap:12px;}
.rrrel .dl{display:inline-flex;align-items:center;gap:11px;border-radius:12px;padding:13px 20px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;border:1.5px solid var(--bd);background:#fff;color:var(--ink);transition:.15s;text-decoration:none;}
.rrrel .dl:hover{border-color:#BFC6D2;}
.rrrel .dl.primary{background:var(--navy);border-color:var(--navy);color:#fff;}
.rrrel .dl.primary:hover{background:#16285C;}
.rrrel .dl[disabled]{opacity:.45;cursor:not-allowed;}
.rrrel .dl .fi{flex:none;width:28px;height:34px;border-radius:5px;display:grid;place-items:center;font-size:8.5px;font-weight:700;letter-spacing:.02em;color:#fff;}
.rrrel .fi.pdf{background:#C0443C;}
.rrrel .fi.xls{background:#1F7A47;}
.rrrel .fi.zip{background:var(--gold-deep);}
.rrrel .dl .sub{font-weight:500;font-size:11.5px;color:var(--ink-3);margin-left:-4px;}
.rrrel .dl.primary .sub{color:#AEB9D6;}
.rrrel .locknote{font-size:12.5px;color:var(--amber);margin-top:12px;display:flex;align-items:center;gap:8px;}
.rrrel .locknote .lk{font-weight:700;}

.rrrel .toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);background:var(--navy);color:#fff;font-size:13.5px;font-weight:500;padding:13px 20px;border-radius:12px;box-shadow:0 12px 32px rgba(15,31,74,.28);opacity:0;pointer-events:none;transition:.25s;display:flex;align-items:center;gap:10px;z-index:50;}
.rrrel .toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.rrrel .toast .td{width:8px;height:8px;border-radius:50%;background:var(--yellow);}

@media (max-width:820px){
  .rrrel .types{grid-template-columns:1fr 1fr;}
}
@media (max-width:620px){
  .rrrel .wrap{padding:18px 14px 40px;gap:16px;}
  .rrrel .step{padding:20px 18px;}
  .rrrel .secs{grid-template-columns:1fr;}
  .rrrel .fld{min-width:0;width:100%;}
  .rrrel .dl{flex:1;justify-content:center;}
}
`;
