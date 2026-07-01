-- AlterTable: registra se a busca de locais no clique "Estou na descarga" foi
-- feita offline (catálogo em cache). Null pras viagens antigas / sem captura.
ALTER TABLE "viagens" ADD COLUMN "descargaBuscaOffline" BOOLEAN;
