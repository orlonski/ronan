-- Novos motoristas nascem travados nas funcionalidades sensíveis: o admin
-- libera caso a caso pelo dashboard (PATCH /admin/motoristas/:id/acessos).
-- Só muda o DEFAULT da coluna (vale pra cadastros futuros); motoristas já
-- existentes mantêm os valores atuais.

ALTER TABLE "motoristas" ALTER COLUMN "podeIniciarViagem" SET DEFAULT false;
ALTER TABLE "motoristas" ALTER COLUMN "podeLancarPedagio" SET DEFAULT false;
ALTER TABLE "motoristas" ALTER COLUMN "podeUsarOcrTicket" SET DEFAULT false;
