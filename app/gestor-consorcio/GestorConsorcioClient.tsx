"use client";

import { useEffect, useState } from "react";

import { Banner, Card, EmptyState, HeaderNavy, KpiBand, Num, Table, UiStyles } from "@/components/ui";

// ============================================================
// TELA DO GESTOR DE CONSORCIO (M3 PARTE C). Duas visoes:
//   1) PRODUCAO GERAL do consorcio (todos os promotores) — quem vendeu quanto;
//   2) MEU REPASSE de 10%, por competencia.
// O gestor NUNCA ve a comissao (40%) dos promotores — a API nem a busca.
// ============================================================

type CompLinha = { competencia: string; base: number; gestor_10: number; empresas: number };
type ProdPromotor = {
  promoter_id: string | null;
  promoter_name: string;
  propostas: number;
  parcelas_recebidas: number;
  base_recebida: number;
};
type Payload = {
  competencias: CompLinha[];
  total: number;
  producao: { total_propostas: number; total_base_recebida: number; por_promotor: ProdPromotor[] };
};

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function compLabel(iso: string): string {
  const [y, m] = iso.split("-");
  return `${MES[Number(m) - 1] ?? m}/${y}`;
}
function brl2(v?: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0));
}

export default function GestorConsorcioClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    fetch("/api/gestor-consorcio")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar o painel do consórcio."))))
      .then((j: Payload) => {
        if (!cancel) setData(j);
      })
      .catch((e) => {
        if (!cancel) setError(e.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const comps = data?.competencias ?? [];
  const prod = data?.producao;
  const promotores = prod?.por_promotor ?? [];

  return (
    <div>
      <UiStyles />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 22 }}>
        <HeaderNavy
          brand="GESTOR CONSÓRCIO"
          title="Consórcio — visão do gestor"
          subtitle="Produção geral do consórcio + o seu repasse de 10%. Você não vê a comissão dos promotores."
        >
          <KpiBand
            columns={3}
            valueSize={26}
            items={[
              { label: "Meu repasse (10%)", value: brl2(data?.total), sub: "acumulado", accent: true },
              { label: "Produção (base recebida)", value: brl2(prod?.total_base_recebida), sub: "comissão-empresa", subTone: "gold" },
              { label: "Propostas", value: prod ? String(prod.total_propostas) : "—", sub: "no consórcio" },
            ]}
          />
        </HeaderNavy>

        <Banner variant="info">
          Você vê a <b>produção geral</b> do consórcio (quem vendeu quanto) e o <b>seu</b> repasse de
          10%, calculado sobre a comissão-empresa total. O repasse dos <b>promotores</b> (40%) não é
          exibido nem consultado aqui — é informação restrita.
        </Banner>

        {error ? <Banner variant="warn">{error}</Banner> : null}

        <Card title="Produção por promotor">
          {loading ? (
            <p style={{ padding: 16, opacity: 0.7 }}>Carregando…</p>
          ) : promotores.length === 0 ? (
            <EmptyState title="Nenhuma produção de consórcio ainda." description="Assim que houver parcelas atribuídas e recebidas, elas aparecem aqui." />
          ) : (
            <Table scrollable minWidth={640}>
              <thead>
                <tr>
                  <th className="rr-sticky-col">Promotor</th>
                  <th>Propostas</th>
                  <th>Parcelas recebidas</th>
                  <th style={{ textAlign: "right" }}>Base recebida (comissão-empresa)</th>
                </tr>
              </thead>
              <tbody>
                {promotores.map((p) => (
                  <tr key={p.promoter_id ?? "__na__"}>
                    <td className="rr-sticky-col">{p.promoter_name}</td>
                    <Num>{p.propostas}</Num>
                    <Num>{p.parcelas_recebidas}</Num>
                    <Num>{brl2(p.base_recebida)}</Num>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <Num>{brl2(prod?.total_base_recebida)}</Num>
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>

        <Card title="Meu repasse (10%) por competência">
          {loading ? (
            <p style={{ padding: 16, opacity: 0.7 }}>Carregando…</p>
          ) : comps.length === 0 ? (
            <EmptyState title="Nenhum repasse de consórcio encontrado." description="Seu repasse aparece após o fechamento das competências com consórcio." />
          ) : (
            <Table scrollable>
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Empresas</th>
                  <th style={{ textAlign: "right" }}>Base (comissão-empresa)</th>
                  <th style={{ textAlign: "right" }}>Meu repasse (10%)</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c.competencia}>
                    <td>{compLabel(c.competencia)}</td>
                    <Num>{c.empresas}</Num>
                    <Num>{brl2(c.base)}</Num>
                    <Num>{brl2(c.gestor_10)}</Num>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <Num>{brl2(data?.total)}</Num>
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>
      </main>
    </div>
  );
}
