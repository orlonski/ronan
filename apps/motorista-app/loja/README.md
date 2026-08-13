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
