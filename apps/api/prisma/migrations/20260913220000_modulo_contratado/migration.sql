-- O que a empresa contratou.
--
-- Existiam quatro mecanismos paralelos pra responder "o que essa conta tem" —
-- permissão por papel, teto por conta, flags na Conta e flags no Motorista — e
-- nenhum deles é contrato: falta a todos nome, alcance fora do painel e data.

CREATE TABLE "modulos_contratados" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "vigenteDe" DATE,
    "vigenteAte" DATE,
    "ligadoPorId" TEXT,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modulos_contratados_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "modulos_contratados_contaId_chave_key" ON "modulos_contratados"("contaId", "chave");
CREATE INDEX "modulos_contratados_contaId_ativo_idx" ON "modulos_contratados"("contaId", "ativo");

ALTER TABLE "modulos_contratados" ADD CONSTRAINT "modulos_contratados_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "modulos_contratados" ADD CONSTRAINT "modulos_contratados_ligadoPorId_fkey" FOREIGN KEY ("ligadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TODAS as contas existentes recebem TODOS os módulos, ligados.
--
-- Ninguém pode perder acesso num deploy: quem hoje usa o fechamento continua
-- usando amanhã. A plataforma desliga caso a caso depois, com a tela de
-- Empresas — que é uma decisão comercial, tomada por gente, não um efeito
-- colateral de migration.
INSERT INTO "modulos_contratados" ("id", "contaId", "chave", "ativo", "criadoEm", "alteradoEm", "observacao")
SELECT
  gen_random_uuid()::text,
  c."id",
  m."chave",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  'Ligado na migração — a conta já usava o sistema inteiro'
FROM "contas" c
CROSS JOIN (
  VALUES ('operacao'), ('conferencia'), ('fechamento'), ('comercial'),
         ('financeiro'), ('frota'), ('torre'), ('comunicacao'), ('plataforma')
) AS m("chave");
