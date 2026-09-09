-- Prospecção ativa: a empresa passa a ser o centro do lead.
--
-- O formulário do site conhece a PESSOA (ela digitou o nome e o telefone). A
-- prospecção conhece a EMPRESA (CNPJ, RNTRC, município do dado aberto da ANTT)
-- e não conhece pessoa nenhuma até alguém atender. Por isso nome e telefone
-- deixam de ser obrigatórios — a validação de quem preenche o formulário
-- continua sendo feita pelo Zod, na borda.
--
-- "supressoes_contato" é tabela separada de propósito: o opt-out precisa
-- sobreviver ao lead ser apagado ou recriado na próxima carga mensal do RNTRC.
-- Se morasse só numa coluna do lead, a importação seguinte traria a empresa
-- limpa e a gente contataria de novo quem mandou parar.

ALTER TABLE "leads" ALTER COLUMN "nome" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "telefone" DROP NOT NULL;

ALTER TABLE "leads" ADD COLUMN "cnpj" TEXT;
ALTER TABLE "leads" ADD COLUMN "rntrc" TEXT;
ALTER TABLE "leads" ADD COLUMN "municipio" TEXT;
ALTER TABLE "leads" ADD COLUMN "uf" TEXT;
ALTER TABLE "leads" ADD COLUMN "cep" TEXT;
ALTER TABLE "leads" ADD COLUMN "site" TEXT;
ALTER TABLE "leads" ADD COLUMN "categoria" TEXT;
ALTER TABLE "leads" ADD COLUMN "frotaQtd" INTEGER;
ALTER TABLE "leads" ADD COLUMN "registradoEm" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "score" INTEGER;
ALTER TABLE "leads" ADD COLUMN "scoreMotivo" TEXT;

CREATE UNIQUE INDEX "leads_cnpj_key" ON "leads"("cnpj");
CREATE INDEX "leads_uf_categoria_status_idx" ON "leads"("uf", "categoria", "status");
CREATE INDEX "leads_score_idx" ON "leads"("score" DESC);

CREATE TABLE "interacoes_lead" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "desfecho" TEXT NOT NULL,
    "resumo" TEXT,
    "autor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interacoes_lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "interacoes_lead_leadId_criadoEm_idx" ON "interacoes_lead"("leadId", "criadoEm" DESC);
CREATE INDEX "interacoes_lead_canal_criadoEm_idx" ON "interacoes_lead"("canal", "criadoEm" DESC);

ALTER TABLE "interacoes_lead"
  ADD CONSTRAINT "interacoes_lead_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "supressoes_contato" (
    "id" TEXT NOT NULL,
    "contato" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "motivo" TEXT,
    "fonte" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supressoes_contato_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supressoes_contato_contato_key" ON "supressoes_contato"("contato");
CREATE INDEX "supressoes_contato_tipo_idx" ON "supressoes_contato"("tipo");
