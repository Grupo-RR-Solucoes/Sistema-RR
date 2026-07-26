"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Banner,
  Card,
  Chip,
  HeaderNavy,
  KpiBand,
  type ChipVariant,
} from "@/components/ui";

// ============================================================
// MONITOR FISCAL / FATOR R — seção do Dashboard. Card por CNPJ: RBT12, faixa,
// alíquota efetiva, Fator R + semáforo, alerta de teto. Primitivos navy.
// Fator R sem dados de folha → chip "aguardando folha" (não quebra).
// ============================================================

type Empresa = {
  cnpj: string;
  nome: string;
  rbt12: number;
  faixa: number | null;
  acimaSimples: boolean;
  aliquotaEfetiva: number | null;
  folha12m: number;
  temDadosFolha: boolean;
  mesesFolha: number;
  folhaIncompleta: boolean;
  fatorR: number | null;
  semaforo: "verde" | "amarelo" | "vermelho" | "parcial" | "sem_dados";
  anexoVigente: "III" | "V" | null;
  margemAteTeto: number;
  pctTetoUsado: number;
  alertaTeto: boolean;
  janelaParcial: boolean;
};
type Payload = {
  referencia: { key: string };
  janela: { de: string; ate: string; meses: number };
  tetoSimples: number;
  empresas: Empresa[];
  algumAlertaTeto: boolean;
  algumFatorRVermelho: boolean;
  semDadosFolha: number;
};

const brl0 = (v?: number | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(v || 0));
const pct1 = (v?: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const nome = (n: string) =>
  String(n || "").split(/\s+/).filter(Boolean).map((w) => (w.toUpperCase() === "RR" ? "RR" : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");

const semaforoChip = (s: Empresa["semaforo"]): ChipVariant =>
  s === "verde" ? "ok" : s === "amarelo" ? "warn" : s === "vermelho" ? "risk" : "neutral";
// "parcial" e "sem_dados" → neutral (sem cor de semáforo).

export default function FatorRSection() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    fetch("/api/fator-r")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar o monitor fiscal."))))
      .then((j: Payload) => { if (!cancel) setData(j); })
      .catch((e) => { if (!cancel) setError(e.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  const empresas = data?.empresas ?? [];
  const rbt12Grupo = useMemo(() => empresas.reduce((a, e) => a + e.rbt12, 0), [empresas]);
  const cnpjsAlertaTeto = empresas.filter((e) => e.alertaTeto).length;

  return (
    <section className="fatorr">
      <HeaderNavy
        eyebrow="MONITOR FISCAL"
        title="Simples & Fator R por CNPJ"
        subtitle="Apuração individual por CNPJ (janela RBT12 de 12 meses). Anexo III enquanto Fator R ≥ 28%."
      >
        <KpiBand
          columns={4}
          valueSize={26}
          items={[
            { label: "CNPJs monitorados", value: empresas.length ? String(empresas.length) : "—" },
            { label: "RBT12 somado (grupo)", value: empresas.length ? brl0(rbt12Grupo) : "—", sub: `teto ${brl0(data?.tetoSimples)}/CNPJ`, subTone: "gold" },
            { label: "CNPJs > 80% do teto", value: empresas.length ? String(cnpjsAlertaTeto) : "—", sub: "risco de desenquadramento", subTone: cnpjsAlertaTeto > 0 ? "amber" : "neutral", accent: cnpjsAlertaTeto > 0 },
            { label: "Fator R aguardando folha", value: data ? String(data.semDadosFolha) : "—", sub: "sem lançamentos ainda" },
          ]}
        />
      </HeaderNavy>

      {error ? <Banner variant="warn">{error}</Banner> : null}

      {data?.algumAlertaTeto ? (
        <Banner variant="warn">
          <b>Atenção ao teto do Simples (R$ 4,8 MM/ano por CNPJ):</b> {cnpjsAlertaTeto} CNPJ(s) acima de 80% do teto.
          Estourar exclui o CNPJ do regime — acompanhe a produção restante do ano.
        </Banner>
      ) : null}

      {data?.algumFatorRVermelho ? (
        <Banner variant="warn">
          <b>Fator R abaixo de 28% em algum CNPJ:</b> risco de migração do Anexo III para o Anexo V (alíquota maior).
          Avalie folha CLT / pró-labore para recompor o Fator R.
        </Banner>
      ) : null}

      <div className="fatorr-grid">
        {loading && !data ? <p className="fatorr-empty">Carregando…</p> : null}
        {empresas.map((e) => (
          <Card key={e.cnpj} title={nome(e.nome)}>
            <div className="fatorr-card">
              <div className="row">
                <span className="k">RBT12 (12m)</span>
                <span className="v num">{brl0(e.rbt12)}</span>
              </div>
              <div className="row">
                <span className="k">Faixa / alíquota efetiva</span>
                <span className="v">
                  {e.acimaSimples ? <Chip variant="risk">Acima do Simples</Chip> : <Chip variant="neutral" dot={false}>Faixa {e.faixa}</Chip>}
                  {e.aliquotaEfetiva != null ? <span className="num" style={{ marginLeft: 8 }}>{pct1(e.aliquotaEfetiva)}</span> : null}
                </span>
              </div>
              <div className="row">
                <span className="k">Fator R</span>
                <span className="v">
                  {e.fatorR == null ? (
                    <Chip variant="neutral" dot={false}>aguardando folha</Chip>
                  ) : e.folhaIncompleta ? (
                    <>
                      <b className="num fr provisorio" title="Fator R provisório — não conclusivo até 12 meses de folha">
                        {pct1(e.fatorR)}*
                      </b>
                      <Chip variant="neutral" dot={false}>folha incompleta: {e.mesesFolha}/12 meses</Chip>
                    </>
                  ) : (
                    <>
                      <b className="num fr">{pct1(e.fatorR)}</b>
                      <Chip variant={semaforoChip(e.semaforo)}>{e.anexoVigente ? `Anexo ${e.anexoVigente}` : e.semaforo}</Chip>
                    </>
                  )}
                </span>
              </div>
              <div className="row foot">
                <span className="k">Teto usado</span>
                <span className="v">
                  <span className="num">{pct1(e.pctTetoUsado)}</span>
                  {e.alertaTeto ? <Chip variant="risk">&gt; 80%</Chip> : <span className="muted">· margem {brl0(e.margemAteTeto)}</span>}
                </span>
              </div>
              {e.janelaParcial ? <p className="parcial">janela parcial (menos de 12 meses com dado)</p> : null}
            </div>
          </Card>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
.fatorr{display:flex;flex-direction:column;gap:16px;}
.fatorr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
.fatorr-empty{font-size:13.5px;color:var(--ink-3);}
.fatorr-card{display:flex;flex-direction:column;gap:10px;}
.fatorr-card .row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.fatorr-card .row.foot{border-top:1px solid var(--bd-soft);padding-top:9px;margin-top:1px;}
.fatorr-card .k{font-size:12px;color:var(--ink-3);}
.fatorr-card .v{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--ink);}
.fatorr-card .v .fr{font-size:18px;}
.fatorr-card .v .fr.provisorio{color:var(--ink-3);font-weight:600;}
.fatorr-card .num{font-variant-numeric:tabular-nums;}
.fatorr-card .muted{font-size:12px;color:var(--ink-3);font-weight:500;}
.fatorr-card .parcial{font-size:11.5px;color:var(--ink-3);margin:2px 0 0;}
@media (max-width:720px){ .fatorr-grid{grid-template-columns:1fr;} }
`,
        }}
      />
    </section>
  );
}
