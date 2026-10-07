# API pública — pesquisa de campo (api-campo)

**Data:** 07/10/2026. **Pedido:** `00-pedido.md`.
Convenção: **Fato** sempre com link. Trecho marcado **Opinião** é leitura minha, sem fonte.

---

## 0. Resumo em 8 linhas

1. No Brasil, a troca transportadora ↔ embarcador ainda roda muito em **arquivo EDI PROCEDA** (NOTFIS, CONEMB, OCOREN, DOCCOB), não em API REST. Quem quer vender pra embarcador grande vai ouvir "manda o OCOREN".
2. Os ERPs/TMS brasileiros têm API, mas o nível é **heterogêneo**: Omie é POST-only com chave no corpo; Sascar é SOAP com usuário e senha; Senior é login de usuário; ESL Cloud tem coleção Postman. Webhook assinado é raro (Bling é a exceção).
3. As plataformas de frota de fora (Samsara, Motive, Fleetio) são o padrão a copiar: REST, token de API por organização, **webhook assinado com HMAC**, cursor, external ID.
4. O mínimo que virou obrigação: HMAC com timestamp, retry com backoff e desativação, `Idempotency-Key`, cursor, `external_id` com upsert, versão explícita.
5. Ninguém garante ordem de evento (Stripe e Bling dizem isso por escrito). Quem recebe tem que tolerar fora de ordem e duplicado.
6. Os dois casos do dono têm nome no mercado: (a) **upsert por external_id** (Salesforce/Samsara); (b) **webhook + feed incremental por cursor** (Samsara `/feed`).
7. Cobrança: o mercado se divide entre **API inclusa pra todo mundo** (Samsara) e **API só em plano superior** (Fleetio: Professional/Premium, com cota de webhook).
8. Pra assinar, o cliente médio pede contrato LGPD de operador (DPA) e documentação. O grande pede questionário de segurança e SLA de uptime.

---

## 1. Quem integra com quem no transporte de carga brasileiro

### O que uma transportadora de 3 a 100 caminhões costuma ter

| Peça | Exemplos | Fonte |
|---|---|---|
| **TMS** (CT-e, MDF-e, rastreio, motorista, custo de frete) | Bsoft, ESL Cloud, Brudam, Senior TMS, Autocargo, Benner, GKO Frete, LogSist, Sythex | [Bsoft: sistema pra pequena e média](https://bsoft.com.br/blog/sistema-para-pequenas-e-medias-transportadoras), [Senior: como escolher](https://www.senior.com.br/blog/sistema-para-transportadora), [ESL Cloud API](https://documenter.gw.postman.com/view/metadata/2s9YXk2fj5) |
| **ERP** (financeiro, contábil, fiscal) | Omie, Bling, Conta Azul (pequenas); TOTVS Protheus (com vertical TMS) e Senior (médias e grandes) | [Omie: sistema pra transportadora](https://www.omie.com.br/blog/por-que-o-sistema-para-transportadora-e-tao-importante/), [TOTVS TDN](https://tdn.totvs.com/x/SW06K), [Conta Azul devs](https://contaazul.com/desenvolvedores/) |
| **Rastreador / telemetria** | Sascar (Michelin), Omnilink, Autotrac | [Manual SasIntegra v2.07](https://connectedfleet.michelin.com/hubfs/WebService_SasIntegra_v2.07_Portugues.pdf), [Omnilink](https://www.omnilink.com.br/omniturbo) |
| **Canhoto / comprovante digital** | NDD Cargo i-Comprova, Comprovei | [NDD i-Comprova](https://mundologistica.com.br/noticias/ndd-lanca-solucao-para-monitorar-e-gerenciar-entregas), [Bsoft: Comprovei](https://bsoft.com.br/blog/comprovei-cargo) |
| **Marketplace de frete** | Fretebras, TruckPad (integra com TMS: Brudam, TOTVS) | [TruckPad + Brudam](https://mundologistica.com.br/noticias/truckpad-e-brudam-se-unem-para-evitar-que-caminhoes-de-transportadoras-viagem-vazios), [TOTVS: integração FreteBras](https://tdn.totvs.com/download/attachments/485876395/Webinar%20Integra%C3%A7%C3%A3o%20FreteBras%2012.1.29.pdf?api=v2) |

Contexto do setor: são 266 mil empresas de transporte de carga e 2,5 milhões de veículos. A maioria tem mais de 20 anos (59,3%) e gestão familiar (79,3%). Só 39% monitoram consumo de combustível ([CNT via SETCESP](https://setcesp.org.br/noticias/cnt-faz-raio-x-do-transportador-de-carga-no-brasil/), [SETCESP](https://setcesp.org.br/noticias/pesquisa-inedita-da-cnt-retrata-o-transporte-rodoviario-de-cargas-no-brasil/)). A CNT não publica dado de adoção de TMS ou rastreador por porte. Não achei número confiável sobre isso.

**Opinião:** na faixa 3–30 caminhões, o "sistema" quase sempre é emissor de CT-e/MDF-e, mais ERP leve (Omie/Bling/Conta Azul), mais o portal do rastreador, mais planilha. Integração de verdade com o Movatruck vai ser, na ordem: (1) **planilha/CSV e BI**, (2) **ERP pra faturar e pagar** (viagem com valor → conta a receber; acerto → conta a pagar), (3) **TMS/emissor** (viagem ↔ CT-e). Rastreador entra como fonte de km/posição, não como destino.

### O que a transportadora quer trocar com um sistema de viagens (opinião, a validar com cliente)
- **Sai do Movatruck:** viagem fechada com km, toneladas e valor (pro faturamento no ERP), acerto do motorista (contas a pagar), abastecimento e pedágio (custo por placa), status ao vivo (pro cliente final).
- **Entra no Movatruck:** cadastro de clientes, obras, materiais e placas vindo do ERP, pedido/programação, CT-e emitido (chave) pra amarrar na viagem.

### O que o embarcador (cliente da transportadora) pede
- **Status da carga e ocorrências.** O padrão nacional é o arquivo **OCOREN** do EDI PROCEDA. NOTFIS vai do embarcador pra transportadora, CONEMB devolve os CT-es, DOCCOB consolida a cobrança ([Bsoft: EDI PROCEDA](https://bsoft.com.br/bsoft-tms/edi-proceda), [Bsoft: EDI no transporte](https://bsoft.com.br/blog/edi-no-transporte-de-cargas)). Portais de embarcador aceitam upload desses arquivos ([Lincros: importação EDI no portal do transportador](https://intercom.help/ajudalincros/pt-BR/articles/13433313-tms-importacao-de-arquivo-edi-via-portal-do-transportador)).
- **POD / canhoto.** O comprovante de entrega eletrônico existe desde set/2019 e vira evento na NF-e/CT-e na SEFAZ ([NFe.io: canhoto digital](https://nfe.io/blog/nota-fiscal/canhoto-digital/), [NDD Cargo](https://mundologistica.com.br/noticias/nddcargo-agora-permite-antecipacao-de-recebimento-de-frete-pelas-transportadoras)).
- **Integração por hub.** A SSW faz ponte ERP ↔ transportadora por WebService: o pedido/NF vai, o status volta ([TekSystem: SSW](https://teksystem.com.br/tekwiki/images/d/d0/Logistica.SSW.pdf)). A Intelipost manda webhook de status pro e-commerce, com uma regra de evento por transportadora ([Intelipost: webhook](https://intercom.help/intelipost/pt-BR/articles/5527430-como-configurar-o-envio-de-notificacoes-via-webhook)).

**Opinião:** o cliente do Movatruck (basculante, agregado, concreto) raramente tem embarcador exigindo EDI. Mesmo assim, **OCOREN de saída** é o "fala a língua do mercado" mais barato que existe. Vale como item de onda tardia, não como fundação.

---

## 2. Como concorrentes e vizinhos expõem API

| Quem | API pública? | Estilo | Autenticação | Webhook | Docs / sandbox | Rate limit | Cobra à parte? |
|---|---|---|---|---|---|---|---|
| **Samsara** (frota, EUA) | Sim, liberada pra todo cliente ([KB](https://kb.samsara.com/hc/articles/360043860111)) | REST, cursor `after`/`endCursor`, endpoints `/feed` ([paginação](https://developers.samsara.com/docs/pagination)) | Token de API por organização, criado por admin. OAuth pra app de marketplace ([auth](https://developers.samsara.com/docs/authentication), [marketplace](https://developers.samsara.com/docs/webhooks-for-marketplace-apps)) | Sim. HMAC-SHA256 sobre `v1:<timestamp>:<body>`, headers `X-Samsara-Signature`/`-Timestamp`/`-Event-Type`. Até 5 tentativas com backoff exponencial ([webhooks](https://developers.samsara.com/docs/webhooks)) | Portal developers.samsara.com, SDK | 150 req/s por token, 200 req/s por org, mais níveis por endpoint. 429 com `Retry-After` ([rate limits](https://developers.samsara.com/docs/rate-limits)) | Não: "free, open API" ([KB](https://kb.samsara.com/hc/articles/360043860111)) |
| **Motive** (ex-KeepTruckin) | Sim ([OAuth](https://developer.gomotive.com/reference/authentication-oauth-20)) | REST | OAuth 2.0 com escopos `recurso.read`/`.manage` ([OAuth](https://developer.gomotive.com/reference/authentication-oauth-20)) | Sim. HMAC-**SHA1** em `X-KT-Webhook-Signature`. Resposta em até 3 s. Retry em 1 min, 1 h e 6 h. 403 não reenvia. Payload "gordo" ([webhooks v2](https://developer.gomotive.com/reference/webhooks-v2)) | Portal developer.gomotive.com | Não publicado: tem que pedir por e-mail ([Supergood](https://supergood.ai/docs/keeptruckin-motive-api)) | Não achei preço público |
| **Fleetio** (manutenção de frota) | Sim, self-serve, mas **só nos planos Professional e Premium** ([usecarly](https://www.usecarly.com/blog/fleetio-api/), [preços](https://www.fleetio.com/pricing)) | REST, paginação por página, **versão datada** (2025-05-05), Bulk API ([overview](https://developer.fleetio.com/docs/category/overview)) | `Authorization: Token` + `X-Fleetio-Account` ([Supergood](https://supergood.ai/docs/fleet-io-api)) | Sim. HMAC-SHA256 em `X-Fleetio-Webhook-Signature`, segredo por webhook. 5 tentativas na 1ª hora, depois de hora em hora por 24 h. Desativa após 3 falhas seguidas ([webhooks](https://developer.fleetio.com/docs/overview/webhooks)) | Portal developer.fleetio.com | Por plano: Professional = 50 req/min, 10 mil eventos de webhook/30 dias. Premium = webhook ilimitado ([Supergood](https://supergood.ai/api-report-card/fleetio)) | **Sim**: API e webhook entram como argumento de upgrade de plano |
| **Omie** (ERP BR) | Sim | JSON ou SOAP, **só POST**: GET foi vetado "por segurança" ([características](https://ajuda.omie.com.br/pt-BR/articles/5412721-caracteristicas-e-recomendacoes-das-apis-do-omie)) | `app_key` + `app_secret` no corpo ([idem](https://ajuda.omie.com.br/pt-BR/articles/5412721-caracteristicas-e-recomendacoes-das-apis-do-omie)) | Sim. Eventos tipo `pedido.incluido`, `nfe.emitida`, `financas.recebido`. FIFO, 3 tentativas rápidas, depois **DLQ** com 5 dias de retry a cada 10 min. Timeout de 7 s ([webhooks](https://ajuda.omie.com.br/pt-BR/articles/9565655-caracteristicas-e-recomendacoes-dos-webhooks), [eventos](https://ajuda.omie.com.br/pt-BR/articles/5412754-webhooks)). Não achei assinatura documentada | developer.omie.com.br, com teste logado | 960 req/min por IP. 240/min por IP+chave+método. 4 simultâneas. Bloqueio de 30 min após 10 erros seguidos. Consulta repetida do mesmo ID em 60 s é barrada ([limites](https://ajuda.omie.com.br/pt-BR/articles/8112984-limites-de-consumo-da-api-do-omie)) | Plano de entrada tem teto menor (Fit: 500/dia) ([limites](https://ajuda.omie.com.br/pt-BR/articles/8112984-limites-de-consumo-da-api-do-omie)) |
| **Bling** (ERP BR) | Sim, API v3 | REST | OAuth2 authorization code + refresh ([Koncili sobre Bling](https://developers.koncili.com/en/docs/direct-erp-integration/bling/technical-information/)) | Sim. HMAC-SHA256 em `X-Bling-Signature-256` (`sha256=...`), com o client secret. Retry crescente por até 3 dias, depois **desativa**. Resposta em até 5 s. **Sem garantia de ordem**, e pede idempotência de quem recebe ([webhooks](https://developer.bling.com.br/webhooks)) | developer.bling.com.br | ~3 req/s e 120 mil/dia ([Koncili](https://developers.koncili.com/en/docs/direct-erp-integration/bling/technical-information/)) | Não achei cobrança à parte |
| **Conta Azul** (ERP BR) | Sim | REST | OAuth2 authorization code ([Nango](https://nango.dev/docs/api-integrations/conta-azul/how-to-register-your-own-conta-azul-api-oauth-app)) | **Não tem** ([LinkAPI](https://developers.linkapi.solutions/docs/contaazul)) | Conta de dev de 30 dias com dados fictícios, em vez de sandbox ([LinkAPI](https://developers.linkapi.solutions/docs/contaazul)) | ~50 req/min, 429 ([LinkAPI](https://developers.linkapi.solutions/docs/contaazul)) | — |
| **ESL Cloud** (TMS BR) | Sim | REST, coleção Postman. URL com subdomínio do tenant (`<transportadora>.escloud.com.br`) ([Postman](https://documenter.gw.postman.com/view/metadata/2s9YXk2fj5)) | Token ([idem](https://documenter.gw.postman.com/view/metadata/2s9YXk2fj5)) | Não documentado | Postman | Intervalo mínimo por API e por IP, 429 ([idem](https://documenter.gw.postman.com/view/metadata/2s9YXk2fj5)) | — |
| **Senior** (TMS/roteirização BR) | Sim, em dev.senior.com.br | REST | **Login com usuário e senha** devolve `access_token` ([Senior](https://documentacao.senior.com.br/roteirizacaoemonitoramento/7.0.0/integracoes/integracao-via-api.htm)) | Não documentado | Portal de APIs | Throttling sem número publicado ([idem](https://documentacao.senior.com.br/roteirizacaoemonitoramento/7.0.0/integracoes/integracao-via-api.htm)) | — |
| **Sascar** (rastreador BR) | Sim | **SOAP/XML** (WSDL). Posições vêm em "pacote" com `idPacote`, por **polling** | Usuário e senha do integrador em cada chamada | Não. É polling | Manual em PDF | **1 consulta simultânea por integradora** nos métodos de posição ([SasIntegra v2.07](https://connectedfleet.michelin.com/hubfs/WebService_SasIntegra_v2.07_Portugues.pdf)) | — |

**Opinião:**
- O nível brasileiro é baixo. Um Movatruck com REST + OpenAPI gerado do código + webhook assinado + sandbox já fica **acima de todo TMS/ERP nacional pesquisado** e no nível da Fleetio.
- Login com usuário e senha (Senior, Sascar) é o que **não** fazer. A credencial de integração tem que ser separada da pessoa: se o funcionário sai, a integração não pode morrer junto.
- Motive ainda usar HMAC-SHA1 é legado. SHA-256 é o mínimo hoje.
- Desativação automática do webhook (Fleetio, Bling) é comum, mas tem que vir com aviso por e-mail/WhatsApp. Senão o cliente descobre semanas depois que parou de receber.

---

## 3. Padrões que viraram obrigação em API B2B

| Padrão | Como o mercado faz | Fonte |
|---|---|---|
| **Idempotency key** | Header `Idempotency-Key` (UUID) em todo POST. O servidor guarda o status e o corpo da 1ª resposta, inclusive erro, por pelo menos 24 h. Mesma chave com parâmetros diferentes dá erro. Está virando padrão IETF | [Stripe](https://docs.stripe.com/api/idempotent_requests), [IETF draft-07](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header) |
| **Paginação por cursor** | `limit` + `after=<cursor>`, devolve `endCursor`/`hasNextPage`. Offset fica lento e pula ou duplica registro com escrita concorrente (no Slack, offset profundo dava p99 > 8 s) | [Slack Engineering](https://slack.engineering/evolving-api-pagination-at-slack/), [Samsara](https://developers.samsara.com/docs/pagination) |
| **Sincronização incremental** | `updated_since`, ou melhor, um **feed com cursor** que devolve "tudo que mudou desde o cursor". O cursor vale 30 dias, e a página pode vir vazia com `hasNextPage=true` | [Samsara feed](https://developers.samsara.com/docs/pagination) |
| **Versionamento** | Na URL (`/v1`, Stripe/Salesforce) ou por data (Fleetio `2025-05-05`, Stripe também por header). O evento congela a versão de quando foi criado | [Fleetio](https://developer.fleetio.com/docs/category/overview), [Stripe webhooks](https://docs.stripe.com/webhooks) |
| **Depreciação** | Headers `Deprecation` (RFC 9745) e `Sunset` (RFC 8594). O sunset nunca vem antes da depreciação | [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html), [resumo RFC 8594](https://www.gravitee.io/corpus/gen-1889/api/api-deprecation-headers-and-sunset-communication-strategies.html) |
| **Assinatura de webhook** | HMAC-SHA256 sobre `id.timestamp.corpo_cru`, tolerância de 5 min contra replay, comparação em tempo constante, rotação de segredo com 2 segredos válidos por até 24 h. Existe spec aberta (**Standard Webhooks**: `webhook-id`, `webhook-timestamp`, `webhook-signature`) com bibliotecas prontas | [Stripe](https://docs.stripe.com/webhooks), [Standard Webhooks (resumo)](https://webhookrelay.com/verify-standard-webhooks-signature.md), [Samsara](https://developers.samsara.com/docs/webhooks) |
| **Retry / DLQ** | Backoff exponencial: Stripe por 3 dias, Bling 3 dias, Fleetio 24 h, Omie com DLQ de 5 dias. Reenvio manual pelo painel (Stripe: 15 dias) e tela de entregas com status | [Stripe](https://docs.stripe.com/webhooks), [Bling](https://developer.bling.com.br/webhooks), [Fleetio](https://developer.fleetio.com/docs/overview/webhooks), [Omie](https://ajuda.omie.com.br/pt-BR/articles/9565655-caracteristicas-e-recomendacoes-dos-webhooks) |
| **Timeout curto** | Quem recebe responde 2xx rápido e processa em fila: Motive 3 s, Bling 5 s, Omie 7 s | [Motive](https://developer.gomotive.com/reference/webhooks-v2), [Bling](https://developer.bling.com.br/webhooks), [Omie](https://ajuda.omie.com.br/pt-BR/articles/9565655-caracteristicas-e-recomendacoes-dos-webhooks) |
| **Thin vs fat** | Stripe agora **recomenda thin**: o evento leva só o id, e quem recebe busca o objeto atual. O snapshot (fat) fica pra quem não pode chamar de volta. Motive manda fat | [Stripe](https://docs.stripe.com/webhooks), [Motive](https://developer.gomotive.com/reference/webhooks-v2) |
| **Ordem e duplicado** | "Não garantimos ordem" (Stripe, Bling). Deduplicar pelo id do evento. Não usar `created` pra ordenar | [Stripe](https://docs.stripe.com/webhooks), [Bling](https://developer.bling.com.br/webhooks) |
| **External ID + upsert** | Salesforce: `PATCH /sobjects/Obj/campoExterno/valor` cria ou atualiza. Se casar mais de 1, dá **300** e não grava. `updateOnly` impede criação. Samsara: `externalIds` em mapa chave:valor (até 30 chaves por tipo), busca por `/drivers/sistema:valor`, valor único por org | [Salesforce](https://developer.salesforce.com/docs/platform/api-rest/guide/dome-upsert.html), [Samsara external IDs](https://developers.samsara.com/docs/external-ids) |
| **Rate limit** | 429 + `Retry-After` | [Samsara](https://developers.samsara.com/docs/rate-limits) |
| **Sandbox** | Ambiente/modo de teste com segredo diferente (Stripe). Conta de dev com dados fictícios (Conta Azul) | [Stripe](https://docs.stripe.com/webhooks), [LinkAPI/Conta Azul](https://developers.linkapi.solutions/docs/contaazul) |

**Opinião sobre o que copiar:**
- **External ID em mapa** (`externalIds: {"erpX": "123"}`), no estilo Samsara, é melhor que uma coluna `idExterno` única. O cliente pode ter ERP e TMS ao mesmo tempo, cada um com o seu id. Hoje o schema só tem `idExterno` em `WhatsappMensagem`; nenhuma entidade de negócio tem.
- **Standard Webhooks** em vez de inventar formato: o cliente usa biblioteca pronta pra verificar.
- **Thin + endpoint de leitura** combina com as nossas regras de valor materializado e congelado (`ViagemValor`). O evento diz "a viagem X mudou" e a leitura devolve o estado atual coerente. Evita mandar um snapshot que o reprocessamento de km invalida minutos depois.
- **Feed incremental com cursor** é obrigatório, não opcional. Webhook perde evento, e o cliente precisa de um jeito de reconciliar.

---

## 4. Os dois casos do dono vistos pelo mercado

### (a) O sistema do cliente cria viagens e ele usa só o painel
- **Padrão:** upsert por external ID (Salesforce, Samsara) com `Idempotency-Key` ([Salesforce](https://developer.salesforce.com/docs/platform/api-rest/guide/dome-upsert.html), [Stripe](https://docs.stripe.com/api/idempotent_requests)). Os cadastros que a viagem referencia (motorista, placa, local, material) também precisam de external ID. Senão o cliente tem que aprender os nossos UUIDs.
- **Armadilhas conhecidas:**
  - **Duplicação no retry de rede:** resolve com idempotency key mais unicidade do external ID ([Stripe](https://docs.stripe.com/api/idempotent_requests)).
  - **Match ambíguo:** mais de um registro com o mesmo external ID tem que dar erro explícito, nunca escolher um ([Salesforce: 300](https://developer.salesforce.com/docs/platform/api-rest/guide/dome-upsert.html)).
  - **Rate limit do lado deles:** Omie barra consulta repetida e bloqueia por 30 min após 10 erros ([Omie](https://ajuda.omie.com.br/pt-BR/articles/8112984-limites-de-consumo-da-api-do-omie)). Quem integra com ERP brasileiro precisa de fila e de backoff.
- **Opinião, específico do Movatruck:**
  - Viagem que entra pela API tem que passar pelas **mesmas regras** do lançamento: `STATUS_FORA_FECHAMENTO`, `RegraMinimo`, `TabelaPreco` → `ViagemValor`, `checarAlteracaoKm`, `chave-fiscal`. Senão vira uma segunda porta de entrada sem trava.
  - O `km` que vem do sistema do cliente não é o `kmMotorista`. Precisa de um carimbo de origem (`origem: "api"`), e a regra "o km do motorista é lei" tem que dizer o que vale quando não houve motorista no app.
  - A regra da casa "lançamento nunca é recusado" (vale pro motorista no app) **não** vale pra API. Integração quer 4xx claro com `issues`, porque é máquina e não motorista na estrada.

### (b) O cliente usa nosso app e quer os dados no sistema dele
- **Padrão:** webhook assinado pra "aconteceu agora", mais feed/listagem incremental por cursor pra reconciliar e pra carga inicial ([Samsara feed](https://developers.samsara.com/docs/pagination), [Stripe: recuperar objeto ausente via API](https://docs.stripe.com/webhooks)).
- **Armadilhas conhecidas:**
  - **Ordem:** "viagem.finalizada" pode chegar antes de "viagem.criada" ([Stripe](https://docs.stripe.com/webhooks), [Bling](https://developer.bling.com.br/webhooks)). Mitigação: evento thin com `version`/`updated_at` do objeto, e quem recebe busca o estado atual.
  - **Duplicado:** dedupe por id do evento ([Stripe](https://docs.stripe.com/webhooks)).
  - **Webhook desativado em silêncio** após falhas ([Fleetio](https://developer.fleetio.com/docs/overview/webhooks), [Bling](https://developer.bling.com.br/webhooks)).
- **Opinião, específico do Movatruck:**
  - Nossos dados **mudam depois de "prontos"**: o reprocessamento de km por cron, a viagem que sai de `AGUARDANDO_PESO`, o valor alterado à mão com motivo, o acerto que fecha e depois é pago. O cliente precisa receber `*.atualizada` por esses caminhos também, não só pelos endpoints HTTP. **O emissor de evento tem que morar perto da escrita** (outbox no banco), não no controller.
  - Viagem `EM_ANDAMENTO`/`AGUARDANDO_PESO` precisa ser **marcada como incompleta** no payload, senão o ERP fatura 0 t (o mesmo furo do `STATUS_FORA_FECHAMENTO`).
  - O pedágio em dobro reaparece aqui: expor `valorPedagioTotal` e as linhas de `Pedagio` lado a lado convida o cliente a somar os dois. A API tem que expor o **pedágio já decidido** (`pedagioDaViagem`).

### Quem é a fonte da verdade (vale pros dois casos)
- **Opinião:** a regra de mercado é **um dono por campo, não por registro**. Exemplo: o cliente é dono do cadastro de cliente/obra (entra via API, painel só lê), e o Movatruck é dono de km, peso e valor (sai via API, o cliente só lê). Edição dos dois lados sem dono definido gera "last write wins" e briga. Salesforce e Samsara resolvem o *casamento* (external ID), não o *conflito*. O conflito é decisão de produto. **Essa é uma decisão pro dono.**

---

## 5. O que o cliente exige pra assinar, e quanto se cobra

### Exigências
- **LGPD:** o contrato tem que dizer quem é controlador (a transportadora) e quem é operador (o Movatruck), quais as categorias de dado (CPF, localização do motorista), quem são os suboperadores (hospedagem, provedores de IA, WhatsApp), o prazo de aviso de incidente (o mercado usa 24–48 h), direito de auditoria e devolução dos dados no fim do contrato em formato utilizável ([Confidata: DPA](https://confidata.com.br/blog/como-elaborar-dpa-data-processing-agreement), [Legale: cláusulas SaaS+LGPD](https://legale.com.br/blog/digital-contratos-de-tecnologia-saas-lgpd-guia-de-clausulas-essenciais/), [Campos Thomaz: cartilha](https://camposthomaz.com/wp-content/uploads/2023/12/Cartilha_como-adequar-meus-contratos-a-lgpd.pdf)). **Opinião:** a API **é** a ferramenta de "devolução dos dados no fim do contrato". Vira argumento de venda.
- **Questionário de segurança:** é pré-requisito em mid-market e enterprise. Cobre controle de acesso, proteção de dados, resposta a incidente e SOC 2/ISO 27001. Pergunta por SSO, MFA, log de acesso e revogação de sessão ([Vera](https://www.getvera.ai/blog/saas-security-questionnaire), [SSOJet](https://ssojet.com/blog/insurance-it-vendor-security-questionnaire-sso-scim)). **Opinião:** o cliente-alvo (3–100 caminhões) não pede SOC 2. O que ele pede é "quem tem a chave, como revogo, onde vejo o que foi acessado". Ou seja: tela de credenciais com escopo, último uso e revogação, mais log de chamadas.
- **SLA / uptime:** a Samsara promete 99,99% no software hospedado, com crédito em dias de licença (3 a 30 dias). O SLA dela **não cita a API** explicitamente ([Samsara SLA](https://www.samsara.com/hosted-software-sla)). Status page pública ([samsarastatus.com](https://www.samsarastatus.com)). **Opinião:** com uma VPS só (e a queda de 22/09/2026), prometer 99,9% em contrato é risco. Melhor uma página de status honesta e um SLA de **entrega de webhook** (retry por N dias mais reenvio manual) do que um número de uptime.
- **Documentação:** todos os bons têm portal com referência gerada, exemplos e quickstart (Samsara, Fleetio, Bling). Os fracos têm PDF (Sascar) ou Postman (ESL). Ver links na seção 2.

### Preço da API no mercado
- **Inclusa pra todos:** Samsara ([KB](https://kb.samsara.com/hc/articles/360043860111)).
- **Gate por plano:** Fleetio. Essential (US$ 4/veículo/mês) não tem API nem webhook. Professional (US$ 7) tem 50 req/min e 10 mil eventos/mês. Premium (US$ 10) tem webhook ilimitado ([usecarly](https://www.usecarly.com/blog/fleetio-api/), [Fleetio pricing](https://www.fleetio.com/pricing)).
- **Teto por plano:** Omie limita conta Trial/Fit a 60 req/min e 100–500 por dia ([Omie](https://ajuda.omie.com.br/pt-BR/articles/8112984-limites-de-consumo-da-api-do-omie)).
- **TMS brasileiros:** não achei preço público de "módulo de API" (Bsoft, ESL, Senior, Brudam). Na prática é negociado.
- **Opinião:** casa com o `ModuloContratado` que já existe. "Integrações (API e webhooks)" como **módulo próprio**, com leitura básica liberada e escrita + webhook no módulo, segue o modelo Fleetio. E a cota (req/min e eventos/mês) é a alavanca de preço, não o liga/desliga.

---

## 6. Decisões que essa pesquisa joga pro dono (não respondidas aqui)
1. **Dono por campo:** num registro que vem do sistema do cliente, o painel pode editar? O que vence na próxima sincronização?
2. **API como módulo pago ou inclusa?** (Fleetio cobra, Samsara não.)
3. **Viagem criada pela API passa pelas regras do lançamento**, incluindo mínimo, preço e auditoria de km? (Minha opinião: sim, sem exceção.)
4. **EDI PROCEDA (OCOREN)** entra no roadmap ou fica só REST?
