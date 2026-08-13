import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { contaIdAtual } from "../../common/conta/conta-context";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { PrismaService } from "../../prisma/prisma.service";

export type CriarCampoInput = {
  slug?: string;
  label: string;
  ordem?: number;
  tipo?: string;
  descricao?: string;
};

export type AtualizarCampoInput = Partial<CriarCampoInput> & { ativo?: boolean };

/**
 * Campos embarcados (sistema=true). Os 5 primeiros são usados em match/comparação
 * pelo processor — não podem ser desativados sem quebrar o fluxo. Os outros são
 * reconhecidos pelo prompt mas não entram na lógica.
 */
const CAMPOS_SISTEMA: { slug: string; label: string; ordem: number; tipo: string; descricao: string }[] = [
  { slug: "data", label: "Data", ordem: 10, tipo: "DATA", descricao: "Data da viagem (chave de match)" },
  { slug: "placa", label: "Placa", ordem: 20, tipo: "TEXTO", descricao: "Placa do veículo (chave de match)" },
  { slug: "ticket", label: "Ticket", ordem: 30, tipo: "TEXTO", descricao: "Número do ticket (chave de match)" },
  { slug: "toneladas", label: "Toneladas", ordem: 40, tipo: "NUMERO", descricao: "Toneladas transportadas (entra em comparação)" },
  { slug: "km", label: "Km", ordem: 50, tipo: "NUMERO", descricao: "Quilômetros rodados (entra em comparação)" },
  { slug: "cliente", label: "Cliente", ordem: 60, tipo: "TEXTO", descricao: "Nome do cliente (referência, não comparado)" },
  { slug: "material", label: "Material", ordem: 70, tipo: "TEXTO", descricao: "Material transportado (referência)" },
  { slug: "fornecedor", label: "Fornecedor", ordem: 80, tipo: "TEXTO", descricao: "Fornecedor da carga (referência)" },
  { slug: "unidade", label: "Unidade", ordem: 90, tipo: "TEXTO", descricao: "Unidade de medida (TON, M3, etc)" },
  { slug: "valor_unitario", label: "Valor unitário", ordem: 100, tipo: "NUMERO", descricao: "Preço por unidade (referência)" },
  { slug: "valor_total", label: "Valor total", ordem: 110, tipo: "NUMERO", descricao: "Total em R$ da linha (referência)" },
  { slug: "praca_pedagio", label: "Praça de pedágio", ordem: 120, tipo: "TEXTO", descricao: "Praça onde foi pago o pedágio" },
  { slug: "eixos", label: "Eixos", ordem: 130, tipo: "NUMERO", descricao: "Quantidade de eixos do veículo (pedágio)" },
  { slug: "ignorar", label: "— Ignorar —", ordem: 999, tipo: "TEXTO", descricao: "Marca a coluna pra ser ignorada na importação" },
];

@Injectable()
export class CamposLayoutService implements OnModuleInit {
  private readonly log = new Logger(CamposLayoutService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Cada empresa tem a sua cópia dos campos de sistema — ela pode desativar e
    // renomear os dela sem mexer nos da outra.
    await paraCadaConta(this.prisma, () => this.seedCamposSistema());
  }

  /**
   * Cria/atualiza os campos de sistema na tabela. Idempotente.
   * Atualiza label/ordem/tipo/descricao se diferentes (drift control).
   */
  async seedCamposSistema() {
    const contaId = contaIdAtual();
    try {
      for (const campo of CAMPOS_SISTEMA) {
        await this.prisma.campoLayout.upsert({
          where: { contaId_slug: { contaId, slug: campo.slug } },
          create: { ...campo, sistema: true, ativo: true },
          update: {
            label: campo.label,
            ordem: campo.ordem,
            tipo: campo.tipo,
            descricao: campo.descricao,
            sistema: true,
          },
        });
      }
      this.log.log(`Campos de layout sistema sincronizados (${CAMPOS_SISTEMA.length})`);
    } catch (err) {
      this.log.warn(`Falha ao sincronizar campos sistema: ${(err as Error).message}`);
    }
  }

  list() {
    return this.prisma.campoLayout.findMany({
      orderBy: [{ ativo: "desc" }, { ordem: "asc" }, { label: "asc" }],
    });
  }

  async findOne(id: string) {
    const campo = await this.prisma.campoLayout.findUnique({ where: { id } });
    if (!campo) throw new NotFoundException("Campo não encontrado");
    return campo;
  }

  /** Lista apenas slugs ativos — usado pelo IaService pra montar o prompt. */
  async listarSlugsAtivos() {
    return this.prisma.campoLayout.findMany({
      where: { ativo: true },
      select: { slug: true, label: true, descricao: true, sistema: true, tipo: true },
      orderBy: { ordem: "asc" },
    });
  }

  /** Valida que o slug existe e está ativo. Usado pra validar mapeamentos salvos. */
  async slugExisteAtivo(slug: string): Promise<boolean> {
    const count = await this.prisma.campoLayout.count({
      where: { slug, ativo: true },
    });
    return count > 0;
  }

  async create(data: CriarCampoInput) {
    const slug = normalizarSlug(data.slug ?? data.label);
    if (!slug) throw new BadRequestException("Slug inválido — use letras, números, _, -");
    const exists = await this.prisma.campoLayout.findFirst({ where: { slug } });
    if (exists) throw new ConflictException(`Já existe campo com slug "${slug}"`);
    return this.prisma.campoLayout.create({
      data: {
        slug,
        label: data.label,
        ordem: data.ordem ?? 100,
        tipo: data.tipo ?? "TEXTO",
        descricao: data.descricao,
        sistema: false,
        ativo: true,
      },
    });
  }

  async update(id: string, data: AtualizarCampoInput) {
    const campo = await this.prisma.campoLayout.findUnique({ where: { id } });
    if (!campo) throw new NotFoundException("Campo não encontrado");

    // Em campo sistema só permitimos label, ordem, descricao e ativo
    const updateData: Prisma.CampoLayoutUpdateInput = {};
    if (data.label !== undefined) updateData.label = data.label;
    if (data.ordem !== undefined) updateData.ordem = data.ordem;
    if (data.descricao !== undefined) updateData.descricao = data.descricao;
    if (data.ativo !== undefined) updateData.ativo = data.ativo;

    if (!campo.sistema) {
      // Custom: pode mudar slug e tipo também
      if (data.slug !== undefined) {
        const novoSlug = normalizarSlug(data.slug);
        if (!novoSlug) throw new BadRequestException("Slug inválido");
        if (novoSlug !== campo.slug) {
          const conflito = await this.prisma.campoLayout.findFirst({ where: { slug: novoSlug } });
          if (conflito) throw new ConflictException(`Já existe campo com slug "${novoSlug}"`);
          updateData.slug = novoSlug;
        }
      }
      if (data.tipo !== undefined) updateData.tipo = data.tipo;
    }

    return this.prisma.campoLayout.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    const campo = await this.prisma.campoLayout.findUnique({ where: { id } });
    if (!campo) throw new NotFoundException("Campo não encontrado");
    if (campo.sistema) {
      throw new UnprocessableEntityException(
        "Campo de sistema não pode ser deletado. Pra desativar, use o toggle.",
      );
    }
    // Verifica se alguma empresa usa esse slug no layoutImport
    const empresasUsando = await this.empresasUsandoSlug(campo.slug);
    if (empresasUsando.length > 0) {
      throw new UnprocessableEntityException(
        `Esse campo está sendo usado por ${empresasUsando.length} empresa(s): ${empresasUsando.map((e) => e.nome).join(", ")}. Atualize o layout dessas empresas antes de deletar.`,
      );
    }
    return this.prisma.campoLayout.delete({ where: { id } });
  }

  /**
   * Lista empresas cujo `layoutImport.colunas[].campo` contém o slug.
   * Usado pra validar delete e pra avisos.
   */
  private async empresasUsandoSlug(slug: string) {
    // Busca todas as empresas e filtra no app (Prisma não tem operador "not null"
    // simples pra Json em todas as versões; volume é baixo, OK).
    const empresas = await this.prisma.empresa.findMany({
      select: { id: true, nome: true, layoutImport: true },
    });
    return empresas.filter((e) => {
      const layout = e.layoutImport as { colunas?: { campo?: string }[] } | null;
      if (!layout?.colunas) return false;
      return layout.colunas.some((c) => c.campo === slug);
    });
  }
}

/**
 * Normaliza string em slug: lowercase, remove acentos, troca espaços por _,
 * mantém apenas [a-z0-9_-].
 */
function normalizarSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira acentos
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^_+|_+$/g, "");
}
