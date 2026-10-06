# 08 — Gasto de viagem x manutenção do caminhão

Data: 05/10/2026. Pergunta do dono: *"não sei se é o caso, mas uma despesa não é uma
manutenção também?"*

**Resposta curta: às vezes é, e aí é as duas coisas ao mesmo tempo — mas o dinheiro só
pode ser contado uma vez.** Uma borracharia na estrada é, ao mesmo tempo, (a) dinheiro que o
motorista tirou do bolso e quer de volta e (b) um serviço feito no caminhão, que tem que
aparecer no prontuário dele. São duas perguntas diferentes sobre o mesmo papel:

| Pergunta | Quem responde no Movatruck | O que guarda |
|---|---|---|
| **Quem pagou e quem devolve?** | o **gasto de viagem** (módulo novo) | foto do papel, valor lançado, valor aprovado, se devolve, em qual acerto entrou |
| **O que foi feito no caminhão?** | a **manutenção (OS)** — `ManutencaoVeiculo` | caminhão, tipo (CORRETIVA/PNEU…), data, km, plano que cumpriu, aviso que resolveu, custo do caminhão |

Recomendação: **o gasto continua sendo a porta do motorista; quando o tipo de gasto é
conserto, o gasto aprovado cria (ou se liga a) uma OS já concluída. O dinheiro vem do gasto,
o custo do caminhão é contado pela OS, e o gasto ligado sai da conta do lucro.**

---

## 1. Como o mercado separa (pesquisa)

**Fleetio** (a referência de manutenção) separa em três lançamentos que **nunca se somam
entre si**, e o custo total do veículo é a soma dos três baldes:
- **Service Entry** = manutenção/conserto: odômetro obrigatório, fornecedor, peças, mão de
  obra, imposto, itens de serviço, fotos e nota. Ao salvar, **zera os lembretes preventivos**
  e **resolve os problemas (Issues) ligados**. A **Work Order concluída gera sozinha a Service
  Entry** — a OS é o caminho "robusto", a Service Entry é o registro.
- **Fuel Entry** = abastecimento: litros, posto, odômetro. Entra pelo app do motorista (Fleetio
  Go), por integração de cartão, e tem tela própria de **mesclar abastecimento duplicado**
  (manual x cartão).
- **Expense Entry** = "todo o resto" ligado ao veículo, com tipos editáveis: pedágio (Tolls),
  multas, seguro, licenciamento, financiamento, depreciação, "Miscellaneous"…
  **Expense Entry não existe no app do motorista** — só o escritório lança.
- O custo total = Service + Fuel + Other Expenses. A não-duplicação vem de cada fato ter **um
  único tipo de lançamento**. Fleetio **não tem reembolso de motorista**: é ferramenta de
  custo do veículo, não de acerto com parceiro.

**Samsara**: o motorista manda o **cupom do diesel** por um formulário próprio (com leitura
por IA) que cai no relatório de combustível; **OS** nasce da inspeção (DVIR) ou da nota da
oficina escaneada. Despesa genérica do motorista fica pros "formulários" (Connected Forms).
**Motive**: o app do motorista sobe **documentos** (cupom de diesel, canhoto, balança, foto
de acidente); o cupom vira relatório de combustível; manutenção é módulo à parte.

**Brasil**: **Bsoft TMS** registra "todas as despesas e receitas da viagem, pagas pela
empresa ou pelo motorista", e elas entram no **acerto de motorista** junto com adiantamentos
e devoluções; manutenção, abastecimento e revisão ficam em **gestão de frota**, separados.
Sofit (manutenção, abastecimento, despesas e pneus como relatórios distintos), Cobli e Infleet
(manutenção preventiva + combustível; despesa de viagem não é o foco) seguem o mesmo corte.

**Lição pra nós:** todo mundo separa **por natureza do fato** (conserto / combustível / resto)
e o TMS brasileiro acrescenta **a régua do acerto** (quem pagou, quem devolve) por cima. O
que ninguém faz é deixar o mesmo papel virar dois custos. Nós temos as duas coisas no mesmo
sistema — então precisamos da **ponte**, não de escolher um lado.

Fontes: [Fleetio — Expenses Overview](https://help.fleetio.com/en_US/expenses-overview) ·
[Fleetio — Expense Entry Types (API)](https://developer.fleetio.com/docs/api/expense-entry-types) ·
[Fleetio — Service Entries no Fleetio Go](https://help.fleetio.com/en_US/service-entries-in-fleetio-go) ·
[Fleetio — Fuel Entry Overview](https://help.fleetio.com/en_US/fuel-entry-overview) ·
[Fleetio — Duplicate Fuel Entries](https://help.fleetio.com/en_US/duplicate-fuel-entries) ·
[Fleetio Go v2 (Work Order gera Service Entry)](https://www.fleetio.com/blog/announcing-fleetio-go-v2) ·
[Samsara — formulário de cupom de combustível](https://kb.samsara.com/hc/en-us/articles/40137562543501) ·
[Samsara — Fuel & Maintenance](https://samsara.com/products/telematics/fuel-and-maintenance/) ·
[Motive — Driver App Documents](https://helpcenter.gomotive.com/hc/en-us/articles/6162542840093-Driver-App-Documents) ·
[Motive — captura de cupom por IA](https://helpcenter.gomotive.com/hc/en-us/articles/36712599468189-AI-powered-Document-Capture-for-Fuel-Receipts-and-Bills-of-Lading) ·
[Bsoft — gerenciamento de frotas](https://bsoft.com.br/bsoft-tms/gerenciamento-de-frotas) ·
[Bsoft TMS](https://bsoft.com.br/produtos/software-controle-transportadoras/tms) ·
[Sofit (Mundo Logística)](https://mundologistica.com.br/noticias/coletora-de-residuos-implementa-solucao-sofit-para-obter-maior-controle-sobre-custos-da-frota) ·
[Cobli (B2B Stack)](https://www.b2bstack.com.br/product/cobli)

---

## 2. O que já existe no código (e que a ponte reaproveita)

- **`ManutencaoVeiculo`** (`schema.prisma:3682`) é a OS: tipo PREVENTIVA/CORRETIVA/PNEU/
  SINISTRO/OUTRO, status ABERTA→EM_ANDAMENTO→CONCLUIDA, `valorPecas/valorMaoObra/valorTotal`,
  `fornecedorId`, `anexos` (nota/fotos), `planoId` (o plano **zera na conclusão**), e
  `tituloPagarId` (conta a pagar gerada por `gerarConta`, `frota-manutencao.service.ts:156`).
- **`ProblemaVeiculo`** (`:3759`) é o aviso do motorista (com `clientId`, foto, "dá pra
  continuar rodando?"), e vira OS pelo `manutencaoId`. Concluir a OS fecha o ciclo e o
  motorista confirma "Ficou bom / Voltou".
- **`PlanoManutencao`** (`:3817`), **`Pneu`** (`:3876`), **`Multa`**, **`DocumentoVeiculo`**,
  **`CustoFixoVeiculo`** (`:3624`), **`Fornecedor`** (`:3594`, tipo OFICINA/PNEU/POSTO…),
  **`TituloPagar`** (`:3393`, com `veiculoId`, `acertoId`, `manutencao`).
- **Lucro por caminhão** (`common/lucro-veiculo.ts` + `admin/relatorios/relatorios-lucro.service.ts`):
  custo = motorista (FRETE do acerto ou régua) + combustível (só se a empresa pagou) +
  pedágio (`pedagioDaViagem`, uma fonte) + **manutenção (OS CONCLUIDA, pela data de conclusão,
  pelo `valorTotal`)** + multas (não descontadas do motorista) + custos fixos + outras contas.
  A regra anti-duplicata já existe pra título: conta a pagar com `acertoId` ou `manutencao`
  **não** entra em "outras contas" (`relatorios-lucro.service.ts:185-195`).
- **Princípio que o lucro já segue e a ponte mantém:** *o custo vem do fato de origem
  (viagem, abastecimento, pedágio, OS), nunca do item de acerto nem do título.* O
  `REEMBOLSO_PEDAGIO/ABASTECIMENTO` do acerto não é lido pelo lucro.
- A aba **Custos** da Manutenção (`custos-manutencao.service.ts`) e o **prontuário**
  (`/veiculos/[id]`) leem só `ManutencaoVeiculo`. Se o conserto da estrada não virar OS, ele
  **não aparece** no histórico do caminhão nem no custo de manutenção — é esse o buraco que o
  dono intuiu.

---

## 3. A regra: quando é gasto, quando é manutenção, quando é os dois

A pergunta que separa não é "quanto custou" nem "quem lançou". É: **mexeu no caminhão?**

| Gasto da estrada | Mexeu no caminhão? | O que vira | Tipo da OS |
|---|---|---|---|
| Borracharia (furo, remendo, câmara, troca de pneu) | sim | **gasto + OS** | PNEU |
| Troca de lâmpada, fusível, mangueira, correia, conserto na estrada | sim | **gasto + OS** | CORRETIVA |
| Socorro / guincho | sim (o caminhão quebrou) | **gasto + OS** | CORRETIVA |
| Óleo completado, filtro, ARLA em galão¹ | sim | gasto + OS (óleo/filtro) | PREVENTIVA/CORRETIVA |
| Lavagem | não (não muda estado, não tem histórico útil) | **só gasto** | — |
| Alimentação, pernoite, chapa, estacionamento, balsa | não | **só gasto** | — |

¹ ARLA abastecido na bomba é `Abastecimento` (`TipoCombustivel.ARLA_32`), nunca gasto.

E **quem pagou** decide o lado do dinheiro, independente de ser manutenção:
- **Motorista pagou do bolso** → é gasto de viagem (reembolso no acerto, se a empresa devolve).
  Se mexeu no caminhão, **também** vira OS.
- **A oficina cobrou a empresa** (boleto, faturado, conta na oficina conveniada) → **não é gasto
  do motorista**. É só OS (+ título a pagar pela `gerarConta`), lançada pelo escritório, como
  hoje. Se o motorista quiser registrar, é **"Problema no caminhão"**, não "Gasto de viagem".
- **Pago no cartão da empresa** → gasto sem reembolso (decisão já tomada na proposta, item 9) +
  OS se mexeu no caminhão.

---

## 4. A ponte (proposta concreta)

### 4.1 No tipo de gasto: "Isto é conserto do caminhão"

`TipoDespesa` ganha dois campos configurados **pela empresa** (nada chumbado):
- `ehManutencao: boolean` — rótulo na tela de tipos: **"Isto é conserto do caminhão (vai pro
  histórico dele)"**.
- `tipoManutencao: TipoManutencao?` — o tipo da OS que nasce (PNEU, CORRETIVA…).

Kit semeado: **Borracharia** (ligado, PNEU) e **Peça/conserto na estrada** (ligado, CORRETIVA).
Lavagem e os demais, desligados. A empresa pode criar "Guincho", "Elétrica" etc. e marcar.

**O motorista não decide nada disso.** Ele escolhe "Borracharia", fotografa, digita o valor —
os mesmos 3 toques. O tipo carrega a classificação. O caminhão vem da viagem (contexto, como
hoje); sem viagem, o formulário pergunta "Qual caminhão?" **sem nada marcado**
(`feedback_nunca_preselecionar_motorista`). Km não é perguntado: a OS usa o km estimado
(`common/km-atual.ts`).

### 4.2 Na aprovação (escritório): o gasto vira OS concluída

Na fila "Conferir gastos", gasto de tipo `ehManutencao` mostra um bloco a mais:
**"Vai pro histórico do ABC-1D23 como: Pneu"**, com três saídas (o escritório decide, o padrão
vem do tipo):
1. **Criar a manutenção** (padrão) → cria `ManutencaoVeiculo` **CONCLUIDA**, `tipo` do tipo de
   gasto, `concluidaEm = iniciadaEm = data do gasto (dia de SP)`, `descricao` = tipo + local +
   observação do motorista, `anexos` = foto do comprovante, `valorTotal` = **valor aprovado**,
   `odometro` = km estimado do dia, e **`despesaViagemId` (FK única)**.
2. **"É desta OS / deste aviso"** → lista OS abertas/em andamento e avisos (`ProblemaVeiculo`)
   abertos do mesmo caminhão nos últimos dias. Ligar a um aviso usa a cascata que já existe
   (aviso → OS → motorista recebe "decidido" e confirma "Ficou bom"). Ligar a uma OS do
   escritório que **já tem valor** mostra os dois números lado a lado ("OS R$ 800 · gasto
   R$ 80 — o gasto é parte dela?") e a OS fica com o valor dela; o gasto só vincula.
3. **"Não é conserto"** → fica só gasto (ex.: escolheu tipo errado). Sem motivo obrigatório:
   não mexe em dinheiro.

Opcional na mesma tela: **"Cumpre o plano: Troca de óleo 20 mil km"** → `planoId`, e o plano
zera pela regra de conclusão que já existe.

Regras de integridade da OS nascida de gasto:
- **Nunca gera título a pagar.** `gerarConta` recusa OS com `despesaViagemId`
  ("Já é pago ao motorista no acerto"). Senão o mesmo dinheiro sai duas vezes do caixa: uma no
  acerto, outra no Financeiro.
- **O valor é espelho do gasto:** na OS fica só leitura ("vem do gasto de viagem — corrija lá").
  Aprovar outro valor, ou o gasto deixar de ser reembolsado, atualiza a OS. Gasto cancelado →
  OS CANCELADA. Gasto em acerto FECHADO/PAGO já é imutável, então a OS também.
- **Aviso de duplicata (R8 do financeiro):** ao aprovar, se existe OS do mesmo caminhão, tipo
  PNEU/CORRETIVA, ±2 dias, o escritório vê "Já tem uma manutenção parecida: …" e a saída 2 vem
  à frente. Nunca bloqueia (`project_lancamento_nunca_recusado`).

### 4.3 Quem é a fonte do custo no lucro — exatamente

> **O dinheiro do motorista vem do GASTO. O custo do caminhão vem da OS quando ela existe;
> o gasto ligado a uma OS sai da conta.**

Em `lucro-veiculo.ts`, as linhas ficam:

| Linha do lucro | Lê de | Regra |
|---|---|---|
| Manutenção | `ManutencaoVeiculo` CONCLUIDA (como hoje) | inclui as OS nascidas de gasto. Se a OS tem `despesaViagemId` e o gasto ficou **"por conta do parceiro"** (não devolve, não foi cartão da empresa), o valor vai pra `foraDaConta.manutencao`, não pro custo — mesma régua do combustível. |
| Gastos de viagem (nova, Onda 2) | gasto APROVADO com `veiculoId` | **`manutencao: { is: null }`** — gasto ligado a OS não entra aqui. Mesmo molde do filtro de título (`relatorios-lucro.service.ts:193`). "Por conta do parceiro" → `foraDaConta.despesas`. Em conferência → aviso, nunca zero. |
| Outras contas | `TituloPagar` | já exclui `acertoId` e `manutencao`; passa a excluir também título gerado por gasto (CLT, Onda 2). |
| Motorista | FRETE do acerto | o item `REEMBOLSO_DESPESA` do acerto **nunca** é lido pelo lucro (como os outros reembolsos). |

Por que a OS e não o gasto: é a OS que a aba **Custos**, o **prontuário** e o **custo/km de
manutenção** já leem. Se o lucro contasse o gasto e a OS ficasse sem valor, a aba Custos
diria que a borracharia custou zero e o `manutencoesSemValor` acusaria falso. Um valor, dois
lugares que o mostram, **uma** soma.

Teste de invariante a exigir: *para todo gasto aprovado com OS ligada, o lucro do caminhão
soma o valor exatamente uma vez* (OS dentro + gasto fora), incluindo os casos devolve /
cartão da empresa / por conta do parceiro.

### 4.4 Em que onda

Não é Onda 1. Na Onda 1 o gasto nem entra no lucro (`proposta.md`: "fora de propósito:
lucro por caminhão"), então não há o que duplicar. A ponte entra **na Onda 2, junto com o
lucro** — é a mesma entrega que a R8 já previa ("despesa pode ser convertida em manutenção").
Na Onda 1 basta **semear os campos `ehManutencao/tipoManutencao` no tipo** (sem efeito), pra
não migrar depois.

Módulos: a OS só é criada se a conta tem o módulo **`manutencao`**. Sem ele, o tipo nem mostra
o interruptor e o gasto fica só gasto (empresa que não contratou não vê nada de manutenção).

---

## 5. Pedágio e abastecimento: porta única na tela, entidades próprias no banco

**Recomendação: Pedágio e Abastecimento continuam entidades próprias (`Pedagio`,
`Abastecimento`, `Viagem.valorPedagioTotal`) e NUNCA são linhas do gasto genérico. A
unificação é só na porta (a lista "O que você pagou?") e na leitura ("Todos os gastos da
viagem").** É o que a proposta já diz; aqui fica o porquê e as travas.

Por que não "tipos de sistema" dentro do mesmo lançamento:
- **Pedágio já tem duas fontes** (`valorPedagioTotal` e `Pedagio.valor`) e a regra
  `pedagioDaViagem` escolhe uma. Uma terceira fonte é o pedágio em triplo.
- **Abastecimento tem semântica que gasto não tem:** litros, odômetro, tanque cheio, consumo
  km/l (`common/consumo.ts`), comboio, conciliação com o cartão-combustível, `odometroAnterior`.
  É exatamente por isso que o Fleetio separa Fuel Entry de Expense Entry.
- **FKs em produção:** `ItemAcerto.pedagioId/abastecimentoId`, `FechamentoLinha` (pedágio no
  fechamento do cliente), lucro, conferência diária. Migrar pra uma tabela única mexe em acerto
  e fatura de empresa em produção (`feedback_nunca_retirar_acesso_sem_autorizacao`).

As travas pra não duplicar:
1. **Na porta:** "Pedágio" e "Abastecimento" no topo da lista abrem **os formulários e
   endpoints que já existem** (`/m/pedagios`, `/m/abastecimentos`), com as capacidades de hoje.
   Nunca um `POST /m/despesas` com tipo pedágio.
2. **No cadastro de tipos:** nome reservado. A empresa não consegue criar tipo cujo nome
   normalizado (`unaccent`, minúsculo) seja pedágio/diesel/combustível/abastecimento/ARLA/multa
   — a tela explica "isto já tem lançamento próprio". O servidor valida (não só a tela).
3. **Na conferência:** se o motorista jogou pedágio em "Outro", o escritório tem
   **"Isto é pedágio" / "Isto é abastecimento"** → cria o `Pedagio`/`Abastecimento` com os
   dados do gasto e o gasto fica **CONVERTIDO** (fora do acerto, fora do lucro, com o link).
   Mesmo padrão da ponte com manutenção: um fato, uma entidade dona, a outra só aponta.
4. **Na leitura:** "Todos os gastos da viagem" (Onda 4) é um `UNION` só de leitura das três
   fontes, cada linha dizendo de onde veio. Soma de dinheiro nunca sai dessa visão — acerto e
   lucro continuam lendo cada fonte pela sua regra.

---

## 6. Resumo da regra pro dono

- **Gasto** responde *"quem pagou e quem devolve"*. **Manutenção** responde *"o que foi feito
  no caminhão"*. Borracharia na estrada é as duas coisas.
- A empresa marca, uma vez, quais tipos de gasto são conserto. O motorista não muda nada.
- Ao aprovar um gasto de conserto, o escritório manda pro histórico do caminhão: cria a
  manutenção já concluída (com a foto) ou liga a uma que já existe/a um aviso do motorista.
- **O dinheiro é contado uma vez:** reembolso vem do gasto (acerto); custo do caminhão vem da
  manutenção; o gasto ligado sai da conta do lucro; manutenção nascida de gasto nunca gera
  conta a pagar.
- Pedágio e diesel continuam com lançamento próprio; aparecem na mesma lista pro motorista,
  mas não viram "gasto genérico" nunca.

Decisão pro dono (nova, D6): **a ponte gasto → manutenção entra na Onda 2, junto com o lucro
por caminhão, e só em empresa que tem o módulo Manutenção?** Recomendação: sim.
