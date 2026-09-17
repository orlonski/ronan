# Chatwoot ↔ Captação de clientes

A mesma pessoa aparecia em duas telas sem uma saber da outra: no Chatwoot, um
número de WhatsApp sem nome; na Captação, um CNPJ sem conversa. Este documento
é como as duas pontas foram ligadas e o que falta configurar pra aparecer.

## O que acontece sozinho

**Quando alguém escreve no WhatsApp** (`chatwoot/chatwoot-agente.service.ts`):

1. O webhook acha o lead pelo telefone (últimos 8 dígitos — o lead da Receita
   guarda sem DDI, o WhatsApp manda com `55`).
2. Não achou? O lead nasce ali, com `origem: WHATSAPP_INBOUND`.
3. A mensagem vira `InteracaoLead` — é o histórico que aparece na ficha.
4. `LeadChatwootService.vincular` grava no lead **onde essa conversa mora**:
   `chatwootContaId`, `chatwootContatoId`, `chatwootConversaId`.
5. Em seguida a ficha do lead sobe pro contato do Chatwoot.

**Quando alguém mexe no lead pelo painel** (`prospeccao.service.ts`): mudar a
situação no funil ou registrar um contato reempurra a ficha. Sem `await`: o
painel não espera um HTTP de fora pra confirmar que salvou.

**Na ficha do lead** aparece "Abrir a conversa no WhatsApp" quando existe
conversa. O link é montado pela API (`linkDaConversa`), não pelo dashboard — a
URL do Chatwoot é env daqui, e repetir isso no painel criaria um segundo lugar
pra desatualizar.

## O que o atendente passa a ver

| Campo | Onde cai no Chatwoot | Precisa configurar? |
|---|---|---|
| Empresa | `company_name` | não |
| Cidade/UF | `city` | não |
| Sócio, porte, frota, origem | `description` | não |
| CNPJ | `cnpj` | **sim** |
| RNTRC | `rntrc` | **sim** |
| Situação no funil | `situacao_funil` | **sim** |
| Nota do lead | `nota_lead` | **sim** |
| Pediu pra não contatar | `nao_contatar` | **sim** |

Os três primeiros o Chatwoot já desenha sozinho na barra lateral. O resto são
atributos personalizados: **a gravação funciona de qualquer jeito, mas sem
criar o atributo ninguém vê**.

**Já criados** em 17/09/2026 na conta Movatruck (`atendimento.movatruck.com.br`,
conta 1), todos do tipo Texto no modelo Contato. Numa instalação nova, refazer
em Configurações → Atributos personalizados → Contato, um pra cada linha
marcada acima, com a **chave exatamente igual** à da tabela — o rótulo pode ser
o que quiser. O Chatwoot sugere a chave a partir do nome e **come os acentos
errado** ("Situação no funil" vira `situao_no_funil`): corrigir o campo Chave na
mão, sempre.

`nota_lead` é Texto de propósito, mesmo guardando número: quando o lead não tem
nota o sistema manda string vazia pra limpar o campo, e atributo numérico
recusaria.

`nao_contatar` é o mais importante da lista: quem atende é justamente quem tem
o dedo no gatilho de mandar mensagem, e quem pediu opt-out não pode receber.

## Env

| Var | Pra quê |
|---|---|
| `CHATWOOT_URL` | base pública, ex. `https://atendimento.movatruck.com.br` |
| `CHATWOOT_API_TOKEN` | token de um agente (Perfil → Token de acesso) |
| `CHATWOOT_INBOX_COMERCIAL` | id do inbox do número de vendas. Sem ele, o agente segue pelo caminho antigo e o painel só consegue abrir conversa se houver UM único canal de WhatsApp |
| `CHATWOOT_CONTA_ID` | opcional: a conta. Sem ele, a API pergunta em `/api/v1/profile` |

Sem as duas primeiras, `configurado()` é false e nada é enviado — nem erro, nem
ficha. Melhor calado que respondendo no vazio.

## Partindo do painel (o caminho de ida)

**"Mandar contatos pro Chatwoot"**, na tela de Captação, sobe como contato todo
lead que tem telefone — com a ficha junto. Antes disto o contato só nascia
quando a pessoa escrevia, então quem a gente ainda não tinha abordado não
existia no atendimento. Roda quantas vezes quiser: quem já foi não vai de novo.

Fica de fora, de propósito: quem pediu pra não ser contatado (contato no
Chatwoot é uma pessoa a um clique de receber mensagem) e telefone impossível.

**"Falar no WhatsApp"**, na ficha do lead, prepara a conversa e leva pra ela.
Acha ou cria o contato, cria a conversa no inbox comercial, guarda os ids e
abre a tela certa. Conversa que já existe não vira uma segunda — duas com a
mesma empresa partem o histórico em dois e o atendente responde na metade
errada.

**Nenhum dos dois manda mensagem.** Quem escreve a primeira palavra pra um lead
frio é uma pessoa, escolhendo o template na tela do Chatwoot. Ver abaixo por
que não é só cautela.

### O telefone da Receita vem sem o nono dígito

O cadastro é antigo: a maior parte dos celulares está com 10 dígitos
("4399912345"). Na primeira varredura isso reprovou 39 de 47 telefones — e
nenhum era lixo. `telefoneDeContato` devolve o 9 quando o terceiro dígito é de
6 a 9 (móvel), deixa o fixo em paz (2 a 5) e barra o que não pode existir
("00000000002" tem onze dígitos e passa em qualquer checagem de tamanho).

Cuidado que já custou meio dia antes: a Meta **identifica** número brasileiro
sem o nono dígito nos payloads dela. Mandar é com o 9; rotear inbox por número
é sem.

## O template de prospecção (a submeter na Meta)

Fora da janela de 24h desde a última mensagem da pessoa, a Cloud API só entrega
**template aprovado** — texto livre é recusado, inclusive digitado dentro do
Chatwoot. Os 13 templates que existem hoje são `utility` e `authentication`;
prospecção é `marketing`, que custa mais, espera opt-in e derruba a nota de
qualidade quando as pessoas marcam como spam. É o número oficial da empresa em
jogo, então a decisão é do dono, não do código.

Pra submeter em Gerenciador do WhatsApp → Modelos de mensagem:

| Campo | Valor |
|---|---|
| Nome | `prospeccao_primeiro_contato` |
| Categoria | Marketing |
| Idioma | Português (BR) |
| Corpo | (abaixo) |
| `{{1}}` | nome da empresa — exemplo: `Transportes Aurora` |
| Rodapé | `Movatruck • gestão de viagens para transportadoras` |
| Botões | Resposta rápida: `Quero saber mais` e `Parar de receber` |

```
Olá! Aqui é a Movatruck.

Encontrei a {{1}} no registro público de transportadoras da ANTT (RNTRC). A gente faz um sistema em que o motorista lança viagem, pedágio e abastecimento pelo celular, inclusive sem internet, e o escritório fecha o mês sem planilha.

Se quiser ver como funciona, é só responder por aqui. Se preferir que a gente não procure mais, responda SAIR.
```

Três coisas que esse texto carrega de propósito:

- **De onde veio o número.** "Encontrei no RNTRC da ANTT" é a resposta pra "como
  vocês conseguiram meu contato?", que é a primeira pergunta de quem não pediu
  nada. É a mesma régua de `docs/captacao-legitimo-interesse.md`.
- **Uma saída, na primeira mensagem.** Marketing sem opt-out visível é como se
  perde a nota de qualidade do número.
- **Nada de "sistema completo de gestão".** Promessa que o produto não cumpre
  volta como cancelamento, e o `ig-qa` já barrou cinco peças por isso.

**"SAIR" funciona sozinho** (`ehPedidoDeParar`): a mensagem que É um pedido de
parar tira a pessoa da lista global na hora, responde a confirmação e não passa
nem pelo SDR nem pela fila humana. "Não quero pagar caro" continua sendo
conversa — a régua só pega a mensagem que é isso e nada mais.

## O que NÃO existe (de propósito)

**Disparo em massa.** Não há botão de "mandar pra todos". Cada conversa começa
por um clique numa ficha, com uma pessoa olhando pra ela. É lento de propósito:
a alternativa é o número da empresa ser denunciado em lote.

**Etiqueta de situação na conversa.** O endpoint de labels do Chatwoot
**substitui** a lista inteira: mandar `proposta-enviada` apagaria o
`precisa-humano` que o repasse acabou de pôr. Por isso a situação do funil vai
como atributo do contato, não como etiqueta.
