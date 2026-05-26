"use client";

import { useEffect, useMemo, useState } from "react";

import ColumnFilter from "@/components/ColumnFilter";

import BulkActionBar from "./BulkActionBar";

// Dia 4.4 Etapa 4.4.2 — Filtros estilo Excel por coluna.
// 4.4.3: estendido com commission_rule_source (Origem MANUAL/DEFAULT).
// 4.4-fix-1.C: Origem REMOVIDA; adicionados srcc_restriction +
//              promoter_commission_percent_base (depois depreciado).
// 4.4-fix-1.E: promoter_commission_percent_base SUBSTITUIDO por
//              a_vista_percent (regra Promotiva pura do raw_payload).
// Distinct values derivados client-side a partir de filteredRows (semantica
// Excel cross-column emerge naturalmente). Labels sao os valores ja
// formatados como o usuario ve na tabela.

const FILTERABLE_COLUMNS = {
  assigned_promoter_id: {
    label: "Promotor",
    getValue: (row) => row.assigned_promoter_id,
    getDisplayLabel: (row) => row.promoter_name || "—",
  },
  product_description: {
    label: "Descricao",
    getValue: (row) => row.product_description,
    getDisplayLabel: (row) => row.product_description || "—",
  },
  agency_code: {
    label: "Agencia",
    getValue: (row) => row.agency_code,
    getDisplayLabel: (row) => row.agency_code || "—",
  },
  srcc_restriction: {
    label: "Restricao SRCC",
    getValue: (row) => row.srcc_restriction || "Nao",
    getDisplayLabel: (row) => row.srcc_restriction || "Nao",
  },
  // % A VISTA: regra TRP/OPP pura Promotiva, lida de raw_payload via
  // getAVistaPercent (4.4-fix-1.E D1). Read-only.
  a_vista_percent: {
    label: "% A vista",
    getValue: (row) => row.a_vista_percent,
    getDisplayLabel: (row) =>
      row.a_vista_percent == null || row.a_vista_percent === ""
        ? "—"
        : `${Number(row.a_vista_percent).toFixed(2).replace(".", ",")}%`,
  },
  // % REPASSE PROMOTOR: override editavel (4.4-fix-1.E D3). Renomeado
  // da antiga "% Penetracao" — esta NAO eh penetracao, eh o %
  // editavel que vai para promoter_proposal_commissions.commission_percent.
  promoter_commission_percent: {
    label: "% Promotor",
    getValue: (row) => row.promoter_commission_percent,
    getDisplayLabel: (row) =>
      row.promoter_commission_percent == null ||
      row.promoter_commission_percent === ""
        ? "—"
        : `${Number(row.promoter_commission_percent)
            .toFixed(2)
            .replace(".", ",")}%`,
  },
};

export default function EditarComissoesPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [companyId, setCompanyId] = useState("");
  const [promoterId, setPromoterId] = useState("");
  const [companies, setCompanies] = useState([]);
  const [promoters, setPromoters] = useState([]);
  const [rows, setRows] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingPromoters, setLoadingPromoters] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [savingRowId, setSavingRowId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Map<columnKey, Set<string>> — Set contem os valores SELECIONADOS
  // (passam pelo filtro). Ausencia da coluna no Map = sem filtro = tudo.
  const [columnFilters, setColumnFilters] = useState(new Map());
  // Selecao bulk: Set<daily_production_record_id>. Persiste atraves de
  // mudancas de filtro (Set tem IDs, nao referencia rows visiveis).
  // Limpa ao trocar year/month/companyId/promoterId (via loadRows).
  const [selectedIds, setSelectedIds] = useState(new Set());

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const nextYear = Number(params.get("year") || 0);
    const nextMonth = Number(params.get("month") || 0);
    const nextCompanyId = params.get("companyId") || "";
    const nextPromoterId = params.get("promoterId") || "";

    if (nextYear) {
      setYear(nextYear);
    }

    if (nextMonth) {
      setMonth(nextMonth);
    }

    if (nextCompanyId) {
      setCompanyId(nextCompanyId);
    }

    if (nextPromoterId) {
      setPromoterId(nextPromoterId);
    }
  }, []);

  useEffect(() => {
    loadPromoters();
  }, [companyId]);

  async function loadCompanies() {
    try {
      setLoadingCompanies(true);
      setError("");

      const response = await fetch("/api/companies/list");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao carregar empresas.");
      }

      setCompanies(data?.companies || []);
    } catch (err) {
      setError(err.message || "Erro ao carregar empresas.");
    } finally {
      setLoadingCompanies(false);
    }
  }

  async function loadPromoters() {
    try {
      setLoadingPromoters(true);

      const params = new URLSearchParams();
      if (companyId) {
        params.set("companyId", companyId);
      }

      const response = await fetch(
        `/api/promoters/list${params.toString() ? `?${params.toString()}` : ""}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao carregar promotores.");
      }

      const nextPromoters = data?.promoters || [];
      setPromoters(nextPromoters);

      if (
        promoterId &&
        !nextPromoters.some((promoter) => promoter.id === promoterId)
      ) {
        setPromoterId("");
      }
    } catch (err) {
      setError(err.message || "Erro ao carregar promotores.");
    } finally {
      setLoadingPromoters(false);
    }
  }

  async function loadRows() {
    try {
      setLoadingRows(true);
      setError("");
      setMessage("");
      // Evita selecao com IDs orfaos apos refetch (year/month/empresa
      // podem ter mudado entre selecao e re-fetch).
      setSelectedIds(new Set());

      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
      });

      if (companyId) {
        params.set("companyId", companyId);
      }

      if (promoterId) {
        params.set("promoterId", promoterId);
      }

      const response = await fetch(`/api/commissions/proposals?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao carregar propostas.");
      }

      setRows(
        (data?.rows || []).map((row) => {
          // Dia 4.5 Etapa B: input "% Promotor" agora edita
          // share_percent_override. UI sempre em escala 0..100 (user
          // digita "66.66"); DB armazena 0..1 (saveRow converte). Valor
          // inicial: override existente OU effective resolvido pela
          // cascata, ambos × 100.
          const initialShare =
            row.share_percent_override != null
              ? Number(row.share_percent_override) * 100
              : row.share_percent_effective != null
                ? Number(row.share_percent_effective) * 100
                : "";
          return {
            ...row,
            // Mantido para compat com handler legado de % Seguro etc.
            promoter_commission_percent_input:
              row.promoter_commission_percent ?? "",
            insurance_commission_percent_input:
              row.insurance_commission_percent ?? "",
            notes_input: row.manual_notes ?? "",
            // Novo input editavel da Etapa B (alvo da cascata).
            share_percent_input: initialShare,
          };
        })
      );
    } catch (err) {
      setError(err.message || "Erro ao carregar propostas.");
    } finally {
      setLoadingRows(false);
    }
  }

  function updateRowValue(id, field, value) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    );
  }

  async function saveRow(row) {
    try {
      setSavingRowId(row.id);
      setError("");
      setMessage("");

      // Dia 4.5 Etapa B: input editavel agora alimenta
      // share_percent_override (escala 0..1 no DB; converte ÷100).
      // Mantemos envio de insurance_commission_percent + notes para
      // back-compat (POST upsert agora preserva campos nao enviados).
      const shareInput = row.share_percent_input;
      const sharePercentOverride =
        shareInput === "" || shareInput === null || shareInput === undefined
          ? null
          : Number(shareInput) / 100;

      const response = await fetch("/api/commissions/proposals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dailyProductionRecordId: row.id,
          promoterId: row.assigned_promoter_id,
          sharePercentOverride,
          insuranceCommissionPercent:
            row.insurance_commission_percent_input === ""
              ? null
              : Number(row.insurance_commission_percent_input),
          notes: row.notes_input || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao salvar comissao.");
      }

      setMessage(`Comissao da proposta ${row.proposal_number} salva com sucesso.`);
      await loadRows();
    } catch (err) {
      setError(err.message || "Erro ao salvar comissao.");
    } finally {
      setSavingRowId("");
    }
  }

  async function clearManualRule(row) {
    try {
      setSavingRowId(row.id);
      setError("");
      setMessage("");

      const response = await fetch("/api/commissions/proposals", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dailyProductionRecordId: row.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao remover regra manual.");
      }

      setMessage(`Regra manual da proposta ${row.proposal_number} removida.`);
      await loadRows();
    } catch (err) {
      setError(err.message || "Erro ao remover regra manual.");
    } finally {
      setSavingRowId("");
    }
  }

  // Aplica todos os filtros EXCETO o da coluna passada (Excel semantics
  // para distinct values: ao abrir o popover de "Promotor", a lista de
  // valores reflete o estado FILTRADO pelas outras colunas, mas nao por
  // ela mesma — assim o usuario sempre consegue voltar a ver tudo dela).
  function rowsFilteredExcept(exceptColumn) {
    if (columnFilters.size === 0) return rows;
    return rows.filter((row) => {
      for (const [col, selected] of columnFilters) {
        if (col === exceptColumn) continue;
        const cfg = FILTERABLE_COLUMNS[col];
        if (!cfg) continue;
        const v = cfg.getValue(row);
        if (!selected.has(String(v ?? ""))) return false;
      }
      return true;
    });
  }

  function getDistinctValuesForColumn(column) {
    const cfg = FILTERABLE_COLUMNS[column];
    if (!cfg) return [];
    const base = rowsFilteredExcept(column);
    const map = new Map();
    for (const row of base) {
      const raw = cfg.getValue(row);
      const key = String(raw ?? "");
      if (!map.has(key)) {
        map.set(key, { value: key, label: cfg.getDisplayLabel(row) });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.label).localeCompare(String(b.label), "pt-BR", {
        numeric: true,
      })
    );
  }

  const filteredRows = useMemo(() => {
    if (columnFilters.size === 0) return rows;
    return rows.filter((row) => {
      for (const [col, selected] of columnFilters) {
        const cfg = FILTERABLE_COLUMNS[col];
        if (!cfg) continue;
        const v = cfg.getValue(row);
        if (!selected.has(String(v ?? ""))) return false;
      }
      return true;
    });
  }, [rows, columnFilters]);

  function applyColumnFilter(column, next, allValues) {
    setColumnFilters((prev) => {
      const m = new Map(prev);
      // "Todos selecionados" = sem filtro -> remove a entry
      if (next.size >= allValues.length) {
        m.delete(column);
      } else {
        m.set(column, next);
      }
      return m;
    });
  }

  function clearAllFilters() {
    setColumnFilters(new Map());
  }

  // -------- Selecao bulk (4.4.3) --------
  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const row of filteredRows) next.add(row.id);
      return next;
    });
  }

  function deselectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const row of filteredRows) next.delete(row.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Estado do checkbox header (tri-state sobre VISIVEIS).
  const visibleSelectedCount = useMemo(() => {
    let count = 0;
    for (const row of filteredRows) {
      if (selectedIds.has(row.id)) count += 1;
    }
    return count;
  }, [filteredRows, selectedIds]);

  const headerSelectState =
    filteredRows.length === 0
      ? "none"
      : visibleSelectedCount === 0
        ? "none"
        : visibleSelectedCount === filteredRows.length
          ? "all"
          : "some";

  // selectedItems para BulkActionBar. Faz lookup em rows (nao
  // filteredRows) para preservar selecao quando filtro oculta linhas.
  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const out = [];
    for (const row of rows) {
      if (!selectedIds.has(row.id)) continue;
      out.push({
        dailyProductionRecordId: row.id,
        commissionRuleId: row.commission_rule_id ?? null,
        currentPercent:
          row.promoter_commission_percent == null
            ? null
            : Number(row.promoter_commission_percent),
      });
    }
    return out;
  }, [rows, selectedIds]);

  // Totals do header KPI continuam refletindo TODAS as propostas (nao
  // os filtros visuais) — preserva semantica das summary cards existentes.
  // Banner separado mostra "X de Y" quando ha filtros ativos.
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.gross += Number(row.commission_base_value || row.net_value || 0);
        acc.promoterAmount += Number(row.promoter_commission_amount || 0);
        acc.insuranceAmount += Number(row.insurance_commission_amount || 0);
        return acc;
      },
      { gross: 0, promoterAmount: 0, insuranceAmount: 0 }
    );
  }, [rows]);

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Override comercial</div>
          <h2 style={styles.title}>Comissao por proposta com visual de operacao real</h2>
          <p style={styles.description}>
            Aqui voce ajusta excecoes manuais por proposta. A prioridade da
            regra continua sendo proposta manual, depois produto e por fim a
            regra mensal padrao.
          </p>
        </article>

        <article style={styles.heroCard}>
          <div style={styles.heroLabel}>Regras desta tela</div>
          <div style={styles.ruleList}>
            <div style={styles.ruleItem}>Promotor respeita teto proprio de 5,8%.</div>
            <div style={styles.ruleItem}>Seguro pode ter repasse diferente por negociacao.</div>
            <div style={styles.ruleItem}>A alteracao manual precisa ficar auditavel.</div>
          </div>
        </article>
      </div>

      <section style={styles.filtersCard}>
        <div style={styles.filtersGrid}>
          <div style={styles.field}>
            <label style={styles.label}>Ano</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Mes</label>
            <input
              type="number"
              min="1"
              max="12"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Empresa</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              style={styles.input}
              disabled={loadingCompanies}
            >
              <option value="">Todas</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Promotor</label>
            <select
              value={promoterId}
              onChange={(e) => setPromoterId(e.target.value)}
              style={styles.input}
              disabled={loadingPromoters}
            >
              <option value="">Todos</option>
              {promoters.map((promoter) => (
                <option key={promoter.id} value={promoter.id}>
                  {promoter.name}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.actions}>
            <button
              type="button"
              onClick={loadRows}
              style={styles.primaryButton}
              disabled={loadingRows}
            >
              {loadingRows ? "Carregando..." : "Buscar propostas"}
            </button>
          </div>
        </div>
      </section>

      {message ? <div style={styles.successBox}>{message}</div> : null}
      {error ? <div style={styles.errorBox}>{error}</div> : null}

      <section style={styles.summaryGrid}>
        <SummaryItem
          label="Propostas"
          value={String(rows.length)}
          accent="linear-gradient(135deg, rgba(13,77,227,0.14) 0%, rgba(255,255,255,0.98) 100%)"
        />
        <SummaryItem
          label="Base total"
          value={formatCurrency(totals.gross)}
          accent="linear-gradient(135deg, rgba(255,240,0,0.16) 0%, rgba(255,255,255,0.98) 100%)"
        />
        <SummaryItem
          label="Comissao promotor"
          value={formatCurrency(totals.promoterAmount)}
          accent="linear-gradient(135deg, rgba(214,161,63,0.18) 0%, rgba(255,255,255,0.98) 100%)"
        />
        <SummaryItem
          label="Comissao seguro"
          value={formatCurrency(totals.insuranceAmount)}
          accent="linear-gradient(135deg, rgba(13,77,227,0.1) 0%, rgba(214,161,63,0.12) 100%)"
        />
      </section>

      <section style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <div style={styles.tableKicker}>Detalhamento operacional</div>
          <h3 style={styles.tableTitle}>Propostas com possibilidade de ajuste manual</h3>
        </div>

        {columnFilters.size > 0 ? (
          <div style={styles.filterBanner}>
            <span>
              Mostrando{" "}
              <strong>{filteredRows.length.toLocaleString("pt-BR")}</strong> de{" "}
              <strong>{rows.length.toLocaleString("pt-BR")}</strong> propostas
              {" "}
              ({columnFilters.size} filtro{columnFilters.size === 1 ? "" : "s"}{" "}
              ativo{columnFilters.size === 1 ? "" : "s"})
            </span>
            <button
              type="button"
              onClick={clearAllFilters}
              style={styles.bannerClearBtn}
            >
              Limpar filtros
            </button>
          </div>
        ) : null}

        <div
          className={`rr-table-wrap${filteredRows.length > 15 ? " rr-table-wrap--scrollable" : ""}`}
          style={{
            ...styles.tableWrap,
            // FIX-1.D.6 (scroll): sempre permite scroll vertical com
            // teto consistente. Antes so aplicava maxHeight para >15
            // rows e sem overflowY explicito; combinado com
            // tableCard.overflow:hidden (parent), poucas rows ficavam
            // cortadas em ~3 linhas visiveis sem barra de scroll.
            maxHeight: "calc(100vh - 460px)",
            overflowY: "auto",
          }}
        >
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.thCheckbox}>
                  <input
                    type="checkbox"
                    checked={headerSelectState === "all"}
                    ref={(el) => {
                      if (el) el.indeterminate = headerSelectState === "some";
                    }}
                    onChange={() => {
                      if (headerSelectState === "all") deselectAllVisible();
                      else selectAllVisible();
                    }}
                    aria-label="Selecionar todos os visíveis"
                    disabled={filteredRows.length === 0}
                  />
                </th>
                {/* Ordem espelha planilha LUCIANA_MATIAS.xlsx (4.4-fix-1.C). */}
                <th style={styles.th}>Contrato</th>
                <th style={styles.th}>Valor bruto</th>
                <th style={styles.th}>Valor liquido</th>
                <th style={styles.th}>Parcela</th>
                <th style={styles.th}>
                  <span style={styles.thContent}>
                    Agencia
                    <ColumnFilter
                      columnLabel="Agencia"
                      values={getDistinctValuesForColumn("agency_code")}
                      selected={
                        columnFilters.get("agency_code") ??
                        new Set(
                          getDistinctValuesForColumn("agency_code").map((v) =>
                            String(v.value)
                          )
                        )
                      }
                      onApply={(next) =>
                        applyColumnFilter(
                          "agency_code",
                          next,
                          getDistinctValuesForColumn("agency_code")
                        )
                      }
                      align="left"
                    />
                  </span>
                </th>
                <th style={styles.th}>Chave J</th>
                <th style={styles.th}>
                  <span style={styles.thContent}>
                    Promotor(a)
                    <ColumnFilter
                      columnLabel="Promotor"
                      values={getDistinctValuesForColumn("assigned_promoter_id")}
                      selected={
                        columnFilters.get("assigned_promoter_id") ??
                        new Set(
                          getDistinctValuesForColumn(
                            "assigned_promoter_id"
                          ).map((v) => String(v.value))
                        )
                      }
                      onApply={(next) =>
                        applyColumnFilter(
                          "assigned_promoter_id",
                          next,
                          getDistinctValuesForColumn("assigned_promoter_id")
                        )
                      }
                      align="left"
                    />
                  </span>
                </th>
                <th style={styles.th}>Data contratacao</th>
                <th style={styles.th}>Tx juros</th>
                <th style={styles.th}>
                  <span style={styles.thContent}>
                    Descricao do produto
                    <ColumnFilter
                      columnLabel="Descricao"
                      values={getDistinctValuesForColumn("product_description")}
                      selected={
                        columnFilters.get("product_description") ??
                        new Set(
                          getDistinctValuesForColumn(
                            "product_description"
                          ).map((v) => String(v.value))
                        )
                      }
                      onApply={(next) =>
                        applyColumnFilter(
                          "product_description",
                          next,
                          getDistinctValuesForColumn("product_description")
                        )
                      }
                      align="left"
                    />
                  </span>
                </th>
                <th style={styles.th}>
                  <span style={styles.thContent}>
                    % A vista
                    <ColumnFilter
                      columnLabel="% A vista"
                      values={getDistinctValuesForColumn("a_vista_percent")}
                      selected={
                        columnFilters.get("a_vista_percent") ??
                        new Set(
                          getDistinctValuesForColumn("a_vista_percent").map(
                            (v) => String(v.value)
                          )
                        )
                      }
                      onApply={(next) =>
                        applyColumnFilter(
                          "a_vista_percent",
                          next,
                          getDistinctValuesForColumn("a_vista_percent")
                        )
                      }
                      align="left"
                    />
                  </span>
                </th>
                <th style={styles.th}>Comissao PF</th>
                <th style={styles.th}>
                  <span style={styles.thContent}>
                    Restricao SRCC
                    <ColumnFilter
                      columnLabel="Restricao SRCC"
                      values={getDistinctValuesForColumn("srcc_restriction")}
                      selected={
                        columnFilters.get("srcc_restriction") ??
                        new Set(
                          getDistinctValuesForColumn("srcc_restriction").map(
                            (v) => String(v.value)
                          )
                        )
                      }
                      onApply={(next) =>
                        applyColumnFilter(
                          "srcc_restriction",
                          next,
                          getDistinctValuesForColumn("srcc_restriction")
                        )
                      }
                      align="left"
                    />
                  </span>
                </th>
                <th style={styles.th}>Valor seguro</th>
                <th style={styles.th}>Comissao seguro</th>
                {/* NOVA col 17 (4.4-fix-1.E D2): % Penetracao mensal de
                    seguro, constante por promotor. Read-only, sem filtro. */}
                <th style={styles.th}>% Penetracao</th>
                <th style={styles.th}>
                  <span style={styles.thContent}>
                    % Promotor
                    <ColumnFilter
                      columnLabel="% Promotor"
                      values={getDistinctValuesForColumn(
                        "promoter_commission_percent"
                      )}
                      selected={
                        columnFilters.get("promoter_commission_percent") ??
                        new Set(
                          getDistinctValuesForColumn(
                            "promoter_commission_percent"
                          ).map((v) => String(v.value))
                        )
                      }
                      onApply={(next) =>
                        applyColumnFilter(
                          "promoter_commission_percent",
                          next,
                          getDistinctValuesForColumn(
                            "promoter_commission_percent"
                          )
                        )
                      }
                      align="left"
                    />
                  </span>
                </th>
                <th style={styles.th}>Comissao promotor</th>
                <th style={styles.th}>Comissao seguro promotor</th>
                <th style={styles.th}>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td style={styles.emptyTd} colSpan={21}>
                    {rows.length === 0
                      ? "Nenhuma proposta encontrada."
                      : "Nenhuma proposta corresponde aos filtros atuais."}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const isSaving = savingRowId === row.id;
                  const isSelected = selectedIds.has(row.id);

                  return (
                    <tr
                      key={row.id}
                      style={isSelected ? styles.trSelected : undefined}
                    >
                      <td style={styles.tdCheckbox}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(row.id)}
                          aria-label={`Selecionar proposta ${row.proposal_number || row.id}`}
                        />
                      </td>
                      {/* Ordem da planilha LUCIANA_MATIAS.xlsx (4.4-fix-1.C) */}
                      <td style={styles.td}>{row.contract_number || "-"}</td>
                      <td style={styles.td}>{formatCurrency(row.gross_value || 0)}</td>
                      <td style={styles.td}>{formatCurrency(row.net_value || 0)}</td>
                      <td style={styles.td}>{row.installment_count ?? "-"}</td>
                      <td style={styles.td}>{row.agency_code || "-"}</td>
                      <td style={styles.tdMono}>{row.j_key || "-"}</td>
                      <td style={styles.td}>{row.promoter_name || "-"}</td>
                      <td style={styles.td}>{formatDateBR(row.contract_date)}</td>
                      <td style={styles.td}>{formatPercentSuffix(row.interest_rate)}</td>
                      <td style={styles.td}>{row.product_description || "-"}</td>
                      <td style={styles.td}>
                        {/* FIX-1.D.6 (display): teto operacional 5,80%
                            visivel APENAS na celula (visao do promotor).
                            row.a_vista_percent armazena o RAW Promotiva
                            para outros consumidores (calculo persistido,
                            export, IIFE de cascata viva — todos aplicam
                            seu proprio clamp). */}
                        {formatPercentSuffix(
                          row.a_vista_percent != null
                            ? Math.min(Number(row.a_vista_percent), 5.8)
                            : row.a_vista_percent
                        )}
                      </td>
                      <td style={styles.td}>
                        {formatCurrency(row.promoter_commission_amount || 0)}
                      </td>
                      <td style={styles.td}>
                        <span style={srccBadgeStyle(row.srcc_restriction)}>
                          {row.srcc_restriction || "Nao"}
                        </span>
                      </td>
                      <td style={styles.td}>
                        {Number(row.insurance_value || 0) > 0
                          ? formatCurrency(row.insurance_value)
                          : "—"}
                      </td>
                      <td style={styles.td}>
                        {Number(row.insurance_commission_amount || 0) > 0
                          ? formatCurrency(row.insurance_commission_amount)
                          : "—"}
                      </td>
                      {/* NOVA col 17 (4.4-fix-1.E D2): % Penetracao
                          mensal de seguro, constante por promotor. */}
                      <td style={styles.td}>
                        {formatPercentSuffix(
                          row.insurance_penetration_percent
                        )}
                      </td>
                      <td style={styles.td}>
                        {/* Dia 4.5 Etapa B: input editavel agora alimenta
                            share_percent_override (escala 0..100 na UI,
                            0..1 no DB). Badge mostra a fonte do valor
                            (override / profile / default) quando nao ha
                            override pendente do usuario. */}
                        <div style={styles.shareInputCell}>
                          <input
                            type="number"
                            step="0.01"
                            value={row.share_percent_input}
                            onChange={(e) =>
                              updateRowValue(
                                row.id,
                                "share_percent_input",
                                e.target.value
                              )
                            }
                            style={styles.smallInput}
                            aria-label="% Promotor (editavel)"
                          />
                          {(() => {
                            const badge = badgeForShareSource(
                              row.share_percent_source,
                              row.share_percent_override
                            );
                            return badge ? (
                              <span style={badge.style} title={badge.title}>
                                {badge.label}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </td>
                      <td style={styles.td}>
                        {/* FIX-1.D.6 (calculo): COMISSAO PROMOTOR =
                            COMISSAO PF × sharePct, sempre. Cascata viva
                            (Etapa B) recalcula enquanto digita.
                            Formula: net_value × min(a_vista, 5.8) / 100
                            × sharePct (decimal 0..1).
                            sharePct cascata:
                              1) draft do input (escala 0..100, ÷100)
                              2) row.share_percent_effective (cascata
                                 Etapa B, ja em 0..1)
                              3) 0 (sem share — render "—")
                            NAO usa row.promoter_share_amount (que para
                            rows MANUAL_PROPOSAL_LEGACY pode vir
                            dessincronizado com a cascata viva). */}
                        {(() => {
                          const draft = row.share_percent_input;
                          const netValue = Number(row.net_value ?? 0);
                          const aVista = Number(row.a_vista_percent ?? 0);
                          const aVistaClamped = Math.min(
                            Math.max(aVista, 0),
                            5.8
                          );
                          const comissaoPF =
                            (netValue * aVistaClamped) / 100;
                          let sharePct = 0;
                          if (
                            draft !== "" &&
                            draft !== null &&
                            draft !== undefined
                          ) {
                            const draftNum = Number(draft);
                            if (Number.isFinite(draftNum)) {
                              sharePct = draftNum / 100;
                            }
                          } else if (row.share_percent_effective != null) {
                            const eff = Number(row.share_percent_effective);
                            if (Number.isFinite(eff)) sharePct = eff;
                          }
                          const comissaoPromotor = comissaoPF * sharePct;
                          return comissaoPromotor > 0
                            ? formatCurrency(comissaoPromotor)
                            : "—";
                        })()}
                      </td>
                      <td style={styles.td}>
                        {row.promoter_insurance_amount == null ||
                        Number(row.promoter_insurance_amount) === 0
                          ? "—"
                          : formatCurrency(row.promoter_insurance_amount)}
                      </td>
                      <td style={styles.td}>
                        <div style={styles.actionButtons}>
                          <button
                            type="button"
                            onClick={() => saveRow(row)}
                            disabled={isSaving || !row.assigned_promoter_id}
                            style={styles.saveButton}
                          >
                            {isSaving ? "Salvando..." : "Salvar"}
                          </button>

                          <button
                            type="button"
                            onClick={() => clearManualRule(row)}
                            disabled={isSaving}
                            style={styles.clearButton}
                          >
                            Limpar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <BulkActionBar
        selectedItems={selectedItems}
        onClearSelection={clearSelection}
        onApplied={async () => {
          clearSelection();
          await loadRows();
        }}
      />
    </section>
  );
}

function SummaryItem({ label, value, accent }) {
  return (
    <article style={{ ...styles.summaryItem, background: accent }}>
      <span style={styles.summaryLabel}>{label}</span>
      <strong style={styles.summaryValue}>{value}</strong>
    </article>
  );
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

// 4.4-fix-1.B: formatadores das colunas novas (Data Contratacao + Tx Juros).
function formatDateBR(iso) {
  if (!iso) return "-";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatPercentSuffix(value) {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(2).replace(".", ",")}%`;
}

// Dia 4.5 Etapa B: badge para a coluna "% Promotor" indicando a
// fonte do valor (override manual, perfil, default). Retorna null
// quando o estado e "default sem destaque" — UX mais limpa para o
// caso comum.
function badgeForShareSource(source, override) {
  const baseStyle = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginLeft: "6px",
    whiteSpace: "nowrap",
  };

  // Override por proposta (manual) tem precedencia visual.
  if (
    override !== null &&
    override !== undefined &&
    String(override) !== ""
  ) {
    return {
      label: "Manual",
      title: "Override por proposta (sobrescreve perfil)",
      style: {
        ...baseStyle,
        background: "rgba(13,77,227,0.12)",
        color: "#0d4de3",
        border: "1px solid rgba(13,77,227,0.30)",
      },
    };
  }

  const src = String(source || "");
  if (src === "OVERRIDE_PROPOSTA") {
    return {
      label: "Manual",
      title: "Override por proposta",
      style: {
        ...baseStyle,
        background: "rgba(13,77,227,0.12)",
        color: "#0d4de3",
        border: "1px solid rgba(13,77,227,0.30)",
      },
    };
  }
  if (src === "PROFILE_CLT_FIXO") {
    return {
      label: "CLT",
      title: "Perfil CLT_FIXO (% fixo de funcionario registrado)",
      style: {
        ...baseStyle,
        background: "rgba(40,140,80,0.14)",
        color: "#185a36",
        border: "1px solid rgba(40,140,80,0.30)",
      },
    };
  }
  if (src === "PROFILE_ACORDO_FIXO") {
    return {
      label: "Acordo fixo",
      title: "Perfil ACORDO_FIXO (% comercial fixo)",
      style: {
        ...baseStyle,
        background: "rgba(40,140,80,0.14)",
        color: "#185a36",
        border: "1px solid rgba(40,140,80,0.30)",
      },
    };
  }
  if (src.startsWith("PROFILE_ENTRANTE_")) {
    return {
      label: "Entrante",
      title: `Perfil entrante (escala por volume mensal): ${src}`,
      style: {
        ...baseStyle,
        background: "rgba(214,140,30,0.14)",
        color: "#8a4a17",
        border: "1px solid rgba(214,140,30,0.32)",
      },
    };
  }
  if (src.startsWith("PROFILE_VARIAVEL")) {
    return {
      label: "Variavel",
      title: "Acordo variavel — sem override -> fallback default 58,33%",
      style: {
        ...baseStyle,
        background: "rgba(214,180,40,0.18)",
        color: "#735b00",
        border: "1px solid rgba(214,180,40,0.38)",
      },
    };
  }
  // PROFILE_DEFAULT, DEFAULT_FALLBACK, DEFAULT_NO_PROFILE: sem badge
  // (caso comum — visual mais limpo).
  return null;
}

// 4.4-fix-1.C: badge da coluna RESTRICAO SRCC.
// "Sim" -> vermelho de aviso; demais ("Nao", "Nao se aplica") -> cinza.
function srccBadgeStyle(label) {
  const isRestricted = String(label || "").trim().toUpperCase() === "SIM";
  return {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    background: isRestricted
      ? "rgba(180,30,30,0.10)"
      : "rgba(15,31,74,0.06)",
    color: isRestricted ? "#8a1717" : "var(--rr-muted)",
    border: isRestricted
      ? "1px solid rgba(180,30,30,0.30)"
      : "1px solid var(--rr-line)",
  };
}

const styles = {
  page: {
    display: "grid",
    gap: "18px",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
  },
  heroMain: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,253,245,0.98) 100%)",
    borderRadius: "28px",
    padding: "28px",
    border: "1px solid var(--rr-line)",
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
    fontSize: "clamp(2rem, 3vw, 3.2rem)",
    color: "var(--rr-ink)",
  },
  description: {
    margin: "14px 0 0",
    fontSize: "15px",
    lineHeight: 1.75,
    color: "var(--rr-muted)",
  },
  heroCard: {
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    borderRadius: "28px",
    padding: "26px",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "var(--rr-shadow)",
  },
  heroLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "rgba(255,255,255,0.72)",
    marginBottom: "12px",
  },
  ruleList: {
    display: "grid",
    gap: "10px",
  },
  ruleItem: {
    borderRadius: "16px",
    background: "rgba(255,240,0,0.12)",
    border: "1px solid rgba(255,240,0,0.18)",
    padding: "12px 14px",
    fontSize: "13px",
    lineHeight: 1.55,
    color: "rgba(255,255,255,0.92)",
  },
  filtersCard: {
    background: "rgba(255,255,255,0.92)",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    alignItems: "end",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  input: {
    height: "44px",
    borderRadius: "12px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "0 12px",
    fontSize: "14px",
    background: "#fff",
  },
  actions: {
    display: "flex",
    alignItems: "end",
  },
  primaryButton: {
    width: "100%",
    height: "44px",
    border: "none",
    borderRadius: "12px",
    background:
      "linear-gradient(135deg, var(--rr-blue) 0%, var(--rr-blue-deep) 100%)",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 16px 30px rgba(13,77,227,0.2)",
  },
  successBox: {
    background: "rgba(236,253,245,0.92)",
    border: "1px solid rgba(16,185,129,0.24)",
    color: "#065f46",
    padding: "14px 16px",
    borderRadius: "16px",
  },
  errorBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(239,68,68,0.24)",
    color: "#991b1b",
    padding: "14px 16px",
    borderRadius: "16px",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
  },
  summaryItem: {
    borderRadius: "22px",
    padding: "18px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  summaryLabel: {
    display: "block",
    color: "var(--rr-blue)",
    fontSize: "11px",
    marginBottom: "8px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    fontWeight: 800,
  },
  summaryValue: {
    fontSize: "24px",
    color: "var(--rr-ink)",
    fontFamily: "var(--font-heading)",
  },
  tableCard: {
    background: "rgba(255,255,255,0.92)",
    borderRadius: "26px",
    border: "1px solid var(--rr-line)",
    overflow: "hidden",
    boxShadow: "var(--rr-shadow-soft)",
  },
  tableHeader: {
    padding: "24px 24px 0",
  },
  tableKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  tableTitle: {
    margin: 0,
    fontSize: "24px",
    color: "var(--rr-ink)",
  },
  tableWrap: {
    overflowX: "auto",
    padding: "18px 24px 24px",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    minWidth: "2350px",
  },
  th: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    textAlign: "left",
    padding: "0 12px 14px 0",
    borderBottom: "1px solid var(--rr-line)",
    whiteSpace: "nowrap",
    fontWeight: 800,
  },
  thContent: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
  },
  shareInputCell: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    whiteSpace: "nowrap",
  },
  thCheckbox: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    textAlign: "center",
    padding: "0 8px 14px 0",
    borderBottom: "1px solid var(--rr-line)",
    width: "40px",
    minWidth: "40px",
  },
  tdCheckbox: {
    borderBottom: "1px solid rgba(13,77,227,0.08)",
    padding: "12px 8px 12px 0",
    textAlign: "center",
    verticalAlign: "middle",
    width: "40px",
    minWidth: "40px",
  },
  trSelected: {
    background: "rgba(13,77,227,0.04)",
  },
  filterBanner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    padding: "10px 14px",
    margin: "12px 0",
    background: "rgba(13,77,227,0.06)",
    border: "1px solid rgba(13,77,227,0.20)",
    borderRadius: "10px",
    fontSize: "13px",
    color: "var(--rr-ink)",
  },
  bannerClearBtn: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid rgba(13,77,227,0.32)",
    background: "#fff",
    color: "#0d4de3",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  td: {
    borderBottom: "1px solid rgba(13,77,227,0.08)",
    padding: "12px 12px 12px 0",
    fontSize: "13px",
    color: "var(--rr-muted)",
    verticalAlign: "middle",
  },
  tdMono: {
    borderBottom: "1px solid rgba(13,77,227,0.08)",
    padding: "12px 12px 12px 0",
    fontSize: "13px",
    color: "var(--rr-muted)",
    verticalAlign: "middle",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  emptyTd: {
    padding: "24px",
    textAlign: "center",
    color: "var(--rr-muted)",
  },
  badge: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: "999px",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.95) 0%, rgba(214,161,63,0.88) 100%)",
    color: "var(--rr-blue-deep)",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
  },
  smallInput: {
    width: "90px",
    height: "38px",
    borderRadius: "10px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "0 10px",
    background: "#fff",
  },
  notesInput: {
    width: "220px",
    height: "38px",
    borderRadius: "10px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "0 10px",
    background: "#fff",
  },
  actionButtons: {
    display: "flex",
    gap: "8px",
  },
  saveButton: {
    border: "none",
    borderRadius: "10px",
    background:
      "linear-gradient(135deg, var(--rr-blue) 0%, var(--rr-blue-deep) 100%)",
    color: "#fff",
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  clearButton: {
    border: "1px solid rgba(13,77,227,0.14)",
    borderRadius: "10px",
    background: "#fffdf6",
    color: "var(--rr-ink)",
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
};
