-- Novo status de viagem: EM_ANDAMENTO (lifecycle guiado — viagem criada no
-- início e fechada depois). Isolado numa migration própria porque o Postgres
-- não deixa USAR um valor de enum recém-adicionado na MESMA transação em que
-- ele foi criado (o índice parcial da migration seguinte referencia
-- 'EM_ANDAMENTO' no WHERE). Cada migration roda em sua própria transação.
ALTER TYPE "StatusViagem" ADD VALUE 'EM_ANDAMENTO';
