-- Roteamento de plataforma: linha única, sem contaId.
--
-- As rotas de código de acesso são sobre a pessoa, não sobre a empresa. O mesmo
-- CPF tem cadastro em várias transportadoras com UMA senha, então a escolha do
-- provedor precisa ser única — senão a mesma pessoa recebe ou não recebe o
-- código conforme qual cadastro venceu o desempate.
CREATE TABLE "configuracao_roteamento_plataforma" (
  "id"            TEXT NOT NULL DEFAULT 'singleton',
  "rotas"         JSONB NOT NULL DEFAULT '{}',
  "alteradoEm"    TIMESTAMP(3) NOT NULL,
  "alteradoPorId" TEXT,
  CONSTRAINT "configuracao_roteamento_plataforma_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "configuracao_roteamento_plataforma"
  ADD CONSTRAINT "configuracao_roteamento_plataforma_alteradoPorId_fkey"
  FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Nasce com as duas rotas de código na Meta. O Evolution deixou de ser o
-- caminho seguro no dia em que o número caiu; deixar em branco faria elas
-- caírem no padrão do código, que também passou a ser meta.
INSERT INTO "configuracao_roteamento_plataforma" ("id", "rotas", "alteradoEm")
VALUES ('singleton', '{"OTP_CADASTRO":"meta","OTP_SENHA":"meta"}', NOW());
