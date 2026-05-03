import ModulePage from "../../components/ModulePage";

export default function ProducaoPage() {
  return (
    <ModulePage
      kicker="Operacao comercial"
      title="Producao diaria e mensal"
      description="Este modulo concentra a entrada da planilha diaria, o tratamento de duplicidade, a leitura do status das propostas e a consolidacao da producao por empresa e por promotor."
      status="Base pronta para organizar a operacao diaria"
      highlights={[
        {
          label: "Base de calculo",
          value: "Liquido",
          description:
            "A producao e a comissao usam o valor financiado liquido.",
        },
        {
          label: "Seguro e penetracao",
          value: "Bruto",
          description:
            "Seguro e penetracao usam o valor financiado bruto.",
        },
        {
          label: "Status valido",
          value: "Producao",
          description:
            "Em Aberto aguarda definicao e Cancelado fica fora do calculo.",
        },
        {
          label: "Competencia",
          value: "Flexivel",
          description:
            "O fechamento do mes pode ser recalculado retroativamente.",
        },
      ]}
      sections={[
        {
          title: "Regras centrais da producao",
          description:
            "A camada operacional precisa refletir exatamente o comportamento informado para a planilha diaria.",
          items: [
            "Importacao de um ou mais dias com atualizacao sem duplicidade por proposta.",
            "Identificacao da empresa por MCI e Codigo Coban, com associacao ao CNPJ correto.",
            "Identificacao do promotor por Chave J, incluindo suporte a chave master e reatribuicao manual.",
            "Separacao clara entre producao valida, pendente e cancelada para nao distorcer previsao e comissao.",
          ],
        },
        {
          title: "Visoes que este modulo vai alimentar",
          description:
            "A producao nao para na importacao. Ela abastece os calculos mensais, o ranking e o fechamento.",
          items: [
            "Producao diaria do grupo e das empresas.",
            "Producao individual por promotor com trilha de override manual.",
            "Base de comissao da empresa e do promotor.",
            "Base de penetracao de seguro por periodo e por vendedor.",
          ],
        },
      ]}
      quickLinks={[
        {
          href: "/importacao-diaria",
          title: "Importacao diaria",
          description:
            "Enviar a planilha operacional do dia e acompanhar resultado do processamento.",
        },
      ]}
    />
  );
}
