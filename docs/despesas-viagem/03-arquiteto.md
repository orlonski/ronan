# 03 — Arquiteto: módulo de Despesas de Viagem (desenho, nada implementado)

Data: 05/10/2026. Base: `00-ponto-de-partida.md` (não refeito). Toda referência é `arquivo:linha` no repositório `/Users/orlonski/dev/ronan`.

---

## 0. A suspeita: o "Paguei pedágio" da viagem guiada chega ao `Viagem.valorPedagioTotal`?

**NÃO.** O valor do evento é gravado e morre ali. Nem o app nem a API somam.

Evidência:

1. **API, registro do evento:** `apps/api/src/motorista/viagens.service.ts:2216-2238`: `eventoViagem.create({... valor: input.valor ...})` (linha 2229). Depois só os marcos `ehCarga`/`ehDescarga` espelham campos da Viagem (linha 2240 em diante). Nada escreve `valorPedagioTotal`.
2. **API, finalizar:** `viagens.service.ts:2472`: `valorPedagioTotal: input.valorPedagioTotal`. Copia o que o app mandou e não lê `eventosViagem`. Os únicos outros escritores de `valorPedagioTotal` são o create (`:1619`) e `informarValorPedagio` (`:459-495`, divergência PEDAGIO_SEM_VALOR).
3. **App, finalizar:** `apps/motorista-app/app/finalizar-viagem.tsx:76` (`useState("")`), `:119` (restaura só do rascunho `d.valorPedagio`), `:590-591` (manda o que foi digitado no campo, e só se o modo tem `mostraPedagio`), `:774-775` (campo digitado à mão). O arquivo não referencia eventos em lugar nenhum.
4. **App, lifecycle:** `lib/lifecycle.ts:36-45`: `EventoLocal` **nem guarda `valor`** no espelho local. O valor sai em `:513` (envio do evento) e não volta. `:614/:650` o finalizar só repassa `input.valorPedagioTotal`.
5. **Ninguém mais lê `EventoViagem.valor`:** acerto (`admin/acertos/acertos.service.ts:179-221` consulta viagem/abastecimento/pedágio, não evento), `common/acerto-motorista.ts:125` (`pedagioDaViagem` só olha `valorPedagioTotal` e `Pedagio.valor`), lucro (`common/lucro-veiculo.ts:18-21`), relatório de ciclo (`admin/relatorios/relatorios-ciclo.service.ts:30-35`, só slug/hora), financeiro (`admin/financeiro/financeiro.service.ts:236-247`, só estadia = duração × `valorHora`, não `valor`). No painel, o único `e.valor` de evento exibido é o prontuário do veículo (`apps/dashboard/src/app/(painel)/veiculos/[id]/prontuario.tsx:203`), que é outro tipo de evento.

Consequência prática: o motorista que toca "Paguei pedágio" e informa R$ 23,40 na estrada **não é reembolsado disso**, a menos que redigite o total no "Pedágio" do finalizar. O kit inicial cria esse evento com `pedeValor: true` (`apps/api/src/admin/contas/kit-inicial.ts:190-196`), ou seja, o produto pede um dado que não usa. Isso cai como **Fatia 0** abaixo.

⚠️ Não "consertar" somando no servidor: o motorista que digitou o total no finalizar **também** teria registrado os eventos, e somar os dois é o pedágio em dobro de novo (`acerto-motorista.ts:118-125`). A correção tem que manter **uma fonte só** (`valorPedagioTotal`) e trazer a soma dos eventos como **sugestão** no campo do finalizar.

---

## 1. Decisões de produto que o desenho toma

| Pergunta | Decisão | Por quê |
|---|---|---|
| Pedágio e abastecimento viram "categoria" de despesa? | **Não.** Ficam como estão: models, rotas, telas, acerto. | Têm regra própria (odômetro, tanque cheio, consumo, comboio, `pedagioDaViagem`, conciliação do cartão). Migrar mexe em acerto/lucro/fechamento de cliente em produção (`feedback_nunca_retirar_acesso_sem_autorizacao`). E pedágio como categoria abriria uma **terceira** fonte de pedágio → pedágio em triplo. |
| Categoria: enum fixo ou configurável? | **Tabela `CategoriaDespesa` por conta**, com kit inicial semeado. | Nada chumbado. Cada transportadora chama "chapa" de um jeito. Mesmo padrão de `TipoEventoViagem` (`schema.prisma:4703`, slug imutável + nome editável). |
| Despesa conversa com o caderno pessoal (`LancamentoPessoal`)? | **Não.** Produtos separados. | O caderno é da PESSOA, sem `contaId` (`schema.prisma:1380`), e a empresa não vê. Despesa é da EMPRESA e vai pro acerto. Espelhar um no outro vazaria dado pessoal pra empresa ou duplicaria o gasto. Futuro possível: botão "guardar uma cópia no meu caderno" (opt-in do motorista), fora deste escopo. |
| Valor do motorista é lei? | **Sim**, igual ao km: `valorInformado` intocável, e o painel só altera o `valor` com motivo escrito + auditoria. | Mesma doutrina de `common/km-motorista.ts` e de `ItemAcerto.motivo` (`schema.prisma:2700-2702`). |
| Lançamento pode ser recusado pelo servidor? | **Nunca no POST.** Categoria desativada, valor acima do limite ou foto faltando viram **carimbo**, e o escritório decide. | `project_lancamento_nunca_recusado`, `aoPerder: "VALA"`. |
| Precisa de aprovação? | **Sim, configurável por categoria:** abaixo de `aprovaAutomaticoAte` nasce APROVADA; acima nasce PENDENTE. | Sem aprovação, qualquer valor digitado vira dinheiro no acerto. Com aprovação obrigatória em tudo, o escritório afoga em R$ 8 de café. |
| Despesa de empregado (CLT)? | O motorista pode lançar. O **acerto** continua recusando o período de emprego (`acertos.service.ts:165-177`), então o reembolso dele sai fora do acerto. | Reembolso de despesa não é remuneração, mas o acerto é de parceiro. **Pergunta aberta pro dono:** o reembolso do CLT aparece onde? (proposta: vira `TituloPagar` com `motoristaId`, `schema.prisma:3393`). |

---

## 2. Modelo de dados (Prisma)

Todos os models nascem com `contaId @default("__SEM_CONTA__")` + relação `Conta`, que é o que a trava automática do Prisma usa (`project_multi_empresa_conta`). Nenhum `$queryRaw` previsto; se aparecer um, ele filtra `contaId` à mão e usa `"despesas"` (nome do `@@map`).

```prisma
/// O que a transportadora aceita como despesa de viagem. Catálogo DA EMPRESA.
model CategoriaDespesa {
  contaId             String   @default("__SEM_CONTA__")
  conta               Conta    @relation(fields: [contaId], references: [id])
  id                  String   @id @default(uuid())
  /// Chave estável (kit inicial, snapshot na despesa). Imutável.
  slug                String
  /// O que o motorista lê no botão. Editável.
  nome                String
  /// Nome de ícone do app (lista fechada no app; desconhecido cai num genérico).
  icone               String?
  ativo               Boolean  @default(true)   // soft-delete SEMPRE: o outbox pode chegar dias depois
  ordem               Int      @default(0)
  /// Pede foto do comprovante. Sem foto = justificativa (igual Viagem.justificativaSemFoto).
  exigeFoto           Boolean  @default(true)
  /// "Outros" exige descrição; hospedagem pode não exigir.
  exigeDescricao      Boolean  @default(false)
  /// Acima disto a despesa entra com carimbo ACIMA_DO_LIMITE (nunca recusa). Null = sem teto.
  valorMaximo         Decimal? @db.Decimal(10, 2)
  /// Até este valor nasce APROVADA sozinha. Null = tudo passa pelo escritório.
  aprovaAutomaticoAte Decimal? @db.Decimal(10, 2)
  criadoEm            DateTime @default(now())
  alteradoEm          DateTime @updatedAt
  criadoPor           User?    @relation("CriouCategoriaDespesa", fields: [criadoPorId], references: [id], onDelete: SetNull)
  criadoPorId         String?

  despesas        Despesa[]
  tiposEvento     TipoEventoViagem[]

  @@unique([contaId, slug])
  @@unique([contaId, nome])
  @@index([contaId, ativo, ordem])
  @@map("categorias_despesa")
}

enum StatusDespesa { PENDENTE APROVADA RECUSADA }

/// Quem tirou o dinheiro do bolso. Só MOTORISTA gera reembolso no acerto.
enum PagadorDespesa { MOTORISTA EMPRESA }

enum OrigemDespesa { APP PAINEL EVENTO_VIAGEM }

model Despesa {
  contaId           String          @default("__SEM_CONTA__")
  conta             Conta           @relation(fields: [contaId], references: [id])
  id                String          @id @default(uuid())
  /// Gerado no aparelho. Único POR MOTORISTA (lição do LancamentoPessoal, schema:1386-1393:
  /// único global vira 500 em colisão).
  clientId          String
  motorista         Motorista       @relation(fields: [motoristaId], references: [id])
  motoristaId       String
  veiculo           Veiculo?        @relation(fields: [veiculoId], references: [id], onDelete: SetNull)
  veiculoId         String?
  /// Vínculo opcional com a viagem. Resolvido pelo servidor.
  viagem            Viagem?         @relation(fields: [viagemId], references: [id], onDelete: SetNull)
  viagemId          String?
  /// O que o app conhece offline: o clientId da viagem guiada em andamento.
  /// Se a viagem ainda não subiu, fica só isto e o iniciar/criar da viagem amarra depois.
  viagemClientId    String?
  categoria         CategoriaDespesa @relation(fields: [categoriaId], references: [id])
  categoriaId       String
  /// Snapshots: a linha continua legível se a categoria for renomeada/desativada.
  categoriaSlug     String
  categoriaNome     String
  /// Instante do gasto (hora importa em hospedagem/alimentação). Dia civil ancorado em SP na leitura.
  data              DateTime
  /// O que o motorista digitou. Intocável (só os caminhos do app escrevem).
  valorInformado    Decimal         @db.Decimal(10, 2)
  /// O que vale (acerto, relatório). Nasce = valorInformado.
  valor             Decimal         @db.Decimal(10, 2)
  valorAlteradoEm   DateTime?
  valorAlteradoPor  User?           @relation("AlterouValorDespesa", fields: [valorAlteradoPorId], references: [id], onDelete: SetNull)
  valorAlteradoPorId String?
  valorAlteradoMotivo String?
  quemPagou         PagadorDespesa  @default(MOTORISTA)
  estabelecimento   String?         // "Restaurante X", "Borracharia do Zé"
  descricao         String?
  justificativaSemFoto String?
  status            StatusDespesa   @default(PENDENTE)
  decididoEm        DateTime?
  decididoPor       User?           @relation("DecidiuDespesa", fields: [decididoPorId], references: [id], onDelete: SetNull)
  decididoPorId     String?
  /// Obrigatório em RECUSADA (tirar dinheiro de parceiro sem motivo escrito não pode).
  motivoDecisao     String?
  /// Carimbos de conferência: ["ACIMA_DO_LIMITE","SEM_FOTO","CATEGORIA_INATIVA","VIAGEM_NAO_ACHADA", "IA_DIVERGE_VALOR"]
  carimbos          String[]        @default([])
  origem            OrigemDespesa   @default(APP)
  /// Quando nasce de um evento da viagem guiada (Fatia 5). Unique = idempotente.
  eventoViagem      EventoViagem?   @relation(fields: [eventoViagemId], references: [id], onDelete: SetNull)
  eventoViagemId    String?         @unique
  lat               Float?
  lng               Float?
  precisao          Float?
  transportadora    Transportadora? @relation(fields: [transportadoraId], references: [id], onDelete: SetNull)
  transportadoraId  String?         // carimbada na criação, como Pedagio (pedagios.service.ts:100-104)
  criadoOfflineEm   DateTime?
  sincronizadoEm    DateTime        @default(now())
  alteradoEm        DateTime        @updatedAt

  fotos       DespesaFoto[]
  itensAcerto ItemAcerto[]

  @@unique([motoristaId, clientId])
  @@index([contaId, data])
  @@index([contaId, status, data])
  @@index([motoristaId, data])
  @@index([viagemId])
  @@index([viagemClientId])
  @@index([veiculoId, data])
  @@index([contaId])
  @@map("despesas")
}

model DespesaFoto {
  contaId     String   @default("__SEM_CONTA__")
  conta       Conta    @relation(fields: [contaId], references: [id])
  id          String   @id @default(uuid())
  despesa     Despesa  @relation(fields: [despesaId], references: [id], onDelete: Cascade)
  despesaId   String
  storageKey  String
  rotacao     Int      @default(0)   // mesmo padrão de AbastecimentoFoto (schema:6157-6171)
  capturadaEm DateTime @default(now())
  @@index([despesaId])
  @@index([contaId])
  @@map("despesa_fotos")
}
```

Alterações em models existentes (todas aditivas, colunas nulas/default → migration sem risco):

- `enum TipoItemAcerto` (`schema.prisma:2597`): + `REEMBOLSO_DESPESA`. Também em `packages/shared-types/src/acerto-motorista.ts:10` e no rótulo `:45` ("Despesa que você pagou").
- `ItemAcerto` (`schema.prisma:2682`): + `despesa Despesa? / despesaId String?` + `@@index([despesaId])`. O comentário "no máximo uma delas" (`:2677-2680`) passa a incluir despesa.
- `ModalidadeMotorista` (`schema.prisma:2715`, ao lado de `:2746-2747`): + `reembolsaDespesas Boolean @default(true)`. Mesmo padrão e mesmo default dos outros dois (o comentário de `:2743-2745` vale igual).
- `TipoEventoViagem` (`schema.prisma:4703`): + `categoriaDespesa CategoriaDespesa? / categoriaDespesaId String?` (Fatia 5).
- `Motorista`, `Veiculo`, `Viagem`, `Transportadora`, `User`, `Conta`, `EventoViagem`: só as relações inversas.

Migration: conferir com `git show --stat` que o `migration.sql` entrou (CLAUDE.md, Prisma). O kit inicial de categorias **não** vai na migration: vai no `kit-inicial.ts` (conta nova) e num seed idempotente por conta (`createMany skipDuplicates`) disparado quando a plataforma **liga o módulo** na conta. Assim a Schaba não ganha categorias antes de querer.

Kit inicial proposto (constante só como seed, `feedback_nada_chumbado_em_codigo`): Alimentação, Hospedagem, Chapa / ajudante de descarga, Borracharia, Lavagem, Estacionamento, Peça ou conserto na estrada, Outros (`exigeDescricao: true`). **Fora do kit, de propósito:** pedágio e combustível (têm fluxo próprio) e diária (removida em 22/09, `project_mensal_obra_diaria`).

---

## 3. Rotas

### 3.1 App do motorista, `m/*` (`apps/api/src/motorista/despesas.controller.ts` + `.service.ts`)

Molde: `motorista/pedagios.controller.ts` / `pedagios.service.ts`. Guards: `@UseGuards(RolesGuard, AcessoMotoristaGuard)` + `@Roles("MOTORISTA")` (`pedagios.controller.ts:36-39`).

| Rota | Decorator | Regra |
|---|---|---|
| `GET m/despesas?mes&cursor&limit` | `@CapacidadeLivre("Ler o que já é dele")` | Paginação por cursor, igual `pedagios.service.ts:26-51`. |
| `POST m/despesas` | `@RequerCapacidade("app.despesa.lancar")` + **`exigirAprovado` explícito** | Idempotente por `(motoristaId, clientId)`. |
| `PATCH m/despesas/:id` | `@RequerCapacidade("app.despesa.lancar")` + aprovado | Só a própria e só em PENDENTE. Reescreve `valorInformado` e `valor` (ainda é o motorista corrigindo). Em APROVADA/RECUSADA dá 409, e a tela orienta a falar com o escritório. |
| `DELETE m/despesas/:id` | idem | Só PENDENTE e não ligada a item de acerto. |
| `POST m/uploads/despesa` | `@Roles("MOTORISTA")` | Clone de `uploads/uploads.controller.ts:43-60`; chave `${contaId}/despesas/${dia}/${motoristaId}/${uuid}` como `uploads.service.ts:95-106`. |
| `POST m/ia/extrair-comprovante` | `@AcessoMotorista("podeUsarOcrTicket")` + `conta.iaLeituraTicket` | Clone de `ia-ticket.controller.ts:115-136` (Fatia 4). |
| `GET m/catalogos` (existente) | — | + `categoriasDespesa` (ativas, ordenadas) no retorno de `motorista.service.ts:1114-1125`. |

Pontos que o CLAUDE.md marca como fáceis de errar:

- **Aprovação do cadastro.** `@RequerCapacidade` não checa `status === "APROVADO"`: só `AcessoMotoristaGuard` com flag faz isso (`auth/guards/acesso-motorista.guard.ts:46`), e o `CapacidadeAppGuard` começa em **sombra**, ou seja, registra e deixa passar (`common/acesso-app/capacidade.decorator.ts:13-17`). Hoje existem **quatro** `exigirAprovado` privados copiados (`motorista/programacao.controller.ts:56`, `admin/frota-manutencao/checklist.controller.ts:114`, `admissao/admissao.controller.ts:225`, `admin/pedidos/anexos-pedido.service.ts:291`). Recomendação: extrair `common/motorista-aprovado.ts` e usar no despesas. Os outros quatro migram quando forem tocados.
- **FK inválida = 4xx.** `categoriaId` e `veiculoId` passam por `garantirCadastro` (`common/item-inexistente.ts`, lança `ConflictException`), como `pedagios.service.ts:79-97`. Categoria **desativada** não é FK inválida: aceita e carimba `CATEGORIA_INATIVA`. Categoria de **outra conta** a trava não acha → 409 → vala.
- **Viagem por clientId.** O payload aceita `viagemId` **ou** `viagemClientId`. O servidor resolve `Viagem.clientId` (`@unique`). Se não achar, grava `viagemClientId`, carimba `VIAGEM_NAO_ACHADA` e **não recusa**. O `iniciar`/`create` de viagem passa a rodar `despesa.updateMany({ where: { viagemClientId, viagemId: null }, data: { viagemId } })` (best-effort, depois do create). Isso cobre a despesa lançada no meio de uma viagem guiada que ainda não subiu.
- **fotoKey alheia.** O POST valida que cada `fotoKey` começa com `${contaId}/despesas/` e contém `/${motoristaId}/`. Sem isso, um motorista anexa foto de outro. O abastecimento hoje não valida isso, e vale registrar como dívida.
- **Vala.** `void this.resgates.marcarQueSubiu(clientId)` como `pedagios.service.ts:105`. O tipo `"despesa"` entra no `LancamentoResgatado.tipo` (`schema.prisma:4994`, é String, então sem migration).
- **Boot-check do app.** Todo handler `m/*` declara `@RequerCapacidade` ou `@CapacidadeLivre`, senão `capacidades.boot-check.ts` derruba a subida.

Zod (`packages/shared-types/src/despesa.ts`, exportado no index; **rebuild obrigatório** do shared-types):

```ts
CriarDespesaInput = z.object({
  clientId: z.string().uuid(),
  categoriaId: z.string().uuid(),
  veiculoId: z.string().uuid().optional(),
  viagemId: z.string().uuid().optional(),
  viagemClientId: z.string().uuid().optional(),
  data: z.coerce.date(),
  valor: z.number().positive().max(50_000),
  quemPagou: z.enum(["MOTORISTA","EMPRESA"]).default("MOTORISTA"),
  estabelecimento: z.string().trim().max(120).optional(),
  descricao: z.string().trim().max(500).optional(),
  fotoKeys: z.array(z.string().min(1)).max(3).default([]),
  justificativaSemFoto: z.string().trim().max(300).optional(),
  lat/lng/precisao: z.number().optional(),   // precisão é float (feedback_erro_de_validacao_que_mente)
  criadoOfflineEm: z.coerce.date().optional(),
})
```

`exigeDescricao` e `exigeFoto` são da categoria, então não entram no Zod. O servidor carimba e não recusa, porque o app velho não conhece a regra nova.

### 3.2 Painel, `admin/*` (`apps/api/src/admin/despesas/` e `admin/categorias-despesa/`)

| Rota | `@RequerPermissao` |
|---|---|
| `GET admin/despesas` (filtros: período, motorista, veículo, viagem, categoria, status, carimbo, quemPagou) + totais por categoria | `despesas.ver` |
| `GET admin/despesas/:id` (com fotos servidas **pela API**, nunca link do MinIO: `feedback_minio_bucket_anonimo`) | `despesas.ver` |
| `PATCH admin/despesas/:id` (categoria, viagem, veículo, quemPagou, descrição; `valor` só com `motivo` → 400 sem motivo + auditoria `ADMIN_ALTEROU_VALOR_DESPESA`) | `despesas.editar` |
| `POST admin/despesas/:id/aprovar` / `recusar` (motivo obrigatório) / `POST admin/despesas/decidir-lote` | `despesas.aprovar` |
| `POST admin/despesas` (escritório lança por ele, `origem: PAINEL`) | `despesas.criar` |
| `DELETE admin/despesas/:id` (bloqueia se tem item em acerto FECHADO/PAGO) | `despesas.excluir` (ADMIN_ONLY) |
| `GET/POST/PATCH admin/categorias-despesa` (sem DELETE: só `ativo=false`) | `categorias-despesa.ver/criar/editar` |

Aprovar ou recusar uma despesa que já está num acerto **ABERTO** não precisa mexer no acerto: o próximo "regerar" varre o automático (`acertos.service.ts:270`). Em acerto **FECHADO/PAGO** a decisão é bloqueada com 409 ("já está no acerto de tal período"), porque acerto FECHADO não regenera e PAGO não reabre.

### 3.3 Acerto (`common/acerto-motorista.ts` + `admin/acertos/acertos.service.ts`)

- `calcularAcerto` (`acerto-motorista.ts:185`) ganha `despesas: { id, data, valor, categoriaNome, estabelecimento }[]` e, se `regra.reembolsaDespesas`, gera um `REEMBOLSO_DESPESA` por despesa (`descricao: "Alimentação 03/10 · Restaurante X"`, `despesaId`).
- `resolverRemuneracao` (`:49-68`) lê `modalidade?.reembolsaDespesas ?? true`. É campo da modalidade, não do override do motorista (o override é tudo-ou-nada **da régua de pagamento** e não inclui reembolsos hoje: `:66-68`).
- `acertos.service.ts:179` ganha uma 4ª consulta: `despesa.findMany({ motoristaId, status: APROVADA, quemPagou: MOTORISTA, data no período, filtro foraDoEmprego })`. A data entra por dia de SP (`common/timezone.ts`), e **não** com o `lt: fim + 86_400_000` do abastecimento (`:206`), que é UTC.
- As **PENDENTES** do período não somam, mas o retorno da geração diz "3 despesas (R$ 214,00) aguardando aprovação". Dinheiro faltando nunca vira zero calado (`lucro-veiculo.ts:28-29` segue a mesma doutrina).
- `createMany` (`acertos.service.ts:274-284`) + `despesaId`.
- Testes vitest novos em `acerto-motorista.spec.ts`: despesa EMPRESA não reembolsa; RECUSADA/PENDENTE não entram; modalidade com `reembolsaDespesas=false`; despesa em período de emprego fica fora.

### 3.4 Lucro por caminhão (Fatia 5)

`common/lucro-veiculo.ts` ganha despesas APROVADAS com `veiculoId` como custo do caminhão, com a **mesma régua** do combustível: entra se `quemPagou=EMPRESA` ou se a modalidade reembolsa; senão vai para `foraDaConta`. Sem veículo, entra num total "despesas sem caminhão" que a tela mostra (nada some).

---

## 4. Módulo, permissões e capacidade

### 4.1 `packages/shared-types/src/modulos.ts`

```ts
MODULOS_CHAVES: + "despesas"
{
  chave: "despesas",
  nome: "Despesas de viagem",
  pitch: "O motorista lança o gasto da estrada com a foto do comprovante, o escritório aprova e o reembolso cai no acerto.",
  recursos: ["despesas", "categorias-despesa"],
}
```

- **Não é núcleo, nem medido, nem adicional.** Entra sozinho em `MODULOS_PADRAO` (`modulos.ts:212-214`), então **conta nova** recebe na criação (`admin/contas/contas.service.ts:439-448`).
- **Conta existente não recebe nada sozinha.** Não existe semeadura no boot: `ModulosService.semearConta` (`common/modulos/modulos.service.ts:109`) não tem chamador, e `modulosDaConta` só soma núcleo + linhas (`common/conta/teto-da-conta.ts:73-84`). Quem liga é a plataforma na tela de Empresas (`modulos.service.ts:52-100`, que já re-semeia papéis na hora). Ligar primeiro na Schaba (`project_schaba_cobaia`) e depois no cliente que perguntou. Nada sai do ar de ninguém.
- **Pedágio e abastecimento continuam no núcleo** (`modulos.ts:121,88`). Despesas é **outra coisa por cima**, e quem não contratar segue exatamente como hoje.
- **Os 9 testes de invariante** (`apps/api/src/common/modulos.spec.ts:22-80`) ficam verdes desde que os dois recursos entrem **ao mesmo tempo** no RBAC e no módulo. Se faltar o RBAC, quebram "todo recurso declarado num módulo existe no RBAC" (`:41`) e "toda chave resolve" (`:50`). Se faltar o módulo, quebra "recurso órfão" (`:22`). Ou seja, os testes são a própria checklist. "Módulos padrão excluem o que custa por uso" (`:56`) segue verde porque o módulo não é `medido`.

### 4.2 `packages/shared-types/src/permissoes.ts`

- `RESOURCE_DEFS`: `{ recurso: "despesas", label: "Despesas de viagem", modulo: "Operação", acoes: ["ver","criar","editar","aprovar","excluir"] }` (ação `aprovar` já tem rótulo em `ACAO_TITULO`, mas é "Aprovar cadastro" e precisa de um rótulo melhor por recurso, ou ação nova `decidir`) e `{ recurso: "categorias-despesa", label: "Categorias de despesa", modulo: "Cadastros", acoes: ["ver","criar","editar"] }`.
- O rótulo `"Operação"`/`"Cadastros"` é **de propósito**: `PERMISSOES_OPERADOR` filtra por esses dois rótulos (`permissoes.ts:~412`), então o Operador já recebe a conferência de despesas. `despesas.excluir` entra em `ADMIN_ONLY` (`:398`).
- ⚠️ **Não** reaproveitar o recurso `pedagios`: ele é da **plataforma** (praças OSM compartilhadas, `permissoes.ts:372-375`).
- O boot-check (`common/modulos/modulos.boot-check.ts`) exige `@RequerPermissao` em todo `admin/*` novo. `endpoints-sem-permissao.ts` **não** pode crescer.
- Na UI: chave no catálogo → `temPermissao` / `<RequerTela>` → `@RequerPermissao`. Uma permissão por tela (`feedback_uma_permissao_por_tela`): "Despesas" (`despesas.ver`) e "Categorias de despesa" (`categorias-despesa.ver`).

### 4.3 `packages/shared-types/src/capacidades-app.ts`

```ts
CAPACIDADES_APP_CHAVES: + "app.despesa.lancar"
{
  chave: "app.despesa.lancar",
  label: "Lançar despesa de viagem",
  efeito: "Registrar alimentação, hospedagem, chapa e outros gastos da estrada com a foto do comprovante, pra entrar no acerto.",
  grupo: "Gastos",
  tipo: "EMPRESA",
  vinculo: "MOTORISTA",
  modulo: "despesas",
  gate: "SERVIDOR",
  aoPerder: "VALA",
}
```

- **Nasce ligada** (sem `nasceDesligada`, sem `colunaLegada`). Isso segue `feedback_empresa_manda_no_app`. Quem segura é o **módulo**: o resolver corta capacidade de módulo não contratado (`common/acesso-app/resolver.ts:258-262`). Na prática: empresa sem o módulo não vê o botão; empresa que liga o módulo vê para todo mundo e desliga por modalidade/pessoa na tabela de acesso.
- **Não** criar coluna `podeLancarDespesa` no `Motorista`. As colunas `pode*` são legado em extinção (`capacidades-app.ts:20-22`).
- `regimesProibidos`: nenhum. Empregado também lança despesa (ver a pergunta aberta na seção 1).

---

## 5. App nativo (`apps/motorista-app`)

### 5.1 Telas
- `app/nova-despesa.tsx` (novo): categoria (dropdown `Select`, nunca `SelecaoBotoes`: `feedback_selecao_botoes_odiada`; **nada pré-selecionado**: `feedback_nunca_preselecionar_motorista`), valor, data/hora (DateField em folha), veículo (padrão = o do motorista se for um só; se forem vários, ele escolhe), "Quem pagou?" (Eu / A empresa), estabelecimento, descrição (obrigatória se a categoria pede), até 3 fotos (câmera **ou galeria**, `project_foto_ticket_galeria`), justificativa sem foto. `KeyboardAvoidingView behavior="padding"` nas duas plataformas + `scrollToEnd`. Validação guiada (rola até o campo, sem pop-up).
- `app/editar-despesa.tsx` ou modo edição na mesma tela: só PENDENTE.
- Entrada: bloco "Gastos" da home, ao lado de pedágio/abastecimento (`app/(tabs)/index.tsx:660,682`), gated por `useCapacidade("app.despesa.lancar") === true` (`lib/acessos-app.ts:140-161`). Também um botão "Lancei uma despesa" **dentro da viagem guiada** (`app/viagem-guiada.tsx`), que já manda `viagemClientId`.
- Histórico: aba/lista "Despesas" com status (Aguardando escritório / Aprovada / Recusada + motivo). O motorista é parceiro: o texto diz "o escritório confere", não "o gestor autoriza".
- Botões no semáforo: "Salvar despesa" verde, "Descartar" contorno.

### 5.2 Outbox
- `db/database.ts`: `DESPESAS_KEY` + `PendingDespesa` (molde `PendingAbastecimento`, `:158-183`, com `fotos: FotoPendente[]` próprias, tipo `"COMPROVANTE"`) + `list/upsert/deletePendingDespesa`. **Entra em `SUFIXOS_OUTBOX`** (`:537-556`): o comentário de `:550-551` explica que, fora da lista, o item some do contador e não é adotado numa migração de storage.
- `lib/sync.ts`: `enqueueDespesa`, `drainDespesas`/`processDespesa` (sobe cada foto em `m/uploads/despesa`, grava o `fotoKey` no item **antes** do POST, como `:2290-2330`, e foto que sumiu do aparelho segue sem ela + justificativa automática), `descartar`/`tentarNovamente`/`atualizarDespesaPendente`. Rodar **depois** dos drains do lifecycle (`VG_INICIAR`), pra o `viagemClientId` normalmente já achar a viagem.
- Transitório (rede/timeout/5xx) não queima `attempts`; só 4xx exige editar. Stale-recovery: incluir no `rescueStaleItems` (`sync.ts:1267`, `STALE_SYNCING_MS` em `:113`).
- `app/pendentes.tsx`: novo `kind: "despesa"` na união (`:82-90`), no `merge` (`:191-199`), linha de resumo ("Alimentação · R$ 42,00") e ação **Editar** que abre `nova-despesa` com o payload (`feedback_outbox_correcao`). Se faltar aqui, o item fica preso e só conta em "X com erro".
- `pendingCounts()` (`sync.ts:878`) inclui despesas.

### 5.3 Cache-first e compat
- `categoriasDespesa` vem no `/m/catalogos` e é pré-baixado no login (`prefetchDadosBase`). **Compat on-read:** cache antigo sem o campo → `categoriasDespesa ?? []` e o botão fica escondido até a revalidação chegar. Nunca crash por `undefined.map`.
- Categoria que sumiu do catálogo enquanto o item esperava na fila não bloqueia nada: o servidor aceita e carimba.

### 5.4 OTA ou build?
Tudo é JS: **vai por OTA**. Ordem obrigatória: **API no ar antes do OTA** (`feedback_empresa_manda_no_app`), senão o POST do app novo dá 404 e enche a tela de Pendentes. Conferir a URL da API dentro do bundle antes e depois (`feedback_eas_ota_url_leak`).

---

## 6. IA: comprovante genérico (Fatia 4)

- Reaproveitar o pipeline do cupom: `common/ia/cupom.ts` (`cupomDoJson` + `INSTRUCOES_CUPOM`) e a torneira de `motorista/ia-ticket.controller.ts:115-136` (`conta.iaLeituraTicket` + `podeUsarOcrTicket` + `ia.habilitada`, com 403/503 tipados).
- Novo `common/ia/comprovante.ts`: `comprovanteDoJson(p)` → `{ valorTotal?, data?, estabelecimento?, cnpj?, categoriaSugeridaSlug?, confidence }`. Teto de plausibilidade igual ao do cupom (`valor <= 0 || > 50_000` some). A categoria sugerida só vale se o slug existir no catálogo da conta (`lerTipo`, `cupom.ts:34-43`, é o molde). Instrução fixa sem interpolação: "deixe de fora o que não ler com segurança".
- **IA nunca afirma** (`feedback_ia_nunca_afirma`): o app só preenche **campo vazio**, mostra "Lido da foto, confira" e **nunca seleciona categoria sozinho** (seria pré-seleção). A categoria vira sugestão destacada no dropdown. Valor que o motorista mudou depois da leitura é dele.
- Carimbo `IA_DIVERGE_VALOR` quando o valor salvo difere do lido (o app manda `valorLidoIa` opcional). É só ajuda pra conferência, nunca bloqueio.
- Custo: conta como leitura paga (`common/ia/uso-ia.ts`). Fica sob o módulo **Conferência** (medido) via `app.ticket.ocr`, não sob Despesas. Despesas continua sem custo por uso.

---

## 7. O que acontece com o que já existe

| Existente | Destino |
|---|---|
| `Pedagio` / `/m/pedagios` / `novo-pedagio.tsx` | **Fica como está.** Não vira categoria. (Bug à parte: a tela não manda `viagemId`, `00-ponto-de-partida`.) |
| `Abastecimento` / `/m/abastecimentos` | **Fica como está.** Tem tela própria no painel, cartão-combustível e consumo. |
| `Viagem.valorPedagioTotal` | Continua sendo **a** fonte do pedágio da viagem. Fatia 0 só melhora o preenchimento. |
| `EventoViagem.valor` com "Paguei pedágio" | Fatia 0: vira sugestão do total no finalizar. Não vira Despesa. |
| `EventoViagem.valor` de evento ligado a categoria | Fatia 5: vira Despesa `origem: EVENTO_VIAGEM` (idempotente por `eventoViagemId @unique`). |
| `LancamentoPessoal` (caderno) | Não muda. Não conversa. |
| Acerto: BONUS/AJUSTE usado como "outra despesa" | Some sozinho com o tempo, porque o escritório passa a aprovar despesa. Nada migra: item manual antigo continua no acerto antigo. |
| Painel sem tela de pedágios lançados | Fora do escopo. Fatia 6 opcional: uma visão "Todos os gastos da viagem" (somente leitura) que junta Pedagio + Abastecimento + Despesa por viagem/veículo, sem mover dado. |

Nenhuma linha existente é alterada. Nenhuma tela some. Nenhum acesso é retirado.

---

## 8. Fatias (cada uma vai pra produção sozinha)

### Fatia 0: pedágio da viagem guiada chega ao total (sem módulo, conserto)
O valor dos eventos "Paguei pedágio" pré-preenche o campo Pedágio do finalizar. É sugestão: só preenche se o campo estiver vazio e o motorista pode editar.
- `apps/motorista-app/lib/lifecycle.ts`: `EventoLocal` + `valor?: number` (`:36-45`). Gravar no registro local (`:463-513`) e no retomar do servidor (`:280`, compat on-read: evento antigo sem valor = ignora).
- `apps/api/src/motorista/viagem-lifecycle` (resposta do retomar): incluir `valor` em `eventosViagem` se não vier.
- `apps/motorista-app/app/finalizar-viagem.tsx`: se não há rascunho de `valorPedagio` e `mostraPedagio`, somar `eventos.filter(e => e.valor != null && tipo pedeValor).valor` com legenda "Somado dos pedágios que você marcou na viagem".
- Por quê fica fora do servidor: uma fonte só (`acerto-motorista.ts:118-125`).
- Teste: viagem guiada com 2 pedágios → finalizar mostra a soma → acerto gera REEMBOLSO_PEDAGIO.
- Deploy: API (se mexer no retomar) → OTA.
- ⚠️ Decisão de produto embutida: a soma vale para **qualquer** tipo com `pedeValor` ou só para o slug `paguei-pedagio`? Recomendo **só tipos marcados como pedágio** (`slug === "paguei-pedagio"` hoje). Melhor ainda, quando a Fatia 5 existir, tipos com `pedeValor` **sem** `categoriaDespesa`. Um evento "Paguei estacionamento" criado pela empresa não pode cair no pedágio.

### Fatia 1: backend + painel de categorias (módulo nasce, nada no app ainda)
- `apps/api/prisma/schema.prisma` + migration (`CategoriaDespesa`, `Despesa`, `DespesaFoto`, enums, `ItemAcerto.despesaId`, `TipoItemAcerto.REEMBOLSO_DESPESA`, `ModalidadeMotorista.reembolsaDespesas`).
- `packages/shared-types/src/{despesa.ts, modulos.ts, permissoes.ts, capacidades-app.ts, acerto-motorista.ts, index.ts}`. Rebuild.
- `apps/api/src/motorista/despesas.{controller,service}.ts`, registro no `motorista.module.ts`; `uploads/uploads.{controller,service}.ts` (`m/uploads/despesa`); `motorista/motorista.service.ts:1002` (`categoriasDespesa` no catálogo); `common/motorista-aprovado.ts` (novo helper); resolução de `viagemClientId` em `motorista/viagens.service.ts` (iniciar/create).
- `apps/api/src/admin/categorias-despesa/*` + seed do kit ao ligar o módulo (`common/modulos/modulos.service.ts:definir` → `seedCategoriasDespesa(contaId)` quando `chave === "despesas" && ativo`); `admin/contas/kit-inicial.ts` (`CATEGORIAS_DESPESA_INICIAIS`).
- Dashboard: `apps/dashboard/src/app/(painel)/cadastros/categorias-despesa/` (lista + form), item de menu gated; `modalidades` ganha o checkbox "Devolve as despesas que ele pagou".
- Testes: `modulos.spec.ts` (verde por construção), spec do service (idempotência, carimbos, FK → 409, `viagemClientId`).
- Em produção: liga o módulo na Schaba e o escritório já cadastra as categorias. O app ainda não mostra nada (sem OTA).

### Fatia 2: app nativo lança despesa
- `apps/motorista-app/app/nova-despesa.tsx` (novo), `app/(tabs)/index.tsx` (botão no Gastos), `app/viagem-guiada.tsx` (atalho), `app/pendentes.tsx`, `db/database.ts`, `lib/sync.ts`, `lib/queries.ts` (tipo do catálogo + `useDespesas`), `lib/validation.ts` (rótulos dos campos), histórico (`app/(tabs)/historico.tsx` ou `app/minhas-despesas.tsx`).
- OTA depois da Fatia 1 no ar.

### Fatia 3: conferência no painel + acerto
- `apps/api/src/admin/despesas/*` (lista, detalhe, foto pela API, editar com motivo, aprovar/recusar/lote, excluir).
- `apps/api/src/common/acerto-motorista.ts` + spec; `admin/acertos/acertos.service.ts` (4ª consulta, aviso de pendentes).
- Dashboard: `apps/dashboard/src/app/(painel)/despesas/` (lista com filtros, visualizador de foto na própria tela: `feedback_imagem_nunca_em_aba_nova`; aprovar em lote; carimbos como chips), aba "Despesas" no detalhe da viagem (`viagens/[id]/page.tsx`), rótulo do novo tipo no extrato do acerto. Seguir o bloco MacBook compacto (`max-2xl:`).
- App: o extrato (`app/meus-acertos.tsx`) já lê `tipo` pelo rótulo do shared-types, então só precisa do rótulo novo (OTA leve).
- Notificação (opcional): push ao motorista quando uma despesa for recusada, com o motivo (sempre todos os aparelhos: `feedback_push_chega_na_pessoa`).

### Fatia 4: leitura do comprovante por IA
- `apps/api/src/common/ia/comprovante.ts` + spec; `common/ia/provedor-ia.ts` (método `extrairComprovante`); `motorista/ia-ticket.controller.ts` (rota); `shared-types` (`ExtrairComprovanteInput/Result`).
- App: botão "Ler a foto" na `nova-despesa.tsx` quando `useCapacidade("app.ticket.ocr")`.

### Fatia 5: evento da viagem guiada vira despesa + lucro por caminhão
- `TipoEventoViagem.categoriaDespesaId` (migration); tela de tipos de evento no painel ganha "Este evento é uma despesa de:" [categoria].
- `motorista/viagens.service.ts:~2216` (registrar evento): se o tipo tem categoria e `valor > 0`, cria `Despesa` com `origem: EVENTO_VIAGEM`, `eventoViagemId`, `viagemId`, `quemPagou: MOTORISTA`. Idempotente pelo unique.
- `common/lucro-veiculo.ts` + `admin/relatorios/relatorios-lucro.service.ts` (seção 3.4).

### Fatia 6 (opcional): visão unificada "Gastos da viagem"
Só leitura, junta as três fontes por viagem e por veículo. Usa `pedagioDaViagem` pra não somar pedágio em dobro.

---

## 9. Riscos e armadilhas para quem implementar

1. **Pedágio em dobro/triplo:** nunca criar categoria "Pedágio" no kit nem permitir `categoriaDespesa` em tipo de evento que já soma no `valorPedagioTotal`. Pôr uma validação no PATCH de `TipoEventoViagem`: tipo com slug `paguei-pedagio` não aceita categoria.
2. **Despesa do evento × despesa avulsa da mesma coisa:** se o motorista marca o evento "Paguei estacionamento" (Fatia 5) **e** lança a despesa avulsa, ela duplica. A tela `nova-despesa`, aberta de dentro da viagem guiada, deve mostrar "Você já marcou R$ X de estacionamento nesta viagem".
3. **Zod descarta chave não declarada:** cada campo novo do app precisa estar no schema, senão a resposta é 200 e nada grava (`feedback_zod_descarta_chave_nao_declarada`).
4. **Dia civil:** filtro de período do acerto e da lista em `America/Sao_Paulo` (`common/timezone.ts`), nunca `setHours(0)`.
5. **Carimbo de vínculo errado no acerto:** usar `foraDoEmprego` igual a viagens e abastecimentos (`acertos.service.ts:161-163`).
6. **Push sequencial:** commitar por fatia e pushar uma vez por bloco (`feedback_easypanel_builds_atropelados`). Commitar `pnpm-lock.yaml` se entrar dependência (não deve entrar).

---

## 10. Perguntas que ficam pro dono (só as que mudam o desenho)

1. Reembolso de despesa do **empregado CLT**: vai pra onde, já que o acerto não se aplica? (Proposta: `TituloPagar` no Financeiro.)
2. **Aprovação:** padrão do kit = `aprovaAutomaticoAte` vazio (tudo passa pelo escritório) ou um valor (ex.: R$ 50)? Recomendo nascer vazio: o escritório sempre vê, e afrouxa quando quiser.
3. O cliente que perguntou: liga o módulo nele já na Fatia 2 (app + aprovação manual sem acerto automático) ou espera a Fatia 3?
