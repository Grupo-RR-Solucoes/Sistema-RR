"use client";

import { useEffect, useState } from "react";

export default function Dashboard() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/dashboard")
      .then(res => res.json())
      .then(setData);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Dashboard Financeiro</h1>

      {data.map((item) => (
        <div key={item.empresa_cnpj} className="border p-4 mt-4">
          <p><b>Empresa:</b> {item.empresa_cnpj}</p>
          <p>À Vista: R$ {item.valor_avista}</p>
          <p>Diferido: R$ {item.valor_diferido}</p>
          <p>Seguro: R$ {item.valor_seguro}</p>
          <p>Total: R$ {item.valor_liquido}</p>
        </div>
      ))}
    </div>
  );
}
