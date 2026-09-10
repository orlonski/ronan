-- O teto de gasto do cadastro público.
--
-- Cada código enviado é uma mensagem de autenticação paga. Os freios que já
-- existiam (3 por minuto por IP, 60 segundos por telefone) seguram insistência,
-- mas não seguram VOLUME: quem tem muitos IPs e muitos números passa pelos dois.
-- Este teto é global e conta no banco, então sobrevive a restart e vale igual
-- com uma ou com dez réplicas da API.
ALTER TABLE "configuracao_plataforma" ADD COLUMN "maxCodigosPorHora" INTEGER NOT NULL DEFAULT 30;

-- Uma linha por código que saiu. O pendente não serve pra contar: ele é
-- sobrescrito a cada tentativa e apagado quando o cadastro conclui — esquece
-- justamente o que precisamos somar.
CREATE TABLE "envio_codigo_cadastro" (
    "id"       TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "ip"       TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "envio_codigo_cadastro_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "envio_codigo_cadastro_criadoEm_idx" ON "envio_codigo_cadastro"("criadoEm");
