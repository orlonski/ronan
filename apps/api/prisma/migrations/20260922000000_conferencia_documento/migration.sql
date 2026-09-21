-- A conferência humana do documento.
--
-- O sistema não consegue ver o que está DENTRO de uma foto: se a CNH está
-- legível, se o comodato está mesmo assinado, se o carimbo do cartório é de
-- verdade. Sem estes campos, "chegou" virava "conferido" por omissão — a ficha
-- mostrava visto verde, o app zerava a contagem, e o motorista ia pra obra
-- achando que estava resolvido.
--
-- Nulo é o estado normal de quem acabou de receber: ninguém olhou ainda.
ALTER TABLE "motorista_documento"
  ADD COLUMN "conferidoEm" TIMESTAMP(3),
  ADD COLUMN "conferidoPor" TEXT,
  ADD COLUMN "recusadoEm" TIMESTAMP(3),
  ADD COLUMN "recusadoPor" TEXT,
  ADD COLUMN "recusaMotivo" TEXT;

-- Conferido e recusado ao mesmo tempo é estado sem sentido: quem recusa
-- devolve, quem confere aceita. O banco garante que não coexistem.
ALTER TABLE "motorista_documento"
  ADD CONSTRAINT "conferido_ou_recusado_nunca_os_dois"
  CHECK ("conferidoEm" IS NULL OR "recusadoEm" IS NULL);
