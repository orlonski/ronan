# Acesso ao app do motorista — desenho

> Desenhado por uma squad de 9 agentes em 22/09/2026 (mapa do backend, do app,
> do painel e do mercado; 3 arquitetos; crítico adversarial; síntese).
> **As decisões do dono abaixo VENCEM o texto original do desenho.**
>
> ⚠️ **Obra e diária saíram do sistema em 22/09/2026** (decisão do dono;
> nenhuma empresa usava). As capacidades `app.diaria.lancar`,
> `app.diaria.verValor` e `app.obra.presenca`, o módulo `mensal`, as rotas
> `/m/obra/*` e `encerrar-diaria` não existem mais. Onde o texto abaixo cita
> diária, obra, alocação ou `mensal`, é histórico do desenho.

## Decisões do dono (22/09/2026) — não reabrir sem ele

1. **Nenhuma empresa perde funcionalidade no app sem autorização explícita dele**,
   vendo antes a lista nominal de quem perde o quê. Toda camada que corta
   (contrato, regime, plataforma, dependência) nasce em SOMBRA e só passa a
   valer por ação dele, empresa por empresa. APROVACAO nasce valendo porque já
   vale hoje (cadastro em análise ou inativo não usa o app).
2. **Exceção herdada da migração NÃO vence.** O presente fica congelado; o
   painel mostra "N exceções herdadas pra revisar" e ele resolve quando quiser.
3. **CLT que dirige lança viagem se o perfil dele permitir** — e o perfil é
   100% configurável na tela. Perfis sugeridos são só semente.
4. **Empresa nova parametriza o padrão de acesso na configuração da empresa**
   (cada uma opera diferente), partindo de modelos da plataforma. Nunca um
   default fixo do código.
5. (Recomendação seguida) CPF que é CLT e é cadastrado como parceiro: aviso
   com motivo obrigatório, sem trava.

## O que já foi entregue

- **F0** (commit 55c642b): ponto do CLT puro pelo token da pessoa; perfis com
  trava de frota e auditoria; ficha mostrando a guiada certa; miúdos.
- **F1**: catálogo `shared-types/src/capacidades-app.ts`; tabelas de regra,
  exceção, efetivo e log; `common/acesso-app/resolver.ts` (puro, testado);
  espelho do cadastro (`fonte: COLUNAS`) de hora em hora com portão que só
  grava se reproduzir a ficha de cada aprovado. Ninguém lê o efetivo ainda.
- **F2**: a empresa passa da ficha pras regras por um botão (conferido: as
  colunas saem idênticas) e daí em diante o resolvedor é o único escritor dos
  `pode*`. Tela `/acesso-app` (Perfis, Quem recebe, Exceções) com simulação;
  card na ficha do motorista e em "Quem bate ponto"; coluna e seleção em lote
  na lista (exceção ou perfil fixado pra vários); "vai entrar como" no
  cadastro novo. Recálculo na hora ao criar/importar/aprovar motorista,
  contratar/desligar funcionário e abrir/encerrar alocação na obra; cron de 2
  min cobre o resto. Nas regras, o PATCH antigo de acessos e a tela antiga de
  perfis recusam com 409 (o caminho é a exceção com motivo).
  Depois: fixar perfil (ou voltar às regras) pela ficha, filtros "perfil do
  app" e "com exceção" na lista, filtros de prazo na aba Exceções e o aviso
  "N herdadas pra revisar · N vencem em 7 dias". **D4 não entrou de
  propósito:** a decisão 2 do dono (acima) diz que exceção herdada não vence;
  o prazo de 90 dias era só a recomendação da squad.
- **F3 (parte 1)**: o app recebe o acesso calculado. Sem `/m/acessos` novo: o
  bloco vem dentro do `GET /m/eu` (que o app já busca no boot e guarda
  offline) e em `GET /m/eu/acessos` (revalida ao voltar pro primeiro plano),
  uma entrada por empresa. **No app, a capacidade só TIRA**: cada item aparece
  se aparecia antes E a capacidade não é `false`; sem resposta pra empresa,
  tudo como antes. Aba Ponto, Conversas, stories, posição, programação,
  acertos, documentos, espelho e correção de ponto passam pela capacidade, e
  as 6 telas correspondentes têm guarda ("Isso não está no seu app nesta
  empresa"). A decisão (`capacidadeNaConta`) é pura e testada; o ponto se
  decide na empresa onde a pessoa é registrada.
- **F3 (parte 2)**: `x-acessos-versao: <contaId>:<versao>` em toda resposta
  `/m/*` (cache de 15s por conta); o app revalida quando sobe. `x-conta-id`
  no token da pessoa escolhe DE QUAL empregador é a batida, e pedida uma conta
  onde ela não é funcionária não cai pra outra (B3: parceiro na A e
  registrado na B tomava 403 no ponto; agora o app manda o token da pessoa +
  a conta do vínculo). `useEhFuncionario` não deduz mais nada do
  `/m/ponto/hoje`: lê o vínculo guardado e o acesso calculado.
  **Fica de propósito:** `vinculo-registrado` (carrega nome da empresa e
  admissão, que a home do registrado mostra e o acesso não traz), e o
  `CAPACIDADE_DESLIGADA` no `sync.ts` entra junto da F4, que é quando o
  servidor passa a responder isso.
- **F4**: `CapacidadeAppGuard` (APP_GUARD) cobra o acesso calculado em todo
  `/m/*`, **em sombra**: grava `CAPACIDADE_SOMBRA` (quem, o quê, qual rota, uma
  vez por dia) e deixa passar. Só barra o que está em
  `ConfiguracaoAcessoApp.capacidadesTravadas`, que a plataforma liga
  capacidade a capacidade na aba Plataforma, vendo antes a lista nominal da
  sombra dos últimos 14 dias. Recusa = 403 `CAPACIDADE_DESLIGADA`, nunca 500;
  no app o item fica no aparelho, a cópia vai pra vala e a mensagem diz que não
  precisa editar. Boot-check (`capacidades.boot-check.ts`) exige declaração
  nos 138 handlers de `/m/*`; a dívida (`endpoints-m-sem-capacidade.ts`)
  nasceu vazia e cada linha futura tem dono e prazo. Regra da classificação:
  ler o que é dele, continuar lançamento que já existe, a vala e a ciência de
  correção de ponto são LIVRES; só criar coisa nova exige capacidade.
  **Não mudou:** os `@AcessoMotorista` antigos e o WHERE do chat seguem nas
  colunas `pode*`, que o resolvedor escreve (mesmo resultado nas regras).
- **F5**: documentos de quem é REGISTRADO. `MotoristaDocumento` e
  `AssinaturaDocumento` ganharam `funcionarioId` (dono = motorista OU
  funcionário, CHECK `*_um_dono`) e o público `REGISTRADOS`. As mesmas rotas
  `/m/admissao/documentos*` servem os dois: exigência de registrado vai pro
  cadastro de funcionário, o resto pro de motorista, e o motorista CLT vê as
  duas numa lista só. O registrado sem cadastro de motorista manda com o token
  da pessoa. Assinatura confere o CPF contra o cadastro DONO do papel. Painel:
  "De quem é registrado em carteira" em Documentos exigidos, e "Documentos"
  em Quem bate ponto (ver, baixar, conferir, devolver com motivo, subir). O
  perfil herdado de registrado ganhou `app.documentos.enviar` (não aparece
  nada até a empresa pedir algum papel). **D5**: registrado pago por produção
  no cadastro de motorista pede motivo (auditoria), nunca trava.
  **Não feito, de propósito (decisão do dono, D1):** tirar o registrado do
  `m/eu/frete*` e ligar as camadas REGIME e CONTRATO — isso corta, e corta
  empresa por empresa com a lista na frente, pela aba Plataforma.

---

# Acesso ao app do motorista: desenho final

Commit de referência: `c9e2390`, de 22/09/2026. Os caminhos partem de `/Users/orlonski/dev/ronan/`. Tudo o que o mapeamento e a crítica afirmaram foi conferido no código. Antes de escrever, conferi mais três coisas:

- A migration `20260913220000_modulo_contratado` ligou nove módulos nas contas antigas e **não ligou `mensal`, `admissao` nem `ponto`**.
- `comunicacao` é `medido` e por isso fica fora de `MODULOS_PADRAO`, o que deixa o trial sem chat no contrato.
- `MotoristaDocumento.motoristaId` é obrigatório e usa `onDelete: Cascade`.

---

## 1. O problema em 5 linhas

1. Hoje o acesso é configurado **pessoa por pessoa**. São 13 colunas `pode*` no `Motorista`, que o painel edita com 13 toggles no fim da ficha, uma requisição por clique. Ninguém tem uma visão de conjunto e nada é feito em lote.
2. A mesma lista de flags aparece **escrita à mão em 7 lugares** e o padrão de cada uma **diverge em 3**: banco, formulário do painel e `normalizarMe` do app. O app chega a ligar o OCR, que custa, quando a chave falta. **Quatro flags não barram nada no servidor**, e a `podeDiaria` só filtra o catálogo.
3. Os menus do app saem de **6 fontes diferentes**. Entre elas estão flags, o 403 de `/m/ponto/hoje`, a existência de alocação, a lista de admissão vazia, `tiposServico` e `Conta.iaLeituraTicket`. O servidor não entrega um contrato de capacidades.
4. O regime (parceiro ou CLT) tem **três fontes**, e nenhuma delas chega ao app. Consequências:
   - o CLT puro fica **sem token para bater ponto** (B1, crítico, em produção hoje);
   - o CLT não tem tela de documentos;
   - o módulo contratado não vale em nenhum `/m/*`.
5. O `PerfilAcessoApp` de hoje é um **molde que copia valores**: depois de aplicado, perde a autoridade. Além disso:
   - nenhuma tela aplica o perfil;
   - `aplicar` e `editar` ignoram o escopo de frota (R1) e não gravam auditoria;
   - a ficha mostra a "Viagem guiada" sempre desligada (R2).

## 2. A ideia central

> **"A empresa não configura mais motorista por motorista: ela diz quem recebe o quê. O sistema calcula o acesso de cada pessoa pelo que já sabe dela (se é parceiro ou registrado, qual a modalidade, qual a frota), o contrato e a lei cortam por cima, e quando precisar de exceção ela tem motivo, autor e prazo. O cadastro só mostra o resultado e explica o porquê."**

A pessoa na conta, identificada por `(contaId, cpf)`, recebe um **perfil**. Quem define o perfil é uma **regra** (regime, modalidade, frota) ou, se nenhuma regra casar, o **padrão da conta**. Por cima do perfil entram as **exceções com motivo**. Depois vêm os cortes duros: **aprovação**, **contrato** (módulo) e **regime** (parceiro nunca recebe o que é de CLT, CLT nunca recebe o que é de parceria).

Uma função só calcula esse resultado. O efetivo é **materializado** por um escritor único, como o `ViagemValor`. O app recebe o resultado já pronto e nunca deduz nada.

O que fica no código e o que vira dado:

- **Código:** a chave de cada capacidade, o que ela significa, a ordem e os rótulos do menu.
- **Dado:** quem recebe cada capacidade, e portanto quais itens do menu cada pessoa enxerga.

## 3. Modelo de dados (`apps/api/prisma/schema.prisma`)

### 3.1 O que muda em models que já existem

```prisma
model PerfilAcessoApp {                 // EXISTE (c9e2390) — na UI: "Perfil do app"
  // ...nome, descricao, ativo, sugeridoPara, contaId (como hoje)
  capacidades String[] @default([])     // NOVO — a FONTE (como Papel.permissoes)
  modeloId    String?                   // rastro de cópia de PerfilAcessoAppModelo
  // as 13 colunas pode* ficam @deprecated: backfill → capacidades; caem na F6
  regras      RegraAcessoApp[]
}

model Motorista {
  perfilAcessoId  String?   // MANTIDO (sem rename). Novo sentido: "perfil fixado à mão", pula as regras
  perfilFixadoMotivo String? // NOVO — obrigatório quando perfilAcessoId != null (Zod)
  acessoEfetivo   AcessoEfetivoApp?
  // pode*: continuam, mas viram ESPELHO escrito só pelo resolvedor
  @@index([perfilAcessoId])   // corrige o drift: a migration criou, o schema não declarava
}

model Funcionario {
  perfilAcessoId     String?   // NOVO — fixado à mão
  perfilFixadoMotivo String?
  acessoEfetivo      AcessoEfetivoApp?
}

model DocumentoExigido {
  // `publico PublicoDocumento (MENSAL|TODOS)` → vira lista, editável na tela de documentos exigidos
  publicos PublicoDocumento[]   // enum novo: PARCEIRO_OBRA | PARCEIRO_FRETE | EMPREGADO
}

model MotoristaDocumento {
  motoristaId   String?        // era obrigatório
  funcionarioId String?        // NOVO — o CLT puro precisa de onde gravar documento
  // CHECK (num_nonnulls("motoristaId","funcionarioId") = 1) na migration SQL
}
```

### 3.2 Models novos

Todos os models de conta usam `contaId @default("__SEM_CONTA__")` e relação com `Conta`, como no padrão da trava. Os modelos da plataforma entram em `MODELS_GLOBAIS` (`apps/api/src/common/conta/trava-conta.ts:33`).

```prisma
enum VinculoApp       { QUALQUER MOTORISTA FUNCIONARIO }
enum CondicaoRegime   { QUALQUER PARCEIRO EMPREGADO NAO_DECLARADO }
enum EfeitoExcecao    { CONCEDER NEGAR }
enum ModoAcessoApp    { SOMBRA ATIVO }

/// "Quem recebe qual perfil". Ordenadas; a PRIMEIRA que casa vence. Campo nulo/QUALQUER = não importa.
model RegraAcessoApp {
  id               String  @id @default(uuid())
  contaId          String  @default("__SEM_CONTA__")
  conta            Conta   @relation(fields: [contaId], references: [id])
  ordem            Int
  nome             String
  ativo            Boolean @default(true)
  vinculo          VinculoApp     @default(QUALQUER)
  regime           CondicaoRegime @default(QUALQUER)
  modalidadeId     String?        // ModalidadeMotorista — a ideia original do dono, no lugar certo
  transportadoraId String?
  perfilId         String
  perfil           PerfilAcessoApp @relation(fields: [perfilId], references: [id])
  criadoPorId String?; alteradoPorId String?
  criadoEm DateTime @default(now()); alteradoEm DateTime @updatedAt
  @@index([contaId, ordem])
  @@map("regras_acesso_app")
}

/// O "todo o resto" da conta + interruptores da transição.
model ConfiguracaoAcessoApp {
  contaId                   String  @id
  perfilPadraoMotoristaId   String?
  perfilPadraoFuncionarioId String?
  versao                    Int     @default(1)          // sobe a cada recálculo → header pro app
  camadasEmSombra           String[] @default(["CONTRATO","REGIME","APROVACAO"]) // o que só LOGA
  modoGuard                 ModoAcessoApp @default(SOMBRA)
  @@map("configuracao_acesso_app")
}

/// Exceção individual: conceder ou negar UMA capacidade. Motivo obrigatório. Nunca fura contrato/regime.
model ExcecaoAcessoApp {
  id          String  @id @default(uuid())
  contaId     String  @default("__SEM_CONTA__")
  conta       Conta   @relation(fields: [contaId], references: [id])
  cpf         String
  capacidade  String
  efeito      EfeitoExcecao
  motivo      String            // Zod min 10, como checarAlteracaoKm
  expiraEm    DateTime?
  origem      String  @default("MANUAL")   // MANUAL | MIGRACAO
  criadoPorId String?           // null = sistema (migração)
  criadoEm    DateTime @default(now())
  revogadaEm  DateTime?; revogadaPorId String?; motivoRevogacao String?
  chaveViva   String?           // "<cpf>:<capacidade>" enquanto viva — o truque do RegimeVigente
  @@unique([contaId, chaveViva])
  @@index([contaId, cpf])
  @@map("excecoes_acesso_app")
}

/// EFETIVO MATERIALIZADO por pessoa na conta. Escritor único: AcessoAppService.recalcular.
/// FKs reais (1-1) pra o WHERE relacional funcionar — ver §5.4.
model AcessoEfetivoApp {
  id            String   @id @default(uuid())
  contaId       String   @default("__SEM_CONTA__")
  cpf           String
  motoristaId   String?  @unique
  motorista     Motorista?   @relation(fields: [motoristaId], references: [id], onDelete: Cascade)
  funcionarioId String?  @unique
  funcionario   Funcionario? @relation(fields: [funcionarioId], references: [id], onDelete: Cascade)
  capacidades   String[]         // SÓ o que vale (aplicando as camadas ATIVAS)
  capacidadesSombra String[]     // o que valeria com TODAS as camadas (relatório de sombra)
  explicacao    Json             // { [chave]: { ligado, camadas:[{camada, ref, detalhe}] } }
  hash          String
  proximaMudanca DateTime?       // menor expiraEm / vigenteAte — leitura recalcula se passou
  calculadoEm   DateTime
  @@unique([contaId, cpf])
  @@index([contaId])
  @@map("acessos_efetivos_app")
}

/// Append-only: decisões (regra/perfil/exceção) E efeito (quem ganhou/perdeu o quê, quando).
model LogAcessoApp {
  id       String   @id @default(uuid())
  contaId  String   @default("__SEM_CONTA__")
  tipo     String   // REGRA_*, PERFIL_*, EXCECAO_*, PADRAO_ALTERADO, EFETIVO_MUDOU, RECALCULO_EM_MASSA
  cpf      String?
  alvoId   String?
  ganhou   String[] @default([])
  perdeu   String[] @default([])
  antes    Json?;  depois Json?
  causa    String?  // "REGRA_EDITADA:<id>", "REGIME_ABERTO", "EXCECAO_VENCEU", "MODULO_DESLIGADO"…
  motivo   String?; autorId String?
  criadoEm DateTime @default(now())
  @@index([contaId, cpf, criadoEm])
  @@map("log_acesso_app")
}

/// Plataforma (GLOBAL): modelos que a empresa COPIA — espelho do PapelModelo. Só na F2+.
model PerfilAcessoAppModelo {
  id String @id @default(uuid()); nome String @unique; descricao String?
  capacidades String[]; regimeSugerido RegimeTrabalho?; publicado Boolean @default(false)
  @@map("perfis_acesso_app_modelos")
}
```

Os rollouts ganham uma coluna em `Conta`: `rolloutsApp String[] @default([])`, ligada na tela **Empresas** da plataforma. A regra da casa vale aqui: recurso que custa, ou que ainda está em rollout, é da plataforma e não entra na matriz.

Novos valores em `AcaoAuditoria`: `ACESSO_APP_PERFIL`, `ACESSO_APP_REGRA`, `ACESSO_APP_EXCECAO` e `ACESSO_APP_RECALCULO_EM_MASSA`.

## 4. Catálogo de capacidades do app

### 4.1 Onde fica e como é cada item

O catálogo fica em `packages/shared-types/src/capacidades-app.ts`, como evolução de `acesso-app.ts`, que passa a reexportar o necessário. Ele é **código**, porque o app precisa saber o que é "ponto". **Quem recebe cada capacidade é dado.**

Todas as chaves usam o prefixo `app.` para não colidir com `acertos.ver`, `programacao.ver` e outras do painel (`permissoes.ts:110,169`). O módulo de cada uma é **explícito**, porque `moduloDaChave("app.x")` devolve `undefined` e o `tetoDaConta` deixaria passar.

```ts
export type CapacidadeAppDef = {
  chave: `app.${string}`;
  label: string; efeito: string; grupo: GrupoCapacidadeApp;
  tipo: "EMPRESA" | "ROLLOUT" | "PLATAFORMA";
  vinculo: "MOTORISTA" | "FUNCIONARIO" | "QUALQUER";   // onde a capacidade MORA (estrutural)
  regimesProibidos?: ("EMPREGADO" | "PARCEIRO")[];     // guarda-corpo jurídico — só onde MUDA algo
  modulo: ModuloChave;                                 // explícito, nunca derivado do prefixo
  dependeDe?: { algum: ChaveApp[] };
  gate: "SERVIDOR" | "FILTRO" | "SO_TELA";             // o painel mostra "só muda a tela" com honestidade
  custa?: boolean;
  aoPerder: "VALA" | "RECUSAR";                        // item offline que chega depois de perder (§6.4)
  sobreviveCancelamento?: boolean;                     // espelho de ponto (o trabalhador tem direito aos registros)
  colunaLegada?: AcessoAppChave;                       // ponte com as pode* do Motorista
};
```

### 4.2 Tabela completa

Legenda da coluna Gate: **S** = o servidor barra, **F** = o servidor filtra o dado, **T** = só muda a tela.

| Chave | O que libera no app | Endpoints que gateia | Grupo | Vínculo · regime proibido · módulo | Gate | Custa | Legado |
|---|---|---|---|---|---|---|---|
| `app.viagem.lancar` | Home "Nova viagem", `/nova-viagem`, passo do tutorial | `POST /m/viagens`, `POST /m/uploads/ticket`; agente `lancar_viagem` (`whatsapp/agente/tools.ts:561`) | Viagens | MOTORISTA · — · operacao | S | | podeLancarViagem |
| `app.viagem.guiada` *(ROLLOUT, depende de `viagem.lancar`)* | Herói "Iniciar viagem", banner Retomar, `AnuncioIniciarViagem`, `/iniciar-viagem`, `/viagem-guiada`, `/finalizar-viagem`, `/editar-viagem-guiada` | `m/viagem/*` inteiro, incluindo os GETs `tipos-evento`, `tipos-ocorrencia` e `andamento`, hoje abertos. Fecha o R3 | Viagens | MOTORISTA · — · operacao* | S | | podeViagemLifecycle |
| `app.viagem.gpsClassico` *(ROLLOUT)* | Botão "Iniciar viagem com GPS" (tracking legado), `/viagem-andamento` | `/m/tracking-config` | Viagens | MOTORISTA · — · operacao | S | | podeIniciarViagem (**rótulo corrigido**: não é "Navegação ao vivo", B10) |
| `app.navegacao.aoVivo` | Navegação por voz (Valhalla) dentro da viagem | `POST /m/rotas/navegar` | Viagens | MOTORISTA · — · operacao | S | sim (Valhalla) | nova; backfill a partir de podeIniciarViagem |
| `app.pedagio.lancar` | Home "Pedágio", `/novo-pedagio` | `POST /m/pedagios`, `/m/pedagios-rodovia` | Gastos | MOTORISTA · — · operacao | S | | podeLancarPedagio |
| `app.abastecimento.lancar` | Home "Abastecimento", `/novo-abastecimento` | `POST /m/abastecimentos`, `postos-recentes`, `POST /m/uploads/abastecimento` | Gastos | MOTORISTA · — · operacao | S | | podeLancarAbastecimento |
| `app.ticket.ocr` *(depende de `viagem.lancar` ou `viagem.guiada`)* | Leitura automática do ticket em `/nova-viagem` | `/m/ia/ticket` | Viagens | MOTORISTA · — · conferencia (absorve `Conta.iaLeituraTicket`) | S | **sim** | podeUsarOcrTicket |
| `app.km.referencia` | Sugestão de km em `/nova-viagem` | `/m/km-referencia` (passa a barrar) | Viagens | MOTORISTA · — · operacao | S | | podeReferenciaKm |
| `app.locais.verTodos` | Busca de local por nome em `descarga-por-gps` | nenhum (declarado) | Viagens | MOTORISTA · — · operacao | T | | podeVerTodosLocais |
| `app.posicao.compartilhar` | Banner e item "Compartilhar posição", `/perfil-posicao`, geofence e posição periódica | `PUT /m/posicao-config`; `POST /m/posicoes` (com algum de posicao, gpsClassico ou guiada) | Localização | MOTORISTA · — · operacao | S | | nova; backfill: todos |
| `app.programacao.ver` | Perfil > "Minha programação", `/programacao` | `/m/programacao` | Operação | MOTORISTA · — · torre* | S | | nova; backfill: todos |
| `app.acertos.ver` | Perfil > "Meus acertos", `/meus-acertos` | `/m/acertos` | Dinheiro | MOTORISTA · **EMPREGADO** · financeiro | S | | nova; backfill: todos (hoje `!useEhFuncionario`) |
| `app.chat.usar` | Aba Conversas, `/chat/*`, `AnuncioChat`, push de chat | `m/chat/*` inteiro; WHERE de contatos e de aviso em massa | Convívio | MOTORISTA · — · comunicacao | S+F | sim (medido) | podeChat |
| `app.stories.ver` | StoriesBar, `/stories/[id]` | `GET /m/stories/feed`, `:id/foto`, `visto`, `reacao` | Convívio | MOTORISTA · — · comunicacao | S | | podeVerStories |
| `app.stories.publicar` | "+" da StoriesBar, `/stories/nova` | `POST /m/stories`, `POST /m/uploads/story` (hoje aberto) | Convívio | MOTORISTA · — · comunicacao | S | | backfill = podeVerStories |
| `app.ponto.bater` | Aba Ponto, herói da HomeRegistrado | `POST /m/ponto/marcacoes`, `GET /m/ponto/hoje`, `GET /m/ponto/catalogo` | Ponto | **FUNCIONARIO** · — · ponto | S | | nova |
| `app.ponto.espelho` *(sobrevive ao cancelamento)* | `/meu-espelho`, "Meu espelho" | `GET /m/ponto/espelho`, `POST /m/ponto/espelho/conferir` | Ponto | FUNCIONARIO · — · ponto | S | | nova |
| `app.ponto.corrigir` | `/corrigir-ponto` | `POST`/`DELETE /m/ponto/correcoes*`, `ciencia` | Ponto | FUNCIONARIO · — · ponto | S | | nova |
| `app.documentos.enviar` | "Meus documentos" (Perfil e HomeRegistrado), BlocoDocumentos, `/documentos-da-obra`, `/assinar-documento`, push `documento-recusado` | `m/admissao/*` para MOTORISTA e FUNCIONARIO. **Quais** documentos aparecem é definido por `DocumentoExigido.publicos × regime`, que é dado | Documentos | QUALQUER · — · admissao | S+F | | nova; backfill: todos |
| `app.telemetria` *(PLATAFORMA)* | trilha `nv_*` | `POST /m/eventos` com `nv_*` | — | QUALQUER · — · plataforma | S | | podeTelemetria (sai da vista da empresa) |

\* `torre` (guiada, programação) só passa a valer no app depois do relatório de sombra (§8 e §10).

**Guarda-corpo de regime: só onde muda algo.** O EMPREGADO não recebe acertos. (Diária, obra e valor de diária também tinham o guarda-corpo; saíram do sistema em 22/09/2026 — ver a nota no topo.) Ponto não precisa de guarda-corpo por regime, porque ele **mora no vínculo `Funcionario`** e `contratar` já abre EMPREGADO na mesma transação (`ponto-admin.service.ts:266-278`). Um cadeado que não muda nada só confundiria.

### 4.3 O que fica fora do catálogo, sempre disponível e declarado

- **Livres para qualquer vínculo ativo:** Início, Perfil, Meu caderno, Pendentes, Notificações, Convites, trocar senha, `/m/me`, `/m/acessos`, `/m/versao-app`, token de push e `POST /m/lancamentos-travados` (que é a vala e **nunca** é barrada).
- **Livres para aprovados:** `/m/catalogos*`, `GET /m/rotas/*` (OSRM, usado no cálculo de km) e `POST /m/locais*`, que exige algum de `viagem.lancar`, `viagem.guiada` ou `abastecimento.lancar`.
- **Livres para o dono do item:** consertar ou encerrar algo que a pessoa já lançou (`completar-peso`, `encerrar-diaria`, `fotos`, `informar-valor-pedagio`, `responder-*`, `mensagens`, e o `DELETE` do que é dela). Quem perdeu uma capacidade **precisa conseguir fechar o que abriu**. É isso que evita a armadilha de perder `diaria.lancar` com uma diária ainda aberta.
- **Preferências da pessoa**, como `aceitaPush`, `aceitaWhatsapp` e `receberResumoDiario`, saem do PATCH de acessos.

### 4.4 O menu (`packages/shared-types/src/menu-app.ts`, novo)

O arquivo lista o que o binário conhece: abas, atalhos da home, itens do perfil e rotas de pilha, cada item com `requer` ou `requerAlgum`.

```ts
export const MENU_APP = {
  abas: [
    { id: "inicio",   sempre: true },
    { id: "historico", requerAlgum: ["app.viagem.lancar","app.viagem.guiada","app.pedagio.lancar","app.abastecimento.lancar"] },
    { id: "ponto",    requer: ["app.ponto.bater"] },
    { id: "conversas", requer: ["app.chat.usar"] },
    { id: "perfil",   sempre: true },
  ],
  rotas: { "/nova-viagem": ["app.viagem.lancar"], "/iniciar-viagem": ["app.viagem.guiada"],
           "/meu-espelho": ["app.ponto.espelho"], "/documentos-da-obra": ["app.documentos.enviar"],
           "/chat": ["app.chat.usar"], "/meus-acertos": ["app.acertos.ver"], /* … todas */ },
  // atalhosHome, itensPerfil …
} as const;
```

**Isto precisa ser dito ao dono com todas as letras:** a **ordem e os rótulos** do menu continuam no código e mudam por OTA. **O que cada pessoa vê** é dado e muda na hora, sem OTA.

### 4.5 Invariantes (`apps/api/src/common/acesso-app/catalogo.spec.ts`)

- Todo `modulo` existe em `MODULOS`, e toda `colunaLegada` existe no `Motorista`.
- Toda chave começa com `app.` e não colide com `CATALOGO_PERMISSOES`.
- `app.acertos.ver` não deixa de proibir EMPREGADO.
- Toda rota em `apps/motorista-app/app/**` aparece em `MENU_APP.rotas` ou em `ROTAS_LIVRES`. Isso fecha o B8 em tempo de build.
- Nenhum arquivo fora de `common/acesso-app/acesso-app.service.ts` escreve `pode[A-Z]\w*:` dentro de `data:` nem `acessoEfetivoApp.(create|update|upsert|delete)`. É a garantia do escritor único, e a lista de exceções só encolhe.

## 5. Como o efetivo é calculado e como a API checa

### 5.1 Função pura: `apps/api/src/common/acesso-app/resolver.ts` (com `.spec.ts`)

Segue o padrão de `viagem-minimos.ts`.

```ts
resolverAcessoApp(pessoa: {
  cpf; regime: RegimeTrabalho | null;                   // regimeDe() de common/regime-vigente.ts — a ÚNICA fonte
  motorista?: { id, ativo, status, modalidadeId, transportadoraId, perfilFixadoId },
  funcionario?: { id, ativo, perfilFixadoId },
}, conta: {
  modulosVivos: Map<ModuloChave, { vigenteAte?: Date }>;  // modulosDaConta (teto-da-conta.ts:50-68)
  rolloutsApp: Set<string>; regras; perfis; padrao; excecoesVivas;
  camadasEmSombra: Set<Camada>;
}, agora: Date): { efetivo: Set<ChaveApp>; sombra: Set<ChaveApp>; explicacao; proximaMudanca? }
```

**Precedência.** Primeiro se monta o que é concedido. Depois se aplicam as negações. Negar sempre vence conceder.

1. **Base, por vínculo** (as capacidades do vínculo MOTORISTA e as do FUNCIONARIO são resolvidas separadamente e depois unidas):
   - o perfil fixado;
   - senão, a **primeira regra ativa que casa** (vínculo, regime, modalidade, frota);
   - senão, o perfil padrão daquele vínculo;
   - senão, nada.

   Não existe união de perfis.
2. **+ Exceções CONCEDER vivas** (não revogadas e com `expiraEm` no futuro).
3. **− Exceções NEGAR vivas.**
4. **− Vínculo.** A capacidade só vale se a pessoa tem o vínculo onde ela mora, ativo nesta conta. Uma exceção não cria vínculo. Por isso o CLT sem `Motorista` não "lança viagem" de mentira.
5. **− Dependências** (`dependeDe`): guiada sem lançar e OCR sem lançar ficam de fora.
6. **− Aprovação.** Motorista fora de `APROVADO` perde tudo o que é do vínculo MOTORISTA. Isso fecha o R5.
7. **− Regime.** Regime vivo dentro de `regimesProibidos`. `NAO_DECLARADO`, que é o caso comum do frete, não corta nada.
8. **− Rollout e plataforma.** ROLLOUT fora de `Conta.rolloutsApp`; PLATAFORMA só com liberação da plataforma.
9. **− Contrato.** Módulo fora de `modulosVivos` ou fora da vigência, exceto `sobreviveCancelamento`.

Cada camada listada em `camadasEmSombra` **só grava em `sombra` e na explicação e não corta**. A explicação registra **todas** as camadas que agiram. Por isso o painel consegue dizer: "a exceção da Ana concedia, mas o módulo Comunicação não está contratado".

### 5.2 Escritor único: `apps/api/src/common/acesso-app/acesso-app.service.ts`

`recalcular(contaId, alvo: {cpfs} | "todos", causa, autorId?, tx?)` faz, nesta ordem:

1. carrega o contexto em lote e roda o resolvedor;
2. faz upsert de `AcessoEfetivoApp`;
3. escreve o **espelho** `pode*` do `Motorista` pela `colunaLegada`;
4. se o `hash` mudou, grava `LogAcessoApp EFETIVO_MUDOU` com o que foi ganho e perdido;
5. incrementa `versao`.

Acima de 200 pessoas, trabalha em lotes. A partir de 1.000, vira um job e a UI mostra "aplicando…".

**Quem dispara o recálculo**, sempre na mesma transação do evento:

| Evento | Onde se liga |
|---|---|
| Perfil, regra, padrão ou exceção criado, editado ou desligado | `admin/perfis-acesso/*` (vira `admin/acesso-app/*`) |
| Abrir ou encerrar regime | **dentro** de `common/regime-vigente.ts` (`abrirRegime` :79, `encerrarRegime` :122). Os chamadores (`mensal.service.ts:174,286`, `ponto-admin.service.ts:267,342`) herdam |
| Criar motorista (os 4 pontos) | `motoristas.service.ts:405`, `:535` (inclusive a reativação em `:522`), `importacao.service.ts:474`, `cadastro-motorista.service.ts:356`. **Ninguém mais nasce com o default do banco** |
| Status, modalidade, frota ou ativo do motorista mudou | `motoristas.service.ts` e o fluxo de aprovação |
| Funcionário contratado ou desligado | `ponto-admin.service.ts` (recalcula o CPF, o que inclui o Motorista do mesmo CPF) |
| Módulo ou rollout alterado | tela Empresas (`modulos-dialog.tsx`) → conta inteira |
| Vencimento (`proximaMudanca`) | na **leitura**: guard e `/m/acessos` recalculam na hora quando a data passou. Não há dependência de cron |
| Rede de segurança | cron 00:05 em `America/Sao_Paulo`, com `common/cron-exclusivo.ts`: varre vencidos e compara uma amostra do resolvedor com o gravado. Divergência é registrada como **bug** e corrigida |

### 5.3 Guards da API

**`apps/api/src/auth/guards/capacidade-app.guard.ts`** é um `APP_GUARD` registrado em `auth.module.ts`, junto do `JwtAuthGuard`. Como roda **antes** dos `@UseGuards(RolesGuard)` dos controllers, ele trata cada `kind` de forma explícita e fail-closed:

- rota fora de `m/*`: não é problema dele;
- `ADMIN_USER` em `m/*`: **403**;
- `IDENTIDADE` puro: só passa em handler marcado `@CapacidadeLivre({ identidade: true })`;
- `MOTORISTA` e `FUNCIONARIO`: o handler precisa declarar `@RequerCapacidade("app.x")`, `@RequerCapacidade({ algum: [...] })` ou `@CapacidadeLivre("motivo", { aprovado?, dono? })`. Sem declaração, **403**.

Não existe o `if (kind !== "MOTORISTA") return true` (`acesso-motorista.guard.ts:37`).

Outras regras do guard:

- Lê `AcessoEfetivoApp.capacidades` pela `(contaId, cpf)` do token. É um select a mais no `jwt.strategy.ts:validate`, que já vai ao banco em toda requisição.
- Cruza **ao vivo** com `modulosDaConta`, com cache curto por conta. Assim, cancelar o módulo corta na hora.
- A checagem de `APROVADO` feita à mão em `mensal.controller.ts:243`, `admissao.controller.ts:208`, `acertos.controller.ts:39` e `programacao.controller.ts:52` sai dos controllers e passa a acontecer aqui.
- Com `modoGuard = SOMBRA`, o guard só grava `CAPACIDADE_SOMBRA` (quem e o que ele teria negado) e deixa passar. A trava é ligada **por capacidade**.

**Boot-check** em `apps/api/src/common/acesso-app/capacidades.boot-check.ts`, irmão de `modulos.boot-check.ts`. Ele varre os cerca de 25 controllers `m/*` (uns 158 handlers) e derruba a subida se algum handler não declarar nada. A dívida conhecida fica em `endpoints-m-sem-capacidade.ts`, com **um dono e uma data por linha**. A lista só encolhe, e uma linha vencida quebra o CI.

**Uso fora do HTTP.** `acessoApp.exigir(motoristaId, chave)` é chamado em `whatsapp/agente/tools.ts:561` (R4) e em `viagens.service.ts`, no `create` com diária e no `iniciar`.

O `AcessoMotoristaGuard` vira um shim: `@AcessoMotorista("podeX")` passa a significar `@RequerCapacidade(colunaLegada⁻¹)`. Ele sai na F6.

### 5.4 O caso `podeChat` no WHERE: resolvido sem gambiarra

O c9e2390 acertou ao ver que valor calculado na leitura não entra em WHERE. Errou ao concluir que a solução era "deixar gente escrever o materializado". Aqui:

- **Até a F4**, os dois WHERE (`chat.service.ts:133,262-265`, `chat-admin.service.ts:151`) **continuam lendo `podeChat` sem mudar uma linha**. A diferença é que a coluna agora é escrita **só** pelo resolvedor. É o `ViagemValor`: materializado, com fonte declarada e escritor controlado.
- **Na F4**, os WHERE migram para a relação 1-1 com FK real:

  ```ts
  where: { acessoEfetivo: { capacidades: { has: "app.chat.usar" } } }
  ```

  Isso fica encapsulado no helper `comCapacidade(chave)`, em `common/acesso-app/`. `abrirConversa` passa a usar `acessoApp.tem(outroId, "app.chat.usar")`.
- **Por que não fazer JOIN direto pelo perfil:** o WHERE teria de reproduzir exceção, aprovação, regime, contrato e validade. Esquecer um fator vaza, e um parceiro com chat negado por exceção passaria a receber aviso em massa. É a mesma armadilha dos 25 pontos do `STATUS_FORA_FECHAMENTO`.

## 6. Como chega ao app e como se comporta offline

### 6.1 Contrato do servidor

`GET /m/acessos` é `@CapacidadeLivre({ identidade: true })`. O Zod dele, `AcessosAppResposta`, fica em `capacidades-app.ts`. Ele aceita o token do cadastro **e** o token da identidade, e devolve **todas as contas do CPF**, porque o token de identidade não tem conta, e isso é de propósito (`jwt.strategy.ts`):

```json
{ "versao": 42, "resolvidoEm": "…",
  "contas": [{ "contaId": "…", "nome": "Transportes X",
    "casa": "empresa" | "registrado",
    "regime": "PARCEIRO" | "EMPREGADO" | null,
    "vinculos": { "motorista": {"id","status"} | null, "funcionario": {"id"} | null },
    "capacidades": ["app.viagem.lancar", "app.ponto.bater"],
    "menu": { "abas": ["inicio","historico","ponto","perfil"] } }] }
```

- Roda em `comoSistema` e monta a saída **campo a campo**, por whitelist. É a regra das rotas públicas e dos models globais.
- **O mesmo bloco vem na resposta do login** (`auth.service.ts:184-191`) e na troca de empresa. Isso resolve B2, B6 e B7.
- **Header `x-acessos-versao`** em toda resposta `/m/*`, via interceptor ao lado de `common/app-version.interceptor.ts`. Quando a versão sobe, o app revalida em segundo plano, sem polling.
- **Seleção de conta da identidade:** header `x-conta-id`, validado contra os vínculos do CPF. `jwt.strategy.ts:139-186` e `eu.service.ts:81-106` promovem o FUNCIONARIO **dessa conta** e olham se a conta está suspensa. Isso resolve CLT na conta A e parceiro na conta B (B3).
- `/m/me` **continua devolvendo os `pode*`** do espelho, para builds antigos.

### 6.2 No app (`apps/motorista-app`)

| Arquivo | O que faz |
|---|---|
| `lib/acessos.ts` (novo) | Cache-first em `q:acessos`, **por identidade** (a resposta já vem separada por conta). Revalida no boot, no foco, ao reconectar, quando `x-acessos-versao` sobe e na troca de empresa. **Erro de rede nunca apaga o cache.** |
| `hooks/use-capacidade.ts` (novo) | `useCapacidade("app.ponto.bater")` avalia na **conta ativa** |
| `lib/visao.ts` | `casa` passa a vir de `/m/acessos`. O disco vira só fallback |
| `app/(tabs)/_layout.tsx` | O `href` de cada aba vem de `menu.abas` |
| `components/requer-capacidade.tsx` + `app/_layout.tsx` | Guarda de rota por `MENU_APP.rotas` em `router.push`, pushes (`_layout.tsx:463-507`) e deep link `ronan://`. Sem a capacidade, mostra "Isso não está no seu app nesta empresa" e oferece Voltar. Fecha o B8 |
| `hooks/use-eh-funcionario.ts` | **Removido.** Acaba a dedução pelo 403 (B5, B13, B15) |
| `lib/vinculo-registrado.ts` | Removido. O vínculo passa a vir do `/m/acessos` por conta (B3) |
| `lib/queries.ts` `normalizarMe` | Os defaults passam a ser **os do banco**, e o OCR nunca é ligado por omissão (R6, B11) |
| `lib/sync.ts` | Trata `CAPACIDADE_DESLIGADA` (§6.4). Usa `comoIdentidade` + `x-conta-id` no ponto (B1) |

### 6.3 Primeiro boot, cache ausente e app antigo

- **Login novo:** as capacidades vêm no login, então a home já nasce montada.
- **Quem já está logado e recebe o OTA** (e não faz login de novo):
  1. sem `q:acessos`, deriva do `q:me` em cache pela `colunaLegada` (compat on-read), **usando o default do banco** para chave ausente;
  2. sem `q:me`, mostra o card "Precisamos de sinal uma vez pra montar seu app". Nunca aparece uma home muda. O "Meu caderno" continua visível.
- **Build antigo** (anterior ao OTA): segue lendo os `pode*` do `/m/me`, que o resolvedor mantém em dia.

### 6.4 Acesso perdido com item parado no outbox

O acesso é revogado enquanto o motorista está sem sinal, com a tela ainda velha.

- **Servidor.** Para capacidades com `aoPerder: "VALA"` (viagem, pedágio, abastecimento, diária), o guard **nunca** simplesmente recusa. Ele verifica:
  - se o `clientId` nunca foi visto;
  - se o `ocorridoEm` é anterior ao `LogAcessoApp` que registrou a perda;
  - se a perda aconteceu **há no máximo 72h**.

  Se tudo isso se confirma, **aceita e carimba a divergência** `LANCADO_APOS_PERDER_ACESSO` (`common/divergencias.ts`), e o item vai para revisão humana. Nunca é aceito sem marca. Se não se confirma, responde `403 { code: "CAPACIDADE_DESLIGADA", capacidade }`. **Nunca 500.**
- **App.** `CAPACIDADE_DESLIGADA` **não** vira "edite o item", porque o motorista não tem como corrigir algo cuja capacidade caiu. O item **sai da fila e sobe sozinho para `/m/lancamentos-travados`** com o payload inteiro, e a tela Pendentes mostra "Enviado pro escritório conferir". Isso evita o "X com erro" para sempre.
- **Painel.** Ao salvar uma mudança que tira acesso, o aviso diz: "quem estiver sem sinal ainda vê isso até sincronizar; o que lançar nesse tempo chega pra conferência".

### 6.5 OTA ou build nativo

**Tudo é JS.** Vai por OTA no runtime `1.1.0`. **Não precisa de build nativo.** Tela nova continua exigindo OTA, e plugin ou permissão nova continua exigindo build.

Antes e depois de cada OTA, conferir a URL da API dentro do bundle e **não stashar WIP**. As colunas `pode*` do `Motorista` só caem depois de subir o piso em `versao-app`.

## 7. UX do painel

### 7.1 Tela "Acesso ao app" (`apps/dashboard/src/app/(painel)/acesso-app/`)

Substitui `/perfis-acesso` e redireciona a rota antiga. Fica sob `RequerTela("perfis-acesso.ver")`. Na primeira entrega tem **três abas**, não cinco:

1. **Perfis.** Reaproveita o editor da matriz de `configuracoes/permissoes/page.tsx`: grupos, contador, "marcar todos" e os selos **custa**, **só parceiro** (cadeado de regime), **não contratado** (cinza, como `foraDoTeto`) e **só muda a tela** (`gate: T`). Cada card de perfil mostra, **dentro do próprio card**, "Quem recebe: …" e "N pessoas".
2. **Quem recebe.** Lista curta de frases, na ordem de avaliação, com setas para subir e descer (sem arrastar):
   - "Se é **Registrado (CLT)** → **Registrado que dirige** · 14 pessoas";
   - "Se é **Parceiro** e modalidade **Agregado** → **Agregado** · 9";
   - na última linha, fixa: "**Todo o resto** → **Parceiro de frete** · 212".

   A condição é montada com `Select` e `AsyncCombobox` (modalidade, frota). Nada de `SelecaoBotoes`.
3. **Exceções.** Pessoa, capacidade, concede ou nega, motivo, autor, validade. Filtros "vencem em 7 dias", "sem prazo" e "herdadas da migração". Revogar pede motivo.

**Simular antes de salvar** vale para toda edição de perfil, regra, ordem ou padrão. O painel chama `POST /admin/acesso-app/simular`, que roda o resolvedor em dry-run com o rascunho. O modal mostra: "37 pessoas mudam: 12 perdem Conversas, 25 ganham Leitura de ticket (custa)", com a lista aberta.

- Se alguém perde acesso: botão **amarelo** "Aplicar para 37 pessoas".
- Se só há ganho: botão **verde**.
- Editar perfil **não apaga exceções**, porque exceção agora é uma camada separada.

**Banner de sombra.** "Quando o contrato valer no app, 8 pessoas perdem Conversas (módulo Comunicação não contratado)". Vem de `capacidadesSombra`.

### 7.2 Ficha do motorista e do funcionário (`motoristas/[id]/acesso-app-card.tsx`, novo)

O bloco de 13 toggles (`motorista-form.tsx:694-831`) **sai no mesmo push** em que o PATCH vira exceção. No lugar entra um card **no topo**, junto do `RegimeCard`:

- "**Parceiro de frete**, pela regra 2 (Parceiro · Agregado)". Um link "por que não caiu na regra 1?" mostra as regras que não casaram.
- Cada capacidade aparece com um chip de origem, por exemplo:
  - `perfil`;
  - `exceção de Ana, até 30/10: "teste do OCR"`;
  - `indisponível: é Registrado`;
  - `módulo não contratado`;
  - `em análise`;
  - `precisa de Lançar viagem`.

  Os dados vêm de `GET /admin/acesso-app/:cpf/explicar`, que é o mesmo resolvedor.
- **"Abrir exceção"** em cada linha: concede ou nega, motivo obrigatório, validade opcional. A validade é sugerida em 30 dias quando a exceção concede algo que custa.
- **"Ver como ele vê"** (`components/app-preview.tsx`): um celular desenhado com as abas, os atalhos da home e os itens do perfil, montado a partir de `MENU_APP` e do mesmo payload do `/m/acessos`. Não tem como mentir. Tem o modo "no aparelho dele (versão X)", usando `AppVersaoCard`.
- **"Fixar perfil"** fica em "Avançado" e exige motivo.

O mesmo card entra na ficha do funcionário (`/ponto/funcionarios`).

**Cadastro novo.** Antes de salvar aparece: "Vai entrar como **Parceiro de frete** (todo o resto)". O escritório não escolhe nada.

### 7.3 Ações em massa

A lista `/motoristas` ganha:

- a coluna "Acesso ao app" (nome do perfil, com um selo quando a pessoa tem exceção);
- filtros por perfil e "tem exceção";
- **seleção de linhas**, o primeiro `rowSelection` do dashboard, com as ações "Fixar perfil" (usando o `POST :id/aplicar` que já existe, agora com escopo) e "Conceder/Negar com motivo e prazo".

Tudo passa por `@EscopoPor` / `filtroEscopo` (R1).

### 7.4 Permissões (`packages/shared-types/src/permissoes.ts`, módulo `operacao`)

O recurso `perfis-acesso` passa a ter as ações `ver`, `criar`, `editar`, `excluir`, `aplicar`, `regras` e `excecoes`.

- Perfis, regras e padrão valem para a conta inteira e exigem `acessoGlobal`.
- Exceções respeitam o escopo de frota.
- O `PATCH /admin/motoristas/:id/acessos` vira uma fachada que cria exceção, exige `perfis-acesso.excecoes` e motivo, e sai de `motoristas.editar`.

A ordem é a da casa: chave no catálogo → gate na UI → `@RequerPermissao`.

### 7.5 Para depois, e só se alguém pedir

Grade pessoas × capacidades, aba de histórico dedicada, "Transformar em perfil" e modelos publicados pela plataforma. O `LogAcessoApp` já guarda tudo, então essas telas saem baratas quando vierem.

## 8. Migração: dia 1 sem mudar nada para ninguém

A migration `2026092xxxxxx_acesso_app` cria as tabelas e o CHECK de documentos, declara o índice e mapeia `PublicoDocumento`. Conferir com `git show --stat`. O mapeamento de público preserva a audiência de hoje, inclusive o vazamento para EMPREGADO, que fica sinalizado na tela. O script `apps/api/prisma/scripts/backfill-acesso-app.ts` é idempotente e roda uma vez por conta:

1. **Perfis que já existem:** `capacidades` recebe o valor das 13 colunas.
2. **Padrão herdado:** a combinação de flags **mais comum** entre os motoristas ativos vira o perfil "Padrão (herdado)" e vai para `perfilPadraoMotoristaId`.
3. **Exceções herdadas:** quem difere do padrão ganha uma `ExcecaoAcessoApp` **por coluna diferente**, com `origem: MIGRACAO` e motivo "Era assim no cadastro em 22/09/2026". **Ninguém é fixado.** O automático vale para todos, então contratar alguém como CLT amanhã muda o acesso dele. O prazo das exceções herdadas é a decisão D4.
4. **Capacidades novas** que hoje dependem só de dado ou valem para todos entram **ligadas** no padrão herdado:
   - `posicao.compartilhar`, `programacao.ver`, `acertos.ver`, `documentos.enviar`;
   - `obra.presenca` para quem tem alocação;
   - `stories.publicar` igual a `stories.ver`;
   - `navegacao.aoVivo` igual a `podeIniciarViagem`.
5. **Funcionário ativo:** cai no perfil "Registrado (herdado)", com `ponto.*` e `documentos.enviar`.
6. **Rollouts:** `Conta.rolloutsApp` recebe as capacidades ROLLOUT que alguém da conta tem ligadas hoje.
7. **Nenhuma regra é criada.** `camadasEmSombra = [CONTRATO, REGIME, APROVACAO]` e `modoGuard = SOMBRA`.
8. **Portão de saída:** o efetivo tem de ser **igual às colunas `pode*` em 100% dos motoristas APROVADOS e ativos**. PENDENTE e inativo ficam fora da comparação, senão o portão abortaria sempre e alguém "consertaria" afrouxando o portão. Qualquer divergência aborta sem escrever nada.

**Antes da F1, rodar em produção** (uma consulta só de leitura):

```sql
SELECT "contaId", array_agg(chave ORDER BY chave) FROM modulos_contratados WHERE ativo GROUP BY 1;
```

Com isso se sabe quem tem `mensal`, `admissao`, `ponto` e `comunicacao` antes de qualquer camada de contrato sair da sombra.

## 9. Fases de entrega

Cada fase é deployável sozinha e sai num **push só por bloco**. **Nenhuma fase exige build nativo.**

| Fase | O que entra | Arquivos principais | Efeito visível |
|---|---|---|---|
| **F0: consertos que valem por si (já)** | **B1**: ponto do CLT puro com `comoIdentidade` (OTA). **R1**: `@EscopoPor` em `aplicar`/`editar` e auditoria real. **R2**: `SAFE_SELECT` com `podeViagemLifecycle` e `perfilAcessoId`. **R6**: defaults alinhados ao banco no form e no `normalizarMe`. Índice declarado. **B9** (`"/viagens"` → `/historico`). **B10** (rótulo). **B16** (tom). Os 3 textos contraditórios sobre regime. Consulta de módulos em prod | `motorista-app/lib/{queries,sync,api}.ts`, `(tabs)/index.tsx`; `admin/perfis-acesso/perfis-acesso.{controller,service}.ts`; `admin/motoristas/motoristas.service.ts`; `dashboard/.../motorista-form.tsx`, `regime-card.tsx:22`, `ponto/funcionarios/page.tsx:44`, `perfis-acesso/page.tsx:260`; `shared-types/src/acesso-app.ts`; `schema.prisma` | CLT volta a bater ponto; ficha mostra a guiada certa |
| **F1: espinha invisível** | Catálogo v2 e `menu-app.ts`, models, resolvedor e spec, `AcessoAppService` gravando **só** `AcessoEfetivoApp`, backfill com portão, cron de consistência, invariantes | `shared-types/src/{capacidades-app,menu-app}.ts`; `api/src/common/acesso-app/{resolver,acesso-app.service,catalogo.spec}.ts`; `prisma/scripts/backfill-acesso-app.ts`; `trava-conta.ts` | Nenhum |
| **F2: escritor único + painel** | O resolvedor passa a escrever os `pode*`. Os gatilhos de §5.2 são ligados (motorista novo nasce no padrão, D3). PATCH de acessos vira exceção **no mesmo push** do card na ficha. Tela Acesso ao app (3 abas), simulação, "ver como", explicação, coluna e lote na lista | `api/src/admin/acesso-app/*`; `common/regime-vigente.ts`; os 4 criadores de motorista; `ponto-admin.service.ts`; `dashboard/(painel)/acesso-app/*`, `motoristas/[id]/acesso-app-card.tsx`, `components/app-preview.tsx`, `motoristas/page.tsx` | O escritório para de mexer em toggle: define perfil, quem recebe e exceção |
| **F3: app por dado (OTA)** | `/m/acessos` com `contas[]`, bloco no login, header de versão, `x-conta-id`. `lib/acessos.ts`, `useCapacidade`, abas e rotas guardadas, fim do `use-eh-funcionario` e do vínculo global. `sync.ts` já trata `CAPACIDADE_DESLIGADA` → vala | `api/src/motorista/acessos.controller.ts`; `auth/{auth.service,eu.service}.ts`; `auth/strategies/jwt.strategy.ts`; `motorista-app/{lib/acessos.ts, hooks/use-capacidade.ts, components/requer-capacidade.tsx, app/_layout.tsx, app/(tabs)/_layout.tsx, lib/visao.ts, lib/sync.ts}` | Menu vindo do servidor; B2, B3, B5–B8 fechados |
| **F4: servidor fail-closed** | `CapacidadeAppGuard` em SOMBRA por 2 semanas, com relatório por conta, e depois trava capacidade a capacidade. Boot-check com dívida datada. Aprovação central (R5). R3, R4. Chat pelo `comCapacidade`. Aceite com carimbo | `auth/guards/capacidade-app.guard.ts`; `common/acesso-app/{capacidades.boot-check,endpoints-m-sem-capacidade}.ts`; `motorista/*.controller.ts`; `chat/{chat,chat-admin}.service.ts`; `whatsapp/agente/tools.ts`; `common/divergencias.ts` | PENDENTE para de ler catálogo; guiada exige lançar |
| **F5: CLT completo + contrato e regime no app** | Documentos do CLT: `MotoristaDocumento.funcionarioId`, `/m/admissao` para FUNCIONARIO, `publicos` por regime. `RolesGuard`: o token promovido a FUNCIONARIO sai de `m/eu/frete*`. `temVinculoDeEmprego` no cadastro (D5). Camadas REGIME e CONTRATO saem da sombra **conta a conta**, depois do relatório (D1) | `admissao/admissao.{controller,service}.ts`; `auth/guards/roles.guard.ts`; `admin/motoristas/motoristas.service.ts`; `dashboard/.../documentos-exigidos`; app `documentos-da-obra.tsx`, `home-registrado.tsx` (OTA) | **O pedido do dono vale inteiro**: CLT com ponto e documentos, parceiro lança viagem, contrato vale no app |
| **F6: limpeza** | Rollouts na tela Empresas. `iaLeituraTicket` absorvido. Drop das 13 colunas do `PerfilAcessoApp`. `AcessoMotoristaGuard` removido. Piso de versão, e só então drop dos `pode*` do `Motorista` | `schema.prisma`; `acesso-motorista.guard.ts` (removido); `contas/_components/*` | Nenhum para o motorista |

## 10. Decisões do dono

**D1. O contrato vale no app?**
- Hoje o chat é do módulo `comunicacao`, medido e fora do trial; diária é `mensal`; documentos são `admissao`; ponto é `ponto`. As contas antigas não têm `mensal`, `admissao` nem `ponto` gravados.
- **Recomendação:** sim, mas só na F5 e depois do relatório de sombra.
  - Onde houver uso real, gravar `ModuloContratado` com a observação "herdado 09/2026".
  - No trial, **incluir o chat** no pacote de teste, porque tirar o chat do trial no dia 1 mata a demonstração.

**D2. CLT que dirige lança viagem?**
- Pelo desenho, lançar mora no vínculo `Motorista`.
- **Recomendação:** sim. O CLT que dirige tem **também** o cadastro de motorista, com regime EMPREGADO, e cai no perfil semeado "Registrado que dirige" (lança viagem, pedágio e abastecimento, sem diária nem acertos). O CLT sem cadastro de motorista só bate ponto e envia documentos.

**D3. Motorista novo nasce com o padrão da conta?**
- Hoje nasce com os defaults do banco.
- **Recomendação:** sim. É o ponto em que o "cadastrou e ficou sem nada" deixa de existir. Anunciar a mudança.

**D4. Prazo das exceções herdadas da migração.**
- **Recomendação:** 90 dias. Um banner avisa "N pessoas com exceção herdada vencendo". Renovar é um clique, e no vencimento a pessoa volta ao perfil. Sem prazo, a exceção vira a "configuração por cadastro" com outro nome.

**D5. CPF que é CLT na conta cadastrado como parceiro na mesma conta.**
- **Recomendação:** aviso com motivo obrigatório, sem trava. CLT também dirige (D2), e a trava de um regime vivo por CPF na conta já existe no `RegimeVigente`.

## 11. Riscos e o que a crítica derrubou

### Riscos que ficam

| Risco | Mitigação |
|---|---|
| Efetivo desatualizado por um gatilho esquecido | Recálculo **dentro** de `abrirRegime`/`encerrarRegime`, invariante de escritor único, cron que registra divergência como bug, leitura que recalcula ao passar `proximaMudanca` |
| Camada de contrato ou regime cortar quem usa hoje (EMPREGADO com diária, trial sem `comunicacao`) | `camadasEmSombra` por conta, relatório nominal no painel e decisão humana (D1). A lista de EMPREGADO com diária também é alerta jurídico |
| Recálculo em massa | Lotes de 200, job acima de 1.000, `versao` para o app só baixar quando muda |
| Multi-conta na identidade | `x-conta-id` validado e E2E com o mesmo CPF CLT na conta A e parceiro na B |
| Guard novo como `APP_GUARD` vendo `kind` cru | Tabela de `kind` explícita (§5.3) com spec cobrindo ADMIN_USER, IDENTIDADE, FUNCIONARIO e MOTORISTA |
| Boot-check com mais de 100 dívidas | Dono e data por linha; linha vencida quebra o CI |
| OTA só alcança o runtime 1.1.0 | Espelho `pode*` até o piso de versão; conferir a URL no bundle antes e depois |
| REP-P (Portaria 671) | Este desenho **não** afirma certificação. `app.ponto.bater` é só a capacidade; conformidade é outro assunto. `ponto.espelho` sobrevive ao cancelamento |

### O que a crítica derrubou, e por quê

- **Guard "depois do RolesGuard".** O `RolesGuard` é por controller e os `APP_GUARD` rodam antes. O guard trata o `kind` sozinho e em fail-closed.
- **"Filtrar pela conta ativa" com o token de identidade.** Ele não tem conta por desenho. A resposta vem com `contas[]` e as chamadas levam `x-conta-id` validado.
- **"Trocar o decorator" para dar documentos ao CLT.** Falta onde gravar. Precisa de `MotoristaDocumento.funcionarioId` e CHECK, e isso está orçado na F5.
- **WHERE por relação polimórfica sem FK.** O efetivo tem FKs 1-1 reais (`motoristaId`, `funcionarioId`).
- **Chaves sem prefixo.** Colidiam com `acertos.ver` e `programacao.ver` do painel. Agora são `app.*` com módulo explícito.
- **Aceite pelo `ocorridoEm` sem limite.** O timestamp vem do cliente. Agora exige `clientId` inédito, fato anterior à perda e 72h no máximo, **sempre carimba** e vai para revisão. Fora disso, sobe para a vala.
- **403 comum no outbox.** Deixaria o item preso em Pendentes para sempre. `CAPACIDADE_DESLIGADA` sobe sozinho para a vala.
- **Portão "100% igual às colunas".** Abortaria sempre por causa dos PENDENTES. Agora compara só APROVADO e ativo.
- **Todo mundo fixado na migração.** Mataria o automático para quem já existe. Agora é padrão herdado mais exceções com prazo.
- **Regra "com alocação em obra".** O acesso ligaria e desligaria a cada obra e prenderia diária aberta. Alocação continua filtrando o **dado**, e fechar o que é seu é livre para o dono do item.
- **Guarda-corpo de regime no ponto.** Era redundante, porque contratar já abre EMPREGADO. Ponto mora no vínculo `Funcionario`. O guarda-corpo fica só onde muda algo: EMPREGADO sem diária, obra, acertos e valor de diária.
- **Rename de `perfilAcessoId`.** Churn sem ganho em código que foi para produção hoje. A coluna muda só de sentido ("fixado").
- **Cinco abas e arrastar na primeira entrega.** O dono reclamou de configurar por cadastro, não de faltar poder. Ficam três abas, frases de "quem recebe" e explicação na ficha. O resto só se alguém pedir.
- **PATCH de acessos exigindo motivo antes da ficha nova.** Quebraria o formulário atual. Os dois saem no mesmo push.