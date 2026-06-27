"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { allowedTargetRoles } from "@/lib/auth/permissions";
import type { UserRole } from "@/lib/auth/types";
import { isValidCPF, maskCPF, onlyDigits } from "@/lib/validators/cpf";

import { IcoUserCog, IcoX, IcoCheck, IcoInfo, IcoUser } from "./icons";

interface Props {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  currentUserRole: UserRole;
}

type Role = "socio" | "funcionario" | "promotor";

type CompanyOption = { id: string; name: string; cnpj: string };
type PromoterOption = { id: string; company_id: string | null; name: string };

function formatCNPJ(cnpj: string): string {
  if (!cnpj) return "";
  // Defesa em profundidade: rejeitar placeholders tipo "TEMP-MCI-COBAN"
  // que coincidentalmente totalizam 14 digitos apos strip de nao-digitos.
  if (/[A-Za-z]/.test(cnpj)) return cnpj;
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return cnpj;
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

export default function CreateUsuarioModal({ onClose, onCreated, currentUserRole }: Props) {
  // Disc.14: roles que o actor pode atribuir.
  // socio -> [socio, funcionario, promotor]; funcionario -> [promotor].
  const targetRoles = useMemo(() => allowedTargetRoles(currentUserRole), [currentUserRole]);
  const roleLocked = targetRoles.length === 1;
  const defaultRole: Role = roleLocked ? targetRoles[0] : "funcionario";

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>(defaultRole);
  const [cpf, setCpf] = useState(""); // só dígitos
  const [cnpjId, setCnpjId] = useState("");
  const [promoterId, setPromoterId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);

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
        if (!cancelled) setOptionsError("Não foi possível carregar empresas e promotores. Recarregue a página.");
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role, companies.length]);

  const filteredPromoters = cnpjId ? promoters.filter((p) => p.company_id === cnpjId) : [];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!targetRoles.includes(role)) {
      setError("Você não tem permissão para criar usuário com esse perfil.");
      return;
    }
    // CPF obrigatório/validado para funcionário e promotor (login por CPF).
    // Sócio loga por e-mail → não valida nem envia CPF.
    const cpfDigits = onlyDigits(cpf);
    if (role === "funcionario" || role === "promotor") {
      if (!isValidCPF(cpfDigits)) {
        setError("CPF inválido");
        return;
      }
    }
    setSubmitting(true);
    const body: Record<string, unknown> = {
      email: email.trim(),
      full_name: fullName.trim() || null,
      role,
    };
    if (role === "funcionario" || role === "promotor") {
      body.cpf = cpfDigits;
    }
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
      setInvited(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    if (invited) onCreated();
    else onClose();
  }

  return (
    <div className="rradmin">
      <div className="overlay" role="dialog" aria-modal="true" onClick={close}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          {invited ? (
            <>
              <div className="dialog-head">
                <div className="dt2">
                  <span className="di green"><IcoCheck /></span>
                  <div>
                    <h3>Convite enviado</h3>
                    <p className="dsub">{email}</p>
                  </div>
                </div>
                <button className="x" onClick={close} aria-label="Fechar"><IcoX /></button>
              </div>
              <div className="dialog-body">
                <p className="pwlead">
                  Convite enviado para <b>{email}</b>. O usuário vai receber um link por
                  e-mail para definir a senha e acessar o sistema.
                </p>
              </div>
              <div className="dialog-foot">
                <button type="button" className="btn-primary" onClick={close}><IcoCheck />Concluir</button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="dialog-head">
                <div className="dt2">
                  <span className="di"><IcoUserCog /></span>
                  <div>
                    <h3>Novo usuário</h3>
                    <p className="dsub">Cria a conta e gera a senha provisória</p>
                  </div>
                </div>
                <button type="button" className="x" onClick={onClose} aria-label="Fechar"><IcoX /></button>
              </div>
              <div className="dialog-body">
                <div className="field">
                  <label>E-mail corporativo <span className="req">*</span></label>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} placeholder="usuario@rrcred.srv.br" />
                </div>
                <div className="field">
                  <label>Nome completo</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={submitting} placeholder="Nome completo do usuário" />
                </div>
                <div className={`field${roleLocked ? " locked" : ""}`}>
                  <label>Perfil de acesso <span className="req">*</span></label>
                  <select value={role} onChange={(e) => { const r = e.target.value as Role; setRole(r); if (r === "socio") setCpf(""); }} disabled={submitting || roleLocked}>
                    {targetRoles.includes("socio") ? <option value="socio">Sócio (acesso completo)</option> : null}
                    {targetRoles.includes("funcionario") ? <option value="funcionario">Funcionário (operacional)</option> : null}
                    {targetRoles.includes("promotor") ? <option value="promotor">Promotor (acesso aos próprios dados)</option> : null}
                  </select>
                  {roleLocked ? <span className="hint">Como funcionário, você só cadastra promotores.</span> : null}
                </div>

                {role === "funcionario" || role === "promotor" ? (
                  <div className="field">
                    <label>CPF <span className="req">*</span></label>
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      value={cpf ? maskCPF(cpf) : ""}
                      onChange={(e) => setCpf(onlyDigits(e.target.value).slice(0, 11))}
                      disabled={submitting}
                      placeholder="000.000.000-00"
                    />
                    <span className="hint">Apenas números. Usado para login deste perfil.</span>
                  </div>
                ) : null}

                {role === "promotor" ? (
                  <div className="condbox">
                    <span className="ctag"><IcoUser />Vínculo do promotor</span>
                    {optionsError ? <div className="errbox">{optionsError}</div> : null}
                    <div className="field">
                      <label>Empresa <span className="req">*</span></label>
                      <select required value={cnpjId} onChange={(e) => { setCnpjId(e.target.value); setPromoterId(""); }} disabled={submitting || optionsLoading}>
                        <option value="">{optionsLoading ? "Carregando…" : "Selecione uma empresa…"}</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>{c.name} — {formatCNPJ(c.cnpj)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Promotor <span className="req">*</span></label>
                      <select required value={promoterId} onChange={(e) => setPromoterId(e.target.value)} disabled={submitting || optionsLoading || !cnpjId}>
                        <option value="">{!cnpjId ? "Primeiro selecione uma empresa…" : "Selecione um promotor…"}</option>
                        {filteredPromoters.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {cnpjId && filteredPromoters.length === 0 && !optionsLoading ? (
                        <span className="hint">Nenhum promotor ativo cadastrado para esta empresa.</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {currentUserRole === "socio" ? (
                  <div className="infobanner"><IcoInfo />Funcionário só cadastra promotores — para ele o perfil fica travado em Promotor.</div>
                ) : null}

                {error ? <div className="errbox">{error}</div> : null}
              </div>
              <div className="dialog-foot">
                <button type="submit" disabled={submitting || (role === "promotor" && (!cnpjId || !promoterId || optionsLoading))} className="btn-primary">
                  {submitting ? <><span className="spinner" />Criando…</> : <><IcoUserCog />Criar usuário</>}
                </button>
                <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
