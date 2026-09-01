# Ledger de conteudo aprovado

Os arquivos listados em `scripts/_ledgerProtegido.ts` (`ARQUIVOS_PROTEGIDOS`)
calculam dinheiro. Cada um tem aqui **uma** entrada com a impressao do conteudo
**aprovado**. A G5 de `scripts/gate_teto_avista_rr.ts` calcula a impressao do
arquivo no run e compara.

Mudou o arquivo e nao atualizou a entrada -> **o portao reprova**, local e no CI.

## Como aprovar uma mudanca

1. Faca a mudanca.
2. Calcule a impressao nova:

       node -e "require('./scripts/_ts_register.cjs');const fs=require('fs');const {impressaoDe}=require('./scripts/_ledgerProtegido.ts');console.log(impressaoDe(fs.readFileSync(process.argv[1],'utf8')))" lib/motor.ts

3. Troque a `impressao:` **e reescreva o corpo**. As tres secoes sao
   obrigatorias e nao podem ficar vazias:

   - `## O QUE MUDOU` — linha a linha, com os trechos. Nao "atualizacao do
     motor": *qual* linha, *o que* virou *o que*.
   - `## POR QUE NAO TOCA O TETO DA EMPRESA` — de preferencia medido
     (contagem de ocorrencias no diff), nao afirmado.
   - `## O QUE MUDA DE COMPORTAMENTO` — inclusive quando a resposta e "nada".
     Se muda, diga que muda; a entrada existe para isso.

4. `node -e "require('./scripts/_ts_register.cjs');require('./scripts/gate_teto_avista_rr.ts')"`

**Trocar so o hash reprova.** Se a impressao mudou e o corpo continua o mesmo
(desprezando espaco em branco e acento), o portao acusa. Isso vale a partir da
SEGUNDA aprovacao de cada arquivo — na primeira nao existe versao anterior em
`origin/main` para comparar, e a regra e exercida pelo autoteste do proprio
portao.

## O que este mecanismo NAO faz

Ele **nao le semantica**. Prova que o conteudo e o que foi aprovado, nao que a
aprovacao esta certa. Se a entrada disser "e so assinatura" e a aritmetica tiver
mudado, **o portao passa**. Por isso:

- o corpo obriga a nomear linha a linha, para um humano conferir contra o diff;
- `.github/CODEOWNERS` exige revisao de quem nao escreveu a entrada;
- a metade **(i)** da G5 (o motor nao importa `tetoAvistaRR`, segue no
  `cashCapPercent`) e INVARIANTE e roda ANTES daqui: **nenhuma entrada deste
  diretorio cobre a (i)**.

## Historico

As entradas sao substituidas, nao acumuladas: a entrada e a aprovacao VIGENTE. O
historico de quem aprovou o que esta no `git log` deste diretorio —

    git log -p scripts/motor-protegido/lib_motor.ts.md
