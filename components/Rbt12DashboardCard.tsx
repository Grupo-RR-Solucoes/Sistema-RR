"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";

// ETAPA 6 — destaque compacto do RBT12 por CNPJ no dashboard (socio),
// linkando p/ a tela /receitas (detalhe + lançamentos manuais).
// Competência FISCAL (recebimento) — o resto do dashboard é por produção.

type Empresa = {
  company_id: string;
  name: string;
  rbt12: number;
  faixa: number | null;
  aliquota: number | null;
  acimaSimples: boolean;
  faltaProxima: number;
  pctFaltaTeto: number;
  sinal: "verde" | "amarelo" | "acima";
  janelaParcial: boolean;
};
type Payload = {
  referencia: { key: string };
  referenciaProducao: { key: string };
  empresas: Empresa[];
  grupo: { rbt12: number; limiteSimples: number; pctLimite: number; faltaLimite: number; sinal: "verde" | "amarelo" | "vermelho" };
};

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function compLabel(key: string) { const [y, m] = key.split("-"); return `${MONTHS_PT[Number(m) - 1]}/${y}`; }
function brl(v: number) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }); }
function sinalColor(s: string) { return s === "acima" ? "#cc2b49" : s === "amarelo" ? "var(--rr-gold)" : "#178a5a"; }

export default function Rbt12DashboardCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch("/api/rbt12")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (!cancel) setData(j); })
      .catch(() => { if (!cancel) setErro(true); });
    return () => { cancel = true; };
  }, []);

  if (erro || !data) return null; // silencioso se indisponível (migration não rodada etc.)

  return (
    <article style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Simples Nacional · Anexo III</div>
          <h3 style={styles.title}>RBT12 por CNPJ — competência fiscal {compLabel(data.referencia.key)}</h3>
          <div style={styles.sub}>Receita recebida (12 meses). Produção de {compLabel(data.referenciaProducao.key)}.</div>
        </div>
        <Link href="/receitas" style={styles.link}>Detalhes e lançamentos →</Link>
      </div>

      <div style={styles.grid}>
        {data.empresas.map((e) => {
          const cor = sinalColor(e.sinal);
          return (
            <Link key={e.company_id} href="/receitas" style={{ ...styles.mini, borderLeft: `4px solid ${cor}` }}>
              <div style={styles.miniName}>{e.name}</div>
              <div style={styles.miniValue}>{brl(e.rbt12)}</div>
              <div style={styles.miniMeta}>
                <span style={{ ...styles.faixa, background: cor }}>{e.acimaSimples ? "ACIMA" : `Faixa ${e.faixa}`}</span>
                <span>{e.aliquota != null ? `${(e.aliquota * 100).toFixed(2)}%` : "—"}</span>
                {e.janelaParcial ? <span style={styles.parcial}>parcial</span> : null}
              </div>
              <div style={styles.miniFalta}>
                {e.acimaSimples ? "—" : `falta ${brl(e.faltaProxima)} p/ faixa ${(e.faixa ?? 0) + 1}`}
              </div>
            </Link>
          );
        })}
        {(() => {
          const g = data.grupo;
          const cor = g.sinal === "vermelho" ? "#cc2b49" : g.sinal === "amarelo" ? "var(--rr-gold)" : "#178a5a";
          return (
            <div
              style={{ ...styles.mini, background: "#f7f9fc", borderLeft: `4px solid ${cor}` }}
              title="Limite de permanência no Simples (R$ 4,8 MM/ano da receita somada do grupo). Estourar exclui o grupo do regime — não é faixa nem base de cálculo do DAS."
            >
              <div style={styles.miniName}>GRUPO · limite Simples</div>
              <div style={styles.miniValue}>{brl(g.rbt12)}</div>
              <div style={styles.miniMeta}>
                <span style={{ ...styles.faixa, background: cor }}>{(g.pctLimite * 100).toFixed(0)}% de R$ 4,8 MM</span>
              </div>
              <div style={styles.miniFalta}>falta {brl(g.faltaLimite)} p/ o teto</div>
            </div>
          );
        })()}
      </div>
    </article>
  );
}

const styles: Record<string, CSSProperties> = {
  card: { background: "var(--rr-panel)", border: "1px solid var(--rr-line)", borderRadius: 14, padding: 18, boxShadow: "var(--rr-shadow-soft)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" },
  kicker: { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--rr-gold)" },
  title: { margin: "2px 0 2px", fontSize: 16, fontWeight: 800, color: "var(--rr-navy)" },
  sub: { fontSize: 12, color: "var(--rr-muted)" },
  link: { fontSize: 13, fontWeight: 700, color: "var(--rr-blue)", textDecoration: "none", whiteSpace: "nowrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 },
  mini: { display: "block", textDecoration: "none", background: "#fff", border: "1px solid var(--rr-line)", borderRadius: 10, padding: "12px 14px", color: "var(--rr-navy)" },
  miniName: { fontSize: 12, fontWeight: 700, color: "var(--rr-muted)" },
  miniValue: { fontSize: 22, fontWeight: 800, color: "var(--rr-navy)", margin: "2px 0 6px" },
  miniMeta: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--rr-muted)" },
  faixa: { color: "#fff", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999 },
  parcial: { color: "var(--rr-gold-deep)", fontWeight: 700 },
  miniFalta: { fontSize: 11, color: "var(--rr-muted)", marginTop: 6 },
};
