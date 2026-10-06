# 05 — Prova do cruzamento automático: passagem da tag × viagem (06/10/2026)

Pedido do dono: provar que o sistema consegue ligar sozinho cada passagem da tag à viagem certa,
sem ligar errado. O cliente ainda não tem viagens lançadas, então a prova tem duas partes:

- **Parte 1, só com dado real** (fatura Sem Parar de setembro): casar a praça do extrato com a praça
  do mapa, cortar as passagens em trechos, separar carregado de vazio e reconstruir as viagens que a
  tag enxergou.
- **Parte 2, com viagens SIMULADAS** (27 viagens inventadas, coerentes com o extrato e marcadas como
  simulação): rodar o casamento e medir acerto, sugestão, sobra e **erro**.

Placas mascaradas (PLACA-A/B/C) e embarcadores como EMB-1/EMB-2. Nada foi gravado no repositório além
deste documento, e nenhum banco foi tocado. Os scripts estão no scratchpad da sessão
(`tag-cruzamento/`: `pracas.mjs`, `fila-mt246.mjs`, `gaps.mjs`, `trechos.mjs`, `rotas.mjs`,
`viagens-simuladas.mjs`, `matcher.mjs`, `relatorio.mjs`) e usam o `extrato.json` de `tag-dados/`.

## Resultado em uma tabela

| | Valor |
|---|---|
| Praças do extrato que casaram sozinhas com o mapa | **8 de 13 só com o OSM** (o `PedagioRodovia` de hoje) · **9 de 13 com OSM + ANTT** |
| Praças que foram pra fila "confirmar praça" | 4, todas da Via Brasil MT-246. A fila resolve com uma confirmação e vale pra sempre |
| Passagens viradas em trechos | 131 linhas (119 da tag + 12 débitos de vale) → **61 trechos: 30 carregados, 31 vazios** |
| Trechos carregados ligados sozinhos e **certos** | **23 de 30 (77%)** |
| Ligados sozinhos e **errados** | **0** |
| Ficaram como sugestão (alguém confirma) | 5 (17%): data trocada, lançamento duplicado e placa trocada no comboio |
| Sobraram sem viagem | 2 (7%). As duas estão certas, porque não existe viagem pra elas |
| Viagens simuladas que têm passagem e foram ligadas sozinhas | **19 de 21 (90%)** |
| Pedágio que a rota previa × o que a tag cobrou, nas 19 ligadas | igual ao centavo em 15. As **4 diferenças são exatamente os achados** (praça pulada 2×, passagem dobrada, reajuste) |

O critério de sucesso era zero ligação automática errada, e ele foi cumprido. Quem garante o zero são
as **travas de estrutura**, e não o ajuste fino dos pontos: só trecho carregado vira viagem, praça na
ordem contrária é a volta, data com um dia de diferença nunca liga sozinha, trechos de uma mesma viagem
precisam ser contíguos e há a checagem de comboio. A varredura de limiares (§2.5) mostra que, com
essas travas, nenhuma combinação de pontos testada errou. Sem elas, o casamento erra (§2.4).

---

## Parte 1: só o extrato real

### 1(a) De-para praça do extrato → praça do mapa

**Fontes baixadas:**
- **OSM**: a mesma consulta Overpass do `pedagios-rodovia.service.ts` (`barrier=toll_booth|toll_gantry`
  mais as vias, pra herdar o `ref`), recortada em MT+TO. Resultado: 67 cabines, que viram **37 praças**
  quando se juntam as cabines a menos de 2 km uma da outra. O `overpass-api.de` deu timeout e o espelho
  `overpass.kumi.systems` respondeu (base OSM de 31/05/2026).
- **ANTT**: o CSV de dados abertos "Dados das Praças de Pedágio" (jun/2026, 277 praças federais). Traz
  **concessionária, rodovia, km, município, sentido e lat/lng**. As 9 praças federais do extrato estão nele.
- Sede dos municípios (código IBGE + lat/lng), pra geocodificar a "cidade" que vem no texto.

**Regra (função pura, `pracas.mjs`):**
1. A chave da praça é `rodovia|km` (o sentido fica na passagem). A UF sai da concessionária
   (NOVA ROTA DO OESTE e VIA BRASIL MT 246 → MT; ECOVIAS DO ARAGUAIA → TO/GO).
2. **Candidatos no OSM**: praça cujo `ref` contém a rodovia do extrato (`BR-364` ⇄ `BR364`, listas com `;`),
   ou que não tem `ref` mas tem a mesma operadora, a até **40 km da sede** da cidade do texto. O nome é
   normalizado ("SANTO ANTÔNIO LEVERGER" = "Santo Antônio do Leverger", "ROSÁRIO DO OESTE" = "Rosário Oeste").
3. **Confirmação pela cadeia de km**: duas praças da mesma rodovia têm que ter a distância OSRM entre os
   GPS parecida com o Δkm do extrato, com tolerância de ±15%. Exemplos: JANGADA→NOBRES dá 100,0 km de Δkm
   e 100,4 km no OSRM; CAMPO VERDE→STO ANTÔNIO, 66,6 e 66,9.
4. **Confirmação pela tarifa**: o valor dividido pelos eixos é comparado com a tarifa publicada por eixo.
   As 7 praças da Nova Rota do Oeste bateram ao centavo.
5. **ANTT**: rodovia + km (±1 km) caem num registro só, o município bate com o texto e o GPS da ANTT cai
   em cima de um nó do OSM (de 3 a 238 m). Com isso a praça casa sozinha.
6. **Casa sozinha** quando há 1 candidato, a cadeia não contradiz e há pelo menos uma confirmação. Se não,
   vai pra fila "confirmar praça", com os candidatos e a evidência.

**Resultado nas 13 praças:**

| Praça do extrato | Pass. | Só OSM | Com ANTT | Observação |
|---|---|---|---|---|
| BR364 km214,4 RONDONÓPOLIS | 16 | casou | casou | 12 km da sede |
| BR364 km316,55 CAMPO VERDE | 17 | casou | casou | 34 km da sede (a praça fica longe da cidade) |
| BR364 km383,1 STO ANTÔNIO LEVERGER | 20 | casou | casou | 32 km da sede |
| BR364 km479,1 JANGADA | 26 | casou | casou | |
| BR364 km579,1 NOBRES | 27 | casou | casou | `ref` do OSM = BR-163;BR-364;MT-010 |
| BR163 km586,9 NOVA MUTUM | 1 | casou | casou | |
| BR153 km640 ALIANÇA DO TOCANTINS | 2 | casou | casou | |
| BR153 km745 ALVORADA (TO) | 2 | casou | casou | no OSM está **sem `ref`**: casou pela operadora |
| BR163 km33,6 ITIQUIRA | 2 | **fila** | casou | a praça está a **65 km** da sede de Itiquira, fora do raio de 40 km. A ANTT resolve |
| MT246 km119 ROSÁRIO DO OESTE | 9 | **fila** | **fila** | estadual, não está na ANTT. Ver abaixo |
| MT246 km332 BARRA DO BUGRES | 3 | **fila** | **fila** | |
| MT246 km107 TANGARÁ DA SERRA | 3 | **fila** | **fila** | |
| MT246 km35 TANGARÁ DA SERRA | 3 | **fila** | **fila** | |

**Por que as 4 da MT-246 não casam sozinhas, e é certo que não casem:**
- A concessionária chama tudo de "MT246", mas no mapa só a praça de Rosário fica na MT-246. As de km107 e
  km35 estão na **MT-358**, e a de km332 na **MT-344**. O casamento por rodovia não encontra nada pra elas.
- ROSÁRIO e BARRA tinham o **mesmo** candidato único (a praça da MT-246). A trava da cadeia derrubou os
  dois: o Δkm do extrato é 213 km e o OSRM mede 0 km. **Essa trava evitou um casamento errado.**
- O "sentido" que a MT-246 imprime não serve de bússola. A PLACA-A anda de Tangará pra Jangada (rumo
  LESTE) e o extrato diz OESTE em todas.

**O que a fila mostra pra pessoa decidir** (`fila-mt246.mjs`): o tempo entre passagens consecutivas
comparado com o tempo de rota entre os candidatos. Na PLACA-A, em 17/09:

| Hipótese | OSRM | Extrato |
|---|---|---|
| km107 = praça MT-358 oeste → km35 = praça MT-358 leste | 73 km / 71 min | 67 min |
| km35 → km332 = praça MT-344 | 52 km / 54 min | 53 min |
| km332 → km119 = praça MT-246 | 80 km / 75 min | 148 min (carregou no caminho) |
| km119 → JANGADA | 43 km / 44 min | 35 min |

A hipótese encaixa minuto a minuto. A alternativa (km107 indo direto pra praça da MT-344) daria 123 min, contra 67 observados.
Confirmar uma vez grava o de-para global (`PracaTagAlias`), que passa a valer pra todas as contas.
**Na Parte 2, essas 4 entram como "confirmadas na fila"**, e o §2.6 mede o custo de não confirmar.

### 1(b) Trechos: onde cortar

O trecho é uma sequência contínua de passagens da mesma placa. Ele quebra quando:
- **a carga muda** (vazio→carregado = carregou; carregado→vazio = descarregou), ou
- a **folga** passa de **90 min**. Folga = Δt entre duas passagens − 1,15 × tempo OSRM entre as duas
  praças. O fator 1,15 existe porque o caminhão anda mais devagar que o perfil carro.

**Calibração** (`gaps.mjs`): distribuição das 128 folgas entre passagens consecutivas.

| Folga | Pares | Dos quais trocam carga |
|---|---|---|
| < 30 min | 63 | 1 |
| 30–60 | 5 | 0 |
| 60–90 | 4 | 1 |
| 90–120 | 2 | 2 |
| 120–360 | 11 | 7 |
| 360–600 | 5 | 4 |
| > 600 (pernoite) | 38 | 24 |

Em 68 de 128 pares o caminhão está claramente rodando (menos de 1 h de folga). Na zona cinzenta, os pares
**sem** troca de carga são:
- 68, 74 e 84 min: a mesma viagem seguindo (A 29/09, C 31/08, A 25/09);
- 175, 180, 184 e 294 min: parada longa. É a B em 17/09 (Sto Antônio 17:22 → Campo Verde 21:41, que pode
  ser descarga seguida de nova carga) e a B em 31/08 (7 h paradas no meio da viagem).

**Por que 90 min**: o erro só anda num sentido. Cortar uma viagem em dois trechos **não custa nada**,
porque o casamento aceita vários trechos contíguos na mesma viagem (a V04 tem 2, a V12 tem 3). Já
**juntar duas viagens num trecho só não tem conserto** depois. Testado:

| Limiar | Trechos | Efeito na Parte 2 |
|---|---|---|
| 60 min | 64 | os mesmos acertos, com mais pedaços por viagem |
| **90 min** | **61** | o escolhido |
| 180 min | 59 | junta as duas viagens da B em 17/09: V15 e V16 caem pra sugestão (não erra, mas perde 2 automáticas) |

O doc 02 usou "pausa de 6 h" e achou 68 pernas. Pausa fixa não enxerga a parada de 4 h entre duas
viagens no mesmo dia, nem separa carga de descarga sem troca de eixo.

### 1(c) Carregado × vazio pelos eixos

O caminhão está **carregado** quando os eixos cobrados são iguais ao máximo do caminhão (A e B = 7, que é
a categoria 61; C = 6). Abaixo disso está vazio, porque o eixo vai suspenso.

| | Trechos carregados | Tag carregado | Vale | Trechos vazios | Tag vazio |
|---|---|---|---|---|---|
| PLACA-A | 9 | R$ 1.109,50 | R$ 338,80 | 12 | R$ 772,40 |
| PLACA-B | 16 | R$ 1.524,60 | R$ 240,10 | 13 | R$ 688,80 |
| PLACA-C | 5 | R$ 312,15 | — | 6 | R$ 341,33 |
| **Total** | **30** (14 com 1 praça só) | **R$ 2.946,25** | **R$ 578,90** | **31** | **R$ 1.802,53** |

Um caso ambíguo: a PLACA-C em 14/09 passa em ALVORADA com 5 eixos e em ALIANÇA com 6, 97 min depois. A
regra lê isso como "carregou no meio" (entre Alvorada e Aliança fica Gurupi). Também pode ser eixo cobrado
a mais, que é o `CATEGORIA_VARIOU` do doc 02. Nos dois casos a viagem simulada liga certo.

### 1(d) As viagens que a tag enxergou

Pra cada trecho carregado, a origem e o destino saem da primeira e da última praça. Quando há um trecho
vazio vizinho (a até 12 h), o lugar fica mais preciso: "carregou **entre** X e Y". Alguns exemplos reais
(lista completa em `trechos.txt`):

- **A 17/09**: vazia por TANGARÁ km107 → km35 → BARRA (13:30–15:30). Carregada a partir de ROSÁRIO 17:58
  → JANGADA → STO ANTÔNIO → CAMPO VERDE → RONDONÓPOLIS 23:48. **Carregou entre Barra do Bugres e Rosário,
  descarregou além de Rondonópolis**, e voltou vazia no dia 18.
- **B 03/09, 04/09 e 05/09**: passa NOBRES SUL vazia de manhã e NOBRES NORTE carregada 3–4 h depois.
  **Carrega ao sul de Nobres e descarrega ao norte.** É o vai-e-vem diário.
- **B 17/09**: carregada de ROSÁRIO a STO ANTÔNIO (14:17–17:22), **4 h paradas**, carregada de novo em
  CAMPO VERDE → RONDONÓPOLIS (21:41–23:25). A tag sozinha não sabe dizer se é uma viagem com parada ou
  duas viagens. Quem decide é a viagem lançada (Parte 2).
- **A 29/09**: NOBRES NORTE 09:38 e NOBRES SUL 09:40 carregada, depois vale da EMB-2, até CAMPO VERDE SUL
  16:39 e de volta vazia em CAMPO VERDE NORTE 19:47. **Descarregou entre Campo Verde e Rondonópolis**
  (Jaciara/Juscimeira).
- **C 14/09**: no Tocantins, **carregou entre Alvorada e Aliança** (Gurupi) e seguiu pro norte.

Os 30 trechos carregados correspondem a **26 a 30 viagens**: 3 pares encostados (parada de menos de 12 h
sem descarregar) podem ser a mesma viagem ou não. Os 31 vazios são retornos ou deslocamentos até a carga.

---

## Parte 2: casamento com viagens SIMULADAS

### 2.1 As viagens simuladas (é simulação, não é dado do cliente)

São 27 viagens nas três placas, com datas e janelas tiradas do extrato e origem/destino em cidades reais
de MT e TO. Há dois tipos de lançamento:
- **manual**: só a `data`, que é o que o app grava hoje;
- **guiada**: `iniciadoEm` e o último evento.

A rota de cada uma veio do **OSRM do Movatruck** (`ronan-osrm.2azr6q.easypanel.host`, só cálculo de rota).
As "praças na rota" usam **a mesma regra do `pedagios-rodovia-consulta.service.ts`**: cada nó do OSM a até
150 m da polyline. O nó vira praça do extrato pelo de-para do 1(a), e a posição ao longo da polyline dá a
ordem e o rumo (N/S, medido em ±25 km em volta da praça).

| Id | Placa | Lançamento | Rota | Praças na rota | Caso de propósito | Gabarito |
|---|---|---|---|---|---|---|
| V01 | A | 31/08 | Diamantino→Nova Mutum | 1 | normal | TA02 |
| V02 | A | 05/09 | Nobres→Diamantino | 1 | **2 viagens no dia, mesma BR-364** | TA06 |
| V03 | A | 05/09 | Diamantino→Alto Paraguai | 0 | idem; **sem praça na rota** | — |
| V04 | A | guiada 11/09 17:30–13/09 21:30 | Diamantino→Rondonópolis | 5 | 3 dias, vale EMB-1 | TA07+TA08 |
| V05 | A | **18/09** | Barra do Bugres→Rondonópolis | 5 | **lançada com a data do dia seguinte** (real: 17/09) | TA12 |
| V06 | A | 23/09 | Campo Novo do Parecis→Várzea Grande | 5 | MT-246 + praça que a tag não cobrou | TA15 |
| V07 | A | guiada 25/09 08:30–19:30 | Barra do Bugres→Rondonópolis | 5 | guiada | TA17 |
| V08 | A | 29/09 | Diamantino→Jaciara | 4 | vale parcial + NOBRES N/S em 2 min | TA20 |
| V09 | B | 31/08 | Barra do Bugres→armazém BR-163 sul de Itiquira | 6 | **cruza meia-noite** + parada de 7 h | TB02+TB03 |
| V10 | B | 03/09 | Rosário Oeste→Diamantino | 1 | vai-e-vem; 04/09 tem o mesmo trecho **sem** viagem | TB07 |
| V11 | B | 05/09 | Rosário Oeste→Diamantino | 1 | vai-e-vem | TB11 |
| V12 | B | guiada 11/09 19:00–13/09 14:00 | Diamantino→Rondonópolis | 5 | vale EMB-1, 3 trechos | TB12+13+14 |
| V13 | B | 16/09 | Diamantino→Várzea Grande | 2 | normal | TB17 |
| V14 | B | 17/09 | Várzea Grande→Cuiabá | 0 | **3 viagens no dia, só 2 por praça** (1/3) | — |
| V15 | B | 17/09 | Barra do Bugres→armazém BR-364 (S. São Vicente) | 3 | idem (2/3) | TB19 |
| V16 | B | 17/09 | armazém BR-364 (S. São Vicente)→Rondonópolis | 2 | idem (3/3), mesma rodovia da 2/3 | TB20 |
| V17 | B | 18/09 | Jaciara→Várzea Grande | 2 | **praça na rota sem passagem** (Campo Verde) | TB22 |
| V18 | B | 19/09 | Barra do Bugres→Rondonópolis | 5 | **ida vazia nas mesmas praças** de manhã + **retorno vazio** na manhã seguinte | TB24 |
| V19 | B | guiada 23/09 08:00–18:30 | Barra do Bugres→Rondonópolis | 5 | ida vazia na véspera | TB28 |
| V20 | B | 25/09 | Rondonópolis→Cuiabá | 3 | **praça na rota e nenhuma passagem**; na véspera há um vazio nas mesmas praças, mesma ordem | — |
| V21 | C | 05/09 | Diamantino→Várzea Grande | 2 | normal | TC04 |
| V22 | C | 07/09 | Jangada→Diamantino | 1 | normal | TC06 |
| V23 | C | **10/09** | Diamantino→Cuiabá | 2 | **cruza meia-noite**: lançada 10/09, passou 11/09 às 05:07 | TC07 |
| V24 | C | 13/09 | Cuiabá→Várzea Grande | 0 | sem praça (no mesmo dia há um vazio em Sto Antônio) | — |
| V25 | C | guiada 14/09 17:00–21:00 | Gurupi→Palmas (TO) | 1 | vazio em Alvorada 28 min antes do início | TC10 |
| V26 | B | 03/09 | Rosário Oeste→Diamantino | 1 | **lançamento duplicado** da V10 | — |
| V27 | A | 03/09 | Rosário Oeste→Diamantino | 1 | **placa trocada**: quem fez foi a C (TC03), que rodava em **comboio** com a A | — |

Os trechos **TB01** (28/08, fora do período), **TC03** e os 31 vazios não têm viagem de propósito. O
comboio é real: a A e a C passam juntas por NOBRES em 02/09 (24 min de diferença) e em 03/09 (2 min).

### 2.2 Como o casamento decide (`matcher.mjs`, função pura)

Pra cada trecho, as candidatas são as viagens da **mesma placa** cuja janela encosta no trecho. A
pontuação soma:

| Ingrediente | Pontos |
|---|---|
| Janela da guiada (trecho dentro de [início − 30 min, último evento + 30 min]) | +4 (parcial: +1, nunca liga sozinha) |
| Janela da manual: mesmo dia | +2 |
| Madrugada seguinte, até 12h | +1 |
| Dia ±1 | 0, nunca liga sozinha |
| Praças em comum (cobertura = praças do trecho que estão na rota) | +3 × cobertura. Com cobertura 0, a viagem não é candidata |
| Ordem e sentido batem com a rota | +1. Ordem contrária = é a volta, e a viagem sai da lista. Sentido da BR contra o rumo na maioria das passagens = sai da lista. A MT-246 não entra nessa conta (§1a) |

Travas que **não são pontos**:
1. **Eixos**: só trecho **carregado** vira viagem. O vazio vira "retorno" ou "ida vazia" da viagem vizinha.
2. **Liga sozinho** só com ≥ 5 pontos, **folga ≥ 2** sobre a 2ª candidata, janela forte (guiada, dia ou
   madrugada) e **cobertura total** (nenhuma praça do trecho fora da rota).
3. **Contiguidade**: vários trechos na mesma viagem só valem se não houver um vazio entre eles. Se houver,
   fica o de mais pontos (com folga ≥ 1) e o resto vira sugestão.
4. **Comboio**: outra placa passou nas mesmas praças, no mesmo sentido, a ≤ 30 min, e não tem viagem.
   Nesse caso vira sugestão: "confira a placa".

Quando não liga sozinho, o trecho vira **sugestão** com o motivo escrito. Sem candidata, vira **sobra**
("passagem sem viagem"). A sugestão nunca afirma nada (regra "IA nunca afirma").

### 2.3 Resultado (30 trechos carregados, 27 viagens)

| Casamento | Auto certo | **Auto errado** | Sugestão | Sobra | Vazio colado como se fosse a viagem |
|---|---|---|---|---|---|
| Ingênuo (placa + dia; liga se só há 1 viagem no dia) | 15 (50%) | **1** | 12 | 2 | **11** |
| Praças + janela, sem as travas | 24 (80%) | **1** | 3 | 2 | **14** |
| **Final** | **23 (77%)** | **0** | **5 (17%)** | **2 (7%)** | **0** |

Na primeira rodada, sem V26 e V27 (25 viagens), deu:
- final: 24 certos, 0 errados, 3 sugestões;
- "praças sem travas": **2 erros** (TB05 e TB09 → V10). O vai-e-vem de 02/09 e de 04/09 grudou na viagem
  de 03/09 pela janela de ±1 dia e pela da madrugada. Quem resolve isso é a trava de contiguidade (há um
  vazio entre os trechos).

"Vazio colado como se fosse a viagem" também é erro. O ingênuo cola o vazio de 24/09 (TB29) na V20, que
não aconteceu, e o vazio de STO ANTÔNIO (TC08) na V24, que é uma viagem urbana sem praça.

### 2.4 Os casos difíceis, um a um (casamento final)

1. **3 viagens no mesmo dia, só 2 por praça (B 17/09).**
   - A V14 (urbana) não tem praça e não é candidata de nada.
   - TB19 (ROSÁRIO→JANGADA→STO ANTÔNIO) → **V15 sozinho** (6,0 pontos). Contra a V16 a cobertura é 0, então
     ela nem é candidata. A V13 (16/09) chega a 2,0 pelo dia ±1 com cobertura parcial.
   - TB20 (CAMPO VERDE→RONDONÓPOLIS) → **V16 sozinho**.
   - Quem separa as duas viagens são as praças, e não a hora: nenhuma das três tem horário. O ingênuo
     deixou as duas como sugestão ("3 viagens no dia").
2. **Duas viagens no dia na mesma rodovia (A 05/09).**
   - TA06 (NOBRES N, carregado) → **V02 sozinho**.
   - A V03 (Diamantino→Alto Paraguai, também BR-364) não passa por praça e fica sem nada, o que está certo.
   - O vazio NOBRES S das 14:44 (TA05) não é ligado.
3. **Data do dia seguinte (V05, lançada 18/09, passagens em 17/09).**
   - **Sugestão** "janela dia ±1, cobertura 5/5". É o custo assumido: se dia ±1 ligasse sozinho, este caso
     acertaria, mas foi justamente o dia ±1 que produziu os 2 erros da primeira rodada.
4. **Viagem sem praça na rota (V03, V14, V24).** Nenhuma ligação. O ingênuo colou um vazio na V24.
5. **Praça na rota sem passagem na tag.**
   - **V06**: ROSÁRIO (MT-246) está na rota, e a tag foi de BARRA 19:32 direto pra JANGADA 21:38, sem
     cobrar. O tempo bate com a rota passando por Rosário. São **R$ 79,80 que a tag não cobrou**.
   - **V17**: CAMPO VERDE pulada (o `PRACA_PULADA` do doc 02), **R$ 42,00**.
   - **V20**: 3 praças, nenhuma passagem (**R$ 136,50 previstos**). Na véspera há um vazio da mesma placa
     nas mesmas 3 praças, na mesma ordem e no mesmo sentido (TB29). Ele não é ligado porque está vazio e
     porque fica a 1 dia. Ou a viagem não existiu, ou foi lançada na placa errada, ou o pedágio foi pago
     por fora.
6. **Passagens sem viagem.**
   - Carregadas: **TB01** (JANGADA S, 28/08, R$ 56,70, de **fora do período** da fatura) e **TC03**
     (NOBRES N, 03/09, R$ 40,20). Somam **R$ 96,90**.
   - Vazias: 31 trechos, **R$ 1.802,53**. Desses, 12 viram **retorno** de uma viagem ligada e 11 são a
     **ida vazia** até a carga de uma viagem ligada. 5 são as duas coisas ao mesmo tempo (o vazio entre duas
     viagens ligadas), então **18 vazios (R$ 1.063,50) ficam atribuídos a alguma viagem**.
   - Sobram 13 vazios soltos (R$ 739,03), que o escritório olha.
7. **Retorno vazio (V18, B 19/09).**
   - De manhã, TB23 passa vazia em JANGADA N e ROSÁRIO, as mesmas praças da viagem, ao contrário.
   - Na manhã seguinte, TB25 passa em RONDONÓPOLIS N → CAMPO VERDE N → STO ANTÔNIO N, dentro da janela de
     madrugada da V18.
   - Nenhum dos dois é ligado como viagem: a ordem é contrária e eles estão vazios. TB24 → **V18 sozinho**.
     A TB25 aparece como **retorno** da V18 (R$ 58,50).
8. **Cruza meia-noite.**
   - V09: TB02 (31/08 11:28) + TB03 (31/08 19:00 → ITIQUIRA 01/09 00:42), os **dois sozinhos**. A parada
     de 7 h no meio não atrapalha, porque os trechos são contíguos.
   - V23: lançada 10/09, passagem 11/09 às 05:07. Liga **sozinho** pela janela de madrugada, com 5,0
     pontos, exatamente no corte.
9. **Lançamento duplicado (V10 = V26).** Os dois empatam em TB07 (6,0 × 6,0) e o trecho vira
   **sugestão** "empate". A folga ≥ 1 é o que impede o cara-ou-coroa: com folga 0, o empate é resolvido
   pela ordem da lista.
10. **Placa trocada no comboio (V27 lançada na A, feita pela C).**
    - TA04 (A, NOBRES N 09:01) casaria **sozinho e errado** com a V27 (6,0 pontos, candidata única).
    - A trava de comboio vê que a C passou junto (TC03, 09:00) e não tem viagem, e rebaixa pra sugestão
      "confira a placa".
    - **Foi o único erro que sobrou no final antes dessa trava existir.**
11. **Guiada no TO com vazio colado no início (V25).** O vazio de ALVORADA (16:32) cai dentro da tolerância
    de 30 min antes do início (17:00), mas não é ligado porque está vazio. TC10 → **V25 sozinho**.
12. **Sentido oposto em 2 min (A 29/09, V08).** Liga **sozinho** com evidência: "NOBRES NORTE 09:38 contra
    o rumo". O pedágio real da viagem fica R$ 46,90 acima do previsto, e esse é o achado
    `SENTIDO_OPOSTO_CURTO` do doc 02, agora com a viagem do lado.

### 2.5 Limiares: o que custa o zero erro

Varredura em cima das travas do final (`relatorio.mjs`), com 30 trechos carregados:

| Dia ±1 liga sozinho? | Mínimo de pontos | Folga | Certo | **Errado** | Sugestão |
|---|---|---|---|---|---|
| sim | 3–4 | 0 | 25 | 0* | 3 |
| sim | 3–4 | 1–3 | 24 | 0 | 4 |
| sim | 5 | 1–3 | 23 | 0 | 5 |
| **não** | **5** | **2** | **23** | **0** | **5** ← escolhido |
| não | 6 | qualquer | 21 | 0 | 7 |

\* Com folga 0 o empate da duplicata "acertou" por sorte, pela ordem da lista. Não conta.

Desligando cada trava, uma de cada vez:
- **sem a do comboio: 1 erro** (TA04 → V27);
- sem ordem/sentido: 22 certos (o sentido também soma ponto);
- as outras travas, nesta amostra, ficam redundantes entre si. Na primeira rodada, a contiguidade e o
  "dia ±1 não liga" eram as que seguravam os 2 erros.

**O custo do zero erro**: 5 dos 30 trechos carregados (17%) viram sugestão. Desses 5:
- 1 é a data trocada (V05), que se resolve em 1 clique;
- 3 são o mesmo vai-e-vem diante da duplicata V10/V26. Isso é um problema do lançamento, e a tela de
  sugestão é que mostra a duplicata;
- 1 é a placa trocada (V27), onde o sistema **não deveria** decidir mesmo.

Comparado com a regra mais permissiva que ainda não erra, o custo do limiar escolhido é **1 a 2 sugestões
a mais**. Subir o mínimo pra 6 custa mais 2 automáticas: a madrugada (V23) e a do sentido oposto (V08).

### 2.6 Custo de não confirmar as 4 praças da MT-246

Rodando o mesmo casamento só com as 9 praças que casam sozinhas, **as automáticas caem de 23 pra 17**. As
6 que perdem (TA15, TA17, TB02, TB19, TB24, TB28) passam todas pela MT-246 e viram sugestão "praça fora da
rota", porque a praça do trecho não tem GPS. Não aparece nenhum erro, só perda. **Uma confirmação na fila,
uma vez, devolve 6 ligações por mês** nesse cliente.

### 2.7 O que a ligação vale (viagem por viagem)

Com a viagem ligada, há três números lado a lado:
- **real** = tag + vale;
- **previsto** = praças na rota × eixos × tarifa por eixo observada no extrato;
- **lançado pelo motorista** (não existe na simulação).

Nas 19 viagens ligadas sozinhas: **real R$ 2.388,75 de tag + R$ 578,90 de vale = R$ 2.967,65** contra
**R$ 3.046,08 previstos**. **Em 15 delas o real é igual ao previsto ao centavo.** As 4 diferenças são
justamente o que interessa:

| Viagem | Real − previsto | O que é |
|---|---|---|
| V06 | −79,80 | ROSÁRIO na rota e não cobrada. Se o motorista lançou pedágio em dinheiro, é **esse** o reembolso legítimo |
| V17 | −42,00 | CAMPO VERDE pulada. Idem |
| V08 | +46,90 | NOBRES cobrada nos dois sentidos em 2 min. É contestação com a operadora |
| V09 | −3,50 | ROSÁRIO em 31/08 ainda na tarifa antiga (10,90 × 7). Reajuste, não é erro |

Isso confirma a decisão do doc 02 (§5): **pra caminhão com tag, o pedágio da viagem sai do extrato e o
lançamento manual some.** O motorista só lança a praça que o sistema já sabe que **faltou** (V06, V17).
O que ele lançar numa praça que a tag cobrou vira `REEMBOLSO_EM_DOBRO`. A viagem guiada e a manual ligaram
igualmente bem; o que fez diferença foram as **praças da rota**, e não o horário.

---

## O que essa prova muda na proposta (03)

1. **De-para de praça na primeira importação, não depois**: ANTT (federais, com km) mais a fila pras
   estaduais, com a evidência de tempo × OSRM. Sem isso, 6 de 23 ligações automáticas viram sugestão.
2. **Trecho = folga > 90 min ou troca de carga.** Nada de pausa fixa de 6 h.
3. **As travas são o produto, e não os pontos**: eixos, ordem/sentido, contiguidade, dia ±1 nunca sozinho e
   comboio. A trava de **comboio** é nova (não estava no 02/03) e foi a que segurou o único erro restante.
4. **Viagem manual com só a `data` basta pra 90% das viagens** quando a rota tem praça. A guiada ajuda nos
   casos de vários dias, mas não foi ela que decidiu os casos difíceis.
5. Toda sugestão sai com motivo escrito e a candidata na frente: "data ±1", "empate com Vxx", "comboio:
   confira a placa", "praça fora da rota". A tela é uma fila de confirmação de 1 clique.

## Limites da prova

- As viagens são **simuladas por quem conhecia o extrato**. O gabarito é coerente, mas um cliente real vai
  trazer casos que não imaginei: rota alternativa escolhida pelo motorista, local cadastrado com o pino
  errado, viagem lançada dias depois. O número de verdade sai do primeiro mês com viagens lançadas.
  Recomendo rodar o casamento **em sombra** (só sugestões) nesse primeiro mês e medir os mesmos quatro números.
- O fuso foi assumido como UTC−4 (MT) pra tudo, inclusive nas passagens do TO. Isso não muda nenhuma
  ligação da prova, porque as janelas são de dia ou têm ±30 min. O doc 02 já indica como calibrar com o GPS.
- As tarifas "previstas" vêm do próprio extrato (tarifa por eixo observada), e não de uma tabela externa.
