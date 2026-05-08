-- Renomeia coluna `usuario` -> `cpf` em motoristas. CPF (11 dígitos sem máscara)
-- agora é o login do motorista.
-- ATENÇÃO: motoristas existentes que tinham `usuario` não-numérico (ex: "joao")
-- precisam ser editados pelo admin no dashboard pra colocar CPF válido. Login
-- desses motoristas vai falhar até serem atualizados.

-- DropIndex (constraint unique vai ser recriada)
ALTER INDEX "motoristas_usuario_key" RENAME TO "motoristas_cpf_key";

-- RenameColumn
ALTER TABLE "motoristas" RENAME COLUMN "usuario" TO "cpf";
