# Sistema RR

Sistema web para producao, comissoes, auditoria, diferido e financeiro do Grupo RR.

## Stack atual

- Next.js 15
- React 18
- TypeScript
- Supabase
- XLSX
- PDFKit

## O que esta neste repositorio

- `app/`
  rotas, telas e modulos do sistema
- `components/`
  componentes reutilizaveis da interface
- `lib/`
  regras de negocio, calculos e integracao com Supabase
- `docs/`
  regras funcionais consolidadas desta fase
- `supabase/migrations/`
  base inicial do schema do banco

## Como rodar localmente no Windows

### 1. Instalar os programas necessarios

Instale estes 2 programas:

1. Node.js LTS
   Baixe em: `https://nodejs.org`
2. Git
   Baixe em: `https://git-scm.com`

Depois de instalar, feche e abra o terminal novamente.

### 2. Confirmar se instalou corretamente

Abra o PowerShell e rode:

```powershell
node -v
npm -v
git --version
```

Se os 3 comandos retornarem versao, esta tudo certo.

### 3. Entrar na pasta do projeto

```powershell
cd "C:\caminho\para\Sistema-RR"
```

Substitua `C:\caminho\para\Sistema-RR` pela pasta real do projeto.

### 4. Instalar as dependencias

```powershell
npm install
```

### 5. Criar o arquivo de ambiente

Crie um arquivo chamado `.env.local` na raiz do projeto com este conteudo:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Voce vai preencher esses valores com as chaves do projeto Supabase.

### 6. Criar as tabelas no Supabase

No painel SQL do Supabase, execute o arquivo:

`supabase/migrations/20260420_000001_rr_foundation.sql`

Esse script cria a base inicial das tabelas de:

- empresas
- identificadores por MCI e Coban
- promotores
- Chaves J
- producao diaria
- regras mensais
- fechamento
- diferido
- despesas
- auditoria

### 7. Rodar o projeto

```powershell
npm run dev
```

Depois abra:

`http://localhost:3000`

## Variaveis obrigatorias

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Documentos uteis

- Regras desta fase:
  `docs/escopo-operacional.md`
- Roteiro de implantacao:
  `docs/implantacao-windows.md`
- Schema inicial:
  `supabase/migrations/20260420_000001_rr_foundation.sql`

## Conferencia tecnica antes de publicar

Depois de configurar o Supabase e subir na Vercel, abra:

- `Configuracoes`

Nessa tela existe agora um bloco de `Diagnostico tecnico` que mostra:

- se as variaveis do Supabase foram preenchidas
- se o banco esta respondendo
- se as tabelas principais foram criadas corretamente

Isso ajuda a validar a implantacao sem precisar procurar erro no codigo.

## Proximos passos recomendados

Antes de publicar em producao, precisamos garantir:

- variaveis configuradas na Vercel
- banco criado no Supabase com o schema inicial
- validacao dos imports reais
- ligacao dos fechamentos mensais e das despesas
- exportacoes em PDF e Excel
- conferencia do diagnostico tecnico em `Configuracoes`
