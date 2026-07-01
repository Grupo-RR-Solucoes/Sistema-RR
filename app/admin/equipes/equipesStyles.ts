// CSS extra da tela /admin/equipes — herda tokens/escopo de .rradmin
// (RRADMIN_CSS de /admin/usuarios). Aqui só o que é próprio da F2: o select
// inline de vínculo nas linhas e a árvore gerente -> supervisor -> promotor.
export const RREQUIPES_CSS = `
.rradmin .linksel{min-width:190px;max-width:260px;border:1px solid var(--bd);border-radius:9px;padding:8px 30px 8px 12px;font-family:inherit;font-size:12.5px;color:var(--ink);background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23838B9C' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 12px center;appearance:none;-webkit-appearance:none;cursor:pointer;transition:border-color .14s,box-shadow .14s;}
.rradmin .linksel:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rradmin .linksel:disabled{background-color:#F4F6F9;color:var(--ink-3);cursor:not-allowed;}
.rradmin .linksel.unset{color:var(--ink-3);font-style:italic;}

/* árvore */
.rradmin .tree{display:flex;flex-direction:column;gap:14px;padding:6px 4px;}
.rradmin .tnode{border:1px solid var(--bd);border-radius:14px;background:#fff;overflow:hidden;}
.rradmin .tnode.ger{border-color:#D5E0F4;}
.rradmin .tnode-head{display:flex;align-items:center;gap:11px;padding:12px 15px;background:var(--blue-bg);border-bottom:1px solid var(--blue-bd);}
.rradmin .tnode-head .tav{width:32px;height:32px;border-radius:9px;background:var(--navy);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:700;flex:none;}
.rradmin .tnode-head .tinfo{display:flex;flex-direction:column;min-width:0;}
.rradmin .tnode-head .tnm{font-size:13.5px;font-weight:700;color:var(--ink);}
.rradmin .tnode-head .tem{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink-3);}
.rradmin .tnode-head .tcount{margin-left:auto;font-size:11px;font-weight:700;color:var(--blue);background:#fff;border:1px solid var(--blue-bd);padding:3px 10px;border-radius:999px;white-space:nowrap;}
.rradmin .tbranch{padding:12px 15px 14px;display:flex;flex-direction:column;gap:10px;}
.rradmin .tsup{border:1px solid var(--bd-soft);border-radius:11px;background:#FBFCFE;}
.rradmin .tsup-head{display:flex;align-items:center;gap:9px;padding:9px 13px;border-bottom:1px solid var(--bd-soft);}
.rradmin .tsup-head .sdot{width:8px;height:8px;border-radius:50%;background:var(--gold);flex:none;}
.rradmin .tsup-head .snm{font-size:12.5px;font-weight:600;color:var(--ink);}
.rradmin .tsup-head .sem{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ink-3);}
.rradmin .tsup-head .scount{margin-left:auto;font-size:10.5px;font-weight:700;color:var(--ink-3);}
.rradmin .tproms{display:flex;flex-wrap:wrap;gap:7px;padding:11px 13px;}
.rradmin .tprom{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:500;color:var(--ink-2);background:#fff;border:1px solid var(--bd);padding:5px 11px;border-radius:999px;}
.rradmin .tprom .pd{width:6px;height:6px;border-radius:50%;background:var(--green);flex:none;}
.rradmin .tempty{font-size:11.5px;color:var(--ink-3);font-style:italic;padding:8px 13px;}
.rradmin .torphan{border-style:dashed;border-color:var(--amber-bd);background:#FEFBF3;}
.rradmin .torphan .tnode-head{background:var(--amber-bg);border-bottom-color:var(--amber-bd);}
.rradmin .torphan .tnode-head .tav{background:var(--amber);color:#fff;}
.rradmin .torphan .tnode-head .tcount{color:var(--amber-tx);border-color:var(--amber-bd);}

.rradmin .lnkcard{margin-bottom:0;}
.rradmin .lnkgrid{display:flex;flex-direction:column;}
`;
