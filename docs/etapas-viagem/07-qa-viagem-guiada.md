# 07 — QA do redesenho da viagem guiada (06-ux-viagem-guiada.md)

Data: 06/10/2026. Revisão adversarial da proposta do 06 contra o código atual.
Nada de código foi alterado. Severidade: **BLOQUEIA** (não vai pro ar assim) ·
**IMPORTANTE** (corrigir antes do OTA) · **MENOR** (dá pra ir e corrigir depois).

Escopo das mudanças: só JS → só OTA, sem API. O salto automático só existe com
`CAP_ETAPAS` ligada (`iniciar-viagem.tsx:170-174`, `viagem-guiada.tsx:91-95`), então
tirá-lo não muda nada pra empresa sem o módulo. **Rótulo, tamanho, ordem e listas,
porém, mudam pra todo motorista com `podeViagemLifecycle`**, de toda empresa, de uma vez.

---

## (1) "Registrar descarga" no lugar de "Finalizar viagem"

**I-1 · IMPORTANTE: o rótulo mente em modo de serviço sem descarga.**
Não existe `mostraDescarga`. A régua é `regrasDoModo(...).exigeLocalDescarga`
(`packages/shared-types/src/tipo-servico.ts:88-99`). O finalizar esconde o bloco de descarga
quando ela é `false` (`finalizar-viagem.tsx:186-189` e `:707`). Nesse caso o motorista toca
"Registrar descarga" e cai numa tela que não tem descarga. A viagem-guiada já sabe calcular
isso, porque `LifecycleLocal.tipoServicoId` existe (`lib/lifecycle.ts:104`).
*Correção:* na viagem-guiada, calcular `regrasDoModo(escolherModoDaLista(cat.tiposServico, local.tipoServicoId))`
e usar "Registrar descarga" só quando `exigeLocalDescarga`. Nos outros casos, usar "Fechar a viagem".

**I-2 · IMPORTANTE: o rótulo esconde que esse toque FECHA a viagem.**
O botão abre o fechamento inteiro: material, toneladas, ticket, km, pedágio, foto, assinatura
e "aguardando peso" (`finalizar-viagem.tsx:594-640`). Ele não abre um "registro de descarga" que
volta pra viagem. Quem está treinado em "Finalizar viagem" procura esse nome e não acha. Quem
lê "Registrar descarga" espera um passo da espinha, como os outros "Registrar X"
(`viagem-guiada.tsx:839-841`), e se surpreende com um formulário de fim. Além disso, o
`DescargaPorGps` captura o GPS sozinho ao abrir (`autoIniciar`, `finalizar-viagem.tsx:719`).
Um toque "pra ver" ainda no pátio de carga grava a carga como descarga no rascunho.
*Correção:* nomear pela situação que ele reconhece ("Cheguei na descarga") e manter o título
da tela "Fim da viagem". Avisar a mudança de nome no mesmo OTA (anúncio no molde do
`anuncio-iniciar-viagem.tsx`).

**I-3 · IMPORTANTE: o botão continua dizendo "Registrar descarga" depois que a descarga já aparece como feita.**
Basta abrir o finalizar e voltar: o rascunho grava `localDescargaId`
(`finalizar-viagem.tsx:371-385`), e a linha do tempo passa a mostrar "✓ Descarga · X"
(`viagem-guiada.tsx:337-356`). O botão principal, porém, segue com "Registrar descarga".
São dois sinais contraditórios na mesma tela.
*Correção:* se `local.finalizarDraft?.localDescargaId` existir, o principal vira
"Continuar o fechamento", com o resumo do rascunho logo abaixo dele.

**M-1 · MENOR: os textos da barreira usam o verbo antigo.**
`iniciar-viagem.tsx:330` diz "…pra começar a viagem" e `finalizar-viagem.tsx:1057` diz
"…pra finalizar a viagem". Com o botão renomeado pra "Confirmar carga", os dois ficam
desencontrados.
*Correção:* trocar pelo nome novo do botão.

## (2) Sem salto automático: ele vai esquecer?

**I-4 · IMPORTANTE: item que só existe no pátio se perde, e a barreira chega tarde demais.**
No formulário CARREGAMENTO do cliente (`00-pedido-do-cliente.md:17-21`), três itens só
podem ser feitos no pátio: a foto do KM do tacógrafo na saída, o ticket da balança e a ordem
de carregamento. Depois que o caminhão anda, esses itens não podem mais ser refeitos. Hoje o
salto é o único empurrão no lugar certo. Sem ele, o que sobra não cobre o caso:
- **Barreira:** só pega `seFaltar === "NAO_SEGUIR"` da carga, e só no FINALIZAR, que acontece
  no destino (`lib/etapas-local.ts:894-905`). A essa altura, "Seguir sem isso" vira a regra.
- **Pendência no servidor:** só depois do sync, e é aviso pro escritório
  (`apps/api/src/motorista/etapas.service.ts:396-450`). Não lembra o motorista na hora.
- **Bloco da home:** conta a carga faltando (`lib/etapas-local.ts:1066-1081`), mas ele está na
  viagem-guiada, não na home.

O cartão "Agora" é a única cobertura real, e sai da dobra quando há ocorrência aberta ou
croqui, como na maquete 4.3.
*Correção:* manter o fim do salto e acrescentar um lembrete único, inline, quando ele tocar
qualquer outra ação ("Registrar descarga", "Outros registros") com a carga em 0 de N:
"Faltou a foto do tacógrafo da saída. Preencher agora / Depois". Sem pop-up e sem trava.

**I-5 · IMPORTANTE: some o croqui/autorização do pedido.**
A "Ordem nova" do 06 §3(c)5 não lista `DocumentosDaViagem` (`viagem-guiada.tsx:266`). Quem
implementar ao pé da letra apaga o croqui da tela, ou coloca acima do "Agora" e empurra o
cartão pra baixo.
*Correção:* declarar a posição: logo depois do "Agora", nunca antes.

**I-6 · IMPORTANTE: depois de finalizar, voltar faz a tela piscar de novo.**
No estado "Viagem finalizada" do 4.6, a pilha é home → viagem-guiada → finalizar. O espelho
local já foi apagado. Se ele usar o voltar do Android ou o gesto de voltar do iOS, cai na
viagem-guiada. Ela mostra o spinner e faz `router.replace("/")` (`viagem-guiada.tsx:64-74`).
É o pisca que o 06 quer matar. Tirar a seta do cabeçalho, como o 4.6 propõe, não segura o
voltar do sistema.
*Correção:* nesse estado, usar `gestureEnabled:false` e um `BackHandler` que leva pro início
com `router.dismissAll()` + `replace("/")`. O mesmo vale pro "Ir pro início".

**M-2 · MENOR: o 06 desfaz o combinado do 03/04 sem registrar a mudança.**
O `03-ux.md:57-61` e o `04-proposta.md:94-95` foram aprovados com "abre sozinha logo depois".
*Correção:* uma linha no 04: "decisão revista em 06/10 — convite, não salto".

## (3) Risco em produção pra todas as empresas

- Não há risco nestes pontos:
  - **Voz da navegação:** não fala nome de botão (`lib/navegacao.ts:27-306`).
  - **Telemetria `nv_*`:** é só da nova-viagem e da descarga (`lib/telemetria-viagem.ts`), e
    nenhum evento usa rótulo.
  - **Deep links e push:** nenhum aponta pra viagem-guiada, finalizar ou iniciar
    (`app/_layout.tsx:256, 626`).
  - **Coachmark:** o `home-tutorial.ts:47-52` mira `coach-iniciar-viagem`, que é o card de GPS
    (`index.tsx:646`), não a guiada.
- **M-3 · MENOR: nenhum teste cobre esse fluxo.**
  O `tests/e2e/` é só do painel e o app não tem nenhum teste. A rede de segurança é manual.
  *Correção:* roteiro manual obrigatório antes do OTA, em Android pequeno (360dp) e no iPhone:
  1. empresa sem Etapas;
  2. com Etapas;
  3. modo sem descarga;
  4. aguardando peso;
  5. offline.
- **I-7 · IMPORTANTE: o botão principal quebra em duas linhas.**
  Os rótulos novos são "Preencher documentos da carga" (29 caracteres) e "…da descarga" (32),
  em `lg` (h-16 fixo) com `text-lg` bold, dentro de cartão `p-4` e com ícone. Num Android de
  360dp sobram cerca de 225dp pro texto: quebra em duas linhas e corta dentro da altura fixa.
  A própria maquete 4.6 já desenha o botão quebrado. Fonte ampliada, comum em motorista mais
  velho, piora o corte.
  *Correção:* usar "Preencher a carga" / "Preencher a descarga" (o título do cartão já diz
  "Documentos") e `numberOfLines={1}` + `adjustsFontSizeToFit`.

## (4) Linha do tempo descendo pro fim da tela

**I-8 · IMPORTANTE: some a confirmação de registro e ele registra duas vezes.**
Evento sem duração ("Parada", "Pesagem") só aparece na linha do tempo. Não vira cartão de
ocorrência aberta (`viagem-guiada.tsx:136-139`), e o retorno ao registrar é só a vibração
(`:182-187`). Com a linha do tempo abaixo de Gastos, ele toca "Parada" e não vê nada mudar
na tela. Ele toca de novo.
O resumo do rascunho do fechamento (material, toneladas, ticket, km) também mora na linha do
tempo (`:358-374`). Descer junto esconde que ele "já começou a finalizar".
*Correção:* mostrar uma faixa "✓ Parada registrada às 14:05" no topo por alguns segundos e
mover o resumo do rascunho pra baixo do botão principal (ver I-3). Feito isso, a linha do
tempo pode descer.

## (5) Regras do dono

**I-9 · IMPORTANTE: pré-seleção na tela "Começar viagem", que a maquete esconde.**
A maquete 4.2 mostra "Escolha a placa" vazia. O código, porém, pré-seleciona a placa padrão
(`iniciar-viagem.tsx:84-89`). O Select de modo também aparece com o padrão da conta já
marcado (`value={modo?.id ?? ""}` com fallback pro padrão, `:259` + `escolherModoDaLista`).
Com o botão virando "Confirmar carga", ele "confirma" uma placa e um modo que o app escolheu
por ele. É o caso exato da `feedback_nunca_preselecionar_motorista`.
*Correção:* placa e modo nascem vazios, a placa padrão vira sugestão visível no Select
("sua placa de sempre"), e a escolha passa pela validação guiada.

**I-10 · IMPORTANTE: a lista de linhas fere duas regras do dono.**
1. `feedback_acao_e_botao_com_icone`: toda AÇÃO é `<Button>` com ícone e verbo. Lista e
   Select são pra ESCOLHER um valor. "Fila" e "Parada" são ações, cada uma abre um registro.
   O argumento do 06 ("lê como o menu de um Select, que ele já aprovou") inverte a regra.
2. `feedback_alvo_sem_corpo_nao_existe`: altura mínima de 72 e quadrado de ícone de 48.
   O 06 propõe h-14 (56).

*Correção:* fazer uma coluna de `Button variant="outline"` `w-full justify-start`, com ícone
de 22 e o mesmo tamanho em todas. Mantém "linhas iguais" e não vira grade de seleção.

**M-4 · MENOR: "Voltar pra viagem" fica errado em metade das entradas.**
A tela `/etapa` também abre da home e da lista de documentos (`bloco-etapas-home.tsx:38`),
da barreira (`barreira-etapas.tsx:160, 267`) e depois do fim da viagem (FIM/AVULSA). Nesses
casos não existe "viagem" pra voltar.
*Correção:* mostrar "Voltar pra viagem" só se a viagem estiver EM_ANDAMENTO e for a do
cartão. Nos outros casos, "Voltar".

**M-5 · MENOR: o título "Documentos da carga" é fixo e ignora o catálogo.**
O cartão mostra `modelo.nome` (no cliente é "CARREGAMENTO"), e o `iniciar` usa o primeiro
modelo INICIO (`iniciar-viagem.tsx:158`). Se a conta tiver dois modelos de carga, o "Agora"
mostra um só.
*Correção:* o "Agora" lista todos os modelos INICIO, cada um com o seu nome.

**M-6 · MENOR: documentos podem passar na frente de um passo que a empresa ordenou.**
O 06 §3(c)2 põe "documentos da carga" antes do passo obrigatório do catálogo. Se a empresa
tiver "Pesagem" como passo obrigatório, o ticket que o documento pede só existe depois desse
passo.
*Correção:* os documentos só viram o principal quando o próximo passo obrigatório for nulo,
ou quando não houver passo antes da descarga. Caso contrário, ficam no cartão "Agora" como
botão contorno.

**M-7 · MENOR: falta um item no inventário.**
O cartão herói da home "Começar viagem" é um `Pressable` sem botão (`index.tsx:569-590`).
O 06 conserta o "Continuar viagem" (4.7), mas deixa esse "igual hoje".
*Correção:* aplicar o mesmo padrão título + botão, ou registrar a exceção.

Sem achados de multi-tenant, SQL cru, MinIO ou outbox: a proposta não toca em dado nem em API.
