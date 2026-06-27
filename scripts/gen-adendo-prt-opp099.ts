// Gerador pontual do ADITAMENTO PRT (OPP099): carta .docx + anexo .xlsx navy,
// empacotados num .zip salvo em C:/Users/diego/Downloads para conferência.
// Lê o dataset validado lib/minutas/data/opp099-prt-adendo-347.json.
// NÃO cria rota/botão, NÃO emite, NÃO grava no banco.
// Uso: npx tsx scripts/gen-adendo-prt-opp099.ts
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

import { construirDocx } from "../lib/minutas/docxBuilder.ts";
import {
  construirAnexoPrtAdendoXlsx,
  montarMinutaPrtAdendo,
  type DivergenciaPrtCobravel,
} from "../lib/minutas/minutaPrtAdendo.ts";

const OUT_DIR = "C:/Users/diego/Downloads";
const DATASET = path.resolve(
  import.meta.dirname,
  "../lib/minutas/data/opp099-prt-adendo-346.json"
);

type DatasetRow = {
  contrato: string;
  empresa: string;
  cnpj: string | null;
  produto: string | null;
  competencia: string;
  prazo: number;
  base: number;
  pctCheio: number;
  pctExcedente: number;
  prtCalculadoParcela: number;
  prtPagoParcela: number;
  diferencaTotal: number;
  dataFinalPrt: string | null;
  ativo: boolean;
};

async function main() {
  const ds = JSON.parse(fs.readFileSync(DATASET, "utf8")) as {
    meta: Record<string, unknown>;
    contratos: DatasetRow[];
  };

  const divergencias: DivergenciaPrtCobravel[] = ds.contratos.map((r) => ({
    contrato: r.contrato,
    empresa: r.empresa,
    cnpj: r.cnpj,
    produto: r.produto,
    competencia: r.competencia,
    prazo: r.prazo,
    base: r.base,
    pctCheio: r.pctCheio,
    pctExcedente: r.pctExcedente,
    prtCalculadoParcela: r.prtCalculadoParcela,
    prtPagoParcela: r.prtPagoParcela,
    diferencaTotal: r.diferencaTotal,
    dataFinalPrt: r.dataFinalPrt,
    ativo: r.ativo,
  }));

  const soma = divergencias.reduce((s, d) => s + Math.abs(d.diferencaTotal), 0);
  const ativos = divergencias.filter((d) => d.ativo).length;
  // Data de emissão fixa (sem Date.now() — determinístico/testável).
  const emissao = new Date("2026-06-26T12:00:00Z");

  const minuta = montarMinutaPrtAdendo({
    divergencias,
    somaACobrar: soma,
    emissao,
    competenciasLabel: "julho e setembro de 2024",
  });

  const [docxBuffer, xlsxBuffer] = await Promise.all([
    construirDocx(minuta),
    construirAnexoPrtAdendoXlsx(divergencias),
  ]);

  const zip = new JSZip();
  zip.file(`${minuta.nomeArquivo}.docx`, docxBuffer);
  zip.file("anexo-divergencias-prt-opp099.xlsx", xlsxBuffer);
  const zipBuffer = (await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  })) as Buffer;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const zipPath = path.join(OUT_DIR, "aditamento-prt-opp099.zip");
  fs.writeFileSync(zipPath, zipBuffer);

  console.log("OK ->", zipPath);
  console.log(
    `contratos: ${divergencias.length} | Σ diferença PRT: R$ ${soma.toFixed(2)} | ativos: ${ativos} (${Math.round((100 * ativos) / divergencias.length)}%)`
  );
  console.log(
    `peças: ${minuta.nomeArquivo}.docx (${docxBuffer.length} B) + anexo-divergencias-prt-opp099.xlsx (${xlsxBuffer.length} B)`
  );
}

main().catch((e) => {
  console.error("ERRO:", e);
  process.exit(1);
});
