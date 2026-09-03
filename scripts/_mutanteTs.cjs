/*
 * scripts/_mutanteTs.cjs — carrega um modulo .ts com o FONTE MUTADO.
 *
 * POR QUE EXISTE
 * --------------
 * Um portao que so afirma "a funcao devolve o certo" nao prova nada: uma
 * assercao frouxa passa com a regra CERTA e com a regra ERRADA. O jeito de
 * provar que o portao tem dente e quebrar a regra de proposito e exigir que ele
 * FIQUE VERMELHO.
 *
 * A tentacao e escrever o "mutante" a mao dentro do portao. Isso testa a copia,
 * nao o codigo. Aqui a mutacao e aplicada ao FONTE REAL do modulo (o mesmo
 * arquivo que a producao importa), transpilado na hora — do jeito que
 * scripts/_ts_register.cjs ja faz para os runners.
 *
 * ANTI-VACUIDADE, que e o ponto mais importante deste arquivo: se o texto
 * procurado NAO existir mais no fonte (alguem renomeou, reescreveu a linha), a
 * substituicao nao acontece, o "mutante" seria IDENTICO ao original e o portao
 * ficaria verde por nao ter mutado nada. Por isso cada troca e CONFERIDA e a
 * ausencia do alvo e ERRO, nunca no-op silencioso.
 *
 * LIMITE: transpila e avalia o modulo isolado. Serve para modulo sem
 * dependencia (as regras puras). Modulo que importa outros precisaria do
 * resolvedor de "@/", que este helper de proposito nao carrega.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");

/**
 * @param {string} relativo  caminho do .ts a partir da raiz do repo
 * @param {Array<[string|RegExp, string]>} trocas  pares [alvo, substituto]
 * @returns {any} module.exports do modulo MUTADO
 */
function carregaMutante(relativo, trocas) {
  const abs = path.join(ROOT, relativo);
  if (!fs.existsSync(abs)) {
    throw new Error(`_mutanteTs: ${relativo} nao existe`);
  }
  let src = fs.readFileSync(abs, "utf8");

  for (const [alvo, substituto] of trocas) {
    const antes = src;
    src = typeof alvo === "string" ? src.split(alvo).join(substituto) : src.replace(alvo, substituto);
    if (src === antes) {
      throw new Error(
        `_mutanteTs: a mutacao NAO se aplicou em ${relativo}.\n` +
          `  alvo procurado: ${String(alvo)}\n` +
          `  O fonte mudou e o portao ficaria verde sem mutar nada — que e ` +
          `exatamente o falso verde que este helper existe para impedir. ` +
          `Atualize a mutacao para o texto novo.`
      );
    }
  }

  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: abs,
  }).outputText;

  const m = new Module(abs, null);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(js, abs);
  return m.exports;
}

/** Carrega o modulo REAL (sem mutacao), pelo mesmo caminho de transpilacao. */
function carregaReal(relativo) {
  return carregaMutante(relativo, []);
}

module.exports = { carregaMutante, carregaReal, ROOT };
