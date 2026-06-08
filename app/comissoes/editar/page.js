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
// Redesign (.rredit): camada visual reescrita para o padrao scoped
// (header navy, chips, .scard, tabela clara). LOGICA preservada
// integralmente — calculo ao vivo, clamp 5,8% do a_vista, gravacao do
// share_percent_override, gating de mes fechado, auditoria: tudo intacto.
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
  // FIX-1.E.6.F — agregados de seguro Modelo B por (promoter, company),
  // vindos do GET. Renderizados como 2 cards extras no summaryGrid quando
  // promoterId esta selecionado.
  const [promoterInsuranceSummaries, setPromoterInsuranceSummaries] = useState(
    []
  );
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingPromoters, setLoadingPromoters] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [savingRowId, setSavingRowId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Map<columnKey, Set<string>> — Set contem os valores SELECIONADOS
  // (passam pelo filtro). Ausencia da coluna no Map = sem filtro = tudo.
  const [columnFilters, setColumnFilters] = useState(new Map());
  // Mês FECHADO por cms -> tela READ-ONLY (vê os valores finais da Promotiva,
  // não edita). Definido pelo flag `closed` da /api/commissions/proposals.
  const [readOnly, setReadOnly] = useState(false);
  // `searched` = já houve uma busca para os filtros ATUAIS. Trocar
  // competência/empresa/promotor limpa a tabela (evita mostrar dado de um mês
  // sob outro selecionado). A busca continua manual (botão "Buscar propostas").
  const [searched, setSearched] = useState(false);
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

  // Trocar competência/empresa/promotor -> LIMPA a tabela e o estado da busca
  // anterior (sem auto-refetch; busca segue manual pelo botão). Evita exibir
  // dado de um mês sob outro selecionado.
  useEffect(() => {
    setRows([]);
    setReadOnly(false);
    setSearched(false);
    setSelectedIds(new Set());
    setColumnFilters(new Map());
    setPromoterInsuranceSummaries([]);
  }, [year, month, companyId, promoterId]);

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

      setReadOnly(data?.closed === true);
      setPromoterInsuranceSummaries(data?.promoterInsuranceSummaries || []);
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
      setSearched(true);
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
        return acc;
      },
      { gross: 0, promoterAmount: 0 }
    );
  }, [rows]);

  const filtersActive = columnFilters.size;
  const colSpan = readOnly ? 20 : 21;

  return (
    <div className="rredit">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        {/* ===================== breadcrumb ===================== */}
        <nav className="crumb">
          <a href="/">Visão geral</a>
          <span className="sep">/</span>
          <a href="/promotores">Promotores</a>
          <span className="sep">/</span>
          <span className="cur">Editar comissões</span>
        </nav>

        {/* ===================== HEADER navy ===================== */}
        <header className="header">
          <div className="header-top">
            <div>
              <p className="brand">GRUPO RR CRED</p>
              <h1>Editar comissões</h1>
              <p className="sub">
                <IcoPencil />
                Exceção manual por proposta
              </p>
            </div>

            <div className="hfilters">
              <div className="hf">
                <label>Ano</label>
                <input
                  type="number"
                  className="hin"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </div>

              <div className="hf">
                <label>Mês</label>
                <input
                  type="number"
                  className="hin"
                  min="1"
                  max="12"
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                />
              </div>

              <div className="hf">
                <label>Empresa</label>
                <div className="sel">
                  <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    disabled={loadingCompanies}
                  >
                    <option value="">Todas</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </div>
              </div>

              <div className="hf">
                <label>Promotor</label>
                <div className="sel">
                  <select
                    value={promoterId}
                    onChange={(e) => setPromoterId(e.target.value)}
                    disabled={loadingPromoters}
                  >
                    <option value="">Todos</option>
                    {promoters.map((promoter) => (
                      <option key={promoter.id} value={promoter.id}>
                        {promoter.name}
                      </option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </div>
              </div>

              <button
                type="button"
                className="hsearch"
                onClick={loadRows}
                disabled={loadingRows}
              >
                <IcoSearch />
                {loadingRows ? "Carregando..." : "Buscar propostas"}
              </button>
            </div>
          </div>
        </header>

        {/* ===================== REGRAS desta tela ===================== */}
        <div className="rules">
          <span className="rlab">Regras desta tela</span>
          <span className="rchip">
            <IcoShield />
            Teto promotor <b>5,8%</b>
          </span>
          <span className="rchip">
            <IcoShieldHalf />
            Seguro: <b>repasse por negociação</b>
          </span>
          <span className="rchip">
            <IcoCheckSquare />
            Toda alteração é <b>auditável</b>
          </span>
        </div>

        {/* ===================== mensagens ===================== */}
        {message ? (
          <div className="sbanner ok">
            <span className="bic">
              <IcoCheck />
            </span>
            <div>
              <b>Comissão atualizada</b>
              <span>{message}</span>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="sbanner err">
            <span className="bic">
              <IcoAlertCircle />
            </span>
            <div>
              <b>Não foi possível concluir</b>
              <span>{error}</span>
            </div>
          </div>
        ) : null}

        {/* ===================== KPIs ===================== */}
        <div className="scards">
          <div className="scard">
            <p className="k">
              <span className="ic">
                <IcoDoc />
              </span>
              Propostas
            </p>
            <div className="v num">{String(rows.length)}</div>
            <div className="s">no período</div>
          </div>

          <div className="scard">
            <p className="k">
              <span className="ic">
                <IcoBars />
              </span>
              Base total
            </p>
            <div className="v num">{formatCurrency(totals.gross)}</div>
            <div className="s">valor base contratado</div>
          </div>

          <div className="scard accent">
            <p className="k">
              <span className="ic">
                <IcoMoney />
              </span>
              Comissão promotor
            </p>
            <div className="v num">{formatCurrency(totals.promoterAmount)}</div>
            <div className="s">repasse calculado</div>
          </div>

          {/* FIX-1.E.6.F — cards de seguro Modelo B. So aparecem quando
              um promotor especifico esta filtrado, porque os agregados
              mensais sao por (promoter, company). Em "Todos" nao faz
              sentido somar penetracoes de promotores diferentes. */}
          {(() => {
            if (!promoterId) return null;
            const summary = promoterInsuranceSummaries.find(
              (s) =>
                s.promoter_id === promoterId &&
                (!companyId || s.company_id === companyId)
            );
            if (!summary) return null;

            const penetracaoTxt = formatPercentSuffix(
              summary.insurance_penetration_percent
            );
            const bandTxt = summary.insurance_share_band_label || "—";

            // Valor principal Modelo B: maio/2026+ usa o que foi gravado;
            // abril/2026 usa a projecao calculada (gate=false → banco ainda
            // tem Promotiva total, projecao mostra o repasse real esperado).
            const projetado = summary.insurance_projected_promoter_value;
            const persistido = summary.insurance_commission_value;
            const ativo = summary.insurance_share_scale_active;
            const mainValue = ativo ? persistido ?? 0 : projetado ?? 0;

            return (
              <>
                <div className="scard seg">
                  <span className="segtag">PROMOTOR</span>
                  <p className="k">
                    <span className="ic">
                      <IcoChart />
                    </span>
                    % Penetração
                  </p>
                  <div className="v num">{penetracaoTxt}</div>
                  <div className="s">Faixa: {bandTxt}</div>
                </div>

                <div className="scard seg">
                  <span className="segtag">PROMOTOR</span>
                  <p className="k">
                    <span className="ic">
                      <IcoShield />
                    </span>
                    Comissão seguro promotor
                  </p>
                  <div className="v num">{formatCurrency(mainValue)}</div>
                  {!ativo ? (
                    <div className="s">
                      Gravado atual: {formatCurrency(persistido ?? 0)}
                    </div>
                  ) : null}
                  {!ativo ? (
                    <span className="projbadge">
                      Projetado — abril não recalculado
                    </span>
                  ) : null}
                </div>
              </>
            );
          })()}
        </div>

        {/* ===================== ACTIVE FILTER BANNER ===================== */}
        {filtersActive > 0 ? (
          <div className="fbanner">
            <span className="ic">
              <IcoFunnel />
            </span>
            <div className="txt">
              Mostrando{" "}
              <b>
                {filteredRows.length.toLocaleString("pt-BR")} de{" "}
                {rows.length.toLocaleString("pt-BR")} propostas
              </b>{" "}
              · {filtersActive} filtro{filtersActive === 1 ? "" : "s"} ativo
              {filtersActive === 1 ? "" : "s"}
            </div>
            <button type="button" className="clear" onClick={clearAllFilters}>
              <IcoX />
              Limpar filtros
            </button>
          </div>
        ) : null}

        {/* ===================== READ-ONLY amber banner ===================== */}
        {readOnly ? (
          <div className="robanner">
            <span className="ic">
              <IcoLock />
            </span>
            <div className="txt">
              <b>Mês consolidado via cms.</b> Estes são os valores finais pagos
              pela Promotiva (ground truth) — exibidos em leitura apenas, não
              editáveis. Para ajustar comissões, use um mês em aberto.
            </div>
            <span className="gt">ground truth via cms</span>
          </div>
        ) : null}

        {/* ===================== DENSE TABLE ===================== */}
        <section className="tcard">
          <div className="tcard-head">
            <div className="lt">
              <span
                className="ic"
                style={
                  readOnly
                    ? { background: "var(--amber-bg)", color: "var(--amber-tx)" }
                    : undefined
                }
              >
                {readOnly ? <IcoLock /> : <IcoGrid />}
              </span>
              <div>
                <h2>
                  Propostas · {mesAbrev(month)}/{year}{" "}
                  <span className="soft">
                    — competência {readOnly ? "fechada" : "em aberto"}
                  </span>
                </h2>
                <p className="csub">
                  {readOnly
                    ? "Valores conciliados · % Promotor e ações indisponíveis"
                    : "Edite o % Promotor linha a linha · valores reais"}
                </p>
              </div>
            </div>
            <span className="scrollhint">
              <IcoArrows />
              Role na horizontal · 20 colunas
            </span>
          </div>

          <div className="tscroll">
            <table className="dt">
              <thead>
                <tr>
                  {!readOnly ? (
                    <th className="stk c-chk c">
                      <input
                        type="checkbox"
                        className="ck"
                        checked={headerSelectState === "all"}
                        ref={(el) => {
                          if (el)
                            el.indeterminate = headerSelectState === "some";
                        }}
                        onChange={() => {
                          if (headerSelectState === "all") deselectAllVisible();
                          else selectAllVisible();
                        }}
                        aria-label="Selecionar todos os visíveis"
                        disabled={filteredRows.length === 0}
                      />
                    </th>
                  ) : null}
                  {/* Ordem espelha planilha LUCIANA_MATIAS.xlsx (4.4-fix-1.C). */}
                  <th
                    className="stk c-ct"
                    style={readOnly ? { left: 0 } : undefined}
                  >
                    Contrato
                  </th>
                  <th className="r">Valor bruto</th>
                  <th className="r">Valor líquido</th>
                  <th className="r">Parcela</th>
                  <th>
                    <span className="th-f">
                      Agência
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
                  <th>Chave J</th>
                  <th>
                    <span className="th-f">
                      Promotor(a)
                      <ColumnFilter
                        columnLabel="Promotor"
                        values={getDistinctValuesForColumn(
                          "assigned_promoter_id"
                        )}
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
                  <th>Data contratação</th>
                  <th className="r">Tx juros</th>
                  <th>
                    <span className="th-f">
                      Descrição do produto
                      <ColumnFilter
                        columnLabel="Descricao"
                        values={getDistinctValuesForColumn(
                          "product_description"
                        )}
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
                  <th className="r">
                    <span className="th-f">
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
                  <th className="r">Comissão PF</th>
                  <th className="c">
                    <span className="th-f">
                      Restrição SRCC
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
                  <th className="r">Valor seguro</th>
                  {/* PADRONIZACAO: "Comissao seguro base" -> "Comissao seguro" */}
                  <th className="r">Comissão seguro</th>
                  {/* NOVA col 17 (4.4-fix-1.E D2): % Penetracao mensal de
                      seguro, constante por promotor. Read-only, sem filtro. */}
                  <th className="r">% Penetração</th>
                  <th>
                    <span className="th-f">
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
                  <th className="r">Comissão promotor</th>
                  <th className="r">Com. seguro prom.</th>
                  <th className="c">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={colSpan}>
                      <span className="empty-art">
                        <IcoSearch />
                      </span>
                      <span className="empty-t">
                        {!searched
                          ? "Nenhuma proposta carregada"
                          : rows.length === 0
                            ? "0 propostas para este filtro"
                            : "Nenhuma proposta corresponde aos filtros"}
                      </span>
                      <span className="empty-s">
                        {!searched
                          ? `Selecione os filtros e clique em "Buscar propostas" para carregar ${
                              promoters.find((p) => p.id === promoterId)?.name ||
                              "os promotores selecionados"
                            } em ${String(month).padStart(2, "0")}/${year}. A busca é sempre manual.`
                          : rows.length === 0
                            ? "Nenhuma proposta encontrada para os filtros aplicados. Ajuste período ou promotor."
                            : "Nenhuma proposta corresponde aos filtros atuais."}
                      </span>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const isSaving = savingRowId === row.id;
                    const isSelected = selectedIds.has(row.id);

                    return (
                      <tr key={row.id} className={isSelected ? "sel" : undefined}>
                        {!readOnly ? (
                          <td className="stk c-chk c">
                            <input
                              type="checkbox"
                              className="ck"
                              checked={isSelected}
                              onChange={() => toggleRow(row.id)}
                              aria-label={`Selecionar proposta ${row.proposal_number || row.id}`}
                            />
                          </td>
                        ) : null}
                        {/* Ordem da planilha LUCIANA_MATIAS.xlsx (4.4-fix-1.C) */}
                        <td
                          className="stk c-ct"
                          style={readOnly ? { left: 0 } : undefined}
                        >
                          <span className="ct">{row.contract_number || "-"}</span>
                        </td>
                        <td className="r">
                          {formatCurrency(row.gross_value || 0)}
                        </td>
                        <td className="r">{formatCurrency(row.net_value || 0)}</td>
                        <td className="r">{row.installment_count ?? "-"}</td>
                        <td>{row.agency_code || "-"}</td>
                        <td className="chavej">{row.j_key || "-"}</td>
                        <td>{row.promoter_name || "-"}</td>
                        <td>{formatDateBR(row.contract_date)}</td>
                        <td className="r">{formatPercentSuffix(row.interest_rate)}</td>
                        <td className="prod">{row.product_description || "-"}</td>
                        <td className="r">
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
                        <td className="r">
                          {/* FIX-1.D.8 (calculo): COMISSAO PF = net x min(a_vista, 5.8) / 100,
                              derivado client-side. NAO le row.promoter_commission_amount do
                              banco — esse campo armazena valor POS-share gravado por
                              /api/calculate/monthly e nao corresponde ao COMISSAO PF puro
                              (visao do promotor antes do share). Col 19 usa mesma cascata e
                              multiplica por sharePct. */}
                          {(() => {
                            const net = Number(row.net_value ?? 0);
                            const aVista = Number(row.a_vista_percent ?? 0);
                            const aVistaClamped = Math.min(
                              Math.max(aVista, 0),
                              5.8
                            );
                            const comissaoPF = (net * aVistaClamped) / 100;
                            return comissaoPF > 0
                              ? formatCurrency(comissaoPF)
                              : "—";
                          })()}
                        </td>
                        <td className="c">
                          {srccRestricted(row.srcc_restriction) ? (
                            <span className="badge red">
                              <span className="d" />
                              {row.srcc_restriction || "Nao"}
                            </span>
                          ) : (
                            <span className="badge neu">
                              {row.srcc_restriction || "Nao"}
                            </span>
                          )}
                        </td>
                        <td className="r">
                          {Number(row.insurance_value || 0) > 0
                            ? formatCurrency(row.insurance_value)
                            : "—"}
                        </td>
                        <td className="r">
                          {Number(row.insurance_commission_amount || 0) > 0
                            ? formatCurrency(row.insurance_commission_amount)
                            : "—"}
                        </td>
                        {/* NOVA col 17 (4.4-fix-1.E D2): % Penetracao
                            mensal de seguro, constante por promotor. */}
                        <td className="r">
                          {formatPercentSuffix(row.insurance_penetration_percent)}
                        </td>
                        <td>
                          {/* Dia 4.5 Etapa B: input editavel agora alimenta
                              share_percent_override (escala 0..100 na UI,
                              0..1 no DB). Badge mostra a fonte do valor
                              (override / profile / default) quando nao ha
                              override pendente do usuario. */}
                          {readOnly ? (
                            <span className="dash">—</span>
                          ) : (
                            <div className="promcell">
                              <span className="pin-wrap">
                                <input
                                  type="number"
                                  step="0.01"
                                  className="pin"
                                  value={row.share_percent_input}
                                  onChange={(e) =>
                                    updateRowValue(
                                      row.id,
                                      "share_percent_input",
                                      e.target.value
                                    )
                                  }
                                  aria-label="% Promotor (editavel)"
                                />
                                <span className="pct">%</span>
                              </span>
                              {(() => {
                                const badge = shareBadge(
                                  row.share_percent_source,
                                  row.share_percent_override,
                                  row.company_received_percent
                                );
                                return badge ? (
                                  <span
                                    className={`sbadge ${badge.cls}`}
                                    title={badge.title}
                                  >
                                    {badge.label}
                                  </span>
                                ) : null;
                              })()}
                            </div>
                          )}
                        </td>
                        <td className="r strong">
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
                              dessincronizado com a cascata viva).
                              READ-ONLY (mês fechado): mostra a comissão do cms
                              (promoter_credit, ground truth pago), não a cascata. */}
                          {readOnly ? (
                            Number(row.promoter_commission_amount || 0) > 0 ? (
                              <span className="paid">
                                {formatCurrency(row.promoter_commission_amount)}
                                <span className="cmstag">pago · cms</span>
                              </span>
                            ) : (
                              "—"
                            )
                          ) : (
                            (() => {
                              const draft = row.share_percent_input;
                              const netValue = Number(row.net_value ?? 0);
                              const aVista = Number(row.a_vista_percent ?? 0);
                              const aVistaClamped = Math.min(
                                Math.max(aVista, 0),
                                5.8
                              );
                              const comissaoPF = (netValue * aVistaClamped) / 100;
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
                            })()
                          )}
                        </td>
                        <td className="r">
                          {row.promoter_insurance_amount == null ||
                          Number(row.promoter_insurance_amount) === 0
                            ? "—"
                            : formatCurrency(row.promoter_insurance_amount)}
                        </td>
                        <td className="c">
                          {readOnly ? (
                            <span className="dash">—</span>
                          ) : (
                            <div className="racts">
                              <button
                                type="button"
                                className={`rbtn save${isSaving ? " saving" : ""}`}
                                onClick={() => saveRow(row)}
                                disabled={isSaving || !row.assigned_promoter_id}
                              >
                                {isSaving ? "Salvando..." : "Salvar"}
                              </button>
                              <button
                                type="button"
                                className="rbtn clear"
                                onClick={() => clearManualRule(row)}
                                disabled={isSaving}
                              >
                                Limpar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {!readOnly ? (
        <BulkActionBar
          selectedItems={selectedItems}
          onClearSelection={clearSelection}
          onApplied={async () => {
            clearSelection();
            await loadRows();
          }}
        />
      ) : null}
    </div>
  );
}

// ============================================================
// Helpers de formatacao (preservados do original).
// ============================================================
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

const MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
function mesAbrev(m) {
  const idx = Number(m) - 1;
  return MESES[idx] || String(m);
}

// Dia 4.5 Etapa B: classe de badge para a coluna "% Promotor" indicando a
// fonte do valor (override manual, perfil, default). Retorna null quando o
// estado e "default sem destaque" — UX mais limpa para o caso comum.
// (Mesma logica/precedencia do original; agora devolve {label, cls, title}
//  em vez de estilos inline.)
function shareBadge(source, override, companyReceivedPercent) {
  // FIX-1.E.3: proposta com Status=Producao mas sem regra TRP vigente
  // (taxa/prazo fora das faixas Promotiva). Promotor vendeu mas
  // Promotiva nao comissiona. Candidata a auditoria recuperatoria.
  // Tem precedencia sobre badges de perfil/override porque sinaliza
  // que o calculo de share nao se aplica (nao ha base PF).
  if (
    companyReceivedPercent === null ||
    companyReceivedPercent === undefined ||
    Number(companyReceivedPercent) === 0
  ) {
    return {
      label: "SEM REGRA TRP",
      cls: "semregra",
      title:
        "Promotiva nao comissionou esta proposta (taxa/prazo fora das " +
        "faixas TRP vigente). Candidata a auditoria mensal.",
    };
  }

  // Override por proposta (manual) tem precedencia visual.
  if (override !== null && override !== undefined && String(override) !== "") {
    return {
      label: "Manual",
      cls: "manual",
      title: "Override por proposta (sobrescreve perfil)",
    };
  }

  const src = String(source || "");
  if (src === "OVERRIDE_PROPOSTA") {
    return {
      label: "Manual",
      cls: "manual",
      title: "Override por proposta",
    };
  }
  if (src === "PROFILE_CLT_FIXO") {
    return {
      label: "CLT",
      cls: "neu",
      title: "Perfil CLT_FIXO (% fixo de funcionario registrado)",
    };
  }
  if (src === "PROFILE_ACORDO_FIXO") {
    return {
      label: "Acordo fixo",
      cls: "neu",
      title: "Perfil ACORDO_FIXO (% comercial fixo)",
    };
  }
  if (src.startsWith("PROFILE_ENTRANTE_")) {
    return {
      label: "Entrante",
      cls: "neu",
      title: `Perfil entrante (escala por volume mensal): ${src}`,
    };
  }
  if (src.startsWith("PROFILE_VARIAVEL")) {
    return {
      label: "Variavel",
      cls: "neu",
      title: "Acordo variavel — sem override -> fallback default 58,33%",
    };
  }
  // PROFILE_DEFAULT, DEFAULT_FALLBACK, DEFAULT_NO_PROFILE: sem badge
  // (caso comum — visual mais limpo).
  return null;
}

// 4.4-fix-1.C: "Sim" -> vermelho de aviso; demais ("Nao", "Nao se aplica") -> neutro.
function srccRestricted(label) {
  return String(label || "").trim().toUpperCase() === "SIM";
}

// ============================================================
// Icones inline (stroke currentColor — herdam cor do contexto).
// ============================================================
function IcoPencil() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function IcoSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function IcoShield() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z" />
    </svg>
  );
}
function IcoShieldHalf() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6c0 5 4 7 8 9 4-2 8-4 8-9Z" />
      <path d="M9 12h6" />
    </svg>
  );
}
function IcoCheckSquare() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function IcoCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function IcoAlertCircle() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v5" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
function IcoDoc() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v5h5" />
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    </svg>
  );
}
function IcoBars() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M3 12h18M3 18h12" />
    </svg>
  );
}
function IcoMoney() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
function IcoChart() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="m7 14 4-4 3 3 4-5" />
    </svg>
  );
}
function IcoFunnel() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18l-7 8v5l-4 2v-7z" />
    </svg>
  );
}
function IcoX() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function IcoLock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function IcoGrid() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h18v18H3z" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </svg>
  );
}
function IcoArrows() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 7 4 12l4 5M16 7l4 5-4 5" />
    </svg>
  );
}

// ============================================================
// CSS scoped (.rredit) — padrao das telas .rrfin/.rrprom/.rrproj/.rrimp.
// ============================================================
const CSS = `
.rredit{
  --navy:#0F1F4A; --navy-deep:#0B1838; --navy-bar:#1E3066;
  --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A; --gold-soft:#E7BE6A;
  --blue:#0d4de3; --blue-bg:#EAF0FB; --blue-bd:#D5E0F4;
  --green:#16A34A; --green-tx:#15803D;
  --amber:#F59E0B; --amber-tx:#B45309; --amber-bg:#FBF1DC; --amber-bd:#EAD7A6;
  --red:#DC2626; --red-tx:#B91C1C; --red-bg:#FBECEB;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --neu:#F1F3F7;
  --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);
  font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.45;
}
.rredit *{box-sizing:border-box;}
.rredit .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rredit .wrap{max-width:1280px;margin:0 auto;padding:30px 28px 120px;display:flex;flex-direction:column;gap:20px;}

/* breadcrumb */
.rredit .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:0 2px -2px;flex-wrap:wrap;}
.rredit .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rredit .crumb a:hover{color:var(--navy);}
.rredit .crumb .sep{color:#C2C8D2;}
.rredit .crumb .cur{color:var(--ink);font-weight:600;}

/* HEADER navy scoped */
.rredit .header{background:var(--navy);border-radius:var(--r-lg);padding:26px 30px 28px;color:#fff;position:relative;overflow:hidden;}
.rredit .header::after{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--gold),rgba(214,161,63,0));opacity:.55;}
.rredit .header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:26px;flex-wrap:wrap;}
.rredit .brand{font-size:11.5px;font-weight:600;letter-spacing:.18em;color:var(--yellow);margin:0 0 7px;}
.rredit .header h1{font-size:26px;font-weight:600;letter-spacing:-.01em;margin:0;color:#fff;}
.rredit .header .sub{font-size:12.5px;color:#9DA9C6;margin:9px 0 0;display:flex;align-items:center;gap:8px;}
.rredit .header .sub svg{display:block;}

/* header filters (translucent pills) */
.rredit .hfilters{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;}
.rredit .hf{display:flex;flex-direction:column;gap:6px;}
.rredit .hf label{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8C98B6;padding-left:2px;}
.rredit .hf .sel{position:relative;display:flex;align-items:center;}
.rredit .hf select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#E9EDF6;padding:9px 32px 9px 13px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;min-width:120px;}
.rredit .hf select:focus{outline:none;border-color:rgba(255,255,255,.4);}
.rredit .hf select:disabled{opacity:.55;cursor:default;}
.rredit .hf select option{color:#16203A;}
.rredit .hf .hin{appearance:none;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#E9EDF6;padding:9px 13px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:600;width:88px;}
.rredit .hf .hin:focus{outline:none;border-color:rgba(255,255,255,.4);}
.rredit .hf .chev{position:absolute;right:13px;pointer-events:none;color:#9DA9C6;font-size:10px;}
.rredit .hsearch{display:inline-flex;align-items:center;gap:9px;background:var(--yellow);color:var(--navy);border:none;border-radius:999px;padding:11px 20px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:filter .14s,transform .12s;white-space:nowrap;height:38px;}
.rredit .hsearch:hover{filter:brightness(1.04);transform:translateY(-1px);}
.rredit .hsearch:disabled{opacity:.6;cursor:default;transform:none;filter:none;}
.rredit .hsearch svg{display:block;}

/* REGRAS desta tela — light strip of chips */
.rredit .rules{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 4px;margin:-4px 0 -2px;}
.rredit .rules .rlab{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);}
.rredit .rchip{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:500;color:var(--ink-2);background:#fff;border:1px solid var(--bd);padding:7px 13px;border-radius:999px;white-space:nowrap;}
.rredit .rchip svg{color:var(--gold-deep);flex:none;}
.rredit .rchip b{color:var(--ink);font-weight:600;}

/* KPIs */
.rredit .scards{display:grid;grid-template-columns:repeat(5,1fr);gap:13px;}
.rredit .scard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-md);box-shadow:var(--shadow);padding:17px 19px 18px;display:flex;flex-direction:column;position:relative;overflow:hidden;}
.rredit .scard .k{font-size:11.5px;font-weight:500;color:var(--ink-3);margin:0 0 10px;display:flex;align-items:center;gap:8px;}
.rredit .scard .k .ic{width:22px;height:22px;border-radius:6px;background:var(--neu);color:var(--navy);display:grid;place-items:center;flex:none;}
.rredit .scard .v{font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:1;color:var(--ink);}
.rredit .scard .s{font-size:11.5px;margin-top:8px;color:var(--ink-3);}
.rredit .scard.accent{background:var(--navy);border-color:var(--navy);}
.rredit .scard.accent::after{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--gold);}
.rredit .scard.accent .k{color:#9DA9C6;}
.rredit .scard.accent .k .ic{background:rgba(255,255,255,.08);color:var(--yellow);}
.rredit .scard.accent .v{color:#fff;}
.rredit .scard.accent .s{color:#8C98B6;}
.rredit .scard.seg{border-style:dashed;border-color:#C9D4E8;background:#FBFCFE;}
.rredit .scard.seg .k .ic{background:var(--blue-bg);color:var(--blue);}
.rredit .scard .segtag{position:absolute;top:13px;right:14px;font-size:9px;font-weight:700;letter-spacing:.06em;color:var(--blue);background:var(--blue-bg);border:1px solid var(--blue-bd);padding:2px 7px;border-radius:999px;}
.rredit .scard .projbadge{display:inline-block;align-self:flex-start;margin-top:8px;padding:3px 9px;border-radius:999px;font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;background:#FEF3C7;color:#92400E;border:1px solid rgba(146,64,14,.30);}

/* active filter banner */
.rredit .fbanner{display:flex;align-items:center;gap:13px;background:var(--blue-bg);border:1px solid var(--blue-bd);border-radius:var(--r-md);padding:12px 16px;flex-wrap:wrap;}
.rredit .fbanner .ic{flex:none;width:28px;height:28px;border-radius:8px;background:#fff;border:1px solid var(--blue-bd);display:grid;place-items:center;color:var(--blue);}
.rredit .fbanner .txt{font-size:12.5px;color:var(--ink-2);flex:1;min-width:180px;}
.rredit .fbanner .txt b{color:var(--ink);font-weight:700;}
.rredit .fbanner .clear{display:inline-flex;align-items:center;gap:6px;background:none;border:none;font-family:inherit;font-size:12px;font-weight:600;color:var(--blue);cursor:pointer;padding:6px 8px;border-radius:8px;transition:background .14s;}
.rredit .fbanner .clear:hover{background:rgba(13,77,227,.08);}

/* read-only amber banner */
.rredit .robanner{display:flex;align-items:center;gap:13px;background:var(--amber-bg);border:1px solid var(--amber-bd);border-radius:var(--r-md);padding:13px 17px;flex-wrap:wrap;}
.rredit .robanner .ic{flex:none;width:30px;height:30px;border-radius:9px;background:#fff;border:1px solid var(--amber-bd);display:grid;place-items:center;color:var(--amber-tx);}
.rredit .robanner .txt{font-size:12.5px;color:var(--ink-2);flex:1;min-width:200px;}
.rredit .robanner .txt b{color:var(--amber-tx);font-weight:700;}
.rredit .robanner .gt{font-size:10.5px;font-weight:700;letter-spacing:.04em;color:var(--amber-tx);background:#fff;border:1px solid var(--amber-bd);padding:4px 10px;border-radius:999px;white-space:nowrap;}

/* status banners (sucesso / erro) */
.rredit .sbanner{width:100%;display:flex;align-items:flex-start;gap:11px;border-radius:var(--r-md);padding:13px 15px;font-size:12.5px;line-height:1.45;}
.rredit .sbanner .bic{flex:none;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;margin-top:1px;}
.rredit .sbanner b{font-weight:700;display:block;margin-bottom:2px;}
.rredit .sbanner.ok{background:rgba(22,163,74,.07);border:1px solid rgba(22,163,74,.24);color:var(--green-tx);}
.rredit .sbanner.ok .bic{background:rgba(22,163,74,.13);color:var(--green);}
.rredit .sbanner.ok span{color:var(--ink-2);}
.rredit .sbanner.err{background:var(--red-bg);border:1px solid #F1CDCB;color:var(--red-tx);}
.rredit .sbanner.err .bic{background:rgba(220,38,38,.12);color:var(--red);}
.rredit .sbanner.err span{color:var(--ink-2);}

/* ============ DENSE TABLE ============ */
.rredit .tcard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden;position:relative;}
.rredit .tcard-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 22px 15px;border-bottom:1px solid var(--bd-soft);flex-wrap:wrap;}
.rredit .tcard-head .lt{display:flex;align-items:center;gap:12px;}
.rredit .tcard-head .lt .ic{width:32px;height:32px;border-radius:9px;background:var(--neu);color:var(--navy);display:grid;place-items:center;flex:none;}
.rredit .tcard-head h2{font-size:15px;font-weight:600;margin:0;color:var(--ink);}
.rredit .tcard-head h2 .soft{color:var(--ink-3);font-weight:500;}
.rredit .tcard-head .csub{font-size:12px;color:var(--ink-3);margin:2px 0 0;}
.rredit .tcard-head .scrollhint{font-size:11px;color:var(--ink-3);display:inline-flex;align-items:center;gap:7px;}
.rredit .tcard-head .scrollhint svg{color:var(--ink-3);}

.rredit .tscroll{overflow-x:auto;overflow-y:visible;}
.rredit table.dt{border-collapse:separate;border-spacing:0;min-width:2280px;width:100%;}
.rredit table.dt thead th{position:sticky;top:0;z-index:5;background:#FAFBFC;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3);text-align:left;padding:11px 14px;border-bottom:1px solid var(--bd);white-space:nowrap;vertical-align:bottom;}
.rredit table.dt thead th.r{text-align:right;}
.rredit table.dt thead th.c{text-align:center;}
.rredit table.dt tbody td{padding:11px 14px;border-bottom:1px solid var(--bd);font-size:12.5px;color:var(--ink-2);white-space:nowrap;vertical-align:middle;background:#fff;}
.rredit table.dt tbody tr:last-child td{border-bottom:none;}
.rredit table.dt tbody td.r{text-align:right;font-variant-numeric:tabular-nums;}
.rredit table.dt tbody td.c{text-align:center;}
.rredit table.dt tbody td.strong{color:var(--ink);font-weight:600;}
.rredit table.dt tbody tr:hover td{background:#FBFCFD;}

/* sticky left columns */
.rredit .stk{position:sticky;z-index:6;}
.rredit thead th.stk{z-index:7;background:#FAFBFC;}
.rredit td.stk{background:#fff;}
.rredit .c-chk{left:0;width:46px;min-width:46px;padding-left:16px;padding-right:0;}
.rredit .c-ct{left:46px;width:118px;min-width:118px;box-shadow:1px 0 0 var(--bd);}
.rredit thead th.c-ct{box-shadow:1px 0 0 var(--bd);}
.rredit table.dt tbody tr:hover td.stk{background:#FBFCFD;}
.rredit table.dt tbody tr.sel td{background:#F2F6FF;}
.rredit table.dt tbody tr.sel td.stk{background:#F2F6FF;}

/* header with filter button (.th-f wraps label + ColumnFilter button) */
.rredit .th-f{display:inline-flex;align-items:center;gap:4px;}

/* contract cell */
.rredit .ct{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;}
.rredit .chavej{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--ink-2);letter-spacing:-.01em;}
.rredit .prod{color:var(--ink);font-weight:500;}

/* checkbox */
.rredit .ck{appearance:none;-webkit-appearance:none;width:16px;height:16px;border:1.5px solid #C2CAD8;border-radius:5px;background:#fff;cursor:pointer;position:relative;flex:none;transition:border-color .12s,background .12s;}
.rredit .ck:hover{border-color:var(--navy);}
.rredit .ck:checked{background:var(--navy);border-color:var(--navy);}
.rredit .ck:checked::after{content:"";position:absolute;left:4.5px;top:1.5px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg);}
.rredit .ck:disabled{opacity:.4;cursor:default;}

/* % Promotor editable input + badge */
.rredit .promcell{display:flex;align-items:center;gap:8px;}
.rredit .pin-wrap{position:relative;display:inline-flex;align-items:center;}
.rredit .pin{width:70px;font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;color:var(--ink);text-align:right;border:1.5px solid #B9C9F0;border-radius:8px;background:#F7FAFF;padding:7px 22px 7px 9px;outline:none;transition:border-color .14s,box-shadow .14s,background .14s;}
.rredit .pin:hover{border-color:var(--blue);}
.rredit .pin:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(13,77,227,.12);background:#fff;}
.rredit .pin::-webkit-outer-spin-button,.rredit .pin::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
.rredit .pin{-moz-appearance:textfield;}
.rredit .pin-wrap .pct{position:absolute;right:8px;font-size:11px;font-weight:600;color:var(--ink-3);pointer-events:none;}

/* source badge next to input */
.rredit .sbadge{font-size:9.5px;font-weight:700;letter-spacing:.03em;padding:3px 7px;border-radius:999px;white-space:nowrap;border:1px solid transparent;}
.rredit .sbadge.manual{color:var(--blue);background:var(--blue-bg);border-color:var(--blue-bd);}
.rredit .sbadge.semregra{color:var(--red);background:var(--red-bg);border-color:#F3C9C6;}
.rredit .sbadge.neu{color:var(--ink-3);background:var(--neu);border-color:var(--bd);}

/* SRCC + generic badge */
.rredit .badge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;border:1px solid transparent;}
.rredit .badge.red{color:var(--red);background:var(--red-bg);border-color:#F3C9C6;}
.rredit .badge.red .d{width:5px;height:5px;border-radius:50%;background:var(--red);}
.rredit .badge.neu{color:var(--ink-3);background:var(--neu);border-color:var(--bd);}

/* row actions */
.rredit .racts{display:inline-flex;align-items:center;gap:7px;}
.rredit .rbtn{appearance:none;font-family:inherit;font-size:11px;font-weight:600;border-radius:8px;padding:6px 11px;cursor:pointer;white-space:nowrap;transition:background .14s,border-color .14s,color .14s,transform .12s;border:1px solid transparent;}
.rredit .rbtn.save{background:var(--navy);color:#fff;}
.rredit .rbtn.save:hover{background:#16285C;transform:translateY(-1px);}
.rredit .rbtn.save.saving{background:var(--navy-bar);cursor:default;transform:none;}
.rredit .rbtn.save:disabled{opacity:.5;cursor:default;transform:none;}
.rredit .rbtn.clear{background:#fff;border-color:var(--bd);color:var(--ink-2);}
.rredit .rbtn.clear:hover{background:#F4F6F9;border-color:#C6CEDE;color:var(--navy);}
.rredit .rbtn.clear:disabled{opacity:.5;cursor:default;}
.rredit .dash{color:var(--ink-3);font-weight:500;}

/* read-only paid value */
.rredit .paid{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums;}
.rredit .paid .cmstag{display:block;font-size:9.5px;font-weight:600;letter-spacing:.04em;color:var(--green-tx);margin-top:1px;}

/* empty state cell */
.rredit td.empty{padding:46px 24px;text-align:center;}
.rredit td.empty .empty-art{display:inline-grid;place-items:center;width:46px;height:46px;border-radius:13px;background:linear-gradient(160deg,#F4F6FA,#E9EDF4);border:1px solid var(--bd);color:var(--navy);box-shadow:inset 0 1px 0 #fff;margin-bottom:12px;}
.rredit td.empty .empty-t{display:block;font-size:13px;font-weight:600;color:var(--ink);}
.rredit td.empty .empty-s{display:block;font-size:11.5px;color:var(--ink-3);margin-top:5px;line-height:1.5;max-width:520px;margin-left:auto;margin-right:auto;white-space:normal;}

@media (max-width:1100px){
  .rredit .scards{grid-template-columns:repeat(3,1fr);}
}
@media (max-width:680px){
  .rredit .wrap{padding:20px 14px 120px;}
  .rredit .header{padding:22px 18px 22px;}
  .rredit .header h1{font-size:21px;}
  .rredit .scards{grid-template-columns:1fr 1fr;}
  .rredit .hfilters{width:100%;}
}
`;
