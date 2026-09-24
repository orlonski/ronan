-- O schema declara @@index([localDescargaId]) em Viagem, mas nenhuma migration
-- criou o índice. O composto (localCargaId, localDescargaId, data) não serve pra
-- busca só por descarga, então contar/filtrar viagens por local de descarga
-- (lista de Locais, Mapa, filtro de local em Viagens) varria a tabela inteira.
CREATE INDEX IF NOT EXISTS "viagens_localDescargaId_idx" ON "viagens"("localDescargaId");
