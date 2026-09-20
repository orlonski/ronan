-- CreateEnum
CREATE TYPE "ModoAssinatura" AS ENUM ('SIMPLES', 'ICP_BRASIL');

-- AlterTable
ALTER TABLE "documentos_exigidos" ADD COLUMN     "exigeAssinatura" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "exigeIcpBrasil" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "assinaturas_documento" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "tipoDocumento" TEXT NOT NULL,
    "modo" "ModoAssinatura" NOT NULL DEFAULT 'SIMPLES',
    "nomeDeclarado" TEXT,
    "cpfDeclarado" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "hashArquivo" TEXT NOT NULL,
    "conviteColetaId" TEXT,
    "assinadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assinaturas_documento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assinaturas_documento_contaId_idx" ON "assinaturas_documento"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_documento_motoristaId_tipoDocumento_key" ON "assinaturas_documento"("motoristaId", "tipoDocumento");

-- AddForeignKey
ALTER TABLE "assinaturas_documento" ADD CONSTRAINT "assinaturas_documento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas_documento" ADD CONSTRAINT "assinaturas_documento_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

