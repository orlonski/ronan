-- Multi-empresa (multi-tenant): cada empresa que assina o sistema vira uma
-- linha em "contas", e todo dado de negócio passa a apontar pra uma delas.
--
-- O isolamento em si NÃO é enforçado aqui: quem filtra é a trava automática em
-- common/conta/trava-conta.ts, que injeta o contaId em toda query do Prisma.
-- Esta migration só cria o dado e adota o passado.
--
-- BACKFILL: a Schaba é a conta 1. A coluna nasce com DEFAULT apontando pra ela
-- (adotando tudo que já existe) e o DEFAULT é DERRUBADO logo em seguida — se
-- ficasse, um registro novo sem contaId nasceria dentro da Schaba em silêncio,
-- que é exatamente o vazamento que este trabalho existe pra impedir.

-- CreateTable
CREATE TABLE "contas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cnpj" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "permiteAutoCadastro" BOOLEAN NOT NULL DEFAULT false,
    "logoUrl" TEXT,
    "corPrimaria" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_pkey" PRIMARY KEY ("id")
);

-- A Schaba herda o auto-cadastro: o app publicado nas lojas não diz de qual
-- empresa o motorista é, e até a landing existir todo signup cai aqui.
INSERT INTO "contas" ("id", "nome", "slug", "ativa", "permiteAutoCadastro", "criadaEm", "alteradaEm")
VALUES ('cnt_schaba', 'Schaba', 'schaba', true, true, NOW(), NOW());
-- DropIndex
DROP INDEX "papeis_nome_key";

-- DropIndex
DROP INDEX "motoristas_cpf_key";

-- DropIndex
DROP INDEX "cadastros_motorista_pendentes_cpf_key";

-- DropIndex
DROP INDEX "veiculos_placa_key";

-- DropIndex
DROP INDEX "transportadoras_cnpj_key";

-- DropIndex
DROP INDEX "empresas_cnpj_key";

-- DropIndex
DROP INDEX "materiais_nome_key";

-- DropIndex
DROP INDEX "tipos_evento_viagem_slug_key";

-- DropIndex
DROP INDEX "campos_layout_slug_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba',
ADD COLUMN     "plataforma" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "papeis" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "admin_notificacoes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "cadastros_motorista_pendentes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "redefinicoes_senha_pendentes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "motorista_posicao_config" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "motorista_posicoes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "motorista_documento" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "motorista_veiculo" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "whatsapp_sessoes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "whatsapp_convites" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "whatsapp_mensagens" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "veiculos" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "transportadoras" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "usuario_transportadoras" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "layout_import_blocos" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "materiais" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "regras_minimo" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "locais" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "local_cliente" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "local_evidencia" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "viagens" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "trechos_viagem" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "tipos_evento_viagem" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "eventos_viagem" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "viagem_mensagens" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "ticket_fotos" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "viagem_compartilhamentos" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "story_visualizacoes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "story_reacoes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "viagem_pontos" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "pedagios" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "fechamentos" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "fechamento_linhas" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "layouts_envio" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "envios_fechamento" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "configuracao_tracking" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "configuracao_ia" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "configuracao_agente" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "configuracao_aviso_grupo" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "configuracao_busca_locais" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "configuracao_km_atipico" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "configuracao_forca_atualizacao" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "campos_layout" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "error_logs" ADD COLUMN     "contaId" TEXT;

-- AlterTable
ALTER TABLE "eventos_motorista" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "abastecimentos" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "abastecimento_fotos" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "notificacoes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "conversas" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "conversa_participantes" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "mensagens_chat" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "bloqueios_chat" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';

-- AlterTable
ALTER TABLE "denuncias_mensagem_chat" ADD COLUMN     "contaId" TEXT NOT NULL DEFAULT 'cnt_schaba';


-- CreateIndex
CREATE UNIQUE INDEX "contas_slug_key" ON "contas"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "contas_cnpj_key" ON "contas"("cnpj");

-- CreateIndex
CREATE INDEX "contas_ativa_idx" ON "contas"("ativa");

-- CreateIndex
CREATE INDEX "users_contaId_idx" ON "users"("contaId");

-- CreateIndex
CREATE INDEX "papeis_contaId_idx" ON "papeis"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "papeis_contaId_nome_key" ON "papeis"("contaId", "nome");

-- CreateIndex
CREATE INDEX "admin_notificacoes_contaId_idx" ON "admin_notificacoes"("contaId");

-- CreateIndex
CREATE INDEX "motoristas_contaId_idx" ON "motoristas"("contaId");

-- CreateIndex
CREATE INDEX "motoristas_contaId_ativo_idx" ON "motoristas"("contaId", "ativo");

-- CreateIndex
CREATE INDEX "motoristas_contaId_status_idx" ON "motoristas"("contaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "motoristas_contaId_cpf_key" ON "motoristas"("contaId", "cpf");

-- CreateIndex
CREATE INDEX "cadastros_motorista_pendentes_contaId_idx" ON "cadastros_motorista_pendentes"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "cadastros_motorista_pendentes_contaId_cpf_key" ON "cadastros_motorista_pendentes"("contaId", "cpf");

-- CreateIndex
CREATE INDEX "redefinicoes_senha_pendentes_contaId_idx" ON "redefinicoes_senha_pendentes"("contaId");

-- CreateIndex
CREATE INDEX "motorista_posicao_config_contaId_idx" ON "motorista_posicao_config"("contaId");

-- CreateIndex
CREATE INDEX "motorista_posicoes_contaId_idx" ON "motorista_posicoes"("contaId");

-- CreateIndex
CREATE INDEX "motorista_documento_contaId_idx" ON "motorista_documento"("contaId");

-- CreateIndex
CREATE INDEX "motorista_veiculo_contaId_idx" ON "motorista_veiculo"("contaId");

-- CreateIndex
CREATE INDEX "whatsapp_sessoes_contaId_idx" ON "whatsapp_sessoes"("contaId");

-- CreateIndex
CREATE INDEX "whatsapp_convites_contaId_idx" ON "whatsapp_convites"("contaId");

-- CreateIndex
CREATE INDEX "whatsapp_mensagens_contaId_idx" ON "whatsapp_mensagens"("contaId");

-- CreateIndex
CREATE INDEX "veiculos_contaId_idx" ON "veiculos"("contaId");

-- CreateIndex
CREATE INDEX "veiculos_contaId_ativo_idx" ON "veiculos"("contaId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "veiculos_contaId_placa_key" ON "veiculos"("contaId", "placa");

-- CreateIndex
CREATE INDEX "transportadoras_contaId_idx" ON "transportadoras"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "transportadoras_contaId_cnpj_key" ON "transportadoras"("contaId", "cnpj");

-- CreateIndex
CREATE INDEX "usuario_transportadoras_contaId_idx" ON "usuario_transportadoras"("contaId");

-- CreateIndex
CREATE INDEX "empresas_contaId_idx" ON "empresas"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_contaId_cnpj_key" ON "empresas"("contaId", "cnpj");

-- CreateIndex
CREATE INDEX "layout_import_blocos_contaId_idx" ON "layout_import_blocos"("contaId");

-- CreateIndex
CREATE INDEX "clientes_contaId_idx" ON "clientes"("contaId");

-- CreateIndex
CREATE INDEX "materiais_contaId_idx" ON "materiais"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "materiais_contaId_nome_key" ON "materiais"("contaId", "nome");

-- CreateIndex
CREATE INDEX "regras_minimo_contaId_idx" ON "regras_minimo"("contaId");

-- CreateIndex
CREATE INDEX "locais_contaId_idx" ON "locais"("contaId");

-- CreateIndex
CREATE INDEX "locais_contaId_ativo_idx" ON "locais"("contaId", "ativo");

-- CreateIndex
CREATE INDEX "local_cliente_contaId_idx" ON "local_cliente"("contaId");

-- CreateIndex
CREATE INDEX "local_evidencia_contaId_idx" ON "local_evidencia"("contaId");

-- CreateIndex
CREATE INDEX "viagens_contaId_idx" ON "viagens"("contaId");

-- CreateIndex
CREATE INDEX "viagens_contaId_data_idx" ON "viagens"("contaId", "data");

-- CreateIndex
CREATE INDEX "viagens_contaId_status_idx" ON "viagens"("contaId", "status");

-- CreateIndex
CREATE INDEX "trechos_viagem_contaId_idx" ON "trechos_viagem"("contaId");

-- CreateIndex
CREATE INDEX "tipos_evento_viagem_contaId_idx" ON "tipos_evento_viagem"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_evento_viagem_contaId_slug_key" ON "tipos_evento_viagem"("contaId", "slug");

-- CreateIndex
CREATE INDEX "eventos_viagem_contaId_idx" ON "eventos_viagem"("contaId");

-- CreateIndex
CREATE INDEX "viagem_mensagens_contaId_idx" ON "viagem_mensagens"("contaId");

-- CreateIndex
CREATE INDEX "ticket_fotos_contaId_idx" ON "ticket_fotos"("contaId");

-- CreateIndex
CREATE INDEX "viagem_compartilhamentos_contaId_idx" ON "viagem_compartilhamentos"("contaId");

-- CreateIndex
CREATE INDEX "stories_contaId_idx" ON "stories"("contaId");

-- CreateIndex
CREATE INDEX "story_visualizacoes_contaId_idx" ON "story_visualizacoes"("contaId");

-- CreateIndex
CREATE INDEX "story_reacoes_contaId_idx" ON "story_reacoes"("contaId");

-- CreateIndex
CREATE INDEX "viagem_pontos_contaId_idx" ON "viagem_pontos"("contaId");

-- CreateIndex
CREATE INDEX "pedagios_contaId_idx" ON "pedagios"("contaId");

-- CreateIndex
CREATE INDEX "pedagios_contaId_data_idx" ON "pedagios"("contaId", "data");

-- CreateIndex
CREATE INDEX "fechamentos_contaId_idx" ON "fechamentos"("contaId");

-- CreateIndex
CREATE INDEX "fechamento_linhas_contaId_idx" ON "fechamento_linhas"("contaId");

-- CreateIndex
CREATE INDEX "layouts_envio_contaId_idx" ON "layouts_envio"("contaId");

-- CreateIndex
CREATE INDEX "envios_fechamento_contaId_idx" ON "envios_fechamento"("contaId");

-- CreateIndex
CREATE INDEX "audit_logs_contaId_idx" ON "audit_logs"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_tracking_contaId_key" ON "configuracao_tracking"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_ia_contaId_key" ON "configuracao_ia"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_agente_contaId_key" ON "configuracao_agente"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_aviso_grupo_contaId_key" ON "configuracao_aviso_grupo"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_busca_locais_contaId_key" ON "configuracao_busca_locais"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_km_atipico_contaId_key" ON "configuracao_km_atipico"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_forca_atualizacao_contaId_key" ON "configuracao_forca_atualizacao"("contaId");

-- CreateIndex
CREATE INDEX "campos_layout_contaId_idx" ON "campos_layout"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "campos_layout_contaId_slug_key" ON "campos_layout"("contaId", "slug");

-- CreateIndex
CREATE INDEX "error_logs_contaId_idx" ON "error_logs"("contaId");

-- CreateIndex
CREATE INDEX "eventos_motorista_contaId_idx" ON "eventos_motorista"("contaId");

-- CreateIndex
CREATE INDEX "abastecimentos_contaId_idx" ON "abastecimentos"("contaId");

-- CreateIndex
CREATE INDEX "abastecimentos_contaId_data_idx" ON "abastecimentos"("contaId", "data");

-- CreateIndex
CREATE INDEX "abastecimento_fotos_contaId_idx" ON "abastecimento_fotos"("contaId");

-- CreateIndex
CREATE INDEX "notificacoes_contaId_idx" ON "notificacoes"("contaId");

-- CreateIndex
CREATE INDEX "conversas_contaId_idx" ON "conversas"("contaId");

-- CreateIndex
CREATE INDEX "conversa_participantes_contaId_idx" ON "conversa_participantes"("contaId");

-- CreateIndex
CREATE INDEX "mensagens_chat_contaId_idx" ON "mensagens_chat"("contaId");

-- CreateIndex
CREATE INDEX "bloqueios_chat_contaId_idx" ON "bloqueios_chat"("contaId");

-- CreateIndex
CREATE INDEX "denuncias_mensagem_chat_contaId_idx" ON "denuncias_mensagem_chat"("contaId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papeis" ADD CONSTRAINT "papeis_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notificacoes" ADD CONSTRAINT "admin_notificacoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadastros_motorista_pendentes" ADD CONSTRAINT "cadastros_motorista_pendentes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redefinicoes_senha_pendentes" ADD CONSTRAINT "redefinicoes_senha_pendentes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motorista_posicao_config" ADD CONSTRAINT "motorista_posicao_config_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motorista_posicoes" ADD CONSTRAINT "motorista_posicoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motorista_documento" ADD CONSTRAINT "motorista_documento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motorista_veiculo" ADD CONSTRAINT "motorista_veiculo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sessoes" ADD CONSTRAINT "whatsapp_sessoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_convites" ADD CONSTRAINT "whatsapp_convites_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transportadoras" ADD CONSTRAINT "transportadoras_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_transportadoras" ADD CONSTRAINT "usuario_transportadoras_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layout_import_blocos" ADD CONSTRAINT "layout_import_blocos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_minimo" ADD CONSTRAINT "regras_minimo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locais" ADD CONSTRAINT "locais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_cliente" ADD CONSTRAINT "local_cliente_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_evidencia" ADD CONSTRAINT "local_evidencia_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trechos_viagem" ADD CONSTRAINT "trechos_viagem_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipos_evento_viagem" ADD CONSTRAINT "tipos_evento_viagem_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_viagem" ADD CONSTRAINT "eventos_viagem_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagem_mensagens" ADD CONSTRAINT "viagem_mensagens_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_fotos" ADD CONSTRAINT "ticket_fotos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagem_compartilhamentos" ADD CONSTRAINT "viagem_compartilhamentos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_visualizacoes" ADD CONSTRAINT "story_visualizacoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_reacoes" ADD CONSTRAINT "story_reacoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagem_pontos" ADD CONSTRAINT "viagem_pontos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedagios" ADD CONSTRAINT "pedagios_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamentos" ADD CONSTRAINT "fechamentos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamento_linhas" ADD CONSTRAINT "fechamento_linhas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layouts_envio" ADD CONSTRAINT "layouts_envio_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_fechamento" ADD CONSTRAINT "envios_fechamento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_tracking" ADD CONSTRAINT "configuracao_tracking_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_ia" ADD CONSTRAINT "configuracao_ia_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_agente" ADD CONSTRAINT "configuracao_agente_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_aviso_grupo" ADD CONSTRAINT "configuracao_aviso_grupo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_busca_locais" ADD CONSTRAINT "configuracao_busca_locais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_km_atipico" ADD CONSTRAINT "configuracao_km_atipico_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_forca_atualizacao" ADD CONSTRAINT "configuracao_forca_atualizacao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campos_layout" ADD CONSTRAINT "campos_layout_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_motorista" ADD CONSTRAINT "eventos_motorista_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimento_fotos" ADD CONSTRAINT "abastecimento_fotos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversa_participantes" ADD CONSTRAINT "conversa_participantes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_chat" ADD CONSTRAINT "mensagens_chat_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueios_chat" ADD CONSTRAINT "bloqueios_chat_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncias_mensagem_chat" ADD CONSTRAINT "denuncias_mensagem_chat_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill do que é opcional
UPDATE "error_logs" SET "contaId" = 'cnt_schaba' WHERE "contaId" IS NULL;

-- Fim do backfill. A partir daqui o default deixa de ser a Schaba e passa a ser
-- um id que NÃO existe em "contas": insert que escape da trava morre na chave
-- estrangeira, em vez de entrar mudo na conta errada.
ALTER TABLE "users" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "papeis" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "admin_notificacoes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "motoristas" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "cadastros_motorista_pendentes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "redefinicoes_senha_pendentes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "motorista_posicao_config" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "motorista_posicoes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "motorista_documento" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "motorista_veiculo" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "whatsapp_sessoes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "whatsapp_convites" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "whatsapp_mensagens" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "veiculos" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "transportadoras" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "usuario_transportadoras" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "empresas" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "layout_import_blocos" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "clientes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "materiais" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "regras_minimo" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "locais" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "local_cliente" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "local_evidencia" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "viagens" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "trechos_viagem" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "tipos_evento_viagem" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "eventos_viagem" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "viagem_mensagens" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "ticket_fotos" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "viagem_compartilhamentos" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "stories" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "story_visualizacoes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "story_reacoes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "viagem_pontos" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "pedagios" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "fechamentos" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "fechamento_linhas" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "layouts_envio" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "envios_fechamento" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "audit_logs" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "configuracao_tracking" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "configuracao_ia" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "configuracao_agente" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "configuracao_aviso_grupo" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "configuracao_busca_locais" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "configuracao_km_atipico" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "configuracao_forca_atualizacao" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "campos_layout" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "eventos_motorista" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "abastecimentos" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "abastecimento_fotos" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "notificacoes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "conversas" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "conversa_participantes" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "mensagens_chat" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "bloqueios_chat" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
ALTER TABLE "denuncias_mensagem_chat" ALTER COLUMN "contaId" SET DEFAULT '__SEM_CONTA__';
