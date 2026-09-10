-- Quanto custa o Movatruck, por tamanho de frota.
--
-- Tabela, e não constante no código, porque preço muda e mudar preço não pode
-- pedir deploy. É o que o SDR vai consultar quando perguntarem "quanto custa?".
CREATE TABLE "faixas_preco" (
    "id"            TEXT NOT NULL,
    "deVeiculos"    INTEGER NOT NULL,
    "ateVeiculos"   INTEGER,
    "valorCentavos" INTEGER NOT NULL,
    "rotulo"        TEXT,
    "ativa"         BOOLEAN NOT NULL DEFAULT true,
    "criadoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faixas_preco_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "faixas_preco_deVeiculos_idx" ON "faixas_preco"("deVeiculos");

-- Três faixas de partida, pra tabela não nascer vazia e a tela ter o que
-- mostrar. Os valores são um ponto de partida, não uma decisão comercial:
-- estão na tela justamente pra serem revistos antes de qualquer uso.
INSERT INTO "faixas_preco" ("id","deVeiculos","ateVeiculos","valorCentavos","rotulo","alteradoEm") VALUES
  (gen_random_uuid()::text,  1,    5,  89000, 'Frota pequena',  now()),
  (gen_random_uuid()::text,  6,   20, 189000, 'Frota média',    now()),
  (gen_random_uuid()::text, 21, NULL, 349000, 'Frota grande',   now());
