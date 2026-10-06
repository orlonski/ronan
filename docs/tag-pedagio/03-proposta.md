# 03 — Proposta: conferência da tag de pedágio (tag-produto, 06/10/2026)

> **Revisada com 04-qa** (06/10/2026). Mudou: leitor com 6 checagens obrigatórias e zero placas =
> FALHOU (B1); cada passagem num só balde, com regra de precedência (B2); vale-pedágio contado e
> perguntado **por viagem**, "até R$ 2.399,60 em 15 viagens" (I1); 4ª resposta "o contratante pagou
> de outro jeito" (I2); chaves entre faturas sem acusação falsa (I3); CNPJ da fatura × conta e
> veículo de terceiro (I4); guarda do PDF e permissões próprias, nomes de embarcador anonimizados
> (I5); eixos do cavalo × composição (I6); modelo próprio pra conferir o pedágio do motorista, com as
> três fontes (I7); praça pulada não valida reembolso (I8); a 3ª saída que lê o pedágio digitado
> (planilha de fechamento). E o requisito do dono: **cruzamento automático passagem × viagem** no
> centro da Onda 1.

Base: `01-campo.md`, `02-dados.md`, `04-qa.md`, e `05-prova-cruzamento.md` quando sair. Placas
são A, B, C; embarcadores são EMB-1 e EMB-2; nenhum nome de contratante neste documento.

---

## Parte 1 — Para o dono (sem jargão)

### Em uma frase

**O escritório sobe a fatura do Sem Parar uma vez por mês; o Movatruck liga sozinho cada passagem à
viagem certa e mostra, em reais, o vale-pedágio que o contratante deixou de dar, o que dá pra
contestar antes do prazo e quanto cada caminhão gastou de pedágio de verdade.**

### Em um parágrafo

Hoje a fatura do Sem Parar chega, alguém olha o total, paga e arquiva: são 7 páginas e mais de cem
passagens por mês, ninguém confere uma por uma. Com a conferência, a pessoa do escritório arrasta o
PDF pra tela e o sistema faz o trabalho chato sozinho: junta as passagens de cada caminhão em
viagens e liga cada uma à viagem que o motorista lançou — só liga sozinho quando não há dúvida; quando
há, mostra a sugestão com o motivo ("as 3 praças da rota, na ordem, no mesmo dia") e a pessoa aceita
várias de uma vez. O que sobra aparece numa tela por dia e por caminhão, onde ligar à mão é um clique.
Pronto o cruzamento, a tela abre pelo dinheiro: **viagens carregadas que pagaram pedágio do próprio
bolso sem o vale que o contratante é obrigado a dar** — em setembro, até **R$ 2,4 mil em 15
viagens**, dos quais R$ 2,0 mil em 7 viagens longas. Pra cada uma, uma pergunta: "essa carga era de
quem?". Respondido, sai um relatório por contratante com data, hora, praça e valor — o papel pra
conversa. Abaixo vêm as passagens pra conferir antes do prazo (dezenas de reais), o caminhão que
pagou pedágio sem viagem lançada (frete que talvez não foi cobrado) e o que vale uma conversa com o
motorista. O dono passa a ver o pedágio real de cada caminhão no lucro por caminhão.

### Onde está o dinheiro (com o arquivo dele, setembro)

Cada passagem conta **uma vez só** (regra na Parte 3, B2).

| Caixa | O que é | Setembro | Força |
|---|---|---|---|
| Pode ser seu | Viagem carregada sem vale-pedágio | **até R$ 2.399,60 em 15 viagens** (R$ 1.976,80 em 7 viagens longas; R$ 281,40 em 6 subidas curtas, provável carga própria) | só vira dinheiro quando o escritório confirma "de terceiro, sem vale" |
| Pode ser seu | Vale que cobriu só parte da viagem (EMB-2, placa A, 29/09) | R$ 42,00 provável | provável |
| Pra conferir | Mesma praça nos dois sentidos em 1 min 44 s (A, 29/09) | R$ 46,90 | conferir: ou foi retorno na praça (cobrança certa) ou leitura dupla — nunca as duas |
| Pra conferir | Diferença entre o resumo e o detalhe da fatura (placa B) | R$ 64,80 a favor dele, sem explicação | conferir |
| Pra conferir | Caminhão pagou pedágio sem viagem lançada | depende das viagens dele (`05`) | frete possivelmente não faturado |
| Pra conversar | Eixo que sobe e desce no mesmo trecho vazio | R$ 6 a R$ 9 por caso | conversa, não contestação |
| Pra conversar | Placa A volta vazia com 4 eixos, a B com 3 | R$ 202/mês **se** forem a mesma composição | pergunta pro cliente antes de virar número |
| Pra conversar | O que a fatura cobra que não é pedágio (plano, "saúde", audiobook…) | R$ 196,65/mês, ~R$ 124 em serviços | uma vez |

**A tarifa bateu com a tabela publicada** em todas as passagens da Nova Rota do Oeste e da MT-246
(na Ecovias só foi possível conferir coerência interna). Por isso a funcionalidade não vende "acha
erro do Sem Parar": vende **"cobra o vale-pedágio que te devem e mostra o pedágio real de cada
caminhão"**. O vale prescreve em 12 meses: cada mês sem conferir é um mês de crédito que vence.

### O que muda pro motorista

Nada na 1ª onda. Na 2ª, só nas empresas que contratarem: no caminhão com tag o botão de pedágio
continua lá, com a frase "a tag não passou? lance o que você pagou do bolso". Nenhum valor dele é
apagado nem descontado sem uma pessoa do escritório decidir.

---

## Parte 2 — As ondas (cada uma vai pro ar sozinha)

### Onda 1 — Raio-x da fatura com cruzamento automático (só painel)

Objetivo: o cliente sobe **o PDF dele**, o sistema liga as passagens às viagens dele sem trabalho, e
a primeira tela mostra o dinheiro de setembro. Não mexe no app, no acerto nem na fatura.

**1.1 Ler a fatura sem errar calado (B1).** Leitor do PDF com o `pdf-parse` que já está na API. Só
devolve **LIDO** se as 6 checagens passarem; qualquer falha é **FALHOU** (nada grava) ou **LIDO COM
DIVERGÊNCIA** (grava e mostra a linha crua e a checagem que não fechou):
1. Cabeçalho reconhecido: "SEM PARAR", nº da fatura, período e CNPJ presentes. Sem nº da fatura = FALHOU.
2. Nº de registros com data+hora no texto cru = passagens + linhas de vale lidas (143 = 119 + 24).
3. Placas do Resumo = blocos de placa lidos, cada uma uma vez só.
4. Por placa: soma = "Total de Pedágio"; líquido do vale = "Total de Vale"; nº de linhas × "Qtd Uso"
   com a diferença dita, nunca engolida.
5. Σ uso do resumo = "Passagens" da nota; uso + planos + outras = total da nota.
6. Linha de vale que não fecha registro vai pra "não lidas"; nunca é sobrescrita pela seguinte.

**Zero placas é sempre FALHOU.** Os 6 testes de mutação do `04-qa` (outra operadora, vale sem D/C,
resumo em formato novo, placa com hífen, título mudado, ano com 4 dígitos) entram como testes do leitor.

**1.2 A fatura é desta empresa? (I4).** A raiz do CNPJ (8 dígitos) da fatura é comparada com a da
conta; diferente pede confirmação explícita mostrando o nome lido. Placa sem cadastro vai pra uma
lista ("placas da fatura sem caminhão"); o sistema não cria caminhão. Placa de **veículo de terceiro**
no cadastro vai pra lista própria e não entra no lucro por caminhão.

**1.3 Importar de novo sem acusar ninguém (I3).**
- Mesmo arquivo (hash) ou mesma fatura re-baixada (nº da fatura): "já importado em …", nada grava.
- A passagem é única **dentro do documento** (`extratoId + chave`, com ordinal pra a mesma passagem
  cobrada duas vezes no arquivo); entre documentos, a chave só serve pra comparar.
- "Cobrada em outra fatura" só entre **duas faturas** de períodos que não se sobrepõem. Relatório de
  período ou Excel do portal **enriquecem**, nunca geram esse achado.
- Decisão tomada se ancora na **passagem-âncora** (a 1ª da viagem inferida), não no conjunto; quando o
  mês vizinho entra e a viagem cresce, a decisão segue valendo.

**1.4 Cruzamento automático passagem × viagem (requisito do dono).** O motor, do mais forte ao mais fraco:

1. **Praça do extrato → praça do mapa, aprendida uma vez.** Chave da praça = rodovia + km
   ("BR364|579100"). Candidatos no cadastro de praças (`PedagioRodovia`) pela rodovia e a 40 km da
   cidade; UF vem da concessionária. Um candidato só e as conferências batendo (tarifa observada,
   distância entre praças vizinhas pelo OSRM) = casa sozinho. Senão, fila "praças a confirmar" com
   mapa. A confirmação **global** (vale pra todas as empresas) é da equipe Movatruck; a empresa só
   confirma pra ela mesma (M6). As 13 praças do arquivo do cliente a gente confirma **antes** de ele
   subir o arquivo. Praça que não existe no cadastro é criada a partir do CSV da ANTT (federais) ou
   do ponto marcado no mapa, com a tarifa por eixo observada.
2. **Viagens inferidas por placa.** As passagens de cada placa viram uma linha do tempo (passagens da
   tag + débitos do vale, que são o caminhão passando também). Corta onde muda de carregado pra vazio
   ou onde há buraco de mais de 8 h; atravessa meia-noite e troca de rodovia sem cortar (B 31/08
   19:00 → 01/09 00:42 é uma viagem só). Cada viagem inferida tem sentido, praças em ordem, eixos e se
   tem vale.
3. **Candidatas.** Viagens lançadas no Movatruck do **mesmo caminhão**, no dia, com a madrugada
   seguinte e o dia anterior. Fuso padrão pela UF da concessionária (MT −4, TO −3), folga de 90 min,
   calibrado pela primeira viagem com GPS (M2).
4. **Pontuação** de cada par (viagem inferida, viagem lançada), cada fator com peso e texto:
   - **praças da rota**: quantas das praças que a rota da viagem atravessa (`pedagiosDaViagem`)
     aparecem nas passagens, e quantas passagens caem fora da rota;
   - **ordem e sentido**: as praças foram passadas na ordem origem → destino da rota (posição ao
     longo do traçado), com o sentido coerente;
   - **janela**: horário dentro de início/eventos de carga e descarga da viagem guiada; ponto de GPS
     da viagem a menos de 2 km da praça e ±10 min é praticamente certeza;
   - **eixos**: carregado na ida, vazio na volta, coerente com a viagem;
   - **km**: distância entre a 1ª e a última praça compatível com o km da viagem.
5. **Liga sozinho só com folga.** Pontuação acima do limiar **e** distância grande pra 2ª candidata
   **e** nenhuma regra dura violada (outro caminhão, fora da janela, sentido contrário). Critério de
   aceite: **zero ligação automática errada** na prova (`05-prova-cruzamento.md`); o limiar é
   calibrado pra precisão total, e o que fica em dúvida vira sugestão. Toda ligação guarda como foi
   feita (automática, sugestão aceita, manual), o motivo em texto e quem desfez.
6. **Sugestão com motivo e aceitar em lote.** "3 de 3 praças da rota, na ordem, mesmo dia, carregado
   na ida": um botão "aceitar estas N sugestões" por dia, por caminhão ou da fatura inteira.
7. **Tela por dia e por caminhão.** Linha do tempo com as viagens lançadas de um lado e as passagens
   do outro; ligar à mão é clicar na passagem (ou na viagem inferida inteira) e na viagem; desfazer
   é um clique. Nada de formulário.
8. **Retorno vazio.** Passagens vazias depois da descarga, no caminho de volta, ligam à **mesma
   viagem** como "retorno" — custo da viagem, não passagem órfã.
9. **Viagem com praça na rota sem passagem.** Aparece como "praça esperada que não passou": a tag não
   leu (risco de multa de evasão), o motorista pagou em dinheiro, ou fez outro caminho. Não é achado
   contra ninguém; é o que explica um lançamento manual na Onda 2.
10. **Passagem sem viagem.** O caminhão rodou e pagou pedágio sem viagem lançada: frete que pode não
    ter sido faturado, ou uso fora do serviço. Caixa "Pra conferir", com o valor em jogo.

Os números de quanto liga sozinho, quanto vira sugestão e quanto sobra saem do `05`.

**1.5 Uma passagem, um balde (B2).** Cada passagem pertence a **uma** hipótese aberta por vez, e
nenhum total da tela soma a mesma passagem duas vezes (teste obrigatório). Precedência:
1. **Fato do documento**: par de vale, fora do período, ajuste não detalhado.
2. **Vale da viagem**: viagem inferida **com** vale nunca entra em "carregado sem vale". Vale
   incompleto só entre a 1ª praça coberta e o destino; praça **antes** da 1ª coberta é "conferir a
   origem", nunca "provável".
3. **Carregado sem vale**: viagem inferida inteira, sem nenhum vale.
4. **Praça**: duplicidade, sentidos opostos, praça pulada.
5. **Eixo e conversa**.

Quando duas hipóteses querem a mesma passagem e se excluem, viram **um achado só**, "explicações
possíveis: A ou B", com o valor contado uma vez, e a pessoa escolhe. O caso da A em 29/09 (Nobres nos
dois sentidos × vale incompleto) é exatamente isso.

**1.6 "Essa carga era de quem?" — por viagem (I1, I2).** Pergunta feita **uma vez por viagem
inferida** carregada sem vale (não por trecho), já com a resposta sugerida pela viagem ligada no
1.4. Quatro respostas:
1. **Um cliente do cadastro** (de terceiro, sem vale) → entra no relatório daquele contratante;
2. **Carga minha** → sai da conta (o cliente pode ser marcado "carga própria" no cadastro e não
   pergunta mais);
3. **O contratante pagou o pedágio de outro jeito** (outra operadora, vale "na placa", junto do
   adiantamento) → campo pro comprovante/CIOT. Se foi por outra tag, a passagem da Sem Parar vira
   suspeita de **cobrança em duas tags** (contestar no Sem Parar), não dívida do contratante;
4. **Não sei** → fica aberta, com o prazo de prescrição contando.

O relatório por contratante só traz viagem **confirmada por gente** como "de terceiro, sem vale". O
nome do embarcador que vem no vale (truncado pela operadora) é ligado ao cliente do cadastro uma vez,
por gente.

**1.7 Regras de eixo e de praça, corrigidas (I6, I8, M1).**
- "Eixo cobrado acima do cadastro" é **a conferir**, nunca "indevido, sempre": o eixo depende da
  composição engatada no dia.
- "Eixo que sobe e desce no mesmo trecho" é **conversa**, não contestação (motorista pode ter baixado
  o eixo; em concessão federal pode ser MDF-e aberto).
- **Praça pulada com mudança de eixo** entre as pontas = "carregou no caminho", sem achado. Sem
  mudança = "a conferir"; nunca valida reembolso sozinha e nunca fala em multa sem a praça esperada
  da rota.

**1.8 Prazo.** O cliente é **pré-pago** (não há vencimento): os 90 dias pra contestar contam da
**data da passagem** (M3). A tela mostra "contestar até dd/mm" por passagem.

**1.9 Eixos no cadastro** — ver (e). **1.10 Papéis**: relatório de vale não recebido por contratante
e lista de contestação (data, hora, praça, sentido, valor, prazo). **1.11 Histórico**: aceita vários
PDFs de uma vez, até 12 meses; mês antigo sem viagem no Movatruck não tem sugestão e depende da
memória do escritório (dito na tela).

**1.12 Guarda do PDF e permissões (I5).**
- Duas chaves novas no catálogo: **`tag.ver`** (ver a conferência e os relatórios) e **`tag.importar`**
  (subir, desfazer e baixar o original). Gate na UI, `@RequerPermissao` em todo endpoint.
- O original (razão social, CNPJ, banco, nº da nota) fica no MinIO com nome sorteado e é **servido
  só pela API**, pra quem tem `tag.importar`. Nunca por link direto.
- Guardado por **13 meses** (prazo do vale + folga); depois o arquivo é apagado e fica só o que foi
  lido. Apagado na hora se o extrato for desfeito ou a conta cancelada.

Tamanho: G (o leitor é M; o cruzamento é o resto). Tudo atrás do módulo novo; nenhuma empresa vê nada
sem contratar.

### Onda 2 — O pedágio do motorista vira conferência (acerto e lucro por caminhão)

1. **Caminhão com tag** é deduzido da fatura (a placa apareceu num extrato do mês), com data.
2. **Três fontes do lançado** (I7): o total da viagem que o app nativo grava (`valorPedagioTotal`),
   as linhas antigas de pedágio (`Pedagio.valor`) e o evento "Paguei pedágio" da viagem guiada. Com
   a viagem ligada (Onda 1), o sistema compara o lançado com o que a tag pagou **na mesma viagem**.
3. **Modelo próprio de decisão** (I7), não a tabela do pedágio em dobro: uma decisão liga passagens
   da tag a uma viagem/pedágio/evento e guarda o **valor decidido**, aceitando decisão **parcial**
   ("dos R$ 120 lançados, R$ 78 a tag pagou; R$ 42 foi do bolso"). Na tela, aparece ao lado do aviso
   de pedágio em dobro que o escritório já conhece.
4. Acerto já fechado não reabre: a decisão vira ajuste no acerto seguinte. Antes da fatura chegar, o
   acerto mostra "pedágio de caminhão com tag ainda sem conferência" — aviso, não trava. Modalidade
   que não reembolsa pedágio não vê aviso.
5. **Lucro por caminhão** (`common/lucro-veiculo.ts:249`): com extrato no mês, o pedágio do caminhão
   com tag passa a ser **o pago pela tag** (vale não é custo da empresa), e a mensalidade da tag
   (R$ 65,55/placa) entra como custo fixo. Caminhão de terceiro fica fora.
6. App (OTA, só com o módulo, API antes do OTA): a frase "a tag não passou? lance o que pagou do bolso".

Depende do Financeiro pra parte de acerto e lucro.

### Onda 3 — A fatura do cliente, o mês seguinte e o Excel

1. **As três saídas que leem o pedágio digitado mudam juntas**, senão divergem entre si:
   - o valor da viagem pro faturamento (`common/viagem-preco.ts:210`, repasse);
   - a **planilha de fechamento** que vai pro cliente (`fechamentos/export-fechamento.service.ts:503`,
     coluna `valor_pedagio`);
   - o lucro por caminhão (Onda 2).
   Com tag ligada, a base do repasse é **o pago pela tag, sem o que o vale cobriu** (nunca se cobra
   do cliente o que o embarcador pagou em vale), congelada com motivo. Junto, consertar a divergência
   antiga: o repasse ignora `Pedagio.valor` e o lucro não (M7). O valor que o motorista digitou fica
   intocado.
2. **Mês seguinte confere o anterior**: estorno de contestação (no pré-pago tende a voltar como
   crédito ou saldo — confirmar no 2º mês) fecha o achado; ausência vira "não estornado".
3. Lembrete mensal de importar e aviso de mês faltando.
4. **Excel do portal** quando o cliente mandar um; o PDF segue aceito.

### Fora das ondas

- Vale que ele deve aos subcontratados (g): só aviso.
- Outras operadoras: o modelo já nasce com `operadora`; leitor quando um cliente pedir.
- API do Sem Parar: não há pública pra conta pequena.
- Tarifa × tabela oficial: não vale manter tabela à mão.

---

## Parte 3 — As decisões de produto (a–g)

**(a) A 1ª onda mostra o vale-pedágio.** A tela abre por "Pode ser seu", com um número só e a regra
escrita: "até R$ 2,4 mil em 15 viagens; R$ 2,0 mil em 7 viagens longas". Sempre "até", até o
escritório confirmar. Passagens de praça ficam em "Pra conferir", com o prazo.

**(b) Vale-pedágio sem esperar a viagem guiada.** O cruzamento automático (1.4) liga a viagem
inferida à viagem lançada com placa + dia + praças da rota + ordem + eixos — lançamento manual basta;
GPS e eventos só deixam mais certo. A pergunta "de quem era a carga" é por viagem, com 4 respostas
(1.6). O sistema sugere; quem afirma é gente.

**(c) Pedágio lançado à mão com tag.** Não some e não vira desconto automático: **vira conferência**,
viagem a viagem, com decisão parcial, num modelo próprio (Onda 2). As três fontes do lançado entram.
Praça pulada não prova nada sozinha.

**(d) Formato.** PDF da fatura agora (provado, com 6 checagens); Excel do portal quando chegar um.
Contestação em 90 dias da passagem e portal guardando 90 dias → **uso mensal**, com lembrete.

**(e) Eixos no cadastro.** Entra na Onda 1, **no núcleo**, opcional, com dois números: **eixos do
cavalo** e **eixos da composição de costume** (cavalo + carreta), mais "quantos suspende vazio".
Sugestão pela **moda** das passagens carregadas (não pelo máximo: uma cobrança errada de 9 eixos
viraria cadastro e calaria a regra). Confirmado por gente. Composição que muda de dia pra dia (carreta
trocada) fica pra quando existir cadastro de carreta.

**(f) Módulo e preço.** Módulo **adicional** "Conferência da tag de pedágio", nos moldes de "Gasto de
viagem" e "Etapas": vendido à parte, nunca liga sozinho, nem no teste grátis. Onda 1 não depende do
Financeiro; acerto e lucro (Onda 2) só com ele.

**(g) Subcontratados.** Fora das ondas; **aviso** de uma frase na tela da tag: quando ele subcontrata,
a lei o põe no lugar do embarcador e ele deve vale ao subcontratado (multa de R$ 3.000 por veículo por
viagem). Não temos o dado (a tag é do subcontratado).

---

## Parte 4 — As decisões do dono (no máximo 5)

| # | Decisão | Recomendação | Por quê |
|---|---|---|---|
| D1 | Quanto custa? | **Módulo à parte, R$ 39 por caminhão com tag, por mês**, por cima do combinado de R$ 129/caminhão. **A conferência do primeiro arquivo é de graça.** Sem percentual do recuperado. | Fica abaixo do plano por placa do Sem Parar (R$ 65,55); uma viagem longa sem vale (~R$ 270) paga meses. Percentual exigiria provar que o dinheiro voltou, e a cobrança é dele. |
| D2 | Quem diz se a carga era de terceiro? | **O escritório, por viagem**, com a sugestão do cruzamento e 4 respostas (inclui "pagou de outro jeito"). | É dinheiro cobrado de quem dá frete pra ele; errar queima relação. |
| D3 | Ligação passagem × viagem: sozinha ou com aprovação? | **Sozinha só quando não há dúvida** (meta: zero ligação errada na prova); o resto vira sugestão aceita em lote. | É o "mínimo de trabalho" sem o sistema afirmar errado. |
| D4 | Pedágio do motorista no caminhão com tag | **Conferência viagem a viagem, com decisão parcial**; não some, não desconta sozinho; app só ganha uma frase. | Tirar o botão quebra a tag que não leu; descontar sozinho acusa parceiro. |
| D5 | Eixos no cadastro do veículo | **Campo novo pra todos, opcional**: eixos do cavalo e da composição de costume, sugeridos pela fatura. | Sem ele não se conversa sobre eixo com dado; útil fora do módulo. |

Subcontratados: só aviso (não precisa de decisão nova).

---

## Parte 5 — Perguntas pro cliente

### Bloqueiam

1. **Autoriza importar as faturas na conta dele no Movatruck?** Sem isso nada vai pra produção.
2. **Das 7 viagens longas carregadas de setembro (Rosário/Tangará → Jangada/Rondonópolis: A 17, 23 e
   25/09; B 31/08, 17, 19 e 23/09), de quem era a carga, e o contratante deu vale de outro jeito?**
   Sem a resposta, R$ 1.976,80 é teto, não dinheiro.
3. **Hoje o motorista dos 3 caminhões lança o pedágio que a tag pagou, e ele devolve no acerto?**
   Define se a Onda 2 é dinheiro saindo todo mês ou só lucro e repasse.

### Não bloqueiam

4. As faturas em PDF dos últimos 12 meses (prescrição; e mais layouts pro leitor).
5. O "Relatório de lançamentos (Excel)" do portal, um mês junto com o PDF.
6. A placa A pode voltar vazia com 3 eixos como a B? É a mesma composição? (decide os R$ 202)
7. As 6 subidas curtas de Nobres (A 03 e 05/09; B 02 a 05/09) são carga própria?
8. Nas viagens que ele subcontrata, quem dá o vale ao subcontratado?
9. Está no RNTRC como transportadora de até 3 caminhões? Quem emite o CIOT?
10. Quem encerra o MDF-e depois da descarga, e quando?
11. Quer usar o relatório pra cobrar o contratante, ou só saber? (muda o tom do papel)

---

## Parte 6 — Riscos

| Risco | O que fazer |
|---|---|
| O cliente ouviu que "já está em desenvolvimento" e não há nada construído | Dizer a verdade e mostrar o raio-x do PDF dele. |
| **Ligação automática errada** vira cobrança errada ao contratante | Liga sozinho só com folga; limiar calibrado na prova pra zero erro; o relatório só traz viagem confirmada por gente; desfazer é um clique. |
| Cobrar o contratante pode custar o frete | O produto mostra e documenta; quem decide cobrar é ele (pergunta 11). |
| Número inflado | Um número só, por viagem, com a regra escrita; cada passagem em um balde; "até" até confirmar. |
| Layout do PDF muda (um arquivo visto) | 6 checagens; zero placas = FALHOU; testes de mutação; pedir mais meses (pergunta 4). |
| Fatura de outra empresa na conta errada | CNPJ raiz conferido, com confirmação explícita. |
| PDF com dados bancários vazando | Servido só pela API com `tag.importar`; nome sorteado; 13 meses e apaga. |
| Fuso (MT −4, TO −3; PDF não diz) | Padrão pela UF da concessionária, folga de 90 min, calibração por GPS. |
| Acusar motorista | Eixo é conversa; pedágio do motorista só sai do acerto por decisão de gente, inclusive parcial; praça pulada não prova nada sozinha. |
| As três saídas do pedágio divergirem | Mudam juntas na Onda 3 (repasse, planilha de fechamento, lucro). |
| Repasse cai a zero se o motorista parar de lançar | O app não manda parar de lançar; a base troca só na Onda 3. |
| Praça confirmada errado por uma empresa contamina as outras | Confirmação global só pela equipe Movatruck. |
| **Dados do cliente no computador da squad** | O texto não anonimizado está no scratchpad da squad (`tag-dados/`) e o PDF em `~/Downloads`: apagar ao fim da análise. |
