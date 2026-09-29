-- ID da conta do WhatsApp (WABA) na Meta, guardado pela plataforma.
-- Antes morava só no localStorage do navegador de quem operava a tela de templates.
ALTER TABLE "configuracao_plataforma" ADD COLUMN     "metaWabaId" TEXT;
