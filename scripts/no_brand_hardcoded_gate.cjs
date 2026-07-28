#!/usr/bin/env node
// ============================================================================
// no_brand_hardcoded_gate.cjs — a marca institucional vive SO na barra.
//
// O QUE ESTE PORTAO PROTEGE
// ---------------------------------------------------------------------------
// A barra do topo mostra "Grupo RR Cred" permanentemente (sticky, nunca some no
// rolar). Ate a FASE 4, cada uma das 16 telas repetia a marca no eyebrow do
// HeaderNavy — a mesma marca, duas vezes na mesma tela. A Fase 4 tirou a
// repeticao.
//
// Sem portao, o ganho dura ate a proxima tela: quem copiar o cabecalho de uma
// tela antiga (ou de um exemplo velho) traz a marca de volta, e ninguem percebe
// numa revisao de diff. Este gate faz a tela nova REPROVAR no CI.
//
// NAO E SOBRE A PALAVRA, E SOBRE ONDE ELA APARECE. A marca continua legitima em
// quatro lugares, e so neles:
//
//   components/BrandLogo.tsx    a ARTE (alt da imagem + comentario)
//   app/layout.tsx              metadata.title — o titulo da aba do navegador
//   app/login/LoginForm.tsx     texto do login (fora do shell, sem barra)
//   app/definir-senha/page.tsx  idem, mesmo fluxo
//
// Login e definir-senha estao em ROTAS_SEM_SHELL: renderizam sem a barra, entao
// ali a marca nao e repeticao — e a unica ocorrencia.
//
// SE UMA TELA NOVA PRECISAR DA MARCA EM PROSA (nao como cabecalho), o caminho e
// acrescentar o arquivo a PERMITIDOS aqui, conscientemente, com o motivo. A
// friccao e o ponto: a decisao passa a ser explicita em vez de silenciosa.
//
// O QUE ESTE PORTAO NAO CHECA, DE PROPOSITO
// ---------------------------------------------------------------------------
// Os 8 eyebrows SEMANTICOS (SEGURIDADE, GESTOR CONSORCIO, AUDITORIA,
// AUDITORIA . ADS, MONITOR CONSORCIO, MONITOR PRT, MONITOR FISCAL) continuam e
// devem continuar. Nao ha assercao sobre eles porque uma lista fixa de strings
// reprovaria por renomear uma secao — ruido, nao defeito. A prop eyebrow fica.
//
// MODO: self-contained. So le arquivos do proprio repo; sem banco, sem caminho
// absoluto. Roda no CI de graca.
//
// Exit: 0 = nenhuma marca fora dos quatro lugares. 1 = achou.
// ============================================================================

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RAIZES = ["app", "components", "lib"];
const EXTENSOES = new Set([".ts", ".tsx", ".js", ".jsx"]);

const PERMITIDOS = new Map([
  ["components/BrandLogo.tsx", "a arte da marca (alt da imagem + comentario)"],
  ["app/layout.tsx", "metadata.title — titulo da aba do navegador"],
  ["app/login/LoginForm.tsx", "login renderiza SEM a barra (ROTAS_SEM_SHELL)"],
  ["app/definir-senha/page.tsx", "definir-senha renderiza SEM a barra"],
]);

// Case-insensitive e tolerante a espaco/quebra de linha: pega "GRUPO RR CRED",
// "Grupo RR Cred" e "Grupo  RR\nCred" com o mesmo padrao. Um gate que so
// pegasse a forma em caixa alta seria contornado sem querer no primeiro copiar
// e colar de um texto em caixa mista.
const MARCA = /grupo\s+rr\s+cred/gi;

function listar(dir, saida) {
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return saida;
  }
  for (const e of entradas) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      listar(abs, saida);
    } else if (EXTENSOES.has(path.extname(e.name))) {
      saida.push(abs);
    }
  }
  return saida;
}

const arquivos = [];
for (const r of RAIZES) listar(path.join(ROOT, r), arquivos);

const achados = [];
for (const abs of arquivos) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  if (PERMITIDOS.has(rel)) continue;
  const conteudo = fs.readFileSync(abs, "utf8");
  const linhas = conteudo.split(/\r?\n/);
  linhas.forEach((linha, i) => {
    MARCA.lastIndex = 0;
    if (MARCA.test(linha)) {
      achados.push({ rel, linha: i + 1, texto: linha.trim() });
    }
  });
}

const barra = "=".repeat(78);
console.log(barra);
console.log("PORTAO — a marca institucional vive SO na barra do topo");
console.log(barra);
console.log(`  arquivos varridos ....... ${arquivos.length}  (app, components, lib)`);
console.log(`  lugares permitidos ...... ${PERMITIDOS.size}`);
for (const [rel, motivo] of PERMITIDOS) {
  const existe = fs.existsSync(path.join(ROOT, rel));
  console.log(`      ${existe ? " " : "!"} ${rel.padEnd(30)} ${motivo}`);
  if (!existe) {
    console.log(
      "        AVISO: arquivo permitido nao existe mais — a lista pode ter envelhecido."
    );
  }
}

if (achados.length === 0) {
  console.log("\n  Nenhuma marca fora dos lugares permitidos.");
  console.log("\n>>> PORTAO OK.");
  process.exit(0);
}

console.log(`\n  MARCA ENCONTRADA FORA DOS LUGARES PERMITIDOS: ${achados.length}\n`);
for (const a of achados) {
  console.log(`    ${a.rel}:${a.linha}`);
  console.log(`      ${a.texto.slice(0, 110)}`);
}
console.log(`
  A barra do topo ja mostra a marca em toda tela do shell. Repetir no cabecalho
  da pagina mostra a mesma marca duas vezes.

  Se for cabecalho/eyebrow: remova. Para rotulo de contexto use o eyebrow
  semantico (SEGURIDADE, AUDITORIA, MONITOR PRT, ...).

  Se for prosa legitima: acrescente o arquivo a PERMITIDOS neste gate, com o
  motivo escrito.
`);
console.log(">>> PORTAO REPROVADO.");
process.exit(1);
