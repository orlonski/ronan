-- Financeiro: a fatura, o que entra e o que sai.
--
-- O sistema conferia a conta do cliente com maestria e não sabia emitir a
-- própria. O fechamento terminava em "marquei como enviado" e o rastro do
-- dinheiro acabava ali — depois disso, planilha.

CREATE TYPE "StatusFatura" AS ENUM ('RASCUNHO', 'EMITIDA', 'ENVIADA', 'CANCELADA');
CREATE TYPE "StatusTitulo" AS ENUM ('ABERTO', 'PARCIAL', 'PAGO', 'CANCELADO');
CREATE TYPE "TipoFornecedor" AS ENUM ('POSTO', 'OFICINA', 'PNEU', 'SEGURADORA', 'PEDAGIO', 'OUTRO');

CREATE TABLE "faturas" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fechamentoId" TEXT,
    "periodoInicio" DATE NOT NULL,
    "periodoFim" DATE NOT NULL,
    "valorBruto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorDescontos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorLiquido" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "StatusFatura" NOT NULL DEFAULT 'RASCUNHO',
    "emitidaEm" TIMESTAMP(3),
    "documentoNumero" TEXT,
    "documentoChave" TEXT,
    "observacao" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "faturas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "faturas_contaId_numero_key" ON "faturas"("contaId", "numero");
CREATE INDEX "faturas_empresaId_periodoInicio_idx" ON "faturas"("empresaId", "periodoInicio");
CREATE INDEX "faturas_contaId_status_idx" ON "faturas"("contaId", "status");
CREATE INDEX "faturas_contaId_idx" ON "faturas"("contaId");

CREATE TABLE "fatura_linhas" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "faturaId" TEXT NOT NULL,
    "viagemId" TEXT,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "precoUnitario" DECIMAL(10,2) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "fatura_linhas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fatura_linhas_faturaId_idx" ON "fatura_linhas"("faturaId");
CREATE INDEX "fatura_linhas_contaId_idx" ON "fatura_linhas"("contaId");

CREATE TABLE "titulos_receber" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "faturaId" TEXT,
    "empresaId" TEXT NOT NULL,
    "parcela" INTEGER NOT NULL DEFAULT 1,
    "emissao" DATE NOT NULL,
    "vencimento" DATE NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "valorPago" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "StatusTitulo" NOT NULL DEFAULT 'ABERTO',
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "titulos_receber_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "titulos_receber_contaId_status_vencimento_idx" ON "titulos_receber"("contaId", "status", "vencimento");
CREATE INDEX "titulos_receber_empresaId_vencimento_idx" ON "titulos_receber"("empresaId", "vencimento");
CREATE INDEX "titulos_receber_contaId_idx" ON "titulos_receber"("contaId");

CREATE TABLE "fornecedores" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpjCpf" TEXT,
    "tipo" "TipoFornecedor" NOT NULL DEFAULT 'OUTRO',
    "telefone" TEXT,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fornecedores_contaId_nome_key" ON "fornecedores"("contaId", "nome");
CREATE INDEX "fornecedores_contaId_tipo_idx" ON "fornecedores"("contaId", "tipo");
CREATE INDEX "fornecedores_contaId_idx" ON "fornecedores"("contaId");

CREATE TABLE "titulos_pagar" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "motoristaId" TEXT,
    "transportadoraId" TEXT,
    "fornecedorId" TEXT,
    "acertoId" TEXT,
    "veiculoId" TEXT,
    "descricao" TEXT NOT NULL,
    "emissao" DATE NOT NULL,
    "vencimento" DATE NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "valorPago" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "StatusTitulo" NOT NULL DEFAULT 'ABERTO',
    "observacao" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "titulos_pagar_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "titulos_pagar_contaId_status_vencimento_idx" ON "titulos_pagar"("contaId", "status", "vencimento");
CREATE INDEX "titulos_pagar_contaId_idx" ON "titulos_pagar"("contaId");

CREATE TABLE "baixas_titulo" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "tituloReceberId" TEXT,
    "tituloPagarId" TEXT,
    "data" DATE NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "meio" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "baixas_titulo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "baixas_titulo_contaId_data_idx" ON "baixas_titulo"("contaId", "data");
CREATE INDEX "baixas_titulo_tituloReceberId_idx" ON "baixas_titulo"("tituloReceberId");
CREATE INDEX "baixas_titulo_tituloPagarId_idx" ON "baixas_titulo"("tituloPagarId");
CREATE INDEX "baixas_titulo_contaId_idx" ON "baixas_titulo"("contaId");

CREATE TABLE "custos_fixos_veiculo" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valorMensal" DECIMAL(12,2) NOT NULL,
    "vigenciaDe" DATE NOT NULL,
    "vigenciaAte" DATE,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "custos_fixos_veiculo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "custos_fixos_veiculo_veiculoId_idx" ON "custos_fixos_veiculo"("veiculoId");
CREATE INDEX "custos_fixos_veiculo_contaId_idx" ON "custos_fixos_veiculo"("contaId");

ALTER TABLE "faturas" ADD CONSTRAINT "faturas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "faturas" ADD CONSTRAINT "faturas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "faturas" ADD CONSTRAINT "faturas_fechamentoId_fkey" FOREIGN KEY ("fechamentoId") REFERENCES "fechamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "faturas" ADD CONSTRAINT "faturas_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fatura_linhas" ADD CONSTRAINT "fatura_linhas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fatura_linhas" ADD CONSTRAINT "fatura_linhas_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "faturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fatura_linhas" ADD CONSTRAINT "fatura_linhas_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "titulos_receber" ADD CONSTRAINT "titulos_receber_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "titulos_receber" ADD CONSTRAINT "titulos_receber_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "faturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "titulos_receber" ADD CONSTRAINT "titulos_receber_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "titulos_pagar" ADD CONSTRAINT "titulos_pagar_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "titulos_pagar" ADD CONSTRAINT "titulos_pagar_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "titulos_pagar" ADD CONSTRAINT "titulos_pagar_transportadoraId_fkey" FOREIGN KEY ("transportadoraId") REFERENCES "transportadoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "titulos_pagar" ADD CONSTRAINT "titulos_pagar_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "titulos_pagar" ADD CONSTRAINT "titulos_pagar_acertoId_fkey" FOREIGN KEY ("acertoId") REFERENCES "acertos_motorista"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "titulos_pagar" ADD CONSTRAINT "titulos_pagar_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "titulos_pagar" ADD CONSTRAINT "titulos_pagar_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "baixas_titulo" ADD CONSTRAINT "baixas_titulo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "baixas_titulo" ADD CONSTRAINT "baixas_titulo_tituloReceberId_fkey" FOREIGN KEY ("tituloReceberId") REFERENCES "titulos_receber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "baixas_titulo" ADD CONSTRAINT "baixas_titulo_tituloPagarId_fkey" FOREIGN KEY ("tituloPagarId") REFERENCES "titulos_pagar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "baixas_titulo" ADD CONSTRAINT "baixas_titulo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "custos_fixos_veiculo" ADD CONSTRAINT "custos_fixos_veiculo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custos_fixos_veiculo" ADD CONSTRAINT "custos_fixos_veiculo_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
