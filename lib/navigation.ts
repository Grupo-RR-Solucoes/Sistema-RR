export type NavigationItem = {
  href: string;
  label: string;
  description: string;
};

export const navigationItems: NavigationItem[] = [
  {
    href: "/",
    label: "Dashboard",
    description: "Visao executiva do grupo, indicadores e prioridades do sistema.",
  },
  {
    href: "/producao",
    label: "Producao",
    description: "Leitura diaria, consolidacao mensal e acompanhamento por empresa e promotor.",
  },
  {
    href: "/fechamento",
    label: "Fechamento",
    description: "Recebimento real, PRT, seguro, estornos e conciliacao por CNPJ.",
  },
  {
    href: "/promotores",
    label: "Promotores",
    description: "Metas, repasses, overrides, descontos e relatorios individuais.",
  },
  {
    href: "/cadastros",
    label: "Cadastros",
    description: "Empresas, promotores, chaves J, chaves master e regras-base.",
  },
  {
    href: "/financeiro",
    label: "Financeiro",
    description: "Despesas, fluxo de caixa, consolidado do grupo e resultado por empresa.",
  },
  {
    href: "/auditoria",
    label: "Auditoria",
    description: "Previsto x recebido, historico de alteracoes, diferido e seguro.",
  },
  {
    href: "/relatorios",
    label: "Relatorios",
    description: "Exportacoes PDF e Excel para diretoria, comissao e conferencia.",
  },
  {
    href: "/importacoes",
    label: "Importacoes",
    description: "Entradas diarias e mensais com historico e validacao dos arquivos.",
  },
  {
    href: "/configuracoes",
    label: "Configuracoes",
    description: "Perfis de acesso, competencias, variaveis e checklist tecnico.",
  },
];
