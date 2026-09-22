-- Documentos de quem é REGISTRADO EM CARTEIRA (F5 do acesso ao app).
--
-- O arquivo e a assinatura passam a ter um dono de dois tipos possíveis: o
-- cadastro de motorista (como sempre) ou o de funcionário, pra quem não tem
-- cadastro de motorista (mecânico, escritório). Nenhuma linha existente muda:
-- todas têm motoristaId, e o CHECK abaixo passa pra elas.
--
-- ⚠️ ADD VALUE num enum não pode ser USADO na mesma transação; esta migration
-- só o declara.

-- AlterEnum
ALTER TYPE "PublicoDocumento" ADD VALUE 'REGISTRADOS';

-- AlterTable
ALTER TABLE "assinaturas_documento" ADD COLUMN     "funcionarioId" TEXT,
ALTER COLUMN "motoristaId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "motorista_documento" ADD COLUMN     "funcionarioId" TEXT,
ALTER COLUMN "motoristaId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "assinaturas_documento_funcionarioId_idx" ON "assinaturas_documento"("funcionarioId");

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_documento_funcionarioId_chave_key" ON "assinaturas_documento"("funcionarioId", "chave");

-- CreateIndex
CREATE INDEX "motorista_documento_funcionarioId_idx" ON "motorista_documento"("funcionarioId");

-- CreateIndex
CREATE UNIQUE INDEX "motorista_documento_funcionarioId_chave_key" ON "motorista_documento"("funcionarioId", "chave");

-- AddForeignKey
ALTER TABLE "motorista_documento" ADD CONSTRAINT "motorista_documento_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "ponto_funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas_documento" ADD CONSTRAINT "assinaturas_documento_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "ponto_funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exatamente um dono: nem órfão, nem dos dois ao mesmo tempo.
ALTER TABLE "motorista_documento" ADD CONSTRAINT "motorista_documento_um_dono"
  CHECK (num_nonnulls("motoristaId", "funcionarioId") = 1);
ALTER TABLE "assinaturas_documento" ADD CONSTRAINT "assinaturas_documento_um_dono"
  CHECK (num_nonnulls("motoristaId", "funcionarioId") = 1);
