-- Obra e diária saem do sistema (decisão do dono, 22/09/2026: "não serve pra
-- absolutamente nada"). Conferido em produção antes: nenhuma empresa lançou
-- viagem por período, e o módulo de obra só estava ligado na conta de teste.
--
-- ⚠️ Esta migration NÃO pode falhar em produção (falha trava todo deploy
-- seguinte, P3009). Por isso: nada de RAISE, tudo com IF EXISTS, e dinheiro
-- nunca é apagado — linha de acerto de diária vira AJUSTE com a descrição
-- marcada, e valor de viagem por período vira valor fechado por viagem.

-- 1) As capacidades do app ------------------------------------------------------
UPDATE "perfis_acesso_app"
   SET "capacidades" = ARRAY(SELECT c FROM unnest("capacidades") c
                             WHERE c NOT IN ('app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca'))
 WHERE "capacidades" && ARRAY['app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca'];

UPDATE "acessos_efetivos_app"
   SET "capacidades" = ARRAY(SELECT c FROM unnest("capacidades") c
                             WHERE c NOT IN ('app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca')),
       "capacidadesSombra" = ARRAY(SELECT c FROM unnest("capacidadesSombra") c
                                   WHERE c NOT IN ('app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca'))
 WHERE "capacidades" && ARRAY['app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca']
    OR "capacidadesSombra" && ARRAY['app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca'];

UPDATE "configuracao_acesso_app"
   SET "capacidadesTravadas" = ARRAY(SELECT c FROM unnest("capacidadesTravadas") c
                                     WHERE c NOT IN ('app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca'))
 WHERE "capacidadesTravadas" && ARRAY['app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca'];

UPDATE "contas"
   SET "rolloutsApp" = ARRAY(SELECT c FROM unnest("rolloutsApp") c
                             WHERE c NOT IN ('app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca'))
 WHERE "rolloutsApp" && ARRAY['app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca'];

-- Exceção viva fica revogada, com o porquê — é histórico de quem deu o quê.
UPDATE "excecoes_acesso_app"
   SET "revogadaEm" = now(),
       "motivoRevogacao" = 'Obra e diária foram removidas do sistema.',
       "chaveViva" = NULL
 WHERE "capacidade" IN ('app.diaria.lancar', 'app.diaria.verValor', 'app.obra.presenca')
   AND "revogadaEm" IS NULL;

-- 2) Módulo e permissões do painel ----------------------------------------------
DELETE FROM "modulos_contratados" WHERE "chave" = 'mensal';

UPDATE "papeis"
   SET "permissoes" = ARRAY(SELECT p FROM unnest("permissoes") p
                            WHERE p NOT LIKE 'alocacoes.%' AND p NOT LIKE 'presenca.%' AND p NOT LIKE 'espelhos.%')
 WHERE EXISTS (SELECT 1 FROM unnest("permissoes") p
               WHERE p LIKE 'alocacoes.%' OR p LIKE 'presenca.%' OR p LIKE 'espelhos.%');

UPDATE "papeis_modelo"
   SET "permissoes" = ARRAY(SELECT p FROM unnest("permissoes") p
                            WHERE p NOT LIKE 'alocacoes.%' AND p NOT LIKE 'presenca.%' AND p NOT LIKE 'espelhos.%')
 WHERE EXISTS (SELECT 1 FROM unnest("permissoes") p
               WHERE p LIKE 'alocacoes.%' OR p LIKE 'presenca.%' OR p LIKE 'espelhos.%');

UPDATE "contas"
   SET "permissoesPermitidas" = ARRAY(SELECT p FROM unnest("permissoesPermitidas") p
                                      WHERE p NOT LIKE 'alocacoes.%' AND p NOT LIKE 'presenca.%' AND p NOT LIKE 'espelhos.%')
 WHERE EXISTS (SELECT 1 FROM unnest("permissoesPermitidas") p
               WHERE p LIKE 'alocacoes.%' OR p LIKE 'presenca.%' OR p LIKE 'espelhos.%');

UPDATE "configuracao_permissoes"
   SET "tetoPadrao" = ARRAY(SELECT p FROM unnest("tetoPadrao") p
                            WHERE p NOT LIKE 'alocacoes.%' AND p NOT LIKE 'presenca.%' AND p NOT LIKE 'espelhos.%')
 WHERE EXISTS (SELECT 1 FROM unnest("tetoPadrao") p
               WHERE p LIKE 'alocacoes.%' OR p LIKE 'presenca.%' OR p LIKE 'espelhos.%');

-- 3) Regime de parceiro que só a obra abria --------------------------------------
-- Ninguém mais abre nem fecha regime PARCEIRO; um vivo esquecido barraria a
-- pessoa de ser importada como funcionário.
UPDATE "regimes_vigentes"
   SET "encerradoEm" = now(),
       "chaveViva" = NULL,
       "motivo" = COALESCE("motivo" || ' · ', '') || 'Encerrado porque obra e diária foram removidas do sistema.'
 WHERE "regime" = 'PARCEIRO' AND "encerradoEm" IS NULL;

-- 4) Dinheiro: acerto e valor da viagem, sem apagar nada -------------------------
UPDATE "itens_acerto" SET "registroPresencaId" = NULL WHERE "registroPresencaId" IS NOT NULL;

UPDATE "itens_acerto"
   SET "tipo" = 'AJUSTE',
       "descricao" = 'Diária (removida): ' || "descricao"
 WHERE "tipo" = 'DIARIA';

UPDATE "viagem_valores" SET "base" = 'VIAGEM' WHERE "base" IN ('PERIODO', 'DIARIA_OBRA');

-- 5) Viagem de diária ainda aberta vira INCOMPLETA (fora do fechamento, igual) ---
UPDATE "viagens" SET "status" = 'INCOMPLETA' WHERE "status" = 'AGUARDANDO_SAIDA';

-- 6) Modo de cobrança por período e preço de diária ------------------------------
-- A conta que tinha a diária como padrão passa o padrão pro modo por peso.
UPDATE "tipos_servico" t
   SET "padrao" = false
 WHERE t."medicao" = 'PERIODO' AND t."padrao";

UPDATE "tipos_servico" t
   SET "padrao" = true
 WHERE t."medicao" = 'PESO'
   AND NOT EXISTS (SELECT 1 FROM "tipos_servico" o WHERE o."contaId" = t."contaId" AND o."padrao")
   AND t."id" = (SELECT o."id" FROM "tipos_servico" o
                  WHERE o."contaId" = t."contaId" AND o."medicao" = 'PESO'
                  ORDER BY o."ativo" DESC, o."ordem", o."criadoEm" LIMIT 1);

UPDATE "viagens" SET "tipoServicoId" = NULL
 WHERE "tipoServicoId" IN (SELECT "id" FROM "tipos_servico" WHERE "medicao" = 'PERIODO');
UPDATE "pedidos" SET "tipoServicoId" = NULL
 WHERE "tipoServicoId" IN (SELECT "id" FROM "tipos_servico" WHERE "medicao" = 'PERIODO');

-- Preço de diária: sem a base, a linha não tem o que precificar. O valor já
-- materializado da viagem fica (o vínculo vira NULL pelo ON DELETE SET NULL).
DELETE FROM "tabelas_preco" WHERE "base" IN ('PERIODO', 'DIARIA_OBRA');
DELETE FROM "tabelas_preco"
 WHERE "tipoServicoId" IN (SELECT "id" FROM "tipos_servico" WHERE "medicao" = 'PERIODO');
DELETE FROM "tipos_servico" WHERE "medicao" = 'PERIODO';

-- 7) Colunas e tabelas ----------------------------------------------------------
ALTER TABLE "itens_acerto" DROP CONSTRAINT IF EXISTS "itens_acerto_registroPresencaId_fkey";
DROP INDEX IF EXISTS "itens_acerto_registroPresencaId_idx";
ALTER TABLE "itens_acerto" DROP COLUMN IF EXISTS "registroPresencaId";

DROP TABLE IF EXISTS "registros_presenca" CASCADE;
DROP TABLE IF EXISTS "alocacoes_obra" CASCADE;
DROP TABLE IF EXISTS "config_mensal_contratante" CASCADE;
DROP TABLE IF EXISTS "medicoes_contratante" CASCADE;
DROP TYPE IF EXISTS "OrigemPresenca";

ALTER TABLE "viagens" DROP COLUMN IF EXISTS "entradaEm";
ALTER TABLE "viagens" DROP COLUMN IF EXISTS "saidaEm";
ALTER TABLE "viagens" DROP COLUMN IF EXISTS "duracaoMinutos";

ALTER TABLE "tipos_servico" DROP COLUMN IF EXISTS "medicao";
DROP TYPE IF EXISTS "MedicaoViagem";

ALTER TABLE "motoristas" DROP COLUMN IF EXISTS "podeDiaria";
ALTER TABLE "motoristas" DROP COLUMN IF EXISTS "podeVerValorDiaria";
ALTER TABLE "motoristas" DROP COLUMN IF EXISTS "valorDiaria";
ALTER TABLE "perfis_acesso_app" DROP COLUMN IF EXISTS "podeDiaria";
ALTER TABLE "perfis_acesso_app" DROP COLUMN IF EXISTS "podeVerValorDiaria";
ALTER TABLE "modalidades_motorista" DROP COLUMN IF EXISTS "valorDiaria";

-- 8) Enums sem os valores que saíram --------------------------------------------
-- Postgres não remove valor de enum: recria o tipo.
-- ⚠️ NÃO recriar o "uq_viagem_em_andamento_por_motorista": ele foi derrubado de
-- propósito em 20260816120100_viagem_divergencias (barrava viagem nova do
-- motorista), e produção tem motorista com duas viagens abertas — recriar faria
-- esta migration falhar e travar todo deploy seguinte. O DROP fica só pra
-- bancos que ainda o tenham.
DROP INDEX IF EXISTS "uq_viagem_em_andamento_por_motorista";

ALTER TYPE "StatusViagem" RENAME TO "StatusViagem_old";
CREATE TYPE "StatusViagem" AS ENUM ('RASCUNHO_OFFLINE', 'ENVIADA', 'EM_CONFERENCIA', 'DIVERGENTE', 'AJUSTADA', 'OK', 'EM_ANDAMENTO', 'AGUARDANDO_PESO', 'INCOMPLETA');
ALTER TABLE "viagens" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "viagens" ALTER COLUMN "status" TYPE "StatusViagem" USING ("status"::text::"StatusViagem");
ALTER TABLE "viagens" ALTER COLUMN "status" SET DEFAULT 'ENVIADA';
DROP TYPE "StatusViagem_old";

ALTER TYPE "TipoItemAcerto" RENAME TO "TipoItemAcerto_old";
CREATE TYPE "TipoItemAcerto" AS ENUM ('FRETE', 'REEMBOLSO_PEDAGIO', 'REEMBOLSO_ABASTECIMENTO', 'ADIANTAMENTO', 'DESCONTO_AVARIA', 'DESCONTO_MULTA', 'DESCONTO_COMBUSTIVEL', 'DESCONTO_OUTROS', 'BONUS', 'AJUSTE');
ALTER TABLE "itens_acerto" ALTER COLUMN "tipo" TYPE "TipoItemAcerto" USING ("tipo"::text::"TipoItemAcerto");
DROP TYPE "TipoItemAcerto_old";

ALTER TYPE "BasePreco" RENAME TO "BasePreco_old";
CREATE TYPE "BasePreco" AS ENUM ('TONELADA', 'KM', 'VIAGEM');
ALTER TABLE "tabelas_preco" ALTER COLUMN "base" TYPE "BasePreco" USING ("base"::text::"BasePreco");
ALTER TABLE "viagem_valores" ALTER COLUMN "base" TYPE "BasePreco" USING ("base"::text::"BasePreco");
DROP TYPE "BasePreco_old";
