"use client";

import { useEffect, useState } from "react";

import { Banner, Card, HeaderNavy, KpiBand, Num, Table, UiStyles } from "@/components/ui";

// ============================================================
// TELA DO GESTOR DE CONSORCIO (M2b). Mostra SO os 10% do gestor, por competencia.
// Le /api/gestor-consorcio (RLS corta as linhas ao gestor logado). O gestor nunca
// ve a comissao dos promotores.
// ============================================================

type CompLinha = { competencia: string; base: number; gestor_10: number; empresas: number };
type Payload = { competencias: CompLinha[]; total: number };

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function compLabel(iso: string): string {
  const [y, m] = iso.split("-");
  return `${MES[Number(m) - 1] ?? m}/${y}`;
}
function brl2(v?: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0));
}

export default function GestorConsorcioPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    fetch("/api/gestor-consorcio")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar o payout do consórcio."))))
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

  return (
    <div>
      <UiStyles />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
        <HeaderNavy
          brand="GESTOR CONSÓRCIO"
          title="Meu repasse — 10% do consórcio"
          subtitle="10% de toda a comissão-empresa do consórcio, de todas as empresas do grupo, por competência."
        >
          <KpiBand
            columns={2}
            valueSize={28}
            items={[
              { label: "Total acumulado", value: brl2(data?.total), sub: "soma de todas as competências", accent: true },
              { label: "Competências", value: String(comps.length), sub: "meses com repasse" },
            ]}
          />
        </HeaderNavy>

        <Banner variant="info">
          Este é o seu payout de gestor de consórcio (10%). É calculado a cada fechamento sobre a
          comissão-empresa total do consórcio e é <b>separado</b> da comissão dos promotores — você
          vê apenas o seu número.
        </Banner>

        {error ? <Banner variant="warn">{error}</Banner> : null}

        <Card title="Repasse por competência">
          {loading ? (
            <p style={{ padding: 16, opacity: 0.7 }}>Carregando…</p>
          ) : comps.length === 0 ? (
            <p style={{ padding: 16, opacity: 0.7 }}>Nenhum repasse de consórcio encontrado.</p>
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
