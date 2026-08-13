-- Código de convite por empresa.
--
-- O app publicado nas lojas é um só e não sabe de qual empresa é quem baixou.
-- O código resolve isso: o motorista digita e o cadastro entra na empresa certa.
--
-- DIRECIONA, não autoriza — o cadastro continua nascendo PENDENTE_APROVACAO e a
-- empresa aprova. Por isso um código que vaze não é incidente de segurança: o
-- estranho no máximo aparece na fila de aprovação de alguém.
ALTER TABLE "contas" ADD COLUMN "codigoConvite" TEXT;
CREATE UNIQUE INDEX "contas_codigoConvite_key" ON "contas"("codigoConvite");
