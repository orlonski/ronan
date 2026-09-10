-- Quem começou a abrir uma empresa pelo site e ainda não confirmou o código.
--
-- Existe ANTES da conta, e é o que impede que um formulário meio preenchido já
-- vire linha em `contas`: a empresa só nasce quando o código chega de volta.
-- Mesmo desenho do pendente do motorista, que já roda em produção.
CREATE TABLE "conta_cadastro_pendente" (
    "id"            TEXT NOT NULL,
    "telefone"      TEXT NOT NULL,
    "empresa"       TEXT NOT NULL,
    "cnpj"          TEXT,
    "adminNome"     TEXT NOT NULL,
    "adminEmail"    TEXT NOT NULL,
    "senhaHash"     TEXT NOT NULL,
    "codigo"        TEXT NOT NULL,
    "expiraEm"      TIMESTAMP(3) NOT NULL,
    "tentativas"    INTEGER NOT NULL DEFAULT 0,
    "reenvios"      INTEGER NOT NULL DEFAULT 0,
    "ultimoEnvioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipCriacao"     TEXT,
    "criadoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conta_cadastro_pendente_pkey" PRIMARY KEY ("id")
);

-- Um celular abre uma empresa por vez: tentar de novo sobrescreve o pendente em
-- vez de acumular linha — e, mais importante, em vez de gerar uma mensagem paga
-- por tentativa.
CREATE UNIQUE INDEX "conta_cadastro_pendente_telefone_key" ON "conta_cadastro_pendente"("telefone");
