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

// Detalhe vindo da MASTER (monthly_closing_entries), casado pela chave natural na
// rota. `comissao_promotor`/`comissao_gestor` sao DERIVADOS na exibicao — nao ha
// coluna gravada para eles. null = sem linha na master para a competencia pedida.
type DetalheEventoUnico = {
  comissao_empresa: number;
  /** AUSENTE quando quem pediu nao pode ver (a rota nem manda). */
  comissao_promotor?: number;
  j_key: string | null;
  operation_date: string | null;
  metadata: Record<string, unknown>;
};
type DetalheConsorcio = {
  comissao_empresa: number;
  /** AUSENTE quando quem pediu nao pode ver (a rota nem manda). */
  comissao_promotor?: number;
  comissao_gestor: number;
  parcela_rotulo: string | null;
  operation_date: string | null;
  valor_bem: number;
  pct_comissao: number | null;
  segmento: string | null;
  razao_social: string | null;
};

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
  detalhe: DetalheEventoUnico | DetalheConsorcio | null;
  // CONSORCIO: a linha e uma PARCELA, mas a atribuicao e da PROPOSTA. Estes tres
  // campos existem so para a tela conseguir DIZER isso — nao decidem valor nenhum.
  parcela_seq?: number;
  parcela_total?: number;
  mesma_proposta?: boolean;
  /** Ancora sem parcela na competencia: atribuivel para as proximas. */
  sem_lancamento?: boolean;
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
  competencia: string;
  // A rota ja OMITIU comissao_promotor do payload quando isto e false. O flag so
  // evita desenhar uma coluna inteira de "—": nao e ele que protege o dado.
  pode_ver_comissao_promotor: boolean;
  escopo: "TODOS" | "CONSORCIO";
  role: string;
  grupos: {
    bbcap: Item[];
    conta_corrente: Item[];
    consorcio: Item[];
    consorcio_sem_lancamento?: Item[];
  };
  beneficiarios: Beneficiario[];
  resumo: {
    pendentes: number;
    atribuidas: number;
    gestao: number;
    parcelas_consorcio?: number;
    ancoras_sem_lancamento?: number;
  };
};

// Nome por EXTENSO, nao a abreviacao de 3 letras. A tela e de trabalho manual e
// "jul" x "jun" a 12px se confundem — errar o mes aqui significa atribuir a
// competencia errada, que so aparece no fechamento seguinte.
const MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const CSS = `
.rratr .wrap{max-width:1080px;margin:0 auto;padding:24px 20px 64px;display:flex;flex-direction:column;gap:22px}
.rratr .crumb{font-size:13px;color:var(--ink-3);display:flex;gap:8px;align-items:center}
.rratr .crumb a{color:var(--ink-2);text-decoration:none}
.rratr .crumb .sep{opacity:.5}
.rratr .comp{display:flex;gap:8px;align-items:center}
.rratr .comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 16px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rratr .comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rratr .prodgrid{display:flex;flex-direction:column;gap:22px}
.rratr .idn{font-family:var(--font-mono);font-size:13px}
.rratr .rowsel{min-width:210px;max-width:280px;background:var(--paper);border:1px solid var(--bd);border-radius:8px;padding:6px 8px;font:inherit;color:var(--ink)}
.rratr .rowsel:disabled{background:var(--neu);color:var(--ink-3)}
.rratr tr.gestaorow td{background:rgba(198,157,74,.10)}
.rratr .hintline{font-size:12.5px;color:var(--ink-3);margin:2px 0 12px}
.rratr td.num,.rratr th.num{text-align:right;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;white-space:nowrap}
.rratr td.rep{color:var(--navy);font-weight:600}
.rratr td.sem{color:var(--ink-3)}

/* TELEFONE ESTREITO — o .wrap nao tinha media query nenhuma e ficava com 20px
   de cada lado a 384px. */
@media (max-width:430px){ .rratr .wrap{padding:16px 12px 36px;gap:16px} }
`;

function brl0(v: number) {
  return new Intl.NumberFormat("pt-BR").format(v);
}

const BRL = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Valor monetario; "—" quando nao ha linha na master para a competencia. */
function money(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : BRL.format(v);
}
/** ISO (ou "20.07.2026" do xlsx) -> dd/mm/aaaa. Devolve "—" para vazio. */
function dataBr(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return "—";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s.replace(/\./g, "/");
}
/** 0.0072 -> "0,72%". */
function pct(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `${BRL.format(v * 100)}%`;
}
function txt(v: unknown) {
  const s = String(v ?? "").trim();
  return s === "" ? "—" : s;
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
      // CONSORCIO: a atribuicao e da PROPOSTA, nao da parcela clicada. Se ha irma
      // na tela, o usuario precisa confirmar sabendo disso — a alternativa era ele
      // descobrir depois, vendo duas linhas mudarem sozinhas.
      if (item.entry_type === "CONSORCIO" && item.mesma_proposta) {
        const nome =
          beneficiarios.find((b) => b.value === beneficiarioValue)?.nome ??
          "— não atribuído —";
        const okConfirm = window.confirm(
          `A proposta ${item.operation_number} tem ${item.parcela_total} parcelas nesta ` +
            `competência.\n\nAtribuir a ${nome} vale para TODAS elas — e para as ` +
            `parcelas futuras da mesma proposta.\n\nConfirma?`
        );
        if (!okConfirm) {
          load(year, month, { silent: true }); // devolve o <select> ao valor anterior
          return;
        }
      }
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
    [year, month, load, beneficiarios]
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

  // ============================================================
  // COLUNAS POR PRODUTO — a MESMA ordem do fechamento manual do financeiro, para
  // conferir linha a linha sem traduzir cabecalho. As duas ultimas (Status / Quem
  // vendeu) sao da FILA e valem para os tres.
  //
  // "Comissao promotor" e "Comissao gestor" sao DERIVADAS na rota (x 0,5833 para
  // evento unico, x 0,40 e x 0,10 para consorcio). Nao existe coluna gravada para
  // elas: quem paga segue sendo o PMR e o consorcio_gestor_payout.
  // ============================================================
  type Col = {
    th: string;
    cls?: string;
    /** coluna que expoe a comissao do PROMOTOR — some para quem nao tem direito. */
    repassePromotor?: true;
    get: (it: Item) => React.ReactNode;
  };
  const mdv = (it: Item, k: string) =>
    txt(((it.detalhe as DetalheEventoUnico | null)?.metadata ?? {})[k]);
  const eu = (it: Item) => it.detalhe as DetalheEventoUnico | null;
  const cs = (it: Item) => it.detalhe as DetalheConsorcio | null;

  const COLS: Record<"BBCAP" | "CONTA_CORRENTE" | "CONSORCIO", Col[]> = {
    BBCAP: [
      { th: "CPF", get: (it) => mdv(it, "cpf_cliente") },
      { th: "Data da venda", get: (it) => dataBr(eu(it)?.operation_date) },
      {
        th: "Data do débito",
        get: (it) => dataBr((eu(it)?.metadata?.data_debito as string | null) ?? null),
      },
      { th: "Código do produto", get: (it) => mdv(it, "codigo_produto") },
      {
        th: "Valor do produto",
        cls: "num",
        get: (it) => money(eu(it) ? Number(eu(it)!.metadata.valor_produto ?? 0) : null),
      },
      { th: "Login do agente", get: (it) => mdv(it, "login_agente") },
      { th: "Comissão", cls: "num", get: (it) => money(eu(it)?.comissao_empresa ?? null) },
      {
        th: "Comissão promotor",
        cls: "num rep",
        repassePromotor: true,
        get: (it) => money(eu(it)?.comissao_promotor ?? null),
      },
    ],
    CONTA_CORRENTE: [
      { th: "Agência", get: (it) => mdv(it, "agencia") },
      { th: "Chave J", get: (it) => txt(eu(it)?.j_key) },
      { th: "Data", get: (it) => dataBr(eu(it)?.operation_date) },
      { th: "Produto", get: (it) => mdv(it, "produto_texto") },
      { th: "Comissão", cls: "num", get: (it) => money(eu(it)?.comissao_empresa ?? null) },
      {
        th: "Comissão promotor",
        cls: "num rep",
        repassePromotor: true,
        get: (it) => money(eu(it)?.comissao_promotor ?? null),
      },
    ],
    CONSORCIO: [
      { th: "Data", get: (it) => dataBr(cs(it)?.operation_date) },
      { th: "Segmento", get: (it) => txt(cs(it)?.segmento) },
      { th: "Valor bem", cls: "num", get: (it) => money(cs(it)?.valor_bem ?? null) },
      {
        th: "Parcela",
        get: (it) => {
          const d = cs(it);
          if (!d) return "—";
          // A parcela DESTA linha. Quando a proposta tem mais de uma no mes, o
          // "1 de 2" avisa que existe irma na tela — e que atribuir aqui move as duas.
          return it.mesma_proposta
            ? `${d.parcela_rotulo ?? "—"} · ${it.parcela_seq} de ${it.parcela_total}`
            : d.parcela_rotulo ?? "—";
        },
      },
      { th: "% Comissão", cls: "num", get: (it) => pct(cs(it)?.pct_comissao ?? null) },
      { th: "Comissão", cls: "num", get: (it) => money(cs(it)?.comissao_empresa ?? null) },
      {
        th: "Comissão promotor",
        cls: "num rep",
        repassePromotor: true,
        get: (it) => money(cs(it)?.comissao_promotor ?? null),
      },
      { th: "Comissão gestor", cls: "num", get: (it) => money(cs(it)?.comissao_gestor ?? null) },
    ],
  };

  const renderGrupo = (
    titulo: string,
    kind: "BBCAP" | "CONTA_CORRENTE" | "CONSORCIO",
    itens: Item[],
    idLabel: string
  ) => {
    const podeVerRepasse = data?.pode_ver_comissao_promotor === true;
    const cols = COLS[kind].filter((c) => !c.repassePromotor || podeVerRepasse);
    const porProposta = kind === "CONSORCIO";
    const soSemLancamento = itens.length > 0 && itens.every((i) => i.sem_lancamento);
    const competencia = data?.competencia ?? "—";
    // Somatorio do que esta na tela — confere de cabeca com o fechamento manual.
    const soma = itens.reduce(
      (a, it) => {
        const d = it.detalhe;
        if (!d) return a;
        a.empresa += d.comissao_empresa;
        a.promotor += d.comissao_promotor ?? 0;
        if (porProposta) a.gestor += (d as DetalheConsorcio).comissao_gestor;
        return a;
      },
      { empresa: 0, promotor: 0, gestor: 0 }
    );
    const semDetalhe = itens.filter((it) => !it.detalhe).length;
    return (
      <Card title={titulo}>
        <p className="hintline">
          {soSemLancamento
            ? `Propostas já atribuíveis que NÃO tiveram parcela em ${competencia}. Não é dado faltando: a parcela deste mês não veio, e a proposta segue na fila — atribuir aqui vale para as próximas parcelas, quando chegarem.`
            : porProposta
            ? `Uma linha por PARCELA recebida em ${competencia} — a mesma quebra do fechamento manual. A ATRIBUIÇÃO, porém, é da PROPOSTA: dar dono a uma parcela dá dono a todas as parcelas daquela proposta, inclusive as futuras. As linhas de uma proposta com mais de uma parcela no mês vêm marcadas.`
            : `Cada linha é um evento único (uma proposta/conta). Valores da competência ${competencia}.`}
        </p>
        {itens.length === 0 ? (
          <EmptyState
            title={`Nenhuma linha de ${titulo.toLowerCase()} na fila.`}
            description="Se acabou de importar, use “Sincronizar fila”."
          />
        ) : (
          <>
            <p className="hintline">
              Comissão da empresa <b>{money(soma.empresa)}</b>
              {podeVerRepasse ? (
                <>
                  {" "}
                  · repasse do promotor <b>{money(soma.promotor)}</b>
                </>
              ) : null}
              {porProposta ? (
                <>
                  {" "}
                  · gestor <b>{money(soma.gestor)}</b>
                </>
              ) : null}
              {semDetalhe > 0 ? ` · ${semDetalhe} sem lançamento em ${competencia}` : ""}
            </p>
            <Table scrollable minWidth={640 + cols.length * 90} cards>
              <thead>
                <tr>
                  <th className="rr-sticky-col">{idLabel}</th>
                  {cols.map((c) => (
                    <th key={c.th} className={c.cls?.includes("num") ? "num" : undefined}>
                      {c.th}
                    </th>
                  ))}
                  <th>Status</th>
                  <th>Quem vendeu</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it) => (
                  <tr
                    key={it.id}
                    className={it.beneficiario_kind === "gestao" ? "gestaorow" : undefined}
                  >
                    {/* idLabel e VARIAVEL (muda por escopo), entao o data-l e a
                        MESMA expressao do th — nao um literal que sairia do ar. */}
                    <td className="rr-sticky-col idn" data-l={idLabel}>
                      {it.operation_number}
                      {it.balde ? (
                        <>
                          {" "}
                          <Chip variant="neutral">S/ IDENTIFICAÇÃO</Chip>
                        </>
                      ) : null}
                      {/* A proposta tem outra parcela NESTA tela: atribuir aqui move
                          as duas. O aviso vem antes do clique, nao depois. */}
                      {it.mesma_proposta ? (
                        <>
                          {" "}
                          <Chip variant="warn">{it.parcela_total} PARCELAS</Chip>
                        </>
                      ) : null}
                      {it.sem_lancamento ? (
                        <>
                          {" "}
                          <Chip variant="neutral">SEM LANÇAMENTO</Chip>
                        </>
                      ) : null}
                    </td>
                    {cols.map((c) => (
                      <td
                        key={c.th}
                        className={`${c.cls ?? ""}${it.detalhe ? "" : " sem"}`.trim() || undefined}
                        data-l={c.th}
                      >
                        {c.get(it)}
                      </td>
                    ))}
                    <td data-l="Status">
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
                    <td data-l="Quem vendeu">
                      <select
                        className="rowsel"
                        value={it.beneficiario_value}
                        disabled={busy === it.id}
                        onChange={(e) => atribuir(it, e.target.value)}
                        aria-label={`Quem vendeu ${it.operation_number}`}
                      >
                        {/* "balde" nao dizia para ONDE ia o dinheiro. Linha sem
                            dono fica 100% com a empresa — quem confere precisa
                            ler isso no proprio campo, nao deduzir. */}
                        <option value="">— sem dono · fica com a empresa —</option>
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
          </>
        )}
      </Card>
    );
  };


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
          <br />
          Linha <b>sem dono não é erro</b>: a comissão dela fica <b>100% com a empresa</b>. O valor
          não se perde — só não é repassado a ninguém. Atribuir é o que decide para onde ele vai.
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
            {soConsorcio ? null : renderGrupo("BBCAP", "BBCAP", g?.bbcap ?? [], "Proposta")}
            {soConsorcio ? null : renderGrupo("Conta Corrente", "CONTA_CORRENTE", g?.conta_corrente ?? [], "Conta")}
            {renderGrupo("Consórcio · parcelas do mês", "CONSORCIO", g?.consorcio ?? [], "Proposta")}
            {/* SEPARADO DE PROPOSITO. Estas âncoras não são buraco no dado: são
                propostas de competências anteriores cuja parcela deste mês não
                veio. Continuam atribuíveis — a atribuição vale para quando vier.
                Misturadas com as parcelas reais, pareceriam linhas faltando. */}
            {(g?.consorcio_sem_lancamento?.length ?? 0) > 0
              ? renderGrupo(
                  `Consórcio · sem lançamento em ${data?.competencia ?? "—"}`,
                  "CONSORCIO",
                  g?.consorcio_sem_lancamento ?? [],
                  "Proposta"
                )
              : null}
          </div>
        )}
      </main>
    </div>
  );
}
