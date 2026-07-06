// ============================================================
// INADIMPLÊNCIA PRT — agregados da fila (função pura, testável).
// Extraído da rota GET p/ poder cobrir por teste o efeito do SOLUCIONADO
// (Fatia B) no "Recuperável aberto".
//
// REGRA: SOLUCIONADO (resolucao_status manual) sai de TODO agregado de fila —
// não conta em novo/aguardando/emCobranca/recuperado nem no recuperável aberto
// (resolvido = não é mais a cobrar). Vira um agregado informativo próprio.
// ============================================================

export interface MonitorFilaRow {
  status_acompanhamento: string;
  recuperavel_estimado: number;
  resolucao_status: string;
}

export interface InadimplenciaAgregados {
  novo: number;
  aguardandoExplicacao: number;
  emCobranca: number;
  recuperado: number;
  recuperavelAberto: number;
  solucionado: { contagem: number; valor: number };
}

/** Status de acompanhamento que contam como recebível EM ABERTO. */
const ABERTOS = new Set(["NOVO", "AGUARDANDO_EXPLICACAO", "EM_COBRANCA"]);

export function buildInadimplenciaAgregados(
  fila: MonitorFilaRow[],
): InadimplenciaAgregados {
  const solucionadas = fila.filter((r) => r.resolucao_status === "SOLUCIONADO");
  const naoSolucionada = fila.filter(
    (r) => r.resolucao_status !== "SOLUCIONADO",
  );
  const aberta = naoSolucionada.filter((r) =>
    ABERTOS.has(r.status_acompanhamento),
  );

  return {
    novo: naoSolucionada.filter((r) => r.status_acompanhamento === "NOVO")
      .length,
    aguardandoExplicacao: naoSolucionada.filter(
      (r) => r.status_acompanhamento === "AGUARDANDO_EXPLICACAO",
    ).length,
    emCobranca: naoSolucionada.filter(
      (r) => r.status_acompanhamento === "EM_COBRANCA",
    ).length,
    recuperado: naoSolucionada.filter(
      (r) => r.status_acompanhamento === "RECUPERADO",
    ).length,
    recuperavelAberto: aberta.reduce(
      (acc, r) => acc + r.recuperavel_estimado,
      0,
    ),
    solucionado: {
      contagem: solucionadas.length,
      valor: solucionadas.reduce((acc, r) => acc + r.recuperavel_estimado, 0),
    },
  };
}
