# Implantacao no Windows

Este roteiro foi escrito para execucao passo a passo, sem remendos.

## 1. Programas que precisam estar instalados

Instale na maquina:

1. Node.js LTS
2. Git

Depois feche e abra o PowerShell.

## 2. Conferir se ficou certo

Abra o PowerShell e rode:

```powershell
node -v
npm -v
git --version
```

Se aparecer uma versao em cada comando, esta pronto.

## 3. Baixar o projeto

No PowerShell:

```powershell
cd $HOME\Documents
git clone https://github.com/Grupo-RR-Solucoes/Sistema-RR.git
cd .\Sistema-RR
```

## 4. Instalar as dependencias

```powershell
npm install
```

## 5. Criar o banco no Supabase

1. Entrar no Supabase
2. Criar um projeto novo
3. Abrir o menu `SQL Editor`
4. Copiar e executar o arquivo:

`supabase/migrations/20260420_000001_rr_foundation.sql`

Isso cria a base inicial de tabelas.

## 6. Criar o arquivo de ambiente local

Na raiz do projeto, crie o arquivo `.env.local` com:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Preencha com os dados do projeto Supabase.

## 7. Rodar localmente

```powershell
npm run dev
```

Depois abrir no navegador:

`http://localhost:3000`

## 8. Subir para a Vercel

1. Entrar na Vercel
2. Importar o repositorio `Sistema-RR`
3. Em `Environment Variables`, cadastrar:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
4. Fazer o deploy

## 9. Primeiras conferencias depois do deploy

Conferir se:

- o sistema abre
- os menus aparecem
- a conexao com Supabase funciona
- a importacao diaria responde
- o dashboard nao retorna erro de ambiente
- a tela `Configuracoes` mostra o `Diagnostico tecnico` como ambiente configurado
- as tabelas principais aparecem como `ok` no diagnostico

## 10. Ordem recomendada depois que o sistema abrir

1. Cadastrar ou importar empresas
2. Cadastrar ou importar promotores e Chaves J
3. Importar a tabela mensal da empresa
4. Importar a tabela mensal dos promotores
5. Importar a producao diaria
6. Importar os fechamentos mensais retroativos desde 01/2026
7. Conferir dashboard, auditoria e financeiro
8. Em `Relatorios`, usar:
- relatorio geral de promotores para conferencia interna
- relatorio individual de promotor para compartilhar um a um
