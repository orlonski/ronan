-- Conferência diária: o painel manda a pergunta de TESTE a um motorista, sem depender do job.
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'CONFERENCIA_PERGUNTA_TESTE';
