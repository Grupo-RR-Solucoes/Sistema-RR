/**
 * RR UI Kit — CSS dos primitivos (Etapa 2). Escopo `.rrui-*`.
 *
 * Convenção: igual às páginas (string CSS injetada via <style dangerouslySetInnerHTML>),
 * porém definida UMA vez aqui e montada por <UiStyles/> (uma vez por página na
 * Etapa 3). Consome SÓ os tokens canônicos do globals.css (var(--navy) etc.) —
 * tokens canônicos. O acento var(--accent) (#FFF000) aparece no stat accent do
 * KpiBand e no total da Table (barra 4px). Cores sobre-navy (branco e cinzas)
 * usam #fff / rgba(255,255,255,α) — não há token de "on-navy" na Etapa 1.
 */
export const UI_CSS = `
/* ===== Card ===== */
.rrui-card{background:var(--paper);border:1px solid var(--bd);border-radius:var(--r-card);box-shadow:var(--sh-2);overflow:hidden;}
.rrui-card__title{font-size:13px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;padding:14px 16px 0;}
.rrui-card__body{padding:16px;}
.rrui-card--navy{background:var(--navy);border-color:var(--navy-bar);color:#fff;}
.rrui-card--navy .rrui-card__title{color:rgba(255,255,255,.66);}
.rrui-card--gold{border-left:4px solid var(--gold);}

/* ===== HeaderNavy — bloco navy do topo (marca + título + badge/ações) ===== */
.rrui-hnavy{background:var(--navy);border-radius:var(--r-lg);padding:30px 34px 34px;color:#fff;position:relative;overflow:hidden;}
.rrui-hnavy::after{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--gold),transparent);opacity:.55;}
.rrui-hnavy--noline::after{display:none;}
.rrui-hnavy__top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;}
.rrui-hnavy__brand{font-size:11.5px;font-weight:600;letter-spacing:.18em;color:var(--accent);margin:0 0 7px;}
.rrui-hnavy__title{font-size:27px;font-weight:600;letter-spacing:-.01em;margin:0;color:#fff;}
.rrui-hnavy__subtitle{font-size:13px;color:rgba(255,255,255,.62);margin:8px 0 0;}
.rrui-hnavy__aside{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}

/* ===== KpiBand — faixa multi-stat embutida no navy ===== */
.rrui-kpiband{margin-top:28px;display:grid;grid-template-columns:repeat(var(--kpi-cols,1),1fr);border-top:1px solid rgba(255,255,255,.10);padding-top:24px;}
.rrui-kpiband__stat{padding:0 26px;position:relative;}
.rrui-kpiband__stat:first-child{padding-left:0;}
.rrui-kpiband__stat + .rrui-kpiband__stat::before{content:"";position:absolute;left:0;top:2px;bottom:2px;width:1px;background:rgba(255,255,255,.10);}
.rrui-kpiband__stat--accent::after{content:"";position:absolute;top:-12px;left:26px;width:28px;height:3px;border-radius:2px;background:var(--accent);}
.rrui-kpiband__stat--accent:first-child::after{left:0;}
.rrui-kpiband__label{font-size:11.5px;font-weight:500;letter-spacing:.01em;color:rgba(255,255,255,.62);margin:0 0 10px;}
.rrui-kpiband__value{font-family:var(--font-mono),'IBM Plex Mono',ui-monospace,monospace;font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1;color:#fff;font-variant-numeric:tabular-nums;}
.rrui-kpiband__sub{font-size:12px;margin-top:9px;color:rgba(255,255,255,.55);}
@media (max-width:920px){ .rrui-kpiband{--kpi-cols:2;row-gap:22px;} .rrui-kpiband__stat{padding-left:0;} .rrui-kpiband__stat + .rrui-kpiband__stat::before{display:none;} }
@media (max-width:560px){ .rrui-kpiband{--kpi-cols:1;} }

/* ===== KpiHero — indicador único grande embutido no navy ===== */
.rrui-kpihero{margin-top:28px;border-top:1px solid rgba(255,255,255,.10);padding-top:24px;}
.rrui-kpihero__label{font-size:12px;font-weight:500;color:rgba(255,255,255,.62);margin:0 0 11px;display:flex;align-items:center;gap:9px;}
.rrui-kpihero__value{font-family:var(--font-mono),'IBM Plex Mono',ui-monospace,monospace;font-size:42px;font-weight:700;letter-spacing:-.025em;line-height:.95;font-variant-numeric:tabular-nums;}
.rrui-kpihero--white .rrui-kpihero__value{color:#fff;}
.rrui-kpihero--gold .rrui-kpihero__value{color:var(--gold);}
.rrui-kpihero__sub{font-size:13px;color:rgba(255,255,255,.6);margin-top:8px;}
.rrui-kpihero__meter{margin-top:16px;height:8px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;}
.rrui-kpihero__meter-fill{height:100%;border-radius:999px;}
.rrui-kpihero__meter--ok .rrui-kpihero__meter-fill{background:var(--ok);}
.rrui-kpihero__meter--warn .rrui-kpihero__meter-fill{background:var(--warn);}
.rrui-kpihero__meter--risk .rrui-kpihero__meter-fill{background:var(--risk);}
.rrui-kpihero__meter-cap{font-size:12px;color:rgba(255,255,255,.6);margin-top:8px;}

/* ===== Button ===== */
.rrui-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 16px;border-radius:var(--r-btn);font-family:inherit;font-size:13px;font-weight:600;line-height:1;cursor:pointer;border:1px solid transparent;transition:background .14s,border-color .14s,color .14s,opacity .14s,filter .14s;white-space:nowrap;}
.rrui-btn:disabled{cursor:not-allowed;opacity:.55;filter:none;}
.rrui-btn--primario{background:var(--navy);color:#fff;}
.rrui-btn--acao{background:var(--blue);color:#fff;}
.rrui-btn--perigo{background:var(--risk);color:#fff;}
.rrui-btn--primario:hover:not(:disabled),.rrui-btn--acao:hover:not(:disabled),.rrui-btn--perigo:hover:not(:disabled){filter:brightness(.93);}
.rrui-btn--secundario{background:var(--paper);color:var(--ink);border-color:var(--bd);}
.rrui-btn--secundario:hover:not(:disabled){background:var(--neu);border-color:var(--bd-soft);}

/* ===== Table (ftable) ===== */
.rrui-table{width:100%;border-collapse:collapse;font-size:13px;color:var(--ink);}
.rrui-table thead th{background:var(--neu);color:var(--ink-2);text-transform:uppercase;font-size:11px;letter-spacing:.04em;font-weight:600;text-align:left;padding:9px 12px;border-bottom:1px solid var(--bd);white-space:nowrap;}
.rrui-table tbody td{padding:8px 12px;border-bottom:1px solid var(--bd-soft);}
.rrui-table tbody tr:nth-child(even){background:var(--neu);}
.rrui-table tbody tr:hover{background:var(--blue-bg);}
.rrui-table .mono,.rrui-table .rrui-table__num{font-family:var(--font-mono),'IBM Plex Mono',ui-monospace,monospace;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.rrui-table tfoot td{padding:10px 12px;font-weight:700;color:var(--ink);border-top:4px solid var(--accent);background:var(--paper);}

/* ===== Chip ===== */
.rrui-chip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:999px;font-size:11.5px;font-weight:600;border:1px solid transparent;white-space:nowrap;}
.rrui-chip__dot{width:7px;height:7px;border-radius:50%;flex:none;}
.rrui-chip--ok{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-bd);}
.rrui-chip--ok .rrui-chip__dot{background:var(--ok);}
.rrui-chip--warn{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-bd);}
.rrui-chip--warn .rrui-chip__dot{background:var(--warn);}
.rrui-chip--risk{background:var(--risk-bg);color:var(--risk);border-color:var(--risk-bd);}
.rrui-chip--risk .rrui-chip__dot{background:var(--risk);}
.rrui-chip--neutral{background:var(--neu);color:var(--ink-2);border-color:var(--bd);}
.rrui-chip--neutral .rrui-chip__dot{background:var(--ink-3);}

/* ===== Banner ===== */
.rrui-banner{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:var(--r-card);border:1px solid var(--bd);background:var(--paper);}
.rrui-banner__icon{flex:none;width:20px;height:20px;margin-top:1px;}
.rrui-banner__body{flex:1;min-width:0;font-size:13px;color:var(--ink);line-height:1.45;}
.rrui-banner__action{flex:none;align-self:center;}
.rrui-banner--info{background:var(--blue-bg);border-color:var(--blue-bd);}
.rrui-banner--info .rrui-banner__icon{color:var(--blue);}
.rrui-banner--ok{background:var(--ok-bg);border-color:var(--ok-bd);}
.rrui-banner--ok .rrui-banner__icon{color:var(--ok);}
.rrui-banner--warn{background:var(--warn-bg);border-color:var(--warn-bd);}
.rrui-banner--warn .rrui-banner__icon{color:var(--warn);}

/* ===== EmptyState ===== */
.rrui-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:40px 24px;}
.rrui-empty__icon{width:40px;height:40px;color:var(--ink-3);}
.rrui-empty__title{font-size:15px;font-weight:600;color:var(--ink);}
.rrui-empty__desc{font-size:13px;color:var(--ink-2);max-width:380px;line-height:1.5;}
.rrui-empty__action{margin-top:6px;}
`;
