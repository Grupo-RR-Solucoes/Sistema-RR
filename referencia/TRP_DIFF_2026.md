# DIFF resumido das TRPs de Crédito PF — 2026 (jan → mai)

Fonte: PDFs oficiais (pdfplumber, célula a célula). Comparação mês a mês.

| Mês | TRP | OPP | Regime | Perfil Grupo RR | Teto à vista |
|---|---|---|---|---|---|
| jan | 2026/166 | PR2026/004 | 3 perfis (Rubi/Safira/Diamante) | Safira | 5,60 / 5,80 / 6,00 |
| fev | 2026/173 | PR2026/004 | 3 perfis | Safira | 5,60 / 5,80 / 6,00 |
| mar | 2026/180 | PR2026/004 | 3 perfis | Safira | 5,60 / 5,80 / 6,00 |
| abr | 2026/187 | PR2026/023 | 5 faixas (Faixa 1–5) | Faixa 3 | 6,00 (uniforme) |
| mai | 2026/194 | PR2026/023 | 5 faixas | Faixa 3 | 6,00 (uniforme) |

---

## jan → fev
- **Percentuais de comissão: NENHUMA mudança** em nenhuma tabela (1.2–3.4 idênticas, coluna a coluna).
- **Prazos abertos:** limites superiores viraram "A partir de":
  - 1.4 Público: `36 a 120` → `A partir de 36`
  - 1.5 SIAPE: `48 a 96` → `A partir de 48`
  - 1.6 SP/MG: `36 a 120` → `A partir de 36`
  - 1.7 Privado: `36 a 96` → `A partir de 36`
  - 2.2/2.3 Portab.: `48 a 120` / `36 a 96` → `A partir de 48` / `A partir de 36`
  - 3.2 Não Consignado: `13 a 96` → `A partir de 13`
  - 3.3 Adiant. 13º: `5 a 12` → `A partir de 5`

## fev → mar
- **Tabelas de crédito: NENHUMA mudança** (percentuais e prazos idênticos a fev).
- **Novidade:** entra em vigor o **seguro prestamista TRP 2026/188** (valor bruto × faixa de prazo): SLIP 0,15/0,25/0,40/0,55; ESTOQUE 0,15 fixo. (Antes de mar o seguro seguia regime anterior.)

## mar → abr  ⬅️ ÚNICA mudança estrutural relevante do período
- **Regime mudou: 3 perfis → 5 Faixas.**
  - Mapeamento preservado: **Rubi → Faixa 1**, **Safira → Faixa 3**, **Diamante → Faixa 4** (mesmos valores).
  - **Colunas NOVAS: Faixa 2 e Faixa 5** (interpoladas/extrapoladas). Ex. 3.2 linha 4,30–4,75%: surge Faixa 2 = **4,34%** e Faixa 5 = **4,73%**.
- **Tetos à vista:** antes diferenciados (Rubi 5,60 / Safira 5,80 / Diamante 6,00) → agora **uniforme 6,00%** em todas as faixas.
- **Limiares de produção:** antes 3 (Safira ≥ 3M, Diamante ≥ 7M) → agora 5 (Faixa 2 ≥ 1M, 3 ≥ 3M, 4 ≥ 7M, 5 ≥ 20M).
- **Valores das colunas que já existiam (Faixa 1/3/4): NÃO mudaram.** Nenhum percentual de Rubi/Safira/Diamante foi alterado; abr só acrescentou as 2 colunas novas.

## abr → mai
- **NENHUMA mudança** em nenhuma tabela de crédito (idêntico célula a célula, 5 Faixas). Muda só o número da TRP (187 → 194); mesma OPP PR2026/023 e mesmo seguro TRP 2026/188.

---

## Resumo para o Grupo RR (Safira ≡ Faixa 3)
**Os percentuais que o Grupo RR usa NÃO mudaram em nenhum mês de jan a mai/2026.** Safira (jan–mar) e Faixa 3 (abr–mai) carregam exatamente os mesmos valores (ex.: 3.2 / 4,30–4,75% = **4,48%** o tempo todo). A única alteração que afeta a operação é a abertura dos limites de prazo (jan→fev) e a mudança de teto à vista (Safira 5,80% → Faixa 3 dentro do teto uniforme 6,00% em abr).

---

## ⚠️ Nota crítica — referência antiga estava errada
O arquivo `TRP35_REFERENCIA_2026-187.md` (raiz do projeto), usado nas investigações anteriores, transcreveu as **Faixas 1/2/3 com −0,01 a −0,03** vs o PDF oficial (ex.: dizia 3.2/4,30–4,75/F3 = **4,45%**; o PDF diz **4,48%**). As Faixas 4/5 estavam corretas.

Consequência: a conclusão anterior de que "JSON/Excel têm offset +0,03 vs oficial" estava **invertida** — o PDF oficial concorda com o JSON/Excel (4,48%). O valor que o sistema usa (4,48%) está **correto**. Os arquivos `referencia/TRP_REFERENCIA_2026-*.md` aqui são os valores reais do PDF e devem substituir a referência antiga.

(Permanece válido: o erro do Excel importado no SP/MG — coluna "3ª FAIXA" com valores da Faixa 4 em 3 linhas — e o bug ×10 do parser, ambos já tratados em fix-7.)
