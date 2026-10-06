# 01 — Campo: papelada, ciclo real e mercado das Etapas da Viagem

Pesquisa do agente `etapa-campo` (06/10/2026). Fonte por link; o que não tem fonte está
marcado **SUPOSIÇÃO**. Base: `00-pedido-do-cliente.md` (4 formulários do Checklist Fácil de
uma transportadora de grão/carga geral no MT que roda frete via agenciadora, ex. "Vidal").

---

## 1. Obrigações legais e operacionais, documento a documento

| Documento | Quem emite / guarda | O que a lei cobra | Por que a transportadora quer do motorista |
|---|---|---|---|
| **CT-e** (mod. 57) | Transportadora contratada pelo embarcador (no frete agenciado, normalmente a agenciadora/transportadora contratante; o dono do caminhão pode emitir CT-e de subcontratação) | Documento fiscal da prestação; acompanha a carga (DACTE). | Prova de **qual frete** o caminhão está fazendo e por qual valor; base da conferência do acerto. A foto não tem valor fiscal — vale a chave de 44 dígitos. |
| **MDF-e** (mod. 58) | Emitente do transporte. **Só o emitente encerra**, pelo sistema emissor; o motorista não encerra [contmatic] | Encerrar ao fim do percurso, após a descarga. Aberto, **bloqueia novo MDF-e da mesma placa/UF na hora** (rejeições 611/662), e após 5 dias (462) e 30 dias (686) [contmatic][cigam]. Multa por UF: RS 5% do valor (mín. 5 UPF), SP até 50% do frete, SC até 30% [contmatic]. | **"Não seguir viagem sem este" é literal:** se o MDF-e da viagem anterior não foi encerrado, o próximo MDF-e daquela placa é rejeitado e o caminhão não sai carregado legalmente. Por isso o formulário pede "SOLICITAR encerramento" (o motorista *pede* a quem emitiu) e depois a **foto do comprovante de encerramento**. |
| **CIOT** | Contratante, quando o contratado é TAC/TAC-equiparado (e, desde 24/05/2026, em toda operação, Res. ANTT 6.078/2026) | Multa de R$ 550 a R$ 10.500; pagamento do TAC só por meio eletrônico de frete; ANTT cruza CIOT × MDF-e × pagamento [contmatic-ciot][transp.net]. | Não é coisa do motorista preencher. Interessa como **número a guardar na viagem** (vem no MDF-e/contrato). **SUPOSIÇÃO:** o cliente não pediu; fica fora. |
| **Canhoto da NF / comprovante de entrega** | Assinado pelo **destinatário**; guardado pela transportadora | Valor comercial, não fiscal; é a principal prova de que o serviço foi prestado [contabeis][bsoft-comprov]. Existe o evento eletrônico "Comprovante de Entrega da NF-e" (NT 2021.001), pouco usado em granel [portalspedbrasil]. | **Trava dinheiro:** sem canhoto o tomador segura o pagamento / o saldo do frete [bsoft-comprov]. |
| **Ticket de pesagem (balança)** | Balança da origem (fazenda/armazém) e do destino (trading/porto) | Não é documento fiscal. Peso da NF/CT-e sai da origem. | No grão, o frete é **R$/tonelada** e o peso de destino define a **quebra** (diferença origem × destino), descontada do motorista quando passa da tolerância contratual. **SUPOSIÇÃO** (prática de mercado conhecida; não achei fonte pública citável com números). |
| **Ordem de carregamento** | Agenciadora/embarcador | Não é fiscal. | Autoriza o caminhão a carregar naquele armazém e traz o combinado (R$/t, origem, destino). O formulário pede junto o "VALOR TARIFA TONELADA" → **SUPOSIÇÃO forte:** é conferência do combinado na ordem, não a nossa `TabelaPreco` (é o que a empresa *recebe* da agenciadora). |
| **Tacógrafo** | Equipamento obrigatório (CTB; Res. CONTRAN 405/406/525) | Lei 13.103/2015: controle de jornada é obrigação **bilateral**; o motorista responde pela preservação/exatidão do registro; disco **não substitui** diário de bordo/papeleta [jornalcontabil][camara-lei][trt18]. PRF pede disco ou fita na fiscalização [zapay]. | O formulário usa a foto do tacógrafo como **odômetro carimbado** (km saída / chegada / fim de descarga) — prova de km e de tempo parado, não de jornada. |
| **Acerto de frete** (escritório da agenciadora) | Agenciadora paga o saldo | Contrato privado; pagamento eletrônico se TAC. | Prova de **com quem** acertou, **quando**, e **assinatura** do responsável — é o recibo do saldo. Não é o nosso `AcertoMotorista` (empresa → motorista). |

## 2. O ciclo real de uma viagem de grão MT (longa distância)

**SUPOSIÇÃO** montada a partir do formulário do cliente + fontes acima; validar com ele.

1. **Contratação:** agenciadora oferece carga (rota, R$/t). Motorista aceita, recebe a **ordem de carregamento**. Às vezes um **adiantamento** (coberto pelo módulo de despesas).
2. **Carregamento (origem):** pesa vazio/cheio → **ticket de pesagem**; NF do produtor/armazém; a emissora gera **CT-e + MDF-e** (+ CIOT). Motorista fotografa **tacógrafo/km de saída**.
3. **Estrada:** dias de viagem; despesas (tarifa, chapa, pedágio); fiscalização (balança, PRF) pede DACTE/DAMDFE/tacógrafo.
4. **Descarga (destino, trading/porto):** fila → pesa → **ticket de destino** (define a quebra) → descarga → **canhoto da NF assinado** → foto do tacógrafo na chegada e no fim da descarga.
5. **Encerramento do MDF-e:** motorista avisa a emissora → emissora encerra → motorista recebe/fotografa o comprovante. **Sem isso, o próximo frete daquela placa não sai.**
6. **Acerto do frete:** no escritório da agenciadora, com canhoto + tickets: saldo = (t × R$/t) − adiantamento − quebra. Assinatura do responsável.
7. **Nosso acerto** (empresa → motorista) e o faturamento só depois disso.

**O que trava dinheiro:** canhoto (sem ele, sem saldo), ticket de destino (sem ele, briga de quebra), MDF-e aberto (sem ele, caminhão parado = sem próximo frete).

## 3. Mercado — como os outros fazem formulários de etapa

| Produto | O que faz | Relevante pra nós |
|---|---|---|
| **Checklist Fácil** (o que o cliente usa) | Checklist genérico: perguntas dependentes, mídia, código de barras, assinatura digital, geolocalização, nota/peso por item, plano de ação [getapp][b2bstack][checklistfacil-actions] | **Genérico demais:** o formulário não sabe que é *a viagem X*, não liga ticket a peso, e "não seguir viagem sem este" é só texto — ficou sem resposta no exemplo do cliente e nada aconteceu. |
| **Bsoft TNS Gestão de Entrega / Comprovei** | App do motorista Android **offline** com ocorrências e foto do canhoto; **análise da foto** (qualidade + se bate com a NF-e informada); QR Code pro recebedor assinar no celular do motorista [bsoft-tns][bsoft-comprovei] | Referência direta pro canhoto: foto **vinculada à NF/viagem**, checagem de legibilidade. |
| **Samsara / Motive** (EUA) | "Documents": templates com campos tipados — foto (câmera ou galeria), **assinatura** (nome + desenho), código de barras, campos **obrigatórios**; POD com campo de foto; DVIR pré/pós viagem [motive-docs][samsara-pod] | O padrão de mercado é **template configurável com tipos de campo**, não formulário fixo no código. Obrigatório = não envia sem; não trava o caminhão. |
| **Senior (Gestão de Rotinas)** | Texto, número, data, lista, QR, **assinatura desenhada (até 5 pessoas)**, condicionais, "não se aplica", avaliativo com peso [senior] | Confirma o pacote de tipos que todo mundo tem. |
| Produttivo, GoodCard, Rodosis, ESL, Fretefy, Infleet, Cobli, Trucker Path | Não achei documentação pública útil dos formulários. **SUPOSIÇÃO:** mesmo padrão (foto + assinatura + obrigatório + offline). | — |

**Padrão comum:** tipos (foto múltipla, PDF/galeria, número/R$, sim/não, texto, assinatura), obrigatório, GPS + hora, offline com sync. **Ninguém trava o caminhão** — o "bloqueio" é "não envia o formulário sem o campo". A nota/peso avaliativo do Checklist Fácil é herança de auditoria de loja; pra viagem, o que importa é **pendência visível pro escritório**, não nota.

## 4. O que já existe no Movatruck (pra não reinventar)

- `TipoEventoViagem` + `EventoViagem` (`apps/api/prisma/schema.prisma` ~4761/4823): catálogo por conta das **etapas da viagem** com `obrigatorio` (bloqueia "Finalizar"), `pedeFoto`, `pedeTicket`, `pedeToneladas`, `pedeValor`, `pedeGps`, `ehCarga`/`ehDescarga`, ocorrências. É **quase** o formulário de etapa — falta: **várias fotos por campo, PDF, assinatura, sim/não com regra, campos nomeados** (hoje `fotoKey` é único).
- `ModeloChecklist`/`ChecklistVeiculo` (~8582): checklist de veículo com modelo editável, foto se reprovar, offline por `clientId` — outro precedente de "modelo configurável".
- `AssinaturaDocumento` (~7488): assinatura com trilha (nome declarado, hash) — da admissão; reaproveitável na ideia, não no modelo.
- `TicketFoto` + `ConferenciaTicket` + `ticketDuplicadoDe`: ticket de pesagem já é cidadão de primeira classe.
- `common/chave-fiscal.ts`: valida chave de 44 dígitos **e o modelo** (57 CT-e × 58 MDF-e × 55 NF-e) — exatamente o que pegaria "foto do CT-e que na verdade é a NF".
- Emissor de CT-e próprio parado na rejeição 229 (memória `project_cte_emissao`) — **não** emitimos MDF-e; pra esse cliente, quem emite é a agenciadora.
- Regra da casa: **lançamento nunca é recusado** (`project_lancamento_nunca_recusado`) → resposta à pergunta 1 do cliente tende a "avisar + pendência", não travar.

## 5. Dores (o que dá errado hoje)

1. **MDF-e não encerrado** → próximo MDF-e rejeitado (611/462/686), caminhão parado no pátio carregado ou sem conseguir carregar; multa estadual [contmatic][cigam]. No formulário do cliente, a pergunta crítica **ficou em branco e nada aconteceu**.
2. **Canhoto perdido, rasgado, molhado, ilegível** → saldo do frete retido, faturamento atrasa [bsoft-comprov].
3. **Foto ilegível / foto do documento errado** (NF no lugar do CT-e) — Bsoft vende análise de foto justamente por isso [bsoft-tns].
4. **Briga de quebra de peso** sem ticket de destino legível. **SUPOSIÇÃO.**
5. **Motorista pula etapa** porque o app genérico não sabe a ordem da viagem e não cobra depois; o escritório só descobre no acerto. **SUPOSIÇÃO** (evidência: campo em branco no exemplo).
6. **Formulário solto da viagem:** o Checklist Fácil sabe a "unidade" (placa), não a viagem; casar 4 formulários com 1 frete é trabalho manual.

---

## As 6 coisas que o produto PRECISA ter

1. **Etapas presas à viagem**, não formulários soltos: carregamento, descarga, encerramento do MDF-e e acerto de frete como etapas da mesma viagem (evoluir `TipoEventoViagem`/`EventoViagem`, não criar um "Checklist Fácil" paralelo).
2. **Campos tipados por etapa, configuráveis pela empresa:** foto **múltipla**, foto **ou PDF/galeria**, sim/não, valor R$, texto, e obrigatório por campo — com GPS + hora + offline (outbox) de graça, como o resto do app.
3. **MDF-e aberto vira pendência gritante, não trava:** "comprovante de encerramento" faltando aparece pro motorista no início da próxima viagem *e* pro escritório (fila de pendências). Coerente com "lançamento nunca é recusado" e com o fato de que quem encerra é o emitente, não o motorista.
4. **Canhoto e ticket de destino como documentos de dinheiro:** status "entregue sem canhoto" visível no painel até chegar a foto; ticket reaproveita `TicketFoto`.
5. **Assinatura desenhada na tela** (responsável da agenciadora no acerto de frete), com nome digitado + foto — guardada com hora/GPS.
6. **Chave de 44 dígitos opcional nos documentos fiscais** (CT-e/MDF-e), validada por `chave-fiscal.ts` (DV + modelo) — transforma foto em dado e pega documento trocado.

## As 3 que parecem boas mas não valem agora

1. **Nota/percentual avaliativo (peso por item)** do Checklist Fácil — é mecânica de auditoria de loja; o escritório precisa de "o que falta", não de "87%".
2. **Construtor de formulário genérico** (condicionais, QR, 5 assinaturas, lógica) — vira concorrer com o Checklist Fácil; um conjunto fixo de tipos de campo nas etapas resolve os 4 formulários.
3. **Emitir/encerrar MDF-e e CIOT pelo Movatruck** — o emissor de CT-e nem saiu da 229 e, nesse cliente, quem emite é a agenciadora. Fica pra quando a empresa emitir o próprio.

---

## Fontes

- [contmatic] https://simplifique.contmatic.com.br/blogs/encerramento-de-mdfe-como-encerrar-prazo-2026
- [cigam] https://www.cigam.com.br/wiki/index.php/Como_resolver_a_rejei%C3%A7%C3%A3o_611_-_Existe_MDF-e_n%C3%A3o_encerrado_para_esta_placa,_tipo_de_emitente_e_UF_descarregamento%3F
- [tecnospeed] https://blog.tecnospeed.com.br/?p=25711
- [contmatic-ciot] https://simplifique.contmatic.com.br/blogs/ciot-o-que-e-para-que-serve-quem-precisa-emitir-2026
- [transp.net] https://www.transp.net/blog/posts/ciot-obrigatorio-2025-guia-completo/
- [jornalcontabil] https://jornalcontabil.com.br/noticia/clt-lei-a-respeito-da-jornada-de-trabalho-de-motoristas/
- [camara-lei] https://www2.camara.leg.br/legin/fed/lei/2015/lei-13103-2-marco-2015-780193-normaatualizada-pl.pdf
- [trt18] https://www.trt18.jus.br/portal/motoristas-profissionais-devem-ter-jornada-de-trabalho-controlada-independente-da-quantidade-de-empregados/
- [zapay] https://blog.usezapay.com.br/cuidados-com-o-veiculo/tacografo
- [contabeis] https://www.contabeis.com.br/forum/tributos-estaduais-municipais/54661/canhoto-assinado/
- [bsoft-comprov] https://bsoft.com.br/blog/comprovacao-de-entregas
- [portalspedbrasil] https://portalspedbrasil.com.br/?p=16497
- [bsoft-tns] https://bsoft.com.br/tns-gestao-de-entrega
- [bsoft-comprovei] https://www.bsoft.com.br/produtos/comprovei-cargo
- [motive-docs] https://helpcenter.gomotive.com/hc/en-us/articles/6162542840093-Driver-App-Documents
- [samsara-pod] https://www.samsara.com/blog/introducing-electronic-proof-of-delivery-with-driver-documents
- [senior] https://documentacao.senior.com.br/seniorx-produtos/ronda/gestao-de-rotinas/aplicativo-gestao-de-rotinas/fazer-checklists.htm
- [getapp] https://www.getapp.com/inspection-software/a/checklist-facil
- [b2bstack] https://www.b2bstack.com.br/compare/checklist-facil-vs-emma-planner
- [checklistfacil-actions] https://solucao.checklistfacil.com/en/support/solutions/articles/70000664605-action-manager-enable-and-monitor-actions
- [aprosoja-balanças] https://www.noticiasagricolas.com.br/noticia/371658
