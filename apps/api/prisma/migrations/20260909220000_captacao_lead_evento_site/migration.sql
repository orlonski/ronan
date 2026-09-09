-- Captação de lead pelo site institucional.
--
-- Duas tabelas separadas de propósito:
--
--   "leads"        — pessoa que pediu contato. É DADO PESSOAL, tratado sob
--                    legítimo interesse (LGPD art. 7º IX). Por isso carrega
--                    origemDado/coletadoEm (de onde veio o contato, exigência
--                    de transparência) e optOut (a supressão, que vale para
--                    todos os canais ao mesmo tempo).
--
--   "eventos_site" — contagem de navegação. ANÔNIMA: sem IP, sem cookie, sem
--                    user-agent. Não é dado pessoal e não deve virar um.
--
-- Nenhuma das duas tem "contaId": lead não pertence a empresa nenhuma — quando
-- vira cliente, vira uma Conta. Ambas estão em MODELS_GLOBAIS, e todo acesso
-- roda em comoSistema().

CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "email" TEXT,
    "cidade" TEXT,
    "frota" TEXT,
    "mensagem" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'SITE_FORMULARIO',
    "origemDado" TEXT,
    "coletadoEm" TIMESTAMP(3),
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "paginaOrigem" TEXT,
    "ipCriacao" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOVO',
    "optOut" BOOLEAN NOT NULL DEFAULT false,
    "optOutEm" TIMESTAMP(3),
    "observacao" TEXT,
    "ultimoContato" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leads_status_criadoEm_idx" ON "leads"("status", "criadoEm" DESC);
CREATE INDEX "leads_optOut_idx" ON "leads"("optOut");
CREATE INDEX "leads_telefone_idx" ON "leads"("telefone");
CREATE INDEX "leads_email_idx" ON "leads"("email");

CREATE TABLE "eventos_site" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "caminho" TEXT NOT NULL DEFAULT '/',
    "rotulo" TEXT,
    "referenciaHost" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "sessao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_site_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "eventos_site_criadoEm_idx" ON "eventos_site"("criadoEm" DESC);
CREATE INDEX "eventos_site_tipo_criadoEm_idx" ON "eventos_site"("tipo", "criadoEm" DESC);
CREATE INDEX "eventos_site_sessao_idx" ON "eventos_site"("sessao");
