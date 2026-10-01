# Suíte de UX do painel (orçamento + baseline do ultrawide)

Mede o painel em 4 viewports e trava regressão. **Não muda nada no painel.** Só GET; rede limitada a localhost.

| projeto | viewport |
|---|---|
| `mobile` | 390x844, DPR 3, touch, UA de iPhone |
| `mac1440` | 1440x900 |
| `mac1280` | 1280x800 |
| `ultra` | 3440x1440 (**não pode piorar**) |

## Rodar tudo

```bash
pnpm ux:tudo                 # sobe o stack, roda `pnpm ux`, derruba (mesmo se falhar)
# ou por partes:
bash tests/ux/subir-stack.sh subir     # Postgres docker NOVO (:5464) + migrate + seed + API :3100 + painel :3101
pnpm ux                                # 14 rotas x 4 viewports + baseline do ultra + teste da trava
bash tests/ux/subir-stack.sh derrubar  # mata por PID só o que subiu, dropa o banco, remove o container
```

O stack **nunca** usa produção, nem as portas 3000/3001/5435 do seu dev. Se 3100/3101 estiverem
ocupadas por outro processo, o script aborta sem derrubar ninguém (`UX_API_PORT`, `UX_DASH_PORT`,
`UX_PG_PORT` trocam as portas). O painel é buildado numa cópia (`tests/ux/.stack/repo`), então não
mexe no `.next` do seu `pnpm dev`; rebuilda sozinho quando `apps/dashboard` muda. API e painel
rodam com o relógio ancorado em 29/09/2026 (`stack/fixar-data.cjs`) pra "hoje" ser sempre o dia do seed.

## Orçamento (ratchet) — `orcamento.json`

Por rota e viewport: o número medido vira o **teto**. Medidas (`medidas.ts`): overflow horizontal do
documento, elementos que estouram, conteúdo cortado pelo `<main>`, alvos de toque < 44x44, menor
fonte e textos < 14px, inputs < 16px (esses quatro só no mobile), largura útil do conteúdo (px e
razão sobre a janela), zoom travado no meta viewport, menu lateral visível.

- **piorou** qualquer número -> o teste **falha** e diz qual (com pistas: seletores).
- **melhorou** -> passa e imprime `melhorou, atualize o orçamento`. Regrave pra o ganho virar o novo teto.
- rota/viewport sem entrada -> falha pedindo regravação.

```bash
pnpm ux:orcamento:atualizar   # regrava mobile, mac1440 e mac1280 (commite o orcamento.json)
```

Ao mudar o seed ou as rotas em `rotas.ts`, regrave: os números dependem dos dados.

## Baseline do ultrawide

Duas travas no viewport `ultra`:
1. **Numérica**: `larguraUtilPx` e `menuLateralVisivel` não podem mudar (tolerância ±16px), e o resto do orçamento não pode piorar.
2. **Visual**: `baseline/ultra/<rota>.png` (só o viewport, PNG de 256 cores, ~1,2 MB no total). Tolerância: até **0,3%** dos pixels diferentes (`maxDiffPixelRatio`, `threshold` de cor 0,2). Horas e "há N min" viram marcador fixo antes do screenshot.

Mudou o ultrawide **de propósito**? Regrave e revise as imagens no diff:

```bash
pnpm ux:ultra:atualizar       # números + PNGs do ultra, e reotimiza os PNGs (python3 + Pillow)
```

O baseline foi gerado no macOS; fonte de outro SO tende a passar de 0,3% (regrave lá).

## Provar que a trava funciona

`trava.dashboard.spec.ts` estoura o layout (`width: 4000px`) e exige que o orçamento acuse. Pra ver a suíte
inteira vermelha: `UX_SABOTAR=1 pnpm ux` (estoura largura) ou `UX_SABOTAR=estreito pnpm ux` (empurra o conteúdo; pega o screenshot).

## E2E e o menu recolhido

Entre 768 e 1535px o menu lateral nasce recolhido numa gaveta (Leva 2 / fatia 4). Os E2E que leem o `aside` chamam
`fixarMenuAberto(page)` (`tests/e2e/helpers/menu.ts`), que grava `localStorage["ronan.menu"] = "fixo"`; o painel lê a
chave num script do `<head>` e mantém a coluna fixa. A chave mora em `apps/dashboard/src/lib/menu-preferencia.ts`
(o helper importa de lá).

## MacBook compacto (Leva 2, fatia 4)

`macbook.dashboard.spec.ts` (projeto `mac1440`, troca o viewport por teste): gaveta fechada/aberta em 1280/1440/1470/1512/1535,
Esc, clique fora, fechar ao navegar, Fixar/Soltar com persistência, "sem piscar" (o `data-menu` existe antes do `<body>`),
1536/1728/3440 sempre fixos (com ou sem preferência), grade de 2 cartões só de 1024 a 1535px e o tour com o menu recolhido.
`capturas-macbook.dashboard.spec.ts` (só com `UX_CAPTURAS=<pasta>`; `UX_LARGURAS`, `UX_MENU=fixo`, `UX_DASH`) grava PNG por
rota/largura + `medidas.json` pra comparar antes x depois.

**Densidade, um lugar só:** `apps/dashboard/src/app/globals.css`, segundo `:root` (dentro da media query 768–1535px):
`--ux-fonte` (15px; 16px = como antes) e `--ux-pad-main/card/celula-y`. Como o html passa a 15px, tudo em rem encolhe ~6%
(ex.: janelas `max-w-md` 448 -> 420px) só nessa faixa.

## Navegação do celular (Leva 1, fatia 2)

`navegacao-mobile.dashboard.spec.ts` roda só no projeto `mobile` e trava: barra inferior (4 destinos derivados do menu + "Mais"), folha "Mais" com busca, o cabeçalho com Voltar nas páginas filhas, a barra que some com o teclado e — a regra central — que a folha do celular mostra **exatamente** as telas da sidebar do desktop (admin e `operador@modelo.test`, papel restrito do seed). A regra de quem vê o quê (menu, semente da barra, raiz x filha) também tem teste sem navegador em `tests/e2e/menu-fonte-unica.dashboard.spec.ts`. A suíte não grava "visto" do passo a passo, então a home abre com o tour por cima: o spec o pula.

## Janelas como folha de baixo + banner "Sobre esta tela" (Leva 1, fatia 3)

Abaixo de 768px (`max-md:`) toda `DialogContent`/`SheetContent` vira **folha de baixo** (`components/ui/folha-mobile.tsx`): ancorada
embaixo, largura total, cantos de cima arredondados, alça de arrasto, cabeçalho e rodapé de ações fixos e SÓ o miolo rola,
fechar de 44px, sobe pela altura do teclado (`visualViewport`, o iOS não redimensiona a janela) e traz o campo focado pro meio.
Do `md` pra cima nada muda (o miolo vira `display: contents`).

**Critério folha x centrado:** `centrado` (`modoCelular="centrado"`) só pra CONFIRMAÇÃO curta sem campo — título + 1-2 linhas +
2 botões, ou seja o `useConfirm()`. Qualquer outra janela (campo, lista, tabela, mapa, preview, ou que possa crescer) é folha.

O banner "Sobre esta tela" (`components/sobre-a-tela.tsx`) no celular é UMA linha ("Sobre esta tela ▸"), fechada por padrão;
abrir fica lembrado por tela (`ronan.sobre-a-tela-celular.<rota>`); "Entendi" (a chave `ronan.sobre-a-tela.<rota>` de sempre) dispensa em todos os tamanhos.

- `janelas-mobile.dashboard.spec.ts` (roda no `pnpm ux`): comportamento da folha, teclado (Android e iPhone simulados), rotação, tour, banner, e a prova de que o desktop segue centrado.
- `pnpm ux:janelas` (`UX_FASE=antes|depois`): abre ~25 janelas pelo gatilho real e captura/mede nos 4 viewports (`resultados/dialogos/<fase>/<viewport>/`), mais 7 telas com o banner (`resultados/banner/`). Só abre, nunca confirma. É lento (minutos): fora do `pnpm ux`.
- `python3 tests/ux/comparar-dialogos.py desktop` prova MacBook/ultra idênticos entre `antes` e `depois`; `... lado <pasta>` gera as imagens antes|depois do celular.
- O stack fixa o relógio da API no dia do seed **mas ele segue andando**: o número de alertas da Torre (e por isso `textosMenor14` dela no celular) depende de há quanto tempo o stack subiu. Rode `pnpm ux` logo depois de `pnpm ux:stack subir`.

## Formulários como app no celular (Leva 1, fatia 6)

Tudo abaixo vale SÓ abaixo de 768px (`max-md:`); de 768px pra cima o formulário é o mesmo de antes (as capturas de 1440 e 3440
ficaram idênticas, pixel a pixel). Teste: `formularios.dashboard.spec.ts` (roda no `pnpm ux`, nos 4 viewports).

**Barra de ação fixa** — `components/barra-de-acao.tsx`. Troque a `<div className="flex justify-end gap-2 pt-2">` do rodapé do
formulário de PÁGINA por `<BarraDeAcao>` (`semTopo` quando a div antiga não tinha o `pt-2`). Os filhos seguem sendo o `<BotaoCancelar>`
(com o `sujo`) e o `<Button type="submit">` com o `disabled` de sempre. No celular: fixa no rodapé (acima do gesto do iPhone), fundo sólido,
linha em cima, botões de 48px (Salvar com o dobro da largura do Cancelar) e um espaçador do mesmo tamanho no fluxo, pro último campo nunca
ficar por baixo. **Some com o teclado aberto** (mesmo critério da barra de navegação, `useTecladoAberto`): no iOS o teclado não redimensiona
a janela e a barra ficaria atrás dele; no Android ela comeria ~60px de uma área que já é pequena. Enter no campo envia o formulário, e ao fechar
o teclado a barra volta. Em janela/folha NÃO use: lá o rodapé fixo já é o `RODAPE_FOLHA`. Formulários de configuração com um "Salvar" só
(`configuracoes/*`) não usam: não têm Cancelar e o botão não é alinhado à direita.

**Teclado certo por campo** — `lib/campos.ts`. Só atributos HTML; espalhe no `<Input {...CAMPO.cpf} ... />` (o que vier escrito depois vence):

| campo | preset | o que faz |
|---|---|---|
| CPF / CNPJ / CPF-ou-CNPJ / CEP / odômetro | `cpf` `cnpj` `cep` `numerico` | `inputMode="numeric"`, sem corretor |
| litros, R$, valores | `decimal` | `inputMode="decimal"` |
| telefone | `telefone` (a própria pessoa) / `telefoneTerceiro` | `type="tel"` `inputMode="tel"` |
| e-mail | `email` / `emailTerceiro` | `type="email"` `inputMode="email"` `autoCapitalize="none"` `autoCorrect="off"` |
| placa | `placa` | `autoCapitalize="characters"` `autoCorrect="off"` `spellCheck={false}` |
| nome | `nome` (a própria pessoa) / `nomeLivre` (motorista, usuário, empresa, local, contato) | `autoCapitalize="words"` |
| busca | `busca` | `inputMode="search"` `enterKeyHint="search"` |
| senha | `senhaAtual` (login) / `senhaNova` (cadastro, trocar) | `autoComplete="current-password"` / `"new-password"` |
| código SMS/WhatsApp | `codigoUnico` | `autoComplete="one-time-code"` |

**Dados do próprio usuário x de terceiros:** `autoComplete="tel"`/`"email"`/`"name"`/`"street-address"` só onde a pessoa digita os DELA (login, cadastro da
conta). Nos formulários onde o escritório cadastra OUTRA pessoa/empresa/local (motorista, usuário, cliente, local) o preset de "terceiro" usa
`autoComplete="off"`: senão o iOS/Chrome oferece o telefone, o e-mail ou a casa de quem está logado dentro do cadastro do motorista.
Campo novo: use o preset; se faltar um, acrescente em `lib/campos.ts` em vez de escrever os atributos soltos.

**Foco no iOS** — `useFocoVisivelNoCelular` (`lib/teclado.ts`, montado uma vez no `FundacaoApp`). O iOS não redimensiona a janela quando o teclado
sobe; este efeito leva o campo focado pro MEIO da área visível (`visualViewport`), 300ms depois (o teclado leva isso pra subir). Só em tela
estreita E de toque; ignora janelas/folhas (que têm o próprio ajuste, `useTecladoDaFolha`); não mexe em campo que já está a menos de 48px do
centro; checkbox/radio/botão não contam. Não briga com a validação guiada nem com `autoFocus`: o `Input` já ignora `autoFocus` em ponteiro `coarse`
(os 17 usos de `autoFocus` do painel são todos `<Input>`, nenhum precisou mudar).

**Checkbox/radio** — regra genérica no fim do `globals.css` (`@media (max-width: 767.98px)`): o desenho tem no mínimo 20px e o `<label>` que o
embrulha (`label:has(input[type=checkbox|radio])`) ganha 44px de altura; clicar no texto marca (já marcava). `<input type="checkbox">` sem `<label>` em
volta não ganha alvo: embrulhe num `<label>` (foi feito no cartão de motorista).

**Grades de campos** — par de campos lado a lado sem breakpoint (`grid-cols-2`) vira `max-md:grid-cols-1` (períodos de envios/fechamentos,
formatos do layout de envio). Grades de fotos, KPIs e lista de checkboxes de divergência seguem como estavam.

`UX_CAPTURAS=<pasta> pnpm exec playwright test formularios-capturas --project=mobile --project=mac1440` grava topo/meio/fim/teclado dos 10
formulários (e do login) em 390px e topo/fim em 1440 e 3440, mais `medidas-<projeto>.json`; use antes e depois de uma mudança e compare.

## Detalhes

- Login: `admin@modelo.test` / `uxmedidas123` (`/whatsapp` abre com `super@movatruck.test`, tela só da plataforma; `operador@modelo.test` tem papel restrito).
- `pnpm typecheck:tests` confere o TypeScript desta pasta.
- Os projetos de UX só entram no `playwright.config.ts` com `UX=1` ou `--project=<viewport>`; `pnpm exec playwright test` segue rodando só o E2E.
