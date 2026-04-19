"use client";

import { useState, useEffect } from "react";

export default function ComissaoProdutoPage() {
  const [rows, setRows] = useState([]);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(4);

  function addRow() {
    setRows([
      ...rows,
      {
        product_description: "",
        received_percent: "",
        promoter_percent: "",
        insurance_percent: "",
      },
    ]);
  }

  function updateRow(index, field, value) {
    const newRows = [...rows];
    newRows[index][field] = value;
    setRows(newRows);
  }

  function adjustPercent(row) {
    const received = Number(row.received_percent || 0);
    let promoter = Number(row.promoter_percent || 0);

    if (received >= 6) {
      promoter = Math.min(promoter, 5.8);
    }

    return promoter;
  }

  async function saveAll() {
    await fetch("/api/commissions/product-rules", {
      method: "POST",
      body: JSON.stringify({
        year,
        month,
        rows: rows.map((r) => ({
          ...r,
          promoter_percent: adjustPercent(r),
        })),
      }),
    });

    alert("Salvo com sucesso");
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Comissão por Produto + % Recebido</h1>

      <button onClick={addRow}>+ Nova Regra</button>

      <table>
        <thead>
          <tr>
            <th>Produto</th>
            <th>% Recebido</th>
            <th>% Promotor</th>
            <th>% Seguro</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  value={row.product_description}
                  onChange={(e) =>
                    updateRow(i, "product_description", e.target.value)
                  }
                />
              </td>

              <td>
                <input
                  value={row.received_percent}
                  onChange={(e) =>
                    updateRow(i, "received_percent", e.target.value)
                  }
                />
              </td>

              <td>
                <input
                  value={row.promoter_percent}
                  onChange={(e) =>
                    updateRow(i, "promoter_percent", e.target.value)
                  }
                />
              </td>

              <td>
                <input
                  value={row.insurance_percent}
                  onChange={(e) =>
                    updateRow(i, "insurance_percent", e.target.value)
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button onClick={saveAll}>Salvar regras</button>
    </div>
  );
}
