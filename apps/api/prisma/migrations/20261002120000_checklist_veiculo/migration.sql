-- Checklist do caminhão: o modelo que a empresa monta e o que o motorista
-- responde no app (pela fila offline). Lembrado, nunca obrigatório.

CREATE TABLE "modelos_checklist" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "modelos_checklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "itens_modelo_checklist" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "texto" TEXT NOT NULL,
    "fotoSeReprovar" BOOLEAN NOT NULL DEFAULT true,
    "abreAviso" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "itens_modelo_checklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "checklists_veiculo" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "veiculoId" TEXT,
    "modeloId" TEXT,
    "feitoEm" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "reprovados" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "checklists_veiculo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "respostas_checklist" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "itemId" TEXT,
    "texto" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "observacao" TEXT,
    "fotoKey" TEXT,
    "problemaId" TEXT,
    CONSTRAINT "respostas_checklist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "modelos_checklist_contaId_ativo_idx" ON "modelos_checklist"("contaId", "ativo");
CREATE INDEX "itens_modelo_checklist_modeloId_ordem_idx" ON "itens_modelo_checklist"("modeloId", "ordem");
CREATE UNIQUE INDEX "checklists_veiculo_clientId_key" ON "checklists_veiculo"("clientId");
CREATE INDEX "checklists_veiculo_contaId_feitoEm_idx" ON "checklists_veiculo"("contaId", "feitoEm");
CREATE INDEX "checklists_veiculo_veiculoId_feitoEm_idx" ON "checklists_veiculo"("veiculoId", "feitoEm");
CREATE INDEX "checklists_veiculo_motoristaId_feitoEm_idx" ON "checklists_veiculo"("motoristaId", "feitoEm");
CREATE INDEX "respostas_checklist_checklistId_idx" ON "respostas_checklist"("checklistId");
CREATE INDEX "respostas_checklist_contaId_idx" ON "respostas_checklist"("contaId");

ALTER TABLE "modelos_checklist" ADD CONSTRAINT "modelos_checklist_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "itens_modelo_checklist" ADD CONSTRAINT "itens_modelo_checklist_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "itens_modelo_checklist" ADD CONSTRAINT "itens_modelo_checklist_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "modelos_checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checklists_veiculo" ADD CONSTRAINT "checklists_veiculo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checklists_veiculo" ADD CONSTRAINT "checklists_veiculo_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checklists_veiculo" ADD CONSTRAINT "checklists_veiculo_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checklists_veiculo" ADD CONSTRAINT "checklists_veiculo_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "modelos_checklist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "respostas_checklist" ADD CONSTRAINT "respostas_checklist_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "respostas_checklist" ADD CONSTRAINT "respostas_checklist_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "checklists_veiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "respostas_checklist" ADD CONSTRAINT "respostas_checklist_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "itens_modelo_checklist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Capacidade nova no app. Nasce ligada como as outras capacidades novas; só
-- aparece pra quem tem o módulo Manutenção (o resolvedor corta o resto).
UPDATE "perfis_acesso_app"
SET "capacidades" = array_append("capacidades", 'app.checklist.fazer'),
    "alteradoEm" = CURRENT_TIMESTAMP
WHERE NOT ('app.checklist.fazer' = ANY("capacidades"));
