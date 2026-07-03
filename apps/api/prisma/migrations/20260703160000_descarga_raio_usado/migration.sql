-- Raio (m) em que o local de descarga foi encontrado na busca por GPS (inicial
-- ou ampliado, conforme a config do painel). Auditoria de quão "solta" foi a
-- marcação. Aditivo e não-destrutivo: coluna nullable, sem default, sem backfill.
ALTER TABLE "viagens" ADD COLUMN "descargaRaioUsadoM" INTEGER;
