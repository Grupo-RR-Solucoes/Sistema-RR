# scripts/archive — one-off ja executados (historico)

Scripts de migracao/backfill/cadastro que **ja cumpriram o papel** e nao devem
mais rodar no caminho principal. Movidos para ca em 2026-07 (blindagem dos
scripts que escrevem em producao): mante-los executaveis em `scripts/` era arma
carregada sem finalidade (escreviam por default, sem `--apply`, sem staging).

Estao aqui por **historico** (o que foi feito e como), NAO para reexecucao.
Os caminhos relativos internos (`require("./_ts_register.cjs")`, `../lib/...`)
apontam para o local ANTIGO (`scripts/`) e nao resolvem daqui — de proposito.
Se algum dia um destes precisar rodar de novo, copie de volta para `scripts/`,
adicione a guarda `--apply` (default dry-run, padrao do repo) e so entao rode.

| Arquivo | O que fez (uma vez) |
|---|---|
| `run_master_redist.cjs` | Redistribuicao master->promotor (04/06): INSERT promoters + reatribuicao de cms_promoter_entries. |
| `run_migrate_novatas_552710.cjs` | Migracao das novatas da chave 552710: INSERT promoters + reatribuicao cms. |
| `run_samuel_cadastro.cjs` | Cadastro do Samuel (JI803091) como INATIVO + atribuicao do cms de janeiro + reprocesso do PMR. |
| `run_import_closing_maio.cjs` | Import do fechamento de maio/2026 (importMonthlyClosingWorkbook). Idempotente por codigo_arquivo. |
| `dia45_prepopulate_share_profiles.py` | Prepopulacao de promoter_share_profile (Dia 4.5). |
