-- Documentos que pedimos: UMA regra só (decisão do dono, 23/09/2026).
--
-- Cada exigência diz só DE QUEM se pede: REGISTRADOS (quem é CLT, o padrão) ou
-- TODOS (motoristas também). O público MENSAL era o da obra/mensal, que saiu
-- do sistema; as linhas dele passam a REGISTRADOS. O valor fica no enum pelo
-- histórico.
--
-- `empresaId` (contratante) não é tocado: a cobrança passa a ignorá-lo.

ALTER TABLE "documentos_exigidos" ALTER COLUMN "publico" SET DEFAULT 'REGISTRADOS';

UPDATE "documentos_exigidos" SET "publico" = 'REGISTRADOS' WHERE "publico" = 'MENSAL';
