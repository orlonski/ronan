# @ronan/site — site institucional do Movatruck

Landing pública que divulga o app do motorista e o painel. É um serviço à parte:
não fala com a API, não tem login, não tem estado. Build estático (Vite) servido
por nginx — sobe sozinho, cai sozinho, e não derruba nada quando reinicia.

```bash
pnpm --filter @ronan/site dev       # http://localhost:3003
pnpm --filter @ronan/site build     # dist/ estático
pnpm --filter @ronan/site preview   # serve o dist buildado
```

## Como está montado

```
index.html          <title>, metas, OG e os dois JSON-LD (SoftwareApplication + FAQPage)
src/App.tsx         ordem das seções
src/componentes/    uma seção por arquivo
src/lib/config.ts   URLs públicas (WhatsApp, painel, lojas) — vêm de VITE_* no build
public/telas/       screenshots reais do painel e do app, em webp
public/marca/       logo e ícone (cópia de apps/dashboard/public/marca)
```

Conceito visual **Pátio**: claro, régua rígida, produto sem maquiagem. Tipografia
Archivo (títulos) + Public Sans (texto). Movimento é um só — fade de 10px por
IntersectionObserver, desligado em `prefers-reduced-motion`. Sem lib de animação.

### Duas regras de cor que não podem ser quebradas

- `#DF7234` (o laranja da marca) dá **3,2:1 sobre branco** — reprova AA. Ele só
  entra como **fundo**, com rótulo quase-preto (`laranja-tinta`, 5,8:1). Pra texto
  ou ícone laranja sobre claro, usar `acao` (`#B4501A`, 5,1:1).
- Contraste mínimo AA em tudo que é texto.

### Screenshots

Vieram de `proposta-alex/imagens/` (seed de vitrine, sem dado de cliente real) e
foram convertidos pra webp. Pra regerar depois de trocar alguma tela:

```bash
python3 - <<'PY'
from PIL import Image
import os, glob
for p in sorted(glob.glob("proposta-alex/imagens/*.png")):
    im = Image.open(p).convert("RGB"); w, h = im.size
    alvo = 760 if h > w else 1600
    if w > alvo: im = im.resize((alvo, round(h * alvo / w)), Image.LANCZOS)
    im.save(f"apps/site/public/telas/{os.path.basename(p)[:-4]}.webp", "WEBP", quality=84, method=6)
PY
```

`public/og.png` (1200×630) é gerado por script — ver o histórico do commit que
criou o site.

## Deploy

Serviço próprio no Easypanel, `apps/site/Dockerfile`. Ver a seção do site em
[`../../DEPLOY.md`](../../DEPLOY.md).
