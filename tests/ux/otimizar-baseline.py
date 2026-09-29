#!/usr/bin/env python3
"""Reduz os PNGs do baseline do ultrawide (paleta de 256 cores + otimização). Roda no fim de
`pnpm ux:ultra:atualizar`. Perda invisível pra UI plana; a comparação tem threshold de cor de sobra."""
import glob, os
from PIL import Image

pasta = os.path.join(os.path.dirname(__file__), "baseline", "ultra")
for f in sorted(glob.glob(os.path.join(pasta, "*.png"))):
    antes = os.path.getsize(f)
    im = Image.open(f).convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    im.save(f, optimize=True)
    print(f"{os.path.basename(f)}: {antes//1024}KB -> {os.path.getsize(f)//1024}KB")
