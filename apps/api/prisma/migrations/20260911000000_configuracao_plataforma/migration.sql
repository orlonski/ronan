-- Os interruptores da plataforma que não são de nenhuma empresa.
--
-- Existe pra estas decisões não morarem em constante de código: abrir ou fechar
-- a porta de auto-cadastro e mudar a duração do teste são decisões comerciais,
-- e virariam deploy se ficassem no código.
CREATE TABLE "configuracao_plataforma" (
    "id"                 TEXT NOT NULL DEFAULT 'singleton',
    "autoCadastroAberto" BOOLEAN NOT NULL DEFAULT false,
    "diasTesteGratis"    INTEGER NOT NULL DEFAULT 14,
    "alteradoEm"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_plataforma_pkey" PRIMARY KEY ("id")
);

-- Nasce com a porta FECHADA: subir a migration não é o mesmo que estar pronto
-- pra receber cadastro de estranho no mesmo minuto. Abrir é um clique na tela.
INSERT INTO "configuracao_plataforma" ("id", "autoCadastroAberto", "diasTesteGratis", "alteradoEm")
VALUES ('singleton', false, 14, now());
