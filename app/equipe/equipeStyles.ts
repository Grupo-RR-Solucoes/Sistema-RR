// CSS scoped da tela /equipe (identidade .rrteam), irmã de .rrproj/.rradmin.
// Reusa os mesmos tokens do design system; nada de design novo.
export const RRTEAM_CSS = `
.rrteam{
  --navy:#0F1F4A; --navy-bar:#1E3066;
  --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --green:#16A34A; --amber:#F59E0B; --red:#DC2626;
  --green-tx:#15803D; --amber-tx:#B45309; --red-tx:#B91C1C;
  --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrteam *{box-sizing:border-box;}
.rrteam .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrteam .wrap{max-width:1180px;margin:0 auto;padding:30px 28px 60px;display:flex;flex-direction:column;gap:20px;}

.rrteam .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:-4px 2px -2px;}
.rrteam .crumb .sep{color:#C2C8D2;}
.rrteam .crumb .cur{color:var(--ink);font-weight:600;}

.rrteam .selectors{display:flex;gap:9px;flex-wrap:wrap;}
.rrteam .pill{position:relative;}
.rrteam .pill select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 34px 8px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrteam .pill select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrteam .pill select option{color:#16203A;}
.rrteam .pill .chev{position:absolute;right:13px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9DA9C6;font-size:10px;}
.rrteam .pill .plabel{position:absolute;top:-7px;left:13px;font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#7C88A8;background:var(--navy);padding:0 5px;}

.rrteam .role{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#E4E9F4;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:600;}
.rrteam .role .d{width:7px;height:7px;border-radius:50%;background:var(--gold);}

.rrteam .kpiwrap-navy{background:var(--navy);border-radius:var(--r-lg);padding:24px 28px 26px;position:relative;overflow:hidden;}
.rrteam .kpiwrap-navy .rrui-kpiband{margin-top:0;border-top:none;padding-top:0;}

.rrteam .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden;}
.rrteam .tcard-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 24px;border-bottom:1px solid var(--bd-soft);flex-wrap:wrap;}
.rrteam .tcard-head h2{font-size:14.5px;font-weight:600;margin:0;color:var(--ink);}
.rrteam .tcard-head .csub{font-size:11.5px;color:var(--ink-3);margin-top:2px;}

.rrteam .rrui-table thead th.r{text-align:right;}
.rrteam .rrui-table thead th.c{text-align:center;}
.rrteam .rrui-table tbody td{vertical-align:middle;font-variant-numeric:tabular-nums;white-space:nowrap;}
.rrteam .pname{font-weight:600;color:var(--ink);min-width:150px;}
.rrteam td.r{text-align:right;}
.rrteam td.c{text-align:center;}
.rrteam td.pctcell{font-weight:600;color:var(--ink);text-align:right;}
.rrteam .emptyrow{padding:40px 18px;text-align:center;color:var(--ink-3);font-size:13px;}

.rrteam .chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:4px 11px;border-radius:999px;border:1px solid;white-space:nowrap;}
.rrteam .chip .d{width:6px;height:6px;border-radius:50%;}
.rrteam .chip.g{background:rgba(22,163,74,.10);border-color:rgba(22,163,74,.28);color:var(--green-tx);}
.rrteam .chip.g .d{background:var(--green);}
.rrteam .chip.a{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.30);color:var(--amber-tx);}
.rrteam .chip.a .d{background:var(--amber);}
.rrteam .chip.r{background:rgba(220,38,38,.09);border-color:rgba(220,38,38,.26);color:var(--red-tx);}
.rrteam .chip.r .d{background:var(--red);}
.rrteam .chip.n{background:#F1F3F7;border-color:var(--bd);color:var(--ink-3);}
.rrteam .chip.n .d{background:#9CA3AF;}

.rrteam .loading-row{display:flex;align-items:center;gap:12px;color:var(--ink-2);font-size:13.5px;font-weight:500;padding:26px 28px;}
.rrteam .spinner{width:22px;height:22px;border-radius:50%;border:2.5px solid #E4E7EC;border-top-color:var(--navy);animation:rrteam-spin .8s linear infinite;flex:none;}
@keyframes rrteam-spin{to{transform:rotate(360deg);}}

@media (max-width:640px){ .rrteam .wrap{padding:20px 16px 44px;} }

/* TELEFONE — solta o texto das celulas. Isto NAO e redundante com o kit:

     kit     .rr-table-cards .rrui-table tbody td   -> 2 classes + 2 elementos
     aqui    .rrteam .rrui-table tbody td           -> 2 classes + 2 elementos

   Empatam em especificidade, e esta folha e injetada DEPOIS do <UiStyles/>
   (EquipeVisao.tsx:401-402), entao o white-space:nowrap da linha 44 VENCERIA o
   white-space:normal do modo cartao e as celulas nao quebrariam linha. Anular
   aqui, mais abaixo no mesmo arquivo, e o unico jeito sem !important.

   O min-width:150px do .pname (linha 45) impedia o cartao de estreitar. */
@media (max-width:560px){
  .rrteam .rrui-table tbody td{white-space:normal;}
  .rrteam .pname{min-width:0;}
}

@media (max-width:430px){ .rrteam .wrap{padding:16px 12px 36px;} }
`;
