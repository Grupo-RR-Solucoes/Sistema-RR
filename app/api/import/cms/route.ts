import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { importCmsWorkbook } from "@/lib/cmsImport";

export async function POST(req: Request) {
  try {
    // Mesmo guard do fechamento mensal: service_role atras de socio/admin.
    // Bulk write em cms_imports + cms_promoter_entries (ground truth do cms).
    const { user } = await withSocioAdmin();

    const body = await req.json();

    if (!body.file) {
      return NextResponse.json(
        { error: "Informe o arquivo do cms (base64)." },
        { status: 400 }
      );
    }

    // empresa e competencia (ano/mes de producao) saem do NOME DO ARQUIVO.
    const payload = await importCmsWorkbook({
      fileBase64: String(body.file),
      fileName: String(body.fileName || "cms.xlsx"),
      createdBy: user.session.appUser.email,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
