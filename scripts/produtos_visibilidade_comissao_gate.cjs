/* ============================================================================
 * produtos_visibilidade_comissao_gate — a comissao do PROMOTOR nao sai da rota
 * para quem nao tem direito.
 *
 * Rodar:
 *   node scripts/produtos_visibilidade_comissao_gate.cjs
 *
 * A INVARIANTE (regra confirmada por Diego em 23/08/2026): a comissao do PROMOTOR
 * so pode ser vista pelo PROPRIO promotor, pelo FINANCEIRO (role `funcionario`) e
 * pelos SOCIOS. Gestor de consorcio NAO ve. Gestores de credito (supervisor /
 * gerente_regional) NAO veem.
 *
 * O DEFEITO (regressao introduzida em cb6e067 e medida em 23/08/2026): a tela
 * /produtos/atribuicao ganhou a coluna "Comissao promotor", e o gestor_consorcio
 * TEM acesso a essa tela (requireAtribuicaoProdutos devolve escopo CONSORCIO para
 * ele). Passou a ver o repasse de cada promotor, proposta a proposta.
 *
 * POR QUE A ASSERCAO E SOBRE O PAYLOAD, E NAO SOBRE A TELA: esconder a coluna no
 * componente e teatro — o JSON continua inteiro no navegador. O gate varre o
 * payload INTEIRO atras da chave proibida, do mesmo jeito que o
 * gate_projecao_gestor guarda a /projecao do gestor (bloco "(c) nenhum campo de
 * comissao de PROMOTOR no payload").
 *
 * OS BLOCOS (os dois lados no mesmo run — um so nao prova nada):
 *   1. PURO         — a regua de visibilidade por papel, sem banco.
 *   2. NEGADO       — payload montado como gestor_consorcio: ZERO ocorrencias de
 *                     comissao_promotor em qualquer profundidade.
 *   3. PERMITIDO    — payload montado como socio: o campo ESTA la, com valor > 0.
 *                     Sem este bloco o gate passaria com a rota devolvendo vazio.
 *   4. O QUE FICA   — o gestor CONTINUA vendo comissao da EMPRESA (base do calculo
 *                     dele) e comissao do GESTOR. Suprimir isso seria outro bug.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const {
  podeVerComissaoDePromotor,
  ROLES_QUE_VEEM_COMISSAO_DE_PROMOTOR,
} = require("../lib/auth/visibilidadeComissao.ts");
const { montarPayloadFilaAtribuicao } = require("../lib/produtos/filaAtribuicao.ts");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

const YEAR = 2026;
const MONTH = 7;

// Varredura recursiva: chave que contenha o termo E carregue VALOR.
//
// O filtro por valor nao e frouxidao — e o que separa vazamento de rotulo. O
// payload tem `pode_ver_comissao_promotor`, um BOOLEANO de render cuja chave
// contem o termo e que nao revela centavo nenhum. Excluir esse nome por
// allow-list criaria um buraco do tamanho do proximo nome que alguem inventar;
// exigir que o valor seja numero ou string fecha a porta por CONTEUDO. Booleano
// nao carrega dinheiro.
function varre(o, termo, caminho = "", achados = []) {
  if (o === null || typeof o !== "object") return achados;
  if (Array.isArray(o)) {
    o.forEach((v, i) => varre(v, termo, `${caminho}[${i}]`, achados));
    return achados;
  }
  for (const [k, v] of Object.entries(o)) {
    const p = caminho ? `${caminho}.${k}` : k;
    const carregaValor = typeof v === "number" || typeof v === "string";
    if (k.includes(termo) && carregaValor) achados.push(p);
    varre(v, termo, p, achados);
  }
  return achados;
}

(async () => {
  // ---- 1. PURO ----
  console.log(linha("="));
  console.log("1) PURO — a regua de visibilidade por papel");
  console.log(linha("="));
  ok(podeVerComissaoDePromotor("socio") === true, "socio VE a comissao do promotor");
  ok(podeVerComissaoDePromotor("funcionario") === true, "funcionario (financeiro) VE");
  ok(podeVerComissaoDePromotor("gestor_consorcio") === false, "gestor_consorcio NAO ve");
  ok(podeVerComissaoDePromotor("supervisor") === false, "supervisor NAO ve");
  ok(podeVerComissaoDePromotor("gerente_regional") === false, "gerente_regional NAO ve");
  ok(
    podeVerComissaoDePromotor("promotor") === false,
    "promotor NAO ve pelo PAPEL (o direito dele e sobre a DELE, e escopo, nao campo)"
  );
  ok(podeVerComissaoDePromotor(null) === false, "papel ausente -> DENY (default deny)");
  ok(podeVerComissaoDePromotor("papel_que_nao_existe") === false, "papel desconhecido -> DENY");
  ok(
    ROLES_QUE_VEEM_COMISSAO_DE_PROMOTOR.length === 2,
    "a lista de quem ve tem exatamente 2 papeis",
    `[${ROLES_QUE_VEEM_COMISSAO_DE_PROMOTOR.join(", ")}]`
  );

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // A MESMA funcao que a rota serve — nao ha reimplementacao do payload aqui.
  const comoGestor = await montarPayloadFilaAtribuicao(sb, {
    year: YEAR,
    month: MONTH,
    role: "gestor_consorcio",
    escopo: "CONSORCIO",
  });
  const comoSocio = await montarPayloadFilaAtribuicao(sb, {
    year: YEAR,
    month: MONTH,
    role: "socio",
    escopo: "TODOS",
  });

  // ---- 2. NEGADO ----
  console.log("\n" + linha("="));
  console.log("2) NEGADO — payload do gestor_consorcio nao tem comissao do promotor");
  console.log(linha("="));
  const vazou = varre(comoGestor, "comissao_promotor");
  console.log(
    `   linhas no payload do gestor: consorcio=${comoGestor.grupos.consorcio.length}` +
      `  bbcap=${comoGestor.grupos.bbcap.length}  conta_corrente=${comoGestor.grupos.conta_corrente.length}`
  );
  ok(
    comoGestor.grupos.consorcio.length > 0,
    "ANTI-VACUIDADE: o payload do gestor TEM linhas (senao nao ha o que vazar)",
    `${comoGestor.grupos.consorcio.length} ancoras`
  );
  ok(
    vazou.length === 0,
    "ZERO campo com VALOR de comissao_promotor em qualquer profundidade",
    vazou.length === 0 ? "" : `VAZOU: ${vazou.slice(0, 6).join(", ")}`
  );
  ok(
    comoGestor.pode_ver_comissao_promotor === false,
    "o flag de render vem false (a tela nem desenha a coluna)"
  );
  // varredura mais larga: nada com "promotor" que carregue numero de comissao.
  const suspeitas = varre(comoGestor, "repasse");
  ok(suspeitas.length === 0, "nem campo com 'repasse' no nome carregando valor", suspeitas.slice(0, 4).join(", "));
  // E o booleano de render, que a varredura por conteudo deixa passar de proposito:
  ok(
    typeof comoGestor.pode_ver_comissao_promotor === "boolean",
    "o unico campo com o termo no nome e um BOOLEANO (rotulo, nao valor)"
  );

  // ---- 3. PERMITIDO (sem isto o gate passa com a rota devolvendo vazio) ----
  console.log("\n" + linha("="));
  console.log("3) PERMITIDO — payload do socio TEM a comissao do promotor, com valor");
  console.log(linha("="));
  const achadas = varre(comoSocio, "comissao_promotor");
  ok(
    comoSocio.pode_ver_comissao_promotor === true,
    "o flag de render vem true para o socio"
  );
  ok(
    achadas.length > 0,
    "ANTI-VACUIDADE: comissao_promotor APARECE no payload do socio",
    `${achadas.length} ocorrencias`
  );
  const valores = [];
  for (const g of ["bbcap", "conta_corrente", "consorcio"]) {
    for (const it of comoSocio.grupos[g]) {
      const v = it.detalhe && it.detalhe.comissao_promotor;
      if (typeof v === "number") valores.push(v);
    }
  }
  const soma = valores.reduce((a, b) => a + b, 0);
  console.log(`   valores de comissao_promotor no payload do socio: ${valores.length}, soma ${soma.toFixed(2)}`);
  ok(valores.length > 0, "ha valores numericos, nao so a chave", `${valores.length} linhas`);
  ok(soma > 0, "a soma e > 0 (nao e uma coluna de zeros)", `R$ ${soma.toFixed(2)}`);

  // O mesmo termo, os dois lados — e a contraprova de que a varredura funciona.
  ok(
    vazou.length === 0 && achadas.length > 0,
    "MESMA varredura: 0 no gestor, >0 no socio (o teste tem poder)",
    `gestor=${vazou.length} socio=${achadas.length}`
  );

  // ---- 4. O QUE O GESTOR CONTINUA VENDO ----
  console.log("\n" + linha("="));
  console.log("4) O QUE FICA — empresa e gestor continuam visiveis para o gestor");
  console.log(linha("="));
  const comDetalhe = comoGestor.grupos.consorcio.filter((i) => i.detalhe);
  const somaEmpresa = comDetalhe.reduce((a, i) => a + Number(i.detalhe.comissao_empresa || 0), 0);
  const somaGestor = comDetalhe.reduce((a, i) => a + Number(i.detalhe.comissao_gestor || 0), 0);
  console.log(`   propostas com lancamento no mes: ${comDetalhe.length}`);
  ok(comDetalhe.length > 0, "ANTI-VACUIDADE: ha proposta com detalhe no mes", `${comDetalhe.length}`);
  ok(somaEmpresa > 0, "comissao da EMPRESA visivel (base do calculo do gestor)", `R$ ${somaEmpresa.toFixed(2)}`);
  ok(somaGestor > 0, "comissao do GESTOR visivel (e dele)", `R$ ${somaGestor.toFixed(2)}`);
  ok(
    Math.abs(somaGestor - somaEmpresa * 0.1) < 0.5,
    "a comissao do gestor continua sendo 10% da empresa",
    `${somaGestor.toFixed(2)} x ${(somaEmpresa * 0.1).toFixed(2)}`
  );

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
