# 12 — QA da proposta "portas do gasto" (11)

Data: 06/10/2026 · QA da squad Despesas de Viagem. Nada de código alterado.
Revisa `11-portas-do-gasto.md` (alternativa A) contra o código no commit `8dd058ae`
e as regras do dono.

## Veredito em 3 linhas

1. **A A sobrevive**, mas a ordem da aba está trocada: o valor "Pra receber de volta" tem que
   vir **em cima** da lista "O que você pagou?". Com 6 a 8 tipos ele cai abaixo da dobra, e quem
   abre a aba pra saber "vou receber?" acha que ela só serve pra lançar.
2. A ideia de mostrar **pedágio e diesel "fora da soma"** parte de uma premissa errada: o acerto
   **já devolve** os dois por padrão. Sem uma frase dizendo isso, o motorista lê que pedágio não volta.
3. A home pode largar o gasto sem coachmark, porque hoje só o piloto (conta Movatruck) tem o módulo.
   O aviso "gasto sem viagem" não pode sumir junto: ele vira **número vermelho na aba**.

---

## Lastro (o 11 confere com o código?)

Bate: `index.tsx:670/680/743`, `meus-gastos.tsx:94`, `perfil.tsx:338`, `usePedagios` em
`lib/queries.ts:1059` sem nenhuma tela que use, Histórico › Pedágios listando viagens
(`historico.tsx:112`), a faixa só depois do `gasto-novo` (`novo-pedagio.tsx:155` e
`novo-abastecimento.tsx:446` fazem só `router.back()`).

Não bate:
- **"Não entram na soma enquanto o acerto não disser que devolve"**: o acerto já devolve.
  `ModalidadeMotorista.reembolsaPedagio/reembolsaAbastecimento @default(true)`
  (`schema.prisma:2800-2801`), e `calcularAcerto` gera `REEMBOLSO_PEDAGIO` (viagem + avulso) e
  `REEMBOLSO_ABASTECIMENTO`, só pulando comboio (`common/acerto-motorista.ts:231-275`). Isso não é
  promessa pro futuro, já está rodando.
- `usePedagios` busca `/m/pedagios?limit=10` (`queries.ts:1062`). Não dá pra reaproveitar no item
  8 do checklist sem paginar.

---

## Achados

### 1. Valor abaixo da dobra — IMPORTANTE
Evidência: maquete A do 11 (faixa → lista de 6 linhas de 64 px → card). `gasto-viagem.tsx`
`Linha` tem `minHeight: 64`. Com Pedágio + Abastecimento + 5 tipos + Outro dá 512 px de lista,
mais o cabeçalho e a faixa. Num celular de 390×844, tirando a barra de baixo, o card
"Pra receber" fica fora da tela. A faixa "sem botões" piora: ela diz "guardado" e o lugar onde
o gasto aparece não está à vista. A memória do dono pede exatamente isto: "o que o motorista
lançou tem que estar sempre à vista ('Ver meus gastos')".
**Correção:** a aba fica cabeçalho → faixa → **resumo compacto** (R$ + 2 linhas + botão
**Ver meus gastos** + "N sem viagem / Ligar à viagem") → "O que você pagou?". Lançar continua com
3 toques e ver com 1, sem rolar.

**Abrir na lista ou no resumo com botão "Lançar gasto"?** O resumo com botão laranja põe um toque
a mais em toda ação de lançar, que é a tarefa do dia (4 toques contra 3). E reabre o "lançar
outro" pela tela intermediária. O resumo compacto no topo com a lista logo embaixo pega o melhor
dos dois: o valor sem rolar e o lançamento sem a tela do meio. A lista é de navegação (linha +
chevron), não grade de botões, e nada vem marcado. Respeita `feedback_selecao_botoes_odiada` e
`feedback_nunca_preselecionar_motorista`.

### 2. "Ver meus gastos" some com R$ 0 — IMPORTANTE
Evidência: o 11 diz "Sem gasto nenhum ainda: o botão Ver meus gastos some". Pedágio e diesel não
entram no `useGastos` (só despesas do módulo + outbox). Com o item 8, eles aparecem em
"Todos", mas o botão estaria escondido justo pra quem lançou só pedágio, que é o caso mais comum.
**Correção:** o botão **Ver meus gastos** aparece sempre que `modulo.acompanhar`.

### 3. Pedágio/diesel "fora da soma" sem explicação — IMPORTANTE
Evidência: ver Lastro. O app não recebe as flags da modalidade (`grep reembolsa` no
motorista-app só acha o `devolve` do tipo). Se mostrar R$ 180 de diesel em "Todos" sem
status, e um "Pra receber de volta" que não inclui esse valor, ele lê que diesel não volta. Somar
também está errado: cartão da empresa (furo conhecido, vira conferência no acerto), comboio,
`DecisaoPedagioDobro` "MESMO_PEDAGIO" e a modalidade com `false` fariam o app prometer dinheiro
que não vem.
**Correção:** em "Todos", pedágio e diesel aparecem **sem valor somado**, com status neutro:
"O escritório confere no acerto". Quando já tem `ItemAcerto` ligado, mostra "No acerto de MM/AA".
Comboio mostra "Diesel da empresa". Embaixo do total vai uma linha fixa: "Pedágio e diesel não
entram nesta conta: o escritório confere e paga no acerto", com o botão **Ver meus acertos**
(`/meus-acertos` já existe). O status "No acerto" exige endpoint, então API antes do OTA.

### 4. Promessa no cabeçalho da lista — IMPORTANTE
Evidência: `gasto-viagem.tsx:55` traz "Vai pro escritório e volta pra você no acerto.". Na A isso
vira o título da aba, em cima de Abastecimento (que pode ter sido pago no cartão da empresa ou no
comboio, e aí ele nem pagou) e de tipos com "Por sua conta" (`gasto-viagem.tsx:104`).
**Correção:** trocar por "Pagou do seu bolso? Lance aqui com a foto." e não prometer devolução no
título.

### 5. "Aprovado — entra no próximo acerto" quando a modalidade não devolve — IMPORTANTE (já existe hoje, a A amplia)
Evidência: o schema diz "Devolve = o TIPO devolve E isto" (`schema.prisma:2802-2804`), e
`itensReembolsoDespesa` devolve `[]` com `reembolsaDespesa=false` (`acerto-motorista.ts:308`). Só
que `situacaoParaMotorista` (`common/despesa-regras.ts:167-189`) ignora a modalidade e soma em
"Pra receber" com o texto "entra no próximo acerto". A A põe esse número no alto da aba.
**Correção:** `paraMotorista` (`motorista/despesas.service.ts:97`) passa a ler a regra resolvida;
com `reembolsaDespesa=false`, a situação é POR_SUA_CONTA e `somaPraReceber=false`.

### 6. Faixa diz "enviado" pro pedágio/diesel offline — IMPORTANTE
Evidência: `components/gastos.tsx:514` faz `naFila = pend.some(...)` sobre `usePendingDespesas`.
O checklist (item 5) manda `novo-pedagio`/`novo-abastecimento` chamarem `marcarGastoSalvo`, mas
esses dois têm fila própria no outbox. Sem sinal, a faixa diria "Gasto enviado pro escritório.",
o que é falso.
**Correção:** o aviso leva o tipo (`despesa | pedagio | abastecimento`) e a faixa consulta a fila
certa.

### 7. Linha "pedágios · total" sai antes de o pedágio aparecer em Gastos — IMPORTANTE
Evidência: `index.tsx:794-803`. Hoje é o único lugar da home onde o pedágio do mês aparece. Se
sair antes do item 8, o pedágio some da home e de Gastos ao mesmo tempo.
**Correção:** a linha só sai no mesmo OTA que liga pedágio/diesel em "Todos".

### 8. O aviso "sem viagem" perde o lugar passivo — IMPORTANTE
Evidência: `CardPraReceber` (`components/gastos.tsx:301`) é hoje o único aviso fora da aba. Não
existe push de decisão de despesa (`grep` em `admin/despesas` e `despesas/` não acha envio). A
regra `feedback_funcionalidade_diaria_merece_aba` diz que card na home é **aviso**, e "gasto sem
viagem" é aviso: o gasto pode ser pago no acerto errado se ninguém ligar.
**Correção:** `tabBarBadge` na aba Gastos com o número de gastos sem viagem (mesmo estilo do chat,
`_layout.tsx`), sem card na home. A pergunta do Finalizar (S3) fica como está.

### 9. Home vazia sem rumo — MENOR
Evidência: o estado vazio "Nada pra lançar por aqui ainda" só aparece com `!modulo.lancar`
(`index.tsx:768`). Com a A, quem só tem o módulo (sem viagem) fica com a home em branco e sem
pista.
**Correção:** nesse caso, mostrar o cartão "Pedágio, diesel e seus gastos ficam na aba **Gastos**,
aqui embaixo".

### 10. Transição e tutorial — MENOR
Evidência: `lib/home-tutorial.ts:57-64`. Tirar o passo deixa o motorista novo sem nenhuma menção a
pedágio/diesel (os passos "pedagio"/"abastecimento" já são cortados com o módulo, `:65-80`). Hoje
só o piloto tem o módulo (ligado à mão, nenhuma migration concede), então ninguém real perde o
card. O coachmark de transição não precisa existir.
**Correção:** trocar o passo por um passo **sem alvo**: "Pagou pedágio, diesel ou comida? Lance na
aba Gastos, aqui embaixo." Se alguma empresa real tiver o módulo ligado antes da A sair, ela
recebe esse mesmo texto **uma vez**, numa chave nova de tutorial.

### 11. `voltar: "2"` quebra quando a lista mora na aba — IMPORTANTE (implementação)
Evidência: `gasto-viagem.tsx:42` e `gasto-novo.tsx:419-423, 483`. O "2" conta com a tela de tipos
no meio. Aberto direto da aba, `router.dismiss(2)` passa do topo da pilha.
**Correção:** o componente da lista recebe `voltar` como parâmetro: "1" na aba e "2" em
`/gasto-viagem`.

### 12. Renomear rota trocando o significado — IMPORTANTE
Evidência: o item 9 do 11 transforma `/meus-gastos` (gasto PESSOAL, `caderno`) na tela de
reembolso. Qualquer `push("/meus-gastos")` que ficar esquecido manda o "Anotar gasto" do caderno
pra tela que a empresa vê. É o mesmo tipo de armadilha que o próprio 11 aponta no diagnóstico.
**Correção:** o caminho nunca é reaproveitado com outro sentido. A tela de reembolso ganha nome novo
(`/gastos-lista`), `/meus-reembolsos` vira redirect pra ela e `/meus-gastos` vira redirect pra
`/anotar-gasto`. Atualizar também `gastos-sem-viagem.tsx:171`.

### 13. Seis abas pro motorista CLT que dirige — MENOR
Evidência: `_layout.tsx` fica com Início, Histórico, Ponto, Gastos, Conversas e Perfil, rótulo de
12 px. A A torna a aba a **única** porta, então o rótulo cortado custa mais caro.
**Correção:** testar num aparelho de 360 px antes do OTA. Se cortar, encurtar "Conversas" pra
"Chat", não mexer em "Gastos".

## Pergunta 4 — a A quebra alguma regra?

- **A empresa manda no app:** não quebra, desde que a lista na aba reaproveite o mesmo gating do
  `gasto-viagem.tsx:32-36` (`podeLancarPedagio && app.pedagio.lancar`, idem abastecimento). O item
  3 do checklist do 11 tem que dizer **"cards Pedágio/Abastecimento continuam sempre que
  `!modulo.lancar`"**, e não "sem o módulo". O caso que importa é a empresa **com** módulo que
  desligou `app.despesa.lancar` de um motorista: ele precisa continuar com os cards na home, e
  continua, porque a condição atual já é `!modulo.lancar`.
- **Nunca retirar acesso:** nada some sem o módulo. Com o módulo, as funções mudam de lugar e
  nenhuma deixa de existir. Pedágio/diesel continuam acessíveis (aba). O único "perde" é o card
  do piloto, que é a nossa conta.
- **Capacidade nova:** a A não cria nenhuma, e o badge não precisa de uma (depende de
  `app.despesa.acompanhar`). Os 9 testes de módulo não são afetados (é só UI do app).
- **Caderno sem interruptor** continua sendo dívida (memória `feedback_empresa_manda_no_app`),
  fora do escopo.
- **Tom:** "com o escritório", "Pra receber de volta" ok. O cabeçalho promete demais (achado 4).

## Checklist que falta no 11

1. Resumo compacto **acima** da lista. "Ver meus gastos" sempre visível (achados 1 e 2).
2. Copy do título sem promessa (achado 4).
3. `paraMotorista` respeita `reembolsaDespesa` da modalidade, deploy da API **antes** do OTA (achado 5).
4. Endpoint pra "Todos" com pedágio avulso + abastecimento + status do `ItemAcerto`, paginado por
   mês (não reaproveitar o `limit=10`). Linha fixa embaixo do total + **Ver meus acertos** (achado 3).
5. Faixa com o tipo do aviso e a fila certa (achado 6).
6. Linha "pedágios · total" da home sai no mesmo OTA do item 4 (achado 7).
7. `tabBarBadge` de "sem viagem" na aba Gastos (achado 8).
8. Estado vazio da home apontando pra aba (achado 9). Passo do tutorial sem alvo (achado 10).
9. `voltar` parametrizado (achado 11). Rota renomeada sem reaproveitar o caminho (achado 12).
10. Apagar a rota `/gasto-viagem` **só** do caminho de fora da viagem. `GastosDaViagem`
    (`components/gastos.tsx:385`) e o "Lançar outro" dentro da viagem continuam usando a rota.
11. Teste de tela de verdade: abrir a aba offline logo depois do login (com o quadro "tipos ainda
    não chegaram" no topo), conferir aparelho de 360 px com 6 abas e lançar pedágio sem sinal pra
    ver o texto da faixa.
