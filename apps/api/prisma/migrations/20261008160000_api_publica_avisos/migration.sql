-- API pública, Onda 1B: registro de mudanças (gatilho) e avisos automáticos
-- (webhooks). Aditivo: nenhuma coluna existente muda.

-- AlterTable
ALTER TABLE "configuracao_plataforma" ADD COLUMN "registroAlteracoesDesligadoEm" TIMESTAMP(3),
ADD COLUMN "registroAlteracoesOrdemMinima" BIGINT;

-- CreateTable
CREATE TABLE "registro_alteracoes" (
    "seq" BIGSERIAL NOT NULL,
    "contaId" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "eventos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "integracaoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordem" BIGINT,
    "publicadoEm" TIMESTAMP(3),

    CONSTRAINT "registro_alteracoes_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "avisos_integracao" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "integracaoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventos" TEXT[],
    "segredoCifrado" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "desligadoEm" TIMESTAMP(3),
    "motivoDesligamento" TEXT,
    "falhasSeguidas" INTEGER NOT NULL DEFAULT 0,
    "primeiraFalhaEm" TIMESTAMP(3),
    "ultimoSucessoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avisos_integracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entregas_aviso" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "avisoId" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "entidadeId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "ultimoStatusHttp" INTEGER,
    "ultimoErro" TEXT,
    "duracaoMs" INTEGER,
    "entregueEm" TIMESTAMP(3),
    "reentregaDeId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entregas_aviso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registro_alteracoes_contaId_ordem_idx" ON "registro_alteracoes"("contaId", "ordem");
CREATE INDEX "registro_alteracoes_ordem_idx" ON "registro_alteracoes"("ordem");
CREATE INDEX "registro_alteracoes_criadoEm_idx" ON "registro_alteracoes"("criadoEm");
CREATE UNIQUE INDEX "avisos_integracao_integracaoId_key" ON "avisos_integracao"("integracaoId");
CREATE INDEX "avisos_integracao_contaId_idx" ON "avisos_integracao"("contaId");
CREATE INDEX "entregas_aviso_status_proximaTentativaEm_idx" ON "entregas_aviso"("status", "proximaTentativaEm");
CREATE INDEX "entregas_aviso_avisoId_criadoEm_idx" ON "entregas_aviso"("avisoId", "criadoEm" DESC);
CREATE INDEX "entregas_aviso_avisoId_entidadeId_tipo_status_idx" ON "entregas_aviso"("avisoId", "entidadeId", "tipo", "status");
CREATE INDEX "entregas_aviso_contaId_idx" ON "entregas_aviso"("contaId");

-- AddForeignKey
ALTER TABLE "avisos_integracao" ADD CONSTRAINT "avisos_integracao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "avisos_integracao" ADD CONSTRAINT "avisos_integracao_integracaoId_fkey" FOREIGN KEY ("integracaoId") REFERENCES "integracoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entregas_aviso" ADD CONSTRAINT "entregas_aviso_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entregas_aviso" ADD CONSTRAINT "entregas_aviso_avisoId_fkey" FOREIGN KEY ("avisoId") REFERENCES "avisos_integracao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- O gatilho. Regras (docs/api-publica/05-qa.md, I-6, I-9, I-10, M-5):
--  * só grava em empresa com integração viva (as outras não pagam nada além
--    de um EXISTS por índice);
--  * UPDATE só conta se mudou campo que SAI na API — carimbo interno (km
--    avaliado, alteradoEm…) não vira aviso;
--  * "conferida" e "finalizada" saem da TRANSIÇÃO, não de emissão à mão: pega
--    a pessoa, a IA que aprova e a dispensa por material, venha de onde vier;
--  * a integração que escreveu marca a transação com
--    set_config('movatruck.integracao', id, true) — só vale na transação, não
--    gruda na conexão do pool.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_alteracao_viagem() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_conta text;
  v_id text;
  v_op text;
  v_eventos text[] := ARRAY[]::text[];
  incompletos text[] := ARRAY['EM_ANDAMENTO','AGUARDANDO_PESO','INCOMPLETA','RASCUNHO_OFFLINE'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_conta := OLD."contaId"; v_id := OLD.id; v_op := 'EXCLUIDA';
  ELSE
    v_conta := NEW."contaId"; v_id := NEW.id;
    v_op := CASE WHEN TG_OP = 'INSERT' THEN 'CRIADA' ELSE 'ATUALIZADA' END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.integracoes i WHERE i."contaId" = v_conta AND i."revogadaEm" IS NULL) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD.status, OLD.data, OLD.toneladas, OLD.km, OLD."kmMotorista", OLD."kmOrigem", OLD."motoristaId",
        OLD."veiculoId", OLD."clienteId", OLD."materialId", OLD."localCargaId", OLD."localDescargaId",
        OLD.ticket, OLD."revisadoEm", OLD."valorPedagioTotal", OLD."pedagioPelaTag")
       IS NOT DISTINCT FROM
       (NEW.status, NEW.data, NEW.toneladas, NEW.km, NEW."kmMotorista", NEW."kmOrigem", NEW."motoristaId",
        NEW."veiculoId", NEW."clienteId", NEW."materialId", NEW."localCargaId", NEW."localDescargaId",
        NEW.ticket, NEW."revisadoEm", NEW."valorPedagioTotal", NEW."pedagioPelaTag") THEN
      RETURN NULL;
    END IF;
    IF OLD.status::text = ANY(incompletos) AND NOT (NEW.status::text = ANY(incompletos)) THEN
      v_eventos := array_append(v_eventos, 'viagem.finalizada');
    END IF;
    IF OLD."revisadoEm" IS NULL AND NEW."revisadoEm" IS NOT NULL THEN
      v_eventos := array_append(v_eventos, 'viagem.conferida');
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW."revisadoEm" IS NOT NULL THEN
    -- Nasceu aprovada (material que dispensa conferência).
    v_eventos := array_append(v_eventos, 'viagem.conferida');
  END IF;

  INSERT INTO public.registro_alteracoes ("contaId", entidade, "entidadeId", operacao, eventos, "integracaoId")
  VALUES (v_conta, 'viagem', v_id, v_op, v_eventos, nullif(current_setting('movatruck.integracao', true), ''));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_alteracao_valor_viagem() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_conta text;
  v_viagem text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_conta := OLD."contaId"; v_viagem := OLD."viagemId";
    -- Viagem apagada leva o valor junto (cascata): o aviso é o "excluída" dela,
    -- não um "atualizada" que chegaria depois e daria 404 em quem fosse buscar.
    IF NOT EXISTS (SELECT 1 FROM public.viagens v WHERE v.id = v_viagem) THEN
      RETURN NULL;
    END IF;
  ELSE
    v_conta := NEW."contaId"; v_viagem := NEW."viagemId";
    IF TG_OP = 'UPDATE' AND (OLD."valorFrete", OLD."valorPedagio", OLD."valorTotal")
       IS NOT DISTINCT FROM (NEW."valorFrete", NEW."valorPedagio", NEW."valorTotal") THEN
      RETURN NULL;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.integracoes i WHERE i."contaId" = v_conta AND i."revogadaEm" IS NULL) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.registro_alteracoes ("contaId", entidade, "entidadeId", operacao, eventos, "integracaoId")
  VALUES (v_conta, 'viagem', v_viagem, 'ATUALIZADA', ARRAY[]::text[], nullif(current_setting('movatruck.integracao', true), ''));
  RETURN NULL;
END;
$$;

CREATE TRIGGER registrar_alteracao_viagem
AFTER INSERT OR UPDATE OR DELETE ON "viagens"
FOR EACH ROW EXECUTE FUNCTION public.registrar_alteracao_viagem();

CREATE TRIGGER registrar_alteracao_valor_viagem
AFTER INSERT OR UPDATE OR DELETE ON "viagem_valores"
FOR EACH ROW EXECUTE FUNCTION public.registrar_alteracao_valor_viagem();
