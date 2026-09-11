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
  posts/NN-slug.html  uma peça por arquivo (1080×1350)
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

**O render é porteiro, não conselheiro.** Ele mede cada peça e sai com código 1 se
transbordar a altura ou se a moldura do celular estiver fora de 1:1,9–1:2,4. Como o
`enfileirar.mjs` chama o render, peça reprovada **não chega na fila** — não existe
caminho pra publicar uma arte fora do padrão sem alguém desligar a trava de
propósito. Transbordo: corte texto, não diminua a fonte.

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

Os cinco agentes estão em `.claude/agents/ig-*.md`.

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

Pelo Chrome, com a conta já logada (skill `claude-in-chrome`). O fluxo do Instagram web:
Criar → Postar → upload pelo input file (nunca clique no botão, abre o seletor nativo) →
**escolher 4:5 no botão de recorte**, senão a arte entra cortada e perde a assinatura →
Avançar → Avançar → legenda → Compartilhar.

**No máximo 2 ou 3 posts por sessão.** Dez em sequência derrubaram a conta numa
verificação anti-bot ("Confirme que você é humano"), e resolver isso é sempre o usuário
— completar verificação de robô não é coisa que eu faça.

O campo "Site" da bio e o nome de exibição só se editam pelo app do celular.

## Publicação em lote

Pra o feed andar sem ninguém, agende no Meta Business Suite em vez de publicar na hora.
Uma sessão de agendamento cobre semanas.
