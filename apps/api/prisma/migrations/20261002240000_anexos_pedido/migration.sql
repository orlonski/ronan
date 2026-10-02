-- Anexos do pedido: croqui de acesso, OS do cliente, autorização de entrada,
-- mapa do bota-fora. O arquivo fica no MinIO (bucket privado); aqui só o
-- registro, com o interruptor de "o motorista vê".
CREATE TABLE "anexos_pedido" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "visivelMotorista" BOOLEAN NOT NULL DEFAULT true,
    "enviadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anexos_pedido_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "anexos_pedido_pedidoId_idx" ON "anexos_pedido"("pedidoId");
CREATE INDEX "anexos_pedido_contaId_idx" ON "anexos_pedido"("contaId");

ALTER TABLE "anexos_pedido" ADD CONSTRAINT "anexos_pedido_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "anexos_pedido" ADD CONSTRAINT "anexos_pedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "anexos_pedido" ADD CONSTRAINT "anexos_pedido_enviadoPorId_fkey" FOREIGN KEY ("enviadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Capacidade nova no app. Nasce ligada como as outras capacidades novas; só
-- aparece pra quem tem o módulo da programação (o resolvedor corta o resto).
UPDATE "perfis_acesso_app"
SET "capacidades" = array_append("capacidades", 'app.pedido.anexos'),
    "alteradoEm" = CURRENT_TIMESTAMP
WHERE NOT ('app.pedido.anexos' = ANY("capacidades"));
