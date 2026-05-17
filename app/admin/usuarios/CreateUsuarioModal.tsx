"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";

interface Props {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}

type Role = "socio" | "funcionario" | "promotor";

type CompanyOption = { id: string; name: string; cnpj: string };
type PromoterOption = { id: string; company_id: string | null; name: string };

function formatCNPJ(cnpj: string): string {
  if (!cnpj) return "";
  // Defesa em profundidade: rejeitar placeholders tipo "TEMP-MCI-COBAN"
  // que coincidentalmente totalizam 14 digitos apos strip de nao-digitos.
  // Se input contem QUALQUER letra, eh placeholder - retorna cru.
  if (/[A-Za-z]/.test(cnpj)) return cnpj;
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return cnpj;
  return digits.replace(
    /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
    "$1.$2.$3/$4-$5"
  );
}

export default function CreateUsuarioModal({ onClose, onCreated }: Props) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("funcionario");
  const [cnpjId, setCnpjId] = useState("");
  const [promoterId, setPromoterId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Disc.7 - selects povoados via /api/companies/list +
  // /api/promoters/list. Lazy load: so dispara quando socio
  // seleciona role=promotor pela primeira vez. Mantido no state
  // depois do primeiro fetch (sem refetch ao alternar role).
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [promoters, setPromoters] = useState<PromoterOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "promotor") return;
    if (companies.length > 0) return; // ja carregado

    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);

    Promise.all([
      fetch("/api/companies/list").then((r) => r.json()),
      fetch("/api/promoters/list").then((r) => r.json()),
    ])
      .then(([cs, ps]) => {
        if (cancelled) return;
        setCompanies((cs?.companies ?? []) as CompanyOption[]);
        setPromoters((ps?.promoters ?? []) as PromoterOption[]);
      })
      .catch(() => {
        if (cancelled) return;
        setOptionsError(
          "Nao foi possivel carregar empresas e promotores. Recarregue a pagina."
        );
      })
      .finally(() => {
        if (cancelled) return;
        setOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [role, companies.length]);

  const filteredPromoters = cnpjId
    ? promoters.filter((p) => p.company_id === cnpjId)
    : [];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const body: Record<string, unknown> = {
      email: email.trim(),
      full_name: fullName.trim() || null,
      role,
    };
    if (role === "promotor") {
      body.cnpj_id = cnpjId.trim();
      body.promoter_id = promoterId.trim();
    }

    try {
      const res = await fetch("/api/admin/usuarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha ao criar usuário");
        return;
      }
      setCreatedPassword(data.password as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPassword() {
    if (!createdPassword) return;
    try {
      await navigator.clipboard.writeText(createdPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignorar — fallback: usuario seleciona e copia manualmente
    }
  }

  function close() {
    if (createdPassword) {
      // Concluir o fluxo de criacao apos exibir a senha
      onCreated();
    } else {
      onClose();
    }
  }

  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <h3 style={styles.title}>
            {createdPassword ? "Senha gerada" : "Criar novo usuário"}
          </h3>
          <button type="button" style={styles.closeBtn} onClick={close} aria-label="Fechar">
            ✕
          </button>
        </header>

        {createdPassword ? (
          <div style={styles.successWrap}>
            <p style={styles.successText}>
              Usuário <strong>{email}</strong> criado. Compartilhe a senha
              abaixo com o usuário — ela <strong>não será exibida novamente</strong>.
            </p>
            <div style={styles.passwordBox}>
              <code style={styles.passwordCode}>{createdPassword}</code>
              <button
                type="button"
                style={styles.copyBtn}
                onClick={copyPassword}
              >
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
            <p style={styles.warning}>
              Esta senha não será exibida novamente. Após fechar, será preciso
              gerar nova senha para recuperar o acesso.
            </p>
            <button type="button" style={styles.primaryBtn} onClick={close}>
              Concluir
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form} noValidate>
            <label style={styles.label}>
              <span style={styles.labelText}>E-mail corporativo</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                disabled={submitting}
                placeholder="usuario@rrcred.srv.br"
              />
            </label>

            <label style={styles.label}>
              <span style={styles.labelText}>Nome completo</span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={styles.input}
                disabled={submitting}
                placeholder="Nome completo do usuário"
              />
            </label>

            <label style={styles.label}>
              <span style={styles.labelText}>Perfil de acesso</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                style={styles.input}
                disabled={submitting}
              >
                <option value="socio">Sócio (acesso completo)</option>
                <option value="funcionario">
                  Funcionário (operacional, sem fluxo caixa/auditoria)
                </option>
                <option value="promotor">
                  Promotor (acesso apenas aos próprios dados)
                </option>
              </select>
            </label>

            {role === "promotor" ? (
              <>
                {optionsLoading ? (
                  <p style={styles.helperLoading}>
                    Carregando empresas e promotores...
                  </p>
                ) : null}
                {optionsError ? (
                  <p style={styles.helperError}>{optionsError}</p>
                ) : null}

                <label style={styles.label}>
                  <span style={styles.labelText}>
                    Empresa — obrigatório p/ promotor
                  </span>
                  <select
                    required
                    value={cnpjId}
                    onChange={(e) => {
                      setCnpjId(e.target.value);
                      setPromoterId("");
                    }}
                    style={styles.input}
                    disabled={submitting || optionsLoading}
                  >
                    <option value="">Selecione uma empresa...</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {formatCNPJ(c.cnpj)}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={styles.label}>
                  <span style={styles.labelText}>
                    Promotor — obrigatório p/ promotor
                  </span>
                  <select
                    required
                    value={promoterId}
                    onChange={(e) => setPromoterId(e.target.value)}
                    style={styles.input}
                    disabled={submitting || optionsLoading || !cnpjId}
                  >
                    <option value="">
                      {!cnpjId
                        ? "Primeiro selecione uma empresa..."
                        : "Selecione um promotor..."}
                    </option>
                    {filteredPromoters.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {cnpjId && filteredPromoters.length === 0 && !optionsLoading ? (
                    <span style={styles.helperWarning}>
                      Nenhum promotor ativo cadastrado para esta empresa.
                    </span>
                  ) : null}
                </label>
              </>
            ) : null}

            {error ? (
              <div role="alert" style={styles.error}>
                {error}
              </div>
            ) : null}

            <div style={styles.actions}>
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={onClose}
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  submitting ||
                  (role === "promotor" &&
                    (!cnpjId || !promoterId || optionsLoading))
                }
                style={styles.primaryBtn}
              >
                {submitting ? "Criando..." : "Criar usuário"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(7, 19, 63, 0.42)",
    backdropFilter: "blur(4px)",
    display: "grid",
    placeItems: "center",
    zIndex: 100,
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    background: "var(--rr-surface-elevated)",
    border: "1px solid var(--rr-line)",
    borderRadius: 20,
    boxShadow: "var(--rr-shadow)",
    padding: "20px 22px 22px",
    display: "grid",
    gap: 14,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 800, color: "var(--rr-ink)" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-muted)",
    fontSize: 14,
    cursor: "pointer",
  },
  form: { display: "grid", gap: 12 },
  label: { display: "grid", gap: 6 },
  labelText: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--rr-ink)",
    letterSpacing: "0.02em",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    fontSize: 14,
    color: "var(--rr-ink)",
    outline: "none",
    fontFamily: "inherit",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 6,
  },
  primaryBtn: {
    padding: "11px 18px",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    background: "#0d4de3",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
    boxShadow: "0 4px 12px rgba(13,77,227,0.18)",
  },
  secondaryBtn: {
    padding: "10px 16px",
    borderRadius: 11,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-ink)",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  error: {
    padding: "10px 12px",
    borderRadius: 10,
    background: "rgba(180,30,30,0.08)",
    border: "1px solid rgba(180,30,30,0.24)",
    color: "#8a1717",
    fontSize: 13,
    fontWeight: 600,
  },
  helperLoading: {
    margin: 0,
    fontSize: 12,
    color: "var(--rr-muted)",
    fontStyle: "italic",
  },
  helperError: {
    margin: 0,
    fontSize: 12,
    color: "#8a1717",
    fontWeight: 600,
  },
  helperWarning: {
    fontSize: 12,
    color: "#8a4a17",
    fontWeight: 600,
  },
  successWrap: { display: "grid", gap: 12 },
  successText: {
    margin: 0,
    fontSize: 13,
    color: "var(--rr-ink)",
    lineHeight: 1.5,
  },
  passwordBox: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 12,
    background: "rgba(255,240,0,0.18)",
    border: "1px solid rgba(214,161,63,0.42)",
  },
  passwordCode: {
    flex: 1,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--rr-ink)",
    userSelect: "all",
  },
  copyBtn: {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-blue-deep)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  warning: {
    margin: 0,
    fontSize: 12,
    color: "#8a4a17",
    fontWeight: 600,
    background: "rgba(214,161,63,0.10)",
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(214,161,63,0.22)",
  },
};
