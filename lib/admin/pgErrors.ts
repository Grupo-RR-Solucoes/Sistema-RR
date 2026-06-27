import { NextResponse } from "next/server";

type PgLikeError = {
  code?: string;
  message?: string;
  details?: string;
};

/**
 * Mapeia uma unique violation do Postgres (SQLSTATE 23505) para uma resposta
 * 409 com mensagem amigável, SEM expor SQL nem o nome da constraint.
 *
 * Cadastro é feito por sócio/funcionário autenticado, então identificar QUAL
 * campo duplicou (CPF ou e-mail) é aceitável — ajuda a corrigir digitação.
 *
 * Retorna a NextResponse quando o erro é 23505; caso contrário `null` (o caller
 * segue o tratamento normal). Identifica o campo pela menção a "cpf"/"email" na
 * mensagem/details (ex.: índice `app_users_cpf_unique`, constraint de e-mail),
 * mas nunca devolve esse texto ao cliente.
 */
export function uniqueViolationResponse(error: unknown): NextResponse | null {
  if (!error || typeof error !== "object") return null;
  const e = error as PgLikeError;
  if (e.code !== "23505") return null;

  const haystack = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
  if (haystack.includes("cpf")) {
    return NextResponse.json(
      { error: "Este CPF já está cadastrado para outro usuário." },
      { status: 409 }
    );
  }
  if (haystack.includes("email") || haystack.includes("e-mail")) {
    return NextResponse.json(
      { error: "Este e-mail já está cadastrado." },
      { status: 409 }
    );
  }
  // 23505 de origem desconhecida: 409 genérico, ainda sem vazar detalhe.
  return NextResponse.json(
    { error: "Registro duplicado." },
    { status: 409 }
  );
}
