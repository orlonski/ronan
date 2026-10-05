-- De/para da conferência de ticket: o que um nome impresso no papel É no cadastro.
-- Decidido por gente na tela da viagem; a leitura da IA nunca cria vínculo.

-- CreateEnum
CREATE TYPE "TipoVinculoNome" AS ENUM ('OBRA', 'MATERIAL', 'FORNECEDOR', 'DESTINO');

-- CreateTable
CREATE TABLE "vinculos_nome_ticket" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "nomeLido" TEXT NOT NULL,
    "nomeNormalizado" TEXT NOT NULL,
    "tipo" "TipoVinculoNome" NOT NULL,
    "clienteId" TEXT,
    "materialId" TEXT,
    "criadoPorId" TEXT,
    "criadoPorNome" TEXT NOT NULL,
    "viagemOrigemId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vinculos_nome_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vinculos_nome_ticket_contaId_campo_nomeNormalizado_key" ON "vinculos_nome_ticket"("contaId", "campo", "nomeNormalizado");

-- AddForeignKey
ALTER TABLE "vinculos_nome_ticket" ADD CONSTRAINT "vinculos_nome_ticket_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_nome_ticket" ADD CONSTRAINT "vinculos_nome_ticket_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_nome_ticket" ADD CONSTRAINT "vinculos_nome_ticket_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materiais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

