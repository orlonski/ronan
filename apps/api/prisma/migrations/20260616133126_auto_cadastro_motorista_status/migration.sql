-- Auto-cadastro de motorista com verificação por WhatsApp e aprovação manual.
-- StatusMotorista controla o ciclo de aprovação; default APROVADO pra não
-- quebrar fluxo existente (motoristas atuais e os criados pelo admin nascem
-- aprovados). Auto-cadastro pelo app nasce PENDENTE_APROVACAO.

-- CreateEnum
CREATE TYPE "StatusMotorista" AS ENUM ('PENDENTE_APROVACAO', 'APROVADO', 'REJEITADO');

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "aprovadoEm" TIMESTAMP(3),
ADD COLUMN     "aprovadoPorId" TEXT,
ADD COLUMN     "status" "StatusMotorista" NOT NULL DEFAULT 'APROVADO';

-- CreateIndex
CREATE INDEX "motoristas_status_idx" ON "motoristas"("status");

-- AddForeignKey
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_aprovadoPorId_fkey" FOREIGN KEY ("aprovadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "cadastros_motorista_pendentes" (
    "id" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "email" TEXT,
    "senhaHash" TEXT NOT NULL,
    "placas" JSONB NOT NULL,
    "codigo" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "reenvios" INTEGER NOT NULL DEFAULT 0,
    "ultimoEnvioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cadastros_motorista_pendentes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cadastros_motorista_pendentes_cpf_key" ON "cadastros_motorista_pendentes"("cpf");
