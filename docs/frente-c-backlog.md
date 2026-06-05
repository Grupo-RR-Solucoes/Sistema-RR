# FRENTE C — Backlog

## 1. Parametrizar o INSS fixo da Aldalene (antes do fechamento de jun/2026)

**Hoje (entregue na Frente C):** o repasse fixo do INSS da Aldalene é uma
**constante** no motor — `ALDALENE_INSS_FIXED_SHARE = 0.6586` em
`app/api/calculate/monthly/route.ts`, e a Aldalene é identificada por nome
(`normalizeText(promoter.name).includes("ALDALENE")`); o INSS é detectado por
`convenio_code = '1640'` ou descrição contendo `INSS`.

**Por que pode ficar assim por enquanto:** a regra só tem efeito em meses
**ABERTOS** (jun/2026+). Maio/2026 está fechado por cms e o motor espelha o
ground truth — a constante não influencia maio.

**A fazer (passo separado, ANTES de fechar junho):**
- Tirar o hardcode `0.6586` e a identificação por nome.
- Mover para tabela/coluna. Opções:
  - coluna `pct_inss_fixo numeric(6,4)` em `promoter_goal_repasse` (por
    promotor/competência), OU
  - tabela própria de exceções de repasse por produto/convênio.
- Identificar a Aldalene por `promoter_id` (não por string de nome).
- Manter a semântica atual: INSS fica FORA da escala de meta; usa o % fixo;
  só vale em meses abertos.

**Disparo:** revisar e implementar antes do recálculo/fechamento de jun/2026.
