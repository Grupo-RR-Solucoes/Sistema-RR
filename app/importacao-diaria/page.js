"use client";

import { useState } from "react";

export default function ImportacaoDiariaPage() {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setFileName(selectedFile ? selectedFile.name : "");
    setResult(null);
    setError("");
  }

  function fileToBase64(selectedFile) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        try {
          const content = reader.result;

          if (typeof content !== "string") {
            reject(new Error("Falha ao converter o arquivo."));
            return;
          }

          resolve(content.split(",")[1]);
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(new Error("Erro ao ler o arquivo."));
      reader.readAsDataURL(selectedFile);
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!file) {
      setError("Selecione uma planilha antes de enviar.");
      return;
    }

    try {
      setLoading(true);
      setLoadingLabel("Importando planilha...");
      setError("");
      setResult(null);

      const base64 = await fileToBase64(file);

      const response = await fetch("/api/import/daily", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file: base64,
          fileName: file.name,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao importar a planilha.");
      }

      const monthlyCalculationResults = [];
      const affectedPeriods = Array.isArray(data?.affected_periods)
        ? data.affected_periods
        : [];

      if (affectedPeriods.length > 0) {
        setLoadingLabel("Atualizando valores do dashboard...");

        for (const period of affectedPeriods) {
          const calculateResponse = await fetch("/api/calculate/monthly", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              year: period.year,
              month: period.month,
            }),
          });
          const calculatePayload = await calculateResponse.json();

          if (!calculateResponse.ok) {
            throw new Error(
              calculatePayload?.error ||
                "A planilha foi importada, mas o recalculo automatico falhou."
            );
          }

          monthlyCalculationResults.push(calculatePayload);
        }
      }

      setResult({
        ...data,
        monthly_calculation_results: monthlyCalculationResults,
      });
    } catch (err) {
      setError(err.message || "Erro inesperado.");
    } finally {
      setLoadingLabel("");
      setLoading(false);
    }
  }

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Entrada operacional</div>
          <h2 style={styles.title}>Importacao diaria com identidade Grupo RR Cred</h2>
          <p style={styles.description}>
            Envie a planilha do dia para identificar empresa por MCI ou Coban,
            localizar Chave J, atualizar propostas sem duplicidade e manter a
            base comercial sempre coerente.
          </p>
        </article>

        <article style={styles.sideCard}>
          <div style={styles.sideLabel}>Regras desta carga</div>
          <div style={styles.ruleList}>
            <div style={styles.ruleItem}>Somente status Producao entra no calculo.</div>
            <div style={styles.ruleItem}>Em Aberto aguarda definicao e pode mudar depois.</div>
            <div style={styles.ruleItem}>Cancelado nao entra em producao nem comissao.</div>
            <div style={styles.ruleItem}>A mesma proposta deve ser atualizada sem duplicar.</div>
          </div>
        </article>
      </div>

      <form onSubmit={handleSubmit} style={styles.uploadCard}>
        <div style={styles.fieldBlock}>
          <label htmlFor="file" style={styles.label}>
            Selecionar planilha Excel
          </label>
          <input
            id="file"
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            style={styles.input}
          />
          <div style={styles.fileName}>
            {fileName ? `Arquivo selecionado: ${fileName}` : "Nenhum arquivo selecionado."}
          </div>
        </div>

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? loadingLabel || "Importando..." : "Enviar planilha"}
        </button>
      </form>

      {error ? <div style={styles.errorBox}>{error}</div> : null}

      {result ? (
        <section style={styles.resultCard}>
          <div style={styles.resultHeader}>
            <div style={styles.resultKicker}>Resultado</div>
            <h3 style={styles.resultTitle}>Resumo da importacao</h3>
          </div>

          <div style={styles.resultGrid}>
            <ResultItem label="Processados" value={result.processed ?? 0} />
            <ResultItem label="Inseridos" value={result.inserted ?? 0} />
            <ResultItem label="Atualizados" value={result.updated ?? 0} />
            <ResultItem label="Competencias recalculadas" value={result.monthly_calculation_results?.length ?? 0} />
            <ResultItem label="Erros" value={result.errors_count ?? 0} />
          </div>

          <pre style={styles.pre}>{JSON.stringify(result, null, 2)}</pre>
        </section>
      ) : null}
    </section>
  );
}

function ResultItem({ label, value }) {
  return (
    <div style={styles.resultItem}>
      <div style={styles.resultLabel}>{label}</div>
      <div style={styles.resultValue}>{value}</div>
    </div>
  );
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
  sideCard: {
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    color: "#ffffff",
    borderRadius: "28px",
    padding: "26px",
    boxShadow: "var(--rr-shadow)",
    border: "1px solid rgba(255,255,255,0.12)",
  },
  sideLabel: {
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
  uploadCard: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid var(--rr-line)",
    borderRadius: "26px",
    padding: "24px",
    boxShadow: "var(--rr-shadow-soft)",
    display: "grid",
    gap: "18px",
  },
  fieldBlock: {
    display: "grid",
    gap: "10px",
  },
  label: {
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    fontFamily: "var(--font-heading)",
  },
  input: {
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid rgba(13,77,227,0.14)",
    background: "#fff",
  },
  fileName: {
    fontSize: "14px",
    color: "var(--rr-muted)",
  },
  button: {
    width: "220px",
    height: "48px",
    border: "none",
    borderRadius: "14px",
    background:
      "linear-gradient(135deg, var(--rr-blue) 0%, var(--rr-blue-deep) 100%)",
    color: "#ffffff",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 16px 30px rgba(13,77,227,0.2)",
  },
  errorBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(239,68,68,0.24)",
    color: "#991b1b",
    borderRadius: "18px",
    padding: "16px",
  },
  resultCard: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid var(--rr-line)",
    borderRadius: "26px",
    padding: "24px",
    boxShadow: "var(--rr-shadow-soft)",
  },
  resultHeader: {
    marginBottom: "16px",
  },
  resultKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  resultTitle: {
    margin: 0,
    fontSize: "24px",
    color: "var(--rr-ink)",
  },
  resultGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    marginBottom: "18px",
  },
  resultItem: {
    borderRadius: "18px",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.16) 0%, rgba(255,255,255,0.98) 100%)",
    border: "1px solid rgba(13,77,227,0.1)",
    padding: "16px",
  },
  resultLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  resultValue: {
    fontSize: "28px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    fontFamily: "var(--font-heading)",
  },
  pre: {
    background: "linear-gradient(180deg, #081532 0%, #102350 100%)",
    color: "#f9fbff",
    padding: "16px",
    borderRadius: "16px",
    overflowX: "auto",
    fontSize: "13px",
    border: "1px solid rgba(255,255,255,0.08)",
  },
};
