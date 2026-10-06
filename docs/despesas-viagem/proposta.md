# Despesas de Viagem — proposta do módulo

Data: 05/10/2026. Squad: campo (`01-campo.md`), financeiro (`02-financeiro.md`), arquiteto
(`03-arquiteto.md`), UX (`04-ux.md`), QA (`06-qa.md`). Esta é a versão final, já com
todos os achados BLOQUEIA e IMPORTANTE do QA (B1–B10) e os menores (B11–B16).
**Nada implementado. Nada sai sem o dono aprovar.**

> Nome no app: o gasto que vai pro escritório se chama **"Gasto de viagem"**. "Lançar gasto"
> e "Meus gastos" já são do caderno pessoal (`meus-gastos.tsx`, "nenhuma empresa vê") e não
> podem ser reaproveitados (B7).

---

## 1. O módulo em uma frase

**"O motorista lança o gasto da estrada com a foto do papel, mesmo sem sinal; o escritório confere com a foto do lado; e o dinheiro volta pra ele sozinho no acerto."**

### Em um parágrafo (pro dono e pra proposta comercial)

Hoje o motorista só consegue lançar pedágio e diesel. Almoço, borracharia, chapa, lavagem, estacionamento e pernoite ficam no bolso dele, num papel que desbota na boleia, e viram discussão no fim do mês. Com o módulo, ele toca em **"Gasto de viagem"**, escolhe o que foi, fotografa o papel e digita o valor — três toques, funciona sem sinal e o app já sabe de qual viagem é. O escritório abre uma fila **"Conferir gastos"**, vê a foto ao lado do valor e aprova (ou aprova outro valor, ou diz que não vai devolver, sempre com motivo escrito). O que foi aprovado entra sozinho no acerto, numa linha própria "Reembolso de gastos", e o motorista acompanha no app quanto tem **"pra receber de volta"**. Quem decide o que a empresa devolve é a empresa, uma vez, no cadastro — não o motorista a cada lançamento.

---

## 2. Ondas

Cada onda vai pro ar sozinha e já resolve alguma coisa. Tamanho: P (dias), M (uma semana), G (duas semanas ou mais).

### Onda 0 — Consertos de hoje (FORA do módulo, vale pra todas as empresas)

Defeitos que **já existem em produção** (o QA confirmou os quatro no código, `06-qa.md` seção A). Não dependem do módulo e não esperam por ele. **Antes de cada um: conferir no banco de produção, por empresa, o tamanho do estrago e mostrar ao dono** (decisão D3). Ordem de deploy: 0c-1 → 0c-2 → 0b → 0a → 0d.

#### 0c — O acerto paga duas vezes ou nunca paga (R6) · M — **o primeiro, porque as outras ondas dependem dele**

Hoje: o acerto escolhe o que pagar só pela data. Dois acertos com períodos que se cruzam (01–15 e 01–30) pagam a mesma viagem/pedágio/diesel duas vezes. E o lançamento que chega do celular depois que o acerto fechou fica de fora — pra sempre se o acerto já foi PAGO. Não existe acerto "cancelado" nem botão de apagar acerto, então um acerto ABERTO gerado com período errado fica pra sempre (B2).

Conferir antes: (a) itens repetidos — a mesma viagem/abastecimento/pedágio em dois acertos; (b) itens com data dentro de acerto FECHADO/PAGO e sem item em nenhum acerto; (c) acertos ABERTO com período sobreposto a outro.

Conserto (B1, B2, B13):
- **0c-1 · Descartar acerto ABERTO.** Botão novo no painel, permissão `acertos.gerar`, motivo obrigatório, auditoria. Solta os itens. Acerto FECHADO/PAGO não se descarta.
- **0c-2 · Regra de seleção nova:** o acerto pega o que tem **data dentro do período** (dia civil de São Paulo, `common/timezone.ts`, nas três buscas — hoje o diesel usa janela UTC) **e não está em acerto FECHADO ou PAGO**.
  - Item que está em **outro acerto ABERTO** é "puxado" pro acerto que está sendo gerado, com aviso "este item saiu do acerto de DD/MM a DD/MM". Assim nada fica preso num ABERTO esquecido.
  - **Sem piso no passado nunca**: item com data **anterior** ao período só entra se a empresa marcar na lista **"Ficou de fora de acertos anteriores"** (nova, na tela do acerto). Nada antigo entra sozinho (B1, D3).
  - Trava no banco só contra o mesmo item em dois acertos **FECHADO/PAGO** (feita no fechamento, com 409 legível — nunca 500 na geração). ⚠️ Se a conferência (a) achar repetidos já fechados, a trava não sobe até o dono decidir o que fazer com eles.
  - O relatório de lucro, que hoje lê só o primeiro item de acerto e esconde o pagamento em dobro, passa a avisar quando há mais de um.

#### 0b — Pedágio avulso em dobro com o pedágio da viagem (R3) · P — **redesenhada (B3, B4)**

Hoje: o pedágio avulso do app nunca leva a viagem. O acerto paga o total de pedágio da viagem **e** todo avulso sem viagem do período. Quem lança nos dois lugares — viagem guiada **ou** viagem manual (`nova-viagem.tsx`) — recebe duas vezes.

Conferir antes: avulsos sem viagem no mesmo dia/motorista de uma viagem com pedágio total > 0, separando acerto ABERTO de FECHADO/PAGO.

Conserto: **não vincular o avulso à viagem nesta onda.** Vincular criaria dois caminhos novos de pedágio sumir: o vinculado é descartado em silêncio quando a viagem já tem total, e o vinculado a viagem que termina INCOMPLETA sai do acerto pra sempre (B3). A proteção é um **aviso no acerto**, que cobre qualquer origem de viagem (B4):
- Para cada motorista + dia (SP) com viagem de pedágio total > 0 **e** pedágio avulso sem viagem, o acerto mostra **"possível pedágio em dobro: viagem R$ X · avulso R$ Y — conferir"**, com as duas linhas lado a lado e os botões "É o mesmo pedágio (tirar o avulso deste acerto)" / "São pedágios diferentes". Decisão humana, com autor; nada sai sozinho.
- Acerto FECHADO/PAGO não muda.
- O vínculo do avulso com a viagem fica pra Onda 4, junto com estas duas regras: (1) quando total da viagem ≠ soma dos vinculados, aviso no acerto em vez de descartar; (2) vinculado a viagem fora do fechamento (INCOMPLETA, EM_ANDAMENTO, AGUARDANDO_PESO) volta a contar como avulso.

#### 0a — "Paguei pedágio" da viagem guiada nunca chega ao acerto · P

Hoje: o motorista toca "Paguei pedágio", digita R$ 23,40 e acha que lançou. O valor fica gravado e nunca é pago, a menos que ele redigite o total no finalizar. (Rede parcial: com o módulo Conferência, a viagem sem valor numa rota com praça vira `PEDAGIO_SEM_VALOR` e o motorista é perguntado — não cobre quem não tem o módulo.)

Conferir antes: viagens com evento "Paguei pedágio" com valor e pedágio total vazio ou menor que a soma.

Conserto: no finalizar, o campo Pedágio vem preenchido com a soma dos pedágios marcados ("Somado dos pedágios que você marcou"), editável. **Mesmo quando o modo da empresa esconde o campo pedágio**: se houve evento "Paguei pedágio" com valor, o campo aparece (B5). Uma fonte só — o servidor não soma, senão é pedágio em dobro. Só o evento `paguei-pedagio`. API → OTA.

#### 0d — Diesel pago no cartão da empresa devolvido ao motorista (R5) · M

Hoje: abastecimento pago no cartão-combustível da empresa continua sendo devolvido se a modalidade devolve diesel — e motorista **sem modalidade** recebe por padrão.

Conferir antes: **não é uma consulta simples** (o casamento cartão × abastecimento é calculado na leitura, não gravado). Rodar a lógica de conciliação por conta, sem gravar, e listar os abastecimentos casados que viraram reembolso.

Conserto: no acerto, o item ganha aviso **"pago no cartão da empresa"** (usando a mesma conciliação) e o escritório decide. Não corta reembolso sozinho. Depois que o dono vir os números, pode virar regra (D3).

### Onda 1 — Lançar, conferir e receber no acerto (o módulo nasce) · G

Pré-requisitos: Onda 0c no ar (a seleção do acerto já é a nova) e um OTA anterior com o rótulo de reserva "Reembolso" no extrato de acertos do app (app sem atualização mostraria a linha nova em branco — B14).

**Módulo (B8, B9).** Chave nova `despesas` em `shared-types/src/modulos.ts`, **`adicional: true`** (vendido à parte, nunca liga sozinho — nem em conta nova), com os recursos `despesas` e `tipos-despesa`. A capacidade `app.despesa.lancar` declara `modulo: "despesas"`. **Depende do Financeiro**: o acerto mora no módulo Financeiro; a tela da plataforma só deixa ligar Despesas em conta com Financeiro vigente (e avisa se o Financeiro for desligado depois: os gastos aprovados ficam "aprovado — aguardando acerto", nunca somem).

**Servidor fecha a porta (B6).** O guard de módulo hoje só vale pro painel, e o guard de capacidade do app ainda está em sombra. Então `POST/PATCH/DELETE /m/despesas` checa **no próprio endpoint** que a conta tem o módulo `despesas` (403 tipado, 4xx: o item vai pros Pendentes, sem loop) e que o cadastro do motorista está APROVADO (molde: `exigirAprovado` de `motorista/acertos.controller.ts`).

**Motorista:**
- Na home, **com o módulo**: card "Gasto de viagem" (D5). Sem o módulo, a home não muda.
- Toque → lista **"O que você pagou?"** (tipos da empresa; Pedágio e Abastecimento no topo, cada um respeitando a capacidade que já existe; nada marcado — B15). A forma da lista vai na maquete antes de codar (B16).
- Formulário curto: foto em cima, valor embaixo, "Foi nesta viagem?" sem nada marcado, "Não tenho o comprovante" com campo "O que aconteceu?". Botão "Gasto desta viagem" dentro da viagem guiada (vínculo pelo contexto).
- Offline pelo outbox; tipo novo na tela de Pendentes, na contagem e na recuperação de envio travado. Tipo de gasto desativado/apagado enquanto o item espera sinal vira carimbo ou 4xx, **nunca 500**.
- Tela **"Gastos de viagem"** (rota nova `gastos-viagem`; não reaproveitar `meus-gastos` nem `a-receber`, que são do caderno) com "pra receber de volta" e os status: "Guardado no celular", "Com o escritório", "Aprovado — entra no próximo acerto", "No acerto de 15/10", "Não vai ser reembolsado" + motivo.
- **Caderno pessoal**: o título da tela pessoal muda de "Lançar gasto" pra **"Anotar gasto"** (o botão do caderno já diz isso), com a frase "Só você vê. Pra o escritório devolver, use Gasto de viagem". Só texto; nada some.

**Tipos de gasto da empresa** (kit editável, semeado quando o módulo liga): Alimentação, Pernoite, Borracharia, Chapa/descarga, Lavagem, Estacionamento, Balsa, Peça/conserto na estrada, Outro. Por tipo: pede foto?, a empresa devolve?, aprova sozinho até R$ __ (nasce **vazio** = escritório confere tudo).
Fora do kit: **pedágio, diesel e ARLA** (têm fluxo próprio; virar tipo é dinheiro em dobro), **multa** (tem cadastro e desconto próprios), **diária e estadia** (fora por decisão do dono: a diária foi removida em 22/09 e a estadia é cobrança ao cliente, não gasto do motorista — B11).

**Quem decide se devolve:** devolve = **o tipo devolve E a modalidade tem ligado "devolve gastos de viagem"**. É um **terceiro** interruptor ao lado dos dois que já existem (devolve pedágio, devolve diesel — B12), nasce ligado, mora só na modalidade (o acordo próprio do motorista não alcança reembolso, como hoje).

**Escritório:** menu Lançamentos → **"Gastos de viagem"**, abas Conferir / Todos / Tipos de gasto (uma permissão por aba). Foto grande ao lado do valor, aberta na própria tela. "Aprovar", "Aprovar outro valor" (motivo), "Não reembolsar" (motivo); aprovar em lote só o que não tem ponto de atenção. Cartão "Gastos desta viagem" na ficha da viagem. Pedágio avulso aparece em "Todos" só pra leitura (sem aprovação).

**Acerto:** linha nova "Reembolso de gastos", item a item, pela mesma regra da 0c (data dentro do período, dia de SP, sem acerto FECHADO/PAGO; passado só marcado pela empresa). **A busca passa pelo mesmo filtro de dias de emprego** que viagens/diesel/pedágio já usam, com teste: gasto de dia em que o motorista era empregado CLT nunca entra no acerto (B10). Antes de fechar: "2 gastos ainda em conferência (R$ 72,40) não entram neste acerto".

**Empregado CLT na Onda 1:** pode lançar; o gasto aprovado aparece pra ele como "Aprovado — o escritório paga fora do acerto". Nunca some, nunca vai pro acerto.

**As duas checagens que derrubam a subida (seção C do QA):**
- todo `admin/despesas*` e `admin/tipos-despesa*` com `@RequerPermissao` — `endpoints-sem-permissao.ts` não cresce;
- todo `/m/despesas*` com `@RequerCapacidade("app.despesa.lancar")` ou `@CapacidadeLivre` — **`common/acesso-app/capacidades.boot-check.ts`**; `endpoints-m-sem-capacidade.ts` não ganha linha.
- Os 9 testes de módulos passam se `despesas`/`tipos-despesa` entrarem no catálogo de permissões **e** só no módulo `despesas`.

**Liga em quem:** Schaba primeiro (cobaia), depois o cliente que perguntou. Deploy: API no ar e `acessos_efetivos_app` conferido **antes** do OTA.

Fora de propósito: leitura da foto por IA, adiantamento, CLT recebendo, lucro por caminhão, cobrar do cliente.

### Onda 2 — Escritório confere mais rápido e o empregado também recebe · M

- **Leitura da foto às cegas pro escritório**: o servidor lê o papel **sem** o valor lançado e mostra na fila "no papel aparece R$ 85,00 · lançado R$ 58,00", rotulado **sugestão**. Sem leitura: "a leitura não achou valor no papel" (nunca "confere"). Custo pelo módulo Conferência (cobrado por uso), como o cupom de hoje.
- **Empregado CLT**: gasto aprovado vira **conta a pagar** no Financeiro, agrupada por motorista ("Gerar a pagar" na aba Conferir), separada do salário.
- **Lucro por caminhão**: gasto aprovado vira custo do caminhão; "por conta do parceiro" vai pro "fora da conta"; em conferência aparece como aviso, nunca zero. Conta a pagar gerada por gasto fica fora da soma de títulos (senão conta duas vezes). Aviso de duplicata com conta a pagar lançada à mão (R7) e com manutenção (R8, borracharia).
- **Push** ao motorista só em "Não vai ser reembolsado" e "Aprovado com outro valor", em todos os aparelhos.

### Onda 3 — Adiantamento e prestação de contas · M

- O escritório registra o **adiantamento** (quanto, quando, como entregou) e ele **aparece no app na hora**: "Adiantamento R$ 1.500 · gastos que a empresa devolve R$ 1.180 · fica R$ 320 com você (sai do próximo acerto)".
- No acerto o adiantamento entra sozinho, descontando, pela mesma regra da 0c e com trava contra dois acertos fechados. O "Adiantamento" manual de hoje continua existindo.
- **Saldo negativo não some mais** (hoje some): vira "Saldo do acerto anterior" no próximo — depende de D2.
- Por que só agora: muda a conta do acerto de quem já está em produção e precisa da Onda 1 estável.

### Onda 4 — Quando o cliente pedir · M

- **Cobrar do cliente** gasto repassável (taxa de descarga, balança) como linha separada da fatura, uma vez só — nunca dentro do valor congelado da viagem.
- **Pedágio avulso ligado à viagem** (o que a 0b deixou de fora), com as duas regras de B3 e o repasse dele ao cliente (R4).
- **Evento da viagem guiada vira gasto** (ex.: "Paguei estacionamento" ligado ao tipo Estacionamento) — um toque, um registro. Pedágio nunca entra aqui.
- **Régua por modalidade e por tipo** ("agregado: devolve chapa mas não almoço").
- Visão "Todos os gastos da viagem" (pedágio + diesel + outros), só leitura.

---

## 3. Decisões do dono (5)

| # | Pergunta | Recomendação | Por quê (uma linha) |
|---|---|---|---|
| **D1** | O módulo é vendido à parte? Quanto custa? | **Vendido à parte, preço por mês por empresa, sem cobrar por gasto lançado. Só liga pra quem já tem o Financeiro** (é lá que mora o acerto). Conta nova **não** recebe sozinha — nem no teste grátis; quem pedir no teste, a plataforma liga à mão. A leitura da foto por IA é cobrada pelo módulo Conferência, como já é. | Foi um cliente que pediu e é diferencial; empresa que não usa não paga nem vê; e sem o Financeiro o dinheiro aprovado não teria pra onde ir. |
| **D2** | Quando o acerto fecha negativo (adiantou mais do que ele rodou e gastou), o que sobra passa pro acerto seguinte? Hoje simplesmente some. | **Sim, passa pro próximo, visível nos dois extratos — só em empresa com o módulo.** Nunca vira "dívida" no nome do motorista. | Com adiantamento automático, sumir vira prejuízo certo; mas é dinheiro de parceiro, então só com seu OK. |
| **D3** | O que fazer com o **passado** que a Onda 0 achar? (pedágio pago em dobro, lançamento que nunca foi pago, diesel do cartão devolvido, acertos fechados com item repetido) | **Não cobrar nada de volta do motorista. Lançamento que nunca foi pago só entra se a empresa marcar na lista "Ficou de fora". Corrigir dali pra frente.** Antes, eu te mostro os números de cada empresa. | "Corrigir o futuro sem quebrar o presente": tirar dinheiro de parceiro por conta do sistema vira briga; o que ele nunca recebeu é dele, mas quem decide pagar é a empresa. |
| **D4** | Gasto de **motorista registrado (CLT)** vai pra onde, já que o acerto é só de parceiro? | **Vira conta a pagar no Financeiro**, separado do salário (Onda 2). | Juntar no acerto ou no salário é o que a Justiça do Trabalho anula; e sem caminho nenhum ele lança e nunca recebe. |
| **D5** | A tela inicial de quem contrata o módulo troca os botões "Pedágio" e "Abastecimento" por um só "Gasto de viagem"? | **Sim, mas só em empresa com o módulo ligado, e só depois de você ver a maquete na Schaba** (incluindo como fica a lista de tipos). Sem o módulo, a tela fica exatamente como hoje. | Uma porta só ensina "todo gasto entra por aqui"; o custo é um toque a mais no diesel, e nenhuma empresa em produção vê mudança sem ter contratado. |

Perguntas pro **cliente que perguntou** (mudam a ordem, não são do dono): os motoristas são registrados ou agregados? Quais 3 gastos aparecem toda semana? Dá adiantamento em dinheiro antes da viagem? Quem confere e em que dia do mês?

---

## 4. Conflitos entre os especialistas e como resolvi

1. **Card único substituindo Pedágio e Abastecimento (UX) × nunca mudar o app de empresa em produção sem autorização.** → A porta única **só existe com o módulo contratado**; sem ele, a home não muda (pedágio e abastecimento são do núcleo). Contratar é ato da empresa, ligado conta a conta, Schaba primeiro. Dentro da lista, Pedágio e Abastecimento obedecem às capacidades que já existem; quem só tem uma delas e nenhum outro tipo vai direto pro formulário. No app o corte é feito pelo resolver de capacidades; no servidor, pela checagem própria do endpoint (B6). Entra como D5.
2. **IA preenche o valor no app (arquiteto) × lê às cegas só pro escritório (UX).** → **Vence o UX.** O motorista digita o valor (é a palavra dele, como o km); a leitura roda no servidor sem o valor lançado e aparece na fila como sugestão. Regra do dono de 05/10 (`feedback_ia_nunca_afirma`): "pode até sugerir, mas não afirmar". Bônus: lançar continua igual offline. Do arquiteto fica o leitor (`common/ia/cupom.ts` como molde) e a torneira de custo. O cupom do abastecimento, que hoje preenche campo vazio, não muda.
3. **Adiantamento + saldo que passa pro próximo (financeiro) × fora das fatias (arquiteto).** → **Onda 3**, depois do reembolso estável. Saldo que passa → D2.
4. **Empregado CLT (financeiro e arquiteto concordam: fora do acerto).** → Onda 1: aparece aprovado, "pago fora do acerto", e o filtro de dias de emprego garante que não entra no acerto (B10). Onda 2: conta a pagar (D4).
5. **Régua de devolução por modalidade × tipo (financeiro) × um interruptor (arquiteto) × "reembolsa" no tipo (UX).** → Onda 1: tipo devolve **e** modalidade devolve gastos (terceiro interruptor ao lado dos dois de hoje). Tabela modalidade × tipo na Onda 4.
6. **Limites (máximo + aprova sozinho / limite sem aprovação / valor de atenção).** → Um número só por tipo, "aprova sozinho até R$", nascendo vazio. Os valores do financeiro aparecem como dica na tela.
7. **Tipo escolhido num campo do formulário (arquiteto) × tela de lista (UX).** → Tela de lista, nada marcado, forma validada na maquete (B16).
8. **"Recusar" × "não reembolsar".** → O gasto nunca é recusado; o escritório decide se **devolve**. Estados: Com o escritório → Aprovado / Aprovado com outro valor / Não vai ser reembolsado (motivo obrigatório, motorista pode responder). Tipo que a empresa não devolve nem entra na fila: "Por sua conta".
9. **"Como você pagou?" sempre × configuração da empresa.** → Configuração: "seus motoristas pagam gasto com cartão da empresa?". Se não, a pergunta não aparece; se sim, aparece sem nada marcado. Gasto no cartão da empresa nunca vira reembolso.
10. **Pedágio avulso na fila de conferência (UX) × fica como está (arquiteto).** → Sem aprovação (atrasaria o pagamento de quem já usa); aparece em "Todos" só pra leitura.
11. **Módulo: recurso em "Operação", que é núcleo (arquiteto) × vendido à parte (D1) — achado do QA (B8).** → Módulo próprio `despesas`, adicional, dependente do Financeiro.

---

## 5. Riscos pra produção

| Risco | Como a proposta segura |
|---|---|
| **Pedágio em dobro ou triplo** | Pedágio nunca é tipo de gasto; o evento da viagem guiada só sugere o total (0a); avulso + total da viagem no mesmo dia viram aviso com decisão humana, qualquer origem de viagem (0b); o avulso não é vinculado à viagem até a Onda 4, quando vem com as regras que impedem ele de sumir. |
| **Mesmo item pago em dois acertos / lançamento que nunca é pago / item preso em acerto ABERTO esquecido** | 0c: data dentro do período + sem acerto FECHADO/PAGO; item de outro ABERTO é puxado com aviso; descartar acerto ABERTO com motivo e auditoria; passado só marcado pela empresa; trava só entre fechados, com 409 legível. Conferir repetidos em produção **antes**. |
| **Dinheiro antigo saindo de uma vez** | Nada com data anterior ao período entra sozinho (B1); lista "Ficou de fora" decidida pela empresa (D3). |
| **Diesel do cartão da empresa devolvido** | Aviso no acerto pela mesma conciliação (0d); gasto novo pago no cartão nunca vira reembolso. |
| **Gasto de CLT pago no acerto** | Busca de gasto passa pelo filtro de dias de emprego, com teste (B10). |
| **Empresa sem o módulo lançando gasto** | Checagem do módulo no próprio endpoint `/m/despesas` (B6), não só na tela. |
| **Quebrar acerto existente** | Tudo aditivo; FECHADO não regenera e PAGO não reabre; correção vira ajuste no seguinte; saldo que passa pro próximo só com D2 e só com o módulo; rótulo de reserva no app antes da linha nova (B14). |
| **Empresa perder funcionalidade / ver o app mudar** | Módulo adicional nunca liga sozinho; home só muda com o módulo (D5); pedágio e abastecimento seguem no núcleo; caderno só muda o título da tela. API no ar e `acessos_efetivos_app` conferido **antes** do OTA. |
| **Subida derrubada** | Os dois boot-checks (painel e `capacidades.boot-check.ts`) e os 9 testes de módulos estão na lista da Onda 1. |
| **Valor do motorista sobrescrito** | Valor lançado é intocável (como o km); aprovar outro valor exige motivo e os dois ficam guardados. |
| **IA afirmando** | Leitura às cegas, rotulada sugestão, nunca "confere". |
| **Gasto contado duas vezes no lucro** | Reembolso fora do custo "motorista"; conta a pagar gerada por gasto fora da soma de títulos; aviso de duplicata com título manual e manutenção (Onda 2). |
| **Motorista confunde caderno com gasto de viagem** | Nomes diferentes ("Anotar gasto" × "Gasto de viagem"), rotas diferentes, e a frase de cada tela dizendo pra quem vai. Os dois nunca conversam. |
| **Item preso no celular** | Tipo novo nos Pendentes, na contagem e na recuperação; falha de rede não queima tentativa; tipo desativado vira carimbo/4xx, nunca 500. |
| **Motorista com cadastro não aprovado lançando** | Checagem de aprovado explícita no endpoint (o guard de capacidade não checa). |
| **Tom de fiscalização** | Nada de "recusado", "erro" ou vermelho pro motorista; "o escritório confere", "pra receber de volta". |

---

## 6. Correções de afirmações das versões anteriores (QA, seção D)

- "Diária tem caminho próprio" — falso: diária foi removida; diária e estadia ficam fora **por decisão do dono**.
- "Interruptor único, como pedágio e diesel" — são dois hoje; o de gastos é o terceiro.
- "Acertos não cancelados" — não existe acerto cancelado; daí o "descartar acerto ABERTO" da 0c.
- "Cortada pelo módulo" — só na tela; o servidor precisa da checagem própria (B6).
- "Conta nova ganha no teste" — módulo adicional não entra em conta nova; a D1 foi reescrita.
- "Consulta só de leitura simples" pra 0d — exige rodar a conciliação do cartão por conta.
- "Lançar gasto"/"Meus gastos" — nomes já tomados pelo caderno pessoal; o módulo usa "Gasto de viagem".
