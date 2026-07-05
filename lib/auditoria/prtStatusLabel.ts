// Rotulo PT visivel para o status de auditoria PRT (enum interno -> label da tela).
// SO apresentacao: nao muda nenhum calculo nem o valor do enum; apenas a STRING exibida.
// Compartilhado entre a fila da InadimplenciaSection e o HistoricalFindingsPrt para os
// dois nunca divergirem.
const PRT_STATUS_LABEL: Record<string, string> = {
  OK: "OK",
  OK_DEBITADO: "Justificado (débito/quitação)",
  INTERROMPIDO_SUSPEITO: "Interrompido (suspeito, <12)",
  INTERROMPIDO_LEGITIMO: "Interrompido (≥12 parcelas)",
  NUNCA_PAGO: "Nunca pago",
  AUSENTE: "Ausente do PRT",
};

/** Traduz o enum de status PRT para o label PT. Enum desconhecido cai no proprio valor. */
export function prtStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PRT_STATUS_LABEL[status] ?? status;
}
