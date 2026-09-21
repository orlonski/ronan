-- A alocação passa a saber O QUE a pessoa é na obra.
--
-- Antes, `criarAlocacao` abria um regime de PARCEIRO incondicionalmente. Quem
-- já era registrado em carteira (módulo ponto) batia num 409 sem caminho de
-- saída: "encerre o anterior antes de continuar" — mas o anterior é o contrato
-- de trabalho dele, que não se encerra pra entrar numa obra.
--
-- Agora o regime DERIVA do vínculo vivo: PARCEIRO abre o regime como sempre;
-- EMPREGADO só reflete a contratação que o ponto já fez.
--
-- O backfill é PARCEIRO porque é o que toda alocação existente sempre foi — o
-- mensal nasceu para parceiro autônomo em 19/09/2026.
ALTER TABLE "alocacoes_obra"
  ADD COLUMN "regime" "RegimeTrabalho" NOT NULL DEFAULT 'PARCEIRO';

-- Dinheiro por dia para empregado é salário por fora. O banco garante.
ALTER TABLE "alocacoes_obra"
  ADD CONSTRAINT "empregado_nao_tem_diaria"
  CHECK ("regime" <> 'EMPREGADO' OR "valorDiaria" IS NULL);
