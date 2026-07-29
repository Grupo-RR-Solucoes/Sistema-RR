/**
 * Trava do defeito de PRODUCAO de 29/07/2026: o import da diaria (owner FULL)
 * apagava a comissao de seguro ja calculada, porque trazia
 * `insurance_commission_amount: null` no payload e FULL escreve toda chave
 * presente. Resultado medido: 645/645 linhas do RR de julho zeradas, e o
 * Dashboard caindo de ~R$ 4,3 mil para R$ 27,08.
 *
 *   node --experimental-strip-types --test lib/__tests__/dailyRecordMerge.derived.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ownedColumnsFor,
  DERIVED_NEVER_UPDATED,
  CREDIT_COLUMNS,
  INSURANCE_COLUMNS,
  mergeDailyProductionRecords,
} from "../dailyRecordMerge.ts";

/**
 * Cliente-duble: devolve as linhas existentes que a gente mandar e CAPTURA os
 * upserts, para a simulacao de import rodar o codigo REAL do merge sem banco.
 */
function stubSupabase(existentes: any[]) {
  const upserts: Array<{ rows: any[]; opts: any }> = [];
  const client: any = {
    from() {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        range: () => q,
        upsert: (rows: any[], opts: any) => {
          upserts.push({ rows, opts });
          return Promise.resolve({ error: null });
        },
        then: (res: any) => res({ data: existentes, error: null }),
      };
      return q;
    },
  };
  return { client, upserts };
}

// Payload do import da diaria do RR, reduzido ao essencial (route.ts:592-616).
const PAYLOAD_IMPORT_RR = {
  company_id: "c1",
  proposal_number: "123",
  net_value: 1000,
  insurance_value: 50,
  company_received_percent: 3.21,
  insurance_commission_percent: null,
  insurance_commission_amount: null,
  status: "Produção",
};

test("FULL: o import NAO escreve a comissao de seguro (era o que zerava)", () => {
  const owned = ownedColumnsFor("FULL", PAYLOAD_IMPORT_RR as any);
  assert.ok(!owned.includes("insurance_commission_amount"));
  assert.ok(!owned.includes("insurance_commission_percent"));
  // o resto do payload continua sendo escrito, como sempre
  assert.ok(owned.includes("net_value"));
  assert.ok(owned.includes("insurance_value"));
  assert.ok(owned.includes("company_received_percent"));
  assert.ok(owned.includes("status"));
});

test("CREDIT: a diaria da ADS NAO zera a comissao do promotor", () => {
  // bbtsDailyImport:327-328 grava as duas como null.
  const payload = {
    company_id: "ads",
    proposal_number: "999",
    gross_value: 5000,
    promoter_commission_amount: null,
    promoter_commission_percent: null,
  };
  const owned = ownedColumnsFor("CREDIT", payload as any);
  assert.ok(!owned.includes("promoter_commission_amount"));
  assert.ok(!owned.includes("promoter_commission_percent"));
  assert.ok(owned.includes("gross_value"));
});

test("FULL do fechamento ADS NAO zera nenhuma das quatro", () => {
  // bbtsClosingImport:366-369 grava as QUATRO como null.
  const payload = {
    company_id: "ads",
    proposal_number: "888",
    gross_value: 7000,
    promoter_commission_amount: null,
    promoter_commission_percent: null,
    insurance_commission_amount: null,
    insurance_commission_percent: null,
  };
  const owned = ownedColumnsFor("FULL", payload as any);
  for (const col of DERIVED_NEVER_UPDATED) assert.ok(!owned.includes(col), col);
  assert.ok(owned.includes("gross_value"));
});

test("as quatro derivadas seguem declaradas nas listas de dono (documentacao)", () => {
  // Continuam listadas — a lista descreve QUEM e o dono do dado; a trava
  // descreve quem pode SOBRESCREVER a conclusao. Sao coisas diferentes.
  for (const c of ["promoter_commission_percent", "promoter_commission_amount"]) {
    assert.ok((CREDIT_COLUMNS as readonly string[]).includes(c), c);
  }
  for (const c of ["insurance_commission_percent", "insurance_commission_amount"]) {
    assert.ok((INSURANCE_COLUMNS as readonly string[]).includes(c), c);
  }
});

test("SIMULACAO DE REIMPORT: a comissao calculada SOBREVIVE", async () => {
  // Linha ja existente, com a comissao que o /api/calculate/monthly gravou.
  const existente = {
    company_id: "c1",
    proposal_number: "123",
    assigned_promoter_id: "p1",
    original_promoter_id: "p1",
    promoter_source: "IMPORT",
    raw_payload: {},
  };
  const { client, upserts } = stubSupabase([existente]);

  // O import da diaria roda de novo, com o MESMO payload que a rota monta hoje.
  await mergeDailyProductionRecords(client, {
    records: [PAYLOAD_IMPORT_RR as any],
    owner: "FULL",
  });

  assert.equal(upserts.length, 1, "deve haver exatamente 1 lote de UPDATE");
  const upd = upserts[0].rows[0];
  // O que importa: as colunas de comissao NAO viajam no UPDATE, entao o valor
  // gravado no banco permanece intacto.
  assert.ok(!("insurance_commission_amount" in upd));
  assert.ok(!("insurance_commission_percent" in upd));
  assert.ok(!("promoter_commission_amount" in upd));
  assert.ok(!("promoter_commission_percent" in upd));
  // E o resto do import continua sendo aplicado normalmente.
  assert.equal(upd.net_value, 1000);
  assert.equal(upd.insurance_value, 50);
});

test("SIMULACAO: ate um payload TEIMOSO (com null explicito) e barrado", async () => {
  // Defesa em profundidade: mesmo que alguem volte a por a chave no payload,
  // o merge nao a escreve. Foi assim que o defeito de 29/07 nasceu.
  const { client, upserts } = stubSupabase([
    { company_id: "c1", proposal_number: "9", raw_payload: {} },
  ]);
  await mergeDailyProductionRecords(client, {
    records: [
      {
        company_id: "c1",
        proposal_number: "9",
        net_value: 10,
        insurance_commission_amount: null,
        promoter_commission_amount: null,
      } as any,
    ],
    owner: "FULL",
  });
  const upd = upserts[0].rows[0];
  assert.ok(!("insurance_commission_amount" in upd));
  assert.ok(!("promoter_commission_amount" in upd));
  assert.equal(upd.net_value, 10);
});

test("SIMULACAO: linha NOVA continua entrando inteira (insert intacto)", async () => {
  const { client, upserts } = stubSupabase([]); // nada existente
  await mergeDailyProductionRecords(client, {
    records: [PAYLOAD_IMPORT_RR as any],
    owner: "FULL",
  });
  const ins = upserts[0].rows[0];
  assert.equal(ins.net_value, 1000);
  assert.equal(ins.proposal_number, "123");
});

test("colunas que NAO sao conclusao seguem sobrescritas normalmente", () => {
  const payload = { company_id: "c", proposal_number: "1", is_srcc_restricted: false, status: "X" };
  const owned = ownedColumnsFor("CREDIT", payload as any);
  assert.ok(owned.includes("is_srcc_restricted"));
  assert.ok(owned.includes("status"));
});
