import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TipoVinculoNome } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { normalizarTexto, type ContextoNomes, type Lido, type VinculoNome } from "../common/conferencia-ticket";

export type CampoVinculo = "cliente" | "material";

/** Que tipos fazem sentido em cada campo da leitura. */
const TIPOS_DO_CAMPO: Record<CampoVinculo, TipoVinculoNome[]> = {
  cliente: [TipoVinculoNome.OBRA, TipoVinculoNome.FORNECEDOR, TipoVinculoNome.DESTINO],
  material: [TipoVinculoNome.MATERIAL],
};

/**
 * O de/para dos nomes do ticket (`VinculoNomeTicket`).
 *
 * Só gente cria vínculo — pela tela da viagem, com permissão própria. A
 * leitura da IA apenas CONSULTA o que já foi decidido.
 */
@Injectable()
export class VinculosNomeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O que o cadastro diz sobre os nomes que a leitura achou nesta viagem: o
   * registro lançado (nome + apelidos) e o vínculo de cada nome lido.
   */
  async contexto(viagemId: string, lido: Pick<Lido, "clienteNome" | "materialNome">): Promise<ContextoNomes> {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        cliente: { select: { id: true, nome: true, apelidos: true } },
        material: { select: { id: true, nome: true, apelidos: true } },
      },
    });
    const [vCliente, vMaterial] = await Promise.all([
      this.buscar("cliente", lido.clienteNome),
      this.buscar("material", lido.materialNome),
    ]);
    return {
      cliente: {
        id: viagem?.cliente?.id ?? null,
        nomes: viagem?.cliente ? [viagem.cliente.nome, ...viagem.cliente.apelidos] : [],
        vinculo: vCliente,
      },
      material: {
        id: viagem?.material?.id ?? null,
        nomes: viagem?.material ? [viagem.material.nome, ...viagem.material.apelidos] : [],
        vinculo: vMaterial,
      },
    };
  }

  private async buscar(campo: CampoVinculo, nome: string | null | undefined): Promise<VinculoNome | null> {
    const norm = nome ? normalizarTexto(nome) : "";
    if (!norm) return null;
    const v = await this.prisma.vinculoNomeTicket.findFirst({
      where: { campo, nomeNormalizado: norm },
      select: {
        tipo: true,
        clienteId: true,
        materialId: true,
        cliente: { select: { nome: true } },
        material: { select: { nome: true } },
      },
    });
    if (!v) return null;
    return {
      tipo: v.tipo,
      alvoId: v.clienteId ?? v.materialId ?? null,
      alvoNome: v.cliente?.nome ?? v.material?.nome ?? null,
    };
  }

  /** Os vínculos que valem pros nomes desta leitura — pro card mostrar quem decidiu. */
  async daLeitura(lido: Pick<Lido, "clienteNome" | "materialNome"> | null) {
    if (!lido) return [];
    const alvos = (
      [
        ["cliente", lido.clienteNome],
        ["material", lido.materialNome],
      ] as const
    )
      .map(([campo, nome]) => ({ campo, nomeNormalizado: nome ? normalizarTexto(nome) : "" }))
      .filter((a) => a.nomeNormalizado);
    if (alvos.length === 0) return [];
    return this.prisma.vinculoNomeTicket.findMany({
      where: { OR: alvos },
      select: {
        id: true,
        campo: true,
        nomeLido: true,
        tipo: true,
        clienteId: true,
        materialId: true,
        cliente: { select: { nome: true } },
        material: { select: { nome: true } },
        criadoPorNome: true,
        criadoEm: true,
      },
    });
  }

  /**
   * Grava a decisão de uma pessoa. Um nome tem UM significado por empresa:
   * decidir de novo substitui o anterior (quem errou o vínculo corrige ali
   * mesmo, sem tela de cadastro à parte).
   */
  async vincular(args: {
    campo: CampoVinculo;
    nomeLido: string;
    tipo: TipoVinculoNome;
    clienteId?: string | null;
    materialId?: string | null;
    viagemOrigemId?: string | null;
    usuario: { id: string | null; nome: string };
  }) {
    const nomeNormalizado = normalizarTexto(args.nomeLido);
    if (!nomeNormalizado) throw new BadRequestException("O nome lido está vazio.");
    if (!TIPOS_DO_CAMPO[args.campo].includes(args.tipo)) {
      throw new BadRequestException(`"${args.tipo}" não vale pro campo ${args.campo}.`);
    }

    // O alvo é exigido exatamente quando o tipo aponta pra um registro.
    const clienteId = args.tipo === TipoVinculoNome.OBRA ? args.clienteId ?? null : null;
    const materialId = args.tipo === TipoVinculoNome.MATERIAL ? args.materialId ?? null : null;
    if (args.tipo === TipoVinculoNome.OBRA) {
      if (!clienteId) throw new BadRequestException("Escolha a obra.");
      const existe = await this.prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
      if (!existe) throw new NotFoundException("Obra não encontrada.");
    }
    if (args.tipo === TipoVinculoNome.MATERIAL) {
      if (!materialId) throw new BadRequestException("Escolha o material.");
      const existe = await this.prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
      if (!existe) throw new NotFoundException("Material não encontrado.");
    }

    const dados = {
      nomeLido: args.nomeLido.trim(),
      tipo: args.tipo,
      clienteId,
      materialId,
      criadoPorId: args.usuario.id,
      criadoPorNome: args.usuario.nome,
      viagemOrigemId: args.viagemOrigemId ?? null,
      criadoEm: new Date(),
    };
    // findFirst + update/create em vez de upsert: o unique composto inclui o
    // `contaId`, que a trava do Prisma carimba sozinha e o código não conhece.
    const atual = await this.prisma.vinculoNomeTicket.findFirst({
      where: { campo: args.campo, nomeNormalizado },
      select: { id: true },
    });
    try {
      return atual
        ? await this.prisma.vinculoNomeTicket.update({ where: { id: atual.id }, data: dados })
        : await this.prisma.vinculoNomeTicket.create({
            data: { campo: args.campo, nomeNormalizado, ...dados },
          });
    } catch (err) {
      // Duas pessoas vinculando o mesmo nome no mesmo segundo: vence a primeira.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BadRequestException("Alguém acabou de vincular esse nome. Recarregue a viagem.");
      }
      throw err;
    }
  }

  /**
   * As conferências cujo nome lido bate com este — pra reavaliar de graça as
   * viagens que estavam paradas esperando justamente esse vínculo.
   */
  async conferenciasComNome(campo: CampoVinculo, nomeLido: string): Promise<string[]> {
    const norm = normalizarTexto(nomeLido);
    const chave = campo === "cliente" ? "clienteNome" : "materialNome";
    const candidatas = await this.prisma.conferenciaTicket.findMany({
      where: { status: "CONCLUIDA", veredito: "INCERTO" },
      select: { viagemId: true, leitura: true },
    });
    return [
      ...new Set(
        candidatas
          .filter((c) => {
            const v = (c.leitura as Record<string, unknown> | null)?.[chave];
            return typeof v === "string" && normalizarTexto(v) === norm;
          })
          .map((c) => c.viagemId),
      ),
    ];
  }
}
