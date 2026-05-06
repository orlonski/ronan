-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "versao" TEXT,
    "userId" TEXT,
    "userType" TEXT,
    "url" TEXT,
    "userAgent" TEXT,
    "extra" JSONB,
    "capturadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_logs_hash_idx" ON "error_logs"("hash");
CREATE INDEX "error_logs_origem_capturadoEm_idx" ON "error_logs"("origem", "capturadoEm");
CREATE INDEX "error_logs_capturadoEm_idx" ON "error_logs"("capturadoEm");
CREATE INDEX "error_logs_userId_idx" ON "error_logs"("userId");
