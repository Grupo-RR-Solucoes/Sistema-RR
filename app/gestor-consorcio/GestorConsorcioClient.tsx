"use client";

import { useEffect, useState } from "react";

import { Banner, Card, EmptyState, HeaderNavy, KpiBand, Num, Table, UiStyles } from "@/components/ui";

// ============================================================
// TELA DO GESTOR DE CONSORCIO (M3 PARTE C). Tres visoes:
//   1) MINHA VENDA PROPRIA — o que ele recebe pelas vendas que ELE fez (mesmo
//      percentual de um promotor). So aparece quando ha venda propria habilitada e
//      atribuida. Ele NAO e promotor: isto NAO vem do PMR.
//   2) PRODUCAO GERAL do consorcio (todos os vendedores) — quem vendeu quanto;
//   3) MEU REPASSE de 10%, por competencia.
// Na venda dele as duas facetas SOMAM: 40% (venda propria) + 10% (gestao), porque a
// base dos 10% ja inclui a parcela que ele vendeu.
// O gestor NUNCA ve a comissao (40%) dos promotores — a API nem a busca.
// ============================================================

type CompLinha = { competencia: string; base: number; gestor_10: number; empresas: number };
type ProdPromotor = {
  promoter_id: string | null;
  promoter_name: string;
  is_gestao: boolean;
  propostas: number;
  parcelas_recebidas: number;
  base_recebida: number;
};
type VendaPropriaComp = {
  competencia: string;
  bbcap: number;
  conta_corrente: number;
  consorcio: number;
  final: number;
};
type VendaPropria = {
  habilitada: boolean;
  total: number;
  competencias: VendaPropriaComp[];
};
type Payload = {
  competencias: CompLinha[];
  total: number;
  producao: { total_propostas: number; total_base_recebida: number; por_promotor: ProdPromotor[] };
  vendaPropria: VendaPropria | null;
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
    setLoading(true);
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
  const vp = data?.vendaPropria ?? null;

  return (
    <div>
      <UiStyles />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 22 }}>
        <HeaderNavy
          eyebrow="GESTOR CONSÓRCIO"
          title="Consórcio — visão do gestor"
          subtitle="Produção geral do consórcio + o seu repasse de 10%. Você não vê a comissão dos promotores."
        >
          <KpiBand
            columns={vp ? 4 : 3}
            valueSize={26}
            items={[
              { label: "Meu repasse (10%)", value: brl2(data?.total), sub: "acumulado", accent: true },
              ...(vp
                ? [{ label: "Minha venda própria", value: brl2(vp.total), sub: "acumulado", subTone: "ok" as const }]
                : []),
              { label: "Produção (base recebida)", value: brl2(prod?.total_base_recebida), sub: "comissão-empresa", subTone: "gold" as const },
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

        {/* MINHA VENDA PROPRIA — so aparece quando ha venda propria atribuida a ele */}
        {vp && vp.habilitada ? (
          <Card title="Minha venda própria">
            <Table scrollable minWidth={620} cards>
              <thead>
                <tr>
                  <th>Competência</th>
                  <th style={{ textAlign: "right" }}>BBCAP</th>
                  <th style={{ textAlign: "right" }}>Conta Corrente</th>
                  <th style={{ textAlign: "right" }}>Consórcio (40%)</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {vp.competencias.map((c) => (
                  <tr key={c.competencia}>
                    <td data-l="Competência">{compLabel(c.competencia)}</td>
                    <Num data-l="BBCAP">{brl2(c.bbcap)}</Num>
                    <Num data-l="Conta Corrente">{brl2(c.conta_corrente)}</Num>
                    <Num data-l="Consórcio (40%)">{brl2(c.consorcio)}</Num>
                    <Num data-l="Total">{brl2(c.final)}</Num>
                  </tr>
                ))}
              </tbody>
              {/* tfoot: o td de colSpan ja diz "Total" e por isso fica sem data-l
                  (regra: celula de colSpan nao recebe rotulo). A celula Num
                  recebe o rotulo da COLUNA dela, senao no cartao o numero fica
                  solto. Sem escrever a tag por extenso no comentario: o
                  verificador de data-l varre o texto e a leria como celula. */}
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <Num data-l="Total">{brl2(vp.total)}</Num>
                </tr>
              </tfoot>
            </Table>
            <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "10px 0 0" }}>
              Estas são as vendas que <b>você</b> fez, com o <b>mesmo percentual de um promotor</b> —
              você não é promotor, esta comissão é do seu papel de gestão. Ela <b>soma</b> com os seus
              10% abaixo: na sua própria venda de consórcio você recebe os 40% aqui e os 10% lá.
            </p>
          </Card>
        ) : null}

        <Card title="Produção por vendedor">
          {loading ? (
            <p style={{ padding: 16, opacity: 0.7 }}>Carregando…</p>
          ) : promotores.length === 0 ? (
            <EmptyState title="Nenhuma produção de consórcio ainda." description="Assim que houver parcelas atribuídas e recebidas, elas aparecem aqui." />
          ) : (
            <Table scrollable minWidth={640} cards>
              <thead>
                <tr>
                  <th className="rr-sticky-col">Vendedor</th>
                  <th>Propostas</th>
                  <th>Parcelas recebidas</th>
                  <th style={{ textAlign: "right" }}>Base recebida (comissão-empresa)</th>
                </tr>
              </thead>
              <tbody>
                {promotores.map((p) => (
                  <tr key={p.promoter_id ?? (p.is_gestao ? `g-${p.promoter_name}` : "__na__")}>
                    <td className="rr-sticky-col" data-l="Vendedor">{p.promoter_name}</td>
                    <Num data-l="Propostas">{p.propostas}</Num>
                    <Num data-l="Parcelas recebidas">{p.parcelas_recebidas}</Num>
                    <Num data-l="Base recebida (comissão-empresa)">{brl2(p.base_recebida)}</Num>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <Num data-l="Base recebida (comissão-empresa)">{brl2(prod?.total_base_recebida)}</Num>
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
            <Table scrollable cards>
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
                    <td data-l="Competência">{compLabel(c.competencia)}</td>
                    <Num data-l="Empresas">{c.empresas}</Num>
                    <Num data-l="Base (comissão-empresa)">{brl2(c.base)}</Num>
                    <Num data-l="Meu repasse (10%)">{brl2(c.gestor_10)}</Num>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <Num data-l="Meu repasse (10%)">{brl2(data?.total)}</Num>
                </tr>
              </tfoot>
            </Table>
          )}
        </Card>
      </main>
    </div>
  );
}
