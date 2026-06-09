"use client";

import { useMemo, useState, type CSSProperties } from "react";

export interface BulkSelectedItem {
  dailyProductionRecordId: string;
  commissionRuleId: string | null;
  // Snapshot do valor exibido para narrar o preview "X% -> Y%".
  currentPercent: number | null;
  // Origem do share resolvido pelo servidor (mesma cascata do motor). Quando
  // comeca com "FRENTE_C", a escala por meta VENCE o override manual no
  // calculo — usado para o aviso de Frente C. NAO recalcula nada aqui.
  sharePercentSource?: string | null;
  // Inputs da formula viva (= a da tela): comissao_empresa x share.
  netValue?: number | null;
  aVistaPercent?: number | null;
  // Share atual efetivo em escala 0..1 (share_percent_effective do servidor).
  currentShareEffective?: number | null;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

interface BulkActionBarProps {
  selectedItems: BulkSelectedItem[];
  onClearSelection: () => void;
  onApplied: () => void | Promise<void>;
}

type Mode = "absolute" | "relative";

function parseValue(input: string): number | null {
  if (!input.trim()) return null;
  // Aceita "30", "30.5", "30,5", "-2,5"
  const cleaned = input.replace(/\s/g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `${Number(value).toFixed(2).replace(".", ",")}%`;
}

/**
 * BulkActionBar — barra fixed-bottom que aparece quando ha selecao.
 *
 * 2 modos:
 *   - absolute: substitui % atual pelo valor informado (0..100).
 *     Funciona em propostas com e sem override (cria via INSERT no
 *     backend para as sem override).
 *   - relative: soma pp ao valor atual (-100..100). SO funciona em
 *     propostas com override existente (backend bloqueia INSERT com
 *     mode=relative). Exibe aviso amarelo se houver propostas sem
 *     override na selecao.
 *
 * Preview transparente conta updated vs created antes do submit.
 * confirm() dialog antes de chamar o endpoint bulk.
 */
export default function BulkActionBar({
  selectedItems,
  onClearSelection,
  onApplied,
}: BulkActionBarProps) {
  const [mode, setMode] = useState<Mode>("absolute");
  const [valueInput, setValueInput] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    let withOverride = 0;
    let withoutOverride = 0;
    for (const item of selectedItems) {
      if (item.commissionRuleId) withOverride += 1;
      else withoutOverride += 1;
    }
    return { withOverride, withoutOverride, total: selectedItems.length };
  }, [selectedItems]);

  // Item 1 — AVISO FRENTE C. Conta as selecionadas onde o servidor ja
  // resolveu a origem do share como FRENTE_C_* (escala por meta na faixa
  // 5,80% / Aldalene INSS). Nessas, o motor IGNORA o share manual. Apenas
  // detecta e avisa; nao bloqueia. Reusa share_percent_source — sem regra nova.
  const frenteCCount = useMemo(
    () =>
      selectedItems.filter((i) =>
        String(i.sharePercentSource ?? "").startsWith("FRENTE_C")
      ).length,
    [selectedItems]
  );

  const parsedValue = parseValue(valueInput);
  const valueValid =
    parsedValue !== null &&
    (mode === "absolute"
      ? parsedValue >= 0 && parsedValue <= 100
      : parsedValue >= -100 && parsedValue <= 100);

  // Item 2 — PREVIEW DE R$. Mesma formula viva da tela:
  //   comissao_empresa = net_value x min(a_vista, 5,80) / 100
  //   comissao_promotor = comissao_empresa x share
  // Soma sobre as propostas AFETADAS (absolute: todas; relative: so com
  // override). Linhas FRENTE_C nao mudam de fato (motor ignora o share),
  // entao no projetado elas mantem o valor atual — preview honesto.
  const moneyPreview = useMemo(() => {
    if (parsedValue === null || !valueValid) return null;
    let current = 0;
    let projected = 0;
    for (const item of selectedItems) {
      const affected =
        mode === "absolute" ? true : Boolean(item.commissionRuleId);
      if (!affected) continue;
      const net = Number(item.netValue ?? 0);
      const aVista = Math.min(Math.max(Number(item.aVistaPercent ?? 0), 0), 5.8);
      const companyCommission = (net * aVista) / 100;
      const curShare = Number(item.currentShareEffective ?? 0);
      const curValue = companyCommission * curShare;
      const isFrenteC = String(item.sharePercentSource ?? "").startsWith(
        "FRENTE_C"
      );
      const newShare =
        mode === "absolute"
          ? parsedValue / 100
          : curShare + parsedValue / 100;
      const projValue = isFrenteC
        ? curValue
        : companyCommission * Math.max(newShare, 0);
      current += curValue;
      projected += projValue;
    }
    return { current, projected, delta: projected - current };
  }, [selectedItems, parsedValue, valueValid, mode]);

  const willCreateCount =
    mode === "absolute" ? counts.withoutOverride : 0;
  const willUpdateCount = counts.withOverride;
  const willSkipCount =
    mode === "relative" ? counts.withoutOverride : 0;
  const willTotalAffected = willUpdateCount + willCreateCount;

  async function handleSubmit() {
    if (!valueValid || parsedValue === null) return;
    setError(null);

    const confirmMessage =
      mode === "absolute"
        ? `Aplicar % Promotor = ${parsedValue.toFixed(2).replace(".", ",")}% em ${willTotalAffected} proposta(s)?\n\n` +
          `- ${willUpdateCount} override(s) existente(s) ser${willUpdateCount === 1 ? "a" : "ao"} atualizado(s)\n` +
          `- ${willCreateCount} novo(s) override(s) ser${willCreateCount === 1 ? "a" : "ao"} criado(s)`
        : `Aplicar ajuste de ${parsedValue >= 0 ? "+" : ""}${parsedValue.toFixed(2).replace(".", ",")}pp em ${willTotalAffected} proposta(s)?\n\n` +
          `- ${willUpdateCount} override(s) existente(s) ser${willUpdateCount === 1 ? "a" : "ao"} atualizado(s)\n` +
          (willSkipCount > 0
            ? `- ${willSkipCount} sem override ser${willSkipCount === 1 ? "a" : "ao"} ignorada(s) (ajuste relativo nao cria)\n`
            : "");

    if (!window.confirm(confirmMessage)) return;

    setSubmitting(true);
    try {
      const proposalIds = selectedItems
        .filter((s) => s.commissionRuleId)
        .map((s) => s.commissionRuleId as string);
      const productionRecordIds =
        mode === "absolute"
          ? selectedItems
              .filter((s) => !s.commissionRuleId)
              .map((s) => s.dailyProductionRecordId)
          : [];

      const res = await fetch("/api/commissions/proposals/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalIds,
          productionRecordIds,
          mode,
          value: parsedValue,
          // Dia 4.5 Etapa B: bulk alvo agora e o override de repasse
          // (escala 0..1 no DB; backend converte do input 0..100).
          targetField: "share_percent_override",
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body.error ?? "Falha ao aplicar bulk.");
        return;
      }

      const updated = Number(body.updated_count ?? 0);
      const created = Number(body.created_count ?? 0);
      const failed = Number(body.failure_count ?? 0);

      let msg = `Aplicado com sucesso: ${updated} atualizadas, ${created} criadas.`;
      if (failed > 0) {
        msg += ` ${failed} falha${failed === 1 ? "" : "s"}.`;
      }
      window.alert(msg);

      setValueInput("");
      await onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setSubmitting(false);
    }
  }

  if (counts.total === 0) return null;

  return (
    <>
      {/* Spacer para evitar que a barra cubra o conteudo */}
      <div style={styles.spacer} aria-hidden="true" />

      <div role="region" aria-label="Aplicar % Promotor em lote" style={styles.bar}>
        <div style={styles.row}>
          <span style={styles.summary}>
            <strong>{counts.total.toLocaleString("pt-BR")}</strong>{" "}
            proposta{counts.total === 1 ? "" : "s"} selecionada{counts.total === 1 ? "" : "s"}
            {" "}
            <span style={styles.summaryDetail}>
              ({counts.withOverride} com override, {counts.withoutOverride} sem)
            </span>
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            style={styles.clearBtn}
            disabled={submitting}
          >
            Limpar seleção
          </button>
        </div>

        <div style={styles.controls}>
          <label style={styles.modeLabel}>
            <input
              type="radio"
              name="bulk-mode"
              value="absolute"
              checked={mode === "absolute"}
              onChange={() => setMode("absolute")}
              disabled={submitting}
            />
            <span>
              Valor único{" "}
              <span style={styles.modeHint}>(substitui o valor atual)</span>
            </span>
          </label>
          <label style={styles.modeLabel}>
            <input
              type="radio"
              name="bulk-mode"
              value="relative"
              checked={mode === "relative"}
              onChange={() => setMode("relative")}
              disabled={submitting}
            />
            <span>
              Ajuste{" "}
              <span style={styles.modeHint}>(soma pp ao valor atual)</span>
            </span>
          </label>

          <div style={styles.inputGroup}>
            <input
              type="text"
              inputMode="decimal"
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              placeholder={mode === "absolute" ? "0,00" : "+/-0,00"}
              style={styles.valueInput}
              disabled={submitting}
              aria-label={
                mode === "absolute"
                  ? "% Promotor (override) em %"
                  : "Ajuste de % Promotor em pp"
              }
            />
            <span style={styles.unit}>{mode === "absolute" ? "%" : "pp"}</span>
          </div>
        </div>

        {frenteCCount > 0 ? (
          <div role="alert" style={styles.warningBox}>
            <strong>Atenção:</strong> {frenteCCount} proposta
            {frenteCCount === 1 ? "" : "s"} de promotor
            {frenteCCount === 1 ? "" : "es"} com meta ativa (Frente C) na faixa
            5,80% — nela{frenteCCount === 1 ? "" : "s"} o repasse manual será{" "}
            <strong>ignorado pelo cálculo</strong> (a escala por meta
            prevalece). As demais serão aplicadas normalmente.
          </div>
        ) : null}

        {mode === "relative" && counts.withoutOverride > 0 ? (
          <div role="alert" style={styles.warningBox}>
            <strong>Atenção:</strong> ajuste relativo não funciona em
            propostas sem override. Apenas as{" "}
            <strong>{counts.withOverride}</strong> com override serão
            afetadas; as <strong>{counts.withoutOverride}</strong> sem
            override ficarão intocadas. Use <em>Valor único</em> para criar
            overrides novos.
          </div>
        ) : null}

        <div style={styles.preview}>
          <span style={styles.previewLabel}>Preview:</span>
          <span>
            ↳ <strong>{willUpdateCount}</strong> com override existente
            {parsedValue !== null && valueValid && willUpdateCount > 0
              ? mode === "absolute"
                ? ` (% → ${formatPercent(parsedValue)})`
                : ` (% ajustado em ${parsedValue >= 0 ? "+" : ""}${parsedValue.toFixed(2).replace(".", ",")}pp)`
              : ""}
          </span>
          {mode === "absolute" ? (
            <span>
              ↳ <strong>{willCreateCount}</strong> sem override
              {willCreateCount > 0 && parsedValue !== null && valueValid
                ? ` (serão criadas como ${formatPercent(parsedValue)} MANUAL)`
                : ""}
            </span>
          ) : willSkipCount > 0 ? (
            <span style={styles.skipText}>
              ↳ <strong>{willSkipCount}</strong> sem override (ignoradas no
              modo relativo)
            </span>
          ) : null}
          {moneyPreview ? (
            <span style={styles.moneyLine}>
              💰 Comissão promotor afetada: de{" "}
              <strong>{formatBRL(moneyPreview.current)}</strong> para{" "}
              <strong>{formatBRL(moneyPreview.projected)}</strong>{" "}
              <span style={styles.moneyDelta}>
                ({moneyPreview.delta >= 0 ? "+" : "−"}
                {formatBRL(Math.abs(moneyPreview.delta))})
              </span>
            </span>
          ) : null}
        </div>

        {error ? (
          <div role="alert" style={styles.errorBox}>
            {error}
          </div>
        ) : null}

        <div style={styles.actions}>
          <button
            type="button"
            onClick={onClearSelection}
            style={styles.cancelBtn}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            style={styles.applyBtn}
            disabled={submitting || !valueValid || willTotalAffected === 0}
            title={
              !valueValid
                ? "Informe um valor válido"
                : willTotalAffected === 0
                  ? "Nenhuma proposta seria afetada com o modo atual"
                  : "Aplicar bulk"
            }
          >
            {submitting ? "Aplicando..." : "Aplicar"}
          </button>
        </div>
      </div>
    </>
  );
}

// Redesign (.rredit): barra inferior repaginada no padrao navy/chips.
// SOMENTE estilos — toda a logica (modos absolute/relative, preview de
// update/create/skip, confirm, submit) permanece intacta.
const NAVY = "#0F1F4A";
const YELLOW = "#FFF000";
const LIGHT = "#D6DDEC";
const MUTED = "#9DA9C6";

const styles: Record<string, CSSProperties> = {
  spacer: {
    height: 220,
  },
  bar: {
    position: "fixed",
    bottom: 18,
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(1180px, calc(100% - 40px))",
    zIndex: 50,
    background: NAVY,
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 24px 70px rgba(11,24,56,0.40)",
    padding: "16px 18px",
    borderRadius: 16,
    display: "grid",
    gap: 10,
    fontSize: 13,
    color: "#fff",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  summary: {
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
  },
  summaryDetail: {
    color: MUTED,
    fontWeight: 400,
  },
  clearBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "9px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.07)",
    color: LIGHT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },
  modeLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    cursor: "pointer",
    color: "#C7CFE3",
    fontWeight: 600,
    fontSize: 12.5,
  },
  modeHint: {
    color: MUTED,
    fontWeight: 400,
    marginLeft: 4,
    fontSize: 12,
  },
  inputGroup: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginLeft: "auto",
  },
  valueInput: {
    width: 120,
    padding: "9px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.09)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    outline: "none",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  unit: {
    fontWeight: 600,
    color: MUTED,
    minWidth: 24,
  },
  warningBox: {
    padding: "9px 13px",
    borderRadius: 10,
    background: "rgba(245,158,11,0.14)",
    border: "1px solid rgba(245,158,11,0.30)",
    color: "#FFE7A6",
    fontSize: 12,
    lineHeight: 1.5,
  },
  preview: {
    display: "grid",
    gap: 2,
    padding: "9px 13px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    fontSize: 12,
    color: "#D6DDEC",
  },
  previewLabel: {
    fontWeight: 700,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: YELLOW,
    marginBottom: 2,
  },
  skipText: {
    color: MUTED,
  },
  moneyLine: {
    marginTop: 4,
    paddingTop: 6,
    borderTop: "1px solid rgba(255,255,255,0.12)",
    color: "#EAF0FB",
    fontWeight: 500,
  },
  moneyDelta: {
    color: YELLOW,
    fontWeight: 700,
  },
  errorBox: {
    padding: "9px 13px",
    borderRadius: 10,
    background: "rgba(220,38,38,0.16)",
    border: "1px solid rgba(220,38,38,0.34)",
    color: "#FFC9C5",
    fontSize: 13,
    fontWeight: 600,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
  cancelBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.07)",
    color: LIGHT,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  applyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 18px",
    borderRadius: 10,
    border: "none",
    background: YELLOW,
    color: NAVY,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
  },
};
