# 11 — As portas do gasto (arrumar a bagunça)

Data: 06/10/2026 · UX. Vale só pra **empresa com o módulo "Gasto de viagem"**; sem o
módulo a home continua com os cards Pedágio e Abastecimento e a aba Caderno, como sempre.
Nada implementado. Base: o código de hoje (commit `8dd058ae`).

## A ideia em 3 linhas

1. Hoje há **6 portas pra ver gastos e 5 pra lançar**, espalhadas em home, aba, tela de tipos, faixa e Perfil, com 5 nomes diferentes.
2. A aba Gastos e o botão "Ver meus gastos" da home abrem **a mesma tela** (o mesmo componente): a home tem um botão que leva pra uma aba que já está no rodapé.
3. Recomendação: **a aba Gastos é a única casa** (abre já em "O que você pagou?", com o "Pra receber de volta" embaixo); a home não fala de gasto; o Perfil perde "Meus gastos". Dentro da viagem, "Gastos desta viagem" fica.

---

## 1. Inventário — toda porta que existe hoje

Empresa com o módulo, motorista que pode lançar e acompanhar (`modulo.lancar` e `modulo.acompanhar`).

### Barra de baixo (`app/(tabs)/_layout.tsx`)

| Aba | Quando | Observação |
|---|---|---|
| Início | sempre | |
| Histórico | sempre (exceto registrado) | sub-abas **Viagens / Pedágios / Abastecimentos**. "Pedágios" lista *viagens com pedágio*, não o pedágio avulso |
| **Gastos** (`ReceiptText`) | `useAbaGastos()` = visão empresa e (lançar ou acompanhar) | ocupa o lugar da aba Caderno desde hoje de manhã |
| Conversas | se tem chat | |
| Perfil | sempre | |

### Portas pra LANÇAR

| # | Onde | Texto na tela | Leva pra | Quando aparece |
|---|---|---|---|---|
| L1 | Home, card (`index.tsx:670`, `CardGastoDeViagem`) | **Gasto de viagem** / "Pedágio, diesel, comida…" | `/gasto-viagem` (ou direto no formulário se só há 1 tipo) | `modulo.lancar`; fica abaixo de Começar viagem, Lançar viagem feita e Iniciar com GPS — costuma pedir rolagem |
| L2 | Aba Gastos, topo (`meus-gastos.tsx:94`) | botão laranja **Lançar gasto de viagem** | `/gasto-viagem` | `naAba && modulo.lancar` |
| L3 | Faixa verde pós-salvar (`FaixaGastoSalvo`, 8 s) | **Lançar outro** | `/gasto-viagem` com o mesmo contexto | depois de salvar pelo `gasto-novo` — mora na home e dentro do bloco da viagem. **Não aparece** depois de salvar Pedágio ou Abastecimento (eles não chamam `marcarGastoSalvo`) |
| L4 | `/meus-reembolsos` vazio (`meus-gastos.tsx:190`) | **Lançar gasto de viagem** | `/gasto-viagem` | só na versão empilhada, sem nenhum gasto |
| L5 | Dentro da viagem: viagem guiada (`viagem-guiada.tsx:425`), Finalizar viagem (`finalizar-viagem.tsx:950`), Lançar viagem feita (`nova-viagem.tsx:1896`) — `GastosDaViagem` | "Gastos desta viagem" + **Adicionar gasto** | `/gasto-viagem` filtrado (sem Pedágio e Abastecimento), vínculo pelo contexto | `modulo.lancar` |
| — | Tela de tipos `/gasto-viagem` | título **Gasto de viagem** · "O que você pagou?" · linhas **Pedágio**, **Abastecimento**, depois os tipos da empresa, "Outro" por último | `novo-pedagio`, `novo-abastecimento`, `gasto-novo` | é o miolo de L1–L4 |
| — | Pendentes (`pendentes.tsx:609`) | corrigir gasto que voltou com erro | `gasto-novo` | item com 4xx |

### Portas pra VER / ACOMPANHAR

| # | Onde | Texto | Leva pra | Quando |
|---|---|---|---|---|
| V1 | Aba Gastos | "Gastos" — Pra receber de volta R$, "aprovado — entra no próximo acerto", "com o escritório", abas **Pra receber / Todos**, lista por mês | — (é a tela) | `useAbaGastos()` |
| V2 | Home, botão (`index.tsx:680`) | **Ver meus gastos** | `/meus-reembolsos` = **a mesma tela da V1**, empilhada, com voltar | `modulo.acompanhar`, sempre (mesmo com R$ 0) |
| V3 | Home, card `CardPraReceber` (`index.tsx:743`) | **Pra receber de volta** R$ / "R$ x aprovado" / "R$ x com o escritório" (tocar no valor abre `/meus-reembolsos`) | V1 empilhada | só se há valor ou gasto sem viagem; mais embaixo, depois de "Seu aviso" |
| V4 | Tela de tipos `/gasto-viagem`, topo | **Ver meus gastos** | V1 empilhada | aberta fora da viagem — inclusive quando ele veio **da própria aba Gastos** (a tela de baixo já é a lista) |
| V5 | Faixa pós-salvar | **Ver meus gastos** | V1 empilhada | 8 s depois de salvar |
| V6 | Perfil, linha (`perfil.tsx:338`) | **Meus gastos** | V1 empilhada | `modulo.acompanhar` |
| — | Home, "Resumo de outubro" | linha "pedágios · total R$" | — | quando há viagem com pedágio no mês: mais um número de gasto na home |
| — | Histórico › Abastecimentos | lista de abastecimentos | — | o abastecimento lançado pela tela de tipos aparece **aqui**, não em Gastos |

### Portas pra "gastos sem viagem"

| # | Onde | Texto | Quando |
|---|---|---|---|
| S1 | Home, dentro do `CardPraReceber` | "N gastos sem viagem" + **Ligar à viagem** | há gasto sem resposta |
| S2 | Aba Gastos (e V2–V6) | caixa azul "N gastos sem viagem" + **Ligar à viagem** | idem |
| S3 | Finalizar viagem / Lançar viagem feita (`perguntaPonte`) | "Você tem N gastos de hoje sem viagem (R$ x). São desta?" + **Ver e ligar** | gasto solto do mesmo dia; aparece uma vez |

### Caderno pessoal (o que a empresa não vê)

| Onde | Texto | Leva pra |
|---|---|---|
| Perfil | **Meu caderno pessoal** — "Fretes por conta própria e anotações suas" | `/caderno-pessoal` |
| Topo do caderno e do "Anotar gasto" | aviso amarelo "Isto é só seu: o escritório não vê. Pra receber de volta no acerto, lance em Gastos." + **Ir pra Gastos** | aba Gastos |
| Caderno | **Anotar gasto** | rota `/meus-gastos` (gasto PESSOAL) |

### Tutorial da home
`lib/home-tutorial.ts:57` — passo "Gasto de viagem" aponta pro card L1.

**Conta:** 5 portas de lançar (L1–L5), 6 de ver (V1–V6), 3 de "sem viagem", e **5 nomes**: "Gasto de viagem", "Gastos", "Meus gastos", "Lançar gasto de viagem", "Pra receber de volta" — mais "Anotar gasto" no caderno.

---

## 2. Diagnóstico

### O que é redundante

- **V2, V4, V5 e V6 abrem a V1.** A aba já está sempre no rodapé; cada um desses botões empilha uma cópia da aba por cima dela. O pior caso é a **V4**: ele está na aba Gastos, toca "Lançar gasto de viagem", e a tela seguinte oferece "Ver meus gastos" — que é a tela de onde ele acabou de sair. O botão "voltar" e o "Ver meus gastos" levam pra telas idênticas, uma delas com voltar e outra sem.
- **V3 repete o número que está no topo da V1**, e **S1 repete a S2**. A home virou uma segunda aba Gastos, só que espremida no meio de outros blocos.
- **L1 e L2** levam à mesma lista de tipos. Com a aba existindo, o card da home não tem trabalho a fazer que a aba não faça.

### O que confunde (mais grave que a repetição)

1. **Pedágio e Abastecimento moram em Gastos, mas não aparecem em Gastos.** A tela de tipos oferece os dois, só que a lista e o "Pra receber de volta" só mostram as despesas do módulo. O abastecimento aparece em *Histórico › Abastecimentos*; o pedágio avulso **não aparece em lugar nenhum** do app (`usePedagios()` existe em `lib/queries.ts:1059` e nenhuma tela usa; Histórico › Pedágios lista viagens). É a reclamação de origem do módulo — "lancei e não achei" — voltando pela porta do lado.
2. **A faixa verde só aparece pros tipos da empresa.** Depois de salvar pedágio ou diesel ele volta sem confirmação nenhuma.
3. **5 nomes pra uma coisa só.** Ele toca em "Gasto de viagem", cai numa tela chamada "Gasto de viagem", depois em "Meus gastos", na aba "Gastos", e o caderno tem "Anotar gasto". Quem tem pouca intimidade com celular lê nome diferente como lugar diferente.
4. **Dois números de gasto na home** (card Pra receber + linha "pedágios" do resumo do mês) que não batem entre si, porque um é reembolso e o outro é pedágio da viagem.
5. **Armadilha de código** (não aparece na tela, mas gera o próximo erro): a rota `/meus-gastos` é o gasto **pessoal** do caderno, e a tela com título "Meus gastos" é a rota `/meus-reembolsos`.

### O que o caminhoneiro faz hoje, situação por situação

| Situação | O que ele provavelmente faz | Toques | O que dá errado |
|---|---|---|---|
| **Almoçou e quer lançar** | Abre o app → home → rola até "Gasto de viagem" → Comida → foto e valor → Salvar | 3 + rolagem | Se for pela aba: Gastos → Lançar gasto de viagem → Comida → Salvar = **4**. Dois caminhos com contagens diferentes pra mesma coisa |
| **Quer saber se vai receber** | Home: acha o card "Pra receber de volta" (se tiver valor), ou "Ver meus gastos", ou aba Gastos, ou Perfil › Meus gastos | 0 a 2 | 4 lugares; e se lançou pedágio ou diesel, **não acha em nenhum** |
| **Lançou sem viagem** | Vê "N gastos sem viagem" na home, na aba, ou na pergunta do Finalizar | 1–2 | Ok, mas aparece duplicado na home e na aba |

---

## 3. Três alternativas completas

As três têm uma parte em comum, que deve ser feita qualquer que seja a escolha:

- **Um nome por coisa:** aba **Gastos** · lista de tipos **"O que você pagou?"** · acompanhar **"Meus gastos"** · dentro da viagem **"Gastos desta viagem"**. "Gasto de viagem" deixa de ser texto de tela (é o nome do módulo no painel).
- **Pedágio e abastecimento aparecem em Meus gastos** (aba "Todos"), com o status que a gente souber dar. Não entram na soma "Pra receber de volta" enquanto o acerto não disser que devolve. Sem isso, qualquer alternativa deixa o "lancei e não achei" vivo.
- **A confirmação depois de salvar aparece pros três** (pedágio, abastecimento e tipos da empresa).
- **Dentro da viagem nada muda:** "Gastos desta viagem" + "Adicionar gasto" + a pergunta do Finalizar. Ali é contexto, não repetição: o vínculo vem de onde ele tocou.
- O caderno pessoal fica no Perfil, com o aviso "Isto é só seu…" e o botão **Ir pra Gastos**.
- Na home, a linha "pedágios · total" do "Resumo de outubro" sai (com o módulo, pedágio é assunto de Gastos).

### Alternativa A — A aba Gastos é a única casa, e abre já pra lançar *(recomendada)*

**Barra:** Início · Histórico · **Gastos** · Conversas · Perfil (igual à de hoje).

**Home:** **nada de gasto**. Saem o card "Gasto de viagem" (L1), o botão "Ver meus gastos" (V2), o card "Pra receber de volta" (V3/S1) e a faixa verde. Sai também o passo do tutorial (a aba com o nome escrito já é a explicação).

**Aba Gastos** (de cima pra baixo):
1. Faixa verde depois de salvar (só a frase, **sem botões**: o "lançar outro" é a lista logo abaixo, e o "ver" é o card logo abaixo).
2. **"O que você pagou?"** — a lista de tipos, que hoje é a tela `/gasto-viagem`, mora direto na aba. Um toque e cai no formulário.
3. Card **"Pra receber de volta"** com o valor, as duas linhas (aprovado / com o escritório) e o botão **Ver meus gastos**.
4. Caixa "N gastos sem viagem" + **Ligar à viagem** (só quando há).

**Meus gastos** (empilhada, com voltar): a lista com as abas Pra receber / Todos. Sem botão de lançar (o voltar leva pra lista de tipos) e sem repetir o número grande (ele está no rótulo: "Pra receber · R$ 312,50").

**Some:** V2, V3, V4, V5, V6 (a linha "Meus gastos" do Perfil), L1, L2, L4, S1, o tutorial do card. A tela `/gasto-viagem` passa a existir só pra "Adicionar gasto" de dentro da viagem.

**Fica:** a aba (V1 + lista de tipos), L5 (dentro da viagem), S2, S3, Pendentes, caderno no Perfil.

**Toques:**
| Situação | Caminho | Toques até salvar/ver |
|---|---|---|
| Almoçou | Gastos → Comida → (foto, valor) → Salvar | **3** — sem rolar: a aba está em toda tela |
| Vai receber? | Gastos → o valor já está na tela | **1** (detalhe de cada um: + Ver meus gastos = 2) |
| Lançou sem viagem | Gastos → Ligar à viagem → escolhe a viagem | **2** (ou a pergunta do Finalizar, no próprio fluxo da viagem) |

**Contras:** quem estava acostumado com o card de lançar na home (há poucos dias, só onde o módulo ligou) tem que achar a aba. Se a empresa tiver 8+ tipos, o card "Pra receber" desce pra metade de baixo da tela.

### Alternativa B — Sem aba: tudo pela home

**Barra:** Início · Histórico · **Caderno** · Conversas · Perfil (o Caderno volta pro lugar de antes; **desfaz a troca de hoje de manhã**).

**Home:** dois cards seguidos, abaixo dos de viagem:
1. **Gastos** — "Pedágio, diesel, comida…" → abre "O que você pagou?". A faixa verde aparece logo acima dele.
2. **Pra receber de volta** — **sempre visível**, mesmo com R$ 0,00 (é a única porta de acompanhar), com o botão **Ver meus gastos** e, quando há, "N gastos sem viagem" + **Ligar à viagem**.

**Some:** a aba Gastos, o botão solto "Ver meus gastos", o "Ver meus gastos" da tela de tipos e a linha do Perfil.

**Toques:** almoçou = home → (rolar) → Gastos → Comida → Salvar = **3 + rolagem**; vai receber = **0** (o valor está na home, se rolar até ele), detalhe = 1; sem viagem = **1**.

**Contras:** vai contra "funcionalidade diária merece aba": quem roda longe lança gasto várias vezes por dia e fica rolando abaixo de 3 a 5 blocos de viagem. A home cresce de novo, que é o que o dono reclamou. E desfaz a decisão de hoje.

### Alternativa C — Cada verbo num lugar: lançar na home, acompanhar na aba

**Barra:** Início · Histórico · **Gastos** · Conversas · Perfil.

**Home:** só o card **Gastos** "Pedágio, diesel, comida…" (lançar), onde Pedágio e Abastecimento sempre moraram. Saem "Ver meus gastos", "Pra receber de volta" e a linha do Perfil.

**Aba Gastos:** só acompanhar (valor + sem viagem + lista). Pra não deixar sem saída quem procura ali, fica um botão **Lançar gasto** no topo — **ou seja, duas portas de lançar de novo** (home e aba).

**Toques:** almoçou = home → Gastos → Comida → Salvar = **3 + rolagem** (ou 4 pela aba); vai receber = **1**; sem viagem = **2**.

**Contras:** é a mudança menor, mas a regra "lançar na home, ver na aba" ninguém deduz sozinho: o motorista abre a aba **Gastos** esperando lançar gasto. Continua com dois caminhos de lançar com contagens diferentes, e esse é o tipo de duplicidade que o dono apontou.

---

## 4. Maquetes

Celular 390 px. `[ ]` = botão com ícone; `›` = linha que abre; laranja = rotina.

### A — recomendada

```
INÍCIO                              GASTOS (aba)                         MEUS GASTOS (empilhada)
┌──────────────────────────────┐    ┌──────────────────────────────┐    ┌──────────────────────────────┐
│ Olá, João                    │    │ Gastos                       │    │ ←  Meus gastos               │
│                              │    ├──────────────────────────────┤    ├──────────────────────────────┤
│ ┌──────────────────────────┐ │    │┌────────────────────────────┐│    │ Pra receber · R$ 312,50  Todos│
│ │ ▶ Começar viagem         │ │    ││✓ Gasto guardado. Vai pro   ││    │ ━━━━━━━━━━━━━━━━━━━          │
│ │ O app acompanha: carga → │ │    ││  escritório quando tiver   ││    │ OUTUBRO                      │
│ │ descarga → fim           │ │    ││  sinal.                    ││    │┌────────────────────────────┐│
│ └──────────────────────────┘ │    │└────────────────────────────┘│    ││[🍴] Comida        R$ 42,00 ││
│ ┌──────────────────────────┐ │    │ O que você pagou?            │    ││ hoje · Areal → Obra Sul    ││
│ │ 🚚 Lançar viagem feita   │ │    │┌────────────────────────────┐│    ││ ● Com o escritório         ││
│ │ Já fez? Registre carga,  │ │    ││[🛣] Pedágio               › ││    │├────────────────────────────┤│
│ │ descarga e a foto        │ │    ││[⛽] Abastecimento         › ││    ││[🛞] Borracharia  R$ 120,00 ││
│ └──────────────────────────┘ │    ││[🍴] Comida                › ││    ││ ontem · sem viagem         ││
│ ┌──────────────────────────┐ │    ││[🛞] Borracharia           › ││    ││ ● Aprovado — entra no      ││
│ │ 🔧 Problema no caminhão  │ │    ││[🛏] Pernoite              › ││    ││   próximo acerto           ││
│ │ Avisar com foto pro      │ │    ││[…] Outro                  › ││    │└────────────────────────────┘│
│ │ escritório               │ │    │└────────────────────────────┘│    │                              │
│ └──────────────────────────┘ │    │┌────────────────────────────┐│    │                              │
│ RESUMO DE OUTUBRO            │    ││Pra receber de volta        ││    │                              │
│ 18 viagens  412 t  2.340 km  │    ││R$ 312,50                   ││    │                              │
│ SUAS VIAGENS RECENTES        │    ││● R$ 200,00 aprovado — entra││    │                              │
│ ...                          │    ││  no próximo acerto         ││    │                              │
│                              │    ││● R$ 112,50 com o escritório││    │                              │
│                              │    ││[≡ Ver meus gastos]         ││    │                              │
│                              │    │└────────────────────────────┘│    │                              │
│                              │    │┌────────────────────────────┐│    │                              │
│                              │    ││2 gastos sem viagem         ││    │                              │
│                              │    ││[🔗 Ligar à viagem]         ││    │                              │
│                              │    │└────────────────────────────┘│    │                              │
├──────────────────────────────┤    ├──────────────────────────────┤    ├──────────────────────────────┤
│ Início Histórico GASTOS Conv. Perfil│ Início Histórico GASTOS Conv. Perfil│ Início Histórico GASTOS Conv. Perfil│
└──────────────────────────────┘    └──────────────────────────────┘    └──────────────────────────────┘
```
Sem gasto nenhum ainda: o card mostra "Pra receber de volta / R$ 0,00" e o botão "Ver meus gastos" some (não há o que ver).
Empresa que cancelou o módulo, mas ele tem histórico (`acompanhar` sem `lancar`): a aba mostra só o card e a lista, sem "O que você pagou?".

### B — sem aba

```
INÍCIO                                        MEUS GASTOS (empilhada)
┌──────────────────────────────┐              ┌──────────────────────────────┐
│ ▶ Começar viagem             │              │ ←  Meus gastos               │
│ 🚚 Lançar viagem feita       │              │ Pra receber · R$ 312,50  Todos│
│ ┌──────────────────────────┐ │              │ OUTUBRO                      │
│ │✓ Gasto guardado. Vai pro │ │ (só 8 s)     │ [🍴] Comida        R$ 42,00  │
│ │  escritório quando tiver │ │              │ ● Com o escritório           │
│ │  sinal.                  │ │              │ ...                          │
│ └──────────────────────────┘ │              │                              │
│ ┌──────────────────────────┐ │              │                              │
│ │ 🧾 Gastos                │ │──► O que você pagou? (tela, igual à lista da A)
│ │ Pedágio, diesel, comida… │ │              │                              │
│ └──────────────────────────┘ │              │                              │
│ ┌──────────────────────────┐ │              │                              │
│ │ Pra receber de volta     │ │              │                              │
│ │ R$ 312,50                │ │              │                              │
│ │ R$ 200,00 aprovado       │ │              │                              │
│ │ R$ 112,50 com o escritório│ │             │                              │
│ │ [≡ Ver meus gastos]      │ │              │                              │
│ │ ──────────────────────── │ │              │                              │
│ │ 2 gastos sem viagem      │ │              │                              │
│ │ [🔗 Ligar à viagem]      │ │              │                              │
│ └──────────────────────────┘ │              │                              │
│ 🔧 Problema no caminhão      │              │                              │
├──────────────────────────────┤              ├──────────────────────────────┤
│ Início Histórico CADERNO Conv. Perfil│      │ Início Histórico CADERNO Conv. Perfil│
└──────────────────────────────┘              └──────────────────────────────┘
```

### C — lançar na home, acompanhar na aba

```
INÍCIO                              GASTOS (aba)
┌──────────────────────────────┐    ┌──────────────────────────────┐
│ ▶ Começar viagem             │    │ Gastos                       │
│ 🚚 Lançar viagem feita       │    │ [+ Lançar gasto]  (laranja)  │
│ ┌──────────────────────────┐ │    │ Pra receber de volta         │
│ │ 🧾 Gastos                │ │    │ R$ 312,50                    │
│ │ Pedágio, diesel, comida… │ │    │ ● R$ 200,00 aprovado — entra │
│ └──────────────────────────┘ │    │   no próximo acerto          │
│ 🔧 Problema no caminhão      │    │ ● R$ 112,50 com o escritório │
│ RESUMO DE OUTUBRO            │    │ 2 gastos sem viagem          │
│ ...                          │    │ [🔗 Ligar à viagem]          │
│                              │    │ Pra receber   Todos          │
│                              │    │ OUTUBRO                      │
│                              │    │ [🍴] Comida        R$ 42,00  │
│                              │    │ ...                          │
├──────────────────────────────┤    ├──────────────────────────────┤
│ Início Histórico GASTOS Conv. Perfil│ Início Histórico GASTOS Conv. Perfil│
└──────────────────────────────┘    └──────────────────────────────┘
```

---

## 5. Por que a A

- **A aba está em toda tela; o card da home fica abaixo de 3 a 5 blocos de viagem.** Pra quem lança várias vezes por dia, um toque fixo no rodapé ganha da rolagem — a mesma régua que levou o Ponto pra aba.
- **Abrir a aba já em "O que você pagou?"** derruba a tela intermediária: lançar fica em 3 toques pela aba (hoje são 4), igual ao melhor caminho que existe hoje pela home.
- **Uma porta por verbo, e as duas na mesma aba.** Lançar = a lista; ver = o card com o valor. Some a pergunta "onde eu vejo?", porque ver e lançar estão na mesma aba.
- **A home volta a ser da viagem**, e respeita a decisão de hoje de manhã (a aba Gastos fica; o Caderno segue no Perfil).
- **O que a A não resolve sozinha:** o pedágio e o diesel aparecerem em "Meus gastos". Isso vale pras três alternativas e é o que mais pesa pro motorista.

## 6. Checklist de implementação (A)

1. `(tabs)/gastos.tsx`: faixa (sem botões) → lista de tipos (extrair o miolo de `gasto-viagem.tsx` num componente) → card "Pra receber de volta" com **Ver meus gastos** → caixa "sem viagem".
2. `components/meus-gastos.tsx`: tirar `naAba`; versão única empilhada, sem botão de lançar e sem o número grande (vai pro rótulo da aba "Pra receber").
3. `(tabs)/index.tsx`: remover `FaixaGastoSalvo`, `CardGastoDeViagem`, o botão "Ver meus gastos", o `CardPraReceber` e a linha de pedágio do resumo quando `modulo.lancar`. Os cards Pedágio/Abastecimento continuam sem o módulo.
4. `gasto-viagem.tsx`: só pro contexto da viagem; remover o "Ver meus gastos".
5. `FaixaGastoSalvo`: sem botões; `novo-pedagio` e `novo-abastecimento` passam a chamar `marcarGastoSalvo`; depois de salvar pela aba, voltar pra aba.
6. `perfil.tsx`: remover a linha "Meus gastos" quando `useAbaGastos()`.
7. `lib/home-tutorial.ts`: remover o passo "Gasto de viagem".
8. Meus gastos › Todos: incluir pedágio avulso e abastecimento do motorista (não somam em "Pra receber" até o acerto confirmar que devolvem).
9. Renomear a rota `/meus-gastos` (gasto pessoal) pra `/anotar-gasto` e `/meus-reembolsos` pra `/meus-gastos` (com redirect da antiga, por causa de pilha e link velhos).
10. OTA só depois da API, se o item 8 precisar de endpoint (`feedback_empresa_manda_no_app`: API antes do OTA).
