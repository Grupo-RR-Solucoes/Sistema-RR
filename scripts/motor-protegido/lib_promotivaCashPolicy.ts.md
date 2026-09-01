arquivo:   lib/promotivaCashPolicy.ts
impressao: sha256:6a720946530399c75c809c4cd2dc7e16a0a120f1a570db09e3750ef522bfbf44
aprovado:  2026-08-31
frente:    feat/trp-vigencia-intra-mes (PR #203)

---

## O QUE MUDOU

**NADA.** Esta e a aprovacao INICIAL, que fotografa o arquivo como ele esta em
origin/main (71c9379) no dia em que o ledger nasceu. Medido:
`git diff --name-only origin/main...HEAD` NAO lista `lib/promotivaCashPolicy.ts`.

Ela existe porque a correspondencia arquivo-protegido <-> entrada e **1:1**: um
protegido sem entrada REPROVA. Sem esta linha de base, a primeira pessoa a mexer
neste arquivo nao teria contra o que comparar.

## POR QUE NAO TOCA O TETO DA EMPRESA

Ele **e** a fonte do teto da empresa (`resolvePromotivaCashPolicy`, o cap de 6%
do a-vista). Nao ha diff nenhum a justificar: byte por byte, e o conteudo que
ja estava em producao. Toda mudanca futura aqui e mudanca no teto por
definicao, e a proxima entrada tera de dizer qual.

## O QUE MUDA DE COMPORTAMENTO

**Nenhum.** Aprovacao de linha de base, sem alteracao de conteudo.
