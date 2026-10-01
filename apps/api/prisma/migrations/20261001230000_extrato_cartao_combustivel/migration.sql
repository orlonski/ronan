-- Cartão combustível: extrato importado em planilha e as passadas dele.
-- A conciliação com os abastecimentos é calculada na leitura (não gravada).

CREATE TABLE "extratos_cartao" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "operadora" TEXT,
    "periodoDe" TIMESTAMP(3) NOT NULL,
    "periodoAte" TIMESTAMP(3) NOT NULL,
    "transacoes" INTEGER NOT NULL,
    "importadoPorId" TEXT,
    "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extratos_cartao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transacoes_cartao" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "extratoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "placa" TEXT,
    "veiculoId" TEXT,
    "motorista" TEXT,
    "posto" TEXT,
    "combustivel" TEXT,
    "litros" DECIMAL(10,3),
    "valor" DECIMAL(12,2) NOT NULL,
    "odometro" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transacoes_cartao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "extratos_cartao_contaId_importadoEm_idx" ON "extratos_cartao"("contaId", "importadoEm");
CREATE UNIQUE INDEX "transacoes_cartao_contaId_chave_key" ON "transacoes_cartao"("contaId", "chave");
CREATE INDEX "transacoes_cartao_contaId_data_idx" ON "transacoes_cartao"("contaId", "data");
CREATE INDEX "transacoes_cartao_veiculoId_data_idx" ON "transacoes_cartao"("veiculoId", "data");
CREATE INDEX "transacoes_cartao_extratoId_idx" ON "transacoes_cartao"("extratoId");

ALTER TABLE "extratos_cartao" ADD CONSTRAINT "extratos_cartao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extratos_cartao" ADD CONSTRAINT "extratos_cartao_importadoPorId_fkey" FOREIGN KEY ("importadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transacoes_cartao" ADD CONSTRAINT "transacoes_cartao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transacoes_cartao" ADD CONSTRAINT "transacoes_cartao_extratoId_fkey" FOREIGN KEY ("extratoId") REFERENCES "extratos_cartao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transacoes_cartao" ADD CONSTRAINT "transacoes_cartao_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
