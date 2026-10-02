-- A empresa escolhe aparecer na busca por nome do app do motorista.
ALTER TABLE "contas" ADD COLUMN "aceitaPedidoMotorista" BOOLEAN NOT NULL DEFAULT false;
