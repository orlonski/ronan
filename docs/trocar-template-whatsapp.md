# Trocar o texto de um template do WhatsApp (Meta)

Template **aprovado** na Meta não muda de nome nem de texto. Quando a Meta
reclassifica um (ex.: UTILITY para MARKETING) ou o texto precisa mudar, o novo
texto precisa de **nome novo**, e o envio atual não pode parar enquanto o novo
espera aprovação. Por isso existe o registro de **candidatos**.

## O que é um candidato

`TEMPLATES_CANDIDATOS_WHATSAPP` em `packages/shared-types/src/whatsapp-mensagens.ts`.
Tem a mesma forma de `TEMPLATES_WHATSAPP` (nome, idioma, `corpo`, botão,
`textoAprovacao`, `exemplo`) mais `substitui` (a rota) e `categoria: "utility"`.

Ele **não** entra em `ROTAS_WHATSAPP`, no envio nem no roteamento. É só uma
receita para cadastrar pelo painel. As rotas seguem apontando para o template
atual até a troca final.

Candidatos hoje:

| Chave | Nome novo | Substitui |
|---|---|---|
| `CONVITE_EMPRESA_V2` | `convite_empresa_v2` | `CONVITE_EMPRESA` (`convite_empresa`) |
| `COBRANCA_AUTORIZACAO_PIX_V2` | `cobranca_autorizacao_pix_link_v2` | `COBRANCA_AUTORIZACAO_PIX` (`cobranca_autorizacao_pix_link`) |

Os testes (`apps/api/src/whatsapp/envio/templates.spec.ts`) garantem: nenhum
candidato é usado por rota, `substitui` é válido, o nome é diferente do atual, e
`corpo`, botão e `exemplo` são idênticos aos do template substituído. É isso que
faz a troca ser só renomear.

## Procedimento

1. **Cadastrar.** No painel da plataforma, tela WhatsApp, card "Templates na
   Meta": informar o WABA, "Conferir", e na linha "Novo texto (substitui ...)"
   clicar em "Cadastrar na Meta". Para a cobrança, o campo de prefixo do botão
   abre sozinho, já sugerido (`.../pagar/`); confirmar. A categoria enviada é
   sempre UTILITY.
2. **Esperar** a linha mostrar `APPROVED` e categoria `UTILITY` (verde, com
   "Pronto para trocar"). Se a Meta devolver MARKETING, **não trocar**: o texto
   precisa ser revisto (factual, sem oferta, sem emoji, variável fora do começo
   e do fim) e cadastrado com outro nome (`_v3`).
3. **Trocar no código** (só depois da confirmação do dono). Em
   `TEMPLATES_WHATSAPP`, na rota substituída, copiar `nome` e `textoAprovacao`
   do candidato. Corpo, botão e exemplo já são iguais.
4. **Remover o candidato** de `TEMPLATES_CANDIDATOS_WHATSAPP`. Se a categoria da
   rota em `ROTAS_WHATSAPP` precisar mudar, mudar junto.
5. **Deploy** (push na `main`) e rodar `cd apps/api && pnpm exec vitest run`.
6. **Conferir o envio**: na tela, "Conferir" deve mostrar a rota com o nome novo,
   APPROVED e UTILITY. Fazer um envio real de teste (convite para um número do
   dono; para a cobrança, o fluxo de autorização em conta de teste).

O template antigo pode ficar na Meta sem uso. Não apagar antes do passo 6.

## Regras da Meta que o texto respeita

- Variável nunca no começo nem no fim do corpo (termine com frase fixa).
- Parâmetro de uma linha só (`achatarParam`).
- Sem emoji e sem tom promocional (promoção vira MARKETING).
- Nome em minúsculas, dígitos e underscore.
