// SEED idempotente da tabela convenio_segmento (rodar APÓS a migration
// 20260624000000_convenio_segmento.sql). Só verdade: diária (convenio_segment
// do banco) + convenios_oficiais.json (TRP23). Upsert por convenio_code.
//
// BLINDAGEM 2026-07: default DRY-RUN (só monta e mostra). Escreve SO com --apply.
// Uso: npx tsx scripts/seed-convenio-segmento.ts           (dry-run)
//      npx tsx scripts/seed-convenio-segmento.ts --apply   (grava)
import fs from "node:fs";
import path from "node:path";
for (const f of [".env", ".env.local"]) {
  try {
    for (const line of fs.readFileSync(path.resolve(f), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
  } catch {}
}
import { getSupabaseAdmin } from "../lib/supabaseAdmin.ts";
import { buildConvenioSegmentoSeed } from "../lib/convenioSegmento.ts";

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const sb = getSupabaseAdmin();
  const rows = await buildConvenioSegmentoSeed(sb);

  const porFonte: Record<string, number> = {};
  const porCategoria: Record<string, number> = {};
  for (const r of rows) {
    porFonte[r.fonte] = (porFonte[r.fonte] ?? 0) + 1;
    porCategoria[r.categoria_trp] = (porCategoria[r.categoria_trp] ?? 0) + 1;
  }

  // upsert em lotes (idempotente por convenio_code) — SO com --apply.
  const now = new Date().toISOString().slice(0, 10);
  const payload = rows.map((r) => ({ ...r, confirmado_em: now, updated_at: new Date().toISOString() }));
  let upserted = 0;
  if (apply) {
    const CHUNK = 500;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const slice = payload.slice(i, i + CHUNK);
      const { error } = await sb
        .from("convenio_segmento")
        .upsert(slice, { onConflict: "convenio_code" });
      if (error) {
        console.error("ERRO upsert (a tabela existe? rode a migration antes):", error.message);
        process.exit(1);
      }
      upserted += slice.length;
    }
    console.log(`convenio_segmento seedado: ${upserted} convênios`);
  } else {
    console.log(`DRY-RUN: gravaria ${payload.length} convênios (upsert idempotente). NADA gravado. Rode com --apply.`);
  }
  console.log("  por fonte:", JSON.stringify(porFonte));
  console.log("  por categoria:", JSON.stringify(porCategoria));
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});
