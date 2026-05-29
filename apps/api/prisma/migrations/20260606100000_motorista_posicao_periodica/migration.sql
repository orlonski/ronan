-- Captura periódica de posição do motorista (controle de frota). Opt-in
-- por motorista. Tabela de config (1:1) + histórico append-only.

CREATE TABLE "motorista_posicao_config" (
  "motoristaId"   TEXT          NOT NULL,
  "ativada"       BOOLEAN       NOT NULL DEFAULT false,
  "horarioInicio" INTEGER,
  "horarioFim"    INTEGER,
  "alteradoEm"    TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "motorista_posicao_config_pkey" PRIMARY KEY ("motoristaId")
);

ALTER TABLE "motorista_posicao_config"
  ADD CONSTRAINT "motorista_posicao_config_motoristaId_fkey"
  FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "motorista_posicoes" (
  "id"          TEXT             NOT NULL,
  "motoristaId" TEXT             NOT NULL,
  "lat"         DOUBLE PRECISION NOT NULL,
  "lng"         DOUBLE PRECISION NOT NULL,
  "precisao"    DOUBLE PRECISION,
  "velocidade"  DOUBLE PRECISION,
  "capturadoEm" TIMESTAMP(3)     NOT NULL,
  "recebidoEm"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "motorista_posicoes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "motorista_posicoes"
  ADD CONSTRAINT "motorista_posicoes_motoristaId_fkey"
  FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "motorista_posicoes_motoristaId_capturadoEm_key"
  ON "motorista_posicoes"("motoristaId", "capturadoEm");
CREATE INDEX "motorista_posicoes_motoristaId_capturadoEm_idx"
  ON "motorista_posicoes"("motoristaId", "capturadoEm");
CREATE INDEX "motorista_posicoes_capturadoEm_idx"
  ON "motorista_posicoes"("capturadoEm");
