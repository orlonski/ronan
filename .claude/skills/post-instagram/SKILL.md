---
name: post-instagram
description: Produzir posts do Instagram do Movatruck (@movatruck) — do ângulo à arte em PNG, com QA contra o código antes de publicar. Use quando pedirem post, carrossel, arte ou legenda pro Instagram, ou pra revisar uma peça já feita.
---

# Post do Instagram do Movatruck

Receita usada nos 10 primeiros posts do perfil, publicados em 11/09/2026.
A arte é **HTML renderizado em PNG** — não existe arquivo de editor gráfico.

## A regra que manda em tudo

**Nada é publicado sem existir no código.** Publicidade de software é contrato: o que
o post promete, a tela precisa entregar. Na primeira leva, o QA barrou cinco peças —
o mapa não mostrava carga nem destino, o "~950 praças de pedágio" saiu de um
comentário e não de medição, o link de comprovante não nascia com a viagem. Todas
pareciam verdade e nenhuma era.

Se não achar a evidência no código, o post não vai. Não suavize a frase: troque a
afirmação.

## Onde fica

```
marketing/instagram/
  base.css            sistema visual — nunca hardcode cor na peça, use as variáveis
  posts/NN-slug.html  uma peça por arquivo (1080×1350). Várias `.peca` no mesmo
                      arquivo = carrossel, na ordem em que aparecem no HTML
  perfil/             foto de perfil e capas de destaque (1080×1080)
  assets/             marca + `telas/` (symlink pros prints em apps/site/public/telas)
  fontes/             Archivo + Public Sans em woff2, pro render não depender de rede
  saida/              PNGs prontos (gitignorado — o que vale é o HTML)
  legendas.md         texto de cada post, pronto pra colar
  perfil.md           bio, nome, destaques e as regras do perfil
marketing/capturas/   telas do painel tiradas do build de produção (sem badge de dev)
```

```bash
cd marketing/instagram
node render.mjs              # todos
node render.mjs 03           # só a peça 03
PASTA=perfil node render.mjs # avatar e destaques
```

Imagem única sai como `saida/NN-slug.png`; carrossel sai numerado,
`saida/NN-slug-1.png`, `-2.png`… e o JPEG correspondente em `saida/jpeg/`. **É o JPEG
que vai pro ar** — a Meta recusa PNG e recusa acima de 8 MB por imagem.

**O render é porteiro, não conselheiro.** Ele mede cada peça e sai com código 1 se
transbordar a altura ou se a moldura do celular estiver fora de 1:1,9–1:2,4. Num
carrossel ele mede **slide a slide** e diz qual reprovou. Como o `enfileirar.mjs` chama
o render, peça reprovada **não chega na fila** — não existe caminho pra publicar uma
arte fora do padrão sem alguém desligar a trava de propósito. Transbordo: corte texto,
não diminua a fonte.

## O fluxo

1. **Ângulo** (`ig-estrategista`) — público, pilar, o que a arte mostra, qual print usar.
2. **Texto** (`ig-copywriter`) — headline de no máximo 7 palavras + legenda com gancho
   na primeira linha (é o que aparece antes do "mais").
3. **Arte** (`ig-designer`, padrão do `ig-diretor-arte`) — HTML usando as variáveis do
   `base.css`, render, e **abra o PNG pra olhar** antes de dizer que está pronto.
4. **QA** (`ig-qa`) — obrigatório. Ele confere cada promessa contra o código e devolve
   bloqueios. Rode **duas vezes**: na segunda passada da primeira leva ele ainda achou
   dois bloqueios que as correções tinham deixado passar.
5. **Publicar** — ver abaixo.

Os agentes estão em `.claude/agents/ig-*.md`.

**Esta skill é de POST EM IMAGEM, e só.** Vídeo e Reel saíram do repositório em
18/09/2026: a esteira de geração por IA foi removida inteira (geradores, roteiros,
montagem e o agente `ig-reels`), por decisão de quem toca a conta. Reel agora é
feito em aplicativo próprio, fora daqui.

Consequência prática: se a pauta pedir Reel, **não existe caminho no repositório** —
não procure `marketing/reels/`, não tente reconstruir a esteira, e não gere vídeo
por API. Escreva o post em imagem ou diga que a pauta não se aplica.

## Carrossel

Um arquivo, várias `<div class="peca">`. Cada uma vira um slide, na ordem em que
aparecem no HTML. De 2 a 10 — é o teto da API, e o app aceitar 20 na mão não muda isso.

Carrossel não é post único fatiado. A forma que funciona:

- **Slide 1 — a promessa, e só ela.** É a capa e é o que decide se alguém desliza.
- **Slides do meio — um passo do mecanismo por tela**, na ordem em que acontece. Se
  dois passos cabem numa tela, eram um passo só.
- **Último slide — o que fazer agora.** Um CTA, não três.

Cada slide precisa fazer sentido sozinho: muita gente entra pelo slide 4 e nunca viu a
capa.

O que merece carrossel é o que não cabe numa frase — regra de negócio com etapas, o
antes-e-depois de um fluxo, um mecanismo que ninguém acredita sem ver o passo a passo.
Ângulo que cabe numa headline continua sendo post único: carrossel de 5 telas pra dizer
uma coisa só é 4 telas de enchimento.

Custa mais: mais copy, mais arte, mais QA. Aqui o QA **não é opcional** — carrossel erra
em sete lugares em vez de um.

## Voz

Brasileiro de transporte, frase curta, verbo forte. Nada de corporativês, superlativo
vazio ou emoji decorativo. Escreva como quem já esteve num pátio às 5h.

**Motorista é parceiro autônomo, não funcionário.** Nunca "sua frota" como posse,
"controle", "fiscalizar", "monitorar". O app trabalha *pro* motorista; o painel dá paz
*pro* dono. Num post sobre o mapa, o ângulo é "ninguém precisa parar o caminhão pra
responder telefone" — e a posição é opt-in, o motorista liga se quiser.

O feed alterna os dois públicos: dono de transportadora (quem paga) e motorista
(quem usa todo dia). Nunca três posts seguidos pro mesmo.

## Armadilhas já pagas

- **"Schaba" nunca aparece** em material publicitário. O produto é Movatruck; a Schaba
  é um cliente. Confira também dentro dos prints — `24-app-perfil.webp` tem
  "Schaba — Motorista PWA" no rodapé e por isso não é usado em post nenhum.
- **Navegação ao vivo, stories, chat e viagem guiada existem só no app nativo.** Não
  prometa no PWA. "App instalado" é ambíguo (PWA na tela de início também é): diga
  "o app do Movatruck para Android e iPhone".
- **O app iOS está unlisted.** CTA de app nunca é "procura na App Store" — é "chama no
  direct que a gente te manda o link".
- **A conferência automática de ticket nasce desligada** (`iaConferenciaTicket` é
  `@default(false)` e ainda roda em modo sombra). A leitura do ticket é que vem ligada.
  Venda como recurso que se liga, não como padrão.
- **Números precisam de origem.** Comentário no código não é medição.
- **Celular tem que parecer celular.** O print do app é 760×1645 (1:2,16). A moldura
  `.celular.recorte` trava a proporção sozinha — a peça define **só a largura**, e o
  render reprova quem furar. Custou quatro posts publicados apagados e repostados. Pra
  mostrar menos tela, diminua a largura; nunca achate a caixa. Uma moldura 320×400 com
  canto arredondado não lê como telefone, lê como tela gorda.
- **Os prints antigos** em `apps/site/public/telas/` carregam a badge do Next devtools
  no canto do menu. A classe `.cartao.sem-menu` corta essa coluna; a correção de raiz é
  recapturar do build de produção (receita em `marketing/capturas/README.md`).

## Publicar

**Nunca dirigindo o navegador.** Isso viola os Termos do Instagram e já custou uma
verificação anti-bot na conta depois de dez posts seguidos — quem resolve captcha é o
usuário, não você. A skill mandava fazer exatamente isso até 21/09/2026; se você leu
essa instrução em algum lugar, ela está velha.

Quem publica é o **publicador da API** (`apps/api/src/marketing/`), e o caminho é a
fila. Você entrega, alguém olha, alguém manda publicar:

```bash
cd marketing/instagram
node enfileirar.mjs <peca> <arquivo-da-legenda> [quando-iso]
```

O `enfileirar.mjs` renderiza, recolhe os JPEGs, confere a legenda (2200 caracteres) e
entrega. Sem `quando-iso` o post entra como **rascunho** e o cron não pega — é o modo
certo pra deixar alguém revisar antes.

Confira na resposta o número de slides. Se você escreveu um carrossel e voltou
`imagem única`, o HTML tem uma `.peca` só.

Do outro lado, no painel (`/marketing`): a arte aparece com a legenda, **Publicar** põe
o post no próximo ciclo (até 5 minutos) e **Cancelar** tira da fila. Os 5 minutos são a
janela de arrependimento — do feed não volta.

Três interruptores seguram tudo, e nenhum é seu: credencial da Meta em env,
`instagramAtivo` no banco e `INSTAGRAM_MODO_SOMBRA`. Não mexa em nenhum, não tente
publicar por conta própria, e não imprima o `MARKETING_INGEST_TOKEN`.

O campo "Site" da bio e o nome de exibição continuam só editáveis pelo app do celular.

