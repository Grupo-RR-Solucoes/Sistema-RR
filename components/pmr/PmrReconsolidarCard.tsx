"use client";

// ============================================================================
// PmrReconsolidarCard — MOVIMENTO 1 do ledger, operacao pela TELA.
//
// O escritor canonico do PMR de mes fechado (reconsolidarCompetenciaFechada) ja
// roda sozinho dentro do import de fechamento. Este card existe para os casos em
// que NAO houve import novo:
//   - BACKFILL de competencia que fechou antes da frente (abril/2026 esta em
//     regime 'fechamento' com o PMR 100% source='daily' fossil).
//   - RE-FECHAMENTO: atribuiu orfaos, mexeu na chave master, corrigiu dado ->
//     reconsolida sem reimportar o arquivo.
//
// SEGURANCA (o motivo deste card existir):
//   - "Simular" chama a rota com dryRun:true. A rota NAO grava e NAO apaga nada
//     nesse modo — devolve so o plano. E o passo obrigatorio antes de gravar.
//   - "Reconsolidar" (dryRun:false) exige CONFIRMACAO explicita, porque reescreve
//     o PMR da competencia inteira.
//   - A rota tem guarda de regime: 'cms' (jan-mai, seed do financeiro) e 'open'
//     (mes vivo) sao RECUSADOS — ran:false, sem erro e sem tocar em nada.
//
// A resposta da rota traz `payload` e `grupo` (linhas do PMR + detalhe por
// proposta). Isso NAO vai para a tela: aqui so entra o RESUMO em numeros.
// ============================================================================

import { useMemo, useState } from "react";

import { Button, Card, Banner, Chip } from "@/components/ui";

type Reconciliacao = {
  apagadas_daily?: number;
  apagadas_orfaos?: number;
  sobrescritas_daily?: number;
  preservadas_cms?: number;
};

type Resultado = {
  ran?: boolean;
  regime?: "cms" | "fechamento" | "open" | string;
  competencia?: string;
  dry_run?: boolean;
  motivo?: string;
  promotores?: number;
  gravadas?: number;
  reconciliacao?: Reconciliacao | null;
  // A resposta traz `payload` (as linhas do PMR) e `grupo` (detalhe por proposta).
  // Nada disso e renderizado: do payload so extraimos o TOTAL de producao.
  payload?: Array<{ production_value?: number | null }>;
};

const MESES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const REGIME_LABEL: Record<string, string> = {
  fechamento: "Fechamento",
  cms: "cms (historico)",
  open: "Mes aberto",
};

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Competencia mais recente PLAUSIVELMENTE fechada = mes anterior ao corrente. */
function competenciaPadrao(): { year: number; month: number } {
  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = hoje.getMonth(); // 0-based => ja e o mes ANTERIOR em base 1
  return m === 0 ? { year: y - 1, month: 12 } : { year: y, month: m };
}

export default function PmrReconsolidarCard({ canConfirm }: { canConfirm: boolean }) {
  const padrao = useMemo(competenciaPadrao, []);
  const [year, setYear] = useState<number>(padrao.year);
  const [month, setMonth] = useState<number>(padrao.month);
  const [busy, setBusy] = useState<null | "simular" | "gravar">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);

  const anos = useMemo(() => {
    const atual = new Date().getFullYear();
    return [atual - 1, atual];
  }, []);

  const compLabel = `${String(month).padStart(2, "0")}/${year}`;

  async function chamar(dryRun: boolean) {
    setErro(null);
    setRes(null);
    setBusy(dryRun ? "simular" : "gravar");
    try {
      const r = await fetch("/api/pmr/reconsolidar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, dryRun }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) {
        setErro(json?.error || `A rota respondeu ${r.status}. Nada foi gravado.`);
        return;
      }
      setRes((json || {}) as Resultado);
    } catch (e: any) {
      setErro(e?.message || "Falha de rede. Nada foi gravado.");
    } finally {
      setBusy(null);
    }
  }

  function gravar() {
    const ok = window.confirm(
      `Isto reescreve o PMR de ${compLabel}.\n\n` +
        `As linhas de comissao/producao dessa competencia serao recalculadas do fechamento ` +
        `(RR + ADS) e as sobras do mes aberto serao apagadas.\n\n` +
        `Confirma?`
    );
    if (!ok) return;
    void chamar(false);
  }

  const rec = res?.reconciliacao ?? null;
  const naoRodou = res && res.ran === false;
  // Total de producao: derivado do payload (as linhas nao vao para a tela).
  const producaoTotal = Array.isArray(res?.payload)
    ? res!.payload.reduce((s, r) => s + Number(r?.production_value ?? 0), 0)
    : 0;

  return (
    <section className="pmrrec">
      <Card
        title={
          <span className="pmrrec__t">
            Reconsolidar competencia
            <Chip variant="neutral">PMR de mes fechado</Chip>
          </span>
        }
        variant="gold"
      >
        <p className="pmrrec__lead">
          Reescreve o PMR (producao e comissao consolidadas por promotor) de uma competencia{" "}
          <b>ja fechada</b>, a partir do fechamento — RR e ADS juntos. O import de fechamento ja faz
          isso sozinho; use aqui para <b>backfill</b> de competencia antiga ou depois de corrigir dado
          (orfaos, chave master) sem reimportar o arquivo.
        </p>

        <div className="pmrrec__form">
          <label className="fld">
            <span className="fld__l">Ano</span>
            <select
              className="fld__i"
              value={year}
              disabled={busy !== null}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {anos.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>

          <label className="fld">
            <span className="fld__l">Mes</span>
            <select
              className="fld__i"
              value={month}
              disabled={busy !== null}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MESES.map((nome, i) => (
                <option key={nome} value={i + 1}>
                  {String(i + 1).padStart(2, "0")} — {nome}
                </option>
              ))}
            </select>
          </label>

          <div className="pmrrec__acts">
            <Button
              variant="secundario"
              onClick={() => void chamar(true)}
              disabled={busy !== null}
            >
              {busy === "simular" ? "Simulando…" : "Simular"}
            </Button>
            <Button
              variant="perigo"
              onClick={gravar}
              disabled={busy !== null || !canConfirm}
              title={canConfirm ? undefined : "Disponivel apenas para socio"}
            >
              {busy === "gravar" ? "Reconsolidando…" : "Reconsolidar"}
            </Button>
          </div>
        </div>

        <p className="pmrrec__hint">
          <b>Simular</b> nao grava nada — mostra exatamente o que a gravacao faria. Rode a simulacao
          antes de reconsolidar.
        </p>

        {erro ? (
          <Banner variant="warn">
            <b>Nao foi possivel reconsolidar.</b>
            <div className="det">{erro}</div>
          </Banner>
        ) : null}

        {naoRodou ? (
          <Banner variant="info">
            <b>
              Competencia {res?.competencia ?? compLabel} em regime{" "}
              {REGIME_LABEL[String(res?.regime)] ?? res?.regime} — nada a reconsolidar.
            </b>
            <div className="det">{res?.motivo}</div>
          </Banner>
        ) : null}

        {res && res.ran ? (
          <>
            <Banner variant={res.dry_run ? "info" : "ok"}>
              <b>
                {res.dry_run
                  ? `Simulacao de ${res.competencia} — nada foi gravado.`
                  : `PMR de ${res.competencia} reconsolidado.`}
              </b>
              <div className="det">
                Regime <b>{REGIME_LABEL[String(res.regime)] ?? res.regime}</b>. As linhas abaixo sao o
                PMR fechado {res.dry_run ? "que seria escrito" : "que passou a valer"} na competencia.
              </div>
            </Banner>

            <div className="pmrrec__stats">
              <div className="st">
                <span className="st__l">Promotores</span>
                <span className="st__v">{res.promotores ?? 0}</span>
              </div>
              <div className="st">
                <span className="st__l">
                  {res.dry_run ? "Linhas que gravaria" : "Linhas gravadas"}
                </span>
                <span className="st__v">
                  {res.dry_run ? (res.payload?.length ?? 0) : (res.gravadas ?? 0)}
                </span>
              </div>
              <div className="st">
                <span className="st__l">Producao total</span>
                <span className="st__v">{brl(producaoTotal)}</span>
              </div>
              <div className="st">
                <span className="st__l">Sobras do mes aberto apagadas</span>
                <span className="st__v">{rec?.apagadas_daily ?? 0}</span>
              </div>
              <div className="st">
                <span className="st__l">Linhas orfas apagadas</span>
                <span className="st__v">{rec?.apagadas_orfaos ?? 0}</span>
              </div>
              <div className="st">
                <span className="st__l">Linhas substituidas</span>
                <span className="st__v">{rec?.sobrescritas_daily ?? 0}</span>
              </div>
              <div className="st st--safe">
                <span className="st__l">Historico cms preservado</span>
                <span className="st__v">{rec?.preservadas_cms ?? 0}</span>
              </div>
            </div>

            {!res.dry_run ? (
              <p className="pmrrec__next">
                Confira em <a href="/promotores">Promotores</a> — selecione a competencia{" "}
                <b>{res.competencia ?? compLabel}</b> no seletor da tela. A producao e a comissao
                passam a vir do fechamento consolidado.
              </p>
            ) : null}
          </>
        ) : null}
      </Card>

      <style jsx>{`
        .pmrrec {
          margin: 18px 0;
        }
        .pmrrec__t {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .pmrrec__lead {
          margin: 0 0 16px;
          font-size: 13px;
          line-height: 1.6;
          color: var(--ink-soft, #4a5568);
        }
        .pmrrec__form {
          display: flex;
          align-items: flex-end;
          gap: 12px;
          flex-wrap: wrap;
        }
        .fld {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 150px;
        }
        .fld__l {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--ink-soft, #6b7280);
        }
        .fld__i {
          height: 38px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid rgba(20, 33, 61, 0.18);
          background: #fff;
          font-size: 13px;
          font-weight: 600;
          color: var(--ink, #14213d);
        }
        .fld__i:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .pmrrec__acts {
          display: flex;
          gap: 8px;
          margin-left: auto;
        }
        .pmrrec__hint {
          margin: 12px 0 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--ink-soft, #6b7280);
        }
        .pmrrec__stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-top: 14px;
        }
        .st {
          border: 1px solid rgba(20, 33, 61, 0.1);
          border-radius: 10px;
          padding: 10px 12px;
          background: rgba(20, 33, 61, 0.02);
        }
        .st--safe {
          border-color: rgba(16, 138, 90, 0.28);
          background: rgba(16, 138, 90, 0.05);
        }
        .st__l {
          display: block;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: var(--ink-soft, #6b7280);
          line-height: 1.35;
          min-height: 26px;
        }
        .st__v {
          display: block;
          margin-top: 4px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 18px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--ink, #14213d);
          word-break: break-word;
        }
        .pmrrec__next {
          margin: 14px 0 0;
          font-size: 13px;
          color: var(--ink-soft, #4a5568);
        }
        .det {
          margin-top: 4px;
          font-size: 12px;
          line-height: 1.5;
          opacity: 0.92;
        }
        @media (max-width: 1100px) {
          .pmrrec__stats {
            grid-template-columns: repeat(3, 1fr);
          }
        }
        @media (max-width: 640px) {
          .pmrrec__stats {
            grid-template-columns: repeat(2, 1fr);
          }
          .pmrrec__acts {
            margin-left: 0;
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
}
