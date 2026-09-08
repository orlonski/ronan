# Submissão pública na App Store

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

- [ ] **Build nativo novo.** OTA não muda o binário que a Apple revisa. Nada
      acima chega ao revisor sem um build.
- [ ] **Conta de demonstração SEM vínculo com empresa.** É obrigatório e é o
      ponto mais fácil de errar: o código de cadastro sai **só por WhatsApp**
      (`OTP_CADASTRO`), e um revisor em Cupertino não tem CPF nem WhatsApp
      brasileiro — ele **não consegue criar conta sozinho**. A conta de demo tem
      que existir pronta, com CPF e senha nas review notes.

      E ela precisa ser de um motorista **sem transportadora**: entregar a conta
      de um motorista vinculado reacende o 3.2 e liga de volta a captura
      periódica, que é exatamente o que estamos dizendo que não existe.
- [ ] **Screenshots** do fluxo do autônomo (a home "Seu trabalho", o frete
      guiado, "Vale a pena?", a carteira de documentos), não do painel nem do
      fluxo de empresa.
- [ ] **Descrição da loja** escrita pro motorista autônomo. Se o texto falar em
      "gestão de frota" ou "controle de motoristas", o 3.2 volta sozinho.

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
