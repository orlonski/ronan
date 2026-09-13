-- O acerto do período com o motorista.
--
-- O sistema sabia faturar o cliente e não sabia pagar quem rodou. E o motorista
-- adianta pedágio e diesel do próprio bolso DENTRO do app, sem que nada
-- registrasse que a empresa devia isso a ele.

CREATE TYPE "TipoRemuneracao" AS ENUM ('SEM_REMUNERACAO', 'PERCENTUAL_FRETE', 'VALOR_POR_VIAGEM', 'VALOR_POR_TONELADA', 'VALOR_POR_KM');
CREATE TYPE "TipoItemAcerto" AS ENUM ('FRETE', 'DIARIA', 'REEMBOLSO_PEDAGIO', 'REEMBOLSO_ABASTECIMENTO', 'ADIANTAMENTO', 'DESCONTO_AVARIA', 'DESCONTO_MULTA', 'DESCONTO_COMBUSTIVEL', 'DESCONTO_OUTROS', 'BONUS', 'AJUSTE');
CREATE TYPE "StatusAcerto" AS ENUM ('ABERTO', 'FECHADO', 'PAGO');

-- Remuneração na modalidade. Nasce SEM_REMUNERACAO: ligar pagamento sozinho
-- para a frota inteira seria gerar acerto de dinheiro que ninguém pediu.
ALTER TABLE "modalidades_motorista"
  ADD COLUMN "tipoRemuneracao" "TipoRemuneracao" NOT NULL DEFAULT 'SEM_REMUNERACAO',
  ADD COLUMN "percentualFrete" DECIMAL(5,2),
  ADD COLUMN "valorPorViagem" DECIMAL(10,2),
  ADD COLUMN "valorPorTonelada" DECIMAL(10,2),
  ADD COLUMN "valorPorKm" DECIMAL(10,2),
  ADD COLUMN "valorDiaria" DECIMAL(10,2),
  ADD COLUMN "reembolsaPedagio" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reembolsaAbastecimento" BOOLEAN NOT NULL DEFAULT true;

-- Override por motorista: agregado negocia caso a caso. Tudo nullable, sem
-- default — null aqui significa "usa a regra da modalidade".
ALTER TABLE "motoristas"
  ADD COLUMN "tipoRemuneracao" "TipoRemuneracao",
  ADD COLUMN "percentualFrete" DECIMAL(5,2),
  ADD COLUMN "valorPorViagem" DECIMAL(10,2),
  ADD COLUMN "valorPorTonelada" DECIMAL(10,2),
  ADD COLUMN "valorPorKm" DECIMAL(10,2),
  ADD COLUMN "valorDiaria" DECIMAL(10,2),
  ADD COLUMN "chavePix" TEXT;

CREATE TABLE "acertos_motorista" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "periodoInicio" DATE NOT NULL,
    "periodoFim" DATE NOT NULL,
    "valorCreditos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorDebitos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorLiquido" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "StatusAcerto" NOT NULL DEFAULT 'ABERTO',
    "fechadoEm" TIMESTAMP(3),
    "fechadoPorId" TEXT,
    "pagoEm" TIMESTAMP(3),
    "pagoMeio" TEXT,
    "pagoPorId" TEXT,
    "vistoEm" TIMESTAMP(3),
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acertos_motorista_pkey" PRIMARY KEY ("id")
);

-- Gerar duas vezes o mesmo período não cria dois acertos.
CREATE UNIQUE INDEX "acertos_motorista_contaId_motoristaId_periodoInicio_periodoFim_key"
  ON "acertos_motorista"("contaId", "motoristaId", "periodoInicio", "periodoFim");
CREATE INDEX "acertos_motorista_contaId_status_idx" ON "acertos_motorista"("contaId", "status");
CREATE INDEX "acertos_motorista_motoristaId_periodoInicio_idx" ON "acertos_motorista"("motoristaId", "periodoInicio");
CREATE INDEX "acertos_motorista_contaId_idx" ON "acertos_motorista"("contaId");

CREATE TABLE "itens_acerto" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "acertoId" TEXT NOT NULL,
    "tipo" "TipoItemAcerto" NOT NULL,
    "viagemId" TEXT,
    "pedagioId" TEXT,
    "abastecimentoId" TEXT,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT,
    "automatico" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itens_acerto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "itens_acerto_acertoId_idx" ON "itens_acerto"("acertoId");
CREATE INDEX "itens_acerto_viagemId_idx" ON "itens_acerto"("viagemId");
CREATE INDEX "itens_acerto_contaId_idx" ON "itens_acerto"("contaId");

ALTER TABLE "acertos_motorista" ADD CONSTRAINT "acertos_motorista_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acertos_motorista" ADD CONSTRAINT "acertos_motorista_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acertos_motorista" ADD CONSTRAINT "acertos_motorista_fechadoPorId_fkey" FOREIGN KEY ("fechadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "acertos_motorista" ADD CONSTRAINT "acertos_motorista_pagoPorId_fkey" FOREIGN KEY ("pagoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "itens_acerto" ADD CONSTRAINT "itens_acerto_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "itens_acerto" ADD CONSTRAINT "itens_acerto_acertoId_fkey" FOREIGN KEY ("acertoId") REFERENCES "acertos_motorista"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "itens_acerto" ADD CONSTRAINT "itens_acerto_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "itens_acerto" ADD CONSTRAINT "itens_acerto_pedagioId_fkey" FOREIGN KEY ("pedagioId") REFERENCES "pedagios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "itens_acerto" ADD CONSTRAINT "itens_acerto_abastecimentoId_fkey" FOREIGN KEY ("abastecimentoId") REFERENCES "abastecimentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "itens_acerto" ADD CONSTRAINT "itens_acerto_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
