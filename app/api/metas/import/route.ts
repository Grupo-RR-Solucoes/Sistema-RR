import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioOrFuncionarioAdmin,
} from "@/lib/auth/guards";
import { importMetasWorkbook } from "@/lib/metasImport";

// ============================================================
// FRENTE C — POST /api/metas/import
// Recebe o xlsx em base64 e chama a LIB REAL lib/metasImport.ts (mesma
// funcao do runner scripts/run_metas_import_maio.cjs).
//
// body: { file: base64, sheetName?: string, dryRun?: boolean }
// dryRun=true (default) so calcula o relatorio, NAO escreve nada.
// ============================================================

export async function POST(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();
    const body = await req.json().catch(() => ({}));
    const fileB64: string | undefined = body?.file;
    const dryRun: boolean = body?.dryRun !== false; // default true

    if (!fileB64) {
      return NextResponse.json(
        { error: "Arquivo nao enviado (campo 'file' em base64)." },
        { status: 400 }
      );
    }

    const report = await importMetasWorkbook({
      supabase,
      fileBuffer: Buffer.from(fileB64, "base64"),
      dryRun,
      sheetName: body?.sheetName,
    });

    return NextResponse.json(report);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
