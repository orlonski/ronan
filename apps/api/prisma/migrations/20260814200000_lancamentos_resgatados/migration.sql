-- A cópia de segurança dos lançamentos que o app não conseguiu enviar.
-- Nenhuma coluna aponta pra cadastro (payload é jsonb): a gravação não pode
-- falhar pelo mesmo motivo que derrubou o lançamento original.

-- CreateEnum
CREATE TYPE "ResolucaoResgate" AS ENUM ('SUBIU_SOZINHO', 'LANCADO_NO_PAINEL', 'DESCARTADO');

-- CreateTable
CREATE TABLE "lancamentos_resgatados" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "motoristaNome" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "erroMensagem" TEXT,
    "erroStatus" INTEGER,
    "appVersao" TEXT,
    "criadoOfflineEm" TIMESTAMP(3),
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "resolucao" "ResolucaoResgate",
    "resolvidoEm" TIMESTAMP(3),
    "resolvidoPorId" TEXT,
    "observacao" TEXT,

    CONSTRAINT "lancamentos_resgatados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lancamentos_resgatados_clientId_tipo_key" ON "lancamentos_resgatados"("clientId", "tipo");

-- CreateIndex
CREATE INDEX "lancamentos_resgatados_contaId_resolvidoEm_idx" ON "lancamentos_resgatados"("contaId", "resolvidoEm");

-- CreateIndex
CREATE INDEX "lancamentos_resgatados_motoristaId_idx" ON "lancamentos_resgatados"("motoristaId");

-- AddForeignKey
ALTER TABLE "lancamentos_resgatados" ADD CONSTRAINT "lancamentos_resgatados_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_resgatados" ADD CONSTRAINT "lancamentos_resgatados_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos_resgatados" ADD CONSTRAINT "lancamentos_resgatados_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
