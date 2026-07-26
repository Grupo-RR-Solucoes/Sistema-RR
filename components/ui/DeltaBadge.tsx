import {
  formatarDelta,
  rotuloComparacao,
  rotuloJanela,
  type ResultadoDelta,
} from "@/lib/delta/calcularDelta";

export interface DeltaBadgeProps {
  /**
   * Resultado vindo de lib/delta/calcularDelta. O componente NAO calcula nada —
   * so desenha. Se voce precisou fazer conta antes de chegar aqui, a conta esta
   * no lugar errado (ver REGRA DE OURO em lib/delta/calcularDelta.ts).
   */
  delta: ResultadoDelta;
  /** Esconde o "vs junho" quando o contexto ja deixa claro (default: mostra). */
  semRotulo?: boolean;
}

const SETA: Record<"up" | "down" | "flat", string> = {
  // Lucide arrow-up / arrow-down; flat usa um traco (minus).
  up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  flat: '<path d="M5 12h14"/>',
};

/**
 * Badge de variacao vs mes anterior: "^ 12,4% vs junho".
 *
 * Verde = subiu, vermelho = caiu, neutro = estavel (sem seta, so um traco).
 * Desenhado para viver SOBRE o navy (dentro do KpiBand/HeaderNavy), por isso
 * usa as variantes -soft dos semanticos, que sao as legiveis em fundo escuro.
 *
 * Renderiza `null` quando `delta.mostrar === false` — o helper ja decidiu que
 * nao ha comparacao honesta a fazer (M-1 zero, ausente ou negativo). Card sem
 * delta e honesto; card com delta errado custa confianca.
 */
export default function DeltaBadge({ delta, semRotulo }: DeltaBadgeProps) {
  if (!delta.mostrar) return null;

  const texto = formatarDelta(delta);
  if (!texto) return null;

  const janela = rotuloJanela(delta);

  // O title explica a janela ANTES da fonte: numa competencia aberta, "estou
  // comparando mes cheio contra mes cheio" muda mais a leitura do numero do que
  // a fonte de cada ponta.
  const avisos: string[] = [];
  if (delta.janela.recorteIndisponivel) {
    avisos.push(
      `Comparacao de MES CHEIO: a competencia atual ainda esta aberta (parcial) e o mes anterior esta fechado (completo). Este indicador nao tem dado com data por linha nas duas pontas, entao nao da para recortar a janela.`
    );
  } else if (delta.janela.modo === "ate-dia-N") {
    avisos.push(
      delta.janela.clampado
        ? `Janela recortada: dias 1-${delta.janela.diaCorteAtual} da competencia atual contra 1-${delta.janela.diaCorteAnterior} de ${delta.labelAnterior} (o mes anterior tem menos dias).`
        : `Janela recortada nos dois lados: dias 1-${delta.janela.diaCorteAtual} de cada competencia.`
    );
    if (delta.janela.limitadoPorDado) {
      avisos.push(
        `O corte parou no dia ${delta.janela.diaCorteAtual} (e nao no dia ${delta.janela.diaHoje}, hoje) porque a competencia atual so tem producao lancada ate ali. Comparar ate hoje leria o atraso de importacao como queda.`
      );
    }
  }
  if (delta.fontesDivergentes) {
    avisos.push(
      `Fontes diferentes: ${delta.fonteAtual} (atual) x ${delta.fonteAnterior} (${delta.labelAnterior}). Mesma metrica, fonte que vale em cada regime.`
    );
  }
  const titulo = avisos.length > 0 ? avisos.join(" ") : undefined;

  return (
    <span
      className={`rrui-delta rrui-delta--${delta.direcao}`}
      title={titulo}
      aria-label={`${texto} ${rotuloComparacao(delta)}`}
    >
      <svg
        className="rrui-delta__seta"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: SETA[delta.direcao] }}
      />
      <span className="rrui-delta__valor">{texto}</span>
      {semRotulo ? null : (
        <span className="rrui-delta__ref">
          {rotuloComparacao(delta)}
          {janela ? <span className="rrui-delta__janela"> · {janela}</span> : null}
          {delta.fontesDivergentes ? <span className="rrui-delta__aviso">*</span> : null}
        </span>
      )}
    </span>
  );
}
