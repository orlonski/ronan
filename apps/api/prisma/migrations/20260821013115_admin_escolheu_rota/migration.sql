-- Painel trocou a estrada (traçado) de uma viagem já lançada.
-- Ação própria, separada de ADMIN_ALTEROU_KM: corrigir a linha do mapa é uma
-- decisão; mexer no km que o motorista recebe é outra.
ALTER TYPE "AcaoAuditoria" ADD VALUE 'ADMIN_ESCOLHEU_ROTA';
