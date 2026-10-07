# API pública: segurança e dados

**Squad:** API Pública e Integrações. **Especialista:** api-seguranca. **Data:** 07/10/2026.
**Escopo:** o desenho de segurança da credencial de integração, do isolamento entre empresas, do que
sai pela fronteira, do webhook de saída, do controle de abuso e da auditoria. Nada aqui foi implementado.

> Uma frase pra guardar: **a API pública é a primeira porta do sistema em que quem está do outro lado
> não é uma pessoa da empresa. É um programa, que roda em lugar que ninguém aqui conhece, com um segredo
> que pode acabar num repositório público.** Tudo o que segue parte disso.

---

## 0. O que o código já tem e o que falta (diagnóstico)

### Peças prontas, que a API pública deve reaproveitar

| Peça | Onde | Por que serve |
|---|---|---|
| Trava de conta (fail-closed, injeta `contaId` em todo `where`/`data`) | `apps/api/src/common/conta/trava-conta.ts:1-26` | Uma credencial que só chama `definirConta(contaId)` herda o isolamento das ~810 chamadas do Prisma sem tocar em service nenhum. |
| Contexto por requisição já aberto em todo request | `common/conta/conta.middleware.ts:19-22`, `conta-context.ts:73-75` | O guard da integração só precisa preencher a conta, como o `JwtStrategy` faz. |
| **Precedente quase idêntico: o portal do encarregado** | `encarregado/encarregado.guard.ts:51-128` | Token opaco com prefixo (`obra_`), guardado só como hash, resolvido em `comoSistema`, conta checada (`estadoDaConta`), escrita barrada em conta somente leitura (`:95-101`), módulo cobrado (`:104-105`), `definirConta` (`:107`), identidade fora de `req.user` (`:17-21`), "último uso" gravado a cada 5 min sem travar a requisição (`:119-125`). **A credencial de integração é este guard com escopos no lugar de flags.** |
| Geração e hash de segredo | `encarregado/encarregado-regras.ts:38-45` (`randomBytes(32)` + SHA-256), `cobranca-cliente/segredo-asaas.ts:43-60` (comparação em tempo constante) | O padrão de "mostra uma vez, guarda o hash" já está no repositório. |
| Cifra simétrica com sal por finalidade | `common/cripto.ts:35-74` (AES-256-GCM) | O segredo do webhook precisa voltar em claro pra assinar. É cifra, não hash, como a chave do Asaas. |
| HMAC + `timingSafeEqual` | `common/link-assinado.ts:12-40`, `common/seguranca/segredo.ts:11-16` | Base do link assinado de foto e da assinatura de webhook. |
| Teto da conta (papel ∩ catálogo ∩ módulos contratados) | `common/conta/teto-da-conta.ts:127-160` | Escopo de credencial nunca passa disso. Quando um módulo é cancelado, o escopo da credencial perde o acesso junto, sem código novo. |
| Boot-check que derruba a subida | `common/modulos/modulos.boot-check.ts:37-125`, `common/acesso-app/capacidades.boot-check.ts` | É o modelo pra cobrar escopo em todo endpoint público. |
| Whitelist com teste de chave proibida | `compartilhamento/viagem-publica.ts` + `viagem-publica.spec.ts:8-13` | É o modelo de serializador da API pública. |
| Rate limit em memória | `common/rate-limit/contador-janela.ts`, `rate-limit-ip.guard.ts` | Serve pra 1 réplica. Por IP, **não** serve (ver furo 4). |
| Mascaramento do registro de chamadas externas | `common/chamadas-externas/registro.ts:65-95` | Já esconde CPF, telefone, e-mail e chaves com nome de segredo. |

### Furos que existem HOJE e viram problema no dia em que a API abrir

1. **O `PermissaoGuard` é fail-open e só conhece `ADMIN_USER`.** Handler sem `@RequerPermissao` passa direto
   (`auth/guards/permissao.guard.ts:20`), e handler com `@RequerPermissao` dá 403 pra qualquer coisa que
   não seja admin (`:24`). Ou seja, ele não serve pra credencial de integração em nenhuma das duas
   direções: ou abre tudo, ou fecha tudo.
2. **O `ModuloGuard` e o `SomenteLeituraGuard` deixam passar quem não é `req.user` de admin.**
   `common/modulos/modulo.guard.ts:51` (`if (!user || user.kind !== "ADMIN_USER") return true`) e
   `auth/guards/somente-leitura.guard.ts:36` (`if (!user …) return true`). Se a credencial não morar em
   `req.user` (e não deve morar, pelo mesmo motivo do encarregado), **nenhum dos dois cobra nada**: uma
   empresa com teste vencido continuaria escrevendo pela API, e um módulo cancelado continuaria
   respondendo. O guard da integração precisa cobrar as duas coisas ele mesmo, como faz o
   `EncarregadoGuard:95-105`.
3. **`@Public()` é a única forma de sair do `JwtAuthGuard` global** (`auth/guards/jwt-auth.guard.ts:17`).
   Hoje existem ~30 controllers com `@Public()`, e cada um se defende com um guard próprio. **Nenhum
   boot-check cobra que um `@Public()` tenha guard.** Esquecer o guard numa rota pública da API equivale a
   abrir a rota pra internet, e nada quebra.
4. **O IP do rate limit pode ser forjado.** `common/rate-limit/ip.ts:5-7` pega o **primeiro** item do
   `X-Forwarded-For`, que é o que o cliente mandou. O Traefik **acrescenta** o IP real no fim da lista. Quem
   manda `X-Forwarded-For: 1.2.3.4` ganha uma cota nova a cada requisição, e o "último uso, de qual IP" da
   credencial sairia com o IP que o atacante quisesse.
5. **Token na query string vai parar no log de erro.** O `JwtStrategy` aceita `?access_token=` em qualquer
   rota (`auth/strategies/jwt.strategy.ts:46`, por causa do SSE). O `ErrorsExceptionFilter` grava
   `req.url` com a query (`errors/errors.filter.ts:49`) e `extra.query` cru (`:55`), além de logar `req.url`
   (`:62`). O sanitizador é raso, olha só o primeiro nível e uma lista curta (`:77-86`): não cobre
   `authorization`, `apiKey`, `secret` nem segredo aninhado.
6. **O registro de chamadas externas guardaria o caminho e o corpo do webhook do cliente.** Todo `fetch`
   passa pelo interceptor (`main.ts:5`). Pra host desconhecido, o padrão é `soResumo: false`, ou seja,
   guarda o pedido (`common/chamadas-externas/registro.ts:62`). O `urlSemSegredo` só mascara a **query**
   (`:121-124`). URL de webhook do Zapier, Make, n8n ou Slack carrega o segredo **no caminho**
   (`/hooks/catch/123/abc…`). Resultado: uma tabela global (`ChamadaExterna` é model global,
   `trava-conta.ts:87`) teria a lista de URLs secretas de todos os clientes, mais o corpo dos eventos.
7. **Não existe nenhuma proteção contra SSRF.** Um `grep` por IP privado, `169.254`, `dns.lookup` ou
   `redirect: "manual"` em `apps/api/src` não acha nada. Até hoje o sistema só chamava URLs fixas. O
   webhook é a primeira URL que o cliente digita e a API chama. E o alvo interno mais valioso está a um
   salto: **o MinIO tem leitura anônima no bucket inteiro** (memória "Bucket do MinIO é anônimo",
   `docker-compose.prod.yml:46`). Hoje a proteção é só topológica, porque o MinIO não tem domínio público.
   Um webhook cadastrado como `http://minio:9000/ronan-tickets/…` desmonta essa proteção, já que quem faz
   a chamada passa a ser o nosso servidor, que está dentro da rede.
8. **O corpo aceito chega a 50 MB em toda rota** (`main.ts:50-65`), e a paginação aceita até 500 por
   página (`common/pagination/pagination.schema.ts:8`). Pra uma API que um robô chama em loop, esses
   limites são altos demais.
9. **A documentação Swagger do sistema interno inteiro está pública** em `/docs` (`main.ts:71-78`). Ela
   lista os ~280 endpoints de admin e os de `/m/*`. A "documentação sempre atualizada" que o dono pediu
   precisa ser **outro** documento, gerado só dos controllers da API pública.
10. **CORS reflete qualquer origem com `credentials: true`** (`main.ts:19-37`, `CORS_ORIGINS=*`). Pra
    `/v1/*` isso convida a usar a credencial secreta direto do navegador do cliente, que é o jeito
    clássico de ela vazar.

---

## 1. A credencial de integração

### 1.1 Formato

```
mvt_live_<43 caracteres base62 = 256 bits><6 caracteres base62 = CRC32>
mvt_test_<…mesmo formato…>
```

- **O prefixo `mvt_live_` / `mvt_test_` aparece em claro.** Ele permite que um ser humano, um log e um
  scanner reconheçam o token sem consultar banco. Ele também cumpre a mesma função do `obra_` do portal: o
  guard recusa sem ir ao banco tudo o que não tem o formato certo (`encarregado.guard.ts:138-144`), e o
  `JwtAuthGuard` recusa o token em qualquer rota `admin/*` ou `m/*`, porque não é JWT.
- **Base62, não base64url.** O base64url tem `-` e `_`, então um duplo clique seleciona só um pedaço e a
  regex do scanner fica ambígua. O GitHub adotou base62 com `_` como separador justamente por isso.
- **Os 6 caracteres finais são um CRC32 do corpo.** Não acrescentam segurança. Servem pra o scanner de
  segredos (o nosso e o do GitHub) descartar falso positivo sem consulta ao banco. O GitHub conta que o
  checksum reduziu os falsos positivos a ~0,5%.
- **256 bits de entropia** (`randomBytes(32)`), a mesma régua do `gerarTokenSessao` do portal
  (`encarregado-regras.ts:43-45`).

Fontes: [GitHub, formato dos tokens](https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/) ·
[Stripe, chaves `sk_live_`/`rk_live_`/`sk_test_`](https://docs.stripe.com/keys).

### 1.2 Armazenamento: SHA-256 basta, argon2 seria erro

- **Guardar só o `SHA-256(token)`**, com índice único, e buscar a credencial pelo hash. O SHA-256 basta
  porque o segredo é aleatório de 256 bits. Argon2 e bcrypt existem pra senha **humana**, de baixa
  entropia, em que o atacante com o dump testa um dicionário. Contra 2²⁵⁶ não existe dicionário, e um hash
  lento não acrescenta nada.
- **Argon2 aqui seria até prejudicial.** Ele custa de ~50 a 100 ms de CPU **por requisição**, e quem não
  tem token nenhum consegue derrubar a API mandando token aleatório no formato certo. Além disso, o salt do
  argon2 impede a busca direta pelo índice, o que obrigaria a guardar um id em claro no token.
- É o mesmo raciocínio que o repositório já documenta em `segredo-asaas.ts:10-12` e
  `encarregado-regras.ts:34-41`.
- A busca por índice de hash não vaza nada por tempo de resposta (o atacante não controla o hash). Mesmo
  assim, a comparação final deve usar `timingSafeEqual`, como no `tokenWebhookConfere`.
- **Pra identificar a credencial, guardar** `prefixoVisivel` (`mvt_live_` + 4 primeiros caracteres) e
  `final` (4 últimos). A tela mostra `mvt_live_Ab3k…x9Qe`, o suficiente pra reconhecer e inútil pra usar
  (como faz o `finalDaChave`, `segredo-asaas.ts:34-37`).

### 1.3 Ciclo de vida

| Item | Desenho | Referência de mercado |
|---|---|---|
| Mostrar | **Uma vez**, na criação, com botão de copiar e aviso de que não aparece de novo. Depois disso só existe o hash. | Stripe: "Não é possível recuperá-lo mais tarde." |
| Dono | **A CONTA**, não a pessoa. O ERP não pode parar porque o funcionário que criou a credencial saiu da empresa. O criador fica registrado (`criadoPorId`). | Stripe: chave é da conta. GitHub PAT é da pessoa (modelo errado pra integração de empresa). |
| Escopos | Lista mínima, escolhida na criação (§2.3). Pode ser **reduzida** depois. **Ampliar** exige criar outra credencial, pra que a ampliação fique visível na auditoria como evento novo. | Stripe restricted keys (`rk_`). |
| Expiração | **Opcional**, sugerida em 1 ano, com alerta 30 e 7 dias antes. Sem prazo é permitido, mas aparece com selo "sem prazo". | Stripe: expiração por chave. GitHub: fine-grained PAT com prazo obrigatório. |
| Revogação | **Imediata**, porque o guard consulta o banco a cada requisição (sem cache, ou com cache de no máximo 15 s como o `ModuloGuard`). Exige motivo escrito. | |
| Rotação sem queda | "Rotacionar" cria uma credencial nova com os **mesmos escopos** e põe na antiga um `graceAte` (padrão de 24 h, máximo de 7 dias). As duas valem no intervalo. A tela mostra o "último uso" da antiga, pra dar pra conferir que o tráfego zerou antes do prazo. | Stripe: a antiga continua valendo por até 7 dias e a recomendação é "expire somente depois que o volume tiver permanecido em zero". |
| Último uso | `ultimoUsoEm` e `ultimoUsoIp`, gravados no máximo a cada 5 min e sem travar a requisição (padrão `encarregado.guard.ts:119-125`). **O IP tem que ser o real** (furo 4, §5.1). | |
| Restrição por IP | Opcional, lista de CIDR. **Onda 2.** | Stripe "políticas de acesso". |
| Limite por conta | Até 10 credenciais ativas, pra que credencial esquecida não vire população. | |

### 1.4 Ambiente de teste (`mvt_test_`)

O Movatruck não tem modo sandbox de dados como a Stripe tem, e criar um seria duplicar o banco. A proposta:

- **O sandbox é uma Conta separada**, criada pela plataforma (do tipo trial, marcada como `sandbox`). O
  isolamento vem de graça da trava, e nenhum dado de teste se mistura ao de produção.
- **Credencial de conta sandbox nasce `mvt_test_`**, e a de conta real nasce `mvt_live_`. O guard confere
  se o prefixo bate com o tipo da conta. Assim, um `mvt_test_` que vaze tem impacto nulo, e o scanner
  consegue tratar os dois de forma diferente (§6.3).
- Webhook de conta sandbox pode ir pra `https://` de túnel (ngrok etc.). As regras de SSRF continuam
  valendo.

---

## 2. Isolamento: a credencial da empresa A nunca toca a empresa B

### 2.1 O caminho da requisição

```
/v1/*  ──►  JwtAuthGuard: @Public() no controller ─► passa (não é JWT)
       ──►  IntegracaoGuard (NOVO, fail-closed, em TODO controller de v1/)
              1. Authorization: Bearer mvt_(live|test)_… ; formato + CRC32 ─► senão 401 sem ir ao banco
              2. comoSistema(findUnique({ where: { tokenHash } }))       ─► não achou: 401
              3. revogada? expirada? (graceAte vencido?)                 ─► 401 com código próprio
              4. estadoDaConta(conta).podeEntrar                         ─► senão 403
              5. escrita && !podeEscrever                                ─► 403 CONTA_SOMENTE_LEITURA
              6. módulo "integracoes" contratado (modulosDaConta)        ─► senão 403 MODULO_NAO_CONTRATADO
              7. escopoExigido ∈ (escoposDaCredencial ∩ escoposDoTeto(tetoDaConta)) ─► senão 403
              8. definirConta(credencial.contaId)                        ─► a trava assume daqui pra frente
              9. req.integracao = { credencialId, contaId, escopos, transportadoraIds, nome }
       ──►  handler ─► service ─► Prisma (trava injeta contaId)
```

Regras que não podem ser esquecidas:

- **A conta vem SÓ da credencial.** O guard ignora `x-conta-id` (que o `JwtStrategy` lê em
  `jwt.strategy.ts:24-28`), parâmetro de URL e campo no corpo. Não existe "visitar outra empresa" pela API.
- **`req.integracao`, nunca `req.user`.** Montar um `AuthAdminUser` falso pra reaproveitar um service
  (`permissoes: TODAS_AS_CHAVES`) é o atalho mais perigoso desse projeto e precisa ser proibido na revisão.
  Service que hoje recebe `AuthAdminUser` e for reaproveitado ganha um tipo `Ator = AuthAdminUser |
  AtorIntegracao`, e cada uso de `user.permissoes`/`user.escopo` dentro dele passa por revisão.
- **Os passos 4 a 7 existem porque os guards globais não olham a credencial** (furos 1 e 2). Sem eles,
  conta suspensa e módulo cancelado continuariam funcionando pela API.
- **Token só no header `Authorization`.** Nunca `?access_token=` nem cookie (furo 5).
- **Os limites da trava continuam valendo pra API:** SQL cru filtra `"contaId"` à mão (memória "SQL cru
  sempre filtra contaId"), model global (`MotoristaIdentidade`, `Conta`, `DocumentoPessoal`…) nunca é
  lido sem alvo no `where` e **nunca** é exposto pela API, e o `await` de Prisma acontece dentro do
  contexto (memória "Promise do Prisma é preguiçosa"). O guard chama `definirConta` no contexto que o
  middleware abriu, igual ao `JwtStrategy`, e não cria contexto novo.

### 2.2 Vazamentos laterais que a trava NÃO pega

| Vetor | Risco | Regra |
|---|---|---|
| **`idExterno` único global** | Se o índice for `@unique` global, a empresa A cria `idExterno = "PED-123"`, recebe 409, e fica sabendo que a empresa B tem esse id. É um oráculo entre empresas. | `@@unique([contaId, idExterno])`, sempre. Mesmo cuidado em toda chave de idempotência. |
| **Criar/buscar motorista por CPF pela API** | Se a API consultar `MotoristaIdentidade` (global), uma resposta do tipo "já existe" ou "vinculado" revela que aquele CPF está cadastrado em alguma empresa. | A API só enxerga o `Motorista` **da conta** (CPF é único por conta). Nunca cria nem consulta identidade global. Convite por CPF continua sendo coisa do painel. |
| Id de outra empresa na URL | 403 confirmaria que o id existe. | **404**, sempre igual ao "não existe". Os ids são UUID, então não dá pra enumerar. |
| Mensagem de erro | Prisma `P2003`/`P2002` com nome de constraint pode ecoar valor. | Erro da API pública passa por um formatador próprio, com `code` estável e sem eco de valor de outra linha. |
| Escopo por frota | Uma credencial de frota terceira veria as outras frotas. | `transportadoraIds` opcional na credencial, aplicado pelo mesmo `filtroEscopo` (`common/escopo/escopo.ts`). "Restrito sem vínculo vê nada" vale aqui também. |

### 2.3 Escopos como teto, nunca como chave-mestra

- **Catálogo próprio em `shared-types`** (`ESCOPOS_INTEGRACAO`), com nomes estáveis de contrato público
  (`viagens:ler`, `viagens:escrever`, `abastecimentos:ler`, `pedagios:ler`, `acertos:ler`,
  `motoristas:ler`, `motoristas:dados-pessoais`, `valores:ler`, `fotos:ler`, `webhooks:gerenciar`…).
  **Cada escopo declara de quais chaves RBAC ele depende** (`viagens:ler` → `viagens.ver`; `valores:ler` →
  `viagens.ver-comercial`), e assim herda o módulo da chave via `moduloDaChave`.
- **Na criação, o escopo pedido tem que caber em `papel do criador ∩ tetoDaConta`.** Ninguém cria uma
  credencial que enxergue mais do que a própria pessoa enxerga. O backend recusa, e não basta a tela
  esconder a opção (como o `PapeisService` recusa chave de plataforma).
- **Em cada requisição, `escoposEfetivos = escoposDaCredencial ∩ escoposPermitidosPor(tetoDaConta)`.**
  Módulo cancelado ou teto reduzido podam a credencial na hora. O que **não** se reavalia a cada requisição
  é o papel do criador, porque a credencial é da empresa. Quando o criador é desativado, a tela marca a
  credencial com "criada por pessoa desativada, confira" e **não revoga sozinha** (memória "Nunca retirar
  acesso sem autorização").
- **Operador da plataforma visitando uma empresa (ContaSwitcher) não cria credencial lá.** O guard da tela
  recusa quando `user.assumida`. Credencial é uma decisão da empresa sobre o dado dela (memória "Dados do
  cliente são do cliente").
- **Gerenciar credencial exige permissão própria** (`integracoes.ver`, `integracoes.gerenciar`) com
  `@RequerPermissao` no endpoint de admin. O boot-check dos módulos já obriga isso.

### 2.4 Provas automáticas (bloqueantes)

1. **`ApiPublicaBootCheck` (novo, derruba a subida).** Todo controller com rota `v1/` precisa ter:
   `IntegracaoGuard` no `@UseGuards` da **classe**, `@RequerEscopo(...)` em **todo** handler, escopo que
   exista no catálogo, e nenhum `@Roles`. **Nasce com a lista de exceções vazia.** Também derruba se um
   controller fora de `v1/` usar o `IntegracaoGuard` (fronteira que vaza pra dentro).
2. **Teste de dois inquilinos (e2e).** O teste semeia as contas A e B, gera uma credencial de A com todos
   os escopos e percorre **todas** as rotas do OpenAPI público (a lista vem do documento gerado, então rota
   nova entra no teste sozinha), usando ids de B. Espera 404 em leitura e 404/422 em escrita, sem nenhuma
   linha de B alterada. Também testa listagem sem filtro: nenhum id de B pode aparecer.
3. **Teste cruzado de credenciais.** JWT do painel em `/v1/*` deve dar 401, `mvt_live_` em `/admin/*` e
   `/m/*` deve dar 401, e `mvt_test_` em conta não-sandbox deve dar 401.
4. **Teste do teto.** O teste cancela o módulo, e a mesma credencial deve passar a receber 403 em menos de
   15 s. Também põe a conta em somente leitura, e o `POST` deve dar 403 enquanto o `GET` dá 200.
5. **Teste de SQL cru.** Todo `$queryRaw` alcançável a partir de `api-publica/` tem `"contaId"` (verificação
   por varredura do código, como a revisão de 12/08).

---

## 3. A fronteira pública é uma whitelist

### 3.1 Como montar cada resposta (e cada evento)

Três camadas, e as três são obrigatórias:

1. **`select` estreito no Prisma**: o que não é lido não tem como vazar (`viagem-publica.spec.ts:8-13`).
2. **Serializador literal, sem nenhum spread** (`api-publica/serializadores/viagem.ts`), com cabeçalho que
   lista o que ficou de fora **e o motivo**. Enum interno é traduzido (`DIVERGENTE` vira "em conferência").
3. **Saída validada pelo schema Zod público** com `.strip()`. É o mesmo schema que gera o OpenAPI, então a
   documentação e a resposta não divergem, e chave não declarada morre na saída (memória "Zod descarta
   chave não declarada", usada aqui a favor).

Além disso, um **teste de chaves proibidas sobre o JSON real** de cada recurso
(`/cpf|telefone|email|pix|senha|token|lat|lng|storageKey|contaId/i`, ajustado por escopo).

**Um serializador por escopo, nunca um `if (escopo)` dentro do mesmo objeto.** `ViagemPublica` e
`ViagemComValores` são tipos diferentes. Um `if` esquecido vira vazamento silencioso.

### 3.2 O que pode sair, com qual escopo

| Dado | Sai? | Escopo | Motivo |
|---|---|---|---|
| Viagem: id, idExterno, status traduzido, datas, origem/destino (nome e coordenada do **local**), material, peso, km faturado, placa | Sim | `viagens:ler` | É o objeto do caso 2. Coordenada de pedreira ou obra é dado de negócio, não pessoal. |
| `kmMotorista` x `km` | Os dois, rotulados | `viagens:ler` | "O km do motorista é lei". O ERP precisa saber qual foi informado e qual foi faturado. |
| Valores (`ViagemValor`, preço, frete, mínimo aplicado) | Só com escopo próprio | `valores:ler` | Espelha o gate duplo `viagens.ver-comercial` do comprovante público. |
| Acerto do motorista (quanto se deve a ele) | Só com escopo próprio | `acertos:ler` (exige `valores:ler`) | É dinheiro de terceiro, o parceiro autônomo. |
| Motorista: id, idExterno, nome | Sim | `viagens:ler` / `motoristas:ler` | Necessário pra casar com o ERP. |
| Motorista: **CPF, telefone, e-mail** | Só com escopo próprio, **desligado por padrão**, com aviso na tela | `motoristas:dados-pessoais` | Dado pessoal de terceiro (LGPD, art. 6º III, necessidade). O ERP costuma precisar do CPF pra pagar, mas a empresa decide isso de forma explícita. |
| Motorista: **chave PIX, dados bancários** | **Não sai na 1ª onda** | — | É o dado mais visado pra fraude (trocar a chave e desviar o pagamento). Decisão do dono (§7). |
| **Posição GPS do motorista** (trilha, ao vivo, ponto do evento) | **Não sai na 1ª onda** | depois: `localizacao:ler` | Localização de pessoa é dado de alto risco. Em parceiro autônomo, o monitoramento contínuo repassado a terceiros também pesa na discussão de vínculo (`RegimeVigente`). |
| Foto do ticket / comprovante | Só pela API, nunca por URL do MinIO | `fotos:ler` | Endpoint autenticado ou link assinado de 15 min (`common/link-assinado.ts`). **Nunca** URL direta do bucket (memória "Bucket do MinIO é anônimo"). |
| Documentos pessoais (CNH, toxicológico, RNTRC), admissão | **Nunca** | — | São da **pessoa**, não da empresa (`DocumentoPessoal` é model global). Toxicológico é dado de saúde, ou seja, dado **sensível** (LGPD, art. 5º II). |
| Ponto/jornada CLT, chat, stories, telemetria, mensagens de WhatsApp, auditoria interna, usuários do painel | **Nunca** | — | Fora da finalidade da integração. |
| `contaId`, ids internos de storage, `storageKey` | **Nunca** | — | Infraestrutura. |

### 3.3 LGPD: quem é quem

- **A transportadora é a controladora; a Movatruck é a operadora.** Isso já está nos Termos de Uso
  (`docs/termos-de-uso.md:142-160`). Quando a empresa cria uma credencial ou um webhook, **ela está
  instruindo** a operadora a entregar dados a um sistema que ela escolheu (art. 39). O ERP dela, ou a
  software house que ela contratou, **não é suboperador da Movatruck**: responde a ela.
- **O que muda nos Termos (bloqueante, antes do 1º cliente).** Acrescentar à seção 7 uma subseção
  "Integrações" dizendo que: criar credencial ou webhook é instrução da controladora; o destino é
  escolhido e respondido por ela; os escopos de dado pessoal são opt-in; a Movatruck registra cada
  entrega; webhook apontado pra fora do Brasil é transferência internacional **decidida por ela**. A tabela
  7.1 continua igual, porque o destino não é fornecedor nosso.
- **Registro das operações (art. 37).** O log de uso (§6) é o registro. Ele precisa responder "quais dados
  pessoais saíram, pra qual credencial, quando".
- **Necessidade e segurança (art. 6º III e art. 46).** Os escopos mínimos e o dado pessoal desligado por
  padrão são a materialização desses dois princípios. Na criação, a tela deve dizer em uma linha o que
  aquele escopo entrega ("inclui CPF e telefone dos motoristas").
- **Incidente.** Se uma credencial vazar com `motoristas:dados-pessoais`, quem comunica à ANPD e aos
  titulares é a controladora, em **3 dias úteis** (Resolução CD/ANPD nº 15/2024). Os Termos já prometem
  avisar a controladora em 48 h, o que está coerente. A tela de credencial precisa dar a ela o que essa
  comunicação exige: o que a credencial podia ver, desde quando e de quais IPs foi usada.
- **Caso 1 (entrada).** Quando o app de terceiro cria viagem e motorista, quem insere é a controladora e
  não muda nada do lado da Movatruck. A diferença é que o motorista que nunca abriu o nosso app nunca viu a
  nossa política. A informação a ele continua sendo obrigação da empresa (Termos, 7, primeiro item).

Fonte do prazo: [Mattos Filho, regulamento de comunicação de incidente](https://www.mattosfilho.com.br/unico/regulamento-incidente-seguranca/).

---

## 4. Webhook de saída

### 4.1 Assinatura: seguir o Standard Webhooks, não inventar formato

```
webhook-id:        evt_<uuid>                    ← chave de idempotência pro receptor
webhook-timestamp: 1791331200                    ← segundos Unix
webhook-signature: v1,<base64 HMAC-SHA256> v1,<…segredo anterior…>
assinado = `${webhook-id}.${webhook-timestamp}.${corpo cru}`
```

- **Por que esse padrão.** Foi especificado pelo Svix com Zapier, Twilio e outros, tem biblioteca de
  verificação pronta em várias linguagens, e é praticamente o formato da Stripe (`t=`, `v1=`), com o id
  dentro do que se assina. O integrador do cliente verifica em 3 linhas, sem a gente escrever SDK.
- **Segredo `whsec_` de 32 bytes, um por assinatura de webhook.** Fica **cifrado**, não em hash, porque
  precisa voltar em claro pra assinar: `cifrar(…, sal "ronan:webhook-integracao:v1")`
  (`common/cripto.ts:40`). **Exigir `CRIPTO_SECRET` próprio pra ligar a feature.** Hoje o
  `segredoDeCripto` cai no `JWT_SECRET` (`common/segredo-cripto.ts:13-16`), e não faz sentido herdar esse
  atalho numa superfície nova: sem a variável, o webhook fica desligado.
- **Anti-replay.** O timestamp entra no que é assinado. A documentação manda o receptor recusar evento
  com mais de **5 min** de diferença e deduplicar pelo `webhook-id`. Cada nova tentativa gera timestamp e
  assinatura novos, com o mesmo `webhook-id`.
- **Rotação.** "Rotacionar segredo" mantém o antigo por até 24 h, e nesse período cada entrega leva **duas**
  assinaturas, uma por segredo (como Stripe e Standard Webhooks).
- **Evento magro na 1ª onda.** O corpo leva `{ id, tipo, criadoEm, recurso: { tipo, id, idExterno } }`, e o
  receptor busca o objeto na API com a credencial dele. Do ponto de vista de segurança, isso vale por três
  motivos: (a) se o escopo for revogado entre o evento e a entrega, nada vaza; (b) as tentativas durante
  3 dias não carregam dado pessoal; (c) os logs do receptor (e o nosso, se algum escapar) não guardam
  CPF. A Stripe recomenda o mesmo ("thin events") pra integração nova. Um evento "gordo", que carregue o
  objeto, pode vir depois, se o arquiteto mostrar necessidade, sempre pelo **mesmo serializador** do §3.

Fontes: [Standard Webhooks, spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) ·
[Stripe, verificar assinatura, tolerância de 5 min, rotação de 24 h, 3 dias de novas tentativas](https://docs.stripe.com/webhooks).

### 4.2 SSRF: o cliente digita a URL, o nosso servidor faz a chamada

O alvo concreto é a rede interna do Easypanel: `minio:9000` (bucket com leitura anônima, com os tickets
de **todas** as empresas), Postgres, Evolution, OSRM, a API em si, e o metadata do provedor
(`169.254.169.254`). Regras, todas obrigatórias:

1. **No cadastro:**
   - só `https:`, com porta 443 (no máximo 443 e 8443);
   - sem usuário e senha na URL;
   - host tem que ser um **FQDN com TLD público**, o que derruba nome de serviço Docker sem ponto (`minio`,
     `postgres`);
   - **IP literal é recusado**, inclusive nas formas decimal, octal e hexa (`http://2130706433`).
2. **Resolver o DNS (A e AAAA) e recusar se QUALQUER endereço cair em faixa não pública:**
   - IPv4: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`,
     `192.168/16`, `198.18/15`, `224/4`, `240/4`;
   - IPv6: `::1`, `::`, `fc00::/7`, `fe80::/10`, `::ffff:0:0/96` (IPv4 mapeado, checado pelo v4
     embutido), `64:ff9b::/96`.
   - Usar biblioteca de classificação de IP (por exemplo `ipaddr.js` com `.range()`), não regex.
3. **A cada entrega, de novo, e conectando NO IP VALIDADO.** Isso fecha o DNS rebinding, em que o DNS
   responde um IP público no cadastro e `127.0.0.1` na entrega. Na prática é um `Agent` do undici com
   `connect.lookup` próprio que resolve, valida e devolve o endereço já checado. Validar e depois deixar o
   `fetch` resolver de novo não protege (é uma condição de corrida, TOCTOU).
4. **`redirect: "manual"`, e todo 3xx conta como falha** (a Stripe faz igual). Seguir redirect anula todas
   as regras acima.
5. **Timeout de 10 s no total, resposta lida até 64 KB e descartada, corpo enviado de até 256 KB.**
6. **Não ecoar a resposta do receptor na tela da empresa além de status e duração.** Mostrar o corpo da
   resposta transformaria o webhook em proxy de leitura de quem conseguisse burlar a validação.
7. **Fora do processo da API.** A entrega roda no worker (o `ronan_agente`, que já existe e não sobe HTTP),
   nunca dentro da requisição. **Depois:** rede Docker de saída sem rota pras redes internas (defesa em
   rede, como recomenda o próprio Standard Webhooks).
8. **Contra uso como canhão.** No máximo 5 webhooks por conta. Desligar sozinho após 3 dias de falha
   contínua, avisando o administrador. Um "testar" manual de 1 por minuto.

Fonte: [OWASP, SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
("Deny-lists are bypass-prone" e "bind the connection to a validated address").

### 4.3 O registro de chamadas externas não pode ver o webhook do cliente

Isso é bloqueante (furo 6). Quando o host é um webhook de cliente, o interceptor grava **só o host**:
`soResumo: true`, sem caminho e sem corpo. O detalhe da entrega vai pra uma tabela **escopada por conta**
(`EntregaWebhook`), que a empresa vê. O jeito mais limpo é o cliente HTTP do webhook marcar a chamada (por
exemplo, com um contexto `comGatilho("webhook-integracao")` que o registro reconhece), em vez de tentar
adivinhar pelo host.

---

## 5. Abuso

### 5.1 Rate limit

- **Por credencial e por conta, nunca por IP.** Na API autenticada, o IP não identifica ninguém (um ERP
  roda atrás de NAT, ou várias empresas usam a mesma software house) e ainda pode ser forjado (furo 4).
- **Ponto de partida, a calibrar:**

  | Limite | Valor |
  |---|---|
  | Leitura, por credencial | 120/min |
  | Escrita, por credencial | 60/min |
  | Por conta, somando todas as credenciais | 600/min |
  | Escrita em lote | até 100 itens por chamada |

  Resposta `429` com `Retry-After` e os cabeçalhos `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset`.
- **Onde fica:** no próprio `IntegracaoGuard`, reaproveitando o `ContadorJanela`
  (`common/rate-limit/contador-janela.ts`). Em memória está bom enquanto houver 1 réplica (o próprio
  arquivo avisa que com 2 o limite dobra, `:6-7`). No dia em que houver réplica, vai pro Redis. Não
  precisa de `@nestjs/throttler`, nem de rate limit no proxy, na 1ª onda.
- **Consertar o `ipDaRequisicao` (`ip.ts:5-7`)** pra pegar o IP **mais à direita que não é do proxy**
  conhecido (Traefik), ou configurar `trust proxy` no Express com o número de saltos. Isso é bloqueante pro
  `ultimoUsoIp` ter valor de prova. Também melhora os rate limits por IP que já existem (comprovante, portal,
  cadastro).
- **Falha de autenticação também conta.** Mais de 20 tokens inválidos por minuto vindos do mesmo IP real
  geram 429 por 5 min. Com 256 bits, isso não é proteção contra adivinhação. É pra não gastar banco.

### 5.2 Tamanho e forma

- **Corpo de até 1 MB em `/v1/*`.** Isso significa montar um `json({ limit: "1mb" })` específico pra
  `/v1` **antes** do parser global de 50 MB (`main.ts:50-65`). Foto entra por upload próprio, com limite
  próprio.
- **Paginação por cursor, no máximo 100 por página** (não os 500 do `PAGE_SIZE_MAX`), ordenada por
  `atualizadoEm, id`. É o "busca o que mudou desde X" do caso 2.
- **Validação Zod estrita (`.strict()`) na entrada.** Na API pública, campo desconhecido gera 400, e não é
  descartado em silêncio. Senão um integrador manda `valor` achando que gravou e recebe 200 sem nada mudar
  (memória "Zod descarta chave não declarada").
- **Idempotência obrigatória em `POST`** (`Idempotency-Key` ou o próprio `idExterno`), com escopo por
  conta (§2.2).

### 5.3 Logs sem segredo (bloqueante)

- **Scrubber por formato.** Uma regex `mvt_(live|test)_[0-9A-Za-z]{49}` e `whsec_[0-9A-Za-z+/=]{40,}` entra
  no `mascararTexto` (`registro.ts:68-73`) e num sanitizador **recursivo** do `ErrorsExceptionFilter`, que
  hoje é raso (`errors.filter.ts:77-86`). A lista de chaves desse sanitizador passa a ser a mesma
  `CHAVE_SECRETA` do registro, que já cobre `authorization`, `secret` e `apikey`. O ganho do prefixo é
  justamente esse: o token é achado onde quer que vaze, inclusive dentro de um corpo que o integrador mandou
  errado.
- **`/v1` nunca lê token da query.** E o `errors.filter.ts:49,55,62` passa a gravar `req.path` (sem query)
  e a query mascarada. Isso também resolve o `?access_token=` do SSE que já existe hoje.
- **O header `Authorization` nunca é gravado.** Hoje o filtro grava só o `user-agent`, e isso precisa
  continuar assim. Fica um teste que garante isso.
- **CORS desligado em `/v1/*`** (furo 10). Sem `Access-Control-Allow-Origin`, o navegador recusa, e a
  credencial secreta não vai parar no JavaScript do site do cliente.

OWASP API Security Top 10 (2023) cobre exatamente estes pontos: API1 (BOLA, §2.4 item 2), API3 (exposição
de propriedade, §3), API4 (consumo de recurso, §5) e API7 (SSRF, §4.2).
[owasp.org/API-Security](https://owasp.org/API-Security/editions/2023/en/0x11-t10/).

---

## 6. Auditoria e transparência

### 6.1 O que fica registrado

| Evento | Onde | Conteúdo |
|---|---|---|
| Credencial criada, escopos reduzidos, rotacionada, revogada (com motivo), expirada | `AuditLog` (já existe, escopado) com `acao` nova | Quem fez, nome, prefixo visível, escopos antes e depois. **Nunca o token.** |
| Webhook criado, alterado, segredo rotacionado, desligado (manual ou automático) | `AuditLog` | Host da URL (o caminho fica fora, porque pode ter segredo). |
| **Escrita feita pela API** | `AuditLog` com coluna nova `integracaoId` (o `usuarioId` já é nulo) | No painel, "Criada por: integração *ERP Freitas* (mvt_live_Ab3k…)". Sem isso, viagem criada por API parece ter caído do céu. |
| Uso | `UsoIntegracao`, **agregado por hora**: credencial, rota sem id (`rotaSemIds`, `registro.ts:152`), status, contagem, latência p95, e se saiu dado pessoal | Gravar uma linha por requisição de robô incha o banco. O agregado responde à pergunta do art. 37. |
| Últimos erros | As últimas 200 respostas ≥ 400 por credencial | Método, rota, status, `code`, horário, IP. **Sem corpo.** |
| Entrega de webhook | `EntregaWebhook`, escopada | Evento, tentativa, status, duração, próximo horário. **Sem o corpo da resposta** (§4.2 item 6). Retenção de 30 dias. |

### 6.2 O que a empresa vê (tela *Sistema › Integrações*)

- **Lista de credenciais:** nome, prefixo, escopos em linguagem de gente ("vê viagens", "vê CPF e
  telefone dos motoristas"), criada por, último uso e IP, prazo, selos ("sem prazo", "sem uso há 90 dias",
  "criador desativado").
- **Por credencial:** gráfico simples de chamadas por dia e últimos erros com o motivo traduzido
  ("credencial sem o escopo `valores:ler`", "empresa em somente leitura").
- **Webhooks:** entregas com status, botão "reenviar" e botão "testar".
- **Alertas para o administrador** (pelo `EnvioWhatsappService`, com rota nova no catálogo): credencial
  vencendo, webhook desligado por falha, credencial marcada como vazada.

### 6.3 Credencial vazada

- **Scanner nosso.** O formato com CRC32 permite que o próprio registro de chamadas e o ErrorLog
  reconheçam o token. Token achado onde não deveria estar gera alerta pra equipe da plataforma.
- **GitHub Secret Scanning, programa de parceiros (onda 2).** Exige prefixo único, alta entropia e
  checksum (o formato do §1.1 já atende), um endpoint de verificação que confira a assinatura ECDSA do
  GitHub, e a obrigação de **revogar ou notificar** o dono. O endpoint seria `@Public()` com guard próprio de
  assinatura e entraria no boot-check do §2.4.
- **O que fazer com o token vazado é decisão do dono** (§7): revogar sozinho é o padrão do mercado e o mais
  seguro, mas derruba a integração do cliente sem ninguém autorizar (memória "Nunca retirar acesso sem
  autorização"). Sugestão: `mvt_test_` é revogado sozinho; `mvt_live_` é marcado como vazado na hora,
  avisa o administrador por WhatsApp e e-mail, e é revogado sozinho em 24 h se ninguém rotacionar.

Fonte: [GitHub, Secret Scanning Partner Program](https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program).

---

## 7. Decisões que são do dono

1. **Chave PIX e dados bancários do motorista** saem pela API em algum momento? A recomendação é não, na
   1ª onda. Se o ERP paga o acerto, o pedido vira escopo próprio, com confirmação por OTP de quem criou a
   credencial.
2. **Token vazado em repositório público:** revogar sozinho na hora, ou avisar e revogar em 24 h? A
   recomendação é a do §6.3.
3. **"Integrações" é um módulo vendido à parte ou faz parte do núcleo?** Pra segurança tanto faz, mas o
   desenho assume um módulo (passo 6 do guard), porque assim cancelar o módulo desliga toda credencial na
   hora.
4. **O texto da subseção "Integrações" nos Termos** (§3.3) precisa de versão nova publicada e de novo
   aceite antes do 1º cliente usar.

---

## 8. Ondas

### Bloqueante pra 1ª onda (sem isto, não abre)

- [ ] `IntegracaoGuard` fail-closed com os 9 passos do §2.1, em `req.integracao`, cobrando ele mesmo a
      conta, o somente leitura, o módulo e o escopo.
- [ ] Credencial `mvt_live_`/`mvt_test_` com 256 bits e CRC32, guardada como SHA-256, mostrada uma vez,
      revogação imediata, rotação com `graceAte`, último uso com IP real.
- [ ] Catálogo de escopos em `shared-types`, ligado a chaves RBAC, e escopo efetivo como interseção com
      `tetoDaConta` a cada requisição. Criação recusada no backend acima do papel do criador ou em
      `assumida`.
- [ ] `ApiPublicaBootCheck` com allowlist vazia, teste de dois inquilinos sobre todas as rotas do OpenAPI,
      teste cruzado de credenciais e teste de módulo/somente leitura (§2.4).
- [ ] `@@unique([contaId, idExterno])`, 404 pra id de outra conta, e nenhum acesso a `MotoristaIdentidade`
      ou outro model global pela API.
- [ ] Serializadores whitelist em três camadas e teste de chave proibida por recurso. CPF e telefone só
      com `motoristas:dados-pessoais`. GPS de pessoa, PIX e documentos pessoais ficam fora.
- [ ] Webhook: Standard Webhooks (HMAC-SHA256, id e timestamp assinados, duas assinaturas na rotação),
      segredo cifrado com `CRIPTO_SECRET` obrigatório, evento magro.
- [ ] SSRF completo (§4.2, itens 1 a 6), com conexão no IP validado, sem redirect, timeout e limite de
      tamanho, rodando no worker.
- [ ] Registro de chamadas externas cego pro webhook do cliente (§4.3).
- [ ] Rate limit por credencial e por conta, `ipDaRequisicao` consertado, corpo de 1 MB em `/v1`, página
      de no máximo 100, Zod `.strict()` na entrada, idempotência.
- [ ] Logs: scrubber de `mvt_`/`whsec_`, sanitizador recursivo, `req.path` no ErrorLog, CORS desligado em
      `/v1`, token só no header.
- [ ] Auditoria: `AuditLog` de criação, revogação e rotação, `integracaoId` nas escritas, `UsoIntegracao`
      agregado, últimos erros, `EntregaWebhook`.
- [ ] Tela de Integrações com o mínimo do §6.2, e Termos com a subseção "Integrações".

### Pode vir depois

- Documentação OpenAPI pública separada (gerada só de `v1/`) e o `/docs` interno fechado em produção
  (furo 9). Isso é recomendado já na 1ª onda, mas não bloqueia.
- Restrição por IP/CIDR por credencial; confirmação por senha ou OTP pra criar credencial com dado
  pessoal.
- GitHub Secret Scanning Partner Program (§6.3).
- Escopo `localizacao:ler` (posição ao vivo), com decisão sobre o parceiro autônomo.
- Evento "gordo" no webhook, pelo mesmo serializador.
- Rede Docker de saída isolada pro worker de webhook.
- Rate limit no Redis (quando houver réplica) e cota diária por plano.
- OAuth 2.0 (client credentials, ou authorization code pra marketplace de apps de terceiros). Só faz
  sentido quando houver um terceiro que integra com **várias** transportadoras. Pra empresa integrando o
  próprio ERP, a credencial de conta é o padrão do mercado (Stripe, Asaas).
- Boot-check geral cobrando que todo `@Public()` declare o guard próprio (furo 3). Vale pro sistema
  inteiro, não só pra API.
