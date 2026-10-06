# 02 — Financeiro: as regras de dinheiro do módulo de Despesas de Viagem

Agente: desp-financeiro · 05/10/2026 · nada implementado, só regra.
Base: `00-ponto-de-partida.md` + leitura de `common/acerto-motorista.ts`, `admin/acertos/acertos.service.ts`,
`common/lucro-veiculo.ts`, `admin/relatorios/relatorios-lucro.service.ts`, `common/viagem-preco.ts`,
`admin/financeiro/financeiro.service.ts`, `prisma/schema.prisma`.

---

## 0. A frase que governa o módulo

**Uma despesa é um FATO (o motorista gastou R$ X em Y). Se ela vira dinheiro, e pra quem, é uma
DECISÃO da empresa, tomada uma vez (na política) e não pelo motorista a cada lançamento.**

O motorista só responde o que ele sabe: o que foi, quanto foi, com que dinheiro pagou, foto.
Se devolve ou não, se cobra do cliente ou não: é regra da empresa, que o sistema aplica.
É a mesma doutrina que já existe: "reembolso é política da empresa, não do acordo individual:
mora só na modalidade" (`common/acerto-motorista.ts:65-68`).

---

## 1. Quem paga: três situações, uma pergunta pro motorista

### Os três destinos de dinheiro
| Situação | Exemplo | O que acontece com o dinheiro |
|---|---|---|
| **EMPRESA pagou** | cartão da empresa, faturado no fornecedor | custo da empresa; não passa pelo acerto |
| **MOTORISTA pagou e a empresa devolve** | chapa paga em dinheiro, estacionamento | crédito no acerto (reembolso); custo da empresa |
| **MOTORISTA pagou e é custo dele** | almoço do agregado por percentual | só registro; não vira dinheiro; aparece em "fora da conta" no lucro |

### O que o motorista vê (uma pergunta só)
**"Como você pagou?"** → `Do meu dinheiro` · `Cartão/conta da empresa`.

- "Do meu dinheiro" inclui o dinheiro do adiantamento. Dinheiro na carteira é dinheiro; a
  conta do adiantamento é feita pelo acerto (seção 2), não pelo motorista separando nota.
- **Nunca pré-selecionar** (memória `feedback_nunca_preselecionar_motorista.md`). Mas a empresa
  configura **na conta** como seus motoristas pagam despesa: `SÓ_DO_BOLSO` / `SÓ_CARTÃO_EMPRESA` /
  `OS_DOIS`. Com uma opção só, a pergunta **não aparece** (não é pré-seleção, é o fato).
- **"Devolve ou não" o motorista não escolhe nem vê na hora de lançar.** Ele vê depois, no
  status da despesa ("a empresa devolve no acerto" / "fica por sua conta — combinado da sua
  modalidade"). Perguntar a ele induz a marcar "devolve" em tudo e transforma o lançamento numa
  negociação.

### Onde mora a regra "devolve ou não"
Na **modalidade**, igual pedágio e diesel já moram (`schema.prisma:2746`, `reembolsaPedagio`/
`reembolsaAbastecimento`). Generaliza: a tela da modalidade ganha a lista de categorias de
despesa com um "a empresa devolve? sim/não" por linha. Pedágio e abastecimento continuam sendo
as duas primeiras linhas, com os campos que já existem (não migrar).

- Tabela nova `ModalidadeReembolsoDespesa(modalidadeId, categoriaId, reembolsa)`; ausência de
  linha = vale o default da categoria.
- **Override do motorista é tudo-ou-nada e NÃO alcança reembolso** — mantém a exceção
  deliberada de `acerto-motorista.ts:65-68`. Motorista com régua própria continua com o
  reembolso da modalidade dele.
- Motorista **sem modalidade**: vale o default da categoria.

### Kit inicial de categorias (defaults propostos — a empresa edita)
| Categoria | Devolve (default) | Limite sem aprovação | Foto | Repassa ao cliente (default) |
|---|---|---|---|---|
| Chapa / ajudante de descarga | sim | R$ 300 | sim | não (escritório marca por viagem) |
| Taxa de descarga / balança | sim | R$ 200 | sim | **sim** |
| Estacionamento / pernoite em pátio | sim | R$ 100 | sim | não |
| Balsa / travessia | sim | R$ 300 | sim | não |
| Borracharia na estrada | sim | R$ 400 | sim | não |
| Lavagem | sim | R$ 150 | sim | não |
| Hospedagem | não | — (sempre aprovação) | sim | não |
| Alimentação | não | — (sempre aprovação quando devolve) | não | não |
| Outra despesa | sim | R$ 0 (sempre aprovação) | sim | não |

Alimentação e hospedagem nascem "não devolve" porque a diária foi removida (22/09/2026) e
agregado por percentual normalmente come por conta. Empresa que paga liga na modalidade.

**Fora do kit, de propósito: pedágio, combustível, ARLA, estadia e multa** (ver riscos R1–R4).

---

## 2. Adiantamento e prestação de contas — pelo acerto que já existe

### Regra
1. O escritório registra o **adiantamento** como fato: entidade `Adiantamento(motoristaId,
   viagemId?, valor, data, meio, entreguePorId)`. Hoje ele é só um item manual `ADIANTAMENTO`
   digitado no acerto (`acerto-motorista.ts:262-268`) — e por isso o motorista não o vê antes
   do acerto, e não há prestação de contas.
2. O adiantamento entra no acerto como **item automático** `ADIANTAMENTO` (negativo) com
   `adiantamentoId` — o mesmo padrão de `abastecimentoId`/`pedagioId` em `ItemAcerto`
   (`schema.prisma:2682`). O `ADIANTAMENTO` manual continua existindo pro que nunca foi
   registrado (não quebra o presente).
3. As despesas que a empresa devolve entram como **crédito** `REEMBOLSO_DESPESA`.
4. **A prestação de contas é a soma do extrato.** Não existe "saldo do adiantamento" guardado:
   ele é DERIVADO (adiantamentos − despesas devolvíveis aprovadas), mesma doutrina do saldo do
   pedido (`common/pedido-saldo.ts`: contador dessincroniza no primeiro cancelamento).
   - Sobrou dinheiro com ele → o líquido do acerto cai (desconta).
   - Faltou → o líquido sobe (reembolsa).
   - Ninguém digita "devolução de sobra".

### O que o motorista vê no app (durante a viagem)
"Adiantamento R$ 1.500 · despesas que a empresa devolve R$ 1.180 · **fica R$ 320 com você**
(sai do seu próximo acerto)". Despesa "por sua conta" aparece listada mas **não abate** —
o número é o que o acerto vai dizer, não o que sobrou na carteira.

### Acerto que fecha negativo (adiantou mais do que ele rodou + gastou)
Hoje: líquido ≤ 0 não vira título e o saldo **some** (`acertos.service.ts:442-470`).
Com adiantamento automático isso vai acontecer com frequência. **Regra:** o negativo vira item
automático `SALDO_ANTERIOR` (negativo, com `acertoOrigemId`) no próximo acerto do motorista,
visível nos dois extratos. Nunca vira "conta a receber" no nome dele (mantém a decisão de
`acertos.service.ts:445-448`), e nunca some.

### Empregado CLT
Acerto não se aplica a período de emprego (`acertos.service.ts:147-176`). Reembolso de despesa
não é salário: despesa devolvível aprovada de empregado vira `TituloPagar(motoristaId,
despesaId)` agrupado por prestação de contas fechada pelo escritório. Adiantamento de empregado
é abatido no mesmo título. (V1 pode deixar CLT fora e avisar na tela; não pode é jogar no acerto.)

---

## 3. Aprovação — tudo entra, o dinheiro espera

**O lançamento nunca é recusado** (`project_lancamento_nunca_recusado.md`). O que se aprova é
o **reembolso**, não a existência da despesa.

### Estados da despesa
`REGISTRADA` → `APROVADA` | `AGUARDANDO_CONFERENCIA` → `APROVADA` | `NAO_DEVOLVIDA`

- **Aprovação automática** quando TODAS: valor ≤ limite da categoria; foto presente se a
  categoria exige; "como pagou" informado; sem suspeita de duplicata.
- Senão → `AGUARDANDO_CONFERENCIA`, com o **motivo carimbado** (padrão de `common/divergencias.ts`):
  "acima do limite de R$ 300", "sem foto do comprovante", "parece repetida da de 14:02".
  Nada de vermelho nem "erro" pro motorista: "o escritório vai conferir".
- **Despesa por conta do parceiro não passa por aprovação** — não vira dinheiro, não há o que aprovar.
- Escritório pode: **aprovar**; **aprovar outro valor** (motivo obrigatório); **não devolver**
  (motivo obrigatório, aparece pro motorista); **mudar quem pagou**.
- **O valor do motorista é intocável**, como o km (`common/km-motorista.ts`): `valorInformado`
  nunca é sobrescrito; `valorAprovado` é o que vai pro acerto. Alteração = motivo + auditoria.
- Desconto/não-devolução sem motivo escrito é proibido — mesma regra do `ItemAcerto.motivo`.

### Despesa pendente na hora do acerto
**Não entra e não some.** O acerto mostra "3 despesas aguardando conferência — R$ 640" antes de
fechar. Quando aprovadas, entram no **próximo** acerto (ver regra de seleção, R6).

---

## 4. Repassável ao cliente x custo interno

- Repassar é decisão **do escritório por despesa**, com default da categoria. O motorista não vê.
- Só repassa despesa **com viagem** (sem viagem não há tomador).
- **Não entra no `ViagemValor`.** `ViagemValor` é frete + pedágio congelados pela precificação
  (`schema.prisma`, model ViagemValor; `viagem-preco.ts:210-222`), e o cron nunca reprecifica o
  que já tem valor — despesa que chega depois ficaria de fora em silêncio, e mexer no valor
  congelado é exatamente o que o modelo proíbe.
- Entra na **fatura como linha avulsa** `FaturaLinha` com `despesaViagemId` — o mesmo desenho da
  estadia (`schema.prisma:3328-3344`, `eventoViagemId`: "o que impede a mesma estadia de entrar
  em duas faturas"). Regra: uma despesa só em uma fatura não cancelada.
- **Repassar não muda o motorista:** se ele pagou e a empresa devolve, ele recebe no acerto
  igual. São dois fluxos independentes: o que a empresa deve a ele e o que o cliente deve à empresa.
- **Estadia nunca é categoria de despesa.** Estadia é tempo parado × valor/hora
  (`TipoEventoViagem.geraCobranca`, `schema.prisma:4752`; `common/estadia-fatura.ts`). Uma
  "despesa de estadia" repassada cobraria o cliente duas vezes pela mesma espera.

---

## 5. Onde cada despesa entra

| Destino | EMPRESA pagou | MOTORISTA pagou, devolve (aprovada) | MOTORISTA pagou, por conta dele | Repassável |
|---|---|---|---|---|
| **Acerto** | não | crédito `REEMBOLSO_DESPESA` (+ `despesaId`) | não | indiferente |
| **Lucro por caminhão** | custo, linha nova "Despesas de viagem" | custo, mesma linha | `foraDaConta.despesas` | custo sempre; receita quando faturada |
| **Lucro por obra/viagem** (`resultado-obra.ts`) | custo da viagem | custo da viagem | fora | idem |
| **Contas a pagar** | só se "faturado no fornecedor" → `TituloPagar(fornecedorId, despesaId)` | via acerto (já gera título ao fechar, `acertos.service.ts:449-470`) | não | — |
| **Fatura do cliente** | se repassável | se repassável | se repassável | `FaturaLinha.despesaViagemId` |
| **Relatórios** | por categoria/caminhão/motorista/viagem, sempre com a coluna "quem pagou" | | | |

Regras de encaixe no lucro (`common/lucro-veiculo.ts`):
- O custo vem **da despesa**, nunca do item de acerto nem do título. O lucro hoje só conta
  `FRETE` do acerto como custo de motorista (`lucro-veiculo.ts:21-23, 225-237`); `REEMBOLSO_DESPESA`
  tem que ficar fora de "motorista", senão conta duas vezes.
- `TituloPagar` gerado por despesa entra na exclusão que já existe pra acerto e manutenção
  (`relatorios-lucro.service.ts:185-195`: `acertoId: null, manutencao: null`) → somar
  `despesaId: null`.
- "A empresa pagou" = EMPRESA, ou MOTORISTA com devolução **aprovada**. Pendente de conferência
  entra no lucro como custo com aviso ("R$ X ainda em conferência"), igual `abastecimentosEstimados`
  (`lucro-veiculo.ts:134-143`): dado faltando nunca vira zero calado.
- A despesa precisa de `veiculoId` carimbado (da viagem, ou do veículo atual do motorista se sem
  viagem), senão não tem caminhão pra cair.
- Receita da despesa repassada só conta quando está numa fatura não cancelada. (Hoje a estadia
  faturada também não entra no "faturou" do lucro — buraco pré-existente, mesmo conserto.)

---

## 6. Valor congelado

- `ItemAcerto` ganha `despesaId` e guarda descrição e valor em snapshot (já é o padrão do model).
- Despesa com item em acerto **FECHADO ou PAGO** fica travada: painel responde 409 "já está no
  acerto de DD/MM; corrija com ajuste no próximo". Motorista não edita despesa aprovada; editar
  despesa ainda não aprovada volta pra conferência.
- Acerto **ABERTO** regenera: a despesa entra como item **automático**, então aprovar/desaprovar
  com o acerto aberto é refletido na próxima geração (`acertos.service.ts:279` só varre automático).
- PAGO não reabre (`acertos.service.ts:491-499`); o conserto é `AJUSTE` no acerto seguinte.
- Fatura emitida congela a linha (`FaturaLinha` não lê a despesa em runtime).

---

## 7. Riscos de dinheiro contado duas vezes ou sumido

**R1 — Terceira fonte de pedágio.** A categoria "pedágio" no módulo novo seria a terceira fonte
ao lado de `Viagem.valorPedagioTotal` e `Pedagio.valor` (`pedagioDaViagem`,
`acerto-motorista.ts:125-133`). **Regra:** pedágio e abastecimento não são categorias; na tela
de despesas aparecem como atalhos que abrem os fluxos que já existem (`/m/pedagios`,
`/m/abastecimentos`). "Outra despesa" com descrição que lembra pedágio/diesel/ARLA →
carimbo pro conferente ("isto parece pedágio — lance pelo pedágio").

**R2 — O evento "Paguei pedágio" da viagem guiada** grava `EventoViagem.valor`
(`admin/contas/kit-inicial.ts:189-197`) e hoje não vale dinheiro. Ele **não pode** virar
fonte por conta própria. Se um dia valer, que crie um `Pedagio` com `viagemId` (fonte que
`pedagioDaViagem` já arbitra), nunca um terceiro caminho.

**R3 — PEDÁGIO EM DOBRO JÁ POSSÍVEL HOJE (pré-existente, achado agora).** A tela de pedágio
avulso não manda `viagemId`; o acerto reembolsa o `valorPedagioTotal` da viagem
(`acerto-motorista.ts:211-225`) **e também** todo avulso com `viagemId: null` do período
(`acerto-motorista.ts:228-239`, busca em `acertos.service.ts:208-216`). Motorista que lança o
pedágio avulso e preenche o total na viagem recebe duas vezes. O `pedagioDaViagem` só arbitra
avulsos JÁ vinculados. Conferir em produção antes de qualquer coisa.

**R4 — Repasse de pedágio ignora os avulsos.** `viagem-preco.ts:210` repassa só
`valorPedagioTotal`. Se o módulo passar a vincular pedágio avulso à viagem, o cliente não é
cobrado desse pedágio. O repasse deveria usar `pedagioDaViagem`.

**R5 — Cartão combustível + reembolso.** Abastecimento casado com transação do cartão da
empresa (`TransacaoCartao`, conciliação em `admin/cartao-combustivel/`) continua sendo
reembolsado se a modalidade tem `reembolsaAbastecimento=true` — o acerto não olha o cartão
(`acertos.service.ts:200-207`). Pré-existente; o módulo de despesas não pode repetir: despesa
com "cartão da empresa" nunca gera crédito, independentemente da modalidade.

**R6 — Seleção do acerto por DATA (pré-existente, crítico pro módulo).** O acerto escolhe
viagens, abastecimentos e pedágios pela data dentro do período (`acertos.service.ts:179-217`), e
a única trava é período idêntico (`@@unique([contaId, motoristaId, periodoInicio, periodoFim])`).
Consequências:
- Períodos sobrepostos (01–15 e 01–30) pagam o mesmo item duas vezes — não há unique em
  `ItemAcerto.abastecimentoId`/`pedagioId`.
- Lançamento offline que sincroniza depois do acerto fechado **some**: a data dele está num
  período que não regenera.
- Despesa aprovada depois do fechamento sumiria igual.
**Regra pro módulo:** despesas e adiantamentos entram por "aprovada/registrado, data ≤ fim do
período, e **sem item vivo em nenhum acerto**" — não por "data dentro do período". Mais um índice
único parcial em `itens_acerto(despesaId) WHERE despesaId IS NOT NULL` (e o mesmo pra
`adiantamentoId`). Recomendo estender pra pedágio e abastecimento.

**R7 — Despesa + título manual.** Escritório que já lança a conta do cartão/fornecedor como
`TituloPagar` com `veiculoId` e o motorista lança a mesma despesa como "empresa pagou" → custo
dobrado no lucro. Regra: título de fatura de cartão sem `veiculoId` (o custo por caminhão vem
das despesas); aviso de possível duplicata (mesmo veículo, dia, valor) na tela de contas a pagar.

**R8 — Borracharia como despesa e como manutenção.** Mesmo pneu lançado pelo motorista e pelo
escritório em `ManutencaoVeiculo` (`schema.prisma:3682`) conta duas vezes no lucro. Mesmo aviso
de duplicata; despesa pode ser "convertida" em manutenção (link, e o lucro conta uma só).

**R9 — Multa.** Já tem model e regra de desconto (`schema.prisma:3913`, `descontarDoMotorista`,
`itemAcertoId`). Não é categoria de despesa.

**R10 — Caderno pessoal.** `LancamentoPessoal` (`schema.prisma:1380`) não tem `contaId` e
"nenhuma empresa vê". Nunca alimenta o módulo nem migra pra ele. São dois produtos.

**R11 — Comboio / empresa pagou nunca vira reembolso**, mesma regra de `acerto-motorista.ts:243-245`.

**R12 — Adiantamento negativo que some** (seção 2): hoje some; com o módulo vira item
`SALDO_ANTERIOR`.

---

## 8. O que muda no código existente (pra arquiteto)

- `TipoItemAcerto` (`schema.prisma:2597`): + `REEMBOLSO_DESPESA`, + `SALDO_ANTERIOR`. Um tipo só
  pra todas as categorias — categoria é catálogo, não enum (enum = migration por cliente).
- `ItemAcerto`: + `despesaId`, `adiantamentoId`, `acertoOrigemId` com índice único parcial.
- `ItemCalculado`/`calcularAcerto` (`acerto-motorista.ts:96-106, 185-259`): recebe
  `despesas` e `adiantamentos` já filtrados (aprovadas, não acertadas, devolvíveis pela régua).
- `RegraRemuneracao` (`acerto-motorista.ts:24-32`): + `reembolsaDespesa: Map<categoriaId, boolean>`
  resolvido SÓ da modalidade.
- `LucroVeiculo.custos` (`lucro-veiculo.ts:119-127`) + `despesasViagem`; `foraDaConta`
  (`:133`) + `despesas`; aviso `despesasEmConferencia`.
- `relatorios-lucro.service.ts:185-195`: exclusão `despesaId: null`.
- `FaturaLinha`: + `despesaViagemId`.
- `TituloPagar`: + `despesaId` (faturado no fornecedor, e reembolso de CLT).
- Dinheiro sempre `Decimal(12,2)`, valor > 0 na despesa, sinal único no `ItemAcerto`.
- Data da despesa ancorada em `America/Sao_Paulo` (`common/timezone.ts`).

---

## 9. Régua final (pro dono, sem jargão)

1. O motorista conta o que gastou, quanto, como pagou e manda a foto. Mais nada.
2. Quem decide se a empresa devolve é a empresa, uma vez, no cadastro da modalidade — igual já é com pedágio e diesel.
3. Até um valor por tipo de gasto, a devolução é automática; acima disso, sem foto ou repetido, o escritório confere. Nada é recusado na cara do motorista.
4. O adiantamento entra sozinho no acerto: o que ele gastou pela empresa é devolvido, o que sobrou é descontado. Ninguém faz conta à mão.
5. Se sobrar dívida dele num acerto, ela aparece no próximo — não some.
6. Gasto que dá pra cobrar do cliente (taxa de descarga) vai pra fatura como linha separada, uma vez só.
7. Pedágio e diesel continuam nos lançamentos de sempre; o módulo novo não cria uma terceira conta deles.
8. No lucro por caminhão, gasto só é custo da empresa se a empresa pagou ou devolveu.
9. Acerto fechado não muda; correção vira ajuste no seguinte.
10. Achados pra conferir já: pedágio pode estar sendo devolvido em dobro hoje, e lançamento que chega depois do acerto fechado não é pago nunca.
