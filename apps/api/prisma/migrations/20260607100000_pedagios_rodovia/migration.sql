-- Pedágios em rodovia BR. Cadastro manual ou via importação OSM.
-- Usado pra detectar quais pedágios uma rota carga→descarga atravessa.

CREATE TABLE "pedagios_rodovia" (
  "id"             TEXT             NOT NULL,
  "nome"           TEXT             NOT NULL,
  "concessionaria" TEXT,
  "rodovia"        TEXT,
  "cidade"         TEXT,
  "uf"             TEXT,
  "lat"            DOUBLE PRECISION NOT NULL,
  "lng"            DOUBLE PRECISION NOT NULL,
  "valorBase"      DECIMAL(8,2),
  "ativo"          BOOLEAN          NOT NULL DEFAULT true,
  "fonte"          TEXT             NOT NULL DEFAULT 'manual',
  "osmId"          TEXT,
  "criadoEm"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "alteradoEm"     TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "pedagios_rodovia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pedagios_rodovia_osmId_key" ON "pedagios_rodovia"("osmId");
CREATE INDEX "pedagios_rodovia_lat_lng_idx" ON "pedagios_rodovia"("lat", "lng");
CREATE INDEX "pedagios_rodovia_uf_idx" ON "pedagios_rodovia"("uf");
CREATE INDEX "pedagios_rodovia_ativo_idx" ON "pedagios_rodovia"("ativo");
