-- Aceite de termos: o texto publicado e a prova de quem aceitou.

CREATE TYPE "TipoTermo" AS ENUM ('USO', 'PRIVACIDADE');

-- O documento. É da casa (sem contaId): uma versão vale pra todo cliente.
CREATE TABLE "termo_versoes" (
    "id" TEXT NOT NULL,
    "tipo" "TipoTermo" NOT NULL,
    "versao" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "vigenteDesde" TIMESTAMP(3) NOT NULL,
    "publicadoEm" TIMESTAMP(3),
    "oQueMudou" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "termo_versoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "termo_versoes_tipo_versao_key" ON "termo_versoes"("tipo", "versao");
CREATE INDEX "termo_versoes_tipo_vigenteDesde_idx" ON "termo_versoes"("tipo", "vigenteDesde" DESC);

-- A prova. Nunca sofre UPDATE: versão nova = linha nova.
CREATE TABLE "aceites_termo" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "termoVersaoId" TEXT NOT NULL,
    "userId" TEXT,
    "nomeQuemAceitou" TEXT NOT NULL,
    "emailQuemAceitou" TEXT NOT NULL,
    "documento" TEXT,
    "aceitoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "origem" TEXT NOT NULL,

    CONSTRAINT "aceites_termo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "aceites_termo_contaId_aceitoEm_idx" ON "aceites_termo"("contaId", "aceitoEm" DESC);
CREATE INDEX "aceites_termo_termoVersaoId_idx" ON "aceites_termo"("termoVersaoId");

ALTER TABLE "aceites_termo" ADD CONSTRAINT "aceites_termo_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "aceites_termo" ADD CONSTRAINT "aceites_termo_termoVersaoId_fkey"
    FOREIGN KEY ("termoVersaoId") REFERENCES "termo_versoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SetNull: usuário removido não apaga a prova de que ele aceitou.
ALTER TABLE "aceites_termo" ADD CONSTRAINT "aceites_termo_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
