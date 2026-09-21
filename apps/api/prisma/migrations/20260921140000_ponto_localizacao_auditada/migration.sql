-- Consultar a coordenada de uma batida de ponto passa a deixar rastro.
--
-- A coleta já existia e já tinha expurgo; o que faltava era a outra ponta.
-- Dado de geolocalização de empregado sem registro de quem consultou é o
-- mesmo problema que o registro de ponto mutável: ninguém consegue
-- reconstituir depois.
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'PONTO_VIU_LOCALIZACAO';
