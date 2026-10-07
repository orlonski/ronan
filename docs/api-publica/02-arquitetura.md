# API pública e integrações — arquitetura

**Autor:** api-arquiteto (squad API Pública). **Data:** 07/10/2026. **Status:** desenho, nada implementado.
Caminhos relativos à raiz do repo; `api/` = `apps/api/src/`, `schema` = `apps/api/prisma/schema.prisma`.

---

## 0. Resumo em 12 linhas

1. A casa já tem quase todas as peças: trava multi-tenant automática, Zod como contrato de entrada, idempotência por `clientId`, boot-checks que derrubam a subida, segredo comparado em tempo constante, fila com `FOR UPDATE SKIP LOCKED`, advisory lock de cron e registro de toda chamada que sai.
2. **Não existe:** credencial de máquina, contrato de SAÍDA (resposta) em Zod, OpenAPI útil, paginação por cursor, rastro de exclusão, evento de domínio, identificador externo.
3. **O Swagger de `/docs` não documenta nada que importe:** só `@ApiTags`/`@ApiBearerAuth`, nenhum corpo e nenhuma resposta. E está aberto em produção com o mapa da API interna inteira.
4. API pública = **novo prefixo `v1/*`**, controllers próprios, com contrato público em Zod separado do interno e envelope de erro único.
5. Credencial = **chave de API própria** (`mvt_live_<prefixo>_<segredo>`, hash SHA-256), com **novo `kind: "INTEGRACAO"`** no `AuthUser`. O JWT dela não existe e o segredo não volta nunca.
6. Escopos = **chaves do catálogo de permissões que já existe** (`viagens.ver`, `viagens.editar`…), podadas pelo `tetoDaConta()`. Assim o módulo contratado vale de graça.
7. Três guards precisam mudar pra não abrir a porta: `ModuloGuard` deixa passar quem não é ADMIN (`api/common/modulos/modulo.guard.ts:51`), `PermissaoGuard` recusa quem não é ADMIN (`:24`), e o `RolesGuard` exige o `Record` completo.
8. Toda escrita da API passa por um **serviço de domínio** (`ViagemEntradaService`) que chama as mesmas regras do app: mínimo, preço, conferência, km, programação. Ela nunca chama `prisma.viagem.create` direto, que é o furo de hoje da importação.
9. Saída = **outbox transacional de verdade**: trigger no Postgres grava `registro_alteracoes` (entidade, id, operação, `xid8`), e o mesmo log alimenta a sincronização incremental (com exclusões) e os webhooks `*.atualizado`. Eventos de negócio (`viagem.finalizada`, `acerto.fechado`) são emitidos à mão em poucos pontos, dentro da transação.
10. Entrega de webhook: HMAC-SHA256 com timestamp (padrão Stripe), backoff até 24h, desligamento automático, reentrega manual e tela de entregas por empresa.
11. Identificador externo = **tabela genérica `VinculoExterno`** (conta, sistema, entidade, idExterno ↔ id). Não é coluna em cada tabela, porque a empresa terá ERP + rastreador + app próprio ao mesmo tempo.
12. A documentação sai do Zod (`@asteasolutions/zod-to-openapi`, que é dependência nova) num `/v1/openapi.json` + Scalar em `/v1/docs`, com boot-check que derruba a subida se uma rota `v1/*` não tiver contrato, e teste de snapshot que obriga a mexer no changelog.

---

## 1. O que existe hoje

### 1.1 Autenticação

| Peça | Evidência | Serve pra API pública? |
|---|---|---|
| `JwtAuthGuard` global, pula se `@Public()` | `api/auth/guards/jwt-auth.guard.ts:12-19`; registrado em `api/auth/auth.module.ts:42` | Atrapalha: chave de API não é JWT. O atalho da casa (`@Public()` + guard próprio, como o ClickUp em `api/clickup-runner/webhook.controller.ts:52-53`) **não serve aqui**: os guards globais de permissão/módulo rodariam antes e veriam `req.user` vazio (§3.3). A chave vira uma segunda estratégia passport. |
| Quatro `kind`: `ADMIN_USER`, `MOTORISTA`, `IDENTIDADE`, `FUNCIONARIO` | `api/auth/types.ts:4-127` | O union serve: adicionar `AuthIntegracao` faz o `Record` do `RolesGuard` virar erro de compilação (`api/auth/guards/roles.guard.ts:16`), que é exatamente o que se quer. |
| `JwtStrategy.validate` recarrega usuário/conta/papel do banco a cada request e chama `definirConta()` | `api/auth/strategies/jwt.strategy.ts:67-132` | O **padrão** serve: revogação vale na hora, estado da conta (`estadoDaConta`, `:95`) é checado. O guard da chave copia isso. |
| Access token de 15 min + refresh | `JwtPayload.type` em `api/auth/types.ts:129-133` | Não serve pra máquina: integração não faz refresh. |
| Token também por `?access_token=` | `jwt.strategy.ts:44-47` | Não reproduzir na v1: chave em query string vaza em log de proxy. |

### 1.2 RBAC e módulo contratado

- `@RequerPermissao` + `PermissaoGuard` **global** (`auth.module.ts:44`). É fail-open (sem decorator passa, `permissao.guard.ts:20`) e recusa todo `kind` que não seja ADMIN (`:24`).
- `ModuloGuard` global (`api/common/modulos/modulos.module.ts:25`) deriva o módulo da chave de permissão. **Linha 51: `if (!user || user.kind !== "ADMIN_USER") return true;`**. Um `kind` novo passaria por ele sem checagem de contrato. É o furo nº 1 a fechar.
- Boot-check (`api/common/modulos/modulos.boot-check.ts:37-120`) só olha `admin/*` e quem declara `@Roles("ADMIN_USER")`. Rota `v1/*` hoje **não seria vista**, e precisa de boot-check próprio (ver §6.4).
- `tetoDaConta()` (`api/common/conta/teto-da-conta.ts:127`) + `acimaDoTeto()` (`:163`) já podam chave acima do que a empresa comprou. É a régua certa pros escopos da credencial.
- O catálogo de recursos (`packages/shared-types/src/permissoes.ts:105-233`) e o de módulos (`packages/shared-types/src/modulos.ts:80-280`, `moduloDaChave` em `:296`) são a fonte dos escopos.
- `SomenteLeituraGuard` (`api/auth/guards/somente-leitura.guard.ts`) barra escrita de conta em somente leitura por `user.contaSomenteLeitura`. A integração **precisa carregar esse campo**, senão um trial vencido continua escrevendo por API.
- `CapacidadeAppGuard` só age em MOTORISTA/FUNCIONARIO (`api/auth/guards/capacidade-app.guard.ts:96`). Fica neutro, o que está certo.

### 1.3 Multi-tenant

- `ContaMiddleware` abre contexto vazio em toda requisição (`api/common/conta/conta.middleware.ts:19-22`). A trava `travaConta` injeta `contaId` em todo where/data (`api/common/conta/trava-conta.ts:328-366`) e **lança** sem conta (`:346`). O guard da chave só precisa chamar `definirConta(credencial.contaId)` (`api/common/conta/conta-context.ts:104`) e tudo abaixo fica isolado de graça.
- `MODELS_GLOBAIS` (`trava-conta.ts:33`): as tabelas novas `ApiCredencial`, `WebhookEndpoint` etc. **são escopadas** (têm `contaId`). Uma só entra em global, por decisão consciente: o lookup da chave pelo prefixo, que roda em `comoSistema` (mesmo padrão de `jwt.strategy.ts:71`).
- SQL cru não passa pela trava (`trava-conta.ts:18`). O dispatcher de webhook e o leitor do log de alterações são SQL cru, então filtram `contaId` na mão.

### 1.4 Validação e erros

- `ZodValidationPipe` (`api/common/zod-validation.pipe.ts:14-27`) devolve `400 { message, issues:[{path,code,message}] }`. É bom e entra no envelope público quase sem mudar.
- `ValidationPipe` global com `forbidNonWhitelisted` (`api/main.ts:68`) é inócuo pra parâmetro tipado por Zod.
- **Não há `ExceptionFilter` global.** Hoje convivem três formatos: o padrão do Nest (`{statusCode,message,error}`), o do Zod (`{message,issues}`) e o do módulo (`{code,modulo,nomeModulo,pitch,message}`, `modulo.guard.ts:82-88`). A v1 precisa de filtro próprio.
- **Zod descarta chave não declarada** (memória `feedback_zod_descarta_chave_nao_declarada`): na API pública isso é perigoso, porque o integrador manda `externalId` com nome errado, recebe 200 e nada acontece. Contrato público usa `.strict()`.
- Paginação hoje é **offset** (`api/common/pagination/pagination.schema.ts:14-20`, `page/pageSize`), e nenhuma lista usa cursor, a não ser chat/notificação/despesa.

### 1.5 Swagger em `/docs`: o que ele documenta de verdade

- `api/main.ts:70-78`: `DocumentBuilder` + `SwaggerModule.setup("docs")`, **sem condição de ambiente**: está no ar em produção.
- Decoradores em uso no código todo: `@ApiTags` (129), `@ApiBearerAuth` (137), `@ApiExcludeController` (17). **Zero** `@ApiProperty`/`@ApiBody`/`@ApiResponse`. Os corpos são `@Body(new ZodValidationPipe(X)) body: X` com tipo inferido do Zod (ex.: `api/admin/viagens/viagens.controller.ts:243`), que o Swagger não enxerga.
- Resultado: `/docs` lista caminhos e verbos, sem corpo, resposta nem erro. Serve de índice, não de contrato. E expõe o mapa da superfície interna (`admin/*`, `m/*`) a qualquer um. **Recomendação colateral: gatear `/docs` atrás de env (`SWAGGER_INTERNO=1`) já na 1ª onda.**
- Saída: não existe Zod de **resposta**. As respostas são serializadas à mão (ex.: `serializarViagemComMinimos` em `api/motorista/viagens.service.ts:1428`). O contrato público de saída tem que nascer.

### 1.6 Endpoints `@Public` com segredo: o padrão da casa

- ClickUp: `@Public()` + `@UseGuards(RateLimitIpGuard, RunnerTokenGuard)` (`api/clickup-runner/webhook.controller.ts:52-57`). Rate limit em memória por IP, **antes** do guard de segredo (`api/clickup-runner/rate-limit-ip.guard.ts:13-35`, `api/common/rate-limit/contador-janela`).
- Meta: HMAC-SHA256 do corpo **cru**, preservado só naquele path (`api/main.ts:59-63`; conferência em `api/whatsapp/meta-webhook.controller.ts:475-482`).
- Comparação em tempo constante: `segredoConfere` (`api/common/seguranca/segredo.ts:11-16`), `link-assinado.ts:17-32`.
- Cifra de segredo que precisa voltar em claro: `cifrar/decifrar` AES-256-GCM com sal por finalidade (`api/common/cripto.ts:35-74`). É exatamente o que o **segredo de assinatura do webhook** precisa (nós assinamos, então precisamos dele em claro). A **chave de API** não: ela vai só com hash.

### 1.7 `clientId`: idempotência do outbox

- `Viagem.clientId String @unique`, **global, não por conta** (`schema:4520`). Mesmo vale `Abastecimento.clientId` (`schema:6326`) e `Pedagio.clientId` (`schema:5350`). Já `Despesa` é `@@unique([motoristaId, clientId])` (`schema:9151`).
- O create do app é idempotente por `clientId` (`api/motorista/viagens.service.ts:1417-1429`), e o da importação deriva um `clientId` sintético `import:<sha1>` (`api/admin/importacao/importacao.service.ts:328-345`).
- **Por que não serve de idempotência pública:** sendo único global, um `clientId` escolhido pelo integrador que colida com outra empresa faz o `findUnique`, já filtrado pela trava, não achar nada. Aí o `create` estoura **P2002 → 500**, e pior: dá pra **sondar se o valor existe noutra empresa**. Na API pública o `clientId` é gerado por nós (`api:<credencialId>:<chave de idempotência>`), e o `externalId` do integrador vive em `VinculoExterno`, que é por conta.

### 1.8 Importação por planilha (`admin/importacao`)

- `importacao.controller.ts:109-135` (`analisar`/`aplicar`), `importacao.service.ts:310-399` (`gravarViagem`).
- Funciona como upsert por chave natural, e é o mais próximo que existe de "entrada de sistema externo". Mas **fura regras**, e a API não pode copiar isso:
  - grava com `prisma.viagem.create/update` direto (`:382-388`): **não** enfileira conferência, **não** chama precificação, **não** casa com programação nem roda km atípico, que são os efeitos de `api/motorista/viagens.service.ts:1759-1779`;
  - no **update** (reimportar a mesma linha) sobrescreve `km` **sem `checarAlteracaoKm`** (`:382`). Fura "o km do motorista é lei" se a viagem tiver nascido no app e colidido de assinatura. Na prática é improvável (o `clientId` é `import:`), mas é o padrão errado. **Defeito a registrar.**
- Os **resolvedores por nome** (`contextoDeViagens`, `acharMotorista`, `normalizar`, `:434-490`) servem pra API como fallback de casamento (placa, CPF, nome normalizado) quando não há `externalId`.

### 1.9 Registro de chamadas externas

- `instalarRegistroDeChamadas()` envelopa o `fetch` global antes de qualquer SDK (`api/main.ts:1-5`; `api/common/chamadas-externas/interceptor.ts`). Grava em `ChamadaExterna` (`schema:1902-1928`) com `contaId` e `gatilho`.
- **Consequência boa:** toda entrega de webhook que sair por `fetch` aparece sozinha na tela da plataforma.
- **Consequência ruim:** a tela é da plataforma (`@UseGuards(RolesGuard, PlataformaGuard)`, `api/admin/chamadas-externas/chamadas-externas.controller.ts:28`), e guarda o **corpo** (`pedido Json`). Payload de webhook com dado do cliente iria parar num log da casa. Precisa (a) de um serviço nomeado "Webhooks de clientes" em `servicoDoHost` (`registro.ts:32`) com `pedido` **não** guardado (só tamanho e status), e (b) de tela própria **por empresa** (`WebhookEntrega`). Não dá pra reaproveitar a tela da plataforma.

### 1.10 Auditoria

- `AuditLog` (`schema:5515-5535`): `usuarioId → User?`, `entidade`, `entidadeId`, `acao AcaoAuditoria` (`schema:190`), `valorAntes/Depois`, `motivo`, `metadata`. `AuditoriaService.log/logDiff` (`api/auditoria/*.service.ts:23-60`).
- A integração não é `User`. Proposta: coluna `credencialId String?` no `AuditLog` + ações `INTEGRACAO_CRIOU`, `INTEGRACAO_ALTEROU`, `INTEGRACAO_ALTEROU_KM`. Não inventar "usuário de serviço" com senha falsa.

### 1.11 Datas de alteração, exclusão e o que isso significa pra sincronização

- 90 models têm `@updatedAt`, com **três nomes**: `alteradoEm` (85), `atualizadoEm` (4), `alteradaEm` (1). Nas entidades da 1ª onda todos têm `alteradoEm`: Viagem (`schema:4746`), Motorista, Veiculo, Local, Cliente, Empresa, Material, Transportadora, Pedido, ViagemPlanejada, AcertoMotorista, ViagemValor, Abastecimento, Despesa.
- **`Pedagio` não tem `@updatedAt`** (`schema:5346-5379`).
- **`@updatedAt` não é confiável como cursor:**
  1. só o Prisma Client carimba, e `UPDATE` cru não (há 5, nenhum em tabela exposta hoje: `grep 'UPDATE "'`);
  2. relógio de aplicação + transações longas: uma linha com `alteradoEm = 10:00:00.100` pode commitar **depois** de o integrador ter lido "até 10:00:00.200". Some pra sempre;
  3. **filho não mexe no pai**: trocar o `ViagemValor` (preço), uma foto ou um trecho não muda `Viagem.alteradoEm`.
- **Exclusão é física:** `prisma.viagem.delete` em `api/admin/viagens/viagens.service.ts:1613`, `api/admin/viagem-lifecycle/viagem-lifecycle.service.ts:287`, `api/motorista/viagens.service.ts:1256` e `:2579`. Sem lápide, o sistema do cliente **nunca descobre** que a viagem sumiu.
- Conclusão: `atualizadoDesde` por timestamp vira só conveniência. A sincronização séria usa o **log de alterações com cursor por transação** (§4.2).

### 1.12 Onde as entidades são escritas (pontos de disparo)

Contagem de `prisma.<model>.(create|update|upsert|delete…)` fora de spec/scripts:

- **Viagem: 19 arquivos.** App (`motorista/viagens.service.ts`, 12), painel (`admin/viagens/viagens.service.ts`, 8), lifecycle admin, importação, CT-e, locais (mesclar), conferência por IA (`conferencia-ticket/aplicar-veredito.service.ts`, 6), fechamento (`fechamentos/fechamento-processor.service.ts`), km reprocessamento (cron), km atípico, etapas, tag de pedágio, transportadora.
- Abastecimento: 3 · Pedágio: 2 · AcertoMotorista: 2 · Motorista: 18 · Veículo: 6 · Local: 5 · Despesa: 3.
- Não há `EventEmitter2`/`@OnEvent` no projeto.
- **Conclusão:** emitir evento "à mão" em cada ponto é inviável (19 só pra Viagem, e o 20º chega amanhã sem ninguém lembrar). Mudança de dado se captura **no banco**. Evento **de negócio** se emite à mão, em poucos pontos com nome.

### 1.13 Quem processa em segundo plano

- `ronan_agente` (`api/agente-main.ts`) é o worker do **agente de desenvolvimento** (ClickUp), sem conta, que apaga `ANTHROPIC_API_KEY` do ambiente. **Não** é lugar pra entregar webhook de cliente.
- Pra fila: `FOR UPDATE SKIP LOCKED` + `recuperarPresas` (`api/clickup-runner/fila.service.ts:88-121`). Pra cron: `cron-exclusivo.ts` (advisory lock). O dispatcher de webhooks copia os dois e roda **na API** (1 réplica hoje). Com volume, vira entrypoint próprio (`dist/integracoes-main.js`) no mesmo molde do agente.
- Triggers em migration já têm precedente: `ponto_marcacao_append_only` (`prisma/migrations/20260920160000_modulo_ponto/migration.sql:456-463`).

### 1.14 Nomes que vão confundir o integrador

`Empresa` = **quem paga** e `Cliente` = **obra** (memória `project_cliente_obra`). Expor o nome do model seria um desastre de suporte. Na v1: `/v1/clientes` → model `Empresa`, `/v1/obras` → model `Cliente`. O tradutor mora no contrato público, e o banco não muda. E a pasta `api/assinaturas/` já é a **cobrança do Asaas**, então o model de webhook **não** pode se chamar "Assinatura": fica `WebhookEndpoint`.

---

## 2. API pública (entrada e leitura)

### 2.1 Forma

- **Prefixo `v1/`** (ex.: `POST /v1/viagens`), versão no caminho. Não `admin/v1`: o boot-check, os guards e os testes tratam `admin/*` como "painel humano".
- REST + JSON, datas ISO-8601 com fuso, dinheiro como **string decimal** (`"1234.50"`, nunca float, porque `Decimal(12,2)` vira float e perde centavo no JS do integrador), ids nossos UUID.
- Pasta nova `api/publica/` (módulo `PublicaModule`), um controller por recurso, **sem** reaproveitar os controllers de `admin/*`: contrato público congelado ≠ tela que muda toda semana.
- Contrato em `packages/shared-types/src/publica/*.ts`, com entrada **e** saída, `.strict()`. É a fonte do OpenAPI (§6).

### 2.2 Recursos da 1ª onda

| Recurso | Model | Ler | Escrever | Por quê |
|---|---|---|---|---|
| `viagens` | Viagem (+ ViagemValor, trechos, fotos como URL assinada) | sim | criar/atualizar/cancelar | caso 1 e caso 2 |
| `motoristas` | Motorista | sim | upsert (sem senha, sem app) | viagem exige `motoristaId` (`schema` Viagem, não-nulo) |
| `veiculos` | Veiculo | sim | upsert | viagem exige `veiculoId` |
| `locais` | Local | sim | upsert | carga/descarga; **sem chave natural** no banco (Local não tem `@@unique`) → `externalId` é essencial |
| `clientes` | Empresa | sim | upsert | quem paga |
| `obras` | Cliente | sim | upsert | |
| `materiais` | Material | sim | upsert | `@@unique([contaId,nome])` |
| `abastecimentos` | Abastecimento | sim | — (2ª onda) | caso 2 |
| `pedagios` | Pedagio + `Viagem.valorPedagioTotal` | sim | — | **só leitura e já resolvida por `pedagioDaViagem`** (`common/acerto-motorista.ts`), senão o ERP soma em dobro |
| `acertos` | AcertoMotorista | sim (FECHADO/PAGO) | — | caso 2 |
| `alteracoes` | registro_alteracoes | sim | — | sincronização incremental (§4.2) |

Fora da 1ª onda: pedidos/programação, despesas, CT-e, ponto (dado trabalhista: decisão do dono).

### 2.3 Upsert por identificador externo

`PUT /v1/viagens/externo/{sistema}/{idExterno}` cria ou atualiza. `POST /v1/viagens` com `externo: {sistema, id}` no corpo também resolve pelo vínculo. Referências no corpo aceitam **id nosso OU externo**:

```json
{ "motorista": { "externo": "erp:MOT-889" }, "veiculo": { "placa": "ABC1D23" },
  "localCarga": { "id": "8f0c…" }, "material": { "externo": "erp:BRITA1" } }
```

Ordem de resolução por referência: `id` → `externo` (VinculoExterno) → chave natural (placa, CPF, CNPJ, nome normalizado reaproveitando `normalizar` da importação). Referência não resolvida **não recusa a viagem**: segue a regra "lançamento nunca é recusado" (memória `project_lancamento_nunca_recusado`, `motorista/viagens.service.ts:1431-1439`). Ela entra com carimbo de divergência (`common/divergencias.ts`) e a resposta lista `avisos[]`. **Exceção:** motorista e veículo são não-nulos no schema, então sem eles a resposta é `422 REFERENCIA_OBRIGATORIA`.

### 2.4 Idempotência

Duas camadas, porque resolvem coisas diferentes:

1. **`Idempotency-Key` (header)** em todo POST: tabela `ApiIdempotencia(contaId, credencialId, chave, hashCorpo, status, resposta, expiraEm 24h)`. Mesma chave com mesmo corpo devolve a mesma resposta. Mesma chave com corpo diferente devolve `422 IDEMPOTENCIA_CONFLITO`. Protege o "deu timeout, mandei de novo".
2. **`externo`** dá identidade de negócio duradoura. Reenviar daqui a 3 meses atualiza, não duplica.

O `Viagem.clientId` gerado é `api:<credencialId>:<sha1(sistema|idExterno)>` (ou da Idempotency-Key, se não houver externo). Isso mantém o invariante global do `@unique` sem colisão entre empresas.

### 2.5 Paginação, filtros, limites

- **Cursor opaco** (`?cursor=…&limite=100`, máx 500), ordenado por `(alteradoEm, id)` nas listas. Resposta `{ dados:[…], proximoCursor: string|null }`. Offset não, porque com escrita concorrente pula e repete.
- `?atualizadoDesde=` existe como **conveniência** de lista (é o que o integrador espera ver), documentado como "pode perder alteração em corrida; pra espelhar, use `/v1/alteracoes`".
- Filtros por recurso: `status`, `dataDe/dataAte` (ancorados em `America/Sao_Paulo`, `common/timezone.ts`), `motorista`, `veiculo`.
- Rate limit **por credencial** (não por IP): 600 req/min de leitura, 120/min de escrita, cabeçalhos `RateLimit-*` e `429` com `Retry-After`. Começa em memória (`ContadorJanela`), igual ao ClickUp. Com segunda réplica, passa pra Postgres.
- Corpo máx. 1 MB na v1 (hoje o global é 50 MB, `main.ts:57`). Lote: `POST /v1/viagens/lote` com até 100 itens, resposta item a item (207-like: `{resultados:[{indice,status,id|erro}]}`).

### 2.6 Envelope de erro (filtro só em `v1/*`)

```json
{ "erro": { "codigo": "VALIDACAO", "mensagem": "Erro de validação",
            "detalhes": [{ "campo": "toneladas", "codigo": "too_small", "mensagem": "…" }],
            "requisicaoId": "req_01J…" } }
```

Códigos estáveis, catalogados em `shared-types/src/publica/erros.ts`: `NAO_AUTENTICADO`, `CREDENCIAL_REVOGADA`, `ESCOPO_INSUFICIENTE`, `MODULO_NAO_CONTRATADO` (reaproveita `CODIGO_MODULO_NAO_CONTRATADO`), `CONTA_SOMENTE_LEITURA` (reaproveita `CODIGO_CONTA_SOMENTE_LEITURA`), `VALIDACAO`, `NAO_ENCONTRADO`, `REFERENCIA_OBRIGATORIA`, `VIAGEM_TRAVADA`, `KM_PROTEGIDO`, `IDEMPOTENCIA_CONFLITO`, `LIMITE_EXCEDIDO`. O filtro traduz o `{issues}` do `ZodValidationPipe` e o `{code}` dos guards. FK inválida (P2003) vira `422`, nunca 500 (memória `feedback_fk_violations_4xx`). `requisicaoId` também volta em header e vai pro log.

### 2.7 Como uma viagem da API entra nas regras sem furar nenhuma

**Regra-mestra:** extrair um `ViagemEntradaService` (`api/viagens-dominio/viagem-entrada.service.ts`) com os efeitos que hoje só o app executa (`motorista/viagens.service.ts:1676-1790`): `etapas.fixarNaViagem`, `validacao.revalidarApos`, `kmReprocessamento.reprocessar`, `kmAtipico.avaliarViagem`, `conferencia.enfileirar(id,"create")`, `precificacao.recalcularSeguro`, `programacao.casarComViagem`, aviso de aguardando peso. A API (e, de quebra, a importação) chama esse serviço. **Nenhum controller `v1/*` toca `prisma.viagem` direto.** Um teste varre `api/publica/**` atrás de `.viagem.create|update|delete` e falha.

| Regra | Como a API respeita |
|---|---|
| `STATUS_FORA_FECHAMENTO` (`common/viagem-status.ts:20`) | A API aceita `status` de entrada só em `EM_ANDAMENTO` (sem peso), `AGUARDANDO_PESO` ou "concluída" (vira `ENVIADA`). Nunca `OK`/`AJUSTADA`/`DIVERGENTE`, que são decisões do conferente. Sem `toneladas`, vira `AGUARDANDO_PESO`, jamais 0t. Na **leitura**, o filtro default exclui `STATUS_FORA_FECHAMENTO` igual ao painel, e o integrador pede `?incluirIncompletas=true`. |
| Km do motorista é lei (`common/km-motorista.ts:36`) | Viagem criada pela API: o `km` informado é gravado em `km` **e** em `kmMotorista`? **Não.** `kmMotorista` é "o que o motorista disse no nosso app" (só 3 caminhos escrevem). Proposta: a API grava em `km` e numa coluna nova `kmOrigem` (o que o sistema de origem disse), e `kmMotorista` fica null, como no painel e na importação. Atualização de km **pela integração dona** passa se a viagem não foi conferida e o painel não mexeu (`kmAlteradoEm IS NULL`), com auditoria `INTEGRACAO_ALTEROU_KM`. Se o painel já alterou com motivo, `409 KM_PROTEGIDO`: decisão justificada de humano não é desfeita por máquina, a mesma lógica que trava o cron. Viagem nascida **no nosso app**: o km **nunca** é alterável por API (`409 KM_PROTEGIDO`). |
| Mínimo → preço (`common/viagem-minimos.ts`, `common/viagem-preco.ts`) | A API **não aceita valor** na 1ª onda: o preço sai da `TabelaPreco` via `precificacao.recalcularSeguro`, como no app. Valor externo (`ViagemValor` com `alteracaoMotivo="integração <nome>"`, `base: VIAGEM` igual à importação, `importacao.service.ts:401`) é escopo separado, `viagens.alterar-valor`, e **não é sobrescrito** depois por recálculo (regra já existente pra valor manual). Na leitura, `quantidadeEfetiva` e `valor` saem já com o mínimo aplicado, porque é o que se fatura. |
| Fechamento | Viagem com `matchesFechamento > 0` ou `revisadoEm` (congelada) dá `409 VIAGEM_TRAVADA`, igual ao painel (`admin/viagens/viagens.service.ts:529-533`). |
| Acerto | Viagem dentro de acerto FECHADO/PAGO dá `409 VIAGEM_TRAVADA` (acerto FECHADO não regenera, PAGO não reabre). |
| Pedágio em dobro | A API escreve **só** `valorPedagioTotal` (nativo), nunca `Pedagio`. Na leitura, expõe `pedagio` já resolvido por `pedagioDaViagem`. |
| Conferência | Viagem da API entra na fila igual (`conferencia.enfileirar`). Se o material dispensa conferência (`project_dispensa_conferencia_material`), nasce aprovada pela mesma regra. |
| Multi-tenant | Garantido pela trava. O `externo` é resolvido **dentro** da conta. |
| Exclusão | `DELETE /v1/viagens/{id}` só pra viagem **criada por aquela credencial** e não travada. Vira `CANCELADA`? Hoje não há esse status (`schema` `enum StatusViagem:31`). **Decisão do dono:** exclusão física (como o painel) + lápide no log, ou introduzir cancelamento lógico. Recomendo física + lápide, pra não abrir os 25 pontos de `STATUS_FORA_FECHAMENTO`. |
| Origem | Coluna nova `Viagem.origemCredencialId String?` (+ selo "Integração: <nome>" no painel, como o selo "Guiada", `schema` `iniciadaGuiada`). É também o que diz "quem pode alterar". |

**Caso 1 (o app próprio da empresa cria viagens):** o motorista dela pode **não** ter login no nosso app. `PUT /v1/motoristas/externo/...` cria `Motorista` com `senhaHash` de bloqueio (aleatório, inutilizável), `aceite: ACEITO`, `status: APROVADO` e **sem identidade**. Ele existe pra viagem e pro acerto, não pra entrar no app. Convite pro app é ação humana no painel (memória `feedback_dados_do_cliente_sao_do_cliente`).

---

## 3. Credenciais de integração

### 3.1 Decisão: chave de API própria + `kind: "INTEGRACAO"`

- **Não JWT.** JWT assinado com `JWT_SECRET` dura 15 min e pede refresh, coisa que máquina faz mal. Um JWT longo não se revoga sem lista de bloqueio. A chave opaca com lookup no banco revoga na hora, igual ao modelo da casa ("tudo recarregado do banco a cada requisição", `jwt.strategy.ts:62-65`).
- Formato: `mvt_live_<prefixo 8>_<segredo 32 base62>` (e `mvt_test_` pra sandbox, se houver). O prefixo fica visível na tela e no log. O segredo aparece **uma vez**. No banco vai `sha256(segredo)`, não bcrypt: o segredo tem 190 bits, então bcrypt só custaria CPU por request.
- Cabeçalho: `Authorization: Bearer mvt_live_…`. **Nada** por query string.

### 3.2 `AuthIntegracao` (em `api/auth/types.ts`)

```ts
export type AuthIntegracao = {
  kind: "INTEGRACAO";
  id: string;              // ApiCredencial.id
  nome: string;            // "ERP Totvs"
  contaId: string;
  contaSomenteLeitura: boolean;
  escopos: string[];       // já podados por tetoDaConta()
  escopo: EscopoAdmin;     // transportadoras (null = todas), mesmo filtroEscopo do painel
};
```

### 3.3 Passagem pelos guards (ordem global do `auth.module.ts:42-50` + `modulos.module.ts:25`)

1. **Não** usar `@Public()` + `@UseGuards` (o padrão do ClickUp), pelo motivo do ⚠️ abaixo.
2. Autenticação da chave (`api/publica/auth/api-chave.strategy.ts`): rate limit por IP antes (força bruta), extrai a chave, busca `ApiCredencial` por `prefixo` em `comoSistema`, `segredoConfere(sha256)`, checa `revogadaEm`/`expiraEm`/`estadoDaConta(conta)` (`common/conta/estado-da-conta.ts`), `definirConta(contaId)`, monta `req.user: AuthIntegracao`. Atualiza `ultimoUsoEm` **no máximo 1×/min** (escrita por request é caro), depois o rate limit por credencial.
   - ⚠️ Os guards globais (`APP_GUARD`) rodam **antes** dos guards de `@UseGuards`. Então `PermissaoGuard`/`ModuloGuard`/`SomenteLeituraGuard` veriam `req.user` vazio. Solução: o `ApiChaveGuard` não pode ser `@UseGuards`. Ele vira **estratégia passport** `"api-chave"` e o `JwtAuthGuard` passa a usar `AuthGuard(["jwt","api-chave"])` **só quando a rota for `v1/*`** (metadata `@RotaPublicaV1()`). Isso mantém a ordem: autentica primeiro, autoriza depois. Rotas `v1/*` **não** levam `@Public()`.
   - E o `jwt` não pode autenticar em `v1/*` (o token do painel não vira acesso de integração): o guard escolhe **uma** estratégia pelo prefixo.
3. `RolesGuard`: entra `INTEGRACAO: ["INTEGRACAO"]` no `PAPEIS_POR_KIND` (`roles.guard.ts:16`). Controllers v1 declaram `@Roles("INTEGRACAO")`, e assim token de admin/motorista nunca entra em `v1/*`, nem chave em `admin/*`.
4. `PermissaoGuard` (`permissao.guard.ts:24`): passa a aceitar `kind === "INTEGRACAO"` checando `user.escopos`. A mesma anotação `@RequerPermissao("viagens.ver")` serve aos dois mundos.
5. `ModuloGuard` (`modulo.guard.ts:51`): **trocar** `kind !== "ADMIN_USER"` por "não é ADMIN nem INTEGRACAO". Tem que ter teste, porque fail-open em kind novo é o furo clássico (memória `feedback_permissao_guard_fail_open`).
6. `SomenteLeituraGuard`: já funciona, desde que `contaSomenteLeitura` venha preenchido (o tipo `AuthIntegracao` exige).
7. Trava: já ativa pelo `definirConta`.

### 3.4 Escopos

- O escopo **é** a chave do catálogo (`viagens.ver`, `viagens.editar`, `motoristas.ver`, `motoristas.editar`, `abastecimentos.ver`, `acertos.ver`, `veiculos.*`, `locais.*`, `clientes.*`, `materiais.*`), mais um recurso novo **`integracoes`** (`ver`, `gerenciar`) **para a tela** que gera chaves e webhooks. Esse recurso entra no módulo `operacao` (núcleo) ou num módulo novo `integracoes` (adicional): **decisão comercial do dono**.
- Na criação: `escopos ⊆ tetoDaConta(contaId)` **e** `escopos ⊆ permissoes do usuário que cria`, porque ninguém fabrica chave mais poderosa que ele mesmo.
- Em uso: `escopos ∩ tetoDaConta()` recalculado com cache de 15s (`CachePorConta`, mesma régua do `ModuloGuard`). Módulo cancelado poda a chave sozinho, **sem** apagar o escopo gravado: recontratou, volta (memória `feedback_nunca_retirar_acesso_sem_autorizacao`).

### 3.5 Rotação e ciclo de vida

- Até **2 chaves ativas por credencial** (`ApiCredencialSegredo`): "Gerar nova chave" cria a segunda, o integrador troca e revoga a antiga. A chave antiga pode ganhar `expiraEm = agora + 7 dias` automático.
- Revogar vale na hora (próximo request).
- Aviso no painel e por e-mail quando uma chave fica 90 dias sem uso, e quando uma chave está pra expirar.
- Toda criação, rotação e revogação vai pra `AuditLog` (entidade `ApiCredencial`).

### 3.6 Tela no painel

`/configuracoes/integracoes` (padrão das telas de `apps/dashboard/src/app/(painel)/configuracoes/*`), gate `integracoes.ver`, item em `apps/dashboard/src/lib/menu.ts`. Abas:

1. **Chaves**: nome, prefixo, escopos (checkboxes agrupados por módulo, só o que cabe no teto), transportadoras, último uso, botões Gerar (azul), Rotacionar (amarelo), Revogar (vermelho). A chave aparece uma vez, num campo de copiar, com o aviso "não mostramos de novo".
2. **Webhooks**: endpoints e eventos.
3. **Entregas**: log por endpoint, com reentregar.
4. **Documentação**: link pro portal + exemplo `curl` já com o prefixo.

Linguagem simples (memória `feedback_simples_antes_de_completo`): "Conectar outro sistema", não "credencial OAuth".

---

## 4. Saída: webhooks e sincronização

### 4.1 Duas fontes de evento

| Tipo | Exemplos | Onde nasce | Como |
|---|---|---|---|
| **Mudança de dado** | `viagem.criada`, `viagem.atualizada`, `viagem.excluida`, `motorista.*`, `veiculo.*`, `abastecimento.*`, `local.*` | qualquer escrita, inclusive cron, raw SQL e exclusão física | **trigger Postgres** → `registro_alteracoes` |
| **Fato de negócio** | `viagem.iniciada`, `viagem.finalizada`, `viagem.peso_completado`, `viagem.conferida` (OK/AJUSTADA/DIVERGENTE), `viagem.valor_definido`, `acerto.fechado`, `acerto.pago`, `abastecimento.conferir` | poucos serviços, com nome | `emitirEvento(tx, tipo, entidadeId, dados)` dentro da mesma `$transaction` |

Pontos de emissão de negócio (mapeados):

- `viagem.iniciada`: `motorista/viagens.service.ts` iniciar (`:2051`).
- `viagem.finalizada`: `finalizar` (`:2324`) e o `create` direto (`:1412`).
- `viagem.peso_completado`: completar peso (`CompletarPesoInput`, `shared-types/src/viagem.ts:267`).
- `viagem.conferida`: `conferencia-ticket/aplicar-veredito.service.ts` + pré-validação (`admin/viagens/viagens.controller.ts:285`).
- `viagem.valor_definido`: `admin/tabelas-preco/precificacao.service.ts:39`.
- `acerto.fechado` e `acerto.pago`: `admin/acertos/acertos.service.ts`.

### 4.2 Log de alterações (outbox transacional + CDC leve)

Trigger `AFTER INSERT OR UPDATE OR DELETE` nas tabelas expostas (`viagens`, `viagem_valores`, `motoristas`, `veiculos`, `locais`, `empresas`, `clientes`, `materiais`, `abastecimentos`, `pedagios`, `acertos_motorista`):

```sql
CREATE OR REPLACE FUNCTION public.registrar_alteracao() RETURNS trigger AS $$
DECLARE r record := COALESCE(NEW, OLD);
BEGIN
  INSERT INTO "registro_alteracoes"("contaId","entidade","entidadeId","operacao","xid")
  VALUES (r."contaId", TG_ARGV[0],
          CASE WHEN TG_ARGV[1] IS NOT NULL THEN (to_jsonb(r)->>TG_ARGV[1]) ELSE r."id" END,
          TG_OP, pg_current_xact_id());
  RETURN NULL;
END $$ LANGUAGE plpgsql;
-- viagem_valores: TG_ARGV = ('viagem','viagemId') → filho marca o PAI como alterado
```

- **Por que trigger:** pega os 19 pontos de escrita da Viagem, o 20º que alguém criar, o `UPDATE` cru, o cron de km e o **DELETE** (lápide), sem disciplina de quem escreve. E é transacional por definição: rollback apaga o registro junto.
- **Cursor sem buraco:** o leitor só lê `xid < pg_snapshot_xmin(pg_current_snapshot())`, ou seja, transações que com certeza já terminaram (PG13+, prod é PG17). Cursor = `(xid, id)`. É o que mata o problema do `alteradoEm` (§1.11).
- **Ruído:** o cron de km (`KmReprocessamentoService`) e o `@updatedAt` geram UPDATE sem mudança "de negócio". O trigger compara `OLD` e `NEW` excluindo colunas técnicas (`alteradoEm`, `sincronizadoEm`, `kmAvaliadoEm`…) e não grava se nada mais mudou. A lista mora em `shared-types/src/publica/colunas-tecnicas.ts` e o SQL é gerado dela.
- **Volume:** ~1 linha por escrita relevante. Retenção de 30 dias (cron de expurgo com `cron-exclusivo`). Quem passar 30 dias sem ler refaz a carga cheia, e o endpoint devolve `410 CURSOR_EXPIRADO`.
- Só registra conta que tem integração ativa? Não: o custo é baixo e ligar a integração não deve depender de "desde quando". Mas o expurgo pode ser de 7 dias pra conta sem credencial nenhuma.

`GET /v1/alteracoes?cursor=…&entidades=viagem,motorista` → `{ dados:[{entidade, id, operacao:"criado|alterado|excluido", em}], proximoCursor }`. O integrador busca o objeto atual em `GET /v1/viagens/{id}` (ou recebe gordo no webhook, §4.4). **É a mesma fila que alimenta os webhooks `*.criada/atualizada/excluida`.**

### 4.3 Entrega

`api/publica/webhooks/despachante.service.ts`, cron a cada 5s com `cron-exclusivo`:

1. **Fan-out:** lê `registro_alteracoes` + `evento_negocio` desde o cursor do despachante, cruza com `WebhookEndpoint` ativos da conta que assinam aquele tipo, e grava `WebhookEntrega(PENDENTE)`. É idempotente por `@@unique([endpointId, eventoId])`.
2. **Envio:** reivindica entregas com `FOR UPDATE SKIP LOCKED` (cópia de `clickup-runner/fila.service.ts:88-107`), monta o payload **dentro de `comConta(contaId)`** (a trava protege o que é lido), faz o POST com timeout de 10s e grava o status.
3. **Assinatura (padrão Stripe/Standard Webhooks):**
   ```
   Movatruck-Id: evt_…            (o mesmo id em toda retentativa → o cliente deduplica)
   Movatruck-Timestamp: 1759850000
   Movatruck-Assinatura: v1=<hex(HMAC-SHA256(segredo, `${id}.${timestamp}.${corpo}`))>
   ```
   Tolerância documentada de 5 min contra replay. Segredo `whsec_…` cifrado com `cifrar()` e sal próprio `ronan:webhook:v1` (`common/cripto.ts:35`), com dois segredos válidos durante a rotação (assina com os dois).
4. **Retry:** 2xx = entregue. 410 = desliga o endpoint na hora. 4xx/5xx/timeout = backoff 30s, 2min, 10min, 30min, 1h, 3h, 6h, 12h, 24h (9 tentativas, ~2 dias). `recuperarPresas` pra `ENVIANDO` velho (memória `feedback_outbox_stale_syncing`).
5. **Desligamento automático:** 3 dias seguidos sem nenhum 2xx (ou 100 falhas consecutivas) desliga o endpoint (`desativadoEm`, `motivoDesativacao`), avisa o admin da empresa (notificação + e-mail) e para de gerar entregas novas. As que estavam pendentes ficam como `DESCARTADA`. Religar é manual.
6. **Reentrega manual:** botão por entrega e "reenviar tudo que falhou desde X", que gera entregas novas com o **mesmo** `Movatruck-Id`.
7. **Destino:** só `https://`, porta 443/8443. Recusa IP privado/loopback/link-local (169.254.169.254) na criação **e** a cada envio (DNS rebinding), porque é SSRF de dentro da VPS onde mora o Postgres.
8. **Registro:** o envio sai por `fetch` e cai no registro da plataforma. Entra `servico: "Webhook de cliente"` com corpo **não guardado** (ver §1.9). O que a empresa vê é a `WebhookEntrega`.

### 4.4 Payload: gordo, versionado, sem ordem garantida

```json
{ "id": "evt_01J…", "tipo": "viagem.finalizada", "versao": "2026-10-01",
  "criadoEm": "2026-10-07T14:03:11-03:00", "contaId": "…",
  "dados": { "viagem": { /* mesmo shape do GET /v1/viagens/{id} */ } } }
```

- **Gordo** (o objeto inteiro, no contrato público), porque o ERP pequeno não quer fazer GET de volta. Mas o objeto é montado **na hora do envio** (estado atual), e o evento diz o fato, não o estado do fato. Pra `*.excluida`, `dados` só leva `{id, externo}`.
- **Ordem não é garantida** (retry embaralha). O documento diz isso e manda usar `dados.viagem.alteradoEm`/`versao` pra descartar o velho. Garantir ordem por entidade custaria fila serial por endpoint, e só vale fazer se alguém pedir.
- Campos sensíveis **fora**: CPF completo do motorista (sai mascarado, ou só sob escopo `motoristas.ver-documento`), senha, tokens, chave Pix, GPS bruto. Montagem campo a campo, **whitelist** (memória `feedback_whitelist_fronteira_publica`), usando o mesmo serializador público do GET.

### 4.5 Catálogo de eventos (código como fonte)

`packages/shared-types/src/publica/eventos.ts`:

```ts
export const EVENTOS_PUBLICOS = {
  "viagem.criada":     { descricao: "...", escopo: "viagens.ver", dados: z.object({ viagem: ViagemPublica }), origem: "alteracao" },
  "viagem.finalizada": { descricao: "...", escopo: "viagens.ver", dados: ..., origem: "negocio" },
  // ...
} as const satisfies Record<string, EventoDef>;
```

- Assinar um evento exige que a credencial dona do endpoint tenha o `escopo`, senão o webhook vazaria o que a chave não lê.
- `emitirEvento()` só aceita chave do catálogo (tipo TS), e o catálogo gera a seção "Webhooks" do OpenAPI 3.1 (`webhooks:`).
- Teste de invariante: todo evento `origem: "negocio"` tem pelo menos uma chamada a `emitirEvento("<tipo>")` no código (grep no teste, mesmo estilo dos 9 testes de módulo).

### 4.6 Telas

- **Empresa** (`/configuracoes/integracoes`, aba Webhooks e Entregas): endpoint, eventos, segredo (mostrar/rotacionar), "Enviar teste" (`ping`), e a lista de entregas com status, tentativas, resposta truncada em 2 KB e Reentregar.
- **Plataforma** (`/chamadas-externas`, já existe): enxerga o volume e o tempo de resposta, sem corpo. **Não** substitui a tela da empresa: são públicos diferentes, e a tela da plataforma é `PlataformaGuard`.

---

## 5. Identificador externo

### 5.1 Decisão: tabela genérica `VinculoExterno`, não coluna por tabela

| Critério | Coluna `externalId` + `@@unique([contaId, externalId])` | Tabela `VinculoExterno` |
|---|---|---|
| ERP + rastreador + app próprio na mesma conta | **não cabe** (um campo só, quem grava por último ganha) | cabe: `sistema` faz parte da chave |
| Migration | ~11 tabelas, ~11 índices, e a cada entidade nova mais uma | 1 tabela |
| Lookup | 1 índice, direto | 1 join/consulta a mais (índice único, barato) |
| `connectOrCreate` do Prisma | natural | upsert manual (já é o que o serviço de domínio faz) |
| Trava multi-tenant | automática | automática (tem `contaId`) |
| Exclusão | some junto | precisa limpar (trigger de exclusão do log já sabe, e o FK lógico se apaga no mesmo serviço) |
| Pedido do dono "todas as tabelas com identificador externo" | literal | atende **todas** de uma vez, inclusive as que nascerem |

O caso real é a empresa média com **ERP (Totvs/Sankhya) + rastreador (Sascar/Omnilink) + app próprio**: três `idExterno` diferentes pro **mesmo caminhão**. Coluna única obriga a escolher o vencedor, e a tabela não.

Regras:

- `sistema` é um texto curto que a empresa cadastra na credencial (`"erp"`, `"sascar"`). **A credencial tem um `sistemaPadrao`**, então o integrador manda `"externo": "MOT-889"` e o sistema é implícito. Uma credencial pode escrever vínculo em outro sistema? Não: escreve só no dela, e lê todos.
- Único em `(contaId, sistema, entidade, idExterno)` **e** em `(contaId, sistema, entidade, entidadeId)`: um registro tem no máximo um id por sistema.
- Mesclar duplicados (locais já fazem merge, `admin/locais/locais.service.ts`; e motoristas) **repassa** os vínculos pro sobrevivente, ou conflito vira aviso. Ponto a lembrar em `project_locais_duplicados_geo`.
- No painel, a ficha de cada cadastro ganha a seção "Em outros sistemas" (sistema, id), editável com `integracoes.gerenciar`, porque o primeiro casamento costuma ser à mão (planilha de-para).
- Na saída, todo objeto público leva `externos: [{sistema, id}]`.

### 5.2 Quais entidades na 1ª onda

Viagem, Motorista, Veiculo, Local, Empresa (cliente), Cliente (obra), Material, Transportadora, Abastecimento, AcertoMotorista. Depois: Pedido, ViagemPlanejada, Despesa, Fornecedor. O enum `EntidadeExterna` é TS (`shared-types`), não enum Postgres, pra não pedir migration a cada entidade.

---

## 6. Documentação sempre atualizada

### 6.1 Gerar do Zod

- Hoje: **nenhuma** lib de OpenAPI a partir de Zod no repo (`grep zod-to-openapi|nestjs-zod` vazio). Zod 3.23 em `apps/api/package.json:64` e `packages/shared-types/package.json:19`.
- Adotar **`@asteasolutions/zod-to-openapi`** (v7, compatível com Zod 3), que é dependência nova só da API. `nestjs-zod` foi descartado: trocaria o `ZodValidationPipe` da casa e mexeria nos 529 usos.
- Registro explícito: cada controller v1 declara a rota com um decorator da casa, que alimenta o registro **e** aplica a validação:

```ts
@RotaV1({ metodo: "post", caminho: "/viagens", escopo: "viagens.editar",
          corpo: CriarViagemPublica, resposta: { 201: ViagemPublica },
          erros: ["VALIDACAO","REFERENCIA_OBRIGATORIA","IDEMPOTENCIA_CONFLITO"],
          resumo: "Cria uma viagem", exemplo: exemplos.viagemNova })
```

  Uma declaração só gera `@Post`, `@RequerPermissao`, pipe Zod e a entrada no OpenAPI. Não dá pra uma divergir da outra.
- `.openapi({ description, example })` nos schemas de `shared-types/src/publica/*`, em PT-BR, com o vocabulário público ("cliente", "obra").

### 6.2 Público separado do interno

- `GET /v1/openapi.json` (sem auth, cache 5 min), só `v1/*` + `webhooks:`, OpenAPI 3.1.
- Portal **Scalar** (`@scalar/nestjs-api-reference` ou HTML estático via cdn) em `/v1/docs`, com tema da marca, exemplos em curl/JS/Python e "Testar com sua chave". Redoc é o plano B. O Swagger UI fica pro interno.
- O `/docs` interno sai do ar em produção (env), §1.5.

### 6.3 Changelog e versão

- `docs/api-publica/CHANGELOG.md` + header `Movatruck-Versao: 2026-10-01` (versão por data, estilo Stripe) pro payload de webhook.
- Teste `openapi.snapshot.spec.ts` gera o JSON e compara com `apps/api/openapi/v1.json` commitado. Se mudou, falha com "atualize o snapshot **e** o CHANGELOG". Teste extra: mudança **destrutiva** (campo removido, tipo trocado, obrigatório novo na entrada) detectada por diff (`oasdiff` em CI, ou um diff caseiro de schema) quebra o build se a versão `v1` não mudou.

### 6.4 Boot-check no estilo da casa

`api/publica/publica.boot-check.ts` (gêmeo de `modulos.boot-check.ts:37`): varre controllers com rota `v1/*` e **derruba a subida** se um handler:

- não declarou `@RotaV1` (sem contrato = sem doc);
- não tem `@Roles("INTEGRACAO")`;
- tem escopo fora do catálogo ou sem módulo (`moduloDaChave`);
- tem resposta sem schema de saída.

E o inverso: o `modulos.boot-check` passa a recusar `@Roles("INTEGRACAO")` em controller `admin/*` ou `m/*`. Sem lista de dívida: a v1 nasce limpa.

---

## 7. Sincronização nos dois lados (caso 2 e o caso misto)

### 7.1 Fonte da verdade por campo, decidida por quem criou

| Origem da viagem (`origemCredencialId`) | Quem manda | O que o outro lado pode |
|---|---|---|
| **App Movatruck** (null) | Movatruck: o motorista é lei no km, e o conferente no status e no peso | a integração **lê**. Pode escrever só campos "de escritório" marcados como `editavelPorIntegracao`: `observacao`, `obra`, `pedido` e `externos`. Km, toneladas, ticket, fotos e status: `409 CAMPO_PROTEGIDO`. |
| **Integração X** | o sistema X, até a viagem ser conferida/fechada | o painel pode corrigir (com motivo, auditado); depois que o painel mexeu num campo, a integração não sobrescreve **aquele campo** (`409 CAMPO_PROTEGIDO` com `campo`). O registro do "quem mexeu por último em quê" sai do `AuditLog` (painel) + carimbos que já existem (`kmAlteradoEm`, `revisadoEm`). |
| **Painel** | Movatruck | integração lê. |

Cadastros (motorista, veículo, local…): **último a escrever ganha**, com `If-Match: <versao>` opcional (ETag = `alteradoEm`+hash) pro integrador que quiser concorrência otimista (`412 VERSAO_DESATUALIZADA`). Sem `If-Match`, sobrescreve, e a auditoria registra.

### 7.2 Conflito quando os dois editam

- Não existe merge automático de campo de dinheiro, km ou peso: ou a regra da tabela acima resolve, ou dá 409 explícito com o valor atual no corpo do erro.
- Laço infinito (nós notificamos, o ERP grava de volta, nós notificamos de novo): a escrita que vem de credencial **não dispara webhook pro endpoint da mesma credencial** (`registro_alteracoes.credencialId` preenchido via `SET LOCAL movatruck.credencial = '…'` na transação e lido pelo trigger com `current_setting('movatruck.credencial', true)`). E UPDATE sem mudança real nem registra (§4.2).

### 7.3 `atualizadoEm` confiável: existe?

Parcialmente. Ver §1.11. Ações:

1. Expor `alteradoEm` como **`atualizadoEm`** no contrato público (um nome só, já que o banco tem três).
2. Pra sincronização, o contrato é o **cursor do `/v1/alteracoes`**, não o timestamp.
3. `Pedagio` ganha `alteradoEm @updatedAt`. É migration simples, mas a 1ª onda expõe pedágio **resolvido dentro da viagem**, então pode esperar.
4. Filho alterado (`ViagemValor`, `TrechoViagem`, `FotoViagem`) marca o pai no log via `TG_ARGV` (§4.2), sem tocar `Viagem.alteradoEm`. Assim não muda semântica nenhuma do painel.

---

## 8. Esboço do schema Prisma (tabelas novas)

```prisma
/// Uma integração da empresa ("ERP Totvs", "App da frota"). Os segredos ficam
/// em ApiCredencialSegredo pra permitir rotação com duas chaves vivas.
model ApiCredencial {
  contaId          String   @default("__SEM_CONTA__")
  conta            Conta    @relation(fields: [contaId], references: [id])
  id               String   @id @default(uuid())
  nome             String
  /// Sistema dono dos `externo` que esta credencial grava ("erp", "sascar").
  sistemaPadrao    String
  /// Chaves do catálogo de permissões. Podadas pelo tetoDaConta() NA LEITURA,
  /// nunca apagadas daqui (módulo recontratado volta a valer).
  escopos          String[]
  /// null = todas as transportadoras (mesma semântica de EscopoAdmin).
  transportadoraIds String[]
  acessoGlobal     Boolean  @default(true)
  criadaPor        User     @relation("CriouApiCredencial", fields: [criadaPorId], references: [id])
  criadaPorId      String
  criadoEm         DateTime @default(now())
  alteradoEm       DateTime @updatedAt
  revogadaEm       DateTime?
  revogadaPorId    String?
  ultimoUsoEm      DateTime?
  ultimoUsoIp      String?

  segredos         ApiCredencialSegredo[]
  webhooks         WebhookEndpoint[]
  idempotencias    ApiIdempotencia[]

  @@index([contaId])
  @@map("api_credenciais")
}

/// Uma chave. O texto completo aparece uma vez; aqui só o prefixo e o hash.
/// Lida em comoSistema pelo prefixo (é a consulta que DESCOBRE a conta).
model ApiCredencialSegredo {
  contaId       String        @default("__SEM_CONTA__")
  conta         Conta         @relation(fields: [contaId], references: [id])
  id            String        @id @default(uuid())
  credencial    ApiCredencial @relation(fields: [credencialId], references: [id], onDelete: Cascade)
  credencialId  String
  /// "mvt_live_ab12cd34" — visível na tela e no log.
  prefixo       String        @unique
  /// sha256 hex do segredo. Segredo de 190 bits dispensa bcrypt.
  hashSegredo   String
  criadoEm      DateTime      @default(now())
  expiraEm      DateTime?
  revogadoEm    DateTime?

  @@index([contaId])
  @@index([credencialId])
  @@map("api_credencial_segredos")
}

/// Idempotency-Key: mesma chave + mesmo corpo = mesma resposta por 24h.
model ApiIdempotencia {
  contaId       String        @default("__SEM_CONTA__")
  conta         Conta         @relation(fields: [contaId], references: [id])
  id            String        @id @default(uuid())
  credencial    ApiCredencial @relation(fields: [credencialId], references: [id], onDelete: Cascade)
  credencialId  String
  chave         String
  hashCorpo     String
  /// EM_ANDAMENTO trava a segunda chamada simultânea (409) em vez de duplicar.
  estado        String        // EM_ANDAMENTO | CONCLUIDA
  statusHttp    Int?
  resposta      Json?
  criadoEm      DateTime      @default(now())
  expiraEm      DateTime

  @@unique([credencialId, chave])
  @@index([expiraEm])
  @@index([contaId])
  @@map("api_idempotencias")
}

/// O id de um registro nosso em outro sistema. Um registro, no máximo um id
/// por sistema; um id externo, no máximo um registro nosso.
model VinculoExterno {
  contaId      String   @default("__SEM_CONTA__")
  conta        Conta    @relation(fields: [contaId], references: [id])
  id           String   @id @default(uuid())
  sistema      String   // "erp", "sascar" — minúsculo, [a-z0-9-]{1,32}
  entidade     String   // "viagem" | "motorista" | … (EntidadeExterna em shared-types)
  entidadeId   String   // id nosso (sem FK: entidade polimórfica)
  idExterno    String   // até 128 chars, como o integrador mandou
  criadoEm     DateTime @default(now())
  alteradoEm   DateTime @updatedAt
  /// Quem criou o vínculo: credencial ou pessoa no painel.
  credencialId String?
  usuarioId    String?

  @@unique([contaId, sistema, entidade, idExterno])
  @@unique([contaId, sistema, entidade, entidadeId])
  @@index([contaId, entidade, entidadeId])
  @@map("vinculos_externos")
}

/// Escrito SÓ pelo trigger `registrar_alteracao`. Cursor = (xid, seq).
model RegistroAlteracao {
  seq          BigInt   @id @default(autoincrement())
  contaId      String
  entidade     String
  entidadeId   String
  operacao     String   // INSERT | UPDATE | DELETE
  /// pg_current_xact_id() — lido só abaixo de pg_snapshot_xmin, sem buraco.
  xid          BigInt
  /// Credencial que causou a escrita (SET LOCAL movatruck.credencial), pra
  /// não ecoar o webhook de volta pra quem escreveu.
  credencialId String?
  criadoEm     DateTime @default(now())

  @@index([contaId, xid, seq])
  @@index([criadoEm])
  @@map("registro_alteracoes")
}
// ⚠️ Lido por SQL cru com "contaId" explícito; gravado por trigger. Entra no
// MODELS_GLOBAIS? NÃO — tem contaId e as leituras pelo Client devem ser travadas.

/// Fato de negócio, emitido dentro da transação que o causou.
model EventoNegocio {
  contaId      String   @default("__SEM_CONTA__")
  conta        Conta    @relation(fields: [contaId], references: [id])
  id           String   @id @default(uuid())   // vira o Movatruck-Id (evt_…)
  tipo         String   // chave de EVENTOS_PUBLICOS
  entidade     String
  entidadeId   String
  dados        Json?    // só o que é do FATO (ex.: status anterior), não o objeto
  xid          BigInt   // mesmo cursor do log
  credencialId String?
  criadoEm     DateTime @default(now())

  @@index([contaId, xid])
  @@index([criadoEm])
  @@map("eventos_negocio")
}

model WebhookEndpoint {
  contaId            String        @default("__SEM_CONTA__")
  conta              Conta         @relation(fields: [contaId], references: [id])
  id                 String        @id @default(uuid())
  /// O endpoint lê com o escopo desta credencial (evento só se ela pode ler).
  credencial         ApiCredencial @relation(fields: [credencialId], references: [id])
  credencialId       String
  url                String        // https, sem IP privado (checado na criação e no envio)
  descricao          String?
  eventos            String[]      // chaves de EVENTOS_PUBLICOS; ["*"] = todos que o escopo permite
  /// whsec_… cifrado com cripto.cifrar (sal "ronan:webhook:v1"). Volta em claro pra assinar.
  segredoCifrado     String
  segredoAnteriorCifrado String?   // vale até segredoAnteriorAte (rotação)
  segredoAnteriorAte DateTime?
  ativo              Boolean       @default(true)
  desativadoEm       DateTime?
  motivoDesativacao  String?       // "AUTOMATICO_FALHAS" | "MANUAL" | "HTTP_410"
  falhasSeguidas     Int           @default(0)
  primeiraFalhaEm    DateTime?
  ultimoSucessoEm    DateTime?
  versaoPayload      String        @default("2026-10-01")
  criadoPorId        String
  criadoEm           DateTime      @default(now())
  alteradoEm         DateTime      @updatedAt

  entregas           WebhookEntrega[]

  @@index([contaId])
  @@index([credencialId])
  @@map("webhook_endpoints")
}

enum StatusEntregaWebhook {
  PENDENTE
  ENVIANDO
  ENTREGUE
  FALHOU        // esgotou as tentativas
  DESCARTADA    // endpoint desligado com ela pendente
}

model WebhookEntrega {
  contaId            String               @default("__SEM_CONTA__")
  conta              Conta                @relation(fields: [contaId], references: [id])
  id                 String               @id @default(uuid())
  endpoint           WebhookEndpoint      @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  endpointId         String
  /// Movatruck-Id. Igual em toda retentativa e na reentrega manual.
  eventoId           String
  tipo               String
  entidade           String
  entidadeId         String
  status             StatusEntregaWebhook @default(PENDENTE)
  tentativas         Int                  @default(0)
  proximaTentativaEm DateTime?
  reivindicadaEm     DateTime?
  workerId           String?
  ultimoStatusHttp   Int?
  ultimoErro         String?              // truncado
  ultimaRespostaTrecho String?            // até 2 KB, pra tela da empresa
  duracaoMs          Int?
  entregueEm         DateTime?
  /// Reentrega manual aponta pra original.
  reentregaDeId      String?
  criadoEm           DateTime             @default(now())

  @@unique([endpointId, eventoId, reentregaDeId])
  @@index([status, proximaTentativaEm])
  @@index([contaId, criadoEm(sort: Desc)])
  @@index([endpointId, criadoEm(sort: Desc)])
  @@map("webhook_entregas")
}
```

Alterações em tabelas existentes:

```prisma
model Viagem {
  // ...
  /// Credencial que CRIOU a viagem. null = app ou painel. Decide quem pode alterar (§7.1).
  origemCredencialId String?
  /// O km que o sistema de origem informou (≠ kmMotorista, que é só do nosso app).
  kmOrigem           Decimal? @db.Decimal(10, 2)
  @@index([contaId, origemCredencialId])
}

model AuditLog {
  // ...
  credencialId String?   // quando quem agiu foi uma integração
}

enum AcaoAuditoria {
  // ...
  INTEGRACAO_CRIOU
  INTEGRACAO_ALTEROU
  INTEGRACAO_ALTEROU_KM
  CREDENCIAL_CRIADA
  CREDENCIAL_REVOGADA
}

model Pedagio {
  // ...
  alteradoEm DateTime @default(now()) @updatedAt   // não tinha
}
```

Gotchas de migration (CLAUDE.md): a função do trigger leva `public.` explícito. Conferir com `git show --stat` que o `migration.sql` entrou. O backfill de `alteradoEm` em `pedagios` é `DEFAULT now()`.

---

## 9. Mapa de arquivos (novo e alterado)

**Novo**

- `packages/shared-types/src/publica/{viagem,motorista,veiculo,local,cliente,obra,material,abastecimento,acerto,alteracao}.ts`: contratos públicos de entrada e saída, `.strict()`, com `.openapi()`.
- `packages/shared-types/src/publica/{erros,eventos,colunas-tecnicas,entidades-externas}.ts`
- `apps/api/src/publica/publica.module.ts`, `publica.boot-check.ts`, `rota-v1.decorator.ts`, `erro-publico.filter.ts`, `openapi.controller.ts` (json + Scalar)
- `apps/api/src/publica/auth/api-chave.strategy.ts`, `credenciais.service.ts`, `rate-limit-credencial.guard.ts`
- `apps/api/src/publica/{viagens,motoristas,veiculos,locais,clientes,obras,materiais,abastecimentos,acertos,alteracoes}.controller.ts`
- `apps/api/src/publica/vinculos/vinculo-externo.service.ts` (resolver/gravar/repassar no merge)
- `apps/api/src/publica/webhooks/{despachante.service,assinatura,destino-seguro,eventos.service}.ts`: `emitirEvento(tx,…)` mora aqui
- `apps/api/src/viagens-dominio/viagem-entrada.service.ts`: efeitos colaterais extraídos de `motorista/viagens.service.ts:1676-1790`
- `apps/api/src/admin/integracoes/integracoes.controller.ts` (painel: chaves, webhooks, entregas), sob `@RequerPermissao("integracoes.*")`
- `apps/dashboard/src/app/(painel)/configuracoes/integracoes/page.tsx` (+ abas)
- `apps/api/prisma/migrations/<data>_api_publica/migration.sql` (tabelas + função + triggers)
- `docs/api-publica/CHANGELOG.md`, `apps/api/openapi/v1.json` (snapshot)

**Alterado**

- `apps/api/src/auth/types.ts`: `AuthIntegracao` no union
- `apps/api/src/auth/guards/roles.guard.ts:16`: `INTEGRACAO: ["INTEGRACAO"]`
- `apps/api/src/auth/decorators/roles.decorator.ts:10`: `RoleName` ganha `"INTEGRACAO"`
- `apps/api/src/auth/guards/jwt-auth.guard.ts`: escolhe a estratégia pelo prefixo `v1/`
- `apps/api/src/auth/guards/permissao.guard.ts:24`: aceita `INTEGRACAO` via `escopos`
- `apps/api/src/common/modulos/modulo.guard.ts:51`: **fecha** pro kind novo
- `apps/api/src/common/modulos/modulos.boot-check.ts`: recusa `@Roles("INTEGRACAO")` fora de `v1/`
- `apps/api/src/motorista/viagens.service.ts`: usa `ViagemEntradaService` + `emitirEvento`
- `apps/api/src/admin/importacao/importacao.service.ts:382`: passa a usar `ViagemEntradaService` (conserta conferência/preço e o km no update)
- `apps/api/src/admin/acertos/acertos.service.ts`, `conferencia-ticket/aplicar-veredito.service.ts`, `admin/tabelas-preco/precificacao.service.ts`: `emitirEvento`
- `apps/api/src/admin/locais/locais.service.ts` + merge de motoristas: repassar `VinculoExterno`
- `apps/api/src/common/chamadas-externas/registro.ts:32`: serviço "Webhook de cliente" sem corpo
- `apps/api/src/main.ts:70-78`: `/docs` interno só com env; `v1/openapi.json` público
- `packages/shared-types/src/permissoes.ts` + `modulos.ts`: recurso `integracoes`
- `apps/dashboard/src/lib/menu.ts`: item "Integrações"

---

## 10. Riscos e decisões que são do dono

1. **Módulo:** "Integrações" é núcleo ou adicional pago? Isso define onde o recurso `integracoes` mora em `modulos.ts`.
2. **Exclusão de viagem por API:** física + lápide (recomendado) ou status de cancelada? A segunda abre os 25 pontos do `STATUS_FORA_FECHAMENTO`.
3. **Valor da viagem por API** (o ERP manda o preço) entra na 1ª onda? Recomendo que não: só leitura do valor calculado.
4. **Motorista criado por API sem app**: aceitável que exista "motorista que nunca entra no app"? (Hoje todo motorista tem `senhaHash`.)
5. **CPF na saída:** completo sob escopo próprio, ou sempre mascarado?
6. **Sandbox (`mvt_test_`)**: conta de teste por cliente ou nada na 1ª onda? Recomendo uma conta-demonstração por integrador, criada pela plataforma.
7. **Risco técnico principal:** os triggers. Um trigger lento em `viagens` atrasa todo lançamento do app. Mitigação: trigger só faz `INSERT` simples (sem `to_jsonb` do OLD inteiro, só a comparação das colunas não técnicas), medir com `EXPLAIN ANALYZE` em cópia de prod antes de ligar, e uma flag `ConfiguracaoPlataforma.registroAlteracoesAtivo` que o trigger lê (`current_setting`) pra desligar sem migration.
8. **Risco de segurança principal:** o `ModuloGuard` fail-open pra kind novo (`modulo.guard.ts:51`) e o SSRF no destino do webhook. Os dois vão com teste antes de qualquer rota `v1/*` existir.
