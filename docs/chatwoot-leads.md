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
criar o atributo ninguém vê**. Em Configurações → Atributos personalizados →
Contato, criar um pra cada linha marcada acima, com a **chave exatamente igual**
à da tabela (o rótulo pode ser o que quiser).

`nao_contatar` é o mais importante da lista: quem atende é justamente quem tem
o dedo no gatilho de mandar mensagem, e quem pediu opt-out não pode receber.

## Env

| Var | Pra quê |
|---|---|
| `CHATWOOT_URL` | base pública, ex. `https://atendimento.movatruck.com.br` |
| `CHATWOOT_API_TOKEN` | token de um agente (Perfil → Token de acesso) |
| `CHATWOOT_INBOX_COMERCIAL` | id do inbox do número de vendas (sem isso, tudo segue pelo caminho antigo) |

Sem as duas primeiras, `configurado()` é false e nada é enviado — nem erro, nem
ficha. Melhor calado que respondendo no vazio.

## O que NÃO existe (de propósito)

**Iniciar conversa a partir do painel.** Fora da janela de 24h a Meta só aceita
template aprovado, e quem é dono do canal é o Chatwoot — mandar pelo
`EnvioWhatsappService` em paralelo entregaria a mensagem fora da conversa e
duplicaria pro destinatário. Quando fizer sentido, o caminho é criar a conversa
pela API do Chatwoot, com template, e passando antes pela régua de
`docs/captacao-legitimo-interesse.md`.

**Etiqueta de situação na conversa.** O endpoint de labels do Chatwoot
**substitui** a lista inteira: mandar `proposta-enviada` apagaria o
`precisa-humano` que o repasse acabou de pôr. Por isso a situação do funil vai
como atributo do contato, não como etiqueta.
