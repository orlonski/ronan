import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AtualizarTabelaPrecoInput,
  CriarTabelaPrecoInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";
import { tabelaPrecoAplicada, type TabelaPrecoRow } from "../../common/viagem-preco";
import { PrecificacaoService } from "./precificacao.service";

type ListParams = PaginationQuery & {
  empresaId?: string;
  base?: string;
  ativo?: "true" | "false";
  /** "true" = só o que vale hoje. O painel abre assim: preço vencido é ruído. */
  vigentes?: "true" | "false";
};

const INCLUDE = {
  empresa: { select: { id: true, nome: true } },
  material: { select: { id: true, nome: true } },
  tipoServico: { select: { id: true, nome: true } },
} satisfies Prisma.TabelaPrecoInclude;

@Injectable()
export class TabelasPrecoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly precificacao: PrecificacaoService,
  ) {}

  list(params: ListParams) {
    const where: Prisma.TabelaPrecoWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.base) where.base = params.base as Prisma.TabelaPrecoWhereInput["base"];
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    if (params.vigentes === "true") {
      const hoje = new Date();
      where.vigenciaDe = { lte: hoje };
      where.OR = [{ vigenciaAte: null }, { vigenciaAte: { gte: hoje } }];
    }
    return paginate(this.prisma.tabelaPreco, {
      params,
      where: where as Record<string, unknown>,
      // Preço é da relação empresa↔tomador, não de uma frota: não há coluna de
      // transportadora pra recortar. Mesmo caso de RegraMinimo.
      escopo: SEM_ESCOPO,
      searchFields: ["empresa.nome", "material.nome"],
      sortable: {
        kmFaixaDe: "kmFaixaDe",
        precoUnitario: "precoUnitario",
        vigenciaDe: "vigenciaDe",
        criadoEm: "criadoEm",
        ativo: "ativo",
      },
      defaultSort: { field: "vigenciaDe", order: "desc" },
      include: INCLUDE,
    });
  }

  findOne(id: string) {
    return this.prisma.tabelaPreco.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }

  async create(data: CriarTabelaPrecoInput, usuarioId: string) {
    await this.validarRefs(data);
    await this.recusarSobreposicao(data);
    const criada = await this.prisma.tabelaPreco.create({
      data: {
        ...data,
        vigenciaDe: new Date(`${data.vigenciaDe}T00:00:00Z`),
        vigenciaAte: data.vigenciaAte ? new Date(`${data.vigenciaAte}T00:00:00Z`) : null,
        criadoPorId: usuarioId,
      },
      include: INCLUDE,
    });
    // Preço novo vale pro que já foi lançado dentro da vigência dele — é o caso
    // normal: a empresa cadastra a tabela depois de um mês já rodado. Sem este
    // recálculo, o cliente cadastra o preço e a tela continua mostrando zero.
    await this.precificacao.recalcularDaEmpresa(criada.empresaId, {
      de: criada.vigenciaDe,
      ate: criada.vigenciaAte ?? undefined,
    });
    return criada;
  }

  async update(id: string, data: AtualizarTabelaPrecoInput) {
    const atual = await this.ensureExists(id);
    await this.validarRefs(data);
    await this.recusarSobreposicao({ ...atual, ...data } as never, id);
    const atualizada = await this.prisma.tabelaPreco.update({
      where: { id },
      data: {
        ...data,
        ...(data.vigenciaDe ? { vigenciaDe: new Date(`${data.vigenciaDe}T00:00:00Z`) } : {}),
        ...(data.vigenciaAte !== undefined
          ? { vigenciaAte: data.vigenciaAte ? new Date(`${data.vigenciaAte}T00:00:00Z`) : null }
          : {}),
      },
      include: INCLUDE,
    });
    // Recalcula nas DUAS empresas quando o preço mudou de dono, senão a antiga
    // fica com valores de uma linha que não a atende mais.
    await this.precificacao.recalcularDaEmpresa(atualizada.empresaId);
    if (atual.empresaId !== atualizada.empresaId) {
      await this.precificacao.recalcularDaEmpresa(atual.empresaId);
    }
    return atualizada;
  }

  /**
   * Preço já usado não some: vira inativo.
   *
   * Apagar reescreveria o passado por tabela — o `ViagemValor` guarda o valor
   * congelado e sobreviveria (a FK é SetNull), mas o painel perderia a linha que
   * explica de onde aquele número saiu. Sem uso, apaga de verdade: erro de
   * digitação recém-criado não merece virar lixo permanente na tela.
   */
  async remove(id: string) {
    const { empresaId } = await this.ensureExists(id);
    const usos = await this.prisma.viagemValor.count({ where: { tabelaPrecoId: id } });
    if (usos > 0) {
      await this.prisma.tabelaPreco.update({ where: { id }, data: { ativo: false } });
      // As viagens que usavam esta linha reavaliam: ou casam com outra linha, ou
      // ficam sem valor. Manter o número velho seria cobrar por um preço que a
      // empresa acabou de dizer que não vale mais.
      await this.precificacao.recalcularDaEmpresa(empresaId);
      return { ok: true, desativado: true, viagens: usos };
    }
    await this.prisma.tabelaPreco.delete({ where: { id } });
    await this.precificacao.recalcularDaEmpresa(empresaId);
    return { ok: true, desativado: false, viagens: 0 };
  }

  /**
   * Simulador: "quanto sai uma viagem assim?". Responde com a linha que casaria
   * e a conta feita — é como o comercial confere a tabela antes de prometer
   * preço, sem ter que lançar uma viagem de mentira.
   */
  async simular(args: {
    empresaId: string;
    materialId?: string | null;
    tipoServicoId?: string | null;
    km: number;
    toneladas: number;
    data?: string;
  }) {
    const tabelas = (await this.prisma.tabelaPreco.findMany({
      where: { empresaId: args.empresaId, ativo: true },
      include: INCLUDE,
    })) as unknown as (TabelaPrecoRow & { empresa: { nome: string } })[];

    const linha = tabelaPrecoAplicada(tabelas, {
      empresaId: args.empresaId,
      materialId: args.materialId ?? null,
      tipoServicoId: args.tipoServicoId ?? null,
      kmReal: args.km,
      data: args.data ?? new Date(),
    });
    if (!linha) {
      return { encontrou: false as const, motivo: "Nenhum preço cadastrado serve pra essa viagem." };
    }

    const quantidade =
      linha.base === "TONELADA" ? args.toneladas : linha.base === "KM" ? args.km : 1;
    const valorFrete = Number(linha.precoUnitario) * quantidade;
    return {
      encontrou: true as const,
      tabelaPrecoId: linha.id,
      base: linha.base,
      precoUnitario: Number(linha.precoUnitario).toFixed(2),
      quantidade: quantidade.toFixed(3),
      valorFrete: valorFrete.toFixed(2),
      repassaPedagio: linha.repassaPedagio,
      // A simulação NÃO aplica mínimo: aqui o usuário está conferindo o preço,
      // e misturar as duas regras na mesma tela é como se confunde as duas.
      observacao: "Simulação pelo valor informado — o mínimo por faixa é aplicado no lançamento.",
    };
  }

  /**
   * Duas linhas que casam com a mesma viagem tornam o preço imprevisível: a
   * ordem de desempate decide, e ninguém lembra dela olhando a tela. Recusamos
   * na hora de cadastrar, que é quando dá pra explicar.
   *
   * Sobreposição = mesmo alvo (empresa + material + modo), faixas de km que se
   * cruzam E vigências que se cruzam.
   */
  private async recusarSobreposicao(
    data: {
      empresaId: string;
      materialId?: string | null;
      tipoServicoId?: string | null;
      kmFaixaDe: number;
      kmFaixaAte?: number | null;
      vigenciaDe: string | Date;
      vigenciaAte?: string | Date | null;
    },
    ignorarId?: string,
  ) {
    const existentes = await this.prisma.tabelaPreco.findMany({
      where: {
        empresaId: data.empresaId,
        materialId: data.materialId ?? null,
        tipoServicoId: data.tipoServicoId ?? null,
        ativo: true,
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
      },
      include: { material: { select: { nome: true } } },
    });

    const dia = (v: string | Date) =>
      typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
    const novoDe = dia(data.vigenciaDe);
    const novoAte = data.vigenciaAte ? dia(data.vigenciaAte) : null;
    const kmDe = data.kmFaixaDe;
    const kmAte = data.kmFaixaAte ?? Number.POSITIVE_INFINITY;

    const conflito = existentes.find((e) => {
      const eDe = Number(e.kmFaixaDe);
      const eAte = e.kmFaixaAte == null ? Number.POSITIVE_INFINITY : Number(e.kmFaixaAte);
      const kmCruza = kmDe < eAte && eDe < kmAte;
      if (!kmCruza) return false;
      const vDe = dia(e.vigenciaDe);
      const vAte = e.vigenciaAte ? dia(e.vigenciaAte) : null;
      // Vigência aberta (sem fim) cruza com tudo que vier depois dela.
      const vigCruza = (novoAte == null || novoAte >= vDe) && (vAte == null || vAte >= novoDe);
      return vigCruza;
    });

    if (conflito) {
      const alvo = conflito.material?.nome ?? "qualquer material";
      const faixa = `${Number(conflito.kmFaixaDe)} a ${conflito.kmFaixaAte == null ? "∞" : Number(conflito.kmFaixaAte)} km`;
      throw new BadRequestException(
        `Já existe um preço pra ${alvo} nessa faixa (${faixa}) valendo no mesmo período. ` +
          `Feche a vigência do preço antigo antes de cadastrar o novo, ou mude a faixa de km.`,
      );
    }
  }

  private async validarRefs(data: {
    empresaId?: string;
    materialId?: string | null;
    tipoServicoId?: string | null;
    base?: string;
  }) {
    if (data.empresaId) {
      const e = await this.prisma.empresa.findUnique({ where: { id: data.empresaId } });
      if (!e) throw new NotFoundException("Cliente não encontrado");
    }
    if (data.materialId) {
      const m = await this.prisma.material.findUnique({ where: { id: data.materialId } });
      if (!m) throw new NotFoundException("Material não encontrado");
    }
    if (data.tipoServicoId) {
      const t = await this.prisma.tipoServico.findUnique({ where: { id: data.tipoServicoId } });
      if (!t) throw new NotFoundException("Modo de serviço não encontrado");
    }
  }

  private async ensureExists(id: string) {
    const t = await this.prisma.tabelaPreco.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Preço não encontrado");
    return t;
  }
}
