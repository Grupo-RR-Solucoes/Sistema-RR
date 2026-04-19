"use client";

import { useEffect, useState } from "react";

export default function Auditoria() {
  const [dados, setDados] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/auditoria")
      .then(res => res.json())
      .then(setDados);
  }, []);

  return (
    <div className="p-6">
      <h1>Auditoria</h1>

      {dados.map((d) => (
        <div key={d.id} className="border p-3 mt-2">
          <p>Operação: {d.numero_operacao}</p>
          <p>Empresa: {d.valor_recebido}</p>
          <p>Promotor: {d.valor_promotor}</p>
          <p>Diferença: {d.diferenca}</p>
        </div>
      ))}
    </div>
  );
}
