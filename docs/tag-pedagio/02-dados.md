# 02 — Dados: ler o extrato, modelar as passagens e conciliar (06/10/2026)

Tudo aqui foi **rodado contra o PDF real** (fatura mensal Sem Parar, 7 páginas, 31/08 a 30/09).
As placas estão mascaradas (PLACA-A/B/C), os embarcadores viraram EMB-1/EMB-2 e os números de
viagem do vale aparecem só pelo final (VP…526). Os scripts de prova ficaram FORA do repositório,
no scratchpad da sessão (`tag-dados/`: `pdfparse.mjs`, `parser.mjs`, `conciliacao.mjs`,
`idempotencia.mjs`, saída em `saida-conciliacao.txt`). Nada foi alterado no código.

## Resumo em números

| | PLACA-A | PLACA-B | PLACA-C | Total |
|---|---|---|---|---|
| Linhas de passagem (tag) | 45 | 58 | 16 | **119** |
| Soma das linhas = "Total de Pedágio" | 1.881,90 = 1.881,90 | 2.213,40 = 2.213,40 | 653,48 = 653,48 | **4.748,78, bate nas 3** |
| Linhas de vale (C/D) | 14 (7/7) | 10 (5/5) | 0 | 24 = **12 pares, todos fechados** |
| "Uso" no Resumo por Veículo | 1.881,90 / 59 usos | **2.148,60 / 69 usos** | 653,48 / 16 usos | 4.683,98 / 144 |
| Diferença detalhe x resumo | 0 | **R$ 64,80 e 1 uso a mais** | 0 | 64,80 |

- Conferência da nota: uso 4.683,98 + planos 184,95 + outras 11,70 = **4.880,63**, que bate com o total da nota.
- Recargas: 4 × 1.500,00 = 6.000,00 (C).
- 143 linhas lidas, **0 linhas com data que o parser não entendeu**.
- Tarifa por eixo constante em cada praça (13 praças). Isso prova que **categoria 61 = 7 eixos**.
- Achados (o que é dinheiro):

| Tipo | Qtd | R$ em jogo | Força |
|---|---|---|---|
| Sentido oposto em 2 min (mesma praça) | 1 | 46,90 | forte |
| Vale incompleto: praça da viagem do vale paga pela tag | 2 | 88,90 | forte |
| Categoria isolada (4→5→4 no mesmo trecho) | 1 | 6,00 | forte |
| Categoria variou (vizinho único, sem parada) | 2 | 15,03 | fraco |
| Ajuste não detalhado (resumo ≠ detalhe) | 1 | 64,80 (a favor do cliente, sem explicação) | conferir |
| **Subtotal provável** | | **156,83** (3,3% do pedágio do mês) | |
| Carregado (7 eixos) pago 100% pela tag, sem vale | 29 trechos | **2.685,60, é teto e não achado** | só com a viagem/cliente |
| Oportunidade: PLACA-A roda vazia com 4 eixos (a B, com 3) | 25 passagens | 202,10/mês | conversa com motorista |
| Duplicidade (mesma praça e sentido em 30 min), passagem impossível (>100 km/h), sentido incoerente, vale sem par | 0 | — | regras rodaram e não acharam nada |

A maior velocidade medida entre praças consecutivas foi 72 km/h (66,55 km em 55 min), o que é coerente.

---

## 1. Leitura do PDF

### Qual ferramenta
**`pdf-parse` ^2.4.5, que já está no `apps/api`** e já é usado em `fechamentos/parsers/pdf-parser.ts`
(`new PDFParse({ data }) → getText()`). Não precisa de dependência nova, nem do binário `pdftotext` no container.

Testei as duas saídas contra o arquivo:
- `pdftotext -layout` é ótimo pra **ler com o olho**, mas no vale-pedágio a 2ª linha do embarcador e da cidade
  ("LOGISTICA E T", "ANTÔNIO LEVERGER") cai **depois** do valor. O parser fecha a linha cedo e quebra (`TypeError` na prova).
- `pdf-parse` (ordem de leitura) devolve uma linha por registro e a continuação logo abaixo, antes do valor. O parser
  junta as linhas até achar o fim `CAT VIAGEM VALOR D|C`. Rodando duas vezes, a extração saiu idêntica byte a byte.

### Como o parser anda (máquina de estados por linha, com espaços colapsados)
- **Quebra de página**: descarta o rodapé (`-- n of 7 --`, `n/7`, o código do cliente sozinho na linha). O título
  "Detalhamento das Passagens por Pedágios" repetido no topo da página nova **não troca a placa**: o bloco continua
  até aparecer outra linha `PLACA - PLANO`. Isso vale pras quebras das páginas 2→3 (PLACA-A), 4→5 (PLACA-B) e 5→6 (PLACA-C).
- **Bloco por placa**: `^[A-Z]{3}\d[A-Z0-9]\d{2} - (.+)$`, que aceita placa Mercosul e antiga. A linha da tabela
  "Plano Contratado" também começa com placa e é excluída.
- **Passagem**: `data hora CONCESSIONÁRIA RODOVIA, KMx+yyy, SENTIDO, CIDADE CAT VALOR D|C`. A praça é decomposta
  em rodovia (`BR364`), km em metros (`579100`), sentido (NORTE/SUL/LESTE/OESTE) e cidade.
- **Vale**: junta as linhas até o fim `CAT NºVIAGEM VALOR D|C`. A linha **C não traz concessionária** e a **D traz**.
  O embarcador vem truncado pela operadora ("… LOGISTICA E T"): é texto pra de-para, não chave.
- **Totais lidos e conferidos**: "Total de Pedágio" e "Total de Vale Pedágio" por placa, "Total de outras
  arrecadações" (GESTOR DE DÉBITOS 3,90), Resumo por Veículo (plano, uso, qtd, total), "Passagens 144 4.683,98" e o
  total da nota.
- **Falha alta, nunca silenciosa**: uma linha com cara de passagem (começa com data) dentro de uma seção e que não casa
  com o padrão vai pra `naoLidas`. Com `naoLidas > 0`, ou com a soma ≠ "Total de Pedágio", o extrato fica
  `LIDO_COM_DIVERGENCIA` e a tela mostra a linha crua. Nada some calado.

### A diferença de R$ 64,80 (PLACA-B)
O detalhe tem 58 passagens que somam 2.213,40 e 10 linhas de vale com líquido 0. O resumo diz **69 usos, 2.148,60**.
Os números fecham com **exatamente uma operação a mais, de −64,80**, que o PDF não lista. A nota fiscal cobra o
valor do resumo, então o cliente pagou 64,80 a **menos** do que o detalhe mostra.

**Não é vale-pedágio.** Os vales da PLACA-B (VP…896, 5 praças, 240,10) estão pareados C=D e o "Total de Vale" é 0,00.
Na PLACA-A a conta fecha exata (45 + 14 linhas de vale = 59 usos), o que mostra que o resumo conta as linhas de
vale como uso.

O PDF não diz o que é o ajuste. Três leituras batem centavo a centavo, e todas são em JANGADA (R$ 8,10/eixo):
- 8 × 8,10;
- 2 × (56,70 − 24,30), ou seja, duas passagens recategorizadas de 7 pra 3 eixos;
- 56,70 + 8,10, sendo 56,70 o valor da passagem de **28/08**, que está **fora do período** (31/08–30/09) e pode ser
  uma cobrança tardia estornada.

Decisão: o sistema concilia pelo **detalhe** (é ele que tem praça e hora), grava a diferença por placa como
`AJUSTE_NAO_DETALHADO`, e a tela pede o extrato detalhado (CSV do portal Sem Parar Empresas) pra explicar. Até lá,
nenhuma passagem é dada como "estornada".

---

## 2. Modelo (Prisma, rascunho)

Segue o padrão do cartão combustível (`ExtratoCartao`/`TransacaoCartao`), com três diferenças: a operação
**repetida entre faturas** vira achado em vez de ser descartada; o vale é passagem também; e os achados têm decisão
própria.

```prisma
model ExtratoTag {
  contaId String; id String @id
  operadora      String   // "SEM_PARAR" (X7/ConectCar/Veloe depois)
  formato        String   // "PDF_FATURA" | "CSV_DETALHADO"
  nomeArquivo    String;  arquivoKey String      // original no MinIO (servido pela API)
  hashArquivo    String                          // sha256 dos bytes
  numeroFatura   String?; codigoCliente String?  // a "conta" na operadora
  periodoDe DateTime @db.Date; periodoAte DateTime @db.Date; emitidoEm DateTime? @db.Date
  fusoInterpretado String @default("America/Sao_Paulo")   // como a hora do texto vira instante (ver §1 fuso)
  status         String   // LIDO | LIDO_COM_DIVERGENCIA | FALHOU
  conferencia    Json     // por placa: soma linhas x Total de Pedágio x Resumo (uso, qtd), NF, recargas
  importadoPorId String?; importadoEm DateTime @default(now())
  @@unique([contaId, hashArquivo])
  @@unique([contaId, operadora, numeroFatura])    // o PDF re-baixado muda de hash (Prawn carimba data)
}
model ExtratoTagVeiculo {   // resumo por veículo + plano + outras: é CUSTO FIXO do caminhão (lucro por caminhão)
  contaId; id; extratoId; placaTexto; veiculoId String?
  plano Decimal; uso Decimal; qtdUsos Int; outras Decimal; somaDetalhe Decimal; qtdDetalhe Int; ajuste Decimal
}
model PassagemTag {
  contaId String; id String @id; extratoId String
  chave        String           // sha256(operadora|placa|tipo|data|hora|rodovia|km|sentido|cat|valor|dc|nºviagem) + "#ordinal"
  tipo         String           // PEDAGIO | VALE
  dc           String           // D | C
  placaTexto   String; veiculoId String?
  ocorridoEm   DateTime         // instante (UTC) interpretado; dataHoraTexto guarda o que veio
  dataHoraTexto String
  concessionaria String?; pracaTexto String
  rodovia String; kmMetros Int; sentido String; cidade String; uf String?
  categoria    Int              // código da operadora (61)
  eixosCobrados Int             // 61 → 7
  valor        Decimal @db.Decimal(10,2)
  embarcadorTexto String?; valePedagioId String?; parId String?   // C ↔ D do vale
  pedagioRodoviaId String?      // null = praça não casada (ver §4)
  viagemId String?; casamento String?   // GPS | JANELA | DIA_ROTA | MANUAL
  linhaOriginal String; linhaPdf Int
  @@unique([contaId, chave])
  @@index([veiculoId, ocorridoEm]) @@index([viagemId]) @@index([contaId, ocorridoEm])
}
model ValePedagio {          // a viagem do embarcador (nº do vale)
  contaId; id; operadora String; numeroViagem String; embarcadorTexto String
  clienteId String?          // de-para embarcador → Cliente, confirmado por gente
  totalCredito Decimal; totalDebito Decimal; viagemId String?
  @@unique([contaId, operadora, numeroViagem])
}
model AchadoTag {
  contaId; id; tipo String; chaveAchado String   // hash das chaves das passagens envolvidas
  veiculoId String?; viagemId String?; valorEmJogo Decimal; evidencia Json
  status String @default("ABERTO")   // ABERTO | CONTESTADO | RESOLVIDO | DESCARTADO (motivo obrigatório)
  motivo String?; decididoPorId String?; decididoEm DateTime?; regraVersao Int
  @@unique([contaId, tipo, chaveAchado])
}
```

**Idempotência, provada** (`idempotencia.mjs`): 143 linhas, 143 chaves, e reimportar o mesmo arquivo dá as mesmas chaves.
- Mesmo arquivo de novo: `hashArquivo` responde "já importado em …" e não grava nada. Mesma fatura re-baixada (hash
  diferente, mesmo `numeroFatura`) cai no mesmo lugar.
- **Ordinal na chave**: se a operadora cobrar a MESMA passagem duas vezes no arquivo, linhas idênticas, cada uma ganha
  `#1`/`#2` e as duas entram. A prova simulou isso: 144 linhas, 144 chaves. A regra de duplicidade enxerga a cópia.
  Sem o ordinal, o dedup engoliria exatamente a cobrança em dobro que o cliente quer achar.
- **Entre faturas mensais** (períodos que não se sobrepõem), uma chave que já existe vinda de OUTRO extrato
  **não é descartada em silêncio**, como faz o cartão. Vira achado `COBRADA_EM_OUTRA_FATURA`. O caso real é a passagem
  de 28/08 da PLACA-B dentro da fatura que começa em 31/08. Já entre o CSV e o PDF do mesmo período, o dedup é o
  esperado: o CSV enriquece, não duplica.
- `AchadoTag` com `@@unique(tipo, chaveAchado)`: reprocessar não recria achado nem apaga a decisão já tomada.

**Multi-tenant**: toda tabela leva `contaId` (trava automática). Toda leitura em SQL cru filtra `contaId`.
`PedagioRodovia` e o de-para de praças (§4) são **globais**, porque praça é dado público. Por isso exigem alvo no `where`.

**Placa → veículo**: normalizar (maiúscula, sem hífen) e casar também pela **forma antiga**, porque o cadastro pode
ter a placa pré-Mercosul (o 5º caractere A–J vira 0–9). Na prova: PLACA-A, PLACA-B e PLACA-C convertem certo.
Placa sem veículo fica `veiculoId null` numa lista "placas do extrato sem cadastro". O sistema não cria veículo sozinho.

**Fuso**: o PDF dá só hora local, sem fuso. MT é UTC−4 e TO é UTC−3. Grava o texto cru, interpreta com
`fusoInterpretado` (reprocessável) e todo casamento com viagem usa folga de ±90 min. A calibração é decidida pela
primeira viagem com rastro GPS (`ViagemPonto`, UTC sem ambiguidade): basta comparar o instante em que o GPS cruza a
praça com a hora do extrato. As regras passagem-a-passagem não dependem disso dentro do MT.

---

## 3. Regras de conciliação (funções puras, `conciliacao.mjs`)

A entrada é a **linha do tempo física** do veículo: passagens da tag (D) mais os **débitos do vale**. O caminhão passou
nas duas, e sem o vale a sequência fica com buraco: em 29/09 a PLACA-A some entre 09:40 e 16:39 sem os débitos do vale.
A saída é `{ tipo, valorEmJogo, evidencia: passagens[] }`.

| Regra | Como | Casos no arquivo real |
|---|---|---|
| `DUPLICIDADE` | mesma praça (rodovia+km) e sentido em ≤ 30 min, tag×tag e tag×vale | 0 |
| `SENTIDO_OPOSTO_CURTO` | mesma praça, sentidos opostos em ≤ 15 min. Em jogo: a 1ª, contrária ao rumo que seguiu | **PLACA-A 29/09 NOBRES N 09:38:16 / S 09:40:00, 7 eixos, R$ 46,90**. 1m44s não dá pra carregar. Em seguida ela segue pro SUL com vale, então a passagem NORTE é a suspeita |
| `PASSAGEM_IMPOSSIVEL` | km/h entre praças consecutivas > 100. Na prova, só na mesma BR (km linear). No produto, OSRM entre os GPS das `PedagioRodovia` casadas | 0. Máximos: A 72, B 68, C 65 km/h. **MT246 não tem km linear** (107→035→332→119 num mesmo trecho): sem GPS, "não sei" |
| `SENTIDO_INCOERENTE` | sentido declarado × km andando (BR364: NORTE = km sobe; BR153 ao contrário) | 0 |
| `CATEGORIA_ISOLADA` | sobe e volta (4,5,4) no mesmo sentido, vizinhos ≤ 6h. Em jogo: eixos a mais × tarifa/eixo | **PLACA-A 14/09 SANTO ANTÔNIO LEVERGER cat5 entre CAMPO VERDE cat4 e JANGADA cat4: R$ 6,00** |
| `CATEGORIA_VARIOU` | difere de um vizinho só e **sem parada**: tempo − distância/80 km/h < 45 min. Com parada, é "carregou" e não é achado | **PLACA-C 14/09 ALVORADA cat5 → ALIANÇA cat6, 105 km em 97 min (18 min de folga): R$ 9,03**; **PLACA-A 29/09 CAMPO VERDE cat5 → SANTO ANTÔNIO cat4: R$ 6,00** (provável eixo não suspenso). Não acusou, de propósito: A 31/08 NOBRES cat4 → NOVA MUTUM cat61 (3h26) e A 17/09 BARRA DO BUGRES cat4 → ROSÁRIO cat61 (2h28). Parou e carregou |
| `CATEGORIA_ACIMA_DO_VEICULO` | eixos cobrados > eixos do cadastro: cobrança indevida, sempre | 0, com cadastro presumido 7/7/6. **Hoje `Veiculo` não tem `eixos`** (só a pessoa, `MotoristaIdentidade.eixos`). Precisa do campo |
| `VALE_DEBITO_SEM_CREDITO` / `VALE_CREDITO_SEM_PASSAGEM` | par por (nº viagem, praça, sentido, data/hora, valor) | 0. Os 12 pares fecham (A: 7, B: 5) |
| `VALE_INCOMPLETO` | praça paga pela **tag**, no mesmo sentido, encostada (≤ 4h antes/depois) na viagem do vale | **PLACA-A 29/09, vale VP…709 (EMB-2) cobriu JANGADA e SANTO ANTÔNIO (98,70), e a tag pagou NOBRES S 09:40 (46,90) antes e CAMPO VERDE S 16:39 (42,00) depois: R$ 88,90.** Às 19:47 ela volta pelo CAMPO VERDE no sentido NORTE com 5 eixos (vazia), então descarregou ao sul de CAMPO VERDE e a praça era da rota do vale. Comparação: os vales da EMB-1 (VP…526 na A e VP…896 na B) cobriram o corredor inteiro, NOBRES→RONDONÓPOLIS, 5 praças, 240,10 |
| `CARREGADO_SEM_VALE` | trecho com eixos = máximo do veículo pago 100% pela tag | 29 trechos, R$ 2.685,60. **É teto, não achado**: só vira dinheiro se a viagem casada tiver embarcador terceiro. A Lei 10.209/2001 obriga o embarcador a antecipar o vale, e a multa é de 2× o frete (confirmar com o jurídico). Carga própria (o vai-e-vem NOBRES N carregado da PLACA-B em 02, 03, 04 e 05/09) não deve vale |
| `PRACA_PULADA` | duas praças da mesma BR e sentido, ≤ 12h, pulando uma praça conhecida no meio | PLACA-B 18/09 RONDONÓPOLIS N 09:51 (cat3) → SANTO ANTÔNIO N 18:33 (cat61), sem CAMPO VERDE. Não é dinheiro perdido: tag falhou, pagou em dinheiro (vai pedir reembolso) ou desviou. É o gancho pra validar o lançamento manual |
| `AJUSTE_NAO_DETALHADO` | resumo por veículo ≠ soma do detalhe | PLACA-B: R$ 64,80 / 1 uso (§1) |
| `COBRADA_EM_OUTRA_FATURA` | chave já importada de outra fatura | ainda não se aplica (só existe 1 fatura). Candidata: PLACA-B 28/08 JANGADA 56,70 |
| `SEM_VIAGEM` / `FORA_DA_ROTA` | precisam do banco do cliente (§5) | não rodam sem as viagens. Exemplos do que vão pegar: PLACA-C no Tocantins (BR153, 14/09 e 28/09) e o corredor MT246 da A e da B |

**Tarifa por eixo** (valor ÷ eixos, constante por praça): JANGADA 8,10 · NOBRES 6,70 · S.A. LEVERGER 6,00 ·
CAMPO VERDE 6,00 · RONDONÓPOLIS 7,50 · ITIQUIRA 6,60 · NOVA MUTUM 5,40 · MT246 (4 praças) 11,40 ·
ALVORADA 11,78 · ALIANÇA 9,03. Uma única exceção: ROSÁRIO DO OESTE em **31/08 a 10,90**, contra 11,40 depois.
Isso é reajuste, e é por ele que se detecta a regra `TARIFA_DIVERGENTE` (valor ≠ eixos × tarifa vigente), também
com 0 casos fora do reajuste. Essa tabela, observada no extrato, é o melhor preenchimento do `PedagioRodovia.valorBase`
("por eixo"). Grava numa tabela à parte, com data (`TarifaObservada`), e nunca sobrescreve sozinha.

**Oportunidade (não é erro de cobrança)**: vazia, a PLACA-B passa com 3 eixos (26 de 29 passagens) e a PLACA-A com
4 (23 de 25). Se forem a mesma composição de 7 eixos, a A pagou R$ 202,10 a mais no mês por não suspender um eixo.
Isso vale uma conversa com o motorista, nunca uma acusação.

---

## 4. Casar a praça do extrato com `PedagioRodovia`

O cadastro vem do OSM: **um nó por cabine/sentido**, com `rodovia` (o `ref` da via, às vezes `"BR-163;BR-364"`),
lat/lng e `valorBase` opcional. **Não tem km, não tem sentido e quase nunca tem cidade.** O texto do extrato também
não traz UF. Por isso texto contra texto não resolve, e o casamento é feito assim:

1. **Chave da praça** = `rodovia|km` (sem sentido): `BR364|579100`. As 13 praças do arquivo viram 13 chaves.
   O sentido fica na passagem.
2. **Candidatos**: `PedagioRodovia` ativos cujo `rodovia` normalizado (`BR-364` ⇄ `BR364`, lista separada por `;`)
   contém a rodovia, dentro de 40 km do centro da cidade geocodificada. A UF sai da **concessionária**, por tabela
   pequena: NOVA ROTA DO OESTE/VIA BRASIL MT 246 → MT, ECOVIAS DO ARAGUAIA → GO/TO. "ALVORADA" existe em TO e em RS.
   Nós a menos de 2 km entre si contam como **a mesma praça** (cabines dos dois sentidos).
3. **Confirmação cruzada**:
   - a tarifa observada (valor ÷ eixos) bate com o `valorBase`, quando ele existe;
   - duas praças da mesma BR: Δkm do extrato ≈ distância OSRM entre os GPS (±10%). Ex.: JANGADA→NOBRES = 100 km.
4. **Um candidato só e as checagens batendo** = casa sozinho. **Mais de um, ou nenhum** = vai pra fila
   "praças a confirmar", com mapa, e quem decide é gente (regra "IA nunca afirma"). A decisão é gravada num
   **de-para global** `PracaTagAlias { operadora, chavePraca, pedagioRodoviaId, confirmadoPor, confirmadoEm }`.
   Uma vez confirmada, a praça vale pra todas as contas e pra todos os meses.
5. **Não achou**: a passagem fica com `pedagioRodoviaId = null` e **nada trava**. Duplicidade, sentido, categoria,
   vale e ajuste usam só a chave textual e rodam igual. As regras que precisam de GPS (velocidade entre rodovias
   diferentes, fora da rota) devolvem **"não sei"** (`null`), nunca "ok". É a mesma semântica de
   `PedagiosDaViagem.pedagios: null`. A fila oferece "cadastrar esta praça" (`fonte: "extrato"`, ponto no mapa)
   já com a tarifa por eixo observada.

---

## 5. Casar passagem com viagem, e o que isso vale

**O que existe hoje pra montar a janela**: `Viagem.veiculoId`; `Viagem.data` (`@db.Date`, só o dia); `iniciadoEm`
(só na viagem guiada); `EventoViagem.ocorridoEm` (carga/descarga do lifecycle); `ViagemPonto` (GPS, só se iniciou
pelo app). **Não existe "finalizadoEm"** na Viagem.

Ordem de casamento, do mais forte pro mais fraco (fica gravada em `casamento`):
1. **GPS**: um `ViagemPonto` da viagem a < 2 km da praça casada e a ±10 min (mais a folga de fuso). Certeza.
2. **JANELA**: mesmo veículo e `ocorridoEm` ∈ [iniciadoEm − 30 min, último evento + 30 min, limitado pelo
   `iniciadoEm` da viagem seguinte do veículo].
3. **DIA_ROTA**: viagem manual (só `data`). O dia é ancorado no fuso, com a madrugada seguinte até 12h, **e** a praça
   tem que estar em `pedagiosDaViagem(viagemId)`. Isso separa os vaivéns do mesmo dia: a PLACA-B passou em NOBRES
   7 vezes em 4 dias.
4. Mais de uma candidata vai pra `MANUAL` (fila). Nenhuma vira achado **`SEM_VIAGEM`**: o caminhão rodou e pagou
   pedágio sem viagem lançada. Ou é frete não faturado, ou é uso fora do serviço. Em jogo: o valor da passagem, e às
   vezes o frete inteiro.
5. Com a viagem casada: praça fora de `pedagiosDaViagem` vira **`FORA_DA_ROTA`**; lista `null` vira "não sei".

Tamanho do trabalho no arquivo real: as passagens formam **68 pernas** (gap de 6h): PLACA-A 23 (13 carregadas),
PLACA-B 34 (19 carregadas), PLACA-C 11. Uma perna carregada típica, JANGADA→RONDONÓPOLIS a 7 eixos, custa
**R$ 193,20**. A volta vazia do mesmo corredor sai por R$ 58,50 a 3 eixos ou R$ 78,00 a 4. Ou seja, **a estimativa
por eixos tem que separar ida carregada e volta vazia**. Um só `eixos` erra a volta em até 57%.

**O que isso dá de valor, por viagem**: quatro números lado a lado.
- **real pela tag** = Σ PassagemTag D (tipo PEDAGIO) casadas;
- **pago pelo embarcador** = Σ débitos de vale (não é custo da empresa e não se repassa ao cliente);
- **lançado pelo motorista** = `pedagioDaViagem()` (`valorPedagioTotal` ou `Pedagio.valor`, nunca os dois);
- **estimado** = praças da rota × eixos × tarifa.

Decisões que isso destrava:
- **Fim do lançamento manual pra caminhão com tag.** Pedágio pago pela tag é dinheiro da empresa: não entra no acerto
  como reembolso. O motorista só lança **o que pagou do bolso** (tag falhou, cabine manual). O lançado que casa com
  passagem de tag (mesmo veículo, dia e praça) vira **`REEMBOLSO_EM_DOBRO`**, o mesmo espírito do
  `DecisaoPedagioDobro`, agora com prova. A `PRACA_PULADA` é o que **valida** um lançamento manual legítimo.
- **Repasse ao cliente** (`TabelaPreco.repassaPedagio`): quando há passagem de tag casada, a base do repasse é o
  **real pela tag menos o vale** (não se cobra do cliente o que o embarcador já pagou). Isso entra como valor congelado
  no `ViagemValor`, com motivo. O `valorPedagioTotal` do motorista continua intocado: o que ele informou é
  registro dele.
- **Lucro por caminhão**: pedágio real por veículo/mês sai do extrato (A 1.881,90, B 2.213,40, C 653,48) e o custo
  fixo da tag também (plano 61,65 + gestor 3,90 = **65,55/placa/mês**, via `ExtratoTagVeiculo`).
