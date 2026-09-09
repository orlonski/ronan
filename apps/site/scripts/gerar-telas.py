#!/usr/bin/env python3
"""Gera as telas do site (webp) a partir dos screenshots originais.

Rodar da raiz do repositório:  python3 apps/site/scripts/gerar-telas.py

As capturas do app vieram num viewport curto (1170x1992 = 0,587), bem mais
larga que a proporção real de um iPhone (0,462). Emoldurada, essa tela vira um
"celular gordo". Como o topo é azul sólido e a base é branca sólida nas cinco
capturas, dá pra estender a moldura com a própria cor da borda — sem inventar
conteúdo — e devolver a silhueta certa. O acréscimo vai quase todo no topo,
porque as telas com barra de navegação inferior precisam dela colada na base.
"""

from PIL import Image
import glob
import os

ORIGEM = "proposta-alex/imagens"
DESTINO = "apps/site/public/telas"

TOPO_EXTRA = 410  # faixa do header/status bar
BASE_EXTRA = 130  # área do indicador de home

LARGURA_CELULAR = 760
LARGURA_PAINEL = 1600


def cor_solida(im, y):
    """Cor da linha y, conferindo que ela é mesmo uniforme."""
    w = im.size[0]
    amostras = [im.getpixel((x, y)) for x in range(0, w, max(1, w // 40))]
    for canal in range(3):
        valores = [c[canal] for c in amostras]
        if max(valores) - min(valores) > 6:
            raise SystemExit(
                f"linha y={y} não é cor sólida — estender ia criar uma emenda visível"
            )
    return amostras[0]


def estender_para_celular(im):
    w, h = im.size
    nova = Image.new("RGB", (w, h + TOPO_EXTRA + BASE_EXTRA))
    nova.paste(Image.new("RGB", (w, TOPO_EXTRA), cor_solida(im, 2)), (0, 0))
    nova.paste(im, (0, TOPO_EXTRA))
    nova.paste(Image.new("RGB", (w, BASE_EXTRA), cor_solida(im, h - 3)), (0, TOPO_EXTRA + h))
    return nova


def main():
    os.makedirs(DESTINO, exist_ok=True)
    total = 0
    for caminho in sorted(glob.glob(f"{ORIGEM}/*.png")):
        nome = os.path.splitext(os.path.basename(caminho))[0]
        im = Image.open(caminho).convert("RGB")
        celular = im.size[1] > im.size[0]

        if celular:
            im = estender_para_celular(im)
            alvo = LARGURA_CELULAR
        else:
            alvo = LARGURA_PAINEL

        w, h = im.size
        if w > alvo:
            im = im.resize((alvo, round(h * alvo / w)), Image.LANCZOS)

        saida = f"{DESTINO}/{nome}.webp"
        im.save(saida, "WEBP", quality=84, method=6)
        kb = os.path.getsize(saida) // 1024
        total += kb
        print(f"{nome:32s} {im.size[0]}x{im.size[1]:5d}  {kb:4d} KB")

    print(f"\ntotal {total} KB")


if __name__ == "__main__":
    main()
