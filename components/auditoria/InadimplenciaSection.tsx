"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  Button,
  Card,
  Chip,
  HeaderNavy,
  KpiBand,
  Num,
  Table,
  type ChipVariant,
} from "@/components/ui";
import { prtStatusLabel } from "@/lib/auditoria/prtStatusLabel";

// ============================================================
// MONITOR DE INADIMPLÊNCIA PRT — Camada 4: seção da Auditoria.
// Lista acionável (e exportável) da fila de PRT interrompido não cobrado,
// lida de prt_inadimplencia_monitor via /api/auditoria/inadimplencia. Usa os
// primitivos navy do kit (HeaderNavy + KpiBand + Card + Table/Num + Chip +
// Banner). socio-only (guard na rota GET e na rota de escrita).
//
// Fatia A — filtro/agrupamento por "parou em" (ultimo_mes_pago), 100% client.
// Fatia B — RESOLUÇÃO MANUAL (SOLUCIONADO): o sócio marca um contrato como
// resolvido (1 clique, sem motivo). Ele SAI da fila principal e vai pra aba
// "Solucionados" (mesma tabela, filtrada por resolucao_status; registro NÃO é
// movido nem apagado) e SAI do "Recuperável aberto". "Reabrir" volta pra fila.
// Escreve via POST /api/auditoria/inadimplencia/resolver. Como toda a seção já
// é socio-only (GET 403 p/ não-sócio), o botão só aparece pra sócio.
// O filtro "parou em" (Fatia A) opera sobre a fila principal (não-solucionados).
// ============================================================

type FilaItem = {
  status_acompanhamento: string;
  operation_number: string;
  company_cnpj: string | null;
  status: string;
  parcelas_pagas: number;
  parcelas_total: number;
  ultimo_mes_pago: string | null;
  meses_parado: number | null;
  recuperavel_estimado: number;
  primeira_deteccao: string;
  resolucao_status: string;
  resolucao_por: string | null;
  resolucao_em: string | null;
};

type Payload = {
  competencia: string | null;
  competencias: string[];
  fila: FilaItem[];
  agregados: {
    novo: number;
    emCobranca: number;
    recuperado: number;
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
function dataHora(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// status_acompanhamento → Chip. NOVO = risco (ação pendente), EM_COBRANCA =
// âmbar (em andamento), RECUPERADO = ok, RESSURGIU = risco, BAIXADO = neutro.
const ACOMP: Record<string, { variant: ChipVariant; label: string }> = {
  NOVO: { variant: "risk", label: "A cobrar" },
  AGUARDANDO_EXPLICACAO: { variant: "warn", label: "Aguardando explicação" },
  EM_COBRANCA: { variant: "warn", label: "Em cobrança" },
  RECUPERADO: { variant: "ok", label: "Recuperado" },
  RESSURGIU: { variant: "risk", label: "Ressurgiu" },
  BAIXADO: { variant: "neutral", label: "Baixado" },
  JUSTIFICADO: { variant: "neutral", label: "Justificado" },
};
function acomp(s: string) {
  return ACOMP[s] ?? { variant: "neutral" as ChipVariant, label: s };
}


// Fases exportáveis: A_COBRAR (status NOVO) vão pra cobrança direta;
// AGUARDANDO_EXPLICACAO (≥12 parcelas) vão pra questionamento; TODOS = a fila inteira.
type ExportFase = "NOVO" | "AGUARDANDO_EXPLICACAO" | "TODOS";
const EXPORT_SLUG: Record<ExportFase, string> = {
  NOVO: "a-cobrar",
  AGUARDANDO_EXPLICACAO: "aguardando-explicacao",
  TODOS: "todos",
};

function exportCsv(comp: string | null, fila: FilaItem[], fase: ExportFase, parouEm?: string) {
  const rows =
    fase === "TODOS" ? fila : fila.filter((r) => r.status_acompanhamento === fase);
  if (rows.length === 0) return;

  const header = [
    "operacao",
    "parcelas_pagas",
    "parcelas_total",
    "parou_em",
    "meses_parado",
    "recuperavel_estimado",
    "primeira_deteccao",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.operation_number,
      r.parcelas_pagas,
      r.parcelas_total,
      r.ultimo_mes_pago ?? "",
      r.meses_parado ?? "",
      // número com vírgula decimal pra abrir limpo no Excel pt-BR.
      String(r.recuperavel_estimado.toFixed(2)).replace(".", ","),
      r.primeira_deteccao,
    ]
      .map(esc)
      .join(";"),
  );
  // ";" como separador (Excel pt-BR) + BOM pra acentos saírem certos.
  const csv = "﻿" + [header.join(";"), ...lines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inadimplencia-prt-${EXPORT_SLUG[fase]}-${comp ?? "atual"}${parouEm ? `-parou-${parouEm}` : ""}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type Aba = "fila" | "solucionados";

export default function InadimplenciaSection() {
  const [selectedComp, setSelectedComp] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Fatia A — filtro/agrupamento por "parou em" (ultimo_mes_pago). 100% client-side.
  const [parouEm, setParouEm] = useState(""); // "" = todos os meses de parada
  const [agrupar, setAgrupar] = useState(false);
  // Fatia B — aba fila/solucionados + estado das ações por linha.
  const [aba, setAba] = useState<Aba>("fila");
  // operation_number em trânsito (marcar/reabrir) → desabilita o botão da linha.
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(
    (comp: string, opts?: { silent?: boolean }) => {
      let cancel = false;
      if (!opts?.silent) setLoading(true);
      setError("");
      const qs = comp ? `?competencia=${encodeURIComponent(comp)}` : "";
      fetch(`/api/auditoria/inadimplencia${qs}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar a inadimplência."))))
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
    },
    [],
  );

  useEffect(() => load(selectedComp), [selectedComp, load]);

  const ag = data?.agregados;
  const fila = useMemo(() => data?.fila ?? [], [data]);
  const compValue = selectedComp || data?.competencia || "";

  // Fatia B — fila principal = tudo que NÃO está solucionado. Solucionados = a aba.
  const filaPrincipal = useMemo(
    () => fila.filter((r) => r.resolucao_status !== "SOLUCIONADO"),
    [fila],
  );
  const solucionadas = useMemo(
    () => fila.filter((r) => r.resolucao_status === "SOLUCIONADO"),
    [fila],
  );

  // Fatia A — o filtro "parou em" opera sobre a fila principal (não-solucionados).
  // Meses de parada distintos na fila principal (recentes primeiro) → seletor.
  const mesesParada = useMemo(() => {
    const set = new Set<string>();
    for (const r of filaPrincipal) if (r.ultimo_mes_pago) set.add(r.ultimo_mes_pago);
    return Array.from(set).sort().reverse();
  }, [filaPrincipal]);

  // Fila principal após o filtro "parou em" — base da tabela, totais e export da aba fila.
  const filaFiltrada = useMemo(
    () => (parouEm ? filaPrincipal.filter((r) => r.ultimo_mes_pago === parouEm) : filaPrincipal),
    [filaPrincipal, parouEm],
  );

  // Agrupamento por mês de parada (recentes primeiro), com subtotal por grupo.
  const grupos = useMemo(() => {
    const map = new Map<string, FilaItem[]>();
    for (const r of filaFiltrada) {
      const k = r.ultimo_mes_pago ?? "—";
      const arr = map.get(k);
      if (arr) arr.push(r);
      else map.set(k, [r]);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filaFiltrada]);

  const totalRecuperavel = useMemo(
    () => filaFiltrada.reduce((acc, r) => acc + r.recuperavel_estimado, 0),
    [filaFiltrada],
  );
  const nACobrar = useMemo(
    () => filaFiltrada.filter((r) => r.status_acompanhamento === "NOVO").length,
    [filaFiltrada],
  );
  const nAguardando = useMemo(
    () => filaFiltrada.filter((r) => r.status_acompanhamento === "AGUARDANDO_EXPLICACAO").length,
    [filaFiltrada],
  );

  // Marca / reabre e recarrega em silêncio (não pisca a tela inteira).
  const resolver = useCallback(
    async (op: string, reabrir: boolean) => {
      const comp = data?.competencia;
      if (!comp) return;
      setBusy(op);
      setActionError("");
      try {
        const res = await fetch("/api/auditoria/inadimplencia/resolver", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ competencia: comp, operation_number: op, reabrir }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || "Falha ao atualizar a resolução.");
        }
        load(selectedComp, { silent: true });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Falha ao atualizar.");
      } finally {
        setBusy(null);
      }
    },
    [data?.competencia, selectedComp, load],
  );

  const renderRow = (r: FilaItem) => {
    const a = acomp(r.status_acompanhamento);
    return (
      <tr key={r.operation_number}>
        <td className="mono">{r.operation_number}</td>
        <td>{prtStatusLabel(r.status)}</td>
        <Num>
          {r.parcelas_pagas}/{r.parcelas_total}
        </Num>
        <td>{compLabel(r.ultimo_mes_pago)}</td>
        <Num>{r.meses_parado ?? "—"}</Num>
        <Num>{brl2(r.recuperavel_estimado)}</Num>
        <td>
          <Chip variant={a.variant}>{a.label}</Chip>
        </td>
        <td>
          <button
            type="button"
            className="inad-mark"
            onClick={() => resolver(r.operation_number, false)}
            disabled={busy === r.operation_number}
            title="Marcar como solucionado — sai da fila e do recuperável"
          >
            {busy === r.operation_number ? "…" : "Marcar solucionado"}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <section className="inad">
      <HeaderNavy
        brand="MONITOR PRT"
        title="Inadimplência — fila de cobrança"
        subtitle="Contratos que pararam antes de quitar → parcela vencida não paga → R$ a cobrar."
        actions={
          <div className="comp">
            <select
              aria-label="Competência da inadimplência"
              value={compValue}
              onChange={(e) => {
                setSelectedComp(e.target.value);
                setParouEm("");
                setAba("fila");
              }}
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
          columns={5}
          valueSize={26}
          items={[
            {
              label: "Na fila (novos)",
              value: ag ? String(ag.novo) : "—",
              sub: "aguardando cobrança",
              accent: true,
            },
            {
              label: "Recuperável aberto",
              value: ag ? brl2(ag.recuperavelAberto) : "—",
              sub: "exclui solucionados",
              subTone: "gold",
            },
            {
              label: "Já em cobrança",
              value: ag ? String(ag.emCobranca) : "—",
              sub: "enviados à Promotiva",
            },
            {
              label: "Recuperado",
              value: ag ? String(ag.recuperado) : "—",
              sub: "voltou a pagar",
              subTone: "ok",
            },
            {
              label: "Solucionado",
              value: ag ? String(ag.solucionado.contagem) : "—",
              sub: ag ? `${brl2(ag.solucionado.valor)} resolvidos` : "resolvidos pelo sócio",
              subTone: "amber",
            },
          ]}
        />
      </HeaderNavy>

      <Banner variant="info">
        Lista de <b>PRT interrompido não cobrado</b>, detectada automaticamente a cada
        fechamento. À vista e PRT são cobranças <b>complementares</b> — esta fila cobre só a
        parte PRT que parou e ainda não entrou em nenhuma cobrança emitida. O{" "}
        <b>recuperável</b> são <b>parcelas já vencidas e não pagas</b> — não inclui o diferido
        futuro do contrato. <b>Solucionar</b> tira o contrato da fila e do recuperável (resolvido
        = não é mais a cobrar); nada é apagado — fica na aba <b>Solucionados</b>.
      </Banner>

      {error ? <Banner variant="warn">{error}</Banner> : null}
      {actionError ? <Banner variant="warn">{actionError}</Banner> : null}

      <Card title={`Fila ${compLabel(data?.competencia ?? null)}`}>
        <div className="inad-tabs">
          <button
            type="button"
            className={"inad-tab" + (aba === "fila" ? " inad-tab--on" : "")}
            onClick={() => setAba("fila")}
          >
            Fila ({filaPrincipal.length})
          </button>
          <button
            type="button"
            className={"inad-tab" + (aba === "solucionados" ? " inad-tab--on" : "")}
            onClick={() => setAba("solucionados")}
          >
            Solucionados ({solucionadas.length})
          </button>
        </div>

        {aba === "fila" ? (
          <>
            <div className="inad-filtros">
              <label className="inad-filtros__grp">
                <span className="inad-filtros__lbl">Parou em:</span>
                <div className="comp comp--light">
                  <select
                    aria-label="Filtrar por mês de parada"
                    value={parouEm}
                    onChange={(e) => setParouEm(e.target.value)}
                  >
                    <option value="">Todos ({filaPrincipal.length})</option>
                    {mesesParada.map((m) => (
                      <option key={m} value={m}>
                        {compLabel(m)} ({filaPrincipal.filter((r) => r.ultimo_mes_pago === m).length})
                      </option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </div>
              </label>
              <label className="inad-toggle">
                <input
                  type="checkbox"
                  checked={agrupar}
                  onChange={(e) => setAgrupar(e.target.checked)}
                />
                <span>Agrupar por mês de parada</span>
              </label>
            </div>

            <div className="inad-toolbar">
              <span className="inad-toolbar__lbl">
                Exportar CSV{parouEm ? ` · parou em ${compLabel(parouEm)}` : ""}:
              </span>
              <Button
                variant="secundario"
                onClick={() => exportCsv(data?.competencia ?? null, filaFiltrada, "NOVO", parouEm)}
                disabled={nACobrar === 0}
                title={nACobrar === 0 ? "Nada a cobrar neste recorte" : "CSV dos A_COBRAR (cobrança direta)"}
              >
                A cobrar ({nACobrar})
              </Button>
              <Button
                variant="secundario"
                onClick={() => exportCsv(data?.competencia ?? null, filaFiltrada, "AGUARDANDO_EXPLICACAO", parouEm)}
                disabled={nAguardando === 0}
                title={nAguardando === 0 ? "Nada aguardando explicação" : "CSV dos ≥12 parcelas (pedido de explicação)"}
              >
                Aguardando explicação ({nAguardando})
              </Button>
              <Button
                variant="secundario"
                onClick={() => exportCsv(data?.competencia ?? null, filaFiltrada, "TODOS", parouEm)}
                disabled={filaFiltrada.length === 0}
                title={filaFiltrada.length === 0 ? "Recorte vazio" : "CSV do recorte inteiro"}
              >
                Todos ({filaFiltrada.length})
              </Button>
            </div>
            {loading ? (
              <p className="inad-empty">Carregando…</p>
            ) : filaPrincipal.length === 0 ? (
              <p className="inad-empty">
                Nenhum PRT interrompido não cobrado em aberto nesta competência. Fila limpa.
              </p>
            ) : filaFiltrada.length === 0 ? (
              <p className="inad-empty">
                Nenhum contrato parou em {compLabel(parouEm)} nesta competência.
              </p>
            ) : (
              <Table scrollable>
                <thead>
                  <tr>
                    <th>Operação</th>
                    <th>Status</th>
                    <th>Parcelas</th>
                    <th>Parou em</th>
                    <th>Meses parado</th>
                    <th style={{ textAlign: "right" }}>Recuperável</th>
                    <th>Acompanhamento</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {agrupar
                    ? grupos.map(([mes, rows]) => {
                        const sub = rows.reduce((s, r) => s + r.recuperavel_estimado, 0);
                        return (
                          <Fragment key={mes}>
                            <tr className="inad-grp">
                              <td colSpan={5}>
                                Parou em {compLabel(mes === "—" ? null : mes)} · {rows.length} contrato(s)
                              </td>
                              <Num>{brl2(sub)}</Num>
                              <td colSpan={2} />
                            </tr>
                            {rows.map(renderRow)}
                          </Fragment>
                        );
                      })
                    : filaFiltrada.map(renderRow)}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>
                      {filaFiltrada.length} contrato(s){parouEm ? ` · parou em ${compLabel(parouEm)}` : " na fila"}
                    </td>
                    <Num>{brl2(totalRecuperavel)}</Num>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </Table>
            )}
          </>
        ) : loading ? (
          <p className="inad-empty">Carregando…</p>
        ) : solucionadas.length === 0 ? (
          <p className="inad-empty">
            Nenhum contrato solucionado nesta competência.
          </p>
        ) : (
          <Table scrollable>
            <thead>
              <tr>
                <th>Operação</th>
                <th>Status</th>
                <th>Parcelas</th>
                <th>Parou em</th>
                <th style={{ textAlign: "right" }}>Recuperável</th>
                <th>Resolvido por</th>
                <th>Quando</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {solucionadas.map((r) => (
                <tr key={r.operation_number}>
                  <td className="mono">{r.operation_number}</td>
                  <td>{prtStatusLabel(r.status)}</td>
                  <Num>
                    {r.parcelas_pagas}/{r.parcelas_total}
                  </Num>
                  <td>{compLabel(r.ultimo_mes_pago)}</td>
                  <Num>{brl2(r.recuperavel_estimado)}</Num>
                  <td>{r.resolucao_por ?? "—"}</td>
                  <td>{dataHora(r.resolucao_em)}</td>
                  <td>
                    <button
                      type="button"
                      className="inad-reopen"
                      onClick={() => resolver(r.operation_number, true)}
                      disabled={busy === r.operation_number}
                      title="Reabrir — volta pra fila e ao recuperável"
                    >
                      {busy === r.operation_number ? "…" : "Reabrir"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{solucionadas.length} contrato(s) solucionado(s)</td>
                <Num>{brl2(solucionadas.reduce((s, r) => s + r.recuperavel_estimado, 0))}</Num>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      <style
        dangerouslySetInnerHTML={{
          __html: `
.inad{display:flex;flex-direction:column;gap:18px;}
.inad .comp{position:relative;}
.inad .comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 36px 8px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.inad .comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.inad .comp .chev{position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9DA9C6;font-size:11px;}
.inad .inad-toolbar{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;}
.inad .inad-toolbar__lbl{font-size:12px;color:var(--ink-3);margin-right:2px;}
.inad .inad-empty{font-size:13.5px;color:var(--ink-3);margin:4px 0;}
.inad .inad-filtros{display:flex;align-items:center;gap:18px;margin-bottom:12px;flex-wrap:wrap;}
.inad .inad-filtros__grp{display:flex;align-items:center;gap:8px;}
.inad .inad-filtros__lbl{font-size:12.5px;font-weight:600;color:var(--ink-2);}
.inad .comp--light{position:relative;}
.inad .comp--light select{appearance:none;-webkit-appearance:none;background:#fff;border:1px solid var(--bd);color:var(--ink-1);padding:7px 32px 7px 12px;border-radius:8px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.inad .comp--light select:focus{outline:none;border-color:var(--gold);}
.inad .comp--light .chev{position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--ink-3);font-size:11px;}
.inad .inad-toggle{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-2);cursor:pointer;user-select:none;}
.inad .inad-toggle input{accent-color:var(--gold);width:15px;height:15px;cursor:pointer;}
.inad .inad-grp td{background:rgba(214,161,63,.10);font-weight:700;font-size:12.5px;color:var(--ink-1);border-top:2px solid rgba(214,161,63,.35);}
.inad .inad-tabs{display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--bd);}
.inad .inad-tab{appearance:none;background:none;border:none;border-bottom:2px solid transparent;color:var(--ink-3);font-family:inherit;font-size:13px;font-weight:600;padding:8px 12px;margin-bottom:-1px;cursor:pointer;}
.inad .inad-tab:hover{color:var(--ink-2);}
.inad .inad-tab--on{color:var(--navy);border-bottom-color:var(--gold);}
.inad .inad-mark{appearance:none;background:var(--navy);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .15s;}
.inad .inad-mark:hover{background:#16285C;}
.inad .inad-mark[disabled]{opacity:.5;cursor:default;}
.inad .inad-reopen{appearance:none;background:#fff;color:var(--ink-2);border:1px solid var(--bd);border-radius:8px;padding:6px 12px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:border-color .15s,color .15s;}
.inad .inad-reopen:hover{border-color:var(--gold);color:var(--navy);}
.inad .inad-reopen[disabled]{opacity:.5;cursor:default;}
`,
        }}
      />
    </section>
  );
}
