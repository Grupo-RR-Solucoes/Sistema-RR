#!/usr/bin/env node
/**
 * scripts/trp_seed_rule_versions.gen.cjs — GERADOR do seed de trp_rule_versions
 * para abr/mai/jun 2026 (Fase 2 TRP self-service).
 *
 * NÃO escreve no banco. Só LÊ os 3 JSON canônicos e EMITE um arquivo .sql
 * para o Diego revisar e rodar no Studio.
 *
 * FIDELIDADE (cópia fiel / deep-equal):
 *   O regra_json é embutido no SQL como o TEXTO EXATO do arquivo canônico,
 *   dentro de dollar-quoting ($rulejson$...$rulejson$) e convertido para ::jsonb.
 *   Ou seja: o Postgres faz o parse do MESMO texto que o bundler do Next importa
 *   hoje (import x from "....json"). Nada é transformado/normalizado/reordenado
 *   por este gerador. (jsonb canoniza ordem de chaves/espaços no armazenamento —
 *   a igualdade é SEMÂNTICA/deep-equal, não byte-a-byte; a prova de deep-equal
 *   está em scripts/trp_seed_verify_deepequal.cjs.)
 *
 * VIGÊNCIA (valid_from/valid_until):
 *   Calculada pelo util REAL lib/trp/vigencia.ts (vigenciaDaCompetencia),
 *   compilado on-the-fly — NUNCA cravada aqui. Quando o _meta do JSON declara
 *   vigencia_inicio/fim (mai/jun), o gerador ASSERTA que o util reproduz as
 *   mesmas datas (guarda contra drift); abril não declara → só computa.
 *
 * Uso:
 *   node scripts/trp_seed_rule_versions.gen.cjs
 *   -> escreve supabase/seeds/trp_rule_versions_abr_mai_jun_2026.seed.sql
 *      e imprime um resumo (competência, regime, vigência, doc, arquivo).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const JSON_DIR = path.join(ROOT, "regras_promotiva", "json");
const OUT_SQL = path.join(ROOT, "supabase", "seeds", "trp_rule_versions_abr_mai_jun_2026.seed.sql");

// competência (YYYY-MM) -> arquivo JSON canônico (== o que MAPA_MES_REGRA usa).
const COMPETENCIAS = [
  { comp: "2026-04", file: "TRP35_2026-04.json" },
  { comp: "2026-05", file: "TRP36_2026-05.json" },
  { comp: "2026-06", file: "TRP37_2026-06.json" },
];

// ---- Reusar o util REAL de vigência (compila lib/trp/vigencia.ts) ----
function loadVigenciaUtil() {
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "trp-vigencia-"));
  const tsconfig = {
    compilerOptions: {
      target: "ES2020",
      module: "commonjs",
      moduleResolution: "node",
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false,
      noEmit: false,
      declaration: false,
      outDir: OUT,
      rootDir: path.join(ROOT, "lib"),
    },
    include: [path.join(ROOT, "lib", "trp", "vigencia.ts")],
  };
  const cfgPath = path.join(OUT, "tsconfig.vigencia.json");
  fs.writeFileSync(cfgPath, JSON.stringify(tsconfig));
  execSync(`npx tsc -p "${cfgPath}"`, { cwd: ROOT, stdio: "inherit" });
  const emitted = path.join(OUT, "trp", "vigencia.js");
  if (!fs.existsSync(emitted)) throw new Error(`tsc não emitiu ${emitted}`);
  return require(emitted);
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function main() {
  const vigenciaUtil = loadVigenciaUtil();
  const linhas = [];
  const resumo = [];

  const header = [
    "-- ============================================================================",
    "-- SEED: trp_rule_versions — abr/mai/jun 2026 (Fase 2 TRP self-service)",
    "-- GERADO por scripts/trp_seed_rule_versions.gen.cjs — NÃO editar à mão.",
    "--",
    "-- Bootstrap da fonte versionada: 1 linha por competência, version_no=1,",
    "-- is_active=true. regra_json = cópia FIEL do JSON canônico (mesmo texto que o",
    "-- motor importa hoje). valid_from/valid_until = vigência holiday-aware do util",
    "-- lib/trp/vigencia.ts. ZERO mudança de comportamento: o motor segue no JSON",
    "-- (flag TRP_SOURCE=json). Rodar no Studio (SQL editor).",
    "--",
    "-- Idempotente: ON CONFLICT (competencia, version_no) DO UPDATE — rodar 2x é",
    "-- seguro e reescreve a mesma linha. Transacional.",
    "-- ============================================================================",
    "",
    "begin;",
    "",
  ];
  linhas.push(header.join("\n"));

  for (const { comp, file } of COMPETENCIAS) {
    const filePath = path.join(JSON_DIR, file);
    const raw = fs.readFileSync(filePath, "utf8");
    const obj = JSON.parse(raw);
    const meta = obj._meta || {};

    // regime: _meta.regime (assertado presente).
    const regime = meta.regime;
    if (!regime) throw new Error(`${file}: _meta.regime ausente`);

    // vigência via util REAL.
    const { validFrom, validUntil } = vigenciaUtil.vigenciaDaCompetencia(comp);

    // guarda contra drift: se o _meta declara vigência, tem que bater.
    if (meta.vigencia_inicio && meta.vigencia_inicio !== validFrom) {
      throw new Error(
        `${file}: _meta.vigencia_inicio (${meta.vigencia_inicio}) != util (${validFrom})`
      );
    }
    if (meta.vigencia_fim && meta.vigencia_fim !== validUntil) {
      throw new Error(
        `${file}: _meta.vigencia_fim (${meta.vigencia_fim}) != util (${validUntil})`
      );
    }

    const firstDay = vigenciaUtil.competenciaFirstDay(comp);
    const trpDocRef = meta.trp || null;
    const sourceFilename = meta.fonte_pdf ? path.basename(String(meta.fonte_pdf).replace(/\\/g, "/")) : null;

    // dollar-quoting seguro (checa que a tag não aparece no conteúdo).
    const tag = "$rulejson$";
    if (raw.includes(tag)) throw new Error(`${file}: conteúdo contém a tag de dollar-quoting ${tag}`);

    const bloco = [
      `-- ---- ${comp} (${file}) — ${trpDocRef || "sem doc"} ----`,
      `insert into trp_rule_versions`,
      `  (competencia, regime, valid_from, valid_until, version_no, is_active,`,
      `   trp_doc_ref, source_filename, notes, regra_json)`,
      `values (`,
      `  date ${sqlLiteral(firstDay)},`,
      `  ${sqlLiteral(regime)},`,
      `  date ${sqlLiteral(validFrom)},`,
      `  date ${sqlLiteral(validUntil)},`,
      `  1,`,
      `  true,`,
      `  ${sqlLiteral(trpDocRef)},`,
      `  ${sqlLiteral(sourceFilename)},`,
      `  ${sqlLiteral(`F2 bootstrap seed — fonte: regras_promotiva/json/${file}`)},`,
      `  ${tag}${raw}${tag}::jsonb`,
      `)`,
      `on conflict (competencia, version_no) do update set`,
      `  regime          = excluded.regime,`,
      `  valid_from      = excluded.valid_from,`,
      `  valid_until     = excluded.valid_until,`,
      `  is_active       = excluded.is_active,`,
      `  trp_doc_ref     = excluded.trp_doc_ref,`,
      `  source_filename = excluded.source_filename,`,
      `  notes           = excluded.notes,`,
      `  regra_json      = excluded.regra_json;`,
      "",
    ];
    linhas.push(bloco.join("\n"));

    resumo.push({ comp, regime, validFrom, validUntil, trpDocRef, sourceFilename, file, bytes: raw.length });
  }

  linhas.push("commit;");
  linhas.push("");
  linhas.push(
    [
      "-- ============================================================================",
      "-- Verificação pós-seed (rodar no Studio APÓS o commit)",
      "-- ============================================================================",
      "-- (a) 3 linhas ativas, uma por competência, version_no=1:",
      "--   select competencia, regime, valid_from, valid_until, version_no, is_active,",
      "--          trp_doc_ref, source_filename",
      "--     from trp_rule_versions",
      "--    where competencia in (date '2026-04-01', date '2026-05-01', date '2026-06-01')",
      "--    order by competencia;",
      "--   esperado: 3 linhas; regime VOLUME_5_FAIXAS; vigências",
      "--     2026-04: 2026-03-31 .. 2026-04-29",
      "--     2026-05: 2026-04-30 .. 2026-05-28",
      "--     2026-06: 2026-05-29 .. 2026-06-29",
      "--",
      "-- (b) só UMA versão ativa por competência (índice parcial):",
      "--   select competencia, count(*) filter (where is_active) as ativas",
      "--     from trp_rule_versions group by competencia order by competencia;  -- ativas = 1",
      "--",
      "-- (c) PROVA de deep-equal regra_json(banco) x JSON(arquivo), por competência:",
      "--   node scripts/trp_seed_verify_deepequal.cjs",
      "--   (lê o banco via service-role e compara valor-a-valor contra os arquivos)",
      "-- ============================================================================",
    ].join("\n")
  );

  fs.mkdirSync(path.dirname(OUT_SQL), { recursive: true });
  fs.writeFileSync(OUT_SQL, linhas.join("\n") + "\n", "utf8");

  console.log("SEED gerado:", path.relative(ROOT, OUT_SQL));
  console.log("");
  for (const r of resumo) {
    console.log(
      `  ${r.comp}  regime=${r.regime}  vigência ${r.validFrom}..${r.validUntil}  ` +
        `doc=${r.trpDocRef}  pdf=${r.sourceFilename}  (json=${r.file}, ${r.bytes} bytes)`
    );
  }
  console.log("");
  console.log("Revise o .sql e rode-o no Studio. Depois: node scripts/trp_seed_verify_deepequal.cjs");
}

main();
