export const homeMetrics = [
  {
    label: "Empresas monitoradas",
    value: "4",
    detail: "Base atual com consolidacao por MCI, CNPJ e codigo Coban.",
  },
  {
    label: "Chaves J cadastradas",
    value: "40",
    detail: "Cadastro inicial pronto para inclusao, inativacao e chave master.",
  },
  {
    label: "Entradas criticas",
    value: "5",
    detail: "Producao diaria, Promotiva, repasse, fechamento mensal e despesas.",
  },
  {
    label: "Auditoria financeira",
    value: "Janeiro/2026+",
    detail: "Carga retroativa de fechamento mensal para visao real e PRT.",
    highlight: true,
  },
] as const;

export const dashboardPriorities = [
  {
    title: "Fundacao do sistema",
    description:
      "Transformar o prototipo atual em uma estrutura profissional, com menus, paginas, fluxos e banco coerente com as regras que voce definiu.",
  },
  {
    title: "Importacoes confiaveis",
    description:
      "Separar leitura de producao diaria, fechamento mensal, tabela Promotiva, tabela de promotores e historico de importacoes com validacao.",
  },
  {
    title: "Financeiro e fluxo de caixa",
    description:
      "Somar producao do grupo, recebido real, diferido, cancelamentos, estornos e despesas por empresa ou grupo.",
  },
] as const;

export const nextSteps = [
  {
    title: "Banco e Supabase",
    description:
      "Criar schema inicial com empresas, promotores, chaves J, producao, fechamento, despesas, auditorias e overrides.",
  },
  {
    title: "Regras de calculo",
    description:
      "Trocar a logica simplificada do prototipo pelas regras reais de credito, seguro, penetracao, PRT e repasse do promotor.",
  },
  {
    title: "Guia sem remendo",
    description:
      "Deixar README, .env.example e passos fechados para subir o projeto localmente e depois na Vercel.",
  },
] as const;

export const sectionContent: Record<
  string,
  {
    title: string;
    description: string;
    highlights: { title: string; description: string }[];
    checklist: string[];
  }
> = {
  producao: {
    title: "Modulo de producao",
    description:
      "Responsavel pela entrada diaria das propostas, consolidacao mensal e acompanhamento por empresa, chave J e promotor final.",
    highlights: [
      {
        title: "Entrada diaria sem duplicidade",
        description:
          "A mesma proposta pode voltar em dias diferentes, com status atualizado. O sistema precisa tratar isso como evolucao do registro e nao como novo cadastro isolado.",
      },
      {
        title: "Base de calculo correta",
        description:
          "Producao e comissao usam Valor Financiado Liquido. Seguro e penetracao usam Valor Financiado ou Valor Bruto.",
      },
      {
        title: "Janela de competencia",
        description:
          "A producao do mes considera do ultimo dia util do mes anterior ate o penultimo dia util do mes corrente.",
      },
    ],
    checklist: [
      "Importar planilha diaria e validar colunas obrigatorias.",
      "Separar status producao, em aberto e cancelado.",
      "Detectar empresa por MCI ou codigo Coban.",
      "Permitir migracao manual de propostas para outro promotor.",
    ],
  },
  fechamento: {
    title: "Modulo de fechamento",
    description:
      "Confronta previsao e recebimento real por CNPJ, incluindo A Vista, PRT, seguro, debitos e creditos financeiros.",
    highlights: [
      {
        title: "Recebimento real por CNPJ",
        description:
          "Cada arquivo mensal pertence a um unico MCI e CNPJ, depois consolidado no grupo RR.",
      },
      {
        title: "PRT auditavel",
        description:
          "O sistema precisa comparar o diferido previsto com o PRT efetivamente recebido e manter o historico mes a mes.",
      },
      {
        title: "Estornos por origem",
        description:
          "Seguro vem da aba Seguro. Liquidacao ou renovacao antecipada vem da aba Debito. Credito fica para ajustes positivos da empresa.",
      },
    ],
    checklist: [
      "Importar fechamento mensal por CNPJ e competencia.",
      "Consolidar A Vista, PRT, Seguro, Credito e Debito.",
      "Permitir carga historica desde janeiro de 2026.",
      "Gerar painel previsto x recebido por empresa e grupo.",
    ],
  },
  promotores: {
    title: "Modulo de promotores",
    description:
      "Reune ranking, detalhamento individual, metas, overrides comerciais e descontos operacionais.",
    highlights: [
      {
        title: "Repasse padrao e excecao manual",
        description:
          "A tabela mensal de remuneracao dos promotores e a base. Mas o sistema precisa aceitar override por proposta, produto, faixa de recebimento e periodo.",
      },
      {
        title: "Sem diferido para promotor",
        description:
          "A visao do promotor considera somente o a vista, com teto proprio de 5,8 por cento.",
      },
      {
        title: "Descontos editaveis",
        description:
          "Estornos entram prioritariamente no mes corrente, mas podem ser parcelados ou movidos para meses seguintes.",
      },
    ],
    checklist: [
      "Cadastrar promotores ativos e inativos.",
      "Controlar chaves J normais e master.",
      "Aplicar meta, meta 1 e meta 2 por promotor.",
      "Gerar relatorio no modelo de detalhamento da Luciana Matias.",
    ],
  },
  cadastros: {
    title: "Modulo de cadastros",
    description:
      "Concentra a base estrutural do sistema: empresas, promotores, chaves, metas e regras principais.",
    highlights: [
      {
        title: "Empresas e grupo",
        description:
          "Cada empresa precisa carregar MCI, CNPJ, codigo Coban e relacionamento com o grupo RR.",
      },
      {
        title: "Chaves master",
        description:
          "Algumas propostas nascem em chaves master e depois precisam ser transferidas para o promotor correto sem perder o historico.",
      },
      {
        title: "Cadastro vivo",
        description:
          "Novos promotores e novas chaves precisam ser criados manualmente. Desligamentos devem virar inativacao, nao exclusao fisica do historico.",
      },
    ],
    checklist: [
      "Separar tabelas de promotores e chaves J.",
      "Registrar vinculacao historica entre promotor e chave.",
      "Permitir classificacao de chave como normal ou master.",
      "Guardar observacoes e datas de admissao ou desligamento.",
    ],
  },
  financeiro: {
    title: "Modulo financeiro",
    description:
      "Faz a visao gerencial do grupo: producao total, recebimento real, despesas, resultado e fluxo de caixa.",
    highlights: [
      {
        title: "Visao por empresa e grupo",
        description:
          "Despesas e recebimentos precisam funcionar tanto por empresa quanto consolidados para o grupo RR.",
      },
      {
        title: "Fluxo de caixa real",
        description:
          "Combinar saldo inicial manual, entradas reais do fechamento e despesas pagas para acompanhar caixa sem remendo.",
      },
      {
        title: "Categorias extensivas",
        description:
          "O sistema pode nascer com categorias predefinidas e aceitar criacao de novas conforme a operacao crescer.",
      },
    ],
    checklist: [
      "Criar cadastro de despesas e categorias.",
      "Lancar despesas por empresa e por grupo.",
      "Controlar saldo inicial e resultado liquido.",
      "Gerar dashboard com entradas, saidas e caixa.",
    ],
  },
  auditoria: {
    title: "Modulo de auditoria",
    description:
      "Centraliza divergencias, historicos e trilhas de alteracao para voce conferir com seguranca qualquer valor do sistema.",
    highlights: [
      {
        title: "Diferido previsto x PRT",
        description:
          "Cada competencia precisa mostrar o que foi previsto de diferido e quanto entrou de fato no fechamento real.",
      },
      {
        title: "Seguro e cancelamentos",
        description:
          "Cancelamento de seguro, estoque PRT e penetracao precisam ficar rastreaveis na analise por empresa, grupo e promotor.",
      },
      {
        title: "Historico de alteracoes",
        description:
          "Como o sistema sera retroativo e o mes nao trava, toda mudanca relevante precisa guardar quem mexeu, quando mexeu e qual foi o motivo.",
      },
    ],
    checklist: [
      "Guardar versoes e historico dos imports.",
      "Registrar overrides e descontos manuais.",
      "Comparar previsto x recebido por competencia.",
      "Exibir divergencias que precisam revisao.",
    ],
  },
  relatorios: {
    title: "Modulo de relatorios",
    description:
      "Responsavel por exportacoes operacionais e executivas em PDF e Excel para conferencia, fechamento e diretoria.",
    highlights: [
      {
        title: "Relatorio de promotor",
        description:
          "Deve seguir, sempre que possivel, o modelo de detalhamento individual que voce enviou como referencia da Luciana Matias.",
      },
      {
        title: "Relatorios executivos",
        description:
          "Diretoria precisa de um consolidado limpo de producao, recebimento, despesas, resultado e fluxo de caixa.",
      },
      {
        title: "Auditoria exportavel",
        description:
          "As divergencias de seguro, PRT e repasse precisam sair em PDF e Excel para conferencia externa e historico interno.",
      },
    ],
    checklist: [
      "Gerar PDF e Excel por modulo.",
      "Preparar relatorio de comissao do promotor.",
      "Criar relatorio financeiro mensal.",
      "Exportar auditoria por competencia.",
    ],
  },
  configuracoes: {
    title: "Modulo de configuracoes",
    description:
      "Organiza usuarios, perfis, competencias, variaveis e a preparacao tecnica para Supabase e Vercel.",
    highlights: [
      {
        title: "Perfis de acesso",
        description:
          "Visao Geral com todos os acessos, Visao Parcial para operacao e perfil futuro para o promotor consultar seus detalhamentos.",
      },
      {
        title: "Variaveis de ambiente",
        description:
          "O sistema depende de chaves do Supabase e de configuracao correta para subir em ambiente local e depois na Vercel.",
      },
      {
        title: "Passo a passo sem remendo",
        description:
          "A configuracao precisa nascer documentada para voce seguir um comando de cada vez, com caminho unico e limpo.",
      },
    ],
    checklist: [
      "Criar .env.local a partir de .env.example.",
      "Subir schema inicial no Supabase.",
      "Configurar projeto na Vercel.",
      "Registrar perfis e preferencias do sistema.",
    ],
  },
};

export const importModules = [
  {
    title: "Producao diaria",
    frequency: "Diaria",
    description:
      "Arquivo principal da producao com status, MCI, Coban, Chave J, produto, prazo, taxa, valores e seguro.",
    route: "/api/import/daily",
  },
  {
    title: "Tabela Promotiva",
    frequency: "Mensal",
    description:
      "Regras oficiais da empresa para credito, seguro, a vista, diferido, cancelamento e estorno.",
    route: "A criar",
  },
  {
    title: "Tabela de promotores",
    frequency: "Mensal",
    description:
      "Regra padrao de repasse, metas, incentivo, overrides e remuneracao por penetracao de seguro.",
    route: "A criar",
  },
  {
    title: "Fechamento mensal por CNPJ",
    frequency: "Mensal",
    description:
      "Recebimento real por empresa com A Vista, PRT, Seguro, Credito e Debito para auditoria e financeiro.",
    route: "A criar",
  },
  {
    title: "Despesas mensais",
    frequency: "Manual",
    description:
      "Lancamentos por empresa ou grupo para resultado mensal e fluxo de caixa.",
    route: "Tela interna",
  },
] as const;
