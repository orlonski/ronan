-- Confiança e evidências de Local. Motorista cadastra um destino na hora;
-- o sistema valida sozinho por GPS (registro), tracking dwell, geofence
-- passivo e recorrência. RECORRENTE/HUMANO = local "limpo".

CREATE TYPE "NivelConfiancaLocal" AS ENUM (
  'RASCUNHO',
  'PRESENCA_PONTUAL',
  'DWELL_CONFIRMADO',
  'RECORRENTE',
  'HUMANO'
);

CREATE TYPE "FonteEvidencia" AS ENUM (
  'GPS_REGISTRO',
  'TRACKING_DWELL',
  'GEOFENCE_PASSIVO',
  'RECORRENCIA',
  'ADMIN'
);

-- Adiciona colunas em locais. Locais existentes ficam como HUMANO (admin
-- cadastrou antes desse sistema, assume-se confiáveis).
ALTER TABLE "locais"
  ADD COLUMN "nivelConfianca"      "NivelConfiancaLocal" NOT NULL DEFAULT 'RASCUNHO',
  ADD COLUMN "criadoPorMotoristaId" TEXT,
  ADD COLUMN "ultimaValidacaoEm"   TIMESTAMP(3),
  ADD COLUMN "contadorValidacoes"  INTEGER              NOT NULL DEFAULT 0;

UPDATE "locais" SET "nivelConfianca" = 'HUMANO';

ALTER TABLE "locais"
  ADD CONSTRAINT "locais_criadoPorMotoristaId_fkey"
  FOREIGN KEY ("criadoPorMotoristaId") REFERENCES "motoristas"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "locais_nivelConfianca_idx" ON "locais"("nivelConfianca");

-- Histórico de evidências (audit trail + base pra recorrência).
CREATE TABLE "local_evidencia" (
  "id"          TEXT             NOT NULL,
  "localId"     TEXT             NOT NULL,
  "motoristaId" TEXT             NOT NULL,
  "fonte"       "FonteEvidencia" NOT NULL,
  "viagemId"    TEXT,
  "duracaoSeg"  INTEGER,
  "detectadoEm" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "local_evidencia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "local_evidencia_localId_idx" ON "local_evidencia"("localId");
CREATE INDEX "local_evidencia_motoristaId_localId_idx"
  ON "local_evidencia"("motoristaId", "localId");

ALTER TABLE "local_evidencia"
  ADD CONSTRAINT "local_evidencia_localId_fkey"
  FOREIGN KEY ("localId") REFERENCES "locais"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "local_evidencia"
  ADD CONSTRAINT "local_evidencia_motoristaId_fkey"
  FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
