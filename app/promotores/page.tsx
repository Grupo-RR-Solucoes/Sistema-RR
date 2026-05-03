"use client";

import type { CSSProperties, FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import FeedbackBanner from "../../components/FeedbackBanner";

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
  const [activeSection, setActiveSection] = useState<
    "resumo" | "descontos" | "detalhamento" | "migracao"
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
  const [targetForm, setTargetForm] = useState({
    promoterId: "",
    meta: "",
    meta1: "",
    meta2: "",
  });
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
  const [savingTarget, setSavingTarget] = useState(false);
  const [savingAgreement, setSavingAgreement] = useState(false);
  const [savingDiscount, setSavingDiscount] = useState(false);
  const [deletingDiscountId, setDeletingDiscountId] = useState("");
  const [proposalTargets, setProposalTargets] = useState<Record<string, string>>({});
  const [proposalReasons, setProposalReasons] = useState<Record<string, string>>({});
  const [movingProposalId, setMovingProposalId] = useState("");

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

  useEffect(() => {
    if (!selectedKey && data.selectedPeriod.key) {
      setSelectedKey(data.selectedPeriod.key);
    }
  }, [data.selectedPeriod.key, selectedKey]);

  useEffect(() => {
    if (!promoterId && data.selectedPromoterId) {
      setPromoterId(data.selectedPromoterId);
    }
  }, [data.selectedPromoterId, promoterId]);

  useEffect(() => {
    const selectedSummary = data.summaryRows.find((row) => row.promoter_id === promoterId);

    if (!selectedSummary) {
      return;
    }

    setTargetForm({
      promoterId: selectedSummary.promoter_id,
      meta: selectedSummary.target_value ? String(selectedSummary.target_value) : "",
      meta1: selectedSummary.target_1_value ? String(selectedSummary.target_1_value) : "",
      meta2: selectedSummary.target_2_value ? String(selectedSummary.target_2_value) : "",
    });
  }, [data.summaryRows, promoterId]);

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

  async function handleTargetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setSavingTarget(true);
      setError("");
      setNotice("");

      const [year, month] = (selectedKey || data.selectedPeriod.key || "").split("-");

      const selectedSummary = data.summaryRows.find(
        (row) => row.promoter_id === targetForm.promoterId
      );

      const response = await fetch("/api/promotores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "target_upsert",
          promoterId: targetForm.promoterId,
          companyId: selectedSummary?.company_id || null,
          year: Number(year),
          month: Number(month),
          meta: parseBrazilianNumber(targetForm.meta),
          meta1: parseBrazilianNumber(targetForm.meta1),
          meta2: parseBrazilianNumber(targetForm.meta2),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao salvar meta.");
      }

      setReloadKey((value) => value + 1);
      setNotice("Meta mensal salva com sucesso.");
    } catch (err: any) {
      setError(err.message || "Erro ao salvar meta.");
    } finally {
      setSavingTarget(false);
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

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Gestao comercial</div>
          <h2 style={styles.title}>Promotores, metas e comissoes</h2>
          <p style={styles.description}>
            Esta visao junta resumo mensal, meta individual, recalculo da
            competencia e migracao manual de propostas para tratar Chave J master,
            novatos e ajustes de carteira sem sair do sistema.
          </p>
          <div style={styles.heroSignals}>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Base padrao</span>
              <strong style={styles.heroSignalValue}>58,33%</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Teto do promotor</span>
              <strong style={styles.heroSignalValue}>5,80%</strong>
            </div>
            <div style={styles.heroSignal}>
              <span style={styles.heroSignalLabel}>Descontos</span>
              <strong style={styles.heroSignalValue}>Controle editavel</strong>
            </div>
          </div>
        </article>

        <article style={styles.heroAside}>
          <div style={styles.heroAsideLabel}>Atalhos especialistas</div>
          <p style={styles.heroAsideDescription}>
            Ajustes finos por promotor, produto ou proposta sem sair do fluxo comercial.
          </p>
          <div style={styles.quickLinks}>
            <Link href={`/comissoes/editar${specialistQuery}`} style={styles.quickLink}>
              <span style={styles.quickLinkTitle}>Excecao por proposta</span>
              <span style={styles.quickLinkDescription}>
                Trate acordos pontuais, divergencias e situacoes individuais.
              </span>
            </Link>
            <Link href={`/comissoes/produto${specialistQuery}`} style={styles.quickLink}>
              <span style={styles.quickLinkTitle}>Regra por produto</span>
              <span style={styles.quickLinkDescription}>
                Defina repasses dedicados por promotor e linha comercial.
              </span>
            </Link>
          </div>
        </article>
      </div>

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="Comercial interrompido"
          title="Nao foi possivel concluir a operacao dos promotores."
          description={error}
        />
      ) : null}
      {notice ? (
        <FeedbackBanner
          variant="success"
          eyebrow="Comercial atualizado"
          title="A base de promotores foi atualizada com sucesso."
          description={notice}
        />
      ) : null}

      <section style={styles.filterCard}>
        <div style={styles.filterHeader}>
          <div>
            <div style={styles.filterKicker}>Painel operacional</div>
            <h3 style={styles.filterTitle}>Filtros e processamento da competencia</h3>
          </div>
          <div style={styles.sectionChip}>
            {data.periods.find((period) => period.key === (selectedKey || data.selectedPeriod.key))
              ?.label ||
              data.selectedPeriod.label ||
              "Sem competencia"}
          </div>
        </div>
        <div style={styles.filterGrid}>
          <FormRow label="Competencia">
            <select
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.target.value)}
              style={styles.input}
            >
              {data.periods.map((period) => (
                <option key={period.key} value={period.key}>
                  {period.label}
                </option>
              ))}
            </select>
          </FormRow>

          <FormRow label="Empresa">
            <select
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setPromoterId("");
              }}
              style={styles.input}
            >
              <option value="">Todas</option>
              {data.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </FormRow>

          <FormRow label="Promotor detalhado">
            <select
              value={promoterId}
              onChange={(event) => setPromoterId(event.target.value)}
              style={styles.input}
            >
              <option value="">Selecione</option>
              {data.promoterOptions.map((promoter) => (
                <option key={promoter.id} value={promoter.id}>
                  {promoter.name}
                </option>
              ))}
            </select>
          </FormRow>

          <div style={styles.filterActionWrap}>
            <button
              type="button"
              onClick={recalculateMonth}
              style={styles.primaryButton}
              disabled={recalculating}
            >
              {recalculating ? "Recalculando..." : "Recalcular competencia"}
            </button>
          </div>
        </div>
        <div style={styles.filterFoot}>
          <div style={styles.filterHint}>
            Se houver promotor selecionado, o recalculo atua so nele. Sem selecao,
            o sistema recalcula a competencia inteira.
          </div>
          <div style={styles.sectionChip}>
            {data.summary.promoters} promotores | {data.proposalRows.length} propostas visiveis
          </div>
        </div>
      </section>

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Promotores"
          value={String(data.summary.promoters)}
          detail="Promotores com movimento ou cadastro no filtro atual."
        />
        <SummaryCard
          label="Producao"
          value={formatCurrency(data.summary.production)}
          detail="Soma da producao valida usando valor financiado liquido."
        />
        <SummaryCard
          label="Comissao bruta"
          value={formatCurrency(data.summary.finalCommission)}
          detail="Antes dos descontos e estornos do promotor."
        />
        <SummaryCard
          label="Comissao a pagar"
          value={formatCurrency(data.summary.payableCommission)}
          detail={`Descontos atuais em ${formatCurrency(data.summary.discounts)}.`}
        />
        <SummaryCard
          label="Penetracao media"
          value={formatPercent(data.summary.averageInsurancePenetration)}
          detail="Media da penetracao de seguro entre os promotores filtrados."
        />
      </div>

      <div style={styles.subsectionNav}>
        <button
          type="button"
          onClick={() => setActiveSection("resumo")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "resumo" ? styles.subsectionButtonActive : {}),
          }}
        >
          Resumo e acordos
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("descontos")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "descontos" ? styles.subsectionButtonActive : {}),
          }}
        >
          Descontos
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("detalhamento")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "detalhamento" ? styles.subsectionButtonActive : {}),
          }}
        >
          Detalhamento
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("migracao")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "migracao" ? styles.subsectionButtonActive : {}),
          }}
        >
          Migracao
        </button>
      </div>

      {activeSection === "resumo" ? (
      <div style={styles.contentGrid}>
        <article style={styles.tableCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Resumo mensal</div>
              <h3 style={styles.sectionTitle}>Painel dos promotores</h3>
            </div>
            <div style={styles.sectionChip}>{data.summaryRows.length} linhas</div>
          </div>

          {loading ? (
            <div style={styles.emptyState}>Carregando promotores...</div>
          ) : data.summaryRows.length === 0 ? (
            <div style={styles.emptyState}>Nenhum promotor encontrado para esta competencia.</div>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Promotor</th>
                    <th style={styles.th}>Empresa</th>
                    <th style={styles.th}>Producao</th>
                    <th style={styles.th}>Penetracao</th>
                    <th style={styles.th}>Meta</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Bruta</th>
                    <th style={styles.th}>Desconto</th>
                    <th style={styles.th}>A pagar</th>
                    <th style={styles.th}>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summaryRows.map((row) => (
                    <tr
                      key={row.promoter_id}
                      onClick={() => setPromoterId(row.promoter_id)}
                      style={
                        promoterId === row.promoter_id ? styles.tableRowSelected : undefined
                      }
                    >
                      <td style={styles.td}>
                        <div style={styles.itemTitle}>{row.promoter_name}</div>
                        <div style={styles.itemMeta}>
                          {row.j_keys_count} Chaves J | {row.proposal_count} propostas
                        </div>
                      </td>
                      <td style={styles.td}>{row.company_name}</td>
                      <td style={styles.td}>{formatCurrency(row.production_value)}</td>
                      <td style={styles.td}>{formatPercent(row.insurance_penetration_percent)}</td>
                      <td style={styles.td}>
                        {formatCurrency(row.target_value)} / {formatCurrency(row.target_1_value)} /{" "}
                        {formatCurrency(row.target_2_value)}
                      </td>
                      <td style={styles.td}>
                        <span style={styles.badge}>{row.target_status}</span>
                      </td>
                      <td style={styles.td}>{formatCurrency(row.final_commission_value)}</td>
                      <td style={styles.td}>{formatCurrency(row.discount_value)}</td>
                      <td style={styles.tdStrong}>{formatCurrency(row.payable_commission_value)}</td>
                      <td style={styles.td}>{row.result_source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <aside style={styles.sideRail}>
          <article style={styles.sideCard}>
            <div style={styles.sectionHeaderCompact}>
              <div>
                <div style={styles.sectionKicker}>Meta mensal</div>
                <h3 style={styles.sectionTitle}>Editar incentivo</h3>
              </div>
            </div>
            <form onSubmit={handleTargetSubmit} style={styles.formGrid}>
              <FormRow label="Promotor">
                <select
                  value={targetForm.promoterId}
                  onChange={(event) =>
                    setTargetForm((current) => ({
                      ...current,
                      promoterId: event.target.value,
                    }))
                  }
                  style={styles.input}
                >
                  <option value="">Selecione</option>
                  {data.promoterOptions.map((promoter) => (
                    <option key={promoter.id} value={promoter.id}>
                      {promoter.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Meta">
                <input
                  value={targetForm.meta}
                  onChange={(event) =>
                    setTargetForm((current) => ({ ...current, meta: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Meta 1">
                <input
                  value={targetForm.meta1}
                  onChange={(event) =>
                    setTargetForm((current) => ({ ...current, meta1: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Meta 2">
                <input
                  value={targetForm.meta2}
                  onChange={(event) =>
                    setTargetForm((current) => ({ ...current, meta2: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <button type="submit" style={styles.primaryButton} disabled={savingTarget}>
                {savingTarget ? "Salvando..." : "Salvar meta"}
              </button>
            </form>

            {selectedPromoterSummary ? (
              <div style={styles.infoBox}>
                <div style={styles.itemTitle}>{selectedPromoterSummary.promoter_name}</div>
                <div style={styles.itemMeta}>
                  {selectedPromoterSummary.company_name} | {selectedPromoterSummary.status}
                </div>
                <div style={styles.infoLine}>
                  Comissao a pagar: {formatCurrency(selectedPromoterSummary.payable_commission_value)}
                </div>
              </div>
            ) : null}
          </article>

          <article style={styles.sideCard}>
            <div style={styles.sectionHeaderCompact}>
              <div>
                <div style={styles.sectionKicker}>Acordo comercial</div>
                <h3 style={styles.sectionTitle}>Repasse do promotor</h3>
                <p style={styles.sectionDescription}>
                  O acordo geral segue o percentual sobre a comissao da empresa, mas a visao do
                  promotor respeita teto de 5,80% no credito.
                </p>
              </div>
            </div>
            <form onSubmit={handleAgreementSubmit} style={styles.formGrid}>
              <FormRow label="Promotor">
                <select
                  value={agreementForm.promoterId}
                  onChange={(event) =>
                    setAgreementForm((current) => ({
                      ...current,
                      promoterId: event.target.value,
                    }))
                  }
                  style={styles.input}
                >
                  <option value="">Selecione</option>
                  {data.promoterOptions.map((promoter) => (
                    <option key={promoter.id} value={promoter.id}>
                      {promoter.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Credito (% da comissao da empresa)">
                <input
                  value={agreementForm.productionShare}
                  onChange={(event) =>
                    setAgreementForm((current) => ({
                      ...current,
                      productionShare: event.target.value,
                    }))
                  }
                  style={styles.input}
                  placeholder="Ex: 58,33 ou 66,66"
                />
              </FormRow>
              <FormRow label="Seguro (% da comissao do seguro)">
                <input
                  value={agreementForm.insuranceShare}
                  onChange={(event) =>
                    setAgreementForm((current) => ({
                      ...current,
                      insuranceShare: event.target.value,
                    }))
                  }
                  style={styles.input}
                  placeholder="Ex: 35 ou 40"
                />
              </FormRow>
              <FormRow label="Observacao">
                <input
                  value={agreementForm.notes}
                  onChange={(event) =>
                    setAgreementForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  style={styles.input}
                  placeholder="Ex: acordo comercial abril"
                />
              </FormRow>
              <button type="submit" style={styles.primaryButton} disabled={savingAgreement}>
                {savingAgreement ? "Salvando..." : "Salvar acordo"}
              </button>
            </form>

            <div style={styles.infoBox}>
              <div style={styles.itemTitle}>Regras salvas nesta competencia</div>
              {data.agreementRows.length === 0 ? (
                <div style={styles.itemMeta}>
                  Sem acordo manual. O sistema usa a tabela mensal importada.
                </div>
              ) : (
                data.agreementRows.map((row) => (
                  <div key={row.id} style={styles.infoLine}>
                    {row.agreement_type === "PRODUCTION" ? "Credito" : "Seguro"}:{" "}
                    {row.commission_value.toFixed(2).replace(".", ",")}%{" "}
                    {row.notes ? `| ${row.notes}` : ""}
                  </div>
                ))
              )}
            </div>
          </article>
        </aside>
      </div>
      ) : null}

      {activeSection === "detalhamento" ? (
      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Comissao PF base"
          value={formatCurrency(proposalTotals.companyCommission)}
          detail="Base de credito exibida na visao do promotor, ja limitada ao teto de 5,80%."
        />
        <SummaryCard
          label="Comissao seguro base"
          value={formatCurrency(proposalTotals.companyInsurance)}
          detail="Base de seguro usada para o repasse individual do promotor."
        />
        <SummaryCard
          label="Descontos do promotor"
          value={formatCurrency(promoterDiscountTotal)}
          detail="Liquidações, cancelamentos, adiantamentos e outros debitos."
        />
        <SummaryCard
          label="Liquido final"
          value={formatCurrency(selectedPromoterSummary?.payable_commission_value)}
          detail="Comissao do promotor ja abatida dos descontos atuais."
        />
      </div>
      ) : null}

      {activeSection === "descontos" ? (
      <article style={styles.tableCard}>
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.sectionKicker}>Descontos e estornos</div>
            <h3 style={styles.sectionTitle}>Lancamentos editaveis do promotor</h3>
          </div>
          <div style={styles.sectionChip}>{data.discountRows.length} lancamentos</div>
        </div>

        <div style={styles.contentGrid}>
          <div style={styles.tableWrap}>
            {data.discountRows.length === 0 ? (
              <div style={styles.emptyState}>
                Nenhum desconto lancado para esta competencia.
              </div>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Tipo</th>
                    <th style={styles.th}>Proposta</th>
                    <th style={styles.th}>Parcela</th>
                    <th style={styles.th}>Valor</th>
                    <th style={styles.th}>Destino</th>
                    <th style={styles.th}>Observacao</th>
                    <th style={styles.th}>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.discountRows.map((row) => (
                    <tr key={row.id}>
                      <td style={styles.td}>{row.discount_type}</td>
                      <td style={styles.td}>{row.proposal_number || "-"}</td>
                      <td style={styles.td}>
                        {row.installment_number}/{row.installments}
                      </td>
                      <td style={styles.td}>{formatCurrency(row.amount)}</td>
                      <td style={styles.td}>
                        {row.apply_to_company ? "Empresa" : "Promotor"}
                      </td>
                      <td style={styles.td}>{row.notes || "-"}</td>
                      <td style={styles.td}>
                        <div style={styles.actionRow}>
                          <button
                            type="button"
                            onClick={() => editDiscount(row)}
                            style={styles.secondaryButton}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteDiscount(row.id)}
                            style={styles.ghostButton}
                            disabled={deletingDiscountId === row.id}
                          >
                            {deletingDiscountId === row.id ? "Removendo..." : "Excluir"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <aside style={styles.sideRail}>
            <article style={styles.sideCard}>
              <div style={styles.sectionHeaderCompact}>
                <div>
                  <div style={styles.sectionKicker}>Novo desconto</div>
                  <h3 style={styles.sectionTitle}>Aplicar no promotor</h3>
                </div>
              </div>
              <form onSubmit={handleDiscountSubmit} style={styles.formGrid}>
                <FormRow label="Promotor">
                  <select
                    value={discountForm.promoterId}
                    onChange={(event) =>
                      setDiscountForm((current) => ({
                        ...current,
                        promoterId: event.target.value,
                      }))
                    }
                    style={styles.input}
                  >
                    <option value="">Selecione</option>
                    {data.promoterOptions.map((promoter) => (
                      <option key={promoter.id} value={promoter.id}>
                        {promoter.name}
                      </option>
                    ))}
                  </select>
                </FormRow>
                <FormRow label="Tipo de desconto">
                  <select
                    value={discountForm.discountType}
                    onChange={(event) =>
                      setDiscountForm((current) => ({
                        ...current,
                        discountType: event.target.value,
                      }))
                    }
                    style={styles.input}
                  >
                    <option value="LIQUIDACAO_ANTECIPADA">Liquidacao antecipada</option>
                    <option value="CANCELAMENTO_SEGURO">Cancelamento de seguro</option>
                    <option value="ESTORNO_CREDITO">Estorno de credito</option>
                    <option value="ADIANTAMENTO">Adiantamento</option>
                    <option value="OUTROS">Outros debitos</option>
                  </select>
                </FormRow>
                <FormRow label="Proposta vinculada">
                  <select
                    value={discountForm.dailyProductionRecordId}
                    onChange={(event) =>
                      setDiscountForm((current) => ({
                        ...current,
                        dailyProductionRecordId: event.target.value,
                      }))
                    }
                    style={styles.input}
                  >
                    <option value="">Sem vinculo</option>
                    {data.proposalRows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.proposal_number} | {row.product_description}
                      </option>
                    ))}
                  </select>
                </FormRow>
                <FormRow label="Valor descontado da empresa">
                  <input
                    value={discountForm.companyAmount}
                    onChange={(event) =>
                      setDiscountForm((current) => ({
                        ...current,
                        companyAmount: event.target.value,
                      }))
                    }
                    style={styles.input}
                    placeholder="Base para aplicar 70%"
                  />
                </FormRow>
                <FormRow label="Valor descontado do promotor">
                  <input
                    value={discountForm.amount}
                    onChange={(event) =>
                      setDiscountForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                    style={styles.input}
                    placeholder="Se vazio, o sistema calcula quando for 70%"
                  />
                </FormRow>
                <div style={styles.twoColumnGrid}>
                  <FormRow label="Parcelas">
                    <input
                      value={discountForm.installments}
                      onChange={(event) =>
                        setDiscountForm((current) => ({
                          ...current,
                          installments: event.target.value,
                        }))
                      }
                      style={styles.input}
                    />
                  </FormRow>
                  <FormRow label="Parcela atual">
                    <input
                      value={discountForm.installmentNumber}
                      onChange={(event) =>
                        setDiscountForm((current) => ({
                          ...current,
                          installmentNumber: event.target.value,
                        }))
                      }
                      style={styles.input}
                    />
                  </FormRow>
                </div>
                <label style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={discountForm.applyToCompany}
                    onChange={(event) =>
                      setDiscountForm((current) => ({
                        ...current,
                        applyToCompany: event.target.checked,
                      }))
                    }
                  />
                  <span>Desconto fica na empresa e nao no promotor</span>
                </label>
                <FormRow label="Observacao">
                  <input
                    value={discountForm.notes}
                    onChange={(event) =>
                      setDiscountForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    style={styles.input}
                    placeholder="Ex: parcelado em 3x"
                  />
                </FormRow>
                <button type="submit" style={styles.primaryButton} disabled={savingDiscount}>
                  {savingDiscount ? "Salvando..." : discountForm.id ? "Atualizar desconto" : "Salvar desconto"}
                </button>
              </form>
            </article>
          </aside>
        </div>
      </article>
      ) : null}

      {activeSection === "detalhamento" ? (
      <article style={styles.tableCard}>
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.sectionKicker}>Detalhamento individual</div>
            <h3 style={styles.sectionTitle}>Visao operacional do promotor</h3>
            <p style={styles.sectionDescription}>
              Nesta visao entram somente propostas com status Producao. % a vista e
              Comissao PF ja saem limitados ao teto de 5,80% do promotor, enquanto
              cancelamentos, estornos e antecipacoes ficam no bloco de descontos.
            </p>
          </div>
          <div style={styles.sectionChip}>{data.proposalRows.length} propostas</div>
        </div>

        {loading ? (
          <div style={styles.emptyState}>Carregando detalhamento...</div>
        ) : !promoterId ? (
          <div style={styles.emptyState}>Selecione um promotor para detalhar as operacoes.</div>
        ) : data.proposalRows.length === 0 ? (
          <div style={styles.emptyState}>
            Nenhuma proposta com status Producao encontrada para este promotor.
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Contrato</th>
                  <th style={styles.th}>Valor bruto</th>
                  <th style={styles.th}>Valor liquido</th>
                  <th style={styles.th}>Parcela</th>
                  <th style={styles.th}>Agencia</th>
                  <th style={styles.th}>Chave J</th>
                  <th style={styles.th}>Promotor(a)</th>
                  <th style={styles.th}>Data contratacao</th>
                  <th style={styles.th}>Tx juros</th>
                  <th style={styles.th}>Descricao do produto</th>
                  <th style={styles.th}>% a vista</th>
                  <th style={styles.th}>Comissao PF</th>
                  <th style={styles.th}>Restricao SRCC</th>
                  <th style={styles.th}>Valor seguro</th>
                  <th style={styles.th}>Comissao seguro base</th>
                  <th style={styles.th}>% penetracao</th>
                  <th style={styles.th}>% repasse promotor</th>
                  <th style={styles.th}>Comissao promotor</th>
                  <th style={styles.th}>Comissao seguro promotor</th>
                  <th style={styles.th}>Regra</th>
                </tr>
              </thead>
              <tbody>
                {data.proposalRows.map((row) => (
                  <tr key={row.id}>
                    <td style={styles.td}>{row.contract_number}</td>
                    <td style={styles.td}>{formatCurrency(row.gross_value)}</td>
                    <td style={styles.td}>{formatCurrency(row.net_value)}</td>
                    <td style={styles.td}>{row.installment_count || "-"}</td>
                    <td style={styles.td}>{row.agency_code}</td>
                    <td style={styles.td}>{row.j_key || "-"}</td>
                    <td style={styles.td}>{row.promoter_name || "-"}</td>
                    <td style={styles.td}>{formatDate(row.contract_date)}</td>
                    <td style={styles.td}>{row.interest_rate ? row.interest_rate.toFixed(2).replace(".", ",") : "-"}</td>
                    <td style={styles.td}>{row.product_description}</td>
                      <td style={styles.td}>
                        {formatPercent(row.company_received_percent * 100, 2)}
                      </td>
                    <td style={styles.td}>{formatCurrency(row.company_commission_amount)}</td>
                    <td style={styles.td}>{row.srcc_restriction}</td>
                    <td style={styles.td}>{formatCurrency(row.insurance_value)}</td>
                    <td style={styles.td}>{formatCurrency(row.company_insurance_commission_amount)}</td>
                    <td style={styles.td}>
                      {formatPercent(row.insurance_penetration_percent * 100, 2)}
                    </td>
                    <td style={styles.tdStrong}>
                      {formatPercent(clampPromoterPercent(row.promoter_commission_percent), 2)}
                    </td>
                    <td style={styles.tdStrong}>{formatCurrency(row.promoter_commission_amount)}</td>
                    <td style={styles.tdStrong}>{formatCurrency(row.insurance_commission_amount)}</td>
                    <td style={styles.td}>{row.commission_rule_source || "-"}</td>
                  </tr>
                ))}
                <tr>
                  <td style={styles.tdStrong}>TOTAL</td>
                  <td style={styles.td}></td>
                  <td style={styles.tdStrong}>{formatCurrency(proposalTotals.net)}</td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.tdStrong}>{formatCurrency(proposalTotals.companyCommission)}</td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.tdStrong}>{formatCurrency(proposalTotals.companyInsurance)}</td>
                  <td style={styles.td}></td>
                  <td style={styles.td}></td>
                  <td style={styles.tdStrong}>{formatCurrency(proposalTotals.promoterCommission)}</td>
                  <td style={styles.tdStrong}>{formatCurrency(proposalTotals.promoterInsurance)}</td>
                  <td style={styles.td}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </article>
      ) : null}

      {activeSection === "migracao" ? (
      <article style={styles.tableCard}>
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.sectionKicker}>Migracao manual</div>
            <h3 style={styles.sectionTitle}>Ajuste de propostas entre promotores</h3>
          </div>
          <div style={styles.sectionChip}>Somente producao</div>
        </div>

        {loading ? (
          <div style={styles.emptyState}>Carregando propostas...</div>
        ) : !promoterId ? (
          <div style={styles.emptyState}>Selecione um promotor para detalhar as propostas.</div>
        ) : data.proposalRows.length === 0 ? (
          <div style={styles.emptyState}>Nenhuma proposta encontrada para este promotor.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Proposta</th>
                  <th style={styles.th}>Produto</th>
                  <th style={styles.th}>Regra</th>
                  <th style={styles.th}>Promotor atual</th>
                  <th style={styles.th}>Migrar para</th>
                  <th style={styles.th}>Motivo</th>
                  <th style={styles.th}>Acao</th>
                </tr>
              </thead>
              <tbody>
                {data.proposalRows.map((row) => (
                  <tr key={row.id}>
                    <td style={styles.td}>
                      <div style={styles.itemTitle}>{row.proposal_number}</div>
                      <div style={styles.itemMeta}>
                        {formatDate(row.movement_date || row.contract_date)}
                      </div>
                    </td>
                    <td style={styles.td}>{row.product_description}</td>
                    <td style={styles.td}>{row.commission_rule_source || "-"}</td>
                    <td style={styles.td}>{row.assigned_promoter_name || "-"}</td>
                    <td style={styles.td}>
                      <select
                        value={proposalTargets[row.id] || ""}
                        onChange={(event) =>
                          setProposalTargets((current) => ({
                            ...current,
                            [row.id]: event.target.value,
                          }))
                        }
                        style={styles.smallInput}
                      >
                        <option value="">Selecione</option>
                        {data.promoterLookup
                          .filter((promoter) => promoter.id !== row.assigned_promoter_id)
                          .map((promoter) => (
                            <option key={promoter.id} value={promoter.id}>
                              {promoter.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td style={styles.td}>
                      <input
                        value={proposalReasons[row.id] || ""}
                        onChange={(event) =>
                          setProposalReasons((current) => ({
                            ...current,
                            [row.id]: event.target.value,
                          }))
                        }
                        style={styles.reasonInput}
                        placeholder="Ex: Chave master"
                      />
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        onClick={() => moveProposal(row)}
                        style={styles.secondaryButton}
                        disabled={movingProposalId === row.id}
                      >
                        {movingProposalId === row.id ? "Migrando..." : "Migrar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
      ) : null}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value}</div>
      <div style={styles.summaryDetail}>{detail}</div>
    </article>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label style={styles.formRow}>
      <span style={styles.formLabel}>{label}</span>
      {children}
    </label>
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

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "16px",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "14px",
  },
  heroMain: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,253,245,0.98) 100%)",
    borderRadius: "22px",
    padding: "22px",
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
    fontSize: "14px",
    lineHeight: 1.62,
    color: "var(--rr-muted)",
  },
  heroSignals: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "14px",
  },
  heroSignal: {
    display: "grid",
    gap: "4px",
    minWidth: "132px",
    padding: "10px 12px",
    borderRadius: "16px",
    background: "rgba(13,77,227,0.04)",
    border: "1px solid rgba(13,77,227,0.08)",
  },
  heroSignalLabel: {
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  heroSignalValue: {
    fontSize: "14px",
    color: "var(--rr-ink-soft)",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
  },
  heroAside: {
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    borderRadius: "22px",
    padding: "20px",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "var(--rr-shadow)",
  },
  heroAsideLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "rgba(255,255,255,0.72)",
    marginBottom: "10px",
    fontWeight: 800,
  },
  heroAsideDescription: {
    margin: "0 0 12px",
    fontSize: "13px",
    lineHeight: 1.55,
    color: "rgba(255,255,255,0.78)",
  },
  quickLinks: {
    display: "grid",
    gap: "8px",
  },
  quickLink: {
    display: "grid",
    gap: "4px",
    textDecoration: "none",
    padding: "12px 14px",
    borderRadius: "14px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#ffffff",
    fontWeight: 700,
  },
  quickLinkTitle: {
    fontSize: "14px",
    fontWeight: 800,
  },
  quickLinkDescription: {
    fontSize: "12px",
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.76)",
    fontWeight: 500,
  },
  errorBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(239,68,68,0.24)",
    color: "#991b1b",
    borderRadius: "18px",
    padding: "16px",
  },
  noticeBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(13,77,227,0.14)",
    color: "var(--rr-blue-deep)",
    borderRadius: "18px",
    padding: "16px",
  },
  filterCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "20px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    padding: "16px",
  },
  filterHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "12px",
  },
  filterKicker: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
    marginBottom: "6px",
  },
  filterTitle: {
    margin: 0,
    fontSize: "20px",
    color: "var(--rr-ink)",
  },
  filterFoot: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: "12px",
  },
  filterHint: {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--rr-muted)",
    maxWidth: "760px",
  },
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "10px",
    alignItems: "end",
  },
  filterActionWrap: {
    display: "flex",
    alignItems: "end",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
  },
  subsectionNav: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "-2px",
  },
  subsectionButton: {
    border: "1px solid rgba(13,77,227,0.12)",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.92)",
    color: "var(--rr-blue-deep)",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "var(--rr-shadow-soft)",
  },
  subsectionButtonActive: {
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.98) 0%, rgba(7,37,125,0.98) 100%)",
    color: "#ffffff",
    border: "1px solid rgba(13,77,227,0.98)",
  },
  summaryCard: {
    borderRadius: "18px",
    padding: "16px",
    border: "1px solid var(--rr-line)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,249,176,0.42) 100%)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  summaryLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
    marginBottom: "8px",
  },
  summaryValue: {
    fontSize: "24px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    fontFamily: "var(--font-heading)",
    marginBottom: "8px",
  },
  summaryDetail: {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--rr-muted)",
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.45fr) minmax(300px, 0.9fr)",
    gap: "14px",
    alignItems: "start",
  },
  tableCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    overflow: "hidden",
    boxShadow: "var(--rr-shadow-soft)",
  },
  sideRail: {
    display: "grid",
    gap: "14px",
    position: "sticky",
    top: "84px",
  },
  sideCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    overflow: "hidden",
    boxShadow: "var(--rr-shadow-soft)",
    paddingBottom: "18px",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    padding: "18px 18px 0",
  },
  sectionChip: {
    padding: "8px 12px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.08)",
    border: "1px solid rgba(13,77,227,0.12)",
    color: "var(--rr-blue-deep)",
    fontSize: "12px",
    fontWeight: 800,
  },
  sectionHeaderCompact: {
    padding: "18px 18px 0",
  },
  sectionKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  sectionTitle: {
    margin: 0,
    fontSize: "22px",
    color: "var(--rr-ink)",
  },
  sectionDescription: {
    margin: "8px 0 0",
    fontSize: "13px",
    lineHeight: 1.6,
    color: "var(--rr-muted)",
    maxWidth: "720px",
  },
  tableWrap: {
    overflowX: "auto",
    padding: "14px 18px 18px",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  th: {
    textAlign: "left",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    padding: "0 12px 12px 0",
    borderBottom: "1px solid var(--rr-line)",
    fontWeight: 800,
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    background: "rgba(255,255,255,0.98)",
    zIndex: 1,
  },
  td: {
    padding: "12px 12px 12px 0",
    fontSize: "12.5px",
    color: "var(--rr-muted)",
    borderBottom: "1px solid rgba(13,77,227,0.08)",
    whiteSpace: "nowrap",
    verticalAlign: "top",
  },
  tdStrong: {
    padding: "12px 12px 12px 0",
    fontSize: "12.5px",
    color: "var(--rr-ink)",
    borderBottom: "1px solid rgba(13,77,227,0.08)",
    whiteSpace: "nowrap",
    verticalAlign: "top",
    fontWeight: 800,
  },
  tableRowSelected: {
    background: "rgba(13,77,227,0.05)",
    cursor: "pointer",
  },
  formGrid: {
    display: "grid",
    gap: "10px",
    padding: "14px 18px 0",
  },
  twoColumnGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
  },
  formRow: {
    display: "grid",
    gap: "6px",
  },
  formLabel: {
    fontSize: "12px",
    color: "var(--rr-blue)",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  input: {
    width: "100%",
    borderRadius: "12px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "10px 12px",
    fontSize: "14px",
    color: "var(--rr-ink)",
    background: "rgba(255,255,255,0.96)",
    outline: "none",
  },
  smallInput: {
    width: "150px",
    borderRadius: "10px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "9px 10px",
    fontSize: "13px",
    color: "var(--rr-ink)",
    background: "#fff",
    outline: "none",
  },
  reasonInput: {
    width: "180px",
    borderRadius: "10px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "9px 10px",
    fontSize: "13px",
    color: "var(--rr-ink)",
    background: "#fff",
    outline: "none",
  },
  primaryButton: {
    border: 0,
    borderRadius: "16px",
    padding: "14px 16px",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
    color: "#ffffff",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.98) 0%, rgba(7,37,125,0.98) 100%)",
    boxShadow: "0 14px 28px rgba(13,77,227,0.16)",
  },
  secondaryButton: {
    border: 0,
    borderRadius: "14px",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    color: "var(--rr-blue-deep)",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.95) 0%, rgba(214,161,63,0.92) 100%)",
    boxShadow: "0 14px 24px rgba(214,161,63,0.14)",
  },
  ghostButton: {
    borderRadius: "14px",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    color: "var(--rr-blue-deep)",
    background: "rgba(13,77,227,0.08)",
    border: "1px solid rgba(13,77,227,0.14)",
  },
  actionRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "13px",
    color: "var(--rr-muted)",
  },
  infoBox: {
    margin: "14px 18px 0",
    padding: "14px",
    borderRadius: "18px",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.12) 0%, rgba(255,255,255,0.96) 100%)",
    border: "1px solid rgba(13,77,227,0.1)",
  },
  infoLine: {
    fontSize: "13px",
    color: "var(--rr-muted)",
    marginTop: "10px",
  },
  itemTitle: {
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    marginBottom: "4px",
  },
  itemMeta: {
    fontSize: "12px",
    color: "var(--rr-muted)",
    lineHeight: 1.5,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    background: "rgba(13,77,227,0.1)",
    color: "var(--rr-blue-deep)",
  },
  emptyState: {
    margin: "14px 18px 18px",
    padding: "16px",
    color: "var(--rr-muted)",
    fontSize: "14px",
    lineHeight: 1.6,
    borderRadius: "16px",
    border: "1px dashed rgba(13,77,227,0.16)",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.04) 0%, rgba(255,255,255,0.96) 100%)",
  },
};
