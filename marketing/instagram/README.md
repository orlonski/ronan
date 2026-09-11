# Instagram do Movatruck

Artes e legendas dos posts. Tudo aqui é gerado a partir de HTML — nada de editor gráfico.

```
base.css        sistema visual (cores, tipografia, molduras). Não hardcode cor na peça.
posts/          uma peça por arquivo, 1080×1350
perfil/         foto de perfil e capas de destaque, 1080×1080
assets/         arquivos de marca; `telas/` é link pros prints em apps/site/public/telas
fontes/         Archivo + Public Sans em woff2 (render offline, sem depender de rede)
saida/          os PNGs prontos pra publicar (2160×2700 @2x)
legendas.md     o texto de cada post, pronto pra colar
perfil.md       bio, nome, destaques e regras do perfil
```

## Gerar as artes

```bash
node render.mjs              # todos os posts
node render.mjs 03           # só a peça 03
PASTA=perfil node render.mjs # foto de perfil e destaques
```

O script avisa se alguma peça transbordou a altura — isso é defeito, corrija o texto.
Para outro formato (story 1080×1920, por exemplo), declare na peça:
`<meta name="tamanho" content="1080x1920">`.

## A squad

Cinco agentes em `.claude/agents/` cuidam do fluxo. Use nesta ordem:

| Agente | Para quê |
|---|---|
| `ig-estrategista` | definir o ângulo, o público e o formato de cada post |
| `ig-copywriter` | escrever o texto da arte e a legenda |
| `ig-diretor-arte` | decidir a composição / criticar uma peça pronta |
| `ig-designer` | implementar o HTML e renderizar o PNG |
| `ig-qa` | auditar antes de publicar: promessa sem lastro, tom, texto, arte |

Exemplo de pedido: *"usa a squad pra fazer 3 posts sobre conciliação de ticket"*.

## Regra que mais importa

**Nada é publicado sem existir no código.** O `ig-qa` confere cada promessa contra
`/Users/orlonski/dev/ronan` e marca o que não tiver lastro. Publicidade de software
é contrato: o que o post promete, a tela precisa entregar.
