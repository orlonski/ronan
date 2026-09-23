-- As empresas antigas passam a seguir o padrão de uma conta nova (decidido com
-- o dono em 23/09/2026).
--
-- 1. Coluna nova: chaves ALÉM do teto padrão. Somam ao padrão sem congelá-lo.
ALTER TABLE "contas" ADD COLUMN IF NOT EXISTS "permissoesExtras" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2. Schaba: sai da lista fechada de 120 chaves (que não tinha 73 do padrão,
--    como Torre, Acertos e Financeiro) e volta ao padrão, levando só o que usa
--    além dele: Conferência de ticket e Praças de pedágio. As telas da
--    plataforma (erros, diagnóstico, demandas, WhatsApp, IA…) saem — o boot
--    poda dos papéis o que ficou acima do teto.
UPDATE "contas"
SET "permissoesPermitidas" = ARRAY[]::TEXT[],
    "permissoesExtras" = ARRAY[
      'pedagios.ver', 'pedagios.criar', 'pedagios.editar', 'pedagios.excluir', 'pedagios.importar',
      'conferencia-ticket.ver', 'conferencia-ticket.reprocessar'
    ]::TEXT[]
WHERE "id" = 'cnt_schaba';

-- 3. Schaba e Freitas ganham Admissão, como toda conta nova.
INSERT INTO "modulos_contratados" ("id", "contaId", "chave", "ativo", "vigenteDe", "criadoEm", "alteradoEm", "observacao")
SELECT gen_random_uuid()::text, c."id", 'admissao', true, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
       'Padronização com conta nova (23/09/2026).'
FROM "contas" c
WHERE c."id" IN ('cnt_schaba', 'cb7b876e-74d7-4d03-afb8-ef2a43c5265b')
ON CONFLICT ("contaId", "chave") DO UPDATE
SET "ativo" = true, "vigenteAte" = NULL, "alteradoEm" = CURRENT_TIMESTAMP,
    "observacao" = EXCLUDED."observacao";

-- 4. E perdem "Ferramentas da plataforma", que é da Movatruck, não do cliente.
UPDATE "modulos_contratados"
SET "ativo" = false, "vigenteAte" = CURRENT_DATE, "alteradoEm" = CURRENT_TIMESTAMP,
    "observacao" = 'Ferramenta da plataforma não é do cliente (23/09/2026).'
WHERE "chave" = 'plataforma'
  AND "ativo" = true
  AND "contaId" IN ('cnt_schaba', 'cb7b876e-74d7-4d03-afb8-ef2a43c5265b');
