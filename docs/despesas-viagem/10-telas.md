# 10 — Telas do módulo Gasto de viagem (pra virar protótipo clicável)

Data: 05/10/2026 · desp-ux. Base: `proposta.md` (versão final com o QA) + `04-ux.md` +
os requisitos novos do dono (A–H). **Nada implementado.** Este arquivo é o roteiro do
protótipo HTML: cada tela tem tamanho, ordem dos elementos, texto exato e estados.

---

## 0. A ideia em 3 linhas

1. **Motorista:** "Gasto de viagem" → escolhe o que pagou → foto → valor → Salvar. Funciona sem sinal. Se foi numa viagem, diz qual (ou deixa pra depois).
2. **Escritório:** cada empresa monta a lista de tipos de gasto e decide, tipo a tipo, que campos o celular pede e o que devolve. Confere numa fila com a foto do lado.
3. **Motorista acompanha** em "Meus reembolsos" quanto vai receber de volta e em que pé está cada gasto.

### Mudanças em relação à proposta (vindas dos requisitos novos)

| Antes (`proposta.md`) | Agora | Por quê |
|---|---|---|
| Tipo tinha só "pede foto / devolve / aprova sozinho" | Tipo tem **campos ligáveis** (foto, litros, odômetro, placa, onde foi, descrição) e **regras** (devolve, aprova sozinho, teto, é manutenção, pode cobrar do cliente) | Pedido do dono (G): borracharia pede placa e "o que foi feito", almoço não |
| Tela de acompanhamento "Gastos de viagem" | **"Meus reembolsos"** | Nome do dono (E); e "Gasto de viagem" fica só pra porta de lançar, sem dois lugares com o mesmo nome |
| Vínculo: perguntado, obrigatório responder | **Pergunta sem resposta obrigatória**; sem resposta, o gasto nasce solto e vai pra **"Gastos sem viagem"** | No posto, com luva, ele não pode ser travado por uma pergunta; e solto-sem-resposta é diferente de "não foi em viagem" (nada é afirmado por ele) |
| Sem aviso de duplicata no app | **Aviso inline ao salvar** (F), nunca bloqueia | Pedido do dono |

### Duas travas que o protótipo tem que respeitar (não são opinião de UX)

- **Pedágio não pergunta "Foi nesta viagem?" até a Onda 4** (achado B3 do QA: pedágio avulso ligado à viagem some do acerto ou paga em dobro). No protótipo o pedágio aparece sem o card de vínculo. Dentro da viagem, o pedágio continua sendo o campo "Pedágio (R$)" que já existe.
- **Abastecimento não tem viagem no banco** (`CriarAbastecimentoInput` sem `viagemId`). Abre o formulário de hoje, sem o card de vínculo, e **não aparece** no "Adicionar gasto" de dentro da viagem.

---

## 1. Medidas e linguagem visual (vale pra todas as telas do app)

- Quadro: **390 × 844** (iPhone 14/15). Margem lateral 16 px. Espaço entre blocos 16 px.
- Cabeçalho: o `ScreenHeader` atual (azul-marinho `hsl(220 75% 28%)`, 56 px, seta de voltar à esquerda, título branco 18 px bold).
- Alvo de toque mínimo **56 px** de altura (luva). Linhas de lista: 64 px. Botão principal: **80 px** (`h-20`, igual ao "Salvar pedágio" de hoje), texto 20 px bold.
- Cores (tokens do app): laranja `primary` = rotina (Salvar); verde `success` = confirmar; amarelo `warning` = cuidado; vermelho `destructive` = apagar; contorno = voltar. Laranja **nunca** como texto em fundo branco (contraste) — link usa o azul-marinho.
- Status de gasto pro motorista: cinza, azul-claro, verde, âmbar. **Vermelho nunca aparece em status de gasto.**
- Valor em dinheiro: 28 px bold, alinhado à direita nas listas, sempre `R$ 1.234,56`.
- Escolhas: listas de navegação (linhas com ícone e `›`) ou `Select` com busca. **Nunca grade de botões grandes** (`feedback_selecao_botoes_odiada`). **Nada vem marcado** (`feedback_nunca_preselecionar_motorista`).
- Validação: guiada — rola até o campo, borda vermelha, frase grande embaixo, vibra. Sem pop-up.
- Confirmação: sempre **inline** na própria tela (troca o rodapé), nunca `showConfirm` (folhas e modais).
- Faixa offline: a tarja que já existe no topo ("Sem internet — tudo fica guardado no celular"). Nenhuma tela deste módulo bloqueia por falta de sinal.

Painel: quadro **1440 × 900**; na faixa MacBook compacto (1024–1535) o menu vira gaveta e as três colunas viram duas (ver cada tela). Azul = rotina, verde = aprovar, amarelo = cuidado, vermelho = apagar.

---

## 2. Mapa das telas

```
APP DO MOTORISTA
Início ─┬─ card "Gasto de viagem" ──► [A] O que você pagou? ─┬─► [B] Formulário do tipo ──► salvar (+[F] aviso de repetido)
        │                                                    ├─► Pedágio (form curto)
        │                                                    └─► Abastecimento (form de hoje)
        ├─ card "Pra receber de volta" ──► [E] Meus reembolsos ──► [E2] Detalhe do gasto
        │                                      └─► [C2] Gastos sem viagem
        └─ viagem em andamento ──► viagem guiada ──► Finalizar viagem ──► [D] seção "Gastos desta viagem"
Lançar viagem feita ──► [D] seção "Gastos desta viagem"
Perfil ──► "Meus reembolsos"

PAINEL
Lançamentos › Gastos de viagem ─┬─ aba Conferir   [H]
                                ├─ aba Todos
                                └─ aba Tipos de gasto [G] (com prévia do celular)
Ficha da viagem ─ cartão "Gastos desta viagem"   ·   Acerto ─ linha "Reembolso de gastos"
```

Interruptores (`feedback_empresa_manda_no_app`): `app.despesa.lancar` (card, lista, botão na viagem, seção na viagem, Gastos sem viagem) e `app.despesa.acompanhar` (card "Pra receber de volta", Meus reembolsos, item no Perfil). Os dois nascem ligados pra quem contrata o módulo. Sem o módulo a home fica **exatamente** como hoje (D5).

---

## 3. App — Início com o módulo

**Onde:** o card "Gasto de viagem" ocupa o lugar dos cards "Pedágio" e "Abastecimento" (que somem só para conta com o módulo). O card "Pra receber de volta" vem depois dos avisos.
**Por quê:** lançar gasto é algumas vezes por semana — card de ação, não aba; acompanhar é aviso — card que some quando não há nada.

```
┌──────────────────────────────────────┐ 390
│▓▓ Movatruck · Transportes Andrade ▓▓▓│ header da marca (já existe)
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ ▶ Viagem em andamento            │ │ (já existe)
│ │   Pedreira Bela Vista → Arena    │ │
│ │   Continuar viagem ›             │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ [🚚] Lançar viagem feita         │ │ (já existe)
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │ card rotina: borda 2px, fundo branco
│ │ [🧾]  Gasto de viagem            │ │ título 18 bold
│ │       Pedágio, diesel, comida,   │ │ 14, cinza; 3 primeiros tipos + "…"
│ │       borracharia…               │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │ card aviso (sem borda forte)
│ │ Pra receber de volta             │ │ 14 semibold cinza
│ │ R$ 312,40                        │ │ 28 bold
│ │ R$ 240,00 aprovado               │ │ 14
│ │ R$ 72,40 com o escritório        │ │ 14
│ │ ─────────────────────────────── │ │
│ │ 2 gastos sem viagem · Ligar ›    │ │ só se houver; link azul-marinho
│ │                Ver meus reembolsos›│ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ [🔧] Problema no caminhão        │ │ (já existe)
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ Início Histórico Caderno Conversas Perfil│
└──────────────────────────────────────┘
```

Estados:
- **Card "Pra receber de volta" vazio:** não aparece (nem com R$ 0,00).
- **Só "sem viagem", nada a receber** (tipo que não devolve): card mostra só a linha "2 gastos sem viagem · Ligar ›".
- **Motorista só com uma opção na lista** (ex.: só pedágio, sem tipos da empresa): o card vira o atalho direto pro formulário e o subtítulo diz o nome do tipo.
- **Offline:** valores vêm do cache; embaixo do número, cinza 12: "Atualizado às 09:40".

---

## 4. [A] App — "O que você pagou?"

**Por quê:** é lista de navegação (como o menu do Perfil), não seletor: um toque escolhe e já abre o formulário certo. Ordem fixa (do painel), nunca por uso.

```
┌──────────────────────────────────────┐
│ ←  Gasto de viagem                   │ header
├──────────────────────────────────────┤
│ O que você pagou?                    │ 22 bold
│ Vai pro escritório e volta pra você  │ 14 cinza
│ no acerto.                           │
│                                      │
│ ┌──────────────────────────────────┐ │ grupo 1 (os que já existem no app)
│ │ [🛣] Pedágio                    › │ │ 64 px por linha, ícone 40 em quadrado
│ ├──────────────────────────────────┤ │ azul-claro, texto 18 semibold
│ │ [⛽] Abastecimento              › │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌──────────────────────────────────┐ │ grupo 2 (da empresa, ordem do painel)
│ │ [🍽] Alimentação                › │ │
│ ├──────────────────────────────────┤ │
│ │ [🛞] Borracharia                › │ │
│ ├──────────────────────────────────┤ │
│ │ [📦] Chapa / descarga           › │ │
│ ├──────────────────────────────────┤ │
│ │ [🛏] Pernoite                   › │ │
│ ├──────────────────────────────────┤ │
│ │ [🧽] Lavagem                    › │ │
│ │      Por sua conta              │ │ ← só em tipo que não devolve, 13 cinza
│ ├──────────────────────────────────┤ │
│ │ [•••] Outro                     › │ │ sempre por último
│ └──────────────────────────────────┘ │
│                                      │
│ Ver meus reembolsos ›                │ link azul-marinho, 16
└──────────────────────────────────────┘
```

Regras e estados:
- **Nenhuma linha destacada** ao abrir; o toque leva direto (sem "Continuar").
- Pedágio/Abastecimento aparecem só se a capacidade de hoje estiver ligada pra ele.
- "Por sua conta" (tipo que não devolve) avisa **antes** de ele lançar, pra não esperar dinheiro que não vem.
- **Tipos da empresa ainda não chegaram no celular** (instalou e nunca teve sinal): o grupo 2 vira um quadro tracejado:
  "Os tipos de gasto do escritório ainda não chegaram neste celular. Quando pegar sinal, eles aparecem aqui." + botão contorno **"Tentar agora"**. Pedágio e Abastecimento continuam funcionando.
- **Tipo desativado no painel depois de baixado:** some da lista na próxima atualização; o que já estava guardado no celular segue (vira carimbo no servidor, nunca erro).

---

## 5. [B] App — Formulário dinâmico

**Regra de montagem (a mesma pra todo tipo da empresa):**
1. Linha da viagem (só se ele veio de dentro de uma viagem) — fixa no topo.
2. **Foto** (se o tipo pede ou exige).
3. **Valor** (sempre).
4. **Campos obrigatórios do tipo**, na ordem: o-que-foi-feito, placa, litros, odômetro, onde foi.
5. **"Foi nesta viagem?"** (se há viagem pra sugerir e ele não veio de dentro dela).
6. Data/hora em uma linha: "Hoje, 14:32 · Foi em outro dia?".
7. **"Mais detalhes"** recolhido, com os campos **opcionais** do tipo (o nome deles aparece no rótulo, pra ele saber o que tem lá).
8. Botão **Salvar gasto** (laranja, 80 px), sempre no fim da rolagem.

**Por quê foto primeiro:** ele está com o papel na mão; fotografa e digita olhando o papel. A câmera **não** abre sozinha (quem não tem papel perderia um toque fechando).
**Por quê opcional fica escondido:** o que o escritório marcou como obrigatório é o mínimo; o resto é exceção, e cada campo a mais na tela é tempo parado no posto.

### 5.1 Alimentação (foto: pede · resto: nada) — o caso mais curto

```
┌──────────────────────────────────────┐
│ ←  Alimentação                       │
├──────────────────────────────────────┤
│ Foto do comprovante                  │ label 16 semibold
│ ┌──────────────────────────────────┐ │ quadro 180 px, borda tracejada 2px
│ │              [📷]                │ │
│ │       Fotografar o papel         │ │ 18 semibold
│ │                                  │ │
│ └──────────────────────────────────┘ │
│ Escolher da galeria · Não tenho o    │ 2 links 15, azul-marinho
│ comprovante                          │
│                                      │
│ Valor                                │
│ ┌──────────────────────────────────┐ │ 64 px, texto 28 bold
│ │ R$ 0,00                          │ │ teclado numérico, máscara R$
│ └──────────────────────────────────┘ │
│ Devolvido até R$ 45,00 por refeição. │ 13 cinza — só se o tipo tem teto
│                                      │
│ Foi nesta viagem?                    │ (ver 5.4)
│ ┌──────────────────────────────────┐ │
│ │ Pedreira Bela Vista → Arena      │ │
│ │ em andamento · começou 06:40     │ │
│ │ ┌────────────┐ ┌───────────────┐ │ │
│ │ │Foi nesta   │ │Não foi nesta  │ │ │ dois botões contorno 56 px,
│ │ │viagem      │ │               │ │ │ NENHUM marcado
│ │ └────────────┘ └───────────────┘ │ │
│ │ Escolher outra viagem            │ │ link
│ └──────────────────────────────────┘ │
│                                      │
│ Hoje, 12:18 · Foi em outro dia?      │ 14 cinza + link
│                                      │
│ ▸ Mais detalhes (onde foi, observação)│ linha 56 px, recolhida
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ ✓  Salvar gasto                  │ │ laranja, 80 px
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

Toques: card (1) → Alimentação (2) → foto/valor → **Salvar gasto (3)**.

### 5.2 Borracharia (foto: exige · o que foi feito: obrigatório · placa: obrigatória · é manutenção)

```
┌──────────────────────────────────────┐
│ ←  Borracharia                       │
├──────────────────────────────────────┤
│ ┌ [foto do recibo, miniatura 96px] ┐ │ depois de fotografar:
│ │  Foto guardada       Tirar outra │ │ miniatura + verde "Foto guardada"
│ └──────────────────────────────────┘ │ + link "Tirar outra"
│                                      │
│ Valor                                │
│ ┌──────────────────────────────────┐ │
│ │ R$ 120,00                        │ │
│ └──────────────────────────────────┘ │
│                                      │
│ O que foi feito?                     │ rótulo vem do painel
│ ┌──────────────────────────────────┐ │ 2 linhas
│ │ ex.: remendo no pneu traseiro    │ │ placeholder vem do painel
│ └──────────────────────────────────┘ │
│                                      │
│ Caminhão                             │
│ ┌──────────────────────────────────┐ │ Select com busca, vazio:
│ │ Escolha a placa               ▾ │ │ "Escolha a placa"
│ └──────────────────────────────────┘ │
│ Vai pro histórico deste caminhão.    │ 13 cinza — só em tipo "é manutenção"
│                                      │
│ Foi nesta viagem?   (5.4)            │
│ Hoje, 14:32 · Foi em outro dia?      │
│ ▸ Mais detalhes (odômetro, onde foi) │
│ [ ✓  Salvar gasto ]                  │
└──────────────────────────────────────┘
```

- Placa: quando ele marca "Foi nesta viagem", o campo Caminhão é trocado pela linha fixa **"Caminhão: ABC1D23 (da viagem)"** com link "Trocar". A placa da viagem é fato da viagem, não escolha feita pelo app. Solto: Select vazio.

### 5.3 Pedágio (sistema: praça + valor)

```
┌──────────────────────────────────────┐
│ ←  Pedágio                           │
├──────────────────────────────────────┤
│ Praça do pedágio                     │
│ ┌──────────────────────────────────┐ │
│ │ ex.: Praça Reg. Norte BR-376     │ │
│ └──────────────────────────────────┘ │
│ Valor                                │
│ ┌──────────────────────────────────┐ │
│ │ R$ 0,00                          │ │
│ └──────────────────────────────────┘ │
│ Hoje, 10:12 · Foi em outro dia?      │
│ ▸ Mais detalhes (caminhão)           │ Caminhão = comportamento de hoje
│ [ ✓  Salvar pedágio ]                │ (vem com o caminhão do cadastro dele)
└──────────────────────────────────────┘
```
Sem foto e sem "Foi nesta viagem?" na Onda 1 (trava B3). Se o caminhão do cadastro estiver vazio, "Caminhão" sai de "Mais detalhes" e vira campo obrigatório visível.

### 5.4 O card "Foi nesta viagem?" (requisito C)

**Quando aparece:** tipo da empresa, ele **não** veio de dentro de uma viagem, e o celular conhece uma viagem candidata: (1) a viagem em andamento; senão (2) a viagem lançada hoje (inclusive a que ainda está guardada no celular) cujo horário cobre a hora do gasto; senão (3) a última viagem das últimas 24 h. Calculado só com o que está no celular — funciona offline.
**Quando não aparece:** sem nenhuma candidata. Aí o gasto nasce solto, sem pergunta e sem aviso.

Estados do card:
| Estado | O que mostra |
|---|---|
| Aberto (nada marcado) | Viagem sugerida + **[Foi nesta viagem]** **[Não foi nesta]** (contorno, iguais, lado a lado) + link "Escolher outra viagem" |
| Tocou "Foi nesta viagem" | Botão vira verde com ✓ "Foi nesta viagem"; o outro some; link "Desfazer" |
| Tocou "Não foi nesta" | Card troca por: "Em qual viagem foi?" + `Select` das viagens dos últimos 7 dias (vazio) + link "Não foi em viagem" |
| "Não foi em viagem" | Linha cinza: "Fora de viagem · Mudar" |
| Não respondeu e salvou | **Salva normal**, sem cobrar. O gasto entra em "Gastos sem viagem". |

**Por quê não obrigatório:** travar o Salvar por causa do vínculo prende o motorista no posto; e o gasto sem resposta não afirma nada em nome dele ("não respondeu" ≠ "disse que não foi em viagem").

### 5.5 Foto: estados e erros

| Situação | Texto na tela | Botões |
|---|---|---|
| Sem foto, tipo **pede** | quadro "Fotografar o papel" | links "Escolher da galeria" · "Não tenho o comprovante" |
| Sem foto, tipo **exige** e tocou "Não tenho o comprovante" | quadro vira campo **"O que aconteceu?"** (obrigatório), placeholder "ex.: o borracheiro não deu nota" | link "Tenho o comprovante, vou fotografar" |
| Sem foto, tipo **pede** e tocou "Não tenho" | quadro some; linha cinza "Sem comprovante · Fotografar" | — |
| Câmera sem permissão | dentro do quadro: "O celular não deixou abrir a câmera." | contorno **"Abrir ajustes do celular"** · link "Escolher da galeria" |
| Câmera fechou sem foto | volta ao quadro vazio, sem mensagem | — |
| Foto tirada | miniatura + "Foto guardada" (verde) | link "Tirar outra" |
| Foto ainda não subiu (depois de salvar) | não aparece no form; em Meus reembolsos: "Foto ainda no celular" | — |
| Foto recusada pelo servidor (4xx) | vai pros **Pendentes** como hoje: "A foto do gasto de Borracharia não subiu. Tirar de novo" | laranja **"Tirar a foto de novo"** |
| Exige foto, salvou sem foto e sem "O que aconteceu?" | validação guiada no quadro: **"Fotografe o comprovante ou conte o que aconteceu"** | — |

### 5.6 Validação (ordem visual, um por vez)
- Valor vazio/zero: **"Digite quanto você pagou"**.
- "O que foi feito?" vazio (obrigatório): **"Conte o que foi feito"** (o texto vem do rótulo do painel).
- Caminhão vazio (obrigatório): **"Escolha o caminhão"**.
- Tipo "Outro": descrição obrigatória sempre: **"Conte o que você pagou"**.
- Valor acima do teto: **não** valida nem avisa em vermelho — só a linha cinza "Devolvido até R$ 45,00…" que já está na tela.

### 5.7 [F] Aviso de possível repetido (ao tocar Salvar)

Mesmo tipo + mesmo valor + mesmo dia (dia de São Paulo), procurado no que está no celular (enviado e guardado). Não bloqueia. **Inline:** o botão Salvar é trocado por este quadro, a tela rola até ele.

```
│ ┌──────────────────────────────────┐ │ fundo âmbar claro, borda âmbar
│ │ ⚠ Você já lançou um pedágio de   │ │ 17 semibold
│ │   R$ 12,40 hoje às 10:12.        │ │
│ │   É outro?                       │ │
│ │                                  │ │
│ │ ┌──────────────────────────────┐ │ │ AMARELO 64 px (cuidado: pode duplicar)
│ │ │  É outro — salvar este       │ │ │
│ │ └──────────────────────────────┘ │ │
│ │ ┌──────────────────────────────┐ │ │ CONTORNO 56 px
│ │ │  É o mesmo — não salvar      │ │ │
│ │ └──────────────────────────────┘ │ │
│ └──────────────────────────────────┘ │
```
- Para tipo da empresa: "Você já lançou **Alimentação** de R$ 38,00 hoje às 12:05. É outro?"
- Mais de um igual: "Você já lançou 2 pedágios de R$ 12,40 hoje (10:12 e 11:40). É outro?"
- "É o mesmo — não salvar" volta pra tela anterior sem gravar (o lançado antes continua). "É outro" salva e o escritório vê na fila o ponto "Ele confirmou que é outro".
- Empilhado: ação principal em cima (padrão de botões).

### 5.8 Depois de salvar
Volta pra tela de onde veio (Início ou viagem) com faixa verde inline no topo, 4 s:
- Com sinal: **"Gasto enviado pro escritório."** · link "Lançar outro"
- Sem sinal: **"Gasto guardado. Vai pro escritório quando tiver sinal."** · link "Lançar outro"
Nunca diz "enviado" se está só no celular.

---

## 6. [D] App — "Gastos desta viagem" dentro da viagem

Aparece em três lugares, com o **mesmo componente compacto**:
- **Viagem guiada (em andamento):** abaixo dos botões de evento.
- **Finalizar viagem:** depois de "Pedágio (R$)" e antes de "Observação".
- **Lançar viagem feita:** no mesmo ponto (depois de Pedágio, antes de Observação). O gasto leva o código da viagem que ainda vai ser salva; se a viagem for descartada, os gastos dela viram "sem viagem" (nunca somem). *Dependência pro arquiteto: vínculo por `clientId` da viagem.*

**Por quê compacto:** a tela de finalizar já é longa (descarga, material, km, ticket, foto, toneladas, assinatura). O bloco ocupa uma linha quando fechado e nunca é obrigatório.

```
Fechado, sem gastos (1 linha, 64 px):
│ ┌──────────────────────────────────┐ │
│ │ Gastos desta viagem   + Adicionar│ │ título 16 semibold · botão contorno pequeno
│ └──────────────────────────────────┘ │ ("+ Adicionar gasto" se couber)

Fechado, com gastos:
│ ┌──────────────────────────────────┐ │
│ │ Gastos desta viagem        2 · ▸ │ │
│ │ R$ 158,00                        │ │ 18 bold
│ │ ┌──────────────────────────────┐ │ │
│ │ │ + Adicionar gasto            │ │ │ contorno, 56 px
│ │ └──────────────────────────────┘ │ │
│ └──────────────────────────────────┘ │

Aberto (toque no ▸):
│ │ [🛞] Borracharia      R$ 120,00 │ │ linhas 56 px; toque abre o
│ │      14:32 · Guardado no celular│ │ formulário pra corrigir
│ │ [🍽] Alimentação       R$ 38,00 │ │
│ │      12:18 · Com o escritório   │ │
```

- "+ Adicionar gasto" abre [A] com título **"Gasto desta viagem"**, só com os **tipos da empresa** (sem Pedágio — já é o campo acima; sem Abastecimento — não tem viagem). Rodapé da lista: "Pedágio desta viagem: use o campo Pedágio da tela anterior."
- No formulário vindo daqui, o card "Foi nesta viagem?" é trocado pela linha fixa no topo **"Viagem: Pedreira Bela Vista → Arena"** — ele tocou dentro da viagem, o vínculo é dele, não do app.
- Abre como tela empilhada (navegação), não como `Modal`: o formulário da viagem fica preservado embaixo e nenhum aviso abre atrás.
- **Pergunta-ponte ao finalizar:** se existem gastos **sem viagem** do mesmo dia, aparece dentro do bloco, uma vez: "Você tem 2 gastos de hoje sem viagem (R$ 61,90). São desta?" + contorno **"Ver e ligar"** (abre [C2] filtrado no dia). Nunca liga sozinho.

---

## 7. [C2] App — "Gastos sem viagem"

Entra por: linha "2 gastos sem viagem · Ligar ›" (Início), topo de Meus reembolsos, pergunta-ponte do Finalizar.
Lista só os que ficaram **sem resposta**. Quem respondeu "Não foi em viagem" não aparece (não insistir).

**Por quê agrupado pela viagem sugerida:** o lote vira natural — "esses três são desta viagem" é um toque, sem modo de seleção.

```
┌──────────────────────────────────────┐
│ ←  Gastos sem viagem                 │
├──────────────────────────────────────┤
│ Diga de qual viagem foi cada gasto.  │ 14 cinza
│ Isso ajuda o escritório a conferir.  │
│                                      │
│ PARECEM DA VIAGEM                    │ 12 caixa alta cinza
│ ┌──────────────────────────────────┐ │
│ │ Pedreira Bela Vista → Arena      │ │ 16 bold
│ │ hoje · 06:40 às 15:10            │ │
│ │ ──────────────────────────────── │ │
│ │ [🛞] Borracharia 14:32  R$ 120,00│ │
│ │ [🍽] Alimentação 12:18   R$ 38,00│ │
│ │ ──────────────────────────────── │ │
│ │ ┌──────────────────────────────┐ │ │ LARANJA 56 px (rotina)
│ │ │ Ligar os 2 a esta viagem     │ │ │
│ │ └──────────────────────────────┘ │ │
│ │ Escolher um por um               │ │ link
│ └──────────────────────────────────┘ │
│                                      │
│ SEM VIAGEM PARECIDA                  │
│ ┌──────────────────────────────────┐ │
│ │ [🛏] Pernoite · 02/10   R$ 90,00 │ │
│ │ ┌───────────────┐ ┌────────────┐ │ │ contorno · contorno
│ │ │Escolher viagem│ │Não foi em  │ │ │
│ │ │               │ │viagem      │ │ │
│ │ └───────────────┘ └────────────┘ │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

- **"Escolher um por um"**: cada linha ganha os botões "Ligar a esta" (laranja pequeno) e "Outra viagem" (contorno).
- **"Escolher viagem"** abre uma folha com `Select` com busca das viagens dos últimos 15 dias (vazio). Mostrar "05/10 · Pedreira → Arena · ABC1D23".
- Depois de ligar: faixa verde "2 gastos ligados à viagem Pedreira → Arena." · link "Desfazer" (10 s).
- Ligar funciona offline (vai pela fila do celular).
- Gasto que já entrou em acerto fechado sai desta lista (não tem mais o que mudar).
- **Vazio:** "Todos os seus gastos estão com a viagem certa." + link "Voltar pros reembolsos".

---

## 8. [E] App — "Meus reembolsos"

Entra por: card "Pra receber de volta" (Início), Perfil → "Meus reembolsos" (ao lado de "Meus acertos"), rodapé de [A].
**Por quê "pra receber de volta" e não "a empresa me deve":** é o dinheiro dele voltando, sem tom de dívida nem de cobrança.

```
┌──────────────────────────────────────┐
│ ←  Meus reembolsos                   │
├──────────────────────────────────────┤
│ Pra receber de volta                 │ 14 semibold cinza
│ R$ 312,40                            │ 32 bold
│ ● R$ 240,00 aprovado — entra no      │ 15, bolinha verde
│   próximo acerto                     │
│ ● R$ 72,40 com o escritório          │ 15, bolinha azul-clara
│                                      │
│ ┌──────────────────────────────────┐ │ só se houver; fundo azul-claro
│ │ 2 gastos sem viagem  Ligar agora ›│ │
│ └──────────────────────────────────┘ │
│                                      │
│ [ Pra receber ] [ Todos ]            │ 2 abas de texto (não botões grandes);
│                                      │ abre em "Pra receber"
│ OUTUBRO                              │
│ ┌──────────────────────────────────┐ │
│ │ [🛞] Borracharia      R$ 120,00  │ │ 72 px por item, toque abre [E2]
│ │ hoje · Pedreira → Arena          │ │
│ │ ○ Guardado no celular            │ │ cinza
│ ├──────────────────────────────────┤ │
│ │ [🍽] Alimentação        R$ 38,00  │ │
│ │ ontem · sem viagem               │ │
│ │ ● Com o escritório               │ │ azul-claro
│ ├──────────────────────────────────┤ │
│ │ [🛏] Pernoite           R$ 90,00  │ │
│ │ 02/10 · sem comprovante          │ │ cinza, informativo
│ │ ● Aprovado — entra no próximo    │ │ verde
│ │   acerto                         │ │
│ ├──────────────────────────────────┤ │
│ │ [🅿] Estacionamento     R$ 58,00  │ │
│ │ 01/10                            │ │
│ │ ▲ Aprovado R$ 50,00              │ │ âmbar
│ │   "No papel está R$ 50,00"  ›    │ │ motivo do escritório, itálico
│ ├──────────────────────────────────┤ │
│ │ [🍽] Alimentação        R$ 45,00  │ │
│ │ 28/09                            │ │
│ │ ▲ Não vai ser reembolsado        │ │ âmbar, NUNCA vermelho
│ │   "Já veio no adiantamento"  ›   │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

Status (texto exato, cor, entra no "pra receber"?):
| Situação | Texto | Cor | Soma? |
|---|---|---|---|
| Só no celular | **Guardado no celular** | cinza | sim |
| Foto ainda não subiu | **Foto ainda no celular** | cinza | sim |
| Esperando conferência | **Com o escritório** | azul-claro | sim |
| Aprovado | **Aprovado — entra no próximo acerto** | verde | sim |
| Aprovado com outro valor | **Aprovado R$ 50,00** + motivo | âmbar | sim (o aprovado) |
| Entrou em acerto | **No acerto de 15/10** | verde | não (aba Todos) |
| Pago | **Pago em 18/10** | verde | não (aba Todos) |
| Não devolve | **Não vai ser reembolsado** + motivo | âmbar | não |
| Tipo "por sua conta" | **Por sua conta** | cinza | não |
| Registrado (CLT) aprovado | **Aprovado — o escritório paga fora do acerto** | verde | sim |
| Pedágio / Abastecimento | o status que já existe hoje no acerto (No acerto de…/Pago em…) | — | segue a regra de hoje |

Estados da tela:
- **Vazio:** ícone de recibo + "Nenhum gasto por aqui ainda." + "Pagou alguma coisa na estrada? Lance com a foto do papel e ele volta pra você no acerto." + laranja **"Lançar gasto de viagem"** (só se tiver `app.despesa.lancar`).
- **Offline:** lista do cache + "Atualizado às 09:40" embaixo do número. Nada some.
- **Erro ao carregar sem cache:** "Não deu pra carregar agora. Seus gastos guardados no celular estão seguros." + contorno **"Tentar de novo"**.

### [E2] Detalhe do gasto

```
┌──────────────────────────────────────┐
│ ←  Borracharia                       │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │ foto 240 px; toque abre em tela cheia
│ │        (foto do recibo)          │ │ com zoom (na própria tela)
│ └──────────────────────────────────┘ │
│ R$ 120,00                            │ 28 bold
│ ● Com o escritório                   │
│                                      │
│ Quando     hoje, 14:32               │ pares rótulo/valor 15
│ Viagem     Pedreira → Arena · Trocar │
│ Caminhão   ABC1D23                   │
│ O que foi  remendo no pneu traseiro  │
│                                      │
│ CONVERSA                             │ só se o escritório escreveu
│ Escritório · 05/10 16:02             │
│ "No papel está R$ 102,00."           │
│ ┌──────────────────────────────────┐ │
│ │ Escreva sua resposta             │ │
│ └──────────────────────────────────┘ │
│ [ Enviar resposta ]                  │ laranja 56 px
│                                      │
│ [ Corrigir gasto ]                   │ laranja 80 px — só Guardado/Com o escritório
│ Apagar este gasto                    │ link vermelho, discreto
└──────────────────────────────────────┘
```
- "Apagar este gasto" → confirmação inline no lugar dos botões: "Apagar o gasto de Borracharia de R$ 120,00? Ele sai do escritório também." + vermelho **"Apagar gasto"** (em cima) + contorno **"Manter"**.
- Depois que o escritório decidiu: sem "Corrigir"/"Apagar"; aparece "Pra mudar, responda acima." (resposta vira conversa no item).

---

## 9. [G] Painel — Gastos de viagem › Tipos de gasto

Menu: **Lançamentos › Gastos de viagem**, abas **Conferir · Todos · Tipos de gasto** (uma permissão por aba).
**Por quê com prévia ao vivo:** quem configura não é quem usa; ver o celular mudando ao ligar um campo responde "o que o motorista vai ver?" sem precisar instalar o app.

### 9.1 Layout (1440 × 900)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Gastos de viagem          Conferir (14)    Todos    [Tipos de gasto]                                       │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Seus motoristas pagam gastos com cartão da empresa?  [ Não ▾ ]                                             │
│ Se sim, o celular pergunta "Pagou como?" e gasto no cartão não vira reembolso.                             │
├───────────────────────────┬────────────────────────────────────────────────┬───────────────────────────────┤
│ TIPOS (na ordem do celular)│ Borracharia                                   │ Como fica no celular          │
│                           │                                                │ [Formulário ▾]               │
│ JÁ VÊM NO APP             │ Nome            [ Borracharia            ]     │ ┌───────────────────────────┐ │
│  🛣 Pedágio               │ Ícone           [ 🛞 Pneu              ▾ ]     │ │ ← Borracharia             │ │
│  ⛽ Abastecimento          │ Aparece no app  (●) Ligado                    │ │ ┌───────────────────────┐ │ │
│                           │                                                │ │ │ 📷 Fotografar o papel │ │ │
│ DA SUA EMPRESA            │ O QUE O CELULAR PEDE                           │ │ └───────────────────────┘ │ │
│ ⋮⋮ 🍽 Alimentação     ↑↓  │ Foto do comprovante  [ Exige            ▾ ]    │ │ Não tenho o comprovante   │ │
│ ⋮⋮ 🛞 Borracharia  ◀  ↑↓  │   Sem foto, ele precisa contar o que houve.    │ │ Valor                     │ │
│ ⋮⋮ 📦 Chapa/descarga  ↑↓  │ Valor                 Sempre                   │ │ [ R$ 0,00             ]   │ │
│ ⋮⋮ 🛏 Pernoite        ↑↓  │ O que foi feito       [ Obrigatório     ▾ ]    │ │ O que foi feito?          │ │
│ ⋮⋮ 🧽 Lavagem         ↑↓  │   Pergunta [ O que foi feito?          ]       │ │ [ ex.: remendo no pneu ]  │ │
│    Por sua conta          │   Exemplo  [ ex.: remendo no pneu       ]      │ │ Caminhão                  │ │
│ ⋮⋮ 🅿 Estacionamento  ↑↓  │ Caminhão (placa)      [ Obrigatório  🔒 ]      │ │ [ Escolha a placa   ▾ ]   │ │
│ ⋮⋮ ••• Outro          ↑↓  │   Obrigatório porque é manutenção.             │ │ Foi nesta viagem?         │ │
│                           │ Litros                [ Não aparece     ▾ ]    │ │ ▸ Mais detalhes           │ │
│ DESLIGADOS                │ Odômetro              [ Opcional        ▾ ]    │ │   (odômetro, onde foi)    │ │
│    Balsa                  │ Onde foi              [ Opcional        ▾ ]    │ │ [   Salvar gasto      ]   │ │
│                           │ Opcional fica em "Mais detalhes" no celular.   │ └───────────────────────────┘ │
│ [ + Novo tipo de gasto ]  │                                                │ O que muda aqui aparece no    │
│                           │ REGRAS                                         │ celular na próxima vez que o  │
│                           │ (●) Devolve ao motorista                       │ motorista tiver sinal.        │
│                           │ Aprova sozinho até   R$ [        ]             │                               │
│                           │   Vazio = o escritório confere todos.          │                               │
│                           │ Devolve no máximo    R$ [ 300,00 ] por gasto   │                               │
│                           │   Acima disso, chega pra você com o aviso.     │                               │
│                           │ (●) Também é manutenção do caminhão            │                               │
│                           │   Aprovado, vira item no histórico do veículo. │                               │
│                           │ ( ) Pode ser cobrado do cliente                │                               │
│                           │   Fica marcado na lista pra entrar na fatura.  │                               │
│                           │                                                │                               │
│                           │ [Desativar tipo]          [Cancelar] [Salvar]  │                               │
│                           │   amarelo                  contorno    azul    │                               │
└───────────────────────────┴────────────────────────────────────────────────┴───────────────────────────────┘
```

Colunas: 300 px · flexível · 340 px (o celular da prévia em escala 0,8 de 390 × 844). Na faixa 1024–1535 a lista de tipos vira um `Select` "Tipo: Borracharia ▾" acima do editor e a prévia fica à direita; abaixo de 1024 a prévia vai pra baixo do editor.

### 9.2 Texto e comportamento de cada controle

**Por quê `Select` e não botões segmentados nos campos:** é a escolha que o dono pediu pra seleção (dropdown), e cabe numa linha por campo.

| Controle | Opções / formato | Ajuda (cinza 13) |
|---|---|---|
| Foto do comprovante | **Não pede · Pede · Exige** | Não pede: "O celular nem mostra a câmera." · Pede: "Ele fotografa se tiver o papel." · Exige: "Sem foto, ele precisa contar o que houve." |
| Valor | fixo "Sempre" (texto, sem controle) | — |
| O que foi feito (descrição) | **Não aparece · Opcional · Obrigatório** + "Pergunta" e "Exemplo" editáveis | — |
| Caminhão (placa) | **Não aparece · Opcional · Obrigatório** | se "manutenção" ligado: travado em Obrigatório, cadeado + "Obrigatório porque é manutenção." |
| Litros | idem | — |
| Odômetro | idem | — |
| Onde foi | idem | "O celular preenche pelo GPS; ele pode trocar." |
| Regra visível sob os campos | — | **"Opcional fica em 'Mais detalhes' no celular."** |
| Devolve ao motorista | interruptor | Desligado: "No celular aparece 'Por sua conta'. Vira só custo do caminhão." |
| Aprova sozinho até | R$, vazio por padrão | "Vazio = o escritório confere todos." Dica da squad: "Comum: R$ 40 em alimentação." |
| Devolve no máximo | R$ por gasto, vazio por padrão | "Acima disso, chega pra você com o aviso. O motorista vê esse limite no celular." |
| Também é manutenção do caminhão | interruptor | "Aprovado, vira item no histórico do veículo." Ligar trava Caminhão em Obrigatório e liga "O que foi feito" em Obrigatório (pode afrouxar pra Opcional). |
| Pode ser cobrado do cliente | interruptor | "Fica marcado na lista pra entrar na fatura." *(Cobrança na fatura = Onda 4; até lá, só a marca e o filtro em Todos.)* |

- **Tipos "Já vêm no app" (Pedágio, Abastecimento):** clicar mostra no editor só texto: "Os campos do pedágio são os de sempre (praça e valor). Quem decide se devolve é a modalidade de cada motorista." + link "Abrir modalidades". "Aparece no app" mostra o estado e leva a "Acesso ao app" (link) — **um interruptor só no sistema** pra não ter dois lugares que se contradizem. Não arrastam: ficam sempre em cima no celular.
- **"Outro"** não pode ser desativado nem apagado (é a válvula); descrição travada em Obrigatório com ajuda "No 'Outro', ele sempre conta o que pagou."
- **Novo tipo de gasto** (azul): cria "Novo tipo" em edição, com Foto = Pede, Devolve = ligado, demais campos "Não aparece". Entra antes do "Outro".
- **Desativar tipo** (amarelo): "O tipo sai do celular. Os gastos já lançados continuam." **Apagar** (vermelho) só aparece em tipo sem nenhum gasto lançado, com confirmação inline "Apagar o tipo Balsa?" + vermelho **"Apagar tipo"** · contorno **"Manter"**.
- Mudou algo e tentou trocar de tipo sem salvar: faixa âmbar no topo do editor "Você mudou a Borracharia e não salvou." + **"Salvar"** (azul) · **"Descartar mudanças"** (vermelho) — inline, sem diálogo.
- Prévia: `Select` "Formulário / Lista de tipos". "Lista de tipos" mostra [A] exatamente como o motorista vê, na ordem atual, refletindo "Por sua conta" e desligados. Atualiza a cada mudança, **antes** de salvar, com etiqueta "Prévia — ainda não salvo" enquanto há mudança pendente.
- Salvo: toast "Borracharia salvo. Os celulares recebem na próxima conexão."

---

## 10. [H] Painel — Gastos de viagem › Conferir

**Por quê mestre-detalhe com a foto grande:** quem confere olha a foto e o valor juntos, dezenas de vezes seguidas; trocar de tela ou abrir aba nova quebra o ritmo (`feedback_imagem_nunca_em_aba_nova`).

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Gastos de viagem          [Conferir (14)]    Todos    Tipos de gasto                                       │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Motorista ▾] [Tipo ▾] [Período: Hoje e antes ▾]  ☐ Só sem ponto de atenção                               │
│ ☐ Selecionar os 9 sem ponto de atenção                              [ ✓ Aprovar 9 selecionados ] verde    │
├────────────────────────────────────────┬───────────────────────────────────────────────────────────────────┤
│ HOJE                                   │ Borracharia · Carlos Souza · ABC1D23              1 de 14  ↑ ↓    │
│ ☑ Carlos Souza · ABC1D23               │ 05/10 14:32 · lançado pelo app · chegou 14:40                     │
│   🍽 Alimentação          R$ 38,00     │ ┌─────────────────────────────────────┐  Lançado                  │
│ ☐ ▶ Carlos Souza · ABC1D23             │ │                                     │  R$ 120,00                │
│   🛞 Borracharia         R$ 120,00  ⚠2 │ │                                     │  (26 px bold)             │
│ ☑ João Lima · DEF4G56                  │ │         (foto do recibo,            │                           │
│   🛣 Pedágio              R$ 24,90     │ │          520 × 560, ajusta)          │  O que foi feito          │
│ ☐ Ana Prado · GHI7J89                  │ │                                     │  "remendo no pneu         │
│   🛏 Pernoite             R$ 90,00  ⚠1 │ │  [⟲ Girar] [+ −]  clique = ampliar  │   traseiro"               │
│ ONTEM                                  │ └─────────────────────────────────────┘  Caminhão ABC1D23         │
│ ☑ …                                    │                                          Odômetro 412.330         │
│                                        │ SUGESTÕES (ninguém decidiu ainda)                                 │
│                                        │ ┌───────────────────────────────────────────────────────────────┐ │
│                                        │ │ ⚠ Leitura da foto (sugestão): no papel aparece R$ 102,00.     │ │
│                                        │ │   Lançado R$ 120,00.            [Usar R$ 102,00 como valor]   │ │
│                                        │ ├───────────────────────────────────────────────────────────────┤ │
│                                        │ │ ⚠ Sem viagem. Parece da viagem Pedreira → Arena               │ │
│                                        │ │   (05/10 06:40–15:10).    [Vincular a esta]  Escolher outra   │ │
│                                        │ └───────────────────────────────────────────────────────────────┘ │
│                                        │ Este mês do Carlos: 6 gastos · R$ 410,00 · 1 não reembolsado      │
│                                        │                                                                   │
│                                        │ [Não reembolsar]  [Aprovar outro valor]          [ ✓ Aprovar ]    │
│                                        │    amarelo            amarelo                       verde         │
│                                        │ Atalhos: A aprova · ↓ próximo · ↑ anterior · N não reembolsar     │
└────────────────────────────────────────┴───────────────────────────────────────────────────────────────────┘
```

Colunas: lista 420 px · detalhe flexível. Na faixa 1024–1535 a foto vai pra cima dos dados (detalhe em uma coluna), lista continua à esquerda; abaixo disso, lista e detalhe viram telas separadas com "← Voltar à fila".

### 10.1 Pontos de atenção (o ⚠ da lista é a contagem)
Cada um é uma linha de texto com, quando cabe, um botão que **só preenche** — nada é decidido sozinho:
| Ponto | Texto | Botão |
|---|---|---|
| Leitura da foto (sugestão) | "Leitura da foto (sugestão): no papel aparece R$ 102,00. Lançado R$ 120,00." | **"Usar R$ 102,00 como valor"** (contorno) — abre o "Aprovar outro valor" já com 102,00 e motivo sugerido "No papel está R$ 102,00", editável |
| Leitura não achou valor | "A leitura não achou valor no papel." (nunca "confere") | — |
| Sem comprovante | "Sem comprovante. Ele escreveu: 'o borracheiro não deu nota'." | — |
| Foto ainda não chegou | "A foto ainda está no celular do motorista." | — |
| Acima do máximo | "Acima do máximo do tipo (R$ 300,00)." | **"Aprovar R$ 300,00"** (contorno) — abre o "Aprovar outro valor" preenchido |
| Possível repetido | "Parecido com Pedágio R$ 12,40 de hoje 10:12 (ver). Ele confirmou no celular que é outro." | link "ver" abre o outro no detalhe |
| Sem viagem | "Sem viagem. Parece da viagem Pedreira → Arena (05/10 06:40–15:10)." | **"Vincular a esta"** (azul) · link "Escolher outra" (combobox das viagens do motorista ±1 dia) |
| Pago no cartão da empresa | "Pago no cartão da empresa — aprovar não vira reembolso, só custo do caminhão." | — |

### 10.2 Ações
- **Aprovar** (verde, `A`): aprova e pula pro próximo; toast "Aprovado. Próximo: João Lima · Pedágio" com "Desfazer" (8 s).
- **Aprovar outro valor** (amarelo): expande inline abaixo dos botões: "Valor aprovado R$ [   ]" + "Motivo (o motorista vai ler)" [obrigatório] + contorno **"Cancelar"** · verde **"Aprovar R$ 102,00"** (o rótulo acompanha o valor). O valor lançado fica guardado e aparece riscado no histórico.
- **Não reembolsar** (amarelo, `N`): expande inline: "Motivo (o motorista vai ler)" [obrigatório, com 3 atalhos de texto: "Já veio no adiantamento" · "Não é gasto de viagem" · "Comprovante não é deste gasto"] + contorno **"Cancelar"** · amarelo **"Não reembolsar"**. Nunca vermelho: não apaga nada e o motorista pode responder.
- **Vincular viagem** não aprova nada; pode ser feito em qualquer status até o acerto fechar.
- **Lote:** só itens **sem ponto de atenção** têm caixa de seleção; a caixa dos outros fica cinza com dica ao passar o mouse "Tem ponto de atenção — confira um por um". "Selecionar os 9 sem ponto de atenção" marca todos os elegíveis do filtro. **"Aprovar 9 selecionados"** (verde) → confirmação inline na barra: "Aprovar 9 gastos, R$ 412,30 no total?" + contorno **"Voltar"** · verde **"Aprovar 9 gastos"**.
- Resposta do motorista chegou: a linha da fila ganha "💬 respondeu" e o detalhe mostra a conversa acima dos botões.

### 10.3 Estados
- **Fila vazia:** "Nada pra conferir. Os gastos novos aparecem aqui assim que o celular do motorista pegar sinal." + link "Ver todos os gastos".
- **Filtro sem resultado:** "Nenhum gasto com esses filtros." + link "Limpar filtros".
- **Foto não abriu:** dentro do quadro: "Não deu pra abrir a foto." + contorno **"Tentar de novo"**.
- **Leitura da foto ainda rodando:** linha cinza "Lendo a foto…" (nunca segura a aprovação).
- **Empresa sem o módulo Conferência:** a linha de leitura da foto não aparece (nem desligada).
- **Alguém aprovou em outra aba/pessoa:** ao agir, faixa âmbar "Este gasto já foi decidido por Marta às 15:02." e a fila atualiza.

### 10.4 Onde aparece fora da fila (resumo, igual a `04-ux.md` §5)
- **Ficha da viagem:** cartão "Gastos desta viagem" — tipo, valor, status, miniatura (abre o visualizador na própria tela), total. Botão "Vincular gasto sem viagem" (combobox dos soltos do motorista no dia).
- **Acerto:** linha "Reembolso de gastos (5) — R$ 240,00", expansível com miniatura; embaixo, se houver: "2 gastos ainda em conferência (R$ 72,40) não entram neste acerto — Conferir agora →".
- **Veículo (manutenção):** gasto aprovado de tipo "é manutenção" aparece no histórico do veículo como "Borracharia · R$ 120,00 · remendo no pneu traseiro · lançado por Carlos" com a foto.
- **Aba Todos:** tabela com filtros (motorista, caminhão, tipo, período, status, "pode ser cobrado do cliente"), exportar. Pedágio avulso aparece só pra leitura.

---

## 11. Checklist do protótipo (o que tem que ser clicável)

1. Início → card "Gasto de viagem" → [A] → Alimentação → tirar foto (simulada) → valor → Salvar → faixa verde (alternar online/offline num botão do protótipo).
2. [A] → Borracharia → card "Foi nesta viagem?" nos 4 estados → Salvar sem responder → aparece em Gastos sem viagem.
3. [A] → Pedágio R$ 12,40 → Salvar → [A] → Pedágio R$ 12,40 → **aviso de repetido** nos dois caminhos.
4. Foto: permissão negada; exige foto sem foto → validação guiada; "Não tenho o comprovante".
5. Finalizar viagem → seção "Gastos desta viagem" fechada/aberta → "+ Adicionar gasto" → volta com o gasto na lista → pergunta-ponte dos soltos.
6. Gastos sem viagem → "Ligar os 2 a esta viagem" → Desfazer.
7. Meus reembolsos → os 9 status → detalhe → Responder / Corrigir / Apagar (confirmação inline).
8. Painel Tipos de gasto → mudar Foto/campos/manutenção e ver a prévia mudar; trocar prévia pra "Lista de tipos"; desativar tipo.
9. Painel Conferir → navegar com ↑↓ → "Usar R$ 102,00 como valor" → aprovar outro valor; "Vincular a esta"; selecionar os 9 e aprovar em lote; fila vazia.

## 12. Pendências que não são de tela (pro arquiteto/financeiro)
- Vínculo do gasto com a viagem **ainda não salva** (Lançar viagem feita / Finalizar offline): referência pelo `clientId` da viagem.
- Separar no banco "sem resposta" de "não foi em viagem" (a tela Gastos sem viagem depende disso).
- Campos por tipo (estado Não aparece/Opcional/Obrigatório, pergunta e exemplo da descrição) em `CategoriaDespesa` + no `/m/catalogos` (offline).
- "Teto" (devolve no máximo) é um segundo número além do "aprova sozinho" — a proposta tinha um só; o dono pediu os dois.
- "É manutenção": gasto aprovado gera item no histórico do veículo (módulo Manutenção) — sem duplicar com a OS lançada à mão (R8).
- "Ele confirmou que é outro" (aviso de repetido) precisa ir no payload pra aparecer na fila.
