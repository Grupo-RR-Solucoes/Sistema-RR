// ============================================================
// VISIBILIDADE DA COMISSAO DO PROMOTOR — regua UNICA.
//
// REGRA (confirmada por Diego em 23/08/2026): a comissao do PROMOTOR so pode ser
// vista pelo PROPRIO promotor, pelo FINANCEIRO (role `funcionario`) e pelos
// SOCIOS. Ninguem mais — nem o gestor de consorcio, nem os gestores de credito
// (supervisor / gerente_regional), que veem produção e a comissao DELES, nunca a
// do promotor.
//
// POR QUE ISTO E UMA REGUA E NAO UM `if` NA TELA: mascarar no componente e
// teatro — o payload continua inteiro no navegador, a um F12 de distancia. Quem
// nao tem direito nao pode receber o campo. Esta funcao existe para que a rota
// decida ANTES de montar a resposta, e para que o gate tenha um so lugar para
// apontar.
//
// O `promotor` NAO entra na lista: o direito dele e sobre a comissao DELE, e isso
// e ESCOPO (filtrar as linhas pelo promoter_id da sessao), nao visibilidade de
// campo. Um `true` aqui liberaria a comissao dos COLEGAS. Quem escopa e o
// chamador.
//
// Consumidores: app/api/produtos/atribuicao (fila de produtos). O padrao de
// asserção — varrer o payload atras de chave proibida — e o mesmo do
// scripts/gate_projecao_gestor.mts, que ja guarda a /projecao do gestor.
// ============================================================

/** Papeis que podem ver a comissao de QUALQUER promotor. */
export const ROLES_QUE_VEEM_COMISSAO_DE_PROMOTOR = ["socio", "funcionario"] as const;

/**
 * O papel pode ver a comissao de um promotor que NAO e ele proprio?
 * Default DENY: papel desconhecido nao ve.
 */
export function podeVerComissaoDePromotor(role: unknown): boolean {
  return (ROLES_QUE_VEEM_COMISSAO_DE_PROMOTOR as readonly string[]).includes(
    String(role ?? "")
  );
}

/**
 * De QUEM sao as linhas que esta sessao pode ver em /promotores.
 *
 * E a outra metade da regra: a de cima decide CAMPO, esta decide ESCOPO. O
 * promotor recebe SEMPRE o proprio id — o `?promoterId=` dele e descartado, nao
 * respeitado. E por isso que podeVerComissaoDePromotor devolve false para o papel
 * `promotor` sem prejudica-lo: ele nao precisa de permissao de campo para ver a
 * comissao dele, precisa de escopo. Ligar o helper la em cima quebraria ISTO aqui.
 *
 * socio/funcionario escolhem pelo parametro (e a tela deles tem dropdown).
 * Qualquer outro papel: undefined — nao ha carteira a mostrar. (Hoje supervisor e
 * gerente_regional nem chegam: levam 403 em app/api/promotores/route.ts:148-154.)
 *
 * Extraida de route.ts:164-167 para o gate poder exercitar a MESMA expressao que
 * a rota usa, em vez de reimplementar a regra e testar a copia.
 */
export function promotorEfetivoDaSessao(args: {
  role: unknown;
  /** promoter_id gravado no app_user da sessao (so o papel `promotor` tem). */
  promoterIdDaSessao: string | null | undefined;
  /** ?promoterId= vindo da URL. IGNORADO quando o papel e `promotor`. */
  promoterIdPedido: string | null | undefined;
}): string | undefined {
  const role = String(args.role ?? "");
  if (role === "promotor") return args.promoterIdDaSessao ?? undefined;
  if (role === "socio" || role === "funcionario") return args.promoterIdPedido ?? undefined;
  return undefined;
}
