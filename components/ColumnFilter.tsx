"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export type ColumnFilterValue = {
  value: string | number;
  label: string;
};

export interface ColumnFilterProps {
  columnLabel: string;
  values: ColumnFilterValue[];
  selected: Set<string>;
  loading?: boolean;
  onApply: (next: Set<string>) => void;
  onClear?: () => void;
  align?: "left" | "right";
}

const SCROLL_MAX_HEIGHT = 240;
const POPOVER_WIDTH = 260;

function toKey(value: string | number): string {
  return String(value);
}

/**
 * ColumnFilter — popover "estilo Excel" generico.
 *
 * Comportamento:
 * - Botao de funil/seta no header da coluna abre o popover abaixo.
 * - Popover tem busca textual, "(Selecionar Tudo)" tri-state que opera
 *   sobre o subset visivel pos-busca, lista scrollavel de checkboxes,
 *   botoes OK/Cancelar no rodape.
 * - ESC ou click fora descarta o draft (mesmo que Cancelar).
 * - Visual: borda + sombra leve, z-index alto, alinhamento configuravel.
 *
 * O componente NAO faz fetch nem cache — receive `values` ja resolvidos.
 * `selected.size === values.length` significa "sem filtro" (icone
 * desativado). `selected.size === 0` significa "filtro vazio" (nada
 * passa) — caller decide se mostra empty state.
 */
export default function ColumnFilter({
  columnLabel,
  values,
  selected,
  loading = false,
  onApply,
  onClear,
  align = "right",
}: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [search, setSearch] = useState("");
  // Posição FIXA calculada do botão — o popover é renderizado num portal no
  // document.body para escapar do `overflow:auto` da tabela (que recortava o
  // dropdown dentro do scroll horizontal). Reposiciona em scroll/resize.
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const reposition = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const top = r.bottom + 6;
      const left = align === "left" ? r.left : Math.max(8, r.right - POPOVER_WIDTH);
      setCoords({ top, left });
    };
    reposition();
    // capture:true pega scroll de qualquer ancestral (a tabela scrollável inclusa)
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, align]);

  // Sincroniza draft com selected sempre que o popover abre.
  useEffect(() => {
    if (open) {
      setDraft(new Set(selected));
      setSearch("");
      // Focus no input de busca apos abrir (pequeno delay para
      // garantir que o elemento esta no DOM).
      const id = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open, selected]);

  // ESC + click fora fecham descartando.
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const totalValues = values.length;
  const isAllSelected = selected.size >= totalValues && totalValues > 0;
  const hasActiveFilter = !isAllSelected && totalValues > 0;

  const visibleValues = useMemo(() => {
    if (!search.trim()) return values;
    const q = search.trim().toLowerCase();
    return values.filter((v) => v.label.toLowerCase().includes(q));
  }, [values, search]);

  const visibleKeys = useMemo(
    () => visibleValues.map((v) => toKey(v.value)),
    [visibleValues]
  );

  // Tri-state do "(Selecionar Tudo)" sobre os VISIVEIS (igual Excel).
  const visibleSelectedCount = useMemo(() => {
    let count = 0;
    for (const k of visibleKeys) {
      if (draft.has(k)) count += 1;
    }
    return count;
  }, [visibleKeys, draft]);

  const selectAllState: "all" | "none" | "some" =
    visibleSelectedCount === 0
      ? "none"
      : visibleSelectedCount === visibleKeys.length
        ? "all"
        : "some";

  function toggleSelectAll() {
    const next = new Set(draft);
    if (selectAllState === "all") {
      for (const k of visibleKeys) next.delete(k);
    } else {
      for (const k of visibleKeys) next.add(k);
    }
    setDraft(next);
  }

  function toggleOne(key: string) {
    const next = new Set(draft);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDraft(next);
  }

  function apply() {
    onApply(new Set(draft));
    setOpen(false);
  }

  function cancel() {
    setOpen(false);
  }

  function handlePopoverKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Focus trap basico: Tab/Shift+Tab circula entre elementos focaveis
    if (e.key !== "Tab" || !popoverRef.current) return;
    const focusables = popoverRef.current.querySelectorAll<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <span style={styles.wrap}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filtrar ${columnLabel}`}
        title={`Filtrar ${columnLabel}`}
        style={hasActiveFilter ? styles.iconButtonActive : styles.iconButton}
      >
        <FilterIcon active={hasActiveFilter} />
      </button>

      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Filtro ${columnLabel}`}
          onKeyDown={handlePopoverKeyDown}
          style={{ ...styles.popover, top: coords.top, left: coords.left }}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
            style={styles.searchInput}
          />

          {loading ? (
            <div style={styles.loadingBox}>Carregando valores...</div>
          ) : totalValues === 0 ? (
            <div style={styles.emptyBox}>Sem valores</div>
          ) : (
            <>
              <label style={styles.selectAllRow}>
                <input
                  type="checkbox"
                  checked={selectAllState === "all"}
                  ref={(el) => {
                    if (el) el.indeterminate = selectAllState === "some";
                  }}
                  onChange={toggleSelectAll}
                />
                <span style={styles.selectAllLabel}>(Selecionar tudo)</span>
              </label>

              <div style={styles.list}>
                {visibleValues.length === 0 ? (
                  <div style={styles.emptyBox}>Nenhum valor encontrado.</div>
                ) : (
                  visibleValues.map((v) => {
                    const key = toKey(v.value);
                    return (
                      <label key={key} style={styles.row}>
                        <input
                          type="checkbox"
                          checked={draft.has(key)}
                          onChange={() => toggleOne(key)}
                        />
                        <span style={styles.rowLabel}>{v.label}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </>
          )}

          <div style={styles.footer}>
            {onClear ? (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                style={styles.clearBtn}
              >
                Limpar
              </button>
            ) : (
              <span />
            )}
            <div style={styles.footerRight}>
              <button type="button" onClick={cancel} style={styles.cancelBtn}>
                Cancelar
              </button>
              <button type="button" onClick={apply} style={styles.applyBtn}>
                OK
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </span>
  );
}

function FilterIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path
        d="M1 2.5h10L7.5 7v3.5l-3-1.5V7L1 2.5z"
        fill={active ? "#fff" : "transparent"}
        stroke={active ? "#fff" : "#838B9C"}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Redesign (.rredit): popover repaginado no padrao novo (navy/cantos/bd).
// Renderiza num portal em document.body — fora do escopo .rredit — por isso
// os estilos sao inline. SOMENTE aparencia mudou; logica intacta.
const styles: Record<string, CSSProperties> = {
  wrap: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    marginLeft: 4,
  },
  iconButton: {
    width: 18,
    height: 18,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#EEF1F6",
    border: "1px solid transparent",
    borderRadius: 5,
    cursor: "pointer",
    color: "#838B9C",
  },
  iconButtonActive: {
    width: 18,
    height: 18,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0F1F4A",
    border: "1px solid #0F1F4A",
    borderRadius: 5,
    cursor: "pointer",
    color: "#fff",
  },
  popover: {
    position: "fixed",
    zIndex: 1000,
    width: POPOVER_WIDTH,
    background: "#fff",
    border: "1px solid #E4E7EC",
    borderRadius: 12,
    boxShadow: "0 18px 50px rgba(15,31,74,0.20), 0 2px 6px rgba(15,31,74,0.08)",
    padding: 10,
    display: "grid",
    gap: 8,
    fontSize: 12.5,
    color: "#16203A",
    textAlign: "left",
  },
  alignLeft: { left: 0 },
  alignRight: { right: 0 },
  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #E4E7EC",
    fontSize: 12.5,
    color: "#16203A",
    outline: "none",
  },
  selectAllRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 8px",
    borderBottom: "1px solid #EEF0F4",
    cursor: "pointer",
  },
  selectAllLabel: {
    fontWeight: 600,
    color: "#16203A",
  },
  list: {
    maxHeight: SCROLL_MAX_HEIGHT,
    overflowY: "auto",
    display: "grid",
    gap: 2,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 8px",
    cursor: "pointer",
    borderRadius: 7,
    color: "#4B5468",
  },
  rowLabel: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  loadingBox: {
    padding: "16px 8px",
    textAlign: "center",
    color: "#838B9C",
    fontStyle: "italic",
  },
  emptyBox: {
    padding: "16px 8px",
    textAlign: "center",
    color: "#838B9C",
    fontStyle: "italic",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    borderTop: "1px solid #EEF0F4",
  },
  footerRight: { display: "flex", gap: 6 },
  clearBtn: {
    padding: "7px 12px",
    borderRadius: 8,
    border: "1px solid #E4E7EC",
    background: "#fff",
    color: "#838B9C",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  cancelBtn: {
    padding: "7px 14px",
    borderRadius: 8,
    border: "1px solid #E4E7EC",
    background: "#fff",
    color: "#4B5468",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  applyBtn: {
    padding: "7px 14px",
    borderRadius: 8,
    border: "none",
    background: "#0F1F4A",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
};
