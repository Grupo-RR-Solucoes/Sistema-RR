"use client";

import { useEffect, useMemo, useState } from "react";

import { UiStyles, HeaderNavy, KpiBand, Table } from "@/components/ui";
import type { UserRole } from "@/lib/auth/types";
import type {
  TeamProductionPayload,
  TeamPromoterRow,
  TargetStatus,
} from "@/lib/equipe/teamProduction";

import { RRTEAM_CSS } from "./equipeStyles";

interface Props {
  role: UserRole;
  email: string;
  fullName: string | null;
}

const brl = (n: number) =>
  "R$ " +
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const pct = (n: number | null) =>
  n === null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

// mês corrente em Fortaleza é o default do backend; aqui só rotulamos.
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const STATUS_CHIP: Record<TargetStatus, "g" | "a" | "r" | "n"> = {
  META_2: "g",
  META_1: "g",
  META: "g",
  ABAIXO: "r",
  SEM_META: "n",
};
const STATUS_LABEL: Record<TargetStatus, string> = {
  META_2: "Meta 2",
  META_1: "Meta 1",
  META: "Bateu a meta",
  ABAIXO: "Abaixo",
  SEM_META: "Sem meta",
};

const ROLE_LABEL: Record<string, string> = {
  supervisor: "Supervisor",
  gerente_regional: "Gerente Regional",
};

export default function EquipeVisao({ role, email, fullName }: Props) {
  const [data, setData] = useState<TeamProductionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<{ year: number; month: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const params = new URLSearchParams();
        if (sel) {
          params.set("year", String(sel.year));
          params.set("month", String(sel.month));
        }
        const qs = params.toString();
        const res = await fetch(`/api/equipe${qs ? `?${qs}` : ""}`, { cache: "no-store" });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || "Erro ao carregar a equipe.");
        if (!cancelled) setData(payload as TeamProductionPayload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar a equipe.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sel]);

  const period = data?.period;
  const totals = data?.totals;
  const rows: TeamPromoterRow[] = data?.rows ?? [];

  // opções de competência: as do backend + garantia da selecionada/atual.
  const periodOptions = useMemo(() => {
    const list = data?.periods ? [...data.periods] : [];
    if (period && !list.some((p) => p.year === period.year && p.month === period.month)) {
      list.unshift(period);
    }
    return list;
  }, [data?.periods, period]);

  const isGerente = role === "gerente_regional";

  return (
    <div className="rrteam">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: RRTEAM_CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <span>Gestão</span>
          <span className="sep">/</span>
          <span className="cur">Minha Equipe</span>
        </nav>

        <HeaderNavy
          brand="GRUPO RR CRED"
          title="Minha Equipe"
          subtitle={
            isGerente
              ? "Produção e desempenho dos seus supervisores e promotores"
              : "Produção e desempenho dos seus promotores"
          }
          actions={
            <div className="selectors">
              <div className="pill">
                <span className="plabel">Competência</span>
                <select
                  aria-label="Competência"
                  value={period ? `${period.year}-${period.month}` : ""}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    setSel({ year: y, month: m });
                  }}
                >
                  {periodOptions.map((p) => (
                    <option key={p.key} value={`${p.year}-${p.month}`}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>
              <span className="role">
                <span className="d" />
                {fullName ?? email} · {ROLE_LABEL[role] ?? role}
              </span>
            </div>
          }
        >
          <KpiBand
            valueSize={24}
            items={[
              {
                label: "Produção do time",
                value: brl(totals?.production_value ?? 0),
                sub: `${totals?.promoters ?? 0} promotor${(totals?.promoters ?? 0) === 1 ? "" : "es"} · ${totals?.proposal_count ?? 0} propostas`,
                accent: true,
              },
              {
                label: "Meta do time",
                value: brl(totals?.meta ?? 0),
                sub: totals?.attainment_percent != null ? `${pct(totals.attainment_percent)} atingido` : "sem meta",
              },
              {
                label: "Produção de seguro",
                value: brl(totals?.insurance_production ?? 0),
                sub: "prêmio no período",
              },
              {
                label: "Penetração de seguro",
                value: pct(totals?.insurance_penetration_percent ?? 0),
                sub: "% do bruto com seguro",
              },
            ]}
          />
        </HeaderNavy>

        {error ? (
          <div className="card" style={{ padding: "16px 20px", color: "var(--red-tx)" }}>
            {error}
          </div>
        ) : null}

        <div className="card">
          <div className="tcard-head">
            <div>
              <h2>Metas vs realizado por promotor</h2>
              <p className="csub">
                Realizado = produção líquida no período (status produção, sem SRCC){period ? ` · ${MONTHS[period.month - 1]}/${String(period.year).slice(-2)}` : ""}
              </p>
            </div>
          </div>
          <Table scrollable minWidth={860}>
            <thead>
              <tr>
                <th className="rr-sticky-col">Promotor</th>
                <th className="r">Produção</th>
                <th className="r">Propostas</th>
                <th className="r">Seguro</th>
                <th className="r">Penetração seg.</th>
                <th className="r">Meta</th>
                <th className="r">% atingido</th>
                <th className="c">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="emptyrow">
                    <span className="loading-row" style={{ justifyContent: "center", padding: 0 }}>
                      <span className="spinner" />Carregando equipe…
                    </span>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="emptyrow">
                    Nenhuma produção do seu time nesta competência.
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.promoter_id}>
                    <td className="rr-sticky-col pname">{p.promoter_name}</td>
                    <td className="r">{brl(p.production_value)}</td>
                    <td className="r">{p.proposal_count}</td>
                    <td className="r">{brl(p.insurance_production)}</td>
                    <td className="r">{pct(p.insurance_penetration_percent)}</td>
                    <td className="r">{p.meta > 0 ? brl(p.meta) : "—"}</td>
                    <td className="pctcell">{pct(p.attainment_percent)}</td>
                    <td className="c">
                      <span className={`chip ${STATUS_CHIP[p.target_status]}`}>
                        <span className="d" />
                        {STATUS_LABEL[p.target_status]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </main>
    </div>
  );
}
