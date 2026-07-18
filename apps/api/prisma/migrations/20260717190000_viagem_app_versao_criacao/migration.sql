-- Carimbo da versão do app usada na CRIAÇÃO da viagem (headers x-app-version /
-- x-app-update-id do app nativo). Null pra viagens antigas ou PWA. Nullable, sem
-- default e sem backfill — seguro em prod.
ALTER TABLE "viagens" ADD COLUMN "appVersaoCriacao" TEXT;
ALTER TABLE "viagens" ADD COLUMN "appUpdateIdCriacao" TEXT;
