# Dores — de onde sai o assunto do post

**Todo post começa aqui, não no código.**

A squad do Instagram só tinha `Read`, `Grep` e `Glob`: a única janela dela pro mundo era
o código-fonte. Então ela escrevia sobre o código-fonte — "o app faz X", "o app faz Y" —,
que é catálogo de funcionalidade, não conteúdo. Quem rola o feed não está procurando
saber o que o nosso app faz. Está com um problema.

A ordem é: **dor primeiro, produto depois.** O post abre com uma coisa que a pessoa
vive, e só então mostra o que mata aquilo. Nunca o contrário.

Isto aqui é o estoque de dores. O `ig-estrategista` escolhe UMA por post e trabalha ela
até o fim — não junta três.

---

## Como ler cada dor

- **Como ele diz** — a frase na boca da pessoa. É daqui que sai o gancho. Não reescreva
  em corporativês: "baixa visibilidade operacional" não é dor de ninguém, "o cliente
  liga e eu não sei responder" é.
- **O que custa** — por que dói. Dinheiro, tempo, briga, ou vergonha na frente do cliente.
- **O que mata** — a nossa resposta. **Ainda precisa ser confirmada no código antes de
  virar post.** Esta coluna diz onde procurar, não serve de prova.

---

# Dono de transportadora

### 1. O frete não cobre mais o custo, e ele não sabe onde está sangrando
**Como ele diz:** "eu rodo, rodo, e no fim do mês não sobra nada."
**O que custa:** o diesel é ~35% do custo da operação e o repasse do frete está travado;
margem some sem ninguém ver por onde. Muita empresa aceita frete no limite da
viabilidade porque não tem o custo consolidado pra saber que está abaixo.
**O que mata:** consumo km/l real por caminhão medido tanque a tanque (`common/consumo.ts`),
custo por km, caminhão que roda abaixo do resto do próprio pátio.

### 2. "Esse frete deu lucro?" é uma pergunta sem resposta
**Como ele diz:** "eu só sei se foi bom depois que o mês fecha. Às vezes nem aí."
**O que custa:** decide preço no achismo, aceita lane ruim e repete.
**O que mata:** valor por viagem materializado (`common/viagem-preco.ts`), custo de
diesel e pedágio na mesma viagem.

### 3. O acerto do motorista leva horas e ainda sai errado
**Como ele diz:** "todo fim de mês eu paro dois dias pra fechar o acerto na planilha."
**O que custa:** horas de alguém caro, erro que vira discussão com o motorista, e o
clássico pedágio devolvido duas vezes ou nenhuma.
**O que mata:** `common/acerto-motorista.ts` — a régua mora na modalidade, o pedágio tem
fonte única, comboio não vira reembolso.

### 4. O cliente liga perguntando da carga e ninguém sabe responder
**Como ele diz:** "aí alguém tem que caçar a foto no WhatsApp de três semanas atrás."
**O que custa:** achar documento (CT-e, canhoto, comprovante, averbação) é queixa
recorrente do setor. Cada ligação dessas queima meia hora e confiança.
**O que mata:** link público de comprovante da viagem.

### 5. O contrato do cliente tem mínimo, e alguém precisa lembrar disso viagem por viagem
**Como ele diz:** "combinei 80 km mínimo com esse cliente. Quem lembra disso na hora de faturar?"
**O que custa:** fatura a menos e ninguém percebe; ou fatura errado e o cliente percebe.
**O que mata:** `RegraMinimo` por empresa/material/faixa de km, aplicado no faturamento
sem sobrescrever o que o motorista lançou.

### 6. Cada cliente quer a planilha de um jeito
**Como ele diz:** "todo mês alguém reformata coluna pra mandar pro cliente."
**O que custa:** trabalho manual repetido, e erro de digitação que vira glosa.
**O que mata:** layout de envio por empresa.

### 7. Frota velha, manutenção cara, e nenhum critério pra decidir o que trocar
**Como ele diz:** "sei que esse caminhão bebe mais, mas é impressão minha."
**O que custa:** vendas de caminhão caíram >15% em 2026 — muita empresa segue com frota
envelhecida e sem número pra justificar a troca no banco.
**O que mata:** km/l por veículo com régua do próprio pátio, custo fixo rateado.

### 8. Ele não confia no número que o sistema mostra
**Como ele diz:** "esse relatório tá certo? porque não bate com o que eu vejo."
**O que custa:** volta pra planilha e o sistema vira digitação dupla.
**O que mata:** o real do motorista nunca é sobrescrito; alteração de km exige motivo
escrito e vira auditoria (`common/km-motorista.ts`).

---

# Motorista parceiro

> Motorista aqui é **parceiro autônomo**, nunca funcionário. Nada de "sua empresa",
> "controle", "cobrança". Ver o tom no `SKILL.md`.

### 9. Ele aceita frete sem saber se vale a pena
**Como ele diz:** "fiz a conta de cabeça e torci pra não ter esquecido nada."
**O que custa:** o setor inteiro erra isso — custo indireto é o que o autônomo mais
esquece, e a margem saudável (15–30%) evapora sem ele ver.
**O que mata:** a conta feita com o consumo DELE, não média de mercado; o que sobra em
reais e por km, antes de aceitar.

### 10. Ele desconfia do acerto e não tem como conferir
**Como ele diz:** "pagaram o que? eu rodei mais que isso."
**O que custa:** é a briga mais velha entre motorista e escritório, e a que mais queima
relação boa.
**O que mata:** o km que ele informou é lei e fica intocado; o escritório só altera com
motivo escrito, e fica registrado.

### 11. Sem sinal, ele perde o que lançou
**Como ele diz:** "fiquei sem sinal na serra e sumiu."
**O que custa:** relança tudo de noite, cansado, e erra.
**O que mata:** fila local, sobe sozinho quando a rede volta.

### 12. Pedágio que saiu do bolso dele e não voltou
**Como ele diz:** "paguei do meu e esqueceram de devolver."
**O que custa:** dinheiro dele, todo mês, em pedaço pequeno que não compensa brigar.
**O que mata:** pedágio na viagem, fonte única, devolvido no acerto.

### 13. O app da empresa trata ele como culpado
**Como ele diz:** "falta uma coisa lá do escritório e o app fica vermelho pra mim."
**O que custa:** ele para de usar o app, e aí o escritório perde o dado.
**O que mata:** pendência do escritório nunca aparece como erro dele.

### 14. O valor caiu na conta, mas nada mostra de onde ele veio
**Como ele diz:** "caiu um valor lá. De onde saiu esse número, ninguém explica."
**O que custa:** ele não tem como conferir — só confiar. É terreno fértil pra
desconfiança mesmo quando a conta está certa, porque "está certa" sem mostrar o
cálculo é indistinguível de "não sei se está certa".
**O que mata:** cada real do acerto nasce de uma linha nomeada — frete da viagem,
pedágio devolvido, abastecimento devolvido, desconto com motivo escrito — nunca de
um total solto (`common/acerto-motorista.ts`, `apps/motorista-app/app/meus-acertos.tsx`).

### 15. Ele avisa que o caminhão tá com problema, e não sabe se alguém viu
**Como ele diz:** "falei que o pneu tava careca. Cadê a resposta?"
**O que custa:** ele fica sem saber se pode seguir rodando, e sem resposta o parceiro
para de avisar — aí o escritório perde justo o dado que evitaria o caminhão parar na
pista.
**O que mata:** botão "Problema no caminhão" no Início — foto, descrição e se dá pra
continuar rodando — cai na hora na aba Avisos da Manutenção, com notificação pro
escritório; quando decidem, o motorista recebe notificação e vê o status em "Meus
avisos" (`apps/motorista-app/app/avisar-problema.tsx`, `meus-avisos.tsx`,
`admin/frota-manutencao/frota-manutencao.service.ts`).

---

## De onde vem isto, e o que falta

As dores 1, 7 e 9 têm número de fora — custo do diesel, queda de venda de caminhão,
margem do autônomo, custo indireto esquecido. Fontes:

- [Frete não acompanha custo e transportadoras operam no limite em 2026 — Revista Caminhoneiro](https://www.revistacaminhoneiro.com.br/frete-nao-acompanha-custo-e-transportadoras-operam-no-limite-em-2026)
- [Alta de custos e dificuldade de repasse — Alisat](https://www.alisat.com.br/post/alta-de-custos-e-dificuldade-de-repasse-o-que-o-transporte-rodovi%C3%A1rio-enfrenta-em-2026)
- [Acerto de motorista: como fazer — Mutuus](https://www.mutuus.net/blog/acerto-de-motorista-como-fazer/)
- [Custos indiretos que o autônomo esquece — Frete com Lucro](https://fretecomlucro.com.br/custos-indiretos/)
- [Como o autônomo define o preço do frete por km — Sem Parar Empresas](https://blog.sempararempresas.com.br/veiculos/preco-do-frete-de-caminhao-por-km)

**O resto é dedução a partir do que o produto resolve — e essa é a fraqueza deste
arquivo.** A fonte boa de dor não é blog de setor: é o que os nossos próprios prospects
falam. As conversas do SDR no WhatsApp e a base de leads da captação têm objeção real,
com nome e CNPJ, de gente que ouviu o pitch e disse não. Quando alguém ligar isso aqui
nessa base, este arquivo vira muito melhor do que é hoje.

**Quem usar uma dor sem número tem que dizer sem número.** Não invente estatística pra
dar peso — a regra de não afirmar o que não se pode provar vale aqui igual vale pro
produto. Na primeira leva o QA barrou uma peça com "~950 praças de pedágio" que tinha
saído de um comentário no código, não de medição.

**Dor que já virou post não vale de novo tão cedo.** Confira a lista de peças publicadas
antes de escolher; o briefing da pauta manda ela junto.
