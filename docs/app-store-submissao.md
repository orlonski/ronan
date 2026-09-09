# Submissão pública na App Store

> **Antes de tudo: o app hoje é UNLISTED, e isso pode não ser reversível.**
>
> A doc da Apple diz que, depois de aprovado, o método de distribuição não muda —
> *"the only exception to this is to change your publicly available app to an
> unlisted app"*. Ou seja: público → unlisted sim, o contrário não está previsto,
> e o relato comum é que a saída seria um **app record novo, com outro bundle
> ID**. O nosso (Apple ID 6778807216) virou unlisted em 03/07/2026.
>
> Pedido aberto no Developer Support em **09/09/2026, case 102957914709**,
> perguntando (a) se dá pra reverter este mesmo app record e (b) se não, que
> confirmem que o caminho é app record novo. **Enquanto não responderem, nada
> aqui embaixo pode ser submetido** — mas tudo pode ser preparado.
>
> Se a resposta for "app novo": bundle iOS novo (o Android fica onde está, a Play
> não troca bundle), credenciais/perfil novos, APNs+Firebase iOS novo, o unlisted
> vira legado e cada motorista de iPhone baixa o app novo à mão. Os dados são do
> servidor — o risco é lançamento offline preso no aparelho antigo.

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
  empresa"* — no fluxo de quem não tem empresa, onde **nenhum ponto sai do
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

- Bundle ID `br.com.schaba.motorista` e host `api.schaba.com.br`. Não dá pra
  trocar (a Play não permite trocar bundle ID, e os domínios/Firebase estão
  amarrados). A UI não mostra "Schaba" em lugar nenhum — a plataforma é a
  Movatruck e a Schaba virou o primeiro cliente.
- `ios/…/Info.plist` é gitignored e regerado pelo prebuild a partir do
  `app.config.ts`. Conferir num build de produção que as strings de permissão que
  saem são as do `app.config.ts`, em PT-BR, e não as antigas em inglês.
