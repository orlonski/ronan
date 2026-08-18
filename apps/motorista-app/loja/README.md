# Artes da ficha das lojas

Arte da **ficha** (o que aparece na loja), que é coisa separada do que vai dentro
do binário. O ícone que o motorista vê na gaveta do celular sai de
`../assets/icon.png` e é compilado no build; estes aqui você sobe à mão no
console. Trocar um não troca o outro.

Gerados a partir dos SVGs oficiais em `apps/dashboard/public/marca/` — se a
marca mudar, regere daqui em vez de editar PNG à mão.

## Google Play Console

| Arquivo | Onde | Spec |
|---|---|---|
| `play-icone-512.png` | Ficha da loja → Ícone do app | 512×512 PNG |
| `play-grafico-destaque-1024x500.png` | Ficha da loja → Gráfico de destaque | 1024×500, **sem transparência** |

Os **screenshots** da ficha não precisam ser refeitos no rebranding: são telas
internas do app (Nova viagem, Histórico, Abastecimento, Viagem em andamento,
Início) e nenhuma delas mostra o nome da plataforma. Conferido em 13/08/2026
baixando as imagens da ficha publicada.

## App Store Connect

Não tem ícone pra subir: a Apple lê o de 1024×1024 de dentro do binário
(`../assets/icon.png`). Os screenshots da ficha seguem os mesmos das telas
internas.

O que muda à mão no ASC é o **nome do app** — continuava "Schaba" em 13/08/2026,
conferido via `https://itunes.apple.com/lookup?id=6778807216`.

## Descrição completa (Google Play)

A descrição da ficha precisa justificar, em texto público, a permissão
`FOREGROUND_SERVICE_LOCATION` — não basta declarar no console. A Play recusou o
envio do rebranding em 14/08/2026 exatamente por isso (a rejeição veio contra o
versionCode 14, o que estava publicado, e derrubou junto as 5 mudanças de nome,
descrição, ícone, gráfico e política de privacidade).

A seção abaixo entra na descrição completa, antes de "PRA QUEM É". Ela existe
pra dizer as quatro coisas que a política cobra: que o motorista inicia, que
roda em segundo plano, que há notificação visível enquanto roda, e que dá pra
parar. Mexer nela sem manter essas quatro é convidar a próxima rejeição.

```
📍 RASTREAMENTO DE TRAJETO EM SEGUNDO PLANO
O Movatruck usa localização em segundo plano (serviço em primeiro plano) apenas quando o motorista toca em "Iniciar viagem com GPS".

• É o motorista quem inicia — o app nunca começa a rastrear sozinho
• Enquanto a viagem está em andamento, uma notificação permanente ("Viagem em andamento") fica visível na barra de status
• O rastreamento continua com o app fechado ou a tela apagada, porque o caminhão roda horas na estrada e o km real é o que remunera a viagem
• O motorista para quando quiser, tocando em "Finalizar viagem" ou "Descartar viagem" — a notificação some junto
• Sem viagem em andamento, o app não coleta localização em segundo plano
```

O texto casa com o código: o `foregroundService` só é ligado em
`../lib/tracking.ts` (trajeto da viagem) e `../lib/posicao-periodica.ts`
(compartilhar posição). O geofencing usa `startGeofencingAsync`, que roda pela
API do Play Services e não abre serviço próprio — por isso a declaração no
console marca **só** "Compartilhamento de local iniciado pelo usuário". Cada
tarefa marcada a mais precisa aparecer no vídeo da declaração.

## Vídeo da declaração de serviço em primeiro plano

A Play exige um vídeo demonstrando a dependência do foreground service. O que
estava lá até 14/08/2026 (`youtube.com/shorts/18XKJTxnuTw`) era um Short de 30s
gravado em 11/05, mostrando o app ainda chamado "Ronan Motorista" e terminando
em `0.00 km / 0 pontos` — não provava nada, e foi metade do motivo da recusa.

O vídeo que substitui precisa mostrar, nesta ordem, com legenda em inglês:

1. Abrir o app **já na tela de login** e entrar com a credencial de teste do console.
   **Não filmar a gaveta/home do celular**: o nome e o ícone ali saem do binário
   (vc14, ainda "Schaba"), enquanto a ficha diz "Movatruck" — mostrar os dois
   lado a lado é convite pro revisor achar que é outro app. As telas de dentro
   já mostram o wordmark Movatruck, que chega por OTA no runtime 1.0.5.
2. Tocar em "Iniciar viagem com GPS" — prova que é iniciado pelo usuário
3. Conceder a permissão de localização ("Permitir o tempo todo")
4. Puxar a barra e mostrar a notificação "Viagem em andamento" — prova que é perceptível
5. Apagar a tela / sair do app e andar 1–2 minutos — prova a dependência do segundo plano
6. Voltar: km e pontos GPS subiram, trajeto no mapa — **é o que faltava no vídeo antigo**
7. "Finalizar viagem" e a notificação sumindo — prova que dá pra interromper

Subir como **Não listado** no YouTube, com título descritivo
(`Movatruck — FOREGROUND_SERVICE_LOCATION demonstration`) e link que abre sem
login.

## Credencial de teste do revisor

Fica em Conteúdo do app → Detalhes do login: CPF `12345678909`, motorista
**"MOTORISTA TESTE PLAY STORE - NÃO APAGAR"**. O revisor não consegue criar conta
(não há cadastro público), então **se a credencial não logar, a recusa é certa**
— vale testar antes de todo envio:

```bash
curl -s -X POST https://api.schaba.com.br/m/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"cpf":"<cpf>","senha":"<senha>"}'
```

O motorista dessa conta precisa estar `APROVADO` e com `podeIniciarViagem`
ligada — o card "Iniciar viagem com GPS" é gateado por ela em
`app/(tabs)/index.tsx`, e sem a flag o revisor não tem como ver o foreground
service existir. Em 14/08/2026 a flag estava **desligada** nessa conta, o que
sozinho já garantiria a recusa; foi religada em 17/08/2026. `podeViagemLifecycle`
pode ficar desligada, gateia outro fluxo.

As instruções do campo precisam estar **em inglês**: a própria tela do console
avisa, e o que estava lá em 14/08/2026 estava em português.

### Como o vídeo de 17/08/2026 foi produzido (emulador)

Dá pra gravar sem celular, e o resultado é reprodutível. O que foi usado:

1. **APK com a marca certa**: `eas build --profile preview-universal --platform android`.
   `preview-universal` (e não `preview`) porque o `DISABLE_ABI_SPLITS=1` entrega um
   APK único, que instala no emulador arm64 sem escolher split. O ambiente EAS
   `preview` já tem `GOOGLE_MAPS_ANDROID_KEY` e `GOOGLE_SERVICES_JSON`, então o
   mapa aparece de verdade no vídeo.
2. **Emulador**: AVD Android 34 `google_apis` arm64, 1080×2400 — formato vertical,
   igual a um celular. `google_apis` importa: sem os Play Services o
   FusedLocationProvider não entrega posição.
3. **GPS**: `adb emu geo fix <lon> <lat>` a 1 Hz, andando ~19 m por fix (≈68 km/h).
   O passo tem que respeitar o `/m/tracking-config`: ponto acima de
   `velocidadeMaxKmh` ou com precisão pior que `accuracyMaxMetros` é **descartado**,
   e aí o vídeo termina em 0,00 km — que é exatamente o motivo da recusa anterior.
   A rota veio do OSRM público e foi reamostrada, pra linha no mapa seguir a estrada.
4. **Gravação**: `adb shell screenrecord` (teto de 180 s). Ele só emite frame quando a
   tela muda, então o mp4 sai com timeline irregular: normalizar com `fps=30`
   **antes** de posicionar legenda, senão as marcações caem no lugar errado.
5. **Legendas**: o ffmpeg desta máquina veio sem libass e sem freetype — não há
   `subtitles` nem `drawtext`. Contorno: gerar cada legenda como PNG (PIL) e
   sobrepor com `overlay` + `enable='between(t,ini,fim)'`.

**A pegadinha que custou uma regravação:** sem `POST_NOTIFICATIONS` concedida, o
Android 13+ **esconde a notificação do foreground service**. O serviço roda
(`dumpsys activity services` mostra `isForeground=true` e `types=00000008`, que é
`FOREGROUND_SERVICE_TYPE_LOCATION`), mas a barra fica vazia — e sem essa
notificação em tela o vídeo não prova o "perceptível ao usuário" que a política
cobra. Num aparelho de motorista a permissão vem do fluxo de push; num emulador
recém-instalado, não. Conceder antes de gravar:
`adb shell pm grant br.com.schaba.motorista android.permission.POST_NOTIFICATIONS`.

Pra o diálogo de permissão de localização aparecer na gravação, resetar antes com
`adb shell pm reset-permissions` (só `pm revoke` deixa flags que podem suprimir o
diálogo).

Os scripts ficaram no scratchpad da sessão (`dirigir.py`, `gravar.sh`,
`legendar.py`) — se for regravar, vale reescrevê-los a partir desta receita.
