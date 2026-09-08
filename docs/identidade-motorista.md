# Identidade do motorista — cadastro sem empresa e vínculo por convite

Desenho fechado em 08/09/2026. Separa **quem a pessoa é** de **pra quem ela roda**,
pra que o motorista possa se cadastrar no app sem pertencer a empresa nenhuma e o
vínculo com a transportadora vire um evento posterior — que pode nascer dos dois
lados.

## O problema de hoje

`Motorista` é três coisas na mesma linha:

1. **a pessoa** — CPF, nome, senha, celular, e-mail;
2. **o vínculo com a empresa** — `contaId`, `status` de aprovação, flags de
   acesso, transportadora, modalidade;
3. **o dono do dado de negócio** — 21 FKs apontam pra ela (viagens, pedágios,
   abastecimentos, stories, chat, posições, documentos…).

Como a pessoa está grudada na conta, tudo em volta ficou torto:

- O CPF é único **por conta** (`@@unique([contaId, cpf])`). A mesma pessoa vira N
  linhas independentes, uma por empresa.
- A senha é da pessoa, mas mora no vínculo. Daí nasceram os remendos:
  `AuthService.propagarSenha` copia o hash pra todas as linhas do CPF, e
  `senhaExistenteDoCpf` existe **duplicado** — em `cadastro-motorista.service.ts`
  e em `admin/motoristas.service.ts` — só pra herdar hash entre contas.
- O cadastro **precisa saber a conta antes de existir**: `resolverConta` roda
  como primeira linha do `iniciar`, e até o `CadastroMotoristaPendente` já nasce
  carimbado com `contaId`. É por isso que o código da empresa é obrigatório — sem
  ele não há onde escrever a linha. O código não é uma decisão de produto, é uma
  consequência do modelo.
- `checarDuplicados` trata "esse CPF já existe" como erro (`CPF_JA_CADASTRADO`),
  quando é justamente o caso que queremos suportar: já existe, então **vincule**.

## O modelo novo

Uma tabela nova pra identidade. `Motorista` **continua existindo e continua sendo
o vínculo** — nenhuma das 21 FKs se move, nenhuma viagem muda de dono.

```
MotoristaIdentidade  (a PESSOA — uma por CPF, na plataforma inteira)
        │ 1
        │
        │ N
   Motorista          (o VÍNCULO com uma Conta — o que já existe hoje)
        │
        └── viagens, pedágios, abastecimentos, stories, chat, …
```

### `MotoristaIdentidade` (tabela `motorista_identidades`)

| campo | por quê |
|---|---|
| `cpf` **@unique global** | a chave da pessoa. É o que permite a empresa "puxar" alguém e o app reconhecer quem volta |
| `nome`, `telefone`, `email` | dados da pessoa; o vínculo guarda uma cópia (ver abaixo) |
| `senhaHash` | **a senha passa a ter um dono só**. `propagarSenha` morre |
| `ativo`, `tentativasLogin`, `bloqueadoAte`, `ultimoLoginEm` | o bloqueio por tentativa é da pessoa, não do cadastro — hoje o `loginMotorista` já faz malabarismo pra contar tentativa em todas as linhas do CPF |
| `expoPushToken`, `pushTokenAtualizadoEm` | o aparelho é da pessoa. Sem isso, quem não tem vínculo não recebe o convite por push |

`telefone` **não** entra como `@unique` global: hoje a checagem de celular
repetido roda dentro da conta (a trava filtra o `findFirst`), então é bem
possível existirem duplicatas entre contas na base de produção — uma constraint
global derrubaria a migration. Fica índice, e a checagem continua onde está.

A tabela não tem `contaId`: entra em `MODELS_GLOBAIS` no `trava-conta.ts`, por
decisão consciente. **Consequência que não pode ser esquecida:** a trava não
protege nada aqui. Toda consulta de identidade filtra por `id`/`cpf` na mão, e é
a fronteira campo a campo (nunca `select` inteiro) que decide o que sai pra fora.

### O que muda em `Motorista`

```prisma
identidade    MotoristaIdentidade @relation(...)
identidadeId  String
/// Lado do MOTORISTA na relação. O `status` é a decisão da EMPRESA; este é a
/// dele. O vínculo só vale com os dois verdes.
aceite        AceiteVinculo @default(ACEITO)   // PENDENTE | ACEITO | RECUSADO
convidadoPor  User?     // quem puxou o CPF no painel
convidadoEm   DateTime?
aceiteEm      DateTime?
```

`StatusMotorista` **não muda** — continua sendo a decisão da empresa
(`PENDENTE_APROVACAO | APROVADO | REJEITADO`), lida em dezenas de lugares no
painel e nos apps. O aceite é um eixo novo e ortogonal; tudo que existe hoje
nasce `ACEITO` na migration, então nada muda de comportamento.

**Regra única de vínculo vivo**, num helper só (`common/vinculo.ts`), pra não
espalhar a condição: `ativo && status !== "REJEITADO" && aceite === "ACEITO"`.
Os pontos que precisam obedecer: `abrirSessao`, `cadastrosDoMotorista`,
`trocarEmpresa` e o `JwtStrategy`.

### `nome`/`cpf`/`telefone` continuam no `Motorista`

De propósito, como **cópia denormalizada**. São ~200 consultas fazendo
`select: { nome, cpf }` no painel, nos relatórios, no export, no chat. Tirar
agora significaria reescrever tudo isso num PR que já mexe em auth e migration.

A fonte da verdade passa a ser a identidade; a cópia é mantida por um ponto único
(`sincronizarVinculos(identidadeId)`), chamado quando a pessoa edita o perfil. O
`senhaHash` do vínculo é o único que sai **do caminho de leitura já na fase 1**:
o login passa a olhar só a identidade. A coluna fica um ciclo pra trás como rede
de segurança e é dropada depois.

## Fluxos

### 1. Cadastro no app, sem empresa nenhuma

Formulário: nome, CPF, celular, senha. **O campo "Código da empresa" sai** — nas
duas bases (`apps/motorista-app/app/signup.tsx` e
`apps/motorista/src/pages/signup.tsx`). Placa deixa de ser obrigatória no
cadastro e vira coisa de perfil: placa é do trabalho, e nesse momento ainda não
há trabalho.

O código de 6 dígitos no WhatsApp continua igual. O que muda é o que acontece
quando o CPF já é conhecido:

| situação do CPF | hoje | novo |
|---|---|---|
| não existe em lugar nenhum | cria vínculo na conta do código | cria **só a identidade**. Sem empresa |
| já tem identidade e **já entrou no app** | 409 | "você já tem cadastro, entre com sua senha" → manda pro login |
| já tem cadastro (painel) e **nunca entrou** | 409 `CPF_JA_CADASTRADO` | **reivindicação** (abaixo) |

**Reivindicação — o seu cenário inverso.** A empresa cadastrou o motorista pelo
painel e ele baixa o app depois. Recusar com "esse CPF já existe" o mandaria pro
"esqueci minha senha" pra recuperar uma senha que ele nunca teve — então o
cadastro **assume o que já está lá**: a identidade que o painel criou passa a ser
dele, a senha que ele acabou de escolher vira a senha da pessoa (a que o
administrativo tinha digitado deixa de valer), e ele já entra vinculado, sem
precisar de convite.

O corte é `ultimoLoginEm`: quem já usou o app tem senha e sabe qual é — pra esse,
cadastro é login. Quem nunca entrou não tem nada a perder.

A prova de que ele é ele: o código vai pro **número que está no cadastro da
empresa**, não pro que ele digitou — mostrado mascarado na tela (`••••-1234`).
Sem essa regra, qualquer um que saiba um CPF assume o cadastro alheio. Número
desatualizado é o caminho de exceção: o admin corrige no painel, e essa correção
**também atualiza a pessoa** enquanto ela não entrou (senão o recado "peça pro
administrativo atualizar" não resolveria nada — o código continuaria indo pro
número velho). Depois que ele entra, o telefone é dele: o painel passa a mexer só
na cópia da empresa.

### 2. Login

Autentica na identidade (um `findUnique` por CPF, em vez do `findMany` +
`bcrypt.compare` em loop de hoje) e devolve:

```jsonc
{
  // formato antigo no topo — app que ainda não recebeu o OTA continua lendo isto
  "accessToken": "...", "refreshToken": "...", "status": "APROVADO",
  "cadastros": [ /* uma sessão por vínculo vivo, como hoje */ ],
  "identidade": { "accessToken": "...", "refreshToken": "..." }  // NOVO
}
```

Zero vínculos = só a parte `identidade`. Pra **app antigo** (que não sabe o que
fazer com isso) a API responde 403 com texto explicando que ele precisa
atualizar — o `AppVersionInterceptor` já carimba a versão em toda request, então
dá pra decidir com segurança. Isso só acontece com quem se cadastrou pelo app
novo e tenta entrar num aparelho desatualizado.

### 3. A empresa puxa pelo CPF

`POST /admin/motoristas/convidar { cpf }`, atrás de `motoristas.criar`.

- **CPF completo, busca exata, nunca lista.** Mesmo princípio do
  `GET /admin/motoristas/checar-cpf` que já existe: responde sobre um CPF que
  quem pergunta já digitou inteiro, e só isso. Nada de busca por nome ou por
  parte do CPF — seria um diretório de motoristas da plataforma inteira.
- Devolve pra conferência: **nome e telefone mascarado**. Nunca em qual outra
  empresa ele roda (a mesma linha que o `cpfEmOutraEmpresa` já não cruza).
- Cria o vínculo com `status: APROVADO` (a empresa quer ele) e
  `aceite: PENDENTE`. **Enquanto o aceite não vem, ele não aparece na lista de
  motoristas do painel** — aparece numa aba "Convites enviados". Isso evita que a
  empresa comece a operar (escalar viagem, mandar mensagem) com alguém que ainda
  não disse sim.
- Avisa por WhatsApp (rota nova `CONVITE_EMPRESA`, categoria `utility`,
  `critica: false`, decisão de provedor **por empresa** — é mensagem sobre a
  operação dela) e por push, se a identidade tiver token.
- Auditoria (`ADMIN_CONVIDOU_MOTORISTA`) e limite de convites por hora: o
  endpoint é um oráculo de "esse CPF existe aqui?" e não pode virar varredura.

CPF que não existe na plataforma continua tendo o caminho de hoje: cadastrar pelo
painel com senha inicial — que agora cria a pessoa junto. Quando ela baixar o
app, cai na **reivindicação**.

### "Novo motorista" e "Convidar por CPF" são a MESMA ação

Do ponto de vista da empresa, as duas coisas são "digitar um CPF e adicionar
alguém". Exigir que ela cadastre num lugar e convide em outro não faz sentido —
e foi assim que a primeira versão saiu: pelo formulário de cadastro o vínculo
nascia `ACEITO`, colocando na equipe alguém que nunca disse sim, enquanto o
convite pedia o aceite. Duas portas, duas regras de consentimento.

Agora quem decide não é o botão, é **o outro lado** (`nasceComoConvite`, em
`common/vinculo.ts`):

| a pessoa | o que acontece | por quê |
|---|---|---|
| **usa o app** (`ultimoLoginEm != null`) | vira **convite**: `aceite: PENDENTE`, aviso no WhatsApp, e ela só entra na equipe quando aceitar | ela está com o telefone na mão e tem como responder; decidir por ela seria passar por cima |
| **nunca entrou no app** | vira **cadastro** normal, valendo na hora | não há ninguém pra responder — o convite ficaria pendurado pra sempre. Ela assume quando baixar o app |

O corte é o mesmo `ultimoLoginEm` da reivindicação, de propósito: uma regra só,
lida do mesmo jeito nos dois fluxos. O formulário avisa ("isto aqui vira um
convite") e o botão passa a dizer **Enviar convite**; ao salvar, o painel leva
direto pra aba de convites, senão o admin cadastraria e não encontraria ninguém
na lista.

O diálogo "Convidar por CPF" continua existindo como atalho — não pede nome,
telefone nem placa, porque esses dados são dela.

### 4. O motorista aceita

Rotas novas sob token de identidade:

- `GET  /m/eu` — perfil + vínculos + convites pendentes
- `GET  /m/eu/convites`
- `POST /m/eu/convites/:id/aceitar` → `aceite: ACEITO`, devolve a sessão daquele
  vínculo já pronta (o app entra na empresa sem pedir senha)
- `POST /m/eu/convites/:id/recusar` → `aceite: RECUSADO`, some da vista dos dois
  lados; a empresa vê "recusou" na aba de convites

O código de convite da empresa **sai do fluxo**: entrar numa empresa é sempre a
empresa que inicia, pelo CPF. `Conta.codigoConvite` fica dormente no schema (a
coluna não incomoda ninguém) e some da tela de Empresas, pra não ficar um campo
que promete algo que não acontece mais.

**Exceção de transição:** o app que está no bolso dos motoristas HOJE ainda manda
o código e espera sair do cadastro já dentro da empresa, com token. Ignorar o
código faria esse app receber uma resposta sem token e quebrar — e ele é o único
que existe até o OTA chegar. Então o backend continua honrando `codigoEmpresa`
quando ele vem: guarda a conta no pendente (`contaConvite`) e, no `confirmar`,
cria o vínculo `PENDENTE_APROVACAO` como sempre criou. O caminho sai quando a
frota estiver atualizada.

## Token, guards e a fronteira

Payload ganha um terceiro tipo: `kind: "ADMIN_USER" | "MOTORISTA" | "IDENTIDADE"`.

- `IDENTIDADE` **não define conta** no contexto. O contexto fica `null` e a trava
  recusa qualquer leitura de dado de negócio — que é exatamente o certo: quem não
  está em empresa nenhuma não tem dado de empresa nenhuma pra ler. Fail-closed de
  graça.
- Rotas `m/*` continuam `@Roles("MOTORISTA")`. As novas `m/eu/*` são
  `@Roles("IDENTIDADE")`.

**Bug a consertar no caminho** — `RolesGuard` hoje faz:

```ts
const userRoles = user.kind === "ADMIN_USER" ? ["ADMIN_USER"] : ["MOTORISTA"];
```

Qualquer coisa que não seja admin é tratada como motorista. Do jeito que está, um
token `IDENTIDADE` passaria por `@Roles("MOTORISTA")` e chegaria em endpoint de
lançamento. Tem que virar mapa explícito por `kind`, fail-closed pro que não
conhece — antes de existir o terceiro tipo.

## App pessoal (o motorista sem empresa)

Ele não fica olhando pra uma sala de espera: registra os **gastos dele**
(abastecimento, pedágio, corrida) e vê o resumo do mês. É o que dá motivo pra
baixar o app antes de ter empresa, e combina com o que ele é — parceiro
autônomo, não funcionário esperando crachá.

**Isso não reaproveita `Viagem`/`Abastecimento`.** Duas razões duras:

1. Todo modelo de negócio exige `contaId` (a trava), e não existe conta aqui.
   Inventar uma conta-fantasma significaria migrar linha entre contas quando ele
   for vinculado — que é justamente o que a trava proíbe.
2. Lançar viagem depende de catálogo (material, cliente, local, veículo) que só
   existe dentro de uma empresa.

Então: tabelas próprias, chaveadas por `identidadeId`, em `MODELS_GLOBAIS`.
Nomes propostos: `GastoPessoal` (tipo `ABASTECIMENTO | PEDAGIO | OUTRO`, valor,
litros, km, data, foto opcional) e `CorridaPessoal` (origem, destino, km, valor
recebido, data). Sem FK pra conta, sem FK pra catálogo — texto livre.

**O que é dele continua dele.** Quando uma empresa vincular esse motorista, ela
**não** enxerga nada disso: gasto pessoal não é dado da transportadora. O
histórico não migra, não é copiado, não aparece em relatório de empresa — ele
segue no app dele, na aba "Meus gastos", vinculado ou não.

Como a trava não protege essas tabelas, o isolamento passa a depender de todo
`where` levar `identidadeId`. É a mesma classe de erro que causou os vazamentos
de `$queryRaw` — então o acesso fica num serviço só, que recebe o id da
identidade do token, e um teste cobra que nenhuma consulta a essas tabelas rode
sem esse filtro.

## Ordem de execução

**Fase 1 — identidade e vínculo** (o que destrava tudo)
1. ✅ `RolesGuard` com mapa explícito por `kind` (fail-closed).
2. ✅ Migration `20260908210000_identidade_motorista`: cria
   `motorista_identidades`, `AceiteVinculo` e as colunas em `motoristas`.
3. ✅ Backfill: uma identidade por CPF distinto — nome/telefone/e-mail/senha do
   cadastro mais recente (mesmo desempate que o antigo `senhaExistenteDoCpf`
   usava) — e liga todos os vínculos daquele CPF.
4. ✅ `AuthService`: login pela identidade, token `IDENTIDADE`, `propagarSenha`
   numa linha só, e a rede de segurança do `conferirSenha` (se o hash eleito na
   migração não bater, tenta os dos vínculos e cura a identidade).
5. ✅ Cadastro sem código: identidade nova, reivindicação do cadastro que a
   empresa criou, OTP no número de arquivo.
6. ✅ `m/eu/*`: perfil, placas, empresas, convites (aceitar/recusar), push token.
7. ✅ `GET /admin/motoristas/procurar-cpf` + `POST /admin/motoristas/convidar`,
   com teto de buscas por usuário; convite pendente sai da lista de motoristas.
8. ⬜ `identidadeId` obrigatória (migration seguinte, depois de conferir zero
   nulos em produção) e `senhaHash` do vínculo dropado.
9. ✅ Painel: filtro "Vínculo" (convites enviados/recusados), diálogo "Convidar
   por CPF" e auditoria (`ADMIN_CONVIDOU_MOTORISTA`, `MOTORISTA_ACEITOU_VINCULO`,
   `MOTORISTA_RECUSOU_VINCULO`).
10. ✅ Apps (nativo e PWA): campo de código fora dos dois signups, placa
   opcional, aviso de reivindicação na tela do código, tela "sem empresa" com os
   convites (aceitar/recusar) e a sessão da pessoa em `lib/identidade.ts`.

**Fase 2 — o caderninho dele** ✅ (09/09/2026)
- `LancamentoPessoal`: UMA tabela, não duas. `tipo` distingue o que entrou
  (`GANHO`) do que saiu, e o resto (litros, odômetro, descrição) é opcional —
  duas tabelas dariam duas listas, dois formulários e dois resumos pra somar no
  fim. Sem `contaId`, chaveada por `identidadeId`, em `MODELS_GLOBAIS`.
- `clientId` único **por pessoa**: idempotência do outbox sem que o id de um
  caderninho possa colidir com o de outro (colisão global viraria 500).
- Rotas em `m/eu/lancamentos` (listar, resumo do mês, criar, apagar). Nenhum
  endpoint de admin: **nenhuma empresa lê isto**, nem quando ela o vincula.
- Nos dois apps: tela "Meus gastos" com o mês (recebi / gastei / sobrou + R$ por
  litro), lançamento offline com selo "Vai subir depois", e drain ao abrir.
  Namespace por PESSOA (`ronan.eu.<id>.*`), não pelo storage carimbado por
  empresa — gasto do próprio bolso não some quando ele troca de transportadora.
- Sem feature flag de propósito: não é lançamento da empresa, é o dinheiro dele.

Pendente da Fase 2: foto do comprovante (exige upload por identidade, fora do
MinIO por conta) e edição de um lançamento já enviado (hoje: apagar e relançar).

## Ficou decidido depois

- **O motorista pode sair de uma empresa por conta própria?** Hoje não pode, e o
  aceite não muda isso (recusar convite ≠ sair depois de aceito). Se for pra
  existir, é `aceite: RECUSADO` com data — e a empresa mantém o histórico de
  viagens dele, que é dela.
- **Push token na identidade x no vínculo.** O desenho põe na identidade (o
  aparelho é da pessoa). O `PushService` hoje resolve pelo vínculo; na fase 1
  ele ganha fallback pra identidade, sem mudar o resto.
- **Diretório de empresas pro motorista se candidatar** — descartado por ora: a
  entrada é sempre por convite da empresa.
- **Armadilha ao testar o PWA local**: `lib/api-url.ts` recusa `localhost` de
  propósito (pra não vazar URL de teste no bundle) e cai no fallback, que é a
  **API de produção**. Pra apontar pro backend local, use o IP da máquina na
  rede (`VITE_API_URL=http://192.168.x.x:3000`) — `localhost` faz o app falar
  com produção sem avisar.
