-- Migração Local↔Cliente de 1:N pra N:N.
-- Ordem importante: cria junction → backfill da FK existente → drop coluna.

-- 1) Junction table
CREATE TABLE "local_cliente" (
    "localId"   TEXT         NOT NULL,
    "clienteId" TEXT         NOT NULL,
    "criadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_cliente_pkey" PRIMARY KEY ("localId","clienteId")
);

CREATE INDEX "local_cliente_clienteId_idx" ON "local_cliente"("clienteId");

ALTER TABLE "local_cliente"
    ADD CONSTRAINT "local_cliente_localId_fkey"
    FOREIGN KEY ("localId") REFERENCES "locais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "local_cliente"
    ADD CONSTRAINT "local_cliente_clienteId_fkey"
    FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Backfill: copia FK 1:N existente pra junction
INSERT INTO "local_cliente" ("localId","clienteId")
SELECT "id","clienteId" FROM "locais" WHERE "clienteId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3) Drop coluna antiga + FK + índice
ALTER TABLE "locais" DROP CONSTRAINT IF EXISTS "locais_clienteId_fkey";
DROP INDEX IF EXISTS "locais_clienteId_idx";
ALTER TABLE "locais" DROP COLUMN "clienteId";
