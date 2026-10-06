# 04 — Proposta fechada: Etapas da Viagem (06/10/2026)

> **Revisada com 05-qa** (06/10/2026): incorporados B1, B2 e I1–I12; os M1–M8 entram na
> parte "Pra quem implementa".

Dono de produto da squad. Base: `00-pedido-do-cliente.md`, `01-campo.md`, `02-arquiteto.md`,
`03-ux.md`, `05-qa.md`. Nada implementado ainda. A primeira metade é pro dono (sem termo
técnico); a segunda, "Pra quem implementa", fecha o desenho.

---

## A funcionalidade em uma frase

**Os papéis de cada momento da viagem (carregamento, descarga, acerto do frete) são
preenchidos no app, presos àquela viagem, e o escritório vê o que chegou e o que falta —
inclusive do formulário que o motorista nem abriu.**

## No dia a dia

O motorista carrega em Sorriso às 10h e toca "Começar viagem" como sempre; logo depois o
app abre "Documentos da carga": foto ou PDF da ordem de carregamento, o valor por
tonelada, se teve pesagem, a foto do km no tacógrafo. O CT-e e o MDF-e só chegam às 14h,
em PDF, pelo WhatsApp do escritório — ele fecha a tela sem medo, porque fica guardado, e
anexa o PDF (ou uma foto da tela) quando chegar, mesmo sem sinal. Ao finalizar a viagem no
destino, abre "Documentos da descarga": canhoto assinado, ticket da balança, tacógrafo. O
comprovante de encerramento do MDF-e, que a empresa marcou como "não seguir viagem sem
este", não trava ninguém: se ele for começar a próxima viagem sem ele, o app para um
instante — "O escritório precisa deste documento" — e oferece anexar agora ou seguir
dizendo o motivo, inclusive "Já está com o escritório". Com sinal, o app confere antes: se
o escritório já anexou, o cartão nem aparece. Dias ou semanas depois, no escritório da
agenciadora, ele abre "Acerto do frete" pela tela inicial: transportadora e foto da
fachada, responsável e foto, fotos do contrato, assinatura no dedo. No escritório da
transportadora, cada viagem tem a seção "Documentos" com tudo organizado, com hora e
lugar; o que falta aparece em amarelo — mesmo que o motorista nunca tenha aberto a tela —
e o escritório pode anexar ele mesmo (o comprovante do MDF-e costuma nascer lá) ou
dispensar com motivo. Os formulários são montados pela própria empresa no painel, vendo
ao lado como fica no celular, e começam pelos três prontos do jeito que o cliente usa hoje.

---

## Os conflitos, resolvidos

**(a) Nota por item e "pergunta que só aparece se…" — fora.** A nota em % do Checklist
Fácil é auditoria de loja; pro escritório o que importa é "o que falta", e o contador
"5 de 7" já mostra. A empresa monta o formulário com um conjunto fixo de tipos de campo
(foto, foto ou PDF, sim/não, valor, texto, texto com foto, assinatura). A única condição é
a dos formulários do cliente: depois de Sim ou Não, pedir foto ou comentário.

**(b) Uma regra só pro que falta.** Faltar documento **nunca impede nada**. O que falta é
calculado pelo sistema a partir da viagem — o motorista não precisa abrir nada pra
pendência existir. Cada campo tem, no painel, "Se faltar":
- **Avisar o escritório** (padrão): aparece como "documento faltando" na viagem.
- **Não seguir viagem sem este**: igual, e **na próxima ação dele** (finalizar a viagem,
  se o campo é da carga; começar a próxima, se é da descarga ou do acerto) o app mostra o
  cartão amarelo com "Anexar agora" e "Seguir sem isso". Seguir pede o motivo
  ("Já está com o escritório" · "Ainda não recebi" · "Vou mandar mais tarde" · outro).
  O motivo fica gravado na viagem.

Motivo é pedido **uma vez, nesse momento**, nunca ao concluir a tela (o CT-e pode
legitimamente estar a caminho). Nada vermelho, nada de "a empresa pede" — o texto é "o
escritório precisa deste documento". Na viagem lançada depois do fato (o lançamento
clássico), a barreira vira só um aviso, sem pedir motivo. Funciona sem sinal; com sinal,
o app confere antes de mostrar. Trava de verdade não entra (decisão 1).

**(c) Sim/Não — as duas telas pro dono ver** (decisão 2):

```
OPÇÃO A — lista (a regra de hoje)        OPÇÃO B — dois botões
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│ Teve pesagem?        obrigatório │     │ Teve pesagem?        obrigatório │
│ [ Escolha…                    ▾ ]│     │ ┌──────────────┐┌──────────────┐ │
│                                  │     │ │     Sim      ││     Não      │ │
│ (tocou: abre a lista)            │     │ └──────────────┘└──────────────┘ │
│   Sim                            │     │ (nenhum vem marcado; o tocado    │
│   Não                            │     │  fica cheio, o outro contorno)   │
│                                  │     │                                  │
│ Escolheu Sim →                   │     │ Tocou Sim →                      │
│ Foto do ticket da pesagem        │     │ Foto do ticket da pesagem        │
│ [📷 Tirar foto] [🖼 Galeria]      │     │ [📷 Tirar foto] [🖼 Galeria]      │
└──────────────────────────────────┘     └──────────────────────────────────┘
2 toques. Igual a todo o resto do app.   1 toque. Exceção à regra da lista.
```

São 4 perguntas Sim/Não nos formulários do cliente. Nas duas opções nada vem marcado.

**(d) Módulo: vendido à parte, igual ao Gasto de viagem.** Conta nova **não** recebe
sozinha, nem no teste grátis; a plataforma liga à mão pra quem pedir. Não depende do
Financeiro (não mexe em dinheiro). **Mesmo com o módulo ligado, o app não muda pra
ninguém** até a empresa ligar a função pros motoristas que quiser — começa por um.
A Schaba não ganha sozinha: pra testar nela, alguém liga o módulo à mão e liga pra um
motorista só.

**Outros, resolvidos sem precisar do dono:**
- *Quando a tela abre?* Logo depois de "Começar viagem" (carga) e logo depois de
  "Finalizar viagem" (descarga); o acerto do frete não abre sozinho, espera na tela
  inicial. Quem não usa "Começar viagem" abre pelo cartão da viagem e pela tela inicial.
- *Até quando dá pra preencher depois?* 30 dias depois de finalizar (o canhoto e o saldo
  às vezes demoram semanas); a empresa muda por formulário.
- *Salva campo a campo?* No celular, a cada toque. Pro escritório, sobe o que está
  preenchido quando ele sai da tela; o que vier depois soma.
- *Corrigir depois?* Pode; o valor anterior fica guardado e o painel mostra "corrigido às".
- *O motorista vê o que já mandou?* Vê, inclusive em outro celular.

---

## As ondas (cada uma vai pro ar sozinha)

**Onda 0 — a base, invisível.** Estrutura de dados, catálogo do módulo, permissões e o
interruptor do app, que nasce desligado. Ninguém vê nada.

**Onda 1 — o cliente troca 3 dos 4 formulários.** (servidor e painel primeiro; o app vem
depois, com o servidor já no ar)
- Painel: montar formulários com a prévia do celular; oferta "Começar pelos modelos
  prontos" (Carregamento, Descarga, Acerto do frete — editáveis; oferta, não cadastro
  automático). Nos prontos, CT-e, MDF-e e comprovante de encerramento são **foto ou PDF**.
- App: a tela de documentos com todos os tipos — fotos várias, foto ou PDF (em celular
  com versão antiga do app, sem botão de PDF, foto da tela vale), sim/não, valor, texto,
  texto com foto, assinatura com nome. Sem sinal funciona igual.
- Onde ele acha: abre depois de Começar e de Finalizar; cartão "Documentos da carga —
  5 de 7" na viagem; aviso na tela inicial ("2 documentos pra completar"); histórico.
- O que falta: "Concluir e mandar depois" e a barreira "Antes de seguir" com motivo.
- Painel: seção "Documentos" na viagem — fotos, PDFs e assinatura abrem na própria tela;
  falta em amarelo com o motivo; **Anexar pelo escritório** e **Dispensar (com motivo)**
  ali mesmo; filtro próprio "Documento faltando" na lista de viagens (separado do filtro
  de divergência da conferência, que não muda).
- Liga primeiro pra **um motorista**; depois a empresa estende.

**Onda 2 — o escritório cobra.**
- Tela "Documentos pendentes" juntando todas as viagens, "seguiu sem" no topo, com
  **Cobrar no app** (notificação pro motorista).
- Aviso ao escritório quando alguém "seguiu sem" (notificação no painel e WhatsApp pro
  número da empresa, se ela quiser) — não avisa se o documento já tinha chegado.

**Onda 3 — o papel que vai pra agenciadora.**
- PDF da viagem com todos os documentos e a assinatura, e link pra mandar.
- Valor por tonelada informado ao lado do preço da tabela, com selo "diferente da tabela"
  (se a decisão 4 for essa). Nunca muda o valor da viagem.

**Depois (sem data):** ler a foto do CT-e/MDF-e e sugerir o número da chave (gente
confirma); juntar os PDFs num arquivo só. **Checklist do caminhão fica fora** — é do
caminhão, não da viagem, e está no módulo de Manutenção.

---

## O que atende o cliente na Onda 1 (os 4 formulários)

**Troca 3 dos 4. O 4º (despesas) depende de o Gasto de viagem aceitar PDF.**

| Formulário dele | Onda 1 | O que fica pra depois |
|---|---|---|
| 1. Controle de despesas (foto ou PDF da nota) | **Parcial**: o Gasto de viagem já recebe a **foto** (com GPS, sem sinal). Mas exige os módulos Gasto de viagem **e** Financeiro contratados. | **PDF no gasto** — pedido à squad de despesas. Até lá, nota em PDF vai por foto da tela. |
| 2. Carregamento | **Inteiro** (6 itens): ordem (foto ou PDF), valor por tonelada, pesagem Sim/Não + foto do ticket, CT-e (foto ou PDF), MDF-e (foto ou PDF), tacógrafo na saída. | Comparar o valor por tonelada com a tabela (Onda 3, se decidido). |
| 3. Descarga | **Inteiro** (6 itens, 4 Sim/Não): tacógrafo na chegada, "solicitei o encerramento do MDF-e", pesagem + comentário, canhoto assinado + fotos, comprovante de encerramento do MDF-e (foto ou PDF) com **"não seguir viagem sem este" funcionando** (barreira + motivo; escritório anexa ou dispensa), tacógrafo no fim. | Cobrar pelo app e aviso na hora (Onda 2). |
| 4. Acerto do frete | **Inteiro** (4 itens): transportadora (cidade) + foto da fachada, responsável (nome + foto), fotos do documento, assinatura no dedo com nome. | PDF pra mandar à agenciadora (Onda 3). |

Em tudo: quem preencheu, a placa, a hora de início e fim, o lugar do fim, e se ficou
guardado no celular esperando sinal — o que o Checklist Fácil grava hoje, menos a nota.
O que o Checklist Fácil **não** faz e a Onda 1 faz: cada formulário fica preso à viagem
certa, o que falta aparece sem depender do motorista, e o "não seguir sem" deixa de ser
só um texto.

---

## Decisões do dono (5)

| # | Decisão | Recomendação | Por quê |
|---|---|---|---|
| 1 | "Não seguir viagem sem este": parar e pedir o motivo, ou travar de verdade? (Pergunta 1 pro cliente.) | **Parar e pedir o motivo** — com "Já está com o escritório" entre as opções, e o escritório podendo anexar ou dispensar. Trava de verdade não entra. Se o cliente insistir depois de um mês usando, só com botão "Liberar o motorista" no painel. | Quem encerra o MDF-e é o escritório, não o motorista; travar pune quem não pode resolver, e motorista travado faz a viagem por fora do app — já aconteceu aqui. Primeiro medir quantas vezes alguém "segue sem". |
| 2 | Sim/Não: lista ou dois botões? (telas acima) | **Lista**, como todo o resto. | É a regra que você já deu; são 4 perguntas; um jeito só no app vale mais que um toque a menos. Se preferir os botões, é exceção só pro Sim/Não, sem custo de prazo. |
| 3 | Preço do módulo | **Mensalidade fixa por empresa, na faixa do Gasto de viagem, sem cobrar por formulário.** Fora do teste grátis; liga à mão pra quem pedir. | Foi um cliente que pediu e é o que separa a transportadora de estrada da de obra; quem não usa não paga nem vê. Cobrar por formulário faz o escritório economizar papel que precisava. |
| 4 | O "valor por tonelada" informado: só registra, ou o painel compara com a tabela? (Pergunta 2 pro cliente.) | **Registra e compara, com selo "diferente da tabela" — nunca muda o valor da viagem.** Comparação na Onda 3, depois de confirmar com o cliente. | É conferência do combinado na ordem. Usar como preço deixaria o motorista definir o faturamento. |
| 5 | Documento faltando segura o faturamento daquela viagem? | **Não.** Fica à vista como "documento faltando" e a viagem fatura normal. | Canhoto às vezes chega semanas depois; segurar a fatura por papel atrasa o caixa. Se algum cliente pedir, vira opção por empresa depois. |

---

## Riscos de produção

1. **App publicado antes do servidor, ou o interruptor mal conferido**: a tela aparece ou
   some pra quem não devia. Ordem fixa: servidor no ar → conferir, conta a conta, quem tem
   a função ligada → app.
2. **Cobrar todo mundo sem querer**: um modelo publicado vale pra todas as viagens de quem
   tem a função ligada. Por isso a função nasce desligada e o piloto é de uma pessoa —
   inclusive na Schaba, que não é transportadora de estrada.
3. **Pendentes do app sem os tipos novos**: formulário que não subiu some da tela e fica
   preso em "X com erro". Todos os tipos de envio de documento entram em Pendentes desde
   a Onda 1.
4. **PDF e fotos grandes no 4G ruim** (6 a 10 por formulário): um arquivo por vez, tempo
   de espera maior que o das fotos comuns, retoma de onde parou; PDF guardado num lugar
   que o iPhone não limpa sozinho.
5. **Formulário preso esperando a viagem**: o documento entra sempre, mesmo que a viagem
   ainda não tenha chegado ao servidor ou tenha sido cancelada — nunca fica na fila pra
   sempre.
6. **Arquivo de uma empresa aparecendo em outra**: o servidor confere que cada arquivo
   enviado é daquela empresa e daquele motorista; fotos fiscais só saem com login.
7. **Fila da conferência de ticket poluída**: "documento faltando" tem filtro e selo
   próprios e não aparece como divergência pro conferente.
8. **Outra squad mexendo na aba Gastos agora**: esta funcionalidade não toca nos arquivos
   do gasto; o campo de valor é reaproveitado, não copiado.

## Perguntas que continuam pro cliente

1. "Não seguir viagem sem este": parar, pedir motivo e deixar o escritório anexar/dispensar
   serve, ou ele quer travar? (Decisão 1.)
2. "Valor tarifa tonelada" é conferência do combinado ou o preço? (Decisão 4.)
3. Quem encerra o MDF-e: o escritório dele ou a agenciadora? Muda quem usa "Anexar pelo
   escritório".

---

# Pra quem implementa

Vale o desenho do `02-arquiteto.md` com estes ajustes (o que não está aqui segue igual).
Referências `Bn/In/Mn` são do `05-qa.md`.

1. **Momentos (B1):** `INICIO` (abre logo depois de `iniciarViagemGuiada` — é a carga),
   `FIM` (logo depois de Finalizar — é a descarga), `AVULSA` (acerto do frete) e `EVENTO`
   **só** pros tipos extras do catálogo (carga/descarga são bookends fixos e nunca geram
   `EventoViagem` na guiada, `lib/lifecycle.ts:396-404`). Em viagem lançada por
   `nova-viagem`, `INICIO` e `FIM` são oferecidos no fim do lançamento. `janelaDias`
   default **30** (M3), editável por modelo.
2. **Pendência calculada na leitura (B2, I10):** "o que falta" = viagem × modelos
   aplicáveis × respostas, no servidor; **resposta inexistente = todos os obrigatórios
   faltando**. Aplicável = modelo ativo, com versão publicada antes do início da viagem,
   motorista com `app.viagem.etapas` efetiva naquele momento (gravar `etapasAplicaveis`
   — ids de versão — na viagem quando ela é criada/iniciada, pra não depender do estado
   atual da capacidade). Nada de `ETAPA_PENDENTE` em `ViagemDivergencia`: "seguiu sem",
   dispensa e anexo do escritório ficam em tabela própria (`EtapaPendenciaAcao`: tipo
   `SEGUIU_SEM | DISPENSADO | ANEXADO_ESCRITORIO`, item, motivo, autor, GPS, hora). Filtro
   e selo "Documento faltando" próprios; `comDivergencia` (`admin/viagens/viagens.service.ts:224`)
   e o selo da lista não mudam. A barreira usa a mesma regra no app.
3. **Sem nota/peso:** tirar `peso`, `simNao.certo`, `nota` e `mostrarSe`. Tipos: `FOTO`,
   `ARQUIVO`, `SIM_NAO`, `VALOR`, `TEXTO`, `TEXTO_FOTO`, `ASSINATURA`. `lerItensEtapa`
   pula tipo desconhecido. `critico` vira `seFaltar: "AVISAR" | "NAO_SEGUIR"`, mais
   `escritorioPodeAnexar`. `ASSINATURA` valida o `d` com a regex de `assinaturaRecebedor`
   (`shared-types/src/viagem-lifecycle.ts:224-227`, M4).
4. **Modelos prontos (I11):** CT-e, MDF-e, comprovante de encerramento e ordem de
   carregamento como `ARQUIVO` (foto ou PDF), com ajuda "ou uma foto da tela".
5. **Unicidade (I9):** `@@unique([viagemClientId, modeloId])`; POST com `clientId`
   diferente pro mesmo par **mescla e devolve 200**, nunca 409/500. Correção vai pra
   `RespostaEtapaItemHistorico` (M7), sem segunda linha no item.
6. **Nunca esperar a viagem nem o evento (I7):** aceitar sempre com `viagemClientId` e
   amarrar quando a viagem chegar (molde `despesas.service.ts:263`).
   `removerItensLifecycleDaViagem` (`sync.ts:865-872`) passa a apagar etapa também.
7. **Outbox (I6, I8):** um `PendingEtapa` por resposta, upsert coalescido, guarda
   `aindaEOMesmoEnvio` (molde admissão, `sync.ts:1614-1618`); `seguiu-sem`/`completar` só
   depois do criar. Upload 120 s por arquivo, `lastTriedAt` renovado a cada arquivo; PDF
   copiado pra `documentDirectory`; comprimir só imagem; teto 10 MB. Todos os tipos em
   `app/pendentes.tsx` e `pendingCounts`. Rascunho e "viagem anterior" pelo storage
   carimbado por cadastro (M6); a barreira só olha viagem da mesma conta.
8. **Barreira (I2, M8):** local; com sinal, revalida por `GET m/etapas?viagemClientId=`
   com timeout curto antes de mostrar. Motivos: "Já está com o escritório", "Ainda não
   recebi", "Vou mandar mais tarde", outro (texto). No `nova-viagem` vira aviso sem motivo.
   Confirmação inline, nunca `showConfirm`; amarelo; texto "O escritório precisa deste
   documento" (M1). Onda 2: aviso ao escritório descartado no servidor se o item já foi
   suprido; envio por `EnvioWhatsappService.tentarEnviar` com rota nova.
9. **Módulo no servidor (I3):** `CONTRATO` está em sombra, então `@RequerCapacidade` não
   corta. Cada `m/etapas/*` confere `modulosDaConta`: `GET modelos` sem módulo → `[]`;
   `POST` sem módulo **aceita e carimba** (`aoPerder: VALA`), nunca 403.
10. **Capacidade e piloto (I4):** `app.viagem.etapas` com `nasceDesligada: true` (molde
    `app.locais.buscarEndereco`), `dependeDe: ["app.viagem.lancar"]`, `modulo: "etapas"`,
    `aoPerder: "VALA"`. Conta em `fonte: REGRAS` não herda pelo espelho de colunas — ligar
    por tipo de motorista. Schaba não é `ehPlataforma`: o módulo exige linha em
    `modulos_contratados` criada à mão. Antes do OTA, conferir conta a conta a fonte e
    `acessos_efetivos_app`.
11. **Arquivos (I5, I12, M5):** chave `${contaId}/etapas/${dia}/${motoristaId}/${sha}_${uuid}`;
    POST recusa (4xx → Pendentes) chave fora do prefixo (molde `exigirFotosDoMotorista`).
    `GET m/etapas/arquivos/:id` conferindo dono e conta; `<Image>` só com `token &&`.
    Painel busca como blob no client, `Content-Type` da lista `MIMES_DOCUMENTO`,
    `X-Content-Type-Options: nosniff`. "Apagar esta foto?" [Apagar] vermelho (M2).
12. **Módulo `etapas`:** `adicional: true`, sem `dependeDe`, recursos `etapas-viagem` e
    `etapas-respostas`; fora de `MODULOS_PADRAO`. Anexar/Dispensar no painel sob
    `etapas-respostas.editar` (chave nova no catálogo).
13. **Ondas × fatias do arquiteto:** Onda 0 = F0. Onda 1 = F1+F2+F3+F4 (sem
    `mostrarSe`) + barreira + pendência calculada + Anexar/Dispensar na seção Documentos +
    filtro próprio; dois pushes (API+painel, depois OTA). Onda 2 = tela consolidada,
    Cobrar, aviso. Onda 3 = F6 + comparação da tarifa.
14. **Formulário 1 (despesas):** não é etapa. PDF no `DespesaFoto` (falta `mime`; upload
    do motorista só imagem) é pedido à squad de despesas, sem tocar daqui.
