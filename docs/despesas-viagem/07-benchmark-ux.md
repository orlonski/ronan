# 07 — Benchmark de UX: lançamento de despesa no celular

Data: 05/10/2026. Autor: pesquisa de UX/produto da squad de Despesas de Viagem.
Escopo: como os melhores produtos resolvem os 5 padrões que o dono pediu. Fontes são
páginas de ajuda oficiais, anúncios de produto e reviews (Capterra/GetApp/App Store).

> Ressalva de método: as telas abaixo foram reconstruídas a partir da documentação de
> ajuda (passo a passo, nomes de botões) — não abri os apps. Onde a doc não descreve a
> tela, eu digo. Duas páginas (Motive e Samsara KB) bloquearam leitura direta (403);
> uso o trecho indexado pela busca.

---

## Padrão 1 — Lançar sem vínculo e vincular depois

A ideia que todos os grandes adotaram: **a despesa nasce solta** (sem relatório/viagem) e
vive numa lista própria até alguém — o usuário ou a máquina — dizer a qual "pacote" ela
pertence. Ninguém obriga a escolher o pacote na hora da foto.

### Referências

**Expensify — "Unreported expenses"**
- [Como adicionar despesa a um relatório (comunidade Expensify)](https://community.expensify.com/discussion/comment/19754/) · [Manually create a report](https://community.expensify.com/discussion/4738/how-to-manually-create-a-report)
- Tela: a aba **Expenses** lista tudo, com um selo de estado em cada linha (Unreported / Open / …). Cada linha tem caixinha de seleção → **vincular em lote** marcando várias e "Add to report".
- Dentro de uma despesa aberta, o campo **Report** fica no pé do formulário: escolher relatório existente, criar novo, ou deixar **"Automatic"** — o app cria/acha o relatório aberto sozinho. É o default que elimina a decisão.
- Caminho inverso: criar o relatório e tocar "add expenses" → abre a lista dos soltos pra marcar.

**SAP Concur — "Available Expenses" + Expense Assistant**
- [Discussão "Available Expenses" (Concur Community)](https://community.concur.com/t5/Concur-Expense-Forum/Available-Expenses/td-p/9469) · [Guia mobile Concur (PDF)](https://ndaa.org/wp-content/uploads/MobileGuide_iPhone.pdf) · [Expense Assistant (UMBC)](https://doit.umbc.edu/post/160166/)
- Tela: **Available Expenses** é a "gaveta" de tudo que não está em relatório (fotos do ExpenseIt, transações do cartão, quick expenses). No mobile: selecionar → "+" (relatório novo) ou escolher relatório existente da lista.
- O ExpenseIt tenta casar a foto com a transação do cartão sozinho; se não casar, na edição do relatório há "Import Expenses" → lista de recibos disponíveis → **Match**.
- **Expense Assistant**: com a viagem (itinerário) existente, as despesas importadas **entram sozinhas no relatório daquela viagem** por data. É o "vínculo sugerido por data" levado ao extremo (automático).

**Ramp — Receipt inbox / matching**
- [Troubleshooting receipt matching](https://support.ramp.com/troubleshooting-transaction-receipt-matching) · [Submitting reimbursements](https://support.ramp.com/submitting-reimbursements)
- Recibo entra por foto no app, SMS ou e-mail e **casa sozinho** com a transação por data/valor/estabelecimento. Recibo que chegou antes da transação "postar" pode não casar ou casar com a transação errada do mesmo fornecedor (eles documentam isso — vale pra nós: o lançamento do motorista pode chegar antes da viagem existir no servidor).
- Foto salva como **draft receipt**; rascunhos em *My Expenses > Reimbursements > Drafts*, com **ações em lote** pra completar e enviar vários.

**Brex — "View unmatched receipts"**
- [Manage your unmatched receipts in one place](https://www.brex.com/product-announcements/manage-your-unmatched-receipts-in-one-place.md) · [Receipts for expenses](https://www.brex.com/support/receipts-for-expenses)
- Tela: na Wallet, um botão **"View unmatched receipts"** abre a lista única de recibos soltos; de cada um: "criar reembolso" ou "casar com despesa".
- O auto-match aceita **2 de 3** (data, valor, estabelecimento) — tolerância explícita.
- Cobrança: push/SMS **2–7 dias** depois da despesa se faltar recibo/memo; e-mail toda segunda até resolver.

### Leitura pro Movatruck
O "relatório" deles é a **viagem** nossa. O padrão vencedor é: (1) gaveta única de soltos,
(2) vínculo automático quando há uma só candidata óbvia (Expense Assistant / "Automatic"),
(3) sugestão quando há dúvida, (4) seleção múltipla pra vincular em lote. Lembrete: a
proposta já tira o vínculo do pedágio avulso da Onda 0 (B3) — o padrão abaixo vale pro
**Gasto de viagem**, não pra reabrir aquela decisão.

---

## Padrão 2 — Viagem primeiro, despesa dentro dela (trip-centric)

### Referências

**Super Dispatch (app do motorista)**
- [How to Add Expenses in the Driver App](https://support.superdispatch.com/hc/en-us/articles/45582869139859-How-to-Add-Expenses-In-the-Driver-App)
- Tela: Loads → abre a carga → **rola até o fim** do detalhe → "Add Expense". Formulário: **Tipo** (Fuel, Towing, Pulling Fee, Storage, Other — lista curta), **Valor**, **Data**, **Foto do recibo (recomendada, não obrigatória)**, chave "Include on Invoice". Cinco campos, a viagem já vem do contexto.
- Ponto fraco: o botão no fim da página é escondido — exige rolar.

**TruckLogics**
- [How to manage expenses for a dispatch](https://support.trucklogics.com/art/11938/how-to-manage-expenses-for-a-dispatch) · [Adding a Fuel Expense](https://blog.trucklogics.com/?p=4097)
- Tela: dentro do dispatch → **Expense → +Add Expense**: data, favorecido (agenda de fornecedores), forma de pagamento, valor, clipe pra foto, categoria em dropdown. É o anti-exemplo de quantidade de campos (6–7, contábil).

**Rigbooks** (owner-operator)
- [Features](https://rigbooks.com/features) · [Capterra](https://www.capterra.com/p/127787/Rigbooks-com/)
- Review citado: *"really easy to add details of each trip & associate the expenses incurred with each trip"* — o valor percebido é a despesa **ficar dentro da viagem** pra calcular lucro por milha.

**GestLog / ADM Frota / Bsoft (Brasil)**
- [GestLog na App Store](https://apps.apple.com/bb/app/gestlog/id1498459917) · [ADM Frota/Infleet/etc. (App Store)](https://apps.apple.com/us/app/id1645158123) · [Bsoft — Controle de viagens](https://bsoft.com.br/bsoft-tms/controle-de-viagens) · [Bsoft — Acerto com motorista](https://bsoft.com.br/bsoft-tms/acerto-com-motorista)
- GestLog: motorista lança "fretes, despesas, adiantamentos, devoluções" e sincroniza com o painel; envio de foto **offline**; gera relatório de acerto imprimível. Changelog de 2024 corrige "cursor em valores decimais" no campo de despesa — o campo de dinheiro é onde os apps BR tropeçam.
- ADM Frota: lança frete, despesa (pedágio, manutenção, refeição), abastecimento e "caixa do motorista".
- Bsoft: despesas e receitas **por viagem**, pagas pela empresa **ou pelo motorista**, adiantamento/devolução por viagem → acerto. Lançamento é do escritório (o app não é o foco).
- **Cobli / Infleet**: o app do motorista cobre veículo do dia, abastecimento e jornada — **não achei lançamento de despesa geral**. Não usar como referência pra isso.

**Concur / TripIt**
- Concur cria relatório a partir do itinerário (TripIt) — a viagem "abre o envelope" e as despesas caem dentro. Ver Expense Assistant acima.

### Leitura pro Movatruck
Os apps de caminhão vinculam pela **tela de onde você partiu** (estava na carga → a despesa
é da carga). Isso é grátis em UX e nós já temos: a viagem em andamento. O erro deles é
esconder o botão no fim do detalhe e copiar formulário contábil (favorecido, forma de
pagamento) pro motorista.

---

## Padrão 3 — Tipos configuráveis sem poluir a tela

### Referências

**Expensify — Category rules / Field requirements**
- [Workspace Rules](https://help.expensify.com/articles/new-expensify/workspaces/Workspace-Rules) · [Enable expense violations](https://help.expensify.com/articles/expensify-classic/workspaces/Enable-and-set-up-expense-violations)
- Por categoria o admin define: **exigir recibo**, **dispensar recibo**, exigir descrição, exigir participantes, exigir recibo itemizado, **teto por despesa ou por dia**, aprovador, e um **"Description hint"** — texto de ajuda que aparece *só quando aquela categoria é escolhida*.
- Regra geral da conta: "recibo obrigatório acima de X".
- Regra quebrada **não bloqueia o envio**: vira *violation* marcada e o aprovador decide. (Casa com o nosso "lançamento nunca é recusado".)
- "Expense defaults": preenche campos sozinho por estabelecimento ou categoria.

**SAP Concur — formulário por tipo de despesa**
- [Managing Expense Forms](https://learning.sap.com/courses/getting-started-with-concur-expense-standard-basic-configuration/managing-expense-forms) · [Attendee forms](https://learning.sap.com/courses/getting-started-with-concur-expense-standard-basic-configuration/managing-attendee-forms)
- Cada **tipo** tem seu formulário; cada campo é **Oculto / Somente leitura / Opcional / Obrigatório** por tipo. É exatamente o "litros só no combustível". Poderoso e é por isso que o Concur tem fama de pesado — a configuração vira tela cheia.

**Expensify — abas de criação**
- [Create an expense](https://help.expensify.com/articles/new-expensify/expenses/Create-an-expense)
- Botão "+" verde → abas **Scan / Manual / Distance / Per diem**. Scan é a câmera direto; tem **multi-scan** (raio) pra fotografar vários papéis em sequência. Na distância, categoria/descrição ficam em **"More options"**.

**TripLog — "Show more"**
- [What's New at TripLog – July 2025](https://updates.triplog.net/publications/whats-new-at-triplog-july-2025)
- Redesenharam o formulário escondendo campos raros (taxas, local, lembrete) atrás de **"Show more"**. Divulgação progressiva explícita.

**Foto-primeiro com IA (frota)**
- Motive: [AI-powered Document Capture](https://helpcenter.gomotive.com/hc/en-us/articles/36712599468189-AI-powered-Document-Capture-for-Fuel-Receipts-and-Bills-of-Lading) — foto do cupom de diesel → IA extrai preço, quantidade, estado e local. Tem **entrada manual** pra quando a bomba não imprime cupom.
- Samsara: [blog Documents](https://www.samsara.com/blog/new-in-documents-more-document-types-easy-uploads-open-apis) · [KB fuel receipt](https://kb.samsara.com/hc/en-us/articles/40137562543501) — formulário "Fuel Receipt" com **AI Extract** que pré-preenche a partir da foto; é alternativa explícita pra quem não tem integração com cartão.
- Flash (BR): [Leitura automática OCR](https://flashapp.com.br/novidades-de-produto/leitura-automatica-ocr) — OCR de nota/cupom "amassado ou riscado"; política por categoria (limite, categoria permitida, prazo) checada no envio.

### Leitura pro Movatruck
O que funciona é **a categoria decidir o formulário** (Concur), mas com o admin vendo
só 3 interruptores por tipo (Expensify: exige foto? teto? dica?) — não a matriz de
campos do Concur. O motorista vê: tipo → foto → valor; o resto em "Mais detalhes".

---

## Padrão 4 — Antiduplicação

### Referências

**Expensify — Duplicate detection**
- [How to find and resolve flagged duplicates](https://help.expensify.com/articles/new-expensify/reports-and-expenses/Duplicate-Detection) · [Why expenses duplicate](https://help.expensify.com/articles/new-expensify/reports-and-expenses/Why-Expenses-Duplicate)
- Critério base: **valor + moeda + data**. Com recibo lido, soma estabelecimento, nº do pedido/nota, final do cartão, CEP — pra **reduzir falso positivo** (duas compras iguais no mesmo posto no mesmo dia).
- Hotel/fatura: casamento por **intervalo de datas**.
- A despesa vai pra **hold** com selo **Fix**; tela "Review duplicates" mostra as candidatas com **radio** pra escolher qual fica → **"Keep all"** ou **"Keep selected"**, e resolve diferenças de categoria antes de confirmar. Aviso "Potential duplicate" aparece **nas duas**.
- Só resolve com relatório em rascunho/pendente; aprovado/pago tem que ser retraído antes (bate com nosso "FECHADO não regenera").
- Revisão automática em segundo plano tira a bandeira quando tem certeza de que são compras diferentes.

**Expensify — Cartão × recibo (o caso do diesel no cartão)**
- [SmartScanned receipts merge with card transactions](https://community.expensify.com/discussion/717/smartscanned-receipts-now-merge-with-submitted-card-transactions) · [How to prevent duplicate expenses](https://help.expensify.com/articles/expensify-classic/expenses/How-to-prevent-duplicate-expenses)
- Foto e transação do cartão **viram uma despesa só** quando: valor igual (com tolerância), mesma data, **uma única candidata**, e o cartão posta em até **7 dias**. Não funde se o usuário editou os dados lidos, se a foto já casou com outra, ou se as duas são de cartão.

**Ramp — duplicata de reembolso**
- [How are duplicate reimbursement claims detected?](https://ramp.com/answers/reimbursement-compliance/duplicate-reimbursement-claims-detected)
- Compara **imagem do recibo** + dados extraídos (valor, data, fornecedor) contra **todos** os envios anteriores; pega a mesma foto reenviada em outro relatório. Sinaliza na fila do aprovador **com a explicação do porquê**; aprovador confirma ou derruba.

**Fleetio / Motive — combustível**
- [Fleetio: Duplicate Fuel Entries](https://help.fleetio.com/en_US/duplicate-fuel-entries) · [Motive: Fuel Purchases](https://helpcenter.gomotive.com/hc/en-us/articles/30922738883357-Fuel-Purchases)
- Fleetio: duplicata = **veículo + data/hora** ou **data/hora + litros + total**. Tela "Find Duplicates" com **Merge All / Merge Set / Edit**; após juntar, **recalcula consumo e custo**.
- Motive: aceita diesel por cartão, foto, CSV e manual, e a regra documentada é **"cada abastecimento por um só caminho"** — ou seja, não resolvem, empurram pro cliente. Anti-exemplo.

**Brasil — chave fiscal**
- NFC-e/NF-e têm chave de 44 dígitos no QR do cupom; a SEFAZ rejeita duplicidade pela chave (rejeição 204). Apps de finanças pessoais leem o QR mas usam só data e valor ([trabalho UFGD](https://repositorio.ufgd.edu.br/jspui/bitstream/prefix/4644/1/EricHenriqueHellerLopes.pdf)). **Ninguém do benchmark usa a chave como trava de duplicata** — é vantagem nossa: `common/chave-fiscal.ts` já valida DV e modelo.

### Leitura pro Movatruck
Três camadas, da mais forte pra mais fraca: (1) **chave fiscal igual = mesma nota** (quase
certeza); (2) **hash da foto igual** = mesmo papel reenviado; (3) **valor + dia + motorista
(+ tipo)** = suspeita. Nunca apagar sozinho: marcar as duas, mostrar lado a lado, humano
escolhe "é o mesmo / são diferentes" — o mesmo desenho que a proposta já usa pro pedágio
em dobro (0b). Combustível do cartão: casar com o extrato que já importamos
(`project_cartao_combustivel` casa por dia) e mostrar "já veio no cartão", em vez de
pedir ao cliente pra escolher um só caminho como o Motive.

---

## Padrão 5 — Telas concretas e anti-padrões

### O que as telas boas têm em comum
- **Um botão grande de câmera** como ação principal (Expensify "+" verde → Scan; Brex scan; Ramp foto→draft).
- **Lista curta de tipos** (Super Dispatch: 5) e "Outro".
- **3–5 campos visíveis**; o resto atrás de "Mais opções"/"Show more" (TripLog, Expensify Distance).
- **Rascunho salvo sozinho** e lista de rascunhos com ação em lote (Ramp Drafts).
- **Selo de pendência por linha** (Expensify "Fix", Brex "missing receipt") em vez de modal.
- **Lembrete com prazo** pra papel faltando (Brex: push em 2–7 dias).
- **Entrada manual quando não há papel** (Motive: bomba sem impressora).

### Anti-padrões que os reviews cobram
- **OCR lento ou que erra**: *"smartscan takes entirely too long… inputting manually is 100% faster"*; *"only works like 10% of the time"* ([Capterra Expensify](https://www.capterra.com/p/97594/Expensify/reviews/?page=21), [Happay compilado](https://happay.com/blog/expensify-reviews)). Bloquear o envio esperando o OCR é o pior dos dois mundos.
- **Ícones sem texto e lista de relatórios ininteligível** ("confusing because they use a lot of icons") — mesma fonte.
- **Categoria que some no app** mas existe na web — sincronia de catálogo falha.
- **Duplicatas de transação** e exigir "atenção a detalhe" do usuário ([GetApp Concur](https://www.getapp.com/finance-accounting-software/a/concur-expense/reviews/)).
- **Botão no fim da tela de detalhe** (Super Dispatch) e **formulário contábil no celular** (TruckLogics: favorecido, forma de pagamento).

---

## O que o Movatruck deve copiar (10, de tela)

1. **Botão "Gasto de viagem" abre direto na câmera** (como o Scan do Expensify), com "Sem papel? Digitar" embaixo — o Motive prova que bomba/borracheiro sem cupom é caso comum. Foto nunca espera OCR: a foto salva e o valor é digitado já.
2. **Tela de lançamento com 3 coisas visíveis**: tipo (grade de ícones **com nome**, os 6 mais usados da empresa + "Outro"), valor (teclado numérico, máscara R$ que não pula o cursor — o bug do GestLog), e a viagem pré-preenchida num chip "Viagem de hoje: Pedreira → Obra X · trocar". Data/hora, observação e campos do tipo ficam em **"Mais detalhes"** (TripLog).
3. **A viagem vem do contexto, como no Super Dispatch** — mas o botão fica **no topo** da viagem em andamento e na home, nunca no fim da rolagem.
4. **Campo condicional por tipo, configurado com 3 interruptores no painel**: "pede foto?", "teto por gasto", "dica pro motorista" (o *Description hint* do Expensify, ex.: "Chapa: escreva quantos ajudantes"). Campos extras (litros, km) só aparecem pro tipo que os declara — modelo Concur, mas sem a matriz oculto/opcional/obrigatório na cara do admin.
5. **Regra quebrada não bloqueia**: acima do teto ou sem foto, o gasto entra com selo amarelo "acima do combinado / sem foto" e vai pra conferência (violation do Expensify = nosso "lançamento nunca é recusado").
6. **Gaveta "Sem viagem"** no app (Brex "unmatched receipts"): lista dos gastos soltos, cada linha com a **sugestão** "Parece ser da viagem de 03/10 (Pedreira → Obra X) · Ligar" quando há **uma só** viagem do motorista naquele dia; com várias, abre a escolha só entre as do dia.
7. **Vincular em lote no painel**: na fila "Conferir gastos", filtro "sem viagem", caixinhas e "Ligar à viagem…" com a viagem sugerida por motorista+dia (Expensify Add to report / Concur Available Expenses). Vínculo automático **só** quando a candidata é única e a viagem está fechável — senão fica sugestão.
8. **Duplicata em três camadas, mostrada lado a lado**: chave fiscal igual (QR do cupom, `chave-fiscal.ts`) → "mesma nota"; hash da foto igual → "mesma foto"; valor+dia+motorista+tipo → "parecido". As duas linhas recebem o selo; o conferente escolhe **"É o mesmo gasto (tirar este)" / "São gastos diferentes"** (Expensify Keep selected/Keep all), com autor. No app, ao salvar, aviso não bloqueante: "Você já lançou R$ 45,00 de Almoço hoje às 12:10. Lançar mesmo assim?".
9. **Diesel do cartão casa, não duplica**: se o tipo for combustível e o extrato do cartão já tem abastecimento do mesmo caminhão no dia com valor dentro da tolerância, o gasto aparece no painel como "já veio no cartão da empresa — conferir" e fica fora do reembolso até alguém decidir (regra do Expensify: uma única candidata, janela de dias, não funde se já casou com outra).
10. **Pendência como selo + lembrete com prazo**: na lista "Gastos de viagem" do motorista, cada linha mostra estado em palavra ("Enviando", "Na conferência", "Falta foto", "Aprovado — vai no acerto") e o "pra receber de volta" no topo; push/WhatsApp pelo `EnvioWhatsappService` 2 dias depois se ainda faltar foto (Brex), nunca diário.

## O que evitar (5)

1. **Esperar o OCR/IA pra deixar salvar** — reviews do Expensify mostram que o usuário prefere digitar. IA só sugere e preenche depois; nunca afirma (memória `feedback_ia_nunca_afirma`).
2. **Formulário contábil no celular** (favorecido, forma de pagamento, centro de custo — TruckLogics). Isso é do escritório, no painel.
3. **Ícone sem nome** e lista de tipos longa (Expensify). Grade de no máximo 6 + "Outro", sempre com rótulo.
4. **"Escolha um caminho só pra não duplicar"** (Motive) — empurrar a deduplicação pro cliente. Nós casamos e avisamos.
5. **Apagar ou fundir duplicata sozinho** — inclusive o "merge automático" do Expensify fora do caso de candidata única. Aqui dinheiro do motorista some; toda fusão é humana, com autor, e acerto FECHADO/PAGO não muda.
