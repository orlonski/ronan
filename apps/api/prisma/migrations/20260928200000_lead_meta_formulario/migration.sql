-- Leads do formulário de anúncio da Meta.
ALTER TABLE "leads" ADD COLUMN "metaLeadgenId" TEXT;
ALTER TABLE "leads" ADD COLUMN "metaFormId" TEXT;
ALTER TABLE "leads" ADD COLUMN "metaAdId" TEXT;
ALTER TABLE "leads" ADD COLUMN "metaAnuncio" TEXT;
ALTER TABLE "leads" ADD COLUMN "metaCampanha" TEXT;
ALTER TABLE "leads" ADD COLUMN "funcaoInformada" TEXT;

CREATE UNIQUE INDEX "leads_metaLeadgenId_key" ON "leads"("metaLeadgenId");
