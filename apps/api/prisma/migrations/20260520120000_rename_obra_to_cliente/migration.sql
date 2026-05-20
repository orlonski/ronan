-- Rename "Obra" -> "Cliente" e "EmpresaCliente" -> "Empresa" em todo o schema.
-- Conteudo: ALTER TABLE/COLUMN/INDEX/CONSTRAINT renames. Sem perda de dados.
-- Reversivel via migration espelhada (ver plano).

-- ============================================================================
-- 1) Renomear tabelas
-- ============================================================================
ALTER TABLE "obras" RENAME TO "clientes";
ALTER TABLE "empresas_cliente" RENAME TO "empresas";

-- ============================================================================
-- 2) Renomear colunas FK
-- ============================================================================
ALTER TABLE "locais" RENAME COLUMN "obraId" TO "clienteId";
ALTER TABLE "viagens" RENAME COLUMN "obraId" TO "clienteId";
ALTER TABLE "clientes" RENAME COLUMN "empresaClienteId" TO "empresaId";
ALTER TABLE "layout_import_blocos" RENAME COLUMN "empresaClienteId" TO "empresaId";
ALTER TABLE "fechamentos" RENAME COLUMN "empresaClienteId" TO "empresaId";
ALTER TABLE "envios_fechamento" RENAME COLUMN "empresaClienteId" TO "empresaId";
ALTER TABLE "fechamento_linhas" RENAME COLUMN "obraTexto" TO "clienteTexto";

-- ============================================================================
-- 3) Renomear PRIMARY KEYS
-- ============================================================================
ALTER INDEX "obras_pkey" RENAME TO "clientes_pkey";
ALTER INDEX "empresas_cliente_pkey" RENAME TO "empresas_pkey";

-- ============================================================================
-- 4) Renomear UNIQUE / KEY indexes
-- ============================================================================
ALTER INDEX "empresas_cliente_cnpj_key" RENAME TO "empresas_cnpj_key";
ALTER INDEX "layout_import_blocos_empresaClienteId_tipo_key" RENAME TO "layout_import_blocos_empresaId_tipo_key";

-- ============================================================================
-- 5) Renomear indexes regulares
-- ============================================================================
ALTER INDEX "obras_empresaClienteId_idx" RENAME TO "clientes_empresaId_idx";
ALTER INDEX "obras_ativa_idx" RENAME TO "clientes_ativa_idx";
ALTER INDEX "obras_nome_trgm_idx" RENAME TO "clientes_nome_trgm_idx";
ALTER INDEX "obras_apelidos_trgm_idx" RENAME TO "clientes_apelidos_trgm_idx";
ALTER INDEX "locais_obraId_idx" RENAME TO "locais_clienteId_idx";
ALTER INDEX "viagens_obraId_data_idx" RENAME TO "viagens_clienteId_data_idx";
ALTER INDEX "fechamentos_empresaClienteId_periodoInicio_idx" RENAME TO "fechamentos_empresaId_periodoInicio_idx";
ALTER INDEX "envios_fechamento_empresaClienteId_periodoInicio_idx" RENAME TO "envios_fechamento_empresaId_periodoInicio_idx";
ALTER INDEX "layout_import_blocos_empresaClienteId_idx" RENAME TO "layout_import_blocos_empresaId_idx";

-- ============================================================================
-- 6) Renomear FOREIGN KEY constraints
-- ============================================================================
ALTER TABLE "clientes" RENAME CONSTRAINT "obras_empresaClienteId_fkey" TO "clientes_empresaId_fkey";
ALTER TABLE "locais" RENAME CONSTRAINT "locais_obraId_fkey" TO "locais_clienteId_fkey";
ALTER TABLE "viagens" RENAME CONSTRAINT "viagens_obraId_fkey" TO "viagens_clienteId_fkey";
ALTER TABLE "fechamentos" RENAME CONSTRAINT "fechamentos_empresaClienteId_fkey" TO "fechamentos_empresaId_fkey";
ALTER TABLE "layout_import_blocos" RENAME CONSTRAINT "layout_import_blocos_empresaClienteId_fkey" TO "layout_import_blocos_empresaId_fkey";
ALTER TABLE "envios_fechamento" RENAME CONSTRAINT "envios_fechamento_empresaClienteId_fkey" TO "envios_fechamento_empresaId_fkey";

-- ============================================================================
-- 7) Migrar slug "obra" -> "cliente" no CampoLayout sistema
--    + dentro do JSON layoutImport (colunas[].campo)
-- ============================================================================
UPDATE "campos_layout"
   SET slug = 'cliente',
       label = 'Cliente',
       descricao = 'Nome do cliente (referência, não comparado)'
 WHERE slug = 'obra';

-- Substitui qualquer ocorrência de "campo":"obra" pra "campo":"cliente" no JSON
-- do layoutImport (Postgres não tem path update fácil em arrays JSONB, então
-- faz string replace no texto serializado — é seguro porque slugs são únicos).
UPDATE "empresas"
   SET "layoutImport" = REPLACE("layoutImport"::text, '"campo":"obra"', '"campo":"cliente"')::jsonb
 WHERE "layoutImport"::text LIKE '%"campo":"obra"%';

UPDATE "empresas"
   SET "layoutImport" = REPLACE("layoutImport"::text, '"campo": "obra"', '"campo": "cliente"')::jsonb
 WHERE "layoutImport"::text LIKE '%"campo": "obra"%';

-- Mesmo replace no JSON `colunas` dos blocos de layout de import
UPDATE "layout_import_blocos"
   SET colunas = REPLACE(colunas::text, '"campo":"obra"', '"campo":"cliente"')::jsonb
 WHERE colunas::text LIKE '%"campo":"obra"%';

UPDATE "layout_import_blocos"
   SET colunas = REPLACE(colunas::text, '"campo": "obra"', '"campo": "cliente"')::jsonb
 WHERE colunas::text LIKE '%"campo": "obra"%';

-- E no JSON `colunas` dos layouts de envio
UPDATE "layouts_envio"
   SET colunas = REPLACE(colunas::text, '"campo":"obra"', '"campo":"cliente"')::jsonb
 WHERE colunas::text LIKE '%"campo":"obra"%';

UPDATE "layouts_envio"
   SET colunas = REPLACE(colunas::text, '"campo": "obra"', '"campo": "cliente"')::jsonb
 WHERE colunas::text LIKE '%"campo": "obra"%';
