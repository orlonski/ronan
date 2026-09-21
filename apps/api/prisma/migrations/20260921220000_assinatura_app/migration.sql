-- O motorista assinando pelo app, e a prova de que ele abriu o papel antes.
--
-- `vistoEm` é carimbado pelo SERVIDOR no download, nunca declarado pelo app:
-- declaração do cliente não prova nada contra quem a escreveu.
--
-- `origem` na assinatura porque `conviteColetaId` nulo dizia só "não foi por
-- link" — e a diferença importa: pelo app quem assinou estava autenticado com
-- CPF e senha, num aparelho com histórico. É o que separa indício de autoria.
ALTER TABLE "motorista_documento" ADD COLUMN "vistoEm" TIMESTAMP(3);

ALTER TABLE "assinaturas_documento"
  ADD COLUMN "origem" "OrigemDocumento" NOT NULL DEFAULT 'LINK',
  ADD COLUMN "viuDocumento" BOOLEAN NOT NULL DEFAULT false;
