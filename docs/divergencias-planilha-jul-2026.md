# A partir de jul/2026 o sistema DIVERGE da planilha do financeiro — e está certo

Registrado em 25/08/2026, depois dos quatro consertos (teto 5,80%, carve-out
INSS por taxa, convênio zero-padded, régua por vigência).

Até aqui a planilha do financeiro era o árbitro: quando os dois discordavam, o
sistema estava errado. **Isso deixou de valer.** Os quatro consertos foram
medidos contra a própria planilha e a maioria dos promotores passou a bater ao
centavo; o que sobra tem causa nomeada, e em boa parte a causa é a planilha.

## O número

DRY-RUN de jul/2026 por `consolidateMonthlyGroup` (a rota), com tudo ligado:

```
  antes (PMR gravado)   122.549,62
  depois (dry-run)      122.650,01     delta  +100,39
  planilha do financeiro 121.635,96    depois - planilha  +1.014,05
  batem ao centavo (2c): 28 de 46 promotores
```

Só o lado RR (`source='fechamento'`), os 46 promotores com aba na planilha. Os
43 contratos da ADS já batiam antes e seguem batendo.

## Os 18 que divergem

### Erros conhecidos do financeiro em jul/2026 — o SISTEMA está certo

| promotor | delta | o que a planilha fez |
|---|---:|---|
| EDUARDA | −60,02 | usou 60,32% onde a escala dá 60,34% |
| ADRIANA | −18,07 | usou 71,86% num contrato a 3,34%, fora da faixa 5,80% |
| ERIKA | +15,02 | bateu o BONUS 1 (produção 235.988,35 ≥ 220.000) e foi paga na faixa base, 62,50% em vez de 63,55% |
| WILIANA | −7,34 | usou 60,32% onde a escala dá 60,34% |
| JENIFFER | −3,51 | usou 60,34% (bonus 2) quando a régua dá 59,32% (bonus 1) |

Soma: −73,92.

O caso da ERIKA e o do JARLES provam que a planilha é internamente
inconsistente: com o gatilho em BONUS1 (que é o que `monthly_targets.meta_1`
guarda, confirmado nos dois escritores e em 50/50 dos dados) o JARLES bate e a
ERIKA não; com o gatilho deslocado, a ERIKA bate e o JARLES não. Não existe
leitura que acerte os dois.

### Divergências por DECISÃO — nenhum dos lados está errado

| promotor | delta | decisão |
|---|---:|---|
| LILIAN + MARIA DE FÁTIMA | +839,67 | o piso de produção de 150k não retroage a julho; a planilha simplesmente não calculou a coluna Q delas |
| TACIANA / MATHEUS | ∓175,34 | o contrato 219262430 foi reatribuído; o sistema o dá ao MATHEUS. No total do grupo dá ZERO — é redistribuição, não gap |

### Pendentes de cadastro — resolvem sozinhos quando o cadastro entrar

| promotor | delta | pendência |
|---|---:|---|
| LETÍCIA | +311,82 | está `ENTRANTE_CUSTOM` (25%); decisão de Diego é CLT_FIXO 16,66% |
| DEYVISON | +116,77 | sem perfil (`DEFAULT_NO_PROFILE` = 58,33%); decisão é CLT_FIXO 16,66% |

O SQL dos dois está aprovado e é o Diego quem roda.

| promotor | delta |
|---|---:|
| JUSSARA | −47,36 |
| MAYANNE | −27,01 |
| MONALISA | −20,67 |
| ROSÂNGELA | −18,65 |
| MONICA | −16,32 |
| ISABEL | −15,51 |
| ERIVAN | −14,27 |

Soma: −159,79. Estes sete **não têm linha em `promoter_goal_repasse` em
competência nenhuma** — a régua por vigência não os alcança porque não há o que
herdar. O sistema paga o genérico 58,33%; a planilha aplicou a escala genérica
(59,32% no bonus 1, 60,34% no bonus 2) pela produção consolidada de cada um.
Enquanto não houver linha cadastrada para eles, o sistema fica abaixo — e essa
diferença é de CADASTRO, não de código.

## O que NÃO mudou

- `abr/2026`: a Frente C continua sem disparar. A competência mais antiga em
  `promoter_goal_repasse` é 2026-05, posterior a abril; não há régua anterior
  para herdar, e herdar "a mais próxima" retroagiria decisão comercial. O teto
  5,80% muda abril em −955,88 se alguém reprocessar.
- `jun/2026`: a régua vigente É a de junho, então a Frente C já disparava. Só o
  teto muda: −950,26.
- **Nada recalcula sozinho.** Não há cron nem trigger neste repo. Julho, junho e
  abril seguem gravados como estão até alguém reprocessar de propósito.

## Uma inconsistência aberta que os consertos criaram

`lib/closingProposalRows.ts:151` rateia o crédito do PMR entre as propostas
usando `comissaoEmpresaAvista` CRU como peso. O total continua correto (é um
rateio: soma sempre o valor do PMR), mas a fatia de um contrato a 6,00% fica
maior do que ele passou a merecer. É visualização, não pagamento. Não foi
mexido por estar fora do escopo combinado — decidir se entra.
