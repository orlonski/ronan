import type { PrismaClient } from "@prisma/client";

/**
 * Resolve a transportadora (frota) dona de um lançamento, pra ser CARIMBADA na
 * criação da viagem/pedágio/abastecimento.
 *
 * Regra única: o motorista manda; o veículo é só fallback pra quando o motorista
 * ainda não foi classificado. Um lançamento pertence a uma frota só — não existe
 * "visível pras duas".
 *
 * O carimbo é desnormalizado de propósito (ver Viagem.transportadoraId no
 * schema): reclassificar um motorista depois NÃO reescreve o histórico dele.
 * Quem quiser saber a frota atual do cadastro lê `motorista.transportadoraId`.
 *
 * Devolve null quando nenhum dos dois está classificado — lançamento fica sem
 * dono e só aparece pra quem tem acesso global.
 */
export async function resolverTransportadora(
  prisma: Pick<PrismaClient, "motorista" | "veiculo">,
  motoristaId: string,
  veiculoId: string | null | undefined,
): Promise<string | null> {
  const motorista = await prisma.motorista.findUnique({
    where: { id: motoristaId },
    select: { transportadoraId: true },
  });
  if (motorista?.transportadoraId) return motorista.transportadoraId;

  if (!veiculoId) return null;
  const veiculo = await prisma.veiculo.findUnique({
    where: { id: veiculoId },
    select: { transportadoraId: true },
  });
  return veiculo?.transportadoraId ?? null;
}

type PrismaLancamentos = Pick<PrismaClient, "viagem" | "pedagio" | "abastecimento">;

/**
 * Adota os lançamentos SEM DONO de um motorista ou veículo recém-classificado.
 *
 * Existe porque o carimbo só acontece na criação: sem isso, classificar uma
 * frota hoje deixaria todo o histórico dela invisível pro gestor, que logaria
 * numa tela vazia.
 *
 * Só toca em `transportadoraId: null` — de propósito. Reclassificar um cadastro
 * de uma frota pra outra NÃO move o histórico já carimbado; adotar órfão é uma
 * operação diferente de transferir dono.
 */
export async function adotarLancamentosOrfaos(
  prisma: PrismaLancamentos,
  alvo: { motoristaId: string } | { veiculoId: string },
  transportadoraId: string,
): Promise<{ viagens: number; pedagios: number; abastecimentos: number }> {
  const where = { ...alvo, transportadoraId: null };
  const data = { transportadoraId };
  const [viagens, pedagios, abastecimentos] = await Promise.all([
    prisma.viagem.updateMany({ where, data }),
    prisma.pedagio.updateMany({ where, data }),
    prisma.abastecimento.updateMany({ where, data }),
  ]);
  return {
    viagens: viagens.count,
    pedagios: pedagios.count,
    abastecimentos: abastecimentos.count,
  };
}
