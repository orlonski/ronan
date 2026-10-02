-- O próprio parceiro troca a chave Pix pelo app, confirmando com código no WhatsApp.
ALTER TABLE "motoristas" ADD COLUMN "chavePixAlteradaEm" TIMESTAMP(3);

CREATE TABLE "trocas_pix_pendentes" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "motoristaId" TEXT NOT NULL,
    "chavePix" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trocas_pix_pendentes_pkey" PRIMARY KEY ("motoristaId")
);
CREATE INDEX "trocas_pix_pendentes_contaId_idx" ON "trocas_pix_pendentes"("contaId");
ALTER TABLE "trocas_pix_pendentes" ADD CONSTRAINT "trocas_pix_pendentes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Capacidade nova no app. Nasce ligada.
UPDATE "perfis_acesso_app"
SET "capacidades" = array_append("capacidades", 'app.pix.editar'),
    "alteradoEm" = CURRENT_TIMESTAMP
WHERE NOT ('app.pix.editar' = ANY("capacidades"));
