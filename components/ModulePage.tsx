import type { CSSProperties } from "react";
import Link from "next/link";

import BrandLogo from "./BrandLogo";

type Highlight = {
  label: string;
  value: string;
  description: string;
};

type Section = {
  title: string;
  description: string;
  items: string[];
};

type QuickLink = {
  href: string;
  title: string;
  description: string;
};

type ModulePageProps = {
  kicker: string;
  title: string;
  description: string;
  status: string;
  highlights: Highlight[];
  sections: Section[];
  quickLinks?: QuickLink[];
};

export default function ModulePage({
  kicker,
  title,
  description,
  status,
  highlights,
  sections,
  quickLinks = [],
}: ModulePageProps) {
  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>{kicker}</div>
          <h2 style={styles.title}>{title}</h2>
          <p style={styles.description}>{description}</p>
        </article>

        <article style={styles.statusCard}>
          <BrandLogo compact size={52} tone="light" />

          <div style={styles.statusMeta}>
            <div style={styles.statusLabel}>Estado do modulo</div>
            <div style={styles.statusValue}>{status}</div>
            <div style={styles.statusText}>
              Esta pagina organiza o fluxo funcional e deixa o modulo com a
              linguagem visual da marca.
            </div>
          </div>
        </article>
      </div>

      <div style={styles.highlightGrid}>
        {highlights.map((item) => (
          <article key={`${item.label}-${item.value}`} style={styles.highlightCard}>
            <div style={styles.highlightLabel}>{item.label}</div>
            <div style={styles.highlightValue}>{item.value}</div>
            <div style={styles.highlightDescription}>{item.description}</div>
          </article>
        ))}
      </div>

      <div style={styles.contentGrid}>
        <div style={styles.sectionsColumn}>
          {sections.map((section) => (
            <article key={section.title} style={styles.sectionCard}>
              <div style={styles.sectionTopLine} />
              <h3 style={styles.sectionTitle}>{section.title}</h3>
              <p style={styles.sectionDescription}>{section.description}</p>
              <div style={styles.itemList}>
                {section.items.map((item) => (
                  <div key={item} style={styles.itemCard}>
                    {item}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        <aside style={styles.sideColumn}>
          <article style={styles.sideCard}>
            <div style={styles.sideKicker}>Acoes rapidas</div>
            <h3 style={styles.sideTitle}>Atalhos do modulo</h3>

            {quickLinks.length === 0 ? (
              <div style={styles.sideEmpty}>
                Os atalhos especificos entram aqui conforme a funcionalidade vai
                ficando pronta.
              </div>
            ) : (
              <div style={styles.quickLinkList}>
                {quickLinks.map((link) => (
                  <Link key={link.href} href={link.href} style={styles.quickLink}>
                    <div style={styles.quickLinkTop}>
                      <span style={styles.quickLinkPill}>Abrir</span>
                      <span style={styles.quickLinkArrow}>-&gt;</span>
                    </div>
                    <div style={styles.quickLinkTitle}>{link.title}</div>
                    <div style={styles.quickLinkDescription}>{link.description}</div>
                  </Link>
                ))}
              </div>
            )}
          </article>
        </aside>
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "16px",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.5fr) minmax(260px, 0.75fr)",
    gap: "14px",
  },
  heroMain: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,253,245,0.98) 100%)",
    border: "1px solid var(--rr-line)",
    borderRadius: "28px",
    padding: "24px",
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
    fontSize: "clamp(1.7rem, 2.8vw, 2.8rem)",
    lineHeight: 1.04,
    color: "var(--rr-ink)",
  },
  description: {
    margin: "12px 0 0",
    fontSize: "14px",
    lineHeight: 1.65,
    color: "var(--rr-muted)",
    maxWidth: 760,
  },
  statusCard: {
    borderRadius: "28px",
    padding: "20px",
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    boxShadow: "var(--rr-shadow)",
    border: "1px solid rgba(255,255,255,0.14)",
    display: "grid",
    gap: "18px",
  },
  statusMeta: {
    display: "grid",
    gap: "8px",
  },
  statusLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "rgba(255,255,255,0.72)",
  },
  statusValue: {
    fontSize: "22px",
    fontWeight: 800,
    color: "var(--rr-yellow)",
    fontFamily: "var(--font-heading)",
  },
  statusText: {
    fontSize: "13px",
    lineHeight: 1.55,
    color: "rgba(255,255,255,0.9)",
  },
  highlightGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "12px",
  },
  highlightCard: {
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,249,176,0.52) 100%)",
    border: "1px solid var(--rr-line)",
    borderRadius: "20px",
    padding: "16px",
    boxShadow: "var(--rr-shadow-soft)",
  },
  highlightLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "10px",
    fontWeight: 800,
  },
  highlightValue: {
    fontSize: "21px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    marginBottom: "6px",
    fontFamily: "var(--font-heading)",
  },
  highlightDescription: {
    fontSize: "13px",
    lineHeight: 1.55,
    color: "var(--rr-muted)",
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.55fr) minmax(280px, 0.8fr)",
    gap: "14px",
    alignItems: "start",
  },
  sectionsColumn: {
    display: "grid",
    gap: "14px",
  },
  sectionCard: {
    position: "relative",
    background: "rgba(255,255,255,0.92)",
    border: "1px solid var(--rr-line)",
    borderRadius: "26px",
    padding: "20px",
    boxShadow: "var(--rr-shadow-soft)",
  },
  sectionTopLine: {
    width: 78,
    height: 6,
    borderRadius: 999,
    background:
      "linear-gradient(90deg, var(--rr-yellow) 0%, var(--rr-gold) 48%, var(--rr-blue) 100%)",
    marginBottom: "12px",
  },
  sectionTitle: {
    margin: 0,
    fontSize: "21px",
    color: "var(--rr-ink)",
  },
  sectionDescription: {
    margin: "8px 0 12px",
    fontSize: "14px",
    lineHeight: 1.6,
    color: "var(--rr-muted)",
  },
  itemList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "10px",
  },
  itemCard: {
    borderRadius: "18px",
    border: "1px solid rgba(13,77,227,0.1)",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.05) 0%, rgba(255,255,255,0.92) 100%)",
    padding: "14px",
    fontSize: "13px",
    lineHeight: 1.55,
    color: "var(--rr-ink)",
  },
  sideColumn: {
    display: "grid",
  },
  sideCard: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.93) 0%, rgba(255,253,245,0.98) 100%)",
    border: "1px solid var(--rr-line)",
    borderRadius: "26px",
    padding: "20px",
    boxShadow: "var(--rr-shadow-soft)",
    position: "sticky",
    top: "88px",
  },
  sideKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
    marginBottom: "8px",
  },
  sideTitle: {
    margin: 0,
    fontSize: "20px",
    color: "var(--rr-ink)",
  },
  sideEmpty: {
    marginTop: "12px",
    borderRadius: "18px",
    background: "rgba(13,77,227,0.05)",
    border: "1px solid rgba(13,77,227,0.1)",
    padding: "14px",
    fontSize: "13px",
    lineHeight: 1.55,
    color: "var(--rr-muted)",
  },
  quickLinkList: {
    display: "grid",
    gap: "10px",
    marginTop: "12px",
  },
  quickLink: {
    display: "grid",
    gap: "6px",
    padding: "14px",
    borderRadius: "18px",
    textDecoration: "none",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.16) 0%, rgba(13,77,227,0.06) 100%)",
    border: "1px solid rgba(13,77,227,0.12)",
    color: "var(--rr-ink)",
    boxShadow: "0 14px 28px rgba(11, 22, 51, 0.06)",
  },
  quickLinkTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quickLinkPill: {
    padding: "6px 10px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.82)",
    color: "var(--rr-blue-deep)",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 800,
  },
  quickLinkArrow: {
    fontSize: "18px",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  quickLinkTitle: {
    fontSize: "15px",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
  },
  quickLinkDescription: {
    fontSize: "13px",
    lineHeight: 1.5,
    color: "var(--rr-muted)",
  },
};
