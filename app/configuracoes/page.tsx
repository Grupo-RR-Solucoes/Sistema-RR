"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import EmptyStatePanel from "../../components/EmptyStatePanel";
import FeedbackBanner from "../../components/FeedbackBanner";

type AccessProfile = {
  id: string;
  name: string;
  description?: string | null;
  created_at?: string | null;
};

type AppUser = {
  id: string;
  email: string;
  full_name?: string | null;
  access_profile_id?: string | null;
  profile_name: string;
  active?: boolean | null;
  created_at?: string | null;
};

type GovernanceItem = {
  title: string;
  detail: string;
};

type DiagnosticPayload = {
  status: "ok" | "warning";
  timestamp: string;
  env: {
    supabaseUrl: boolean;
    supabaseAnonKey: boolean;
    supabaseServiceRole: boolean;
  };
  database: {
    connected: boolean;
    checkedTables: number;
    healthyTables: number;
  };
  tables: Array<{
    table: string;
    ok: boolean;
    count: number | null;
    error?: string;
  }>;
  message: string;
};

type ConfigPayload = {
  summary: {
    profiles: number;
    users: number;
    activeUsers: number;
    monthPolicy: string;
    retroactivePolicy: string;
  };
  profiles: AccessProfile[];
  users: AppUser[];
  governance: GovernanceItem[];
};

const emptyPayload: ConfigPayload = {
  summary: {
    profiles: 0,
    users: 0,
    activeUsers: 0,
    monthPolicy: "EDITAVEL",
    retroactivePolicy: "LIBERADA",
  },
  profiles: [],
  users: [],
  governance: [],
};

const emptyDiagnostic: DiagnosticPayload = {
  status: "warning",
  timestamp: "",
  env: {
    supabaseUrl: false,
    supabaseAnonKey: false,
    supabaseServiceRole: false,
  },
  database: {
    connected: false,
    checkedTables: 0,
    healthyTables: 0,
  },
  tables: [],
  message: "",
};

const profileCoverage: Record<string, string[]> = {
  "visao geral": [
    "Dashboard completo",
    "Financeiro e fechamento",
    "Cadastros e governanca",
    "Importacoes, auditoria e relatorios",
  ],
  "visao parcial": [
    "Lancamento de despesas",
    "Importacao diaria",
    "Descontos e detalhes de promotores",
    "Consultas operacionais",
  ],
};

export default function ConfiguracoesPage() {
  const [data, setData] = useState<ConfigPayload>(emptyPayload);
  const [diagnostic, setDiagnostic] = useState<DiagnosticPayload>(emptyDiagnostic);
  const [loading, setLoading] = useState(true);
  const [diagnosticLoading, setDiagnosticLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState<"" | "profile" | "user" | "toggle">("");
  const [activeSection, setActiveSection] = useState<
    "diagnostico" | "perfis" | "usuarios"
  >("diagnostico");
  const [profileForm, setProfileForm] = useState({
    id: "",
    name: "",
    description: "",
  });
  const [userForm, setUserForm] = useState({
    id: "",
    fullName: "",
    email: "",
    accessProfileId: "",
  });

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/configuracoes");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao carregar configuracoes.");
      }

      setData(payload || emptyPayload);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar configuracoes.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDiagnostic() {
    try {
      setDiagnosticLoading(true);

      const response = await fetch("/api/diagnostico");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao carregar diagnostico.");
      }

      setDiagnostic(payload || emptyDiagnostic);
    } catch (err: any) {
      setDiagnostic({
        ...emptyDiagnostic,
        message: err.message || "Erro ao carregar diagnostico.",
      });
    } finally {
      setDiagnosticLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    loadDiagnostic();
  }, []);

  useEffect(() => {
    if (!userForm.accessProfileId && data.profiles[0]?.id) {
      setUserForm((current) => ({
        ...current,
        accessProfileId: data.profiles[0].id,
      }));
    }
  }, [data.profiles, userForm.accessProfileId]);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setSubmitting("profile");
      setError("");
      setNotice("");

      const response = await fetch("/api/configuracoes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "profile_upsert",
          id: profileForm.id || null,
          name: profileForm.name,
          description: profileForm.description || null,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao salvar perfil.");
      }

      setProfileForm({
        id: "",
        name: "",
        description: "",
      });
      setNotice("Perfil salvo com sucesso.");
      await loadData();
      await loadDiagnostic();
    } catch (err: any) {
      setError(err.message || "Erro ao salvar perfil.");
    } finally {
      setSubmitting("");
    }
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setSubmitting("user");
      setError("");
      setNotice("");

      const response = await fetch("/api/configuracoes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "user_upsert",
          id: userForm.id || null,
          fullName: userForm.fullName,
          email: userForm.email,
          accessProfileId: userForm.accessProfileId,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao salvar usuario.");
      }

      setUserForm({
        id: "",
        fullName: "",
        email: "",
        accessProfileId: data.profiles[0]?.id || "",
      });
      setNotice("Usuario salvo com sucesso.");
      await loadData();
      await loadDiagnostic();
    } catch (err: any) {
      setError(err.message || "Erro ao salvar usuario.");
    } finally {
      setSubmitting("");
    }
  }

  async function toggleUser(user: AppUser) {
    try {
      setSubmitting("toggle");
      setError("");
      setNotice("");

      const response = await fetch("/api/configuracoes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "toggle_user",
          id: user.id,
          active: user.active === false,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao atualizar usuario.");
      }

      setNotice(
        user.active === false ? "Usuario reativado com sucesso." : "Usuario inativado com sucesso."
      );
      await loadData();
      await loadDiagnostic();
    } catch (err: any) {
      setError(err.message || "Erro ao atualizar usuario.");
    } finally {
      setSubmitting("");
    }
  }

  const profileCards = useMemo(
    () =>
      data.profiles.map((profile) => ({
        ...profile,
        coverage:
          profileCoverage[(profile.name || "").toLowerCase()] || [
            "Perfil customizado",
            "Ajuste a descricao conforme a operacao",
          ],
      })),
    [data.profiles]
  );

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Governanca</div>
          <h2 style={styles.title}>Configuracoes, perfis e usuarios internos</h2>
          <p style={styles.description}>
            Esta central deixa o sistema pronto para operacao organizada: perfis de
            acesso, usuarios internos e politicas administrativas que sustentam a
            retroatividade do negocio.
          </p>
          <div style={styles.heroSignals}>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Perfis</span>
              <strong style={styles.heroSignalValue}>Controle por area</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Usuarios</span>
              <strong style={styles.heroSignalValue}>Base interna pronta</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Politicas</span>
              <strong style={styles.heroSignalValue}>Mes editavel e retroativo</strong>
            </div>
          </div>
        </article>

        <article style={styles.heroAside}>
          <div style={styles.heroAsideLabel}>Aviso importante</div>
          <div style={styles.heroAsideHighlight}>Auth entra na publicacao</div>
          <div style={styles.sideText}>
            O cadastro de perfis e usuarios ja esta operacional. O bloqueio real por
            login entra assim que conectarmos o Supabase Auth na publicacao.
          </div>
        </article>
      </div>

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="Governanca interrompida"
          title="Nao foi possivel concluir a configuracao."
          description={error}
        />
      ) : null}
      {notice ? (
        <FeedbackBanner
          variant="success"
          eyebrow="Governanca atualizada"
          title="A configuracao foi salva com sucesso."
          description={notice}
          actionLabel="Revisar diagnostico"
          actionHref="/configuracoes"
        />
      ) : null}

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Perfis"
          value={String(data.summary.profiles)}
          detail="Perfis internos cadastrados."
        />
        <SummaryCard
          label="Usuarios ativos"
          value={String(data.summary.activeUsers)}
          detail={`${data.summary.users} usuarios no cadastro interno.`}
        />
        <SummaryCard
          label="Competencia"
          value={data.summary.monthPolicy}
          detail="Mes aberto e editavel para recalculos."
        />
        <SummaryCard
          label="Retroatividade"
          value={data.summary.retroactivePolicy}
          detail="Alteracoes passadas e futuras continuam permitidas."
        />
      </div>

      <div style={styles.subsectionNav}>
        <button
          type="button"
          onClick={() => setActiveSection("diagnostico")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "diagnostico" ? styles.subsectionButtonActive : {}),
          }}
        >
          Diagnostico
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("perfis")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "perfis" ? styles.subsectionButtonActive : {}),
          }}
        >
          Perfis
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("usuarios")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "usuarios" ? styles.subsectionButtonActive : {}),
          }}
        >
          Usuarios
        </button>
      </div>

      {activeSection === "diagnostico" ? (
        <article style={styles.diagnosticCard}>
          <div style={styles.sectionHeaderInline}>
            <div>
              <div style={styles.sectionKicker}>Diagnostico tecnico</div>
              <h3 style={styles.sectionTitle}>Ambiente e banco</h3>
            </div>
            <button type="button" onClick={loadDiagnostic} style={styles.lightButton}>
              {diagnosticLoading ? "Atualizando..." : "Atualizar diagnostico"}
            </button>
          </div>

          <div style={styles.diagnosticTop}>
            <div style={styles.policyItem}>
              <div style={styles.policyTitle}>Status geral</div>
              <div style={styles.policyDetail}>
                {diagnosticLoading
                  ? "Consultando ambiente..."
                  : diagnostic.message || "Sem diagnostico."}
              </div>
            </div>
            <div style={styles.coverageList}>
              <span
                style={{
                  ...styles.badge,
                  ...(diagnostic.status === "ok" ? styles.badgeOk : styles.badgeWarning),
                }}
              >
                {diagnostic.status === "ok" ? "ambiente ok" : "pendencias"}
              </span>
              <span style={styles.badge}>
                tabelas validas {diagnostic.database.healthyTables}/{diagnostic.database.checkedTables}
              </span>
            </div>
          </div>

          <div style={styles.envGrid}>
            <EnvStatus label="Supabase URL" ok={diagnostic.env.supabaseUrl} />
            <EnvStatus label="Anon Key" ok={diagnostic.env.supabaseAnonKey} />
            <EnvStatus label="Service Role" ok={diagnostic.env.supabaseServiceRole} />
            <EnvStatus label="Banco respondendo" ok={diagnostic.database.connected} />
          </div>

          <div style={styles.tableGrid}>
            {diagnostic.tables.length === 0 ? (
              <EmptyStatePanel
                compact
                eyebrow="Sem validacao"
                title="Nenhuma tabela foi validada ainda."
                description="Isso costuma acontecer antes de ligar o Supabase ou quando o diagnostico ainda nao foi executado."
              />
            ) : (
              diagnostic.tables.map((table) => (
                <div key={table.table} style={styles.tableHealthCard}>
                  <div style={styles.profileHeader}>
                    <div>
                      <div style={styles.profileName}>{table.table}</div>
                      <div style={styles.profileDescription}>
                        {table.ok
                          ? `${table.count ?? 0} registros visiveis no teste.`
                          : table.error || "Tabela sem leitura valida."}
                      </div>
                    </div>
                    <span
                      style={{
                        ...styles.badge,
                        ...(table.ok ? styles.badgeOk : styles.badgeWarning),
                      }}
                    >
                      {table.ok ? "ok" : "falha"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      ) : null}

      {activeSection === "perfis" ? (
        <div style={styles.contentGrid}>
          <article style={styles.sectionCard}>
            <div style={styles.sectionTopLine} />
            <div style={styles.sectionKicker}>Perfis de acesso</div>
            <h3 style={styles.sectionTitle}>Cobertura operacional</h3>
            <p style={styles.sectionDescription}>
              Estes perfis representam o que foi definido para diretoria e operacao parcial,
              sem travar futura expansao para acesso dos promotores.
            </p>

            <div style={styles.profileGrid}>
              {loading ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Perfis"
                  title="Carregando perfis de acesso."
                  description="A leitura dos perfis internos esta em andamento."
                />
              ) : profileCards.length === 0 ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Sem perfis"
                  title="Nenhum perfil foi cadastrado ainda."
                  description="Crie a primeira camada de acesso para organizar diretoria e operacao."
                />
              ) : (
                profileCards.map((profile) => (
                  <article key={profile.id} style={styles.profileCard}>
                    <div style={styles.profileHeader}>
                      <div>
                        <div style={styles.profileName}>{profile.name}</div>
                        <div style={styles.profileDescription}>
                          {profile.description || "Sem descricao cadastrada."}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setProfileForm({
                            id: profile.id,
                            name: profile.name,
                            description: profile.description || "",
                          })
                        }
                        style={styles.lightButton}
                      >
                        Editar
                      </button>
                    </div>
                    <div style={styles.coverageList}>
                      {profile.coverage.map((item) => (
                        <span key={item} style={styles.badge}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>

          <aside style={styles.formRail}>
            <article style={styles.formCard}>
              <div style={styles.sectionHeaderCompact}>
                <div>
                  <div style={styles.sectionKicker}>Cadastro</div>
                  <h3 style={styles.sectionTitle}>Novo perfil</h3>
                </div>
              </div>

              <form onSubmit={handleProfileSubmit} style={styles.formGrid}>
                <FormRow label="Nome do perfil">
                  <input
                    value={profileForm.name}
                    onChange={(event) =>
                      setProfileForm((current) => ({ ...current, name: event.target.value }))
                    }
                    style={styles.input}
                  />
                </FormRow>
                <FormRow label="Descricao">
                  <textarea
                    value={profileForm.description}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    style={styles.textarea}
                  />
                </FormRow>
                <button
                  type="submit"
                  style={styles.primaryButton}
                  disabled={submitting === "profile"}
                >
                  {submitting === "profile" ? "Salvando..." : "Salvar perfil"}
                </button>
              </form>
            </article>

            <article style={styles.formCard}>
              <div style={styles.sectionHeaderCompact}>
                <div>
                  <div style={styles.sectionKicker}>Governanca</div>
                  <h3 style={styles.sectionTitle}>Politicas atuais</h3>
                </div>
              </div>

              <div style={styles.policyList}>
                {data.governance.map((item) => (
                  <div key={item.title} style={styles.policyItem}>
                    <div style={styles.policyTitle}>{item.title}</div>
                    <div style={styles.policyDetail}>{item.detail}</div>
                  </div>
                ))}
              </div>
            </article>
          </aside>
        </div>
      ) : null}

      {activeSection === "usuarios" ? (
        <div style={styles.contentGrid}>
          <article style={styles.sectionCard}>
            <div style={styles.sectionTopLine} />
            <div style={styles.sectionKicker}>Usuarios internos</div>
            <h3 style={styles.sectionTitle}>Operacao e diretoria</h3>
            <p style={styles.sectionDescription}>
              Aqui ficam os usuarios internos ligados aos perfis, ja prontos para
              serem conectados ao login real na implantacao.
            </p>

            {loading ? (
              <EmptyStatePanel
                compact
                eyebrow="Usuarios"
                title="Carregando base interna."
                description="Os usuarios internos aparecerao assim que a leitura do cadastro terminar."
              />
            ) : data.users.length === 0 ? (
              <EmptyStatePanel
                compact
                eyebrow="Sem usuarios"
                title="Nenhum usuario foi cadastrado ainda."
                description="Cadastre a equipe interna para preparar o sistema para a etapa de login real."
              />
            ) : (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Usuario</th>
                      <th style={styles.th}>Perfil</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Criado em</th>
                      <th style={styles.th}>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((user) => (
                      <tr key={user.id}>
                        <td style={styles.td}>
                          <div style={styles.itemTitle}>{user.full_name || "Sem nome"}</div>
                          <div style={styles.itemMeta}>{user.email}</div>
                        </td>
                        <td style={styles.td}>{user.profile_name}</td>
                        <td style={styles.td}>
                          <span
                            style={{
                              ...styles.badge,
                              ...(user.active === false ? styles.badgeWarning : styles.badgeOk),
                            }}
                          >
                            {user.active === false ? "inativo" : "ativo"}
                          </span>
                        </td>
                        <td style={styles.td}>{formatDate(user.created_at)}</td>
                        <td style={styles.td}>
                          <div style={styles.actionRow}>
                            <button
                              type="button"
                              onClick={() =>
                                setUserForm({
                                  id: user.id,
                                  fullName: user.full_name || "",
                                  email: user.email,
                                  accessProfileId: user.access_profile_id || "",
                                })
                              }
                              style={styles.lightButton}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleUser(user)}
                              style={styles.lightButton}
                              disabled={submitting === "toggle"}
                            >
                              {user.active === false ? "Ativar" : "Inativar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <aside style={styles.formRail}>
            <article style={styles.formCard}>
              <div style={styles.sectionHeaderCompact}>
                <div>
                  <div style={styles.sectionKicker}>Cadastro</div>
                  <h3 style={styles.sectionTitle}>Novo usuario interno</h3>
                </div>
              </div>

              <form onSubmit={handleUserSubmit} style={styles.formGrid}>
                <FormRow label="Nome completo">
                  <input
                    value={userForm.fullName}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, fullName: event.target.value }))
                    }
                    style={styles.input}
                  />
                </FormRow>
                <FormRow label="Email">
                  <input
                    value={userForm.email}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, email: event.target.value }))
                    }
                    style={styles.input}
                    type="email"
                  />
                </FormRow>
                <FormRow label="Perfil de acesso">
                  <select
                    value={userForm.accessProfileId}
                    onChange={(event) =>
                      setUserForm((current) => ({
                        ...current,
                        accessProfileId: event.target.value,
                      }))
                    }
                    style={styles.input}
                  >
                    <option value="">Selecione</option>
                    {data.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </FormRow>
                <button
                  type="submit"
                  style={styles.primaryButton}
                  disabled={submitting === "user"}
                >
                  {submitting === "user" ? "Salvando..." : "Salvar usuario"}
                </button>
              </form>
            </article>
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

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value}</div>
      <div style={styles.summaryDetail}>{detail}</div>
    </article>
  );
}

function EnvStatus({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={styles.envStatusCard}>
      <div style={styles.policyTitle}>{label}</div>
      <div style={styles.coverageList}>
        <span
          style={{
            ...styles.badge,
            ...(ok ? styles.badgeOk : styles.badgeWarning),
          }}
        >
          {ok ? "configurado" : "pendente"}
        </span>
      </div>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-BR").format(date);
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
    minWidth: "154px",
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
    display: "grid",
    gap: "12px",
  },
  heroAsideLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "rgba(255,255,255,0.72)",
    fontWeight: 800,
  },
  heroAsideHighlight: {
    fontSize: "20px",
    lineHeight: 1.2,
    color: "var(--rr-yellow)",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
  },
  sideText: {
    fontSize: "14px",
    lineHeight: 1.7,
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
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
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
  diagnosticCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "26px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    padding: "22px",
    display: "grid",
    gap: "16px",
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
  sectionHeaderInline: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  diagnosticTop: {
    display: "grid",
    gap: "12px",
  },
  envGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
  },
  envStatusCard: {
    borderRadius: "18px",
    border: "1px solid rgba(13,77,227,0.1)",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.05) 0%, rgba(255,255,255,0.92) 100%)",
    padding: "14px",
    display: "grid",
    gap: "10px",
  },
  tableGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "12px",
  },
  tableHealthCard: {
    borderRadius: "18px",
    border: "1px solid rgba(13,77,227,0.1)",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.12) 0%, rgba(255,255,255,0.96) 100%)",
    padding: "16px",
  },
  sectionCard: {
    position: "relative",
    background: "rgba(255,255,255,0.92)",
    border: "1px solid var(--rr-line)",
    borderRadius: "26px",
    padding: "22px",
    boxShadow: "var(--rr-shadow-soft)",
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
    margin: "10px 0 16px",
    fontSize: "15px",
    lineHeight: 1.7,
    color: "var(--rr-muted)",
  },
  profileGrid: {
    display: "grid",
    gap: "12px",
  },
  profileCard: {
    borderRadius: "18px",
    border: "1px solid rgba(13,77,227,0.1)",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.05) 0%, rgba(255,255,255,0.92) 100%)",
    padding: "16px",
    display: "grid",
    gap: "14px",
  },
  profileHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
  },
  profileName: {
    fontSize: "16px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    marginBottom: "4px",
  },
  profileDescription: {
    fontSize: "14px",
    lineHeight: 1.6,
    color: "var(--rr-muted)",
  },
  coverageList: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  formRail: {
    display: "grid",
    gap: "16px",
  },
  formCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "26px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    overflow: "hidden",
    paddingBottom: "20px",
  },
  sectionHeaderCompact: {
    padding: "20px 22px 0",
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
  policyList: {
    display: "grid",
    gap: "12px",
    padding: "16px 22px 0",
  },
  policyItem: {
    borderRadius: "18px",
    border: "1px solid rgba(13,77,227,0.1)",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.12) 0%, rgba(255,255,255,0.96) 100%)",
    padding: "14px",
  },
  policyTitle: {
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    marginBottom: "6px",
  },
  policyDetail: {
    fontSize: "13px",
    lineHeight: 1.65,
    color: "var(--rr-muted)",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  th: {
    textAlign: "left",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    padding: "0 14px 12px 0",
    borderBottom: "1px solid var(--rr-line)",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "14px 14px 14px 0",
    fontSize: "14px",
    color: "var(--rr-muted)",
    borderBottom: "1px solid rgba(13,77,227,0.08)",
    whiteSpace: "nowrap",
    verticalAlign: "top",
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
  badgeOk: {
    background: "rgba(13,77,227,0.1)",
    color: "var(--rr-blue-deep)",
  },
  badgeWarning: {
    background: "rgba(245,158,11,0.14)",
    color: "#92400e",
  },
  actionRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
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
};
