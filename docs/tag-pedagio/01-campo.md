# 01 — Campo: tag de pedágio, vale-pedágio e onde está o dinheiro (tag-campo, 06/10/2026)

Pergunta: o que a conciliação do Sem Parar precisa conferir pra devolver dinheiro ao cliente de MT
(3 caminhões, grãos/pecuária, agregado de transportadoras), e o que o mercado já faz?

Convenção: toda afirmação tem link ou vem marcada **SUPOSIÇÃO**. Os números da seção 0 saem da
fatura real do cliente (set/2026, texto extraído do PDF, fora do repositório). Dados do cliente
foram anonimizados: placas viram **A, B, C**, embarcadores viram "embarcador 1 / 2", nº de
viagem e de fatura não aparecem.

---

## 0. O que a fatura real já mostra (antes de qualquer pesquisa)

Conta feita em script sobre as 119 passagens + 12 pares de vale-pedágio da fatura.

| Placa | Eixos (deduzido) | Passagens pagas pela tag | Das quais carregado (cat. 61/6) | Vale-pedágio recebido |
|---|---|---|---|---|
| A | 7 (vazio roda em 4, às vezes 5) | R$ 1.881,90 | R$ 1.109,50 em 20 passagens | 1 viagem completa (emb. 1) + 1 parcial (emb. 2) |
| B | 7 (vazio roda em 3) | R$ 2.213,40 | R$ 1.524,60 em 29 passagens | 1 viagem completa (emb. 1) |
| C | 6 (vazio 4/5) | R$ 653,48 | — | nenhum |

Achados concretos:

1. **"Cat" do extrato é código do Sem Parar, não categoria ANTT.** Dividindo o valor pela tarifa
   por eixo publicada pela concessionária, bate exato: cat 3 = 3 eixos, 4 = 4, 5 = 5, 6 = 6,
   **61 = 7 eixos** (Nova Rota do Oeste: Campo Verde R$ 6,00/eixo → 18,00 / 24,00 / 30,00 / 42,00;
   Jangada R$ 8,10/eixo → 24,30 / 32,40 / 48,60 / 56,70 —
   [tarifas Nova Rota do Oeste](https://novarotadooeste.com.br/tarifas/)). Na tabela ANTT a
   "categoria 3" é automóvel com semirreboque, multiplicador 1,5
   ([resoluções ANTT de tarifa, ex. 2.935/2008](https://www.normasbrasil.com.br/norma/resolucao-2935-2008_107480.html)) —
   comparar o "Cat" do extrato com a tabela da concessionária sem traduzir dá falso positivo em tudo.
   Que 62 = 8 eixos, 63 = 9 eixos é **SUPOSIÇÃO** (padrão do 61; não achei tabela pública).
2. **A tarifa cobrada bateu com a tabela em 100% das passagens.** Inclusive o reajuste da MT-246:
   31/08 cat. 61 = R$ 76,30 (7 × 10,90) e a partir de 01/09 = R$ 79,80 (7 × 11,40), que é
   exatamente a vigência publicada ([Olhar Direto, reajuste AGER-MT a partir de 01/09/2026 00h](https://www.olhardireto.com.br/noticias/ager-autoriza-reajuste-de-459-e-pedagio-da-mt-246-passa-a-r-1140)).
   **O dinheiro desse cliente não está em "tarifa acima da tabela"; está em vale-pedágio e eixo.**
3. **Viagem carregada sem vale-pedágio.** O padrão Rosário Oeste/Tangará → Rondonópolis carregado
   (cat. 61 no sentido SUL, ~R$ 273 por viagem) aparece 6 vezes sem nenhum crédito C (A: 17/09, 25/09;
   B: 31/08, 17/09, 19/09, 23/09). Somando os trechos curtos (Nobres NORTE carregado, Itiquira etc.),
   são **R$ 2.634,10 em passagens carregadas pagas pelo próprio cliente no mês**. Se a carga era de
   terceiro, era obrigação do contratante (seção 2). Se era carga própria, não há o que cobrar —
   **pergunta nº 1 pro cliente**.
4. **Vale-pedágio parcial.** Viagem do embarcador 2 (placa A, 29/09): o VP cobriu Jangada e Santo
   Antônio; Campo Verde SUL carregado (R$ 42,00) 2 h depois saiu da conta do cliente, e o retorno
   vazio passou por Campo Verde NORTE às 19:47 — ou seja, o destino estava depois de Campo Verde.
   Se Nobres também era rota, faltam R$ 88,90 nessa viagem.
5. **Passagem dupla/impossível.** Placa A, 29/09, Nobres km 579: NORTE 09:38:16 e SUL 09:40:00,
   ambas cat. 61 (R$ 46,90 cada). 1 min 44 s com bitrem de 7 eixos. Pelo menos uma é contestável
   (ou é retorno na própria praça — **SUPOSIÇÃO**; a concessionária tem as imagens).
6. **Categoria que muda dentro do mesmo trecho vazio.** A, 14/09: Campo Verde cat 4 → Santo Antônio
   **cat 5** → Jangada cat 4 (R$ 6,00 a mais). A, 29/09: Campo Verde **cat 5** → Santo Antônio cat 4.
   C, 14/09 (Ecovias do Araguaia): Alvorada cat 5 → Aliança **cat 6** 1h37 depois (R$ 9,02).
   B, 18/09: Santo Antônio NORTE **cat 61** (R$ 42,00) no meio de um retorno vazio em cat 3 (R$ 18,00).
7. **Praça pulada.** B, 18/09: Rondonópolis NORTE 09:51 e Santo Antônio NORTE 18:33, sem Campo
   Verde (km 316, que fica entre as duas). Ou rota alternativa, ou passagem não lida (risco de
   multa de evasão — seção 4).
8. **A fatura não fecha por linha na placa B**: soma das passagens R$ 2.213,40 × "Uso" do resumo
   R$ 2.148,60 (diferença R$ 64,80) e 68 linhas × 69 usos; e há uma passagem de 28/08, fora do
   período (31/08–30/09). Na placa A, "Qtd uso" = passagens + **as duas linhas** (C e D) de cada
   par de vale-pedágio. Recado pro tag-dados: o importador nunca confia num total só.
9. **O que a fatura cobra que não é pedágio:** por placa, plano R$ 45,85 + "serviços de saúde"
   R$ 7,90 + "monitoramento débito veicular" R$ 7,90 + "gestor de débitos" R$ 3,90. O rodapé da NF
   diz que R$ 65,13 do plano são "Serviços e Produtos Digitais (Skeelo Audiobooks)". Total de
   tarifa da tag: **R$ 196,65/mês (4,2% do que passou em pedágio)**.

---

## 1. Como a tag funciona pra empresa e qual arquivo importar

| Operadora | Modelo PJ | O que o cliente consegue baixar | API |
|---|---|---|---|
| **Sem Parar Empresas** | Pré-pago (recarga, saldo debitado a cada passagem) ou pós (fatura) — [termos B2B, cl. 4.1 XIX](https://www.sempararempresas.com.br/Documents/pdf/termos_e_condicoes_b2b.pdf); recarga por Pix ([Olhar Digital](https://olhardigital.com.br/2021/02/16/pro/sem-parar-e-a-primeira-no-mercado-de-pagamento-automatico-a-adotar-o-pix/)) | Fatura/extrato mensal em **PDF** (o arquivo do cliente). No portal: *Home > Sem Parar > **Relatório de lançamentos (Excel)** ou Período personalizado (PDF e Excel)*, enviado por e-mail (resposta do Sem Parar no [Reclame Aqui](https://www.reclameaqui.com.br/sem-parar/novo-site-do-sem-parar-nao-permite-exportar-para-arquivos-em-excel_tnNkuUnHXPGWtOyL/), lida via resultado de busca — a página bloqueia leitura automática) | Não achei API pública de passagens pra PJ pequena. **SUPOSIÇÃO**: existe integração pra grandes contas/VPO (é o mesmo grupo da CTF/Fleetcor — [SETCESP](https://setcesp.org.br/noticias/solucoes-com-a-inovacao-sem-parar-empresas/)) |
| **ConectCar** | Pré-pago com recarga (Plano Total) | Portal ConectCar Empresas: relatório de passagens por placa/período/praça, exporta **XLS ou PDF** ([ajuda ConectCar](https://atendimentoconectcar.zendesk.com/hc/pt-br/articles/14621542740507-Como-consultar-o-relat%C3%B3rio-de-passagens-da-minha-frota), via resultado de busca) | "Hub de APIs" pra frotas grandes ([lp.conectcar.com/frotas](https://lp.conectcar.com/frotas), via busca) |
| **Veloe (Alelo)** | Pré/pós | Portal Minha Frota: relatórios personalizados, por centro de custo/placa/motorista ([SETCESP](https://setcesp.org.br/noticias/veloe-go-reformula-portal-minha-frota-e-garante-economia-e-reducao-de-ate-20-no-risco-de-fraudes/)) | A integração do Omie com a Veloe é por **login e senha**, captura boletos, não passagens ([Omie](https://ajuda.omie.com.br/pt-BR/articles/5324482-configurando-a-integracao-veloe-pedagio-e-estacionamento)) |
| **Move Mais** | Foco em transportador, conta única com frota própria + agregados | Extratos por unidade/centro de custo, relatórios ([SETCESP](https://setcesp.org.br/?p=25995)) | não encontrado |
| **C6 Tag** | Grátis pra PJ | — | **Só categoria 1 (passeio): não serve pra caminhão** ([C6](https://www.c6bank.com.br/blog/c6-tag-veiculos-da-empresa), via busca) |

Regras do Sem Parar que mudam o desenho ([termos B2B](https://www.sempararempresas.com.br/Documents/pdf/termos_e_condicoes_b2b.pdf), out/2020):
- **Autoatendimento só mostra os últimos 90 dias** de transações (cl. 5 V). Quem não baixa todo mês perde o histórico.
- **Contestar em 90 dias**: da data de vencimento da fatura (cl. 4.1 XVI — "passado o prazo… reputar-se-ão aceitas") e da data da passagem (cl. 8.3).
- **A categoria cobrada é a que a concessionária constatou** (cl. 8.2). O Sem Parar só repassa; a contestação de categoria vai pra concessionária, que tem foto e sensor ([Portal do Trânsito](https://www.portaldotransito.com.br/noticias/mobilidade-e-tecnologia/transporte-de-carga/transportadoras-podem-pedir-revisao-de-valores-pagos-nos-postos-de-pedagio/)).
- **Duas tags no mesmo veículo = débito em duplicidade por conta do cliente** (cl. 4.1 XV). Caminhão de agregado com tag própria + tag de VP é o caso clássico (**SUPOSIÇÃO** quanto à frequência).

**Melhor caminho pra importar:** o **Excel do "Relatório de lançamentos"** do portal Sem Parar
Empresas como formato preferido (linha por transação, sem quebra de página, sem as linhas de
embarcador quebradas em duas). O **PDF da fatura** como alternativa garantida — é o que o cliente
já tem, o texto sai limpo com `pdftotext -layout`, e é o único que traz recargas, plano e NF.
**SUPOSIÇÃO**: que o Excel traga as colunas de vale-pedágio (embarcador, nº viagem) — não vi um
arquivo; pedir um ao cliente antes de desenhar o parser.

---

## 2. Vale-pedágio obrigatório (VPO)

**Quem paga.** O pedágio de veículo de carga é responsabilidade do **embarcador** (dono da carga
que contrata o frete), equiparado a ele quem contrata sem ser dono da carga e **a transportadora
que subcontrata** ([Lei 10.209/2001, art. 1º §§1–3](https://www.planalto.gov.br/ccivil_03/leis/leis_2001/l10209.htm)).
A [Resolução ANTT 6.024/2023](https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirTextoAto&link=S&tipo=RES&numeroAto=00006024&seqAto=000&valorAno=2023&orgao=DG%2FANTT%2FMT&cod_modulo=161&cod_menu=7796)
(vigente desde 01/09/2023) repete: "embarcador equiparado: … ou a empresa transportadora que
subcontratar serviço de transporte rodoviário de carga" (art. 2º VII).

**Quanto e quando.** Antecipado **até o embarque**, "no valor necessário à livre circulação entre
a sua origem e o destino, considerando **todas as praças** de pedágio existentes na rota da viagem
contratada e as tarifas correspondentes à **categoria do veículo**" (Res. 6.024, art. 4º §1 e art. 7º I).
Vedado em espécie (§2). Vazio por disposição contratual também tem direito (§6). Eixo suspenso
vazio é isento (§5). Mudança de rota por força maior: diferença acertada no fim da viagem (§7).
Desde 2025 o único meio aceito é **tag** — cartão e cupom acabaram
([ANTT, 27/12/2024](https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias/antt-moderniza-pagamento-do-vale-pedagio-obrigatorio-a-partir-de-2025)).

**Não pode vir dentro do frete.** O valor do VPO "não integra o valor do frete" e vai destacado no
documento de transporte ([Lei 10.209, art. 2º](https://www.planalto.gov.br/ccivil_03/leis/leis_2001/l10209.htm)).
Em jun/2026 a 3ª Turma do STJ decidiu que **nem por acordo entre as partes** o VPO pode ser
embutido no frete; o caso voltou ao TJ-SP pra apurar "a comprovação do percurso realizado, a
existência das praças de pedágio na rota contratada e os valores efetivamente suportados pelo
transportador" ([informe FIEC 20/2026](https://arquivos.sfiec.org.br/sfiec/files/files/IJ020_2026-STJ-VALEPEDAGIOEOVALORDOFRETE-THAIS-CLARA.pdf),
citando [ConJur, 07/06/2026](https://www.conjur.com.br/2026-jun-07/acordo-entre-empresas-nao-permite-embutir-vale-pedagio-no-valor-do-frete/)).
**É exatamente a prova que a conciliação produz** (rastro da viagem + praças + o que a tag cobrou).

**Penalidades.**
- Contratante que não antecipa: **R$ 3.000 por veículo e por viagem** (Res. 6.024, art. 23 I). O portal da ANTT ainda fala em R$ 550 da norma antiga ([ANTT VPO](https://portal.antt.gov.br/en/vpo)) — vale a resolução.
- Indenização ao transportador de **duas vezes o valor do frete** ([Lei 10.209, art. 8º](https://www.planalto.gov.br/ccivil_03/leis/leis_2001/l10209.htm)), constitucional pela [ADI 6031](https://www.coad.com.br/home/noticias-detalhe/90110/constitucionalidade-do-vale-pedagio-obrigatorio-e-questionada-no-stf) (julgada em 27/03/2020, segundo resultado de busca).
- **Prescreve em 12 meses** contados da data do transporte (art. 8º, parágrafo único, incluído pela Lei 14.229/2021). **Todo mês que passa, um mês de crédito vence.**
- Denúncia: Ouvidoria ANTT, telefone 166 ([ANTT VPO](https://portal.antt.gov.br/en/vpo)).

**Como aparece no extrato** (fatura real): bloco "Detalhamento das Passagens Vale Pedágio" com
**par de linhas** — crédito C (sem concessionária, com embarcador) e débito D (com concessionária),
mesma data/hora/praça/categoria/nº de viagem; "Total de Vale Pedágio" = 0,00 quando cobre tudo.
Passagem não coberta cai no bloco comum de pedágio, **sem nº de viagem** — é por isso que
"viagem carregada sem VP" só aparece cruzando com a viagem do Movatruck.

**CIOT.** Desde 24/05/2026 o CIOT vinculado ao MDF-e é obrigatório em todas as operações de
transporte remunerado ([Res. ANTT 6.078/2026, via Inventti](https://inventti.com.br/resolucao-antt-no-6-078-2026-obrigatoriedade-do-ciot-e-ampliada-e-exige-rapida-adaptacao-das-transportadoras/)),
e o VPO é informado no CIOT ([Contmatic](https://simplifique.contmatic.com.br/blogs/ciot-o-que-e-para-que-serve-quem-precisa-emitir-2026);
[Transp.net](https://www.transp.net/blog/posts/resolucoes-antt-6077-6078-regulamentacao-mp-1343/) — fontes secundárias).
ETC com **até 3 veículos é equiparada a TAC** ([Lei 11.442, via resultado de busca](https://www2.camara.leg.br/legin/fed/lei/2007/lei-11442-5-janeiro-2007-549026-normaatualizada-pl.pdf)) —
o cliente tem 3 caminhões, então provavelmente é TAC-equiparado e o CIOT é emitido pelo contratante
(**SUPOSIÇÃO** até ver o RNTRC dele). Consequência prática: **o CIOT de cada viagem traz o valor do
VPO que o contratante declarou** — é o "esperado" contra o qual o extrato confere.

**O que o transportador deve conferir:** (a) toda viagem de terceiro tem VP; (b) o VP cobre todas
as praças da rota até o destino, na categoria certa (carregado = todos os eixos); (c) o valor
declarado no CIOT/MDF-e = o crédito que apareceu no extrato.

**Risco do outro lado (aviso, não conferência):** o cliente subcontrata ~70% do que roda. Quando ele
subcontrata, **ele é o equiparado** e deve VPO ao subcontratado — R$ 3.000/veículo/viagem se não
der (Res. 6.024, art. 2º VII e 23 I).

---

## 3. Categorias e eixo suspenso

- **Lei:** "veículos de transporte de cargas que circularem vazios ficarão isentos da cobrança de
  pedágio sobre os eixos que mantiverem suspensos", em qualquer via, inclusive concedida
  ([Lei 13.103/2015, art. 17, red. Lei 13.711/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13103.htm)).
  Eixo suspenso indevidamente (carregado) é infração (art. 17 §5).
- **MDF-e aberto derruba a isenção.** Nas concessões federais, a câmera lê a placa e consulta a
  SEFAZ; havendo MDF-e aberto, cobra **todos os eixos**, tocando o chão ou não. O transportador
  tem que **encerrar o MDF-e** ao descarregar ([ANTT, ago/2023](https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias/concessionarias-passam-a-cobrar-tarifa-pela-totalidade-dos-eixos-de-veiculos-com-carga)
  — lista Ecovias do Araguaia, por onde a placa C passou). Se a Nova Rota do Oeste e a Via Brasil
  MT-246 fazem a mesma consulta: **SUPOSIÇÃO** (não achei). No extrato, os retornos vazios na
  Nova Rota saem em 3/4 eixos, então ali o suspenso está sendo respeitado na maioria.
- **Por que a mesma placa aparece em 3, 4, 5, 6 e 61:** (1) carregado × vazio com eixos erguidos —
  normal; (2) motorista não ergueu todos os eixos (A vazio roda em 4, B vazio roda em 3 — mesmo
  porte; **pergunta pro cliente** se A pode rodar em 3); (3) leitura errada do sensor/OCR da praça;
  (4) MDF-e não encerrado.
- **Como provar:** o transportador aponta a passagem (data/hora/praça/sentido); a prova de eixos
  é da concessionária (foto + sensor de pista — [Portal do Trânsito](https://www.portaldotransito.com.br/noticias/mobilidade-e-tecnologia/transporte-de-carga/transportadoras-podem-pedir-revisao-de-valores-pagos-nos-postos-de-pedagio/)).
  O que o Movatruck soma: a viagem já estava encerrada (descarga registrada, peso, ticket), e o
  par de praças vizinhas no mesmo trecho com categoria menor. TJ-PR já condenou operadora de tag a
  reembolsar por cobrança "desproporcional ao número de eixos", com o argumento de que bastava
  "simples conferência cadastral" ([Migalhas, proc. 0011539-75.2016.8.16.0035](https://www.migalhas.com.br/quentes/316087/empresa-de-pagamento-automatico-de-pedagio-deve-reembolsar-transportadora)) —
  restituição simples, não em dobro.

---

## 4. Cobranças indevidas típicas e como contestar

| Tipo | Como se reconhece no extrato | Visto na fatura real? |
|---|---|---|
| Dupla leitura | Mesma placa, mesma praça, intervalo de minutos (mesmo sentido ou sentidos opostos) | Sim — Nobres 29/09 (seção 0, item 5) |
| Categoria acima do real | Categoria diferente entre praças vizinhas do mesmo trecho; cheia no retorno vazio | Sim — 4 casos, R$ 6 a R$ 24 cada |
| Praça fora da rota / sequência impossível | Praça que não está entre origem e destino da viagem; praça pulada no corredor | Sim — praça pulada em B 18/09 |
| Tarifa acima da tabela | Valor ≠ tarifa/eixo × eixos na data | **Não** — 100% bateu |
| Tag na placa errada | Passagem sem viagem do caminhão naquele dia; caminhão parado com passagem | Não dá pra saber sem as viagens |
| Duas tags no veículo | Duas passagens idênticas em operadoras diferentes | Fora do extrato de uma operadora só |
| Passagem fora do período da fatura | Data anterior ao início do período | Sim — B, 28/08 |

**Contestar no Sem Parar:**
- Canal: Central de Relacionamento **4002 1552** (capitais) / **0800 015 0252**; acompanhamento
  em *Minha Conta > Consultar protocolo* ([ajuda Sem Parar — cobrança duplicada](https://ajuda.semparar.com.br/hc/pt-br/articles/360046993892-O-que-devo-fazer-quando-recebo-uma-cobran%C3%A7a-de-ped%C3%A1gio-duplicada)
  e [cobrança indevida](https://ajuda.semparar.com.br/hc/pt-br/articles/360046993252-Recebi-uma-cobran%C3%A7a-indevida-O-que-devo-fazer), via resultado de busca).
- Duplicidade "o sistema estorna automaticamente" e aparece em **"Outros Créditos"** na fatura
  seguinte (mesma fonte) — **logo, a conferência precisa ler o mês seguinte antes de reclamar**.
- Análise em **até 5 dias úteis**; aprovado, abate da fatura (respostas do Sem Parar no
  [Reclame Aqui](https://www.reclameaqui.com.br/sem-parar/contestacao-de-cobranca-indevida_V2MTyn9zY5DIIP0b/), via busca).
- Prazo contratual: **90 dias** (seção 1).
- O Sem Parar se diz só intermediário, sem autonomia pra mudar valor ou cancelar cobrança da
  concessionária (respostas no Reclame Aqui, via busca) — categoria vai pra concessionária.
- Passagem não lida não é vantagem: vira evasão (CTB art. 209-A, infração grave, R$ 195,23 e
  5 pontos) se não regularizada no prazo (respostas no [Reclame Aqui](https://www.reclameaqui.com.br/sem-parar/cobranca-indevida-e-nao-registro-de-pedagio-risco-de-multa-indevida_rcnYcy07gfjc1lFr/), via busca).

**Quanto costuma ser recuperado:** **não achei número público** sobre pedágio. Há empresas que
vendem auditoria de pedágio com análise grátis, sem divulgar taxa de recuperação
([Extratos Fácil](https://extratosfacil.com/); [Portal do Trânsito](https://www.portaldotransito.com.br/noticias/mobilidade-e-tecnologia/transporte-de-carga/transportadoras-podem-pedir-revisao-de-valores-pagos-nos-postos-de-pedagio/)
cita a Via Brasil Sistemas). O "3–7%" que circula é de **auditoria de frete**, não de pedágio
([Simfrete](https://www.simfrete.com.br/blog/auditoria-de-faturas-de-frete-como-encontrar-divergencias-entre-contrato-cotacao-e-cobranca)) — não usar.
O que dá pra afirmar com dado próprio: na fatura do cliente, cobrança indevida de praça soma
**dezenas de reais no mês** (~R$ 90–140 nos casos da seção 0); **vale-pedágio faltando soma
milhares** (até R$ 2.634,10 no mês, a depender de quantas dessas viagens eram de terceiro).

---

## 5. Mercado: quem faz o quê

| Quem | O que faz de pedágio/VP | Concilia extrato da tag × viagem? | Preço |
|---|---|---|---|
| **Sem Parar Empresas** | Tag, VPO (tag/voucher/cartão), frete, combustível; diz ter ~80% do mercado ([SETCESP](https://setcesp.org.br/noticias/solucoes-com-a-inovacao-sem-parar-empresas/)) | Relatório por placa/período; não confere contra rota | Plano por placa (na fatura do cliente: R$ 61,65 + R$ 3,90) |
| **Repom (Edenred)** | Gestão de VP com roteirizador, relatórios de status de VP, cancelamento, quitação e créditos/débitos ([release Repom](https://www.edenred.com.br/wp-content/uploads/2022/02/20210820_Release_Repom_GestaoValePedagio_RevCom_VFINAL.docx.pdf)) | Do lado de **quem paga** o VP (embarcador) | não público |
| **Pamcard (Roadcard)** | VP por tag e "Pamcard na Placa" (OCR de placa) ([SETCESP](https://setcesp.org.br/noticias/roadcard-realiza-1a-viagem-do-pais-com-pagamento-de-vale-pedagio-por-leitura-de-placa/)) | Embarcador | não público |
| **eFrete / NDD / Target** | CIOT + PEF + VP (o Bsoft integra com a eFrete pra CIOT — [Bsoft](https://bsoft.com.br/blog/o-que-e-ciot-como-emitir-e-quando-deve-ser-usado?amp;)) | Embarcador/contratante | não público |
| **Bsoft TMS** | CIOT via eFrete; conciliação **bancária** por OFX ([Bsoft](https://bsoft.com.br/produtos/bsoft-tms)) | Não achei conciliação de tag | não público |
| **Lincros** | Roteirizador manda valor do pedágio pro TMS como taxa ([Lincros](https://intercom.help/ajudalincros/pt-BR/articles/13438599-routing-integracao-do-valor-do-pedagio-ao-tms-como-taxa-adicional)) | Não (é cálculo previsto) | não público |
| **Veloe Go** | Portal Minha Frota, relatórios, rota do motorista, passagens ([SETCESP](https://setcesp.org.br/noticias/veloe-go-reformula-portal-minha-frota-e-garante-economia-e-reducao-de-ate-20-no-risco-de-fraudes/)) | Só dentro da Veloe | não público |
| **Rota (Rotacard)** | Gestão de tags integrada, data/hora/local/sentido ([Rota](https://www.rotagestaodefrota.com.br/gestao-de-pedagios/)) | Não diz | não público |
| **Extratos Fácil / auditorias** | "Auditoria completa" de pedágios e recuperação ([site](https://extratosfacil.com/)) | É o produto deles, como serviço | sob consulta (**SUPOSIÇÃO**: % do recuperado) |
| **Infleet, Cobli, Rodosis** | Não achei conciliação de tag nem de VP publicada | — | — |

**Leitura:** o mercado de VP é todo **do lado de quem paga** (embarcador emite, roteiriza, presta
contas). **Do lado de quem recebe** — agregado/TAC-equiparado conferindo se o VP veio e cobriu a
rota — não achei produto; quem faz é auditoria terceirizada ou planilha (**SUPOSIÇÃO** apoiada na
ausência). É o buraco onde o Movatruck entra, porque já tem a viagem (cliente, origem, destino,
rota, rastro) que nenhum extrato de tag tem.

---

## 6. Tarifas públicas do MT — dá pra usar como tabela de referência?

| Concessão | Regulador | Fonte oficial | Formato |
|---|---|---|---|
| **Nova Rota do Oeste** (BR-163/364, 9 praças) | ANTT (federal) | [novarotadooeste.com.br/tarifas](https://novarotadooeste.com.br/tarifas/) — tarifa por eixo comercial por praça (Itiquira 6,60; Rondonópolis 7,50; Campo Verde 6,00; Sto Antônio 6,00; Jangada 8,10; Diamantino/Nobres 6,70; Nova Mutum 5,40; Lucas 7,10; Sorriso 10,40). Revisão: [Deliberação ANTT 292/2025](https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias/antt-aprova-revisao-extraordinaria-de-pedagio-da-nova-rota-do-oeste-garantindo-equilibrio-contratual-e-investimentos-estrategicos), vigência 21/09/2025 | HTML |
| **Via Brasil MT-246** | **AGER-MT** (estadual) | Diário Oficial de MT; tarifa básica R$ 11,40 desde 01/09/2026, 7 eixos R$ 79,80 ([Olhar Direto](https://www.olhardireto.com.br/noticias/ager-autoriza-reajuste-de-459-e-pedagio-da-mt-246-passa-a-r-1140)) | Notícia/DOE |
| **Via Brasil BR-163** (Cláudia, Guarantã) | ANTT | [dados.antt.gov.br — praças](https://dados.antt.gov.br/dataset/praca-de-pedagio) | CSV |
| **Ecovias do Araguaia** (BR-153 TO/GO) | ANTT | idem | CSV |

- A ANTT publica em **dados abertos** o cadastro de praças federais **com latitude/longitude, km e
  sentido** ([CSV de praças](https://dados.antt.gov.br/dataset/praca-de-pedagio)) — as 9 da Nova
  Rota do Oeste estão lá. **Tarifa não está em CSV**: só num painel interativo
  ([Agência iNFRA, 08/05/2026](https://agenciainfra.com/blog/antt-reestrutura-portal-de-rodovias-e-amplia-acesso-a-dados-e-paineis/)).
- Rodovia **estadual** (MT-246) não aparece na ANTT. "ARSEC" é a agência do MS; em MT é a **AGER-MT**.
- A ANTT também publica o agregado mensal de VPO (nº e valor por categoria de transportador)
  ([CSV VPO](https://dados.antt.gov.br/dataset/vale-pedagio-obrigatorio)) — inútil pra conferir
  viagem, útil pra marketing.
- **Recomendação:** não manter tabela de tarifa à mão. A tarifa por eixo de cada praça sai do
  **próprio extrato** (valor ÷ eixos) e muda só em data de reajuste; o cadastro de praças com GPS
  sai do CSV da ANTT (federais) e do `PedagioRodovia` que o Movatruck já tem (estaduais).

---

## 7. As 6 conferências que mais valem dinheiro pro cliente

Em ordem de R$ esperado. Cada uma diz o que compara e de onde vem o "esperado".

1. **Viagem de terceiro carregada sem vale-pedágio.** Passagem carregada (categoria cheia, no
   sentido da carga, entre carregamento e descarga de uma viagem do Movatruck com cliente ≠ a própria
   empresa) que não tem par C/D. Esperado: todas as praças da rota na categoria cheia. **Até R$ 2,6 mil
   num mês desse cliente.** Prova pronta pro que o STJ exige; prescreve em 12 meses.
2. **Vale-pedágio que não cobriu a rota inteira.** Viagem com VP (nº de viagem do embarcador) em que
   praças da mesma viagem, entre a 1ª e a última coberta ou até o destino, saíram da conta do cliente;
   ou VP em categoria menor que a cobrada. Visto: R$ 42–88,90 numa viagem. Conversa com o embarcador,
   não com o Sem Parar.
3. **Categoria cheia no retorno vazio / categoria que muda no mesmo trecho.** Depois da descarga
   (viagem encerrada), passagem com mais eixos que a vizinha do mesmo trecho, ou cheia. Recupera via
   contestação (R$ 6–24 por passagem aqui) e, mais importante, aponta o motorista que não ergue eixo
   e o **MDF-e que ficou aberto** — esse é o vazamento recorrente.
4. **Passagem dupla ou impossível.** Mesma praça em poucos minutos (qualquer sentido), ou sequência
   que pula praça do corredor / volta no tempo. Contestável em 90 dias; a praça pulada é risco de
   multa de evasão, avisar antes de virar auto.
5. **Pedágio que o motorista lançou e a tag já pagou (ou o VP cobriu).** É o pedágio em dobro do
   acerto (`Pedagio.valor` / `Viagem.valorPedagioTotal` × extrato): reembolso pago ao motorista por
   passagem que saiu da conta da tag. Hoje o motorista lança à mão — esse cruzamento é dinheiro saindo
   todo mês sem ninguém ver. (**SUPOSIÇÃO** quanto ao volume: depende de quem roda com tag.)
6. **O que a fatura cobra que não é pedágio.** Plano + saúde + monitoramento + gestor de débitos +
   audiobook = R$ 196,65/mês nas 3 placas, dos quais ~R$ 124 são serviços agregados. Conferência de
   uma vez (e alerta se aparecer serviço novo), não mensal. Se dá pra tirar sem trocar de plano:
   **SUPOSIÇÃO** — perguntar ao Sem Parar.

## As 3 que parecem boas e não valem agora

1. **Tarifa cobrada × tabela oficial da concessionária.** Bateu em 100% das 119 passagens, inclusive
   no dia do reajuste. A tag cobra o que a concessionária manda; o erro está no eixo, não no preço.
   Manter tabela de MT-246 à mão (não tem dado aberto) é custo sem retorno.
2. **Integração automática (API) com Sem Parar/ConectCar.** Não há API pública de passagens pra PJ
   pequena; com 3 caminhões, subir o Excel/PDF uma vez por mês resolve — e é o que respeita a janela
   de 90 dias.
3. **Provar eixo suspenso com GPS/foto do app.** A prova de eixo é foto e sensor da concessionária;
   o Movatruck só precisa apontar a passagem e mostrar que a viagem já tinha encerrado. Pedir foto de
   eixo ao motorista em cada praça é carga de trabalho pra um parceiro autônomo sem ganho de prova.

---

## 8. Perguntas pro cliente (antes de desenhar)

1. Das viagens Rosário/Tangará → Rondonópolis de setembro, quais eram carga de terceiro e de quem?
   (decide se os R$ 2,6 mil são crédito ou carga própria)
2. Ele é ETC com até 3 veículos no RNTRC (TAC-equiparado)? Quem emite o CIOT das viagens dele?
3. Nas viagens que ele subcontrata, quem dá o VPO ao subcontratado — ele ou o embarcador direto?
4. Consegue baixar o "Relatório de lançamentos (Excel)" do portal? Mandar um mês junto com o PDF.
5. A placa A pode rodar vazia em 3 eixos como a B? (se sim, cada praça vazia em 4 é 1 eixo a mais)
6. Quem encerra o MDF-e depois da descarga, e quando?
