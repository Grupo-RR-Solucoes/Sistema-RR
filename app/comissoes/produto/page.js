import { redirect } from "next/navigation";

// A tela "regra por produto" foi descontinuada (tabela
// promoter_product_commissions vazia, fluxo nunca usado). Mantemos a ROTA
// como redirect — preserva bookmarks/URLs salvas e leva o usuario para a
// tela ativa de comissao por proposta. O motor (findProductRule /
// PRODUCT_RULE_LEGACY) segue intacto e vira no-op com a tabela vazia.
export default function ComissaoProdutoRedirect() {
  redirect("/comissoes/editar");
}
