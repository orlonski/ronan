# Fixture: Gamerim Transportes — Boletim de Medição

Material real recebido da empresa-cliente **GAMERIM TRANSPORTES** (CNPJ 19.215.279/0001-30) referente ao boletim de medição de obras EV (Estaduais Vias).

Arquivos:
- `recebido-medicao.xlsx` — versão **planilha** com 8 abas separando viagens, pedágios, descontos por medição
- `recebido-boletim.pdf` — versão **PDF** consolidada (mesma medição apresentada como boletim único de 10 páginas)
- `recebido-boletim.txt` — texto extraído do PDF (gerado via `pdftotext -layout`) pra inspeção rápida e treino do prompt da IA

Este material é usado como referência pra calibrar:
- Parser Excel (ExcelJS) — múltiplas abas, cabeçalho não-canônico
- Parser PDF (pdf-parse / pdfjs) — quando a empresa enviar versão consolidada
- Inferência de layout via Claude Haiku
- Algoritmo de match placa+data+ticket
- Tela de Conferência (viagens + pedágios + descontos)

## Estrutura observada (`recebido-medicao.xlsx`)

8 abas organizadas em pares por medição:

| Aba | Conteúdo | Match com nosso sistema |
|---|---|---|
| `1ª/2ª MEDIÇÃO EV - GAMERIM` | Sumário do boletim (contratada, CNPJ, período, totais) | Não — é meta-info |
| `REL. CAMIN. 1ª/2ª MED EV - GAMERIM` | **Relação de viagens (caminhões)** | **SIM — fonte primária do match** |
| `RELAÇÃO PEDÁGIO 1ª/2ª EV - GAMERIM` | Pedágios pagos | Cruza com nossa tabela de Pedágios |
| `DESCONTO 1ª/2ª MEDIÇÃO EV - GAMERIM` | Descontos / penalidades | Não — observacional |

### Aba REL. CAMIN. — estrutura

- Cabeçalho na **linha 5** (com merged cells em algumas colunas)
- Dados começam **linha 10**
- Linhas 8 e 9 contém títulos de seção (ex: "RESUMO EV - ATA 097/2025", "Equipe EDINALDO") que **não são dados** — parser deve ignorar
- Algumas viagens podem ter linhas de subtotal entre blocos

Colunas relevantes:
| Letra | Cabeçalho | Mapeia para |
|---|---|---|
| C | DATA | `Viagem.data` (datetime) |
| D | Nº TICKET | `Viagem.ticket` (string, formato `TKB-XXXXXX`) |
| E | OBRA | identificar `Obra` (descrição precisa de alias/normalização) |
| F | PLACA | `Viagem.veiculo.placa` (sem hífen, ex: `APL6A61`) |
| G | FORNECEDOR | quem origina material — não casa direto, info auxiliar |
| H | MATERIAL | identificar `Material` (alias/normalização) |
| I | UN. | unidade ("KM*TON" típico) |
| J | QUANT. | `Viagem.toneladas` (decimal) |
| K | DISTÂNCIA KM | `Viagem.km` (decimal) |
| L | R$ UNIT | preço unitário acordado em contrato |
| M-N | R$ TOTAL / TOTAL | valor da viagem |

### Aba RELAÇÃO PEDÁGIO — estrutura

- Cabeçalho na **linha 5**
- Dados começam **linha 9**
- Colunas: DATA, OBRA, PLACA, PRAÇA DE PEDÁGIO, TRAÇÃO, IDA EIXOS, VOLTA EIXOS, EIXO, VALOR POR EIXO, TOTAL

Mapeia pra `Pedagio`:
- DATA → `data`
- PLACA → cruza com `Veiculo`
- PRAÇA DE PEDÁGIO → `pracaPedagio`
- TOTAL → `valor`

### Insights sobre normalização

Ao processar, vamos enfrentar:

1. **Nome da OBRA na planilha** ≠ nome da `Obra` no banco. Ex: planilha diz `EV - ATA 097/2025`, banco pode ter "Obra Estadual Vias 097/25". Solução: alias por empresa-cliente, IA propõe mapping na 1ª vez, operadora confirma, sistema cacheia.

2. **MATERIAL na planilha** descreve com mais detalhe que o cadastro simples. Ex: `C.B.U.Q. FAIXA "F"` vs `C.B.U.Q. FAIXA "C"` quando nosso banco tem só `CBUQ`. Decisão: IA categoriza ao tipo cadastrado mais próximo; operadora pode criar variantes específicas no cadastro de Material se necessário.

3. **PLACA**: formato Mercosul sem hífen (`APL6A61`). Padronizar UPPER + sem espaços/hífens em ambas as pontas pra match.

4. **DATA**: vem como datetime do Excel; preservar timezone neutro (date-only).

5. **TICKET**: usado como chave dura no match. Formato variável por empresa.

## Estrutura observada (`recebido-boletim.pdf` — 10 páginas)

Mesma medição que o XLSX, organizado em 3 blocos:

1. **Página 1** — capa "BOLETIM DE MEDIÇÃO" com sumário (totais, descontos, créditos, valor líquido a pagar). Aqui aparece também o item "FRESADO HORA FRESA" como linha extra (cobrança por hora-máquina, não por viagem) — algo a considerar no modelo de dados se for recorrente.
2. **Páginas 2 e seguintes** — "RELAÇÃO PEDÁGIOS" como tabela paginada
3. **Páginas finais** — "RELAÇÃO DE CAMINHÕES" com cabeçalho `DATA | Nº TICKET | OBRA | PLACA | FORNECEDOR | MATERIAL | UN. | QUANT. | DISTÂNCIA KM | R$ UNIT | R$ TOTAL | TOTAL`, agrupado por seções (`RESUMO EV - C 011/2026 → Equipe EDINALDO`)
4. Item "CAMINHÃO NA FRESA (DIARIA R$ 1.250,00)" aparece como linha de cobrança extra — sinaliza categoria de cobrança "diária de hora-máquina" diferente de viagem. Talvez precise virar entidade própria ou ficar como `Cobranca` genérica.

PDF é mais difícil de parsear que XLSX (não tem células estruturadas), mas IA + bibliotecas como `pdf-parse` ou `pdfplumber` resolvem; layout é razoavelmente regular.

## Pontos cegos a investigar

- Empresa fornece amostra do **layout que ela espera receber** (caso ela seja "destino" também)? **Resolvido**: Ronan disse que ele não tem layout padrão pra mandar — vai ser um construtor dinâmico no dashboard, operadora define o layout pra cada empresa-destino.
- Há outras empresas-cliente além da Gamerim? **Por enquanto só Gamerim manda planilha**. Mas o sistema já é desenhado pra suportar N empresas com layouts diferentes (cache por empresa).
- Ticket de pedágio (na aba RELAÇÃO PEDÁGIO) tem ID próprio? Nesse arquivo parece que não — só data+placa+praça é a chave. Match feito por essa tripla.
- Categoria "CAMINHÃO NA FRESA (DIÁRIA)" e "FRESADO HORA FRESA" — não é viagem comum, é hora-máquina. Ver se é caso da Gamerim apenas ou se vai aparecer em outras empresas → talvez virar campo opcional na Viagem ou entidade separada `LancamentoExtra`.
