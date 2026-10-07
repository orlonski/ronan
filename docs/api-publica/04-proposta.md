# API pública e integrações: a proposta

**Autor:** api-produto (squad API Pública). **Data:** 07/10/2026. **Status:** proposta. Nada foi implementado.
**Base:** `00-pedido.md` (o pedido), `01-campo.md` (mercado), `02-arquitetura.md` (desenho), `03-seguranca.md` (segurança).

---

## 1. Em uma página, pro dono

### O que é

Hoje o Movatruck só conversa com gente: o motorista pelo app e o escritório pelo painel. A proposta é
abrir **uma porta pra outro sistema**, que é o programa que a transportadora já usa (ERP, sistema de
frete, app próprio). Por essa porta, o sistema dela pode **mandar** viagens pra nós e **receber** o que
acontece aqui.

São quatro peças, e são as quatro que você intuiu:

1. **Chave de acesso.** A empresa gera no painel, em "Conectar outro sistema", uma chave pra cada
   sistema dela e marca o que aquela chave pode fazer (só ver viagens, ou também criar). A chave
   aparece uma vez só, mostra quando foi usada pela última vez e é desligada na hora com um botão.
2. **Aviso automático.** Quando uma viagem é criada, termina ou é conferida, o Movatruck avisa o
   sistema da empresa sozinho, em segundos. Se o sistema dela estiver fora do ar, a gente tenta de novo
   por 3 dias. Se mesmo assim não der, desliga o aviso e manda mensagem pro administrador.
3. **"O que mudou desde a última vez."** Além do aviso, o sistema dela pode perguntar o que mudou desde
   a última vez e recuperar o que perdeu. Aviso sozinho perde coisa. Com os dois, nada se perde.
4. **Número do outro sistema.** Cada viagem, motorista, caminhão e local pode guardar o número que ele
   tem no sistema da empresa. Mandar a mesma viagem duas vezes atualiza a que já existe e não cria uma
   segunda.

E a documentação **nasce do mesmo código**. Se alguém mudar a porta e não mudar a documentação, o
sistema nem sobe, e por isso ela fica sempre atualizada.

### O que destrava: os seus dois casos

**(a) A empresa cria viagens no sistema dela e usa o nosso painel.**
Exemplo: a Pedreira Freitas tem um app próprio onde o motorista marca a carga. Cada carga lançada lá
aparece no painel do Movatruck em segundos, com o selo "Veio do App Freitas". A partir daí segue o
caminho normal: entra na conferência, pega o preço da tabela de preço, aparece no fechamento e na fatura
do cliente. Se o app dela mandar a mesma carga duas vezes por causa de internet ruim, continua sendo uma
carga só.

**(b) A empresa usa o nosso app e quer os dados no sistema dela.**
Exemplo: a Transportes Silva usa o app do Movatruck e controla o financeiro no Omie. Quando o conferente
aprova uma viagem, o Omie recebe o aviso na hora e lança a conta a receber com cliente, obra, toneladas,
km e valor. Numa segunda-feira em que o Omie passou a manhã fora do ar, ele pergunta o que mudou desde
sexta-feira e recebe tudo, inclusive as viagens que o km reprocessado corrigiu durante o fim de semana.

### O que NÃO faz

- **Não muda o km que o motorista informou.** Viagem lançada no nosso app só pode ser **lida** por
  outro sistema. Km, peso, foto e status continuam com o motorista e com o conferente.
- **Não aceita preço vindo de fora, por enquanto.** O valor da viagem continua saindo da tabela de preço
  do Movatruck. O outro sistema lê esse valor, mas não escreve.
- **Não entrega dado pessoal sem a empresa pedir.** CPF e telefone do motorista só saem se ela marcar
  isso na chave. Pix, conta bancária, localização ao vivo e documentos (CNH, toxicológico) não saem.
- **Não substitui o app do motorista** e não liga nem desliga nada no app.
- **Não fala a "língua de arquivo" das transportadoras grandes** (EDI PROCEDA, o arquivo OCOREN) por
  enquanto. Fica pra depois, se um cliente pedir.
- **Não promete ficar no ar 100% do tempo.** Hoje é uma máquina só. O que a gente promete é **não perder
  aviso**: tenta de novo por 3 dias, e o "o que mudou desde" recupera o resto.
- **Não é uma loja de aplicativos** pra uma empresa de fora se conectar a várias transportadoras. Cada
  transportadora conecta os sistemas dela.

### O tamanho

É grande, como você imaginou. Mas a primeira parte que já resolve os dois casos é uma onda só (a Onda 1),
feita em dois pedaços que podem ir pro ar separados. O resto melhora o que já funciona.

---

## 2. Ondas

Tamanho: **P** (dias), **M** (1 a 2 semanas), **G** (3 semanas ou mais).

### Já em correção, fora desta proposta

A squad achou quatro furos que **já existem hoje** e estão sendo corrigidos agora, em paralelo. Eles não
entram no planejamento abaixo, mas a Onda 1 **depende** deles:

1. IP do limite de tentativas que dá pra forjar (`common/rate-limit/ip.ts`).
2. Token na URL indo parar no registro de erros (`errors/errors.filter.ts`).
3. Segredo no caminho da URL gravado no registro de chamadas externas (`common/chamadas-externas/registro.ts`).
4. Documentação interna (Swagger) aberta em `/docs` em produção (`main.ts`).

### Onda 1: os dois casos funcionando com um cliente piloto (G)

Tem três blocos. O **1.0** é arrumação da casa e vale a pena mesmo sem API. O **1A** resolve o caso (a)
e o **1B** resolve o caso (b). O 1A e o 1B podem ir pro ar separados, e a ordem fica a critério do piloto.

#### 1.0: arrumação da casa (M)

| Entra | Por quê |
|---|---|
| Uma porta única pra "criar viagem" (`ViagemEntradaService`), que faz o que o app já faz: conferência, preço, programação, km atípico e aviso de aguardando peso | Sem ela, a API vira uma segunda porta sem trava |
| A **importação por planilha passa a usar essa porta** | Conserta um furo de hoje: a importação grava viagem sem enfileirar conferência, sem precificar, e no reimport sobrescreve o km sem `checarAlteracaoKm` |
| `ModuloGuard` e `SomenteLeituraGuard` passam a **fechar** pra quem não é usuário do painel (`modulo.guard.ts:51`) | Hoje um tipo novo de acesso passaria por eles sem cobrança de módulo nem de conta somente leitura |
| Rascunho da subseção "Integrações" nos Termos de Uso | Precisa estar publicada antes do 1º cliente (Decisão 5) |

- **Depende de:** nada.
- **Pronto quando:** uma planilha importada gera viagem que aparece na fila da conferência e com valor
  da tabela, e reimportar com km diferente uma viagem que veio do app é recusado com motivo. Um teste
  prova que um acesso que não é do painel recebe 403 em módulo não contratado. A suíte de testes
  continua verde.

#### 1A: entrada, o caso (a) (G)

| Entra | Detalhe |
|---|---|
| **Chave de acesso** | Formato `mvt_live_…`, guardada só como "impressão digital" (hash), mostrada uma vez, revogação na hora, último uso com IP real. Dona é a **empresa**, não a pessoa que criou. Até 10 por empresa. |
| **Porteiro próprio, que fecha por padrão** | Confere a chave, se a conta está ativa, se está em somente leitura, se o módulo está contratado e o escopo. A empresa vem **só** da chave. |
| **Escopos em linguagem de gente** | "Vê viagens", "Cria viagens", "Vê valores", "Vê CPF e telefone dos motoristas". Cada escopo é preso a uma permissão que já existe, e por isso módulo cancelado poda a chave sozinho. Ninguém cria uma chave mais poderosa que ele mesmo. |
| **Tela mínima "Conectar outro sistema"** | Gerar, ver os escopos, último uso e revogar com motivo. Operador da plataforma visitando a conta não cria chave. |
| **Criar e atualizar viagem** | `POST /v1/viagens` e `PUT /v1/viagens/externo/{id}`, sempre pela porta do 1.0. |
| **Cadastros que a viagem exige** | Criar e atualizar motorista, veículo e local pelo número do sistema da empresa. Material, cliente e obra são achados pelo nome (e pela placa, CPF ou CNPJ), com aviso quando não acharem. |
| **Número do outro sistema** | Tabela única de vínculo (`VinculoExterno`), por empresa. Nesta onda: viagem, motorista, veículo e local. |
| **Mandar duas vezes não duplica** | `Idempotency-Key` de 24 h mais o número externo. O identificador interno da viagem é **gerado por nós** e não colide entre empresas (conserta o `clientId` único global, que hoje deixaria uma empresa descobrir se o valor existe noutra). |
| **Erros claros** | Um formato só, com código estável. Campo desconhecido é recusado, não engolido. Id de outra empresa responde "não existe". |
| **Limites** | Corpo de até 1 MB em `/v1` (o global hoje é 50 MB), página de até 100, 120 leituras e 60 escritas por minuto por chave, 600 por empresa. CORS desligado em `/v1`, pra a chave não ir parar no navegador. |
| **Rastro** | Selo "Veio de: integração X" na viagem do painel. Auditoria de toda escrita com o nome da chave. |
| **Documentação gerada** | Cada rota declara o contrato numa linha só, e disso saem a validação, a permissão e a página de documentação (`/v1/openapi.json` + `/v1/docs`). Uma rota sem contrato derruba a subida. Um teste compara o contrato com o publicado e obriga a anotar a mudança no CHANGELOG. |

- **Depende de:** 1.0 e os quatro furos em correção.
- **Pronto quando:** o sistema do piloto cria 10 viagens reais; elas aparecem no painel com o selo,
  passam pela conferência e ganham valor da tabela. Viagem sem peso **não** entra no fechamento.
  Reenviar a mesma viagem não duplica. Chave revogada para no próximo pedido. O teste de duas empresas
  (a chave da empresa A tentando todas as rotas com ids da B) passa sem nenhum vazamento. Alguém
  abre a tela de verdade e gera e revoga uma chave.

#### 1B: saída, o caso (b) (G)

| Entra | Detalhe |
|---|---|
| **Ler viagens** | `GET /v1/viagens` (com filtro de data, status, motorista e placa) e `GET /v1/viagens/{id}`. Saem o km informado pelo motorista e o km faturado, rotulados; as toneladas e o valor **já com o mínimo aplicado**; e o pedágio **já decidido**, uma fonte só. O valor só sai com o escopo "Vê valores". |
| **"O que mudou desde"** | `GET /v1/alteracoes`. Um registro no banco anota toda mudança de viagem, inclusive a do robô de km, a do conferente, a da IA e a exclusão. Nesta onda vale pra viagem e valor da viagem. Guarda 30 dias. |
| **Aviso automático** | Eventos `viagem.criada`, `viagem.atualizada`, `viagem.excluida`, `viagem.finalizada` e `viagem.conferida`. O aviso é **magro**: diz "a viagem X mudou" e o sistema da empresa busca o estado atual. Assinatura no padrão de mercado (Standard Webhooks), o mesmo id em toda tentativa, tentativas por cerca de 3 dias, desligamento com aviso ao administrador. A escrita feita por uma chave não volta como aviso pra ela mesma. |
| **Proteção do destino** | Só `https`, sem endereço interno, conferido no cadastro e a cada envio. Sem seguir redirecionamento. O envio roda num processo à parte, e não no `ronan_agente`. O registro de chamadas externas guarda só o host. Sem `CRIPTO_SECRET` próprio, o aviso não liga. |
| **Tela mínima de avisos** | Cadastrar endereço, escolher eventos, "Enviar teste", lista das últimas entregas (status, tentativas, quando) e "Reenviar". |

- **Depende de:** chave e porteiro do 1A, e 1.0. O registro de mudanças precisa ser medido numa cópia
  do banco de produção antes de ligar e tem interruptor pra desligar sem mexer no código. Um registro
  lento atrasaria o lançamento do app, e isso não pode acontecer.
- **Pronto quando:** o piloto recebe o aviso de uma viagem conferida em menos de 1 minuto, com
  assinatura válida. Derrubando o endereço dele por 2 horas, ao voltar ele recebe tudo pelas novas
  tentativas, e o "o que mudou desde" confirma que nada se perdeu. Uma viagem excluída no painel
  aparece como excluída. Uma viagem em andamento ou aguardando peso sai marcada como incompleta e fica
  fora da lista padrão. Um endereço apontando pra rede interna é recusado. O lançamento do app não
  fica mais lento (medido).

### Onda 2: mais dados saindo e o casamento de cadastros (M)

| Entra | Detalhe |
|---|---|
| Abastecimentos, pedágios (já decididos, uma fonte por viagem) e acertos FECHADO/PAGO | Leitura, entrada no "o que mudou desde" e eventos `abastecimento.*`, `acerto.fechado` e `acerto.pago`. O acerto exige o escopo "Vê valores". |
| Criar e atualizar material, cliente (quem paga), obra e transportadora | Mesma régua dos cadastros do 1A |
| **"Em outros sistemas"** na ficha de cada cadastro do painel | O primeiro casamento costuma ser feito à mão (de-para). Mesclar locais ou motoristas duplicados repassa o vínculo pro que fica. |
| Escopo de dado pessoal (CPF e telefone) | Desligado por padrão, com aviso na tela de que aquilo entrega dado pessoal |

- **Depende de:** Onda 1.
- **Pronto quando:** o ERP do piloto lança a conta a pagar do acerto do motorista sem ninguém digitar,
  e o pedágio de uma viagem com linhas antigas e valor nativo aparece **uma vez** só.

### Onda 3: portal, teste sem risco e telas completas (M)

| Entra | Detalhe |
|---|---|
| Portal de documentação caprichado | Exemplos em curl, JavaScript e Python, guia "primeira viagem em 10 minutos", "Testar com sua chave" e vocabulário do cliente ("cliente", "obra") |
| **Ambiente de teste** | Uma conta de demonstração por integrador, criada pela plataforma, com chave `mvt_test_`. Chave de teste não funciona em conta real, e vice-versa. |
| Tela de credenciais completa | Trocar a chave sem parar o sistema (a antiga vale por 24 h, no máximo 7 dias), prazo de validade, selos ("sem uso há 90 dias", "criador desativado"), chamadas por dia, últimos erros traduzidos |
| Tela de avisos completa | Filtros, "reenviar tudo que falhou desde…", troca do segredo da assinatura |
| Alertas por WhatsApp ao administrador | Chave vencendo, aviso desligado por falha, chave vazada (Decisão 4) |

- **Depende de:** Onda 1 (a Onda 2 é opcional).
- **Pronto quando:** um programador de fora, só com o portal e uma chave de teste, cria uma viagem e
  recebe o aviso sem falar com a gente.

### Depois, se um cliente pedir

Valor da viagem vindo do ERP (escopo próprio, que não é sobrescrito por recálculo), envio em lote (até
100 por chamada), pedido e programação, CT-e, arquivo OCOREN, restrição da chave por IP, aviso "gordo"
(com o objeto inteiro), localização ao vivo, aviso de chave vazada pelo GitHub e conexão de aplicativo de
terceiros pra várias transportadoras.

### Número do outro sistema: quais entidades primeiro

O pedido foi "todas as tabelas". A resposta é **uma tabela de vínculo que serve pra todas**, inclusive as
que nascerem amanhã. Assim não é preciso mexer nas cerca de 100 tabelas, e o mesmo caminhão pode ter um
número no ERP, outro no rastreador e outro no app próprio.

| Quando | Entidades | Por quê |
|---|---|---|
| Onda 1 | Viagem, Motorista, Veículo, Local | A viagem não existe sem as três; o local nem tem outro jeito de ser achado |
| Onda 2 | Material, Cliente (quem paga), Obra, Transportadora, Abastecimento, Acerto | Faturamento e contas a pagar no ERP |
| Depois | Pedido, Programação, Despesa, Fornecedor | Só quando esses dados entrarem na API |
| Nunca | Chat, stories, ponto, auditoria, usuários do painel, documentos pessoais | Não são dado de integração |

---

## 3. Regras que não podem quebrar

| Regra da casa | Como a API respeita |
|---|---|
| **O km do motorista é lei** | O km mandado por outro sistema é guardado como "km do sistema de origem" e **nunca** como km do motorista. Esse campo continua sendo escrito só pelos 3 caminhos do app. Em viagem lançada no app, outro sistema não muda o km: a resposta é "km protegido". Em viagem criada pela integração, ela pode corrigir o km até a conferência, com auditoria própria. Se o painel já alterou com motivo, a máquina não desfaz a decisão de uma pessoa. |
| **STATUS_FORA_FECHAMENTO** | A integração só cria viagem "em andamento", "aguardando peso" ou "concluída". Viagem sem peso vira aguardando peso, nunca 0 t. Aprovar ou ajustar é sempre do conferente. Na saída, viagem incompleta vem rotulada e fica fora da lista padrão, pra o ERP não faturar 0 t. A exclusão é a mesma do painel, com registro de que sumiu, e não um status novo de "cancelada" (que obrigaria a revisar os 25 pontos da regra). |
| **Mínimo conta, preço vale** | Toda viagem passa pela mesma porta (`ViagemEntradaService`), e o preço sai da tabela de preço sobre a quantidade **efetiva**. Na saída, toneladas, km e valor já vêm com o mínimo aplicado, que é o que se fatura. Valor alterado à mão no painel não é mexido por ninguém. |
| **Pedágio em dobro** | A integração escreve só o pedágio da viagem, nunca linhas soltas. Na leitura sai **um** pedágio por viagem, já decidido pela regra (`pedagioDaViagem`), e nunca as duas fontes lado a lado. |
| **Trava multi-tenant** | A empresa vem **só** da chave e nunca de cabeçalho, parâmetro ou corpo. O número externo é único **dentro** da empresa. Id de outra empresa responde "não existe". O cadastro global de motoristas (CPF) nunca é consultado pela API. Um teste com duas empresas percorre todas as rotas, e rota nova entra nele sozinha. |
| **Módulo contratado** | Cada escopo é preso a uma permissão, e a permissão a um módulo. Módulo cancelado faz a chave parar de ver aquilo em até 15 s, sem apagar nada: se a empresa recontratar, volta. Conta em somente leitura lê, mas não escreve. Uma rota `/v1` sem escopo derruba a subida. |
| **IA nunca afirma** | Viagem vinda da API entra na mesma conferência. O aviso `viagem.conferida` só sai quando uma pessoa (ou a regra do material que dispensa conferência) decide, e nunca quando a IA só leu o ticket. O que a IA leu não sai como fato. O nome que vem do outro sistema só casa com o nosso cadastro por número de vínculo, placa, CPF ou CNPJ. Quando o casamento é só por nome parecido, a viagem entra com aviso de divergência pra uma pessoa conferir. |
| **A empresa manda no app** | A API não liga nem desliga nada no app do motorista e não fala com o aparelho. O motorista criado por outro sistema existe pra viagem e pro acerto, **sem acesso ao app**. O convite pro app continua sendo feito por uma pessoa no painel. Nada desta proposta põe item novo no app. Se um dia puser, nasce com interruptor. |
| **Lançamento nunca é recusado** (nuance) | Isso vale pro **motorista** na estrada, e continua valendo. Pra **máquina**, erro de formato é recusado com motivo claro, porque é o que o programador precisa. Referência que não foi achada não recusa: a viagem entra com aviso, exceto motorista e veículo, que são obrigatórios. |

---

## 4. Comercial

**Proposta: "Integrações" é um módulo contratado à parte**, igual aos outros (aparece em Módulos e é
ligado por empresa). O motivo é que o mercado cobra (a Fleetio só dá API nos planos de cima; os TMS
brasileiros negociam caso a caso), quem pede integração é empresa maior, e o desenho de segurança já
assume isso: cancelar o módulo desliga todas as chaves na hora, sem apagar nada.

| Item | Proposta |
|---|---|
| Quem tem de graça | A Schaba (cobaia, como nos outros módulos) e o 1º cliente piloto, durante o piloto |
| O que vem no módulo | Tudo: ler, criar e aviso automático. Separar leitura de escrita em preços diferentes complica a venda sem ganho agora. |
| Cobrança | Por empresa, por mês, e não por chamada. Cobrança por chamada assusta o cliente pequeno e dá trabalho de medir. O valor é decisão sua. |
| Limites do plano padrão | 120 leituras e 60 escritas por minuto por chave, 600 por empresa, até 10 chaves, até 5 endereços de aviso |
| Plano "volume" | Limites maiores, negociados com quem precisar. Fica como alavanca de preço, e não como liga e desliga. |
| Fim de contrato | O cliente que sai tem direito aos dados dele (LGPD). A exportação por planilha continua no núcleo. A API não é a única saída. |
| Argumento de venda | REST, documentação sempre atualizada, aviso assinado e ambiente de teste deixam o Movatruck **acima de todos os TMS e ERP brasileiros pesquisados** (`01-campo.md` §2) |

---

## 5. Decisões do dono

> **Decidido em 07/10/2026: o dono aprovou as cinco recomendações abaixo como estão.**
> Falta só ele escolher os clientes piloto (decisão 5). Antes de implementar a Onda 1, os 4
> BLOQUEIA de `05-qa.md` entram no bloco 1.0 (identidade por CPF entre empresas, km da
> integração no reprocessamento, viagem da API no app do motorista, efeitos por origem na porta
> única de entrada).

Juntei as 14 perguntas dos três especialistas. As técnicas a squad resolveu sozinha (estão no anexo).
Sobram cinco, e cada uma vem com a minha recomendação.

### 1. A integração é vendida à parte?

**Recomendo:** sim, como módulo "Integrações", com a Schaba e o 1º piloto sem custo. O preço é seu.
**Por quê:** é o que o mercado faz com quem pede integração (empresa maior), e o desenho já usa o módulo
como interruptor geral: cancelou, todas as chaves param na hora.

### 2. Quando o sistema da empresa e o painel mexem na mesma viagem, quem manda?

**Recomendo:** quem criou a viagem manda nela.
- Viagem lançada no **nosso app**: o outro sistema só **lê**. Ele pode, no máximo, anotar observação,
  obra, pedido e o número dele.
- Viagem criada **pelo sistema da empresa**: ele manda até a conferência ou o fechamento. Se alguém do
  painel corrigir um campo com motivo, o sistema dela não sobrescreve mais **aquele campo**.
- **Preço:** sai sempre da nossa tabela nesta fase. O ERP lê, mas não escreve.

**Por quê:** não existe mistura automática segura de km, peso e dinheiro. Essa regra protege o km do
motorista e a decisão do conferente, e evita a briga de "quem salvou por último ganha". O preço vindo de
fora pode abrir depois, se um piloto precisar.

### 3. Que dado pessoal do motorista pode sair?

**Recomendo:**
- Nome sempre.
- CPF e telefone só se a empresa marcar isso na chave, que nasce desmarcado e com aviso de que entrega
  dado pessoal.
- **Nunca** nesta fase: Pix ou conta bancária, localização ao vivo e documentos (CNH, toxicológico).

**Por quê:**
- Pix é o dado mais visado pra golpe (trocar a chave e desviar o pagamento).
- Localização contínua de parceiro autônomo repassada a terceiros pesa contra a tese de que ele não é
  empregado.
- Toxicológico é dado de saúde.

Se o ERP precisar pagar o acerto pelo Pix, isso vira um pedido próprio, com confirmação por código.

### 4. Se uma chave aparecer exposta na internet (por exemplo, publicada num código aberto), o que fazer?

**Recomendo:**
- Chave de teste: desligar na hora.
- Chave real: avisar o administrador na hora, por WhatsApp e e-mail, e desligar sozinha em 24 h se
  ninguém trocar.

**Por quê:** desligar na hora é o mais seguro, mas derruba a integração do cliente sem ninguém autorizar.
A regra da casa é nunca tirar acesso sem autorização. As 24 h dão tempo de trocar sem parar a operação.

### 5. Antes de abrir: Termos novos e quem é o piloto

**Recomendo:**
- Publicar nos Termos de Uso uma subseção "Integrações", com novo aceite, **antes** do 1º cliente. Ela
  diz que, ao criar uma chave ou um aviso, a empresa decide pra onde os dados dela vão e responde por
  esse destino.
- Você escolher **um** cliente piloto pra cada caso. Pro caso (b), a Schaba serve, se tiver um ERP; pro
  caso (a), precisa ser uma empresa que já tenha um app próprio.

**Por quê:** pela lei de proteção de dados, a empresa é a dona dos dados e nós só operamos. Mandar dado
pra um sistema que ela escolheu é instrução dela, e isso tem que estar escrito. E o "pronto" da Onda 1 é
um cliente real usando, não uma suíte de testes verde.

---

## Anexo: o que a squad decidiu sozinha (pro time técnico)

Nos pontos em que `02-arquitetura.md` e `03-seguranca.md` divergem, vale o seguinte:

| Ponto | Decisão | Motivo |
|---|---|---|
| Como a chave passa pelos guards | Guard próprio fail-closed em `req.integracao`, no molde do `EncarregadoGuard`, cobrando ele mesmo conta, somente leitura, módulo e escopo. **E** o `ModuloGuard`/`SomenteLeituraGuard` são fechados mesmo assim (bloco 1.0). | Tem precedente no repo que já funciona. Não depende da ordem dos guards globais. A defesa fica em dobro. |
| Escopos | Catálogo público próprio (`viagens:ler`…), cada um preso a uma chave RBAC e, por ela, a um módulo | Nome estável de contrato. A chave interna pode mudar sem quebrar o integrador. |
| Aviso gordo ou magro | **Magro** na Onda 1 | Escopo revogado não vaza. As tentativas de 3 dias não carregam CPF. O reprocessamento de km invalida snapshot. É o que a Stripe recomenda. |
| Cabeçalhos da assinatura | Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) | Tem biblioteca pronta, e o cliente não depende de SDK nosso |
| Onde roda o envio | Processo próprio, no molde do `agente-main`, e não dentro do `ronan_agente` | O agente é do robô de desenvolvimento e não tem conta. A chamada pra URL do cliente fica fora da API (SSRF). |
| Troca de chave | Credencial nova com o mesmo escopo e a antiga em carência (24 h padrão, 7 dias no máximo) | A rotação vira evento visível na auditoria |
| Limites | Os de `03-seguranca.md` §5.1, com página de no máximo 100 | O mais conservador. Afrouxar é fácil, apertar quebra cliente. |
| Mudança de dado | Trigger no banco gravando `registro_alteracoes`, com cursor por transação, mais eventos de negócio emitidos à mão em poucos pontos | São 19 pontos de escrita só da viagem. A data de alteração sozinha perde linha e não vê exclusão. |
| Exclusão de viagem | Física, com lápide no registro. Só pra viagem criada por aquela chave e não travada. | Não abre os 25 pontos do `STATUS_FORA_FECHAMENTO` |
| Número externo | Tabela `VinculoExterno`, única por `(conta, sistema, entidade, idExterno)` | Mais de um sistema por empresa, e sem oráculo entre empresas |
| Motorista criado pela API | Existe sem acesso ao app (senha inutilizável, sem identidade global) | É necessário pro caso (a). O convite continua humano. |
| Ambiente de teste | Conta de demonstração separada, na Onda 3 | Isolamento de graça pela trava, sem duplicar banco |
| Dinheiro na saída | Texto decimal (`"1234.50"`) | O integrador em JavaScript perde centavo com número |
| EDI OCOREN | Fora, até um cliente pedir | O cliente-alvo (basculante, agregado) raramente tem embarcador exigindo arquivo |
| Boot-check do `@Public()` geral | Fora desta proposta. Vale pro sistema inteiro e merece demanda própria. | Fura o escopo da API, mas é real (`03-seguranca.md` furo 3) |
