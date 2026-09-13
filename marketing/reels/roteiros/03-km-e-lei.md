# Reel 3 — "O km que ele rodou é lei" · ponte motorista ↔ dono · 20s

**Por que este é o mais forte:** é o único com motivo de envio nos dois sentidos. O
motorista manda pro dono ("existe sistema que não mexe no meu km calado") e o dono manda
pro conferente ("é assim que a gente vai passar a fazer"). Compartilhamento por DM é o
sinal que mais alcança quem não segue, e uma peça que cruza os dois públicos num envio só
vale mais que duas peças presas cada uma na sua bolha. Além disso é posicionamento, não
funcionalidade — não tem como virar tour de recurso.

| Tempo | Cena | Texto na tela |
|---|---|---|
| 0–6s | POV rasante do asfalto molhado, faixa gasta, acostamento de terra vermelha, neblina de serra. | **Ele rodou 64. Chegou 58.** |
| 6–13s | Mão calejada no aro do volante, amanhecendo, contraluz forte. | **Alguém corrigiu depois** → **Sem falar nada com ele** |
| 13–18s | Obra no asfalto: caçamba despejando brita, nuvem de pó, cones. | **O km do motorista é lei** |
| 18–20s | **Captura real**: painel recusando a alteração de km, com a mensagem do backend. | **Mudar exige motivo escrito** |

## Prompts

### Clipe 3A (0–6s)
```
Vertical 9:16 low-angle POV shot skimming just above wet dark asphalt on a Brazilian
mountain highway at dawn, moving fast. A faded, worn white lane marking rushes past; the
shoulder is red clay dirt with puddles. Dense tropical roadside vegetation blurs by, and
serra fog sits low over the road ahead. Spray kicks up from the tires.
Camera: mounted low near the tire, 24mm wide lens, f/4, motion blur at the frame edges
with the road center sharp. Continuous forward movement, no cuts, slight vibration from
the suspension. Cold blue dawn light, overcast, high contrast.
Audio: tires hissing on wet asphalt, diesel engine under load, wind buffeting, water
spray. No music. No voices. No dialogue.
NEGATIVE: no road signs, no kilometer markers with readable numbers, no license plates,
no billboards, no lane text, no truck logos, no US interstate markings, no desert, no
yellow center line American style, no subtitles, no watermark, no on-screen graphics.
```

### Clipe 3B (6–13s)
```
Vertical 9:16 close-up inside a truck cab at sunrise. A calloused, weathered hand rests
on the worn rim of a large steering wheel — cracked skin, short nails, a faded fabric
wristband. Strong backlight from the side window blows out the background into pure
white haze; the hand is rendered nearly as a silhouette with a warm rim of light along
the knuckles. Dust floats in the light shaft. The driver's face and body are never
shown.
Camera: close-up, 85mm lens, f/1.8, extremely shallow focus on the knuckles, the wheel
rim falling out of focus in both directions. Handheld, tiny natural drift. Warm golden
backlight against cool shadow, heavy contrast, filmic grain.
Audio: cab interior rumble, a low AM radio murmur too quiet to understand, steady
breathing, wind seal noise. No music. No intelligible voices. No dialogue.
NEGATIVE: no instrument cluster, no gauges, no speedometer, no odometer, no dashboard
screens, no steering wheel logo or emblem, no phone screen, no readable text, no
numbers, no visible face, no subtitles, no watermark, no on-screen graphics.
```

### Clipe 3C (13–18s) — OBRA, não paisagem

A versão original era uma vista da serra. Bonita e genérica: podia ser turismo.
O nosso mundo é pedreira, caçamba, obra no meio do asfalto e pó — é isso que o
público reconhece como a vida dele.
```
Vertical 9:16 cinematic shot at a road construction site on a Brazilian highway,
mid-morning. A dump truck body is tilted up, releasing a heavy cascade of crushed
stone and gravel onto the raw roadbed. A thick cloud of pale rock dust blooms and
drifts across the frame, catching hard sunlight. Orange traffic cones stand in a
line at the edge; red clay earth, patches of fresh black asphalt, tropical scrub
and hills in the far background. A worker in a high-visibility vest is visible far
away as a small blurred silhouette, never in focus, face never shown.
Camera: low wide angle, 28mm lens, f/5.6, shot from ground level near the cones
looking up at the tipping body against the sky. Slight handheld weight, no zoom.
Harsh midday sun, deep contrast, dust haze, documentary realism, visible grain.
Audio: crushed stone thundering down onto the roadbed, hydraulic whine of the
tipping body, diesel idling, distant compactor, wind. No music. No voices. No
dialogue.
NEGATIVE: no license plates, no truck brand badges or grille logos, no company
lettering on the dump body, no readable signage, no road signs, no safety signs
with text, no legible numbers, no visible faces, no eye contact, no American
roadwork layout, no desert, no snow, no subtitles, no watermark, no on-screen
graphics.
```

## Narração (voz masculina, afirmativa, quase um juramento)
> Quem estava na estrada foi ele.
> Se o km precisar mudar, muda — erro de digitação existe. Mas nunca calado.
> Sem motivo escrito, o sistema recusa. E o número que ele mandou fica guardado do jeito que chegou.

## Legenda
```
O km que o motorista informa é lei.

Erro de digitação existe — 640 no lugar de 64 acontece. Então o conferente pode corrigir.
O que ele não pode é corrigir calado.

No Movatruck, alterar o km de uma viagem lançada pelo motorista sem escrever o motivo é
recusado pelo sistema. A alteração que passa vira registro de auditoria com autor, valor
antigo, valor novo e motivo. E o número original do motorista fica guardado num campo
separado que ninguém sobrescreve, nunca.

Motorista é parceiro. Parceiro não descobre no acerto que o número dele mudou.

#movatruck #caminhoneiro #transportadora #fretes #motoristadecaminhao #parceiroautonomo
```

## A captura dos últimos 2s
Painel, edição de viagem: km alterado de 64 pra 58 e o **erro real do backend**
aparecendo. O texto sai de `apps/api/src/common/km-motorista.ts`:

> O km foi informado pelo motorista (64 km). Pra alterar, escreva o motivo.

É o quadro mais forte dos três Reels. Gravar com a resposta 400 de verdade, nunca
simulada.

## Evidência no código
| Promessa | Onde |
|---|---|
| Sem motivo escrito, o sistema recusa | `checarAlteracaoKm` em `apps/api/src/common/km-motorista.ts` |
| Vira auditoria com autor e motivo | `AcaoAuditoria.ADMIN_ALTEROU_KM` em `apps/api/src/admin/viagens/viagens.service.ts` |
| O número dele nunca é sobrescrito | `Viagem.kmMotorista` é cópia intocável; `Viagem.km` é o faturado |
| O conferente pode corrigir | a regra permite com motivo, e carimba `kmAlterado*` |

## Como foi montado

`node marketing/reels/montar-reel3.mjs` — os três clipes do Veo mais a captura
real do painel, com o texto queimado POR CIMA do vídeo (cartela de tela cheia foi
o que o dono reprovou; com imagem de verdade embaixo ela só rouba quadro).

O trecho do painel é tela clara: ali o texto ganha faixa escura por trás, porque
branco com sombra some no claro.

E a tela entregou melhor que o roteiro: em vez do 400 seco, o painel **pede o
motivo** e explica que ele vai pro histórico e chega no celular do motorista. A
frase "Informado pelo motorista: 64 km — esse valor é lei" já está na interface.
