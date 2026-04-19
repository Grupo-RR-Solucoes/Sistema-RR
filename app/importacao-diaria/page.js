"use client";

import { useState } from "react";

export default function ImportacaoDiariaPage() {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
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
          const result = reader.result;
          if (typeof result !== "string") {
            reject(new Error("Falha ao converter arquivo."));
            return;
          }

          const base64 = result.split(",")[1];
          resolve(base64);
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
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao importar planilha.");
      }

      setResult(data);
    } catch (err) {
      setError(err.message || "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.title}>Importação diária de produção</h1>
        <p style={styles.subtitle}>
          Envie a planilha diária para processar produção, identificar empresa,
          localizar promotor por Chave J e atualizar propostas sem duplicidade.
        </p>

        <form onSubmit={handleSubmit} style={styles.card}>
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

          {fileName ? (
            <p style={styles.fileName}>Arquivo selecionado: {fileName}</p>
          ) : (
            <p style={styles.fileName}>Nenhum arquivo selecionado.</p>
          )}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? "Importando..." : "Enviar planilha"}
          </button>
        </form>

        {error ? (
          <div style={styles.errorBox}>
            <strong>Erro:</strong>
            <div>{error}</div>
          </div>
        ) : null}

        {result ? (
          <div style={styles.resultBox}>
            <h2 style={styles.resultTitle}>Resultado da importação</h2>

            <div style={styles.resultGrid}>
              <div style={styles.resultItem}>
                <span style={styles.resultLabel}>Processados</span>
                <strong style={styles.resultValue}>
                  {result.processed ?? 0}
                </strong>
              </div>

              <div style={styles.resultItem}>
                <span style={styles.resultLabel}>Inseridos</span>
                <strong style={styles.resultValue}>
                  {result.inserted ?? 0}
                </strong>
              </div>

              <div style={styles.resultItem}>
                <span style={styles.resultLabel}>Atualizados</span>
                <strong style={styles.resultValue}>
                  {result.updated ?? 0}
                </strong>
              </div>
            </div>

            <pre style={styles.pre}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f5f7fb",
    padding: "40px 20px",
  },
  container: {
    maxWidth: "800px",
    margin: "0 auto",
  },
  title: {
    fontSize: "32px",
    fontWeight: 700,
    color: "#111827",
    marginBottom: "8px",
  },
  subtitle: {
    fontSize: "16px",
    color: "#4b5563",
    marginBottom: "24px",
    lineHeight: 1.5,
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  label: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#111827",
  },
  input: {
    padding: "12px",
    border: "1px solid #d1d5db",
    borderRadius: "10px",
    background: "#fff",
  },
  fileName: {
    margin: 0,
    color: "#374151",
    fontSize: "14px",
  },
  button: {
    background: "#111827",
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    padding: "14px 18px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
  },
  errorBox: {
    marginTop: "20px",
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: "12px",
    padding: "16px",
  },
  resultBox: {
    marginTop: "20px",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "16px",
    padding: "24px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.05)",
  },
  resultTitle: {
    marginTop: 0,
    marginBottom: "16px",
    fontSize: "22px",
    color: "#111827",
  },
  resultGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "12px",
    marginBottom: "20px",
  },
  resultItem: {
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "16px",
  },
  resultLabel: {
    display: "block",
    fontSize: "13px",
    color: "#6b7280",
    marginBottom: "8px",
  },
  resultValue: {
    fontSize: "24px",
    color: "#111827",
  },
  pre: {
    background: "#0f172a",
    color: "#e5e7eb",
    padding: "16px",
    borderRadius: "12px",
    overflowX: "auto",
    fontSize: "13px",
  },
};
