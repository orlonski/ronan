import type { PlacaInput } from "@ronan/shared-types";
import type { PrismaService } from "../prisma/prisma.service";

export type PrismaTx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/** Como as placas ficam guardadas na identidade (antes de haver empresa). */
export type PlacaJson = { placa: string; modelo?: string; default?: boolean };

/**
 * Lê o JSON de placas da identidade. Tolera formato velho/lixo devolvendo
 * vazio: placa é conveniência de preenchimento, nunca motivo pra derrubar um
 * cadastro ou um aceite de convite.
 */
export function lerPlacasJson(valor: unknown): {
  placas: PlacaInput[];
  placaDefault: string | null;
} {
  if (!Array.isArray(valor)) return { placas: [], placaDefault: null };
  const itens = valor.filter(
    (p): p is PlacaJson => typeof p === "object" && p !== null && typeof (p as PlacaJson).placa === "string",
  );
  return {
    placas: itens.map((p) => ({ placa: p.placa, ...(p.modelo ? { modelo: p.modelo } : {}) })),
    placaDefault: itens.find((p) => p.default)?.placa ?? null,
  };
}

/**
 * Placa → `Veiculo` DA CONTA ATUAL, criando o que não existe.
 *
 * A placa é única por veículo dentro da empresa, e o mesmo caminhão pode estar
 * em vários motoristas (N:N). O `modelo` só é sobrescrito quando vem
 * preenchido — o que o administrativo cadastrou vale mais que o que o app
 * adivinhou.
 */
export async function upsertVeiculos(
  tx: PrismaTx,
  placas: PlacaInput[],
): Promise<{ id: string; placa: string }[]> {
  if (placas.length === 0) return [];
  const resolvidos: { id: string; placa: string }[] = [];
  for (const p of placas) {
    const existente = await tx.veiculo.findFirst({ where: { placa: p.placa } });
    if (existente) {
      if (p.modelo && existente.modelo !== p.modelo) {
        await tx.veiculo.update({ where: { id: existente.id }, data: { modelo: p.modelo } });
      }
      // Veículo que estava inativo volta a rodar — senão ele fica de fora dos
      // selects e relatórios do painel apesar de ter motorista.
      if (!existente.ativo) {
        await tx.veiculo.update({ where: { id: existente.id }, data: { ativo: true } });
      }
      resolvidos.push({ id: existente.id, placa: existente.placa });
    } else {
      const novo = await tx.veiculo.create({ data: { placa: p.placa, modelo: p.modelo } });
      resolvidos.push({ id: novo.id, placa: novo.placa });
    }
  }
  return resolvidos;
}

/** Qual dos veículos é o padrão. Com um só, é ele — sem precisar escolher. */
export function resolverVeiculoDefault(
  placaDefault: string | null | undefined,
  veiculos: { id: string; placa: string }[],
): string | null {
  if (placaDefault == null) return veiculos.length === 1 ? veiculos[0]!.id : null;
  return veiculos.find((v) => v.placa === placaDefault)?.id ?? null;
}

/**
 * Materializa as placas de um motorista dentro da empresa dele.
 *
 * É o que acontece quando alguém que se cadastrou pelo app (e disse "rodo com
 * ABC1D23" antes de ter empresa) aceita um convite: sem isto ele entraria sem
 * veículo nenhum e não conseguiria lançar. Placa que já está com outro motorista
 * é apenas VINCULADA também — quem resolve caminhão trocado é o administrativo,
 * e barrar aqui deixaria o motorista travado na porta.
 */
export async function vincularPlacas(
  tx: PrismaTx,
  motoristaId: string,
  placas: PlacaInput[],
  placaDefault: string | null,
): Promise<void> {
  const resolvidos = await upsertVeiculos(tx, placas);
  if (resolvidos.length === 0) return;
  await tx.motoristaVeiculo.createMany({
    data: resolvidos.map((v) => ({ motoristaId, veiculoId: v.id })),
    skipDuplicates: true,
  });
  const veiculoDefaultId = resolverVeiculoDefault(placaDefault, resolvidos);
  if (veiculoDefaultId) {
    await tx.motorista.update({ where: { id: motoristaId }, data: { veiculoDefaultId } });
  }
}
