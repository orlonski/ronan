-- Lifecycle de viagem com eventos dinâmicos configuráveis.
-- (O valor de enum EM_ANDAMENTO foi criado na migration anterior, já commitado,
--  então aqui pode ser usado no índice parcial abaixo.)

-- 1) Flag de acesso por motorista (default false = admin libera caso a caso).
ALTER TABLE "motoristas" ADD COLUMN "podeViagemLifecycle" BOOLEAN NOT NULL DEFAULT false;

-- 2) Campos da viagem que só existem no fechamento viram nullable (viagem
--    EM_ANDAMENTO pode não tê-los ainda). DROP NOT NULL não reescreve a tabela.
ALTER TABLE "viagens" ALTER COLUMN "clienteId" DROP NOT NULL;
ALTER TABLE "viagens" ALTER COLUMN "materialId" DROP NOT NULL;
ALTER TABLE "viagens" ALTER COLUMN "data" DROP NOT NULL;
ALTER TABLE "viagens" ALTER COLUMN "toneladas" DROP NOT NULL;
ALTER TABLE "viagens" ALTER COLUMN "km" DROP NOT NULL;
ALTER TABLE "viagens" ALTER COLUMN "localCargaId" DROP NOT NULL;
ALTER TABLE "viagens" ALTER COLUMN "localDescargaId" DROP NOT NULL;

-- 3) Catálogo dinâmico de tipos de evento da viagem (admin gerencia).
CREATE TABLE "tipos_evento_viagem" (
    "id"             TEXT         NOT NULL,
    "slug"           TEXT         NOT NULL,
    "nome"           TEXT         NOT NULL,
    "ativo"          BOOLEAN      NOT NULL DEFAULT true,
    "ordem"          INTEGER      NOT NULL DEFAULT 0,
    "obrigatorio"    BOOLEAN      NOT NULL DEFAULT false,
    "repetivel"      BOOLEAN      NOT NULL DEFAULT false,
    "ehCarga"        BOOLEAN      NOT NULL DEFAULT false,
    "ehDescarga"     BOOLEAN      NOT NULL DEFAULT false,
    "pedeGps"        BOOLEAN      NOT NULL DEFAULT true,
    "pedeFoto"       BOOLEAN      NOT NULL DEFAULT false,
    "pedeToneladas"  BOOLEAN      NOT NULL DEFAULT false,
    "pedeValor"      BOOLEAN      NOT NULL DEFAULT false,
    "pedeTicket"     BOOLEAN      NOT NULL DEFAULT false,
    "pedeObservacao" BOOLEAN      NOT NULL DEFAULT true,
    "criadoEm"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm"     TIMESTAMP(3) NOT NULL,
    "criadoPorId"    TEXT,
    CONSTRAINT "tipos_evento_viagem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tipos_evento_viagem_slug_key" ON "tipos_evento_viagem"("slug");
CREATE INDEX "tipos_evento_viagem_ativo_ordem_idx" ON "tipos_evento_viagem"("ativo", "ordem");

ALTER TABLE "tipos_evento_viagem"
  ADD CONSTRAINT "tipos_evento_viagem_criadoPorId_fkey"
  FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Eventos de negócio da viagem (idempotente por id gerado no client).
CREATE TABLE "eventos_viagem" (
    "id"              TEXT         NOT NULL,
    "viagemId"        TEXT         NOT NULL,
    "tipoEventoId"    TEXT         NOT NULL,
    "tipoSlug"        TEXT         NOT NULL,
    "lat"             DOUBLE PRECISION,
    "lng"             DOUBLE PRECISION,
    "precisao"        DOUBLE PRECISION,
    "localId"         TEXT,
    "fotoKey"         TEXT,
    "toneladas"       DECIMAL(10,3),
    "valor"           DECIMAL(10,2),
    "ticket"          TEXT,
    "observacao"      TEXT,
    "ocorridoEm"      TIMESTAMP(3) NOT NULL,
    "criadoOfflineEm" TIMESTAMP(3),
    "recebidoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eventos_viagem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "eventos_viagem_viagemId_ocorridoEm_idx" ON "eventos_viagem"("viagemId", "ocorridoEm");
CREATE INDEX "eventos_viagem_tipoEventoId_idx" ON "eventos_viagem"("tipoEventoId");

ALTER TABLE "eventos_viagem"
  ADD CONSTRAINT "eventos_viagem_viagemId_fkey"
  FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eventos_viagem"
  ADD CONSTRAINT "eventos_viagem_tipoEventoId_fkey"
  FOREIGN KEY ("tipoEventoId") REFERENCES "tipos_evento_viagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "eventos_viagem"
  ADD CONSTRAINT "eventos_viagem_localId_fkey"
  FOREIGN KEY ("localId") REFERENCES "locais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) "1 viagem EM_ANDAMENTO por motorista" (índice parcial — Prisma não gera).
--    Garante no nível do banco; o service também checa antes p/ responder 409.
CREATE UNIQUE INDEX "uq_viagem_em_andamento_por_motorista"
  ON "viagens" ("motoristaId") WHERE "status" = 'EM_ANDAMENTO';

-- 6) Seed dos tipos de evento base (Carga + Descarga). Idempotente por slug:
--    ON CONFLICT DO NOTHING preserva edições do admin em deploys futuros.
INSERT INTO "tipos_evento_viagem"
  ("id", "slug", "nome", "ativo", "ordem", "obrigatorio", "repetivel", "ehCarga", "ehDescarga",
   "pedeGps", "pedeFoto", "pedeToneladas", "pedeValor", "pedeTicket", "pedeObservacao", "alteradoEm")
VALUES
  (gen_random_uuid(), 'carga', 'Carga', true, 1, true, false, true, false,
   true, false, true, false, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'descarga', 'Descarga', true, 99, true, false, false, true,
   true, false, true, false, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
