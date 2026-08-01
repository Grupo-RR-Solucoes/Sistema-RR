"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { UiStyles, HeaderNavy, KpiBand, Table } from "@/components/ui";

// Redesign (.rrcad): camada visual reescrita para o padrao scoped novo
// (header navy, chips, KPIs .scard, abas pill, tabelas claras, form aside).
// Funcionalidades novas sobre a MESMA API /api/cadastros (sem endpoint novo):
//   - Busca client-side por aba.
//   - Filtro Ativos|Inativos|Todos (default Ativos), sobre o `active` do GET.
//   - Edicao: botao Editar abre o form preenchido e o Salvar manda o payload
//     COM id (reusa os *_upsert -> branch if(id) = UPDATE no backend).
//   - Toggle "Marcar como Master" no promotor (grava is_master).
// PRESERVADO: auditoria (writeAudit em toda action), soft-delete (toggle_*
// active=false/true, nunca hard-delete), guard socio+funcionario, KPI de
// promotores ativos excluindo master, identificadores MCI/Coban, vinculo
// chave->promotor e tipos INDIVIDUAL/MASTER. Na edicao, carregamos os campos
// de status (active/status/dismissed_at/group_code/display_name) inalterados
// para o upsert NAO reativar nem zerar nada sem querer.

type Identifier = {
  id: string;
  mci?: string | null;
  coban_code?: string | null;
  identifier_type?: string | null;
  active?: boolean | null;
};

type Company = {
  id: string;
  name: string;
  legal_name?: string | null;
  cnpj: string;
  group_name?: string | null;
  group_code?: string | null;
  active?: boolean | null;
  identifiers: Identifier[];
  promoters_count: number;
  active_promoters_count: number;
};

type Promoter = {
  id: string;
  company_id?: string | null;
  company_name: string;
  company_cnpj: string;
  name: string;
  status?: string | null;
  active?: boolean | null;
  is_master?: boolean | null;
  hired_at?: string | null;
  dismissed_at?: string | null;
  notes?: string | null;
  estado?: "AL" | "SE" | "PE" | "BA" | null;
  estado_confirmado?: boolean | null;
  keys: Array<{ id: string; j_key: string; key_type?: string | null; active?: boolean | null }>;
};

type JKey = {
  id: string;
  company_id?: string | null;
  company_name: string;
  promoter_id?: string | null;
  promoter_name: string;
  j_key: string;
  key_type?: string | null;
  active?: boolean | null;
  display_name?: string | null;
};

type CadastroPayload = {
  summary: {
    companies: number;
    activeCompanies: number;
    promoters: number;
    activePromoters: number;
    jKeys: number;
    activeJKeys: number;
    masterKeys: number;
    identifiers: number;
  };
  companies: Company[];
  promoters: Promoter[];
  jKeys: JKey[];
};

const emptyPayload: CadastroPayload = {
  summary: {
    companies: 0,
    activeCompanies: 0,
    promoters: 0,
    activePromoters: 0,
    jKeys: 0,
    activeJKeys: 0,
    masterKeys: 0,
    identifiers: 0,
  },
  companies: [],
  promoters: [],
  jKeys: [],
};

type Tab = "promotores" | "empresas" | "chaves";
type StatusFilter = "ativos" | "inativos" | "todos";

const isActive = (v?: boolean | null) => v !== false;

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

function fmtCnpj(value?: string | null) {
  const d = String(value || "").replace(/\D/g, "");
  if (d.length !== 14) return value || "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export default function CadastrosPage() {
  const [data, setData] = useState<CadastroPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState("");
  const [toast, setToast] = useState("");

  const [activeTab, setActiveTab] = useState<Tab>("promotores");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ativos");

  // ---- forms (cada um carrega `id` quando em modo edicao + campos de status
  // que o upsert exige preservar) ----
  const blankCompany = {
    id: "" as string,
    name: "",
    cnpj: "",
    legalName: "",
    groupName: "Grupo RR",
    groupCode: "",
    active: true,
  };
  const blankPromoter = {
    id: "" as string,
    companyId: "",
    name: "",
    hiredAt: "",
    notes: "",
    isMaster: false,
    active: true,
    status: "ACTIVE",
    dismissedAt: "" as string | null,
    estado: "" as string,
  };
  const blankJKey = {
    id: "" as string,
    companyId: "",
    promoterId: "",
    jKey: "",
    keyType: "INDIVIDUAL",
    displayName: "" as string | null,
    active: true,
  };
  const blankIdentifier = { companyId: "", mci: "", cobanCode: "" };

  const [companyForm, setCompanyForm] = useState(blankCompany);
  const [promoterForm, setPromoterForm] = useState(blankPromoter);
  const [jKeyForm, setJKeyForm] = useState(blankJKey);
  const [identifierForm, setIdentifierForm] = useState(blankIdentifier);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/cadastros");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Erro ao carregar cadastros.");
      setData(payload || emptyPayload);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar cadastros.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function postAction(
    body: Record<string, unknown>,
    successMessage: string,
    toastMessage?: string
  ): Promise<boolean> {
    try {
      setSubmitting(String(body.action || ""));
      setError("");
      setNotice("");
      const response = await fetch("/api/cadastros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Erro ao salvar cadastro.");
      await loadData();
      setNotice(successMessage);
      if (toastMessage) showToast(toastMessage);
      return true;
    } catch (err: any) {
      setError(err.message || "Erro ao salvar cadastro.");
      return false;
    } finally {
      setSubmitting("");
    }
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    setQuery("");
    setStatus("ativos");
    setNotice("");
    setError("");
  }

  // ---------- COMPANY ----------
  function newCompany() {
    setCompanyForm(blankCompany);
  }
  function editCompany(c: Company) {
    setCompanyForm({
      id: c.id,
      name: c.name || "",
      cnpj: c.cnpj || "",
      legalName: c.legal_name || "",
      groupName: c.group_name || "Grupo RR",
      groupCode: c.group_code || "",
      active: isActive(c.active),
    });
  }
  async function submitCompany(e: FormEvent) {
    e.preventDefault();
    const editing = Boolean(companyForm.id);
    const ok = await postAction(
      {
        action: "company_upsert",
        id: companyForm.id || undefined,
        name: companyForm.name,
        cnpj: companyForm.cnpj,
        legalName: companyForm.legalName,
        groupName: companyForm.groupName,
        groupCode: companyForm.groupCode || undefined,
        active: companyForm.active,
      },
      editing ? "Empresa atualizada com sucesso." : "Empresa cadastrada com sucesso.",
      editing ? "Empresa atualizada" : "Empresa cadastrada"
    );
    if (ok) newCompany();
  }

  // ---------- IDENTIFIER (criar) ----------
  async function submitIdentifier(e: FormEvent) {
    e.preventDefault();
    const ok = await postAction(
      {
        action: "identifier_upsert",
        companyId: identifierForm.companyId,
        mci: identifierForm.mci,
        cobanCode: identifierForm.cobanCode,
      },
      "Identificador salvo com sucesso.",
      "Identificador salvo"
    );
    if (ok) setIdentifierForm(blankIdentifier);
  }

  // ---------- PROMOTER ----------
  function newPromoter() {
    setPromoterForm(blankPromoter);
  }
  function editPromoter(p: Promoter) {
    setPromoterForm({
      id: p.id,
      companyId: p.company_id || "",
      name: p.name || "",
      hiredAt: p.hired_at ? String(p.hired_at).slice(0, 10) : "",
      notes: p.notes || "",
      isMaster: p.is_master === true,
      active: isActive(p.active),
      status: p.status || (isActive(p.active) ? "ACTIVE" : "DISMISSED"),
      dismissedAt: p.dismissed_at ? String(p.dismissed_at).slice(0, 10) : null,
      estado: p.estado ?? "",
    });
  }
  async function submitPromoter(e: FormEvent) {
    e.preventDefault();
    const editing = Boolean(promoterForm.id);
    const ok = await postAction(
      {
        action: "promoter_upsert",
        id: promoterForm.id || undefined,
        companyId: promoterForm.companyId || null,
        name: promoterForm.name,
        status: promoterForm.status,
        active: promoterForm.active,
        isMaster: promoterForm.isMaster,
        hiredAt: promoterForm.hiredAt || null,
        dismissedAt: promoterForm.dismissedAt || null,
        notes: promoterForm.notes || null,
        estado: promoterForm.estado || null,
      },
      editing ? "Promotor atualizado com sucesso." : "Promotor salvo com sucesso.",
      editing ? "Promotor atualizado" : "Promotor cadastrado"
    );
    if (ok) newPromoter();
  }

  // ---------- ESTADO GERENCIAL (revisao dos promotores) ----------
  const [soRevisar, setSoRevisar] = useState(false);
  const ESTADOS = [
    { v: "AL", l: "Alagoas" },
    { v: "SE", l: "Sergipe" },
    { v: "PE", l: "Pernambuco" },
    { v: "BA", l: "Bahia" },
  ] as const;
  // Estado IMPLICITO pelo CNPJ (nome da empresa) — SO para o selo "≠ CNPJ". AL/PE apenas.
  function estadoDaEmpresa(companyName: string | null | undefined): string | null {
    const n = String(companyName ?? "").toUpperCase();
    if (n.includes("ALAGOAS")) return "AL";
    if (n.includes("PERNAMBUCO")) return "PE";
    return null;
  }
  // Salva o estado de UM promotor (edicao inline = confirma aquele; action dedicada).
  async function saveEstado(p: Promoter, novo: string) {
    await postAction(
      { action: "promoter_estado_upsert", id: p.id, estado: novo || null },
      "Estado atualizado.",
    );
  }
  // Contador de revisao: so promotores (exclui chaves master, que nao tem estado gerencial).
  const estRevisaveis = useMemo(() => data.promoters.filter((p) => p.is_master !== true), [data.promoters]);
  const estConfirmados = estRevisaveis.filter((p) => p.estado_confirmado === true).length;

  // ---------- JKEY ----------
  function newJKey() {
    setJKeyForm(blankJKey);
  }
  function editJKey(k: JKey) {
    setJKeyForm({
      id: k.id,
      companyId: k.company_id || "",
      promoterId: k.promoter_id || "",
      jKey: k.j_key || "",
      keyType: (k.key_type || "INDIVIDUAL").toUpperCase(),
      displayName: k.display_name || null,
      active: isActive(k.active),
    });
  }
  async function submitJKey(e: FormEvent) {
    e.preventDefault();
    const editing = Boolean(jKeyForm.id);
    const ok = await postAction(
      {
        action: "jkey_upsert",
        id: jKeyForm.id || undefined,
        companyId: jKeyForm.companyId || null,
        promoterId: jKeyForm.promoterId || null,
        jKey: jKeyForm.jKey,
        keyType: jKeyForm.keyType,
        displayName: jKeyForm.displayName || undefined,
        active: jKeyForm.active,
      },
      editing ? "Chave J atualizada com sucesso." : "Chave J salva com sucesso.",
      editing ? "Chave J atualizada" : "Chave J cadastrada"
    );
    if (ok) newJKey();
  }

  // ---------- toggles (soft-delete) ----------
  function toggleCompany(c: Company) {
    const next = c.active === false;
    postAction(
      { action: "toggle_company", id: c.id, active: next },
      next ? "Empresa reativada com sucesso." : "Empresa inativada com sucesso.",
      next ? "Reativada" : "Inativada · histórico preservado"
    );
  }
  function togglePromoter(p: Promoter) {
    const next = p.active === false;
    postAction(
      { action: "toggle_promoter", id: p.id, active: next },
      next ? "Promotor reativado com sucesso." : "Promotor inativado com sucesso.",
      next ? "Reativado" : "Inativado · histórico preservado"
    );
  }
  function toggleJKey(k: JKey) {
    const next = k.active === false;
    postAction(
      { action: "toggle_jkey", id: k.id, active: next },
      next ? "Chave J reativada com sucesso." : "Chave J inativada com sucesso.",
      next ? "Reativada" : "Inativada · histórico preservado"
    );
  }

  // ---------- filtros client-side ----------
  const q = query.trim().toLowerCase();

  const companiesSearched = useMemo(
    () =>
      data.companies.filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          String(c.cnpj || "").replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
          String(c.legal_name || "").toLowerCase().includes(q)
      ),
    [data.companies, q]
  );
  const promotersSearched = useMemo(
    () =>
      data.promoters.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.keys.some((k) => k.j_key.toLowerCase().includes(q))
      ),
    [data.promoters, q]
  );
  const jKeysSearched = useMemo(
    () =>
      data.jKeys.filter(
        (k) =>
          !q ||
          k.j_key.toLowerCase().includes(q) ||
          (k.promoter_name || "").toLowerCase().includes(q)
      ),
    [data.jKeys, q]
  );

  function byStatus<T extends { active?: boolean | null }>(rows: T[]) {
    if (status === "ativos") return rows.filter((r) => isActive(r.active));
    if (status === "inativos") return rows.filter((r) => !isActive(r.active));
    return rows;
  }

  const searched =
    activeTab === "promotores"
      ? promotersSearched
      : activeTab === "empresas"
        ? companiesSearched
        : jKeysSearched;
  const counts = {
    ativos: searched.filter((r: any) => isActive(r.active)).length,
    inativos: searched.filter((r: any) => !isActive(r.active)).length,
    todos: searched.length,
  };

  const companiesView = byStatus(companiesSearched);
  const promotersView = byStatus(promotersSearched);
  // Filtro "so a revisar" (estado_confirmado=false) sobre a lista ja filtrada.
  const promotersRender = soRevisar
    ? promotersView.filter((p) => p.estado_confirmado !== true)
    : promotersView;
  // Confirmacao em LOTE: so os visiveis/filtrados nao-confirmados (exclui master).
  // Passo deliberado (window.confirm com contagem por estado). NAO muda valor de estado.
  async function confirmarDerivadosLote() {
    const alvo = promotersRender.filter((p) => p.estado_confirmado !== true && p.is_master !== true);
    if (alvo.length === 0) return;
    const porEstado = new Map<string, number>();
    for (const p of alvo) {
      const k = p.estado ?? "Nao classificado";
      porEstado.set(k, (porEstado.get(k) ?? 0) + 1);
    }
    const resumo = Array.from(porEstado.entries()).map(([k, n]) => `${k}: ${n}`).join(", ");
    if (!window.confirm(`Confirmar o estado derivado de ${alvo.length} promotores? ${resumo}`)) return;
    await postAction(
      { action: "promoter_estado_confirmar_lote", ids: alvo.map((p) => p.id) },
      `${alvo.length} estados confirmados.`,
    );
  }
  const jKeysView = byStatus(jKeysSearched);

  const newLabel =
    activeTab === "promotores" ? "Novo promotor" : activeTab === "empresas" ? "Nova empresa" : "Nova chave";
  function onNew() {
    if (activeTab === "promotores") newPromoter();
    else if (activeTab === "empresas") newCompany();
    else newJKey();
    showToast("Novo cadastro");
  }

  return (
    <div className="rrcad">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        {/* breadcrumb */}
        <nav className="crumb">
          <a href="/dashboard">Dashboard</a>
          <span className="sep">/</span>
          <span>Comercial</span>
          <span className="sep">/</span>
          <span className="cur">Cadastros</span>
        </nav>

        {/* HEADER */}
        <HeaderNavy
          title="Cadastros"
          subtitle="Base mestra · inclusão manual"
          actions={
            <div className="role">
              <span className="d" />
              Sócio &amp; funcionário · sem trava de mês
            </div>
          }
        >
          <KpiBand
            valueSize={28}
            items={[
              { label: "Empresas", value: data.summary.companies, sub: `grupo RR · ${data.summary.activeCompanies} ativas`, accent: true },
              { label: "Promotores ativos", value: data.summary.activePromoters, sub: `de ${data.summary.promoters} cadastrados` },
              { label: "Chaves J ativas", value: data.summary.activeJKeys, sub: "vinculadas a promotor" },
              { label: "Chaves master", value: data.summary.masterKeys, sub: "recebem p/ redistribuir" },
            ]}
          />
        </HeaderNavy>

        {/* banners de erro / sucesso */}
        {error ? (
          <div className="sbanner err">
            <span className="bic"><IcoAlert /></span>
            <div>
              <b>Não foi possível concluir a alteração</b>
              <span>{error}</span>
            </div>
          </div>
        ) : null}
        {notice ? (
          <div className="sbanner ok">
            <span className="bic"><IcoCheck /></span>
            <div>
              <b>Estrutura cadastral salva</b>
              <span>{notice}</span>
            </div>
          </div>
        ) : null}

        {/* TABS */}
        <div className="tabbar" role="tablist">
          <TabBtn on={activeTab === "promotores"} onClick={() => switchTab("promotores")} label="Promotores" count={data.promoters.length} />
          <TabBtn on={activeTab === "empresas"} onClick={() => switchTab("empresas")} label="Empresas e identificadores" count={data.companies.length} />
          <TabBtn on={activeTab === "chaves"} onClick={() => switchTab("chaves")} label="Chaves J" count={data.jKeys.length} />
        </div>

        {/* ACTION BAR (comum) */}
        <div className="actionbar">
          <div className="search">
            <IcoSearch />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                activeTab === "promotores"
                  ? "Buscar por nome do promotor…"
                  : activeTab === "empresas"
                    ? "Buscar por nome fantasia ou CNPJ…"
                    : "Buscar por chave J…"
              }
              aria-label="Buscar"
            />
          </div>
          <div className="seg" role="tablist" aria-label="Filtro de status">
            {(["ativos", "inativos", "todos"] as StatusFilter[]).map((f) => (
              <button key={f} className={status === f ? "on" : ""} onClick={() => setStatus(f)} data-f={f}>
                {f === "ativos" ? "Ativos" : f === "inativos" ? "Inativos" : "Todos"}
                <span className="cnt">{counts[f]}</span>
              </button>
            ))}
          </div>
          <button className="newbtn" onClick={onNew}>
            <span className="ic"><IcoPlus /></span>
            {newLabel}
          </button>
        </div>

        {/* ============== PANEL PROMOTORES ============== */}
        {activeTab === "promotores" ? (
          <div className="cgrid">
            <div className="tcard">
              <div className="tcard-head">
                <div>
                  <h2>Promotores</h2>
                  <p className="csub">{counts.ativos} ativos · clique no lápis para editar o cadastro</p>
                </div>
                <div className="est-review">
                  <span className={`est-count${estConfirmados >= estRevisaveis.length ? " done" : ""}`}>
                    Estado: <b>{estConfirmados}</b> / {estRevisaveis.length} confirmados
                  </span>
                  <button type="button" className={`est-filter${soRevisar ? " on" : ""}`} onClick={() => setSoRevisar((v) => !v)}>
                    {soRevisar ? "Mostrando só a revisar" : "Só a revisar"}
                  </button>
                  {(() => {
                    const pend = promotersRender.filter((p) => p.estado_confirmado !== true && p.is_master !== true).length;
                    return pend > 0 ? (
                      <button type="button" className="est-bulk" onClick={confirmarDerivadosLote} disabled={submitting === "promoter_estado_confirmar_lote"}>
                        Confirmar derivados ({pend})
                      </button>
                    ) : null;
                  })()}
                </div>
              </div>
              <Table scrollable minWidth={600} cards>
                  <thead>
                    <tr>
                      <th className="rr-sticky-col">Nome</th>
                      <th>Empresa</th>
                      <th>Estado (gerencial)</th>
                      <th className="c">Chaves J</th>
                      <th>Admissão</th>
                      <th>Tipo</th>
                      <th>Status</th>
                      <th className="r">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <TableState colSpan={8} loading />
                    ) : promotersRender.length === 0 ? (
                      <TableState colSpan={8} query={query} empty={soRevisar ? "Nenhum promotor a revisar — todos confirmados." : "Nenhum promotor nesta aba. Cadastre manualmente pelo botão Novo promotor."} />
                    ) : (
                      promotersRender.map((p) => {
                        const active = isActive(p.active);
                        const fiscal = estadoDaEmpresa(p.company_name);
                        const diverge = p.estado != null && fiscal != null && p.estado !== fiscal;
                        return (
                          <tr key={p.id} className={active ? "" : "inactive"}>
                            <td className="nm rr-sticky-col" data-l="Nome">
                              {p.name}
                              <small>{p.keys[0]?.j_key || "Sem chave"}</small>
                            </td>
                            <td data-l="Empresa">{p.company_name}</td>
                            <td className="estcell" data-l="Estado (gerencial)">
                              {p.is_master ? (
                                <span className="est-na">—</span>
                              ) : (
                                <div className="estwrap">
                                  <select
                                    className="estsel"
                                    aria-label={`Estado gerencial de ${p.name}`}
                                    value={p.estado ?? ""}
                                    onChange={(e) => saveEstado(p, e.target.value)}
                                    disabled={submitting === "promoter_estado_upsert"}
                                  >
                                    <option value="">Não classificado</option>
                                    {ESTADOS.map((x) => (
                                      <option key={x.v} value={x.v}>{x.v} · {x.l}</option>
                                    ))}
                                  </select>
                                  <span className={`estchip ${p.estado_confirmado ? "ok" : "warn"}`}>
                                    {p.estado_confirmado ? "confirmado" : "derivado (revisar)"}
                                  </span>
                                  {diverge ? (
                                    <span className="estdiv" title={`Estado gerencial (${p.estado}) difere do implícito pelo CNPJ (${fiscal})`}>≠ CNPJ</span>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            <td className="c" data-l="Chaves J"><span className="cntpill">{p.keys.length}</span></td>
                            <td className="num" data-l="Admissão">{fmtDate(p.hired_at)}</td>
                            <td data-l="Tipo">{p.is_master ? <MasterBadge /> : <span className="badge indiv">Individual</span>}</td>
                            <td data-l="Status"><StatusChip active={active} /></td>
                            <td className="actcell" data-l="Ações">
                              <div className="acts">
                                <button className="iconact" title="Editar" onClick={() => editPromoter(p)}><IcoPencil /></button>
                                <ToggleBtn active={active} onClick={() => togglePromoter(p)} />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
              </Table>
            </div>

            <div>
              <form className="form" onSubmit={submitPromoter}>
                <div className="form-head">
                  <div className="ft">
                    <span className="badge2"><IcoPencil /></span>
                    <div>
                      <h3>{promoterForm.id ? "Editar promotor" : "Novo promotor"}</h3>
                      <p className="who">{promoterForm.id ? promoterForm.name || "—" : "Inclusão manual"}</p>
                    </div>
                  </div>
                  {promoterForm.id ? (
                    <button type="button" className="closeb" title="Cancelar edição" onClick={newPromoter}><IcoX /></button>
                  ) : null}
                </div>
                <div className="form-body">
                  <div className="field">
                    <label>Nome <span className="req">*</span></label>
                    <input value={promoterForm.name} onChange={(e) => setPromoterForm((c) => ({ ...c, name: e.target.value }))} placeholder="Nome do promotor" />
                  </div>
                  <div className="field">
                    <label>Empresa</label>
                    <select value={promoterForm.companyId} onChange={(e) => setPromoterForm((c) => ({ ...c, companyId: e.target.value }))}>
                      <option value="">Sem empresa</option>
                      {data.companies.map((co) => (
                        <option key={co.id} value={co.id}>{co.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Estado (gerencial)</label>
                    <select value={promoterForm.estado} onChange={(e) => setPromoterForm((c) => ({ ...c, estado: e.target.value }))}>
                      <option value="">Não classificado</option>
                      {ESTADOS.map((x) => (
                        <option key={x.v} value={x.v}>{x.v} · {x.l}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Data de admissão</label>
                    <input type="date" value={promoterForm.hiredAt} onChange={(e) => setPromoterForm((c) => ({ ...c, hiredAt: e.target.value }))} />
                  </div>
                  <div className="field">
                    <div className="togglefield">
                      <div className="tt">
                        <div className="tl">Marcar como <MasterBadge small /></div>
                        <div className="th">Chave técnica que recebe produção para redistribuir entre promotores na Migração. Não conta como promotor ativo.</div>
                      </div>
                      <label className="switch">
                        <input type="checkbox" checked={promoterForm.isMaster} onChange={(e) => setPromoterForm((c) => ({ ...c, isMaster: e.target.checked }))} />
                        <span className="tr" />
                        <span className="kn" />
                      </label>
                    </div>
                  </div>
                  <div className="field">
                    <label>Observações</label>
                    <textarea value={promoterForm.notes} onChange={(e) => setPromoterForm((c) => ({ ...c, notes: e.target.value }))} placeholder="Anotações internas (visíveis na auditoria)…" />
                  </div>
                </div>
                <div className="form-foot">
                  <button type="submit" className="btn-save" disabled={submitting === "promoter_upsert"}>
                    {submitting === "promoter_upsert" ? <><span className="spinner" />Salvando…</> : <><IcoSave />{promoterForm.id ? "Salvar alterações" : "Salvar"}</>}
                  </button>
                  {promoterForm.id ? (
                    <button type="button" className="btn-cancel" onClick={newPromoter}>Cancelar</button>
                  ) : null}
                </div>
              </form>

              <div className="infocard">
                <h4>Promotores por empresa</h4>
                <div className="byco">
                  {data.companies.length === 0 ? (
                    <div className="r"><span className="cn">Sem empresas</span></div>
                  ) : (
                    data.companies.map((co) => (
                      <div className="r" key={co.id}>
                        <span className="cn">{co.name}</span>
                        <span className="cv">{co.active_promoters_count} <small>/ {co.promoters_count}</small></span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ============== PANEL EMPRESAS ============== */}
        {activeTab === "empresas" ? (
          <div className="cgrid">
            <div>
              <div className="tcard">
                <div className="tcard-head">
                  <div>
                    <h2>Empresas</h2>
                    <p className="csub">Pessoas jurídicas do grupo</p>
                  </div>
                </div>
                <Table scrollable minWidth={600} cards>
                    <thead>
                      <tr>
                        <th className="rr-sticky-col">Nome fantasia</th>
                        <th>CNPJ</th>
                        <th className="c">Identificadores</th>
                        <th>Status</th>
                        <th className="r">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <TableState colSpan={5} loading />
                      ) : companiesView.length === 0 ? (
                        <TableState colSpan={5} query={query} empty="Nenhuma empresa nesta aba." />
                      ) : (
                        companiesView.map((c) => {
                          const active = isActive(c.active);
                          return (
                            <tr key={c.id} className={active ? "" : "inactive"}>
                              <td className="nm rr-sticky-col" data-l="Nome fantasia">{c.name}<small>{c.legal_name || "—"}</small></td>
                              <td className="num mono" data-l="CNPJ">{fmtCnpj(c.cnpj)}</td>
                              <td className="c" data-l="Identificadores"><span className="cntpill">{c.identifiers.length}</span></td>
                              <td data-l="Status"><StatusChip active={active} /></td>
                              <td className="actcell" data-l="Ações">
                                <div className="acts">
                                  <button className="iconact" title="Editar" onClick={() => editCompany(c)}><IcoPencil /></button>
                                  <ToggleBtn active={active} onClick={() => toggleCompany(c)} />
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                </Table>
              </div>

              {/* IDENTIFICADORES */}
              <div className="subcard" style={{ marginTop: 16 }}>
                <div className="subcard-head">
                  <div>
                    <h2>Identificadores</h2>
                    <p className="csub">Códigos MCI / Coban usados na detecção das planilhas</p>
                  </div>
                </div>
                <form className="idform" onSubmit={submitIdentifier}>
                  <select value={identifierForm.companyId} onChange={(e) => setIdentifierForm((c) => ({ ...c, companyId: e.target.value }))} aria-label="Empresa">
                    <option value="">Empresa…</option>
                    {data.companies.map((co) => (
                      <option key={co.id} value={co.id}>{co.name}</option>
                    ))}
                  </select>
                  <input value={identifierForm.mci} onChange={(e) => setIdentifierForm((c) => ({ ...c, mci: e.target.value }))} placeholder="MCI" className="mono" />
                  <input value={identifierForm.cobanCode} onChange={(e) => setIdentifierForm((c) => ({ ...c, cobanCode: e.target.value }))} placeholder="Coban" className="mono" />
                  <button type="submit" className="addmini" disabled={submitting === "identifier_upsert"}>
                    <IcoPlus />{submitting === "identifier_upsert" ? "Salvando…" : "Adicionar"}
                  </button>
                </form>
                <Table scrollable minWidth={600} cards>
                    <thead>
                      <tr><th className="rr-sticky-col">Empresa</th><th>MCI</th><th>Coban</th><th>Tipo</th></tr>
                    </thead>
                    <tbody>
                      {data.companies.flatMap((c) => c.identifiers.map((i) => ({ c, i }))).length === 0 ? (
                        <TableState colSpan={4} empty="Nenhum identificador cadastrado." />
                      ) : (
                        data.companies.flatMap((c) =>
                          c.identifiers.map((i) => (
                            <tr key={i.id}>
                              <td className="nm rr-sticky-col" data-l="Empresa">{c.name}</td>
                              <td className="num mono" data-l="MCI">{i.mci || "—"}</td>
                              <td className="num mono" data-l="Coban">{i.coban_code || "—"}</td>
                              <td data-l="Tipo"><span className="idtype">{i.identifier_type || "PRIMARY"}</span></td>
                            </tr>
                          ))
                        )
                      )}
                    </tbody>
                </Table>
              </div>
            </div>

            <form className="form" onSubmit={submitCompany}>
              <div className="form-head">
                <div className="ft">
                  <span className="badge2"><IcoBuilding /></span>
                  <div>
                    <h3>{companyForm.id ? "Editar empresa" : "Nova empresa"}</h3>
                    <p className="who">{companyForm.id ? companyForm.name || "—" : "Pessoa jurídica do grupo"}</p>
                  </div>
                </div>
                {companyForm.id ? (
                  <button type="button" className="closeb" title="Cancelar edição" onClick={newCompany}><IcoX /></button>
                ) : null}
              </div>
              <div className="form-body">
                <div className="field">
                  <label>Nome fantasia <span className="req">*</span></label>
                  <input value={companyForm.name} onChange={(e) => setCompanyForm((c) => ({ ...c, name: e.target.value }))} placeholder="Ex.: RR Alagoas 4" />
                </div>
                <div className="field">
                  <label>CNPJ <span className="req">*</span></label>
                  <input value={companyForm.cnpj} onChange={(e) => setCompanyForm((c) => ({ ...c, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" className="mono" />
                </div>
                <div className="field">
                  <label>Razão social</label>
                  <input value={companyForm.legalName} onChange={(e) => setCompanyForm((c) => ({ ...c, legalName: e.target.value }))} placeholder="Razão social completa" />
                </div>
                <div className="field">
                  <label>Grupo</label>
                  <input value={companyForm.groupName} onChange={(e) => setCompanyForm((c) => ({ ...c, groupName: e.target.value }))} placeholder="Grupo RR" />
                  <p className="hint">Padrão Grupo RR. Identificadores MCI/Coban são adicionados na lista ao lado.</p>
                </div>
              </div>
              <div className="form-foot">
                <button type="submit" className="btn-save" disabled={submitting === "company_upsert"}>
                  {submitting === "company_upsert" ? <><span className="spinner" />Salvando…</> : <><IcoSave />{companyForm.id ? "Salvar alterações" : "Salvar"}</>}
                </button>
                {companyForm.id ? <button type="button" className="btn-cancel" onClick={newCompany}>Cancelar</button> : null}
              </div>
            </form>
          </div>
        ) : null}

        {/* ============== PANEL CHAVES ============== */}
        {activeTab === "chaves" ? (
          <div className="cgrid">
            <div className="tcard">
              <div className="tcard-head">
                <div>
                  <h2>Chaves J</h2>
                  <p className="csub">Identificadores de operador na produção</p>
                </div>
              </div>
              <Table scrollable minWidth={600} cards>
                  <thead>
                    <tr>
                      <th className="rr-sticky-col">Chave J</th>
                      <th>Empresa</th>
                      <th>Promotor</th>
                      <th>Tipo</th>
                      <th>Status</th>
                      <th className="r">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <TableState colSpan={6} loading />
                    ) : jKeysView.length === 0 ? (
                      <TableState colSpan={6} query={query} empty="Nenhuma chave nesta aba." />
                    ) : (
                      jKeysView.map((k) => {
                        const active = isActive(k.active);
                        const master = (k.key_type || "").toUpperCase() === "MASTER";
                        return (
                          <tr key={k.id} className={active ? "" : "inactive"}>
                            <td className="num mono rr-sticky-col" data-l="Chave J" style={{ fontWeight: 600, color: "var(--ink)" }}>{k.j_key}</td>
                            <td data-l="Empresa">{k.company_name}</td>
                            <td data-l="Promotor" style={k.promoter_name ? undefined : { color: "var(--ink-3)" }}>{k.promoter_name || "Sem promotor"}</td>
                            <td data-l="Tipo">{master ? <MasterBadge /> : <span className="badge indiv">Individual</span>}</td>
                            <td data-l="Status"><StatusChip active={active} /></td>
                            <td className="actcell" data-l="Ações">
                              <div className="acts">
                                <button className="iconact" title="Editar" onClick={() => editJKey(k)}><IcoPencil /></button>
                                <ToggleBtn active={active} onClick={() => toggleJKey(k)} />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
              </Table>
            </div>

            <div>
              <form className="form" onSubmit={submitJKey}>
                <div className="form-head">
                  <div className="ft">
                    <span className="badge2"><IcoKey /></span>
                    <div>
                      <h3>{jKeyForm.id ? "Editar chave J" : "Nova chave J"}</h3>
                      <p className="who">{jKeyForm.id ? jKeyForm.jKey || "—" : "Identificador de operador"}</p>
                    </div>
                  </div>
                  {jKeyForm.id ? (
                    <button type="button" className="closeb" title="Cancelar edição" onClick={newJKey}><IcoX /></button>
                  ) : null}
                </div>
                <div className="form-body">
                  <div className="field">
                    <label>Chave J <span className="req">*</span></label>
                    <input value={jKeyForm.jKey} onChange={(e) => setJKeyForm((c) => ({ ...c, jKey: e.target.value }))} placeholder="J0000000" className="mono" />
                  </div>
                  <div className="field">
                    <label>Empresa</label>
                    <select value={jKeyForm.companyId} onChange={(e) => setJKeyForm((c) => ({ ...c, companyId: e.target.value }))}>
                      <option value="">Sem empresa</option>
                      {data.companies.map((co) => (
                        <option key={co.id} value={co.id}>{co.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Promotor vinculado</label>
                    <select value={jKeyForm.promoterId} onChange={(e) => setJKeyForm((c) => ({ ...c, promoterId: e.target.value }))}>
                      <option value="">Sem promotor</option>
                      {data.promoters.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Tipo</label>
                    <select value={jKeyForm.keyType} onChange={(e) => setJKeyForm((c) => ({ ...c, keyType: e.target.value }))}>
                      <option value="INDIVIDUAL">Individual</option>
                      <option value="MASTER">Master</option>
                    </select>
                    <p className="hint">Individual vincula a 1 promotor. Master recebe produção para redistribuir na Migração.</p>
                  </div>
                </div>
                <div className="form-foot">
                  <button type="submit" className="btn-save" disabled={submitting === "jkey_upsert"}>
                    {submitting === "jkey_upsert" ? <><span className="spinner" />Salvando…</> : <><IcoSave />{jKeyForm.id ? "Salvar alterações" : "Salvar"}</>}
                  </button>
                  {jKeyForm.id ? <button type="button" className="btn-cancel" onClick={newJKey}>Cancelar</button> : null}
                </div>
              </form>

              <div className="infocard">
                <h4>Regras de uso</h4>
                <ul className="userule" style={{ margin: 0, paddingLeft: 18 }}>
                  <li><span className="tg i">Individual</span> vincula a <b>1 promotor</b> — toda produção da chave é dele.</li>
                  <li><span className="tg m">Master</span> recebe produção para <b>redistribuir</b> entre promotores na <b>Migração</b>.</li>
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className={`toast${toast ? " show" : ""}`}>
        <span className="ck-i">✓</span>
        <span>{toast}</span>
      </div>
    </div>
  );
}

/* ====================== small components ====================== */

function TabBtn({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button className={`tab${on ? " on" : ""}`} role="tab" onClick={onClick}>
      {label} <span className="tc">{count}</span>
    </button>
  );
}

function StatusChip({ active }: { active: boolean }) {
  return (
    <span className={`chip ${active ? "on" : "off"}`}>
      <span className="d" />
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}

function MasterBadge({ small }: { small?: boolean }) {
  return (
    <span className="badge master" style={small ? { fontSize: 10, padding: "2px 8px" } : undefined}>
      <IcoShieldSmall />
      Master
    </span>
  );
}

function ToggleBtn({ active, onClick }: { active: boolean; onClick: () => void }) {
  if (active) {
    return <button className="txtact warn" title="Inativar" onClick={onClick}>Inativar</button>;
  }
  return (
    <button className="txtact go" title="Reativar" onClick={onClick}>
      <IcoUndo />Reativar
    </button>
  );
}

function TableState({ colSpan, loading, empty, query }: { colSpan: number; loading?: boolean; empty?: string; query?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div className="tstate">
          {loading ? (
            <span className="btn-loading"><span className="spinner" />Carregando base cadastral…</span>
          ) : query ? (
            <div className="noresult">
              <span className="empty-art"><IcoSearch /></span>
              <div className="empty-t">Nada encontrado</div>
              <div className="empty-s">Nenhum registro para <span className="q">&quot;{query}&quot;</span></div>
            </div>
          ) : (
            <div className="noresult">
              <span className="empty-art"><IcoClipboard /></span>
              <div className="empty-t">Nenhum registro</div>
              <div className="empty-s">{empty}</div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ====================== icons ====================== */
const S = (p: any) => <svg fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p} />;
const IcoClipboard = () => <S width="13" height="13" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7L9 4H5a2 2 0 0 0-2 2Z" /></S>;
const IcoBuilding = () => <S width="13" height="13" viewBox="0 0 24 24"><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /></S>;
const IcoKey = () => <S width="13" height="13" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.5 12.5 8-8M16 4h4v4" /></S>;
const IcoShieldSmall = () => <S width="11" height="11" viewBox="0 0 24 24" strokeWidth={2.4}><path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z" /></S>;
const IcoSearch = () => <S width="16" height="16" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></S>;
const IcoPlus = () => <S width="14" height="14" viewBox="0 0 24 24" strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></S>;
const IcoPencil = () => <S width="14" height="14" viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></S>;
const IcoUndo = () => <S width="12" height="12" viewBox="0 0 24 24" strokeWidth={2.2}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></S>;
const IcoSave = () => <S width="14" height="14" viewBox="0 0 24 24" strokeWidth={2.2}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></S>;
const IcoX = () => <S width="14" height="14" viewBox="0 0 24 24" strokeWidth={2.2}><path d="M18 6 6 18M6 6l12 12" /></S>;
const IcoCheck = () => <S width="15" height="15" viewBox="0 0 24 24" strokeWidth={2.4}><path d="M20 6 9 17l-5-5" /></S>;
const IcoAlert = () => <S width="15" height="15" viewBox="0 0 24 24" strokeWidth={2.2}><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></S>;

const CSS = `
.rrcad{
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
.rrcad *{box-sizing:border-box;}
.rrcad .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrcad .mono{font-family:'IBM Plex Mono','SFMono-Regular',ui-monospace,monospace;}
.rrcad .wrap{max-width:1180px;margin:0 auto;padding:4px 0 90px;display:flex;flex-direction:column;gap:20px;}

.rrcad .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:0 2px -2px;flex-wrap:wrap;}
.rrcad .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rrcad .crumb a:hover{color:var(--navy);}
.rrcad .crumb .sep{color:#C2C8D2;}
.rrcad .crumb .cur{color:var(--ink);font-weight:600;}

.rrcad .role{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#E4E9F4;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:600;}
.rrcad .role .d{width:7px;height:7px;border-radius:50%;background:var(--yellow);}

.rrcad .tabbar{display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--bd);border-radius:999px;box-shadow:var(--shadow);padding:6px;width:fit-content;max-width:100%;flex-wrap:wrap;}
.rrcad .tab{display:inline-flex;align-items:center;gap:9px;border:none;background:none;font-family:inherit;font-size:13px;font-weight:600;color:var(--ink-2);padding:9px 18px;border-radius:999px;cursor:pointer;transition:background .14s,color .14s;white-space:nowrap;}
.rrcad .tab .tc{font-size:11px;font-weight:700;color:var(--ink-3);background:#EDF0F6;border-radius:999px;padding:1px 8px;transition:background .14s,color .14s;}
.rrcad .tab:hover{background:#F4F6F9;color:var(--navy);}
.rrcad .tab.on{background:var(--navy);color:#fff;}
.rrcad .tab.on .tc{background:rgba(255,255,255,.16);color:#fff;}

.rrcad .actionbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--card);border:1px solid var(--bd);border-radius:var(--r-md);padding:12px 14px;box-shadow:var(--shadow);}
.rrcad .search{position:relative;flex:1;min-width:200px;max-width:360px;}
.rrcad .search svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--ink-3);pointer-events:none;}
.rrcad .search input{width:100%;border:1px solid var(--bd);border-radius:10px;padding:9px 12px 9px 36px;font-family:inherit;font-size:13px;color:var(--ink);background:#F8F9FC;transition:border-color .14s,background .14s;}
.rrcad .search input::placeholder{color:var(--ink-3);}
.rrcad .search input:focus{outline:none;border-color:var(--navy);background:#fff;box-shadow:0 0 0 3px rgba(15,31,74,.07);}
.rrcad .seg{display:inline-flex;background:#F1F3F7;border:1px solid var(--bd);border-radius:10px;padding:3px;gap:2px;}
.rrcad .seg button{appearance:none;border:none;background:none;font-family:inherit;font-size:12px;font-weight:600;color:var(--ink-3);padding:7px 14px;border-radius:7px;cursor:pointer;transition:background .14s,color .14s,box-shadow .14s;white-space:nowrap;}
.rrcad .seg button:hover{color:var(--ink-2);}
.rrcad .seg button.on{background:#fff;color:var(--navy);box-shadow:0 1px 2px rgba(15,31,74,.08);}
.rrcad .seg button .cnt{font-weight:700;color:var(--ink-3);margin-left:5px;}
.rrcad .seg button.on .cnt{color:var(--blue);}
.rrcad .newbtn{margin-left:auto;display:inline-flex;align-items:center;gap:8px;background:var(--navy);color:#fff;border:none;border-radius:10px;padding:10px 17px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .14s,transform .12s;white-space:nowrap;}
.rrcad .newbtn:hover{background:#16285C;transform:translateY(-1px);}
.rrcad .newbtn .ic{color:var(--yellow);display:grid;place-items:center;}

.rrcad .cgrid{display:grid;grid-template-columns:1fr 360px;gap:16px;align-items:start;}

.rrcad .tcard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden;}
.rrcad .tcard-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 22px 14px;border-bottom:1px solid var(--bd-soft);}
.rrcad .tcard-head h2{font-size:14.5px;font-weight:600;margin:0;color:var(--ink);}
.rrcad .tcard-head .csub{font-size:11.5px;color:var(--ink-3);margin-top:2px;}
/* Tabelas migradas para o kit (<Table scrollable minWidth={600} cards>): scroll horizontal
   no desktop, cartao empilhado no telefone (<=560px, via data-l em cada td),
   min-width, thead sticky, padding, zebra, hover e coluna fixa vêm do kit
   (.rr-table-wrap / .rrui-table / .rr-sticky-col). Mantidos só ajustes da tela:
   alinhamento .c/.r dos cabeçalhos e células e células em linha única. */
.rrcad .rrui-table thead th.c{text-align:center;}
.rrcad .rrui-table thead th.r{text-align:right;}
.rrcad .rrui-table tbody td.c{text-align:center;}
.rrcad .rrui-table tbody td.r{text-align:right;}
.rrcad .rrui-table tbody td{white-space:nowrap;vertical-align:middle;}
.rrcad .nm{font-weight:600;color:var(--ink);}
.rrcad .nm small{display:block;font-weight:500;font-size:11px;color:var(--ink-3);margin-top:1px;}
.rrcad .cntpill{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:var(--neu);border:1px solid var(--bd);font-size:11.5px;font-weight:600;color:var(--ink-2);}
/* Estado gerencial — revisao dos promotores */
.rrcad .est-review{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.rrcad .est-count{font-size:12px;color:var(--ink-2);white-space:nowrap;}
.rrcad .est-count b{color:var(--ink);}
.rrcad .est-count.done b{color:var(--green,#2F855A);}
.rrcad .est-filter{font-size:11.5px;font-weight:600;color:var(--ink-2);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;background:#fff;cursor:pointer;}
.rrcad .est-filter.on{background:var(--navy,#0F1F4A);border-color:var(--navy,#0F1F4A);color:#fff;}
.rrcad .est-bulk{font-size:11.5px;font-weight:600;color:#fff;border:1px solid var(--navy,#0F1F4A);border-radius:8px;padding:6px 10px;background:var(--navy,#0F1F4A);cursor:pointer;}
.rrcad .est-bulk:disabled{opacity:.6;cursor:not-allowed;}
.rrcad .estcell .estwrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.rrcad .estsel{height:30px;border:1px solid var(--bd);border-radius:8px;padding:0 8px;font:inherit;font-size:12px;background:#fff;color:var(--ink);cursor:pointer;}
.rrcad .estsel:disabled{opacity:.6;}
.rrcad .estchip{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap;}
.rrcad .estchip.warn{background:#fffdf0;border:1px solid #f5e7a8;color:#7a5b00;}
.rrcad .estchip.ok{background:#f2fbf5;border:1px solid #cdeed8;color:#14532d;}
.rrcad .estdiv{font-size:10.5px;font-weight:700;color:#8a1c1c;background:#fdece9;border:1px solid #f4c6bd;border-radius:999px;padding:2px 7px;white-space:nowrap;}
.rrcad .est-na{color:var(--ink-3);}
.rrcad tr.inactive td{background:#FCFCFD;}
.rrcad tr.inactive .nm{color:var(--ink-3);}
.rrcad tr.inactive td:not(.actcell){opacity:.72;}

.rrcad .badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap;border:1px solid transparent;}
.rrcad .badge.master{color:var(--blue);background:var(--blue-bg);border-color:var(--blue-bd);}
.rrcad .badge.indiv{color:var(--ink-2);background:var(--neu);border-color:var(--bd);}
.rrcad .badge svg{flex:none;}
.rrcad .chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:4px 11px;border-radius:999px;border:1px solid;white-space:nowrap;}
.rrcad .chip .d{width:6px;height:6px;border-radius:50%;}
.rrcad .chip.on{color:var(--green-tx);background:var(--green-bg);border-color:var(--green-bd);}
.rrcad .chip.on .d{background:var(--green);}
.rrcad .chip.off{color:var(--ink-3);background:var(--neu);border-color:var(--bd);}
.rrcad .chip.off .d{background:var(--ink-3);}

.rrcad .actcell{white-space:nowrap;}
.rrcad .acts{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;}
.rrcad .iconact{appearance:none;width:30px;height:30px;border-radius:8px;border:1px solid var(--bd);background:#fff;color:var(--ink-2);display:inline-grid;place-items:center;cursor:pointer;transition:background .14s,border-color .14s,color .14s;}
.rrcad .iconact:hover{background:#F4F6F9;border-color:#C6CEDE;color:var(--navy);}
.rrcad .txtact{appearance:none;display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:11.5px;font-weight:600;border-radius:8px;padding:6px 11px;cursor:pointer;border:1px solid var(--bd);background:#fff;color:var(--ink-2);transition:background .14s,border-color .14s,color .14s;white-space:nowrap;}
.rrcad .txtact:hover{background:#F4F6F9;border-color:#C6CEDE;color:var(--navy);}
.rrcad .txtact.warn:hover{background:var(--amber-bg);border-color:var(--amber-bd);color:var(--amber-tx);}
.rrcad .txtact.go:hover{background:var(--green-bg);border-color:var(--green-bd);color:var(--green-tx);}
.rrcad .txtact svg{flex:none;}

.rrcad .form{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);position:sticky;top:18px;overflow:hidden;}
.rrcad .form-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 14px;border-bottom:1px solid var(--bd-soft);background:#FAFBFC;}
.rrcad .form-head .ft{display:flex;align-items:center;gap:11px;}
.rrcad .form-head .ft .badge2{width:32px;height:32px;border-radius:9px;background:var(--navy);color:#fff;display:grid;place-items:center;flex:none;}
.rrcad .form-head h3{font-size:14.5px;font-weight:600;margin:0;color:var(--ink);}
.rrcad .form-head .who{font-size:11.5px;color:var(--ink-3);margin-top:2px;}
.rrcad .closeb{appearance:none;width:28px;height:28px;border-radius:8px;border:1px solid var(--bd);background:#fff;color:var(--ink-3);display:grid;place-items:center;cursor:pointer;flex:none;}
.rrcad .closeb:hover{color:var(--ink);border-color:#C6CEDE;}
.rrcad .form-body{padding:18px 20px;}
.rrcad .field{margin-bottom:14px;}
.rrcad .field:last-child{margin-bottom:0;}
.rrcad .field label{display:block;font-size:12px;font-weight:600;color:var(--ink-2);margin-bottom:6px;}
.rrcad .field label .req{color:var(--red);margin-left:2px;}
.rrcad .field input,.rrcad .field select,.rrcad .field textarea{width:100%;border:1px solid var(--bd);border-radius:9px;padding:10px 12px;font-family:inherit;font-size:13px;color:var(--ink);background:#fff;transition:border-color .14s,box-shadow .14s;}
.rrcad .field textarea{resize:vertical;min-height:66px;line-height:1.5;}
.rrcad .field select{appearance:none;-webkit-appearance:none;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23838B9C' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 12px center;padding-right:30px;cursor:pointer;}
.rrcad .field input:focus,.rrcad .field select:focus,.rrcad .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rrcad .field .hint{font-size:11px;color:var(--ink-3);margin-top:5px;line-height:1.45;}
.rrcad .togglefield{display:flex;align-items:flex-start;gap:12px;background:var(--blue-bg);border:1px solid var(--blue-bd);border-radius:11px;padding:13px 14px;}
.rrcad .togglefield .tt{flex:1;min-width:0;}
.rrcad .togglefield .tt .tl{font-size:12.5px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:7px;}
.rrcad .togglefield .tt .th{font-size:11px;color:var(--ink-2);margin-top:4px;line-height:1.45;}
.rrcad .switch{position:relative;width:42px;height:24px;flex:none;cursor:pointer;}
.rrcad .switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;}
.rrcad .switch .tr{position:absolute;inset:0;background:#CBD2DE;border-radius:999px;transition:background .16s;}
.rrcad .switch .kn{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(15,31,74,.3);transition:transform .16s;}
.rrcad .switch input:checked + .tr{background:var(--blue);}
.rrcad .switch input:checked ~ .kn{transform:translateX(18px);}
.rrcad .form-foot{display:flex;align-items:center;gap:10px;padding:15px 20px;border-top:1px solid var(--bd-soft);background:#FAFBFC;}
.rrcad .btn-save{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--navy);color:#fff;border:none;border-radius:10px;padding:11px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .14s;}
.rrcad .btn-save:hover{background:#16285C;}
.rrcad .btn-save:disabled{opacity:.7;cursor:default;}
.rrcad .btn-save .spinner{width:14px;height:14px;border-radius:50%;border:2.1px solid rgba(255,255,255,.3);border-top-color:#fff;animation:rrcadspin .8s linear infinite;}
.rrcad .btn-cancel{background:#fff;border:1px solid var(--bd);color:var(--ink-2);border-radius:10px;padding:11px 16px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .14s,border-color .14s;}
.rrcad .btn-cancel:hover{background:#F4F6F9;border-color:#C6CEDE;}
@keyframes rrcadspin{to{transform:rotate(360deg);}}

.rrcad .infocard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-md);box-shadow:var(--shadow);padding:16px 18px;margin-top:14px;}
.rrcad .infocard h4{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin:0 0 12px;}
.rrcad .byco{display:flex;flex-direction:column;gap:9px;}
.rrcad .byco .r{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px;}
.rrcad .byco .r .cn{color:var(--ink-2);font-weight:500;}
.rrcad .byco .r .cv{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;}
.rrcad .byco .r .cv small{color:var(--ink-3);font-weight:500;}
.rrcad .userule{font-size:12px;color:var(--ink-2);line-height:1.55;}
.rrcad .userule li{margin-bottom:8px;}
.rrcad .userule b{color:var(--ink);font-weight:600;}
.rrcad .userule .tg{display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;vertical-align:middle;}
.rrcad .userule .tg.m{color:var(--blue);background:var(--blue-bg);border:1px solid var(--blue-bd);}
.rrcad .userule .tg.i{color:var(--ink-2);background:var(--neu);border:1px solid var(--bd);}

.rrcad .subcard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden;}
.rrcad .subcard-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 22px 14px;border-bottom:1px solid var(--bd-soft);}
.rrcad .subcard-head h2{font-size:14px;font-weight:600;margin:0;color:var(--ink);}
.rrcad .subcard-head .csub{font-size:11.5px;color:var(--ink-3);margin-top:2px;}
.rrcad .idform{display:flex;gap:8px;flex-wrap:wrap;padding:12px 22px;border-bottom:1px solid var(--bd-soft);background:#FBFCFD;}
.rrcad .idform select,.rrcad .idform input{border:1px solid var(--bd);border-radius:9px;padding:8px 11px;font-family:inherit;font-size:12.5px;color:var(--ink);background:#fff;}
.rrcad .idform select{flex:1;min-width:150px;}
.rrcad .idform input{width:110px;}
.rrcad .idform input:focus,.rrcad .idform select:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rrcad .addmini{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px dashed #C4CEDF;color:var(--navy);border-radius:9px;padding:8px 13px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background .14s,border-color .14s;}
.rrcad .addmini:hover{background:var(--blue-bg);border-color:var(--blue-bd);}
.rrcad .addmini:disabled{opacity:.6;cursor:default;}
.rrcad .addmini svg{color:var(--blue);}
.rrcad .idtype{font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-3);}

.rrcad .tstate{padding:34px 22px;display:flex;justify-content:center;}
.rrcad .noresult{display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center;}
.rrcad .empty-art{width:44px;height:44px;border-radius:12px;background:linear-gradient(160deg,#F4F6FA,#E9EDF4);border:1px solid var(--bd);display:grid;place-items:center;color:var(--navy);}
.rrcad .empty-t{font-size:13px;font-weight:600;color:var(--ink);}
.rrcad .empty-s{font-size:11.5px;color:var(--ink-3);line-height:1.5;max-width:340px;}
.rrcad .noresult .q{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink-2);background:var(--neu);border:1px solid var(--bd);padding:2px 8px;border-radius:6px;}
.rrcad .btn-loading{display:inline-flex;align-items:center;gap:10px;background:var(--navy-bar);color:#fff;border:none;border-radius:10px;padding:10px 17px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:default;}
.rrcad .spinner{width:15px;height:15px;border-radius:50%;border:2.2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:rrcadspin .8s linear infinite;flex:none;}

.rrcad .sbanner{width:100%;display:flex;align-items:flex-start;gap:11px;border-radius:11px;padding:13px 14px;font-size:12.5px;line-height:1.45;}
.rrcad .sbanner .bic{flex:none;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;margin-top:1px;}
.rrcad .sbanner b{font-weight:700;display:block;margin-bottom:2px;}
.rrcad .sbanner.ok{background:var(--green-bg);border:1px solid var(--green-bd);color:var(--green-tx);}
.rrcad .sbanner.ok .bic{background:rgba(22,163,74,.13);color:var(--green);}
.rrcad .sbanner.ok span{color:var(--ink-2);}
.rrcad .sbanner.err{background:var(--red-bg);border:1px solid var(--red-bd);color:var(--red-tx);}
.rrcad .sbanner.err .bic{background:rgba(220,38,38,.12);color:var(--red);}
.rrcad .sbanner.err span{color:var(--ink-2);}

.rrcad .toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--ink);color:#fff;font-size:13px;font-weight:500;padding:12px 19px;border-radius:11px;box-shadow:0 24px 70px rgba(11,24,56,.34);display:flex;align-items:center;gap:10px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:60;}
.rrcad .toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.rrcad .toast .ck-i{color:var(--yellow);display:grid;place-items:center;}

@media (max-width:1040px){
  .rrcad .cgrid{grid-template-columns:1fr;}
  .rrcad .form{position:static;}
}
@media (max-width:640px){
  .rrcad .search{max-width:100%;}
  .rrcad .newbtn{margin-left:0;}
}

/* TELEFONE — solta o texto das celulas para o modo cartao poder quebrar linha.
   NAO e redundante com o kit:

     kit    .rr-table-cards .rrui-table tbody td   -> 2 classes + 2 elementos
     aqui   .rrcad .rrui-table tbody td            -> 2 classes + 2 elementos

   Empatam, e esta folha e injetada DEPOIS do <UiStyles/>, entao o nowrap da
   linha 1190 venceria o white-space:normal do cartao e as celulas nao
   quebrariam. Anular aqui, mais abaixo no mesmo arquivo, e o unico jeito sem
   !important. */
@media (max-width:560px){
  .rrcad .rrui-table tbody td{white-space:normal;}
}

@media (max-width:430px){ .rrcad .wrap{padding:16px 12px 36px;} }
`;
