import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria, Prisma } from "@prisma/client";
import {
  CAMPOS_PADRAO,
  normalizarNomeTipo,
  nomeReservadoTipoDespesa,
  slugDoNomeTipo,
  SLUG_TIPO_OUTRO,
  type AtualizarTipoDespesaInput,
  type CriarTipoDespesaInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";

const dec = (v: number | null | undefined) =>
  v == null ? null : new Prisma.Decimal(v.toFixed(2));

/** Mensagem do nome reservado — diz POR QUE, e pra onde ir. */
export function erroNomeReservado(nome: string): string | null {
  const r = nomeReservadoTipoDespesa(nome);
  if (!r) return null;
  const onde: Record<string, string> = {
    pedagio: "Pedágio já tem lançamento próprio no app.",
    diesel: "Combustível já tem lançamento próprio no app (Abastecimento).",
    arla: "ARLA entra pelo Abastecimento, que já tem lançamento próprio.",
    abastecimento: "Abastecimento já tem lançamento próprio no app.",
    combustivel: "Combustível já tem lançamento próprio no app (Abastecimento).",
    multa: "Multa tem cadastro e desconto próprios, em Manutenção › Multas.",
    estadia: "Estadia é cobrança ao cliente, não gasto do motorista.",
    diaria: "Diária ficou fora por decisão da empresa (foi removida do sistema).",
  };
  return `Esse nome não pode virar tipo de gasto. ${onde[r]} Virar tipo aqui pagaria o mesmo dinheiro por dois caminhos.`;
}

/**
 * Os tipos de gasto DA EMPRESA (aba "Tipos de gasto").
 *
 * Nunca apaga: só desativa (um gasto pode chegar do celular dias depois com o
 * id antigo). O slug é imutável; o nome se edita. "Outro" é a válvula: não
 * desativa e fica sempre por último.
 */
@Injectable()
export class TiposDespesaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async list() {
    const tipos = await this.prisma.tipoDespesa.findMany({
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      include: { _count: { select: { despesas: true } } },
    });
    return tipos.map(({ _count, ...t }) => ({
      ...t,
      aprovaSozinhoAte: t.aprovaSozinhoAte?.toFixed(2) ?? null,
      devolveNoMaximo: t.devolveNoMaximo?.toFixed(2) ?? null,
      totalGastos: _count.despesas,
    }));
  }

  private async exigirNomeLivre(nome: string, ignorarId?: string) {
    const erro = erroNomeReservado(nome);
    if (erro) throw new BadRequestException({ code: "NOME_RESERVADO", message: erro });
    const alvo = normalizarNomeTipo(nome);
    const todos = await this.prisma.tipoDespesa.findMany({ select: { id: true, nome: true } });
    if (todos.some((t) => t.id !== ignorarId && normalizarNomeTipo(t.nome) === alvo)) {
      throw new ConflictException(`Já existe um tipo de gasto chamado "${nome}".`);
    }
  }

  async criar(input: CriarTipoDespesaInput, usuarioId: string) {
    await this.exigirNomeLivre(input.nome);
    const existentes = await this.prisma.tipoDespesa.findMany({ select: { slug: true, ordem: true } });
    const slugs = new Set(existentes.map((t) => t.slug));
    const base = slugDoNomeTipo(input.nome);
    let slug = base;
    for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;

    // Entra antes do "Outro", que é sempre o último.
    const outro = existentes.find((t) => t.slug === SLUG_TIPO_OUTRO);
    const maxSemOutro = Math.max(0, ...existentes.filter((t) => t.slug !== SLUG_TIPO_OUTRO).map((t) => t.ordem));
    const ordem = maxSemOutro + 10;

    const tipo = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.tipoDespesa.create({
        data: {
          slug,
          nome: input.nome.trim(),
          icone: input.icone ?? null,
          devolve: input.devolve,
          aprovaSozinhoAte: dec(input.aprovaSozinhoAte),
          devolveNoMaximo: dec(input.devolveNoMaximo),
          manutencao: input.manutencao,
          podeCobrarCliente: input.podeCobrarCliente,
          campos: (input.campos ?? CAMPOS_PADRAO) as unknown as Prisma.InputJsonValue,
          ordem,
        },
      });
      if (outro && outro.ordem <= ordem) {
        await tx.tipoDespesa.updateMany({ where: { slug: SLUG_TIPO_OUTRO }, data: { ordem: ordem + 10 } });
      }
      return criado;
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "TipoDespesa",
      entidadeId: tipo.id,
      acao: AcaoAuditoria.UPDATE,
      motivo: "Tipo de gasto criado",
    });
    return tipo;
  }

  async atualizar(id: string, input: AtualizarTipoDespesaInput, usuarioId: string) {
    const atual = await this.prisma.tipoDespesa.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException("Tipo de gasto não encontrado.");
    if (input.nome !== undefined && normalizarNomeTipo(input.nome) !== normalizarNomeTipo(atual.nome)) {
      await this.exigirNomeLivre(input.nome, id);
    }
    if (atual.slug === SLUG_TIPO_OUTRO && input.ativo === false) {
      throw new BadRequestException(
        'O tipo "Outro" não se desativa: é por onde o motorista lança o que não cabe nos outros.',
      );
    }
    const mudouCampos =
      input.campos !== undefined && JSON.stringify(input.campos) !== JSON.stringify(atual.campos);

    const tipo = await this.prisma.tipoDespesa.update({
      where: { id },
      data: {
        ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}),
        ...(input.icone !== undefined ? { icone: input.icone } : {}),
        ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
        ...(input.devolve !== undefined ? { devolve: input.devolve } : {}),
        ...(input.aprovaSozinhoAte !== undefined ? { aprovaSozinhoAte: dec(input.aprovaSozinhoAte) } : {}),
        ...(input.devolveNoMaximo !== undefined ? { devolveNoMaximo: dec(input.devolveNoMaximo) } : {}),
        ...(input.manutencao !== undefined ? { manutencao: input.manutencao } : {}),
        ...(input.podeCobrarCliente !== undefined ? { podeCobrarCliente: input.podeCobrarCliente } : {}),
        ...(mudouCampos
          ? { campos: input.campos as unknown as Prisma.InputJsonValue, camposVersao: { increment: 1 } }
          : {}),
      },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "TipoDespesa",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      valorAntes: atual,
      valorDepois: tipo,
    });
    return tipo;
  }

  /** A ordem do celular. "Outro" vai sempre pro fim, mesmo que venha no meio. */
  async reordenar(ids: string[]) {
    const tipos = await this.prisma.tipoDespesa.findMany({ select: { id: true, slug: true } });
    const existentes = new Set(tipos.map((t) => t.id));
    const outroId = tipos.find((t) => t.slug === SLUG_TIPO_OUTRO)?.id;
    const ordem = ids.filter((i) => existentes.has(i) && i !== outroId);
    // Quem não veio na lista mantém a posição relativa, depois dos que vieram.
    for (const t of tipos) if (!ordem.includes(t.id) && t.id !== outroId) ordem.push(t.id);
    if (outroId) ordem.push(outroId);
    await this.prisma.$transaction(
      ordem.map((id, i) => this.prisma.tipoDespesa.update({ where: { id }, data: { ordem: (i + 1) * 10 } })),
    );
    return this.list();
  }
}
