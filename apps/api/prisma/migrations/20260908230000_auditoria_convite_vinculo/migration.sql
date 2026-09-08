-- Convite de motorista por CPF: quem convidou, quem aceitou, quem recusou.
-- Ações próprias em vez de UPDATE genérico — o endpoint de busca responde
-- "essa pessoa existe e se chama fulano", e isso precisa de rastro.
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'ADMIN_CONVIDOU_MOTORISTA';
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'MOTORISTA_ACEITOU_VINCULO';
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'MOTORISTA_RECUSOU_VINCULO';
