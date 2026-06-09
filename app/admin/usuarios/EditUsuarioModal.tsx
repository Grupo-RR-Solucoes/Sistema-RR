"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { UserRole } from "@/lib/auth/types";

import type { UsuarioRow } from "./UsuariosList";
import { IcoPencil, IcoX, IcoSave, IcoUser } from "./icons";
import { roleLabel } from "./usuariosStyles";

interface Props {
  target: UsuarioRow;
  currentUserRole: UserRole;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

type Role = "socio" | "funcionario" | "promotor";
type CompanyOption = { id: string; name: string; cnpj: string };
type PromoterOption = { id: string; company_id: string | null; name: string };

function formatCNPJ(cnpj: string): string {
  if (!cnpj) return "";
  if (/[A-Za-z]/.test(cnpj)) return cnpj;
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return cnpj;
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

export default function EditUsuarioModal({
  target,
  currentUserRole,
  onClose,
  onSaved,
}: Props) {
  // REGRA EXISTENTE: só sócio troca papel (canChangeUserRole). Para
  // funcionário o select de papel fica travado (ele só edita o nome).
  const canChangeRole = currentUserRole === "socio";

  const [fullName, setFullName] = useState(target.full_name ?? "");
  const [role, setRole] = useState<Role>(target.role);
  const [cnpjId, setCnpjId] = useState("");
  const [promoterId, setPromoterId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Só precisamos de empresa/promotor quando MUDAMOS o papel PARA promotor
  // (virar promotor exige cnpj_id + promoter_id no backend).
  const becomingPromotor = role === "promotor" && role !== target.role;

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [promoters, setPromoters] = useState<PromoterOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => {
    if (!becomingPromotor) return;
    if (companies.length > 0) return;
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
  }, [becomingPromotor, companies.length]);

  const filteredPromoters = cnpjId ? promoters.filter((p) => p.company_id === cnpjId) : [];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const body: Record<string, unknown> = { full_name: fullName.trim() || null };
    // Só enviamos `role` se REALMENTE mudou — assim o backend não re-exige
    // cnpj_id/promoter_id de um promotor que permaneceu promotor.
    if (role !== target.role) {
      if (!canChangeRole) {
        setError("Apenas sócios podem alterar o perfil de um usuário.");
        return;
      }
      body.role = role;
      if (role === "promotor") {
        if (!cnpjId || !promoterId) {
          setError("Para tornar promotor, selecione empresa e promotor.");
          return;
        }
        body.cnpj_id = cnpjId;
        body.promoter_id = promoterId;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/usuarios/${target.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha ao salvar alterações");
        return;
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rradmin">
      <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <div className="dialog-head">
            <div className="dt2">
              <span className="di"><IcoPencil /></span>
              <div>
                <h3>Editar usuário</h3>
                <p className="dsub">{target.email}</p>
              </div>
            </div>
            <button className="x" onClick={onClose} aria-label="Fechar"><IcoX /></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="dialog-body">
              <div className="field">
                <label>Nome completo</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome completo do usuário" disabled={submitting} />
              </div>

              <div className="field">
                <label>Perfil de acesso</label>
                <select value={role} onChange={(e) => { setRole(e.target.value as Role); setCnpjId(""); setPromoterId(""); }} disabled={submitting || !canChangeRole}>
                  <option value="socio">Sócio (acesso completo)</option>
                  <option value="funcionario">Funcionário (operacional)</option>
                  <option value="promotor">Promotor (acesso aos próprios dados)</option>
                </select>
                {!canChangeRole ? (
                  <span className="hint">Apenas sócios podem alterar o perfil. Você pode editar o nome.</span>
                ) : role !== target.role ? (
                  <span className="hint">Alterando de <b>{roleLabel(target.role)}</b> para <b>{roleLabel(role)}</b>.</span>
                ) : null}
              </div>

              {becomingPromotor ? (
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
                  </div>
                </div>
              ) : null}

              {error ? <div className="errbox">{error}</div> : null}
            </div>
            <div className="dialog-foot">
              <button type="submit" className="btn-primary" disabled={submitting || (becomingPromotor && (!cnpjId || !promoterId))}>
                {submitting ? <><span className="spinner" />Salvando…</> : <><IcoSave />Salvar alterações</>}
              </button>
              <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
