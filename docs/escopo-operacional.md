# Escopo operacional do Sistema RR

Este documento resume as regras de negocio confirmadas para a primeira fase do sistema.

## 1. Fontes de dados

### Producao diaria

- Frequencia: diaria
- Arquivo-base: planilha operacional com MCI, Coban, Chave J, produto, prazo, taxa, valor, seguro e status
- Funcao: alimentar producao do grupo, das empresas e dos promotores

### Tabela mensal da empresa

- Frequencia: mensal
- Fonte: tabela Promotiva
- Escopo atual: Credito PF e Seguro
- Funcao: calcular previsao da empresa em a vista e diferido

### Tabela mensal dos promotores

- Frequencia: mensal
- Funcao: definir repasse padrao dos vendedores
- Observacao: precisa aceitar override manual por proposta, produto, promotor, periodo e percentual recebido

### Fechamento mensal real

- Frequencia: mensal
- Um arquivo por CNPJ
- Escopo atual: A Vista, PRT, Seguro, Credito e Debito
- Funcao: comparar previsto x recebido e alimentar o dashboard financeiro real

## 2. Regras centrais da producao

- Somente status `Producao` entra no calculo de producao e comissao
- Status `Em Aberto` nao entra no calculo do momento
- Status `Cancelado` nao entra no calculo
- A planilha diaria pode chegar com atraso, entao o sistema deve aceitar um ou mais dias na mesma carga
- O sistema deve atualizar a mesma proposta sem duplicidade
- MCI e Codigo Coban definem a empresa
- Chave J define o promotor original
- Deve existir suporte a Chave J master
- O sistema deve permitir migracao manual de proposta para outro promotor

## 3. Bases corretas de calculo

### Producao e comissao

- Usam `Valor Financiado Liquido`
- Essa regra vale para empresa e promotor

### Seguro e penetracao

- Usam `Valor Financiado` ou `Valor Bruto`
- Isso vale especialmente para renovacao, onde o valor bruto pode ser muito maior que o liquido

### Penetracao de seguro

- Formula: soma do valor bruto das propostas com seguro / soma do valor bruto total do periodo
- O indicador muda a remuneracao do seguro do promotor

## 4. Regras da empresa

- Comissao da empresa precisa ser separada em:
- a vista
- diferido do mes
- total
- O dashboard deve mostrar tambem a carteira futura do diferido
- O percentual de a vista da empresa deve seguir a `OPP/TRP` vigente de cada competencia
- Se a proposta/diaria trouxer o `% a vista`, esse valor prevalece
- Se faltar a tabela do mes, deve ser usada a tabela anterior mais proxima disponivel
- O teto de `6%` so existe nos periodos em que a `OPP/TRP` vigente realmente permitir esse limite
- O diferido existe somente para a empresa
- O sistema deve auditar mes a mes o diferido previsto x recebido

## 5. Regras do promotor

- O promotor nao recebe diferido
- O teto do promotor e `5,8%`
- O repasse padrao vem da tabela mensal de remuneracao
- A ordem de prioridade recomendada e:
- override manual por proposta
- regra manual por produto/promotor/faixa/periodo
- incentivo por meta
- tabela mensal padrao

### Metas

- Cada promotor pode ter:
- Meta
- Meta 1
- Meta 2
- As metas sao configuradas manualmente

### Seguro do promotor

- O promotor recebe percentual sobre a comissao do seguro da empresa
- A faixa depende da penetracao de seguro das operacoes dele

## 6. Estornos e descontos

- Cancelamento de seguro vem na aba `Seguro`
- Estorno de credito por liquidacao antecipada ou renovacao antecipada vem na aba `Debito`
- A aba `Credito` guarda creditos a favor da empresa, como bonus ou ajuste positivo
- O desconto do promotor segue `70%` do estorno da empresa
- O desconto entra prioritariamente no mes atual, mas deve ser editavel
- O sistema deve permitir parcelamento ou lancamento em meses seguintes
- Deve existir o mesmo campo para descontos extras, como antecipacoes
- Se o promotor estiver desligado, o estorno fica para a empresa

## 7. Financeiro e fluxo de caixa

- O dashboard financeiro deve consolidar todas as empresas do grupo
- Deve existir lancamento manual de despesas
- Despesas precisam aceitar:
- empresa
- grupo
- categoria
- descricao
- valor
- vencimento
- pagamento
- status
- Deve existir saldo inicial manual
- O sistema pode trazer categorias padrao, mas deve permitir novas categorias

## 8. Cadastros obrigatorios

- Empresas
- Identificadores por MCI e Coban
- Promotores
- Chaves J
- Chaves master
- Metas mensais
- Regras mensais da empresa
- Regras mensais de promotores
- Categorias de despesas

## 9. Perfis de acesso

- `Visao Geral`: acesso total para diretoria
- `Visao Parcial`: despesas, importacao diaria e descontos dos promotores
- Futuro: acesso individual do promotor aos seus detalhamentos

## 10. Regras de governanca

- O mes nao fica travado
- Alteracoes retroativas sao permitidas
- Toda alteracao relevante deve deixar trilha de auditoria
- O historico nao pode ser apagado ao desligar promotor ou inativar cadastro

## 11. Exportacoes

- O sistema deve exportar em PDF e Excel
- Escopo inicial:
- relatorio financeiro mensal
- relatorio de auditoria
- conferencia de fechamento
- relatorio de comissao dos promotores

## 12. Menus-alvo da aplicacao

- Dashboard
- Producao
- Fechamento
- Promotores
- Cadastros
- Financeiro
- Auditoria
- Importacoes
- Relatorios
- Configuracoes
