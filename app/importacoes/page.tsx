"use client";

import type { CSSProperties, FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import EmptyStatePanel from "../../components/EmptyStatePanel";
import FeedbackBanner from "../../components/FeedbackBanner";

type Company = {
  id: string;
  name: string;
  cnpj: string;
};

type DailyImport = {
  id: string;
  file_name: string;
  status?: string | null;
  rows_count?: number | null;
  created_at?: string | null;
};

type MonthlyClosingImport = {
  id: string;
  company_id?: string | null;
  company_name: string;
  company_cnpj: string;
  year: number;
  month: number;
  file_name: string;
  status?: string | null;
  created_at?: string | null;
};

type ImportacoesPayload = {
  summary: {
    dailyImports: number;
    monthlyClosingImports: number;
    lastDailyImportAt?: string | null;
    lastMonthlyClosingImportAt?: string | null;
  };
  companies: Company[];
  dailyImports: DailyImport[];
  monthlyClosingImports: MonthlyClosingImport[];
};

const emptyPayload: ImportacoesPayload = {
  summary: {
    dailyImports: 0,
    monthlyClosingImports: 0,
    lastDailyImportAt: null,
    lastMonthlyClosingImportAt: null,
  },
  companies: [],
  dailyImports: [],
  monthlyClosingImports: [],
};

export default function ImportacoesPage() {
  const [activeSection, setActiveSection] = useState<
    "base" | "fechamento" | "historico"
  >("base");
  const [data, setData] = useState<ImportacoesPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [setupSubmitting, setSetupSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [keysFile, setKeysFile] = useState<File | null>(null);
  const [dailyReferenceFile, setDailyReferenceFile] = useState<File | null>(null);
  const [promoterRemunerationFile, setPromoterRemunerationFile] = useState<File | null>(null);
  const [promoterRemunerationSubmitting, setPromoterRemunerationSubmitting] =
    useState(false);
  const [cancellingImportId, setCancellingImportId] = useState<string | null>(null);
  const [form, setForm] = useState({
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1),
    companyId: "",
  });

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/importacoes");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao carregar importacoes.");
      }

      setData(payload || emptyPayload);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar importacoes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function fileToBase64(selectedFile: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        try {
          const content = reader.result;

          if (typeof content !== "string") {
            reject(new Error("Falha ao converter o arquivo."));
            return;
          }

          resolve(content.split(",")[1]);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error("Erro ao ler o arquivo."));
      reader.readAsDataURL(selectedFile);
    });
  }

  async function handleMonthlyClosingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Selecione uma planilha de fechamento antes de enviar.");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      setNotice("");

      const base64 = await fileToBase64(file);

      const response = await fetch("/api/import/closing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file: base64,
          fileName: file.name,
          year: Number(form.year),
          month: Number(form.month),
          companyId: form.companyId || null,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao importar fechamento mensal.");
      }

      setNotice(
        `Fechamento importado com sucesso para ${payload.company?.name}. Total liquido: ${formatCurrency(
          payload.totals?.valor_liquido
        )}.`
      );
      setFile(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Erro ao importar fechamento mensal.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBaseSetupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!keysFile && !dailyReferenceFile) {
      setError("Selecione a planilha de Chaves J ou uma diaria de referencia.");
      return;
    }

    try {
      setSetupSubmitting(true);
      setError("");
      setNotice("");

      const [keysBase64, dailyBase64] = await Promise.all([
        keysFile ? fileToBase64(keysFile) : Promise.resolve(null),
        dailyReferenceFile ? fileToBase64(dailyReferenceFile) : Promise.resolve(null),
      ]);

      const response = await fetch("/api/import/cadastros", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          keysFile: keysBase64,
          keysFileName: keysFile?.name || null,
          dailyFile: dailyBase64,
          dailyFileName: dailyReferenceFile?.name || null,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao importar base cadastral.");
      }

      const summary = payload.summary || {};

      setNotice(
        `Base cadastral importada com sucesso. ${summary.companiesCreated || 0} empresas operacionais, ${
          summary.identifiersCreated || 0
        } identificadores, ${summary.promotersCreated || 0} promotores novos, ${
          summary.jKeysCreated || 0
        } Chaves J novas e ${summary.linkedKeysFromDaily || 0} vinculos reforcados pela diaria.`
      );
      setKeysFile(null);
      setDailyReferenceFile(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Erro ao importar base cadastral.");
    } finally {
      setSetupSubmitting(false);
    }
  }

  async function handleCancelImport(row: MonthlyClosingImport) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Cancelar import travado de ${row.company_name} (${String(row.month).padStart(2, "0")}/${row.year})?\n\n` +
          `Arquivo: ${row.file_name}\n` +
          `Status: ${row.status || "PROCESSING"}\n\n` +
          `Isso marca o registro como CANCELLED e remove entries parciais. Use depois de constatar travamento.`
      );
      if (!confirmed) return;
    }

    try {
      setCancellingImportId(row.id);
      setError("");
      setNotice("");

      const response = await fetch("/api/import/closing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId: row.id }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "Falha ao cancelar import.");
      }

      setNotice(
        `Import ${row.id.slice(0, 8)} cancelado. Voce pode refazer o upload sem conflito.`
      );
      await loadData();
    } catch (err: any) {
      setError(err.message || "Falha ao cancelar import.");
    } finally {
      setCancellingImportId(null);
    }
  }

  async function handlePromoterRemunerationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!promoterRemunerationFile) {
      setError("Selecione a tabela mensal de remuneracao dos promotores.");
      return;
    }

    try {
      setPromoterRemunerationSubmitting(true);
      setError("");
      setNotice("");

      const base64 = await fileToBase64(promoterRemunerationFile);

      const response = await fetch("/api/import/promoter-remuneration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file: base64,
          fileName: promoterRemunerationFile.name,
          year: Number(form.year),
          month: Number(form.month),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error || "Erro ao importar tabela mensal de remuneracao."
        );
      }

      setNotice(
        `Tabela de remuneracao importada com sucesso. ${payload.summary?.productionRules || 0} regras de producao e ${payload.summary?.insuranceBands || 0} faixas de seguro preparadas para ${String(
          form.month
        ).padStart(2, "0")}/${form.year}.`
      );
      setPromoterRemunerationFile(null);
    } catch (err: any) {
      setError(err.message || "Erro ao importar tabela mensal de remuneracao.");
    } finally {
      setPromoterRemunerationSubmitting(false);
    }
  }

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Entrada de dados</div>
          <h2 style={styles.title}>Importacoes e cargas historicas</h2>
          <p style={styles.description}>
            Esta area agora concentra a carga diaria e a carga mensal real por CNPJ,
            mantendo historico, evitando retrabalho e atualizando o fechamento do mes
            para auditoria, dashboard e financeiro.
          </p>
          <div style={styles.heroSignals}>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Base diaria</span>
              <strong style={styles.heroSignalValue}>Carga recorrente</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Fechamento</span>
              <strong style={styles.heroSignalValue}>Importacao por CNPJ</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Historico</span>
              <strong style={styles.heroSignalValue}>Rastro preservado</strong>
            </div>
          </div>
        </article>

        <article style={styles.heroAside}>
          <div style={styles.heroAsideLabel}>Atalhos operacionais</div>
          <p style={styles.heroAsideDescription}>
            Use esta trilha para conferir carga, fechamento real e divergencias sem perder contexto.
          </p>
          <div style={styles.quickLinks}>
            <Link href="/importacao-diaria" style={styles.quickLink}>
              <span style={styles.quickLinkTitle}>Subir producao diaria</span>
              <span style={styles.quickLinkDescription}>
                Atualize propostas, status e valores operacionais do periodo.
              </span>
            </Link>
            <Link href="/fechamento" style={styles.quickLink}>
              <span style={styles.quickLinkTitle}>Conferir fechamento</span>
              <span style={styles.quickLinkDescription}>
                Valide se o recebido real entrou de forma consistente no sistema.
              </span>
            </Link>
            <Link href="/auditoria" style={styles.quickLink}>
              <span style={styles.quickLinkTitle}>Auditar previsto x recebido</span>
              <span style={styles.quickLinkDescription}>
                Releia as divergencias logo apos a importacao mensal.
              </span>
            </Link>
          </div>
        </article>
      </div>

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="Carga interrompida"
          title="Nao foi possivel concluir a operacao de importacao."
          description={error}
          actionLabel="Revisar historico"
          actionHref="/importacoes"
        />
      ) : null}
      {notice ? (
        <FeedbackBanner
          variant="success"
          eyebrow="Carga registrada"
          title="A base foi atualizada com sucesso."
          description={notice}
          actionLabel="Abrir auditoria"
          actionHref="/auditoria"
        />
      ) : null}

      <FeedbackBanner
        variant="info"
        eyebrow="Rotina recomendada"
        title="Mantenha a base operacional sempre na mesma ordem."
        description="Primeiro cadastros e tabela mensal, depois diaria, fechamento e por fim a conferencia em auditoria e relatorios."
        helper="Esse bloco resume a sequencia ideal para evitar cargas fora de contexto."
      />

      <div style={styles.summaryGrid}>
        <SummaryCard label="Cargas diarias" value={String(data.summary.dailyImports)} />
        <SummaryCard label="Fechamentos mensais" value={String(data.summary.monthlyClosingImports)} />
        <SummaryCard
          label="Ultima diaria"
          value={formatDateTime(data.summary.lastDailyImportAt)}
        />
        <SummaryCard
          label="Ultimo fechamento"
          value={formatDateTime(data.summary.lastMonthlyClosingImportAt)}
        />
      </div>

      <div style={styles.subsectionNav}>
        <button
          type="button"
          onClick={() => setActiveSection("base")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "base" ? styles.subsectionButtonActive : {}),
          }}
        >
          Base operacional
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("fechamento")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "fechamento" ? styles.subsectionButtonActive : {}),
          }}
        >
          Fechamento mensal
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("historico")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "historico" ? styles.subsectionButtonActive : {}),
          }}
        >
          Historico
        </button>
      </div>

      {activeSection === "base" ? (
      <div style={styles.contentGrid}>
        <article style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.sectionKicker}>Base cadastral inteligente</div>
              <h3 style={styles.sectionTitle}>Chaves J + diaria de referencia</h3>
            </div>
            <div style={styles.cardHeaderBadge}>Setup inicial</div>
          </div>

          <form onSubmit={handleBaseSetupSubmit} style={styles.formGrid}>
            <FormRow label="Planilha de Chaves J">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => setKeysFile(event.target.files?.[0] || null)}
                style={styles.input}
              />
            </FormRow>
            <FormRow label="Diaria de referencia">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => setDailyReferenceFile(event.target.files?.[0] || null)}
                style={styles.input}
              />
            </FormRow>
          <div style={styles.helperText}>
            A planilha de Chaves J cria promotores e chaves. A diaria ajuda a
            identificar MCI, Coban e a vincular cada chave a empresa operacional.
          </div>
          <div style={styles.helperBadgeRow}>
            <span style={styles.badge}>1 carga inteligente</span>
            <span style={styles.helperMiniText}>base inicial sem digitacao manual</span>
          </div>
          <button type="submit" style={styles.primaryButton} disabled={setupSubmitting}>
            {setupSubmitting ? "Importando base..." : "Importar base cadastral"}
          </button>
            </form>
          </article>

          <article style={styles.card}>
            <div style={styles.cardHeader}>
            <div>
              <div style={styles.sectionKicker}>Tabela mensal de repasse</div>
              <h3 style={styles.sectionTitle}>Remuneracao dos promotores</h3>
            </div>
            <div style={styles.cardHeaderBadge}>Mensal</div>
          </div>

          <form onSubmit={handlePromoterRemunerationSubmit} style={styles.formGrid}>
            <FormRow label="Arquivo da tabela">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) =>
                  setPromoterRemunerationFile(event.target.files?.[0] || null)
                }
                style={styles.input}
              />
            </FormRow>
            <div style={styles.helperText}>
              Essa carga transforma a planilha mensal de repasse em regras de
              producao e faixas de seguro para o calculo dos promotores.
            </div>
            <div style={styles.helperBadgeRow}>
              <span style={styles.badge}>mensal</span>
              <span style={styles.helperMiniText}>mantem o repasse alinhado a cada competencia</span>
            </div>
            <button
              type="submit"
              style={styles.primaryButton}
              disabled={promoterRemunerationSubmitting}
            >
              {promoterRemunerationSubmitting
                ? "Importando tabela..."
                : "Importar tabela de remuneracao"}
            </button>
          </form>
        </article>
      </div>
      ) : null}

      {activeSection === "fechamento" ? (
      <div style={styles.contentGrid}>
        <article style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.sectionKicker}>Fechamento mensal real</div>
              <h3 style={styles.sectionTitle}>Upload por CNPJ</h3>
            </div>
            <div style={styles.cardHeaderBadge}>Auditoria</div>
          </div>

          <form onSubmit={handleMonthlyClosingSubmit} style={styles.formGrid}>
            <FormRow label="Ano">
              <input
                value={form.year}
                onChange={(event) =>
                  setForm((current) => ({ ...current, year: event.target.value }))
                }
                style={styles.input}
              />
            </FormRow>
            <FormRow label="Mes">
              <select
                value={form.month}
                onChange={(event) =>
                  setForm((current) => ({ ...current, month: event.target.value }))
                }
                style={styles.input}
              >
                {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((month) => (
                  <option key={month} value={month}>
                    {month.padStart(2, "0")}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Empresa">
              <select
                value={form.companyId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, companyId: event.target.value }))
                }
                style={styles.input}
              >
                <option value="">Inferir pelo arquivo</option>
                {data.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Planilha">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                style={styles.input}
              />
            </FormRow>
            <button type="submit" style={styles.primaryButton} disabled={submitting}>
              {submitting ? "Importando..." : "Importar fechamento"}
            </button>
            </form>
          </article>

          <article style={styles.card}>
            <div style={styles.cardHeader}>
            <div>
              <div style={styles.sectionKicker}>Fontes previstas</div>
              <h3 style={styles.sectionTitle}>Organizacao das cargas</h3>
            </div>
          </div>

          <div style={styles.list}>
            <div style={styles.listItem}>
              <div>
                <div style={styles.itemTitle}>Base cadastral automatica</div>
                <div style={styles.itemMeta}>
                  Sobe Chaves J e usa a diaria para parametrizar empresa, MCI, Coban e
                  vinculos iniciais.
                </div>
              </div>
              <span style={styles.badge}>novo</span>
            </div>

            <div style={styles.listItem}>
              <div>
                <div style={styles.itemTitle}>Producao diaria</div>
                <div style={styles.itemMeta}>
                  Atualiza proposta sem duplicidade e alimenta toda a base mensal.
                </div>
              </div>
              <Link href="/importacao-diaria" style={styles.lightButton}>
                Abrir
              </Link>
            </div>

            <div style={styles.listItem}>
              <div>
                <div style={styles.itemTitle}>Fechamento mensal por empresa</div>
                <div style={styles.itemMeta}>
                  Atualiza o recebido real de credito, PRT, seguro e ajustes.
                </div>
              </div>
              <span style={styles.badge}>ativo</span>
            </div>

            <div style={styles.listItem}>
              <div>
                <div style={styles.itemTitle}>Tabela mensal de repasse</div>
                <div style={styles.itemMeta}>
                  Continua sendo tratada pela tela de regra por produto e excecoes.
                </div>
              </div>
              <Link href="/comissoes/produto" style={styles.lightButton}>
                Abrir
              </Link>
            </div>
          </div>
        </article>
      </div>
      ) : null}

      {activeSection === "historico" ? (
      <div style={styles.contentGrid}>
        <article style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.sectionKicker}>Historico</div>
              <h3 style={styles.sectionTitle}>Ultimas cargas diarias</h3>
            </div>
            <div style={styles.sectionChip}>{data.dailyImports.length} arquivos</div>
          </div>
          <div style={styles.list}>
            {loading ? (
              <EmptyStatePanel
                compact
                eyebrow="Historico"
                title="Carregando ultimas importacoes diarias."
                description="Assim que a leitura terminar, as cargas mais recentes aparecerao nesta lista."
              />
            ) : data.dailyImports.length === 0 ? (
              <EmptyStatePanel
                compact
                eyebrow="Sem diaria"
                title="Nenhuma importacao diaria foi registrada ainda."
                description="Suba a primeira diaria para alimentar producao, promotores e previsoes mensais."
                actionLabel="Abrir producao diaria"
                actionHref="/importacao-diaria"
              />
            ) : (
              data.dailyImports.map((row) => (
                <div key={row.id} style={styles.listItem}>
                  <div>
                    <div style={styles.itemTitle}>{row.file_name}</div>
                    <div style={styles.itemMeta}>
                      {formatDateTime(row.created_at)} | {row.rows_count || 0} linhas
                    </div>
                  </div>
                  <span style={styles.badge}>{row.status || "PENDING"}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <article style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.sectionKicker}>Historico</div>
              <h3 style={styles.sectionTitle}>Ultimos fechamentos mensais</h3>
            </div>
            <div style={styles.sectionChip}>{data.monthlyClosingImports.length} arquivos</div>
          </div>
          <div style={styles.list}>
            {loading ? (
              <EmptyStatePanel
                compact
                eyebrow="Historico"
                title="Carregando fechamentos mensais."
                description="A lista sera preenchida com os uploads por CNPJ ja gravados no sistema."
              />
            ) : data.monthlyClosingImports.length === 0 ? (
              <EmptyStatePanel
                compact
                eyebrow="Sem fechamento"
                title="Nenhum fechamento mensal foi importado ainda."
                description="Essa carga e a base do recebido real, do PRT e da auditoria financeira do grupo."
                actionLabel="Abrir fechamento"
                actionHref="/fechamento"
              />
            ) : (
              data.monthlyClosingImports.map((row) => {
                const isStuck = isProcessingStuck(row);
                return (
                  <div
                    key={row.id}
                    style={{
                      ...styles.listItem,
                      ...(isStuck ? styles.listItemWarning : {}),
                    }}
                  >
                    <div>
                      <div style={styles.itemTitle}>{row.company_name}</div>
                      <div style={styles.itemMeta}>
                        {String(row.month).padStart(2, "0")}/{row.year} | {row.file_name}
                        {row.created_at ? ` | ${formatDateTime(row.created_at)}` : ""}
                      </div>
                      {isStuck ? (
                        <div style={styles.stuckHint}>
                          Travado em PROCESSING ha mais de 5 minutos. Provavel falha
                          de upload (timeout/exception). Cancele para liberar a
                          competencia para novo upload.
                        </div>
                      ) : null}
                    </div>
                    <div style={styles.listItemActions}>
                      <span
                        style={{
                          ...styles.badge,
                          ...(isStuck ? styles.badgeWarning : {}),
                        }}
                      >
                        {row.status || "PENDING"}
                      </span>
                      {isStuck ? (
                        <button
                          type="button"
                          onClick={() => handleCancelImport(row)}
                          disabled={cancellingImportId === row.id}
                          style={styles.cancelButton}
                        >
                          {cancellingImportId === row.id
                            ? "Cancelando..."
                            : "Cancelar import"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>
      </div>
      ) : null}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value}</div>
    </article>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label style={styles.formRow}>
      <span style={styles.formLabel}>{label}</span>
      {children}
    </label>
  );
}

function formatCurrency(value?: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function isProcessingStuck(row: MonthlyClosingImport) {
  if (row.status !== "PROCESSING") return false;
  if (!row.created_at) return false;
  const created = new Date(row.created_at).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created > 5 * 60 * 1000;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "16px",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "14px",
  },
  heroMain: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,253,245,0.98) 100%)",
    borderRadius: "22px",
    padding: "22px",
    border: "1px solid var(--rr-line)",
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
    fontSize: "clamp(2rem, 3vw, 3.2rem)",
    color: "var(--rr-ink)",
  },
  description: {
    margin: "14px 0 0",
    fontSize: "14px",
    lineHeight: 1.62,
    color: "var(--rr-muted)",
  },
  heroSignals: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "14px",
  },
  heroSignal: {
    display: "grid",
    gap: "4px",
    minWidth: "142px",
    padding: "10px 12px",
    borderRadius: "16px",
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
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    borderRadius: "22px",
    padding: "20px",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "var(--rr-shadow)",
  },
  heroAsideLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "rgba(255,255,255,0.72)",
    marginBottom: "10px",
    fontWeight: 800,
  },
  heroAsideDescription: {
    margin: "0 0 12px",
    fontSize: "13px",
    lineHeight: 1.55,
    color: "rgba(255,255,255,0.78)",
  },
  quickLinks: {
    display: "grid",
    gap: "8px",
  },
  quickLink: {
    display: "grid",
    gap: "4px",
    textDecoration: "none",
    padding: "12px 14px",
    borderRadius: "14px",
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
  noticeBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(13,77,227,0.14)",
    color: "var(--rr-blue-deep)",
    borderRadius: "18px",
    padding: "16px",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
  },
  summaryCard: {
    borderRadius: "18px",
    padding: "16px",
    border: "1px solid var(--rr-line)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,249,176,0.42) 100%)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  summaryLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
    marginBottom: "8px",
  },
  summaryValue: {
    fontSize: "20px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    fontFamily: "var(--font-heading)",
  },
  subsectionNav: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "-2px",
  },
  subsectionButton: {
    border: "1px solid rgba(13,77,227,0.12)",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.92)",
    color: "var(--rr-blue-deep)",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "var(--rr-shadow-soft)",
  },
  subsectionButtonActive: {
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.98) 0%, rgba(7,37,125,0.98) 100%)",
    color: "#ffffff",
    border: "1px solid rgba(13,77,227,0.98)",
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "14px",
    alignItems: "start",
  },
  card: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    overflow: "hidden",
    paddingBottom: "18px",
  },
  cardHeader: {
    padding: "18px 18px 0",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  cardHeaderBadge: {
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
  sectionChip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.08)",
    border: "1px solid rgba(13,77,227,0.12)",
    color: "var(--rr-blue-deep)",
    fontSize: "12px",
    fontWeight: 800,
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
    fontSize: "22px",
    color: "var(--rr-ink)",
  },
  formGrid: {
    display: "grid",
    gap: "10px",
    padding: "14px 18px 0",
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
  helperText: {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--rr-muted)",
    background: "rgba(255,249,176,0.22)",
    border: "1px solid rgba(13,77,227,0.1)",
    borderRadius: "12px",
    padding: "10px 12px",
  },
  helperBadgeRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  helperMiniText: {
    fontSize: "12px",
    color: "var(--rr-muted)",
  },
  input: {
    width: "100%",
    borderRadius: "12px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "10px 12px",
    fontSize: "14px",
    color: "var(--rr-ink)",
    background: "rgba(255,255,255,0.96)",
    outline: "none",
  },
  primaryButton: {
    border: 0,
    borderRadius: "16px",
    padding: "14px 16px",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
    color: "#ffffff",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.98) 0%, rgba(7,37,125,0.98) 100%)",
    boxShadow: "0 14px 28px rgba(13,77,227,0.16)",
  },
  lightButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    border: "1px solid rgba(13,77,227,0.14)",
    borderRadius: "14px",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    background: "#fffdf6",
  },
  list: {
    display: "grid",
    gap: "10px",
    padding: "14px 18px 0",
  },
  listItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    padding: "14px",
    borderRadius: "16px",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.12) 0%, rgba(255,255,255,0.96) 100%)",
    border: "1px solid rgba(13,77,227,0.1)",
  },
  itemTitle: {
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    marginBottom: "4px",
  },
  itemMeta: {
    fontSize: "12px",
    color: "var(--rr-muted)",
    lineHeight: 1.5,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    background: "rgba(13,77,227,0.1)",
    color: "var(--rr-blue-deep)",
  },
  badgeWarning: {
    background: "rgba(217,119,6,0.15)",
    color: "#92400e",
  },
  listItemWarning: {
    background:
      "linear-gradient(135deg, rgba(254,243,199,0.85) 0%, rgba(255,247,237,0.96) 100%)",
    border: "1px solid rgba(217,119,6,0.35)",
  },
  listItemActions: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    alignItems: "flex-end",
  },
  stuckHint: {
    marginTop: "6px",
    fontSize: "12px",
    lineHeight: 1.45,
    color: "#92400e",
    background: "rgba(255,247,237,0.6)",
    borderRadius: "10px",
    padding: "8px 10px",
    border: "1px dashed rgba(217,119,6,0.4)",
    maxWidth: "440px",
  },
  cancelButton: {
    border: "1px solid rgba(217,119,6,0.45)",
    background: "rgba(255,255,255,0.96)",
    color: "#92400e",
    borderRadius: "12px",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  emptyState: {
    margin: "14px 18px 0",
    padding: "16px",
    fontSize: "14px",
    color: "var(--rr-muted)",
    lineHeight: 1.6,
    borderRadius: "16px",
    border: "1px dashed rgba(13,77,227,0.16)",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.04) 0%, rgba(255,255,255,0.96) 100%)",
  },
};
