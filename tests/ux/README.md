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

As próximas levas recolhem o menu lateral abaixo de 1536px. Os E2E que leem o `aside` chamam
`fixarMenuAberto(page)` (`tests/e2e/helpers/menu.ts`), que grava `localStorage["ronan.menu"] = "fixo"`.
**A Leva 1 deve ler essa chave** e manter o menu aberto quando ela valer `fixo`. Hoje o painel ignora a chave.

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

## Detalhes

- Login: `admin@modelo.test` / `uxmedidas123` (`/whatsapp` abre com `super@movatruck.test`, tela só da plataforma; `operador@modelo.test` tem papel restrito).
- `pnpm typecheck:tests` confere o TypeScript desta pasta.
- Os projetos de UX só entram no `playwright.config.ts` com `UX=1` ou `--project=<viewport>`; `pnpm exec playwright test` segue rodando só o E2E.
