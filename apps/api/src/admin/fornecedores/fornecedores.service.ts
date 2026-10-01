import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AtualizarFornecedorInput,
  CriarCustoFixoInput,
  CriarFornecedorInput,
  EncerrarCustoFixoInput,
  LoteCustoFixoInput,
  ResultadoItemLoteCustoFixo,
  ResultadoLoteCustoFixo,
  SituacaoLoteCustoFixo,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";
import { normalizarPlaca } from "../../common/conferencia-ticket";

@Injectable()
export class FornecedoresService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: PaginationQuery & { tipo?: string; ativo?: string }) {
    const where: Prisma.FornecedorWhereInput = {};
    if (params.tipo) where.tipo = params.tipo as Prisma.FornecedorWhereInput["tipo"];
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    return paginate(this.prisma.fornecedor, {
      params,
      where: where as Record<string, unknown>,
      // Fornecedor é da empresa inteira, não de uma frota.
      escopo: SEM_ESCOPO,
      searchFields: ["nome", "cnpjCpf", "observacao"],
      sortable: { nome: "nome", tipo: "tipo", criadoEm: "criadoEm" },
      defaultSort: { field: "nome", order: "asc" },
    });
  }

  async findOne(id: string) {
    const f = await this.prisma.fornecedor.findUnique({ where: { id } });
    if (!f) throw new NotFoundException("Fornecedor não encontrado");
    return f;
  }

  create(data: CriarFornecedorInput) {
    return this.prisma.fornecedor.create({ data });
  }

  async update(id: string, data: AtualizarFornecedorInput) {
    await this.findOne(id);
    return this.prisma.fornecedor.update({ where: { id }, data });
  }

  /**
   * Fornecedor com conta lançada vira inativo em vez de sumir: apagar deixaria
   * o título a pagar apontando pro vazio, e o histórico do que se gastou com
   * quem é justamente o motivo de existir cadastro de fornecedor.
   */
  async remove(id: string) {
    await this.findOne(id);
    const usos = await this.prisma.tituloPagar.count({ where: { fornecedorId: id } });
    if (usos > 0) {
      await this.prisma.fornecedor.update({ where: { id }, data: { ativo: false } });
      return { ok: true, desativado: true, titulos: usos };
    }
    await this.prisma.fornecedor.delete({ where: { id } });
    return { ok: true, desativado: false, titulos: 0 };
  }

  listCustos(veiculoId?: string) {
    return this.prisma.custoFixoVeiculo.findMany({
      where: veiculoId ? { veiculoId } : {},
      include: { veiculo: { select: { id: true, placa: true } } },
      orderBy: [{ veiculoId: "asc" }, { vigenciaDe: "desc" }],
    });
  }

  async criarCusto(data: CriarCustoFixoInput) {
    const v = await this.prisma.veiculo.findUnique({ where: { id: data.veiculoId } });
    if (!v) throw new NotFoundException("Veículo não encontrado");

    // Dois custos do mesmo tipo valendo ao mesmo tempo dobrariam o rateio sem
    // ninguém perceber — o custo/km sairia inflado e a margem, negativa.
    const conflito = await this.prisma.custoFixoVeiculo.findFirst({
      where: {
        veiculoId: data.veiculoId,
        tipo: data.tipo,
        OR: [
          { vigenciaAte: null },
          { vigenciaAte: { gte: new Date(`${data.vigenciaDe}T00:00:00Z`) } },
        ],
      },
    });
    if (conflito) {
      throw new ConflictException(
        `Já existe um custo de ${data.tipo} valendo pra esse caminhão. Feche a vigência do antigo antes.`,
      );
    }

    return this.prisma.custoFixoVeiculo.create({
      data: {
        ...data,
        vigenciaDe: new Date(`${data.vigenciaDe}T00:00:00Z`),
        vigenciaAte: data.vigenciaAte ? new Date(`${data.vigenciaAte}T00:00:00Z`) : null,
      },
    });
  }

  async encerrarCusto(id: string, data: EncerrarCustoFixoInput) {
    const c = await this.prisma.custoFixoVeiculo.findUnique({ where: { id } });
    if (!c) throw new NotFoundException("Custo não encontrado");
    const ate = new Date(`${data.vigenciaAte}T00:00:00Z`);
    if (ate < c.vigenciaDe) {
      throw new BadRequestException("O fim não pode ser antes do início do custo.");
    }
    return this.prisma.custoFixoVeiculo.update({ where: { id }, data: { vigenciaAte: ate } });
  }

  /**
   * Custos fixos de vários caminhões de uma vez. Confere TUDO antes e só grava
   * se nenhuma linha tiver erro — meio lote gravado deixaria a pessoa sem saber
   * o que reenviar. Com `simular`, só devolve o que aconteceria.
   *
   * Caminhão que já tem o mesmo tipo valendo com outro valor: o antigo é
   * encerrado na véspera e o novo começa na data. É o "seguro renovou" — e o
   * mês em que o antigo valeu continua no lucro daquele mês.
   */
  async loteCustos(input: LoteCustoFixoInput): Promise<ResultadoLoteCustoFixo> {
    const veiculos = await this.prisma.veiculo.findMany({ select: { id: true, placa: true } });
    const porPlaca = new Map(veiculos.map((v) => [normalizarPlaca(v.placa), v]));

    const ids = [
      ...new Set(
        input.itens
          .map((i) => porPlaca.get(normalizarPlaca(i.placa))?.id)
          .filter((id): id is string => id != null),
      ),
    ];
    const existentes = ids.length
      ? await this.prisma.custoFixoVeiculo.findMany({
          where: { veiculoId: { in: ids } },
          select: { id: true, veiculoId: true, tipo: true, valorMensal: true, vigenciaDe: true, vigenciaAte: true },
        })
      : [];

    const vistos = new Set<string>();
    const planos: { item: ResultadoItemLoteCustoFixo; veiculoId?: string; encerrarId?: string }[] = [];
    for (const item of input.itens) {
      const v = porPlaca.get(normalizarPlaca(item.placa));
      if (!v) {
        planos.push({ item: { ...item, situacao: "ERRO", mensagem: "Caminhão não cadastrado com essa placa." } });
        continue;
      }
      const chave = `${v.id}|${item.tipo}`;
      if (vistos.has(chave)) {
        planos.push({
          item: { ...item, placaCadastro: v.placa, situacao: "ERRO", mensagem: "Este custo aparece duas vezes pro mesmo caminhão." },
        });
        continue;
      }
      vistos.add(chave);

      const inicio = new Date(`${item.vigenciaDe}T00:00:00Z`);
      const conflitos = existentes.filter(
        (c) =>
          c.veiculoId === v.id &&
          c.tipo === item.tipo &&
          (c.vigenciaAte == null || c.vigenciaAte >= inicio),
      );
      const depois = conflitos.find((c) => c.vigenciaDe >= inicio);
      if (depois && depois.vigenciaDe.getTime() === inicio.getTime() && depois.valorMensal.eq(item.valorMensal)) {
        planos.push({ item: { ...item, placaCadastro: v.placa, situacao: "IGUAL", mensagem: "Já cadastrado assim." } });
        continue;
      }
      if (depois) {
        planos.push({
          item: {
            ...item,
            placaCadastro: v.placa,
            situacao: "ERRO",
            mensagem: `Já existe ${item.tipo} desse caminhão começando em ${fmtDia(depois.vigenciaDe)}. Use uma data depois dessa ou apague o outro.`,
          },
        });
        continue;
      }
      const anterior = conflitos[0];
      if (!anterior) {
        planos.push({ item: { ...item, placaCadastro: v.placa, situacao: "NOVO" }, veiculoId: v.id });
        continue;
      }
      if (anterior.valorMensal.eq(item.valorMensal) && anterior.vigenciaAte == null) {
        planos.push({ item: { ...item, placaCadastro: v.placa, situacao: "IGUAL", mensagem: "Já está valendo com esse valor." } });
        continue;
      }
      planos.push({
        item: {
          ...item,
          placaCadastro: v.placa,
          situacao: "SUBSTITUI",
          anterior: { valorMensal: anterior.valorMensal.toFixed(2), vigenciaDe: fmtDia(anterior.vigenciaDe) },
        },
        veiculoId: v.id,
        encerrarId: anterior.id,
      });
    }

    const resumo: Record<SituacaoLoteCustoFixo, number> = { NOVO: 0, SUBSTITUI: 0, IGUAL: 0, ERRO: 0 };
    for (const p of planos) resumo[p.item.situacao]++;
    const itens = planos.map((p) => p.item);

    if (input.simular || resumo.ERRO > 0) return { gravado: false, itens, resumo };

    await this.prisma.$transaction(async (tx) => {
      for (const p of planos) {
        if (!p.veiculoId) continue;
        const inicio = new Date(`${p.item.vigenciaDe}T00:00:00Z`);
        if (p.encerrarId) {
          await tx.custoFixoVeiculo.update({
            where: { id: p.encerrarId },
            data: { vigenciaAte: new Date(inicio.getTime() - 86_400_000) },
          });
        }
        await tx.custoFixoVeiculo.create({
          data: {
            veiculoId: p.veiculoId,
            tipo: p.item.tipo,
            valorMensal: p.item.valorMensal,
            vigenciaDe: inicio,
          },
        });
      }
    });
    return { gravado: true, itens, resumo };
  }

  async removerCusto(id: string) {
    const c = await this.prisma.custoFixoVeiculo.findUnique({ where: { id } });
    if (!c) throw new NotFoundException("Custo não encontrado");
    await this.prisma.custoFixoVeiculo.delete({ where: { id } });
    return { ok: true };
  }
}

/** Dia de uma coluna @db.Date, como a pessoa lê. */
function fmtDia(d: Date): string {
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
}
