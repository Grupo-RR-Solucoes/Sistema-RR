"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import EmptyStatePanel from "../../components/EmptyStatePanel";
import FeedbackBanner from "../../components/FeedbackBanner";

type ReportType = "financeiro" | "fechamento" | "auditoria" | "promotores";
type PromoterReportScope = "geral" | "individual";

type PeriodOption = {
  key: string;
  label: string;
  year: number;
  month: number;
};

type LookupOption = {
  id: string;
  name: string;
};

type ReportPreviewPayload = {
  reportType: ReportType;
  title: string;
  description: string;
  sourceHref: string;
  sourceLabel: string;
  periods: PeriodOption[];
  selectedPeriod: PeriodOption | null;
  selectedCompanyId: string;
  selectedPromoterId: string;
  reportScope: PromoterReportScope | null;
  companies: LookupOption[];
  promoters: LookupOption[];
  cards: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
  sections: string[];
  alerts: string[];
};

const emptyPayload: ReportPreviewPayload = {
  reportType: "financeiro",
  title: "Financeiro consolidado",
  description: "",
  sourceHref: "/financeiro",
  sourceLabel: "Abrir modulo",
  periods: [],
  selectedPeriod: null,
  selectedCompanyId: "",
  selectedPromoterId: "",
  reportScope: null,
  companies: [],
  promoters: [],
  cards: [],
  sections: [],
  alerts: [],
};

const reportOptions: Array<{ id: ReportType; label: string; description: string }> = [
  {
    id: "financeiro",
    label: "Financeiro",
    description: "Caixa, despesas, recebido real e PRT futuro.",
  },
  {
    id: "fechamento",
    label: "Fechamento",
    description: "Previsto x recebido por empresa e por grupo.",
  },
  {
    id: "auditoria",
    label: "Auditoria",
    description: "Fila de divergencias para conferencia imediata.",
  },
  {
    id: "promotores",
    label: "Promotores",
    description: "Resumo e detalhamento das comissoes dos vendedores.",
  },
];

export default function RelatoriosPage() {
  const [reportType, setReportType] = useState<ReportType>("financeiro");
  const [selectedKey, setSelectedKey] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [promoterId, setPromoterId] = useState("");
  const [promoterScope, setPromoterScope] = useState<PromoterReportScope>("geral");
  const [batchMode, setBatchMode] = useState<"zip" | "abas">("zip");
  const [activeSection, setActiveSection] = useState<"montagem" | "previa" | "downloads">(
    "montagem"
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<ReportPreviewPayload>(emptyPayload);

  useEffect(() => {
    setSelectedKey("");
    setCompanyId("");
    setPromoterId("");
    setPromoterScope("geral");
  }, [reportType]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams({
          type: reportType,
        });

        if (selectedKey) {
          const [year, month] = selectedKey.split("-");
          params.set("year", year);
          params.set("month", month);
        }

        if (reportType === "promotores" && companyId) {
          params.set("companyId", companyId);
        }

        if (reportType === "promotores") {
          params.set("scope", promoterScope);
        }

        if (reportType === "promotores" && promoterId) {
          params.set("promoterId", promoterId);
        }

        const response = await fetch(`/api/relatorios?${params.toString()}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Erro ao carregar relatorios.");
        }

        setData(payload || emptyPayload);
      } catch (err: any) {
        setError(err.message || "Erro ao carregar relatorios.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [reportType, selectedKey, companyId, promoterId, promoterScope]);

  useEffect(() => {
    if (!selectedKey && data.selectedPeriod?.key) {
      setSelectedKey(data.selectedPeriod.key);
    }
  }, [data.selectedPeriod?.key, selectedKey]);

  useEffect(() => {
    if (reportType !== "promotores") {
      return;
    }

    if (!companyId && data.selectedCompanyId) {
      setCompanyId(data.selectedCompanyId);
    }

    if (!promoterId && data.selectedPromoterId) {
      setPromoterId(data.selectedPromoterId);
    }
  }, [
    companyId,
    data.selectedCompanyId,
    data.selectedPromoterId,
    promoterId,
    reportType,
  ]);

  const exportBaseParams = useMemo(() => {
    const params = new URLSearchParams({
      type: reportType,
    });

    const effectiveKey = selectedKey || data.selectedPeriod?.key || "";
    if (effectiveKey) {
      const [year, month] = effectiveKey.split("-");
      params.set("year", year);
      params.set("month", month);
    }

    if (reportType === "promotores" && companyId) {
      params.set("companyId", companyId);
    }

    if (reportType === "promotores") {
      params.set("scope", promoterScope);
    }

    if (reportType === "promotores" && promoterId) {
      params.set("promoterId", promoterId);
    }

    return params;
  }, [
    companyId,
    data.selectedPeriod?.key,
    promoterId,
    promoterScope,
    reportType,
    selectedKey,
  ]);

  function getExportHref(
    format: "pdf" | "xlsx",
    scopeOverride?: PromoterReportScope
  ) {
    const params = new URLSearchParams(exportBaseParams);
    params.set("format", format);
    if (reportType === "promotores" && scopeOverride) {
      params.set("scope", scopeOverride);
    }
    return `/api/relatorios/export?${params.toString()}`;
  }

  // ETAPA 7 — export em lote: reusa competencia e empresa da Montagem.
  function getBatchHref() {
    const effectiveKey = selectedKey || data.selectedPeriod?.key || "";
    const params = new URLSearchParams();
    if (effectiveKey) {
      const [year, month] = effectiveKey.split("-");
      params.set("ano", year);
      params.set("mes", month);
    }
    if (companyId) {
      params.set("companyId", companyId);
    }
    params.set("modo", batchMode);
    return `/api/relatorios/export-lote?${params.toString()}`;
  }

  const periodValue = selectedKey || data.selectedPeriod?.key || "";
  const requiresIndividualPromoter =
    reportType === "promotores" && !promoterId && !data.selectedPromoterId;

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Saida gerencial</div>
          <h2 style={styles.title}>Relatorios e exportacoes do Grupo RR</h2>
          <p style={styles.description}>
            Esta central gera os PDFs e Excels principais do sistema sem retrabalho:
            financeiro, fechamento, auditoria e detalhamento dos promotores.
          </p>
          <div style={styles.heroSignals}>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Central unica</span>
              <strong style={styles.heroSignalValue}>PDF + Excel</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Escopos</span>
              <strong style={styles.heroSignalValue}>Geral e individual</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Fonte</span>
              <strong style={styles.heroSignalValue}>Dados vivos do sistema</strong>
            </div>
          </div>
        </article>

        <article style={styles.heroAside}>
          <div style={styles.heroAsideLabel}>Fluxo recomendado</div>
          <p style={styles.heroAsideDescription}>
            Monte, confira e baixe o arquivo final sem sair da trilha de operacao.
          </p>
          <div style={styles.quickLinks}>
            <Link href={data.sourceHref} style={styles.quickLink}>
              <span style={styles.quickLinkTitle}>{data.sourceLabel}</span>
              <span style={styles.quickLinkDescription}>
                Abrir o modulo base e conferir a origem dos numeros.
              </span>
            </Link>
            <Link href="/importacoes" style={styles.quickLink}>
              <span style={styles.quickLinkTitle}>Conferir importacoes</span>
              <span style={styles.quickLinkDescription}>
                Validar se a base diaria e os fechamentos estao atualizados.
              </span>
            </Link>
            <Link href="/dashboard" style={styles.quickLink}>
              <span style={styles.quickLinkTitle}>Voltar ao dashboard</span>
              <span style={styles.quickLinkDescription}>
                Reenquadrar o contexto executivo antes de exportar.
              </span>
            </Link>
          </div>
        </article>
      </div>

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="Leitura interrompida"
          title="Nao foi possivel preparar a central de relatorios."
          description={error}
          actionLabel="Conferir importacoes"
          actionHref="/importacoes"
        />
      ) : null}

      <div style={styles.subsectionNav}>
        <button
          type="button"
          onClick={() => setActiveSection("montagem")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "montagem" ? styles.subsectionButtonActive : {}),
          }}
        >
          Montagem
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("previa")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "previa" ? styles.subsectionButtonActive : {}),
          }}
        >
          Previa
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("downloads")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "downloads" ? styles.subsectionButtonActive : {}),
          }}
        >
          Downloads
        </button>
      </div>

      {activeSection === "montagem" ? (
        <article style={styles.filterCard}>
          <div style={styles.filterHeader}>
            <div>
              <div style={styles.filterKicker}>Montagem</div>
              <h3 style={styles.filterTitle}>Defina o recorte do relatorio</h3>
            </div>
            <div style={styles.filterBadge}>
              {reportOptions.find((option) => option.id === reportType)?.label || "Relatorio"}
            </div>
          </div>
          <div style={styles.filterGrid}>
            <FormRow label="Tipo de relatorio">
              <select
                value={reportType}
                onChange={(event) => setReportType(event.target.value as ReportType)}
                style={styles.input}
              >
                {reportOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow label="Competencia">
              <select
                value={periodValue}
                onChange={(event) => setSelectedKey(event.target.value)}
                style={styles.input}
              >
                {data.periods.length === 0 ? <option value="">Sem competencia</option> : null}
                {data.periods.map((period) => (
                  <option key={period.key} value={period.key}>
                    {period.label}
                  </option>
                ))}
              </select>
            </FormRow>

            {reportType === "promotores" ? (
              <FormRow label="Empresa">
                <select
                  value={companyId}
                  onChange={(event) => {
                    setCompanyId(event.target.value);
                    setPromoterId("");
                  }}
                  style={styles.input}
                >
                  <option value="">Todas</option>
                  {data.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </FormRow>
            ) : null}

            {reportType === "promotores" ? (
              <FormRow label="Visao do relatorio">
                <select
                  value={promoterScope}
                  onChange={(event) =>
                    setPromoterScope(event.target.value as PromoterReportScope)
                  }
                  style={styles.input}
                >
                  <option value="geral">Geral</option>
                  <option value="individual">Individual</option>
                </select>
              </FormRow>
            ) : null}

            {reportType === "promotores" ? (
              <FormRow label="Promotor detalhado">
                <select
                  value={promoterId}
                  onChange={(event) => setPromoterId(event.target.value)}
                  style={styles.input}
                >
                  <option value="">Selecione</option>
                  {data.promoters.map((promoter) => (
                    <option key={promoter.id} value={promoter.id}>
                      {promoter.name}
                    </option>
                  ))}
                </select>
              </FormRow>
            ) : null}
          </div>

          <div style={styles.filterNote}>
            {reportType === "promotores"
              ? "Promotores possuem duas saidas separadas: relatorio geral da equipe e relatorio individual pronto para compartilhar com cada vendedor."
              : reportOptions.find((option) => option.id === reportType)?.description}
          </div>
        </article>
      ) : null}

      {activeSection === "previa" ? (
        <>
          <div style={styles.summaryGrid}>
            {loading ? (
              <LoadingCard />
            ) : data.cards.length === 0 ? (
              <EmptyStatePanel
                eyebrow="Sem previa"
                title="Ainda nao ha dados para este relatorio."
                description="Ajuste o recorte da competencia ou valide se o modulo de origem ja possui base suficiente."
                actionLabel="Abrir modulo base"
                actionHref={data.sourceHref}
              />
            ) : (
              data.cards.map((card) => (
                <article key={`${card.label}-${card.value}`} style={styles.summaryCard}>
                  <div style={styles.summaryLabel}>{card.label}</div>
                  <div style={styles.summaryValue}>{card.value}</div>
                  <div style={styles.summaryDetail}>{card.detail}</div>
                </article>
              ))
            )}
          </div>

          {data.alerts.map((alert) => (
            <FeedbackBanner
              key={alert}
              variant="warning"
              eyebrow="Leitura de apoio"
              title="Existe um ponto de atencao nesta previa."
              description={alert}
            />
          ))}

          <div style={styles.contentGrid}>
            <article style={styles.sectionCard}>
              <div style={styles.sectionTopLine} />
              <div style={styles.sectionKicker}>Relatorio selecionado</div>
              <h3 style={styles.sectionTitle}>{data.title}</h3>
              <p style={styles.sectionDescription}>
                {loading ? "Carregando descricao do relatorio..." : data.description}
              </p>

              <div style={styles.itemList}>
                {loading ? (
                  <EmptyStatePanel
                    compact
                    eyebrow="Montagem"
                    title="Preparando a estrutura da exportacao."
                    description="A central esta organizando as secoes que vao para o arquivo final."
                  />
                ) : data.sections.length === 0 ? (
                  <EmptyStatePanel
                    compact
                    eyebrow="Sem secoes"
                    title="Nao ha secoes definidas para esta selecao."
                    description="Revise o tipo de relatorio ou a competencia para montar uma previa util."
                  />
                ) : (
                  data.sections.map((item) => (
                    <div key={item} style={styles.itemCard}>
                      {item}
                    </div>
                  ))
                )}
              </div>
            </article>

            <aside style={styles.sideCard}>
              <div style={styles.sideKicker}>Origem dos dados</div>
              <h3 style={styles.sideTitle}>Mesma base do sistema</h3>
              <div style={styles.sideText}>
                A exportacao usa a mesma base que alimenta dashboard, fechamento,
                auditoria e promotores, para evitar numero diferente entre tela e relatorio.
              </div>
            </aside>
          </div>
        </>
      ) : null}

      {activeSection === "downloads" ? (
        <div style={styles.contentGrid}>
          <article style={styles.downloadCard}>
            <div style={styles.sectionTopLine} />
            <div style={styles.sectionKicker}>Pronto para baixar</div>
            <h3 style={styles.sectionTitle}>Arquivos disponiveis</h3>
            <p style={styles.sectionDescription}>
              Escolha o formato mais adequado para diretoria, conferencia interna ou envio ao time.
            </p>

            {reportType === "promotores" ? (
              <div style={styles.downloadGroups}>
                <div style={styles.downloadGroup}>
                  <div style={styles.downloadGroupLabel}>Relatorio geral</div>
                  <div style={styles.exportActions}>
                    <a
                      href={getExportHref("pdf", "geral")}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.primaryButton}
                    >
                      PDF geral
                    </a>
                    <a
                      href={getExportHref("xlsx", "geral")}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.secondaryButton}
                    >
                      Excel geral
                    </a>
                  </div>
                </div>

                <div style={styles.downloadGroup}>
                  <div style={styles.downloadGroupLabel}>Relatorio individual</div>
                  <div style={styles.exportActions}>
                    {requiresIndividualPromoter ? (
                      <>
                        <span style={styles.disabledPrimaryButton}>PDF individual</span>
                        <span style={styles.disabledSecondaryButton}>Excel individual</span>
                      </>
                    ) : (
                      <>
                        <a
                          href={getExportHref("pdf", "individual")}
                          target="_blank"
                          rel="noreferrer"
                          style={styles.primaryButton}
                        >
                          PDF individual
                        </a>
                        <a
                          href={getExportHref("xlsx", "individual")}
                          target="_blank"
                          rel="noreferrer"
                          style={styles.secondaryButton}
                        >
                          Excel individual
                        </a>
                      </>
                    )}
                  </div>
                  {requiresIndividualPromoter ? (
                    <div style={styles.downloadHint}>
                      Escolha um promotor na montagem para liberar a exportacao individual.
                    </div>
                  ) : null}
                </div>

                <div style={styles.downloadGroup}>
                  <div style={styles.downloadGroupLabel}>Exportar em lote</div>
                  <div style={styles.exportActions}>
                    <select
                      value={batchMode}
                      onChange={(event) =>
                        setBatchMode(event.target.value as "zip" | "abas")
                      }
                      style={styles.input}
                    >
                      <option value="zip">ZIP — 1 arquivo por promotor</option>
                      <option value="abas">Arquivo unico — 1 aba por promotor</option>
                    </select>
                    <a
                      href={getBatchHref()}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.primaryButton}
                    >
                      Baixar lote
                    </a>
                  </div>
                  <div style={styles.downloadHint}>
                    Inclui TODOS os promotores ativos da competencia
                    {companyId
                      ? " da empresa selecionada"
                      : " (todas as empresas)"}{" "}
                    — quem nao produziu sai com relatorio zerado. ZIP: relatorio
                    individual completo (7 abas) por promotor. Arquivo unico: 1 aba
                    fiel (modelo LUCIANA) por promotor.
                  </div>
                </div>
              </div>
            ) : (
              <div style={styles.exportActions}>
                <a
                  href={getExportHref("pdf")}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.primaryButton}
                >
                  Exportar PDF
                </a>
                <a
                  href={getExportHref("xlsx")}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.secondaryButton}
                >
                  Exportar Excel
                </a>
              </div>
            )}
          </article>

          <aside style={styles.sideCard}>
            <div style={styles.sideKicker}>Guia rapido</div>
            <h3 style={styles.sideTitle}>Quando usar cada formato</h3>
            <div style={styles.formatList}>
              <div style={styles.formatItem}>
                <div style={styles.formatTitle}>PDF executivo</div>
                <div style={styles.formatText}>
                  Melhor para diretoria, envio rapido e memoria de reuniao.
                </div>
              </div>
              <div style={styles.formatItem}>
                <div style={styles.formatTitle}>Excel operacional</div>
                <div style={styles.formatText}>
                  Melhor para conferencia, filtros e auditoria linha a linha.
                </div>
              </div>
              <div style={styles.formatItem}>
                <div style={styles.formatTitle}>Antes de baixar</div>
                <div style={styles.formatText}>
                  Confira competencia, escopo e base do modulo de origem para evitar
                  arquivo fora do contexto.
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={styles.formRow}>
      <span style={styles.formLabel}>{label}</span>
      {children}
    </label>
  );
}

function LoadingCard() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <article key={index} style={styles.summaryCard}>
          <div style={styles.summaryLabel}>Carregando</div>
          <div style={styles.summaryValue}>...</div>
          <div style={styles.summaryDetail}>Preparando a previa deste relatorio.</div>
        </article>
      ))}
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "18px",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
  },
  heroMain: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,253,245,0.98) 100%)",
    border: "1px solid var(--rr-line)",
    borderRadius: "28px",
    padding: "28px",
    boxShadow: "var(--rr-shadow)",
  },
  kicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: "var(--rr-blue)",
    fontWeight: 800,
    marginBottom: "10px",
  },
  title: {
    margin: 0,
    fontSize: "clamp(2rem, 3.2vw, 3.3rem)",
    lineHeight: 1.05,
    color: "var(--rr-ink)",
  },
  description: {
    margin: "16px 0 0",
    fontSize: "15px",
    lineHeight: 1.75,
    color: "var(--rr-muted)",
  },
  heroSignals: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "16px",
  },
  heroSignal: {
    display: "grid",
    gap: "4px",
    minWidth: "150px",
    padding: "11px 13px",
    borderRadius: "18px",
    background: "rgba(13,77,227,0.04)",
    border: "1px solid rgba(13,77,227,0.08)",
  },
  heroSignalLabel: {
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  heroSignalValue: {
    fontSize: "14px",
    color: "var(--rr-ink-soft)",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
  },
  heroAside: {
    borderRadius: "28px",
    padding: "24px",
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    boxShadow: "var(--rr-shadow)",
    border: "1px solid rgba(255,255,255,0.14)",
    display: "grid",
    gap: "14px",
    alignContent: "start",
  },
  heroAsideLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "rgba(255,255,255,0.72)",
    fontWeight: 800,
  },
  heroAsideDescription: {
    margin: 0,
    fontSize: "13px",
    lineHeight: 1.55,
    color: "rgba(255,255,255,0.78)",
  },
  quickLinks: {
    display: "grid",
    gap: "10px",
  },
  quickLink: {
    display: "grid",
    gap: "4px",
    textDecoration: "none",
    padding: "14px 16px",
    borderRadius: "16px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#ffffff",
    fontWeight: 700,
  },
  quickLinkTitle: {
    fontSize: "14px",
    fontWeight: 800,
  },
  quickLinkDescription: {
    fontSize: "12px",
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.76)",
    fontWeight: 500,
  },
  errorBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(239,68,68,0.24)",
    color: "#991b1b",
    borderRadius: "18px",
    padding: "16px",
  },
  alertBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(13,77,227,0.12)",
    color: "var(--rr-blue-deep)",
    borderRadius: "18px",
    padding: "14px 16px",
    lineHeight: 1.6,
  },
  subsectionNav: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  subsectionButton: {
    border: "1px solid rgba(13,77,227,0.12)",
    background: "rgba(255,255,255,0.8)",
    color: "var(--rr-muted)",
    borderRadius: "999px",
    padding: "10px 16px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  subsectionButtonActive: {
    color: "var(--rr-blue-deep)",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.92) 0%, rgba(255,255,255,0.96) 100%)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  filterCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "26px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    padding: "20px",
    display: "grid",
    gap: "14px",
  },
  filterHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  filterKicker: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
    marginBottom: "6px",
  },
  filterTitle: {
    margin: 0,
    fontSize: "20px",
    color: "var(--rr-ink)",
  },
  filterBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.06)",
    border: "1px solid rgba(13,77,227,0.1)",
    color: "var(--rr-blue-deep)",
    fontSize: "12px",
    fontWeight: 800,
  },
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
    alignItems: "end",
  },
  formRow: {
    display: "grid",
    gap: "6px",
  },
  formLabel: {
    fontSize: "12px",
    color: "var(--rr-blue)",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  input: {
    width: "100%",
    borderRadius: "14px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "12px 14px",
    fontSize: "14px",
    color: "var(--rr-ink)",
    background: "rgba(255,255,255,0.96)",
    outline: "none",
  },
  filterNote: {
    fontSize: "14px",
    lineHeight: 1.65,
    color: "var(--rr-muted)",
    maxWidth: "760px",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "12px",
  },
  summaryCard: {
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,249,176,0.52) 100%)",
    border: "1px solid var(--rr-line)",
    borderRadius: "20px",
    padding: "18px",
    boxShadow: "var(--rr-shadow-soft)",
  },
  summaryLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "10px",
    fontWeight: 800,
  },
  summaryValue: {
    fontSize: "24px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    marginBottom: "8px",
    fontFamily: "var(--font-heading)",
  },
  summaryDetail: {
    fontSize: "14px",
    lineHeight: 1.65,
    color: "var(--rr-muted)",
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
    alignItems: "start",
  },
  sectionCard: {
    position: "relative",
    background: "rgba(255,255,255,0.92)",
    border: "1px solid var(--rr-line)",
    borderRadius: "26px",
    padding: "22px",
    boxShadow: "var(--rr-shadow-soft)",
  },
  downloadCard: {
    position: "relative",
    background: "rgba(255,255,255,0.92)",
    border: "1px solid var(--rr-line)",
    borderRadius: "26px",
    padding: "22px",
    boxShadow: "var(--rr-shadow-soft)",
    display: "grid",
    gap: "14px",
  },
  sectionTopLine: {
    width: 78,
    height: 6,
    borderRadius: 999,
    background:
      "linear-gradient(90deg, var(--rr-yellow) 0%, var(--rr-gold) 48%, var(--rr-blue) 100%)",
    marginBottom: "14px",
  },
  sectionKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  sectionTitle: {
    margin: 0,
    fontSize: "24px",
    color: "var(--rr-ink)",
  },
  sectionDescription: {
    margin: "10px 0 0",
    fontSize: "15px",
    lineHeight: 1.7,
    color: "var(--rr-muted)",
  },
  itemList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "12px",
    marginTop: "16px",
  },
  itemCard: {
    borderRadius: "18px",
    border: "1px solid rgba(13,77,227,0.1)",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.05) 0%, rgba(255,255,255,0.92) 100%)",
    padding: "16px",
    fontSize: "14px",
    lineHeight: 1.65,
    color: "var(--rr-ink)",
  },
  sideCard: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.93) 0%, rgba(255,253,245,0.98) 100%)",
    border: "1px solid var(--rr-line)",
    borderRadius: "26px",
    padding: "22px",
    boxShadow: "var(--rr-shadow-soft)",
    display: "grid",
    gap: "14px",
  },
  sideKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  sideTitle: {
    margin: 0,
    fontSize: "24px",
    color: "var(--rr-ink)",
  },
  sideText: {
    fontSize: "14px",
    lineHeight: 1.7,
    color: "var(--rr-muted)",
  },
  formatList: {
    display: "grid",
    gap: "12px",
  },
  formatItem: {
    borderRadius: "18px",
    border: "1px solid rgba(13,77,227,0.1)",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.14) 0%, rgba(13,77,227,0.04) 100%)",
    padding: "16px",
  },
  formatTitle: {
    fontSize: "15px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    marginBottom: "6px",
  },
  formatText: {
    fontSize: "14px",
    lineHeight: 1.6,
    color: "var(--rr-muted)",
  },
  downloadGroups: {
    display: "grid",
    gap: "14px",
  },
  downloadGroup: {
    display: "grid",
    gap: "8px",
  },
  downloadGroupLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  exportActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    border: 0,
    borderRadius: "16px",
    padding: "14px 16px",
    fontSize: "14px",
    fontWeight: 800,
    color: "#ffffff",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.98) 0%, rgba(7,37,125,0.98) 100%)",
  },
  secondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    border: 0,
    borderRadius: "16px",
    padding: "14px 16px",
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--rr-blue-deep)",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.95) 0%, rgba(214,161,63,0.92) 100%)",
  },
  disabledPrimaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "16px",
    padding: "14px 16px",
    fontSize: "14px",
    fontWeight: 800,
    color: "rgba(7,37,125,0.48)",
    background: "rgba(13,77,227,0.12)",
    border: "1px dashed rgba(13,77,227,0.18)",
    cursor: "not-allowed",
  },
  disabledSecondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "16px",
    padding: "14px 16px",
    fontSize: "14px",
    fontWeight: 800,
    color: "rgba(11,22,51,0.42)",
    background: "rgba(11,22,51,0.06)",
    border: "1px dashed rgba(11,22,51,0.12)",
    cursor: "not-allowed",
  },
  downloadHint: {
    fontSize: "12px",
    lineHeight: 1.55,
    color: "var(--rr-muted)",
  },
};
