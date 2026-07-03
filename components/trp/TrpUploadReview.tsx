"use client";

// F6b sub-fase 2 — Tela de upload + revisão assistida da TRP (SEM gravar).
// Consome a rota read-only /api/trp/parse (F6b.1). O confirmar é NO-OP nesta
// fase (gravação = F6b.3). Socio+funcionario sobem e revisam; só socio vê o
// botão confirmar. Nada persiste.

import { useMemo, useState } from "react";

import { Button, Banner, Chip } from "@/components/ui";

const FAIXA_LABELS = ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5", "pct_geral"];

type Confianca = {
  provado: { totalPct: number; produtos: Record<string, number[][]> };
  conferir: { produto: string; campo: string; valorLido: string | null; motivo: string }[];
};
type ParseMeta = {
  competencia: string;
  regime: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  source_filename: string | null;
  parser_version: string;
  n_lines: number;
};
type ParseOk = {
  regraDraft: Record<string, unknown>;
  meta: ParseMeta;
  confianca: Confianca;
  diff: { anterior: { competencia: string; version_no: number; regra_json: unknown } | null };
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

  const anterior = useMemo(() => (result?.diff.anterior ? anteriorVals(result.diff.anterior.regra_json) : null), [result]);

  async function onEnviar() {
    if (!file || !competencia) return;
    setLoading(true);
    setErro(null);
    setResult(null);
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

  return (
    <section className="trp-up">
      <header className="trp-up__head">
        <div className="tt">
          <span className="badge">TRP</span>
          <div>
            <h3>TRP do mês (Promotiva)</h3>
            <p className="sub">Suba o PDF oficial; o servidor lê e você confere antes de confirmar. Não grava nada nesta etapa.</p>
          </div>
        </div>
        <Chip variant="neutral">upload + revisão</Chip>
      </header>

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
            <span><b>{result.meta.competencia}</b> · {result.meta.regime}</span>
            <span>vigência {result.meta.vigencia_inicio} → {result.meta.vigencia_fim}</span>
            <span>{result.meta.source_filename} · {result.meta.n_lines} linhas · {result.confianca.provado.totalPct} pct lidos</span>
          </div>

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

          {/* CONFERIR */}
          <h4 className="trp-rev__h">Conferir contra o PDF <Chip variant="warn">{result.confianca.conferir.length} itens</Chip></h4>
          <ul className="trp-conf">
            {result.confianca.conferir.map((c, i) => (
              <li key={i} className="conf">
                <span className="conf__k">{c.produto} · {c.campo}</span>
                {c.valorLido ? <span className="conf__v">lido: {c.valorLido}</span> : <span className="conf__v conf__v--none">não lido</span>}
                <span className="conf__m">{c.motivo}</span>
              </li>
            ))}
          </ul>

          {/* DIFF */}
          <h4 className="trp-rev__h">Mudanças vs TRP anterior</h4>
          {result.diff.anterior ? (
            <p className="trp-diff">
              Comparando com <b>{result.diff.anterior.competencia}</b> (v{result.diff.anterior.version_no}). As células destacadas em <span className="chg-inline">amarelo</span> na grade acima mudaram de valor. Passe o mouse para ver o valor anterior.
            </p>
          ) : (
            <p className="trp-diff">Sem TRP anterior no banco — nada a comparar (primeira competência).</p>
          )}

          {/* CONFIRMAR (no-op nesta sub-fase) */}
          <div className="trp-rev__act">
            {canConfirm ? (
              <>
                <Button variant="acao" disabled title="Gravação entra na próxima fase (F6b.3)">
                  Confirmar e gravar
                </Button>
                <span className="hint">Pronto para confirmar — a <b>gravação versionada + recálculo</b> entram na próxima fase. Nada é gravado agora.</span>
              </>
            ) : (
              <span className="hint">Revisão do auxiliar — a <b>confirmação/gravação é do sócio</b>. Você não grava.</span>
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
        .trp-up__form { display: flex; align-items: flex-end; gap: 14px; margin-top: 16px; flex-wrap: wrap; }
        .fld { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #5b6472; }
        .fld span { font-weight: 600; }
        .fld input { height: 36px; border: 1px solid var(--bd-soft, #d7dbe3); border-radius: 8px; padding: 0 10px; font: inherit; }
        .fld--file input { padding: 6px; }
        .det { font-size: 12px; opacity: .85; margin-top: 4px; }
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
        .conf__k { font-weight: 700; color: #101a33; }
        .conf__v { font-family: var(--font-mono), monospace; color: #7a5b00; }
        .conf__v--none { opacity: .6; }
        .conf__m { color: #6b6250; }
        .trp-diff { font-size: 12.5px; color: #5b6472; }
        .chg-inline { background: var(--accent, #fff000); padding: 0 4px; border-radius: 3px; color: #101a33; }
        .trp-rev__act { margin-top: 18px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .trp-rev__act .hint { font-size: 12px; color: #5b6472; }
        @media (max-width: 640px) { .conf { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}
