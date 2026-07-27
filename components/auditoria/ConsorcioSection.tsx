"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, Card, Chip, HeaderNavy, KpiBand, Num, Table, type ChipVariant } from "@/components/ui";

// ============================================================
// AUDITORIA FORTE DO CONSORCIO (M2b) — secao da Auditoria.
// Lista as parcelas ESPERADAS que nao vieram (a partir de carteira_consorcio),
// lidas de consorcio_inadimplencia_monitor via /api/auditoria/consorcio. Espelho
// do InadimplenciaSection do PRT. socio-only (guard na rota GET). READ-ONLY.
// ============================================================

type FilaItem = {
  proposta: string;
  posicao: number;
  status: string;
  segmento_grupo: string | null;
  teto_parcelas: number;
  posicao_recebida_max: number;
  ultimo_mes_recebido: string | null;
  cauda_restante: number;
  valor_previsto: number;
  recuperavel_estimado: number;
  primeira_deteccao: string;
  status_acompanhamento: string;
  resolucao_status: string;
  resolucao_por: string | null;
  resolucao_em: string | null;
};

type Payload = {
  competencia: string | null;
  competencias: string[];
  fila: FilaItem[];
  agregados: {
    suspeitos: number;
    quitacoes: number;
    recuperavelAberto: number;
    solucionado: { contagem: number; valor: number };
  };
};

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function compLabel(iso: string | null): string {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  return `${MES[Number(m) - 1] ?? m}/${y}`;
}
function brl2(v?: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0));
}

const STATUS: Record<string, { variant: ChipVariant; label: string }> = {
  PARCELA_NAO_VEIO_SUSPEITO: { variant: "risk", label: "Suspeito (parou no meio)" },
  PARCELA_NAO_VEIO_QUITACAO: { variant: "warn", label: "Provável quitação" },
};
function statusChip(s: string) {
  return STATUS[s] ?? { variant: "neutral" as ChipVariant, label: s };
}

export default function ConsorcioSection() {
  const [selectedComp, setSelectedComp] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback((comp: string) => {
    let cancel = false;
    setLoading(true);
    setError("");
    const qs = comp ? `?competencia=${encodeURIComponent(comp)}` : "";
    fetch(`/api/auditoria/consorcio${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar a auditoria do consórcio."))))
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

  useEffect(() => load(selectedComp), [selectedComp, load]);

  const ag = data?.agregados;
  const fila = useMemo(() => (data?.fila ?? []).filter((r) => r.resolucao_status !== "SOLUCIONADO"), [data]);
  const compValue = selectedComp || data?.competencia || "";
  const totalPrevisto = useMemo(() => fila.reduce((s, r) => s + r.valor_previsto, 0), [fila]);

  return (
    <section className="consorcio-aud">
      <HeaderNavy
        eyebrow="MONITOR CONSÓRCIO"
        title="Consórcio — parcelas esperadas que não vieram"
        subtitle="A cada fechamento: parcelas recebidas × esperadas (TRP 210). A próxima parcela não veio → R$ previsto a recuperar."
        actions={
          <div className="comp">
            <select
              aria-label="Competência da auditoria do consórcio"
              value={compValue}
              onChange={(e) => setSelectedComp(e.target.value)}
            >
              {(data?.competencias ?? []).map((c) => (
                <option key={c} value={c}>
                  {compLabel(c)}
                </option>
              ))}
            </select>
            <span className="chev">▾</span>
          </div>
        }
      >
        <KpiBand
          columns={4}
          valueSize={26}
          items={[
            { label: "Suspeitos", value: ag ? String(ag.suspeitos) : "—", sub: "parou no meio", accent: true },
            {
              label: "Recuperável aberto",
              value: ag ? brl2(ag.recuperavelAberto) : "—",
              sub: "cauda esperada pela TRP",
              subTone: "gold",
            },
            { label: "Prováveis quitações", value: ag ? String(ag.quitacoes) : "—", sub: "só faltou a última" },
            {
              label: "Solucionados",
              value: ag ? String(ag.solucionado.contagem) : "—",
              sub: ag ? `${brl2(ag.solucionado.valor)} resolvidos` : "resolvidos pelo sócio",
              subTone: "amber",
            },
          ]}
        />
      </HeaderNavy>

      <Banner variant="info">
        Auditoria forte do consórcio: para cada proposta ativa, a carteira projeta as parcelas 1..teto
        pela <b>TRP 210</b> (Geral 6, Imóvel 10). Se a <b>próxima parcela</b> não chega no mês esperado,
        acusamos <b>PARCELA NÃO VEIO</b> com o valor previsto. Cauda ≥ 2 = <b>suspeito</b>; só a última ={" "}
        <b>provável quitação</b>. A comissão-empresa paga vem pronta no fechamento — a TRP só projeta e audita.
      </Banner>

      {error ? <Banner variant="warn">{error}</Banner> : null}

      <Card title={`Parcelas não vindas · ${compLabel(data?.competencia ?? null)}`}>
        {loading ? (
          <p style={{ padding: 16, opacity: 0.7 }}>Carregando…</p>
        ) : fila.length === 0 ? (
          <p style={{ padding: 16, opacity: 0.7 }}>Nenhuma parcela esperada faltando nesta competência.</p>
        ) : (
          <Table scrollable>
            <thead>
              <tr>
                <th>Proposta</th>
                <th>Segmento</th>
                <th>Recebidas</th>
                <th>Parcela que faltou</th>
                <th>Último recebido</th>
                <th>Cauda</th>
                <th style={{ textAlign: "right" }}>Valor previsto</th>
                <th style={{ textAlign: "right" }}>Recuperável</th>
                <th>Classificação</th>
              </tr>
            </thead>
            <tbody>
              {fila.map((r) => {
                const c = statusChip(r.status);
                return (
                  <tr key={`${r.proposta}|${r.posicao}`}>
                    <td className="mono">{r.proposta}</td>
                    <td>{r.segmento_grupo === "IMOVEL" ? "Imóvel" : "Geral"}</td>
                    <Num>
                      {r.posicao_recebida_max}/{r.teto_parcelas}
                    </Num>
                    <Num>{r.posicao}ª</Num>
                    <td>{compLabel(r.ultimo_mes_recebido)}</td>
                    <Num>{r.cauda_restante}</Num>
                    <Num>{brl2(r.valor_previsto)}</Num>
                    <Num>{brl2(r.recuperavel_estimado)}</Num>
                    <td>
                      <Chip variant={c.variant}>{c.label}</Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>{fila.length} parcela(s) não vieram</td>
                <Num>{brl2(totalPrevisto)}</Num>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </section>
  );
}
