import { processarFechamento } from "@/lib/fechamento";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.records || !Array.isArray(body.records)) {
      return Response.json(
        { error: "Formato inválido" },
        { status: 400 }
      );
    }

    const resultado = await processarFechamento(body.records);

    return Response.json(resultado);
  } catch (err: any) {
    return Response.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
