-- Identidade do motorista: separa a PESSOA (CPF) do VÍNCULO com a empresa.
-- Ver docs/identidade-motorista.md. Migration aditiva: nada é removido e todo
-- vínculo que já existia continua exatamente como estava (aceite = ACEITO).

-- 1. O lado do motorista na relação com a empresa.
CREATE TYPE "AceiteVinculo" AS ENUM ('PENDENTE', 'ACEITO', 'RECUSADO');

-- 2. A pessoa. Sem contaId de propósito: existe antes de qualquer empresa.
CREATE TABLE "motorista_identidades" (
    "id" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "senhaHash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoLoginEm" TIMESTAMP(3),
    "tentativasLogin" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoAte" TIMESTAMP(3),
    "expoPushToken" TEXT,
    "pushTokenAtualizadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "motorista_identidades_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "motorista_identidades_cpf_key" ON "motorista_identidades"("cpf");
CREATE INDEX "motorista_identidades_ativo_idx" ON "motorista_identidades"("ativo");

-- 3. Colunas novas no vínculo.
ALTER TABLE "motoristas" ADD COLUMN     "identidadeId" TEXT,
                         ADD COLUMN     "aceite" "AceiteVinculo" NOT NULL DEFAULT 'ACEITO',
                         ADD COLUMN     "convidadoPorId" TEXT,
                         ADD COLUMN     "convidadoEm" TIMESTAMP(3),
                         ADD COLUMN     "aceiteEm" TIMESTAMP(3);

-- 4. Backfill: uma identidade por CPF distinto.
--
-- A linha de origem é a mesma que o `senhaExistenteDoCpf` já elegia quando
-- precisava herdar senha entre empresas — cadastro ativo, mais recente primeiro.
-- Assim ninguém troca de senha por causa desta migration.
--
-- `ativo` nasce true pra todo mundo: aqui ele significa "a pessoa não está
-- banida da plataforma", enquanto `motoristas.ativo` continua sendo "trabalha
-- pra esta empresa". Consequência conhecida: quem foi desativado na única
-- empresa em que estava volta a conseguir entrar no app — e cai numa tela sem
-- empresa nenhuma, sem enxergar nada da operação de onde saiu.
INSERT INTO "motorista_identidades" (
    "id", "cpf", "nome", "telefone", "email", "senhaHash", "ativo",
    "ultimoLoginEm", "expoPushToken", "pushTokenAtualizadoEm", "criadoEm", "alteradoEm"
)
SELECT
    gen_random_uuid()::text,
    s."cpf",
    s."nome",
    s."telefone",
    s."email",
    s."senhaHash",
    true,
    s."ultimoLoginEm",
    s."expoPushToken",
    s."pushTokenAtualizadoEm",
    s."criadoEm",
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (m."cpf") m.*
    FROM "motoristas" m
    ORDER BY m."cpf", m."ativo" DESC, m."criadoEm" DESC
) s;

UPDATE "motoristas" m
   SET "identidadeId" = i."id"
  FROM "motorista_identidades" i
 WHERE i."cpf" = m."cpf";

-- 5. Índices e chaves estrangeiras.
CREATE INDEX "motoristas_identidadeId_idx" ON "motoristas"("identidadeId");
CREATE INDEX "motoristas_contaId_aceite_idx" ON "motoristas"("contaId", "aceite");

ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_identidadeId_fkey"
    FOREIGN KEY ("identidadeId") REFERENCES "motorista_identidades"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_convidadoPorId_fkey"
    FOREIGN KEY ("convidadoPorId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
