-- ============================================================================
-- SEED: trp_rule_versions — abr/mai/jun 2026 (Fase 2 TRP self-service)
-- GERADO por scripts/trp_seed_rule_versions.gen.cjs — NÃO editar à mão.
--
-- Bootstrap da fonte versionada: 1 linha por competência, version_no=1,
-- is_active=true. regra_json = cópia FIEL do JSON canônico (mesmo texto que o
-- motor importa hoje). valid_from/valid_until = vigência holiday-aware do util
-- lib/trp/vigencia.ts. ZERO mudança de comportamento: o motor segue no JSON
-- (flag TRP_SOURCE=json). Rodar no Studio (SQL editor).
--
-- Idempotente: ON CONFLICT (competencia, version_no) DO UPDATE — rodar 2x é
-- seguro e reescreve a mesma linha. Transacional.
-- ============================================================================

begin;

-- ---- 2026-04 (TRP35_2026-04.json) — TRP Nº 2026/187 ----
insert into trp_rule_versions
  (competencia, regime, valid_from, valid_until, version_no, is_active,
   trp_doc_ref, source_filename, notes, regra_json)
values (
  date '2026-04-01',
  'VOLUME_5_FAIXAS',
  date '2026-03-31',
  date '2026-04-29',
  1,
  true,
  'TRP Nº 2026/187',
  'TRP35 - PROMOTIVA 042026.pdf',
  'F2 bootstrap seed — fonte: regras_promotiva/json/TRP35_2026-04.json',
  $rulejson${
  "_meta": {
    "trp": "TRP Nº 2026/187",
    "opp_referencia": "OPP PR2026/023",
    "competencia": "2026-04",
    "regime": "VOLUME_5_FAIXAS",
    "fonte_pdf": "C:\\Users\\diego\\Downloads\\TRP35 - PROMOTIVA 042026.pdf",
    "categorias": ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5"],
    "limites_categoria": {
      "Faixa 1": {"prod_min": 0,         "teto_avista": 0.0600},
      "Faixa 2": {"prod_min": 1000000,   "teto_avista": 0.0600},
      "Faixa 3": {"prod_min": 3000000,   "teto_avista": 0.0600},
      "Faixa 4": {"prod_min": 7000000,   "teto_avista": 0.0600},
      "Faixa 5": {"prod_min": 20000000,  "teto_avista": 0.0600}
    },
    "observacoes": [
      "Citação literal: 'a remuneração está condicionada ao volume de produção apurado mensalmente. Os parceiros são classificados em cinco categorias, sendo que, em todas as categorias, o comissionamento à vista é limitado em até 6%.'",
      "Citação literal: 'O volume de produção será apurado com base na produção líquida, desconsiderando as operações com a restrição SRCC.'",
      "Citação literal: 'Para que a operação esteja apta a ser remunerada, é imprescindível que a linha do produto, taxa de juros, prazo e ticket mínimo estejam devidamente previstos e em conformidade com as especificações contidas na tabela vigente.'",
      "Diferenças com TRP34 (VOLUME_3_PERFIS): mesma lista de produtos, mesmo schema; muda só o conjunto de categorias (5 Faixas vs Rubi/Safira/Diamante) e o teto à vista é UNIFORME 6,00% em todas, mas a matriz interna de pcts varia por Faixa em todas as células.",
      "Confirmação interpretação Diego: célula INSS Novo prazo 48-60 taxa 1,85% retorna pcts diferentes em cada Faixa (1,96 / 1,97 / 2,03 / 2,12 / 2,15) — não é apenas hard-code de teto."
    ]
  },
  "INSS_NOVO": {
    "_titulo": "1.2 - Crédito Consignado INSS Novo",
    "tx_juros_fixa": 0.0185,
    "tiquete_min": 100.00,
    "custo_processamento": 2.03,
    "celulas_prazo": [
      {"prazo_min": 48, "prazo_max": 60,  "Faixa 1": 0.0196, "Faixa 2": 0.0197, "Faixa 3": 0.0203, "Faixa 4": 0.0212, "Faixa 5": 0.0215},
      {"prazo_min": 61, "prazo_max": 84,  "Faixa 1": 0.0235, "Faixa 2": 0.0237, "Faixa 3": 0.0244, "Faixa 4": 0.0255, "Faixa 5": 0.0258},
      {"prazo_min": 85, "prazo_max": 999, "Faixa 1": 0.0321, "Faixa 2": 0.0323, "Faixa 3": 0.0334, "Faixa 4": 0.0348, "Faixa 5": 0.0352}
    ]
  },
  "INSS_RENOV": {
    "_titulo": "1.3 - Crédito Consignado INSS Renovação",
    "tx_juros_min": 0.0100,
    "tiquete_min": 100.00,
    "custo_processamento": 2.03,
    "celulas_prazo": [
      {"prazo_min": 48, "prazo_max": 60,  "Faixa 1": 0.0196, "Faixa 2": 0.0197, "Faixa 3": 0.0203, "Faixa 4": 0.0212, "Faixa 5": 0.0215},
      {"prazo_min": 61, "prazo_max": 84,  "Faixa 1": 0.0235, "Faixa 2": 0.0237, "Faixa 3": 0.0244, "Faixa 4": 0.0255, "Faixa 5": 0.0258},
      {"prazo_min": 85, "prazo_max": 999, "Faixa 1": 0.0321, "Faixa 2": 0.0323, "Faixa 3": 0.0334, "Faixa 4": 0.0348, "Faixa 5": 0.0352}
    ]
  },
  "CONSIG_PUBLICO": {
    "_titulo": "1.4 - Consignado Geral Público",
    "prazo_min": 36,
    "tiquete_min": 100.00,
    "custo_processamento": "2.5% ou R$ 5,00",
    "celulas_taxa": [
      {"tx_min": 0.0175, "tx_max": 0.0177, "Faixa 1": 0.0078, "Faixa 2": 0.0079, "Faixa 3": 0.0081, "Faixa 4": 0.0085, "Faixa 5": 0.0086},
      {"tx_min": 0.0178, "tx_max": 0.0187, "Faixa 1": 0.0235, "Faixa 2": 0.0237, "Faixa 3": 0.0244, "Faixa 4": 0.0255, "Faixa 5": 0.0258},
      {"tx_min": 0.0188, "tx_max": 0.0197, "Faixa 1": 0.0353, "Faixa 2": 0.0355, "Faixa 3": 0.0366, "Faixa 4": 0.0382, "Faixa 5": 0.0387},
      {"tx_min": 0.0198, "tx_max": 0.0207, "Faixa 1": 0.0431, "Faixa 2": 0.0434, "Faixa 3": 0.0448, "Faixa 4": 0.0467, "Faixa 5": 0.0473},
      {"tx_min": 0.0208, "tx_max": 0.0217, "Faixa 1": 0.0471, "Faixa 2": 0.0474, "Faixa 3": 0.0489, "Faixa 4": 0.0510, "Faixa 5": 0.0516},
      {"tx_min": 0.0218, "tx_max": 0.0227, "Faixa 1": 0.0588, "Faixa 2": 0.0592, "Faixa 3": 0.0611, "Faixa 4": 0.0637, "Faixa 5": 0.0645},
      {"tx_min": 0.0228, "tx_max": 0.0237, "Faixa 1": 0.0667, "Faixa 2": 0.0671, "Faixa 3": 0.0692, "Faixa 4": 0.0722, "Faixa 5": 0.0731},
      {"tx_min": 0.0238, "tx_max": 0.0247, "Faixa 1": 0.0785, "Faixa 2": 0.0790, "Faixa 3": 0.0815, "Faixa 4": 0.0850, "Faixa 5": 0.0860},
      {"tx_min": 0.0248, "tx_max": 999,    "Faixa 1": 0.0902, "Faixa 2": 0.0908, "Faixa 3": 0.0937, "Faixa 4": 0.0977, "Faixa 5": 0.0989}
    ]
  },
  "SIAPE": {
    "_titulo": "1.5 - Consignado Convênio SIAPE",
    "convenio": "1078",
    "prazo_min": 48,
    "tiquete_min": 100.00,
    "custo_processamento": 3.08,
    "celulas_taxa": [
      {"tx_min": 0.0164, "tx_max": 0.0167, "Faixa 1": 0.0094, "Faixa 2": 0.0095, "Faixa 3": 0.0097, "Faixa 4": 0.0102, "Faixa 5": 0.0103},
      {"tx_min": 0.0168, "tx_max": 0.0179, "Faixa 1": 0.0235, "Faixa 2": 0.0237, "Faixa 3": 0.0244, "Faixa 4": 0.0255, "Faixa 5": 0.0258},
      {"tx_min": 0.0180, "tx_max": 0.0180, "Faixa 1": 0.0321, "Faixa 2": 0.0323, "Faixa 3": 0.0334, "Faixa 4": 0.0348, "Faixa 5": 0.0352}
    ]
  },
  "CONSIG_SP_MG": {
    "_titulo": "1.6 - Consignado Convênio SP e MG",
    "prazo_min": 36,
    "tiquete_min": 100.00,
    "custo_processamento": "2.5% ou R$ 5,00",
    "celulas_taxa": [
      {"tx_min": 0.0172, "tx_max": 0.0179, "Faixa 1": 0.0125, "Faixa 2": 0.0126, "Faixa 3": 0.0130, "Faixa 4": 0.0136, "Faixa 5": 0.0137},
      {"tx_min": 0.0180, "tx_max": 0.0189, "Faixa 1": 0.0243, "Faixa 2": 0.0244, "Faixa 3": 0.0252, "Faixa 4": 0.0263, "Faixa 5": 0.0266},
      {"tx_min": 0.0190, "tx_max": 0.0199, "Faixa 1": 0.0353, "Faixa 2": 0.0355, "Faixa 3": 0.0366, "Faixa 4": 0.0382, "Faixa 5": 0.0387},
      {"tx_min": 0.0200, "tx_max": 0.0209, "Faixa 1": 0.0431, "Faixa 2": 0.0434, "Faixa 3": 0.0448, "Faixa 4": 0.0467, "Faixa 5": 0.0473},
      {"tx_min": 0.0210, "tx_max": 0.0219, "Faixa 1": 0.0510, "Faixa 2": 0.0513, "Faixa 3": 0.0529, "Faixa 4": 0.0552, "Faixa 5": 0.0559},
      {"tx_min": 0.0220, "tx_max": 0.0229, "Faixa 1": 0.0588, "Faixa 2": 0.0592, "Faixa 3": 0.0611, "Faixa 4": 0.0637, "Faixa 5": 0.0645},
      {"tx_min": 0.0230, "tx_max": 0.0239, "Faixa 1": 0.0667, "Faixa 2": 0.0671, "Faixa 3": 0.0692, "Faixa 4": 0.0722, "Faixa 5": 0.0731},
      {"tx_min": 0.0240, "tx_max": 0.0249, "Faixa 1": 0.0785, "Faixa 2": 0.0790, "Faixa 3": 0.0815, "Faixa 4": 0.0850, "Faixa 5": 0.0860},
      {"tx_min": 0.0250, "tx_max": 999,    "Faixa 1": 0.0902, "Faixa 2": 0.0908, "Faixa 3": 0.0937, "Faixa 4": 0.0977, "Faixa 5": 0.0989}
    ]
  },
  "CONSIG_PRIVADO": {
    "_titulo": "1.7 - Consignado Convênio Privado",
    "tiquete_min": 2000.00,
    "_observacao": "Schema com 4 linhas. Linha 1 cobre prazo 18-35 (taxa A partir de 2,54%). Linhas 2-4 cobrem prazo >=36 segmentadas por taxa.",
    "celulas_taxa_prazo": [
      {"tx_min": 0.0254, "tx_max": 999,    "prazo_min": 18, "prazo_max": 35,  "Faixa 1": 0.0078, "Faixa 2": 0.0079, "Faixa 3": 0.0081, "Faixa 4": 0.0085, "Faixa 5": 0.0086},
      {"tx_min": 0.0254, "tx_max": 0.0299, "prazo_min": 36, "prazo_max": 999, "Faixa 1": 0.0235, "Faixa 2": 0.0237, "Faixa 3": 0.0244, "Faixa 4": 0.0255, "Faixa 5": 0.0258},
      {"tx_min": 0.0300, "tx_max": 0.0350, "prazo_min": 36, "prazo_max": 999, "Faixa 1": 0.0314, "Faixa 2": 0.0316, "Faixa 3": 0.0326, "Faixa 4": 0.0340, "Faixa 5": 0.0344},
      {"tx_min": 0.0351, "tx_max": 999,    "prazo_min": 36, "prazo_max": 999, "Faixa 1": 0.0392, "Faixa 2": 0.0395, "Faixa 3": 0.0407, "Faixa 4": 0.0425, "Faixa 5": 0.0430}
    ]
  },
  "PORTAB_PUBLICO": {
    "_titulo": "2.2 - Portabilidade Convênio Público",
    "_observacao": "Sem variação por Faixa — pct é Geral",
    "prazo_min": 48,
    "tiquete_min": 2500.00,
    "custo_processamento": "2.5% ou R$ 5,00",
    "celulas_taxa": [
      {"tx_min": 0.0173, "tx_max": 0.0189, "pct_geral": 0.0072},
      {"tx_min": 0.0190, "tx_max": 999,    "pct_geral": 0.0225}
    ]
  },
  "PORTAB_PRIVADO": {
    "_titulo": "2.3 - Portabilidade Convênio Privado",
    "_observacao": "Sem variação por Faixa — pct é Geral",
    "prazo_min": 36,
    "tiquete_min": 2500.00,
    "custo_processamento": "2.5% ou R$ 5,00",
    "celulas_taxa": [
      {"tx_min": 0.0254, "tx_max": 0.0299, "pct_geral": 0.0045},
      {"tx_min": 0.0300, "tx_max": 999,    "pct_geral": 0.0180}
    ]
  },
  "NAO_CONSIGNADO": {
    "_titulo": "3.2 - Crédito Não Consignado (Automático, Salário e Benefício)",
    "prazo_min": 13,
    "tiquete_min": 100.00,
    "celulas_taxa": [
      {"tx_min": 0.0292, "tx_max": 0.0337, "Faixa 1": 0.0196, "Faixa 2": 0.0197, "Faixa 3": 0.0203, "Faixa 4": 0.0212, "Faixa 5": 0.0215},
      {"tx_min": 0.0338, "tx_max": 0.0383, "Faixa 1": 0.0274, "Faixa 2": 0.0276, "Faixa 3": 0.0285, "Faixa 4": 0.0297, "Faixa 5": 0.0301},
      {"tx_min": 0.0384, "tx_max": 0.0429, "Faixa 1": 0.0353, "Faixa 2": 0.0355, "Faixa 3": 0.0366, "Faixa 4": 0.0382, "Faixa 5": 0.0387},
      {"tx_min": 0.0430, "tx_max": 0.0475, "Faixa 1": 0.0431, "Faixa 2": 0.0434, "Faixa 3": 0.0448, "Faixa 4": 0.0467, "Faixa 5": 0.0473},
      {"tx_min": 0.0476, "tx_max": 0.0538, "Faixa 1": 0.0549, "Faixa 2": 0.0553, "Faixa 3": 0.0570, "Faixa 4": 0.0595, "Faixa 5": 0.0602},
      {"tx_min": 0.0539, "tx_max": 999,    "Faixa 1": 0.0824, "Faixa 2": 0.0829, "Faixa 3": 0.0855, "Faixa 4": 0.0892, "Faixa 5": 0.0903}
    ]
  },
  "ADIANTAMENTO_13": {
    "_titulo": "3.3 - Adiantamento 13º Salário",
    "tx_juros_min": 0.0325,
    "prazo_min": 5,
    "tiquete_min": 100.00,
    "celulas": [
      {"prazo_min": 5, "prazo_max": 999, "Faixa 1": 0.0235, "Faixa 2": 0.0237, "Faixa 3": 0.0244, "Faixa 4": 0.0255, "Faixa 5": 0.0258}
    ]
  },
  "FGTS": {
    "_titulo": "3.4 - CDC FGTS Saque Aniversário",
    "_observacao": "Sem variação por Faixa — % é Geral",
    "tx_juros_fixa": 0.0179,
    "prazo_min": 36,
    "prazo_max": 84,
    "tiquete_min": 1000.00,
    "pct_geral": 0.0420
  }
}
$rulejson$::jsonb
)
on conflict (competencia, version_no) do update set
  regime          = excluded.regime,
  valid_from      = excluded.valid_from,
  valid_until     = excluded.valid_until,
  is_active       = excluded.is_active,
  trp_doc_ref     = excluded.trp_doc_ref,
  source_filename = excluded.source_filename,
  notes           = excluded.notes,
  regra_json      = excluded.regra_json;

-- ---- 2026-05 (TRP36_2026-05.json) — TRP Nº 2026/194 ----
insert into trp_rule_versions
  (competencia, regime, valid_from, valid_until, version_no, is_active,
   trp_doc_ref, source_filename, notes, regra_json)
values (
  date '2026-05-01',
  'VOLUME_5_FAIXAS',
  date '2026-04-30',
  date '2026-05-28',
  1,
  true,
  'TRP Nº 2026/194',
  'TRP36 - PROMOTIVA 052026.pdf',
  'F2 bootstrap seed — fonte: regras_promotiva/json/TRP36_2026-05.json',
  $rulejson${
 "_meta": {
  "trp": "TRP Nº 2026/194",
  "opp_referencia": "OPP PR2026/023",
  "competencia": "2026-05",
  "regime": "VOLUME_5_FAIXAS",
  "fonte_pdf": "C:\\Users\\diego\\Documents\\Codex\\2026-04-20-files-mentioned-by-the-user-sistema\\repo\\Sistema-RR-main\\TRP36 - PROMOTIVA 052026.pdf",
  "vigencia_inicio": "2026-04-30",
  "vigencia_fim": "2026-05-28",
  "vigencia_regra": "último dia útil do mês anterior → penúltimo dia útil do mês nominal (holiday-aware)",
  "categorias": [
   "Faixa 1",
   "Faixa 2",
   "Faixa 3",
   "Faixa 4",
   "Faixa 5"
  ],
  "limites_categoria": {
   "Faixa 1": {
    "prod_min": 0,
    "teto_avista": 0.06
   },
   "Faixa 2": {
    "prod_min": 1000000,
    "teto_avista": 0.06
   },
   "Faixa 3": {
    "prod_min": 3000000,
    "teto_avista": 0.06
   },
   "Faixa 4": {
    "prod_min": 7000000,
    "teto_avista": 0.06
   },
   "Faixa 5": {
    "prod_min": 20000000,
    "teto_avista": 0.06
   }
  },
  "observacoes": [
   "Gerado a partir de trp36_extracted.json (Etapa 1 — parser pdfplumber ancora-rotulo).",
   "Matriz cross-checada: TRP36 PDF == TRP37_2026-06.json APROVADO nos 11 produtos (205/205 celulas); TRP36 PDF == TRP37 PDF exceto rotulo do mes e numero do TRP (2026/194 vs 2026/201).",
   "Limite aberto ('A partir de'/'Acima de') = 999 neste JSON (convenção do motor).",
   "1.7 (CONSIG_PRIVADO) populado com prazo por célula.",
   "Vigencia holiday-aware: ultimo dia util de abril (2026-04-30) -> penultimo dia util de maio (2026-05-28); a mesma regra reproduz as datas oficiais de junho (2026-05-29 -> 2026-06-29)."
  ]
 },
 "INSS_NOVO": {
  "_titulo": "1.2 - Crédito Consignado INSS Novo",
  "tx_juros_fixa": 0.0185,
  "tiquete_min": 100,
  "custo_processamento": 2.03,
  "celulas_prazo": [
   {
    "prazo_min": 48,
    "prazo_max": 60,
    "Faixa 1": 0.0196,
    "Faixa 2": 0.0197,
    "Faixa 3": 0.0203,
    "Faixa 4": 0.0212,
    "Faixa 5": 0.0215
   },
   {
    "prazo_min": 61,
    "prazo_max": 84,
    "Faixa 1": 0.0235,
    "Faixa 2": 0.0237,
    "Faixa 3": 0.0244,
    "Faixa 4": 0.0255,
    "Faixa 5": 0.0258
   },
   {
    "prazo_min": 85,
    "prazo_max": 999,
    "Faixa 1": 0.0321,
    "Faixa 2": 0.0323,
    "Faixa 3": 0.0334,
    "Faixa 4": 0.0348,
    "Faixa 5": 0.0352
   }
  ]
 },
 "INSS_RENOV": {
  "_titulo": "1.3 - Crédito Consignado INSS Renovação",
  "tx_juros_min": 0.01,
  "tiquete_min": 100,
  "custo_processamento": 2.03,
  "celulas_prazo": [
   {
    "prazo_min": 48,
    "prazo_max": 60,
    "Faixa 1": 0.0196,
    "Faixa 2": 0.0197,
    "Faixa 3": 0.0203,
    "Faixa 4": 0.0212,
    "Faixa 5": 0.0215
   },
   {
    "prazo_min": 61,
    "prazo_max": 84,
    "Faixa 1": 0.0235,
    "Faixa 2": 0.0237,
    "Faixa 3": 0.0244,
    "Faixa 4": 0.0255,
    "Faixa 5": 0.0258
   },
   {
    "prazo_min": 85,
    "prazo_max": 999,
    "Faixa 1": 0.0321,
    "Faixa 2": 0.0323,
    "Faixa 3": 0.0334,
    "Faixa 4": 0.0348,
    "Faixa 5": 0.0352
   }
  ]
 },
 "CONSIG_PUBLICO": {
  "_titulo": "1.4 - Crédito Consignado Geral – Público",
  "prazo_min": 36,
  "tiquete_min": 100,
  "custo_processamento": "2,5% ou R$ 5,00",
  "celulas_taxa": [
   {
    "tx_min": 0.0175,
    "tx_max": 0.0177,
    "Faixa 1": 0.0078,
    "Faixa 2": 0.0079,
    "Faixa 3": 0.0081,
    "Faixa 4": 0.0085,
    "Faixa 5": 0.0086
   },
   {
    "tx_min": 0.0178,
    "tx_max": 0.0187,
    "Faixa 1": 0.0235,
    "Faixa 2": 0.0237,
    "Faixa 3": 0.0244,
    "Faixa 4": 0.0255,
    "Faixa 5": 0.0258
   },
   {
    "tx_min": 0.0188,
    "tx_max": 0.0197,
    "Faixa 1": 0.0353,
    "Faixa 2": 0.0355,
    "Faixa 3": 0.0366,
    "Faixa 4": 0.0382,
    "Faixa 5": 0.0387
   },
   {
    "tx_min": 0.0198,
    "tx_max": 0.0207,
    "Faixa 1": 0.0431,
    "Faixa 2": 0.0434,
    "Faixa 3": 0.0448,
    "Faixa 4": 0.0467,
    "Faixa 5": 0.0473
   },
   {
    "tx_min": 0.0208,
    "tx_max": 0.0217,
    "Faixa 1": 0.0471,
    "Faixa 2": 0.0474,
    "Faixa 3": 0.0489,
    "Faixa 4": 0.051,
    "Faixa 5": 0.0516
   },
   {
    "tx_min": 0.0218,
    "tx_max": 0.0227,
    "Faixa 1": 0.0588,
    "Faixa 2": 0.0592,
    "Faixa 3": 0.0611,
    "Faixa 4": 0.0637,
    "Faixa 5": 0.0645
   },
   {
    "tx_min": 0.0228,
    "tx_max": 0.0237,
    "Faixa 1": 0.0667,
    "Faixa 2": 0.0671,
    "Faixa 3": 0.0692,
    "Faixa 4": 0.0722,
    "Faixa 5": 0.0731
   },
   {
    "tx_min": 0.0238,
    "tx_max": 0.0247,
    "Faixa 1": 0.0785,
    "Faixa 2": 0.079,
    "Faixa 3": 0.0815,
    "Faixa 4": 0.085,
    "Faixa 5": 0.086
   },
   {
    "tx_min": 0.0248,
    "tx_max": 999,
    "Faixa 1": 0.0902,
    "Faixa 2": 0.0908,
    "Faixa 3": 0.0937,
    "Faixa 4": 0.0977,
    "Faixa 5": 0.0989
   }
  ]
 },
 "SIAPE": {
  "_titulo": "1.5 - Crédito Consignado – Convênio SIAPE",
  "convenio": "1078",
  "prazo_min": 48,
  "tiquete_min": 100,
  "custo_processamento": 3.08,
  "celulas_taxa": [
   {
    "tx_min": 0.0164,
    "tx_max": 0.0167,
    "Faixa 1": 0.0094,
    "Faixa 2": 0.0095,
    "Faixa 3": 0.0097,
    "Faixa 4": 0.0102,
    "Faixa 5": 0.0103
   },
   {
    "tx_min": 0.0168,
    "tx_max": 0.0179,
    "Faixa 1": 0.0235,
    "Faixa 2": 0.0237,
    "Faixa 3": 0.0244,
    "Faixa 4": 0.0255,
    "Faixa 5": 0.0258
   },
   {
    "tx_min": 0.018,
    "tx_max": 0.018,
    "Faixa 1": 0.0321,
    "Faixa 2": 0.0323,
    "Faixa 3": 0.0334,
    "Faixa 4": 0.0348,
    "Faixa 5": 0.0352
   }
  ]
 },
 "CONSIG_SP_MG": {
  "_titulo": "1.6 - Crédito Consignado – Convênio SP e MG",
  "prazo_min": 36,
  "tiquete_min": 100,
  "custo_processamento": "2,5% ou R$ 5,00",
  "celulas_taxa": [
   {
    "tx_min": 0.0172,
    "tx_max": 0.0179,
    "Faixa 1": 0.0125,
    "Faixa 2": 0.0126,
    "Faixa 3": 0.013,
    "Faixa 4": 0.0136,
    "Faixa 5": 0.0137
   },
   {
    "tx_min": 0.018,
    "tx_max": 0.0189,
    "Faixa 1": 0.0243,
    "Faixa 2": 0.0244,
    "Faixa 3": 0.0252,
    "Faixa 4": 0.0263,
    "Faixa 5": 0.0266
   },
   {
    "tx_min": 0.019,
    "tx_max": 0.0199,
    "Faixa 1": 0.0353,
    "Faixa 2": 0.0355,
    "Faixa 3": 0.0366,
    "Faixa 4": 0.0382,
    "Faixa 5": 0.0387
   },
   {
    "tx_min": 0.02,
    "tx_max": 0.0209,
    "Faixa 1": 0.0431,
    "Faixa 2": 0.0434,
    "Faixa 3": 0.0448,
    "Faixa 4": 0.0467,
    "Faixa 5": 0.0473
   },
   {
    "tx_min": 0.021,
    "tx_max": 0.0219,
    "Faixa 1": 0.051,
    "Faixa 2": 0.0513,
    "Faixa 3": 0.0529,
    "Faixa 4": 0.0552,
    "Faixa 5": 0.0559
   },
   {
    "tx_min": 0.022,
    "tx_max": 0.0229,
    "Faixa 1": 0.0588,
    "Faixa 2": 0.0592,
    "Faixa 3": 0.0611,
    "Faixa 4": 0.0637,
    "Faixa 5": 0.0645
   },
   {
    "tx_min": 0.023,
    "tx_max": 0.0239,
    "Faixa 1": 0.0667,
    "Faixa 2": 0.0671,
    "Faixa 3": 0.0692,
    "Faixa 4": 0.0722,
    "Faixa 5": 0.0731
   },
   {
    "tx_min": 0.024,
    "tx_max": 0.0249,
    "Faixa 1": 0.0785,
    "Faixa 2": 0.079,
    "Faixa 3": 0.0815,
    "Faixa 4": 0.085,
    "Faixa 5": 0.086
   },
   {
    "tx_min": 0.025,
    "tx_max": 999,
    "Faixa 1": 0.0902,
    "Faixa 2": 0.0908,
    "Faixa 3": 0.0937,
    "Faixa 4": 0.0977,
    "Faixa 5": 0.0989
   }
  ]
 },
 "CONSIG_PRIVADO": {
  "_titulo": "1.7 - Crédito Consignado – Convênio Privado",
  "_observacao": "Linha 1 cobre prazo 18-35 (taxa A partir de 2,54%). Linhas 2-4 cobrem prazo >=36 segmentadas por taxa.",
  "tiquete_min": 2000,
  "celulas_taxa_prazo": [
   {
    "tx_min": 0.0254,
    "tx_max": 999,
    "prazo_min": 18,
    "prazo_max": 35,
    "Faixa 1": 0.0078,
    "Faixa 2": 0.0079,
    "Faixa 3": 0.0081,
    "Faixa 4": 0.0085,
    "Faixa 5": 0.0086
   },
   {
    "tx_min": 0.0254,
    "tx_max": 0.0299,
    "prazo_min": 36,
    "prazo_max": 999,
    "Faixa 1": 0.0235,
    "Faixa 2": 0.0237,
    "Faixa 3": 0.0244,
    "Faixa 4": 0.0255,
    "Faixa 5": 0.0258
   },
   {
    "tx_min": 0.03,
    "tx_max": 0.035,
    "prazo_min": 36,
    "prazo_max": 999,
    "Faixa 1": 0.0314,
    "Faixa 2": 0.0316,
    "Faixa 3": 0.0326,
    "Faixa 4": 0.034,
    "Faixa 5": 0.0344
   },
   {
    "tx_min": 0.0351,
    "tx_max": 999,
    "prazo_min": 36,
    "prazo_max": 999,
    "Faixa 1": 0.0392,
    "Faixa 2": 0.0395,
    "Faixa 3": 0.0407,
    "Faixa 4": 0.0425,
    "Faixa 5": 0.043
   }
  ]
 },
 "PORTAB_PUBLICO": {
  "_titulo": "2.2 - Portabilidade Convênio Público",
  "_observacao": "Sem variação por Faixa — pct é Geral",
  "prazo_min": 48,
  "tiquete_min": 2500,
  "custo_processamento": "2,5% ou R$ 5,00",
  "celulas_taxa": [
   {
    "tx_min": 0.0173,
    "tx_max": 0.0189,
    "pct_geral": 0.0072
   },
   {
    "tx_min": 0.019,
    "tx_max": 999,
    "pct_geral": 0.0225
   }
  ]
 },
 "PORTAB_PRIVADO": {
  "_titulo": "2.3 - Portabilidade Convênio Privado",
  "_observacao": "Sem variação por Faixa — pct é Geral",
  "prazo_min": 36,
  "tiquete_min": 2500,
  "custo_processamento": "2,5% ou R$ 5,00",
  "celulas_taxa": [
   {
    "tx_min": 0.0254,
    "tx_max": 0.0299,
    "pct_geral": 0.0045
   },
   {
    "tx_min": 0.03,
    "tx_max": 999,
    "pct_geral": 0.018
   }
  ]
 },
 "NAO_CONSIGNADO": {
  "_titulo": "3.2 - Crédito Não Consignado (Automático, Salário e Benefício)",
  "prazo_min": 13,
  "tiquete_min": 100,
  "celulas_taxa": [
   {
    "tx_min": 0.0292,
    "tx_max": 0.0337,
    "Faixa 1": 0.0196,
    "Faixa 2": 0.0197,
    "Faixa 3": 0.0203,
    "Faixa 4": 0.0212,
    "Faixa 5": 0.0215
   },
   {
    "tx_min": 0.0338,
    "tx_max": 0.0383,
    "Faixa 1": 0.0274,
    "Faixa 2": 0.0276,
    "Faixa 3": 0.0285,
    "Faixa 4": 0.0297,
    "Faixa 5": 0.0301
   },
   {
    "tx_min": 0.0384,
    "tx_max": 0.0429,
    "Faixa 1": 0.0353,
    "Faixa 2": 0.0355,
    "Faixa 3": 0.0366,
    "Faixa 4": 0.0382,
    "Faixa 5": 0.0387
   },
   {
    "tx_min": 0.043,
    "tx_max": 0.0475,
    "Faixa 1": 0.0431,
    "Faixa 2": 0.0434,
    "Faixa 3": 0.0448,
    "Faixa 4": 0.0467,
    "Faixa 5": 0.0473
   },
   {
    "tx_min": 0.0476,
    "tx_max": 0.0538,
    "Faixa 1": 0.0549,
    "Faixa 2": 0.0553,
    "Faixa 3": 0.057,
    "Faixa 4": 0.0595,
    "Faixa 5": 0.0602
   },
   {
    "tx_min": 0.0539,
    "tx_max": 999,
    "Faixa 1": 0.0824,
    "Faixa 2": 0.0829,
    "Faixa 3": 0.0855,
    "Faixa 4": 0.0892,
    "Faixa 5": 0.0903
   }
  ]
 },
 "ADIANTAMENTO_13": {
  "_titulo": "3.3 - Adiantamento 13º Salário",
  "tx_juros_min": 0.0325,
  "prazo_min": 5,
  "tiquete_min": 100,
  "celulas": [
   {
    "prazo_min": 5,
    "prazo_max": 999,
    "Faixa 1": 0.0235,
    "Faixa 2": 0.0237,
    "Faixa 3": 0.0244,
    "Faixa 4": 0.0255,
    "Faixa 5": 0.0258
   }
  ]
 },
 "FGTS": {
  "_titulo": "3.4 - CDC FGTS Saque Aniversário",
  "_observacao": "Sem variação por Faixa — % é Geral",
  "tx_juros_fixa": 0.0179,
  "prazo_min": 36,
  "prazo_max": 84,
  "tiquete_min": 1000,
  "pct_geral": 0.042
 }
}$rulejson$::jsonb
)
on conflict (competencia, version_no) do update set
  regime          = excluded.regime,
  valid_from      = excluded.valid_from,
  valid_until     = excluded.valid_until,
  is_active       = excluded.is_active,
  trp_doc_ref     = excluded.trp_doc_ref,
  source_filename = excluded.source_filename,
  notes           = excluded.notes,
  regra_json      = excluded.regra_json;

-- ---- 2026-06 (TRP37_2026-06.json) — TRP Nº 2026/201 ----
insert into trp_rule_versions
  (competencia, regime, valid_from, valid_until, version_no, is_active,
   trp_doc_ref, source_filename, notes, regra_json)
values (
  date '2026-06-01',
  'VOLUME_5_FAIXAS',
  date '2026-05-29',
  date '2026-06-29',
  1,
  true,
  'TRP Nº 2026/201',
  'TRP37 - PROMOTIVA 062026.pdf',
  'F2 bootstrap seed — fonte: regras_promotiva/json/TRP37_2026-06.json',
  $rulejson${
  "_meta": {
    "trp": "TRP Nº 2026/201",
    "opp_referencia": "OPP PR2026/023",
    "competencia": "2026-06",
    "regime": "VOLUME_5_FAIXAS",
    "fonte_pdf": "C:\\Users\\diego\\Documents\\Codex\\2026-04-20-files-mentioned-by-the-user-sistema\\repo\\Sistema-RR-main\\TRP37 - PROMOTIVA 062026.pdf",
    "vigencia_inicio": "2026-05-29",
    "vigencia_fim": "2026-06-29",
    "vigencia_regra": "último dia útil do mês anterior → penúltimo dia útil do mês nominal (holiday-aware)",
    "categorias": [
      "Faixa 1",
      "Faixa 2",
      "Faixa 3",
      "Faixa 4",
      "Faixa 5"
    ],
    "limites_categoria": {
      "Faixa 1": {
        "prod_min": 0,
        "teto_avista": 0.06
      },
      "Faixa 2": {
        "prod_min": 1000000,
        "teto_avista": 0.06
      },
      "Faixa 3": {
        "prod_min": 3000000,
        "teto_avista": 0.06
      },
      "Faixa 4": {
        "prod_min": 7000000,
        "teto_avista": 0.06
      },
      "Faixa 5": {
        "prod_min": 20000000,
        "teto_avista": 0.06
      }
    },
    "observacoes": [
      "Gerado na Etapa 2 (isolado) a partir de trp37_extracted.json (Etapa 1 aprovada).",
      "Limite aberto ('A partir de'/'Acima de') = 999 neste JSON (convenção do motor).",
      "1.7 (CONSIG_PRIVADO) populado com prazo por célula — TRP35 deixou vazio."
    ]
  },
  "INSS_NOVO": {
    "_titulo": "1.2 - Crédito Consignado INSS Novo",
    "tx_juros_fixa": 0.0185,
    "tiquete_min": 100.0,
    "custo_processamento": 2.03,
    "celulas_prazo": [
      {
        "prazo_min": 48,
        "prazo_max": 60,
        "Faixa 1": 0.0196,
        "Faixa 2": 0.0197,
        "Faixa 3": 0.0203,
        "Faixa 4": 0.0212,
        "Faixa 5": 0.0215
      },
      {
        "prazo_min": 61,
        "prazo_max": 84,
        "Faixa 1": 0.0235,
        "Faixa 2": 0.0237,
        "Faixa 3": 0.0244,
        "Faixa 4": 0.0255,
        "Faixa 5": 0.0258
      },
      {
        "prazo_min": 85,
        "prazo_max": 999,
        "Faixa 1": 0.0321,
        "Faixa 2": 0.0323,
        "Faixa 3": 0.0334,
        "Faixa 4": 0.0348,
        "Faixa 5": 0.0352
      }
    ]
  },
  "INSS_RENOV": {
    "_titulo": "1.3 - Crédito Consignado INSS Renovação",
    "tx_juros_min": 0.01,
    "tiquete_min": 100.0,
    "custo_processamento": 2.03,
    "celulas_prazo": [
      {
        "prazo_min": 48,
        "prazo_max": 60,
        "Faixa 1": 0.0196,
        "Faixa 2": 0.0197,
        "Faixa 3": 0.0203,
        "Faixa 4": 0.0212,
        "Faixa 5": 0.0215
      },
      {
        "prazo_min": 61,
        "prazo_max": 84,
        "Faixa 1": 0.0235,
        "Faixa 2": 0.0237,
        "Faixa 3": 0.0244,
        "Faixa 4": 0.0255,
        "Faixa 5": 0.0258
      },
      {
        "prazo_min": 85,
        "prazo_max": 999,
        "Faixa 1": 0.0321,
        "Faixa 2": 0.0323,
        "Faixa 3": 0.0334,
        "Faixa 4": 0.0348,
        "Faixa 5": 0.0352
      }
    ]
  },
  "CONSIG_PUBLICO": {
    "_titulo": "1.4 - Crédito Consignado Geral – Público",
    "prazo_min": 36,
    "tiquete_min": 100.0,
    "custo_processamento": "2,5% ou R$ 5,00",
    "celulas_taxa": [
      {
        "tx_min": 0.0175,
        "tx_max": 0.0177,
        "Faixa 1": 0.0078,
        "Faixa 2": 0.0079,
        "Faixa 3": 0.0081,
        "Faixa 4": 0.0085,
        "Faixa 5": 0.0086
      },
      {
        "tx_min": 0.0178,
        "tx_max": 0.0187,
        "Faixa 1": 0.0235,
        "Faixa 2": 0.0237,
        "Faixa 3": 0.0244,
        "Faixa 4": 0.0255,
        "Faixa 5": 0.0258
      },
      {
        "tx_min": 0.0188,
        "tx_max": 0.0197,
        "Faixa 1": 0.0353,
        "Faixa 2": 0.0355,
        "Faixa 3": 0.0366,
        "Faixa 4": 0.0382,
        "Faixa 5": 0.0387
      },
      {
        "tx_min": 0.0198,
        "tx_max": 0.0207,
        "Faixa 1": 0.0431,
        "Faixa 2": 0.0434,
        "Faixa 3": 0.0448,
        "Faixa 4": 0.0467,
        "Faixa 5": 0.0473
      },
      {
        "tx_min": 0.0208,
        "tx_max": 0.0217,
        "Faixa 1": 0.0471,
        "Faixa 2": 0.0474,
        "Faixa 3": 0.0489,
        "Faixa 4": 0.051,
        "Faixa 5": 0.0516
      },
      {
        "tx_min": 0.0218,
        "tx_max": 0.0227,
        "Faixa 1": 0.0588,
        "Faixa 2": 0.0592,
        "Faixa 3": 0.0611,
        "Faixa 4": 0.0637,
        "Faixa 5": 0.0645
      },
      {
        "tx_min": 0.0228,
        "tx_max": 0.0237,
        "Faixa 1": 0.0667,
        "Faixa 2": 0.0671,
        "Faixa 3": 0.0692,
        "Faixa 4": 0.0722,
        "Faixa 5": 0.0731
      },
      {
        "tx_min": 0.0238,
        "tx_max": 0.0247,
        "Faixa 1": 0.0785,
        "Faixa 2": 0.079,
        "Faixa 3": 0.0815,
        "Faixa 4": 0.085,
        "Faixa 5": 0.086
      },
      {
        "tx_min": 0.0248,
        "tx_max": 999,
        "Faixa 1": 0.0902,
        "Faixa 2": 0.0908,
        "Faixa 3": 0.0937,
        "Faixa 4": 0.0977,
        "Faixa 5": 0.0989
      }
    ]
  },
  "SIAPE": {
    "_titulo": "1.5 - Crédito Consignado – Convênio SIAPE",
    "convenio": "1078",
    "prazo_min": 48,
    "tiquete_min": 100.0,
    "custo_processamento": 3.08,
    "celulas_taxa": [
      {
        "tx_min": 0.0164,
        "tx_max": 0.0167,
        "Faixa 1": 0.0094,
        "Faixa 2": 0.0095,
        "Faixa 3": 0.0097,
        "Faixa 4": 0.0102,
        "Faixa 5": 0.0103
      },
      {
        "tx_min": 0.0168,
        "tx_max": 0.0179,
        "Faixa 1": 0.0235,
        "Faixa 2": 0.0237,
        "Faixa 3": 0.0244,
        "Faixa 4": 0.0255,
        "Faixa 5": 0.0258
      },
      {
        "tx_min": 0.018,
        "tx_max": 0.018,
        "Faixa 1": 0.0321,
        "Faixa 2": 0.0323,
        "Faixa 3": 0.0334,
        "Faixa 4": 0.0348,
        "Faixa 5": 0.0352
      }
    ]
  },
  "CONSIG_SP_MG": {
    "_titulo": "1.6 - Crédito Consignado – Convênio SP e MG",
    "prazo_min": 36,
    "tiquete_min": 100.0,
    "custo_processamento": "2,5% ou R$ 5,00",
    "celulas_taxa": [
      {
        "tx_min": 0.0172,
        "tx_max": 0.0179,
        "Faixa 1": 0.0125,
        "Faixa 2": 0.0126,
        "Faixa 3": 0.013,
        "Faixa 4": 0.0136,
        "Faixa 5": 0.0137
      },
      {
        "tx_min": 0.018,
        "tx_max": 0.0189,
        "Faixa 1": 0.0243,
        "Faixa 2": 0.0244,
        "Faixa 3": 0.0252,
        "Faixa 4": 0.0263,
        "Faixa 5": 0.0266
      },
      {
        "tx_min": 0.019,
        "tx_max": 0.0199,
        "Faixa 1": 0.0353,
        "Faixa 2": 0.0355,
        "Faixa 3": 0.0366,
        "Faixa 4": 0.0382,
        "Faixa 5": 0.0387
      },
      {
        "tx_min": 0.02,
        "tx_max": 0.0209,
        "Faixa 1": 0.0431,
        "Faixa 2": 0.0434,
        "Faixa 3": 0.0448,
        "Faixa 4": 0.0467,
        "Faixa 5": 0.0473
      },
      {
        "tx_min": 0.021,
        "tx_max": 0.0219,
        "Faixa 1": 0.051,
        "Faixa 2": 0.0513,
        "Faixa 3": 0.0529,
        "Faixa 4": 0.0552,
        "Faixa 5": 0.0559
      },
      {
        "tx_min": 0.022,
        "tx_max": 0.0229,
        "Faixa 1": 0.0588,
        "Faixa 2": 0.0592,
        "Faixa 3": 0.0611,
        "Faixa 4": 0.0637,
        "Faixa 5": 0.0645
      },
      {
        "tx_min": 0.023,
        "tx_max": 0.0239,
        "Faixa 1": 0.0667,
        "Faixa 2": 0.0671,
        "Faixa 3": 0.0692,
        "Faixa 4": 0.0722,
        "Faixa 5": 0.0731
      },
      {
        "tx_min": 0.024,
        "tx_max": 0.0249,
        "Faixa 1": 0.0785,
        "Faixa 2": 0.079,
        "Faixa 3": 0.0815,
        "Faixa 4": 0.085,
        "Faixa 5": 0.086
      },
      {
        "tx_min": 0.025,
        "tx_max": 999,
        "Faixa 1": 0.0902,
        "Faixa 2": 0.0908,
        "Faixa 3": 0.0937,
        "Faixa 4": 0.0977,
        "Faixa 5": 0.0989
      }
    ]
  },
  "CONSIG_PRIVADO": {
    "_titulo": "1.7 - Crédito Consignado – Convênio Privado",
    "_observacao": "Linha 1 cobre prazo 18-35 (taxa A partir de 2,54%). Linhas 2-4 cobrem prazo >=36 segmentadas por taxa.",
    "tiquete_min": 2000.0,
    "celulas_taxa_prazo": [
      {
        "tx_min": 0.0254,
        "tx_max": 999,
        "prazo_min": 18,
        "prazo_max": 35,
        "Faixa 1": 0.0078,
        "Faixa 2": 0.0079,
        "Faixa 3": 0.0081,
        "Faixa 4": 0.0085,
        "Faixa 5": 0.0086
      },
      {
        "tx_min": 0.0254,
        "tx_max": 0.0299,
        "prazo_min": 36,
        "prazo_max": 999,
        "Faixa 1": 0.0235,
        "Faixa 2": 0.0237,
        "Faixa 3": 0.0244,
        "Faixa 4": 0.0255,
        "Faixa 5": 0.0258
      },
      {
        "tx_min": 0.03,
        "tx_max": 0.035,
        "prazo_min": 36,
        "prazo_max": 999,
        "Faixa 1": 0.0314,
        "Faixa 2": 0.0316,
        "Faixa 3": 0.0326,
        "Faixa 4": 0.034,
        "Faixa 5": 0.0344
      },
      {
        "tx_min": 0.0351,
        "tx_max": 999,
        "prazo_min": 36,
        "prazo_max": 999,
        "Faixa 1": 0.0392,
        "Faixa 2": 0.0395,
        "Faixa 3": 0.0407,
        "Faixa 4": 0.0425,
        "Faixa 5": 0.043
      }
    ]
  },
  "PORTAB_PUBLICO": {
    "_titulo": "2.2 - Portabilidade Convênio Público",
    "_observacao": "Sem variação por Faixa — pct é Geral",
    "prazo_min": 48,
    "tiquete_min": 2500.0,
    "custo_processamento": "2,5% ou R$ 5,00",
    "celulas_taxa": [
      {
        "tx_min": 0.0173,
        "tx_max": 0.0189,
        "pct_geral": 0.0072
      },
      {
        "tx_min": 0.019,
        "tx_max": 999,
        "pct_geral": 0.0225
      }
    ]
  },
  "PORTAB_PRIVADO": {
    "_titulo": "2.3 - Portabilidade Convênio Privado",
    "_observacao": "Sem variação por Faixa — pct é Geral",
    "prazo_min": 36,
    "tiquete_min": 2500.0,
    "custo_processamento": "2,5% ou R$ 5,00",
    "celulas_taxa": [
      {
        "tx_min": 0.0254,
        "tx_max": 0.0299,
        "pct_geral": 0.0045
      },
      {
        "tx_min": 0.03,
        "tx_max": 999,
        "pct_geral": 0.018
      }
    ]
  },
  "NAO_CONSIGNADO": {
    "_titulo": "3.2 - Crédito Não Consignado (Automático, Salário e Benefício)",
    "prazo_min": 13,
    "tiquete_min": 100.0,
    "celulas_taxa": [
      {
        "tx_min": 0.0292,
        "tx_max": 0.0337,
        "Faixa 1": 0.0196,
        "Faixa 2": 0.0197,
        "Faixa 3": 0.0203,
        "Faixa 4": 0.0212,
        "Faixa 5": 0.0215
      },
      {
        "tx_min": 0.0338,
        "tx_max": 0.0383,
        "Faixa 1": 0.0274,
        "Faixa 2": 0.0276,
        "Faixa 3": 0.0285,
        "Faixa 4": 0.0297,
        "Faixa 5": 0.0301
      },
      {
        "tx_min": 0.0384,
        "tx_max": 0.0429,
        "Faixa 1": 0.0353,
        "Faixa 2": 0.0355,
        "Faixa 3": 0.0366,
        "Faixa 4": 0.0382,
        "Faixa 5": 0.0387
      },
      {
        "tx_min": 0.043,
        "tx_max": 0.0475,
        "Faixa 1": 0.0431,
        "Faixa 2": 0.0434,
        "Faixa 3": 0.0448,
        "Faixa 4": 0.0467,
        "Faixa 5": 0.0473
      },
      {
        "tx_min": 0.0476,
        "tx_max": 0.0538,
        "Faixa 1": 0.0549,
        "Faixa 2": 0.0553,
        "Faixa 3": 0.057,
        "Faixa 4": 0.0595,
        "Faixa 5": 0.0602
      },
      {
        "tx_min": 0.0539,
        "tx_max": 999,
        "Faixa 1": 0.0824,
        "Faixa 2": 0.0829,
        "Faixa 3": 0.0855,
        "Faixa 4": 0.0892,
        "Faixa 5": 0.0903
      }
    ]
  },
  "ADIANTAMENTO_13": {
    "_titulo": "3.3 - Adiantamento 13º Salário",
    "tx_juros_min": 0.0325,
    "prazo_min": 5,
    "tiquete_min": 100.0,
    "celulas": [
      {
        "prazo_min": 5,
        "prazo_max": 999,
        "Faixa 1": 0.0235,
        "Faixa 2": 0.0237,
        "Faixa 3": 0.0244,
        "Faixa 4": 0.0255,
        "Faixa 5": 0.0258
      }
    ]
  },
  "FGTS": {
    "_titulo": "3.4 - CDC FGTS Saque Aniversário",
    "_observacao": "Sem variação por Faixa — % é Geral",
    "tx_juros_fixa": 0.0179,
    "prazo_min": 36,
    "prazo_max": 84,
    "tiquete_min": 1000.0,
    "pct_geral": 0.042
  }
}$rulejson$::jsonb
)
on conflict (competencia, version_no) do update set
  regime          = excluded.regime,
  valid_from      = excluded.valid_from,
  valid_until     = excluded.valid_until,
  is_active       = excluded.is_active,
  trp_doc_ref     = excluded.trp_doc_ref,
  source_filename = excluded.source_filename,
  notes           = excluded.notes,
  regra_json      = excluded.regra_json;

commit;

-- ============================================================================
-- Verificação pós-seed (rodar no Studio APÓS o commit)
-- ============================================================================
-- (a) 3 linhas ativas, uma por competência, version_no=1:
--   select competencia, regime, valid_from, valid_until, version_no, is_active,
--          trp_doc_ref, source_filename
--     from trp_rule_versions
--    where competencia in (date '2026-04-01', date '2026-05-01', date '2026-06-01')
--    order by competencia;
--   esperado: 3 linhas; regime VOLUME_5_FAIXAS; vigências
--     2026-04: 2026-03-31 .. 2026-04-29
--     2026-05: 2026-04-30 .. 2026-05-28
--     2026-06: 2026-05-29 .. 2026-06-29
--
-- (b) só UMA versão ativa por competência (índice parcial):
--   select competencia, count(*) filter (where is_active) as ativas
--     from trp_rule_versions group by competencia order by competencia;  -- ativas = 1
--
-- (c) PROVA de deep-equal regra_json(banco) x JSON(arquivo), por competência:
--   node scripts/trp_seed_verify_deepequal.cjs
--   (lê o banco via service-role e compara valor-a-valor contra os arquivos)
-- ============================================================================
