-- Guarda qual versão dos Termos a pessoa marcou no formulário de cadastro.
-- Nulo = cadastro feito antes desta feature existir.
ALTER TABLE "conta_cadastro_pendente" ADD COLUMN "termoVersaoId" TEXT;
ALTER TABLE "conta_cadastro_pendente" ADD COLUMN "termoSha256" TEXT;
