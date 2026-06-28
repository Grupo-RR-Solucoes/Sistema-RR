"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useUser } from "../../lib/auth/useUser";
import PromotorView from "./PromotorView";
import { UiStyles, HeaderNavy, KpiBand } from "@/components/ui";

type PeriodOption = {
  key: string;
  label: string;
  year: number;
  month: number;
};

type CompanyOption = {
  id: string;
  name: string;
  cnpj: string;
};

type PromoterSummaryRow = {
  promoter_id: string;
  promoter_name: string;
  company_id?: string | null;
  company_name: string;
  company_cnpj: string;
  active: boolean;
  status: string;
  j_keys_count: number;
  production_value: number;
  proposal_count: number;
  insurance_penetration_percent: number;
  target_value: number;
  target_1_value: number;
  target_2_value: number;
  target_status: string;
  production_commission_value: number;
  insurance_commission_value: number;
  agreement_adjustment_value: number;
  discount_value: number;
  final_commission_value: number;
  payable_commission_value: number;
  result_source: string;
};

type ProposalRow = {
  id: string;
  contract_number: string;
  proposal_number: string;
  agency_code: string;
  j_key: string;
  promoter_name: string;
  product_description: string;
  status: string;
  movement_date?: string | null;
  contract_date?: string | null;
  interest_rate: number;
  installment_count: number;
  company_received_percent: number;
  company_commission_amount: number;
  srcc_restriction: string;
  net_value: number;
  gross_value: number;
  insurance_value: number;
  company_insurance_commission_amount: number;
  insurance_penetration_percent: number;
  promoter_commission_percent: number;
  promoter_commission_amount: number;
  insurance_commission_percent: number;
  insurance_commission_amount: number;
  commission_rule_source: string;
  assigned_promoter_id?: string | null;
  assigned_promoter_name: string;
  original_promoter_id?: string | null;
  original_promoter_name: string;
};

type AgreementRow = {
  id: string;
  agreement_type: string;
  commission_type: string;
  commission_value: number;
  notes: string;
};

type DiscountRow = {
  id: string;
  daily_production_record_id?: string | null;
  proposal_number: string;
  discount_type: string;
  amount: number;
  installments: number;
  installment_number: number;
  apply_to_company: boolean;
  notes: string;
};

type PromoterOption = {
  id: string;
  name: string;
};

type PromoterPayload = {
  periods: PeriodOption[];
  selectedPeriod: PeriodOption;
  selectedPromoterId: string;
  selectedCompanyId: string;
  summary: {
    promoters: number;
    production: number;
    productionTotal: number;
    productionUnassigned: number;
    productionUnassignedCount: number;
    finalCommission: number;
    payableCommission: number;
    discounts: number;
    averageInsurancePenetration: number;
  };
  summaryRows: PromoterSummaryRow[];
  proposalRows: ProposalRow[];
  agreementRows: AgreementRow[];
  discountRows: DiscountRow[];
  promoterOptions: PromoterOption[];
  promoterLookup: PromoterOption[];
  companies: CompanyOption[];
};

const emptyPayload: PromoterPayload = {
  periods: [],
  selectedPeriod: {
    key: "",
    label: "sem competencia",
    year: 0,
    month: 0,
  },
  selectedPromoterId: "",
  selectedCompanyId: "",
  summary: {
    promoters: 0,
    production: 0,
    productionTotal: 0,
    productionUnassigned: 0,
    productionUnassignedCount: 0,
    finalCommission: 0,
    payableCommission: 0,
    discounts: 0,
    averageInsurancePenetration: 0,
  },
  summaryRows: [],
  proposalRows: [],
  agreementRows: [],
  discountRows: [],
  promoterOptions: [],
  promoterLookup: [],
  companies: [],
};

export default function PromotoresPage() {
  // 3.5.6 - Branch role-aware: promotor recebe UI somente leitura
  // (PromotorView, modelo LUCIANA MATIAS.xlsx); socio/funcionario veem a
  // UI completa de edicao + multiplas abas. Backend /api/promotores ja
  // filtra por RLS (Etapa 3.7) e bloqueia POST de promotor com 403
  // explicito (Etapa 3.5.5) — esta camada e estritamente cosmetica/UX.
  const { user, loading: userLoading } = useUser();
  if (!userLoading && user?.role === "promotor") {
    return <PromotorView />;
  }

  return <PromotoresFullPage />;
}

function PromotoresFullPage() {
  const [activeSection, setActiveSection] = useState<
    "resumo" | "metas" | "descontos" | "detalhamento" | "migracao"
  >("resumo");
  const [selectedKey, setSelectedKey] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [promoterId, setPromoterId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<PromoterPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recalculating, setRecalculating] = useState(false);
  const [agreementForm, setAgreementForm] = useState({
    promoterId: "",
    productionShare: "",
    insuranceShare: "",
    notes: "",
  });
  const [discountForm, setDiscountForm] = useState({
    id: "",
    promoterId: "",
    dailyProductionRecordId: "",
    discountType: "LIQUIDACAO_ANTECIPADA",
    companyAmount: "",
    amount: "",
    installments: "1",
    installmentNumber: "1",
    applyToCompany: false,
    notes: "",
  });
  const [savingAgreement, setSavingAgreement] = useState(false);
  const [savingDiscount, setSavingDiscount] = useState(false);
  const [deletingDiscountId, setDeletingDiscountId] = useState("");
  const [proposalTargets, setProposalTargets] = useState<Record<string, string>>({});
  const [proposalReasons, setProposalReasons] = useState<Record<string, string>>({});
  const [movingProposalId, setMovingProposalId] = useState("");
  // Aba "Metas & escala" (Fase 2 p2: editor em lote migrado da /metas — reusa
  // /api/metas verbatim; a escala grava em promoter_goal_repasse, onde o motor lê).
  const [metasRows, setMetasRows] = useState<MetaRow[]>([]);
  const [metasDrafts, setMetasDrafts] = useState<Record<string, MetaDraft>>({});
  const [metasLoading, setMetasLoading] = useState(false);
  const [savingMetaId, setSavingMetaId] = useState("");

  const specialistQuery = useMemo(() => {
    const params = new URLSearchParams();
    const key = selectedKey || data.selectedPeriod.key;

    if (key) {
      const [year, month] = key.split("-");
      if (year) params.set("year", year);
      if (month) params.set("month", String(Number(month)));
    }

    if (companyId) {
      params.set("companyId", companyId);
    }

    if (promoterId) {
      params.set("promoterId", promoterId);
    }

    return params.toString() ? `?${params.toString()}` : "";
  }, [companyId, data.selectedPeriod.key, promoterId, selectedKey]);

  // Abre a aba certa quando chega com ?tab=migracao (ex.: aviso de produção
  // não atribuída no Dashboard). Aceita as chaves de seção válidas.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "resumo" || tab === "metas" || tab === "descontos" || tab === "detalhamento" || tab === "migracao") {
      setActiveSection(tab);
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();

        if (selectedKey) {
          const [year, month] = selectedKey.split("-");
          params.set("year", year);
          params.set("month", month);
        }

        if (companyId) {
          params.set("companyId", companyId);
        }

        if (promoterId) {
          params.set("promoterId", promoterId);
        }

        const response = await fetch(
          `/api/promotores${params.toString() ? `?${params.toString()}` : ""}`
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Erro ao carregar promotores.");
        }

        setData(payload || emptyPayload);
      } catch (err: any) {
        setError(err.message || "Erro ao carregar promotores.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [selectedKey, companyId, promoterId, reloadKey]);

  // DEFAULT de competência = último mês FECHADO. Heurística de data: o mês
  // corrente do calendário está aberto (em produção), então escolhemos o
  // período mais recente ANTERIOR a ele (ex.: hoje jun → default mai). Sem
  // seleção manual ainda; só roda no load inicial. Fallback: selectedPeriod.
  useEffect(() => {
    if (selectedKey || data.periods.length === 0) {
      return;
    }
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth() + 1;
    const closed = data.periods.filter(
      (p) => p.year < cy || (p.year === cy && p.month < cm)
    );
    const pick = closed.reduce<PeriodOption | null>((best, p) => {
      if (!best) return p;
      if (p.year > best.year || (p.year === best.year && p.month > best.month)) {
        return p;
      }
      return best;
    }, null);
    const target = pick?.key || data.selectedPeriod.key;
    if (target) {
      setSelectedKey(target);
    }
  }, [data.periods, data.selectedPeriod.key, selectedKey]);

  useEffect(() => {
    if (!promoterId && data.selectedPromoterId) {
      setPromoterId(data.selectedPromoterId);
    }
  }, [data.selectedPromoterId, promoterId]);

  useEffect(() => {
    const selectedSummary = data.summaryRows.find((row) => row.promoter_id === promoterId);
    const productionAgreement = data.agreementRows.find(
      (row) => row.agreement_type === "PRODUCTION"
    );
    const insuranceAgreement = data.agreementRows.find(
      (row) => row.agreement_type === "INSURANCE"
    );

    setAgreementForm({
      promoterId: promoterId || "",
      productionShare:
        productionAgreement?.commission_value || productionAgreement?.commission_value === 0
          ? String(productionAgreement.commission_value)
          : "",
      insuranceShare:
        insuranceAgreement?.commission_value || insuranceAgreement?.commission_value === 0
          ? String(insuranceAgreement.commission_value)
          : "",
      notes: productionAgreement?.notes || insuranceAgreement?.notes || "",
    });

    setDiscountForm((current) => ({
      ...current,
      promoterId: promoterId || "",
      id: "",
      dailyProductionRecordId: "",
      companyAmount: "",
      amount: "",
      installments: "1",
      installmentNumber: "1",
      applyToCompany: selectedSummary?.status === "DISMISSED",
      notes: "",
    }));
  }, [data.agreementRows, data.summaryRows, promoterId]);

  async function recalculateMonth() {
    try {
      setRecalculating(true);
      setError("");
      setNotice("");

      const year = Number((selectedKey || data.selectedPeriod.key || "").split("-")[0]);
      const month = Number((selectedKey || data.selectedPeriod.key || "").split("-")[1]);

      const response = await fetch("/api/calculate/monthly", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          year,
          month,
          companyId: companyId || null,
          promoterId: promoterId || null,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao recalcular a competencia.");
      }

      setReloadKey((value) => value + 1);
      setNotice("Competencia recalculada com sucesso.");
    } catch (err: any) {
      setError(err.message || "Erro ao recalcular a competencia.");
    } finally {
      setRecalculating(false);
    }
  }

  async function handleAgreementSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setSavingAgreement(true);
      setError("");
      setNotice("");

      const [year, month] = (selectedKey || data.selectedPeriod.key || "").split("-");
      const selectedSummary = data.summaryRows.find(
        (row) => row.promoter_id === agreementForm.promoterId
      );

      const response = await fetch("/api/promotores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "agreement_upsert",
          promoterId: agreementForm.promoterId,
          companyId: selectedSummary?.company_id || null,
          year: Number(year),
          month: Number(month),
          productionShare:
            agreementForm.productionShare === ""
              ? null
              : parseBrazilianNumber(agreementForm.productionShare),
          insuranceShare:
            agreementForm.insuranceShare === ""
              ? null
              : parseBrazilianNumber(agreementForm.insuranceShare),
          notes: agreementForm.notes || null,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao salvar acordo comercial.");
      }

      setReloadKey((value) => value + 1);
      setNotice("Acordo comercial salvo com sucesso.");
    } catch (err: any) {
      setError(err.message || "Erro ao salvar acordo comercial.");
    } finally {
      setSavingAgreement(false);
    }
  }

  async function handleDiscountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setSavingDiscount(true);
      setError("");
      setNotice("");

      const [year, month] = (selectedKey || data.selectedPeriod.key || "").split("-");
      const selectedSummary = data.summaryRows.find(
        (row) => row.promoter_id === discountForm.promoterId
      );

      const response = await fetch("/api/promotores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "discount_upsert",
          id: discountForm.id || null,
          promoterId: discountForm.promoterId,
          companyId: selectedSummary?.company_id || null,
          dailyProductionRecordId: discountForm.dailyProductionRecordId || null,
          year: Number(year),
          month: Number(month),
          discountType: discountForm.discountType,
          companyAmount:
            discountForm.companyAmount === ""
              ? null
              : parseBrazilianNumber(discountForm.companyAmount),
          amount:
            discountForm.amount === ""
              ? null
              : parseBrazilianNumber(discountForm.amount),
          installments: parseBrazilianNumber(discountForm.installments),
          installmentNumber: parseBrazilianNumber(discountForm.installmentNumber),
          applyToCompany: discountForm.applyToCompany,
          notes: discountForm.notes || null,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao salvar desconto.");
      }

      setReloadKey((value) => value + 1);
      setNotice("Desconto do promotor salvo com sucesso.");
    } catch (err: any) {
      setError(err.message || "Erro ao salvar desconto.");
    } finally {
      setSavingDiscount(false);
    }
  }

  function editDiscount(row: DiscountRow) {
    setDiscountForm({
      id: row.id,
      promoterId: promoterId || "",
      dailyProductionRecordId: row.daily_production_record_id || "",
      discountType: row.discount_type,
      companyAmount: "",
      amount: row.amount ? String(row.amount) : "",
      installments: String(row.installments || 1),
      installmentNumber: String(row.installment_number || 1),
      applyToCompany: row.apply_to_company,
      notes: row.notes || "",
    });
  }

  async function deleteDiscount(id: string) {
    try {
      setDeletingDiscountId(id);
      setError("");
      setNotice("");

      const response = await fetch("/api/promotores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "discount_delete",
          id,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao remover desconto.");
      }

      setDiscountForm((current) => ({
        ...current,
        id: "",
        dailyProductionRecordId: "",
        companyAmount: "",
        amount: "",
        installments: "1",
        installmentNumber: "1",
        notes: "",
      }));
      setReloadKey((value) => value + 1);
      setNotice("Desconto removido com sucesso.");
    } catch (err: any) {
      setError(err.message || "Erro ao remover desconto.");
    } finally {
      setDeletingDiscountId("");
    }
  }

  async function moveProposal(row: ProposalRow) {
    const toPromoterId = proposalTargets[row.id];

    if (!toPromoterId) {
      setError("Selecione o promotor de destino para migrar a proposta.");
      return;
    }

    try {
      setMovingProposalId(row.id);
      setError("");
      setNotice("");

      const response = await fetch("/api/promotores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "reassign_proposal",
          dailyProductionRecordId: row.id,
          toPromoterId,
          reason: proposalReasons[row.id] || null,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao migrar proposta.");
      }

      setReloadKey((value) => value + 1);
      setNotice(`Proposta ${row.proposal_number} migrada com sucesso.`);
    } catch (err: any) {
      setError(err.message || "Erro ao migrar proposta.");
    } finally {
      setMovingProposalId("");
    }
  }

  const selectedPromoterSummary = useMemo(
    () => data.summaryRows.find((row) => row.promoter_id === promoterId),
    [data.summaryRows, promoterId]
  );

  const proposalTotals = useMemo(
    () =>
      data.proposalRows.reduce(
        (acc, row) => {
          acc.net += row.net_value;
          acc.companyCommission += row.company_commission_amount;
          acc.companyInsurance += row.company_insurance_commission_amount;
          acc.promoterCommission += row.promoter_commission_amount;
          acc.promoterInsurance += row.insurance_commission_amount;
          return acc;
        },
        {
          net: 0,
          companyCommission: 0,
          companyInsurance: 0,
          promoterCommission: 0,
          promoterInsurance: 0,
        }
      ),
    [data.proposalRows]
  );

  const promoterDiscountTotal = useMemo(
    () =>
      data.discountRows
        .filter((row) => !row.apply_to_company)
        .reduce((sum, row) => sum + row.amount, 0),
    [data.discountRows]
  );

  // ---- Aba "Metas & escala": carrega/salva via /api/metas (reuso verbatim) ----
  async function loadMetas() {
    try {
      setMetasLoading(true);
      setError("");
      const key = selectedKey || data.selectedPeriod.key || "";
      const [year, month] = key.split("-");
      if (!year || !month) {
        setMetasRows([]);
        return;
      }
      const params = new URLSearchParams({ year, month: String(Number(month)) });
      if (companyId) params.set("companyId", companyId);
      const res = await fetch(`/api/metas?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Falha ao carregar metas.");
      const rows: MetaRow[] = json.rows || [];
      setMetasRows(rows);
      const d: Record<string, MetaDraft> = {};
      for (const r of rows) d[r.promoter_id] = metaRowToDraft(r);
      setMetasDrafts(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar metas.");
      setMetasRows([]);
    } finally {
      setMetasLoading(false);
    }
  }

  useEffect(() => {
    if (activeSection === "metas") {
      loadMetas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, selectedKey, companyId, reloadKey]);

  function setMetaDraft(id: string, patch: Partial<MetaDraft>) {
    setMetasDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function saveMetaRow(row: MetaRow) {
    const d = metasDrafts[row.promoter_id];
    if (!d) return;
    setSavingMetaId(row.promoter_id);
    setError("");
    setNotice("");
    try {
      const key = selectedKey || data.selectedPeriod.key || "";
      const [yearS, monthS] = key.split("-");
      const year = Number(yearS);
      const month = Number(monthS);
      const num = (s: string) => Number(String(s).replace(",", ".")) || 0;
      const pctOrNull = (s: string) => (s === "" || s == null ? null : num(s) / 100);

      // monthly_targets (meta/meta_1/meta_2) — MESMO upsert do target_upsert.
      const metaRes = await fetch("/api/metas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "meta_upsert",
          promoterId: row.promoter_id,
          companyId: row.company_id,
          year,
          month,
          meta: num(d.meta),
          bonus1: num(d.bonus1),
          bonus2: num(d.bonus2),
        }),
      });
      if (!metaRes.ok) throw new Error((await metaRes.json())?.error || "Falha ao salvar metas.");

      // promoter_goal_repasse (a ESCALA Frente C) — só quando há % base.
      if (d.pct_base !== "") {
        const repRes = await fetch("/api/metas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "repasse_upsert",
            promoterId: row.promoter_id,
            year,
            month,
            pct_base: num(d.pct_base) / 100,
            pct_meta1: pctOrNull(d.pct_meta1),
            pct_meta2: pctOrNull(d.pct_meta2),
          }),
        });
        if (!repRes.ok) throw new Error((await repRes.json())?.error || "Falha ao salvar escala.");
      }

      setNotice(`Metas/escala salvas: ${row.promoter_name}.`);
      setReloadKey((v) => v + 1); // atualiza o Resumo (meta/faixa podem mudar)
      await loadMetas();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar metas.");
    } finally {
      setSavingMetaId("");
    }
  }

  const competenceLabel =
    data.periods.find((period) => period.key === (selectedKey || data.selectedPeriod.key))
      ?.label ||
    data.selectedPeriod.label ||
    "Sem competência";
  const competenceShort = (() => {
    const m = competenceLabel.match(/(\w+)\/(\d{4})/);
    return m ? `${m[1]}/${m[2]}` : competenceLabel;
  })();
  const tabs: Array<{ key: typeof activeSection; label: string }> = [
    { key: "resumo", label: "Resumo" },
    { key: "metas", label: "Metas & escala" },
    { key: "descontos", label: "Descontos" },
    { key: "detalhamento", label: "Detalhamento" },
    { key: "migracao", label: "Migração" },
  ];

  return (
    <div className="rrprom">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <Link href="/dashboard">Dashboard</Link>
          <span className="sep">/</span>
          <span>Promotores</span>
        </nav>

        {/* HEADER + KPIs */}
        <HeaderNavy
          brand="GRUPO RR CRED"
          title="Promotores, metas e comissões"
          actions={
            <div className="comp">
              <select
                aria-label="Competência"
                value={selectedKey}
                onChange={(event) => setSelectedKey(event.target.value)}
              >
                {data.periods.map((period) => (
                  <option key={period.key} value={period.key}>
                    {period.label}
                  </option>
                ))}
              </select>
              <span className="chev">▾</span>
            </div>
          }
        >
          <KpiBand
            valueSize={25}
            items={[
              { label: "Promotores", value: data.summary.promoters, sub: "ativos na competência" },
              {
                label: "Produção",
                value: formatCurrency(data.summary.productionTotal),
                sub:
                  data.summary.productionUnassigned > 0 ? (
                    <button
                      type="button"
                      className="pend"
                      onClick={() => setActiveSection("migracao")}
                      title="Abrir a aba Migração"
                    >
                      inclui {formatCurrency(data.summary.productionUnassigned)} em{" "}
                      {data.summary.productionUnassignedCount} não atribuída
                      {data.summary.productionUnassignedCount > 1 ? "s" : ""} →
                    </button>
                  ) : (
                    "crédito + seguro"
                  ),
              },
              { label: "Comissão bruta", value: formatCurrency(data.summary.finalCommission), sub: "antes de descontos" },
              { label: "Comissão a pagar", value: formatCurrency(data.summary.payableCommission), sub: "líquido a repassar", subTone: "gold" },
              { label: "Penetração média", value: formatPercent(data.summary.averageInsurancePenetration), sub: "seguro / crédito" },
            ]}
          />
        </HeaderNavy>

        {error ? <div className="banner err">{error}</div> : null}
        {notice ? <div className="banner ok">{notice}</div> : null}

        {/* FILTER BAR */}
        <div className="filters">
          <div className="fsel">
            <select
              aria-label="Competência"
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.target.value)}
            >
              {data.periods.map((period) => (
                <option key={period.key} value={period.key}>
                  Competência: {period.label}
                </option>
              ))}
            </select>
            <span className="chev">▾</span>
          </div>
          <div className="fsel">
            <select
              aria-label="Empresa"
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setPromoterId("");
              }}
            >
              <option value="">Empresa: todas</option>
              {data.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <span className="chev">▾</span>
          </div>
          <div className="fsel">
            <select
              aria-label="Promotor"
              value={promoterId}
              onChange={(event) => setPromoterId(event.target.value)}
            >
              <option value="">Promotor: todos</option>
              {data.promoterOptions.map((promoter) => (
                <option key={promoter.id} value={promoter.id}>
                  {promoter.name}
                </option>
              ))}
            </select>
            <span className="chev">▾</span>
          </div>
          <button
            type="button"
            className="fbtn primary"
            onClick={recalculateMonth}
            disabled={recalculating}
            title="Recalcula a competência (todo o mês, ou só o promotor selecionado)."
          >
            <span className="ic">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </span>
            {recalculating ? "Recalculando…" : "Recalcular competência"}
          </button>
          {promoterId ? (
            <a
              className="fbtn"
              href={`/api/relatorios/export?type=promotores&format=xlsx&scope=individual&promoterId=${encodeURIComponent(
                promoterId
              )}&year=${(selectedKey || data.selectedPeriod.key || "").split("-")[0]}&month=${Number(
                (selectedKey || data.selectedPeriod.key || "").split("-")[1]
              )}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ""}`}
              title="Exporta o relatório individual (xlsx) da competência selecionada — mesma fonte da tela (cms se mês fechado)."
            >
              <span className="ic">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              </span>
              Exportar xlsx
            </a>
          ) : null}
          <span className="chip">
            <b>{data.summary.promoters}</b> promotores · <b>{data.proposalRows.length}</b> propostas
          </span>
        </div>

        {/* TABS */}
        <div className="tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              className={`tab${activeSection === tab.key ? " active" : ""}`}
              onClick={() => setActiveSection(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* PANEL: RESUMO */}
        {activeSection === "resumo" ? (
          <section className="panel active">
            <div className="resumo-grid">
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Promotores · {competenceShort}</h2>
                    <p className="csub">Clique numa linha para editar meta e repasse</p>
                  </div>
                </div>
                {loading ? (
                  <div className="state">Carregando promotores…</div>
                ) : data.summaryRows.length === 0 ? (
                  <div className="state">Nenhum promotor encontrado para esta competência.</div>
                ) : (
                  <div className="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th className="l sticky">Promotor</th>
                          <th className="l">Empresa</th>
                          <th>Produção</th>
                          <th>Penetração</th>
                          <th>Meta</th>
                          <th className="l">Status</th>
                          <th>Comissão bruta</th>
                          <th>Desconto</th>
                          <th>A pagar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.summaryRows.map((row) => {
                          const hasMeta = row.target_value > 0;
                          const achieved = hasMeta && row.production_value >= row.target_value;
                          return (
                            <tr
                              key={row.promoter_id}
                              className={`clk${promoterId === row.promoter_id ? " sel" : ""}`}
                              onClick={() => setPromoterId(row.promoter_id)}
                            >
                              <td className="l sticky prom" data-l="Promotor">
                                {row.promoter_name}
                                <small>
                                  {row.j_keys_count} Chaves J · {row.proposal_count} propostas
                                </small>
                              </td>
                              <td className="l muted" data-l="Empresa">
                                {row.company_name}
                              </td>
                              <td className="num" data-l="Produção">
                                {formatCurrency(row.production_value)}
                              </td>
                              <td className="num" data-l="Penetração">
                                {formatPercent(row.insurance_penetration_percent)}
                              </td>
                              <td className="num muted" data-l="Meta">
                                {hasMeta ? formatCurrency(row.target_value) : "—"}
                              </td>
                              <td className="l" data-l="Status">
                                {hasMeta ? (
                                  <span className={`badge2 ${achieved ? "ok" : "low"}`}>
                                    <span className="d" />
                                    {achieved ? "atingiu" : "abaixo"}
                                  </span>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td className="num" data-l="Comissão bruta">
                                {formatCurrency(row.final_commission_value)}
                              </td>
                              <td className={`num${row.discount_value > 0 ? " neg" : ""}`} data-l="Desconto">
                                {row.discount_value > 0
                                  ? `−${formatCurrency(row.discount_value)}`
                                  : formatCurrency(0)}
                              </td>
                              <td className="num pay" data-l="A pagar">
                                {formatCurrency(row.payable_commission_value)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <aside className="edit">
                {!selectedPromoterSummary ? (
                  <div>
                    <h3>Edição do promotor</h3>
                    <p className="who">Nenhum promotor selecionado</p>
                    <p className="empty" style={{ marginTop: 14 }}>
                      Selecione uma linha na tabela para ajustar o <b>acordo de repasse</b>.
                      Metas e a escala de % ficam na aba <b>Metas &amp; escala</b>.
                    </p>
                  </div>
                ) : (
                  <div>
                    <h3>{selectedPromoterSummary.promoter_name}</h3>
                    <p className="who">
                      {selectedPromoterSummary.company_name} · {selectedPromoterSummary.status}
                    </p>

                    <form className="mini" onSubmit={handleAgreementSubmit}>
                      <h4>Acordo de repasse</h4>
                      <div className="pair">
                        <div className="field">
                          <label>Crédito %</label>
                          <input
                            className="num nopre"
                            value={agreementForm.productionShare}
                            onChange={(event) =>
                              setAgreementForm((current) => ({
                                ...current,
                                productionShare: event.target.value,
                              }))
                            }
                            placeholder="58,33"
                          />
                        </div>
                        <div className="field">
                          <label>Seguro %</label>
                          <input
                            className="num nopre"
                            value={agreementForm.insuranceShare}
                            onChange={(event) =>
                              setAgreementForm((current) => ({
                                ...current,
                                insuranceShare: event.target.value,
                              }))
                            }
                            placeholder="35"
                          />
                        </div>
                      </div>
                      <div className="field">
                        <label>Observação</label>
                        <input
                          className="nopre"
                          value={agreementForm.notes}
                          onChange={(event) =>
                            setAgreementForm((current) => ({ ...current, notes: event.target.value }))
                          }
                          placeholder="Ex: acordo comercial abril"
                        />
                      </div>
                      <button className="save" type="submit" disabled={savingAgreement}>
                        {savingAgreement ? "Salvando…" : "Salvar acordo"}
                      </button>
                      {data.agreementRows.length > 0 ? (
                        <p className="agnote">
                          {data.agreementRows
                            .map(
                              (a) =>
                                `${a.agreement_type === "PRODUCTION" ? "Crédito" : "Seguro"}: ${a.commission_value
                                  .toFixed(2)
                                  .replace(".", ",")}%`
                            )
                            .join(" · ")}
                        </p>
                      ) : (
                        <p className="agnote">Sem acordo manual — usa a tabela mensal importada.</p>
                      )}
                    </form>
                  </div>
                )}
              </aside>
            </div>
          </section>
        ) : null}

        {/* PANEL: METAS & ESCALA */}
        {activeSection === "metas" ? (
          <section className="panel active">
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Metas &amp; escala · {competenceShort}</h2>
                  <p className="csub">
                    META / BÔNUS e a escala de repasse (% base / meta&nbsp;1 / meta&nbsp;2) por
                    promotor — em lote, salvar por linha. A escala alimenta o motor de comissão
                    (Frente C): grava em promoter_goal_repasse, a mesma fonte que o cálculo lê.
                  </p>
                </div>
                <span className="chip soft">{metasRows.length} promotores</span>
              </div>
              {metasLoading ? (
                <div className="state">Carregando metas…</div>
              ) : metasRows.length === 0 ? (
                <div className="state">Sem metas ou escala para esta competência.</div>
              ) : (
                <div className="scroll">
                  <table className="wide">
                    <thead>
                      <tr>
                        <th className="l sticky">Promotor</th>
                        <th className="l">Estado</th>
                        <th>Meta (R$)</th>
                        <th>Bônus 1 (R$)</th>
                        <th>Bônus 2 (R$)</th>
                        <th>Produção</th>
                        <th>Falta p/ meta</th>
                        <th className="l">Faixa</th>
                        <th>% Base</th>
                        <th>% Meta 1</th>
                        <th>% Meta 2</th>
                        <th>% Vigente</th>
                        <th className="l">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metasRows.map((row) => {
                        const d = metasDrafts[row.promoter_id];
                        if (!d) return null;
                        return (
                          <tr key={row.promoter_id}>
                            <td className="l sticky prom" data-l="Promotor">
                              {row.promoter_name}
                            </td>
                            <td className="l muted" data-l="Estado">
                              {row.estado}
                            </td>
                            <td className="num" data-l="Meta (R$)">
                              <input
                                className="mtin"
                                inputMode="decimal"
                                value={d.meta}
                                onChange={(e) => setMetaDraft(row.promoter_id, { meta: e.target.value })}
                              />
                            </td>
                            <td className="num" data-l="Bônus 1 (R$)">
                              <input
                                className="mtin"
                                inputMode="decimal"
                                value={d.bonus1}
                                onChange={(e) => setMetaDraft(row.promoter_id, { bonus1: e.target.value })}
                              />
                            </td>
                            <td className="num" data-l="Bônus 2 (R$)">
                              <input
                                className="mtin"
                                inputMode="decimal"
                                value={d.bonus2}
                                onChange={(e) => setMetaDraft(row.promoter_id, { bonus2: e.target.value })}
                              />
                            </td>
                            <td className="num" data-l="Produção">
                              {formatCurrency(row.production)}
                            </td>
                            <td className="num pay" data-l="Falta p/ meta">
                              {formatCurrency(row.falta_meta)}
                            </td>
                            <td className="l" data-l="Faixa">
                              <span className={`mtfaixa ${row.faixa.toLowerCase()}`}>
                                {FAIXA_LABEL[row.faixa]}
                              </span>
                            </td>
                            <td className="num" data-l="% Base">
                              <input
                                className="mtin pct"
                                inputMode="decimal"
                                placeholder="%"
                                value={d.pct_base}
                                onChange={(e) => setMetaDraft(row.promoter_id, { pct_base: e.target.value })}
                              />
                            </td>
                            <td className="num" data-l="% Meta 1">
                              <input
                                className="mtin pct"
                                inputMode="decimal"
                                placeholder="%"
                                value={d.pct_meta1}
                                onChange={(e) => setMetaDraft(row.promoter_id, { pct_meta1: e.target.value })}
                              />
                            </td>
                            <td className="num" data-l="% Meta 2">
                              <input
                                className="mtin pct"
                                inputMode="decimal"
                                placeholder="%"
                                value={d.pct_meta2}
                                onChange={(e) => setMetaDraft(row.promoter_id, { pct_meta2: e.target.value })}
                              />
                            </td>
                            <td className="num pay" data-l="% Vigente">
                              {pctLabel(row.pct_vigente)}
                            </td>
                            <td className="l" data-l="Ação">
                              <button
                                type="button"
                                className="tinybtn"
                                disabled={savingMetaId === row.promoter_id}
                                onClick={() => saveMetaRow(row)}
                              >
                                {savingMetaId === row.promoter_id ? "Salvando…" : "Salvar"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {/* PANEL: DESCONTOS */}
        {activeSection === "descontos" ? (
          <section className="panel active">
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Descontos lançados</h2>
                  <p className="csub">Abatimentos sobre a comissão a pagar</p>
                </div>
                <span className="chip soft">{data.discountRows.length} lançamentos</span>
              </div>
              <div className="scroll">
                {data.discountRows.length === 0 ? (
                  <div className="state">Nenhum desconto lançado para esta competência.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th className="l sticky">Tipo</th>
                        <th className="l">Proposta</th>
                        <th>Parcela</th>
                        <th>Valor</th>
                        <th className="l">Destino</th>
                        <th className="l">Obs.</th>
                        <th className="l">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.discountRows.map((row) => (
                        <tr key={row.id}>
                          <td className="l sticky" data-l="Tipo">
                            {row.discount_type}
                          </td>
                          <td className="l" data-l="Proposta">
                            {row.proposal_number || "-"}
                          </td>
                          <td data-l="Parcela">
                            {row.installment_number} / {row.installments}
                          </td>
                          <td className="num neg" data-l="Valor">
                            −{formatCurrency(row.amount)}
                          </td>
                          <td className="l" data-l="Destino">
                            {row.apply_to_company ? "Empresa" : "Promotor"}
                          </td>
                          <td className="l muted" data-l="Obs.">
                            {row.notes || "-"}
                          </td>
                          <td className="l" data-l="Ações">
                            <div className="actions">
                              <button type="button" className="linkbtn" onClick={() => editDiscount(row)}>
                                Editar
                              </button>
                              <button
                                type="button"
                                className="iconbtn"
                                title="Remover"
                                onClick={() => deleteDiscount(row.id)}
                                disabled={deletingDiscountId === row.id}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* NOVO DESCONTO — formulário completo preservado */}
              <form className="ndform" onSubmit={handleDiscountSubmit}>
                <div className="field">
                  <label>Promotor</label>
                  <select
                    value={discountForm.promoterId}
                    onChange={(event) =>
                      setDiscountForm((current) => ({ ...current, promoterId: event.target.value }))
                    }
                  >
                    <option value="">Selecione</option>
                    {data.promoterOptions.map((promoter) => (
                      <option key={promoter.id} value={promoter.id}>
                        {promoter.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Tipo</label>
                  <select
                    value={discountForm.discountType}
                    onChange={(event) =>
                      setDiscountForm((current) => ({ ...current, discountType: event.target.value }))
                    }
                  >
                    <option value="LIQUIDACAO_ANTECIPADA">Liquidação antecipada</option>
                    <option value="CANCELAMENTO_SEGURO">Cancelamento de seguro</option>
                    <option value="ESTORNO_CREDITO">Estorno de crédito</option>
                    <option value="ADIANTAMENTO">Adiantamento</option>
                    <option value="OUTROS">Outros débitos</option>
                  </select>
                </div>
                <div className="field">
                  <label>Proposta vinculada</label>
                  <select
                    value={discountForm.dailyProductionRecordId}
                    onChange={(event) =>
                      setDiscountForm((current) => ({
                        ...current,
                        dailyProductionRecordId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Sem vínculo</option>
                    {data.proposalRows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.proposal_number} · {row.product_description}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Valor da empresa (R$)</label>
                  <input
                    value={discountForm.companyAmount}
                    onChange={(event) =>
                      setDiscountForm((current) => ({ ...current, companyAmount: event.target.value }))
                    }
                    placeholder="Base p/ 70%"
                  />
                </div>
                <div className="field">
                  <label>Valor do promotor (R$)</label>
                  <input
                    value={discountForm.amount}
                    onChange={(event) =>
                      setDiscountForm((current) => ({ ...current, amount: event.target.value }))
                    }
                    placeholder="Se vazio, calcula 70%"
                  />
                </div>
                <div className="field">
                  <label>Parcelas</label>
                  <input
                    value={discountForm.installments}
                    onChange={(event) =>
                      setDiscountForm((current) => ({ ...current, installments: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Parcela atual</label>
                  <input
                    value={discountForm.installmentNumber}
                    onChange={(event) =>
                      setDiscountForm((current) => ({
                        ...current,
                        installmentNumber: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Observação</label>
                  <input
                    value={discountForm.notes}
                    onChange={(event) =>
                      setDiscountForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder="Ex: parcelado em 3x"
                  />
                </div>
                <label className="chkrow">
                  <input
                    type="checkbox"
                    checked={discountForm.applyToCompany}
                    onChange={(event) =>
                      setDiscountForm((current) => ({ ...current, applyToCompany: event.target.checked }))
                    }
                  />
                  <span>Fica na empresa, não no promotor</span>
                </label>
                <button className="tinybtn" type="submit" disabled={savingDiscount}>
                  {savingDiscount ? "Salvando…" : discountForm.id ? "Atualizar" : "Adicionar"}
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {/* PANEL: DETALHAMENTO */}
        {activeSection === "detalhamento" ? (
          <section className="panel active">
            <div className="dk">
              <div className="dkc">
                <p className="k">Comissão PF (promotor)</p>
                <div className="v num">{formatCurrency(proposalTotals.promoterCommission)}</div>
              </div>
              <div className="dkc">
                <p className="k">Comissão seguro (promotor)</p>
                <div className="v num">{formatCurrency(proposalTotals.promoterInsurance)}</div>
              </div>
              <div className="dkc">
                <p className="k">Descontos</p>
                <div className={`v num${promoterDiscountTotal > 0 ? " neg" : ""}`}>
                  {promoterDiscountTotal > 0
                    ? `−${formatCurrency(promoterDiscountTotal)}`
                    : formatCurrency(0)}
                </div>
              </div>
              <div className="dkc hl">
                <p className="k">Líquido</p>
                <div className="v num">
                  {formatCurrency(selectedPromoterSummary?.payable_commission_value)}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Detalhamento de propostas</h2>
                  <p className="csub">
                    Contrato → comissão · {competenceShort}. Só propostas em Produção; % à vista e
                    Comissão PF já saem limitados ao teto de 5,80%.
                  </p>
                </div>
                <div className="head-actions">
                  <Link className="linkbtn" href={`/comissoes/editar${specialistQuery}`}>
                    Editar comissões →
                  </Link>
                  <span className="chip soft">{data.proposalRows.length} propostas</span>
                </div>
              </div>
              {loading ? (
                <div className="state">Carregando detalhamento…</div>
              ) : !promoterId ? (
                <div className="state">Selecione um promotor para detalhar as operações.</div>
              ) : data.proposalRows.length === 0 ? (
                <div className="state">
                  Nenhuma proposta com status Produção encontrada para este promotor.
                </div>
              ) : (
                <div className="scroll">
                  <table className="wide">
                    <thead>
                      <tr>
                        <th className="l sticky">Contrato</th>
                        <th>Valor bruto</th>
                        <th>Valor líquido</th>
                        <th>Parcela</th>
                        <th className="l">Agência</th>
                        <th className="l">Chave J</th>
                        <th className="l">Promotor(a)</th>
                        <th className="l">Data contratação</th>
                        <th>Tx juros</th>
                        <th className="l">Descrição do produto</th>
                        <th>% à vista</th>
                        <th>Comissão PF</th>
                        <th className="l">Restrição SRCC</th>
                        <th>Valor seguro</th>
                        <th>Comissão seguro</th>
                        <th>% penetração</th>
                        <th>% Promotor</th>
                        <th>Comissão promotor</th>
                        <th>Comissão seguro promotor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.proposalRows.map((row) => (
                        <tr key={row.id}>
                          <td className="l sticky ctr" data-l="Contrato">
                            {row.contract_number}
                          </td>
                          <td className="num" data-l="Valor bruto">
                            {formatCurrency(row.gross_value)}
                          </td>
                          <td className="num" data-l="Valor líquido">
                            {formatCurrency(row.net_value)}
                          </td>
                          <td className="num" data-l="Parcela">
                            {row.installment_count || "-"}
                          </td>
                          <td className="l" data-l="Agência">
                            {row.agency_code}
                          </td>
                          <td className="l" data-l="Chave J">
                            {row.j_key || "-"}
                          </td>
                          <td className="l" data-l="Promotor(a)">
                            {row.promoter_name || "-"}
                          </td>
                          <td className="l" data-l="Data contratação">
                            {formatDate(row.contract_date)}
                          </td>
                          <td className="num" data-l="Tx juros">
                            {row.interest_rate ? row.interest_rate.toFixed(2).replace(".", ",") : "-"}
                          </td>
                          <td className="l" data-l="Produto">
                            {row.product_description}
                          </td>
                          <td className="num" data-l="% à vista">
                            {formatPercent(row.company_received_percent * 100, 2)}
                          </td>
                          <td className="num" data-l="Comissão PF">
                            {formatCurrency(row.company_commission_amount)}
                          </td>
                          <td className="l" data-l="Restrição SRCC">
                            {row.srcc_restriction}
                          </td>
                          <td className="num" data-l="Valor seguro">
                            {formatCurrency(row.insurance_value)}
                          </td>
                          <td className="num" data-l="Comissão seguro">
                            {formatCurrency(row.company_insurance_commission_amount)}
                          </td>
                          <td className="num" data-l="% penetração">
                            {formatPercent(row.insurance_penetration_percent * 100, 2)}
                          </td>
                          <td className="num pay" data-l="% Promotor">
                            {formatPercent(clampPromoterPercent(row.promoter_commission_percent), 2)}
                          </td>
                          <td className="num pay" data-l="Comissão promotor">
                            {formatCurrency(row.promoter_commission_amount)}
                          </td>
                          <td className="num pay" data-l="Comissão seguro promotor">
                            {formatCurrency(row.insurance_commission_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="total">
                        <td className="l sticky" data-l="">
                          TOTAL
                        </td>
                        <td />
                        <td className="num">{formatCurrency(proposalTotals.net)}</td>
                        <td colSpan={8} />
                        <td className="num">{formatCurrency(proposalTotals.companyCommission)}</td>
                        <td />
                        <td />
                        <td className="num">{formatCurrency(proposalTotals.companyInsurance)}</td>
                        <td />
                        <td />
                        <td className="num">{formatCurrency(proposalTotals.promoterCommission)}</td>
                        <td className="num">{formatCurrency(proposalTotals.promoterInsurance)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {/* PANEL: MIGRAÇÃO */}
        {activeSection === "migracao" ? (
          <section className="panel active">
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Migração de propostas</h2>
                  <p className="csub">Reatribuir proposta a outro promotor</p>
                </div>
                <span className="chip soft">Somente produção</span>
              </div>
              {loading ? (
                <div className="state">Carregando propostas…</div>
              ) : !promoterId ? (
                <div className="state">Selecione um promotor para detalhar as propostas.</div>
              ) : data.proposalRows.length === 0 ? (
                <div className="state">Nenhuma proposta encontrada para este promotor.</div>
              ) : (
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th className="l sticky">Proposta</th>
                        <th className="l">Produto</th>
                        <th className="l">Promotor atual</th>
                        <th className="l">Migrar para</th>
                        <th className="l">Motivo</th>
                        <th className="l">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.proposalRows.map((row) => (
                        <tr key={row.id}>
                          <td className="l sticky prom" data-l="Proposta">
                            {row.proposal_number}
                            <small>{formatDate(row.movement_date || row.contract_date)}</small>
                          </td>
                          <td className="l" data-l="Produto">
                            {row.product_description}
                          </td>
                          <td className="l" data-l="Promotor atual">
                            {row.assigned_promoter_name || "-"}
                          </td>
                          <td className="l" data-l="Migrar para">
                            <span className="miginsel">
                              <select
                                value={proposalTargets[row.id] || ""}
                                onChange={(event) =>
                                  setProposalTargets((current) => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))
                                }
                              >
                                <option value="">Selecionar…</option>
                                {data.promoterLookup
                                  .filter((promoter) => promoter.id !== row.assigned_promoter_id)
                                  .map((promoter) => (
                                    <option key={promoter.id} value={promoter.id}>
                                      {promoter.name}
                                    </option>
                                  ))}
                              </select>
                              <span className="chev">▾</span>
                            </span>
                          </td>
                          <td className="l" data-l="Motivo">
                            <input
                              className="reason"
                              value={proposalReasons[row.id] || ""}
                              onChange={(event) =>
                                setProposalReasons((current) => ({
                                  ...current,
                                  [row.id]: event.target.value,
                                }))
                              }
                              placeholder="Ex: Chave master"
                            />
                          </td>
                          <td className="l" data-l="Ação">
                            <button
                              type="button"
                              className="tinybtn"
                              onClick={() => moveProposal(row)}
                              disabled={movingProposalId === row.id}
                            >
                              {movingProposalId === row.id ? "Migrando…" : "Migrar"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function parseBrazilianNumber(value: string) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value?: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function formatPercent(value?: number, digits = 1) {
  return `${Number(value || 0).toFixed(digits).replace(".", ",")}%`;
}

function clampPromoterPercent(value?: number) {
  return Math.min(Math.max(Number(value || 0), 0), 5.8);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

// ---- Aba "Metas & escala" (migrada da /metas) ----
type MetaRow = {
  promoter_id: string;
  promoter_name: string;
  company_id: string | null;
  company_name: string;
  estado: string;
  meta: number;
  bonus1: number;
  bonus2: number;
  production: number;
  falta_meta: number;
  faixa: "BASE" | "META1" | "META2";
  pct_vigente: number | null;
  pct_base: number | null;
  pct_meta1: number | null;
  pct_meta2: number | null;
  has_repasse: boolean;
};
type MetaDraft = {
  meta: string;
  bonus1: string;
  bonus2: string;
  pct_base: string;
  pct_meta1: string;
  pct_meta2: string;
};

const FAIXA_LABEL: Record<string, string> = {
  BASE: "Base",
  META1: "Meta 1",
  META2: "Meta 2",
};

// decimal (0.6666) -> display ("66.66"); valor R$ -> string crua.
function metaRowToDraft(r: MetaRow): MetaDraft {
  const pp = (f: number | null) => (f == null ? "" : String(+(f * 100).toFixed(4)));
  return {
    meta: r.meta ? String(r.meta) : "",
    bonus1: r.bonus1 ? String(r.bonus1) : "",
    bonus2: r.bonus2 ? String(r.bonus2) : "",
    pct_base: pp(r.pct_base),
    pct_meta1: pp(r.pct_meta1),
    pct_meta2: pp(r.pct_meta2),
  };
}

function pctLabel(fraction: number | null) {
  if (fraction == null) return "—";
  return `${(fraction * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

const CSS = `
.rrprom{
  --navy:#0F1F4A; --navy-deep:#0B1838; --navy-bar:#1E3066;
  --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A;
  --green:#3C9D6B; --green-soft:#5FB98A; --green-bg:#E9F5EE;
  --red:#C0443C; --red-bg:#FBECEB;
  --amber:#B07A12; --amber-bg:#FBF1DC; --amber-bd:#EAD7A6;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);
  font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrprom *{box-sizing:border-box;}
.rrprom .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrprom .wrap{max-width:1180px;margin:0 auto;padding:34px 28px 56px;display:flex;flex-direction:column;gap:20px;}

.rrprom .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:-6px 2px -2px;}
.rrprom .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rrprom .crumb a:hover{color:var(--navy);}
.rrprom .crumb .sep{color:#C2C8D2;}

/* bloco navy + marca + h1 agora vêm do <HeaderNavy> do kit; .comp (select) fica */
.rrprom .comp{position:relative;}
.rrprom .comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 36px 8px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrprom .comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrprom .comp select option{color:#16203A;}
.rrprom .comp .chev{position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9DA9C6;font-size:11px;}

/* faixa de KPIs agora vem do <KpiBand valueSize={25}> do kit; .pend (botão custom no sub) fica */
.rrprom .pend{display:inline-block;margin-top:7px;font-size:11.5px;font-weight:500;color:var(--gold);background:none;border:none;border-bottom:1px dashed rgba(214,161,63,.45);padding:0 0 1px;cursor:pointer;font-family:inherit;text-align:left;transition:color .14s,border-color .14s;}
.rrprom .pend:hover{color:#fff;border-color:rgba(255,255,255,.6);}

.rrprom .banner{border-radius:var(--r-md);padding:12px 16px;font-size:13px;}
.rrprom .banner.err{background:var(--red-bg);border:1px solid #E9B7B2;color:#8E2F28;}
.rrprom .banner.ok{background:var(--green-bg);border:1px solid #B6DEC8;color:#1F6B45;}

.rrprom .filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--card);border:1px solid var(--bd);border-radius:var(--r-md);padding:13px 16px;box-shadow:var(--shadow);}
.rrprom .fsel{position:relative;}
.rrprom .fsel select{appearance:none;-webkit-appearance:none;background:#F6F7FA;border:1px solid var(--bd);color:var(--ink-2);padding:8px 30px 8px 12px;border-radius:9px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;max-width:230px;}
.rrprom .fsel select:focus{outline:none;border-color:#BFC6D2;}
.rrprom .fsel .chev{position:absolute;right:11px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--ink-3);font-size:10px;}
.rrprom .fbtn{display:inline-flex;align-items:center;gap:7px;border-radius:9px;padding:9px 14px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid var(--bd);background:#F6F7FA;color:var(--ink-2);transition:.15s;text-decoration:none;}
.rrprom .fbtn:hover{border-color:#BFC6D2;}
.rrprom .fbtn:disabled{opacity:.6;cursor:default;}
.rrprom .fbtn.primary{background:var(--navy);border-color:var(--navy);color:#fff;}
.rrprom .fbtn.primary:hover{background:#16285C;}
.rrprom .fbtn.primary .ic{color:var(--yellow);}
.rrprom .fbtn .ic{display:grid;place-items:center;}
.rrprom .chip{margin-left:auto;font-size:12px;font-weight:500;color:var(--ink-3);background:#F1F3F7;border:1px solid var(--bd);padding:7px 12px;border-radius:999px;white-space:nowrap;}
.rrprom .chip.soft{margin-left:0;}
.rrprom .chip b{color:var(--ink-2);font-weight:600;}

.rrprom .tabs{display:flex;gap:4px;border-bottom:1px solid var(--bd);padding:0 2px;overflow-x:auto;}
.rrprom .tab{appearance:none;background:none;border:none;font-family:inherit;font-size:13.5px;font-weight:600;color:var(--ink-3);padding:12px 16px 14px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s;}
.rrprom .tab:hover{color:var(--ink-2);}
.rrprom .tab.active{color:var(--navy);border-bottom-color:var(--navy);}

.rrprom .panel{display:block;}

.rrprom .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);}
.rrprom .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 24px 14px;}
.rrprom .card-head h2{font-size:15.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrprom .card-head .csub{font-size:12px;color:var(--ink-3);margin:4px 0 0;max-width:640px;}
.rrprom .head-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.rrprom .state{padding:26px 24px;font-size:13.5px;color:var(--ink-3);}

.rrprom .scroll{overflow:auto;max-height:calc(100vh - 240px);}
.rrprom table{border-collapse:collapse;width:100%;min-width:760px;font-size:13.5px;}
.rrprom table.wide{min-width:1600px;}
.rrprom thead th{position:sticky;top:0;z-index:3;font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3);text-align:right;padding:11px 16px;border-bottom:1px solid var(--bd);white-space:nowrap;background:var(--card);}
.rrprom thead th.l{text-align:left;}
.rrprom tbody td{padding:13px 16px;border-bottom:1px solid var(--bd-soft);text-align:right;white-space:nowrap;color:var(--ink);}
.rrprom tbody td.l{text-align:left;}
.rrprom tbody tr:last-child td{border-bottom:none;}
.rrprom .sticky{position:sticky;left:0;z-index:2;background:var(--card);}
/* canto superior-esquerdo (cabeçalho da 1ª coluna): acima do thead (z3) e da
   coluna (z2). Hierarquia: canto(4) > thead(3) > coluna(2) > normal. */
.rrprom thead th.sticky{z-index:4;}
.rrprom .sticky::after{content:"";position:absolute;top:0;right:0;width:14px;height:100%;transform:translateX(100%);background:linear-gradient(90deg,rgba(15,31,74,.06),rgba(15,31,74,0));pointer-events:none;}
.rrprom .prom{font-weight:600;}
.rrprom .prom small{display:block;font-weight:500;font-size:11.5px;color:var(--ink-3);margin-top:1px;}
.rrprom .ctr{font-weight:600;}
.rrprom tbody tr.clk{cursor:pointer;transition:background .12s;}
.rrprom tbody tr.clk:hover td{background:#F8F9FC;}
.rrprom tbody tr.clk:hover td.sticky{background:#F8F9FC;}
.rrprom tbody tr.sel td{background:#F2F5FF;}
.rrprom tbody tr.sel td.sticky{background:#F2F5FF;box-shadow:inset 3px 0 0 var(--navy);}
.rrprom .badge2{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:999px;}
.rrprom .badge2.ok{color:var(--green);background:var(--green-bg);}
.rrprom .badge2.low{color:var(--amber);background:var(--amber-bg);border:1px solid var(--amber-bd);}
.rrprom .badge2 .d{width:6px;height:6px;border-radius:50%;background:currentColor;}
.rrprom .pay{font-weight:600;color:var(--ink);}
.rrprom .neg{color:var(--red);}
.rrprom .muted{color:var(--ink-2);}
.rrprom .mtin{width:96px;border:1px solid var(--bd);border-radius:8px;padding:7px 9px;font-family:inherit;font-size:13px;color:var(--ink);text-align:right;background:#fff;}
.rrprom .mtin:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rrprom .mtin.pct{width:70px;}
.rrprom .mtfaixa{display:inline-flex;align-items:center;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;}
.rrprom .mtfaixa.base{color:var(--ink-2);background:#F1F3F7;border:1px solid var(--bd);}
.rrprom .mtfaixa.meta1{color:var(--amber);background:var(--amber-bg);border:1px solid var(--amber-bd);}
.rrprom .mtfaixa.meta2{color:var(--gold-deep);background:#FBF1DC;border:1px solid #EAD7A6;}
.rrprom tfoot td{padding:13px 16px;border-top:1.5px solid var(--bd);font-weight:600;text-align:right;white-space:nowrap;background:#FBFBFD;}
.rrprom tfoot td.l{text-align:left;color:var(--ink-2);}
.rrprom tfoot .sticky{background:#FBFBFD;}

.rrprom .linkbtn{appearance:none;background:none;border:none;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--navy);cursor:pointer;text-decoration:none;padding:0;}
.rrprom .linkbtn:hover{text-decoration:underline;}
.rrprom .actions{display:inline-flex;align-items:center;gap:10px;justify-content:flex-end;}
.rrprom .iconbtn{appearance:none;border:1px solid var(--bd);background:#F6F7FA;border-radius:8px;width:32px;height:32px;display:inline-grid;place-items:center;cursor:pointer;color:var(--ink-3);}
.rrprom .iconbtn:hover{border-color:#BFC6D2;color:var(--red);}
.rrprom .iconbtn:disabled{opacity:.5;cursor:default;}

.rrprom .resumo-grid{display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start;}
.rrprom .edit{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:22px 22px;position:sticky;top:20px;}
.rrprom .edit h3{font-size:14.5px;font-weight:600;margin:0;color:var(--ink);}
.rrprom .edit .who{font-size:12.5px;color:var(--ink-3);margin:3px 0 0;}
.rrprom .edit .empty{font-size:13px;color:var(--ink-3);line-height:1.6;}
.rrprom .mini{margin-top:18px;padding-top:18px;border-top:1px solid var(--bd-soft);}
.rrprom .mini h4{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3);margin:0 0 12px;}
.rrprom .field{margin-bottom:12px;}
.rrprom .field label{display:block;font-size:12px;font-weight:500;color:var(--ink-2);margin-bottom:5px;}
.rrprom .field .inwrap{position:relative;}
.rrprom .field .pre{position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:12.5px;color:var(--ink-3);}
.rrprom .field input,.rrprom .field select{width:100%;border:1px solid var(--bd);border-radius:9px;padding:9px 12px;font-family:inherit;font-size:13.5px;color:var(--ink);background:#fff;}
.rrprom .field input.num{padding-left:32px;}
.rrprom .field input.nopre{padding-left:12px;}
.rrprom .field input:focus,.rrprom .field select:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rrprom .pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.rrprom .save{width:100%;margin-top:6px;background:var(--navy);color:#fff;border:none;border-radius:10px;padding:11px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;}
.rrprom .save:hover{background:#16285C;}
.rrprom .save:disabled{opacity:.6;cursor:default;}
.rrprom .agnote{font-size:11.5px;color:var(--ink-3);margin:12px 0 0;}

.rrprom .ndform{display:grid;grid-template-columns:repeat(4,1fr);gap:12px 14px;align-items:end;padding:18px 24px 22px;border-top:1px solid var(--bd-soft);}
.rrprom .ndform .field{margin-bottom:0;}
.rrprom .ndform .chkrow{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-2);grid-column:1 / -1;}
.rrprom .ndform .chkrow input{width:auto;}
.rrprom .tinybtn{background:var(--navy);color:#fff;border:none;border-radius:9px;padding:10px 16px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;}
.rrprom .tinybtn:hover{background:#16285C;}
.rrprom .tinybtn:disabled{opacity:.6;cursor:default;}

.rrprom .dk{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px;}
.rrprom .dkc{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-md);box-shadow:var(--shadow);padding:16px 18px;}
.rrprom .dkc .k{font-size:11.5px;font-weight:500;color:var(--ink-3);margin:0 0 8px;}
.rrprom .dkc .v{font-size:21px;font-weight:600;letter-spacing:-.01em;color:var(--ink);}
.rrprom .dkc.hl .v{color:var(--gold-deep);}

.rrprom .miginsel{position:relative;display:inline-block;}
.rrprom .miginsel select{appearance:none;-webkit-appearance:none;background:#F6F7FA;border:1px solid var(--bd);color:var(--ink-2);padding:7px 26px 7px 10px;border-radius:8px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrprom .miginsel select:focus{outline:none;border-color:var(--navy);}
.rrprom .miginsel .chev{position:absolute;right:9px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--ink-3);font-size:9px;}
.rrprom input.reason{border:1px solid var(--bd);border-radius:8px;padding:7px 10px;font-family:inherit;font-size:12.5px;color:var(--ink);background:#fff;min-width:160px;}
.rrprom input.reason:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}

@media (max-width:980px){
  .rrprom .resumo-grid{grid-template-columns:1fr;}
  .rrprom .edit{position:static;}
  .rrprom .ndform{grid-template-columns:repeat(2,1fr);}
  .rrprom .dk{grid-template-columns:1fr 1fr;}
}
@media (max-width:720px){
  .rrprom .wrap{padding:18px 14px 40px;gap:16px;}
  .rrprom .ndform{grid-template-columns:1fr;}

  /* mobile-card: desfaz a janela de scroll vertical do desktop para os cards
     empilharem livremente (o thead some logo abaixo via display:none). */
  .rrprom .scroll{max-height:none;overflow:visible;}
  .rrprom table.wide{min-width:0;}
  .rrprom table,.rrprom thead,.rrprom tbody,.rrprom tfoot,.rrprom tr,.rrprom th,.rrprom td{display:block;}
  .rrprom table{min-width:0;}
  .rrprom thead{display:none;}
  .rrprom tbody tr{border:1px solid var(--bd);border-radius:12px;margin-bottom:12px;padding:6px 14px;}
  .rrprom tbody tr.sel{border-color:var(--navy);}
  .rrprom tbody td{display:flex;justify-content:space-between;align-items:center;gap:16px;text-align:right;padding:9px 0;border-bottom:1px solid var(--bd-soft);white-space:normal;}
  .rrprom tbody td:last-child{border-bottom:none;}
  .rrprom tbody td.sticky{position:static;box-shadow:none!important;}
  .rrprom tbody td.sticky::after{display:none;}
  .rrprom tbody td::before{content:attr(data-l);font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-3);text-align:left;}
  .rrprom tbody td.l{text-align:right;}
  .rrprom .prom small{display:inline;margin-left:6px;}
  .rrprom tfoot td{display:flex;justify-content:space-between;background:none;border:none;border-top:1px solid var(--bd-soft);}
  .rrprom tfoot td::before{content:attr(data-l);font-weight:600;color:var(--ink-2);}
}
`;
