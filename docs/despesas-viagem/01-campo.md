# 01 — Campo: como a despesa de viagem acontece de verdade (desp-campo, 05/10/2026)

Pergunta: como o gasto de viagem acontece, do bolso do motorista até o fechamento, e o que o mercado já resolve?
Ponto de partida (o que o código tem hoje) está em `00-ponto-de-partida.md` e não foi refeito.

Convenção: toda afirmação tem link ou vem marcada **SUPOSIÇÃO**. A web quase não tem recorte de
basculante/granel curto (mesma lacuna da pesquisa de dores de 02/10, `reference_dores_caminhoneiro_out26.md`),
então tudo o que é específico de pedreira→obra está marcado como suposição e precisa ser confirmado
conversando com o cliente que fez a pergunta.

---

## 1. O ciclo real

### 1.1 O ciclo "de manual" (o que todo TMS descreve)
1. **Adiantamento antes de sair**: dinheiro/depósito pra combustível, pedágio, alimentação, hospedagem.
2. **Gasto na estrada**: o motorista paga e guarda o comprovante.
3. **Prestação de contas na volta**: apresenta comprovantes e **devolve o que sobrou** do adiantamento.
4. **Acerto**: saldo = adiantado − gasto comprovado → motorista devolve ou empresa paga a diferença.

Fontes: [Proxsis — Acerto de Viagem](https://proxsis.tomticket.com/kb/acerto-de-viagem/acerto-de-viagem) (abas Adiantamento / Despesas / Devolução),
[Simetris — Acerto entre transportadora e motorista](https://simetris.app/blog/acerto-de-viagem-entre-transportadora-e-motorista/),
[Bsoft — Acerto com motorista](https://bsoft.com.br/bsoft-tms/acerto-com-motorista) ("despesas pagas pela empresa **ou pagas pelo motorista**", "adiantamentos e devoluções durante a viagem", "saldo do motorista antes da viagem acabar"),
[Blog do Caminhoneiro (2020)](https://blogdocaminhoneiro.com/2020/05/como-um-aplicativo-para-caminhoneiros-pode-ajudar-no-acerto-de-viagem-com-motorista/) — o acerto ainda roda em planilha Excel em boa parte das transportadoras; o argumento de venda dos apps é "acerto em até 48h".

O ganho que os próprios fornecedores vendem é **o motorista lançar durante a viagem, e o escritório só conferir** na volta
(resumo do Datatransp no resultado de busca de "acerto de viagem … aplicativo"; a página `datatransp.com/aplicativo/despesas` não resolveu DNS no fetch, então fica como citação de busca, não verificada por leitura).

### 1.2 Quem paga o quê — muda conforme o vínculo

| Vínculo | Quem arca com o gasto de viagem | Como volta pro motorista | Fonte |
|---|---|---|---|
| **Empregado CLT** (frota própria) | A empresa. Despesa feita a serviço é dela; chapa pago do bolso tem que ser devolvido | Reembolso contra comprovante, ou diária/ajuda de custo fixa | TST RR-590-11.2010.5.04.0221 ([Legisweb](https://www.legisweb.com.br/noticia/?id=6435)): reembolso de alimentação em viagem; empresa não pode "embutir" a despesa num percentual da comissão (salário complessivo, Súm. 91). Mesmo caso/linha: chapa pago do bolso é devolvido ([Sedep](https://www.sedep.com.br/?p=50586)) |
| **TAC agregado / parceiro autônomo** | Em regra **o próprio parceiro** — a despesa está dentro do frete. A empresa só devolve o que **combinou** devolver (pedágio, às vezes combustível, às vezes chapa) | Crédito no acerto (reembolso combinado) ou desconto de adiantamento | **SUPOSIÇÃO** apoiada em: piso ANTT (Res. 5.867/2020) é custo de deslocamento + carga/descarga, com pedágio somado à parte ([NetCPA](https://netcpa.com.br/colunas/antt-republica-tabela-de-frete-e-inclui-pedagio-no-calculo-do-preco-minimo/3951), [Contábeis](https://www.contabeis.com.br/legislacao/5350471/resolucao-antt-5867-2020/)) — ou seja, o custo de rodar já está no frete |
| **TAC eventual / frete de mercado** | O autônomo, 100% | Não volta; vira custo dele (por isso o "caderninho" do autônomo) | SUPOSIÇÃO |

Consequência direta pro Movatruck: **o mesmo gasto (ex.: almoço) é reembolsável pra um e não pra outro.**
Isso já existe no código como régua na `ModalidadeMotorista` (`reembolsaPedagio`, `reembolsaAbastecimento`);
despesa nova precisa da mesma régua **por tipo de despesa**, senão o parceiro autônomo lança almoço e o
acerto credita algo que nunca foi combinado.

### 1.3 Como o dinheiro chega antes da viagem
- Adiantamento em dinheiro/depósito/Pix (manual dos TMSs acima).
- **Cartão pré-pago de despesa** emitido pela empresa: Pamcard "Despesas Corporativas" (créditos em lote em tempo real) e Repom "Gestão de Despesas" com cartão corporativo ([SETCESP](https://setcesp.org.br/noticias/inovacao-e-tecnologia-para-ampliar-a-oferta-de-meios-de-pagamentos/), [Edenred/Repom](https://www.edenred.com.br/wp-content/uploads/2018/06/20180425_Edenred_Jurb-no-comando-de-Frota-e-Soluções-de-Mobilidade-005.pdf)). Quem usa cartão tem o extrato como "comprovante" — é o mesmo padrão do cartão-combustível que o Movatruck já importa (`project_cartao_combustivel`).
- Pro agregado, o que existe é **adiantamento de frete** (parte do frete antes, saldo depois), muitas vezes por meio de pagamento eletrônico obrigatório ANTT ([Mundo Logística — Fretebras](https://mundologistica.com.br/noticias/fretebras-lanca-conta-digital-para-pagamentos-de-fretes-rodoviarios), [Repom adiantamento de recebíveis](https://www.edenred.com.br/wp-content/uploads/2021/11/Repom_release_adiantamento_recebiveis_VF.pdf)). Isso **não é** adiantamento de despesa; misturar os dois na mesma linha confunde o acerto. **SUPOSIÇÃO** pro tamanho do problema.

---

## 2. Tipos de gasto que aparecem de verdade

Não achei estudo com frequência medida. A ordem abaixo é **SUPOSIÇÃO** guiada por: as convenções coletivas e decisões do TST (que só falam de alimentação, pernoite, banho e chapa), os catálogos dos apps de mercado e o perfil basculante/curto dos clientes do Movatruck.

| Tipo | Frequência estimada (basculante curto) | Comprovante? | Observação / fonte |
|---|---|---|---|
| **Alimentação** (café/almoço/janta) | Alta — todo dia | Cupom/NFC-e quase sempre; às vezes "PF" de beira de estrada sem nota | CCT motoristas SP 2025-26: R$ 35 almoço/jantar, R$ 50 pernoite ([SETCESP CCT 2025-26](https://setcesp.org.br/noticias/baixe-agora-as-convencoes-coletivas-2025-2026/)); CCT antiga PR listava café, almoço, janta, pernoite e **banho** com teto ([Law Insider CCT PR 2019](https://lawinsider.com/pt/contracts/dj1AnOCEHlo)) |
| **Pedágio** | Alta (já existe) | Recibo da praça / tag | Já coberto pelo app |
| **Combustível / Arla** | Alta (já existe) | Cupom/NFC-e | Já coberto (abastecimento com OCR) |
| **Chapa** (ajudante de carga/descarga) | Média em carga seca; **baixa em basculante** (descarga é basculando) | **Quase nunca** — pago em dinheiro/Pix a pessoa física | TST: chapa é ônus da empresa pro CLT ([Sedep](https://www.sedep.com.br/?p=50586)); informalidade generalizada ([Jus — carta-frete](https://jus.com.br/artigos/66826/a-pratica-ilicita-da-carta-frete)) |
| **Borracharia** (furo, remendo, troca na obra) | Média — pneu em obra/pedreira | Recibo à mão ou nada | SUPOSIÇÃO. Hoje o Movatruck tem "manutenção avisada pelo motorista" (`project_manutencao_pelo_motorista`) — borracharia é **gasto**, não aviso |
| **Lavagem** (caçamba, rodas pra sair da obra/entrar em via pública) | Média em basculante | Recibo/cupom às vezes | SUPOSIÇÃO |
| **Pernoite / hotel** | Baixa em basculante curto; alta em rodoviário longo | NF de hotel sim; "dormi na boleia" não tem | CCT acima; dormir na boleia é tempo à disposição, não despesa ([Legisweb](https://www.legisweb.com.br/noticia/?id=6605)) |
| **Banho** | Baixa/média em rodoviário | Ficha do posto, raramente cupom | CCT PR 2019 |
| **Estacionamento / pátio** | Baixa/média | Ticket do pátio às vezes | SUPOSIÇÃO |
| **Balança** (pesagem avulsa) | Baixa — basculante pesa na pedreira | Ticket da balança | SUPOSIÇÃO |
| **Lona / cinta / amarração** | Baixa | Cupom de loja | SUPOSIÇÃO |
| **Taxa de descarga** (cobrada pelo destino) | Baixa em obra; comum em CD/supermercado | Recibo às vezes | SUPOSIÇÃO |
| **Gorjeta de pátio / "agrado"** | Existe; ninguém declara | Nunca | SUPOSIÇÃO — não vale campo próprio |
| **Telefone / recarga** | Baixa | Raro | SUPOSIÇÃO |
| **Peça / óleo de emergência** | Baixa | Cupom | Fleetio trata como "Service", não "Expense" ([Fleetio Expenses Overview](https://help.fleetio.com/en_US/expenses-overview)) |

**Padrão que importa pro produto:** existe uma categoria inteira de gasto legítimo **sem comprovante**
(chapa, PF sem nota, borracharia de beira de obra). Se o módulo **exigir** foto pra salvar, ou o
motorista não lança (e reclama no acerto), ou fotografa qualquer coisa. O mercado gringo resolve isso
com "recibo opcional por categoria" — Expensify deixa a política dizer, por categoria, se exige recibo
e a partir de qual valor ([CNBC — Expensify review](https://www.cnbc.com/select/expensify-app-review/), [TechRepublic](https://www.techrepublic.com/article/expensify-review/)).
Pro Movatruck isso casa com a regra já paga em `project_lancamento_nunca_recusado`: **aceita sempre e carimba "sem comprovante"**.

---

## 3. Dor

1. **Dinheiro é a dor nº 1** do caminhoneiro (reviews de 32 apps: taxa de saque, saldo preso até "dar baixa", pagamento menor que o combinado, extrato que não diz de qual viagem) — `reference_dores_caminhoneiro_out26.md`. Despesa que vira crédito no acerto é **dinheiro do parceiro**: o módulo é lido por ele como "vou receber de volta?", não como prestação de contas.
2. **Adianta do bolso e espera**: chapa e alimentação pagos do bolso viram processo trabalhista quando não voltam ([TST via Legisweb](https://www.legisweb.com.br/noticia/?id=6435); [Sedep](https://www.sedep.com.br/?p=50586)). O empregador "embutia" a despesa num percentual sobre o faturamento — o tribunal anulou. Lição: **despesa tem linha própria, nunca dentro do frete/comissão**.
3. **Comprovante que some**: cupom em papel térmico desbota; Goiás chegou a proibir papel térmico pra comprovante a guardar > 1 ano ([Lei GO 17.281/2011](https://appasp.economia.go.gov.br/Legislacao/arquivos/Leis/L_17281.htm)); a Receita aceita digitalização ([Tributo Devido — ADI RFB 4/2019](https://tributodevido.com.br/portal/digitalizacao-de-documentos-fiscais/)). Foto **na hora** resolve; foto "depois, no acerto" já pega cupom apagado e amassado. **SUPOSIÇÃO** pro "amassado na boleia", mas é o relato universal.
4. **Briga no acerto**: escritório não sabe de qual viagem é o gasto; motorista diz que pagou e não tem papel. Hoje no Movatruck o pedágio avulso **nem leva viagemId** (`00-ponto-de-partida`), então essa briga já é possível no produto.
5. **Fraude / cupom inflado**: recibo "de quanto, doutor?" é prática conhecida ([Unieducar](https://unieducar.org.br/blog/quer-que-eu-faca-o-recibo-de-quanto-doutor)); padrões típicos: recibo falso, despesa inexistente, valor inflado, cartão em uso indevido ([Flash — fraudes em viagens](https://flashapp.com.br/blog/viagens-corporativas/prevencao-de-fraudes-trabalhistas-em-viagens)); no transporte, caso de taxa de estacionamento inflada em nota de subcontratado ([ICAC HK](https://www.icac.org.hk/en/press/index_id_807.html)). **A defesa barata no Brasil é a NFC-e**: o QR code do cupom leva à chave de 44 dígitos e à consulta na SEFAZ ([SEFAZ RR — Manual DANFE NFC-e](https://www.sefaz.rr.gov.br/Manual_do_DANFE_NFC-e_QR_Code.pdf)). O Movatruck já tem `common/chave-fiscal.ts` (DV mód. 11 + modelo — modelo 65 = NFC-e). Isso deixa o sistema **sinalizar** (nunca recusar) cupom repetido, CNPJ/data fora da viagem, ou valor digitado ≠ valor da nota.

Tom: o produto não pode soar como "fiscalização". O enquadramento certo é **"pra você receber de volta mais rápido, sem discussão"** (regra do agente: parceiro autônomo, nada de controle).

---

## 4. Mercado

### Brasil (TMS e apps)
| Produto | O que faz com despesa | Foto/OCR | Adiantamento | Preço | Fonte |
|---|---|---|---|---|---|
| **Bsoft TMS** | Despesa e receita por viagem, paga pela empresa ou pelo motorista; regras de cálculo; saldo do motorista em tempo real | Não citado | Sim, + devoluções | Não publicado | [bsoft.com.br](https://bsoft.com.br/bsoft-tms/acerto-com-motorista) |
| **Proxsis** (ERP) | Acerto: adiantamento → despesas → devolução; placa, destino, km ini/fim | Não citado | Sim (aba própria) | Não publicado | [Proxsis KB](https://proxsis.tomticket.com/kb/acerto-de-viagem/acerto-de-viagem) |
| **ADM Frota** (EL Sistemas, app) | Motorista lança pedágio, oficina, alimentação, combustível; **"caixa do motorista"** (recebe frete, paga despesa) | Não citado | Via caixa | Grátis (app; o painel é pago, SUPOSIÇÃO) | [App Store](https://apps.apple.com/us/app/id1645158123) |
| **GestLog** (app) | Motorista registra frete, despesas, adiantamentos e devoluções e sincroniza com o painel; **envia foto de documento** | Foto sim | Sim | Não publicado | [App Store](https://apps.apple.com/bb/app/gestlog/id1498459917) |
| **Transfer-Gest** | Despesas por serviço e veículo, pelo motorista | — | — | — | [mwm.ai](https://mwm.ai/pt/apps/transfer-gest/6495715697) |
| **OtimaisApp** (Curitiba) | Acerto em até 48h, online e offline | — | — | — | [Blog do Caminhoneiro](https://blogdocaminhoneiro.com/2020/05/como-um-aplicativo-para-caminhoneiros-pode-ajudar-no-acerto-de-viagem-com-motorista/) |
| **Pamcard / Repom (Edenred)** | Cartão pré-pago de despesa, crédito em lote, extrato | Extrato = comprovante | É o próprio cartão | Taxa por transação/saque (dor nº 1 nos reviews) | [SETCESP](https://setcesp.org.br/noticias/inovacao-e-tecnologia-para-ampliar-a-oferta-de-meios-de-pagamentos/) |
| **Datatransp** | Módulo de despesas no app: motorista lança durante o percurso, escritório só confere | — | — | — | resultado de busca (site fora do ar no fetch) |

Leitura: **no Brasil o padrão é "acerto de viagem" com adiantamento + despesas + devolução**, quase sempre no
painel; o app do motorista, quando existe, é um formulário simples. Ninguém anuncia OCR de cupom de
despesa (o Movatruck já tem OCR de cupom de combustível — é vantagem real). Nenhum fala de offline com clareza além do OtimaisApp.

### Referências de fora
- **Expensify**: SmartScan (OCR do recibo); política por categoria (exige recibo? acima de quanto? limite); violações que o sistema marca; per diem sem recibo. Preço: Collect grátis até 25 scans/mês; Track US$ 4,99/usuário/mês; Submit US$ 7,99; Control US$ 9,99 (anual) ([TechRepublic](https://www.techrepublic.com/article/expensify-review/), [Vertice](https://vertice.one/inside-saas/expensify-pricing)).
- **Ramp**: cartão corporativo primeiro; o recibo vem **depois** e é casado com a transação. Pede o recibo por **SMS** na hora da compra presencial; o motorista responde com a foto e o texto vira memo ([Ramp Support](https://support.ramp.com/hc/en-us/articles/360042588454-Submitting-Receipts-Memos)). "Receipt Agent" casa 70%+ em 24h; "Policy Agent" aprova o que está na política e só escala a exceção ([Ramp — expense management](https://ramp.com/expense-management)). Preço base grátis (receita vem do cartão).
- **Fleetio**: despesa é **do veículo**, não da pessoa — tipos pré-definidos editáveis por conta (Tolls, Fines, Misc., etc.); combustível tem app próprio com foto do recibo e GPS do abastecimento ([Fleetio Expenses](https://help.fleetio.com/en_US/expenses-overview), [Fleetio API — expense entry types](https://developer.fleetio.com/docs/api/expense-entry-types), [Business Fleet](https://www.businessfleet.com/130733/fleetio-introduces-mobile-fuel-tracking-app)).

Lição dos gringos: **(a)** tipo de despesa configurável por conta; **(b)** a regra (exige recibo, teto, reembolsa?) mora na **categoria**, não no lançamento; **(c)** o que está dentro da regra passa sozinho, só a exceção pede olho humano; **(d)** o pedido do recibo vai até a pessoa no canal que ela usa (pra nós, WhatsApp — 88% dos caminhoneiros, CNT).

---

## 5. Regra brasileira que muda o produto (não é parecer jurídico)

1. **CLT, art. 457 §2º (pós-Reforma, Lei 13.467/2017)**: ajuda de custo, auxílio-alimentação (vedado em dinheiro) e **diárias pra viagem, de qualquer valor**, não integram a remuneração nem são base de encargo ([Jornal Contábil](https://jornalcontabil.com.br/noticia/clt-parcelas-salariais-isentas-de-encargos-sociais-pela-reforma-trabalhista/), [Pontotel](https://www.pontotel.com.br/alimentacao-viagem-a-trabalho/)). Antes de 2017, diária > 50% do salário integrava ([Conjur PDF](https://www.conjur.com.br/wp-content/uploads/2023/09/empregado-recebia-diarias-superiores-50.pdf)).
   → **Produto:** reembolso e diária têm que sair em **linha separada** do frete/salário no acerto e no PDF. Nunca somar no "FRETE". Misturar é o "salário complessivo" que o TST anula (Súm. 91).
2. **Convenção coletiva fixa valores** de refeição/pernoite pro CLT (ex.: SP 2025-26 R$ 35 / R$ 50 — [SETCESP](https://setcesp.org.br/noticias/baixe-agora-as-convencoes-coletivas-2025-2026/)) e varia por sindicato/região.
   → **Produto:** teto por categoria é **configuração da conta**, nunca constante (casa com `feedback_nada_chumbado_em_codigo`). Diária foi **removida** do Movatruck em 22/09 — não recriar sem o dono pedir; teto de reembolso ≠ diária.
3. **Lei 13.103/2015, art. 235-G**: veda remunerar o motorista por distância/tempo/quantidade se comprometer a segurança ([LegJur](https://www.legjur.com/legislacao/htm/lei_00131032015)). Não afeta despesa diretamente, mas reforça: **reembolso é devolução de gasto, não prêmio** — nada de "bônus por economizar na estrada".
4. **Parceiro autônomo (TAC)**: não existe "reembolso trabalhista"; existe o **combinado comercial**. Pedágio é do embarcador por lei (vale-pedágio, Lei 10.209/2001 — [FMP](https://www.fmp.edu.br/wp-content/uploads/2023/01/A-constitucionalidade-da-Lei-do-Vale-Pedagio-10.2092001-1.pdf)); o resto é contrato.
   → **Produto:** a regra "reembolsa ou não" de cada tipo tem que viver na **ModalidadeMotorista** (como já vivem pedágio e abastecimento), com o override tudo-ou-nada que já existe. Despesa **não reembolsável** ainda tem valor: entra como custo no lucro por caminhão quando a empresa pagou, e como registro pessoal do parceiro quando ele pagou.
5. **Comprovante digital vale**: Receita aceita digitalização (ADI RFB 4/2019) e NFC-e é verificável pela chave. → foto guardada (MinIO servido pela API) é o comprovante; o papel pode ir pro lixo.

---

## 6. Conclusão

### As 5 coisas que o módulo PRECISA ter
1. **Lançar em 3 toques, offline, ligado à viagem**: tipo + valor + foto opcional, entrando no outbox como pedágio/abastecimento já entram, e **carimbado com a viagem em andamento** automaticamente (o motorista não escolhe viagem; o app sabe). Sem isso, é o "caderninho" que o dono achou aquém.
2. **Tipos configuráveis por empresa, com a regra no tipo**: cada tipo diz se **exige comprovante** (e a partir de quanto), se tem **teto**, e — via ModalidadeMotorista — se **reembolsa**. Kit inicial curto (Alimentação, Chapa/descarga, Borracharia, Lavagem, Estacionamento, Pernoite, Outro). Empresa liga/desliga cada um (capacidade do app no grupo "Gastos").
3. **"Sem comprovante" é estado, não erro**: aceita sempre (regra `lancamento_nunca_recusado`), carimba e deixa o escritório decidir. Chapa em dinheiro é real e não pode travar o motorista.
4. **Vira dinheiro no acerto, em linha própria**: crédito `REEMBOLSO_DESPESA` (por tipo) no `acerto-motorista.ts`, separado de FRETE; adiantamento de despesa abatendo; status visível pro parceiro ("aprovada — entra no acerto de outubro"). Hoje o escritório teria que usar BONUS/AJUSTE — que é exatamente o "salário complessivo" que dá problema.
5. **Uma tela no painel pra conferir por exceção**: lista de despesas por viagem/motorista/período, com foto no visualizador (nunca aba nova), filtro "sem comprovante" / "acima do teto" / "cupom repetido", aprovar em lote. O que está dentro da regra passa sozinho (padrão Ramp). Bônus barato: OCR do cupom (já existe pro combustível) + chave NFC-e pra sinalizar cupom repetido — sinalizar, nunca recusar.

### As 3 que parecem boas mas ninguém usa
1. **Diária automática / per diem calculado**: o dono já removeu diária em 22/09 por ninguém usar; e pro parceiro autônomo não se aplica. Teto por tipo resolve o mesmo problema.
2. **Fluxo de aprovação multinível / centro de custo / rateio contábil** (padrão Expensify/SAP Concur): transportadora pequena tem uma pessoa no escritório que confere tudo; multinível vira fila parada. SUPOSIÇÃO baseada no perfil dos clientes.
3. **Cartão pré-pago próprio de despesa / integração com Pamcard-Repom no V1**: o mercado já tem, a taxa é a dor nº 1 dos reviews, e quem usa cartão já tem extrato. Melhor caminho, se vier, é **importar o extrato** como já se faz com o cartão-combustível — não emitir cartão.

### Para confirmar com o cliente que perguntou (o que a web não responde)
- Ele é CLT ou agregado? (muda tudo do item 5.)
- Quais 3 gastos aparecem toda semana? (basculante: aposto em alimentação, borracharia, lavagem — **SUPOSIÇÃO**.)
- Hoje ele dá adiantamento em dinheiro antes da viagem, ou o motorista paga e pede de volta?
- Quem confere a despesa e em que dia do mês?
