"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useUser } from "../../lib/auth/useUser";
import EmptyStatePanel from "../../components/EmptyStatePanel";
import FeedbackBanner from "../../components/FeedbackBanner";

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

export default function ImportacoesPage() {
  const { user } = useUser();
  const isFuncionario = user?.role === "funcionario";

  const [activeSection, setActiveSection] = useState<"base" | "fechamento" | "historico">("base");
  const [data, setData] = useState<ImportacoesPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [promoterRemunerationFile, setPromoterRemunerationFile] = useState<File | null>(null);
  const [promoterRemunerationSubmitting, setPromoterRemunerationSubmitting] = useState(false);
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
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <span>Visão geral</span>
          <span className="sep">/</span>
          <span>Operação</span>
          <span className="sep">/</span>
          <span>Importações</span>
        </nav>

        {/* HEADER navy scoped */}
        <header className="header">
          <div className="header-top">
            <div>
              <p className="brand">GRUPO RR CRED</p>
              <h1>Importações</h1>
              <p className="sub">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v13" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" />
                </svg>
                Entrada de dados do sistema
              </p>
            </div>
            <div className="role">
              <span className="d" />
              {isFuncionario ? "Funcionário · leitura" : "Sócio · acesso total"}
            </div>
          </div>
        </header>

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

        {/* SUMMARY KPIs (reais) */}
        <div className="scards">
          <div className="scard">
            <p className="k"><span className="ic"><IcoRows /></span>Cargas diárias</p>
            <div className="v num">{data.summary.dailyImports}</div>
            <div className="s">total importadas</div>
          </div>
          <div className="scard">
            <p className="k"><span className="ic"><IcoCal /></span>Fechamentos mensais</p>
            <div className="v num">{data.summary.monthlyClosingImports}</div>
            <div className="s">total importados</div>
          </div>
          <div className="scard accent">
            <p className="k"><span className="ic"><IcoClock /></span>Última diária</p>
            <div className="v sm num">{formatDateTime(data.summary.lastDailyImportAt)}</div>
            <div className="s">
              {lastDaily ? `${lastDaily.rows_count || 0} linhas · ${lastDaily.file_name}` : "sem cargas ainda"}
            </div>
          </div>
          <div className="scard">
            <p className="k"><span className="ic"><IcoCheck /></span>Último fechamento</p>
            <div className="v sm num">{formatDateTime(data.summary.lastMonthlyClosingImportAt)}</div>
            <div className="s">
              {lastMonthly ? `${lastMonthly.company_name} · ${String(lastMonthly.month).padStart(2, "0")}/${lastMonthly.year}` : "sem fechamentos ainda"}
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="tabbar" role="tablist">
          <button className={`tab${activeSection === "base" ? " on" : ""}`} onClick={() => setActiveSection("base")}>
            <span className="tn">1</span>Base operacional
          </button>
          <button className={`tab${activeSection === "fechamento" ? " on" : ""}`} onClick={() => setActiveSection("fechamento")}>
            <span className="tn">2</span>Fechamento mensal
          </button>
          <button className={`tab${activeSection === "historico" ? " on" : ""}`} onClick={() => setActiveSection("historico")}>
            <span className="tn">3</span>Histórico
          </button>
        </div>

        {/* ===================== ABA BASE OPERACIONAL ===================== */}
        {activeSection === "base" ? (
          <>
            {isFuncionario ? (
              <div className="lockbar"><IcoLock /><span><b>Disponível apenas para sócio.</b> Você pode consultar o histórico das cargas.</span></div>
            ) : null}

            <div className={`two-up${isFuncionario ? " locked" : ""}`}>
              {/* CARD TRP — CAMADA B (em breve) */}
              <section className="ucard soon">
                <div className="ucard-head">
                  <div className="tt">
                    <span className="badge pdf"><IcoPdf /></span>
                    <div>
                      <h3>TRP do mês (Promotiva)</h3>
                      <p className="csub">Documento oficial. A conferência automática TRP × planilha entra numa próxima etapa.</p>
                    </div>
                  </div>
                  <span className="seal soon"><IcoClock />Em breve</span>
                </div>
                <Dropzone disabled pdf accept=".pdf" file={null} onFile={() => {}}
                  title="selecione a TRP do mês" sub="Importação ainda não disponível" />
                <div className="uact">
                  <span className="uhint"><IcoInfo />Conferência da TRP em desenvolvimento (Frente 2).</span>
                  <button type="button" className="btn-primary dis" disabled>Enviar e conferir TRP</button>
                </div>
              </section>

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

            {/* Conferencia TRP x planilha — CAMADA B (em breve, sem numeros inventados) */}
            <section className="lcard soon-panel">
              <div className="conf-head">
                <div className="lt">
                  <span className="ic"><IcoCheckSquare /></span>
                  <div>
                    <h3>Conferência · TRP × planilha</h3>
                    <p className="csub">Cruzamento automático dos percentuais oficiais com a planilha da RR.</p>
                  </div>
                </div>
                <span className="seal soon"><IcoClock />Em breve</span>
              </div>
              <div className="soon-body">
                <IcoSparkle />
                <div>
                  <div className="sb-t">Conferência automática em desenvolvimento (Frente 2)</div>
                  <div className="sb-s">
                    Quando ativa, esta área vai comparar cada faixa da TRP oficial com a planilha importada
                    e apontar divergências antes de arquivar. Por enquanto a planilha é importada direto e a
                    conferência é feita manualmente.
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {/* ===================== ABA FECHAMENTO ===================== */}
        {activeSection === "fechamento" ? (
          <>
            {isFuncionario ? (
              <div className="lockbar"><IcoLock /><span><b>Disponível apenas para sócio.</b> Você acompanha o status na auditoria.</span></div>
            ) : null}
            <div className={`two-up${isFuncionario ? " locked" : ""}`}>
              <section className="ucard">
                <div className="ucard-head">
                  <div className="tt">
                    <span className="badge"><IcoFile /></span>
                    <div><h3>Importar fechamento</h3><p className="csub">Planilha final da competência, por CNPJ.</p></div>
                  </div>
                  <span className="fmt">.xlsx</span>
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
                  <Dropzone disabled={isFuncionario} accept=".xlsx,.xls"
                    file={file} onFile={setFile}
                    title="selecione a planilha" sub="Fechamento da competência · até 25 MB" />
                  <div className="uact">
                    <span className="uhint"><IcoInfo />Disponível na auditoria após importar.</span>
                    <button type="submit" className={`btn-primary${isFuncionario ? " dis" : ""}`} disabled={isFuncionario || submitting}>
                      {submitting ? <><span className="spinner" />Importando…</> : <><span className="ck"><IcoUp /></span>Importar fechamento</>}
                    </button>
                  </div>
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
function IcoRows() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v6H4z" /><path d="M4 14h16v6H4z" /><path d="M8 7h.01M8 17h.01" /></svg>; }
function IcoCal() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M9 3v4M15 3v4" /></svg>; }
function IcoClock() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>; }
function IcoCheck() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>; }
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

.rrimp .header{background:var(--navy);border-radius:var(--r-lg);padding:28px 32px 30px;color:#fff;position:relative;overflow:hidden;}
.rrimp .header::after{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--gold),rgba(214,161,63,0));opacity:.55;}
.rrimp .header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:22px;flex-wrap:wrap;}
.rrimp .brand{font-size:11.5px;font-weight:600;letter-spacing:.18em;color:var(--yellow);margin:0 0 7px;}
.rrimp .header h1{font-size:26px;font-weight:600;letter-spacing:-.01em;margin:0;color:#fff;}
.rrimp .header .sub{font-size:12.5px;color:#9DA9C6;margin:9px 0 0;display:flex;align-items:center;gap:8px;}
.rrimp .header .sub svg{display:block;}
.rrimp .header .role{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#E4E9F4;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;}
.rrimp .header .role .d{width:7px;height:7px;border-radius:50%;background:var(--yellow);}

.rrimp .infobar{display:flex;align-items:center;gap:14px;background:#EAF0FB;border:1px solid #D5E0F4;border-radius:var(--r-md);padding:14px 18px;flex-wrap:wrap;}
.rrimp .infobar .ic{flex:none;width:30px;height:30px;border-radius:9px;background:#fff;border:1px solid #D5E0F4;display:grid;place-items:center;color:var(--navy);}
.rrimp .infobar .txt{font-size:12.5px;color:var(--ink-2);min-width:160px;flex:1;}
.rrimp .infobar .txt b{color:var(--ink);font-weight:600;}
.rrimp .flow{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.rrimp .flow .step{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #D5E0F4;color:var(--navy);font-size:11.5px;font-weight:600;padding:6px 11px;border-radius:999px;white-space:nowrap;}
.rrimp .flow .step .n{width:16px;height:16px;border-radius:50%;background:var(--navy);color:#fff;font-size:9.5px;display:grid;place-items:center;font-weight:700;}
.rrimp .flow .arr{color:#9DB0D6;display:grid;place-items:center;}

.rrimp .scards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
.rrimp .scard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-md);box-shadow:var(--shadow);padding:18px 20px 19px;display:flex;flex-direction:column;position:relative;overflow:hidden;}
.rrimp .scard .k{font-size:12px;font-weight:500;color:var(--ink-3);margin:0 0 11px;display:flex;align-items:center;gap:8px;}
.rrimp .scard .k .ic{width:22px;height:22px;border-radius:6px;background:#EDF0F6;color:var(--navy);display:grid;place-items:center;flex:none;}
.rrimp .scard .v{font-size:26px;font-weight:600;letter-spacing:-.02em;line-height:1;color:var(--ink);}
.rrimp .scard .v.sm{font-size:19px;}
.rrimp .scard .s{font-size:12px;margin-top:9px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.rrimp .scard.accent{background:var(--navy);border-color:var(--navy);}
.rrimp .scard.accent::after{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--gold);}
.rrimp .scard.accent .k{color:#9DA9C6;}
.rrimp .scard.accent .k .ic{background:rgba(255,255,255,.08);color:var(--yellow);}
.rrimp .scard.accent .v{color:#fff;}
.rrimp .scard.accent .s{color:#8C98B6;}

.rrimp .tabbar{display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--bd);border-radius:999px;box-shadow:var(--shadow);padding:6px;width:fit-content;max-width:100%;flex-wrap:wrap;}
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

@media (max-width:980px){
  .rrimp .scards{grid-template-columns:1fr 1fr;}
  .rrimp .two-up{grid-template-columns:1fr;}
  .rrimp .uhint{max-width:100%;}
}
@media (max-width:640px){
  .rrimp .wrap{padding:20px 16px 46px;}
  .rrimp .header{padding:22px 20px 24px;}
  .rrimp .header h1{font-size:21px;}
  .rrimp .scards{grid-template-columns:1fr;}
  .rrimp .frow{grid-template-columns:1fr;}
  .rrimp .tabbar{width:100%;justify-content:space-between;}
  .rrimp .tab{padding:9px 12px;}
}
`;
