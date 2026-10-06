# 09 — Arquiteto: modelo dinâmico, vínculo depois, gastos no form da viagem e pedágio de uma fonte só

Data: 05/10/2026. Redesenha **só o que muda** em relação a `03-arquiteto.md` e `proposta.md`
diante de quatro requisitos novos do dono. O que não está aqui continua valendo como estava
(módulo `despesas` adicional e dependente do Financeiro, checagem de módulo e de APROVADO no
próprio endpoint, regra de seleção do acerto da Onda 0c, leitura às cegas da IA, CLT fora do
acerto). Toda referência a código é `arquivo:linha` em `/Users/orlonski/dev/ronan`. Nada
implementado.

Mudança de nome em relação ao 03: `CategoriaDespesa` vira **`TipoDespesa`** (a proposta já
fala em "tipos de gasto" e no recurso `tipos-despesa`). O model do gasto continua `Despesa`.

---

## 0. Fatos do código que mudam o desenho

1. **A viagem não guarda quando terminou.** O model `Viagem` só tem `iniciadoEm`
   (`apps/api/prisma/schema.prisma:4489`) e `data @db.Date` (`:4335`); não há `finalizadoEm`. O
   `finalizar` grava `data`, `valorPedagioTotal`, `sincronizadoEm` e não carimba a hora do fim
   (`apps/api/src/motorista/viagens.service.ts:2440-2483`). Sem coluna nova, a "janela da viagem"
   pra sugerir vínculo não existe.
2. **O diesel já é pago por motorista+data, sem olhar viagem.** O acerto busca abastecimento só
   por `motoristaId` e data (`apps/api/src/admin/acertos/acertos.service.ts:203-209`) e o model
   nem tem `viagemId` (`schema.prisma:6096-6155`). O pedágio avulso também é por data, mas **só o
   sem viagem** (`acertos.service.ts:211-218`, `viagemId: null`); o vinculado só é pago através da
   viagem (`:181-198` → `pedagioDaViagem`, `common/acerto-motorista.ts:125-133`), e a viagem
   incompleta não entra (`:186`, `STATUS_FORA_FECHAMENTO`). É aí que nasce o "pedágio vinculado a
   viagem INCOMPLETA some" (B3 da proposta).
3. **`valorPedagioTotal` tem muitos leitores**, não só o acerto: preço com repasse
   (`common/viagem-preco.ts:210`, e é insumo do preço em `:245-256`), export do fechamento
   (`fechamentos/export-fechamento.service.ts:504`), lucro (`admin/relatorios/relatorios-lucro.service.ts:125,307`),
   relatórios (`admin/relatorios/relatorios-viagens.service.ts:277,306,384`), pré-aprovação da
   conferência (`conferencia-ticket/pre-aprovacao.service.ts:93,136-143`), resumo do app
   (`motorista/viagens.service.ts:295-355`), agente do WhatsApp (`whatsapp/agente/tools.ts:572,923`).
   Qualquer "fonte de verdade" nova que não **mantenha esse campo preenchido** quebra dez telas.
4. **Já existe o padrão de "configuração por coluna + leitor tolerante"**: `TipoServico` liga
   campos do form da viagem por colunas booleanas (`schema.prisma:2540-2549`) e o app lê com
   `regrasDoModo`, onde campo ausente no cache vale o clássico (`packages/shared-types/src/tipo-servico.ts:83-98`).
   É o molde do leitor de config, não da forma de guardar (ver 1.1).
5. **Já existe o padrão de duplicidade que marca e não recusa**: `Viagem.ticketDuplicadoDeId` +
   `duplicidadeAceitaEm` (`schema.prisma:4404-4410`), gravado no finalizar (`viagens.service.ts:2465`).
6. **Já existe o padrão "isto já é custo por outro caminho"** no lucro: título a pagar com
   manutenção ou acerto é excluído (`relatorios-lucro.service.ts:185-195`).
7. **O form da viagem manual gera o `clientId` da viagem no começo da sessão**
   (`apps/motorista-app/app/nova-viagem.tsx:159-163`), e o drain sobe viagens (e o lifecycle
   guiado) **antes** de pedágio e abastecimento (`apps/motorista-app/lib/sync.ts:1225-1245`). Dá pra
   lançar gasto amarrado à viagem que ainda nem foi salva.
8. **`expo-camera` já está no app** (`apps/motorista-app/package.json:36`): ler o QR da NFC-e
   offline é JS, vai por OTA.
9. A foto do abastecimento é exigida por coluna da conta (`Conta.exigeFotoAbastecimento`, servida
   em `motorista/motorista.service.ts:1121-1124`). O tipo de sistema "Abastecimento" **não** pode
   ter uma segunda configuração de foto: a tela de tipos edita essa coluna.

---

## 1. Tipos de gasto configuráveis e campos dinâmicos

### 1.1 Decisão: colunas pra dinheiro, JSON versionado pra formulário

| O quê | Onde mora | Por quê |
|---|---|---|
| `ativo`, `ordem`, `sistema`, `reembolsa`, `aprovaAutomaticoAte` | **Coluna** do `TipoDespesa` | O acerto e a fila de conferência **filtram** por isso em SQL. Dinheiro não mora em JSON. |
| Quais campos aparecem e com que força (oculto/pede/exige) | **`campos Json`** validado por Zod, com `v` (forma) e `camposVersao Int` (revisão) | A lista de campos vai crescer (o dono já listou nove). Com colunas, cada campo novo = migration + select no catálogo + compat no app. Com JSON, é uma entrada no catálogo de campos do shared-types e o leitor tolerante cobre cache antigo num lugar só, como `regrasDoModo` faz (`tipo-servico.ts:88-98`). |
| **Os valores** que o motorista preenche (litros, odômetro, placa, quem pagou, repassar, manutenção) | **Colunas** da `Despesa` | Litros e odômetro alimentam consumo; placa alimenta lucro por caminhão; repassar alimenta fatura; manutenção alimenta OS. Tudo isso é consulta. JSON de valores viraria `$queryRaw` com `->>`, que não passa pela trava de conta (`feedback_sql_cru_filtra_conta`). |

### 1.2 Prisma (substitui o `CategoriaDespesa` do 03, seção 2)

```prisma
enum SistemaTipoDespesa { PEDAGIO ABASTECIMENTO }

model TipoDespesa {
  contaId             String   @default("__SEM_CONTA__")
  conta               Conta    @relation(fields: [contaId], references: [id])
  id                  String   @id @default(uuid())
  slug                String   // imutável; snapshot na despesa
  nome                String   // editável
  icone               String?
  ativo               Boolean  @default(true)  // soft-delete sempre (outbox chega dias depois)
  ordem               Int      @default(0)
  /// Null = tipo da empresa (usa `campos`). Preenchido = tipo de sistema: aparece na mesma
  /// lista, mas o app abre a tela própria e `campos` é ignorado.
  sistema             SistemaTipoDespesa?
  reembolsa           Boolean  @default(true)
  aprovaAutomaticoAte Decimal? @db.Decimal(10, 2)   // nasce vazio (proposta, conflito 6)
  /// ConfigCamposDespesa (shared-types). Lido SEMPRE por `lerConfigCampos`.
  campos              Json     @default("{\"v\":1,\"campos\":{}}")
  /// +1 a cada edição de `campos`. A despesa guarda qual revisão o app usou.
  camposVersao        Int      @default(1)
  criadoEm            DateTime @default(now())
  alteradoEm          DateTime @updatedAt

  despesas    Despesa[]
  tiposEvento TipoEventoViagem[]

  @@unique([contaId, slug])
  @@unique([contaId, nome])
  @@unique([contaId, sistema])   // PG aceita vários NULL: um PEDAGIO e um ABASTECIMENTO por conta
  @@index([contaId, ativo, ordem])
  @@map("tipos_despesa")
}
```

### 1.3 Catálogo de campos (constante do produto, não da empresa) — `packages/shared-types/src/despesa-campos.ts`

O que é **constante** é a lista de campos que o sistema sabe guardar; o que é **da empresa** é o
modo de cada um. Valor e data **não são configuráveis** (sem eles não é gasto).

| Chave | Coluna na `Despesa` | Modos permitidos | Padrão do catálogo |
|---|---|---|---|
| `foto` | `DespesaFoto[]` + `justificativaSemFoto` | OCULTO · PEDE · EXIGE | PEDE |
| `litros` | `litros Decimal?` | OCULTO · PEDE · EXIGE | OCULTO |
| `odometro` | `odometro Int?` | OCULTO · PEDE · EXIGE | OCULTO |
| `estabelecimento` | `estabelecimento String?` | OCULTO · PEDE · EXIGE | PEDE |
| `placa` | `veiculoId String?` | OCULTO · PEDE · EXIGE | PEDE |
| `observacao` | `descricao String?` | OCULTO · PEDE · EXIGE | PEDE |
| `quemPagou` | `quemPagou PagadorDespesa?` | OCULTO · PERGUNTA | OCULTO (= MOTORISTA) |
| `repassarCliente` | `repassarCliente Boolean?` | OCULTO · PERGUNTA | OCULTO |
| `manutencao` | `tambemManutencao Boolean?` | OCULTO · PERGUNTA | OCULTO |

`PERGUNTA` é sim/não **sem nada marcado** (`feedback_nunca_preselecionar_motorista`). `EXIGE`
num campo de foto aceita "não tenho o comprovante" + texto, como `Viagem.justificativaSemFoto`.

```ts
export const ConfigCamposDespesa = z.object({
  v: z.literal(1),
  campos: z.record(z.string(), z.string()),   // chave → modo; desconhecidos ignorados no leitor
});
/** Total: nunca lança. Forma desconhecida (v≠1) → padrões; campo ausente → padrão do catálogo;
 *  modo inválido pro campo → padrão; campo que o app não conhece → ignorado. */
export function lerConfigCampos(json: unknown): Record<CampoDespesa, ModoCampo>;
```

Kit semeado ao ligar o módulo (constante só como seed — `feedback_nada_chumbado_em_codigo`), por
exemplo: Borracharia (`placa: EXIGE`, `manutencao: PERGUNTA`), Peça na estrada (`odometro: PEDE`,
`manutencao: PERGUNTA`), Chapa/descarga (`repassarCliente: PERGUNTA`), Alimentação (`placa: OCULTO`).
Mais as duas linhas de sistema (`sistema: PEDAGIO`, `sistema: ABASTECIMENTO`).

### 1.4 Tipos de sistema na mesma lista

- Aparecem na lista "O que você pagou?" na `ordem` que a empresa definir; tocar abre
  `novo-pedagio.tsx` / `novo-abastecimento.tsx` como hoje. Visíveis só se a capacidade própria
  estiver ligada (`app.pedagio.lancar`, `capacidades-app.ts:285`; `app.abastecimento.lancar`, `:297`).
- No painel, a tela "Tipos de gasto" mostra os dois com cadeado: edita nome/ícone/ordem; **não**
  desativa (quem desliga é a capacidade) e não edita `campos`. A foto do Abastecimento, nessa tela,
  escreve em `Conta.exigeFotoAbastecimento` (fato 9) — uma configuração só.
- Só existem com o módulo ligado. Sem o módulo, a home não muda (D5 da proposta).

### 1.5 O que a Despesa ganha (em relação ao 03, seção 2)

```
+ tipoId / tipoSlug / tipoNome          (renomeia categoria*)
+ camposVersao  Int                     revisão que o app usou
+ camposUsados  Json                    snapshot da config que o app usou (o escritório vê "foto não era exigida quando ele lançou")
+ litros        Decimal? @db.Decimal(8,3)
+ odometro      Int?
+ repassarCliente  Boolean?
+ tambemManutencao Boolean?
+ manutencao    ManutencaoVeiculo? @relation(fields:[manutencaoId]) / manutencaoId String? @unique
  quemPagou     PagadorDespesa?     (passa a ser nulo: nulo = não perguntado = MOTORISTA na leitura)
+ chaveFiscal   String?             44 dígitos, só se passar em lerChaveFiscal (seção 4.4)
+ chaveFonte    FonteChave?         QR | DIGITADA | IA
+ duplicadaDe   Despesa? / duplicadaDeId String?, duplicidadeAceitaEm DateTime?   (molde schema.prisma:4404-4410)
+ vinculoPor    VinculoPor?         CONTEXTO | MOTORISTA | ESCRITORIO
+ vinculadoEm   DateTime?
```

O servidor **não recusa** por config: campo exigido que não veio, tipo desativado, versão velha
→ carimbo (`CAMPO_EXIGIDO_AUSENTE`, `TIPO_INATIVO`). Mesma doutrina de
`project_lancamento_nunca_recusado`.

### 1.6 Como o app renderiza, offline

- `/m/catalogos` ganha `tiposDespesa: { id, slug, nome, icone, sistema, campos, camposVersao, reembolsa }[]`
  ao lado de `tiposServico` (`motorista/motorista.service.ts:1045-1061,1114-1125`). Pré-baixado no
  login (`prefetchDadosBase`), cache-first.
- `app/gasto-viagem.tsx` (novo) recebe `tipoId`; resolve `lerConfigCampos(tipo.campos)`; percorre
  a **ordem fixa do catálogo** (foto, valor, data, placa, litros, odômetro, estabelecimento,
  observação, quem pagou, repassar, manutenção) e, pra cada campo ≠ OCULTO, monta o componente de
  um **registro fechado** `CAMPOS_RENDER: Record<CampoDespesa, Componente>` no app. A ordem não é
  configurável de propósito: o motorista aprende o form uma vez.
- Validação guiada (rola até o campo, sem pop-up) só pros `EXIGE`.
- O item do outbox leva `tipoId`, `camposVersao` e `camposUsados` (a config que ele viu).
- **Compat on-read:** cache antigo sem `tiposDespesa` → `[]` e o card fica escondido até a
  revalidação; `campos` inválido → padrões do catálogo; campo novo que um app antigo não conhece →
  não é desenhado e o servidor carimba em vez de recusar; tipo que sumiu do catálogo com item na
  fila → o item sobe com o `tipoId` velho e o servidor aceita e carimba `TIPO_INATIVO`.
- Edição de `campos` no painel: PATCH valida com o Zod estrito (o leitor tolerante é só pra
  leitura), incrementa `camposVersao`. Tipo de sistema → 400 se tentar mudar `campos`.

---

## 2. Lançar sem viagem e vincular depois

### 2.1 Regra de ouro: **o vínculo não mexe no acerto**

Todo gasto pago pelo motorista entra no acerto **pelo motorista e pela data do gasto** (dia civil
de SP), com o filtro de dias de emprego e a regra de seleção da Onda 0c. Com ou sem viagem. Isso
já é verdade pro diesel (fato 2) e passa a ser pra `Despesa` e pro pedágio novo (seção 4). O
motivo: se o vínculo decidisse o pagamento, vincular/desvincular depois de um acerto fechado
pagaria duas vezes ou sumiria com o dinheiro, e viagem INCOMPLETA engoliria o gasto.

| O vínculo muda... | Como |
|---|---|
| Acerto | **Nada.** Gasto solto entra; gasto vinculado a viagem incompleta entra. |
| Lucro por caminhão | O custo vai pro `veiculoId` do gasto. Vincular **preenche** `veiculoId` com o da viagem só se estava vazio. |
| Fatura (repasse ao cliente) | Só gasto **vinculado** pode virar linha de fatura (o cliente vem da viagem). Solto com `repassarCliente = true` → carimbo `REPASSE_SEM_VIAGEM` na fila. Onda 4. |
| Pedágio da viagem (seção 4) | Pedágio vinculado a viagem "por linhas" **soma no `valorPedagioTotal` materializado** e dispara a reprecificação, como a edição do painel (`admin/viagens/viagens.service.ts:665`, `viagem-preco.ts:245-256`). Viagem já em fatura emitida: não reprecifica, carimba. |
| Relatório "Gastos da viagem" | Passa a listar. |

### 2.2 Janela da viagem (o que falta no banco)

- `Viagem.finalizadoEm DateTime?` (novo, aditivo), gravado no `finalizar`
  (`viagens.service.ts:2440`) e no `create` manual = `null`.
- Janela na leitura: guiada = `[iniciadoEm − tolerância, (finalizadoEm ?? maior EventoViagem.ocorridoEm ?? agora se EM_ANDAMENTO) + tolerância]`;
  manual = o dia civil de SP de `data`. Viagens antigas usam o fallback do evento, sem backfill.
- `tolerância` é config da conta (`Conta.toleranciaVinculoGastoMin`, seed 120), não constante.

### 2.3 Sugestão: uma função, dois lugares

`packages/shared-types/src/despesa-vinculo.ts → sugerirViagens(gasto, viagens[], tolerancia)`,
pura, usada pelo app (offline, com as viagens do cache + as do outbox, que têm `clientId`) e pela
API (fila do painel). Ranqueia:

1. **forte:** mesmo motorista, mesmo veículo, dentro da janela;
2. **média:** mesmo motorista, mesmo dia SP, outro veículo ou gasto sem placa;
3. nada além disso.

**Nunca vincula sozinha e nunca vem marcada.** O app mostra "Foi nesta viagem? Carga X → Y, 08:10–11:40"
com os botões "É desta viagem" / "Não é de viagem nenhuma". A única exceção é o **contexto**:
gasto aberto de dentro da viagem guiada ou do form da viagem nasce vinculado (`vinculoPor: CONTEXTO`)
— não é pré-seleção, é onde ele estava.

### 2.4 Vínculo offline

- Gasto ainda na fila: vincular = editar o item pendente (`viagemClientId`).
- Gasto já enviado: item novo no outbox **`vinculo-gasto`** `{ entidade: "despesa"|"pedagio"|"abastecimento", id, viagemId?, viagemClientId?, desvincular? }`.
  Entra em `SUFIXOS_OUTBOX` (`db/database.ts:537-556`), na união e no `merge` dos Pendentes
  (`app/pendentes.tsx:82-90,191-199`), no `pendingCounts` (`lib/sync.ts:878`) e no
  `rescueStaleItems` (`:1267`). Drena **depois** de `drainAbastecimentos` (`sync.ts:1245`).
- Servidor resolve `viagemClientId` → `Viagem.clientId` (`schema.prisma:4319`, `@unique`); não
  achou → grava só o `viagemClientId`, carimba `VIAGEM_NAO_ACHADA`, **não recusa**. O `create`
  (`viagens.service.ts:1407`) e o `iniciar` (`:2060`) amarram depois com `updateMany` nas três
  tabelas (best-effort, depois do create).
- Viagem de outro motorista → 409 (vai pros Pendentes, nunca 500). Viagem já faturada e pedágio
  "por linhas" → 409 "a viagem já foi faturada, fale com o escritório".

### 2.5 Rotas novas (somam à seção 3 do 03)

| Rota | Decorator | Regra |
|---|---|---|
| `PATCH m/despesas/:id/viagem` | `@RequerCapacidade("app.despesa.lancar")` + aprovado + módulo | Idempotente. Também cobre desvincular. |
| `PATCH m/pedagios/:id/viagem` | `@RequerCapacidade("app.pedagio.lancar")` + aprovado + **módulo `despesas`** | Só existe com o módulo: sem ele, pedágio segue como hoje. |
| `PATCH m/abastecimentos/:id/viagem` | `@RequerCapacidade("app.abastecimento.lancar")` + aprovado + módulo | Só exibição/fatura; consumo e acerto não leem. |
| `GET admin/despesas/sem-viagem` (com sugestões) | `@RequerPermissao("despesas.ver")` | Aba "Sem viagem" na tela de Gastos. |
| `POST admin/despesas/vincular` (lote, as três entidades) | `@RequerPermissao("despesas.editar")` | `vinculoPor: ESCRITORIO`, auditoria. |

Recursos de permissão não mudam (`despesas`, `tipos-despesa`): os 9 testes de módulos ficam como na proposta.

---

## 3. Criar a viagem e já lançar gasto

### 3.1 Onde

- `apps/motorista-app/app/nova-viagem.tsx` — logo acima do Salvar, depois do bloco do pedágio
  (`:1838-1850`).
- `apps/motorista-app/app/finalizar-viagem.tsx` — no lugar do campo Pedágio (`:770-780`) quando a
  viagem é "por linhas" (seção 4); senão, abaixo dele.
- Só com o módulo `despesas` (capacidade `app.despesa.lancar` resolvida). Sem o módulo, os dois
  forms ficam idênticos aos de hoje.

### 3.2 Forma (compacta)

Uma linha fechada: **"Gastos desta viagem · 2 · R$ 87,40"** + botão "Adicionar gasto". Tocar na
linha abre a lista (tipo · valor · status de envio). "Adicionar" abre a mesma lista "O que você
pagou?" e o form de 1.6 numa folha, com `viagemClientId` = o `clientId` da sessão do form
(`nova-viagem.tsx:159-163`) ou da viagem guiada. Sem novo componente de formulário: é o mesmo.

### 3.3 Regras

- Cada gasto é **item próprio do outbox**, enfileirado na hora (não espera o Salvar da viagem):
  dinheiro não pode morrer junto com um rascunho.
- O drain já sobe a viagem antes (fato 7); se o gasto subir antes da viagem mesmo assim, cai no
  `VIAGEM_NAO_ACHADA` e é amarrado no create.
- **Motorista descarta o form da viagem:** o app avisa "Os 2 gastos ficam guardados, sem viagem"
  e limpa `viagemClientId` dos que ainda estão na fila; os já enviados ficam com o
  `viagemClientId` órfão, que o servidor trata como solto (a sugestão do 2.3 roda pra eles).
- Pedágio e abastecimento lançados por aqui vão pras **entidades deles** (`/m/pedagios`,
  `/m/abastecimentos`) com `viagemClientId`, nunca como `Despesa`.

---

## 4. Pedágio e abastecimento nunca duplicam

### 4.1 Decisão: **(a) continuam entidades próprias; a porta única só roteia**

Justificativa:

- **Abastecimento** tem odômetro obrigatório, litros, tanque cheio, comboio, consumo tanque-a-tanque,
  conciliação do cartão, fechamento (`schema.prisma:6096-6155`, `fechamentoLinhas`). Virar linha
  de `Despesa` reescreveria `common/consumo.ts`, o cartão-combustível e o lucro de quem está em
  produção. Ganho: nenhum que o roteamento não dê.
- **Pedágio** tem leitores em dez lugares via `valorPedagioTotal` (fato 3) e `Pedagio` tem
  `FechamentoLinha` e `ItemAcerto` (`schema.prisma:5141-5143`). Como tipo de `Despesa`, seria a
  **terceira** fonte de pedágio.
- O que o dono quer de (b) — "aparecer na mesma lista" — a linha de sistema do `TipoDespesa` (1.4)
  entrega sem mover dado.

### 4.2 Uma fonte de verdade de pedágio por viagem, daqui pra frente: **as linhas**

Hoje há três lugares onde o mesmo pedágio pode estar: `Viagem.valorPedagioTotal` (digitado no
finalizar/criar), `Pedagio.valor` (avulso) e `EventoViagem.valor` do "Paguei pedágio" (que não
chega a lugar nenhum, `03`, seção 0).

**Daqui pra frente, numa viagem com o módulo:** a verdade é a **linha de `Pedagio`**; o
`valorPedagioTotal` vira **soma materializada** dessas linhas, escrita só pelo servidor, pra que os
dez leitores (fato 3) continuem funcionando sem mudar uma linha. O evento "Paguei pedágio" **gera**
a linha; não é uma fonte à parte.

**Nas viagens que já existem (e em empresa sem o módulo):** nada muda. O total digitado continua
fonte, `pedagioDaViagem` continua decidindo como hoje (`acerto-motorista.ts:125-133`), e a Onda 0a
(pré-preencher com a soma dos eventos) e a 0b (aviso de dobro) continuam valendo.

Campos novos (todos aditivos):

```prisma
// Viagem
pedagioPorLinhas Boolean   @default(false)  // true = valorPedagioTotal é soma das linhas, só o servidor escreve
finalizadoEm     DateTime?                  // seção 2.2

enum PapelPedagio {
  AVULSO            // sem viagem, ou com viagem mas ainda não decidido → pago pela data (como hoje)
  COMPOE_TOTAL      // linha de viagem por linhas → pago pela data E soma no total materializado
  COBERTO_PELO_TOTAL// "é o mesmo dinheiro do total digitado" (decisão humana) → nunca pago à parte
  LEGADO_VINCULADO  // linha antiga com viagemId (PWA) → regra antiga de pedagioDaViagem
}
enum OrigemPedagio { LEGADO APP PAINEL EVENTO_VIAGEM TOTAL_CONVERTIDO }

// Pedagio
papelNaViagem   PapelPedagio  @default(AVULSO)
origem          OrigemPedagio @default(APP)
viagemClientId  String?
eventoViagem    EventoViagem? @relation(...) / eventoViagemId String? @unique  // idempotência evento→linha
chaveFiscal     String?, chaveFonte FonteChave?
duplicadoDeId   String?, duplicidadeAceitaEm DateTime?
fotos           PedagioFoto[]   // novo, molde AbastecimentoFoto (schema.prisma:6157-6171)

// Abastecimento
viagemId / viagemClientId String?   // só exibição e fatura; acerto e consumo NÃO leem
chaveFiscal, chaveFonte, duplicadoDeId, duplicidadeAceitaEm
```

**Migração (sem efeito em produção):** `UPDATE pedagios SET "papelNaViagem" = 'LEGADO_VINCULADO', origem = 'LEGADO' WHERE "viagemId" IS NOT NULL`;
o resto fica `AVULSO` com `origem = 'LEGADO'` via SQL (o default `APP` só vale pra linha nova).
Toda viagem nasce `pedagioPorLinhas = false`. Com isso, o acerto calcula **exatamente** o que
calcula hoje. Teste de aceitação: regerar na cópia do banco, antes e depois, os acertos ABERTO de
todas as contas e comparar item a item.

**Acerto (`acertos.service.ts:179-218` + `acerto-motorista.ts:125`):**

- busca de pedágio por data: `papelNaViagem in (AVULSO, COMPOE_TOTAL)` no lugar de `viagemId: null`
  (com a migração, é o mesmo conjunto de linhas de hoje);
- `pedagios` do select da viagem: só `LEGADO_VINCULADO`;
- `pedagioDaViagem` recebe `pedagioPorLinhas`: `true` → devolve zero pra viagem (as linhas já
  foram pagas pela data). Mesma mudança no lucro (`common/lucro-veiculo.ts:3,18-21`), que soma as
  linhas pelo `veiculoId`.
- consequência boa: pedágio de viagem por linhas que termina INCOMPLETA **continua pago** (B3
  resolvido por construção, como o diesel).

**Como a viagem vira "por linhas":**

1. App novo, conta com o módulo: o payload de `iniciar`/`create` manda `pedagioPorLinhas: true`
   (campo novo no Zod — sem declarar, o Zod descarta: `feedback_zod_descarta_chave_nao_declarada`).
   O servidor só aceita se a conta tem o módulo; senão ignora. App antigo não manda → `false`, e
   tudo segue como hoje.
2. Viagem antiga (`false`) com **total vazio ou zero** recebe uma linha vinculada → vira `true`
   (não havia dinheiro em jogo).
3. Viagem antiga com **total > 0** recebe uma linha vinculada → a linha fica `AVULSO` com
   `viagemId` preenchido (o vínculo aparece; o pagamento é pela data) e o acerto mostra o aviso da
   0b. A decisão é humana (motorista no app, se ele souber; senão o escritório):
   - "Já está nos R$ X da viagem" → `COBERTO_PELO_TOTAL` (não paga à parte; vira comprovante);
   - "É outro pedágio" → **converte**: a viagem vira `true`, nasce uma linha `TOTAL_CONVERTIDO`
     com o total antigo (`COMPOE_TOTAL`) e a nova vira `COMPOE_TOTAL`. Se o `REEMBOLSO_PEDAGIO`
     daquela viagem já está em acerto FECHADO/PAGO, a linha `TOTAL_CONVERTIDO` **não entra** em
     acerto nenhum (regra explícita na seleção), senão pagaria o total de novo.

**Escritas em `valorPedagioTotal` numa viagem por linhas:**

- `finalizar` (`viagens.service.ts:2472`) e `create` (`:1619`): ignoram o valor do app; se veio e
  difere da soma, carimbo `PEDAGIO_TOTAL_DIVERGE` (o app novo nem manda).
- `informarValorPedagio` (`:459-495`, divergência PEDAGIO_SEM_VALOR): numa viagem por linhas, cria
  uma linha `COMPOE_TOTAL` em vez de escrever o total.
- edição no painel (`admin/viagens/viagens.service.ts:665,1680`): campo vira só leitura com
  "editar as linhas"; PATCH com `valorPedagioTotal` → 400 explicando.
- toda escrita de linha (criar, editar, vincular, desvincular) recalcula a soma **na mesma
  transação** e chama `precificacao.recalcularSeguro` (`admin/tabelas-preco/precificacao.service.ts:144`),
  porque o pedágio é insumo do preço (`viagem-preco.ts:245-256`). Valor congelado em fatura
  emitida não é tocado: carimbo pro escritório.
- resumo do app (`motorista/viagens.service.ts:295-355`): linhas `COMPOE_TOTAL` saem da contagem
  de "avulsos" (senão o motorista vê o mesmo pedágio duas vezes na aba).

**Evento "Paguei pedágio":** `TipoEventoViagem.tipoDespesaId` (já previsto no 03, Fatia 5)
apontando pro tipo de sistema PEDAGIO substitui o slug chumbado `paguei-pedagio`
(`admin/contas/kit-inicial.ts:190-196`). No registro do evento (`viagens.service.ts:2216-2238`),
se a viagem é por linhas e o tipo aponta pra PEDAGIO e `valor > 0`, cria a linha
`EVENTO_VIAGEM`/`COMPOE_TOTAL` (idempotente por `eventoViagemId @unique`). Tipo de evento apontando
pra ABASTECIMENTO → 400 no PATCH do tipo (faltam litros/odômetro). Viagem antiga: evento segue só
pré-preenchendo o finalizar (0a).

### 4.3 Abastecimento

Não tem dobro de fonte: só existe a linha, paga por data (fato 2). O vínculo novo com a viagem é
só pra exibir em "Gastos desta viagem" e, um dia, repasse. Tipo de empresa chamado "Diesel" ou
"Arla" no `TipoDespesa` é bloqueado no painel por **aviso**, não por lista de nomes: a tela de
tipos alerta "combustível tem tipo próprio" quando o tipo novo liga `litros`; quem decide é o
escritório (ARLA pode ser legítimo como gasto, a proposta deixou fora do kit, não proibiu).

### 4.4 Antiduplicação de comprovante: marca, nunca recusa

Três sinais, em ordem de força. Os três gravam `duplicadoDeId` (+ `duplicidadeAceitaEm` quando o
escritório aceita), molde `schema.prisma:4404-4410`. O app mostra antes de salvar "Parece o mesmo
papel do gasto de 03/10 (R$ 42,00). Salvar mesmo assim?" com "Salvar assim mesmo" (amarelo) e
"Voltar" (contorno). O servidor nunca dá 4xx por isso.

| Sinal | De onde vem | Alcance |
|---|---|---|
| **Chave de 44 dígitos igual** | QR da NFC-e lido pela câmera (offline, `expo-camera` já instalado), digitada, ou lida pela IA. Só é gravada se `lerChaveFiscal` passar com modelo 55 ou 65 (`common/chave-fiscal.ts:74`, DV módulo 11 + modelo). Chave da IA que passa no DV é guardada com `chaveFonte: IA` e serve **só** pra marcar duplicata, nunca pra afirmar valor. | Cruza `Despesa`, `Pedagio` e `Abastecimento` da conta (o mesmo cupom de posto lançado como "Outro" e como abastecimento). |
| **Mesma foto** | `sha256` dos bytes, calculado pelo servidor no upload (`uploads/uploads.service.ts`), em `DespesaFoto`, `PedagioFoto` e `AbastecimentoFoto` (coluna nova). Pega foto da galeria reaproveitada. | Idem. |
| **Parecido** | mesmo motorista + mesmo tipo + mesmo valor + mesmo dia SP. | Por entidade. É o mais fraco: rótulo "parecido", nunca "duplicado". |

Pra cruzar as três tabelas sem três varreduras: tabela `ImpressaoComprovante (contaId, tipo CHAVE|HASH, valor, entidade, entidadeId, criadoEm)`
com `@@index([contaId, tipo, valor])`, **sem unique** (unique seria recusa). Escrita no mesmo
`create` de cada entidade.

---

## 5. Fatias (cada uma vai pra produção sozinha)

Encaixe nas ondas da proposta: A entra antes da Onda 1; B–D são a Onda 1 redesenhada; E é a nova
"Gastos desta viagem"; F pode vir na Onda 2.

**A — Base aditiva, sem efeito visível** · API só
`apps/api/prisma/schema.prisma` + migration (`Viagem.finalizadoEm/pedagioPorLinhas`; `Pedagio.papelNaViagem/origem/viagemClientId/eventoViagemId/chaveFiscal/duplicadoDeId`; `PedagioFoto`; `Abastecimento.viagemId/viagemClientId/chaveFiscal/duplicadoDeId`; `AbastecimentoFoto.sha256`; `ImpressaoComprovante`; backfill do papel).
`apps/api/src/motorista/viagens.service.ts` (gravar `finalizadoEm`), `admin/acertos/acertos.service.ts`, `common/acerto-motorista.ts` + spec, `common/lucro-veiculo.ts` + spec, `admin/relatorios/relatorios-lucro.service.ts`.
Aceite: acertos ABERTO regerados na cópia de produção iguais item a item. Conferir `git show --stat` do `migration.sql`.

**B — Tipos dinâmicos (backend + painel)**
`packages/shared-types/src/{despesa.ts, despesa-campos.ts, despesa-vinculo.ts, modulos.ts, permissoes.ts, capacidades-app.ts, index.ts}` (rebuild);
`apps/api/prisma/schema.prisma` (`TipoDespesa`, `Despesa`, `DespesaFoto` com `sha256`);
`apps/api/src/admin/tipos-despesa/*`, `common/modulos/modulos.service.ts` (seed do kit + 2 linhas de sistema ao ligar), `admin/contas/kit-inicial.ts`, `motorista/motorista.service.ts` (`tiposDespesa` no catálogo), `motorista/despesas.{controller,service}.ts`, `uploads/uploads.{controller,service}.ts` (`m/uploads/despesa`, hash);
`apps/dashboard/src/app/(painel)/cadastros/tipos-despesa/` (editor de campos: uma linha por campo do catálogo com Select oculto/pede/exige — Select, nunca botões grandes).

**C — App lança pelo form dinâmico** · OTA depois de B
`apps/motorista-app/app/gasto-viagem.tsx` (novo, renderer), `app/gastos-viagem.tsx` (lista/status), `app/(tabs)/index.tsx`, `app/pendentes.tsx`, `db/database.ts`, `lib/sync.ts`, `lib/queries.ts`, `lib/validation.ts`.

**D — Vincular depois**
API: rotas do 2.5, amarração por `viagemClientId` em `motorista/viagens.service.ts` (create/iniciar), `motorista/pedagios.service.ts`, `motorista/abastecimentos.service.ts`.
App: `vinculo-gasto` no outbox (`db/database.ts`, `lib/sync.ts`, `app/pendentes.tsx`), sugestão em `gastos-viagem.tsx`.
Painel: aba "Sem viagem" em `apps/dashboard/src/app/(painel)/despesas/`.

**E — "Gastos desta viagem" + pedágio por linhas** · API antes do OTA
API: `motorista/viagens.service.ts` (`pedagioPorLinhas` no create/iniciar/finalizar/`informarValorPedagio`, evento → linha), `shared-types` (Zod de iniciar/create/finalizar), `admin/viagens/viagens.service.ts` (total só leitura), `admin/tipos-evento*` (`tipoDespesaId`, 400 pra ABASTECIMENTO), `motorista/viagens.service.ts:295-355` (resumo).
App: `app/nova-viagem.tsx`, `app/finalizar-viagem.tsx`, `lib/lifecycle.ts`, componente `components/GastosDaViagem.tsx`.
Painel: ficha da viagem com linhas de pedágio e botões da conversão (4.2, item 3).

**F — Antiduplicação**
`apps/api/src/common/comprovante-duplicado.ts` + spec (puro: decide o sinal), escrita de `ImpressaoComprovante` nos três `create`, leitor de QR da NFC-e em `shared-types` (`chaveDoQrNfce`, puro, testável) + câmera no `gasto-viagem.tsx`/`novo-abastecimento.tsx`/`novo-pedagio.tsx`, chips no painel.

---

## 6. Riscos novos que este desenho cria (e como fecha)

1. **JSON de config sem validação** vira tela que crasha: escrita com Zod estrito, leitura com
   `lerConfigCampos` total (nunca lança), testes com config lixo.
2. **Viagem por linhas em empresa sem módulo**: o servidor ignora a flag sem o módulo; módulo
   desligado depois não reverte viagens (o total materializado continua certo e pago pelas linhas).
3. **Conversão "é outro pedágio" pagando o total de novo**: regra explícita de exclusão do
   `TOTAL_CONVERTIDO` quando a viagem já foi paga em acerto FECHADO/PAGO, com teste.
4. **Reprecificação em massa** por vínculo: só reprecifica a viagem tocada, só se não faturada,
   pelo `recalcularSeguro` que já existe.
5. **Gasto órfão de rascunho descartado**: tratado como solto; acerto não depende de viagem.
