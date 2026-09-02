"use client";

// F6b sub-fase 3 — Tela de upload + revisão + GRAVAÇÃO versionada da TRP.
//
// F6b.2 (base): consome /api/trp/parse (read-only) e renderiza a revisão.
// F6b.3 (agora):
//   - Sócio: "Confirmar e gravar" chama /api/trp/commit (grava a versão viva).
//     Como as leituras são ao vivo, os Recebíveis já refletem a nova TRP.
//   - Todos (socio+funcionario): "Salvar rascunho" chama /api/trp/staging.
//   - Sócio: caixa "Rascunhos pendentes" (inbox) — abre um rascunho, revisa e confirma.
// Só o sócio vê confirmar e a inbox; o funcionário só salva rascunho.
//
// FASE 3 (01/09/2026) — a data de início que vem de FORA do PDF.
// A TRP39 passou a valer em 05/08/2026 e essa data só existe no e-mail da
// Promotiva: nunca vai estar no documento. O campo abaixo é a única porta por
// onde ela entra, e por isso ele nasce FECHADO — o caminho normal é não tocar
// nele, e 100% das réguas até hoje foram assim. Aberto, ele mostra a janela
// derivada e diz, em português, o que vai acontecer com a régua que já está
// viva: ela é TRUNCADA e CONTINUA ATIVA, não é substituída.
// O funcionário pode preencher no rascunho (rascunho não é régua); quem grava é
// o sócio, e a revisão dele mostra a data EM DESTAQUE justamente porque ela é o
// único campo da tela que não veio do PDF.

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Banner, Chip } from "@/components/ui";
import {
  deveAvisarSubstituicao,
  fatiaQueSeriaSubstituida,
  type FatiaAtiva,
} from "@/lib/trp/avisoRascunhoSubstitui";

const FAIXA_LABELS = ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5", "pct_geral"];

type Confianca = {
  provado: { totalPct: number; produtos: Record<string, number[][]> };
  conferir: { produto: string; campo: string; valorLido: string | null; motivo: string; severidade?: "conferir" | "informativo" }[];
};
type ParseMeta = {
  competencia: string;
  regime: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  source_filename: string | null;
  sha256?: string | null;
  trp_doc_ref?: string | null;
  parser_version: string;
  n_lines: number;
};
type ParseOk = {
  regraDraft: Record<string, unknown>;
  meta: ParseMeta;
  confianca: Confianca;
  diff: {
    // A base do diff: a fatia ATIVA da PRÓPRIA competência quando já há régua
    // (`origem: "propria"`), senão a última da anterior (`"anterior"`). O nome
    // do campo continua `anterior` por compatibilidade do shape.
    anterior:
      | {
          competencia: string;
          version_no: number;
          valid_from?: string;
          valid_until?: string;
          regra_json: unknown;
          origem?: "propria" | "anterior";
        }
      | null;
  };
  /** Só vem do staging (/api/trp/staging/[id]); o parse do PDF nunca traz. */
  validFromOverride?: string | null;
  /** Fatias ATIVAS da competência (só do staging). Vazio = mês sem régua ainda. */
  fatiasAtivas?: FatiaAtiva[];
};
type PendItem = {
  id: string;
  competencia: string; // "YYYY-MM-DD"
  source_filename: string | null;
  parser_version: string | null;
  uploaded_at: string;
  /** Fase 3: início de vigência informado por fora do PDF (parte a competência). */
  valid_from_override?: string | null;
};

function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === "string" ? resolve(r.result.split(",")[1]) : reject(new Error("falha ao ler arquivo")));
    r.onerror = () => reject(new Error("erro ao ler arquivo"));
    r.readAsDataURL(f);
  });
}

const pctFmt = (v: number) => `${(v * 100).toFixed(2).replace(".", ",")}%`;

/** dd/mm a partir de "YYYY-MM-DD" — só para o texto do efeito. */
const dm = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/** Dia anterior em ISO. Espelha subtraiUmDia do servidor (é onde a fatia atual passa a terminar). */
function diaAnterior(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Dia seguinte em ISO — o primeiro valor ACEITÁVEL de override (o `>` estrito do servidor). */
function diaSeguinte(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// valores de pct do JSON canônico anterior, achatados por produto (p/ diff).
function anteriorVals(regraJson: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!regraJson || typeof regraJson !== "object") return out;
  for (const [k, prod] of Object.entries(regraJson as Record<string, any>)) {
    if (k === "_meta" || !prod || typeof prod !== "object") continue;
    const cellKey = ["celulas_taxa", "celulas_prazo", "celulas_taxa_prazo", "celulas"].find((c) => prod[c]);
    const vals: number[] = [];
    if (cellKey) for (const cel of prod[cellKey]) for (const fk of FAIXA_LABELS) if (cel[fk] !== undefined) vals.push(cel[fk]);
    else if (prod.pct_geral !== undefined) vals.push(prod.pct_geral);
    if (vals.length) out[k] = vals;
  }
  return out;
}

export default function TrpUploadReview({ canConfirm }: { canConfirm: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [competencia, setCompetencia] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<{ msg: string; detalhe?: string | null } | null>(null);
  const [result, setResult] = useState<ParseOk | null>(null);

  // F6b.3 — gravação/staging
  const [currentUploadId, setCurrentUploadId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<{ msg: string; detalhe?: string | null } | null>(null);
  // Peca 4 (elo TRP->recalculo): competencias FECHADAS que a regua recem-gravada
  // desalinhou. So OFERTA — link pro card de reconsolidacao (?reconsolidar=YYYY-MM).
  const [oferta, setOferta] = useState<Array<{ year: number; month: number }> | null>(null);
  const [pendentes, setPendentes] = useState<PendItem[]>([]);
  const [loadingPend, setLoadingPend] = useState(false);
  // FASE 3 — o override. Nasce FECHADO: o caminho normal e' nao tocar aqui.
  const [overrideOn, setOverrideOn] = useState(false);
  const [overrideData, setOverrideData] = useState("");
  // Guarda o que veio do STAGING, para a revisao do socio poder dizer "esta data
  // foi informada por quem salvou o rascunho" em vez de fingir que ele digitou.
  const [overrideDoRascunho, setOverrideDoRascunho] = useState<string | null>(null);
  // Fatias ATIVAS da competência do rascunho aberto — vêm do staging, porque é
  // estado do BANCO. Decide se o aviso de substituição aparece.
  const [fatiasAtivas, setFatiasAtivas] = useState<FatiaAtiva[]>([]);

  const anterior = useMemo(() => (result?.diff.anterior ? anteriorVals(result.diff.anterior.regra_json) : null), [result]);

  const loadPendentes = useCallback(async () => {
    if (!canConfirm) return; // inbox é só do sócio
    setLoadingPend(true);
    try {
      const resp = await fetch("/api/trp/staging?status=pendente");
      const json = await resp.json();
      if (resp.ok) setPendentes(Array.isArray(json.pendentes) ? json.pendentes : []);
    } catch {
      /* silencioso — inbox é auxiliar */
    } finally {
      setLoadingPend(false);
    }
  }, [canConfirm]);

  useEffect(() => {
    loadPendentes();
  }, [loadPendentes]);

  async function onEnviar() {
    if (!file || !competencia) return;
    setLoading(true);
    setErro(null);
    setResult(null);
    setActionMsg(null);
    setActionErr(null);
    setCurrentUploadId(null); // upload fresco: não é rascunho da inbox
    // upload fresco zera o override: ele NUNCA vem do PDF, então não pode
    // sobreviver de uma revisão anterior e entrar caladamente na próxima régua.
    setOverrideOn(false);
    setOverrideData("");
    setOverrideDoRascunho(null);
    setFatiasAtivas([]);
    try {
      const base64 = await fileToBase64(file);
      const resp = await fetch("/api/trp/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: base64, fileName: file.name, competencia }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setErro({ msg: json.error || "não consegui ler este PDF", detalhe: json.detalhe });
        return;
      }
      setResult(json as ParseOk);
    } catch (e) {
      setErro({ msg: "falha ao enviar o PDF", detalhe: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function onAbrirRascunho(id: string) {
    setLoading(true);
    setErro(null);
    setActionMsg(null);
    setActionErr(null);
    try {
      const resp = await fetch(`/api/trp/staging/${id}`);
      const json = await resp.json();
      if (!resp.ok) {
        setActionErr({ msg: json.error || "não consegui abrir o rascunho", detalhe: json.detalhe });
        return;
      }
      const parsed = json as ParseOk;
      setResult(parsed);
      setCurrentUploadId(id);
      // O override do rascunho reabre o campo JÁ preenchido — se ele ficasse
      // escondido, o sócio confirmaria uma competência partida sem ver a data
      // que a parte.
      const ov = parsed.validFromOverride ?? null;
      setFatiasAtivas(parsed.fatiasAtivas ?? []);
      setOverrideDoRascunho(ov);
      setOverrideOn(!!ov);
      setOverrideData(ov ?? "");
    } catch (e) {
      setActionErr({ msg: "falha ao abrir o rascunho", detalhe: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  /**
   * O que vai no corpo: a data só quando a caixa está marcada E preenchida.
   * Caixa desmarcada manda null EXPLÍCITO — é o que apaga um override que o
   * rascunho tinha e o sócio decidiu não usar.
   */
  const overrideEnviado = overrideOn && overrideData ? overrideData : null;

  async function onSalvarRascunho() {
    if (!result) return;
    setSaving(true);
    setActionMsg(null);
    setActionErr(null);
    try {
      const resp = await fetch("/api/trp/staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencia: result.meta.competencia,
          regraDraft: result.regraDraft,
          confianca: result.confianca,
          meta: result.meta,
          validFromOverride: overrideEnviado,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setActionErr({ msg: json.error || "não consegui salvar o rascunho", detalhe: json.detalhe });
        return;
      }
      setActionMsg(
        canConfirm
          ? `Rascunho de ${result.meta.competencia} salvo. Você pode confirmar agora ou revisar depois pela caixa de rascunhos.`
          : `Rascunho de ${result.meta.competencia} salvo — o sócio vai revisar e confirmar. Nada foi gravado ainda.`,
      );
      loadPendentes();
    } catch (e) {
      setActionErr({ msg: "falha ao salvar o rascunho", detalhe: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmar() {
    if (!result) return;
    setCommitting(true);
    setActionMsg(null);
    setActionErr(null);
    setOferta(null);
    try {
      // DELEGADO: só o uploadId. O override NÃO vai no corpo de propósito — o
      // servidor lê da LINHA do staging (mesma invariante do regraDraft). Se o
      // sócio mudou a data aqui, ele salva o rascunho antes de confirmar.
      const body = currentUploadId
        ? { uploadId: currentUploadId }
        : {
            regraDraft: result.regraDraft,
            meta: result.meta,
            validFromOverride: overrideEnviado,
          };
      const resp = await fetch("/api/trp/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setActionErr({ msg: json.error || "não consegui gravar a TRP", detalhe: json.detalhe });
        return;
      }
      setActionMsg(
        `TRP de ${result.meta.competencia} gravada — versão ${json.version_no}. ` +
          `As leituras são ao vivo: os Recebíveis já usam a nova TRP.`,
      );
      // OFERTA (não execução): se a régua desalinhou competências fechadas, o
      // servidor devolve a lista; renderizamos o link pro card. Ausente => sem oferta.
      setOferta(
        Array.isArray(json.competencias_fechadas_afetadas) &&
          json.competencias_fechadas_afetadas.length > 0
          ? json.competencias_fechadas_afetadas
          : null,
      );
      setCurrentUploadId(null);
      loadPendentes();
    } catch (e) {
      setActionErr({ msg: "falha ao gravar a TRP", detalhe: e instanceof Error ? e.message : String(e) });
    } finally {
      setCommitting(false);
    }
  }

  const busy = saving || committing;

  return (
    <section className="trp-up">
      <header className="trp-up__head">
        <div className="tt">
          <span className="badge">TRP</span>
          <div>
            <h3>TRP do mês (Promotiva)</h3>
            <p className="sub">Suba o PDF oficial; o servidor lê e você confere antes de {canConfirm ? "gravar" : "salvar o rascunho"}.</p>
          </div>
        </div>
        <Chip variant="neutral">upload + revisão + gravação</Chip>
      </header>

      {/* ---- inbox de rascunhos pendentes (só sócio) ---- */}
      {canConfirm ? (
        <div className="trp-inbox">
          <div className="trp-inbox__h">
            <span>Rascunhos pendentes</span>
            <Chip variant={pendentes.length ? "warn" : "ok"}>{loadingPend ? "…" : `${pendentes.length}`}</Chip>
          </div>
          {pendentes.length === 0 ? (
            <p className="trp-inbox__empty">Sem rascunhos aguardando confirmação.</p>
          ) : (
            <ul className="trp-inbox__list">
              {pendentes.map((p) => (
                <li key={p.id} className="trp-inbox__item">
                  <span className="ci">{String(p.competencia).slice(0, 7)}</span>
                  <span className="cf">
                    {p.source_filename || "sem nome"}
                    {p.valid_from_override ? (
                      <b className="cf__ov"> · parte o mês em {dm(p.valid_from_override)}</b>
                    ) : null}
                  </span>
                  <Button variant="secundario" onClick={() => onAbrirRascunho(p.id)} disabled={loading || busy}>
                    Abrir e revisar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* ---- upload ---- */}
      <div className="trp-up__form">
        <label className="fld">
          <span>Competência</span>
          <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} disabled={loading} />
        </label>
        <label className="fld fld--file">
          <span>PDF da TRP</span>
          <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={loading} />
        </label>
        <Button variant="primario" disabled={!file || !competencia || loading} onClick={onEnviar}>
          {loading ? "Lendo o PDF…" : "Enviar e revisar"}
        </Button>
      </div>

      {erro ? (
        <Banner variant="warn">
          <b>não consegui ler este PDF:</b> {erro.msg}
          {erro.detalhe ? <div className="det">{erro.detalhe}</div> : null}
          <div className="det">Confira o arquivo e tente de novo — nada foi gravado.</div>
        </Banner>
      ) : null}

      {/* ---- revisão ---- */}
      {result ? (
        <div className="trp-rev">
          <div className="trp-rev__meta">
            <span><b>{result.meta.competencia}</b> · {result.meta.regime}{currentUploadId ? " · rascunho pendente" : ""}</span>
            <span>vigência {result.meta.vigencia_inicio} → {result.meta.vigencia_fim}</span>
            <span>{result.meta.source_filename}{result.meta.n_lines ? ` · ${result.meta.n_lines} linhas` : ""} · {result.confianca.provado.totalPct} pct lidos</span>
          </div>

          {/* ---- FASE 3: início de vigência que NÃO veio do PDF ----
              Fechado por padrão. No fluxo DELEGADO (rascunho aberto da inbox) o
              campo é SÓ LEITURA e aparece em destaque: o servidor lê o override
              da LINHA do staging, então deixar editável aqui criaria a armadilha
              de o sócio mudar a data, confirmar, e o sistema usar a outra. */}
          {currentUploadId ? (
            deveAvisarSubstituicao({
              delegado: !!currentUploadId,
              overrideDoRascunho,
              fatiasAtivas,
            }) ? (
              (() => {
                const alvo = fatiaQueSeriaSubstituida(fatiasAtivas);
                return (
                  <Banner variant="warn">
                    <b>
                      Este rascunho NÃO parte {result.meta.competencia} — confirmar vai SUBSTITUIR a
                      régua que está valendo.
                    </b>
                    <div className="det">
                      {alvo ? (
                        <>
                          A régua ativa <b>v{alvo.version_no}</b> ({alvo.valid_from} a{" "}
                          {alvo.valid_until}) será <b>desativada</b>, e a régua deste PDF passa a
                          valer de <b>{result.meta.vigencia_inicio}</b> a{" "}
                          <b>{result.meta.vigencia_fim}</b> — o mês inteiro.{" "}
                        </>
                      ) : null}
                      Se era isso que você queria (re-upload corrigindo a régua do mês), pode
                      confirmar.
                    </div>
                    <div className="det">
                      <b>Se a intenção era PARTIR a competência</b>, não dá para acrescentar a data
                      aqui: o servidor grava o que está guardado no rascunho, não o que está na
                      tela. Suba o PDF de novo pelo formulário acima, marque{" "}
                      <b>&ldquo;Esta régua começa a valer em outra data&rdquo;</b>, informe a data e{" "}
                      <b>salve o rascunho</b> — aí ele substitui este, já com a data.
                    </div>
                  </Banner>
                );
              })()
            ) : overrideDoRascunho ? (
              <div className="trp-ov trp-ov--ro">
                <div className="trp-ov__t">
                  Este rascunho PARTE a competência em <b>{overrideDoRascunho}</b>
                </div>
                <p className="trp-ov__d">
                  Data informada por fora do PDF por quem salvou o rascunho — confira no e-mail da
                  Promotiva antes de gravar. A régua que hoje vale em {result.meta.competencia} será
                  truncada em <b>{diaAnterior(overrideDoRascunho)}</b> e <b>continua ativa</b>; a
                  régua deste PDF passa a valer de <b>{overrideDoRascunho}</b> a{" "}
                  <b>{result.meta.vigencia_fim}</b>. Para mudar a data, salve o rascunho de novo —
                  o que vale na gravação é o que está guardado, não o que está na tela.
                </p>
              </div>
            ) : null
          ) : (
            <div className={`trp-ov${overrideOn ? " trp-ov--on" : ""}`}>
              <label className="trp-ov__chk">
                <input
                  type="checkbox"
                  checked={overrideOn}
                  onChange={(e) => {
                    setOverrideOn(e.target.checked);
                    if (!e.target.checked) setOverrideData("");
                  }}
                  disabled={busy}
                />
                <span>Esta régua começa a valer em outra data (parte a competência)</span>
              </label>
              {overrideOn ? (
                <div className="trp-ov__body">
                  <label className="fld">
                    <span>Início da nova régua</span>
                    <input
                      type="date"
                      value={overrideData}
                      min={diaSeguinte(result.meta.vigencia_inicio)}
                      max={result.meta.vigencia_fim}
                      onChange={(e) => setOverrideData(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <p className="trp-ov__d">
                    Só preencha quando a data vier de FORA do PDF (o e-mail da Promotiva). A janela
                    padrão de {result.meta.competencia} é{" "}
                    <b>
                      {result.meta.vigencia_inicio} a {result.meta.vigencia_fim}
                    </b>
                    .{" "}
                    {overrideData ? (
                      <>
                        Com <b>{overrideData}</b>: a régua que hoje vale nesta competência será
                        truncada em <b>{diaAnterior(overrideData)}</b> e{" "}
                        <b>continua ativa</b> — a régua deste PDF vale de <b>{overrideData}</b> até{" "}
                        <b>{result.meta.vigencia_fim}</b>. Nada é substituído.
                      </>
                    ) : (
                      <>
                        A data tem de ser <b>posterior</b> a {result.meta.vigencia_inicio}: informar
                        o próprio {result.meta.vigencia_inicio} não parte nada (seria o re-upload de
                        sempre) e é recusado.
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <p className="trp-ov__d trp-ov__d--off">
                  Caminho normal: deixe fechado. A vigência sai da régua da casa —{" "}
                  {result.meta.vigencia_inicio} a {result.meta.vigencia_fim} — e o envio SUBSTITUI a
                  régua ativa da competência.
                </p>
              )}
            </div>
          )}

          {/* PROVADOS */}
          <h4 className="trp-rev__h">Percentuais lidos <Chip variant="ok">provado</Chip></h4>
          <div className="trp-grid">
            {Object.entries(result.confianca.provado.produtos).map(([prod, rows]) => {
              const ant = anterior?.[prod];
              let flatIdx = 0;
              return (
                <div className="pcard" key={prod}>
                  <div className="pcard__t">{prod}</div>
                  <table className="pt">
                    <tbody>
                      {rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((v, ci) => {
                            const prev = ant ? ant[flatIdx] : undefined;
                            const changed = prev !== undefined && prev !== v;
                            flatIdx++;
                            return (
                              <td key={ci} className={`num prov${changed ? " chg" : ""}`} title={changed ? `antes: ${pctFmt(prev as number)}` : undefined}>
                                {pctFmt(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>

          {/* CONFERIR — só os âmbar (severidade "conferir"; ausente = default âmbar).
              Os "informativo" (não afetam cálculo) saem do contador e vão pro bloco abaixo. */}
          {(() => {
            const ambar = result.confianca.conferir.filter((c) => c.severidade !== "informativo");
            const info = result.confianca.conferir.filter((c) => c.severidade === "informativo");
            return (
              <>
                <h4 className="trp-rev__h">Conferir contra o PDF <Chip variant="warn">{ambar.length} itens</Chip></h4>
                <ul className="trp-conf">
                  {ambar.map((c, i) => (
                    <li key={i} className="conf">
                      <span className="conf__k">{c.produto} · {c.campo}</span>
                      {c.valorLido ? <span className="conf__v">lido: {c.valorLido}</span> : <span className="conf__v conf__v--none">não lido</span>}
                      <span className="conf__m">{c.motivo}</span>
                    </li>
                  ))}
                </ul>

                {info.length > 0 ? (
                  <>
                    <h4 className="trp-rev__h">Informativo <Chip variant="neutral">não afeta cálculo</Chip></h4>
                    <ul className="trp-conf trp-conf--info">
                      {info.map((c, i) => (
                        <li key={i} className="conf conf--info">
                          <span className="conf__k">{c.produto} · {c.campo}</span>
                          {c.valorLido ? <span className="conf__v">lido: {c.valorLido}</span> : <span className="conf__v conf__v--none">opcional</span>}
                          <span className="conf__m">{c.motivo}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            );
          })()}

          {/* DIFF */}
          <h4 className="trp-rev__h">Mudanças vs TRP anterior</h4>
          {result.diff.anterior ? (
            <p className="trp-diff">
              {/* O rótulo diz a FATIA, não só a competência: numa competência
                  partida existem duas réguas ativas, e dizer só o mês faria o
                  texto mentir exatamente no caso novo. */}
              Comparando com{" "}
              <b>
                {result.diff.anterior.competencia} v{result.diff.anterior.version_no}
              </b>
              {result.diff.anterior.valid_from && result.diff.anterior.valid_until ? (
                <>
                  {" "}
                  ({result.diff.anterior.valid_from} a {result.diff.anterior.valid_until})
                </>
              ) : null}
              {result.diff.anterior.origem === "anterior" ? (
                <> — a competência ainda não tem régua própria, então a base é a do mês anterior</>
              ) : (
                <> — a régua que está valendo nesta competência</>
              )}
              . As células destacadas em <span className="chg-inline">amarelo</span> na grade acima
              mudaram de valor. Passe o mouse para ver o valor anterior.
            </p>
          ) : (
            <p className="trp-diff">Sem TRP anterior no banco — nada a comparar (primeira competência).</p>
          )}

          {/* MENSAGENS DE AÇÃO */}
          {actionMsg ? (
            <Banner variant="ok">
              <b>{actionMsg}</b>
              {actionMsg.includes("Recebíveis") ? (
                <div className="det">Abra os <a href="/recebiveis">Recebíveis</a> para conferir. O recálculo do derivado persistido e o badge de fallback são a próxima fase (F6b.4).</div>
              ) : null}
            </Banner>
          ) : null}
          {oferta ? (
            <Banner variant="warn">
              <b>
                A régua afeta {oferta.length} competência(s) FECHADA(s) — reconsolidar para alinhar o
                PMR à nova TRP.
              </b>
              <div className="det">
                Nada recalcula sozinho. Clique para abrir o card já na competência (depois Simular
                -&gt; Reconsolidar):{" "}
                {oferta.map((c, i) => (
                  <span key={`${c.year}-${c.month}`}>
                    {i > 0 ? ", " : ""}
                    <a
                      href={`/importacoes?reconsolidar=${c.year}-${String(c.month).padStart(2, "0")}`}
                    >
                      {String(c.month).padStart(2, "0")}/{c.year}
                    </a>
                  </span>
                ))}
              </div>
            </Banner>
          ) : null}
          {actionErr ? (
            <Banner variant="warn">
              <b>{actionErr.msg}</b>
              {actionErr.detalhe ? <div className="det">{actionErr.detalhe}</div> : null}
            </Banner>
          ) : null}

          {/* AÇÕES: salvar rascunho (todos) + confirmar (só sócio) */}
          <div className="trp-rev__act">
            {!currentUploadId ? (
              <Button variant="secundario" disabled={busy} onClick={onSalvarRascunho}>
                {saving ? "Salvando…" : "Salvar rascunho"}
              </Button>
            ) : null}
            {canConfirm ? (
              <>
                <Button variant="acao" disabled={busy} onClick={onConfirmar}>
                  {committing ? "Gravando…" : "Confirmar e gravar"}
                </Button>
                <span className="hint">Grava a versão viva da TRP. As leituras são ao vivo — os Recebíveis passam a usar a nova TRP na hora.</span>
              </>
            ) : (
              <span className="hint">Revisão do auxiliar — a <b>confirmação/gravação é do sócio</b>. Você salva o rascunho; ele confirma.</span>
            )}
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .trp-up { border: 1px solid var(--bd-soft, #e6e8ee); border-radius: 14px; background: #fff; padding: 18px; margin-bottom: 18px; }
        .trp-up__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .trp-up__head .tt { display: flex; gap: 12px; align-items: center; }
        .trp-up__head .badge { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 10px; background: #101a33; color: var(--accent, #fff000); font-weight: 700; font-size: 13px; }
        .trp-up__head h3 { margin: 0; font-size: 16px; color: #101a33; }
        .trp-up__head .sub { margin: 2px 0 0; font-size: 12.5px; color: #5b6472; }
        .trp-inbox { margin-top: 16px; border: 1px solid var(--bd-soft, #eef0f4); border-radius: 10px; background: #fafbfe; padding: 12px 14px; }
        .trp-inbox__h { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #101a33; margin-bottom: 8px; }
        .trp-inbox__empty { margin: 0; font-size: 12.5px; color: #5b6472; }
        .trp-inbox__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .trp-inbox__item { display: grid; grid-template-columns: 84px 1fr auto; gap: 10px; align-items: center; padding: 6px 8px; background: #fff; border: 1px solid var(--bd-soft, #eef0f4); border-radius: 8px; }
        .trp-inbox__item .ci { font-family: var(--font-mono), monospace; font-weight: 700; font-size: 12px; color: #101a33; }
        .trp-inbox__item .cf { font-size: 12px; color: #5b6472; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .trp-up__form { display: flex; align-items: flex-end; gap: 14px; margin-top: 16px; flex-wrap: wrap; }
        .fld { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #5b6472; }
        .fld span { font-weight: 600; }
        .fld input { height: 36px; border: 1px solid var(--bd-soft, #d7dbe3); border-radius: 8px; padding: 0 10px; font: inherit; }
        .fld--file input { padding: 6px; }
        .det { font-size: 12px; opacity: .85; margin-top: 4px; }
        .det a { color: #101a33; font-weight: 700; }
        .trp-rev { margin-top: 18px; border-top: 1px solid var(--bd-soft, #eef0f4); padding-top: 16px; }
        .trp-rev__meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12.5px; color: #5b6472; margin-bottom: 14px; }
        .trp-rev__h { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #101a33; margin: 18px 0 10px; }
        .trp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
        .pcard { border: 1px solid var(--bd-soft, #eef0f4); border-radius: 10px; overflow: hidden; }
        .pcard__t { background: #f6f8fc; padding: 6px 10px; font-size: 11.5px; font-weight: 700; color: #101a33; letter-spacing: .02em; }
        .pt { width: 100%; border-collapse: collapse; }
        .pt td.num { font-family: var(--font-mono), "IBM Plex Mono", ui-monospace, monospace; font-size: 11.5px; text-align: right; padding: 4px 8px; border-top: 1px solid #f1f3f7; font-variant-numeric: tabular-nums; }
        .pt td.prov { background: #f2fbf5; color: #14532d; }
        .pt td.chg { background: var(--accent, #fff000); color: #101a33; font-weight: 700; }
        .trp-conf { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .conf { display: grid; grid-template-columns: 220px auto 1fr; gap: 10px; align-items: baseline; padding: 8px 10px; border-radius: 8px; background: #fffdf0; border: 1px solid #f5e7a8; font-size: 12px; }
        .conf--info { background: #f6f8fc; border-color: #e6e8ee; }
        .conf--info .conf__k { color: #3b4657; }
        .conf--info .conf__v { color: #6b7280; }
        .conf--info .conf__m { color: #6b7280; }
        .conf__k { font-weight: 700; color: #101a33; }
        .conf__v { font-family: var(--font-mono), monospace; color: #7a5b00; }
        .conf__v--none { opacity: .6; }
        .conf__m { color: #6b6250; }
        .trp-ov { margin: 0 0 14px; border: 1px solid var(--bd-soft, #eef0f4); border-radius: 10px; background: #fafbfe; padding: 10px 12px; }
        .trp-ov--on { background: #fffdf0; border-color: #f5e7a8; }
        .trp-ov--ro { background: #fffdf0; border-color: #f5e7a8; }
        .trp-ov__chk { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: #101a33; cursor: pointer; }
        .trp-ov__chk input { width: 15px; height: 15px; }
        .trp-ov__t { font-size: 13px; color: #101a33; }
        .trp-ov__body { display: flex; align-items: flex-start; gap: 14px; margin-top: 10px; flex-wrap: wrap; }
        .trp-ov__d { margin: 6px 0 0; font-size: 12px; color: #5b6472; line-height: 1.5; max-width: 640px; }
        .trp-ov__d--off { opacity: .85; }
        .trp-inbox__item .cf__ov { color: #7a5b00; font-weight: 700; }
        .trp-diff { font-size: 12.5px; color: #5b6472; }
        .chg-inline { background: var(--accent, #fff000); padding: 0 4px; border-radius: 3px; color: #101a33; }
        .trp-rev__act { margin-top: 18px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .trp-rev__act .hint { font-size: 12px; color: #5b6472; }
        @media (max-width: 640px) { .conf { grid-template-columns: 1fr; } .trp-inbox__item { grid-template-columns: 64px 1fr; } }
      `}</style>
    </section>
  );
}
