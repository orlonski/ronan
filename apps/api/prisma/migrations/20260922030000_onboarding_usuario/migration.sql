-- O que cada pessoa do painel já viu do onboarding.
-- Uma linha por usuário, criada só quando ele interage — conta nova não
-- nasce com N linhas de gente que ainda não abriu o painel.
CREATE TABLE "onboarding_usuarios" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "usuarioId" TEXT NOT NULL,
    "toursVistos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chegadaDispensadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_usuarios_pkey" PRIMARY KEY ("usuarioId")
);

CREATE INDEX "onboarding_usuarios_contaId_idx" ON "onboarding_usuarios"("contaId");

ALTER TABLE "onboarding_usuarios" ADD CONSTRAINT "onboarding_usuarios_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cascade: usuário apagado leva junto o que ele viu. É dado sobre ele, não
-- sobre a empresa, e não serve pra nada sem ele.
ALTER TABLE "onboarding_usuarios" ADD CONSTRAINT "onboarding_usuarios_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
