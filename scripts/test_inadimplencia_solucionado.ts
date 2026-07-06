// ============================================================
// TESTE — Fatia B (SOLUCIONADO). Roda:
//   npx tsc scripts/test_inadimplencia_solucionado.ts lib/auditoria/inadimplenciaAgregados.ts \
//     --outDir .tmp-test --module commonjs --target es2020 --moduleResolution node --esModuleInterop
//   node .tmp-test/scripts/test_inadimplencia_solucionado.js
//
// (a) marcar solucionado → sai da fila/agregados, recuperável aberto cai pelo valor dele.
// (b) reabrir → volta pra fila, recuperável aberto volta a incluir.
// (c) recálculo do motor → SOLUCIONADO PERSISTE: prova estrutural de que o
//     write-path do motor (persistInadimplencia) NUNCA toca resolucao_*.
// (d) guard: a rota de escrita é socio-only (withSocioAdmin → 403 p/ não-sócio).
// ============================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildInadimplenciaAgregados,
  type MonitorFilaRow,
} from "../lib/auditoria/inadimplenciaAgregados";

let fails = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FALHOU:"} ${msg}`);
  if (!cond) fails++;
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

const root = process.cwd();

// Fixture: 3 em aberto (1800 recuperável) na fila.
const rowA: MonitorFilaRow = { status_acompanhamento: "NOVO", recuperavel_estimado: 1000, resolucao_status: "PENDENTE" };
const rowB: MonitorFilaRow = { status_acompanhamento: "EM_COBRANCA", recuperavel_estimado: 500, resolucao_status: "PENDENTE" };
const rowC: MonitorFilaRow = { status_acompanhamento: "NOVO", recuperavel_estimado: 300, resolucao_status: "PENDENTE" };

console.log("\n[baseline] fila com 3 abertos (2 NOVO + 1 EM_COBRANCA), R$1.800");
const base = buildInadimplenciaAgregados([rowA, rowB, rowC]);
eq(base.novo, 2, "baseline novo=2");
eq(base.emCobranca, 1, "baseline emCobranca=1");
eq(base.recuperavelAberto, 1800, "baseline recuperável aberto=1800");
eq(base.solucionado, { contagem: 0, valor: 0 }, "baseline solucionado zerado");

console.log("\n(a) marcar rowC (R$300) como SOLUCIONADO");
const solucionadoC: MonitorFilaRow = { ...rowC, resolucao_status: "SOLUCIONADO" };
const afterMark = buildInadimplenciaAgregados([rowA, rowB, solucionadoC]);
eq(afterMark.novo, 1, "após marcar: novo cai 2→1 (rowC saiu da fila)");
eq(afterMark.recuperavelAberto, 1500, "após marcar: recuperável 1800→1500");
ok(base.recuperavelAberto - afterMark.recuperavelAberto === rowC.recuperavel_estimado, "queda do recuperável == valor do contrato marcado (300)");
eq(afterMark.solucionado, { contagem: 1, valor: 300 }, "após marcar: solucionado {1, R$300}");

console.log("\n(b) reabrir rowC → volta pra fila");
const reaberto: MonitorFilaRow = { ...solucionadoC, resolucao_status: "PENDENTE" };
const afterReopen = buildInadimplenciaAgregados([rowA, rowB, reaberto]);
eq(afterReopen.recuperavelAberto, 1800, "após reabrir: recuperável volta a 1800");
eq(afterReopen.novo, 2, "após reabrir: novo volta a 2");
eq(afterReopen.solucionado, { contagem: 0, valor: 0 }, "após reabrir: solucionado zera");

console.log("\n(c) blindagem: motor (persistInadimplencia) NUNCA escreve resolucao_*");
const persistSrc = readFileSync(join(root, "lib/auditoria/persistInadimplencia.ts"), "utf8");
ok(!/resolucao_/.test(persistSrc), "persistInadimplencia.ts não referencia nenhuma coluna resolucao_* → upsert/update do motor não a toca → SOLUCIONADO persiste ao recálculo");

console.log("\n(d) guard: rota de escrita é socio-only");
const resolverSrc = readFileSync(join(root, "app/api/auditoria/inadimplencia/resolver/route.ts"), "utf8");
ok(/withSocioAdmin/.test(resolverSrc), "resolver usa withSocioAdmin (requireSocio → 403 p/ não-sócio)");
const getSrc = readFileSync(join(root, "app/api/auditoria/inadimplencia/route.ts"), "utf8");
ok(/withSocioAnon/.test(getSrc), "GET da fila é socio-only (funcionário/promotor não leem nem veem a seção)");

console.log(fails === 0 ? "\n✅ TODOS OS TESTES PASSARAM\n" : `\n❌ ${fails} TESTE(S) FALHARAM\n`);
process.exit(fails === 0 ? 0 : 1);
