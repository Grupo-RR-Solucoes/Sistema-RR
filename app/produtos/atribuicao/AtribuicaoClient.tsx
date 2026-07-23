"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Banner, Button, Card, Chip, EmptyState, HeaderNavy, KpiBand, Table, UiStyles } from "@/components/ui";

// FRENTE DE PRODUTO — M3 PARTE A1 + VENDA PROPRIA DE GESTAO: fila de atribuicao.
// Lista PENDING/ASSIGNED por produto e permite dar dono a cada linha. O dono pode ser
// um PROMOTOR ou um PAPEL DE GESTAO com venda propria (que NAO e promotor). Consorcio
// e por PROPOSTA (uma ancora resolve todas as parcelas).
//
// ESCOPO: o gestor de consorcio ve SO o card de Consorcio (a API nem devolve os
// outros). socio/funcionario veem os tres.

type Item = {
  id: string;
  company_id: string | null;
  entry_type: string;
  operation_number: string;
  contract_number: string;
  beneficiario_value: string;
  beneficiario_kind: "promotor" | "gestao" | null;
  beneficiario_nome: string | null;
  status: "PENDING" | "ASSIGNED";
  balde: boolean;
};
type Beneficiario = {
  value: string;
  kind: "promotor" | "gestao";
  id: string;
  nome: string;
  sub: string;
};
type Payload = {
  year: number;
  month: number;
  escopo: "TODOS" | "CONSORCIO";
  role: string;
  grupos: { bbcap: Item[]; conta_corrente: Item[]; consorcio: Item[] };
  beneficiarios: Beneficiario[];
  resumo: { pendentes: number; atribuidas: number; gestao: number };
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
.rratr tr.gestaorow td{background:rgba(198,157,74,.10)}
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

  const beneficiarios = useMemo(() => data?.beneficiarios ?? [], [data]);
  const promotores = useMemo(() => beneficiarios.filter((b) => b.kind === "promotor"), [beneficiarios]);
  const gestao = useMemo(() => beneficiarios.filter((b) => b.kind === "gestao"), [beneficiarios]);
  const soConsorcio = data?.escopo === "CONSORCIO";

  const atribuir = useCallback(
    async (item: Item, beneficiarioValue: string) => {
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
            beneficiario: beneficiarioValue || null,
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
              <th>Quem vendeu</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it) => (
              <tr key={it.id} className={it.beneficiario_kind === "gestao" ? "gestaorow" : undefined}>
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
                  {it.beneficiario_kind === "gestao" ? (
                    <>
                      {" "}
                      <Chip variant="warn">VENDA DE GESTÃO</Chip>
                    </>
                  ) : null}
                </td>
                <td>
                  <select
                    className="rowsel"
                    value={it.beneficiario_value}
                    disabled={busy === it.id}
                    onChange={(e) => atribuir(it, e.target.value)}
                    aria-label={`Quem vendeu ${it.operation_number}`}
                  >
                    <option value="">— não atribuído (balde) —</option>
                    {promotores.length > 0 ? (
                      <optgroup label="Promotores">
                        {promotores.map((b) => (
                          <option key={b.value} value={b.value}>
                            {b.nome}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {gestao.length > 0 ? (
                      <optgroup label="Gestão (venda própria)">
                        {gestao.map((b) => (
                          <option key={b.value} value={b.value}>
                            {b.nome}
                            {b.sub ? ` — ${b.sub}` : ""}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
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
          title={soConsorcio ? "Atribuição de consórcio" : "Atribuição de produtos"}
          subtitle={
            soConsorcio
              ? "Dê um dono a cada proposta de Consórcio. Sem dono = sem repasse (fica no balde)."
              : "Dê um dono a cada linha de BBCAP, Conta Corrente e Consórcio. Sem dono = sem repasse (fica no balde)."
          }
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
            columns={3}
            valueSize={26}
            items={[
              { label: "Pendentes", value: data ? brl0(data.resumo.pendentes) : "—", sub: "sem dono (balde)", accent: true },
              { label: "Atribuídas", value: data ? brl0(data.resumo.atribuidas) : "—", sub: "com dono", subTone: "ok" },
              { label: "Venda de gestão", value: data ? brl0(data.resumo.gestao) : "—", sub: "para conferência", subTone: "gold" },
            ]}
          />
        </HeaderNavy>

        <Banner variant="info">
          Consórcio é <b>diferido</b>: atribuir a proposta uma vez faz todas as parcelas (e as futuras)
          herdarem o dono. BBCAP e Conta Corrente são <b>evento único</b>. Reatribuir é possível a
          qualquer momento — o repasse recompõe no próximo fechamento.
        </Banner>

        {gestao.length > 0 ? (
          <Banner variant="warn">
            As linhas em destaque foram atribuídas a um <b>papel de gestão</b> (venda própria) — a
            comissão vai para a pessoa da gestão, não para um promotor. Elas ficam marcadas aqui para
            conferência.
          </Banner>
        ) : null}

        {error ? <Banner variant="warn">{error}</Banner> : null}

        {loading ? (
          <Card title="Fila">
            <p style={{ padding: 16, opacity: 0.7 }}>Carregando…</p>
          </Card>
        ) : (
          <div className="prodgrid">
            {soConsorcio ? null : renderGrupo("BBCAP", g?.bbcap ?? [], false, "Proposta")}
            {soConsorcio ? null : renderGrupo("Conta Corrente", g?.conta_corrente ?? [], false, "Conta")}
            {renderGrupo("Consórcio", g?.consorcio ?? [], true, "Proposta")}
          </div>
        )}
      </main>
    </div>
  );
}
