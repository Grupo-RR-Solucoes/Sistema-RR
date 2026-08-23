/* ============================================================================
 * gate_schema_colunas — TODA COLUNA QUE O CODIGO PEDE EXISTE NO BANCO?
 *
 * SOMENTE LEITURA. Nao grava, nao cria, nao altera nada. Faz GET no PostgREST.
 *
 * Rodar:  npx tsx scripts/gate_schema_colunas.mts
 *
 * ---------------------------------------------------------------------------
 * POR QUE CONTRA O BANCO REAL, E NAO CONTRA supabase/migrations/
 * ---------------------------------------------------------------------------
 * ESTA E A DECISAO CENTRAL DO GATE, e ela e deliberada.
 *
 * O INCIDENTE (21/08/2026). O commit 81d6cb6 (PR #174) mergeou, no MESMO commit,
 * o SELECT de `piso_zerou` e o DDL que cria a coluna. So que o DDL foi parar em
 * scripts/sql/2026-08-18_piso_producao_repasse.sql — FORA de supabase/migrations/.
 * Nenhuma esteira o pega; nenhum inventario de pendencias o lista. O merge
 * publicou o leitor sem o pre-requisito de banco e o resultado foi 42703
 * ("column promoter_monthly_results.piso_zerou does not exist") em:
 *   /projecao, /promotores, /dashboard, /relatorios (+2 exports) e /financeiro
 *   em dobro (a pagina faz fetch de /api/financeiro E /api/dre no mesmo Promise.all),
 * e os caminhos de ESCRITA mortos junto — fechamento e reconsolidacao — porque o
 * upsert inclui a coluna no payload.
 *
 * UM GATE QUE COMPARASSE COM supabase/migrations/ TERIA PASSADO VERDE NESTE
 * INCIDENTE. O DDL nao estava la. Comparar codigo com migration responde
 * "alguem escreveu o DDL?", que nao e a pergunta. A pergunta e:
 *
 *     a coluna existe ONDE O CODIGO VAI LER?
 *
 * e so o banco responde isso. Migration nao aplicada, migration aplicada a mao
 * pelo Studio, DDL solto em scripts/sql, coluna dropada por engano depois de uma
 * migration legitima — as quatro situacoes divergem do repo e convergem no banco.
 * O banco e a unica fonte que nao mente sobre o que o runtime vai encontrar.
 *
 * CONSEQUENCIA ACEITA: este gate NAO roda sem credencial, entao nao e
 * self-contained e nao entra no `npm run gates`. Ele entra no CI por um passo
 * PROPRIO do .github/workflows/gates.yml, com a chave ANON. Ver o bloco FAIXA no
 * fim do arquivo.
 *
 * ---------------------------------------------------------------------------
 * O QUE ELE VARRE
 * ---------------------------------------------------------------------------
 * app/ e lib/ (.ts/.tsx) — os caminhos que servem requisicao. Para cada
 * `.from(tabela)` resolvido, extrai as colunas de:
 *   .select("a, b, c")                    LEITURA
 *   .upsert(obj) / .insert(obj)           GRAVACAO — as COLUNAS sao as CHAVES
 *   .update(obj)                          do objeto gravado.
 *
 * OS DOIS LADOS, porque os dois quebraram no incidente: as 6 telas caiam no
 * .select(), e o fechamento/reconsolidacao caiam no .upsert() — o payload do PMR
 * inclui a coluna. Um gate que so varresse select teria dito "tudo certo" com a
 * consolidacao de mes fechado morta.
 *
 * COBERTURA HONESTA, NAO PRESUMIDA. Toda chamada que o extrator nao consegue ler
 * com confianca vai para o bloco NAO COBERTO, impressa com arquivo:linha e
 * motivo. Nao ha "provavelmente esta ok": ou o gate leu a coluna, ou ele declara
 * que nao leu. Fingir cobertura e pior que nao ter gate, porque desliga a
 * desconfianca de quem le o verde.
 *
 * FORA DE ESCOPO, de proposito: scripts/. Sao scratch, importadores e gates —
 * nao servem requisicao, e ~70 deles nem rastreados no git estao. Quebrar um
 * script de diagnostico nao derruba tela.
 * ========================================================================== */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// .env -> process.env. MESMA precedencia dos outros gates .mts: shell >
// .env.local > .env (o guard `!process.env[k]` impede o .env de sobrescrever).
for (const arquivo of [".env.local", ".env"]) {
  const p = path.join(ROOT, arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linhaEnv of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linhaEnv.match(/^([A-Z0-9_]+)=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ===========================================================================
// TIPOS
// ===========================================================================

type Origem = { arquivo: string; linha: number };

type Pedido = {
  tabela: string;
  coluna: string;
  via: "select" | "upsert" | "insert" | "update";
  origem: Origem;
};

type NaoCoberto = {
  origem: Origem;
  motivo: string;
  trecho: string;
};

// ===========================================================================
// VARREDURA LEXICA — comentarios, strings, parenteses
// ===========================================================================

/**
 * Troca todo comentario por espacos, PRESERVANDO offsets (para linha/coluna
 * continuarem batendo com o arquivo original).
 *
 * Isto nao e preciosismo: este repo comenta MUITO, e varios comentarios citam
 * `.from("x").select("y")` como exemplo. Sem mascarar, o gate cobraria coluna
 * de codigo que nao existe — e um falso positivo mata a confianca no gate tao
 * rapido quanto um falso negativo.
 */
function mascararComentarios(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  let estado: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : "";
    if (estado === "code") {
      if (c === "/" && d === "/") { out[i] = " "; out[i + 1] = " "; estado = "line"; i += 2; continue; }
      if (c === "/" && d === "*") { out[i] = " "; out[i + 1] = " "; estado = "block"; i += 2; continue; }
      if (c === "'") { estado = "sq"; i++; continue; }
      if (c === '"') { estado = "dq"; i++; continue; }
      if (c === "`") { estado = "tpl"; i++; continue; }
      i++; continue;
    }
    if (estado === "line") {
      if (c === "\n") { estado = "code"; i++; continue; }
      out[i] = " "; i++; continue;
    }
    if (estado === "block") {
      if (c === "*" && d === "/") { out[i] = " "; out[i + 1] = " "; estado = "code"; i += 2; continue; }
      if (c !== "\n" && c !== "\r") out[i] = " ";
      i++; continue;
    }
    // dentro de string: so o fechamento (ou a barra de escape) importa.
    if (c === "\\") { i += 2; continue; }
    if ((estado === "sq" && c === "'") || (estado === "dq" && c === '"') || (estado === "tpl" && c === "`")) {
      estado = "code"; i++; continue;
    }
    i++;
  }
  return out.join("");
}

/** Indice do fechamento que casa com o abridor em `idxAbre`. -1 se nao fecha. */
function casarFechamento(src: string, idxAbre: number): number {
  const abre = src[idxAbre];
  const fecha = abre === "(" ? ")" : abre === "{" ? "}" : "]";
  let depth = 0;
  let estado: "code" | "sq" | "dq" | "tpl" = "code";
  for (let i = idxAbre; i < src.length; i++) {
    const c = src[i];
    if (estado === "code") {
      if (c === "'") { estado = "sq"; continue; }
      if (c === '"') { estado = "dq"; continue; }
      if (c === "`") { estado = "tpl"; continue; }
      if (c === abre) depth++;
      else if (c === fecha) { depth--; if (depth === 0) return i; }
      continue;
    }
    if (c === "\\") { i++; continue; }
    if ((estado === "sq" && c === "'") || (estado === "dq" && c === '"') || (estado === "tpl" && c === "`")) estado = "code";
  }
  return -1;
}

/** Fim (indice da aspa de fechamento) da string que comeca em `i`. */
function fimDeString(src: string, i: number): number {
  const q = src[i];
  for (let k = i + 1; k < src.length; k++) {
    if (src[k] === "\\") { k++; continue; }
    if (src[k] === q) return k;
  }
  return src.length - 1;
}

/** Divide por virgulas de TOPO (ignorando as que estao dentro de (), {}, [] ou string). */
function argsDeTopo(interior: string): string[] {
  const out: string[] = [];
  let atual = "";
  let depth = 0;
  let estado: "code" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < interior.length; i++) {
    const c = interior[i];
    if (estado === "code") {
      if (c === "'") { estado = "sq"; atual += c; continue; }
      if (c === '"') { estado = "dq"; atual += c; continue; }
      if (c === "`") { estado = "tpl"; atual += c; continue; }
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      else if (c === "," && depth === 0) { out.push(atual); atual = ""; continue; }
      atual += c; continue;
    }
    atual += c;
    if (c === "\\") { if (i + 1 < interior.length) { atual += interior[i + 1]; i++; } continue; }
    if ((estado === "sq" && c === "'") || (estado === "dq" && c === '"') || (estado === "tpl" && c === "`")) estado = "code";
  }
  if (atual.trim() !== "") out.push(atual);
  return out;
}

/** Se `texto` e UM literal de string sem interpolacao, devolve o conteudo. */
function literalDeString(texto: string): string | null {
  const t = texto.trim();
  if (t.length < 2) return null;
  const q = t[0];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  if (t[t.length - 1] !== q) return null;
  const corpo = t.slice(1, -1);
  // template com interpolacao nao e literal conhecido em tempo de varredura.
  if (q === "`" && /\$\{/.test(corpo)) return null;
  // aspa nao escapada no meio => sao duas strings concatenadas, nao um literal.
  for (let i = 0; i < corpo.length; i++) {
    if (corpo[i] === "\\") { i++; continue; }
    if (corpo[i] === q) return null;
  }
  return corpo;
}

/**
 * `const NOME = "literal"` do PROPRIO arquivo. Cobre o idioma
 * `const TABLE = "..."` / `const COLUMNS = "..."` das rotas de auditoria e o
 * `export const PISO_TABELA = "piso_producao_rule_versions"` do lib/pisoProducao.
 * Import de outro arquivo NAO e seguido — vira NAO COBERTO, com o nome impresso.
 */
function constantesDeString(masked: string): Map<string, string> {
  const m = new Map<string, string>();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(["'`])/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(masked)) !== null) {
    const idxQuote = mm.index + mm[0].length - 1;
    const fim = fimDeString(masked, idxQuote);
    const valor = literalDeString(masked.slice(idxQuote, fim + 1));
    if (valor !== null) m.set(mm[1], valor);
  }
  return m;
}

/**
 * Objetos literais que uma EXPRESSAO produz. Cobre as tres formas em que este
 * repo monta payload de gravacao:
 *   {...}                       objeto direto
 *   [ {...}, {...} ]            array literal
 *   xs.map((r) => ({...}))      map com arrow devolvendo objeto
 *   xs.map((r) => { return {...} })
 * Qualquer outra forma devolve motivo, e o chamador manda para NAO COBERTO.
 */
function objetosDeExpressao(expr: string): { objetos: string[]; motivo: string } {
  const t = expr.trim();
  if (t.startsWith("{")) return { objetos: [t], motivo: "" };
  if (t.startsWith("[")) {
    const f = casarFechamento(t, 0);
    const interior = t.slice(1, f < 0 ? t.length : f);
    if (interior.trim() === "") return { objetos: [], motivo: "array literal VAZIO na declaracao" };
    const objs: string[] = [];
    for (const el of argsDeTopo(interior)) {
      const e = el.trim();
      if (e.startsWith("{")) objs.push(e);
      else return { objetos: [], motivo: "array com elemento que nao e objeto literal" };
    }
    return { objetos: objs, motivo: "" };
  }
  // ...map(cb) — pega o ULTIMO .map da expressao (`xs.filter(...).map(...)`).
  let idxMap = -1;
  for (let k = 0; ; ) {
    const j = t.indexOf(".map(", k);
    if (j < 0) break;
    idxMap = j; k = j + 5;
  }
  if (idxMap >= 0) {
    const idxParen = idxMap + 4;
    const f = casarFechamento(t, idxParen);
    if (f < 0) return { objetos: [], motivo: "map com parenteses nao balanceado" };
    const cb = (argsDeTopo(t.slice(idxParen + 1, f))[0] || "").trim();
    const seta = cb.indexOf("=>");
    if (seta < 0) return { objetos: [], motivo: "callback do map nao e arrow" };
    const corpo = cb.slice(seta + 2).trim();
    if (corpo.startsWith("(")) {
      const fc = casarFechamento(corpo, 0);
      const dentro = corpo.slice(1, fc < 0 ? corpo.length : fc).trim();
      if (dentro.startsWith("{")) return { objetos: [dentro], motivo: "" };
      return { objetos: [], motivo: "arrow do map nao devolve objeto literal" };
    }
    if (corpo.startsWith("{")) {
      const mr = /\breturn\s*\{/.exec(corpo);
      if (!mr) return { objetos: [], motivo: "bloco do map sem `return {`" };
      const idxObj = mr.index + mr[0].length - 1;
      const fo = casarFechamento(corpo, idxObj);
      if (fo < 0) return { objetos: [], motivo: "objeto do return nao balanceado" };
      return { objetos: [corpo.slice(idxObj, fo + 1)], motivo: "" };
    }
    return { objetos: [], motivo: "corpo do map em forma que nao sei ler" };
  }
  return { objetos: [], motivo: "" };   // "" = tente resolver como identificador
}

/** Chaves de topo de um objeto literal em texto (`{ a: 1, b, ...c }`). */
function chavesDeObjeto(texto: string): { chaves: string[]; spread: boolean; computada: boolean } | null {
  const t = texto.trim();
  if (t[0] !== "{") return null;
  const fecha = casarFechamento(t, 0);
  if (fecha < 0) return null;
  const chaves: string[] = [];
  let spread = false;
  let computada = false;
  for (const seg of argsDeTopo(t.slice(1, fecha))) {
    const s = seg.trim();
    if (s === "") continue;
    if (s.startsWith("...")) { spread = true; continue; }
    if (s.startsWith("[")) { computada = true; continue; }
    let m = /^(["'`])((?:[^"'`\\]|\\.)*)\1\s*:/.exec(s);
    if (m) { chaves.push(m[2]); continue; }
    m = /^([A-Za-z_$][\w$]*)\s*:/.exec(s);
    if (m) { chaves.push(m[1]); continue; }
    m = /^([A-Za-z_$][\w$]*)\s*$/.exec(s);      // atalho { a, b }
    if (m) { chaves.push(m[1]); continue; }
    computada = true;                            // forma que nao sei ler
  }
  return { chaves, spread, computada };
}

/**
 * Objetos gravados por uma VARIAVEL usada em `.upsert(VAR)` / `.insert(VAR)`.
 *
 * ANCORA NA DECLARACAO MAIS PROXIMA ANTES DO USO, e isso e o conserto de um
 * FALSO POSITIVO medido: app/api/promotores/route.ts declara `const rows` DUAS
 * vezes (:424 para uma tabela, :651 para monthly_targets). A primeira versao
 * deste gate procurava `rows.push({...})` no arquivo INTEIRO e atribuia as
 * chaves da outra tabela a monthly_targets — acusando 5 colunas que nao faltam.
 * Nome de variavel generico (`rows`, `payload`, `batch`) e reusado o tempo todo;
 * varrer o arquivo inteiro por ele nao e cobertura, e ruido.
 *
 * Se a declaracao inicializa com [] vazio, ai sim os `.push({...})` valem — mas
 * so os que estao ENTRE esta declaracao e a proxima do mesmo nome.
 */
function objetosDaVariavel(src: string, nome: string, idxUso: number): { objetos: string[]; motivo: string } {
  const decls: number[] = [];
  const reDecl = new RegExp(`\\b(?:const|let|var)\\s+${nome}\\b`, "g");
  let md: RegExpExecArray | null;
  while ((md = reDecl.exec(src)) !== null) decls.push(md.index);
  const antes = decls.filter((d) => d < idxUso);
  if (antes.length === 0) return { objetos: [], motivo: `\`${nome}\` nao e declarado antes do uso neste arquivo` };
  const decl = antes[antes.length - 1];
  const proxima = decls.find((d) => d > decl);
  const limite = proxima === undefined ? src.length : proxima;

  // inicializador: do primeiro `=` de atribuicao ate o `;` de topo.
  let i = decl;
  let igual = -1;
  for (; i < limite; i++) {
    const c = src[i];
    if (c === "=" && src[i + 1] !== "=" && src[i + 1] !== ">" && src[i - 1] !== "=" && src[i - 1] !== "!" && src[i - 1] !== "<" && src[i - 1] !== ">") { igual = i; break; }
    if (c === ";" || c === "\n") { if (c === ";") break; }
  }
  if (igual < 0) return { objetos: [], motivo: `\`${nome}\` declarado sem inicializador legivel` };
  let depth = 0;
  let fimInit = limite;
  let estado: "code" | "sq" | "dq" | "tpl" = "code";
  for (let k = igual + 1; k < limite; k++) {
    const c = src[k];
    if (estado === "code") {
      if (c === "'") { estado = "sq"; continue; }
      if (c === '"') { estado = "dq"; continue; }
      if (c === "`") { estado = "tpl"; continue; }
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      else if (c === ";" && depth === 0) { fimInit = k; break; }
      continue;
    }
    if (c === "\\") { k++; continue; }
    if ((estado === "sq" && c === "'") || (estado === "dq" && c === '"') || (estado === "tpl" && c === "`")) estado = "code";
  }
  const init = src.slice(igual + 1, fimInit).trim();

  const direto = objetosDeExpressao(init);
  if (direto.objetos.length > 0) return direto;

  // `= []` (ou array vazio) -> as chaves nascem dos push DESTE escopo.
  const rePush = new RegExp(`\\b${nome}\\s*\\.\\s*push\\s*\\(`, "g");
  const objs: string[] = [];
  let mp: RegExpExecArray | null;
  while ((mp = rePush.exec(src)) !== null) {
    if (mp.index < decl || mp.index > limite) continue;
    const ip = mp.index + mp[0].length - 1;
    const fp = casarFechamento(src, ip);
    if (fp < 0) continue;
    const arg = (argsDeTopo(src.slice(ip + 1, fp))[0] || "").trim();
    const r = objetosDeExpressao(arg);
    for (const o of r.objetos) objs.push(o);
  }
  if (objs.length > 0) return { objetos: objs, motivo: "" };
  return {
    objetos: [],
    motivo: direto.motivo
      ? `\`${nome}\` (declarado antes do uso): ${direto.motivo}`
      : `\`${nome}\` vem de expressao que nao sei ler, e nao ha \`${nome}.push({...})\` no escopo dela`,
  };
}

// ===========================================================================
// EXTRATOR
// ===========================================================================

const pedidos: Pedido[] = [];
const naoCobertos: NaoCoberto[] = [];
const tabelasVistas = new Set<string>();
let sitiosFromBrutos = 0;   // `.from(` no arquivo cru (inclui comentario)
let sitiosFromReais = 0;    // `.from(` fora de comentario
let selectsLidos = 0;
let gravacoesLidas = 0;

function arquivosDe(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivosDe(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function inicioDeLinhas(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}

function linhaDe(starts: number[], off: number): number {
  let lo = 0, hi = starts.length - 1, r = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= off) { r = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return r + 1;
}

/** Normaliza um token de `.select()` para o nome de coluna, ou diz por que nao da. */
function colunaDeToken(tok: string): { coluna: string } | { erro: string } {
  let t = tok.trim();
  if (t === "" || t === "*") return { erro: "" };            // "" = ignorar em silencio
  if (t.indexOf("(") >= 0) return { erro: "recurso embutido/agregado" };
  if (t.indexOf("!") >= 0) return { erro: "dica de relacionamento (!inner/!fk)" };
  const doisPontos = t.indexOf(":");
  if (doisPontos >= 0) t = t.slice(doisPontos + 1).trim();   // alias:coluna
  const seta = t.indexOf("->");
  if (seta >= 0) t = t.slice(0, seta).trim();                // coluna->>chave (json)
  t = t.replace(/^"(.*)"$/, "$1");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return { erro: "token que nao e nome simples de coluna" };
  return { coluna: t };
}

for (const abs of [...arquivosDe(path.join(ROOT, "app")), ...arquivosDe(path.join(ROOT, "lib"))]) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  const bruto = fs.readFileSync(abs, "utf8");
  sitiosFromBrutos += (bruto.match(/\.from\s*\(/g) || []).length;

  const src = mascararComentarios(bruto);
  const starts = inicioDeLinhas(src);
  const consts = constantesDeString(src);

  const reFrom = /\.from\s*\(/g;
  let mf: RegExpExecArray | null;
  while ((mf = reFrom.exec(src)) !== null) {
    const idxParen = mf.index + mf[0].length - 1;
    const fechaFrom = casarFechamento(src, idxParen);
    if (fechaFrom < 0) continue;
    const linhaFrom = linhaDe(starts, mf.index);

    // Array.from / Buffer.from nao sao acesso a tabela.
    const antes = src.slice(Math.max(0, mf.index - 12), mf.index);
    if (/\b(Array|Buffer|Object|Date|Set|Map)\s*$/.test(antes)) continue;
    sitiosFromReais++;

    const argFrom = (argsDeTopo(src.slice(idxParen + 1, fechaFrom))[0] || "").trim();
    let tabela = literalDeString(argFrom);
    if (tabela === null) {
      const ident = /^([A-Za-z_$][\w$]*)$/.exec(argFrom);
      if (ident && consts.has(ident[1])) tabela = consts.get(ident[1]) as string;
    }
    if (tabela === null) {
      naoCobertos.push({
        origem: { arquivo: rel, linha: linhaFrom },
        motivo: "tabela por expressao/import — nao resolvi o nome",
        trecho: `.from(${argFrom.slice(0, 60)})`,
      });
      continue;
    }
    tabelasVistas.add(tabela);

    // ---- caminhar o encadeamento a partir do `.from(...)` ----
    let i = fechaFrom + 1;
    let guard = 0;
    while (i < src.length && guard++ < 100000) {
      const c = src[i];
      if (c === "'" || c === '"' || c === "`") { i = fimDeString(src, i) + 1; continue; }
      // saiu do encadeamento: fim da expressao ou proximo item de uma lista
      if (c === ")" || c === "]" || c === "}" || c === ";" || c === ",") break;
      if (c === "(" || c === "[" || c === "{") {
        const f = casarFechamento(src, i);
        if (f < 0) break;
        i = f + 1; continue;
      }
      if (c === ".") {
        const m = /^\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(i, i + 80));
        if (m) {
          const metodo = m[1];
          const idxM = i + m[0].length - 1;
          const fechaM = casarFechamento(src, idxM);
          if (fechaM < 0) break;
          const linhaM = linhaDe(starts, i);
          const origem: Origem = { arquivo: rel, linha: linhaM };
          const interior = src.slice(idxM + 1, fechaM);

          if (metodo === "select") {
            selectsLidos++;
            const primeiro = (argsDeTopo(interior)[0] || "").trim();
            if (primeiro === "") {
              // `.select()` sem argumento = todas as colunas; nao pede nome nenhum.
            } else {
              let conteudo = literalDeString(primeiro);
              if (conteudo === null) {
                const ident = /^([A-Za-z_$][\w$]*)$/.exec(primeiro);
                if (ident && consts.has(ident[1])) conteudo = consts.get(ident[1]) as string;
              }
              if (conteudo === null) {
                naoCobertos.push({ origem, motivo: "select por variavel/template interpolado", trecho: `.select(${primeiro.slice(0, 60)})` });
              } else {
                for (const tok of argsDeTopo(conteudo)) {
                  const r = colunaDeToken(tok);
                  if ("coluna" in r) pedidos.push({ tabela, coluna: r.coluna, via: "select", origem });
                  else if (r.erro !== "") naoCobertos.push({ origem, motivo: `select: ${r.erro}`, trecho: tok.trim().slice(0, 60) });
                }
              }
            }
          } else if (metodo === "upsert" || metodo === "insert" || metodo === "update") {
            gravacoesLidas++;
            const via = metodo as "upsert" | "insert" | "update";
            const primeiro = (argsDeTopo(interior)[0] || "").trim();
            let objetos: string[] = [];
            let motivoFalha = "";

            // 1) a propria expressao ja produz o objeto? ({...}, [{...}], .map(=>({...})))
            const direto = objetosDeExpressao(primeiro);
            if (direto.objetos.length > 0) {
              objetos = direto.objetos;
            } else if (direto.motivo !== "") {
              motivoFalha = direto.motivo;
            } else {
              // 2) `.upsert(VAR)` / `.upsert(VAR.slice(i, i+500), {...})` -> resolve
              //    pela DECLARACAO mais proxima antes deste uso (ver a funcao).
              const base = /^([A-Za-z_$][\w$]*)/.exec(primeiro);
              if (!base) {
                motivoFalha = "primeiro argumento nao e objeto, array nem identificador";
              } else {
                const r = objetosDaVariavel(src, base[1], i);
                objetos = r.objetos;
                motivoFalha = r.motivo;
              }
            }

            if (objetos.length === 0) {
              naoCobertos.push({ origem, motivo: `${via}: ${motivoFalha || "nao consegui extrair as chaves"}`, trecho: `.${via}(${primeiro.slice(0, 50)})` });
            }
            for (const o of objetos) {
              const k = chavesDeObjeto(o);
              if (!k) { naoCobertos.push({ origem, motivo: `${via}: objeto ilegivel`, trecho: o.slice(0, 50) }); continue; }
              if (k.spread) naoCobertos.push({ origem, motivo: `${via}: objeto tem spread (...) — as chaves de dentro dele NAO foram lidas`, trecho: o.slice(0, 50) });
              if (k.computada) naoCobertos.push({ origem, motivo: `${via}: objeto tem chave computada/ilegivel`, trecho: o.slice(0, 50) });
              for (const ch of k.chaves) pedidos.push({ tabela, coluna: ch, via, origem });
            }
          }
          i = fechaM + 1;
          continue;
        }
      }
      i++;
    }
  }
}

// ===========================================================================
// GUARDA DE VACUIDADE — extrator quebrado NAO pode passar verde
// ===========================================================================
// Sem isto, um refactor que quebre o parser devolveria lista vazia e o gate
// diria "0 divergencias" para sempre. As tres asserçoes abaixo sao calculadas
// no MESMO run que produz o resultado — nenhuma delas e numero congelado:
//   (1) achou pelo menos uma coluna;
//   (2) achou pelo menos uma tabela;
//   (3) achou coluna na ANCORA (promoter_monthly_results) — a tabela do
//       incidente, que tem 26 sitios em app+lib. Zero coluna nela so acontece
//       se o extrator quebrou.
const ANCORA = "promoter_monthly_results";
const colunasDaAncora = pedidos.filter((p) => p.tabela === ANCORA);

const linha = (c: string) => c.repeat(78);
console.log(linha("="));
console.log("GATE DE SCHEMA — coluna pedida pelo codigo x banco REAL");
console.log(linha("="));
console.log(`\n>>> EXTRACAO (app/ + lib/, .ts e .tsx)`);
console.log(`    sitios .from(...) no texto cru ....... ${sitiosFromBrutos}`);
console.log(`    sitios .from(...) fora de comentario . ${sitiosFromReais}`);
console.log(`    .select(...) lidos .................. ${selectsLidos}`);
console.log(`    .upsert/.insert/.update(...) lidos ... ${gravacoesLidas}`);
console.log(`    tabelas distintas resolvidas ........ ${tabelasVistas.size}`);
console.log(`    pedidos de coluna (tabela,coluna,sitio) ${pedidos.length}`);
console.log(`    ancora ${ANCORA} ...... ${colunasDaAncora.length} pedidos`);

// `--listar <tabela>` imprime o que o extrator VIU nessa tabela. Existe para o
// verde ser auditavel: sem isto, "0 divergencias" e indistinguivel de "o
// extrator perdeu a coluna e ninguem viu". Nao altera o veredito.
const idxListar = process.argv.indexOf("--listar");
if (idxListar >= 0) {
  const alvo = process.argv[idxListar + 1] || ANCORA;
  const doAlvo = pedidos.filter((p) => p.tabela === alvo);
  const porColuna = new Map<string, Pedido[]>();
  for (const p of doAlvo) {
    const l = porColuna.get(p.coluna);
    if (l) l.push(p); else porColuna.set(p.coluna, [p]);
  }
  console.log(`
>>> EXTRAIDO DE ${alvo}  (${porColuna.size} coluna(s) distinta(s))`);
  for (const [col, ps] of [...porColuna.entries()].sort()) {
    const vias = [...new Set(ps.map((x) => x.via))].sort().join("+");
    console.log(`    ${col.padEnd(36)} ${String(ps.length).padStart(3)} sitio(s)  [${vias}]`);
  }
}

const vacuidade: string[] = [];
if (pedidos.length === 0) vacuidade.push("nenhuma coluna extraida do codigo");
if (tabelasVistas.size === 0) vacuidade.push("nenhuma tabela extraida do codigo");
if (colunasDaAncora.length === 0) vacuidade.push(`nenhuma coluna extraida da ancora ${ANCORA}`);
if (vacuidade.length > 0) {
  console.log("\n" + linha("="));
  console.log("ABORTADO — GUARDA DE VACUIDADE");
  console.log(linha("="));
  for (const v of vacuidade) console.log("  - " + v);
  console.log("\n  O extrator nao produziu nada para conferir. Isso NAO e aprovacao:");
  console.log("  gate que devolve lista vazia passaria verde para sempre.");
  console.log("  Conserte o extrator (ou o alvo da varredura) antes de confiar neste gate.");
  process.exit(3);
}

// ===========================================================================
// O BANCO — o que EXISTE de fato
// ===========================================================================
// CAMINHO 1 (preferido): OpenAPI da raiz do PostgREST. UMA requisicao devolve
//   todas as tabelas com todas as colunas. Medido em 21/08/2026: 73 tabelas,
//   507 KB, 0,68s. Exige service_role (a anon leva 401 nessa rota).
//
// CAMINHO 2 (fallback): sonda por tabela. Pede TODAS as colunas de uma vez; o
//   PostgREST devolve 42703 nomeando a PRIMEIRA que nao existe, entao o laco
//   remove e repete ate a tabela responder. Custa 1 requisicao por tabela (mais
//   uma por coluna ausente).
//
//   O fallback funciona COM A CHAVE ANON, e isso e medido, nao suposto:
//     coluna que EXISTE, chave anon -> 42501 permission denied (RLS/grant)
//     coluna INEXISTENTE, chave anon -> 42703 column ... does not exist
//   O PostgREST resolve os nomes de coluna ANTES de aplicar permissao, entao a
//   ausencia de coluna se distingue da ausencia de permissao. Isso importa: a
//   anon key e NEXT_PUBLIC_ (ja vai no bundle do browser, nao e segredo), o que
//   deixa este gate CI-avel sem expor a service_role. Ver o bloco FAIXA no fim.

const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const KEY_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// `--anon` FORCA o caminho do CI mesmo com a service_role em disco. Existe para
// o caminho do CI ser EXERCITAVEL localmente: sem isto, ele so seria testado no
// dia em que quebrasse dentro do CI — que e a forma de gate morto que este repo
// ja pagou uma vez (o runner rodava `node arquivo.ts` e os 16 gates .ts/.mts
// eram orfaos por incapacidade, nao por esquecimento).
const FORCAR_ANON = process.argv.includes("--anon");
const USANDO_ANON = FORCAR_ANON || !KEY_SVC;
const KEY = USANDO_ANON ? KEY_ANON : KEY_SVC;
const ROTULO_CHAVE = USANDO_ANON ? "anon (publicavel, sb_publishable_)" : "service_role";

if (!URL_BASE || !KEY) {
  console.log("\n" + linha("="));
  console.log("ABORTADO — SEM CREDENCIAL");
  console.log(linha("="));
  if (!URL_BASE) console.log("  Faltou NEXT_PUBLIC_SUPABASE_URL.");
  if (!KEY && USANDO_ANON) console.log("  Faltou NEXT_PUBLIC_SUPABASE_ANON_KEY" + (FORCAR_ANON ? " (e --anon foi pedido)." : "."));
  if (!KEY && !USANDO_ANON) console.log("  Faltou uma chave (service_role ou anon).");
  console.log("  Este gate compara contra o BANCO REAL (ver o cabecalho); sem banco ele");
  console.log("  nao tem o que comparar. ABORTA em vez de passar: ausencia de medicao");
  console.log("  nunca e aprovacao.");
  console.log("  No CI, isto quer dizer que as repository VARIABLES nao chegaram ao passo.");
  process.exit(3);
}

function cab(): Record<string, string> {
  return { apikey: KEY, Authorization: `Bearer ${KEY}` };
}

type Erro = { code?: string; message?: string };

async function schemaViaOpenApi(): Promise<Map<string, Set<string>> | null> {
  // A raiz do PostgREST exige chave SECRETA: com a anon devolve 401 "Secret API
  // key required" (medido 21/08). Entao no CI este caminho nunca roda.
  if (USANDO_ANON || !KEY_SVC) return null;
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/`, {
      headers: { apikey: KEY_SVC, Authorization: `Bearer ${KEY_SVC}`, Accept: "application/openapi+json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }> };
    const defs = j.definitions;
    if (!defs || Object.keys(defs).length === 0) return null;
    const m = new Map<string, Set<string>>();
    for (const [t, d] of Object.entries(defs)) m.set(t, new Set(Object.keys(d.properties || {})));
    return m;
  } catch {
    return null;
  }
}

/** Sonda uma tabela pedindo todas as colunas; devolve as que nao existem. */
async function sondar(tabela: string, colunas: string[]): Promise<{ tabelaExiste: boolean; ausentes: string[] }> {
  const ausentes: string[] = [];
  let restantes = [...colunas];
  for (let volta = 0; volta <= colunas.length + 1; volta++) {
    if (restantes.length === 0) break;
    const url = `${URL_BASE}/rest/v1/${encodeURIComponent(tabela)}?select=${encodeURIComponent(restantes.join(","))}&limit=1`;
    const r = await fetch(url, { headers: cab() });
    if (r.ok) break;
    let e: Erro = {};
    try { e = (await r.json()) as Erro; } catch { /* corpo nao-json */ }
    const code = String(e.code || "");
    if (code === "42501") break;                       // colunas resolveram; so a permissao negou
    if (code === "PGRST205") return { tabelaExiste: false, ausentes: [] };
    if (code === "42703") {
      const m = /column\s+\S*?\.?([A-Za-z0-9_]+)\s+does not exist/i.exec(String(e.message || ""));
      const nome = m ? m[1] : "";
      if (nome && restantes.indexOf(nome) >= 0) {
        ausentes.push(nome);
        restantes = restantes.filter((c) => c !== nome);
        continue;
      }
      throw new Error(`42703 que nao consegui atribuir a uma coluna pedida (${tabela}): ${e.message}`);
    }
    throw new Error(`erro inesperado lendo ${tabela}: ${code} ${e.message || r.status}`);
  }
  return { tabelaExiste: true, ausentes };
}

const porTabela = new Map<string, Map<string, Pedido[]>>();
for (const p of pedidos) {
  let t = porTabela.get(p.tabela);
  if (!t) { t = new Map<string, Pedido[]>(); porTabela.set(p.tabela, t); }
  const lista = t.get(p.coluna);
  if (lista) lista.push(p); else t.set(p.coluna, [p]);
}

const t0 = Date.now();
const openapi = await schemaViaOpenApi();
const modo = openapi ? "OpenAPI — 1 requisicao" : `sonda por tabela — ${porTabela.size} requisicoes`;

const colunasAusentes: Array<{ tabela: string; coluna: string; sitios: Pedido[] }> = [];
const tabelasAusentes: Array<{ tabela: string; sitios: Origem[] }> = [];

for (const [tabela, colunas] of [...porTabela.entries()].sort()) {
  const nomes = [...colunas.keys()].sort();
  if (openapi) {
    const reais = openapi.get(tabela);
    if (!reais) {
      const sitios: Origem[] = [];
      for (const l of colunas.values()) for (const p of l) sitios.push(p.origem);
      tabelasAusentes.push({ tabela, sitios });
      continue;
    }
    for (const c of nomes) if (!reais.has(c)) colunasAusentes.push({ tabela, coluna: c, sitios: colunas.get(c) as Pedido[] });
  } else {
    const r = await sondar(tabela, nomes);
    if (!r.tabelaExiste) {
      const sitios: Origem[] = [];
      for (const l of colunas.values()) for (const p of l) sitios.push(p.origem);
      tabelasAusentes.push({ tabela, sitios });
      continue;
    }
    for (const c of r.ausentes) colunasAusentes.push({ tabela, coluna: c, sitios: colunas.get(c) as Pedido[] });
  }
}
const msBanco = Date.now() - t0;

console.log(`\n>>> BANCO  (${URL_BASE.replace(/^https?:\/\//, "")})`);
console.log(`    chave ............................... ${ROTULO_CHAVE}${FORCAR_ANON ? "   [--anon: forcado]" : ""}`);
console.log(`    modo ................................ ${modo}`);
console.log(`    tabelas conferidas .................. ${porTabela.size}`);
console.log(`    tempo ............................... ${(msBanco / 1000).toFixed(2)}s`);
if (USANDO_ANON) {
  // NAO PRESUMA PARIDADE. Medido em 21/08/2026, com a anon deste projeto:
  //   - a raiz OpenAPI devolve 401 "Secret API key required" -> so a sonda resta;
  //   - toda tabela existente responde 42501 (a anon nao tem grant em nenhuma),
  //     e o PostgREST resolve NOME DE COLUNA ANTES da permissao, entao 42703
  //     ainda aparece — inclusive misturando coluna existente e inexistente na
  //     MESMA consulta, nas duas ordens (testado);
  //   - tabela ausente responde PGRST205 igual a service_role.
  // O QUE SE PERDE: a lista do que EXISTE. A service_role traz todas as colunas
  // de cada tabela numa requisicao; a anon so consegue perguntar "esta existe?".
  // Consequencia pratica: com anon o gate NAO pode sugerir "voce quis dizer X?"
  // nem apontar coluna orfa no banco. O VEREDITO (falta/nao falta) e o mesmo.
  console.log("    NOTA: com a chave anon o gate so pergunta \"esta coluna existe?\".");
  console.log("          Nao le a lista do que existe, entao nao sugere coluna parecida.");
  console.log("          O veredito falta/nao-falta e o MESMO da service_role.");
}

// ===========================================================================
// NAO COBERTO — o que este gate NAO conferiu, dito em voz alta
// ===========================================================================
console.log(`\n>>> NAO COBERTO PELO EXTRATOR  (${naoCobertos.length} sitio(s))`);
if (naoCobertos.length === 0) {
  console.log("    nenhum — toda chamada varrida foi lida.");
} else {
  const porMotivo = new Map<string, NaoCoberto[]>();
  for (const n of naoCobertos) {
    const k = n.motivo.split("—")[0].trim();
    const l = porMotivo.get(k);
    if (l) l.push(n); else porMotivo.set(k, [n]);
  }
  for (const [motivo, lista] of [...porMotivo.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${lista.length}x  ${motivo}`);
    for (const n of lista.slice(0, 6)) console.log(`          ${n.origem.arquivo}:${n.origem.linha}   ${n.trecho}`);
    if (lista.length > 6) console.log(`          ... e mais ${lista.length - 6}`);
  }
  console.log("    Estes sitios NAO foram conferidos contra o banco. Verde aqui em cima");
  console.log("    NAO os cobre.");
}

// ===========================================================================
// VEREDITO
// ===========================================================================
console.log("\n" + linha("="));
console.log("RESULTADO");
console.log(linha("="));

const listaTabelas = [...porTabela.keys()].sort();
console.log(`\n  Tabelas conferidas (${listaTabelas.length}):`);
for (let i = 0; i < listaTabelas.length; i += 3) {
  console.log("    " + listaTabelas.slice(i, i + 3).map((t) => t.padEnd(34)).join("").trimEnd());
}

if (colunasAusentes.length === 0 && tabelasAusentes.length === 0) {
  console.log(`\n  PASSOU — as ${pedidos.length} colunas pedidas existem nas ${porTabela.size} tabelas conferidas.`);
  console.log(`           (${naoCobertos.length} sitio(s) NAO coberto(s), listados acima)`);
  process.exit(0);
}

if (colunasAusentes.length > 0) {
  console.log(`\n  FALHOU — ${colunasAusentes.length} COLUNA(S) QUE O CODIGO PEDE E O BANCO NAO TEM:\n`);
  for (const a of colunasAusentes) {
    console.log(`    ${a.tabela}.${a.coluna}   -> 42703 em runtime`);
    const vias = [...new Set(a.sitios.map((s) => s.via))].join(" + ");
    console.log(`      pedida por (${a.sitios.length} sitio(s), via ${vias}):`);
    for (const s of a.sitios) console.log(`        ${s.origem.arquivo}:${s.origem.linha}  (${s.via})`);
    console.log(`      DDL QUE FALTA:`);
    console.log(`        ALTER TABLE ${a.tabela} ADD COLUMN ${a.coluna} <tipo> ...;`);
    console.log(`      Procure o DDL em supabase/migrations/ E em scripts/sql/ (foi de`);
    console.log(`      scripts/sql/ que veio o incidente de 21/08). Se existir, ele NAO`);
    console.log(`      foi aplicado. Se nao existir, escreva-o em supabase/migrations/.\n`);
  }
}

if (tabelasAusentes.length > 0) {
  console.log(`\n  FALHOU — ${tabelasAusentes.length} TABELA(S) QUE O CODIGO LE E O BANCO NAO TEM:\n`);
  for (const a of tabelasAusentes) {
    console.log(`    ${a.tabela}   -> PGRST205 em runtime`);
    const unicos = [...new Set(a.sitios.map((s) => `${s.arquivo}:${s.linha}`))];
    console.log(`      lida por (${unicos.length} sitio(s)):`);
    for (const s of unicos) console.log(`        ${s}`);
    console.log(`      DDL QUE FALTA:  CREATE TABLE ${a.tabela} (...);\n`);
  }
  console.log("    NOTA: tabela ausente pode estar sendo TOLERADA em runtime (o codigo");
  console.log("    trata PGRST205 e degrada em vez de cair). Isso e PIOR, nao melhor: a");
  console.log("    funcionalidade fica DESLIGADA EM SILENCIO. Foi esse o agravante do");
  console.log("    incidente de 21/08 — a tolerancia deu impressao de deploy seguro.");
}

console.log("\n  RESULTADO: FALHOU");
process.exit(1);

/* ============================================================================
 * FAIXA — ONDE ESTE GATE RODA
 * ----------------------------------------------------------------------------
 * DOIS LUGARES, com chaves diferentes e custos diferentes:
 *
 *   1. CI, a cada pull_request para main — passo proprio em
 *      .github/workflows/gates.yml, `npx tsx ... --anon`, com as repository
 *      VARIABLES (nao secrets) NEXT_PUBLIC_SUPABASE_URL e
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY. Reprova o check.
 *
 *   2. `npm run gates:db` local (needs-db no run_all_gates.cjs), com a
 *      service_role que ja esta no .env.local.
 *
 * POR QUE NAO ENTROU NO `npm run gates`: aquele comando roda so os
 * self-contained e o criterio do runner reprova gate que le .env — este le. Um
 * passo separado no workflow resolve sem afrouxar o criterio de ninguem.
 *
 * O QUE MUDA ENTRE AS DUAS CHAVES (medido em 21/08/2026, nao presumido):
 *
 *                          service_role            anon (sb_publishable_)
 *   raiz OpenAPI           200, 73 tabelas         401 "Secret API key required"
 *   caminho                1 requisicao            sonda: 62 requisicoes
 *   tempo do bloco BANCO   0,8s - 1,9s             10,7s
 *   coluna ausente         detecta                 detecta (42703)
 *   tabela ausente         detecta                 detecta (PGRST205)
 *   le linha de dado       sim                     NAO (42501 nas 62 tabelas)
 *   lista o que EXISTE     sim                     NAO
 *
 *   O VEREDITO E O MESMO: as duas saidas foram comparadas por diff, ignorando
 *   so as linhas de chave/modo/tempo, e sao IDENTICAS. A deteccao de coluna
 *   ausente foi provada nos DOIS caminhos com colunas falsas injetadas (3
 *   colunas, 2 tabelas, via select e via update).
 *
 *   O QUE SE PERDE COM A ANON e a lista do que existe. Consequencia pratica:
 *   nenhuma hoje — o gate so pergunta "este nome resolve?". Se um dia ele for
 *   sugerir "voce quis dizer X?" ou apontar coluna ORFA no banco (existe e
 *   ninguem le), isso so funciona no caminho da service_role.
 *
 * POR QUE 42703 VENCE 42501, que e o que torna a anon suficiente: o PostgREST
 * resolve os nomes de coluna ANTES de aplicar permissao. Testado misturando
 * coluna existente e inexistente na MESMA consulta, nas DUAS ordens — o 42703
 * volta sempre. Se um dia essa ordem mudar do lado do PostgREST, este gate
 * comeca a passar por vacuidade no CI; o sinal seria o gate ficar verde no CI e
 * vermelho no gates:db para a mesma arvore.
 * ========================================================================== */
