import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria, Prisma } from "@prisma/client";
import type {
  AtualizarRegraSobretaxaInput,
  CriarRegraSobretaxaInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";

const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Cadastro da sobretaxa de combustível do cliente pagador. A conta e o uso na
 * fatura moram em `common/sobretaxa-combustivel.ts` e no `FinanceiroService`.
 *
 * Ligar, desligar e mexer nos números vai pra auditoria: cada mudança aqui
 * mexe no valor da próxima fatura, e "quem ligou isso?" é a primeira pergunta
 * quando o cliente reclamar.
 */
@Injectable()
export class SobretaxaCombustivelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  list(empresaId: string) {
    return this.prisma.regraSobretaxaCombustivel.findMany({
      where: { empresaId },
      orderBy: [{ ativo: "desc" }, { vigenciaDe: "desc" }],
    });
  }

  async create(input: CriarRegraSobretaxaInput, usuarioId: string) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id: input.empresaId }, select: { id: true } });
    if (!empresa) throw new BadRequestException("Cliente não encontrado.");
    if (input.ativo) {
      await this.recusarSobreposicao(input.empresaId, input.vigenciaDe, input.vigenciaAte ?? null, null);
    }
    const criada = await this.prisma.regraSobretaxaCombustivel.create({
      data: {
        empresaId: input.empresaId,
        ativo: input.ativo,
        dieselReferencia: input.dieselReferencia,
        gatilho: input.gatilho,
        percentualPorPasso: input.percentualPorPasso,
        tetoPercentual: input.tetoPercentual ?? null,
        vigenciaDe: dia(input.vigenciaDe),
        vigenciaAte: input.vigenciaAte ? dia(input.vigenciaAte) : null,
        criadoPorId: usuarioId,
      },
    });
    await this.auditar(criada.id, usuarioId, null, criada, "Regra de sobretaxa de combustível criada");
    return criada;
  }

  async update(id: string, input: AtualizarRegraSobretaxaInput, usuarioId: string) {
    const atual = await this.prisma.regraSobretaxaCombustivel.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException("Regra não encontrada");

    const ativo = input.ativo ?? atual.ativo;
    const vigenciaDe = input.vigenciaDe ?? iso(atual.vigenciaDe)!;
    const vigenciaAte = input.vigenciaAte !== undefined ? input.vigenciaAte : iso(atual.vigenciaAte);
    if (vigenciaAte != null && vigenciaAte < vigenciaDe) {
      throw new BadRequestException("O fim da vigência não pode ser antes do início.");
    }
    if (ativo) await this.recusarSobreposicao(atual.empresaId, vigenciaDe, vigenciaAte ?? null, id);

    const data: Prisma.RegraSobretaxaCombustivelUpdateInput = {};
    if (input.ativo !== undefined) data.ativo = input.ativo;
    if (input.dieselReferencia !== undefined) data.dieselReferencia = input.dieselReferencia;
    if (input.gatilho !== undefined) data.gatilho = input.gatilho;
    if (input.percentualPorPasso !== undefined) data.percentualPorPasso = input.percentualPorPasso;
    if (input.tetoPercentual !== undefined) data.tetoPercentual = input.tetoPercentual;
    if (input.vigenciaDe !== undefined) data.vigenciaDe = dia(input.vigenciaDe);
    if (input.vigenciaAte !== undefined) data.vigenciaAte = input.vigenciaAte ? dia(input.vigenciaAte) : null;

    const nova = await this.prisma.regraSobretaxaCombustivel.update({ where: { id }, data });
    const motivo =
      input.ativo === true && !atual.ativo
        ? "Sobretaxa de combustível LIGADA"
        : input.ativo === false && atual.ativo
          ? "Sobretaxa de combustível desligada"
          : "Regra de sobretaxa de combustível alterada";
    await this.auditar(id, usuarioId, atual, nova, motivo);
    return nova;
  }

  async remove(id: string, usuarioId: string) {
    const atual = await this.prisma.regraSobretaxaCombustivel.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException("Regra não encontrada");
    // Fatura já emitida guarda os números na própria linha (`FaturaLinha.sobretaxa`):
    // apagar a regra não muda nada do que já foi cobrado.
    await this.prisma.regraSobretaxaCombustivel.delete({ where: { id } });
    await this.auditar(id, usuarioId, atual, null, "Regra de sobretaxa de combustível apagada", AcaoAuditoria.DELETE);
    return { ok: true };
  }

  /**
   * Duas regras LIGADAS com vigência cruzada deixariam a fatura sem saber qual
   * percentual vale. Desligada pode sobrepor à vontade — é rascunho.
   */
  private async recusarSobreposicao(empresaId: string, de: string, ate: string | null, ignorarId: string | null) {
    const conflito = await this.prisma.regraSobretaxaCombustivel.findFirst({
      where: {
        empresaId,
        ativo: true,
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
        ...(ate ? { vigenciaDe: { lte: dia(ate) } } : {}),
        OR: [{ vigenciaAte: null }, { vigenciaAte: { gte: dia(de) } }],
      },
      select: { vigenciaDe: true, vigenciaAte: true },
    });
    if (conflito) {
      const fmt = (d: Date) => iso(d)!.split("-").reverse().join("/");
      const periodo = conflito.vigenciaAte
        ? `de ${fmt(conflito.vigenciaDe)} a ${fmt(conflito.vigenciaAte)}`
        : `desde ${fmt(conflito.vigenciaDe)}, sem data pra acabar`;
      throw new BadRequestException(
        `Já existe uma sobretaxa ligada pra este cliente ${periodo}. Desligue ou encerre a vigência dela antes.`,
      );
    }
  }

  private auditar(
    id: string,
    usuarioId: string,
    antes: unknown,
    depois: unknown,
    motivo: string,
    acao: AcaoAuditoria = AcaoAuditoria.UPDATE,
  ) {
    return this.auditoria.log({
      usuarioId,
      entidade: "RegraSobretaxaCombustivel",
      entidadeId: id,
      acao,
      motivo,
      valorAntes: antes,
      valorDepois: depois,
    });
  }
}
