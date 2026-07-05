"use client";

import { useEffect, useMemo, useState } from "react";

import { KpiBand, Table, Num } from "@/components/ui";
import Chip from "@/components/ui/Chip";

// Aba "Cobrança" do /financeiro (Opção B): lista as SAÍDAS da carteira — contratos
// que sumiram antes do prazo = diferido interrompido que a Promotiva justifica caso a
// caso (ônus da prova dela) ou paga. READ-ONLY: só lista + exporta CSV; a marcação de
// status é a fatia seguinte.

interface SaidaItem {
  numero_operacao: string;
  competencia_ultima: string;
  parcelas_pagas: number | null;
  prazo: number | null;
  parcelas_restantes: number | null;
  comissao: number | null;
  diferido_interrompido: number | null;
  status_justificativa: string | null;
}
interface Payload {
  kpis: { total: number; valorEmRisco: number; material: { contratos: number; valor: number } };
  itens: SaidaItem[];
}

const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const FAIXAS: Array<{ v: string; l: string }> = [
  { v: "all", l: "Todas" },
  { v: ">36", l: ">36 (material)" },
  { v: "13-36", l: "13-36" },
  { v: "4-12", l: "4-12" },
  { v: "1-3", l: "1-3" },
];

export default function CobrancaSection() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [faixa, setFaixa] = useState("all");
  const [status, setStatus] = useState("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const qs = new URLSearchParams({ faixa, status });
        const res = await fetch(`/api/carteira-saida?${qs.toString()}`, { cache: "no-store" });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || "Erro ao carregar as saídas.");
        if (alive) setData(payload);
      } catch (err: any) {
        if (alive) setError(err.message || "Erro ao carregar as saídas.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [faixa, status]);

  const exportHref = useMemo(
    () => `/api/carteira-saida?${new URLSearchParams({ faixa, status, format: "csv" }).toString()}`,
    [faixa, status]
  );

  const k = data?.kpis;

  return (
    <div className="cobranca">
      <p className="note">
        <span className="dot" />
        Cada linha é <b>diferido interrompido antes do prazo</b>. O sistema NÃO classifica o motivo — a{" "}
        <b>Promotiva justifica caso a caso</b> (quitou / cancelou / portou / inadimpliu) ou paga. O ônus da
        prova é dela.
      </p>

      {k ? (
        <KpiBand
          valueSize={26}
          items={[
            { label: "Saídas a justificar", value: String(k.total), sub: "contratos que saíram antes do prazo" },
            { label: "Valor em risco", value: brl(k.valorEmRisco), sub: "diferido interrompido total", accent: true },
            {
              label: "Núcleo material (>36 restantes)",
              value: brl(k.material.valor),
              sub: `${k.material.contratos} contratos · onde a cobrança rende`,
            },
          ]}
        />
      ) : null}

      <section className="card">
        <div className="cob-head">
          <div>
            <h2>Saídas da carteira · diferido a justificar</h2>
            <p className="csub">Ordenado por diferido interrompido (maior primeiro)</p>
          </div>
          <div className="cob-actions">
            <div className="seg" role="tablist" aria-label="Faixa de parcelas restantes">
              {FAIXAS.map((f) => (
                <button key={f.v} className={faixa === f.v ? "on" : ""} onClick={() => setFaixa(f.v)}>
                  {f.l}
                </button>
              ))}
            </div>
            <a className="expbtn" href={exportHref} download>
              Exportar CSV
            </a>
          </div>
        </div>

        {error ? <div className="cob-state err">{error}</div> : null}
        {loading ? (
          <div className="cob-state">Carregando saídas…</div>
        ) : data && data.itens.length > 0 ? (
          <Table scrollable minWidth={720}>
            <thead>
              <tr>
                <th>Nº Operação</th>
                <th>Saiu em</th>
                <th className="c">Pagas/Prazo</th>
                <th className="r">Restantes</th>
                <th className="r">Comissão</th>
                <th className="r">Diferido interrompido</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.itens.map((r) => (
                <tr key={r.numero_operacao}>
                  <td className="op">{r.numero_operacao}</td>
                  <td>{r.competencia_ultima}</td>
                  <td className="c">
                    {r.parcelas_pagas}/{r.prazo}
                  </td>
                  <td className={`r${(r.parcelas_restantes ?? 0) > 36 ? " mat" : ""}`}>{r.parcelas_restantes}</td>
                  <Num>{brl(r.comissao)}</Num>
                  <Num className="dif">{brl(r.diferido_interrompido)}</Num>
                  <td>
                    <Chip variant={r.status_justificativa === "a_justificar" ? "warn" : "neutral"}>
                      {r.status_justificativa === "a_justificar" ? "a justificar" : r.status_justificativa}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="cob-state">Nenhuma saída nesta faixa.</div>
        )}
      </section>

      <style jsx>{`
        .note {
          font-size: 12.5px;
          color: #5b6472;
          margin: 4px 0 14px;
          display: flex;
          gap: 8px;
          align-items: baseline;
        }
        .note .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #d6a13f;
          flex: none;
          margin-top: 4px;
        }
        .cob-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }
        .cob-head h2 {
          font-size: 14.5px;
          font-weight: 600;
          margin: 0;
        }
        .csub {
          font-size: 11.5px;
          color: #9aa1b0;
          margin-top: 2px;
        }
        .cob-actions {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .seg {
          display: inline-flex;
          border: 1px solid #e2e6ec;
          border-radius: 9px;
          overflow: hidden;
        }
        .seg button {
          font-size: 11.5px;
          font-weight: 600;
          color: #5b6472;
          background: #fff;
          border: 0;
          padding: 7px 11px;
          cursor: pointer;
          border-left: 1px solid #e2e6ec;
        }
        .seg button:first-child {
          border-left: 0;
        }
        .seg button.on {
          background: #0f1f4a;
          color: #fff;
        }
        .expbtn {
          font-size: 12px;
          font-weight: 600;
          color: #fff;
          background: #0f1f4a;
          border-radius: 9px;
          padding: 8px 14px;
          text-decoration: none;
          white-space: nowrap;
        }
        .cob-state {
          padding: 24px;
          text-align: center;
          color: #9aa1b0;
          font-size: 13px;
        }
        .cob-state.err {
          color: #8a1c1c;
        }
        .op {
          font-variant-numeric: tabular-nums;
        }
        .dif {
          font-weight: 700;
          color: var(--gold-deep, #9a6a12);
        }
        .r.mat {
          font-weight: 700;
          color: #8a1c1c;
        }
      `}</style>
    </div>
  );
}
