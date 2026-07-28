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
/* FASE 4: sem eyebrow o titulo e o primeiro elemento e sobe ~21px. O 30 do
   topo foi calibrado com o eyebrow no lugar; sem ele sobra menos ar em cima
   (30) do que embaixo (34). Reequilibra em 34/34 — o bloco ainda encolhe
   17px, so nao fica apertado. Depende de vir DEPOIS da regra base: mesma
   especificidade, quem vence e a ordem. */
.rrui-hnavy--sem-eyebrow{padding-top:34px;}
.rrui-hnavy__top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;}
.rrui-hnavy__eyebrow{font-size:11.5px;font-weight:600;letter-spacing:.18em;color:var(--accent);margin:0 0 7px;}
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
.rrui-kpiband__value{font-family:var(--font-mono),'IBM Plex Mono',ui-monospace,monospace;font-size:var(--kpi-value,30px);font-weight:600;letter-spacing:-.02em;line-height:1;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;}
.rrui-kpiband__delta{margin-top:9px;}
.rrui-kpiband__sub{font-size:12px;margin-top:9px;color:rgba(255,255,255,.55);}
.rrui-kpiband__sub--gold{color:var(--gold);}
.rrui-kpiband__sub--amber{color:var(--gold-soft);}
.rrui-kpiband__sub--ok{color:var(--ok-soft);}
@media (max-width:920px){ .rrui-kpiband{--kpi-cols:2;row-gap:22px;} .rrui-kpiband__stat{padding-left:0;} .rrui-kpiband__stat + .rrui-kpiband__stat::before{display:none;} }
@media (max-width:560px){ .rrui-kpiband{--kpi-cols:1;} }

/* ===== DeltaBadge — variacao vs mes anterior ("^ 12,4% vs junho") =====
   Vive sobre o navy (dentro do KpiBand), por isso usa as variantes -soft dos
   semanticos: os escuros do kit (--ok/--risk) sao ilegiveis em fundo escuro.
   O numero herda a Mono do kit para nao "dancar" quando o valor muda. */
.rrui-delta{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1;white-space:nowrap;}
.rrui-delta__seta{width:12px;height:12px;flex:none;display:block;}
.rrui-delta__valor{font-family:var(--font-mono),'IBM Plex Mono',ui-monospace,monospace;font-weight:600;font-variant-numeric:tabular-nums;}
.rrui-delta__ref{color:rgba(255,255,255,.55);font-weight:400;}
/* rotulo da janela ("1-26", "mes cheio"): discreto — informa sem competir com
   o numero. Ver rotuloJanela() em lib/delta/calcularDelta. */
.rrui-delta__janela{color:rgba(255,255,255,.42);}
.rrui-delta__aviso{margin-left:2px;}
.rrui-delta--up{color:var(--ok-soft);}
.rrui-delta--down{color:var(--risk-soft);}
.rrui-delta--flat{color:rgba(255,255,255,.55);}
.rrui-delta--flat .rrui-delta__valor{font-weight:500;}

/* --- variante SOBRE FUNDO CLARO ---
   O badge acima e calibrado para o navy: os textos secundarios usam
   rgba(255,255,255,a) e o up/down usa as variantes -soft (claras, feitas para
   fundo escuro). Num card branco isso vira texto branco sobre branco.
   Envolva o <DeltaBadge/> num .rrui-delta-claro e SO as cores mudam -- mesmo
   componente, mesma marcacao, sem duplicar nada.
     up/down  -> semaforo SATURADO (--sem-ok/--sem-risk), que e a familia com
                 contraste correto sobre branco (as -soft sao para o navy).
     ref      -> --ink-2 (cinza escuro legivel), janela -> --ink-3. */
.rrui-delta-claro .rrui-delta--up{color:var(--sem-ok);}
.rrui-delta-claro .rrui-delta--down{color:var(--sem-risk);}
.rrui-delta-claro .rrui-delta--flat{color:var(--ink-3);}
.rrui-delta-claro .rrui-delta__ref{color:var(--ink-2);}
.rrui-delta-claro .rrui-delta__janela{color:var(--ink-3);}

/* ===== KpiHero — indicador grande embutido no navy (vertical ou two-column) ===== */
.rrui-kpihero{margin-top:28px;border-top:1px solid rgba(255,255,255,.10);padding-top:24px;}
.rrui-kpihero__row{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;}
.rrui-kpihero__main{min-width:0;}
.rrui-kpihero__label{font-size:12px;font-weight:500;color:rgba(255,255,255,.62);margin:0 0 11px;display:flex;align-items:center;gap:9px;}
.rrui-kpihero__dot{width:10px;height:10px;border-radius:50%;flex:none;}
.rrui-kpihero__dot--ok{background:var(--sem-ok);box-shadow:0 0 0 4px color-mix(in srgb,var(--sem-ok) 18%,transparent);}
.rrui-kpihero__dot--warn{background:var(--sem-warn);box-shadow:0 0 0 4px color-mix(in srgb,var(--sem-warn) 20%,transparent);}
.rrui-kpihero__dot--risk{background:var(--sem-risk);box-shadow:0 0 0 4px color-mix(in srgb,var(--sem-risk) 18%,transparent);}
.rrui-kpihero__value{font-family:var(--font-mono),'IBM Plex Mono',ui-monospace,monospace;font-size:var(--hero-value,42px);font-weight:700;letter-spacing:-.025em;line-height:.95;font-variant-numeric:tabular-nums;}
.rrui-kpihero--white .rrui-kpihero__value{color:#fff;}
.rrui-kpihero--gold .rrui-kpihero__value{color:var(--gold);}
.rrui-kpihero__suffix{font-size:19px;font-weight:600;color:rgba(255,255,255,.65);margin-left:8px;letter-spacing:0;}
.rrui-kpihero__sub{font-size:13px;color:rgba(255,255,255,.6);margin-top:8px;}
.rrui-kpihero__side{flex:none;text-align:right;}
.rrui-kpihero__secondary-value{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums;color:#fff;}
.rrui-kpihero__secondary-value--ok{color:var(--ok-soft);}
.rrui-kpihero__secondary-value--warn{color:var(--gold-soft);}
.rrui-kpihero__secondary-value--risk{color:var(--risk-soft);}
.rrui-kpihero__secondary-label{font-size:12px;color:rgba(255,255,255,.6);margin-top:8px;}
.rrui-kpihero__aside{font-size:12.5px;color:rgba(255,255,255,.55);max-width:260px;line-height:1.5;margin:0;}
.rrui-kpihero__aside b{color:rgba(255,255,255,.78);font-weight:600;}
.rrui-kpihero__meter{margin-top:16px;height:9px;border-radius:6px;background:rgba(255,255,255,.10);overflow:hidden;}
.rrui-kpihero__meter-fill{height:100%;border-radius:6px;}
.rrui-kpihero__meter--ok .rrui-kpihero__meter-fill{background:linear-gradient(90deg,var(--sem-ok),var(--ok-soft));}
.rrui-kpihero__meter--warn .rrui-kpihero__meter-fill{background:linear-gradient(90deg,var(--sem-warn),var(--gold-soft));}
.rrui-kpihero__meter--risk .rrui-kpihero__meter-fill{background:linear-gradient(90deg,var(--sem-risk),var(--risk-soft));}
.rrui-kpihero__meter-cap{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:rgba(255,255,255,.5);margin-top:8px;}

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
