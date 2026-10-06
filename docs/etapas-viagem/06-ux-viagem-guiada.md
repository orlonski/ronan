# 06 — Viagem guiada com as Etapas: o que o dono reclamou e o que muda

Data: 06/10/2026. Não mexe em código: é inventário, diagnóstico e proposta com maquete
pra o dono escolher vendo.

O dono testou no celular e reclamou de três coisas:

1. "cliquei em começar viagem, aí novamente em começar viagem (aí já começa uma
   confusão, porque o mesmo nome de botão)"
2. "foi pra tela de viagem em andamento e já na sequência, sem clicar em nada, foi para
   a tela carregamento, como se eu tivesse clicado em continuar documentos [...] dá tipo
   um pisque na tela"
3. "a tela de viagem em andamento não segue um layout padrão, aquele botão de finalizar
   viagem dá a impressão que é gigante, e aquela parte de baixo 'deu problema' os botões
   são tipo largados, sem padrão no tamanho deles"

---

## 1. Como está hoje (inventário do código)

Caminho: `apps/motorista-app/`.

### 1.1 Os "Começar viagem"

| Onde | arquivo:linha | O que é |
|---|---|---|
| Home, cartão herói laranja | `app/(tabs)/index.tsx:569-590` | `Pressable` → `router.push("/iniciar-viagem")`. Título "Começar viagem", subtítulo "O app acompanha: carga → descarga → fim" |
| Tela seguinte, título | `app/iniciar-viagem.tsx:194` | `<ScreenHeader title="Começar viagem" />` |
| Tela seguinte, botão final | `app/iniciar-viagem.tsx:321-327` | `<Button size="lg" className="h-20">` laranja, texto `text-xl` "Começar viagem" (carregando: "Abrindo...") |
| Aviso de lançamento | `components/anuncio-iniciar-viagem.tsx:60` | "Agora tem o **Começar viagem**" |

São três "Começar viagem" seguidos: cartão da home → título → botão. O motorista
toca no mesmo nome duas vezes e não sabe se o primeiro toque "pegou".

Perto disso ainda moram outros dois nomes parecidos, que não podem ser reaproveitados:
"Iniciar viagem com GPS" na home (`index.tsx:656`, rastreio de km, outra coisa) e
"Iniciar viagem" na navegação por voz (`app/viagem-andamento.tsx:489`).

### 1.2 Por que pisca: a navegação até "Documentos da carga"

Sequência do código, do toque até o pisca:

1. `iniciar-viagem.tsx:125` grava a viagem (`iniciarViagemGuiada`); `:161` grava os
   formulários (`registrarViagemComEtapas`).
2. `iniciar-viagem.tsx:170-174`: `router.replace({ pathname: "/viagem-guiada", params: { abrirEtapa: inicio.id } })`.
3. `viagem-guiada.tsx:206-216`: a tela monta com `carregando = true` e mostra
   **"Carregando viagem…"** com spinner (1º quadro).
4. `viagem-guiada.tsx:88` `useFocusEffect(recarregar)` lê o AsyncStorage → `setLocal`;
   a tela desenha **Viagem em andamento** inteira (2º quadro).
5. `viagem-guiada.tsx:91-95`: um `useEffect` vê `local` + `params.abrirEtapa` e chama
   `abrirEtapa(...)` → `components/etapas/cartao-etapas-viagem.tsx:10`
   `router.push({ pathname: "/etapa", ... })`. A tela de documentos entra deslizando
   por cima (3º quadro).

São três telas em menos de um segundo, sendo duas que ele não pediu: replace +
push disparado por efeito. O botão do cartão que ele achou ter sido tocado é o mesmo
`abrirEtapa` (rótulo "Abrir documentos"/"Continuar documentos", `cartao-etapas-viagem.tsx:58-63`).
Por isso ele achou que tinha tocado em "Continuar documentos".

No fim da viagem tem o mesmo problema, mais um pop-up:
`finalizar-viagem.tsx:660-667` abre `showAlert("Viagem finalizada!")`. Depois do "OK"
vai `router.replace("/etapa")` para os documentos da descarga, sem ele pedir. E a tela
repete o nome: o botão na viagem em andamento é "Finalizar viagem"
(`viagem-guiada.tsx:404`), o título é "Finalizar viagem" (`finalizar-viagem.tsx:688`) e o
botão final também (`:1053`). É a mesma reclamação 1, só que no fim da viagem.

### 1.3 Como a tela "Viagem em andamento" está montada (`app/viagem-guiada.tsx`)

Ordem de cima pra baixo:

| # | Bloco | Linhas | Como está |
|---|---|---|---|
| 1 | Cabeçalho azul "Viagem em andamento" | 225 | `ScreenHeader` |
| 2 | Cartão laranja com **outro** "VIAGEM EM ANDAMENTO" + placa `text-3xl` + cliente + carga + hora | 229-263 | o nome da tela aparece duas vezes |
| 3 | Croqui/autorização do pedido | 266 | `DocumentosDaViagem` |
| 4 | Ocorrências abertas (fila, quebra) com "Já resolveu" | 270-296 | `Button className="bg-success"` (cor solta, não a variante) |
| 5 | "O que já foi feito" (linha do tempo) | 299-377 | cartão, antes de qualquer ação |
| 6 | "Documentos da viagem" (cartão por formulário) | 382 | botão laranja `h-14` "Abrir/Continuar documentos" |
| 7 | **Botão principal** | 385-408 | `size="lg"` (h-16) **sobrescrito por `className="h-24"`** (96 px), texto `text-2xl font-extrabold`, três ícones (Flag + texto + ArrowRight), verde por `className="bg-success"`. É o "gigante" |
| 8 | "Outros registros" | 411-431 | `View flex-row flex-wrap gap-2` + `Button variant="outline" className="grow"`, texto "+ {nome}" **sem ícone** |
| 9 | "Deu problema?" + parágrafo de 2 linhas | 436-459 | mesmo `flex-row flex-wrap gap-2` + `grow`, `border-warning`, ícone de 16 px |
| 10 | Gastos da viagem | 463-469 | `GastosDaViagem` |
| 11 | "Descartar viagem" | 472-477 | `ghost`, confirmação por `showConfirm` (pop-up) |

**Por que os botões de baixo parecem "largados":** `flex-wrap` com `grow` faz cada botão
ter a largura do próprio texto, e a sobra da linha vai pra quem estiver nela. "Fila"
fica estreito, "Carga recusada" fica largo, e o último que sobra sozinho numa linha
estica pela tela toda. Como os nomes vêm do catálogo da empresa, cada empresa vê
uma bagunça diferente. A altura é a mesma (h-14), mas largura, alinhamento e ícone
variam de botão pra botão.

**Tamanhos do design system** (`components/ui/button.tsx:24-29`): `default` h-14
(56 px), `lg` h-16 (64 px), `sm` h-11. Hoje três telas do fluxo furam o padrão com
`className`: `iniciar-viagem.tsx:321` h-20, `viagem-guiada.tsx:388/399` h-24,
`etapa.tsx:419` h-20, `finalizar-viagem.tsx:1047` h-20. Cada tela tem um tamanho
diferente de "botão principal".

---

## 2. Diagnóstico pelo dia a dia do caminhoneiro

- **Ele está no pátio da carga, com pressa e o celular numa mão.** Dois toques no
  mesmo nome fazem ele achar que o primeiro não pegou. É assim que nasce o toque duplo
  e a dúvida "comecei duas viagens?". O nome do botão final tem que dizer o que acontece
  naquele toque: ele está confirmando a carga.
- **Tela que muda sozinha parece defeito.** Quem tem pouca intimidade com celular
  confia no que vê parado. O pisca tira dele a única confirmação de que a viagem
  começou (a tela "Viagem em andamento") e joga num formulário que ele não pediu.
  Quando ele aperta "voltar", cai numa tela que mal viu. Isso fere duas regras do dono:
  ele escolhe vendo, e nada acontece sozinho no lugar dele.
- **Botão de 96 px com letra de título grita "aperte-me".** A tela que ele vai olhar
  por horas tem como peça principal um botão de *fim*. O risco é ele finalizar sem ter
  descarregado. O tamanho tem que ser o mesmo das outras telas, que ele já conhece.
- **"Deu problema" é a hora mais tensa do dia** (fila, quebra, carga recusada). Nessa
  hora ele lê de cima pra baixo, não procura numa grade torta. Uma lista de linhas
  iguais lê como menu, e cada opção ocupa o mesmo lugar toda vez.
- **Na volta do escritório** (acerto, canhoto), ele quer achar os documentos sem
  procurar. Por isso o cartão de documentos tem que estar no topo, como próximo passo
  visível, e não aparecer de surpresa.

---

## 3. Proposta

### (a) Nomes dos botões, passo a passo

Regra: o rótulo é o verbo do que acontece naquele toque, e dois toques seguidos nunca
têm o mesmo nome.

| Passo | Tela (título) | Botão principal | Cor / tamanho / ícone |
|---|---|---|---|
| 1 | Home (sem viagem) | **Começar viagem** (cartão herói, igual hoje) | laranja · `Route` |
| 2 | Começar viagem | **Confirmar carga** (carregando: "Confirmando…") | verde `success` · `lg` · `CheckCircle2` |
| 3 | Viagem em andamento | **Preencher documentos da carga** (enquanto a carga não tiver os documentos concluídos) | laranja `default` · `lg` · `FileText` |
| 4 | Documentos da carga | **Concluir documentos** · secundário **Voltar pra viagem** | verde `success` · `lg` · `CheckCircle2` / contorno · `ArrowLeft` |
| 5 | Viagem em andamento | **Registrar descarga** (vira o principal depois dos documentos da carga) | laranja `default` · `lg` · `Flag` |
| 6 | Fim da viagem | **Finalizar viagem** | verde `success` · `lg` · `Flag` |
| 7 | Fim da viagem (estado "Viagem finalizada", na mesma tela) | **Preencher documentos da descarga** · secundário **Ir pro início** | laranja `lg` · `FileText` / contorno · `Home` |
| — | Home (com viagem aberta) | **Continuar viagem** | laranja `default` · `Route` |

Por que esses nomes:
- O título da tela 2 continua "Começar viagem": é onde ele está, o mesmo nome do cartão
  que tocou. O que muda é o **botão**, que agora diz o que ele faz ali: confirma a carga
  (placa, cliente, local, hora). Fica verde porque é confirmação.
- "Iniciar viagem" fica de fora de propósito, porque já é o nome da voz da navegação, e
  "Iniciar viagem com GPS" é outra função.
- "Finalizar viagem" sai da viagem em andamento. Lá o toque **abre o formulário da
  descarga**, então o nome é "Registrar descarga". "Finalizar viagem" fica só onde a
  viagem de fato acaba. Assim o par repetido do fim some também.
- Se a empresa cadastrar no catálogo um tipo obrigatório chamado "Descarga", o botão
  gerado sai "Registrar Descarga" e colide com o passo 5. Isso tem que ser conferido no
  catálogo antes de ligar.

### (b) Sem pisca: chegar na viagem em andamento com o convite "Documentos da carga"

**Recomendação: depois de "Confirmar carga", ele cai na "Viagem em andamento" e a tela
fica parada.** No topo aparece um cartão "Agora" com os documentos da carga, e o
botão principal da tela é "Preencher documentos da carga". Ele toca quando quiser.

Por que essa e não "ir direto pros documentos":
- **Ele vê que a viagem começou.** A faixa verde "Viagem começou às 10:12" é a resposta
  ao toque. Ir direto pros documentos esconde essa confirmação. É exatamente o que
  ele reclamou: "sem clicar em nada".
- **Uma tela por toque.** "Confirmar carga" leva a uma tela só. Sem `push` disparado por
  efeito não existe o terceiro quadro, então não pisca.
- **O "voltar" faz sentido.** Dos documentos, "Voltar pra viagem" cai numa tela que ele
  já viu. Se fosse direto, o voltar levaria pra home ou exigiria uma pilha montada à mão.
- **A empresa continua mandando.** O cartão é a primeira coisa da tela e o botão grande
  é dele. O que é "não siga sem este" continua garantido pela barreira na próxima
  ação. Custa um toque a mais e tira uma surpresa.
- **Mesma regra no fim:** depois de "Finalizar viagem" sai o pop-up "Viagem finalizada!"
  e sai o salto automático pros documentos da descarga. A própria tela vira o estado
  "Viagem finalizada", com o convite "Preencher documentos da descarga" e "Ir pro
  início". É confirmação inline, sem pop-up.

O que muda no código (pra quem for implementar):
- `iniciar-viagem.tsx:170-174`: `router.replace("/viagem-guiada", { iniciou: "1" })`,
  sem `abrirEtapa`.
- `viagem-guiada.tsx:60-62` e `:90-95`: remover o efeito que dá push. O param `iniciou`
  só liga a faixa "Viagem começou às HH:MM". Pra reduzir o 1º quadro (spinner), basta
  a tela já nascer com o espelho que o `iniciar` acabou de gravar.
- `finalizar-viagem.tsx:660-667`: tirar `showAlert` e `router.replace("/etapa")`; virar
  estado "finalizada" na própria tela.

### (c) A tela "Viagem em andamento": hierarquia e padrão

**Regras:**
1. **Um botão principal por tela, sempre no mesmo lugar e sempre `lg` (h-16, texto
   `text-lg`).** Nada de `className="h-24"` nem `text-2xl`. Um ícone à esquerda, sem a
   seta extra. Vale pro fluxo inteiro: os `h-20` de `iniciar-viagem`, `etapa` e
   `finalizar-viagem` também voltam pra `lg`.
2. **O principal é o próximo passo**, que o código já calcula
   (`viagem-guiada.tsx:384`), agora com os documentos entrando na ordem:
   documentos da carga não concluídos → passo obrigatório do catálogo ("Registrar X") →
   "Registrar descarga". Enquanto os documentos estão pendentes, "Registrar descarga"
   continua na tela como botão **contorno, tamanho `default`**, logo abaixo. Nunca some
   e nunca trava.
3. **Cor pela variante, não por `className`.** `variant="success"` no lugar de
   `className="bg-success"` ("Já resolveu", "Confirmar carga", "Finalizar viagem",
   "Concluir documentos").
4. **"Deu problema" e "Outros registros" viram LISTA de linhas iguais.** Escolha:
   lista, não grade de duas colunas.
   - Os nomes vêm do catálogo de cada empresa ("Fila", "Carga recusada pelo cliente",
     "Pneu furado") e o número muda. Uma lista aguenta qualquer nome e qualquer
     quantidade. A grade de duas colunas corta nome comprido em duas linhas e deixa um
     cartão órfão quando a quantidade é ímpar, que é a mesma bagunça de hoje.
   - O dono odeia botão grande de escolha (`feedback_selecao_botoes_odiada`). A linha é
     baixa, ocupa a largura toda e lê como o menu de um Select, que ele já aprovou.
   - Cada linha tem corpo (`feedback_alvo_sem_corpo_nao_existe`): cartão `rounded-xl
     border-2 border-border bg-card`, altura mínima h-14, ícone 22 px à esquerda, nome em
     `text-base font-semibold`, `ChevronRight` à direita. É uma linha só por toque.
     Todas as linhas são iguais em largura, altura e alinhamento.
   - Em "Deu problema", o ícone é `AlertTriangle` âmbar (`#B45309`) em todas as linhas,
     e a cor fica só no ícone. A borda é a mesma de "Outros registros": o título da
     seção já diz que é problema, e borda amarela em cada linha vira grito.
   - Em "Outros registros", o ícone é `PlusCircle`. Sai o "+" escrito no texto.
   - O parágrafo de duas linhas de "Deu problema?" vira uma linha: "O escritório fica
     sabendo na hora. Fila e espera contam o tempo."
5. **Ordem nova:** resumo da viagem (sem repetir "Viagem em andamento") → ocorrência
   aberta → **Agora** (documentos pendentes + botão principal) → Registrar descarga →
   Deu problema → Outros registros → Gastos → O que já foi feito → Descartar viagem. A
   linha do tempo desce porque é consulta, não ação. Hoje ela empurra o botão principal
   pra baixo da dobra.
6. **"Descartar viagem"** continua discreto (ghost vermelho), mas a confirmação vira
   inline, no lugar do `showConfirm`: o botão abre um cartão com "Descartar viagem"
   (vermelho) e "Manter viagem" (contorno).

---

## 4. Maquetes (texto exato)

Legenda: `[ ícone  Texto ]` é botão. A altura vai indicada à direita
(`lg` = 64 px, `def` = 56 px).

### 4.1 Home sem viagem aberta

```
┌──────────────────────────────────────────┐
│ Olá, Valdir                              │  ← cabeçalho azul
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ ▣ Route   Começar viagem          ▶  │ │  ← cartão herói laranja (igual hoje)
│ │           O app acompanha:           │ │
│ │           carga → descarga → fim     │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ ▣ Truck   Lançar viagem feita        │ │
│ │           Já fez? Registre carga,    │ │
│ │           descarga e a foto          │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### 4.2 Começar viagem (tela 2)

```
┌──────────────────────────────────────────┐
│ ←  Começar viagem                        │  ← título igual ao cartão: "é aqui"
├──────────────────────────────────────────┤
│ Placa                                    │
│ [ Escolha a placa                     ▾ ]│
│                                          │
│ Cliente                                  │
│ [ Escolha o cliente                   ▾ ]│
│                                          │
│ [ ⌖  Estou no local de carga           ] │  def, laranja
│ Toque quando estiver no pátio de carga — │
│ o app acha o local desse cliente pela    │
│ sua posição. Marca aqui a hora que você  │
│ carregou.                                │
│                                          │
│ [ ✓  Confirmar carga                   ] │  lg, VERDE
└──────────────────────────────────────────┘
```
(Carregando, o botão diz "Confirmando…" com o spinner do próprio `Button`.)

### 4.3 Viagem em andamento, logo depois de confirmar a carga

```
┌──────────────────────────────────────────┐
│ ←  Viagem em andamento                   │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ ✓ Viagem começou às 10:12            │ │  ← faixa verde, só nesta chegada
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ ABC-1D23                             │ │  ← placa text-2xl
│ │ 👤 Agro Sorriso Ltda                 │ │
│ │ ⌖  Armazém Sorriso                   │ │
│ │ Carregou 06/10 10:12 · há 2 min      │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ AGORA                                    │
│ ┌──────────────────────────────────────┐ │
│ │ 📄 Documentos da carga       0 de 7  │ │
│ │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │ │
│ │ Falta: Ordem de carregamento ·       │ │
│ │ Nota fiscal · Tarifa por tonelada    │ │
│ │ [ 📄 Preencher documentos da carga ] │ │  lg, laranja  ← o principal
│ └──────────────────────────────────────┘ │
│ [ ⚑  Registrar descarga                ] │  def, contorno
│                                          │
│ DEU PROBLEMA?                            │
│ O escritório fica sabendo na hora. Fila  │
│ e espera contam o tempo.                 │
│ ┌──────────────────────────────────────┐ │
│ │ ⚠  Fila                            › │ │  def
│ ├──────────────────────────────────────┤ │
│ │ ⚠  Quebra do caminhão              › │ │  def
│ ├──────────────────────────────────────┤ │
│ │ ⚠  Carga recusada pelo cliente     › │ │  def
│ └──────────────────────────────────────┘ │
│                                          │
│ OUTROS REGISTROS                         │
│ ┌──────────────────────────────────────┐ │
│ │ ⊕  Parada                          › │ │  def
│ ├──────────────────────────────────────┤ │
│ │ ⊕  Pesagem                         › │ │  def
│ └──────────────────────────────────────┘ │
│                                          │
│ GASTOS DESTA VIAGEM                      │
│ (igual hoje)                             │
│                                          │
│ O QUE JÁ FOI FEITO                       │
│ ✓ Carga · Armazém Sorriso   06/10 10:12  │
│                                          │
│ [ 🗑  Descartar viagem ]                  │  ghost vermelho, discreto
└──────────────────────────────────────────┘
```
Cada linha da lista é um cartão separado (`gap-2`) ou um bloco único com divisória:
dá no mesmo, desde que **todas as linhas sejam iguais**. O desenho acima usa o bloco
único.

### 4.4 Viagem em andamento, documentos da carga concluídos

```
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ ABC-1D23                             │ │
│ │ 👤 Agro Sorriso Ltda                 │ │
│ │ ⌖  Armazém Sorriso                   │ │
│ │ Carregou 06/10 10:12 · há 3h 20min   │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [ ⚑  Registrar descarga                ] │  lg, laranja  ← agora é o principal
│                                          │
│ DOCUMENTOS DA VIAGEM                     │
│ ┌──────────────────────────────────────┐ │
│ │ ✓ Documentos da carga        7 de 7  │ │
│ │ [ 📄 Ver documentos ]                │ │  def, contorno
│ └──────────────────────────────────────┘ │
│                                          │
│ DEU PROBLEMA?   (lista igual a 4.3)      │
│ OUTROS REGISTROS (lista igual a 4.3)     │
│ ...                                      │
```
Se ele concluiu com "Concluir e mandar o resto depois", o cartão fica com "5 de 7",
"Falta: …" e o botão contorno "Continuar documentos". O principal continua sendo
"Registrar descarga", porque ele já disse que manda depois.

### 4.5 Documentos da carga (tela da etapa)

```
┌──────────────────────────────────────────┐
│ ←  Documentos da carga                   │
│    ABC-1D23 · Agro Sorriso · Armazém...  │
├──────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░  3 de 7 feitos   │
│                                          │
│ ┌ ORDEM DE CARREGAMENTO ─────── 2 de 3 ┐ │
│ │ Foto ou PDF da ordem     obrigatório │ │
│ │ [img] [img] [PDF]                    │ │
│ │ [ 📷 Tirar foto ] [ 🖼 Galeria ]      │ │
│ │ [ 📄 Escolher arquivo (PDF) ]        │ │
│ │ ...                                  │ │
│ └──────────────────────────────────────┘ │
│                                          │
│ [ ✓  Concluir documentos               ] │  lg, VERDE
│ [ ←  Voltar pra viagem                 ] │  def, contorno
│ Tudo o que você preenche fica guardado   │
│ no celular. Pode sair e voltar depois.   │
└──────────────────────────────────────────┘
```
(O resto da tela fica como em `03-ux.md` §2. Muda só o rótulo "Concluir" para
"Concluir documentos" e o tamanho de h-20 para `lg`.)

### 4.6 Fim da viagem, depois de "Finalizar viagem" (sem pop-up, sem salto)

```
┌──────────────────────────────────────────┐
│    Fim da viagem                         │  ← sem seta de voltar neste estado
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ ✓ Viagem finalizada                  │ │  ← cartão verde
│ │ Vamos enviar assim que tiver sinal.  │ │
│ │ Bom trabalho.                        │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ 📄 Documentos da descarga    0 de 4  │ │
│ │ Falta: Canhoto assinado · Ticket ... │ │
│ │ [ 📄 Preencher documentos da         │ │  lg, laranja
│ │      descarga ]                      │ │
│ └──────────────────────────────────────┘ │
│ [ ⌂  Ir pro início                     ] │  def, contorno
└──────────────────────────────────────────┘
```
Se ficou esperando o peso, o cartão verde diz "Viagem finalizada — falta o peso" e
"Quando sair o romaneio, complete o peso e o ticket — a gente te lembra." (o mesmo
texto do alerta de hoje).

### 4.7 Home com viagem aberta

```
│ ┌──────────────────────────────────────┐ │
│ │ ▣ Route  Viagem em andamento         │ │  ← cartão com borda laranja
│ │          ABC-1D23 · Armazém Sorriso  │ │
│ │          Documentos da carga: 3 de 7 │ │  ← só se houver pendência
│ │ [ ➜  Continuar viagem              ] │ │  def, laranja
│ └──────────────────────────────────────┘ │
```
O texto "Retomar viagem em andamento / Toque pra continuar de onde parou" vira
título + botão: a ação é botão com ícone, nunca o cartão inteiro como texto clicável.

---

## 5. Resumo do que muda (pra quem implementar)

| Arquivo | Mudança |
|---|---|
| `app/iniciar-viagem.tsx:321-327` | botão "Confirmar carga", `variant="success" size="lg"`, sem `h-20` e sem `ArrowRight` |
| `app/iniciar-viagem.tsx:170-174` | `replace` sem `abrirEtapa` (com `iniciou`) |
| `app/viagem-guiada.tsx:60-62, 90-95` | remover o `useEffect` que dá push pra `/etapa` |
| `app/viagem-guiada.tsx:229-263` | tirar o segundo "VIAGEM EM ANDAMENTO"; placa `text-2xl`; faixa "Viagem começou às HH:MM" quando `iniciou` |
| `app/viagem-guiada.tsx:384-408` | principal = documentos da carga pendentes → passo obrigatório → "Registrar descarga"; `size="lg"` puro |
| `app/viagem-guiada.tsx:411-459` | lista de linhas iguais (componente `LinhaAcao` novo, reaproveitado nas duas seções) |
| `app/viagem-guiada.tsx:289, 399` | `variant="success"` no lugar de `className="bg-success"` |
| `components/etapas/cartao-etapas-viagem.tsx` | cartão "Agora" (com o principal) × cartão compacto (contorno) |
| `app/etapa.tsx:416-425` | "Concluir documentos", `lg` sem `h-20` |
| `app/finalizar-viagem.tsx:660-667, 688, 1045-1054` | título "Fim da viagem"; sem `showAlert`/`replace` → estado "Viagem finalizada" na tela; `lg` sem `h-20` |
| `app/(tabs)/index.tsx:426-446` | cartão "Viagem em andamento" com botão "Continuar viagem" |
