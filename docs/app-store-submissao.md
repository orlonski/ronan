# Submissão pública na App Store

> **Resolvido em 17/09/2026: o caminho é app record novo, e ele já existe.**
>
> O app antigo (Apple ID 6778807216) virou unlisted em 03/07/2026, e a Apple não
> desfaz isso: a doc dela só prevê público → unlisted. O case 102957914709
> (aberto 09/09/2026) confirmou o que já se suspeitava — para voltar a ser
> público, **app record novo, com bundle novo**.
>
> O que já está feito do lado da Apple:
>
> - **App ID `br.com.movatruck.app`** registrado, com Push Notifications.
> - **App novo "Movatruck"**, Apple ID **6813093675**, PT-BR, SKU
>   `MOVATRUCK-IOS`, distribuição **Pública**.
> - O app antigo foi **renomeado para "Schaba"**. A Apple só deixa renomear
>   criando versão nova, então existe uma **1.1.1 em rascunho** — não enviada
>   para revisão, e o app segue publicado normalmente.
>
> O Android não se mexe: a Play não troca bundle de app publicado, então ele
> fica em `br.com.schaba.motorista` para sempre. **Isso é o estado final**, não
> dívida — cada loja tem a sua regra, e cada uma ficou com o nome que deu.

O app já foi recusado uma vez, por dois motivos:

- **2.5.4** — localização em segundo plano sem justificativa que se sustentasse.
- **3.2** — "app específico de uma organização", que deve ir por Custom App /
  Unlisted, não pela loja pública.

Este documento é o que mudou, o que ainda falta e o roteiro do revisor.

## O que mudou (e por que muda a conversa com a Apple)

### O 3.2 deixou de ser verdade

O app **não é mais de uma transportadora**. Qualquer motorista baixa, se
cadastra sem código de empresa nenhum e usa sozinho: calcula se um frete vale a
pena com o consumo dele, roda com GPS guiado, anota gastos, guarda documentos e
manda o comprovante do mês pra quem vai pagar. A relação com uma transportadora
virou **opcional** — ela convida por CPF e ele aceita ou recusa.

É a diferença entre "app da Schaba" e "app pra motorista autônomo que também
funciona quando uma empresa te chama".

### O 2.5.4 ficou honesto

O que estava errado antes, e não era só texto:

- O boot ligava **geofence passivo**, **captura periódica de posição** e
  **watchdog de GPS** pra todo mundo, inclusive pra quem não tem empresa — e a
  nossa própria política de privacidade diz que a localização em segundo plano
  serve pra registrar o trajeto **da viagem** e para quando ela acaba. Política
  contradita pelo código é o pior tipo de achado numa review. Hoje esse bloco só
  roda pra quem tem vínculo com transportadora.
- O pre-prompt da permissão dizia *"seus dados vão SOMENTE pro servidor da
  empresa"* — no fluxo de quem não tem empresa, onde **o trajeto não sai do
  aparelho**. Hoje o texto depende do fluxo e diz a verdade nos dois.
- O GPS ligava no `mount` da tela de frete: o popup do sistema aparecia sobre uma
  tela que só dizia "Pra onde você vai". Hoje só quando ele toca em começar.

No fluxo do autônomo, o rastreio é **odômetro**: ele inicia, ele para, o trajeto
fica no aparelho e o que sobe é o km do frete que ele registrou.

### Os bloqueadores de triagem que faltavam

- **Apagar a conta pelo app** (5.1.1-v): Perfil › "Apagar minha conta". Apaga a
  pessoa e tudo que é dela, inclusive os arquivos no MinIO. As viagens rodadas
  pra uma transportadora ficam (documento fiscal dela) e o vínculo é desligado —
  o texto da tela diz isso antes de confirmar.
- **Política de privacidade dentro do app**: Perfil › "Política de privacidade".

## O que ainda falta antes de submeter

- [x] **Build nativo novo.** OTA não muda o binário que a Apple revisa: nada do
      app do autônomo chega ao revisor sem build. `app.config.ts` já está em
      **1.2.0 / iOS build 15 / Android versionCode 17**; falta rodar o
      `eas build --profile production`.
- [x] **Conta de demonstração SEM vínculo com empresa.** É o ponto mais fácil de
      errar: o código de cadastro sai só por WhatsApp (`OTP_CADASTRO`), e um
      revisor em Cupertino não tem CPF nem WhatsApp brasileiro — ele não
      consegue criar conta sozinho. E ela precisa ser de um motorista **sem
      transportadora**: entregar um vinculado reacende o 3.2 e liga de volta a
      captura periódica de posição.

      Criar com `cd apps/api && pnpm demo:apple -- --senha "..."` (em produção,
      dentro do container: `node dist/scripts/criar-demo-apple.js --senha "..."`).
      O script recusa CPF que já tenha vínculo, e grava `ultimoLoginEm` pra que
      uma empresa que cadastre aquele CPF gere convite pendente em vez de adotar
      a conta do revisor.
- [ ] **Rodar o script em produção** e colar CPF/senha nas review notes.
- [ ] **Screenshots** do fluxo do autônomo (a home "Seu trabalho", o frete
      guiado, "Vale a pena?", a carteira de documentos), não do painel nem do
      fluxo de empresa.
- [x] **Descrição da loja** escrita pro motorista autônomo — junto com
      subtítulo, keywords, novidades e as review notes em inglês, em
      `docs/app-store-ficha.md`. Se o texto falar em "gestão de frota" ou
      "controle de motoristas", o 3.2 volta sozinho.
- [ ] **Revisar o App Privacy**: a declaração é de 06/2026, de quando todo mundo
      tinha empresa. No fluxo do autônomo o trajeto não sai do aparelho.

## O caminho que o revisor faz

1. Abre → login → "Criar cadastro" (ou entra com a conta de demo).
2. Cai na home **"Seu trabalho"**, com o selo "Autônomo": herói "Iniciar frete",
   o resumo do mês e quatro ações (Vale a pena?, Abastecer, Lançar gasto,
   Documentos).
3. **Iniciar frete** → digita o destino → "Começar e me guiar". Só aqui aparece o
   pedido de localização, com o pre-prompt explicando que é pra medir o km e que
   o trajeto fica no aparelho. Se ele der só "Durante o uso", o app segue e
   explica o que muda. Se negar, o app oferece abrir os Ajustes.
4. **Cheguei** → folha com de onde saiu, km medido (editável) e quanto vai
   receber → o frete entra no histórico.
5. **Histórico** → toca em qualquer linha pra corrigir ou apagar. "Mandar o que
   rodei em <mês>" gera o link pro contratante.
6. **Perfil** → dados, placas, documentos, trocar senha, **política de
   privacidade** e **apagar minha conta**.

Nada nesse caminho exige transportadora, e nenhuma tela fala em empresa a não ser
o banner de convite — que só aparece se existir um.

## Resíduos conhecidos

Não bloqueiam, mas alguém vai reparar:

- Host `api.schaba.com.br` e, **no Android**, o bundle `br.com.schaba.motorista`.
  Não dá pra trocar: a Play não troca bundle de app publicado e os domínios e o
  projeto Firebase estão amarrados nele. No iOS o bundle passou a ser
  `br.com.movatruck.app`. A UI não mostra "Schaba" em lugar nenhum — a
  plataforma é a Movatruck e a Schaba virou o primeiro cliente.
- `ios/…/Info.plist` é gitignored e regerado pelo prebuild a partir do
  `app.config.ts`. Conferir num build de produção que as strings de permissão que
  saem são as do `app.config.ts`, em PT-BR, e não as antigas em inglês.

## A virada, no dia em que a Apple aprovar

Três coisas ficam **de propósito** apontando pro app velho até a aprovação sair.
Antes disso, mexer nelas manda motorista pra uma página que não existe.

1. `packages/shared-types/src/versao-app.ts` → `APP_STORE_IOS_ID` de
   `"6778807216"` para `"6813093675"`. É o que o `GET /m/versao-app` devolve
   como `storeUrl`, ou seja, **o link que a força-atualização abre no iPhone**.
   Mora no servidor: um deploy da API vira a chave pra todo mundo de uma vez,
   sem OTA e sem build.
2. `apps/site/src/lib/config.ts` → `APPSTORE_URL` (hoje `""`) recebe
   `https://apps.apple.com/br/app/id6813093675`. O site esconde o botão da App
   Store enquanto a string estiver vazia.
3. No app "Schaba": publicar o aviso de migração e só então **Remover da venda**.
   A 1.1.1 em rascunho pode ser apagada.

### O que ninguém deve descobrir no dia

**No iPhone, "atualizar" não é atualizar — é instalar outro app.** Bundle novo é
app novo para o sistema: ícone novo ao lado do antigo, login de novo (o
`SecureStore` é por bundle) e, o que dói, **o outbox do app velho não viaja**.
Lançamento feito offline que ainda não subiu fica preso lá dentro.

Duas consequências práticas:

- A tela `components/atualizacao-obrigatoria.tsx` diz "Atualizar agora" e "a
  atualização acontece na hora". No Android é verdade (fluxo IMMEDIATE do
  Google). No iPhone do app legado é mentira — o texto precisa de uma variante
  por plataforma antes de a força-atualização apontar pro app novo.
- O aviso de migração tem que pedir, com todas as letras, que ele **abra o app
  antigo conectado até a tela de pendentes zerar** antes de apagar qualquer
  coisa.

## Rejeição 4.3(a) Spam (19/09/2026) — e por que ela inverte a ordem do plano

A 1.2.0 / build 15 foi **rejeitada por 4.3(a) Design: Spam**: *"this app is
available in the same locations as another identical app you submitted"*. Não é
achado sobre o código, sobre o 2.5.4 nem sobre o 3.2 — os dois registros
(6778807216 "Schaba" e 6813093675 "Movatruck") são **o mesmo app disponível no
mesmo território**, e a Apple trata isso como duplicata.

A própria mensagem dá a correção: *"restrict the available storefronts for these
apps and ensure none of the selected storefronts overlap"*.

**O que muda:** o passo 3 da seção anterior ("publicar o aviso de migração e só
então Remover da venda") **tem que acontecer agora, antes da aprovação**, não
depois. O app novo só é aprovado quando o velho sair do Brasil.

### O que fazer, na ordem

1. App **Schaba** (6778807216) → Preços e Disponibilidade → Disponibilidade por
   país ou região → **Nenhum** (remover da venda em todas as lojas). O novo está
   só no Brasil, então basta o velho não estar em lugar nenhum.
2. Responder no Resolution Center com o texto abaixo.
3. **Reenviar a mesma 1.2.0 / build 15.** Nada no binário mudou — não precisa de
   `eas build` nem de OTA (e OTA segue proibido enquanto estiver em revisão).

### O que remover da venda faz, e o que não faz

- **Não desinstala nada.** Quem já tem o Schaba no iPhone continua com ele
  funcionando, e continua recebendo `eas update` — OTA é resolvido por
  projeto+canal+runtime, não passa pela loja.
- **Mata o link unlisted** `apps.apple.com/br/app/schaba/id6778807216` para
  instalação nova. Quem já baixou ainda consegue rebaixar pelo histórico de
  compras da conta Apple; motorista novo de iPhone, não.
- **Deixa o iOS sem canal de instalação nova durante a revisão.** Se precisar de
  saída nesse intervalo, o **TestFlight do app legado não depende de
  disponibilidade na loja** — conferir se o build de lá ainda está dentro dos 90
  dias antes de contar com isso.
- **Deixa o link da força-atualização apontando pra página morta**:
  `APP_STORE_IOS_ID` em `packages/shared-types/src/versao-app.ts` ainda é
  `"6778807216"`. Enquanto o app novo não for aprovado, o modo da
  força-atualização no painel **não pode estar em `bloquear` pra iOS** — seria
  mandar o motorista pra uma página que não existe mais, sem saída.

### Resposta pro Resolution Center (em inglês — é o que o revisor lê)

> Hello,
>
> Movatruck is not a duplicate app. It is the replacement record for an app we
> already have on the App Store, and this new record exists because Apple
> Developer Support instructed us to create it.
>
> Background:
>
> - Apple ID 6778807216 ("Schaba") is our existing app. On July 3, 2026 it was
>   converted to Unlisted App Distribution (Developer Support case
>   102925600923), because at the time the app served a single company.
> - The product has since changed: any independent truck driver can now sign up
>   and use the app on their own, with no company code, so the app is no longer
>   tied to one organization and belongs on the public App Store.
> - We asked Developer Support how to convert 6778807216 back to public
>   distribution (case 102957914709). We were told that unlisted to public is
>   not possible, and that the correct path is a new app record with a new
>   bundle ID.
> - Apple ID 6813093675 ("Movatruck", bundle br.com.movatruck.app) is that new
>   record. It replaces 6778807216 — we are not distributing two products.
>
> Following your instructions, we have removed the legacy app (6778807216) from
> sale in every storefront. There is now no overlap: Movatruck is available in
> Brazil only, and the legacy app is available nowhere. Existing users of the
> legacy app are being migrated to Movatruck.
>
> No binary change was needed, so we are resubmitting the same version 1.2.0
> (build 15) for review.
>
> Thank you.

### Feito em 19/09/2026

- **Modo da força-atualização conferido antes de tudo**: está em **Observar**,
  com os dois pisos vazios. Ninguém é bloqueado, então o link morto da loja não
  prende motorista nenhum. Nada a mudar lá — mas se alguém subir o modo pra
  `bloquear` antes de o app novo aprovar, prende.
- **Schaba (6778807216): disponibilidade em 0 países.** Pela tela
  Preços e disponibilidade › Disponibilidade do app › Gerenciar disponibilidade
  › **Nenhum**. A Apple confirmou "seu app será removido da App Store no
  seguinte país ou região: Brasil" e avisa que **leva até 24 horas** pra valer
  de fato.
- **Movatruck (6813093675) conferido**: 1 país, Brasil, "Disponível no
  lançamento do app". Sem sobreposição.
- **Resposta enviada** no Resolution Center e **1.2.0 / build 15 reenviada** —
  status voltou pra "Aguardando revisão".

**Gotcha do reenvio:** na página do envio, o botão **"Reenviar para Revisão do
app" nasce desabilitado**, mesmo depois de responder a mensagem. Ele só acende
depois de abrir a versão (link "Editar" na linha do item) e clicar em
**"Atualizar revisão"** — aí o item sai de "Rejeitado" e vira "Pronto para
revisão". Sem esse passo dá pra ficar rodando em círculo achando que a Apple
travou o reenvio.
