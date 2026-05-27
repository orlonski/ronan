-- Rastreamento de autoria: coluna "criadoPorId" (FK opcional → users) em 9
-- entidades editáveis pelo admin. Registros antigos ficam com NULL (frontend
-- mostra "—"). Se o User for deletado, FK volta a NULL (SET NULL).

ALTER TABLE "clientes"     ADD COLUMN "criadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "materiais"    ADD COLUMN "criadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veiculos"     ADD COLUMN "criadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "motoristas"   ADD COLUMN "criadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "empresas"     ADD COLUMN "criadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "locais"       ADD COLUMN "criadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users"        ADD COLUMN "criadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notificacoes" ADD COLUMN "criadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fechamentos"  ADD COLUMN "criadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
