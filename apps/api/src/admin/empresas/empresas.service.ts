import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PapelEmpresa, Prisma } from "@prisma/client";
import type { CriarEmpresaInput, AtualizarEmpresaInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";

type ListEmpresasParams = PaginationQuery & {
  ativa?: "true" | "false";
  papel?: PapelEmpresa;
};

@Injectable()
export class EmpresasService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListEmpresasParams) {
    const where: Prisma.EmpresaWhereInput = {};
    if (params.ativa === "true") where.ativa = true;
    if (params.ativa === "false") where.ativa = false;
    if (params.papel) where.papel = params.papel;
    return paginate(this.prisma.empresa, {
      params,
      where: where as Record<string, unknown>,
      // Model sem coluna de frota: não há o que filtrar por transportadora. O
      // isolamento entre EMPRESAS aqui é da trava de conta; o recorte por frota
      // fica com a matriz de papéis (não existe guard de escopo — ver escopo.ts).
      escopo: SEM_ESCOPO,
      searchFields: ["nome", "cnpj", "contato"],
      sortable: { nome: "nome", cnpj: "cnpj", papel: "papel", ativa: "ativa", criadoEm: "criadoEm" },
      defaultSort: { field: "nome", order: "asc" },
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
  }

  findOne(id: string) {
    return this.prisma.empresa.findUniqueOrThrow({
      where: { id },
      include: { criadoPor: { select: { id: true, nome: true } } },
    });
  }

  async create(data: CriarEmpresaInput, usuarioId: string) {
    if (data.cnpj) {
      const exists = await this.prisma.empresa.findFirst({ where: { cnpj: data.cnpj } });
      if (exists) throw new ConflictException("CNPJ/CPF já cadastrado");
    }
    // Todo cliente nasce com a primeira obra, com o mesmo nome. O motorista
    // escolhe OBRA no app — um cliente sem nenhuma não aparece pra ele, e antes
    // o escritório tinha que cadastrar o mesmo nome duas vezes (33 de 34 casos
    // em produção eram exatamente isso). Quem tem uma obra só nunca precisa
    // ver essa camada; quem tem várias cadastra as outras dentro do cliente.
    return this.prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.create({
        data: { ...data, criadoPorId: usuarioId } as Prisma.EmpresaUncheckedCreateInput,
      });
      await tx.cliente.create({
        data: { nome: empresa.nome, empresaId: empresa.id, criadoPorId: usuarioId },
      });
      return empresa;
    });
  }

  async update(id: string, data: AtualizarEmpresaInput) {
    const antes = await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.update({
        where: { id },
        data: data as Prisma.EmpresaUncheckedUpdateInput,
      });
      // Renomear o cliente leva junto a obra que nasceu com ele — só quando é
      // a única e tem EXATAMENTE o nome antigo. "Castilho" com a obra
      // "CASTILHO" não é a mesma coisa: alguém escolheu escrever diferente
      // (é o nome que o motorista lê), e isso não se muda por tabela.
      if (data.nome && data.nome !== antes.nome) {
        const obras = await tx.cliente.findMany({
          where: { empresaId: id },
          select: { id: true, nome: true },
          take: 2,
        });
        if (obras.length === 1 && obras[0]!.nome === antes.nome) {
          await tx.cliente.update({ where: { id: obras[0]!.id }, data: { nome: data.nome } });
        }
      }
      return empresa;
    });
  }

  async remove(id: string) {
    const empresa = await this.ensureExists(id);
    // A obra que nasceu junto não pode travar a exclusão pra sempre: se ela é a
    // única, tem o mesmo nome e nunca foi usada (sem viagem, local ou pedido),
    // sai junto. Obra usada continua travando — ela carrega histórico.
    const obras = await this.prisma.cliente.findMany({
      where: { empresaId: id },
      select: { id: true, nome: true },
      take: 2,
    });
    let obraQueSaiJunto: string | null = null;
    if (obras.length === 1 && obras[0]!.nome === empresa.nome) {
      const [viagens, locais, pedidos] = await Promise.all([
        this.prisma.viagem.count({ where: { clienteId: obras[0]!.id } }),
        this.prisma.localCliente.count({ where: { clienteId: obras[0]!.id } }),
        this.prisma.pedido.count({ where: { clienteId: obras[0]!.id } }),
      ]);
      if (viagens + locais + pedidos === 0) obraQueSaiJunto = obras[0]!.id;
    }
    const [clientes, fechamentos, layouts, envios] = await Promise.all([
      this.prisma.cliente.count({
        where: { empresaId: id, ...(obraQueSaiJunto ? { id: { not: obraQueSaiJunto } } : {}) },
      }),
      this.prisma.fechamento.count({ where: { empresaId: id } }),
      this.prisma.layoutEnvio.count({ where: { empresaId: id } }),
      this.prisma.envioFechamento.count({ where: { empresaId: id } }),
    ]);
    const partes: string[] = [];
    if (clientes > 0) partes.push(`${clientes} obra${clientes === 1 ? "" : "s"}`);
    if (fechamentos > 0)
      partes.push(`${fechamentos} fechamento${fechamentos === 1 ? "" : "s"}`);
    if (layouts > 0) partes.push(`${layouts} layout${layouts === 1 ? "" : "s"} de envio`);
    if (envios > 0) partes.push(`${envios} envio${envios === 1 ? "" : "s"}`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    // LayoutImportBloco sai cascade via schema
    await this.prisma.$transaction(async (tx) => {
      if (obraQueSaiJunto) await tx.cliente.delete({ where: { id: obraQueSaiJunto } });
      await tx.empresa.delete({ where: { id } });
    });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const e = await this.prisma.empresa.findUnique({ where: { id } });
    if (!e) throw new NotFoundException("Cliente não encontrado");
    return e;
  }
}
