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
| 13–18s | Serra abrindo, vale com neblina embaixo. Plano largo. | **O km do motorista é lei** |
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

### Clipe 3C (13–18s)
```
Vertical 9:16 wide landscape shot from a curve high on a Brazilian serra highway at early
morning. A deep green valley below is filled with a sea of low fog; layered blue ridges
recede into the distance. The dark asphalt curve and its red dirt shoulder cut across the
lower third of the frame, empty. Rich tropical forest, Atlantic-forest look, no
buildings.
Camera: locked-off wide, 28mm lens, f/5.6, deep focus, shot from the roadside looking out
and slightly down. Extremely slow, almost still push-in. Natural overcast-to-golden
light, no color grading tricks, documentary realism.
Audio: wind through vegetation, birds, one very distant engine far below. No music. No
voices. No dialogue.
NEGATIVE: no road signs, no guardrail signage, no kilometer posts, no billboards, no
vehicles in frame, no license plates, no towns, no US canyon or desert scenery, no pine
forest, no subtitles, no watermark, no on-screen graphics.
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
