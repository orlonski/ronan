# Reels

Vídeo vertical 1080×1920 pro Instagram, gravado do **app rodando de verdade** —
não é animação de tela fingindo ser produto. O Playwright dirige o PWA
(`apps/motorista`), grava em webm e o ffmpeg entrega o MP4.

```bash
pnpm --filter @ronan/motorista dev        # :3002
node marketing/reels/01-offline.mjs       # -> saida/01-offline.mp4
```

## A regra, igual à das artes

**Nada entra no vídeo que o app não faça.** No 01 a rede é cortada de verdade
(`context.setOffline(true)`), e o script imprime no fim quantos POSTs de viagem
a API falsa recebeu. Se sair `0`, a viagem não subiu e o vídeo está mentindo —
foi o que denunciou uma regra de rota minha que engolia o envio.

Nenhuma chamada sai da máquina: `**/m/**` inteiro é interceptado.

## Armadilhas já pagas

- **O canvas do vídeo tem que ser IGUAL ao viewport.** O Playwright encaixa a
  página 1:1 no canto do canvas, não escala pra caber. Canvas maior = app num
  pedaço do quadro e o resto cinza.
- **A tela é 1:2,16, mais alta que os 9:16 do Reels.** Escalar pela largura dá
  2336px de altura e o `pad` recusa ("dimensions cannot be smaller"). Escala
  pela ALTURA e completa a largura com a cor da marca.
- **Offline derruba o dev server junto.** `page.goto` vira tela de erro. Navegue
  tocando nos botões: o react-router é client-side e não pede rede. Pelo mesmo
  motivo a tela tem que ser aberta pelo botão — o app faz `navigate(-1)` ao
  salvar, e com URLs abertas na mão isso vira navegação de documento.
- **IDs do mock têm que ser UUID.** O `CriarViagemInput` valida formato: `"c1"`
  devolve "Cliente: formato inválido" e o salvar não passa.
- **Cliente precisa da empresa aninhada** (`cliente.empresa.nome`), senão a tela
  de nova viagem quebra com "Cannot read properties of undefined".
- **`/m/viagens` responde envelope** `{itens,nextCursor}`. Devolver `[]` cru faz
  a home dizer "Sem internet e sem viagens em cache" — péssimo num vídeo cuja
  primeira cena é o app funcionando.
- **Dispensar o convite de "instalar na tela inicial"** (`ios-install-prompt`):
  é banner de navegador, fala de Safari, e não tem nada a ver com o produto.
- O POST e a leitura batem na **mesma URL** `/m/viagens`. Testar o método ANTES,
  senão a regra de leitura engole o envio.

## O que ainda não temos

Sem rosto e sem voz. Legenda grande no topo faz o papel da narração e o vídeo
funciona mudo, que é como a maioria assiste. Áudio em alta é material de
terceiro e não entra no perfil da marca.
