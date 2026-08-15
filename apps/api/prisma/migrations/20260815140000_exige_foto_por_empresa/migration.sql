-- Foto do comprovante obrigatória, configurada por EMPRESA.
--
-- Empresa é onde já mora a config da relação comercial (tolerâncias, chave de
-- match, layouts) — as duas flags entram ao lado delas.
--
-- Tudo nasce DESLIGADO: quem não configurar nada continua exatamente como hoje,
-- onde a foto é opcional em todos os pontos de lançamento.
ALTER TABLE "empresas"
  ADD COLUMN "exigeFotoViagem" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "exigeFotoAbastecimento" BOOLEAN NOT NULL DEFAULT false;

-- Material que não gera papel nenhum (concreto) suprime a exigência da empresa:
-- não dá pra cobrar foto de um comprovante que não existe. Default true porque
-- a esmagadora maioria dos materiais gera ticket de pesagem.
ALTER TABLE "materiais"
  ADD COLUMN "temComprovanteFoto" BOOLEAN NOT NULL DEFAULT true;

-- Por que o lançamento veio sem a foto. O app bloqueia o salvar até ter foto ou
-- justificativa; o backend nunca recusa (recusar mataria item de outbox offline),
-- então aqui também cai o carimbo automático de "a foto sumiu do aparelho".
ALTER TABLE "viagens" ADD COLUMN "justificativaSemFoto" TEXT;
ALTER TABLE "abastecimentos" ADD COLUMN "justificativaSemFoto" TEXT;
