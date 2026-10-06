# 02 — Arquiteto: etapas da viagem com documentos

Squad Etapas da Viagem · 06/10/2026 · só desenho, nada implementado.
Entrada: `00-pedido-do-cliente.md` (4 formulários do Checklist Fácil).

---

## 0. O que o código já tem e muda o desenho

| Fato | Onde | Consequência |
|---|---|---|
| A viagem guiada já é dirigida por catálogo: `TipoEventoViagem` com `pedeFoto/pedeValor/pedeTicket/pedeToneladas/pedeObservacao`, `obrigatorio` (espinha), `repetivel`, `ehCarga/ehDescarga`, `ehOcorrencia` | `apps/api/prisma/schema.prisma:4761` | O "momento" da etapa já existe e tem nome: é o tipo de evento. Não se inventa outro eixo de tempo. |
| `EventoViagem` guarda **uma** `fotoKey`, um `valor`, um `ticket` | `schema.prisma:4823` | Não cabe "foto 1..N + PDF + sim/não + assinatura" sem virar outra coisa. |
| O servidor recusa evento se a viagem não está `EM_ANDAMENTO` (400) | `apps/api/src/motorista/viagens.service.ts:2176` (checagem logo no início) | O "Acerto de frete" acontece **depois** da descarga, às vezes depois de finalizar. Etapa não pode morar dentro do endpoint de evento. |
| Quem trava hoje é **só o app**: `EventoSheet` recusa salvar sem foto/valor (`viagem-guiada.tsx:528-544`) e `prontoParaFinalizar` segura o botão (`lib/lifecycle.ts:421-440`). O servidor aceita tudo | `FinalizarViagemBase` no `viagem-lifecycle.controller.ts:21-25` | O padrão da casa já é "trava local, servidor carimba". A etapa segue o mesmo. |
| Lançamento nunca é recusado: falta vira `ViagemDivergencia` (uma por `(viagemId, motivo)`), bloqueantes seguram em INCOMPLETA | `common/divergencias.ts:38` (`MOTIVOS_BLOQUEANTES`), `schema.prisma:61,95,113` | Pendência de etapa = um motivo novo. Mas `aplicarDivergencias` (`divergencias.ts:202`) **pula** motivo que já existe e nunca atualiza `dados` — etapa precisa de um upsert próprio. |
| Checklist do caminhão: `ModeloChecklist` → `ItemModeloChecklist` (texto, `fotoSeReprovar`, `abreAviso`) → `ChecklistVeiculo` → `RespostaChecklist` com **cópia do texto** | `schema.prisma:8582-8680`, `shared-types/src/checklist.ts` | Bom molde de "modelo + resposta com snapshot". Mas é do caminhão, do módulo Manutenção, só ok/não-ok. |
| Config de formulário por JSON versionado + leitor total que nunca lança | `shared-types/src/despesa.ts:55-119` (`CamposDoTipo`, `lerConfigCampos`) | Molde pronto pra definição de itens que o celular cacheia e pode estar velha. |
| Assinatura no dedo, **sem módulo nativo** (SVG path 300×150, vai por OTA) | `apps/motorista-app/components/assinatura-pad.tsx`, `Viagem.assinaturaRecebedor` (`schema.prisma:~4658`), capacidade `app.viagem.assinatura` (`capacidades-app.ts:181`) | Item ASSINATURA sai de graça. |
| Escolher PDF: `expo-document-picker` blindado (`requireOptionalNativeModule`) | `lib/escolher-arquivo.ts`, `package.json:39` | Item PDF só aparece onde o binário tem o módulo; o resto vê só foto. |
| Upload do motorista aceita só imagem; `MIMES_DOCUMENTO` (imagem+PDF) existe mas só o painel usa | `common/arquivo-enviado.ts:20,30`, `uploads/uploads.controller.ts:73` | Endpoint de upload novo, com `MIMES_DOCUMENTO`. |
| Outbox: despesa sobe foto a foto e marca `fotoKey` (retoma do meio); checklist manda multipart de até 30 arquivos de uma vez | `db/database.ts:537` (`PendingDespesa`), `:334` (`PendingChecklist`), `checklist.controller.ts:106` | Etapa com 6–10 fotos no 4G ruim → molde da **despesa**, não do checklist. |
| Catálogo da viagem guiada é pré-baixado no login | `lib/queries.ts:643` (`prefetchDadosBase` → `/m/viagem/tipos-evento`) | Modelos de etapa entram no mesmo prefetch. |
| PDF no servidor: `pdfkit` | `admin/acertos/acerto-pdf.service.ts:3`, `orcamento-pdf.service.ts` | Dossiê da viagem usa o mesmo. Não há `pdf-lib`: juntar os PDFs anexados num arquivo só é fatia futura. |
| Geocodificação reversa existe | `geocoding/geocoding.controller.ts:46` | "Endereço do fim" sai do servidor, depois, sem custar o motorista. |
| CT-e/MDF-e: `Viagem.cteChave`, `mdfeChave`; `common/chave-fiscal.ts` checa modelo 57/58 | `schema.prisma:~4645` | Foto do CT-e/MDF-e pode, no futuro, sugerir a chave (IA sugere, gente confirma). Não no v1. |

---

## 1. Modelo de dados

### 1.1 Decisão: definição em JSON versionado, respostas em linhas tipadas

- **Definição do formulário** muda pouco, é lida inteira pelo celular e precisa ser congelada no momento em que o motorista viu → JSON versionado e imutável por versão (molde `CamposDoTipo`).
- **Respostas** são o que o painel filtra ("quem rodou sem canhoto", "tarifa por tonelada informada") → linhas com colunas tipadas, não um blob.

### 1.2 Prisma (novo)

```prisma
enum MomentoEtapa {
  EVENTO       // amarrada a um TipoEventoViagem (carga, descarga, chegada no destino…)
  FIM_VIAGEM   // oferecida ao finalizar
  AVULSA       // "acerto de frete": a qualquer hora, inclusive depois de finalizar
}

/// O formulário que a empresa monta. Identidade estável; o conteúdo mora nas versões.
model ModeloEtapa {
  contaId      String        @default("__SEM_CONTA__")
  conta        Conta         @relation(...)
  id           String        @id @default(uuid())
  nome         String        // "Carregamento", "Descarga", "Acerto de frete"
  momento      MomentoEtapa
  tipoEvento   TipoEventoViagem? @relation(...)   // só quando momento = EVENTO
  tipoEventoId String?
  /// Janela da AVULSA: até quantos dias depois de finalizar ainda dá pra responder.
  janelaDias   Int?
  ordem        Int           @default(0)
  ativo        Boolean       @default(true)
  versaoAtual  ModeloEtapaVersao? @relation("VersaoAtual", ...)
  versaoAtualId String?      @unique
  criadoEm / alteradoEm / criadoPorId
  versoes      ModeloEtapaVersao[]
  @@index([contaId, ativo])
  @@map("modelos_etapa")
}

/// Uma versão publicada. IMUTÁVEL: editar no painel publica a próxima.
model ModeloEtapaVersao {
  contaId   String
  id        String  @id @default(uuid())
  modeloId  String
  versao    Int
  itens     Json    // ItensEtapa v1 (Zod estrito na escrita, leitor total na leitura)
  publicadaEm DateTime @default(now())
  publicadaPorId String?
  @@unique([modeloId, versao])
  @@map("modelos_etapa_versoes")
}

/// Um formulário respondido pelo motorista numa viagem.
model RespostaEtapa {
  contaId        String
  id             String   @id @default(uuid())
  clientId       String   @unique             // idempotência do outbox
  versaoId       String                       // a versão que ELE viu
  modeloId       String                       // atalho de consulta
  momento        MomentoEtapa                 // snapshot
  viagemId       String?                      // resolvido no servidor
  viagemClientId String                       // a viagem ainda pode estar no celular
  eventoViagemId String?                      // o EventoViagem que disparou (EVENTO)
  motoristaId    String                       // autor
  veiculoId      String?                      // "unidade"
  placa          String?                      // snapshot da unidade
  iniciadaEm     DateTime                     // abriu o formulário (aparelho)
  concluidaEm    DateTime                     // tocou em concluir (aparelho)
  recebidoEm     DateTime @default(now())     // chegou no servidor (sincronização)
  lat / lng / precisao Float?                 // GPS do fim
  endereco       String?                      // reverso, preenchido depois pelo servidor
  /// Itens obrigatórios que ficaram sem resposta, com o motivo que ele escreveu.
  faltando       Json?                        // [{ itemChave, rotulo, critico, motivo }]
  /// Nota dos itens avaliativos, calculada no recebimento (0–100). Cache de leitura.
  nota           Decimal? @db.Decimal(5, 2)
  itens          RespostaEtapaItem[]
  @@index([viagemId]) @@index([contaId, concluidaEm]) @@index([motoristaId, concluidaEm])
  @@map("respostas_etapa")
}

model RespostaEtapaItem {
  contaId     String
  id          String  @id @default(uuid())
  respostaId  String  (onDelete: Cascade)
  itemChave   String                 // estável entre versões
  // snapshot do item como ele viu — mudar o modelo não reescreve o passado
  rotulo      String
  area        String?
  tipo        String                 // FOTO|ARQUIVO|TEXTO|NUMERO|VALOR|SIM_NAO|ASSINATURA|DATA_HORA|GPS
  obrigatorio Boolean
  peso        Int     @default(0)
  // valor — só a coluna do tipo vem preenchida
  texto       String?
  numero      Decimal? @db.Decimal(14, 3)
  valor       Decimal? @db.Decimal(12, 2)
  simNao      Boolean?
  dataHora    DateTime?
  lat / lng / precisao Float?
  assinaturaSvg  String?             // `d` do AssinaturaPad
  assinanteNome  String?             // "pessoa responsável"
  comentario  String?
  arquivos    RespostaEtapaArquivo[]
  @@unique([respostaId, itemChave])
  @@map("respostas_etapa_itens")
}

model RespostaEtapaArquivo {
  contaId    String
  id         String @id @default(uuid())
  itemId     String (onDelete: Cascade)
  storageKey String                  // MinIO privado; sai só pela API
  mime       String                  // image/* | application/pdf
  nome       String?
  tamanho    Int
  sha256     String?                 // antiduplicação, como DespesaFoto
  ordem      Int @default(0)
  @@index([itemId]) @@index([contaId, sha256])
  @@map("respostas_etapa_arquivos")
}
```

Mais: `MotivoDivergencia.ETAPA_PENDENTE` (enum, `schema.prisma:61`) — **fora** de `MOTIVOS_BLOQUEANTES` (ver §2).

Todos com `contaId` + trava automática. Nenhum `$queryRaw` previsto; se a tela de pendências precisar, filtra `contaId` na mão (memória `feedback_sql_cru_filtra_conta`).

### 1.3 Definição dos itens — `packages/shared-types/src/etapa-viagem.ts`

```ts
type ItemEtapa = {
  chave: string;           // uuid, estável entre versões (é o que liga respostas no tempo)
  area?: string;           // "Ordem de carregamento", "Pesagem" — agrupa na tela e no PDF
  rotulo: string;          // "VALOR TARIFA TONELADA"
  ajuda?: string;          // uma linha na língua do motorista
  tipo: "FOTO" | "ARQUIVO" | "TEXTO" | "NUMERO" | "VALOR" | "SIM_NAO"
      | "ASSINATURA" | "DATA_HORA" | "GPS";
  obrigatorio: boolean;
  critico?: boolean;       // "NÃO SEGUIR VIAGEM SEM ESTE" (ver §2)
  peso?: number;           // avaliativo (0 = não conta na nota)
  // por tipo:
  fotos?: { min: number; max: number };            // FOTO / ARQUIVO (ARQUIVO aceita PDF)
  simNao?: {
    certo?: boolean;                                // qual resposta pontua (avaliativo)
    comentario?: "NAO" | "PEDE" | "EXIGE";
    fotos?: { quando: "SIM" | "NAO" | "SEMPRE"; min: number; max: number };
  };
  assinatura?: { pedeNome: boolean };               // "pessoa responsável" + desenho
  mostrarSe?: { itemChave: string; simNao: boolean }; // condicional simples (só pai SIM_NAO)
};
type ItensEtapa = { v: 1; itens: ItemEtapa[] };    // máx. 60 itens, 10 arquivos por item
```

- `SalvarModeloEtapaInput` **estrito** (painel); `lerItensEtapa(json)` **total** (app e PDF): versão desconhecida, tipo desconhecido ou campo novo → item vira "não sei mostrar, pula" em vez de tela quebrada no posto (mesma regra de `lerConfigCampos`, `despesa.ts:119`).
- Os 4 formulários do cliente cabem sem exceção. Exemplos: "POSSUI PESAGEM?" = `SIM_NAO` com `comentario: "PEDE"`; "COMPROVANTE DE DESCARGA" = `SIM_NAO` com `fotos: {quando: "SIM", min:1, max:5}`; "NOME DA TRANSPORTADORA (CIDADE)" = `TEXTO` + `FOTO` na mesma área (dois itens, não um item híbrido); "ASSINATURA" = `ASSINATURA {pedeNome:true}`.
- `ITENS_ETAPA_SUGERIDOS` (como `ITENS_CHECKLIST_SUGERIDOS`): os três modelos do cliente como **ponto de partida** que a empresa edita — nunca chumbados (memória `feedback_nada_chumbado_em_codigo`).
- `VALOR` **não** alimenta `TabelaPreco`, `ViagemValor`, acerto nem financeiro. É dado declarado. Se o dono decidir que "tarifa tonelada" é conferência do combinado (pergunta 2 do 00), vira comparação **exibida** no card da viagem, nunca escrita em lugar de dinheiro.

### 1.4 Endpoints

Motorista (`m/*`, `@RequerCapacidade("app.viagem.etapas")` + `exigirMotoristaAprovado` explícito — o decorator não checa aprovação, CLAUDE.md "Guards do motorista"):

| Rota | O quê |
|---|---|
| `GET m/etapas/modelos` | Modelos ativos com a `versaoAtual` resolvida. `@CapacidadeLivre`-like na leitura: catálogo sem dado de ninguém. |
| `POST m/uploads/etapa` | Um arquivo, `MIMES_DOCUMENTO`, 10 MB. Devolve `{storageKey, sha256}`. |
| `POST m/etapas` | `RegistrarRespostaEtapaInput` (JSON, só `storageKey`s). Idempotente por `clientId`. |
| `GET m/etapas?viagemClientId=` | O que ele já respondeu (pra tela da viagem e o "completar depois"). |
| `POST m/etapas/:clientId/completar` | Acrescenta item que ficou faltando (só adiciona; não sobrescreve item respondido). |

Regras do `POST m/etapas`, todas "aceita e carimba" (`project_lancamento_nunca_recusado`):
- versão desconhecida/antiga → aceita contra a versão que veio (é o que ele viu);
- viagem ainda não chegou → **404 transitório** (mesmo contrato do evento, `viagens.service.ts:2176`; o outbox segura sem queimar tentativa);
- viagem já finalizada → **aceita** (diferente do evento). Fechada em fechamento → aceita e carimba;
- modelo inativo/excluído → aceita com o snapshot que veio;
- FK inválida (veículo sumido) → grava null + carimba, nunca 500 (500 trava o outbox).

Painel (`admin/*`, boot-check exige `@RequerPermissao` em todos — `modulos.boot-check.ts`):

| Rota | Permissão |
|---|---|
| `GET/POST/PATCH/DELETE admin/etapas-modelos` (+ `POST :id/publicar`) | `etapas-viagem.ver/criar/editar/excluir` |
| `GET admin/viagens/:id/etapas` | `etapas-respostas.ver` |
| `GET admin/etapas/arquivos/:id` (proxy MinIO; bucket é anônimo, nunca URL direta) | `etapas-respostas.ver` |
| `GET admin/etapas/pendencias` | `etapas-respostas.ver` |
| `GET admin/viagens/:id/etapas.pdf` + link assinado (`common/link-assinado`) | `etapas-respostas.exportar` |

---

## 2. App: render offline e o obrigatório que falta

### 2.1 Render

- `GET m/etapas/modelos` entra no `prefetchDadosBase` (`lib/queries.ts:643`) e cache-first como `tipos-evento`. O app guarda **a versão** (id + JSON) junto do rascunho: modelo trocado no painel no meio do preenchimento não muda a tela dele.
- **Gatilho EVENTO:** depois que `registrarEventoGuiado` grava o evento (o `EventoSheet` continua igual e rápido — `viagem-guiada.tsx:457`), se o tipo tem modelo ativo, o app empurra a **rota** `app/etapa/[clientId].tsx`. Rota de tela cheia, **não** dentro do `<Modal>` do sheet: assinatura com `PanResponder`, confirmação inline e teclado brigam com Modal (CLAUDE.md: showConfirm atrás de Modal, KeyboardAvoidingView `padding`).
- **FIM_VIAGEM:** oferecida em `finalizar-viagem.tsx`, no mesmo lugar onde hoje entra a assinatura do recebedor.
- **AVULSA:** botão "Etapas" no cartão da viagem (em andamento ou do histórico dentro de `janelaDias`).
- **Rascunho persistente** em AsyncStorage por `clientId` da resposta: o acerto de frete é feito no balcão, com interrupção; app morto não pode perder 6 fotos.
- **Componentes por tipo:** FOTO (câmera/galeria, cópia pra `documentDirectory` — o iOS limpa `Caches/`), ARQUIVO (= FOTO + "Escolher PDF" só se `podeEscolherArquivo()`; sem o módulo nativo, o botão não aparece e o item aceita foto), VALOR (o campo de valor que a aba Gastos acabou de acertar — reaproveitar, não copiar), SIM_NAO (dois botões grandes + comentário/foto condicionais; **nada pré-selecionado**, `feedback_nunca_preselecionar_motorista`), ASSINATURA (`AssinaturaPad` + nome), DATA_HORA (`DateField/HoraField` em folha), GPS (o mesmo `capturarGps` do sheet).
- Validação guiada: rola até o campo e destaca, sem pop-up (`reference_validacao_guiada`).
- `<Image>` de arquivo já enviado só monta com token pronto (Fresco cacheia o 401).

### 2.2 Outbox

`PendingEtapa` novo em `db/database.ts`, molde `PendingDespesa` (`:537`):

```ts
{ clientId, viagemClientId, payload, arquivos: { itemChave, uri, mime, nome, storageKey?, sha256? }[],
  resumo: { modeloNome, viagemRotulo, versao /* o JSON que ele viu */ },
  status, attempts, createdAt, lastTriedAt, errorMsg, errorStatus, errorIssues, errorPermanenteLocal }
```

- Drain **depois** de `viagem-iniciar` e do evento correspondente (gate por `viagemClientId`, igual `PendingEventoViagem`, `database.ts:440`).
- Sobe arquivo a arquivo; cada `storageKey` gravado no item é a marca de "não subir de novo". Só então o POST.
- Transitório (rede/5xx/404 de viagem não chegada) não queima tentativa; stale `syncing` ~5 min; arquivo sumido do aparelho → `errorPermanenteLocal`.
- **Tela de Pendentes lista o tipo novo** (senão some da tela e fica preso no contador — CLAUDE.md).

### 2.3 Item obrigatório faltando — as duas variantes

**Variante A — Bloqueio (trava no app).** "Concluir etapa" fica cinza até todo obrigatório; item `critico` impede o próximo passo da espinha (ex.: "Finalizar viagem" some enquanto o comprovante de encerramento do MDF-e não foi anexado), via `proximoPassoObrigatorio` olhando também as etapas.
- *Ganho:* o que o cliente escreveu ("NÃO SEGUIR VIAGEM SEM ESTE") vira verdade; escritório recebe completo.
- *Custo:*
  1. Trava por coisa que **não depende do motorista**: o encerramento do MDF-e é feito pelo emissor (escritório/agenciadora); canhoto às vezes fica retido; cliente sem pesagem. O motorista fica parado com o caminhão — dinheiro dele perdido.
  2. Contradiz a regra da casa (`project_lancamento_nunca_recusado`) e repete o pior erro que o app já teve: fila de viagens travada por algo que é do cadastro, não dele (`viagens.service.ts`, comentário do `iniciar`, e `project_lifecycle_casca_orfa`).
  3. Na prática exige uma válvula ("não consegui, motivo"), e com válvula vira a variante B com mais atrito. Sem válvula, o suporte vira "cancela no painel".
  4. Servidor não pode garantir nada (o app velho e o offline passam); a trava é só cosmética do lado de cá.

**Variante B — Pendência carimbada.** Concluir sempre é possível. Obrigatório vazio exige escolher "Vou mandar depois" ou escrever o motivo; vai em `RespostaEtapa.faltando`. Servidor faz upsert de `ViagemDivergencia(ETAPA_PENDENTE)` com `dados` = lista viva do que falta (helper próprio, porque `aplicarDivergencias` não atualiza `dados` — `divergencias.ts:216`). Quando o item chega por `…/completar`, a lista encolhe; vazia → `resolvidoEm` sozinho (mesma filosofia de `resolverDivergenciasSupridas`). Motivo **informativo**: não entra em `MOTIVOS_BLOQUEANTES`, a viagem segue pro fechamento.
- *Ganho:* nunca para caminhão; escritório vê exatamente o que falta e de quem; cabe no que já existe (carimbo, tela de divergência, offline).
- *Custo:* o "não seguir sem" perde dente; precisa de cobrança depois (lembrete no app, aviso ao escritório), tela de pendências no painel e a ação "completar depois" no app. Também: se o canhoto for condição de faturar pra esse cliente, informativo é pouco — aí o motivo teria que virar bloqueante **pro fechamento** (não pro motorista), decisão por conta.

**Recomendação: B, com atrito no item `critico`.** No item crítico, pular pede confirmação inline vermelha ("Seguir sem o comprovante de encerramento do MDF-e?") + motivo escrito; o carimbo sai com `critico: true`, sobe pro topo da fila de pendências e dispara aviso ao escritório por `EnvioWhatsappService.tentarEnviar` (rota nova no catálogo `whatsapp-mensagens.ts`; nunca `enviarTexto` direto) e/ou push pro painel. Atrito pro motorista, muro nunca. Isso é exatamente o que a pergunta 1 do 00 pergunta ao cliente — se ele insistir em A, o desenho já comporta: `critico` passa a esconder o próximo passo no app, com a válvula "o escritório me liberou" (sem ela, A não deve ir pro ar).

---

## 3. Reaproveitar ou criar

- **`TipoEventoViagem` não cresce em colunas `pede*`.** Seriam 9 tipos × N fotos × áreas × condicionais em colunas, e `EventoViagem` tem uma `fotoKey` só. Ele ganha **só a ligação** (a etapa aponta pro tipo: `ModeloEtapa.tipoEventoId`). O evento continua o marco rápido (hora + GPS + local); a etapa é a papelada daquele marco. App antigo não vê nada novo em `/m/viagem/tipos-evento` (mesma lógica que separou ocorrências em rota própria, `viagem-lifecycle.controller.ts`).
- Os `pede*` atuais **ficam** e continuam valendo (quem não contratou etapas segue com a foto única do evento). Não migrar `fotoKey` de evento pra etapa.
- **Checklist do caminhão não vira caso particular agora.** É do veículo (não da viagem), do módulo Manutenção, e o item reprovado abre aviso de problema (`abreAviso`). Juntar mexe em produção sem ganho pro cliente novo. O desenho deixa a porta aberta: `SIM_NAO` + `peso` + `foto quando NAO` já é o item do checklist; num segundo momento um `ItemEtapa.abreAviso` + `momento: AVULSA` sem viagem cobriria o checklist e os dois convergem. Não fazer no v1.
- **Assinatura do recebedor (`Viagem.assinaturaRecebedor`) fica como está** — alimenta o comprovante de entrega do CT-e (evento 110180). O item ASSINATURA da etapa é outra assinatura (o responsável da transportadora contratante, no acerto de frete).
- **`AnexoPedido` não** é reaproveitado: é papel do escritório PRO motorista; aqui é do motorista PRO escritório. Mesmo armazenamento (MinIO privado, saída pela API).
- **Formulário 1 (despesas)** fica no módulo Gasto de viagem. Os dois gaps do 00: GPS **já existe** (`Despesa.lat/lng`); PDF falta (`DespesaFoto` não tem `mime`, upload só imagem). Fica registrado pra squad de despesas — outro agente está mexendo na aba Gastos agora; não tocar daqui.

---

## 4. Painel

1. **`/etapas-viagem` (montar modelos)** — gated por `etapas-viagem.ver`. Lista por momento ("Na carga", "Na descarga", "Ao finalizar", "A qualquer hora"); editor com áreas e itens arrastáveis, tipo em `Select` (não `SelecaoBotoes`), obrigatório/crítico/peso, condicional, prévia de celular. "Publicar" grava a versão nova; rascunho não vai pro app. Botão "Começar dos modelos sugeridos". Mora sob o bloco "MacBook compacto" (`max-2xl:`).
2. **Card "Etapas" na viagem** (`viagens/[id]/_components/etapas-card.tsx`, novo) — por momento: autor, placa, início/fim, GPS + endereço, sincronizado em, nota; cada item com valor, fotos no visualizador **na própria tela** (`feedback_imagem_nunca_em_aba_nova`), PDF no visualizador embutido, assinatura desenhada do SVG. Itens faltando em amarelo com o motivo dele.
3. **Pendências** — `/etapas-viagem/pendencias` (ou filtro "Etapa pendente" na lista de viagens, que já lê divergências): críticos no topo; ação "Avisar motorista".
4. **PDF por viagem** — `etapas-pdf.service.ts` com `pdfkit` (molde `acerto-pdf.service.ts`): cabeçalho da viagem, cada etapa por área, fotos reduzidas, assinatura via `doc.path(d)` escalada do quadro 300×150, PDFs anexados **listados** (juntar páginas exige `pdf-lib`, fatia futura). Link assinado pra mandar à agenciadora.
5. Permissões no catálogo `shared-types/src/permissoes.ts`: `etapas-viagem` (ver/criar/editar/excluir) e `etapas-respostas` (ver/exportar) — uma por tela, matriz segue o menu.

---

## 5. Módulo contratado

**Módulo novo, adicional: `etapas` — "Etapas e documentos da viagem"**, `recursos: ["etapas-viagem", "etapas-respostas"]`, sem `dependeDe` (a viagem guiada é núcleo). Capacidade do app `app.viagem.etapas` (`capacidades-app.ts`): `tipo: "EMPRESA"`, `modulo: "etapas"`, `dependeDe: ["app.viagem.guiada"]`, `gate: "SERVIDOR"`, `aoPerder: "VALA"` — perder acesso não pode jogar fora formulário que já está na fila (o POST continua aceitando o que foi preenchido antes do corte; só a tela some).

Por que não no núcleo: é o que separa a transportadora de longa distância (CT-e, MDF-e, tacógrafo, agenciadora) do basculante de obra; enfiar no núcleo dá de graça e entope o app de quem não precisa. Por que não no Fiscal: quem não emite CT-e aqui também precisa da foto do CT-e. Preço e se entra no teste grátis: **decisão do dono**. Schaba recebe (cobaia, `project_schaba_cobaia`); o cliente novo recebe ao contratar.

Os 9 testes de invariante de módulo pegam recurso órfão/duplicado; o boot-check pega endpoint `admin/*` sem `@RequerPermissao`.

---

## 6. Fatias que vão pro ar sozinhas

| # | Fatia | Vai por | Vai pro ar sem quebrar porque |
|---|---|---|---|
| F0 | Schema + migration + `shared-types/etapa-viagem.ts` (Zod estrito + leitor total + testes vitest do leitor e da nota) + módulo/permissões/capacidade no catálogo | push | nada lê ainda; módulo nasce desligado em toda conta (`adicional`) |
| F1 | Painel: montar e publicar modelos + sugeridos | push | só aparece pra quem tem o módulo |
| F2 | API do motorista (`m/etapas/*`, `m/uploads/etapa`) + card "Etapas" na viagem (leitura) | push | sem app, ninguém posta; testável por curl/harness |
| F3 | App: tela de etapa com FOTO/TEXTO/NUMERO/VALOR/SIM_NAO/DATA_HORA/GPS, gatilho EVENTO + AVULSA, rascunho, `PendingEtapa`, Pendentes. Variante B sem aviso | OTA (API antes do OTA — `feedback_empresa_manda_no_app`) | capacidade desligada = tela não existe |
| F4 | ARQUIVO (PDF, gated pelo módulo nativo), ASSINATURA, condicional `mostrarSe`, FIM_VIAGEM | OTA | `podeEscolherArquivo()` esconde PDF em binário velho |
| F5 | Pendência: `ETAPA_PENDENTE` com upsert, "completar depois" no app, item crítico com confirmação + aviso ao escritório, tela de pendências | push + OTA | carimbo informativo, não mexe em fechamento |
| F6 | PDF da viagem + link assinado | push | só leitura |
| F7 | Nota/peso em relatório por motorista; comparação "tarifa informada × tabela" (se o dono responder a pergunta 2) | push | só leitura |
| Depois | IA lendo foto de CT-e/MDF-e → sugere `cteChave/mdfeChave` (chave-fiscal checa modelo; gente confirma); juntar PDFs; convergir checklist | — | — |

Com F0–F3 o cliente já troca o Checklist Fácil em Carregamento e Descarga; F4 fecha o Acerto de frete (assinatura).

---

## Decisões que são do dono

1. Item crítico: atrito com pendência (recomendado) ou trava com válvula? (= pergunta 1 do 00)
2. "Valor tarifa tonelada": só registro, ou comparação com a tabela de preço? (nunca vira preço)
3. Etapas é adicional pago? Entra no teste grátis?
4. `ETAPA_PENDENTE` deve, por conta, segurar a viagem fora do fechamento (canhoto como condição de faturar)? Padrão recomendado: não.
5. Janela da etapa AVULSA depois de finalizar (sugestão: 7 dias).
