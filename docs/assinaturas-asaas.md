# Mensalidade das empresas clientes (Asaas)

Como a Movatruck cobra as transportadoras que usam o sistema. Antes disso era
Pix na mão, sem cobrança gerada, sem nota e sem histórico.

**Nasce desligado.** Sem `ASAAS_API_KEY` nada é criado no gateway, o webhook
recusa tudo e a régua não manda mensagem nenhuma — a API sobe normal e diz isso
no boot. Ligar é decisão consciente, em dois interruptores separados (a chave da
API e o token do webhook).

## O que ele NÃO faz

**Não corta acesso de ninguém.** Decisão do dono em 14/09/2026: a régua avisa, e
quem mexe em `Conta.ativa` ou `somenteLeitura` é uma pessoa, na tela de
Empresas. Com dois clientes, automatizar o corte transformaria um boleto
esquecido numa transportadora parada — e a primeira vez que isso acontecesse
custaria mais que o mês devido.

Cancelar uma assinatura significa **parar de cobrar**, nunca "tirar do ar".

## Por que Asaas, e por que Pix Automático primeiro

Em cima de uma mensalidade de R$ 1.890:

| Forma | Taxa | Por mês | Por ano |
|---|---|---|---|
| Pix Automático / Pix | R$ 1,99 fixo | R$ 1,99 | R$ 24 |
| Boleto | R$ 1,99 fixo | R$ 1,99 | R$ 24 |
| Cartão recorrente | R$ 0,49 + 2,99% | R$ 57,00 | R$ 684 |

O cartão custa **28x mais** para receber exatamente a mesma coisa. Por isso a
tela mostra a taxa de cada forma junto do nome dela na hora de escolher, e o
Pix Automático é o primeiro da lista.

O **Pix Automático** é recorrência de verdade (Banco Central, não lembrete com
QR Code): o cliente paga um QR uma vez e, ao pagar, autoriza no app do banco que
as próximas caiam sozinhas. Desde abril/2026 mais de 85% dos bancos suportam.

O **cartão** entra como conveniência. Assinatura mensal cobra só a mensalidade a
cada mês — ao contrário de parcelar o ano, que travaria o limite inteiro de uma
vez.

## Como ligar

### 1. Conta no Asaas

Conta PJ com o CNPJ que vai emitir a nota. Em Configurações → Integrações,
gerar a chave de API.

### 2. Variáveis de ambiente (serviço `ronan-api` no Easypanel)

| Var | O quê | Obrigatória |
|---|---|---|
| `ASAAS_API_KEY` | Chave de API. Sem ela, tudo fica desligado. | sim |
| `ASAAS_AMBIENTE` | `sandbox` (padrão) ou `producao`. | sim, pra valer |
| `ASAAS_WEBHOOK_TOKEN` | Segredo que o Asaas manda de volta. Mínimo 16 caracteres, gerado por você. | sim |
| `ASAAS_CHAVE_PIX` | A chave Pix que recebe o primeiro pagamento do Pix Automático. | só pra essa forma |
| `ASAAS_EMITIR_NFSE` | `true` emite nota na confirmação (R$ 0,49/doc). | não |
| `ASAAS_TIMEOUT_MS` | Padrão 20s. | não |

⚠️ A chave de sandbox e a de produção são **valores diferentes**. Trocar de
ambiente sem trocar a chave dá 401 em tudo.

### 3. Webhook no Asaas

Em Configurações → Integrações → Webhooks:

- **URL**: `https://ronan-api.2azr6q.easypanel.host/pagamentos/webhook/asaas`
- **Token de autenticação**: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`
- **Eventos**: todos os de cobrança (`PAYMENT_*`)
- **Versão**: v3

Confira que a fila está ativa depois do primeiro evento. **15 falhas seguidas
interrompem a fila inteira** — de todos os clientes — e o Asaas dá 14 dias antes
de apagar os eventos. Por isso o nosso handler responde 200 mesmo quando não
entende o evento: ele guarda o payload cru e registra o erro na linha, em vez de
devolver 500.

### 4. Templates da Meta (só se as cobranças forem sair pelo WhatsApp oficial)

Duas rotas novas: `COBRANCA_ABERTA` e `COBRANCA_ATRASADA`. O texto exato a
cadastrar está em `shared-types/src/whatsapp-mensagens.ts` (`textoAprovacao`).

Os dois têm **botão de URL dinâmica** com prefixo fixo
`https://www.asaas.com/i/` — o envio manda só o sufixo. Link inteiro em
parâmetro de corpo a Meta costuma tratar como conteúdo suspeito.

Enquanto os templates não forem aprovados, as duas rotas saem pelo Evolution
(que é o padrão de toda rota nova).

## Os dois clientes que já pagam no Pix

1. Criar a assinatura na tela **Assinantes → Mensalidades → Nova assinatura**,
   forma **Pix Automático**.
2. Mandar o copia-e-cola do QR inicial pro financeiro (aparece em "Cobranças"
   enquanto a assinatura está *Aguardando autorização*).
3. Quando ele pagar, a assinatura vira **Ativa** sozinha e as próximas caem
   sem ninguém fazer nada.
4. O mês que ele já pagou na mão entra por **Dar baixa** — com a data e como
   entrou escritos. Sem isso a cobrança ficaria vencida pra sempre, cobrando
   quem já pagou.

Se o banco dele ainda não suporta Pix Automático, use **Pix mês a mês**: o
Asaas gera o QR todo mês e a régua manda o link.

## Como funciona por dentro

```
Painel (plataforma)          Asaas                     Nosso banco
─────────────────────────────────────────────────────────────────────
Nova assinatura      ──►  customer + subscription
                          (ou autorização Pix)   ──►  Assinatura (RASCUNHO→AGUARDANDO)

                          gera a cobrança do mês
                          PAYMENT_CREATED        ──►  CobrancaAssinatura (PENDENTE)

cliente paga        ──►   PAYMENT_CONFIRMED      ──►  CONFIRMADA + Assinatura ATIVA
não paga            ──►   PAYMENT_OVERDUE        ──►  VENCIDA + Assinatura INADIMPLENTE
```

**O gateway gera as cobranças**, não a gente: é para isso que a assinatura
existe lá. Nosso cron só marca o que venceu (rede de segurança, caso um webhook
se perca) e manda os avisos.

### A régua

| Quando | O que sai |
|---|---|
| 3 dias antes | "a mensalidade está disponível", com o link |
| 1 dia de atraso | "venceu e consta em aberto" |
| 7 dias | idem |
| 15 dias | idem |
| depois disso | **silêncio** — daqui é conversa humana |

Roda às 9h de Brasília. As datas de aviso ficam gravadas na cobrança, não
booleanos: é o que faz o cron ser idempotente de graça e não mandar duas
mensagens se rodar duas vezes.

Um aviso que **não sai** (WhatsApp fora do ar) não grava a data — a régua tenta
de novo amanhã. Marcar como avisado o que não saiu é como um cliente deixa de
ser cobrado.

### Onde está o quê

| Arquivo | O quê |
|---|---|
| `common/assinatura-cobranca.ts` | As regras puras: competência, vencimento, quando avisar, tradução do status do gateway. É onde estão os testes. |
| `assinaturas/gateway.types.ts` | A porta. Trocar de gateway mexe só na implementação. |
| `assinaturas/asaas.provedor.ts` | O Asaas falando a nossa língua (centavos ↔ reais, forma ↔ endpoint). |
| `assinaturas/eventos-gateway.service.ts` | O webhook aplicado. Nada lança aqui. |
| `assinaturas/regua-cobranca.service.ts` | O cron que avisa. |
| `contas/_components/mensalidades.tsx` | A tela. |

## Cartão de crédito

O checkout transparente ainda **não está implementado** — hoje o cliente que
escolhe cartão informa os dados na página do próprio Asaas.

Quando entrar, o cartão será tokenizado pelo JS do gateway **na tela**: o número
não passa pela nossa API, o que nos mantém fora de quase todo o PCI-DSS. O banco
já tem lugar pro que pode ser guardado (`cartaoBandeira`, `cartaoUltimos4`) e
pra mais nada.

## Notas fiscais

`ASAAS_EMITIR_NFSE=true` emite NFS-e na confirmação do pagamento, a R$ 0,49 por
documento. Exige o município configurado no Asaas e certificado digital válido —
ligar antes disso gera nota recusada, que é pior que nota nenhuma.

## Quando algo não bate

Todo evento recebido fica em `eventos_gateway_pagamento`, com o payload cru.
Linha com `erro` preenchido é evento guardado e **não aplicado**:

```sql
SELECT "eventoId", tipo, "recebidoEm", erro
FROM eventos_gateway_pagamento
WHERE erro IS NOT NULL
ORDER BY "recebidoEm" DESC;
```

Evento repetido (o gateway reenvia em qualquer resposta fora de 2xx) é
descartado pelo `eventoId` único — reenviar é sempre seguro.
