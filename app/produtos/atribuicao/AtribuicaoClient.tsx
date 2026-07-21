"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, Button, Card, Chip, EmptyState, HeaderNavy, KpiBand, Table, UiStyles } from "@/components/ui";

// FRENTE DE PRODUTO — M3 PARTE A1: fila de atribuicao de produtos.
// Lista PENDING/ASSIGNED por produto e permite o socio/funcionario atribuir o
// promotor. Consorcio e por PROPOSTA (uma ancora resolve todas as parcelas).

type Item = {
  id: string;
  company_id: string | null;
  entry_type: string;
  operation_number: string;
  contract_number: string;
  promoter_id: string | null;
  promoter_name: string | null;
  status: "PENDING" | "ASSIGNED";
  balde: boolean;
};
type Promoter = { id: string; name: string; company_id: string | null };
type Payload = {
  year: number;
  month: number;
  grupos: { bbcap: Item[]; conta_corrente: Item[]; consorcio: Item[] };
  promoters: Promoter[];
  resumo: { pendentes: number; atribuidas: number };
};

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const CSS = `
.rratr .wrap{max-width:1080px;margin:0 auto;padding:24px 20px 64px;display:flex;flex-direction:column;gap:22px}
.rratr .crumb{font-size:13px;color:var(--ink-3);display:flex;gap:8px;align-items:center}
.rratr .crumb a{color:var(--ink-2);text-decoration:none}
.rratr .crumb .sep{opacity:.5}
.rratr .comp{display:flex;gap:8px;align-items:center}
.rratr .comp select{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:8px;padding:7px 10px;font:inherit}
.rratr .prodgrid{display:flex;flex-direction:column;gap:22px}
.rratr .idn{font-family:var(--font-mono);font-size:13px}
.rratr .rowsel{min-width:210px;max-width:280px;background:var(--paper);border:1px solid var(--bd);border-radius:8px;padding:6px 8px;font:inherit;color:var(--ink)}
.rratr .rowsel:disabled{background:var(--neu);color:var(--ink-3)}
.rratr .hintline{font-size:12.5px;color:var(--ink-3);margin:2px 0 12px}
`;

function brl0(v: number) {
  return new Intl.NumberFormat("pt-BR").format(v);
}

export default function AtribuicaoClient() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback((y: number, m: number, opts?: { silent?: boolean }) => {
    let cancel = false;
    if (!opts?.silent) setLoading(true);
    setError("");
    fetch(`/api/produtos/atribuicao?year=${y}&month=${m}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar a fila de atribuição."))))
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

  useEffect(() => load(year, month), [year, month, load]);

  const promoters = useMemo(() => data?.promoters ?? [], [data]);

  const atribuir = useCallback(
    async (item: Item, promoterId: string) => {
      setBusy(item.id);
      setError("");
      try {
        const res = await fetch("/api/produtos/atribuicao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "assign",
            entry_type: item.entry_type,
            operation_number: item.operation_number,
            contract_number: item.contract_number,
            company_id: item.company_id,
            promoter_id: promoterId || null,
            year,
            month,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || "Falha ao atribuir.");
        }
        load(year, month, { silent: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao atribuir.");
      } finally {
        setBusy(null);
      }
    },
    [year, month, load]
  );

  const sincronizar = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/produtos/atribuicao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", year, month }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Falha ao sincronizar.");
      }
      load(year, month, { silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao sincronizar.");
    } finally {
      setSyncing(false);
    }
  }, [year, month, load]);

  const renderGrupo = (
    titulo: string,
    itens: Item[],
    porProposta: boolean,
    idLabel: string
  ) => (
    <Card title={titulo}>
      <p className="hintline">
        {porProposta
          ? "Consórcio é atribuído por PROPOSTA: uma atribuição vale para todas as parcelas (passadas e futuras) daquela proposta."
          : "Cada linha é um evento único (uma proposta/conta)."}
      </p>
      {itens.length === 0 ? (
        <EmptyState title={`Nenhuma linha de ${titulo.toLowerCase()} na fila.`} description="Se acabou de importar, use “Sincronizar fila”." />
      ) : (
        <Table scrollable minWidth={640}>
          <thead>
            <tr>
              <th className="rr-sticky-col">{idLabel}</th>
              <th>Status</th>
              <th>Promotor</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it) => (
              <tr key={it.id}>
                <td className="rr-sticky-col idn">
                  {it.operation_number}
                  {it.balde ? (
                    <>
                      {" "}
                      <Chip variant="neutral">S/ IDENTIFICAÇÃO</Chip>
                    </>
                  ) : null}
                </td>
                <td>
                  {it.status === "ASSIGNED" ? (
                    <Chip variant="ok">atribuído</Chip>
                  ) : (
                    <Chip variant="warn">pendente</Chip>
                  )}
                </td>
                <td>
                  <select
                    className="rowsel"
                    value={it.promoter_id ?? ""}
                    disabled={busy === it.id}
                    onChange={(e) => atribuir(it, e.target.value)}
                    aria-label={`Promotor de ${it.operation_number}`}
                  >
                    <option value="">— não atribuído (balde) —</option>
                    {promoters.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );

  const g = data?.grupos;

  return (
    <div className="rratr">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <Link href="/dashboard">Dashboard</Link>
          <span className="sep">/</span>
          <span>Atribuição de produtos</span>
        </nav>

        <HeaderNavy
          brand="GRUPO RR CRED"
          title="Atribuição de produtos"
          subtitle="Dê um dono a cada linha de BBCAP, Conta Corrente e Consórcio. Sem promotor = sem repasse (fica no balde)."
          actions={
            <div className="comp">
              <select aria-label="Mês" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select aria-label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {[2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <Button variant="secundario" onClick={sincronizar} disabled={syncing}>
                {syncing ? "Sincronizando…" : "Sincronizar fila"}
              </Button>
            </div>
          }
        >
          <KpiBand
            valueSize={26}
            items={[
              { label: "Pendentes", value: data ? brl0(data.resumo.pendentes) : "—", sub: "sem promotor (balde)", accent: true },
              { label: "Atribuídas", value: data ? brl0(data.resumo.atribuidas) : "—", sub: "com dono", subTone: "ok" },
            ]}
          />
        </HeaderNavy>

        <Banner variant="info">
          Consórcio é <b>diferido</b>: atribuir a proposta uma vez faz todas as parcelas (e as futuras)
          herdarem o promotor. BBCAP e Conta Corrente são <b>evento único</b>. Reatribuir é possível a
          qualquer momento — o repasse recompõe no próximo fechamento.
        </Banner>

        {error ? <Banner variant="warn">{error}</Banner> : null}

        {loading ? (
          <Card title="Fila">
            <p style={{ padding: 16, opacity: 0.7 }}>Carregando…</p>
          </Card>
        ) : (
          <div className="prodgrid">
            {renderGrupo("BBCAP", g?.bbcap ?? [], false, "Proposta")}
            {renderGrupo("Conta Corrente", g?.conta_corrente ?? [], false, "Conta")}
            {renderGrupo("Consórcio", g?.consorcio ?? [], true, "Proposta")}
          </div>
        )}
      </main>
    </div>
  );
}
