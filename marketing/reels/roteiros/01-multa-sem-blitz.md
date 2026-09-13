# Reel 1 — "A multa que chega sem blitz" · motorista · 22s

**Frase de compartilhamento:** motorista manda pro parceiro de estrada que está com
o toxicológico vencendo e não sabe — essa multa chega em casa sem ninguém parar ele,
e avisar um amigo disso é favor de verdade, não conteúdo.

| Tempo | Cena | Texto na tela |
|---|---|---|
| 0–7s | Pátio de posto no interior, 4h, neblina. Silhueta na boleia, papéis no colo, luz do celular por baixo. | **A multa chega sem blitz** |
| 7–14s | Close das mãos abrindo um papel dobrado. Nada legível. | **Toxicológico vence quieto** → **30 dias depois ela sai** |
| 14–20s | Celular no painel acendendo no escuro, reflexo no para-brisa molhado. | **O app te avisa 60 dias antes** |
| 20–22s | **Captura real**: tela "Meus documentos", toxicológico vencendo. | **Movatruck — a carteira do motorista** |

## Prompts

### Clipe 1A (0–7s)
```
Cinematic vertical 9:16 video, 4 AM at a truck stop yard in the interior of Brazil.
Low fog hanging over cracked dark asphalt, red dirt shoulder at the edge of frame,
dense tropical vegetation silhouetted behind. A cargo truck cab sits parked, driver
door open. A man is seated sideways on the cab step, only a rim-lit silhouette — his
face is never visible, lit from below by the cold blue glow of a phone, with sodium
vapor light far behind him. Loose papers rest on his lap. Fine drizzle falls through
the light beams.
Camera: static wide-to-medium, 35mm lens, slight handheld breathing, shallow depth of
field, shot from outside the cab at chest height. Heavy shadow, high contrast, natural
night grain. No camera movement toward the vehicle.
Audio: distant idling diesel engine, light rain on metal, crickets, a far-off truck
passing on wet asphalt. No music. No voices. No dialogue.
NEGATIVE: no license plates, no readable text anywhere, no logos or brand badges, no
dashboard instruments, no gauges, no lit signage, no storefront signs, no legible
numbers, no visible human face, no eye contact, no American highway signage, no desert,
no palm-lined US freeway, no subtitles, no watermark, no on-screen graphics.
```

### Clipe 1B (7–14s)
```
Extreme close-up, vertical 9:16, of a working man's calloused hands unfolding a creased
sheet of paper inside a dark truck cab at night. The paper is deliberately out of focus
and unreadable — soft, blown highlights where the phone light hits it. Grease under the
fingernails, a worn watch strap, a faded sleeve. Only the hands and the paper are lit;
everything else falls to black.
Camera: macro-feel close-up, 85mm lens, f/1.8, razor-thin depth of field focused on the
knuckles, tiny handheld drift. Single cold practical light source from below left, warm
sodium spill from far behind.
Audio: paper being unfolded, slow breathing, rain tapping the windshield, faint engine
hum. No music. No voices. No dialogue.
NEGATIVE: no readable text or printed words, no document layout in focus, no logos, no
faces, no dashboard, no gauges, no license plates, no numbers, no screens, no subtitles,
no watermark, no on-screen graphics.
```

### Clipe 1C (14–20s)
```
Vertical 9:16 night interior of a Brazilian truck cab. A phone lying face-up on the
dashboard suddenly lights up, throwing cold blue light across a rain-streaked
windshield. Water beads on the glass catch the glow and the orange smear of distant lot
lights. The phone screen itself is heavily overexposed and out of focus — pure glow,
nothing readable. The cab interior is almost entirely black, only edges of the steering
wheel rim catching light.
Camera: static locked-off close shot from the passenger side, 50mm lens, f/2, focus
pulled to the rain on the glass so the phone stays a soft bloom in the foreground. No
dolly, no zoom.
Audio: steady rain on the roof, one short muffled notification buzz against plastic,
distant highway. No music. No voices. No dialogue.
NEGATIVE: no readable phone UI, no app icons, no notification text, no dashboard
instrument cluster, no gauges, no speedometer, no license plates, no brand logos, no
visible face, no subtitles, no watermark, no on-screen graphics.
```

## Narração (gravar em pós — voz masculina grave, sem pressa)
> Toxicológico vencido não precisa de blitz pra te achar.
> A multa sai sozinha trinta dias depois do vencimento.
> O app te avisa com sessenta dias de antecedência. Dá tempo de marcar o exame.

## Legenda
```
Essa multa não depende de blitz. Ela chega em casa.

O exame toxicológico vale 2 anos e 6 meses. Passou do prazo, a multa é lançada sozinha
30 dias depois — ninguém precisa te parar na estrada.

Por isso o Movatruck avisa o toxicológico com 60 dias de antecedência, e não com 30 como
os outros documentos: o exame demora pra sair. Avisar em cima da hora é avisar tarde.

Na carteira do app: CNH, toxicológico, RNTRC, CRLV, MOPP, cronotacógrafo. Cada um com a
sua validade e o seu aviso.

#movatruck #caminhoneiro #toxicologico #rntrc #motoristadecaminhao #estrada
```

## Evidência no código
| Promessa | Onde |
|---|---|
| Multa sai sozinha 30 dias depois, sem blitz | `shared-types/src/documento-pessoal.ts` — `AJUDA_DOCUMENTO_PESSOAL.EXAME_TOXICOLOGICO` (texto já exibido no app) |
| Avisa 60 dias antes | `DIAS_AVISO_DOCUMENTO = { EXAME_TOXICOLOGICO: 60 }`, padrão 30 pros demais |
| O aviso chega sozinho | `apps/api/src/frete-pessoal/aviso-documentos.service.ts` — cron diário 8h SP, push, marca `avisadoEm` |
| A carteira tem esses documentos | `TIPOS_DOCUMENTO_PESSOAL` + `GET/POST /m/documentos` |

**Ressalva:** é o roteiro que mais perde por não ter pessoa. Um aviso entre parceiros
pede a cara de um motorista dizendo isso. Quando houver um parceiro real disposto, é
este que se regrava primeiro — mesmo texto, celular na mão, dentro da cabine dele.
