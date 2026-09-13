# Reel 2 — "A viagem que fechou zerada" · dono de transportadora · 24s

**Frase de compartilhamento:** dono manda pro sócio ou pro conferente que fecha o mês
na planilha — todo mundo que já fechou mês na mão viu uma viagem entrar sem peso e
ninguém perceber até o cliente contestar.

| Tempo | Cena | Texto na tela |
|---|---|---|
| 0–7s | Escritório de pátio, 22h, fluorescente piscando. Pilha de tickets amassados. Mão empurra a pilha. | **Essa viagem fechou como zero** |
| 7–14s | Pátio de manhã, neblina. Caminhão saindo pelo portão, silhueta contra o sol baixo. | **A carga rodou** → **O peso ficou na balança** |
| 14–22s | Escritório vazio, luz da manhã, a pilha no mesmo lugar. Travelling lento. | **Toneladas que ninguém faturou** |
| 22–24s | **Captura real**: painel, viagens filtradas em "Aguardando peso". | **Sem peso, não entra no fechamento** |

## Prompts

### Clipe 2A (0–7s)
```
Vertical 9:16 cinematic shot inside a small, worn dispatch office at a Brazilian
trucking yard, 10 PM. A single flickering fluorescent tube overhead casts green-tinged
light. On a scratched laminate desk sits a tall messy stack of crumpled, rain-warped
paper slips held down by a stapler; a chipped coffee cup and a cheap desk fan turning
slowly beside them. A man's hand, sleeve rolled up, enters frame and pushes the stack
aside, then rests flat on the desk. The man himself stays out of frame from the
shoulders up.
Camera: static medium close-up, 40mm lens, f/2.2, shallow focus on the hand and the near
edge of the paper stack; the background office dissolves into soft green bokeh. Very
slight handheld sway. Naturalistic, unpolished, documentary look with visible grain.
Audio: fluorescent tube hum and buzz, a desk fan, a truck maneuvering outside with air
brakes hissing, distant dog barking. No music. No voices. No dialogue.
NEGATIVE: no readable text on the paper slips, no printed forms in focus, no computer
screen content, no monitor UI, no spreadsheets, no logos, no calendar text, no license
plates, no numbers, no visible face, no clean modern corporate office, no subtitles, no
watermark, no on-screen graphics.
```

### Clipe 2B (7–14s)
```
Vertical 9:16 wide shot at a Brazilian trucking yard at sunrise, heavy morning fog. A
loaded cargo truck pulls out through an old iron gate, seen from a distance and rendered
almost entirely as a dark silhouette against the low orange sun burning through the
mist. Red dirt ground with puddles in the foreground, tropical vegetation and a hill
line behind. Dust and exhaust catch the light beams.
Camera: locked-off wide, 85mm telephoto compression from far away, heavy backlight and
lens flare, silhouette exposure with crushed blacks. Extremely slow push-in, almost
imperceptible. The truck never comes close enough to resolve detail.
Audio: diesel engine loading up through the gears, air brakes releasing, an iron gate
rolling on its track, birds, a distant AM radio. No music. No voices. No dialogue.
NEGATIVE: no license plates, no truck brand badges or grille logos, no company lettering
on the trailer, no readable signage, no gate signs, no US highway look, no desert, no
pine forest, no snow, no subtitles, no watermark, no on-screen graphics.
```

### Clipe 2C (14–22s)
```
Vertical 9:16 shot of the same empty dispatch office, now in early morning light. Warm
sunlight comes in sideways through a dusty window blind, striping the desk. The same
crumpled stack of paper slips sits untouched where it was left; dust motes drift through
the light. The chair is empty and pushed back. Nobody is in frame.
Camera: very slow lateral dolly left to right past the desk, 35mm lens, f/2.8, focus on
the paper stack with the window blown out behind. Still, quiet, almost a still-life.
Documentary grain, no stylization.
Audio: room tone, a wall clock ticking, a street waking up outside, one distant truck
horn. No music. No voices. No dialogue.
NEGATIVE: no readable text or printed documents, no computer screen, no monitor UI, no
spreadsheet, no whiteboard writing, no wall calendar text, no logos, no numbers, no
people, no subtitles, no watermark, no on-screen graphics.
```

## Narração (voz masculina, tom seco, sem entusiasmo de vendedor)
> A carga rodou. O ticket ficou molhado em cima da mesa.
> No fim do mês essa viagem entra no fechamento pesando zero — e ninguém vê.
> No Movatruck, viagem sem peso não entra no fechamento. Fica separada até alguém resolver.

## Legenda
```
Viagem sem peso não deveria fechar. E fecha — como zero.

O ticket molhou, o motorista lançou no fim do dia, o peso ficou pra depois. No
fechamento da planilha essa linha entra valendo zero tonelada, e o erro só aparece
quando o cliente contesta.

No Movatruck existe uma regra única que todo cálculo respeita: viagem incompleta — sem
peso, sem saída, faltando dado — fica de fora de match, fechamento, KPI e exportação.
Ela não some: aparece separada, com a frase do que está faltando, pra quem confere
resolver.

Manda pro teu sócio que ainda fecha o mês na planilha.

#movatruck #transportadora #gestaodefrota #logistica #frete #fechamento
```

## Evidência no código
| Promessa | Onde |
|---|---|
| Viagem sem peso não entra no fechamento | `apps/api/src/common/viagem-status.ts` — `STATUS_FORA_FECHAMENTO`, usada em todo filtro de fechamento/KPI/export |
| Não some: fica separada com o que falta | model `ViagemDivergencia` — campo `detalhe` (frase pronta, montada no servidor) + `resolvidoEm`/`resolvidoPor` |
| O servidor aceita de propósito em vez de recusar | `lancamentos-resgatados.service.ts` |
