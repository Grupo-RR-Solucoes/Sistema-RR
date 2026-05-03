import type { CSSProperties } from "react";
import Link from "next/link";

import BrandLogo from "../components/BrandLogo";

const quickAccess = [
  {
    href: "/dashboard",
    title: "Dashboard executivo",
    badge: "Diretoria",
    accent:
      "linear-gradient(135deg, rgba(13,77,227,0.14) 0%, rgba(255,240,0,0.18) 100%)",
    description:
      "Consolida o mes, organiza o previsto x recebido e abre o painel central do grupo.",
  },
  {
    href: "/producao",
    title: "Producao",
    badge: "Operacao",
    accent:
      "linear-gradient(135deg, rgba(255,240,0,0.18) 0%, rgba(214,161,63,0.16) 100%)",
    description:
      "Controla a entrada diaria, status das propostas e consolidacao por empresa e promotor.",
  },
  {
    href: "/fechamento",
    title: "Fechamento",
    badge: "Conferencia",
    accent:
      "linear-gradient(135deg, rgba(13,77,227,0.1) 0%, rgba(214,161,63,0.16) 100%)",
    description:
      "Conecta previsao, PRT, cancelamentos e auditoria do recebido real.",
  },
  {
    href: "/promotores",
    title: "Promotores",
    badge: "Comercial",
    accent:
      "linear-gradient(135deg, rgba(255,240,0,0.22) 0%, rgba(13,77,227,0.1) 100%)",
    description:
      "Resume comissoes, metas, estornos e regras especiais de repasse.",
  },
  {
    href: "/financeiro",
    title: "Financeiro",
    badge: "Fluxo de caixa",
    accent:
      "linear-gradient(135deg, rgba(214,161,63,0.16) 0%, rgba(13,77,227,0.12) 100%)",
    description:
      "Acompanha PRT, despesas, saldo inicial, resultado liquido e fluxo de caixa.",
  },
  {
    href: "/importacoes",
    title: "Importacoes",
    badge: "Dados",
    accent:
      "linear-gradient(135deg, rgba(13,77,227,0.12) 0%, rgba(255,240,0,0.18) 100%)",
    description:
      "Centraliza o envio da planilha diaria, das tabelas mensais e dos fechamentos por CNPJ.",
  },
];

const strategicPillars = [
  "Arquitetura reorganizada em modulos de negocio para diretoria, operacao e auditoria.",
  "Identidade visual alinhada com a marca, usando logo, azul forte, amarelo vivo e dourado como assinatura.",
  "Base preparada para fechar schema, conectar Supabase e seguir para deploy com menos improviso.",
];

const liveSignals = [
  {
    label: "Marca",
    value: "Grupo RR Cred",
  },
  {
    label: "Escopo",
    value: "Comissao, financeiro e auditoria",
  },
  {
    label: "Etapa",
    value: "Fundacao visual e estrutural",
  },
];

export default function Home() {
  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Plataforma Grupo RR Cred</div>
          <h2 style={styles.title}>Sistema com identidade da marca e estrutura profissional</h2>
          <p style={styles.description}>
            A home agora vira uma sala de comando: apresenta a marca, distribui
            os modulos principais e prepara a experiencia para operacao diaria,
            fechamento, auditoria e acompanhamento financeiro com a cara do Grupo RR Cred.
          </p>

          <div style={styles.signalGrid}>
            {liveSignals.map((item) => (
              <div key={item.label} style={styles.signalItem}>
                <span style={styles.signalLabel}>{item.label}</span>
                <strong style={styles.signalValue}>{item.value}</strong>
              </div>
            ))}
          </div>
        </article>

        <article style={styles.heroAside}>
          <BrandLogo size={110} tone="light" />

          <div style={styles.heroAsideList}>
            {strategicPillars.map((item) => (
              <div key={item} style={styles.heroAsideItem}>
                {item}
              </div>
            ))}
          </div>
        </article>
      </div>

      <div style={styles.grid}>
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div style={styles.panelKicker}>Modulos principais</div>
            <h3 style={styles.panelTitle}>Acesso rapido da operacao</h3>
          </div>

          <div style={styles.cardGrid}>
            {quickAccess.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  ...styles.linkCard,
                  background: item.accent,
                }}
              >
                <div style={styles.cardTop}>
                  <span style={styles.badge}>{item.badge}</span>
                  <span style={styles.arrow}>-&gt;</span>
                </div>
                <div style={styles.linkCardTitle}>{item.title}</div>
                <div style={styles.linkCardDescription}>{item.description}</div>
              </Link>
            ))}
          </div>
        </section>

        <section style={styles.sidePanel}>
          <div style={styles.panelHeader}>
            <div style={styles.panelKicker}>Direcao tecnica</div>
            <h3 style={styles.panelTitle}>Prioridades desta fase</h3>
          </div>

          <div style={styles.foundationList}>
            {strategicPillars.map((item) => (
              <div key={item} style={styles.foundationItem}>
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "22px",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
  },
  heroMain: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.94) 0%, rgba(255,253,245,0.96) 100%)",
    borderRadius: "28px",
    padding: "30px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow)",
    position: "relative",
    overflow: "hidden",
  },
  kicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: "var(--rr-blue)",
    fontWeight: 800,
    marginBottom: "12px",
  },
  title: {
    margin: 0,
    fontSize: "clamp(2.3rem, 4vw, 4.2rem)",
    lineHeight: 1,
    color: "var(--rr-ink)",
    maxWidth: 720,
  },
  description: {
    margin: "18px 0 0",
    fontSize: "16px",
    lineHeight: 1.8,
    color: "var(--rr-muted)",
    maxWidth: 760,
  },
  signalGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    marginTop: "24px",
  },
  signalItem: {
    display: "grid",
    gap: "8px",
    padding: "16px 18px",
    borderRadius: "18px",
    background: "rgba(13,77,227,0.06)",
    border: "1px solid rgba(13,77,227,0.1)",
  },
  signalLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  signalValue: {
    fontSize: "16px",
    lineHeight: 1.45,
    color: "var(--rr-ink)",
  },
  heroAside: {
    borderRadius: "28px",
    padding: "26px",
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.95) 0%, rgba(7,37,125,0.98) 100%)",
    boxShadow: "var(--rr-shadow)",
    border: "1px solid rgba(255,255,255,0.12)",
    display: "grid",
    gap: "18px",
    alignContent: "start",
  },
  heroAsideList: {
    display: "grid",
    gap: "12px",
  },
  heroAsideItem: {
    padding: "14px 16px",
    borderRadius: "18px",
    background: "rgba(255,240,0,0.12)",
    border: "1px solid rgba(255,240,0,0.2)",
    color: "rgba(255,255,255,0.94)",
    fontSize: "14px",
    lineHeight: 1.65,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
  },
  panel: {
    background: "rgba(255,255,255,0.9)",
    borderRadius: "26px",
    padding: "24px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  sidePanel: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(255,253,245,0.96) 100%)",
    borderRadius: "26px",
    padding: "24px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  panelHeader: {
    marginBottom: "18px",
  },
  panelKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
    marginBottom: "8px",
  },
  panelTitle: {
    margin: 0,
    fontSize: "28px",
    color: "var(--rr-ink)",
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "14px",
  },
  linkCard: {
    display: "grid",
    gap: "12px",
    padding: "20px",
    borderRadius: "22px",
    textDecoration: "none",
    border: "1px solid rgba(13,77,227,0.12)",
    color: "var(--rr-ink)",
    boxShadow: "0 18px 30px rgba(11, 22, 51, 0.06)",
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.76)",
    color: "var(--rr-blue-deep)",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 800,
  },
  arrow: {
    fontSize: "20px",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  linkCardTitle: {
    fontSize: "21px",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
  },
  linkCardDescription: {
    fontSize: "14px",
    lineHeight: 1.65,
    color: "rgba(11,22,51,0.76)",
  },
  foundationList: {
    display: "grid",
    gap: "12px",
  },
  foundationItem: {
    borderRadius: "18px",
    border: "1px solid rgba(13,77,227,0.12)",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.1) 0%, rgba(255,255,255,0.9) 100%)",
    padding: "16px",
    fontSize: "14px",
    lineHeight: 1.7,
    color: "var(--rr-muted)",
  },
};
