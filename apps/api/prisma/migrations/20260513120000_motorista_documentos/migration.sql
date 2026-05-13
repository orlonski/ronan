-- Anexos de documentos por motorista (CNH, CRLV, seguro, ASO, EPI, eSocial,
-- NR, OS, registro). 1 arquivo por (motoristaId, tipo) — reupload substitui
-- o anterior. Apenas admin acessa.

CREATE TYPE "TipoDocumentoMotorista" AS ENUM (
  'CNH',
  'CRLV',
  'SEGURO_VEICULO',
  'REGISTRO_MOTORISTA',
  'ASO',
  'EPI',
  'ESOCIAL',
  'NR',
  'OS'
);

CREATE TABLE "motorista_documento" (
    "id"          TEXT                     NOT NULL,
    "motoristaId" TEXT                     NOT NULL,
    "tipo"        "TipoDocumentoMotorista" NOT NULL,
    "nomeArquivo" TEXT                     NOT NULL,
    "storageKey"  TEXT                     NOT NULL,
    "mimetype"    TEXT                     NOT NULL,
    "tamanho"     INTEGER                  NOT NULL,
    "validade"    DATE,
    "criadoEm"    TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm"  TIMESTAMP(3)             NOT NULL,
    CONSTRAINT "motorista_documento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "motorista_documento_motoristaId_tipo_key"
  ON "motorista_documento"("motoristaId", "tipo");

CREATE INDEX "motorista_documento_motoristaId_idx"
  ON "motorista_documento"("motoristaId");

ALTER TABLE "motorista_documento"
  ADD CONSTRAINT "motorista_documento_motoristaId_fkey"
  FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
