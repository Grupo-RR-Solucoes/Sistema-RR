"use client";

import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import EmptyStatePanel from "../../components/EmptyStatePanel";
import FeedbackBanner from "../../components/FeedbackBanner";

type Company = {
  id: string;
  name: string;
  legal_name?: string | null;
  cnpj: string;
  group_name?: string | null;
  group_code?: string | null;
  active?: boolean | null;
  identifiers: Array<{
    id: string;
    mci?: string | null;
    coban_code?: string | null;
    identifier_type?: string | null;
    active?: boolean | null;
  }>;
  promoters_count: number;
  active_promoters_count: number;
};

type Promoter = {
  id: string;
  company_id?: string | null;
  company_name: string;
  company_cnpj: string;
  name: string;
  status?: string | null;
  active?: boolean | null;
  hired_at?: string | null;
  dismissed_at?: string | null;
  notes?: string | null;
  keys: Array<{
    id: string;
    j_key: string;
    key_type?: string | null;
    active?: boolean | null;
  }>;
};

type JKey = {
  id: string;
  company_id?: string | null;
  company_name: string;
  promoter_id?: string | null;
  promoter_name: string;
  j_key: string;
  key_type?: string | null;
  active?: boolean | null;
  display_name?: string | null;
};

type CadastroPayload = {
  summary: {
    companies: number;
    activeCompanies: number;
    promoters: number;
    activePromoters: number;
    jKeys: number;
    activeJKeys: number;
    masterKeys: number;
    identifiers: number;
  };
  companies: Company[];
  promoters: Promoter[];
  jKeys: JKey[];
};

const emptyPayload: CadastroPayload = {
  summary: {
    companies: 0,
    activeCompanies: 0,
    promoters: 0,
    activePromoters: 0,
    jKeys: 0,
    activeJKeys: 0,
    masterKeys: 0,
    identifiers: 0,
  },
  companies: [],
  promoters: [],
  jKeys: [],
};

export default function CadastrosPage() {
  const [data, setData] = useState<CadastroPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState("");
  const [activeSection, setActiveSection] = useState<
    "empresas" | "promotores" | "chaves"
  >("empresas");
  const [companyForm, setCompanyForm] = useState({
    name: "",
    cnpj: "",
    legalName: "",
    groupName: "Grupo RR",
    groupCode: "",
  });
  const [identifierForm, setIdentifierForm] = useState({
    companyId: "",
    mci: "",
    cobanCode: "",
    identifierType: "PRIMARY",
  });
  const [promoterForm, setPromoterForm] = useState({
    companyId: "",
    name: "",
    status: "ACTIVE",
    hiredAt: "",
    notes: "",
  });
  const [jKeyForm, setJKeyForm] = useState({
    companyId: "",
    promoterId: "",
    jKey: "",
    keyType: "INDIVIDUAL",
    displayName: "",
  });

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/cadastros");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao carregar cadastros.");
      }

      setData(payload || emptyPayload);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar cadastros.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function postAction(body: Record<string, unknown>, successMessage: string) {
    try {
      setSubmitting(String(body.action || ""));
      setError("");
      setNotice("");

      const response = await fetch("/api/cadastros", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao salvar cadastro.");
      }

      await loadData();
      setNotice(successMessage);
    } catch (err: any) {
      setError(err.message || "Erro ao salvar cadastro.");
    } finally {
      setSubmitting("");
    }
  }

  async function handleCompanySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await postAction(
      {
        action: "company_upsert",
        name: companyForm.name,
        cnpj: companyForm.cnpj,
        legalName: companyForm.legalName,
        groupName: companyForm.groupName,
        groupCode: companyForm.groupCode,
      },
      "Empresa cadastrada com sucesso."
    );

    setCompanyForm({
      name: "",
      cnpj: "",
      legalName: "",
      groupName: "Grupo RR",
      groupCode: "",
    });
  }

  async function handleIdentifierSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await postAction(
      {
        action: "identifier_upsert",
        companyId: identifierForm.companyId,
        mci: identifierForm.mci,
        cobanCode: identifierForm.cobanCode,
        identifierType: identifierForm.identifierType,
      },
      "Identificador salvo com sucesso."
    );

    setIdentifierForm((current) => ({
      ...current,
      mci: "",
      cobanCode: "",
    }));
  }

  async function handlePromoterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await postAction(
      {
        action: "promoter_upsert",
        companyId: promoterForm.companyId || null,
        name: promoterForm.name,
        status: promoterForm.status,
        hiredAt: promoterForm.hiredAt || null,
        notes: promoterForm.notes || null,
      },
      "Promotor salvo com sucesso."
    );

    setPromoterForm((current) => ({
      ...current,
      name: "",
      hiredAt: "",
      notes: "",
    }));
  }

  async function handleJKeySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await postAction(
      {
        action: "jkey_upsert",
        companyId: jKeyForm.companyId || null,
        promoterId: jKeyForm.promoterId || null,
        jKey: jKeyForm.jKey,
        keyType: jKeyForm.keyType,
        displayName: jKeyForm.displayName || null,
      },
      "Chave J salva com sucesso."
    );

    setJKeyForm((current) => ({
      ...current,
      jKey: "",
      displayName: "",
    }));
  }

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Base mestra</div>
          <h2 style={styles.title}>Cadastros estruturais do sistema</h2>
          <p style={styles.description}>
            Aqui voce cadastra empresas, identificadores, promotores e Chaves J sem
            depender da importacao diaria. A inativacao preserva historico e evita
            apagar o passado da operacao.
          </p>
          <div style={styles.heroSignals}>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Empresas</span>
              <strong style={styles.heroSignalValue}>Base legal e operacional</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Promotores</span>
              <strong style={styles.heroSignalValue}>Historico preservado</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Chaves J</span>
              <strong style={styles.heroSignalValue}>Controle manual e ativo</strong>
            </div>
          </div>
        </article>

        <article style={styles.heroAside}>
          <div style={styles.heroAsideLabel}>Governanca</div>
          <div style={styles.heroAsideValue}>Inclusao manual com historico preservado</div>
          <div style={styles.heroAsideText}>
            Empresas, promotores e Chaves J podem ser criados ou inativados sem
            quebrar meses ja fechados.
          </div>
        </article>
      </div>

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="Cadastro interrompido"
          title="Nao foi possivel concluir a alteracao."
          description={error}
        />
      ) : null}
      {notice ? (
        <FeedbackBanner
          variant="success"
          eyebrow="Cadastro atualizado"
          title="A estrutura cadastral foi salva com sucesso."
          description={notice}
          actionLabel="Abrir promotores"
          actionHref="/promotores"
        />
      ) : null}

      <div style={styles.summaryGrid}>
        <SummaryCard label="Empresas" value={String(data.summary.companies)} />
        <SummaryCard label="Promotores ativos" value={String(data.summary.activePromoters)} />
        <SummaryCard label="Chaves J ativas" value={String(data.summary.activeJKeys)} />
        <SummaryCard label="Chaves master" value={String(data.summary.masterKeys)} />
      </div>

      <div style={styles.subsectionNav}>
        <button
          type="button"
          onClick={() => setActiveSection("empresas")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "empresas" ? styles.subsectionButtonActive : {}),
          }}
        >
          Empresas e identificadores
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("promotores")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "promotores" ? styles.subsectionButtonActive : {}),
          }}
        >
          Promotores
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("chaves")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "chaves" ? styles.subsectionButtonActive : {}),
          }}
        >
          Chaves J
        </button>
      </div>

      {activeSection === "empresas" ? (
        <div style={styles.contentGrid}>
          <article style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <div style={styles.sectionKicker}>Empresa</div>
                <h3 style={styles.sectionTitle}>Nova empresa</h3>
              </div>
            </div>

            <form onSubmit={handleCompanySubmit} style={styles.formGrid}>
              <FormRow label="Nome fantasia">
                <input
                  value={companyForm.name}
                  onChange={(event) =>
                    setCompanyForm((current) => ({ ...current, name: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="CNPJ">
                <input
                  value={companyForm.cnpj}
                  onChange={(event) =>
                    setCompanyForm((current) => ({ ...current, cnpj: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Razao social">
                <input
                  value={companyForm.legalName}
                  onChange={(event) =>
                    setCompanyForm((current) => ({
                      ...current,
                      legalName: event.target.value,
                    }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Grupo">
                <input
                  value={companyForm.groupName}
                  onChange={(event) =>
                    setCompanyForm((current) => ({
                      ...current,
                      groupName: event.target.value,
                    }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <button
                type="submit"
                style={styles.primaryButton}
                disabled={submitting === "company_upsert"}
              >
                {submitting === "company_upsert" ? "Salvando..." : "Salvar empresa"}
              </button>
            </form>

            <div style={styles.list}>
              {loading ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Empresas"
                  title="Carregando base de empresas."
                  description="A listagem sera exibida assim que a leitura cadastral terminar."
                />
              ) : data.companies.length === 0 ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Sem empresas"
                  title="Nenhuma empresa foi cadastrada ainda."
                  description="Cadastre a primeira empresa para comecar a organizar identificadores, promotores e chaves."
                />
              ) : (
                data.companies.map((company) => (
                  <div key={company.id} style={styles.listItem}>
                    <div>
                      <div style={styles.itemTitle}>{company.name}</div>
                      <div style={styles.itemMeta}>
                        {company.cnpj} | {company.identifiers.length} identificadores
                      </div>
                    </div>
                    <button
                      type="button"
                      style={company.active === false ? styles.secondaryButton : styles.lightButton}
                      onClick={() =>
                        postAction(
                          {
                            action: "toggle_company",
                            id: company.id,
                            active: company.active === false,
                          },
                          company.active === false
                            ? "Empresa reativada com sucesso."
                            : "Empresa inativada com sucesso."
                        )
                      }
                    >
                      {company.active === false ? "Reativar" : "Inativar"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </article>

          <article style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <div style={styles.sectionKicker}>Identificador</div>
                <h3 style={styles.sectionTitle}>MCI e Coban</h3>
              </div>
            </div>

            <form onSubmit={handleIdentifierSubmit} style={styles.formGrid}>
              <FormRow label="Empresa">
                <select
                  value={identifierForm.companyId}
                  onChange={(event) =>
                    setIdentifierForm((current) => ({
                      ...current,
                      companyId: event.target.value,
                    }))
                  }
                  style={styles.input}
                >
                  <option value="">Selecione</option>
                  {data.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="MCI">
                <input
                  value={identifierForm.mci}
                  onChange={(event) =>
                    setIdentifierForm((current) => ({ ...current, mci: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Codigo Coban">
                <input
                  value={identifierForm.cobanCode}
                  onChange={(event) =>
                    setIdentifierForm((current) => ({
                      ...current,
                      cobanCode: event.target.value,
                    }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <button
                type="submit"
                style={styles.primaryButton}
                disabled={submitting === "identifier_upsert"}
              >
                {submitting === "identifier_upsert" ? "Salvando..." : "Salvar identificador"}
              </button>
            </form>

            <div style={styles.list}>
              {loading ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Identificadores"
                  title="Carregando MCI e Coban."
                  description="Os vinculos operacionais das empresas aparecerao nesta lista."
                />
              ) : data.companies.flatMap((company) => company.identifiers).length === 0 ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Sem identificadores"
                  title="Ainda nao existem MCI e Coban cadastrados."
                  description="Esses dados ajudam o sistema a casar a diaria com a empresa correta."
                />
              ) : (
                data.companies.flatMap((company) =>
                  company.identifiers.map((identifier) => (
                    <div key={identifier.id} style={styles.listItem}>
                      <div>
                        <div style={styles.itemTitle}>{company.name}</div>
                        <div style={styles.itemMeta}>
                          MCI {identifier.mci || "-"} | Coban {identifier.coban_code || "-"}
                        </div>
                      </div>
                      <span style={styles.badge}>{identifier.identifier_type || "PRIMARY"}</span>
                    </div>
                  ))
                )
              )}
            </div>
          </article>
        </div>
      ) : null}

      {activeSection === "promotores" ? (
        <div style={styles.contentGrid}>
          <article style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <div style={styles.sectionKicker}>Promotor</div>
                <h3 style={styles.sectionTitle}>Novo promotor</h3>
              </div>
            </div>

            <form onSubmit={handlePromoterSubmit} style={styles.formGrid}>
              <FormRow label="Empresa">
                <select
                  value={promoterForm.companyId}
                  onChange={(event) =>
                    setPromoterForm((current) => ({
                      ...current,
                      companyId: event.target.value,
                    }))
                  }
                  style={styles.input}
                >
                  <option value="">Sem empresa</option>
                  {data.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Nome">
                <input
                  value={promoterForm.name}
                  onChange={(event) =>
                    setPromoterForm((current) => ({ ...current, name: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Data de admissao">
                <input
                  type="date"
                  value={promoterForm.hiredAt}
                  onChange={(event) =>
                    setPromoterForm((current) => ({ ...current, hiredAt: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Observacoes">
                <textarea
                  value={promoterForm.notes}
                  onChange={(event) =>
                    setPromoterForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  style={styles.textarea}
                />
              </FormRow>
              <button
                type="submit"
                style={styles.primaryButton}
                disabled={submitting === "promoter_upsert"}
              >
                {submitting === "promoter_upsert" ? "Salvando..." : "Salvar promotor"}
              </button>
            </form>

            <div style={styles.list}>
              {loading ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Promotores"
                  title="Carregando base comercial."
                  description="Os vendedores cadastrados aparecerao nesta relacao logo apos a leitura."
                />
              ) : data.promoters.length === 0 ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Sem promotores"
                  title="Nenhum promotor foi cadastrado ainda."
                  description="Use a planilha de Chaves J ou inclua manualmente o time comercial."
                />
              ) : (
                data.promoters.map((promoter) => (
                  <div key={promoter.id} style={styles.listItem}>
                    <div>
                      <div style={styles.itemTitle}>{promoter.name}</div>
                      <div style={styles.itemMeta}>
                        {promoter.company_name} | {promoter.keys.length} Chaves J
                      </div>
                    </div>
                    <button
                      type="button"
                      style={promoter.active === false ? styles.secondaryButton : styles.lightButton}
                      onClick={() =>
                        postAction(
                          {
                            action: "toggle_promoter",
                            id: promoter.id,
                            active: promoter.active === false,
                          },
                          promoter.active === false
                            ? "Promotor reativado com sucesso."
                            : "Promotor inativado com sucesso."
                        )
                      }
                    >
                      {promoter.active === false ? "Reativar" : "Inativar"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </article>

          <aside style={styles.supportCard}>
            <div style={styles.sectionKicker}>Distribuicao atual</div>
            <h3 style={styles.sectionTitle}>Promotores por empresa</h3>
            <div style={styles.supportList}>
              {data.companies.length === 0 ? (
                <div style={styles.supportItem}>
                  <div style={styles.supportTitle}>Sem empresas</div>
                  <div style={styles.supportDetail}>
                    Cadastre a base das empresas para organizar os promotores.
                  </div>
                </div>
              ) : (
                data.companies.map((company) => (
                  <div key={company.id} style={styles.supportItem}>
                    <div style={styles.supportTitle}>{company.name}</div>
                    <div style={styles.supportDetail}>
                      {company.active_promoters_count} ativos de {company.promoters_count} cadastrados.
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {activeSection === "chaves" ? (
        <div style={styles.contentGrid}>
          <article style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <div style={styles.sectionKicker}>Chave J</div>
                <h3 style={styles.sectionTitle}>Nova chave</h3>
              </div>
            </div>

            <form onSubmit={handleJKeySubmit} style={styles.formGrid}>
              <FormRow label="Empresa">
                <select
                  value={jKeyForm.companyId}
                  onChange={(event) =>
                    setJKeyForm((current) => ({
                      ...current,
                      companyId: event.target.value,
                    }))
                  }
                  style={styles.input}
                >
                  <option value="">Sem empresa</option>
                  {data.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Promotor vinculado">
                <select
                  value={jKeyForm.promoterId}
                  onChange={(event) =>
                    setJKeyForm((current) => ({
                      ...current,
                      promoterId: event.target.value,
                    }))
                  }
                  style={styles.input}
                >
                  <option value="">Sem promotor</option>
                  {data.promoters.map((promoter) => (
                    <option key={promoter.id} value={promoter.id}>
                      {promoter.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Chave J">
                <input
                  value={jKeyForm.jKey}
                  onChange={(event) =>
                    setJKeyForm((current) => ({ ...current, jKey: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Tipo">
                <select
                  value={jKeyForm.keyType}
                  onChange={(event) =>
                    setJKeyForm((current) => ({
                      ...current,
                      keyType: event.target.value,
                    }))
                  }
                  style={styles.input}
                >
                  <option value="INDIVIDUAL">Individual</option>
                  <option value="MASTER">Master</option>
                </select>
              </FormRow>
              <button
                type="submit"
                style={styles.primaryButton}
                disabled={submitting === "jkey_upsert"}
              >
                {submitting === "jkey_upsert" ? "Salvando..." : "Salvar Chave J"}
              </button>
            </form>

            <div style={styles.list}>
              {loading ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Chaves J"
                  title="Carregando mapa das chaves."
                  description="As chaves da operacao ficarao disponiveis assim que a base terminar de carregar."
                />
              ) : data.jKeys.length === 0 ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Sem chaves"
                  title="Nenhuma Chave J foi cadastrada ainda."
                  description="Cadastre ou importe as chaves para distribuir corretamente a producao entre empresa e promotor."
                />
              ) : (
                data.jKeys.map((jKey) => (
                  <div key={jKey.id} style={styles.listItem}>
                    <div>
                      <div style={styles.itemTitle}>{jKey.j_key}</div>
                      <div style={styles.itemMeta}>
                        {jKey.company_name} | {jKey.promoter_name || "Sem promotor"}
                      </div>
                    </div>
                    <div style={styles.inlineActions}>
                      <span style={styles.badge}>{jKey.key_type || "INDIVIDUAL"}</span>
                      <button
                        type="button"
                        style={jKey.active === false ? styles.secondaryButton : styles.lightButton}
                        onClick={() =>
                          postAction(
                            {
                              action: "toggle_jkey",
                              id: jKey.id,
                              active: jKey.active === false,
                            },
                            jKey.active === false
                              ? "Chave J reativada com sucesso."
                              : "Chave J inativada com sucesso."
                          )
                        }
                      >
                        {jKey.active === false ? "Reativar" : "Inativar"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <aside style={styles.supportCard}>
            <div style={styles.sectionKicker}>Regras de uso</div>
            <h3 style={styles.sectionTitle}>Leitura da base</h3>
            <div style={styles.supportList}>
              <div style={styles.supportItem}>
                <div style={styles.supportTitle}>Chave individual</div>
                <div style={styles.supportDetail}>
                  Usada quando a producao ja sai no nome do promotor.
                </div>
              </div>
              <div style={styles.supportItem}>
                <div style={styles.supportTitle}>Chave master</div>
                <div style={styles.supportDetail}>
                  Serve para novatos e operacoes que depois serao migradas manualmente.
                </div>
              </div>
              <div style={styles.supportItem}>
                <div style={styles.supportTitle}>Historico preservado</div>
                <div style={styles.supportDetail}>
                  Inativar evita apagar meses antigos e protege auditorias futuras.
                </div>
              </div>
            </div>
          </aside>
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
    borderRadius: "28px",
    padding: "28px",
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
    minWidth: "156px",
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
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    borderRadius: "28px",
    padding: "24px",
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
  heroAsideValue: {
    fontSize: "24px",
    fontWeight: 800,
    color: "var(--rr-yellow)",
    marginBottom: "10px",
    lineHeight: 1.2,
    fontFamily: "var(--font-heading)",
  },
  heroAsideText: {
    fontSize: "14px",
    lineHeight: 1.65,
    color: "rgba(255,255,255,0.9)",
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
    gap: "12px",
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
  summaryCard: {
    borderRadius: "22px",
    padding: "18px",
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
    fontSize: "28px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    fontFamily: "var(--font-heading)",
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
    alignItems: "start",
  },
  card: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "26px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    overflow: "hidden",
    paddingBottom: "20px",
  },
  supportCard: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.93) 0%, rgba(255,253,245,0.98) 100%)",
    borderRadius: "26px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    padding: "22px",
    display: "grid",
    gap: "14px",
    position: "sticky",
    top: "84px",
  },
  supportList: {
    display: "grid",
    gap: "12px",
  },
  supportItem: {
    borderRadius: "18px",
    border: "1px solid rgba(13,77,227,0.1)",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.04) 0%, rgba(255,255,255,0.96) 100%)",
    padding: "14px",
  },
  supportTitle: {
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    marginBottom: "4px",
  },
  supportDetail: {
    fontSize: "13px",
    lineHeight: 1.6,
    color: "var(--rr-muted)",
  },
  cardHeader: {
    padding: "22px 22px 0",
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
  formGrid: {
    display: "grid",
    gap: "12px",
    padding: "16px 22px 0",
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
  textarea: {
    width: "100%",
    minHeight: "92px",
    borderRadius: "14px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "12px 14px",
    fontSize: "14px",
    color: "var(--rr-ink)",
    background: "rgba(255,255,255,0.96)",
    outline: "none",
    resize: "vertical",
    fontFamily: "inherit",
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
  },
  secondaryButton: {
    border: 0,
    borderRadius: "14px",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    color: "var(--rr-blue-deep)",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.95) 0%, rgba(214,161,63,0.92) 100%)",
  },
  lightButton: {
    border: "1px solid rgba(13,77,227,0.14)",
    borderRadius: "14px",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    color: "var(--rr-ink)",
    background: "#fffdf6",
  },
  list: {
    display: "grid",
    gap: "10px",
    padding: "16px 22px 0",
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
  inlineActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
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
  emptyState: {
    padding: "16px 22px 0",
    fontSize: "14px",
    color: "var(--rr-muted)",
  },
};
