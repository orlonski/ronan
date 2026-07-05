-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "legenda" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_visualizacoes" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "vistoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_visualizacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_reacoes" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_reacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stories_clientId_key" ON "stories"("clientId");

-- CreateIndex
CREATE INDEX "stories_expiraEm_idx" ON "stories"("expiraEm");

-- CreateIndex
CREATE INDEX "stories_motoristaId_criadoEm_idx" ON "stories"("motoristaId", "criadoEm");

-- CreateIndex
CREATE INDEX "story_visualizacoes_storyId_idx" ON "story_visualizacoes"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "story_visualizacoes_storyId_motoristaId_key" ON "story_visualizacoes"("storyId", "motoristaId");

-- CreateIndex
CREATE INDEX "story_reacoes_storyId_idx" ON "story_reacoes"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "story_reacoes_storyId_motoristaId_key" ON "story_reacoes"("storyId", "motoristaId");

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_visualizacoes" ADD CONSTRAINT "story_visualizacoes_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_visualizacoes" ADD CONSTRAINT "story_visualizacoes_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_reacoes" ADD CONSTRAINT "story_reacoes_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_reacoes" ADD CONSTRAINT "story_reacoes_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
