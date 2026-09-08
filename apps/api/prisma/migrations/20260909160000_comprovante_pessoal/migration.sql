-- O link que o motorista autônomo manda pra quem vai pagar: os fretes de um
-- período. Espelha o ViagemCompartilhamento (comprovante da viagem da empresa),
-- mas é da PESSOA e cobre período, que é o que o autônomo precisa comprovar.
CREATE TABLE "comprovantes_pessoais" (
    "id" TEXT NOT NULL,
    "identidadeId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "destinatario" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadoEm" TIMESTAMP(3),

    CONSTRAINT "comprovantes_pessoais_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "comprovantes_pessoais_token_key" ON "comprovantes_pessoais"("token");
CREATE INDEX "comprovantes_pessoais_identidadeId_criadoEm_idx" ON "comprovantes_pessoais"("identidadeId", "criadoEm");

ALTER TABLE "comprovantes_pessoais" ADD CONSTRAINT "comprovantes_pessoais_identidadeId_fkey"
    FOREIGN KEY ("identidadeId") REFERENCES "motorista_identidades"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
