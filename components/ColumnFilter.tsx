"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

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
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Filtro ${columnLabel}`}
          onKeyDown={handlePopoverKeyDown}
          style={{
            ...styles.popover,
            ...(align === "left" ? styles.alignLeft : styles.alignRight),
          }}
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
        </div>
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
        fill={active ? "#0d4de3" : "transparent"}
        stroke={active ? "#0d4de3" : "#0F1F4A"}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    marginLeft: 6,
  },
  iconButton: {
    width: 22,
    height: 22,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 6,
    cursor: "pointer",
    color: "#0F1F4A",
  },
  iconButtonActive: {
    width: 22,
    height: 22,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(13,77,227,0.12)",
    border: "1px solid rgba(13,77,227,0.35)",
    borderRadius: 6,
    cursor: "pointer",
    color: "#0d4de3",
  },
  popover: {
    position: "absolute",
    top: "calc(100% + 6px)",
    zIndex: 50,
    width: 260,
    background: "#fff",
    border: "1px solid var(--rr-line-strong, #d6dbe4)",
    borderRadius: 12,
    boxShadow: "0 10px 30px rgba(15, 31, 74, 0.18)",
    padding: 10,
    display: "grid",
    gap: 8,
    fontSize: 13,
    color: "var(--rr-ink, #0F1F4A)",
    textAlign: "left",
  },
  alignLeft: { left: 0 },
  alignRight: { right: 0 },
  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--rr-line-strong, #d6dbe4)",
    fontSize: 13,
    outline: "none",
  },
  selectAllRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 6px",
    borderBottom: "1px solid var(--rr-line, #e6e9f0)",
    cursor: "pointer",
  },
  selectAllLabel: {
    fontWeight: 700,
    color: "var(--rr-ink, #0F1F4A)",
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
    gap: 8,
    padding: "4px 6px",
    cursor: "pointer",
    borderRadius: 6,
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
    color: "var(--rr-muted, #5A6B82)",
    fontStyle: "italic",
  },
  emptyBox: {
    padding: "16px 8px",
    textAlign: "center",
    color: "var(--rr-muted, #5A6B82)",
    fontStyle: "italic",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    paddingTop: 6,
    borderTop: "1px solid var(--rr-line, #e6e9f0)",
  },
  footerRight: { display: "flex", gap: 6 },
  clearBtn: {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--rr-line-strong, #d6dbe4)",
    background: "#fff",
    color: "var(--rr-muted, #5A6B82)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  cancelBtn: {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid var(--rr-line-strong, #d6dbe4)",
    background: "#fff",
    color: "var(--rr-ink, #0F1F4A)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  applyBtn: {
    padding: "6px 14px",
    borderRadius: 8,
    border: "none",
    background: "#0d4de3",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(13,77,227,0.22)",
  },
};
