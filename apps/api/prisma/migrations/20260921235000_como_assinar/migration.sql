-- Como o papel é assinado, em três estados em vez de dois booleanos.
--
-- O par `exigeAssinatura` + `exigeIcpBrasil` não expressava o caso mais comum
-- da operação: o motorista assina NO PAPEL, reconhece firma em cartório e
-- devolve uma FOTO. Marcar "exige certificado" fazia o sistema recusar essa
-- foto — ele ia ao cartório, pagava, e o app dizia não. Não marcar aceitava
-- qualquer coisa, inclusive o contrato em branco.
--
-- `exigeAssinatura` continua existindo como espelho, pra não reescrever as
-- consultas que já perguntam por ele.
CREATE TYPE "ModoAssinaturaExigida" AS ENUM ('NAO', 'NO_APP', 'JA_ASSINADO');

ALTER TYPE "ModoAssinatura" ADD VALUE IF NOT EXISTS 'NO_PAPEL';

ALTER TABLE "documentos_exigidos"
  ADD COLUMN "comoAssinar" "ModoAssinaturaExigida" NOT NULL DEFAULT 'NAO';

-- Backfill fiel ao que cada linha significava:
--   sem assinatura            -> NAO
--   assinatura simples        -> NO_APP   (o aceite eletrônico daqui)
--   exigia certificado        -> JA_ASSINADO, mantendo exigeIcpBrasil = true
UPDATE "documentos_exigidos"
   SET "comoAssinar" = CASE
       WHEN "exigeAssinatura" = false THEN 'NAO'::"ModoAssinaturaExigida"
       WHEN "exigeIcpBrasil" = true  THEN 'JA_ASSINADO'::"ModoAssinaturaExigida"
       ELSE 'NO_APP'::"ModoAssinaturaExigida"
   END;
