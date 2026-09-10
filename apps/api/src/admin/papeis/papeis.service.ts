import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CriarPapelInput,
  AtualizarPapelInput,
  CriarPapelDoModeloInput,
} from "@ronan/shared-types";
import { comoSistema, contaIdAtual } from "../../common/conta/conta-context";
import { acimaDoTeto, tetoDaConta } from "../../common/conta/teto-da-conta";
import { PrismaService } from "../../prisma/prisma.service";
import { PAPEL_ADMIN } from "../permissoes/permissoes.service";

@Injectable()
export class PapeisService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const papeis = await this.prisma.papel.findMany({
      orderBy: [{ sistema: "desc" }, { nome: "asc" }],
      include: { _count: { select: { usuarios: true } } },
    });
    return papeis.map(({ _count, ...p }) => ({ ...p, usuarios: _count.usuarios }));
  }

  findOne(id: string) {
    return this.prisma.papel.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Impede que uma empresa conceda a si mesma o que está acima do teto dela.
   *
   * Esconder o menu não basta: o admin da empresa tem `permissoes.gerenciar` (ele
   * monta os papéis da equipe dele), e sem esta trava bastaria criar um papel com
   * `whatsapp.gerenciar` e se atribuir — chegando na instância de WhatsApp que
   * todas as empresas dividem. O painel chama a API direto do navegador, então a
   * regra tem que morar aqui, não na tela.
   *
   * O teto sai de `tetoDaConta`: normalmente `PERMISSOES_ADMIN_EMPRESA`, mas a
   * plataforma pode abrir ou fechar caso a caso. A casa passa livre porque o
   * teto dela é o catálogo inteiro.
   */
  private async recusarAcimaDoTeto(chaves: string[] | undefined): Promise<void> {
    if (!chaves || chaves.length === 0) return;

    const teto = await tetoDaConta(this.prisma, contaIdAtual());
    const proibidas = acimaDoTeto(chaves, teto);
    if (proibidas.length === 0) return;

    throw new BadRequestException(
      `Estas permissões não estão liberadas para esta empresa: ${proibidas.join(", ")}.`,
    );
  }

  /** Os modelos publicados pela plataforma que a empresa pode copiar. */
  async listarModelos() {
    const [modelos, teto] = await Promise.all([
      comoSistema(() =>
        this.prisma.papelModelo.findMany({
          where: { ativo: true },
          orderBy: { nome: "asc" },
          select: { id: true, nome: true, descricao: true, permissoes: true },
        }),
      ),
      tetoDaConta(this.prisma, contaIdAtual()),
    ]);

    // Cada modelo já vai com o que ele REALMENTE vale nesta empresa. Um modelo
    // pode citar chave que esta empresa não tem liberada, e a tela precisa
    // mostrar o que vai acontecer de verdade em vez de prometer o que o modelo
    // diz e entregar menos depois de copiar.
    return modelos.map((m) => {
      const aplicaveis = m.permissoes.filter((c) => teto.has(c));
      return {
        id: m.id,
        nome: m.nome,
        descricao: m.descricao,
        permissoes: aplicaveis,
        /** Quantas chaves do modelo esta empresa não pode receber. */
        foraDoTeto: m.permissoes.length - aplicaveis.length,
      };
    });
  }

  /**
   * Cria um papel da empresa a partir de um modelo da plataforma.
   *
   * A cópia é filtrada pelo teto da empresa — é o que deixa um modelo servir a
   * todas sem ser perigoso: ele pode citar uma chave que só alguns clientes têm
   * liberada, e cada empresa recebe a parte que lhe cabe.
   *
   * Daqui pra frente o papel é dela: editar não afeta o modelo, e mexer no
   * modelo não afeta ela. `modeloId` fica só como rastro de origem.
   */
  async criarDoModelo(input: CriarPapelDoModeloInput) {
    const modelo = await comoSistema(() =>
      this.prisma.papelModelo.findUnique({ where: { id: input.modeloId } }),
    );
    if (!modelo || !modelo.ativo) throw new NotFoundException("Modelo de papel não encontrado.");

    const nome = (input.nome ?? modelo.nome).trim();
    const existe = await this.prisma.papel.findFirst({ where: { nome } });
    if (existe) {
      throw new ConflictException(
        `Já existe um papel chamado "${nome}" aqui. Escolha outro nome para a cópia.`,
      );
    }

    const teto = await tetoDaConta(this.prisma, contaIdAtual());
    return this.prisma.papel.create({
      data: {
        nome,
        descricao: modelo.descricao,
        permissoes: modelo.permissoes.filter((c) => teto.has(c)),
        sistema: false,
        modeloId: modelo.id,
      },
    });
  }

  async create(input: CriarPapelInput) {
    await this.recusarAcimaDoTeto(input.permissoes);
    const existe = await this.prisma.papel.findFirst({ where: { nome: input.nome } });
    if (existe) throw new ConflictException("Já existe um papel com esse nome.");
    return this.prisma.papel.create({
      data: {
        nome: input.nome,
        descricao: input.descricao,
        permissoes: input.permissoes ?? [],
        sistema: false,
      },
    });
  }

  async update(id: string, input: AtualizarPapelInput) {
    const papel = await this.prisma.papel.findUnique({ where: { id } });
    if (!papel) throw new NotFoundException("Papel não encontrado");
    // Administrador é o super-papel (sempre todas as permissões) — não editável.
    if (papel.nome === PAPEL_ADMIN) {
      throw new BadRequestException("O papel Administrador não pode ser editado.");
    }
    if (input.nome && input.nome !== papel.nome) {
      const existe = await this.prisma.papel.findFirst({ where: { nome: input.nome } });
      if (existe) throw new ConflictException("Já existe um papel com esse nome.");
    }
    await this.recusarAcimaDoTeto(input.permissoes);
    return this.prisma.papel.update({
      where: { id },
      data: {
        nome: input.nome,
        descricao: input.descricao,
        permissoes: input.permissoes,
      },
    });
  }

  async remove(id: string) {
    const papel = await this.prisma.papel.findUnique({
      where: { id },
      include: { _count: { select: { usuarios: true } } },
    });
    if (!papel) throw new NotFoundException("Papel não encontrado");
    if (papel.sistema) throw new BadRequestException("Papéis do sistema não podem ser excluídos.");
    if (papel._count.usuarios > 0) {
      throw new BadRequestException(
        `Há ${papel._count.usuarios} usuário(s) com este papel. Troque o papel deles antes de excluir.`,
      );
    }
    return this.prisma.papel.delete({ where: { id } });
  }
}
