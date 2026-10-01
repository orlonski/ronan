#!/usr/bin/env python3
"""Compara as capturas de janelas/banner de tests/ux/resultados (fase antes x depois).

  python3 tests/ux/comparar-dialogos.py desktop            # mac1440, mac1280, ultra: % de pixels diferentes por captura
  python3 tests/ux/comparar-dialogos.py lado <saida-dir>   # mobile: uma imagem antes|depois por captura
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops

RES = Path(__file__).parent / "resultados"


def medidas(vp):
    import json
    return json.loads((RES / "dialogos" / "antes" / f"{vp}.json").read_text())


def pares(tipo, vp):
    a, d = RES / tipo / "antes" / vp, RES / tipo / "depois" / vp
    for f in sorted(a.glob("*.png")):
        yield f.stem, f, d / f.name


def desktop():
    ruim = 0
    for tipo in ("dialogos", "banner"):
        for vp in ("mac1440", "mac1280", "ultra"):
            n = 0
            for nome, fa, fd in pares(tipo, vp):
                n += 1
                if not fd.exists():
                    print(f"[{tipo}/{vp}] {nome}: FALTA o 'depois'")
                    ruim += 1
                    continue
                A, D = Image.open(fa).convert("RGB"), Image.open(fd).convert("RGB")
                if A.size != D.size:
                    print(f"[{tipo}/{vp}] {nome}: tamanho {A.size} x {D.size}")
                    ruim += 1
                    continue
                # O seed do stack é regerado a cada subida: dados de fundo (torre, programação, contagem do sino)
                # variam. Compara só o que importa: a janela (região central) ou o banner (topo, sem o sino).
                if tipo == "dialogos":
                    m = medidas(vp).get(nome, {})  # retângulo real da janela, medido na fase "antes"
                    caixa = (m["x"], m["y"], min(A.width, m["x"] + m["w"]), min(A.height, m["y"] + m["h"])) if m.get("abriu") else (0, 0, A.width, A.height)
                else:
                    caixa = (0, 0, min(A.width, 1380), 240 if nome.endswith("dispensado") else 330)
                A, D = A.crop(caixa), D.crop(caixa)
                diff = ImageChops.difference(A, D).convert("L").point(lambda v: 255 if v > 24 else 0)
                pct = 100 * sum(1 for v in diff.getdata() if v) / (A.width * A.height)
                if pct > 0.05:
                    print(f"[{tipo}/{vp}] {nome}: {pct:.3f}% dos pixels diferentes")
                    ruim += 1
            print(f"[{tipo}/{vp}] {n} capturas conferidas")
    print("DESKTOP IDENTICO" if ruim == 0 else f"{ruim} capturas com diferença")


def lado(saida):
    out = Path(saida)
    out.mkdir(parents=True, exist_ok=True)
    for tipo in ("dialogos", "banner"):
        for nome, fa, fd in pares(tipo, "mobile"):
            if not fd.exists():
                continue
            A, D = Image.open(fa).convert("RGB"), Image.open(fd).convert("RGB")
            c = Image.new("RGB", (A.width + D.width + 16, max(A.height, D.height)), (255, 0, 255))
            c.paste(A, (0, 0))
            c.paste(D, (A.width + 16, 0))
            c.save(out / f"{tipo}-{nome}.png")


if __name__ == "__main__":
    (desktop if sys.argv[1] == "desktop" else lambda: lado(sys.argv[2]))()
