"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { detectDailySource, DAILY_SOURCE_LABEL, type DailySource } from "@/lib/dailySourceDetect";
import { useUser } from "../../lib/auth/useUser";
import EmptyStatePanel from "../../components/EmptyStatePanel";
import FeedbackBanner from "../../components/FeedbackBanner";
import { UiStyles, HeaderNavy, KpiBand } from "@/components/ui";
import BbtsUploadReview from "@/components/bbts/BbtsUploadReview";
import TrpUploadReview from "@/components/trp/TrpUploadReview";
import PmrReconsolidarCard from "@/components/pmr/PmrReconsolidarCard";

// ============================================================
// /importacoes — identidade .rrimp.
// CAMADA A (real): planilha de remuneracao, fechamento mensal, historico,
//   KPIs — tudo via endpoints existentes (so troca a roupagem visual).
// CAMADA B (sem backend ainda / Frente 2): card "TRP do mes" e a
//   conferencia TRP x planilha — renderizados como "Em breve", desabilitados,
//   sem acao falsa e sem numeros inventados.
// ============================================================

type Company = { id: string; name: string; cnpj: string };

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

type DailyAffectedPeriod = { year: number; month: number; companies_count: number };

type DailyResult = {
  fileName: string;
  processed: number;
  inserted: number;
  updated: number;
  duplicatesInFile: number;
  errorsCount: number;
  affectedPeriods: DailyAffectedPeriod[];
  recalculated: number;
  zeroRows: boolean;
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

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const MONTHS_ABBR = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function competenceLabel(month: number, year: number) {
  const abbr = MONTHS_ABBR[month - 1] || String(month).padStart(2, "0");
  return `${abbr}/${year}`;
}

// Empresa ADS (BBTS): o fechamento dela vem em 2 PDFs (crédito + seguro), não xlsx.
const ADS_COMPANY_ID = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

export default function ImportacoesPage() {
  const { user } = useUser();
  const isFuncionario = user?.role === "funcionario";

  const [activeSection, setActiveSection] = useState<"base" | "diaria" | "fechamento" | "historico">("base");
  const [data, setData] = useState<ImportacoesPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // Fechamento ADS (2 PDFs): crédito + seguro.
  const [adsCreditoFile, setAdsCreditoFile] = useState<File | null>(null);
  const [adsSeguroFile, setAdsSeguroFile] = useState<File | null>(null);
  const [adsSubmitting, setAdsSubmitting] = useState(false);
  const [promoterRemunerationFile, setPromoterRemunerationFile] = useState<File | null>(null);
  const [promoterRemunerationSubmitting, setPromoterRemunerationSubmitting] = useState(false);
  const [cancellingImportId, setCancellingImportId] = useState<string | null>(null);
  // ABA DIARIA — estado proprio, independente das outras abas. A carga diaria
  // e liberada para socio E funcionario (API usa withSocioOrFuncionarioAdmin),
  // por isso nao reaproveita o gating de isFuncionario das abas Base/Fechamento.
  const [dailyFile, setDailyFile] = useState<File | null>(null);
  const [dailySubmitting, setDailySubmitting] = useState(false);
  const [dailyResult, setDailyResult] = useState<DailyResult | null>(null);
  const [dailyError, setDailyError] = useState("");
  const [dailyPhase, setDailyPhase] = useState<"" | "importing" | "recalculating">("");
  const [dailyRecalcLabel, setDailyRecalcLabel] = useState("");
  // ORIGEM da diária: auto-detect pela assinatura de colunas/abas + override manual.
  const [detectedSource, setDetectedSource] = useState<DailySource | null>(null);
  const [sourceOverride, setSourceOverride] = useState<DailySource | "">("");
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
      if (!response.ok) throw new Error(payload?.error || "Erro ao carregar importacoes.");
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

  // Abre a aba certa quando chega com ?tab=diaria (ou #diaria) — usado pelo
  // redirect da tela antiga /importacao-diaria e por links diretos.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get("tab") || window.location.hash.replace("#", "")).toLowerCase();
    if (raw === "base" || raw === "diaria" || raw === "fechamento" || raw === "historico") {
      setActiveSection(raw);
    }
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
        } catch (e) {
          reject(e);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: base64,
          fileName: file.name,
          year: Number(form.year),
          month: Number(form.month),
          companyId: form.companyId || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Erro ao importar fechamento mensal.");
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

  async function handleAdsClosingSubmit() {
    if (!adsCreditoFile) {
      setError("Envie ao menos o PDF de crédito da ADS.");
      return;
    }
    try {
      setAdsSubmitting(true);
      setError("");
      setNotice("");
      const creditoFile = await fileToBase64(adsCreditoFile);
      const seguroFile = adsSeguroFile ? await fileToBase64(adsSeguroFile) : null;
      const response = await fetch("/api/import/closing/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditoFile, seguroFile, fileName: adsCreditoFile.name }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Erro ao importar o fechamento ADS.");
      setNotice(
        `Fechamento ADS importado (${competenceLabel(payload.month, payload.year)}): ${payload.gravadas} linha(s), ` +
          `${payload.com_seguro} com seguro. Âncoras ${payload.ancora_ok ? "conferidas ✔" : "NÃO fecharam ✖"}.`
      );
      setAdsCreditoFile(null);
      setAdsSeguroFile(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Erro ao importar o fechamento ADS.");
    } finally {
      setAdsSubmitting(false);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: base64,
          fileName: promoterRemunerationFile.name,
          year: Number(form.year),
          month: Number(form.month),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Erro ao importar tabela mensal de remuneracao.");
      setNotice(
        `Tabela de remuneracao importada com sucesso. ${payload.summary?.productionRules || 0} regras de producao e ${
          payload.summary?.insuranceBands || 0
        } faixas de seguro preparadas para ${String(form.month).padStart(2, "0")}/${form.year}.`
      );
      setPromoterRemunerationFile(null);
    } catch (err: any) {
      setError(err.message || "Erro ao importar tabela mensal de remuneracao.");
    } finally {
      setPromoterRemunerationSubmitting(false);
    }
  }

  // Lê abas + cabeçalho da 1ª linha e detecta a origem, SEM enviar nada (só p/
  // mostrar o formato antes do upload; o servidor re-detecta/valida no envio).
  async function detectSourceFromFile(selectedFile: File) {
    try {
      const buf = await selectedFile.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const header = (XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], {
        header: 1,
        blankrows: false,
      })[0] || []) as Array<string | number>;
      setDetectedSource(detectDailySource({ sheetNames: wb.SheetNames, headers: header }));
    } catch {
      setDetectedSource(null);
    }
  }

  async function handleDailySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dailyFile) {
      setDailyError("Selecione uma planilha de produção antes de enviar.");
      return;
    }
    const source: DailySource | undefined = sourceOverride || detectedSource || undefined;
    if (!source) {
      setDailyError("Não foi possível identificar o formato da planilha. Escolha a origem no seletor antes de enviar.");
      return;
    }
    try {
      setDailySubmitting(true);
      setDailyError("");
      setDailyResult(null);
      setDailyPhase("importing");
      setDailyRecalcLabel("");

      const base64 = await fileToBase64(dailyFile);

      // A API infere competência, empresa e promotor da própria planilha —
      // por isso NÃO enviamos year/month/company.
      const response = await fetch("/api/import/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: base64, fileName: dailyFile.name, source }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Erro ao importar a planilha.");

      // CRÍTICO — recálculo em loop (porte de app/importacao-diaria/page.js):
      // a importação invalida os snapshots mensais; o dashboard só volta a
      // bater se recalcularmos cada competência afetada aqui no client.
      const affectedPeriods: DailyAffectedPeriod[] = Array.isArray(data?.affected_periods)
        ? data.affected_periods
        : [];
      let recalculated = 0;
      if (affectedPeriods.length > 0) {
        setDailyPhase("recalculating");
        for (const period of affectedPeriods) {
          setDailyRecalcLabel(competenceLabel(period.month, period.year));
          const calcResponse = await fetch("/api/calculate/monthly", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year: period.year, month: period.month }),
          });
          const calcPayload = await calcResponse.json();
          if (!calcResponse.ok) {
            throw new Error(
              calcPayload?.error ||
                "A planilha foi importada, mas o recálculo automático falhou."
            );
          }
          recalculated += 1;
        }
      }

      const inserted = data.inserted ?? 0;
      const updated = data.updated ?? 0;
      setDailyResult({
        fileName: dailyFile.name,
        processed: data.processed ?? 0,
        inserted,
        updated,
        duplicatesInFile: data.duplicates_in_file ?? 0,
        errorsCount: data.errors_count ?? 0,
        affectedPeriods,
        recalculated,
        // Falha silenciosa: API responde 200 mas nada entrou na base.
        zeroRows: inserted === 0 && updated === 0,
      });
      // Atualiza KPIs e histórico de cargas diárias no topo da tela.
      await loadData();
    } catch (err: any) {
      setDailyError(err.message || "Erro inesperado ao importar a planilha.");
    } finally {
      setDailyPhase("");
      setDailyRecalcLabel("");
      setDailySubmitting(false);
    }
  }

  async function handleCancelImport(row: MonthlyClosingImport) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Cancelar import travado de ${row.company_name} (${String(row.month).padStart(2, "0")}/${row.year})?\n\n` +
          `Arquivo: ${row.file_name}\nStatus: ${row.status || "PROCESSING"}\n\n` +
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
      if (!response.ok) throw new Error(payload?.error || "Falha ao cancelar import.");
      setNotice(`Import ${row.id.slice(0, 8)} cancelado. Voce pode refazer o upload sem conflito.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Falha ao cancelar import.");
    } finally {
      setCancellingImportId(null);
    }
  }

  const lastDaily = data.dailyImports[0];
  const lastMonthly = data.monthlyClosingImports[0];

  return (
    <div className="rrimp">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <span>Dashboard</span>
          <span className="sep">/</span>
          <span>Operação</span>
          <span className="sep">/</span>
          <span>Importações</span>
        </nav>

        {/* HEADER navy (kit) — KPIs + abas como children (modelo Financeiro) */}
        <HeaderNavy
          brand="GRUPO RR CRED"
          title="Importações"
          subtitle="Entrada de dados do sistema"
          actions={
            <div className="role">
              <span className="d" />
              {isFuncionario ? "Auxiliar Financeiro · leitura" : "Sócio · acesso total"}
            </div>
          }
        >
          <KpiBand
            valueSize={22}
            items={[
              { label: "Cargas diárias", value: data.summary.dailyImports, sub: "total importadas" },
              { label: "Fechamentos mensais", value: data.summary.monthlyClosingImports, sub: "total importados" },
              { label: "Última diária", value: formatDateTime(data.summary.lastDailyImportAt), sub: lastDaily ? `${lastDaily.rows_count || 0} linhas · ${lastDaily.file_name}` : "sem cargas ainda", accent: true },
              { label: "Último fechamento", value: formatDateTime(data.summary.lastMonthlyClosingImportAt), sub: lastMonthly ? `${lastMonthly.company_name} · ${String(lastMonthly.month).padStart(2, "0")}/${lastMonthly.year}` : "sem fechamentos ainda" },
            ]}
          />
          <div className="tabbar" role="tablist">
            <button className={`tab${activeSection === "base" ? " on" : ""}`} onClick={() => setActiveSection("base")}>
              <span className="tn">1</span>Base operacional
            </button>
            <button className={`tab${activeSection === "diaria" ? " on" : ""}`} onClick={() => setActiveSection("diaria")}>
              <span className="tn">2</span>Diária
            </button>
            <button className={`tab${activeSection === "fechamento" ? " on" : ""}`} onClick={() => setActiveSection("fechamento")}>
              <span className="tn">3</span>Fechamento mensal
            </button>
            <button className={`tab${activeSection === "historico" ? " on" : ""}`} onClick={() => setActiveSection("historico")}>
              <span className="tn">4</span>Histórico
            </button>
          </div>
        </HeaderNavy>

        {/* INFO · fluxo recomendado */}
        <div className="infobar">
          <span className="ic">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 16v-5" /><path d="M12 8h.01" />
            </svg>
          </span>
          <div className="txt"><b>Fluxo recomendado.</b> Mantenha a ordem para o fechamento e a auditoria baterem.</div>
          <div className="flow">
            <span className="step"><span className="n">1</span>Planilha de remuneração do mês</span>
            <Arrow />
            <span className="step"><span className="n">2</span>Diária</span>
            <Arrow />
            <span className="step"><span className="n">3</span>Fechamento</span>
            <Arrow />
            <span className="step"><span className="n">4</span>Conferência em auditoria</span>
          </div>
        </div>

        {error ? (
          <FeedbackBanner
            variant="error"
            eyebrow="Carga interrompida"
            title="Nao foi possivel concluir a operacao de importacao."
            description={error}
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

        {/* ===================== ABA BASE OPERACIONAL ===================== */}
        {activeSection === "base" ? (
          <>
            {/* TRP self-service (F6b) — upload + revisão do PDF da TRP (sócio+funcionário
                veem; só sócio confirma). Confirmar GRAVA de verdade desde a F6b.3:
                cria a versão ativa em trp_rule_versions, que é a fonte do motor. */}
            <TrpUploadReview canConfirm={!isFuncionario} />

            {/* Régua BBTS (auditoria ADS, 1A) — mesmo fluxo self-service da TRP, para a
                TABELA DE PAGAMENTO da BBTS. Grava em bbts_rule_versions; NÃO muda a
                comissão do promotor na ADS (essa continua saindo da TRP da Promotiva). */}
            <BbtsUploadReview canConfirm={!isFuncionario} />

            {isFuncionario ? (
              <div className="lockbar"><IcoLock /><span><b>Disponível apenas para sócio.</b> Você pode consultar o histórico das cargas.</span></div>
            ) : null}

            <div className={`two-up${isFuncionario ? " locked" : ""}`}>
              {/* CARD PLANILHA REMUNERACAO — CAMADA A (real) */}
              <section className="ucard">
                <div className="ucard-head">
                  <div className="tt">
                    <span className="badge"><IcoGrid /></span>
                    <div>
                      <h3>Planilha de remuneração mensal (RR)</h3>
                      <p className="csub">Regras de produção e faixas de seguro do mês — vira o repasse por linha.</p>
                    </div>
                  </div>
                  <span className="fmt">.xlsx</span>
                </div>
                {isFuncionario ? (
                  <div className="lockbar"><IcoLock /><span><b>Disponível apenas para sócio.</b></span></div>
                ) : null}
                <form onSubmit={handlePromoterRemunerationSubmit}>
                  <div className="frow">
                    <Field label="Ano">
                      <input type="number" value={form.year} disabled={isFuncionario}
                        onChange={(e) => setForm((c) => ({ ...c, year: e.target.value }))} />
                    </Field>
                    <Field label="Mês (competência)" select>
                      <select value={form.month} disabled={isFuncionario}
                        onChange={(e) => setForm((c) => ({ ...c, month: e.target.value }))}>
                        {MONTHS.map((m, i) => <option key={i + 1} value={String(i + 1)}>{m}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Dropzone disabled={isFuncionario} accept=".xlsx,.xls"
                    file={promoterRemunerationFile} onFile={setPromoterRemunerationFile}
                    title="selecione a planilha" sub="INSS · Público · Privado · Seguro · BBCAP …" />
                  <div className="uact">
                    <span className="uhint"><IcoInfo />Grava as regras de produção do mês.</span>
                    <button type="submit" className={`btn-primary${isFuncionario ? " dis" : ""}`} disabled={isFuncionario || promoterRemunerationSubmitting}>
                      {promoterRemunerationSubmitting ? <><span className="spinner" />Importando…</> : <><span className="ck"><IcoUp /></span>Importar planilha</>}
                    </button>
                  </div>
                </form>
              </section>
            </div>

            {/* Conferencia TRP x realizado — PONTEIRO: a conferência vive na Auditoria */}
            <section className="lcard">
              <div className="conf-head">
                <div className="lt">
                  <span className="ic"><IcoCheckSquare /></span>
                  <div>
                    <h3>Conferência · TRP × realizado</h3>
                    <p className="csub">Cruzamento dos percentuais da TRP versionada com o que a Promotiva pagou, por contrato.</p>
                  </div>
                </div>
                <a className="seal" href="/auditoria#conferencia-trp" style={{ textDecoration: "none" }}>Abrir na Auditoria →</a>
              </div>
              <div className="soon-body">
                <IcoSparkle />
                <div>
                  <div className="sb-t">A conferência agora vive na Auditoria</div>
                  <div className="sb-s">
                    Compara, por competência e por contrato, o realizado (o que a Promotiva pagou à vista)
                    contra a régua da TRP versionada — teto 6% liso — e sinaliza subpagamentos.
                    Abra em <a href="/auditoria#conferencia-trp">Auditoria → Conferência TRP × realizado</a>.
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {/* ===================== ABA DIARIA ===================== */}
        {activeSection === "diaria" ? (
          <>
            <div className="viewlabel">
              <span className="tag">ABA 2</span>
              <h2>Diária</h2>
              <span className="who">carga da produção do dia</span>
              <span className="rule" />
            </div>

            {/* Diaria NAO e socio-only: liberada para socio E funcionario. */}
            <div className="openbar">
              <span className="ic"><IcoUsers /></span>
              <div className="txt">
                <b>Rotina operacional aberta.</b> A carga diária pode ser feita por sócio e por funcionário — sem bloqueio.
              </div>
              <div className="roles">
                <span className="rp"><span className="d" />Sócio</span>
                <span className="rp"><span className="d" />Auxiliar Financeiro</span>
              </div>
            </div>

            <div className="two-up dia-two">
              {/* CARD principal · Producao diaria */}
              <section className="ucard">
                <div className="ucard-head">
                  <div className="tt">
                    <span className="badge"><IcoGrid /></span>
                    <div>
                      <h3>Produção diária (.xlsx)</h3>
                      <p className="csub">Carga da produção do dia. Competência, empresa e promotor são detectados automaticamente da planilha.</p>
                    </div>
                  </div>
                  <span className="fmt">.xlsx · .xls</span>
                </div>

                <form onSubmit={handleDailySubmit}>
                  {/* substitui Ano/Mes/Empresa: deteccao automatica */}
                  <div className="autobar">
                    <span className="ic"><IcoSparkleSm /></span>
                    <div className="t"><b>Sem seleção de ano, mês ou empresa.</b> Tudo é lido do próprio arquivo — pode importar a planilha direto.</div>
                  </div>

                  <Dropzone
                    accept=".xlsx,.xls"
                    file={dailyFile}
                    onFile={(f) => {
                      setDailyFile(f);
                      setDailyError("");
                      setSourceOverride("");
                      setDetectedSource(null);
                      if (f) detectSourceFromFile(f);
                    }}
                    title="selecione a planilha de produção"
                    sub="Formato .xlsx ou .xls · uma planilha pode conter vários dias"
                  />

                  {/* ORIGEM detectada + override (protege contra cabeçalho novo) */}
                  {dailyFile ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", margin: "12px 0", padding: "10px 12px", border: "1px solid var(--rrimp-line, #e3e8ef)", borderRadius: 10, background: "var(--rrimp-soft, #f7f9fc)" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span className="ic" aria-hidden><IcoSearch /></span>
                        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.6 }}>Formato detectado</span>
                          <strong style={{ fontSize: 14, color: detectedSource ? "inherit" : "#b45309" }}>
                            {detectedSource ? DAILY_SOURCE_LABEL[detectedSource] : "Não identificado — escolha a origem"}
                          </strong>
                        </div>
                      </div>
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                        <span style={{ opacity: 0.7 }}>Origem</span>
                        <select
                          value={sourceOverride}
                          onChange={(e) => setSourceOverride(e.target.value as DailySource | "")}
                          style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--rrimp-line, #e3e8ef)" }}
                        >
                          <option value="">{detectedSource ? `Auto (${DAILY_SOURCE_LABEL[detectedSource]})` : "Auto (não identificado)"}</option>
                          <option value="promotiva">{DAILY_SOURCE_LABEL["promotiva"]}</option>
                          <option value="ads-credito">{DAILY_SOURCE_LABEL["ads-credito"]}</option>
                          <option value="ads-seguro">{DAILY_SOURCE_LABEL["ads-seguro"]}</option>
                        </select>
                      </label>
                    </div>
                  ) : null}

                  <div className="rules-wrap">
                    <div className="rules-lab">Como cada linha entra</div>
                    <div className="rules">
                      <span className="chip g static"><span className="d" />Só Produção entra no cálculo</span>
                      <span className="chip a static"><span className="d" />Em aberto aguarda</span>
                      <span className="chip r"><span className="d" />Cancelado não entra</span>
                      <span className="chip n"><span className="d" />Mesma proposta atualiza sem duplicar</span>
                    </div>
                  </div>

                  <div className="uact">
                    <span className="uhint"><IcoInfo />Recalcula o dashboard das competências afetadas.</span>
                    <button type="submit" className="btn-primary" disabled={dailySubmitting}>
                      {dailySubmitting ? (
                        <><span className="spinner" />{dailyPhase === "recalculating" ? "Atualizando dashboard…" : "Importando planilha…"}</>
                      ) : (
                        <><span className="ck"><IcoUp /></span>Enviar planilha</>
                      )}
                    </button>
                  </div>
                </form>
              </section>

              {/* Auto-detect explainer */}
              <section className="dia-note">
                <div className="nc-head">
                  <span className="badge"><IcoSearch /></span>
                  <div><h3>Detecção automática</h3><p className="csub">Lido de cada linha do arquivo</p></div>
                </div>
                <div className="detect">
                  <div className="row">
                    <span className="dic"><IcoCalSm /></span>
                    <div className="dm"><div className="dt">Competência <span className="src">data da linha</span></div><div className="ds">Cada linha vai para o mês da sua própria data.</div></div>
                  </div>
                  <div className="row">
                    <span className="dic"><IcoBank /></span>
                    <div className="dm"><div className="dt">Empresa <span className="src">MCI / Coban</span></div><div className="ds">CNPJ resolvido pelo código da agência.</div></div>
                  </div>
                  <div className="row">
                    <span className="dic"><IcoUser /></span>
                    <div className="dm"><div className="dt">Promotor <span className="src">Chave J</span></div><div className="ds">Vinculado ao promotor pela chave do operador.</div></div>
                  </div>
                </div>
                <div className="multi">
                  <IcoCalSm />
                  <div>Uma planilha pode afetar <b>vários meses</b> — cada competência é recalculada por conta própria.</div>
                </div>
              </section>
            </div>

            {/* estado intermediario: importando / recalculando */}
            {dailySubmitting ? (
              <div className="lcard">
                <div className="recalc">
                  <span className="spin" />
                  <div className="rtx">
                    {dailyPhase === "recalculating" ? (
                      <>Atualizando valores do dashboard… <span>recalculando {dailyRecalcLabel}</span></>
                    ) : (
                      <>Importando planilha… <span>lendo e gravando as propostas</span></>
                    )}
                  </div>
                  <div className="rbar"><div className="rfill" /></div>
                </div>
              </div>
            ) : null}

            {/* erro */}
            {dailyError && !dailySubmitting ? (
              <div className="dia-banner err">
                <span className="bic"><IcoErrCircle /></span>
                <div><b>Não foi possível importar</b><span>{dailyError}</span></div>
              </div>
            ) : null}

            {/* ATENCAO · falha silenciosa (0 linhas) */}
            {dailyResult && dailyResult.zeroRows && !dailySubmitting ? (
              <>
                <div className="viewlabel">
                  <span className="tag">ATENÇÃO</span>
                  <h2>Falha silenciosa · 0 linhas</h2>
                  <span className="who">a API respondeu, mas nada entrou</span>
                  <span className="rule" />
                </div>
                <div className="alert">
                  <span className="aic"><IcoAlert22 /></span>
                  <div className="abody">
                    <div className="ahead">
                      <span className="at">Atenção: nenhuma linha foi importada.</span>
                      <span className="chip r lg"><span className="d" />0 inseridas</span>
                    </div>
                    <p className="ax">
                      Verifique se o <b>cabeçalho da planilha está correto</b> (colunas esperadas). O arquivo foi
                      recebido, mas nenhuma linha pôde ser interpretada — isto <b>não conta como sucesso</b>.
                    </p>
                    <div className="checklist">
                      <div className="ci"><span className="cb"><IcoCheckSm /></span>Colunas esperadas: <code>Data</code> <code>MCI/Coban</code> <code>Chave J</code> <code>Proposta</code> <code>Situação</code> <code>Valor</code></div>
                      <div className="ci"><span className="cb"><IcoCheckSm /></span>O cabeçalho deve estar na primeira linha, sem linhas em branco acima.</div>
                    </div>
                    <div className="afoot">
                      <span className="api">resposta da API <span className="mono">200 OK · {formatInt(dailyResult.processed)} lidas · rows_imported: 0</span></span>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {/* RESULTADO · sucesso */}
            {dailyResult && !dailyResult.zeroRows && !dailySubmitting ? (
              <>
                <div className="viewlabel">
                  <span className="tag">RESULTADO</span>
                  <h2>Resumo da importação</h2>
                  <span className="who">após envio bem-sucedido</span>
                  <span className="rule" />
                </div>
                <section className="lcard">
                  <div className="res-head">
                    <div className="lt">
                      <span className="ic"><IcoChart /></span>
                      <div>
                        <h3>Resumo da importação</h3>
                        <p className="csub">
                          <span className="mono">{dailyResult.fileName}</span>
                          <span>·</span>
                          {dailyResult.recalculated} {dailyResult.recalculated === 1 ? "competência recalculada" : "competências recalculadas"}
                        </p>
                      </div>
                    </div>
                    <span className="chip g static lg"><span className="d" />Importada</span>
                  </div>

                  <div className="rstats">
                    <div className="rstat proc"><div className="rl"><span className="di" />Processados</div><div className="rn num">{formatInt(dailyResult.processed)}</div><div className="rs">linhas lidas</div></div>
                    <div className="rstat ins"><div className="rl"><span className="di" />Inseridos</div><div className="rn num">{formatInt(dailyResult.inserted)}</div><div className="rs">propostas novas</div></div>
                    <div className="rstat upd"><div className="rl"><span className="di" />Atualizados</div><div className="rn num">{formatInt(dailyResult.updated)}</div><div className="rs">já existiam</div></div>
                    <div className="rstat comp"><div className="rl"><span className="di" />Competências</div><div className="rn num">{formatInt(dailyResult.recalculated)}</div><div className="rs">recalculadas</div></div>
                    <div className="rstat err"><div className="rl"><span className="di" />Erros</div><div className="rn num">{formatInt(dailyResult.errorsCount)}</div><div className="rs">linhas ignoradas</div></div>
                  </div>

                  {dailyResult.affectedPeriods.length > 0 ? (
                    <div className="comp-sec">
                      <div className="comp-lab">Competências afetadas</div>
                      <div className="comp-grid">
                        {dailyResult.affectedPeriods.map((p) => (
                          <div className="comp-item" key={`${p.year}-${p.month}`}>
                            <span className="cm"><IcoCalSm /></span>
                            <div>
                              <div className="ct">{competenceLabel(p.month, p.year)}</div>
                              <div className="cs">{p.companies_count} {p.companies_count === 1 ? "empresa" : "empresas"}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}
          </>
        ) : null}

        {/* ===================== ABA FECHAMENTO ===================== */}
        {activeSection === "fechamento" ? (
          <>
            {isFuncionario ? (
              <div className="lockbar"><IcoLock /><span><b>Disponível apenas para sócio.</b> Você acompanha o status na auditoria.</span></div>
            ) : null}

            {/* Reconsolidar o PMR de uma competência JÁ FECHADA (Movimento 1 do ledger).
                O import de fechamento abaixo já reconsolida sozinho; este card é para
                BACKFILL (competência que fechou antes da frente) e RE-FECHAMENTO (corrigiu
                órfão/chave master e quer refazer sem reimportar o arquivo). "Simular" é
                dry-run e nunca grava; só sócio confirma a gravação. */}
            <PmrReconsolidarCard canConfirm={!isFuncionario} />
            <div className={`two-up${isFuncionario ? " locked" : ""}`}>
              <section className="ucard">
                {/* O cabeçalho acompanha o MODO do card: ao escolher a ADS no seletor de
                    empresa, o formulário troca o .xlsx pelos 2 PDFs (crédito + seguro) —
                    o título, o subtítulo e o selo de formato precisam trocar junto, senão
                    o card parece servir só ao RR e o caminho do import ADS fica escondido. */}
                <div className="ucard-head">
                  <div className="tt">
                    <span className="badge"><IcoFile /></span>
                    {form.companyId === ADS_COMPANY_ID ? (
                      <div>
                        <h3>Importar fechamento ADS</h3>
                        <p className="csub">2 PDFs (crédito + seguro). A competência vem do próprio PDF.</p>
                      </div>
                    ) : (
                      <div>
                        <h3>Importar fechamento</h3>
                        <p className="csub">Planilha final da competência, por CNPJ.</p>
                      </div>
                    )}
                  </div>
                  <span className="fmt">{form.companyId === ADS_COMPANY_ID ? ".pdf" : ".xlsx"}</span>
                </div>
                <form onSubmit={handleMonthlyClosingSubmit}>
                  <div className="frow">
                    <Field label="Ano">
                      <input type="number" value={form.year} disabled={isFuncionario}
                        onChange={(e) => setForm((c) => ({ ...c, year: e.target.value }))} />
                    </Field>
                    <Field label="Mês" select>
                      <select value={form.month} disabled={isFuncionario}
                        onChange={(e) => setForm((c) => ({ ...c, month: e.target.value }))}>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                          <option key={m} value={String(m)}>{String(m).padStart(2, "0")}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Empresa" select full>
                      <select value={form.companyId} disabled={isFuncionario}
                        onChange={(e) => setForm((c) => ({ ...c, companyId: e.target.value }))}>
                        <option value="">Inferir pelo arquivo</option>
                        {data.companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}{c.cnpj ? ` · ${c.cnpj}` : ""}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {form.companyId === ADS_COMPANY_ID ? (
                    <>
                      {/* ADS: fechamento vem em 2 PDFs (crédito + seguro). */}
                      <div className="autobar" style={{ marginBottom: 10 }}>
                        <span className="ic"><IcoInfo /></span>
                        <div className="t"><b>ADS — fechamento por PDF.</b> Envie o PDF de crédito (obrigatório) e o de seguro. A competência é lida do próprio arquivo; as âncoras do PDF são conferidas antes de gravar.</div>
                      </div>
                      <div className="two-up">
                        <Dropzone disabled={isFuncionario} accept=".pdf"
                          file={adsCreditoFile} onFile={setAdsCreditoFile}
                          title="PDF de crédito (Crédito ADS-BBTS)" sub="obrigatório · .pdf" />
                        <Dropzone disabled={isFuncionario} accept=".pdf"
                          file={adsSeguroFile} onFile={setAdsSeguroFile}
                          title="PDF de seguro (Seguro ADS-BBTS)" sub="opcional · .pdf" />
                      </div>
                      <div className="uact">
                        <span className="uhint"><IcoInfo />Grava na produção ADS; âncora do PDF valida antes.</span>
                        <button type="button" onClick={handleAdsClosingSubmit} className={`btn-primary${isFuncionario ? " dis" : ""}`} disabled={isFuncionario || adsSubmitting || !adsCreditoFile}>
                          {adsSubmitting ? <><span className="spinner" />Importando…</> : <><span className="ck"><IcoUp /></span>Importar fechamento ADS</>}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Dropzone disabled={isFuncionario} accept=".xlsx,.xls"
                        file={file} onFile={setFile}
                        title="selecione a planilha" sub="Fechamento da competência · até 25 MB" />
                      <div className="uact">
                        <span className="uhint"><IcoInfo />Disponível na auditoria após importar.</span>
                        <button type="submit" className={`btn-primary${isFuncionario ? " dis" : ""}`} disabled={isFuncionario || submitting}>
                          {submitting ? <><span className="spinner" />Importando…</> : <><span className="ck"><IcoUp /></span>Importar fechamento</>}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              </section>

              <section className="ucard notecard">
                <div className="ucard-head" style={{ marginBottom: 14 }}>
                  <div className="tt"><span className="badge"><IcoAlert /></span><div><h3>Antes de importar</h3><p className="csub">Checagem rápida</p></div></div>
                </div>
                <ul>
                  <li>Planilha de remuneração do mês já importada.</li>
                  <li>Confira o CNPJ — ou deixe <b>Inferir pelo arquivo</b>.</li>
                  <li>Um fechamento por empresa/competência.</li>
                  <li>Reimportar substitui o fechamento anterior.</li>
                </ul>
              </section>
            </div>
          </>
        ) : null}

        {/* ===================== ABA HISTORICO (real) ===================== */}
        {activeSection === "historico" ? (
          <div className="two-up">
            {/* Cargas diarias */}
            <section className="lcard">
              <div className="lcard-head"><h3>Últimas cargas diárias</h3><span className="cnt">{data.dailyImports.length} arquivos</span></div>
              {loading ? (
                <EmptyStatePanel compact eyebrow="Histórico" title="Carregando últimas importações diárias." description="As cargas mais recentes aparecerão aqui." />
              ) : data.dailyImports.length === 0 ? (
                <div className="lempty">
                  <div className="art"><IcoBox /></div>
                  <div className="et">Nenhuma importação diária ainda</div>
                  <div className="es">As cargas que você importar aparecem aqui com arquivo, data e status.</div>
                </div>
              ) : (
                data.dailyImports.map((row) => {
                  const sc = statusChip(row.status);
                  return (
                    <div key={row.id} className="lrow">
                      <span className="fic"><IcoFileSm /></span>
                      <div className="meta">
                        <div className="fn mono">{row.file_name}</div>
                        <div className="det">
                          <span>{formatDateTime(row.created_at)}</span>
                          <span className="sepd">·</span>
                          <span>{row.rows_count || 0} linhas</span>
                        </div>
                      </div>
                      <div className="right"><Chip cls={sc.cls} label={sc.label} /></div>
                    </div>
                  );
                })
              )}
            </section>

            {/* Fechamentos mensais */}
            <section className="lcard">
              <div className="lcard-head"><h3>Últimos fechamentos mensais</h3><span className="cnt">{data.monthlyClosingImports.length} arquivos</span></div>
              {loading ? (
                <EmptyStatePanel compact eyebrow="Histórico" title="Carregando fechamentos mensais." description="Os uploads por CNPJ já gravados aparecem aqui." />
              ) : data.monthlyClosingImports.length === 0 ? (
                <div className="lempty">
                  <div className="art"><IcoBox /></div>
                  <div className="et">Nenhum fechamento mensal ainda</div>
                  <div className="es">Essa carga é a base do recebido real, do PRT e da auditoria financeira.</div>
                </div>
              ) : (
                data.monthlyClosingImports.map((row) => {
                  const stuck = isProcessingStuck(row);
                  const sc = stuck ? { cls: "a", label: "Processando" } : statusChip(row.status);
                  return (
                    <div key={row.id} className={`lrow${stuck ? " busy" : ""}`}>
                      <span className="fic"><IcoCalSm /></span>
                      <div className="meta">
                        <div className="fn"><span className="emp">{row.company_name}</span> · <span className="mono">{String(row.month).padStart(2, "0")}/{row.year}</span></div>
                        <div className="det">
                          <span className="mono">{row.file_name}</span>
                          {row.created_at ? <><span className="sepd">·</span><span>{formatDateTime(row.created_at)}</span></> : null}
                          {stuck ? <><span className="sepd">·</span><span>travado &gt; 5 min</span></> : null}
                        </div>
                      </div>
                      <div className="right">
                        <Chip cls={sc.cls} label={sc.label} />
                        {stuck ? (
                          <button type="button" className="cancelbtn" disabled={cancellingImportId === row.id} onClick={() => handleCancelImport(row)}>
                            {cancellingImportId === row.id ? "Cancelando…" : "Cancelar import"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

// ---------- subcomponents ----------
function Field({ label, children, select, full }: { label: string; children: ReactNode; select?: boolean; full?: boolean }) {
  return (
    <div className={`fld${full ? " full" : ""}`}>
      <label>{label}</label>
      <div className="ctrl">
        {children}
        {select ? <span className="chev">▾</span> : null}
      </div>
    </div>
  );
}

function Dropzone({
  file, onFile, disabled, pdf, accept, title, sub,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
  pdf?: boolean;
  accept: string;
  title: string;
  sub: string;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      className={`dropzone${pdf ? " pdf" : ""}${file ? " filled" : ""}${drag ? " drag" : ""}`}
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <input type="file" accept={accept} hidden disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] || null)} />
      <span className="dz-ic">{pdf ? <IcoPdf /> : <IcoUp22 />}</span>
      <span className="dz-t">
        {file ? <span className="br">{file.name}</span> : <>Arraste ou <span className="br">{title}</span></>}
      </span>
      <span className="dz-s">{file ? "Pronto para enviar" : sub}</span>
    </label>
  );
}

function Chip({ cls, label }: { cls: string; label: string }) {
  return <span className={`chip ${cls}`}><span className="d" />{label}</span>;
}

function statusChip(status?: string | null): { cls: string; label: string } {
  const s = String(status || "").toUpperCase();
  if (["DONE", "COMPLETED", "COMPLETE", "SUCCESS", "OK", "FINISHED"].includes(s)) return { cls: "g", label: "Concluído" };
  if (["ERROR", "FAILED", "FAIL"].includes(s)) return { cls: "r", label: "Erro" };
  if (["CANCELLED", "CANCELED"].includes(s)) return { cls: "r", label: "Cancelado" };
  if (["PROCESSING", "RUNNING"].includes(s)) return { cls: "a", label: "Processando" };
  if (["PENDING", "QUEUED"].includes(s)) return { cls: "a", label: "Pendente" };
  return { cls: "a", label: status || "Pendente" };
}

function formatCurrency(value?: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}
function formatInt(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
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
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

// ---------- icons ----------
function Arrow() { return <span className="arr"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>; }
function IcoClock() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>; }
function IcoInfo() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-5" /><path d="M12 8h.01" /></svg>; }
function IcoLock() { return <svg className="lk" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>; }
function IcoPdf() { return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v5h5" /><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M9 13h2M9 17h4" /></svg>; }
function IcoGrid() { return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18M9 3v18" /><rect x="3" y="3" width="18" height="18" rx="2" /></svg>; }
function IcoFile() { return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v5h5" /><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M9 13h6M9 17h4" /></svg>; }
function IcoAlert() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.3 2 18a1.5 1.5 0 0 0 1.3 2.2h17.4A1.5 1.5 0 0 0 22 18L13.7 3.3a1.5 1.5 0 0 0-2.6 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>; }
function IcoUp() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></svg>; }
function IcoUp22() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" /></svg>; }
function IcoCheckSquare() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>; }
function IcoSparkle() { return <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /></svg>; }
function IcoBox() { return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" /><path d="M4 7l2-3h12l2 3" /><path d="M9 12h6" /></svg>; }
function IcoFileSm() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v5h5" /><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /></svg>; }
function IcoCalSm() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M9 3v4M15 3v4" /></svg>; }
function IcoUsers() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>; }
function IcoSparkleSm() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>; }
function IcoSearch() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>; }
function IcoBank() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /></svg>; }
function IcoUser() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>; }
function IcoChart() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></svg>; }
function IcoErrCircle() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>; }
function IcoAlert22() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.3 2 18a1.5 1.5 0 0 0 1.3 2.2h17.4A1.5 1.5 0 0 0 22 18L13.7 3.3a1.5 1.5 0 0 0-2.6 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>; }
function IcoCheckSm() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>; }

const CSS = `
.rrimp{
  --navy:#0F1F4A; --navy-deep:#0B1838; --navy-bar:#1E3066;
  --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A; --gold-soft:#E7BE6A;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --green:#16A34A; --amber:#F59E0B; --red:#DC2626;
  --green-tx:#15803D; --amber-tx:#B45309; --red-tx:#B91C1C;
  --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrimp *{box-sizing:border-box;}
.rrimp .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrimp .mono{font-family:'IBM Plex Mono',monospace;}
.rrimp .wrap{max-width:1180px;margin:0 auto;padding:30px 28px 64px;display:flex;flex-direction:column;gap:20px;}

.rrimp .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:0 2px -2px;}
.rrimp .crumb .sep{color:#C2C8D2;}

.rrimp .role{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#E4E9F4;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;}
.rrimp .role .d{width:7px;height:7px;border-radius:50%;background:var(--yellow);}

.rrimp .infobar{display:flex;align-items:center;gap:14px;background:#EAF0FB;border:1px solid #D5E0F4;border-radius:var(--r-md);padding:14px 18px;flex-wrap:wrap;}
.rrimp .infobar .ic{flex:none;width:30px;height:30px;border-radius:9px;background:#fff;border:1px solid #D5E0F4;display:grid;place-items:center;color:var(--navy);}
.rrimp .infobar .txt{font-size:12.5px;color:var(--ink-2);min-width:160px;flex:1;}
.rrimp .infobar .txt b{color:var(--ink);font-weight:600;}
.rrimp .flow{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.rrimp .flow .step{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #D5E0F4;color:var(--navy);font-size:11.5px;font-weight:600;padding:6px 11px;border-radius:999px;white-space:nowrap;}
.rrimp .flow .step .n{width:16px;height:16px;border-radius:50%;background:var(--navy);color:#fff;font-size:9.5px;display:grid;place-items:center;font-weight:700;}
.rrimp .flow .arr{color:#9DB0D6;display:grid;place-items:center;}

.rrimp .tabbar{display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--bd);border-radius:999px;box-shadow:var(--shadow);padding:6px;width:fit-content;max-width:100%;flex-wrap:wrap;margin-top:24px;}
.rrimp .tab{display:inline-flex;align-items:center;gap:9px;border:none;background:none;font-family:inherit;font-size:13px;font-weight:600;color:var(--ink-2);padding:9px 18px;border-radius:999px;cursor:pointer;transition:background .14s,color .14s;white-space:nowrap;}
.rrimp .tab .tn{width:18px;height:18px;border-radius:50%;background:#EDF0F6;color:var(--ink-3);font-size:10px;display:grid;place-items:center;font-weight:700;transition:background .14s,color .14s;}
.rrimp .tab:hover{background:#F4F6F9;color:var(--navy);}
.rrimp .tab.on{background:var(--navy);color:#fff;}
.rrimp .tab.on .tn{background:rgba(255,255,255,.16);color:#fff;}

.rrimp .seal{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.02em;color:var(--gold-deep);background:linear-gradient(180deg,#FCF6E8,#F8EDD3);border:1px solid #E7CF94;padding:5px 11px;border-radius:8px;white-space:nowrap;}
.rrimp .seal.soon{color:var(--amber-tx);background:rgba(245,158,11,.10);border-color:rgba(245,158,11,.32);}

.rrimp .ucard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:24px 26px;display:flex;flex-direction:column;}
.rrimp .ucard.soon{background:#FBFAF7;}
.rrimp .ucard-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px;}
.rrimp .ucard-head .tt{display:flex;align-items:center;gap:12px;}
.rrimp .ucard-head .tt .badge{width:38px;height:38px;border-radius:11px;background:#EDF0F6;color:var(--navy);display:grid;place-items:center;flex:none;}
.rrimp .ucard-head .tt .badge.pdf{background:#FBEAE8;color:var(--red);}
.rrimp .ucard-head h3{font-size:15.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrimp .ucard-head .csub{font-size:12px;color:var(--ink-3);margin:3px 0 0;max-width:44ch;line-height:1.45;}
.rrimp .ucard-head .fmt{font-size:10.5px;font-weight:700;letter-spacing:.04em;color:var(--gold-deep);background:#FBF4E6;border:1px solid #EBD9B0;padding:4px 9px;border-radius:7px;white-space:nowrap;}

.rrimp .frow{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:15px;}
.rrimp .fld{display:flex;flex-direction:column;gap:7px;}
.rrimp .fld.full{grid-column:1 / -1;}
.rrimp .fld label{font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--ink-2);}
.rrimp .ctrl{position:relative;display:flex;align-items:center;}
.rrimp .ctrl select,.rrimp .ctrl input{width:100%;font-family:inherit;font-size:13.5px;color:var(--ink);border:1px solid var(--bd);border-radius:10px;background:#fff;padding:11px 13px;outline:none;transition:border-color .15s,box-shadow .15s;}
.rrimp .ctrl select{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:34px;}
.rrimp .ctrl .chev{position:absolute;right:13px;pointer-events:none;color:var(--ink-3);font-size:11px;}
.rrimp .ctrl select:focus,.rrimp .ctrl input:focus{border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rrimp .ctrl select:disabled,.rrimp .ctrl input:disabled{background:#F2F3F6;color:var(--ink-3);cursor:not-allowed;}

.rrimp .dropzone{border:1.5px dashed var(--bd);background:#FAFBFC;border-radius:14px;padding:24px 20px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:11px;cursor:pointer;transition:border-color .15s,background .15s;}
.rrimp .dropzone:hover{border-color:#B9C4DC;background:#F4F7FC;}
.rrimp .dropzone.drag{border-color:var(--navy);background:#F1F5FC;}
.rrimp .dropzone .dz-ic{width:46px;height:46px;border-radius:13px;background:#fff;border:1px solid var(--bd);display:grid;place-items:center;color:var(--navy);}
.rrimp .dropzone.pdf .dz-ic{color:var(--red);}
.rrimp .dropzone .dz-t{font-size:13.5px;font-weight:600;color:var(--ink);}
.rrimp .dropzone .dz-t .br{color:var(--navy);text-decoration:underline;text-underline-offset:2px;word-break:break-all;}
.rrimp .dropzone .dz-s{font-size:11.5px;color:var(--ink-3);margin-top:-3px;}
.rrimp .dropzone.filled{border-style:solid;border-color:var(--green);background:rgba(22,163,74,.05);}
.rrimp .dropzone.filled .dz-ic{color:var(--green);border-color:rgba(22,163,74,.3);}
.rrimp .dropzone:has(input:disabled){cursor:not-allowed;border-color:var(--bd);background:#F2F3F6;}
.rrimp .dropzone:has(input:disabled) .dz-ic{color:var(--ink-3) !important;background:#EEF0F4;}
.rrimp .dropzone:has(input:disabled) .dz-t{color:var(--ink-2);}
.rrimp .dropzone:has(input:disabled) .dz-t .br{color:var(--ink-2);text-decoration:none;}

.rrimp .uact{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;flex-wrap:wrap;}
.rrimp .uhint{font-size:11.5px;color:var(--ink-3);display:flex;align-items:center;gap:7px;max-width:58%;}
.rrimp .uhint svg{flex:none;color:var(--ink-3);}
.rrimp .btn-primary{display:inline-flex;align-items:center;gap:9px;background:var(--navy);color:#fff;border:none;border-radius:11px;padding:12px 20px;font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;transition:background .14s,transform .12s;white-space:nowrap;}
.rrimp .btn-primary:hover{background:#16285C;transform:translateY(-1px);}
.rrimp .btn-primary .ck{color:var(--yellow);display:grid;place-items:center;}
.rrimp .btn-primary:disabled,.rrimp .btn-primary.dis{background:#C8CDD8;cursor:not-allowed;transform:none;box-shadow:none;}
.rrimp .btn-primary:disabled:hover,.rrimp .btn-primary.dis:hover{background:#C8CDD8;transform:none;}
.rrimp .spinner{width:16px;height:16px;border-radius:50%;border:2.4px solid rgba(255,255,255,.35);border-top-color:#fff;animation:rrimp-spin .8s linear infinite;flex:none;}
@keyframes rrimp-spin{to{transform:rotate(360deg);}}

.rrimp .two-up{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;}

.rrimp .lockbar{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--ink-3);background:#EEF0F4;border:1px solid var(--bd);border-radius:10px;padding:10px 13px;}
.rrimp .lockbar .lk{flex:none;color:var(--ink-3);}
.rrimp .lockbar b{color:var(--ink-2);font-weight:600;}
.rrimp .two-up.locked .ucard{background:#F7F8FA;}
.rrimp .two-up.locked .badge{background:#EEF0F4 !important;color:var(--ink-3) !important;}

.rrimp .notecard{background:#F9FAFC;}
.rrimp .notecard .badge{background:#FBF4E6 !important;color:var(--gold-deep) !important;}
.rrimp .notecard ul{margin:0;padding-left:20px;font-size:13px;color:var(--ink-2);line-height:1.75;}
.rrimp .notecard ul b{color:var(--ink);font-weight:600;}

.rrimp .lcard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;}
.rrimp .soon-panel{background:#FBFAF7;}
.rrimp .conf-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 24px 16px;border-bottom:1px solid var(--bd-soft);flex-wrap:wrap;}
.rrimp .conf-head .lt{display:flex;align-items:center;gap:12px;}
.rrimp .conf-head .lt .ic{width:34px;height:34px;border-radius:10px;background:#EDF0F6;color:var(--navy);display:grid;place-items:center;flex:none;}
.rrimp .conf-head h3{font-size:15px;font-weight:600;margin:0;color:var(--ink);}
.rrimp .conf-head .csub{font-size:12px;color:var(--ink-3);margin-top:2px;}
.rrimp .soon-body{display:flex;align-items:center;gap:16px;padding:22px 24px 26px;color:var(--amber);}
.rrimp .soon-body .sb-t{font-size:13.5px;font-weight:600;color:var(--ink);}
.rrimp .soon-body .sb-s{font-size:12.5px;color:var(--ink-2);margin-top:4px;line-height:1.55;max-width:80ch;}

.rrimp .lcard-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 22px 15px;border-bottom:1px solid var(--bd-soft);}
.rrimp .lcard-head h3{font-size:14.5px;font-weight:600;margin:0;color:var(--ink);}
.rrimp .lcard-head .cnt{font-size:12px;color:var(--ink-3);}
.rrimp .lrow{display:flex;align-items:center;gap:14px;padding:14px 22px;border-top:1px solid var(--bd-soft);}
.rrimp .lrow:first-of-type{border-top:none;}
.rrimp .lrow .fic{width:34px;height:34px;border-radius:9px;background:#EDF0F6;color:var(--navy);display:grid;place-items:center;flex:none;}
.rrimp .lrow .meta{min-width:0;flex:1;}
.rrimp .lrow .fn{font-size:13px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.rrimp .lrow .fn .emp{font-weight:600;color:var(--navy);}
.rrimp .lrow .det{font-size:11.5px;color:var(--ink-3);margin-top:3px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.rrimp .lrow .det .sepd{color:#C7CDD8;}
.rrimp .lrow .right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none;}
.rrimp .lrow.busy{background:rgba(245,158,11,.05);}

.rrimp .chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid;white-space:nowrap;}
.rrimp .chip .d{width:6px;height:6px;border-radius:50%;}
.rrimp .chip.g{background:rgba(22,163,74,.10);border-color:rgba(22,163,74,.28);color:var(--green-tx);}
.rrimp .chip.g .d{background:var(--green);}
.rrimp .chip.a{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.30);color:var(--amber-tx);}
.rrimp .chip.a .d{background:var(--amber);}
.rrimp .chip.r{background:rgba(220,38,38,.09);border-color:rgba(220,38,38,.26);color:var(--red-tx);}
.rrimp .chip.r .d{background:var(--red);}
.rrimp .cancelbtn{background:#fff;border:1px solid var(--bd);color:var(--ink-2);border-radius:8px;font-family:inherit;font-size:11px;font-weight:600;padding:6px 11px;cursor:pointer;transition:background .14s,border-color .14s,color .14s;}
.rrimp .cancelbtn:hover{background:var(--red);border-color:var(--red);color:#fff;}
.rrimp .cancelbtn:disabled{opacity:.6;cursor:default;}

.rrimp .lempty{padding:40px 22px 44px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;}
.rrimp .lempty .art{width:60px;height:60px;border-radius:16px;background:linear-gradient(160deg,#F4F6FA,#E9EDF4);border:1px solid var(--bd);display:grid;place-items:center;color:var(--navy);}
.rrimp .lempty .et{font-size:13.5px;font-weight:600;color:var(--ink);}
.rrimp .lempty .es{font-size:12px;color:var(--ink-3);margin-top:-8px;max-width:260px;line-height:1.5;}

/* ===================== ABA DIARIA ===================== */
.rrimp .dia-two{grid-template-columns:1.32fr 1fr;}

.rrimp .viewlabel{display:flex;align-items:center;gap:14px;margin:6px 2px 0;}
.rrimp .viewlabel .tag{font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--gold-deep);background:#fff;border:1px solid var(--bd);padding:5px 11px;border-radius:999px;white-space:nowrap;}
.rrimp .viewlabel h2{font-size:18px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);white-space:nowrap;}
.rrimp .viewlabel .who{font-size:12px;color:var(--ink-3);}
.rrimp .viewlabel .rule{flex:1;height:1px;background:linear-gradient(90deg,var(--bd),transparent);}

.rrimp .openbar{display:flex;align-items:center;gap:13px;background:rgba(22,163,74,.06);border:1px solid rgba(22,163,74,.22);border-radius:var(--r-md);padding:13px 17px;flex-wrap:wrap;}
.rrimp .openbar .ic{flex:none;width:30px;height:30px;border-radius:9px;background:#fff;border:1px solid rgba(22,163,74,.28);display:grid;place-items:center;color:var(--green);}
.rrimp .openbar .txt{font-size:12.5px;color:var(--ink-2);min-width:160px;flex:1;}
.rrimp .openbar .txt b{color:var(--green-tx);font-weight:700;}
.rrimp .openbar .roles{display:flex;align-items:center;gap:7px;}
.rrimp .openbar .rp{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--bd);color:var(--ink-2);font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:999px;white-space:nowrap;}
.rrimp .openbar .rp .d{width:6px;height:6px;border-radius:50%;background:var(--green);}

.rrimp .autobar{display:flex;align-items:center;gap:11px;background:#EAF0FB;border:1px solid #D5E0F4;border-radius:11px;padding:11px 14px;margin-bottom:15px;}
.rrimp .autobar .ic{flex:none;width:26px;height:26px;border-radius:8px;background:#fff;border:1px solid #D5E0F4;display:grid;place-items:center;color:var(--navy);}
.rrimp .autobar .t{font-size:12px;color:var(--ink-2);line-height:1.4;}
.rrimp .autobar .t b{color:var(--navy);font-weight:700;}

.rrimp .rules-wrap{margin-top:16px;}
.rrimp .rules-lab{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:9px;}
.rrimp .rules{display:flex;flex-wrap:wrap;gap:8px;}

.rrimp .chip.n{background:#F1F3F7;border-color:var(--bd);color:var(--ink-2);}
.rrimp .chip.n .d{background:var(--ink-3);}
.rrimp .chip.lg{font-size:12px;padding:6px 13px;}
.rrimp .chip.a .d{animation:rrimp-pulse 1.3s ease-in-out infinite;}
.rrimp .chip.a.static .d{animation:none;}
@keyframes rrimp-pulse{0%,100%{opacity:1;}50%{opacity:.35;}}

.rrimp .dia-note{background:#F9FAFC;border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:22px 24px;display:flex;flex-direction:column;}
.rrimp .dia-note .nc-head{display:flex;align-items:center;gap:11px;margin-bottom:6px;}
.rrimp .dia-note .nc-head .badge{width:34px;height:34px;border-radius:10px;background:#FBF4E6;color:var(--gold-deep);display:grid;place-items:center;flex:none;}
.rrimp .dia-note .nc-head h3{font-size:14.5px;font-weight:600;margin:0;color:var(--ink);}
.rrimp .dia-note .nc-head .csub{font-size:11.5px;color:var(--ink-3);margin:2px 0 0;}
.rrimp .detect{display:flex;flex-direction:column;}
.rrimp .detect .row{display:flex;align-items:flex-start;gap:12px;padding:13px 0;border-top:1px solid var(--bd-soft);}
.rrimp .detect .dic{flex:none;width:30px;height:30px;border-radius:9px;background:#fff;border:1px solid var(--bd);display:grid;place-items:center;color:var(--navy);}
.rrimp .detect .dm{min-width:0;flex:1;}
.rrimp .detect .dt{font-size:13px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.rrimp .detect .dt .src{font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;color:var(--gold-deep);background:#FBF4E6;border:1px solid #EBD9B0;padding:2px 7px;border-radius:6px;}
.rrimp .detect .ds{font-size:11.5px;color:var(--ink-3);margin-top:2px;}
.rrimp .dia-note .multi{display:flex;align-items:center;gap:9px;margin-top:14px;padding:11px 13px;background:#fff;border:1px dashed var(--bd);border-radius:10px;font-size:11.5px;color:var(--ink-2);}
.rrimp .dia-note .multi b{color:var(--ink);font-weight:600;}
.rrimp .dia-note .multi svg{flex:none;color:var(--navy);}

.rrimp .res-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 24px 16px;border-bottom:1px solid var(--bd-soft);flex-wrap:wrap;}
.rrimp .res-head .lt{display:flex;align-items:center;gap:12px;}
.rrimp .res-head .lt .ic{width:34px;height:34px;border-radius:10px;background:#EDF0F6;color:var(--navy);display:grid;place-items:center;flex:none;}
.rrimp .res-head h3{font-size:15px;font-weight:600;margin:0;color:var(--ink);}
.rrimp .res-head .csub{font-size:12px;color:var(--ink-3);margin-top:2px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.rrimp .res-head .csub .mono{color:var(--ink-2);}

.rrimp .rstats{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--bd-soft);}
.rrimp .rstat{background:#fff;padding:18px 20px 17px;display:flex;flex-direction:column;gap:7px;}
.rrimp .rstat .rl{font-size:11px;font-weight:500;color:var(--ink-3);display:flex;align-items:center;gap:7px;}
.rrimp .rstat .rl .di{width:7px;height:7px;border-radius:2px;flex:none;}
.rrimp .rstat .rn{font-size:27px;font-weight:600;letter-spacing:-.02em;line-height:1;color:var(--ink);}
.rrimp .rstat .rs{font-size:11px;color:var(--ink-3);}
.rrimp .rstat.ins .rn{color:var(--green-tx);} .rrimp .rstat.ins .di{background:var(--green);}
.rrimp .rstat.upd .di{background:var(--navy);}
.rrimp .rstat.comp .di{background:var(--gold);}
.rrimp .rstat.err .rn{color:var(--red-tx);} .rrimp .rstat.err .di{background:var(--red);}
.rrimp .rstat.proc .di{background:var(--ink-3);}

.rrimp .comp-sec{padding:17px 24px 18px;border-top:1px solid var(--bd-soft);}
.rrimp .comp-lab{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:11px;}
.rrimp .comp-grid{display:flex;flex-wrap:wrap;gap:10px;}
.rrimp .comp-item{display:flex;align-items:center;gap:10px;background:#FAFBFC;border:1px solid var(--bd);border-radius:11px;padding:9px 14px 9px 11px;}
.rrimp .comp-item .cm{width:30px;height:30px;border-radius:8px;background:#EDF0F6;color:var(--navy);display:grid;place-items:center;flex:none;}
.rrimp .comp-item .ct{font-size:13px;font-weight:600;color:var(--ink);}
.rrimp .comp-item .cs{font-size:11px;color:var(--ink-3);margin-top:1px;}

.rrimp .recalc{display:flex;align-items:center;gap:13px;padding:15px 24px;background:#EAF0FB;flex-wrap:wrap;}
.rrimp .recalc .spin{width:17px;height:17px;border-radius:50%;border:2.4px solid rgba(15,31,74,.18);border-top-color:var(--navy);animation:rrimp-spin .8s linear infinite;flex:none;}
.rrimp .recalc .rtx{font-size:12.5px;color:var(--navy);font-weight:600;flex:1;min-width:160px;}
.rrimp .recalc .rtx span{color:var(--ink-3);font-weight:400;}
.rrimp .recalc .rbar{height:6px;width:160px;border-radius:999px;background:#D9E2F4;overflow:hidden;flex:none;}
.rrimp .recalc .rbar .rfill{height:100%;width:62%;border-radius:999px;background:linear-gradient(90deg,var(--navy-bar),var(--navy));animation:rrimp-rpulse 1.6s ease-in-out infinite;}
@keyframes rrimp-rpulse{0%,100%{opacity:.85;}50%{opacity:1;}}

.rrimp .dia-banner{display:flex;align-items:flex-start;gap:11px;border-radius:12px;padding:14px 15px;font-size:13px;line-height:1.45;}
.rrimp .dia-banner .bic{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;margin-top:1px;}
.rrimp .dia-banner b{font-weight:700;display:block;margin-bottom:3px;}
.rrimp .dia-banner span{font-weight:400;}
.rrimp .dia-banner.err{background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.22);color:var(--red-tx);}
.rrimp .dia-banner.err .bic{background:rgba(220,38,38,.12);color:var(--red);}
.rrimp .dia-banner.err span{color:var(--ink-2);}

.rrimp .alert{display:flex;align-items:flex-start;gap:15px;background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.34);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:20px 22px;}
.rrimp .alert .aic{flex:none;width:42px;height:42px;border-radius:12px;background:rgba(245,158,11,.16);color:var(--amber);display:grid;place-items:center;}
.rrimp .alert .abody{flex:1;min-width:0;}
.rrimp .alert .ahead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.rrimp .alert .at{font-size:15px;font-weight:700;color:var(--amber-tx);}
.rrimp .alert .ax{font-size:12.5px;color:var(--ink-2);margin-top:7px;line-height:1.5;max-width:68ch;}
.rrimp .alert .ax b{color:var(--ink);font-weight:600;}
.rrimp .alert .checklist{display:flex;flex-direction:column;gap:7px;margin-top:13px;}
.rrimp .alert .checklist .ci{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--ink-2);flex-wrap:wrap;}
.rrimp .alert .checklist .ci .cb{flex:none;width:18px;height:18px;border-radius:5px;background:#fff;border:1px solid #EBD9B0;display:grid;place-items:center;color:var(--amber);}
.rrimp .alert .checklist .ci .cb svg{display:block;}
.rrimp .alert .checklist .ci code{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink);background:#fff;border:1px solid var(--bd);padding:1px 6px;border-radius:5px;}
.rrimp .alert .afoot{display:flex;align-items:center;gap:10px;margin-top:15px;flex-wrap:wrap;}
.rrimp .alert .api{font-size:11px;color:var(--ink-3);display:flex;align-items:center;gap:6px;}
.rrimp .alert .api .mono{color:var(--ink-2);}

@media (max-width:980px){
  .rrimp .two-up{grid-template-columns:1fr;}
  .rrimp .uhint{max-width:100%;}
  .rrimp .rstats{grid-template-columns:repeat(3,1fr);}
}
@media (max-width:640px){
  .rrimp .rstats{grid-template-columns:1fr 1fr;}
}
@media (max-width:640px){
  .rrimp .wrap{padding:20px 16px 46px;}
  .rrimp .frow{grid-template-columns:1fr;}
  .rrimp .tabbar{width:100%;justify-content:space-between;}
  .rrimp .tab{padding:9px 12px;}
}
`;
