#!/usr/bin/env python3
"""Gera as telas do site (webp) a partir dos screenshots originais.

Rodar da raiz do repositório:  python3 apps/site/scripts/gerar-telas.py

As capturas do app saíram num viewport curto (1170x1992 = 0,587), bem mais
larga que a proporção real de um iPhone (0,462). Dentro de uma moldura de
celular isso vira um "aparelho achatado".

O jeito ERRADO de consertar é empilhar azul no topo: o header incha e fica
diferente do app de verdade. O certo é esticar o MIOLO — as telas foram
capturadas numa janela curta, então o que falta é área de conteúdo, não
cabeçalho. O script acha as faixas de cor uniforme (os vãos entre cards e
campos) e distribui a altura que falta entre elas, proporcionalmente. Header e
barra de navegação inferior ficam com o tamanho real, e a proporção entre eles
e a tela passa a ser a mesma que o motorista vê no aparelho.

Sobra só o indispensável nas pontas: a faixa da barra de status no topo e a do
indicador de home embaixo.
"""

from PIL import Image
import glob
import os

ORIGEM = "proposta-alex/imagens"
DESTINO = "apps/site/public/telas"

PROPORCAO_IPHONE = 1170 / 2532  # 0,4621

FAIXA_STATUS = 150  # barra de status, na cor do header
FAIXA_HOME = 100    # indicador de home, na cor do rodapé

LARGURA_CELULAR = 760
LARGURA_PAINEL = 1600


def linha_uniforme(im, y, tol=4):
    """Cor da linha y, ou None se ela não for de cor sólida."""
    w = im.size[0]
    amostras = [im.getpixel((x, y)) for x in range(0, w, max(1, w // 60))]
    for canal in range(3):
        valores = [a[canal] for a in amostras]
        if max(valores) - min(valores) > tol:
            return None
    return amostras[0]


def faixas_uniformes(im, y_inicio, y_fim, cor_header, minimo=8):
    """Trechos contíguos de cor sólida entre y_inicio e y_fim.

    Faixas na cor do header ficam de fora: esticar ali engordaria o cabeçalho,
    que é exatamente o defeito que estamos corrigindo.
    """
    faixas, atual = [], None
    for y in range(y_inicio, y_fim):
        cor = linha_uniforme(im, y)
        do_header = cor and max(abs(cor[i] - cor_header[i]) for i in range(3)) <= 10
        if cor and not do_header:
            if atual and atual[2] == cor:
                atual = (atual[0], y, cor)
            else:
                if atual and atual[1] - atual[0] >= minimo:
                    faixas.append(atual)
                atual = (y, y, cor)
        else:
            if atual and atual[1] - atual[0] >= minimo:
                faixas.append(atual)
            atual = None
    if atual and atual[1] - atual[0] >= minimo:
        faixas.append(atual)
    return faixas


def esticar_miolo(im):
    w, h = im.size
    cor_header = linha_uniforme(im, 2)
    cor_rodape = linha_uniforme(im, h - 3)
    if cor_header is None or cor_rodape is None:
        raise SystemExit(
            "topo ou base não é cor sólida — estender ia criar uma emenda visível"
        )

    altura_final = round(w / PROPORCAO_IPHONE)
    falta = altura_final - h - FAIXA_STATUS - FAIXA_HOME
    if falta < 0:
        return im

    # o miolo exclui o topo (header) e os 12% de baixo (barra de navegação, que
    # precisa continuar colada na base)
    faixas = faixas_uniformes(im, 60, int(h * 0.88), cor_header)
    disponivel = sum(f[1] - f[0] for f in faixas)
    if disponivel < falta * 0.5:
        raise SystemExit("vãos de sobra insuficientes pra esticar sem deformar")

    # distribui proporcionalmente ao tamanho de cada vão
    extra = {}
    for i, f in enumerate(faixas):
        extra[i] = round(falta * (f[1] - f[0]) / disponivel)
    sobra = falta - sum(extra.values())
    if faixas:
        maior = max(range(len(faixas)), key=lambda i: faixas[i][1] - faixas[i][0])
        extra[maior] += sobra

    nova = Image.new("RGB", (w, altura_final))
    y_destino = 0
    nova.paste(Image.new("RGB", (w, FAIXA_STATUS), cor_header), (0, 0))
    y_destino += FAIXA_STATUS

    pontos = {f[1]: extra[i] for i, f in enumerate(faixas)}
    y_origem = 0
    for y in range(h):
        nova.paste(im.crop((0, y, w, y + 1)), (0, y_destino))
        y_destino += 1
        if y in pontos and pontos[y] > 0:
            cor = linha_uniforme(im, y)
            nova.paste(Image.new("RGB", (w, pontos[y]), cor), (0, y_destino))
            y_destino += pontos[y]

    nova.paste(Image.new("RGB", (w, altura_final - y_destino), cor_rodape), (0, y_destino))
    return nova


def main():
    os.makedirs(DESTINO, exist_ok=True)
    total = 0
    for caminho in sorted(glob.glob(f"{ORIGEM}/*.png")):
        nome = os.path.splitext(os.path.basename(caminho))[0]
        im = Image.open(caminho).convert("RGB")
        celular = im.size[1] > im.size[0]

        if celular:
            im = esticar_miolo(im)
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
