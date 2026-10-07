-- API pública, Onda 1A: integrações, chaves de acesso, número do outro sistema,
-- idempotência e uso por hora. Tudo aditivo: nenhuma coluna existente muda de
-- tipo e nenhuma linha é reescrita. Desenho: docs/api-publica/04-proposta.md.

-- AlterEnum
ALTER TYPE "AcaoAuditoria" ADD VALUE 'INTEGRACAO_CRIADA';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'INTEGRACAO_REVOGADA';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'CHAVE_INTEGRACAO_CRIADA';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'CHAVE_INTEGRACAO_REVOGADA';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'INTEGRACAO_CRIOU';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'INTEGRACAO_ALTEROU';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'INTEGRACAO_ALTEROU_KM';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "integracaoId" TEXT;
ALTER TABLE "viagens" ADD COLUMN "origemIntegracaoId" TEXT,
ADD COLUMN "kmOrigem" DECIMAL(10,2),
ADD COLUMN "camposTravados" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "motoristas" ADD COLUMN "origemIntegracaoId" TEXT;
ALTER TABLE "veiculos" ADD COLUMN "origemIntegracaoId" TEXT;
ALTER TABLE "locais" ADD COLUMN "origemIntegracaoId" TEXT;

-- CreateTable
CREATE TABLE "integracoes" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "sistema" TEXT NOT NULL,
    "escopos" TEXT[],
    "transportadoraIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acessoGlobal" BOOLEAN NOT NULL DEFAULT true,
    "criadaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "revogadaEm" TIMESTAMP(3),
    "revogadaPorId" TEXT,
    "revogacaoMotivo" TEXT,

    CONSTRAINT "integracoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chaves_integracao" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "integracaoId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "inicio" TEXT NOT NULL,
    "final" TEXT NOT NULL,
    "criadaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),
    "revogadaPorId" TEXT,
    "revogacaoMotivo" TEXT,
    "ultimoUsoEm" TIMESTAMP(3),
    "ultimoUsoIp" TEXT,

    CONSTRAINT "chaves_integracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotencias_integracao" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "integracaoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "hashCorpo" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "statusHttp" INTEGER,
    "resposta" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotencias_integracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculos_externos" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "sistema" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "idExterno" TEXT NOT NULL,
    "integracaoId" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vinculos_externos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usos_integracao" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "integracaoId" TEXT NOT NULL,
    "hora" TIMESTAMP(3) NOT NULL,
    "metodo" TEXT NOT NULL,
    "rota" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "ultimoIp" TEXT,
    "ultimoCodigo" TEXT,
    "ultimoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usos_integracao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "viagens_origemIntegracaoId_idx" ON "viagens"("origemIntegracaoId");
CREATE INDEX "integracoes_contaId_idx" ON "integracoes"("contaId");
CREATE UNIQUE INDEX "chaves_integracao_hash_key" ON "chaves_integracao"("hash");
CREATE INDEX "chaves_integracao_contaId_idx" ON "chaves_integracao"("contaId");
CREATE INDEX "chaves_integracao_integracaoId_idx" ON "chaves_integracao"("integracaoId");
CREATE INDEX "idempotencias_integracao_expiraEm_idx" ON "idempotencias_integracao"("expiraEm");
CREATE INDEX "idempotencias_integracao_contaId_idx" ON "idempotencias_integracao"("contaId");
CREATE UNIQUE INDEX "idempotencias_integracao_integracaoId_chave_key" ON "idempotencias_integracao"("integracaoId", "chave");
CREATE INDEX "vinculos_externos_contaId_entidade_entidadeId_idx" ON "vinculos_externos"("contaId", "entidade", "entidadeId");
CREATE UNIQUE INDEX "vinculos_externos_contaId_sistema_entidade_idExterno_key" ON "vinculos_externos"("contaId", "sistema", "entidade", "idExterno");
CREATE UNIQUE INDEX "vinculos_externos_contaId_sistema_entidade_entidadeId_key" ON "vinculos_externos"("contaId", "sistema", "entidade", "entidadeId");
CREATE INDEX "usos_integracao_contaId_hora_idx" ON "usos_integracao"("contaId", "hora");
CREATE UNIQUE INDEX "usos_integracao_integracaoId_hora_metodo_rota_status_key" ON "usos_integracao"("integracaoId", "hora", "metodo", "rota", "status");

-- AddForeignKey
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_origemIntegracaoId_fkey" FOREIGN KEY ("origemIntegracaoId") REFERENCES "integracoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_origemIntegracaoId_fkey" FOREIGN KEY ("origemIntegracaoId") REFERENCES "integracoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_origemIntegracaoId_fkey" FOREIGN KEY ("origemIntegracaoId") REFERENCES "integracoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "locais" ADD CONSTRAINT "locais_origemIntegracaoId_fkey" FOREIGN KEY ("origemIntegracaoId") REFERENCES "integracoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integracoes" ADD CONSTRAINT "integracoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chaves_integracao" ADD CONSTRAINT "chaves_integracao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chaves_integracao" ADD CONSTRAINT "chaves_integracao_integracaoId_fkey" FOREIGN KEY ("integracaoId") REFERENCES "integracoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "idempotencias_integracao" ADD CONSTRAINT "idempotencias_integracao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotencias_integracao" ADD CONSTRAINT "idempotencias_integracao_integracaoId_fkey" FOREIGN KEY ("integracaoId") REFERENCES "integracoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vinculos_externos" ADD CONSTRAINT "vinculos_externos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "usos_integracao" ADD CONSTRAINT "usos_integracao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "usos_integracao" ADD CONSTRAINT "usos_integracao_integracaoId_fkey" FOREIGN KEY ("integracaoId") REFERENCES "integracoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
