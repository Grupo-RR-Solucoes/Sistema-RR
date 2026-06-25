// Modelo genérico de Minuta (documento de carta). Sem regra de negócio: o
// preenchedor específico (ex. minutaAvista.ts) monta este modelo e o docxBuilder
// genérico o renderiza em .docx. Mantém a base reutilizável para outras minutas.

/** Um parágrafo é uma sequência de trechos (runs) — permite negrito inline. */
export type Trecho = {
  texto: string;
  negrito?: boolean;
  italico?: boolean;
};

/** Parágrafo: string simples (texto puro) ou lista de trechos formatados. */
export type Paragrafo = string | Trecho[];

/** Seção de texto: heading opcional + parágrafos. */
export type SecaoTexto = {
  tipo: "texto";
  heading?: string;
  paragrafos: Paragrafo[];
};

/** Seção de bullets: heading opcional + itens. */
export type SecaoBullets = {
  tipo: "bullets";
  heading?: string;
  itens: Paragrafo[];
};

/** Alinhamento de coluna de tabela. */
export type AlinhamentoColuna = "esquerda" | "direita" | "centro";

export type ColunaTabela = {
  titulo: string;
  alinhamento?: AlinhamentoColuna;
  /** Largura relativa (peso). Opcional — default distribui igual. */
  peso?: number;
};

/** Seção de tabela: heading opcional + colunas + linhas (matriz de células string). */
export type SecaoTabela = {
  tipo: "tabela";
  heading?: string;
  colunas: ColunaTabela[];
  linhas: string[][];
  /** Nota abaixo da tabela (ex. "demais N contratos no anexo"). */
  rodape?: string;
};

export type Secao = SecaoTexto | SecaoBullets | SecaoTabela;

/** Modelo completo de uma minuta. */
export type Minuta = {
  titulo: string;
  /** Bloco de cabeçalho (destinatário, data, Ref.) — parágrafos soltos. */
  cabecalho: Paragrafo[];
  secoes: Secao[];
  /** Bloco de assinatura (nome, cargo, organização). */
  assinatura: Paragrafo[];
  /** Nome-base do arquivo (sem extensão). */
  nomeArquivo: string;
};
