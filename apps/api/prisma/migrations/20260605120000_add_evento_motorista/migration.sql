-- EventoMotorista: telemetria semântica de operação. Diferente de error_logs
-- (que captura crashes JS), aqui é "ação/resultado aconteceu — quero saber".
-- Linka a viagem via viagemId (após sync) ou viagemClientId (pré-sync). A
-- reconciliação acontece no service de criação de viagem: UPDATE WHERE
-- viagemClientId = ? AND viagemId IS NULL.
--
-- "id" sem default porque o motorista gera UUID local (idempotência: se enviar
-- o mesmo evento 2x, o ON CONFLICT no upsert ignora). Tipo string livre (não
-- enum) pra adicionar tipos novos sem migration; enum tipado vive em
-- shared-types (TipoEvento).

CREATE TABLE "eventos_motorista" (
    "id"             TEXT          NOT NULL,
    "motoristaId"    TEXT          NOT NULL,
    "viagemId"       TEXT,
    "viagemClientId" TEXT,
    "tipo"           TEXT          NOT NULL,
    "contexto"       JSONB         NOT NULL,
    "online"         BOOLEAN       NOT NULL,
    "versaoApp"      TEXT,
    "origem"         TEXT          NOT NULL,
    "capturadoEm"    TIMESTAMP(3)  NOT NULL,
    "recebidoEm"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_motorista_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "eventos_motorista"
  ADD CONSTRAINT "eventos_motorista_motoristaId_fkey"
  FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eventos_motorista"
  ADD CONSTRAINT "eventos_motorista_viagemId_fkey"
  FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "eventos_motorista_motoristaId_capturadoEm_idx"    ON "eventos_motorista"("motoristaId", "capturadoEm");
CREATE INDEX "eventos_motorista_viagemId_capturadoEm_idx"       ON "eventos_motorista"("viagemId", "capturadoEm");
CREATE INDEX "eventos_motorista_viagemClientId_capturadoEm_idx" ON "eventos_motorista"("viagemClientId", "capturadoEm");
CREATE INDEX "eventos_motorista_tipo_capturadoEm_idx"           ON "eventos_motorista"("tipo", "capturadoEm");
