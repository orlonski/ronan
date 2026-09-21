-- De quem se cobra o documento.
--
-- Exigência sem contratante valia pra TODO motorista da conta, então quem só
-- roda frete comum via "3 documentos faltam" de uma papelada de obra que não é
-- dele. Decisão do dono: documento de admissão é cobrança de quem está no
-- mensal; pro resto não aparece pendência nenhuma.
--
-- O backfill carimba tudo que existe como MENSAL, que é o que essas linhas
-- sempre foram na prática: o catálogo nasceu junto com a obra, em 19/09/2026.
-- Quem quiser cobrar da frota inteira marca na tela.
CREATE TYPE "PublicoDocumento" AS ENUM ('MENSAL', 'TODOS');

ALTER TABLE "documentos_exigidos"
  ADD COLUMN "publico" "PublicoDocumento" NOT NULL DEFAULT 'MENSAL';
