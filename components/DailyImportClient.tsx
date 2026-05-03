"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

export default function DailyImportClient() {
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState("");

  async function handleFile(file: File) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer);

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);

    setData(json);
  }

  async function enviar() {
    setError("");

    const res = await fetch("/api/fechamento", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: data }) // 🔥 CORRETO
    });

    const result = await res.json();

    if (!res.ok) {
      setError(result.error || "Erro ao enviar");
    } else {
      alert("Fechamento processado");
    }
  }

  return (
    <div>
      <input
        type="file"
        accept=".xlsx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      <button onClick={enviar}>
        Enviar para fechamento mensal
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
