/* eslint-disable no-console */
// ============================================================================
// MEDIDA DO PONTO DE QUEBRA DA BARRA (FASE 6 do menu-topo)
//
// POR QUE EXISTE: a Fase 6 precisa de um breakpoint que saia da LARGURA REAL do
// conteudo, nao de um numero redondo. A conta da 55cbe84 foi estimada a mao e o
// proprio commit admitia "+-5% na largura de texto". Aqui o texto e medido.
//
// COMO: le os .woff2 que o next/font ja baixou em .next/static/media (a MESMA
// fonte que o browser carrega), decodifica o WOFF2 (diretorio de tabelas +
// brotli) e soma os advance widths do hmtx pelos glifos do cmap.
//
// A FONTE E VARIAVEL. IBM Plex Sans no Google Fonts virou variable font: ha UM
// arquivo por subset (nao um por peso), com eixo wght. Somar o hmtx cru daria
// SEMPRE o peso default (400) — os itens da barra sao 500, o nome 600 e o papel
// 700. Entao o script instancia o eixo: normaliza o wght por fvar, passa pelo
// avar e aplica os deltas do HVAR sobre cada advance. Sem isso a medida sairia
// estreita e o breakpoint, baixo demais.
//
// LIMITE CONHECIDO: nao aplica kerning (GPOS). Em IBM Plex Sans os pares
// latinos de caixa baixa tem kern ~0, e onde ele existe ENCOLHE o texto — logo
// esta medida e teto, nunca piso. A folga somada no fim cobre isso.
//
// Uso:  node scripts/medida-barra-breakpoint.cjs   [DUMP_FONTS=1 para inventario]
// ============================================================================

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const MEDIA = path.join(ROOT, ".next", "static", "media");

// ---------------------------------------------------------------- WOFF2 ----

const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ",
  "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp",
  "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF",
  "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
  "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc",
  "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx",
  "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function readBase128(buf, posRef) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const b = buf[posRef.p];
    posRef.p += 1;
    value = value * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) return value;
  }
  throw new Error("UIntBase128 malformado");
}

/** Decodifica um WOFF2 e devolve { tag: {data, transformed} }. */
function decodeWoff2(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("nao e woff2");
  const numTables = buf.readUInt16BE(12);

  const pos = { p: 48 };
  const dir = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[pos.p];
    pos.p += 1;
    const known = flags & 0x3f;
    let tag;
    if (known === 0x3f) {
      tag = buf.toString("latin1", pos.p, pos.p + 4);
      pos.p += 4;
    } else {
      tag = KNOWN_TAGS[known];
    }
    const transformVersion = (flags >> 6) & 0x03;
    const origLength = readBase128(buf, pos);
    // glyf/loca: transformadas quando version==0. Demais tabelas: transformadas
    // quando version!=0 (so hmtx tem transform definida, versao 1).
    const isGlyfLoca = tag === "glyf" || tag === "loca";
    const transformed = isGlyfLoca ? transformVersion === 0 : transformVersion !== 0;
    const transformLength = transformed ? readBase128(buf, pos) : origLength;
    dir.push({ tag, length: transformLength, transformed });
  }

  const decompressed = zlib.brotliDecompressSync(buf.subarray(pos.p));

  const tables = {};
  let off = 0;
  for (const entry of dir) {
    tables[entry.tag] = {
      data: decompressed.subarray(off, off + entry.length),
      transformed: entry.transformed,
    };
    off += entry.length;
  }
  return tables;
}

// ----------------------------------------------------------- TABELAS SFNT --

function parseCmap(data) {
  const numTables = data.readUInt16BE(2);
  let best = null;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 4 + i * 8;
    const platform = data.readUInt16BE(rec);
    const encoding = data.readUInt16BE(rec + 2);
    const offset = data.readUInt32BE(rec + 4);
    const format = data.readUInt16BE(offset);
    const unicode =
      platform === 3 ? encoding === 1 || encoding === 10 : platform === 0;
    if (!unicode) continue;
    const rank = format === 12 ? 2 : format === 4 ? 1 : 0;
    if (rank > 0 && (!best || rank > best.rank)) best = { offset, format, rank };
  }
  if (!best) throw new Error("cmap sem subtabela unicode");

  const map = new Map();
  if (best.format === 4) {
    const o = best.offset;
    const segX2 = data.readUInt16BE(o + 6);
    const seg = segX2 / 2;
    const endO = o + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    for (let s = 0; s < seg; s += 1) {
      const end = data.readUInt16BE(endO + s * 2);
      const start = data.readUInt16BE(startO + s * 2);
      const delta = data.readInt16BE(deltaO + s * 2);
      const rangeOffset = data.readUInt16BE(rangeO + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c !== 0x10000; c += 1) {
        let gid;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gi = rangeO + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= data.length) continue;
          const g = data.readUInt16BE(gi);
          gid = g === 0 ? 0 : (g + delta) & 0xffff;
        }
        if (gid) map.set(c, gid);
      }
    }
  } else {
    const o = best.offset;
    const nGroups = data.readUInt32BE(o + 12);
    for (let g = 0; g < nGroups; g += 1) {
      const rec = o + 16 + g * 12;
      const start = data.readUInt32BE(rec);
      const end = data.readUInt32BE(rec + 4);
      const startGid = data.readUInt32BE(rec + 8);
      for (let c = start; c <= end; c += 1) map.set(c, startGid + (c - start));
    }
  }
  return map;
}

function parseAdvances(hmtx, numberOfHMetrics) {
  const out = new Array(numberOfHMetrics);
  if (hmtx.transformed) {
    // hmtx transformada (versao 1): 1 byte de flags + advanceWidth[nHMetrics].
    // Os arrays de lsb podem ter sido omitidos; os advances NUNCA sao.
    for (let i = 0; i < numberOfHMetrics; i += 1) out[i] = hmtx.data.readUInt16BE(1 + i * 2);
  } else {
    for (let i = 0; i < numberOfHMetrics; i += 1) out[i] = hmtx.data.readUInt16BE(i * 4);
  }
  return out;
}

function parseNameFamily(data) {
  const count = data.readUInt16BE(2);
  const stringOffset = data.readUInt16BE(4);
  let family = null;
  for (let i = 0; i < count; i += 1) {
    const rec = 6 + i * 12;
    if (data.readUInt16BE(rec + 6) !== 1) continue; // nameID 1 = family
    const platform = data.readUInt16BE(rec);
    const len = data.readUInt16BE(rec + 8);
    const off = stringOffset + data.readUInt16BE(rec + 10);
    const raw = Buffer.from(data.subarray(off, off + len));
    family = platform === 3 ? raw.swap16().toString("utf16le") : raw.toString("latin1");
    if (platform === 3) break;
  }
  return family;
}

// ------------------------------------------------------ FONTE VARIAVEL -----

const f2dot14 = (buf, o) => buf.readInt16BE(o) / 16384;
const fixed = (buf, o) => buf.readInt32BE(o) / 65536;

function parseFvar(data) {
  const axesOffset = data.readUInt16BE(4);
  const axisCount = data.readUInt16BE(8);
  const axisSize = data.readUInt16BE(10);
  const axes = [];
  for (let i = 0; i < axisCount; i += 1) {
    const o = axesOffset + i * axisSize;
    axes.push({
      tag: data.toString("latin1", o, o + 4),
      min: fixed(data, o + 4),
      def: fixed(data, o + 8),
      max: fixed(data, o + 12),
    });
  }
  return axes;
}

function parseAvar(data, axisCount) {
  if (!data) return null;
  const maps = [];
  let o = 8;
  for (let a = 0; a < axisCount; a += 1) {
    const n = data.readUInt16BE(o);
    o += 2;
    const pairs = [];
    for (let i = 0; i < n; i += 1) {
      pairs.push([f2dot14(data, o), f2dot14(data, o + 2)]);
      o += 4;
    }
    maps.push(pairs);
  }
  return maps;
}

function applyAvar(pairs, v) {
  if (!pairs || pairs.length < 2) return v;
  for (let i = 0; i < pairs.length - 1; i += 1) {
    const [f1, t1] = pairs[i];
    const [f2, t2] = pairs[i + 1];
    if (v >= f1 && v <= f2) {
      if (f2 === f1) return t1;
      return t1 + ((v - f1) * (t2 - t1)) / (f2 - f1);
    }
  }
  return v;
}

/** Normaliza um valor de eixo para [-1,1] conforme fvar (+ avar). */
function normalize(axis, value, avarPairs) {
  const v = Math.max(axis.min, Math.min(axis.max, value));
  let n;
  if (v === axis.def) n = 0;
  else if (v < axis.def) n = (v - axis.def) / (axis.def - axis.min);
  else n = (v - axis.def) / (axis.max - axis.def);
  return applyAvar(avarPairs, Math.max(-1, Math.min(1, n)));
}

function parseDeltaSetIndexMap(data, offset) {
  if (!offset) return null;
  const format = data[offset];
  const entryFormat = data[offset + 1];
  const entrySize = ((entryFormat & 0x30) >> 4) + 1;
  const innerBits = (entryFormat & 0x0f) + 1;
  const mapCount = format === 0 ? data.readUInt16BE(offset + 2) : data.readUInt32BE(offset + 2);
  const dataStart = offset + (format === 0 ? 4 : 6);
  return { entrySize, innerBits, mapCount, dataStart };
}

function lookupDeltaSetIndex(data, map, gid) {
  if (!map) return { outer: 0, inner: gid };
  const i = Math.min(gid, map.mapCount - 1);
  let entry = 0;
  for (let b = 0; b < map.entrySize; b += 1) {
    entry = (entry << 8) | data[map.dataStart + i * map.entrySize + b];
  }
  return { outer: entry >>> map.innerBits, inner: entry & ((1 << map.innerBits) - 1) };
}

function parseItemVariationStore(data, offset) {
  const regionListOffset = offset + data.readUInt32BE(offset + 2);
  const dataCount = data.readUInt16BE(offset + 6);
  const dataOffsets = [];
  for (let i = 0; i < dataCount; i += 1) {
    dataOffsets.push(offset + data.readUInt32BE(offset + 8 + i * 4));
  }

  const axisCount = data.readUInt16BE(regionListOffset);
  const regionCount = data.readUInt16BE(regionListOffset + 2);
  const regions = [];
  let o = regionListOffset + 4;
  for (let r = 0; r < regionCount; r += 1) {
    const axes = [];
    for (let a = 0; a < axisCount; a += 1) {
      axes.push({
        start: f2dot14(data, o),
        peak: f2dot14(data, o + 2),
        end: f2dot14(data, o + 4),
      });
      o += 6;
    }
    regions.push(axes);
  }

  const subtables = dataOffsets.map((so) => {
    const itemCount = data.readUInt16BE(so);
    const word = data.readUInt16BE(so + 2);
    const longWords = (word & 0x8000) !== 0;
    const wordDeltaCount = word & 0x7fff;
    const regionIndexCount = data.readUInt16BE(so + 4);
    const regionIndexes = [];
    for (let i = 0; i < regionIndexCount; i += 1) {
      regionIndexes.push(data.readUInt16BE(so + 6 + i * 2));
    }
    const big = longWords ? 4 : 2;
    const small = longWords ? 2 : 1;
    const rowSize = wordDeltaCount * big + (regionIndexCount - wordDeltaCount) * small;
    return {
      itemCount,
      longWords,
      wordDeltaCount,
      regionIndexes,
      rowStart: so + 6 + regionIndexCount * 2,
      rowSize,
    };
  });

  return { regions, subtables };
}

function deltaFor(data, store, outer, inner, scalars) {
  const st = store.subtables[outer];
  if (!st || inner >= st.itemCount) return 0;
  let o = st.rowStart + inner * st.rowSize;
  let delta = 0;
  for (let i = 0; i < st.regionIndexes.length; i += 1) {
    let d;
    if (i < st.wordDeltaCount) {
      d = st.longWords ? data.readInt32BE(o) : data.readInt16BE(o);
      o += st.longWords ? 4 : 2;
    } else {
      d = st.longWords ? data.readInt16BE(o) : data.readInt8(o);
      o += st.longWords ? 2 : 1;
    }
    delta += d * scalars[st.regionIndexes[i]];
  }
  return delta;
}

function regionScalars(regions, coords) {
  return regions.map((axes) => {
    let scalar = 1;
    for (let a = 0; a < axes.length; a += 1) {
      const { start, peak, end } = axes[a];
      const c = coords[a] ?? 0;
      if (peak === 0) continue;
      if (c === peak) continue;
      if (c <= start || c >= end) return 0;
      scalar *= c < peak ? (c - start) / (peak - start) : (end - c) / (end - peak);
    }
    return scalar;
  });
}

function loadFont(file) {
  const tables = decodeWoff2(fs.readFileSync(file));
  if (!tables.head || !tables.hhea || !tables.hmtx || !tables.cmap) return null;
  const font = {
    file: path.basename(file),
    unitsPerEm: tables.head.data.readUInt16BE(18),
    family: tables.name ? parseNameFamily(tables.name.data) : null,
    defaultWeight: tables["OS/2"] ? tables["OS/2"].data.readUInt16BE(4) : null,
    cmap: parseCmap(tables.cmap.data),
    baseAdvances: parseAdvances(tables.hmtx, tables.hhea.data.readUInt16BE(34)),
    variable: false,
  };
  if (tables.fvar && tables.HVAR) {
    font.variable = true;
    font.axes = parseFvar(tables.fvar.data);
    font.avar = parseAvar(tables.avar && tables.avar.data, font.axes.length);
    const h = tables.HVAR.data;
    font.hvar = {
      data: h,
      store: parseItemVariationStore(h, h.readUInt32BE(4)),
      advMap: parseDeltaSetIndexMap(h, h.readUInt32BE(8)),
    };
  }
  return font;
}

/** Advance de um glifo, com o eixo wght instanciado no peso pedido. */
function advanceAt(font, gid, weight) {
  const base = font.baseAdvances[gid] ?? font.baseAdvances[font.baseAdvances.length - 1];
  if (!font.variable) return base;
  const key = `w${weight}`;
  if (!font.__scalars) font.__scalars = {};
  if (!font.__scalars[key]) {
    const coords = font.axes.map((axis, i) =>
      axis.tag === "wght" ? normalize(axis, weight, font.avar && font.avar[i]) : 0
    );
    font.__scalars[key] = regionScalars(font.hvar.store.regions, coords);
  }
  const { outer, inner } = lookupDeltaSetIndex(font.hvar.data, font.hvar.advMap, gid);
  return base + deltaFor(font.hvar.data, font.hvar.store, outer, inner, font.__scalars[key]);
}

/** Largura em px de `text`, no peso e tamanho dados, com letter-spacing em em. */
function measure(font, text, weight, sizePx, letterSpacingEm = 0) {
  const chars = Array.from(text);
  let units = 0;
  for (const ch of chars) {
    const gid = font.cmap.get(ch.codePointAt(0));
    if (gid == null) throw new Error(`glifo ausente para "${ch}" em ${font.file}`);
    units += advanceAt(font, gid, weight);
  }
  // letter-spacing entra depois de CADA caractere, inclusive o ultimo (CSS).
  return (units / font.unitsPerEm) * sizePx + chars.length * letterSpacingEm * sizePx;
}

// ------------------------------------------------------------- INVENTARIO --

const files = fs
  .readdirSync(MEDIA)
  .filter((f) => f.endsWith(".woff2"))
  .map((f) => path.join(MEDIA, f));

const fonts = [];
for (const f of files) {
  try {
    const font = loadFont(f);
    if (font) fonts.push(font);
  } catch {
    /* subset sem as tabelas que interessam */
  }
}

// Tudo que a barra escreve. O subset escolhido precisa ter todos estes glifos.
const ALFABETO = "AaÁáÂâÃãÇçÉéÍíÓóÕõÚúNnRrSsTtUuVvWwXxZz &%()0123456789";

const sans = fonts
  .filter(
    (f) =>
      f.family &&
      /^IBM Plex Sans$/.test(f.family) &&
      Array.from(ALFABETO).every((c) => f.cmap.has(c.codePointAt(0)))
  )
  .sort((a, b) => b.cmap.size - a.cmap.size)[0];

if (!sans) throw new Error("subset latin do IBM Plex Sans nao encontrado em .next/static/media");

if (process.env.DUMP_FONTS) {
  console.log(`inventario: ${fonts.length}/${files.length} woff2 decodificados`);
  for (const f of fonts) {
    console.log(`  ${f.file} | ${f.family} | OS/2=${f.defaultWeight} | glifos=${f.cmap.size} | variavel=${f.variable}`);
  }
  console.log();
}

console.log("=== FONTE (a mesma que o browser carrega) ===");
console.log(`  arquivo   : .next/static/media/${sans.file}`);
console.log(`  familia   : ${sans.family}   unitsPerEm=${sans.unitsPerEm}   glifos=${sans.cmap.size}`);
console.log(`  variavel  : ${sans.variable ? "SIM" : "nao"}${sans.variable ? `  eixos=[${sans.axes.map((a) => `${a.tag} ${a.min}..${a.def}..${a.max}`).join(", ")}]` : ""}`);
if (sans.variable) {
  // Prova de que a instanciacao do eixo esta viva: se HVAR nao fosse aplicado,
  // os tres pesos dariam a MESMA largura.
  const amostra = "Importações";
  console.log(
    `  prova wght: "${amostra}" 400=${measure(sans, amostra, 400, 13).toFixed(2)}px  500=${measure(sans, amostra, 500, 13).toFixed(2)}px  600=${measure(sans, amostra, 600, 13).toFixed(2)}px  700=${measure(sans, amostra, 700, 13).toFixed(2)}px`
  );
}

// ------------------------------------------------- GEOMETRIA DA BARRA (CSS) --
// Fonte de verdade: app/globals.css (.rr-nav*) + components/TopNav.tsx.
const CSS = {
  navPaddingX: 18,   // .rr-nav padding: 0 18px
  navGap: 16,        // .rr-nav gap
  burger: 34,        // .rr-nav__burger 34x34
  brand: 40,         // BrandLogo size="sm" -> WIDTHS.sm
  itemPaddingX: 13,  // .rr-nav__item padding: 0 13px
  itemIcon: 17,      // .rr-nav__ic
  itemGap: 8,        // .rr-nav__item gap
  listGap: 2,        // .rr-nav__list gap
  itemFont: 13,      // .rr-nav__item font-size / weight 500
  avatar: 30,        // .rr-nav__avatar
  userGap: 10,       // .rr-nav__user gap
  logout: 34,        // .rr-nav__logout
  unameMax: 180,     // .rr-nav__uname max-width
  unameFont: 13,     // peso 600
  uroleFont: 11,     // peso 700
  uroleTracking: 0.04, // letter-spacing: 0.04em
};

const textoItem = (label) => measure(sans, label, 500, CSS.itemFont);
const larguraItem = (label) => CSS.itemPaddingX * 2 + CSS.itemIcon + CSS.itemGap + textoItem(label);

// ------------------------------------------------------- BARRAS POR PAPEL --
// Reproduz o resultado de barItems (AppShell.tsx) para cada papel: preferidos
// da NAV_BARRA na ordem, completando ate 7 na ordem de declaracao dos grupos.
const BARRAS = {
  socio: ["Dashboard", "Promotores", "Projeção", "Importações", "Cadastros", "Atribuição", "Financeiro"],
  funcionario: ["Promotores", "Projeção", "Importações", "Cadastros", "Atribuição", "Receita & Simples", "Despesas"],
  promotor: ["Promotores", "Projeção"],
  supervisor: ["Minha Equipe"],
  gerente_regional: ["Minha Equipe"],
  gestor_consorcio: ["Consórcio (10%)", "Atribuir consórcio"],
};
// Papeis com MAIS destinos do que cabem na barra ja ganham hamburguer hoje.
const COM_HAMBURGUER = new Set(["socio", "funcionario"]);

const ROLE_LABEL = {
  socio: "Sócio",
  funcionario: "Auxiliar Financeiro",
  promotor: "Promotor",
  supervisor: "Supervisor",
  gerente_regional: "Gerente Regional",
  gestor_consorcio: "Gestor de Consórcio",
};

console.log("\n=== ROTULOS DA BARRA, MEDIDOS (13px, peso 500) ===");
const todos = new Map();
for (const labels of Object.values(BARRAS)) for (const l of labels) todos.set(l, larguraItem(l));
for (const [label, w] of [...todos].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${label.padEnd(20)} texto ${textoItem(label).toFixed(1).padStart(6)}px    item ${w.toFixed(1).padStart(6)}px`);
}

// ---------------------------------------------------------- BLOCO USUARIO --
console.log("\n=== BLOCO DO USUARIO (avatar + nome/papel + sair) ===");
let piorUser = 0;
let piorUserQuem = "";
for (const [role, label] of Object.entries(ROLE_LABEL)) {
  const roleW = measure(sans, label, 700, CSS.uroleFont, CSS.uroleTracking);
  // O nome trava em max-width 180px; o papel pode ser mais largo que isso? nao,
  // mas a coluna e o MAIOR dos dois.
  const uinfo = Math.max(CSS.unameMax, roleW);
  const total = CSS.avatar + CSS.userGap + uinfo + CSS.userGap + CSS.logout;
  if (total > piorUser) {
    piorUser = total;
    piorUserQuem = role;
  }
  console.log(`  ${role.padEnd(18)} papel "${label}" = ${roleW.toFixed(1).padStart(6)}px   ->  bloco ${total.toFixed(1)}px`);
}
console.log(`  PIOR CASO: ${piorUser.toFixed(1)}px (${piorUserQuem}) — o nome satura no max-width 180px`);

const nomeDiego = measure(sans, "Rodrigues", 600, CSS.unameFont);
const papelDiego = measure(sans, "Sócio", 700, CSS.uroleFont, CSS.uroleTracking);
const userDiego = CSS.avatar + CSS.userGap + Math.max(nomeDiego, papelDiego) + CSS.userGap + CSS.logout;
console.log(`  Diego na tela: "Rodrigues" ${nomeDiego.toFixed(1)}px / "Sócio" ${papelDiego.toFixed(1)}px  ->  bloco ${userDiego.toFixed(1)}px`);

// ------------------------------------------------------------ BREAKPOINT ---
function larguraNecessaria(labels, comHamburguer, blocoUser) {
  const lista = labels.reduce((s, l) => s + larguraItem(l), 0) + CSS.listGap * (labels.length - 1);
  const filhos = comHamburguer ? 4 : 3; // burger?, marca, nav, usuario
  const cromo =
    CSS.navPaddingX * 2 +
    CSS.navGap * (filhos - 1) +
    (comHamburguer ? CSS.burger : 0) +
    CSS.brand +
    blocoUser;
  return { lista, cromo, total: lista + cromo };
}

console.log("\n=== LARGURA MINIMA PARA A BARRA EXPANDIDA, POR PAPEL (pior bloco de usuario) ===");
let pior = null;
for (const [role, labels] of Object.entries(BARRAS)) {
  const r = larguraNecessaria(labels, COM_HAMBURGUER.has(role), piorUser);
  console.log(
    `  ${role.padEnd(18)} ${String(labels.length).padStart(2)} itens   lista ${r.lista.toFixed(1).padStart(7)}px + cromo ${r.cromo.toFixed(1).padStart(6)}px = ${r.total.toFixed(1).padStart(7)}px`
  );
  if (!pior || r.total > pior.total) pior = { role, ...r };
}
console.log(`\n  PIOR PAPEL: ${pior.role} — precisa de ${pior.total.toFixed(1)}px de viewport.`);

// Folga: a medida ignora kerning (que so encolhe) e o arredondamento subpixel
// do browser; e o zoom do usuario reescala tudo. 20px < meio item.
const FOLGA = 20;
const BP = Math.ceil((pior.total + FOLGA) / 10) * 10;
console.log(`  + folga de ${FOLGA}px (subpixel/zoom/kerning) = ${(pior.total + FOLGA).toFixed(1)}px`);
console.log(`\n  >>> PONTO DE QUEBRA: ${BP}px  (colapsa em @media (max-width: ${BP - 0.02}px))`);

// --------------------------------------------------------- VIEWPORTS TESTE --
console.log("\n=== VIEWPORTS PEDIDOS (barra do pior papel) ===");
for (const vw of [1920, 1440, 1366, 1024, 890, 768, 375]) {
  const sobra = vw - pior.total;
  const modo = vw >= BP ? "EXPANDIDA" : "COLAPSADA";
  const nota =
    modo === "EXPANDIDA"
      ? `sobra ${sobra.toFixed(0)}px na barra`
      : `barra expandida FALTARIA ${Math.max(0, -sobra).toFixed(0)}px -> vai para a gaveta`;
  console.log(`  ${String(vw).padStart(4)}px  ${modo.padEnd(9)}  ${nota}`);
}

// Modo colapsado: [hamburguer] [marca] [usuario]. Cabe onde?
const colapsada = CSS.navPaddingX * 2 + CSS.navGap * 2 + CSS.burger + CSS.brand + piorUser;
const colapsadaMin =
  CSS.navPaddingX * 2 + CSS.navGap * 2 + CSS.burger + CSS.brand + CSS.avatar + CSS.userGap + CSS.logout;
console.log(`\n  Colapsada com nome+papel : ${colapsada.toFixed(0)}px  -> cabe em 768px? ${colapsada <= 768 ? "SIM" : "NAO"}`);
console.log(`  Colapsada so avatar+sair : ${colapsadaMin.toFixed(0)}px  -> cabe em 375px? ${colapsadaMin <= 375 ? "SIM" : "NAO"}`);
console.log(
  `  => abaixo de ${colapsada.toFixed(0)}px o nome/papel PRECISAM sair (sobrariam ${(375 - colapsada).toFixed(0)}px em 375px).`
);

// ============================================================================
// GATE — nenhuma largura pode sobrepor.
//
// Modela as regras que estao de fato no app/globals.css e confere, papel a
// papel, largura a largura, se a soma dos elementos VISIVEIS cabe no viewport.
// Se couber, nao ha como sobrepor: a barra e um flex de filhos flex:none, e o
// unico que crescia (a lista) agora some inteiro no colapso.
// ============================================================================
// Os tres pontos de quebra saem da MESMA regra: exigido + 20px de folga,
// arredondado para cima na dezena. Nada de numero redondo escolhido a mao.
//
//   cheia  1276,1 + 20 = 1296,1 -> 1300
//   curta   680,9 + 20 =  700,9 ->  710
//   uinfo   406,0 + 20 =  426,0 ->  430
const REGRAS = {
  bpCheia: 1300,   // .rr-nav[data-bar="cheia"]  colapsa abaixo disto
  bpCurta: 710,    // .rr-nav[data-bar="curta"]  colapsa abaixo disto
  bpUinfo: 430,    // .rr-nav__uinfo some abaixo disto
};

function layoutEm(role, vw) {
  const labels = BARRAS[role];
  const barSize = labels.length > 2 ? "cheia" : "curta"; // TopNav.tsx
  const bp = barSize === "cheia" ? REGRAS.bpCheia : REGRAS.bpCurta;
  const colapsado = vw < bp;

  // Hamburguer: visivel se o papel ja o tinha, ou se a barra colapsou.
  const temBurger = COM_HAMBURGUER.has(role) || colapsado;
  const mostraUinfo = vw >= REGRAS.bpUinfo;

  const bloco =
    CSS.avatar +
    CSS.userGap +
    (mostraUinfo ? CSS.unameMax : 0) +
    (mostraUinfo ? CSS.userGap : 0) +
    CSS.logout;

  const lista = colapsado
    ? 0
    : labels.reduce((s, l) => s + larguraItem(l), 0) + CSS.listGap * (labels.length - 1);

  // Filhos visiveis do flex: [burger?] marca nav? usuario
  const filhos = (temBurger ? 1 : 0) + 1 + (colapsado ? 0 : 1) + 1;
  const necessario =
    CSS.navPaddingX * 2 +
    CSS.navGap * (filhos - 1) +
    (temBurger ? CSS.burger : 0) +
    CSS.brand +
    lista +
    bloco;

  return { barSize, colapsado, temBurger, mostraUinfo, necessario, sobra: vw - necessario };
}

console.log("\n=== GATE: sobreposicao em cada largura x papel ===");
console.log("     (sobra < 0 = os itens encostariam no bloco do usuario)\n");

const LARGURAS = [1920, 1440, 1366, 1300, 1299, 1024, 890, 768, 700, 699, 420, 419, 375];
const papeis = Object.keys(BARRAS);

const cab = ["largura".padEnd(8), ...papeis.map((r) => r.slice(0, 9).padStart(11))].join("");
console.log(cab);
console.log("-".repeat(cab.length));

let falhas = 0;
for (const vw of LARGURAS) {
  const cels = papeis.map((role) => {
    const r = layoutEm(role, vw);
    if (r.sobra < 0) falhas += 1;
    const marca = r.colapsado ? "gav" : "bar";
    return `${marca} ${r.sobra >= 0 ? "+" : ""}${r.sobra.toFixed(0)}`.padStart(11);
  });
  console.log(`${String(vw).padEnd(8)}${cels.join("")}`);
}
console.log("\n  bar = barra expandida   gav = tudo na gaveta   numero = px de sobra");

// Varredura fina: 320px ate 1920px, de 1 em 1.
let piorSweep = { sobra: Infinity };
for (let vw = 320; vw <= 1920; vw += 1) {
  for (const role of papeis) {
    const r = layoutEm(role, vw);
    if (r.sobra < piorSweep.sobra) piorSweep = { vw, role, ...r };
    if (r.sobra < 0) falhas += 1;
  }
}
console.log(
  `\n  Varredura 320..1920px x ${papeis.length} papeis = ${(1601 * papeis.length).toLocaleString("pt-BR")} combinacoes.`
);
console.log(
  `  Pior folga: ${piorSweep.sobra.toFixed(1)}px em ${piorSweep.vw}px (${piorSweep.role}, ${piorSweep.colapsado ? "gaveta" : "barra"}).`
);

if (falhas > 0) {
  console.log(`\n  >>> GATE REPROVADO: ${falhas} combinacoes com sobreposicao.`);
  process.exitCode = 1;
} else {
  console.log("\n  >>> GATE OK: nenhuma largura sobrepoe em nenhum papel.");
}
