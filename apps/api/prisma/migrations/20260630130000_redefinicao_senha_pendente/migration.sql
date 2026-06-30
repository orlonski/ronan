-- Fluxo "esqueci minha senha" do motorista: pedido de redefinição verificado
-- por código no WhatsApp. 1 pendente por motorista (chave única).

CREATE TABLE "redefinicoes_senha_pendentes" (
    "id" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "vincular" BOOLEAN NOT NULL DEFAULT false,
    "codigo" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "reenvios" INTEGER NOT NULL DEFAULT 0,
    "ultimoEnvioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redefinicoes_senha_pendentes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "redefinicoes_senha_pendentes_motoristaId_key" ON "redefinicoes_senha_pendentes"("motoristaId");

ALTER TABLE "redefinicoes_senha_pendentes" ADD CONSTRAINT "redefinicoes_senha_pendentes_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
