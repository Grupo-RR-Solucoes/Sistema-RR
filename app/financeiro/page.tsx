"use client";

import { useEffect, useState } from "react";

export default function Financeiro() {
  const [parcelas, setParcelas] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/diferido")
      .then(res => res.json())
      .then(setParcelas);
  }, []);

  return (
    <div className="p-6">
      <h1>Diferido</h1>

      {parcelas.map((p) => (
        <div key={p.id} className="border p-3 mt-2">
          <p>Parcela {p.parcela_numero}</p>
          <p>Valor: R$ {p.valor}</p>
          <p>Status: {p.status}</p>
        </div>
      ))}
    </div>
  );
}
