-- Nova ação de auditoria: mesclar (unificar) locais duplicados. Aditivo.
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'MESCLAR_LOCAL';
