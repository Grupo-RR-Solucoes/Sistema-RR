arquivo:   lib/motor.ts
impressao: sha256:a3b4ca0a2e37da39c919194d924750de9cbb82982c1bed21c61f3b376634021f
aprovado:  2026-08-31
frente:    feat/trp-vigencia-intra-mes (PR #203)

---

## O QUE MUDOU

Em relacao a aprovacao anterior (o `lib/motor.ts` de origin/main em 71c9379):
**3 mudancas de codigo e 10 linhas de comentario** — `13 insertions(+), 3
deletions(-)` medidos por `git diff --numstat origin/main...HEAD -- lib/motor.ts`.

1. O tipo `TrpRegraProvider` ganha um **2o parametro opcional**
   `contractDate?: string`. Aritmetica nenhuma; e assinatura.

       - export type TrpRegraProvider = (competencia: string) => RegraMes | null;
       + export type TrpRegraProvider = (
       +   competencia: string,
       +   contractDate?: string,
       + ) => RegraMes | null;

2. `lib/motor.ts:605`, dentro de `lookupCreditPercentTrp` — **repasse de
   parametro** na mesma chamada:

       - const fromDb = trpProvider ? trpProvider(mes) : null;
       + const fromDb = trpProvider ? trpProvider(mes, op.contract_date ?? undefined) : null;

3. `lib/motor.ts:682`, dentro de `getCreditPercent` (o gate do tiquete) — o
   **mesmo repasse**, para o tiquete minimo nascer da MESMA fatia que o pct:

       - (mes && trpProvider ? trpProvider(mes) : null) ??
       + (mes && trpProvider ? trpProvider(mes, op.contract_date ?? undefined) : null) ??

As outras 10 linhas sao o bloco de comentario que explica o parametro novo.

## POR QUE NAO TOCA O TETO DA EMPRESA

MEDIDO no diff, nao afirmado. As 16 linhas alteradas **nao contem uma unica
ocorrencia** de `cashCap`, `teto`, `promotivaCash`, `0.06`, `avista` nem
`TETO_EMPRESA` (contagem: 0).

O arquivo segue com **3** ocorrencias de `cashCapPercent` e **0** de
`tetoAvistaRR` — que sao exatamente as duas invariantes (i) deste bloco, e elas
continuam sendo verificadas de forma independente desta aprovacao. Nenhuma das 3
mudancas altera ordem de guarda, aritmetica ou fluxo: `resolvePromotivaCashPolicy`,
`cashCapPercent` e o `Math.min` do a-vista estao intocados.

## O QUE MUDA DE COMPORTAMENTO

Sem suavizar: **passa a existir um caminho em que a regua escolhida depende da
data do contrato.**

Ate aqui o provider recebia so a competencia e devolvia uma regua. Agora recebe
tambem a `contract_date`, e quando a competencia tiver **2+ reguas ativas**
(vigencia intra-mes — agosto/2026: TRP38 ate 04/08 e TRP39 de 05/08 em diante)
a fatia escolhida muda conforme a data.

E **no-op enquanto cada competencia tiver uma regua so** — medido em 122 dias
sobre 4 competencias, 0 divergencias de `versionId`, e sonda identica em 31 dias
de julho dando 1 unico percentual (`gate_trp_vigencia_intra_mes.cjs`, blocos A e
B). Mas e **mudanca de comportamento POR CONSTRUCAO**, nao cosmetica, e foi por
isso que esta aprovacao foi escrita em vez de a mudanca passar calada.

O parametro e OPCIONAL de proposito: um provider de 1 parametro continua
atribuivel ao tipo novo (arity menor e assinavel para arity maior), entao os
**6 sitios de `calcularOperacao` seguem valendo sem alteracao** — nenhum foi
tocado.
