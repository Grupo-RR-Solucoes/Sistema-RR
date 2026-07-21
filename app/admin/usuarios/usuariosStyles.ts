// Redesign (.rradmin): CSS scoped da tela /admin/usuarios, irma de
// .rrcad/.rrprom/.rredit. Injetado uma vez por UsuariosList; os modais
// usam className="rradmin" na raiz do overlay para herdar o escopo/tokens.
import type { UserRole } from "@/lib/auth/types";

export const RRADMIN_CSS = `
.rradmin{
  --navy:#0F1F4A; --navy-bar:#1E3066;
  --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A;
  --blue:#0d4de3; --blue-bg:#EAF0FB; --blue-bd:#D5E0F4;
  --green:#16A34A; --green-tx:#15803D; --green-bg:#E9F5EE; --green-bd:#BFE3CD;
  --amber:#F59E0B; --amber-tx:#B45309; --amber-bg:#FBF1DC; --amber-bd:#EAD7A6;
  --red:#DC2626; --red-tx:#B91C1C; --red-bg:#FBECEB; --red-bd:#F1CDCB;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --neu:#F1F3F7;
  --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  color:var(--ink);font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;
}
.rradmin *{box-sizing:border-box;}
.rradmin .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rradmin .mono{font-family:'IBM Plex Mono','SFMono-Regular',ui-monospace,monospace;}
.rradmin .wrap{display:flex;flex-direction:column;gap:20px;}

.rradmin .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:0 2px -2px;flex-wrap:wrap;}
.rradmin .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rradmin .crumb a:hover{color:var(--navy);}
.rradmin .crumb .sep{color:#C2C8D2;}
.rradmin .crumb .cur{color:var(--ink);font-weight:600;}

.rradmin .role{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#E4E9F4;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:600;}
.rradmin .role .d{width:7px;height:7px;border-radius:50%;}
.rradmin .role .d.socio{background:var(--blue);}
.rradmin .role .d.func{background:var(--gold);}
.rradmin .role .d.prom{background:var(--green);}
.rradmin .role .d.sup{background:#1E3066;}
.rradmin .role .d.ger{background:#7C3AED;}

.rradmin .rules{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 4px;margin:-2px 0;}
.rradmin .rules .rlab{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);}
.rradmin .rchip{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:500;color:var(--ink-2);background:#fff;border:1px solid var(--bd);padding:7px 13px;border-radius:999px;white-space:nowrap;}
.rradmin .rchip svg{color:var(--gold-deep);flex:none;}
.rradmin .rchip b{color:var(--ink);font-weight:600;}

.rradmin .actionbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--card);border:1px solid var(--bd);border-radius:var(--r-md);padding:12px 14px;box-shadow:var(--shadow);}
.rradmin .search{position:relative;flex:1;min-width:190px;max-width:300px;}
.rradmin .search svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--ink-3);pointer-events:none;}
.rradmin .search input{width:100%;border:1px solid var(--bd);border-radius:10px;padding:9px 12px 9px 36px;font-family:inherit;font-size:13px;color:var(--ink);background:#F8F9FC;transition:border-color .14s,background .14s;}
.rradmin .search input::placeholder{color:var(--ink-3);}
.rradmin .search input:focus{outline:none;border-color:var(--navy);background:#fff;box-shadow:0 0 0 3px rgba(15,31,74,.07);}
.rradmin .seg{display:inline-flex;background:#F1F3F7;border:1px solid var(--bd);border-radius:10px;padding:3px;gap:2px;}
.rradmin .seg button{appearance:none;border:none;background:none;font-family:inherit;font-size:12px;font-weight:600;color:var(--ink-3);padding:7px 13px;border-radius:7px;cursor:pointer;transition:background .14s,color .14s,box-shadow .14s;white-space:nowrap;display:inline-flex;align-items:center;}
.rradmin .seg button:hover{color:var(--ink-2);}
.rradmin .seg button.on{background:#fff;color:var(--navy);box-shadow:0 1px 2px rgba(15,31,74,.08);}
.rradmin .seg button .cnt{font-weight:700;color:var(--ink-3);margin-left:5px;}
.rradmin .seg button.on .cnt{color:var(--blue);}
.rradmin .seg .dt{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;}
.rradmin .newbtn{margin-left:auto;display:inline-flex;align-items:center;gap:8px;background:var(--navy);color:#fff;border:none;border-radius:10px;padding:10px 17px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .14s,transform .12s;white-space:nowrap;}
.rradmin .newbtn:hover{background:#16285C;transform:translateY(-1px);}
.rradmin .newbtn .ic{color:var(--yellow);display:grid;place-items:center;}

.rradmin .errbar{display:flex;align-items:flex-start;gap:11px;background:var(--red-bg);border:1px solid var(--red-bd);border-radius:var(--r-md);padding:12px 14px;font-size:12.5px;color:var(--red-tx);}
.rradmin .errbar .bic{flex:none;width:24px;height:24px;border-radius:7px;background:rgba(220,38,38,.12);color:var(--red);display:grid;place-items:center;}

.rradmin .tcard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden;}
.rradmin .tcard-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 22px 14px;border-bottom:1px solid var(--bd-soft);flex-wrap:wrap;}
.rradmin .tcard-head h2{font-size:14.5px;font-weight:600;margin:0;color:var(--ink);}
.rradmin .tcard-head .csub{font-size:11.5px;color:var(--ink-3);margin-top:2px;}
.rradmin .tcard-head .leg{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--ink-3);}
.rradmin .tcard-head .leg .lg{display:inline-flex;align-items:center;gap:6px;}
.rradmin .tcard-head .leg .lg .sw{width:9px;height:9px;border-radius:3px;}
/* Tabela migrada para o kit (<Table scrollable minWidth={780}>): o chrome
   (scroll horizontal, min-width, thead sticky, padding, zebra, hover) agora vem
   do kit (.rr-table-wrap / .rrui-table). Mantemos só ajustes próprios da tela:
   alinhamento à direita do cabeçalho "Ações" e células em linha única. */
.rradmin .rrui-table thead th.r{text-align:right;}
.rradmin .rrui-table tbody td{white-space:nowrap;}
.rradmin .nm{font-weight:600;color:var(--ink);display:flex;align-items:center;gap:9px;}
.rradmin .nm .av{width:30px;height:30px;border-radius:9px;background:linear-gradient(150deg,#EAEEF6,#DCE3EF);color:var(--navy);display:grid;place-items:center;font-size:11.5px;font-weight:700;flex:none;border:1px solid var(--bd);}
.rradmin .nm .self{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--blue);background:var(--blue-bg);border:1px solid var(--blue-bd);padding:1px 7px;border-radius:999px;}
.rradmin .em{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink-2);}
.rradmin tr.inactive td{background:#FCFCFD;}
.rradmin tr.inactive td:not(.actcell){opacity:.62;}
.rradmin .emptyrow{padding:40px 18px;text-align:center;color:var(--ink-3);font-size:13px;}

.rradmin .rolechip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;padding:3px 11px;border-radius:999px;letter-spacing:.02em;border:1px solid transparent;}
.rradmin .rolechip .d{width:6px;height:6px;border-radius:50%;}
.rradmin .rolechip.socio{color:var(--blue);background:var(--blue-bg);border-color:var(--blue-bd);}
.rradmin .rolechip.socio .d{background:var(--blue);}
.rradmin .rolechip.func{color:var(--gold-deep);background:#FBF3E2;border-color:#EAD7A6;}
.rradmin .rolechip.func .d{background:var(--gold);}
.rradmin .rolechip.prom{color:var(--green-tx);background:var(--green-bg);border-color:var(--green-bd);}
.rradmin .rolechip.prom .d{background:var(--green);}
/* F4: cor própria dos roles de gestão — supervisor (navy) e gerente (violeta),
   distintos entre si e de socio/func/promotor. */
.rradmin .rolechip.sup{color:#1E3066;background:#E7EAF3;border-color:#CDD5E6;}
.rradmin .rolechip.sup .d{background:#1E3066;}
.rradmin .rolechip.ger{color:#6D28D9;background:#F1EAFB;border-color:#DFCFF6;}
.rradmin .rolechip.ger .d{background:#7C3AED;}

.rradmin .chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:4px 11px;border-radius:999px;border:1px solid;white-space:nowrap;}
.rradmin .chip .d{width:6px;height:6px;border-radius:50%;}
.rradmin .chip.on{color:var(--green-tx);background:var(--green-bg);border-color:var(--green-bd);}
.rradmin .chip.on .d{background:var(--green);}
.rradmin .chip.off{color:var(--ink-3);background:var(--neu);border-color:var(--bd);}
.rradmin .chip.off .d{background:var(--ink-3);}

.rradmin .actcell{white-space:nowrap;}
.rradmin .acts{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;}
.rradmin .iconact{appearance:none;width:30px;height:30px;border-radius:8px;border:1px solid var(--bd);background:#fff;color:var(--ink-2);display:inline-grid;place-items:center;cursor:pointer;transition:background .14s,border-color .14s,color .14s;}
.rradmin .iconact:hover{background:#F4F6F9;border-color:#C6CEDE;color:var(--navy);}
.rradmin .iconact.danger:hover{background:var(--red-bg);border-color:var(--red-bd);color:var(--red);}
.rradmin .iconact:disabled{opacity:.4;cursor:not-allowed;}
.rradmin .iconact:disabled:hover{background:#fff;border-color:var(--bd);color:var(--ink-2);}
.rradmin .txtact{appearance:none;display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:11.5px;font-weight:600;border-radius:8px;padding:6px 11px;cursor:pointer;border:1px solid var(--bd);background:#fff;color:var(--ink-2);transition:background .14s,border-color .14s,color .14s;white-space:nowrap;}
.rradmin .txtact:hover{background:#F4F6F9;border-color:#C6CEDE;color:var(--navy);}
.rradmin .txtact.warn:hover{background:var(--amber-bg);border-color:var(--amber-bd);color:var(--amber-tx);}
.rradmin .txtact.go:hover{background:var(--green-bg);border-color:var(--green-bd);color:var(--green-tx);}
.rradmin .txtact:disabled{opacity:.45;cursor:not-allowed;}
.rradmin .txtact svg{flex:none;}
.rradmin .actsep{width:1px;height:20px;background:var(--bd);margin:0 2px;}
.rradmin .dash{color:var(--ink-3);font-size:13px;}

/* overlay + dialog (modais) */
.rradmin .overlay{position:fixed;inset:0;background:rgba(7,19,63,.42);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:100;padding:16px;}
.rradmin .dialog{width:100%;max-width:440px;max-height:92vh;overflow-y:auto;background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:0 30px 80px rgba(11,24,56,.28);}
.rradmin .dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 15px;border-bottom:1px solid var(--bd-soft);background:#FAFBFC;}
.rradmin .dialog-head .dt2{display:flex;align-items:center;gap:11px;}
.rradmin .dialog-head .dt2 .di{width:32px;height:32px;border-radius:9px;background:var(--navy);color:#fff;display:grid;place-items:center;flex:none;}
.rradmin .dialog-head .dt2 .di.red{background:var(--red);}
.rradmin .dialog-head .dt2 .di.green{background:var(--green);}
.rradmin .dialog-head h3{font-size:14.5px;font-weight:600;margin:0;color:var(--ink);}
.rradmin .dialog-head .dsub{font-size:11.5px;color:var(--ink-3);margin-top:2px;}
.rradmin .dialog-head h3.red{color:var(--red-tx);}
.rradmin .dialog-head.red{background:var(--red-bg);border-bottom-color:var(--red-bd);}
.rradmin .dialog-head .x{appearance:none;width:28px;height:28px;border-radius:8px;border:1px solid var(--bd);background:#fff;color:var(--ink-3);display:grid;place-items:center;cursor:pointer;flex:none;}
.rradmin .dialog-head .x:hover{color:var(--ink);border-color:#C6CEDE;}
.rradmin .dialog-body{padding:18px 20px;}
.rradmin .field{margin-bottom:14px;}
.rradmin .field:last-child{margin-bottom:0;}
.rradmin .field label{display:block;font-size:12px;font-weight:600;color:var(--ink-2);margin-bottom:6px;}
.rradmin .field label .req{color:var(--red);margin-left:2px;}
.rradmin .field input,.rradmin .field select{width:100%;border:1px solid var(--bd);border-radius:9px;padding:10px 12px;font-family:inherit;font-size:13px;color:var(--ink);background:#fff;transition:border-color .14s,box-shadow .14s;}
.rradmin .field input::placeholder{color:var(--ink-3);}
.rradmin .field input:disabled,.rradmin .field select:disabled{background:#F4F6F9;color:var(--ink-3);cursor:not-allowed;}
.rradmin .field select{appearance:none;-webkit-appearance:none;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23838B9C' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 12px center;padding-right:30px;cursor:pointer;}
.rradmin .field input:focus,.rradmin .field select:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rradmin .field .hint{font-size:11px;color:var(--ink-3);margin-top:5px;line-height:1.45;}
.rradmin .field.locked{background:#FBF3E2;border:1px solid #EAD7A6;border-radius:11px;padding:11px 12px;}
.rradmin .field.locked label{color:var(--gold-deep);}
.rradmin .field.locked .hint{color:var(--amber-tx);}
.rradmin .condbox{border:1px dashed #C4CEDF;border-radius:12px;padding:13px 13px 4px;background:#FBFCFE;margin-bottom:14px;}
.rradmin .condbox .ctag{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--green-tx);background:var(--green-bg);border:1px solid var(--green-bd);padding:3px 9px;border-radius:999px;margin-bottom:11px;}
.rradmin .dialog-foot{display:flex;align-items:center;gap:10px;padding:15px 20px;border-top:1px solid var(--bd-soft);background:#FAFBFC;}
.rradmin .btn-primary{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--navy);color:#fff;border:none;border-radius:10px;padding:11px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .14s;}
.rradmin .btn-primary:hover{background:#16285C;}
.rradmin .btn-primary:disabled{opacity:.6;cursor:not-allowed;}
.rradmin .btn-primary.danger{background:var(--red);}
.rradmin .btn-primary.danger:hover{background:#B91C1C;}
.rradmin .btn-ghost{background:#fff;border:1px solid var(--bd);color:var(--ink-2);border-radius:10px;padding:11px 16px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;}
.rradmin .btn-ghost:hover{background:#F4F6F9;border-color:#C6CEDE;}
.rradmin .btn-primary .spinner{width:14px;height:14px;border-radius:50%;border:2.1px solid rgba(255,255,255,.3);border-top-color:#fff;animation:rradminspin .8s linear infinite;}
@keyframes rradminspin{to{transform:rotate(360deg);}}

.rradmin .pwlead{font-size:12.5px;color:var(--ink-2);line-height:1.5;margin:0 0 14px;}
.rradmin .pwlead b{color:var(--ink);}
.rradmin .pwbox{display:flex;align-items:center;gap:10px;background:#FBF1DC;border:1px solid var(--amber-bd);border-radius:13px;padding:14px 15px;}
.rradmin .pwbox code{flex:1;font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;letter-spacing:.06em;color:var(--ink);user-select:all;word-break:break-all;}
.rradmin .pwbox .copy{display:inline-flex;align-items:center;gap:7px;background:var(--navy);color:#fff;border:none;border-radius:9px;padding:9px 14px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;}
.rradmin .pwbox .copy:hover{background:#16285C;}
.rradmin .pwbox .copy svg{color:var(--yellow);}
.rradmin .pwwarn{display:flex;align-items:flex-start;gap:10px;margin-top:13px;background:var(--amber-bg);border:1px solid var(--amber-bd);border-radius:11px;padding:11px 13px;font-size:12px;color:var(--amber-tx);line-height:1.5;}
.rradmin .pwwarn svg{flex:none;margin-top:1px;}
.rradmin .pwwarn b{font-weight:700;}

.rradmin .cfm{font-size:13px;color:var(--ink-2);line-height:1.55;margin:0 0 12px;}
.rradmin .cfm b{color:var(--ink);}
.rradmin .userbox{display:flex;align-items:center;gap:12px;background:#F8F9FC;border:1px solid var(--bd);border-radius:12px;padding:12px 14px;margin-bottom:14px;}
.rradmin .userbox .av{width:36px;height:36px;border-radius:10px;background:linear-gradient(150deg,#EAEEF6,#DCE3EF);color:var(--navy);display:grid;place-items:center;font-size:13px;font-weight:700;border:1px solid var(--bd);flex:none;}
.rradmin .userbox .ub-n{font-size:13px;font-weight:600;color:var(--ink);}
.rradmin .userbox .ub-e{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--ink-3);margin-top:1px;}
.rradmin .dangerbanner{display:flex;align-items:flex-start;gap:11px;background:var(--red-bg);border:1px solid var(--red-bd);border-radius:12px;padding:13px 14px;margin-bottom:14px;}
.rradmin .dangerbanner .di{flex:none;width:30px;height:30px;border-radius:9px;background:rgba(220,38,38,.12);color:var(--red);display:grid;place-items:center;margin-top:1px;}
.rradmin .dangerbanner .dx{font-size:12.5px;color:var(--red-tx);line-height:1.5;}
.rradmin .dangerbanner .dx b{color:var(--red-tx);font-weight:700;}
.rradmin .infobanner{display:flex;align-items:flex-start;gap:10px;background:var(--amber-bg);border:1px solid var(--amber-bd);border-radius:11px;padding:11px 13px;margin-bottom:2px;font-size:12px;color:var(--amber-tx);line-height:1.5;}
.rradmin .infobanner svg{flex:none;margin-top:1px;}
.rradmin .errbox{padding:10px 12px;border-radius:10px;background:var(--red-bg);border:1px solid var(--red-bd);color:var(--red-tx);font-size:12.5px;font-weight:500;margin-bottom:12px;}

.rradmin .toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--ink);color:#fff;font-size:13px;font-weight:500;padding:12px 19px;border-radius:11px;box-shadow:0 24px 70px rgba(11,24,56,.34);display:flex;align-items:center;gap:10px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:120;}
.rradmin .toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.rradmin .toast .ck-i{color:var(--yellow);}

@media (max-width:640px){ .rradmin .search{max-width:100%;} .rradmin .newbtn{margin-left:0;} }
`;

export function initials(name?: string | null, email?: string): string {
  const src = (name && name.trim()) || email || "";
  const parts = src.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function roleLabel(role: UserRole): string {
  if (role === "socio") return "Sócio";
  if (role === "funcionario") return "Auxiliar Financeiro";
  if (role === "supervisor") return "Supervisor";
  if (role === "gerente_regional") return "Gerente Regional";
  if (role === "gestor_consorcio") return "Gestor de Consórcio";
  return "Promotor";
}

// Rótulo completo (descritivo) de cada perfil no dropdown "Perfil de acesso".
// FONTE UNICA usada pelos DOIS modais (criar e editar), iterando allowedTargetRoles
// — evita listas hardcoded que divergem (bug do M3: o perfil novo so entrava no
// modal de criar). Todo role de UserRole precisa ter um label aqui.
export const ROLE_OPTION_LABEL: Record<UserRole, string> = {
  socio: "Sócio (acesso completo)",
  funcionario: "Auxiliar Financeiro (operacional)",
  promotor: "Promotor (acesso aos próprios dados)",
  supervisor: "Supervisor (produção/desempenho da equipe)",
  gerente_regional: "Gerente Regional (produção/desempenho da regional)",
  gestor_consorcio: "Gestor de Consórcio (produção geral + 10% próprio)",
};

export function roleClass(role: UserRole): string {
  if (role === "socio") return "socio";
  if (role === "funcionario") return "func";
  if (role === "supervisor") return "sup";
  if (role === "gerente_regional") return "ger";
  return "prom";
}
