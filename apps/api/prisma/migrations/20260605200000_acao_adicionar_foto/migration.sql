-- Auditoria de "admin anexou foto a viagem existente". Usado pelo endpoint
-- POST /admin/viagens/:id/fotos.
ALTER TYPE "AcaoAuditoria" ADD VALUE 'ADICIONAR_FOTO';
