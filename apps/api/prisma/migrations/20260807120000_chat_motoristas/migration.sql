-- CreateEnum
CREATE TYPE "TipoConversa" AS ENUM ('DIRETA', 'AVISOS');

-- CreateEnum
CREATE TYPE "TipoMensagemChat" AS ENUM ('TEXTO', 'AUDIO');

-- CreateEnum
CREATE TYPE "StatusDenunciaChat" AS ENUM ('ABERTA', 'ARQUIVADA', 'REMOVIDA');

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "podeChat" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "conversas" (
    "id" TEXT NOT NULL,
    "tipo" "TipoConversa" NOT NULL DEFAULT 'DIRETA',
    "chaveDireta" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaMensagemEm" TIMESTAMP(3),
    "ultimaMensagemTexto" TEXT,

    CONSTRAINT "conversas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversa_participantes" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "ultimaLeituraEm" TIMESTAMP(3),
    "silenciado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversa_participantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_chat" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "autor" "AutorMensagem" NOT NULL,
    "motoristaId" TEXT,
    "usuarioId" TEXT,
    "autorNome" TEXT NOT NULL,
    "tipo" "TipoMensagemChat" NOT NULL DEFAULT 'TEXTO',
    "texto" TEXT,
    "audioKey" TEXT,
    "audioSegundos" INTEGER,
    "transcricao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apagadaEm" TIMESTAMP(3),
    "removidaPorId" TEXT,

    CONSTRAINT "mensagens_chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueios_chat" (
    "id" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "bloqueadoId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueios_chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denuncias_mensagem_chat" (
    "id" TEXT NOT NULL,
    "mensagemId" TEXT NOT NULL,
    "denuncianteId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "detalhe" TEXT,
    "status" "StatusDenunciaChat" NOT NULL DEFAULT 'ABERTA',
    "resolvidoPorId" TEXT,
    "resolvidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "denuncias_mensagem_chat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversas_chaveDireta_key" ON "conversas"("chaveDireta");

-- CreateIndex
CREATE INDEX "conversas_ultimaMensagemEm_idx" ON "conversas"("ultimaMensagemEm" DESC);

-- CreateIndex
CREATE INDEX "conversa_participantes_motoristaId_idx" ON "conversa_participantes"("motoristaId");

-- CreateIndex
CREATE UNIQUE INDEX "conversa_participantes_conversaId_motoristaId_key" ON "conversa_participantes"("conversaId", "motoristaId");

-- CreateIndex
CREATE UNIQUE INDEX "mensagens_chat_clientId_key" ON "mensagens_chat"("clientId");

-- CreateIndex
CREATE INDEX "mensagens_chat_conversaId_criadoEm_idx" ON "mensagens_chat"("conversaId", "criadoEm");

-- CreateIndex
CREATE INDEX "bloqueios_chat_bloqueadoId_idx" ON "bloqueios_chat"("bloqueadoId");

-- CreateIndex
CREATE UNIQUE INDEX "bloqueios_chat_motoristaId_bloqueadoId_key" ON "bloqueios_chat"("motoristaId", "bloqueadoId");

-- CreateIndex
CREATE INDEX "denuncias_mensagem_chat_status_criadoEm_idx" ON "denuncias_mensagem_chat"("status", "criadoEm" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "denuncias_mensagem_chat_mensagemId_denuncianteId_key" ON "denuncias_mensagem_chat"("mensagemId", "denuncianteId");

-- AddForeignKey
ALTER TABLE "conversa_participantes" ADD CONSTRAINT "conversa_participantes_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversa_participantes" ADD CONSTRAINT "conversa_participantes_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_chat" ADD CONSTRAINT "mensagens_chat_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_chat" ADD CONSTRAINT "mensagens_chat_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_chat" ADD CONSTRAINT "mensagens_chat_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_chat" ADD CONSTRAINT "mensagens_chat_removidaPorId_fkey" FOREIGN KEY ("removidaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueios_chat" ADD CONSTRAINT "bloqueios_chat_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueios_chat" ADD CONSTRAINT "bloqueios_chat_bloqueadoId_fkey" FOREIGN KEY ("bloqueadoId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncias_mensagem_chat" ADD CONSTRAINT "denuncias_mensagem_chat_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "mensagens_chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncias_mensagem_chat" ADD CONSTRAINT "denuncias_mensagem_chat_denuncianteId_fkey" FOREIGN KEY ("denuncianteId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncias_mensagem_chat" ADD CONSTRAINT "denuncias_mensagem_chat_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

