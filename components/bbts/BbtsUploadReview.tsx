"use client";

// Auditoria ADS/BBTS — 1A: tela de upload + revisão + gravação versionada da
// TABELA DA BBTS (a "TRP da ADS"). Espelho estrutural do TrpUploadReview:
//   - Sócio: "Confirmar e gravar" -> /api/bbts/commit (grava a versão viva).
//   - Todos (socio+funcionario): "Salvar rascunho" -> /api/bbts/staging.
//   - Sócio: caixa "Rascunhos pendentes" (inbox).
//
// O que muda vs a TRP é o GRID revisado: aqui a célula tem faixa de juros, prazo e
// percentual por Faixa 1..5, com BASE e ADICIONAL (bonificação) separados. A coluna
// FAIXA 4 vem destacada: é a que o Grupo RR/ADS recebe por acordo comercial — mas a
// régua grava as 5 faixas fiéis à tabela (a trava da Faixa 4 é do resolver).

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Banner, Chip } from "@/components/ui";

const FAIXAS = ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5"];
const FAIXA_ADS = "Faixa 4";

type PctCel = { base: number; adicional?: number };
type Celula = {
  tx_min?: number | null;
  tx_max?: number | null;
  prazo_min?: number | null;
  prazo_max?: number | null;
  valor_min?: number | null;
  faixas: Record<string, PctCel>;
};
type Grupo = { titulo: string; celulas: Celula[] };
type RegraBbts = {
  _meta: {
    competencia: string;
    vigencia_inicio: string;
    vigencia_fim: string;
    vigencia_pdf?: string | null;
    faixas_enquadramento: { faixa: string; prod_min: number; prod_max: number | null }[];
    modelo_pagamento: { avt_teto: number; prt: string };
  };
  convenios: Record<string, { grupo: string; nome: string }>;
  grupos: Record<string, Grupo>;
  seguro?: { slip: { prazo_min: number; prazo_max: number | null; pct: number }[]; estoque: { pct: number } };
};
type ParseMeta = {
  competencia: string;
  vigencia_pdf: string | null;
  valid_from: string;
  valid_until: string;
  shape_version: string;
  parser_version: string;
  source_filename: string | null;
  sha256?: string | null;
  celulas_por_grupo: Record<string, number>;
  total_celulas: number;
  convenios_mapeados: number;
};
type ParseOk = {
  regraDraft: RegraBbts;
  meta: ParseMeta;
  confianca: { provado: string[]; conferir: { grupo: string; celula?: number; motivo: string }[] };
  diff: { anterior: { competencia: string; version_no: number; regra_json: RegraBbts } | null };
};
type PendItem = { id: string; competencia: string; source_filename: string | null; uploaded_at: string };

function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === "string" ? resolve(r.result.split(",")[1]) : reject(new Error("falha ao ler arquivo")));
    r.onerror = () => reject(new Error("erro ao ler arquivo"));
    r.readAsDataURL(f);
  });
}

const pctFmt = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(2).replace(".", ",")}%`;

const rangeTx = (c: Celula) =>
  c.tx_min == null && c.tx_max == null
    ? "—"
    : c.tx_max == null
      ? `a partir de ${pctFmt(c.tx_min)}`
      : `${pctFmt(c.tx_min)} a ${pctFmt(c.tx_max)}`;

const rangePrazo = (c: Celula) =>
  c.prazo_min == null && c.prazo_max == null
    ? "—"
    : c.prazo_max == null
      ? `${c.prazo_min}+`
      : `${c.prazo_min} a ${c.prazo_max}`;

/** Valor da mesma célula/faixa na régua anterior (para o diff). */
function anteriorPct(anterior: RegraBbts | null, gk: string, ci: number, faixa: string): number | undefined {
  const cel = anterior?.grupos?.[gk]?.celulas?.[ci];
  return cel?.faixas?.[faixa]?.base;
}

export default function BbtsUploadReview({ canConfirm }: { canConfirm: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [competencia, setCompetencia] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<{ msg: string; detalhe?: string | null } | null>(null);
  const [result, setResult] = useState<ParseOk | null>(null);

  const [currentUploadId, setCurrentUploadId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<{ msg: string; detalhe?: string | null } | null>(null);
  const [pendentes, setPendentes] = useState<PendItem[]>([]);

  const anterior = useMemo(() => result?.diff.anterior?.regra_json ?? null, [result]);

  const loadPendentes = useCallback(async () => {
    if (!canConfirm) return; // inbox é só do sócio
    try {
      const resp = await fetch("/api/bbts/staging?status=pendente");
      const json = await resp.json();
      if (resp.ok) setPendentes(Array.isArray(json.pendentes) ? json.pendentes : []);
    } catch {
      /* silencioso — inbox é auxiliar */
    }
  }, [canConfirm]);

  useEffect(() => {
    loadPendentes();
  }, [loadPendentes]);

  async function onEnviar() {
    if (!file) return;
    setLoading(true);
    setErro(null);
    setResult(null);
    setActionMsg(null);
    setActionErr(null);
    setCurrentUploadId(null);
    try {
      const base64 = await fileToBase64(file);
      const resp = await fetch("/api/bbts/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // competência opcional: sem ela o parser deduz da vigência do PDF
        body: JSON.stringify({ file: base64, fileName: file.name, competencia: competencia || undefined }),
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
      const resp = await fetch(`/api/bbts/staging/${id}`);
      const json = await resp.json();
      if (!resp.ok) {
        setActionErr({ msg: json.error || "não consegui abrir o rascunho", detalhe: json.detalhe });
        return;
      }
      setResult(json as ParseOk);
      setCurrentUploadId(id);
    } catch (e) {
      setActionErr({ msg: "falha ao abrir o rascunho", detalhe: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  async function onSalvarRascunho() {
    if (!result) return;
    setSaving(true);
    setActionMsg(null);
    setActionErr(null);
    try {
      const resp = await fetch("/api/bbts/staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencia: result.meta.competencia,
          regraDraft: result.regraDraft,
          confianca: result.confianca,
          meta: result.meta,
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
    try {
      const body = currentUploadId ? { uploadId: currentUploadId } : { regraDraft: result.regraDraft, meta: result.meta };
      const resp = await fetch("/api/bbts/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setActionErr({ msg: json.error || "não consegui gravar a régua BBTS", detalhe: json.detalhe });
        return;
      }
      setActionMsg(
        `Régua BBTS de ${result.meta.competencia} gravada — versão ${json.version_no}. ` +
          `Passa a ser a régua ativa da competência (auditoria da ADS na próxima etapa).`,
      );
      setCurrentUploadId(null);
      loadPendentes();
    } catch (e) {
      setActionErr({ msg: "falha ao gravar a régua BBTS", detalhe: e instanceof Error ? e.message : String(e) });
    } finally {
      setCommitting(false);
    }
  }

  const busy = saving || committing;
  const r = result?.regraDraft;

  return (
    <section className="bb-up">
      <header className="bb-up__head">
        <div className="tt">
          <span className="badge">BBTS</span>
          <div>
            <h3>Tabela de pagamento da BBTS (ADS)</h3>
            <p className="sub">
              Suba o PDF da tabela; o servidor lê e você confere antes de {canConfirm ? "gravar" : "salvar o rascunho"}. É a régua
              da <b>auditoria da ADS</b> — não muda a comissão do promotor (essa segue a TRP).
            </p>
          </div>
        </div>
        <Chip variant="neutral">upload + revisão + gravação</Chip>
      </header>

      {canConfirm ? (
        <div className="bb-inbox">
          <div className="bb-inbox__h">
            <span>Rascunhos pendentes</span>
            <Chip variant={pendentes.length ? "warn" : "ok"}>{`${pendentes.length}`}</Chip>
          </div>
          {pendentes.length === 0 ? (
            <p className="bb-inbox__empty">Sem rascunhos aguardando confirmação.</p>
          ) : (
            <ul className="bb-inbox__list">
              {pendentes.map((p) => (
                <li key={p.id} className="bb-inbox__item">
                  <span className="ci">{String(p.competencia).slice(0, 7)}</span>
                  <span className="cf">{p.source_filename || "sem nome"}</span>
                  <Button variant="secundario" onClick={() => onAbrirRascunho(p.id)} disabled={loading || busy}>
                    Abrir e revisar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="bb-up__form">
        <label className="fld">
          <span>Competência (opcional)</span>
          <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} disabled={loading} />
        </label>
        <label className="fld fld--file">
          <span>PDF da tabela BBTS</span>
          <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={loading} />
        </label>
        <Button variant="primario" disabled={!file || loading} onClick={onEnviar}>
          {loading ? "Lendo o PDF…" : "Enviar e revisar"}
        </Button>
        <span className="hint">Sem competência, ela é deduzida da vigência declarada no PDF.</span>
      </div>

      {erro ? (
        <Banner variant="warn">
          <b>não consegui ler este PDF:</b> {erro.msg}
          {erro.detalhe ? <div className="det">{erro.detalhe}</div> : null}
          <div className="det">Confira o arquivo e tente de novo — nada foi gravado.</div>
        </Banner>
      ) : null}

      {result && r ? (
        <div className="bb-rev">
          <div className="bb-rev__meta">
            <span>
              <b>{result.meta.competencia}</b>
              {currentUploadId ? " · rascunho pendente" : ""}
            </span>
            <span>
              vigência {result.meta.valid_from} → {result.meta.valid_until}
              {result.meta.vigencia_pdf ? ` (PDF: a partir de ${result.meta.vigencia_pdf})` : ""}
            </span>
            <span>
              {result.meta.source_filename} · {result.meta.total_celulas} células · teto à vista{" "}
              {pctFmt(r._meta.modelo_pagamento.avt_teto)}
            </span>
          </div>

          <h4 className="bb-rev__h">
            Régua lida <Chip variant="ok">provado</Chip>
            <span className="lg">
              coluna <b>{FAIXA_ADS}</b> destacada — é a que a ADS recebe por acordo
            </span>
          </h4>

          <div className="bb-groups">
            {Object.entries(r.grupos).map(([gk, g]) => (
              <div className="gcard" key={gk}>
                <div className="gcard__t">
                  {gk} <span className="gcard__st">{g.celulas.length} células</span>
                </div>
                <div className="tw">
                  <table className="gt">
                    <thead>
                      <tr>
                        <th>Juros</th>
                        <th>Prazo</th>
                        {Object.keys(g.celulas[0]?.faixas ?? {}).map((f) => (
                          <th key={f} className={f === FAIXA_ADS ? "ads" : undefined}>
                            {f}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.celulas.map((c, ci) => (
                        <tr key={ci}>
                          <td className="rg">{rangeTx(c)}</td>
                          <td className="rg">{rangePrazo(c)}</td>
                          {Object.entries(c.faixas).map(([f, v]) => {
                            const prev = anteriorPct(anterior, gk, ci, f);
                            const changed = prev !== undefined && prev !== v.base;
                            return (
                              <td
                                key={f}
                                className={`num${f === FAIXA_ADS ? " ads" : ""}${changed ? " chg" : ""}`}
                                title={changed ? `antes: ${pctFmt(prev)}` : undefined}
                              >
                                {pctFmt(v.base)}
                                {v.adicional !== undefined ? <span className="add"> +{pctFmt(v.adicional)}</span> : null}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <h4 className="bb-rev__h">Faixas de enquadramento e seguro</h4>
          <div className="bb-aux">
            <ul>
              {r._meta.faixas_enquadramento.map((f) => (
                <li key={f.faixa}>
                  <b>{f.faixa}</b> produção {f.prod_min.toLocaleString("pt-BR")} →{" "}
                  {f.prod_max === null ? "sem teto" : f.prod_max.toLocaleString("pt-BR")}
                </li>
              ))}
            </ul>
            {r.seguro ? (
              <ul>
                {r.seguro.slip.map((s) => (
                  <li key={s.prazo_min}>
                    <b>Slip {s.prazo_min}–{s.prazo_max ?? "+"}</b> {pctFmt(s.pct)}
                  </li>
                ))}
                <li>
                  <b>Estoque</b> {pctFmt(r.seguro.estoque.pct)}
                </li>
              </ul>
            ) : (
              <p className="bb-diff">Seguro Prestamista não encontrado no PDF.</p>
            )}
          </div>

          <h4 className="bb-rev__h">
            Conferir contra o PDF <Chip variant="warn">{result.confianca.conferir.length} itens</Chip>
          </h4>
          <ul className="bb-conf">
            {result.confianca.conferir.map((c, i) => (
              <li key={i} className="conf">
                <span className="conf__k">
                  {c.grupo}
                  {c.celula !== undefined ? ` · célula ${c.celula}` : ""}
                </span>
                <span className="conf__m">{c.motivo}</span>
              </li>
            ))}
          </ul>

          <h4 className="bb-rev__h">Mudanças vs régua anterior</h4>
          {result.diff.anterior ? (
            <p className="bb-diff">
              Comparando com <b>{result.diff.anterior.competencia}</b> (v{result.diff.anterior.version_no}). As células em{" "}
              <span className="chg-inline">amarelo</span> mudaram de valor — passe o mouse para ver o anterior.
            </p>
          ) : (
            <p className="bb-diff">Sem régua BBTS anterior no banco — nada a comparar (primeira competência).</p>
          )}

          {actionMsg ? (
            <Banner variant="ok">
              <b>{actionMsg}</b>
              {actionMsg.includes("gravada") ? (
                <div className="det">
                  Abra a <a href="/auditoria#conferencia-bbts">Conferência BBTS</a> para ver, contrato a contrato, o que a
                  BBTS pagou contra o que a tabela manda (Faixa 4 do acordo).
                </div>
              ) : null}
            </Banner>
          ) : null}
          {actionErr ? (
            <Banner variant="warn">
              <b>{actionErr.msg}</b>
              {actionErr.detalhe ? <div className="det">{actionErr.detalhe}</div> : null}
            </Banner>
          ) : null}

          <div className="bb-rev__act">
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
                <span className="hint">Grava a versão viva da régua BBTS da competência.</span>
              </>
            ) : (
              <span className="hint">
                Revisão do auxiliar — a <b>confirmação/gravação é do sócio</b>. Você salva o rascunho; ele confirma.
              </span>
            )}
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .bb-up { border: 1px solid var(--bd-soft, #e6e8ee); border-radius: 14px; background: #fff; padding: 18px; margin-bottom: 18px; }
        .bb-up__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .bb-up__head .tt { display: flex; gap: 12px; align-items: center; }
        .bb-up__head .badge { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 40px; border-radius: 10px; background: #0b2b6b; color: #fff; font-weight: 700; font-size: 12px; }
        .bb-up__head h3 { margin: 0; font-size: 16px; color: #101a33; }
        .bb-up__head .sub { margin: 2px 0 0; font-size: 12.5px; color: #5b6472; }
        .bb-inbox { margin-top: 16px; border: 1px solid var(--bd-soft, #eef0f4); border-radius: 10px; background: #fafbfe; padding: 12px 14px; }
        .bb-inbox__h { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #101a33; margin-bottom: 8px; }
        .bb-inbox__empty { margin: 0; font-size: 12.5px; color: #5b6472; }
        .bb-inbox__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .bb-inbox__item { display: grid; grid-template-columns: 84px 1fr auto; gap: 10px; align-items: center; padding: 6px 8px; background: #fff; border: 1px solid var(--bd-soft, #eef0f4); border-radius: 8px; }
        .bb-inbox__item .ci { font-family: var(--font-mono), monospace; font-weight: 700; font-size: 12px; color: #101a33; }
        .bb-inbox__item .cf { font-size: 12px; color: #5b6472; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bb-up__form { display: flex; align-items: flex-end; gap: 14px; margin-top: 16px; flex-wrap: wrap; }
        .fld { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #5b6472; }
        .fld span { font-weight: 600; }
        .fld input { height: 36px; border: 1px solid var(--bd-soft, #d7dbe3); border-radius: 8px; padding: 0 10px; font: inherit; }
        .fld--file input { padding: 6px; }
        .hint { font-size: 12px; color: #5b6472; }
        .det { font-size: 12px; opacity: .85; margin-top: 4px; }
        .det a { color: #101a33; font-weight: 700; }
        .bb-rev { margin-top: 18px; border-top: 1px solid var(--bd-soft, #eef0f4); padding-top: 16px; }
        .bb-rev__meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12.5px; color: #5b6472; margin-bottom: 14px; }
        .bb-rev__h { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #101a33; margin: 18px 0 10px; }
        .bb-rev__h .lg { font-weight: 400; font-size: 12px; color: #5b6472; }
        .bb-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
        .gcard { border: 1px solid var(--bd-soft, #eef0f4); border-radius: 10px; overflow: hidden; }
        .gcard__t { background: #f6f8fc; padding: 6px 10px; font-size: 11.5px; font-weight: 700; color: #101a33; display: flex; justify-content: space-between; }
        .gcard__st { font-weight: 400; color: #5b6472; }
        .tw { overflow-x: auto; }
        .gt { width: 100%; border-collapse: collapse; }
        .gt th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: #5b6472; padding: 5px 8px; text-align: right; border-bottom: 1px solid #eef0f4; white-space: nowrap; }
        .gt th:first-child, .gt th:nth-child(2) { text-align: left; }
        .gt th.ads { background: #eef4ff; color: #0b2b6b; }
        .gt td { font-size: 11.5px; padding: 4px 8px; border-top: 1px solid #f1f3f7; }
        .gt td.rg { color: #5b6472; white-space: nowrap; }
        .gt td.num { font-family: var(--font-mono), ui-monospace, monospace; text-align: right; font-variant-numeric: tabular-nums; background: #f2fbf5; color: #14532d; white-space: nowrap; }
        .gt td.num.ads { background: #eef4ff; color: #0b2b6b; font-weight: 700; }
        .gt td.num.chg { background: var(--accent, #fff000); color: #101a33; font-weight: 700; }
        .gt .add { color: #7a5b00; font-size: 10.5px; }
        .bb-aux { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; font-size: 12px; color: #3b4657; }
        .bb-aux ul { list-style: none; margin: 0; padding: 10px 12px; border: 1px solid var(--bd-soft, #eef0f4); border-radius: 10px; display: flex; flex-direction: column; gap: 4px; }
        .bb-conf { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .conf { display: grid; grid-template-columns: 220px 1fr; gap: 10px; align-items: baseline; padding: 8px 10px; border-radius: 8px; background: #fffdf0; border: 1px solid #f5e7a8; font-size: 12px; }
        .conf__k { font-weight: 700; color: #101a33; }
        .conf__m { color: #6b6250; }
        .bb-diff { font-size: 12.5px; color: #5b6472; }
        .chg-inline { background: var(--accent, #fff000); padding: 0 4px; border-radius: 3px; color: #101a33; }
        .bb-rev__act { margin-top: 18px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        @media (max-width: 640px) { .conf { grid-template-columns: 1fr; } .bb-inbox__item { grid-template-columns: 64px 1fr; } }
      `}</style>
    </section>
  );
}
