-- Cadastro fiscal e as chaves dos documentos emitidos fora.
--
-- Varredura por CT-e, MDF-e, NF-e, SEFAZ, CFOP, IBGE no código: zero. O sistema
-- não emitia, não importava, não validava e não guardava nenhum documento
-- fiscal. Isto não o torna um emissor — torna-o capaz de AMARRAR o documento que
-- o cliente já emite em outro lugar, que é o que mata a digitação dupla.
--
-- Tudo nullable: quem não emite documento não precisa preencher nada, e quem
-- for emitir é cobrado na hora de emitir, não na hora de cadastrar.

ALTER TABLE "contas"
  ADD COLUMN "razaoSocial" TEXT,
  ADD COLUMN "inscricaoEstadual" TEXT,
  ADD COLUMN "inscricaoMunicipal" TEXT,
  ADD COLUMN "crt" TEXT,
  ADD COLUMN "logradouro" TEXT,
  ADD COLUMN "numero" TEXT,
  ADD COLUMN "complemento" TEXT,
  ADD COLUMN "bairro" TEXT,
  ADD COLUMN "cep" TEXT,
  ADD COLUMN "municipio" TEXT,
  ADD COLUMN "codigoMunicipioIbge" TEXT,
  ADD COLUMN "uf" TEXT,
  ADD COLUMN "telefoneFiscal" TEXT,
  ADD COLUMN "rntrc" TEXT,
  ADD COLUMN "tipoTransportador" TEXT;

ALTER TABLE "empresas"
  ADD COLUMN "razaoSocial" TEXT,
  ADD COLUMN "inscricaoEstadual" TEXT,
  ADD COLUMN "indicadorIe" TEXT,
  ADD COLUMN "logradouro" TEXT,
  ADD COLUMN "numeroEndereco" TEXT,
  ADD COLUMN "bairro" TEXT,
  ADD COLUMN "cep" TEXT,
  ADD COLUMN "municipio" TEXT,
  ADD COLUMN "codigoMunicipioIbge" TEXT,
  ADD COLUMN "uf" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "prazoPagamentoDias" INTEGER;

ALTER TABLE "clientes"
  ADD COLUMN "cnpjCpf" TEXT,
  ADD COLUMN "inscricaoEstadual" TEXT,
  ADD COLUMN "indicadorIe" TEXT,
  ADD COLUMN "logradouro" TEXT,
  ADD COLUMN "numeroEndereco" TEXT,
  ADD COLUMN "bairro" TEXT,
  ADD COLUMN "cep" TEXT,
  ADD COLUMN "municipio" TEXT,
  ADD COLUMN "codigoMunicipioIbge" TEXT,
  ADD COLUMN "uf" TEXT,
  ADD COLUMN "telefone" TEXT,
  ADD COLUMN "email" TEXT;

-- O campo mais barato e mais bloqueante da lista fiscal: o CT-e exige
-- cMunIni/cMunFim e o MDF-e exige cMunCarrega/cMunDescarga.
ALTER TABLE "locais" ADD COLUMN "codigoMunicipioIbge" TEXT;

ALTER TABLE "viagens"
  ADD COLUMN "nfeChave" TEXT,
  ADD COLUMN "nfeNumero" TEXT,
  ADD COLUMN "nfeSerie" TEXT,
  ADD COLUMN "cteChave" TEXT,
  ADD COLUMN "cteNumero" TEXT,
  ADD COLUMN "cteSerie" TEXT,
  ADD COLUMN "mdfeChave" TEXT,
  -- Comprovante de Entrega Eletrônico (evento 110180 do CT-e): faltava só saber
  -- quem recebeu. Data, hora e geolocalização já estavam no banco.
  ADD COLUMN "recebedorNome" TEXT,
  ADD COLUMN "recebedorDoc" TEXT;
