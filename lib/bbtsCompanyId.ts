// ============================================================================
// lib/bbtsCompanyId.ts — o company_id da ADS/BBTS, ISOLADO num modulo sem
// dependencias.
//
// Existe para que quem so precisa IDENTIFICAR a ADS (p.ex. a rota de calculo
// diario do RR, que precisa EXCLUI-LA do seu escopo) nao tenha de importar
// lib/bbtsMonthly.ts e arrastar junto motor/TRP/regua BBTS.
//
// FONTE UNICA: lib/bbtsMonthly.ts re-exporta desta constante.
// ============================================================================

export const BBTS_COMPANY_ID = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
