-- CreateTable: regras dinâmicas de mínimo faturado por empresa + material + faixa de km.
CREATE TABLE "regras_minimo" (
    "id"              TEXT         NOT NULL,
    "empresaId"       TEXT         NOT NULL,
    "materialId"      TEXT,
    "kmFaixaDe"       DECIMAL(10,2) NOT NULL,
    "kmFaixaAte"      DECIMAL(10,2),
    "kmMinimo"        DECIMAL(10,2),
    "toneladasMinimo" DECIMAL(10,3),
    "ativo"           BOOLEAN      NOT NULL DEFAULT true,
    "criadoPorId"     TEXT,
    "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "regras_minimo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "regras_minimo_empresaId_materialId_idx" ON "regras_minimo"("empresaId", "materialId");
CREATE INDEX "regras_minimo_ativo_idx" ON "regras_minimo"("ativo");

ALTER TABLE "regras_minimo"
  ADD CONSTRAINT "regras_minimo_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "regras_minimo"
  ADD CONSTRAINT "regras_minimo_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materiais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "regras_minimo"
  ADD CONSTRAINT "regras_minimo_criadoPorId_fkey"
  FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
