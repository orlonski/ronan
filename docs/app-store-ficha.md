# Ficha da App Store — textos prontos pra colar

Companheiro de `docs/app-store-submissao.md` (que explica *por que* cada coisa
está escrita assim). Aqui é só o texto final.

Regra que vale pra tudo abaixo: **nada de "frota", "gestão de motoristas" ou
"controle"**. O app foi recusado por 3.2 justamente por parecer o app interno de
uma empresa. Quem usa é o motorista, e o texto tem que soar como ferramenta
dele.

---

## Nome

```
Movatruck
```

## Subtítulo (30 caracteres)

```
O app do motorista de caminhão
```

## Palavras-chave (100 caracteres)

```
caminhoneiro,frete,motorista,caminhao,km,pedagio,diesel,autonomo,rota,viagem,transporte,carreteiro
```

## Descrição

```
O Movatruck é o app do motorista de caminhão: ele mostra se o frete vale a pena
antes de você pegar a estrada, mede o km que você rodou e guarda tudo o que
você precisa na hora de receber.

VALE A PENA?
Digite de onde sai e para onde vai. O app calcula a distância, mostra as praças
de pedágio que ficam no caminho e estima o diesel pelo SEU consumo — calculado
com os abastecimentos que você mesmo lançou, não com uma média de mercado.

FRETE GUIADO
Toque em começar e siga a rota com orientação por voz, como você já está
acostumado. O app mede a distância enquanto você dirige e, ao chegar, mostra de
onde saiu, quantos quilômetros rodou e quanto vai receber. O km medido é seu:
dá para corrigir antes de salvar.

SEU CADERNO, SEM PAPEL
Cada frete fica no histórico, com data, trajeto, km e valor. Lance abastecimento
e as despesas do dia. No fim do mês, gere um link com tudo o que você rodou e
mande para quem vai te pagar — pelo WhatsApp mesmo.

DOCUMENTOS SEMPRE À MÃO
Guarde CNH, documento do caminhão e o que mais precisar, para achar rápido
quando pedirem.

FUNCIONA SEM SINAL
Estrada tem buraco de sinal. Você lança o frete, o abastecimento e a despesa
mesmo sem internet — quando o sinal volta, o app envia sozinho, sem você
precisar lembrar.

E SE VOCÊ RODA PARA UMA TRANSPORTADORA
Se uma transportadora te convidar, é você quem aceita ou recusa. Aí os fretes
que você roda para ela vão direto para o sistema dela, e você para de mandar
foto de ticket no WhatsApp. Isso é opcional: o app é seu e funciona sozinho.

SOBRE A LOCALIZAÇÃO
O app usa o GPS em segundo plano só para medir a distância do frete que VOCÊ
começou, e só enquanto ele estiver rodando. Você inicia, você para. O uso
contínuo do GPS em segundo plano pode reduzir a duração da bateria.
```

## Novidades desta versão

```
Agora o app é seu mesmo que você não rode para nenhuma transportadora: cadastro
sem código de empresa, cálculo de quanto rende um frete pelo seu consumo, frete
guiado por voz, caderno de gastos, carteira de documentos e o comprovante do mês
pronto para mandar a quem vai te pagar.

Você também pode apagar sua conta pelo próprio app, em Perfil.
```

## URLs

| Campo | Valor |
|---|---|
| Suporte | https://app.movatruck.com.br |
| Marketing | https://www.movatruck.com.br |
| Política de privacidade | https://app.schaba.com.br/politica-de-privacidade |

---

## Review notes (em inglês — é o que o revisor lê)

Trocar `<CPF>` e `<SENHA>` pelos valores gerados por
`cd apps/api && pnpm demo:apple -- --senha "..."`, rodado contra o banco de
**produção**. A conta tem que ser de um motorista **sem transportadora** — ver
`docs/app-store-submissao.md`.

```
DEMO ACCOUNT
The app signs in with a Brazilian tax ID (CPF) and a password.

  CPF:      <CPF>
  Password: <SENHA>

Please use this account. Self sign-up sends a confirmation code over WhatsApp to
a Brazilian phone number, so a reviewer cannot complete it. This demo account is
an independent driver with NO trucking company attached, which is how most of
our users work.

ABOUT THE PREVIOUS REJECTION (3.2)
This app used to be built for the drivers of one specific trucking company. It
is not anymore. Any independent truck driver can download it, sign up with no
company code, and use the whole app on their own. A relationship with a trucking
company is optional: a company may invite the driver, and the driver accepts or
declines. The demo account has no such relationship, and no screen in the flow
below mentions a company.

BACKGROUND LOCATION (2.5.4)
Background location is used to measure the distance of a freight job that the
driver starts and stops themselves — it is the odometer of their own work, and
it is how they get paid. It is requested only when the driver taps to start a
job, never at launch. For a driver with no company attached, the recorded track
stays on the device; only the total distance of the job they saved is uploaded.
The permission prompt and the App Store description both say this.

WALKTHROUGH
1. Sign in with the CPF and password above.
2. You land on the home screen, "Seu trabalho" ("Your work"), marked "Autônomo"
   ("Independent"). The main button is "Iniciar frete" ("Start a freight job").
3. "Vale a pena?" ("Is it worth it?") — type an origin and a destination to see
   distance, tolls along the route and the estimated diesel cost.
4. "Iniciar frete" — type a destination, then "Começar e me guiar" ("Start and
   guide me"). The location permission is requested at this point, with an
   explanation screen first. Granting "While Using" is enough to continue.
5. "Cheguei" ("I arrived") — a summary shows where the job started, the measured
   distance (editable) and the amount to be paid. Saving it adds it to the
   history.
6. "Histórico" ("History") — tap any job to edit or delete it. "Mandar o que
   rodei em <month>" generates a link the driver can send to whoever pays them.
7. "Perfil" ("Profile") — personal data, license plates, documents, change
   password, "Política de privacidade" (privacy policy) and "Apagar minha conta"
   (delete my account, guideline 5.1.1(v)).

The app is in Brazilian Portuguese only; our users are truck drivers in Brazil.

Thank you for the review.
```

---

## App Privacy — o que precisa ser revisto

A declaração atual (de 06/2026) foi escrita quando todo mundo tinha empresa.
Antes de submeter, conferir tipo por tipo se ainda bate com o app do motorista
sem transportadora — em especial **Localização precisa**, que no fluxo do
autônomo não sai do aparelho: o que sobe é o km do frete que ele salvou.
Declaração que não bate com o comportamento é achado de review, não detalhe.

## Screenshots

Do fluxo do autônomo, não do fluxo de empresa: a home "Seu trabalho", "Vale a
pena?" com o resultado na tela, o frete guiado no mapa e o histórico com o botão
de mandar o mês.

Gerar pelo simulador com o perfil que já existe no `eas.json`
(`preview-simulator` — o `production` gera IPA que não instala em simulador) e
normalizar pro slot da ficha com `sips -z <altura> <largura>`.
