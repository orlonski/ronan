import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AcaoAuditoria,
  FonteFechamento,
  Prisma,
  StatusFechamento,
} from "@prisma/client";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { aplicarMinimos, resolverRegraMinimo } from "../common/viagem-minimos";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { FechamentoProcessorService } from "./fechamento-processor.service";
import { paginate, type PaginationQuery } from "../common/pagination";
import { SEM_ESCOPO } from "../common/escopo/escopo";

type ListFechamentosParams = PaginationQuery & {
  empresaId?: string;
  status?: StatusFechamento;
  incluirSubstituidos?: "true" | "false";
};

const FECHAMENTO_INCLUDE = {
  empresa: { select: { id: true, nome: true } },
  substituidoPor: { select: { id: true, versao: true, criadoEm: true } },
  substitui: { select: { id: true, versao: true, criadoEm: true } },
  criadoPor: { select: { id: true, nome: true } },
  envios: {
    orderBy: { geradoEm: "desc" as const },
    include: {
      geradoPor: { select: { id: true, nome: true } },
      layout: { select: { id: true, nome: true } },
    },
  },
} satisfies Prisma.FechamentoInclude;

const LINHA_INCLUDE = {
  viagemMatch: {
    select: {
      id: true,
      data: true,
      ticket: true,
      km: true,
      toneladas: true,
      veiculo: { select: { placa: true } },
      motorista: { select: { nome: true } },
      cliente: { select: { nome: true, empresaId: true, toneladasMinimas: true, kmMinimos: true } },
      material: { select: { id: true, nome: true } },
    },
  },
  resolvidoPor: { select: { id: true, nome: true } },
} satisfies Prisma.FechamentoLinhaInclude;

@Injectable()
export class FechamentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly processor: FechamentoProcessorService,
    private readonly auditoria: AuditoriaService,
  ) {}

  list(params: ListFechamentosParams) {
    const where: Prisma.FechamentoWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.status) where.status = params.status;
    if (params.incluirSubstituidos !== "true") {
      where.status = params.status
        ? params.status
        : { not: StatusFechamento.SUBSTITUIDO };
    }

    return paginate(this.prisma.fechamento, {
      params,
      where: where as Record<string, unknown>,
      // Model sem coluna de frota: não há o que filtrar por transportadora. O
      // isolamento entre EMPRESAS aqui é da trava de conta; o recorte por frota
      // fica com a matriz de papéis (não existe guard de escopo — ver escopo.ts).
      escopo: SEM_ESCOPO,
      searchFields: ["arquivoOriginalNome", "empresa.nome"],
      sortable: {
        criadoEm: "criadoEm",
        periodoInicio: "periodoInicio",
        periodoFim: "periodoFim",
        status: "status",
        empresa: "empresa.nome",
        versao: "versao",
      },
      defaultSort: { field: "criadoEm", order: "desc" },
      include: {
        empresa: { select: { id: true, nome: true } },
        criadoPor: { select: { id: true, nome: true } },
        _count: { select: { linhas: true, envios: true } },
      },
    });
  }

  async detalhe(id: string) {
    const fechamento = await this.prisma.fechamento.findUnique({
      where: { id },
      include: {
        ...FECHAMENTO_INCLUDE,
        _count: { select: { linhas: true } },
      },
    });
    if (!fechamento) throw new NotFoundException("Fechamento não encontrado");
    return fechamento;
  }

  async linhas(fechamentoId: string, status?: string, tipo?: string) {
    const where: Prisma.FechamentoLinhaWhereInput = { fechamentoId };
    if (status) {
      where.status = status as Prisma.EnumStatusLinhaFechamentoFilter["equals"];
    }
    if (tipo && ["VIAGEM", "PEDAGIO", "COMBUSTIVEL"].includes(tipo)) {
      where.tipo = tipo as Prisma.EnumTipoBlocoFechamentoFilter["equals"];
    }
    const linhas = await this.prisma.fechamentoLinha.findMany({
      where,
      include: LINHA_INCLUDE,
      orderBy: { ordem: "asc" },
    });
    const regras = await this.prisma.regraMinimo.findMany({ where: { ativo: true } });
    return linhas.map((l) => ({
      ...l,
      viagemMatch: l.viagemMatch
        ? {
            ...l.viagemMatch,
            ...aplicarMinimos(
              l.viagemMatch,
              // Viagem casada é finalizada; incompleta (EM_ANDAMENTO/AGUARDANDO_PESO) nunca casa.
              resolverRegraMinimo(
                regras,
                l.viagemMatch.cliente?.empresaId ?? "",
                l.viagemMatch.material?.id ?? null,
                l.viagemMatch.km ?? 0,
              ) ?? undefined,
            ),
          }
        : null,
    }));
  }

  /**
   * Cria fechamento + persiste arquivo no MinIO + dispara processamento async.
   */
  async upload(input: {
    usuarioId: string;
    empresaId: string;
    periodoInicio: string;
    periodoFim: string;
    substituirFechamentoId?: string;
    arquivo: { buffer: Buffer; nome: string; mimetype: string };
  }) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: input.empresaId },
    });
    if (!empresa) throw new NotFoundException("Empresa não encontrada");
    if (!empresa.ativa) throw new BadRequestException("Empresa inativa");

    const periodoInicio = new Date(input.periodoInicio);
    const periodoFim = new Date(input.periodoFim);
    if (Number.isNaN(periodoInicio.getTime()) || Number.isNaN(periodoFim.getTime())) {
      throw new BadRequestException("Período inválido");
    }

    let versao = 1;
    let substituidoAnterior: { id: string; versao: number } | null = null;
    if (input.substituirFechamentoId) {
      const anterior = await this.prisma.fechamento.findUnique({
        where: { id: input.substituirFechamentoId },
        select: { id: true, versao: true, empresaId: true, status: true },
      });
      if (!anterior) throw new NotFoundException("Fechamento anterior não encontrado");
      if (anterior.empresaId !== input.empresaId) {
        throw new BadRequestException("Fechamento anterior é de outra empresa");
      }
      if (anterior.status === StatusFechamento.SUBSTITUIDO) {
        throw new ConflictException("Esse fechamento já foi substituído");
      }
      versao = anterior.versao + 1;
      substituidoAnterior = { id: anterior.id, versao: anterior.versao };
    }

    const arquivoKey = await this.uploads.putFechamentoOriginal(
      input.arquivo.buffer,
      input.arquivo.nome,
      input.arquivo.mimetype,
    );

    const novo = await this.prisma.fechamento.create({
      data: {
        empresaId: input.empresaId,
        periodoInicio,
        periodoFim,
        fonte: FonteFechamento.UPLOAD,
        arquivoOriginalKey: arquivoKey,
        arquivoOriginalNome: input.arquivo.nome,
        arquivoMimetype: input.arquivo.mimetype,
        versao,
        status: StatusFechamento.RECEBIDO,
        criadoPorId: input.usuarioId,
      },
      include: FECHAMENTO_INCLUDE,
    });

    await this.auditoria.log({
      usuarioId: input.usuarioId,
      entidade: "Fechamento",
      entidadeId: novo.id,
      acao: AcaoAuditoria.UPDATE,
      campo: "criacao",
      valorDepois: {
        empresa: empresa.nome,
        periodo: `${input.periodoInicio} a ${input.periodoFim}`,
        arquivo: input.arquivo.nome,
        versao,
      },
    });

    if (substituidoAnterior) {
      // marca anterior e copia anotações relevantes
      await this.prisma.fechamento.update({
        where: { id: substituidoAnterior.id },
        data: {
          status: StatusFechamento.SUBSTITUIDO,
          substituidoPorId: novo.id,
        },
      });
      await this.auditoria.log({
        usuarioId: input.usuarioId,
        entidade: "Fechamento",
        entidadeId: substituidoAnterior.id,
        acao: AcaoAuditoria.SUBSTITUIR,
        motivo: `Substituído pela versão ${versao}`,
        metadata: { novoFechamentoId: novo.id },
      });
    }

    // dispara processamento sem bloquear resposta
    void this.processor.processar(novo.id, input.usuarioId).catch(() => {
      // erros são logados dentro do processor
    });

    return novo;
  }

  async resolverLinha(input: {
    usuarioId: string;
    fechamentoId: string;
    linhaId: string;
    acao: "aceitar_sugestao" | "escolher_viagem" | "erro_cliente" | "criar_retroativa";
    viagemId?: string;
    motivo?: string;
  }) {
    const linha = await this.prisma.fechamentoLinha.findUnique({
      where: { id: input.linhaId },
      include: { fechamento: true },
    });
    if (!linha || linha.fechamentoId !== input.fechamentoId) {
      throw new NotFoundException("Linha não encontrada");
    }

    let viagemFinalId: string | null = linha.viagemMatchId;
    let novaSugestao = linha.sugestaoIa as { viagemId?: string } | null;
    let auditEntries: { acao: AcaoAuditoria; motivo: string }[] = [];

    switch (input.acao) {
      case "aceitar_sugestao":
        if (!novaSugestao?.viagemId) {
          throw new BadRequestException("Linha não tem sugestão da IA pra aceitar");
        }
        viagemFinalId = novaSugestao.viagemId;
        auditEntries.push({
          acao: AcaoAuditoria.MATCH_IA,
          motivo: input.motivo ?? "Operadora aceitou sugestão da IA",
        });
        break;
      case "escolher_viagem":
        if (!input.viagemId) throw new BadRequestException("viagemId obrigatório");
        viagemFinalId = input.viagemId;
        auditEntries.push({
          acao: AcaoAuditoria.RESOLVER,
          motivo: input.motivo ?? "Operadora associou linha a uma viagem manualmente",
        });
        break;
      case "erro_cliente":
        viagemFinalId = null;
        auditEntries.push({
          acao: AcaoAuditoria.RESOLVER,
          motivo: input.motivo ?? "Marcado como erro do cliente",
        });
        break;
      case "criar_retroativa":
        // apenas marca; criação da viagem retroativa fica num endpoint à parte
        auditEntries.push({
          acao: AcaoAuditoria.RESOLVER,
          motivo: input.motivo ?? "Marcado para criar viagem retroativa",
        });
        break;
    }

    const atualizada = await this.prisma.fechamentoLinha.update({
      where: { id: linha.id },
      data: {
        status: "RESOLVIDA_OPERADORA",
        viagemMatchId: viagemFinalId,
        resolvidoPorId: input.usuarioId,
        resolvidoEm: new Date(),
        motivoResolucao: input.motivo ?? null,
      },
      include: LINHA_INCLUDE,
    });

    for (const e of auditEntries) {
      await this.auditoria.log({
        usuarioId: input.usuarioId,
        entidade: "FechamentoLinha",
        entidadeId: linha.id,
        acao: e.acao,
        motivo: e.motivo,
        metadata: { viagemFinalId },
      });
    }

    if (viagemFinalId) {
      await this.prisma.viagem.update({
        where: { id: viagemFinalId },
        data: { status: "AJUSTADA" },
      });
      await this.auditoria.log({
        usuarioId: input.usuarioId,
        entidade: "Viagem",
        entidadeId: viagemFinalId,
        acao: AcaoAuditoria.RESOLVER,
        motivo: input.motivo ?? "Vinculada a fechamento",
        metadata: { fechamentoLinhaId: linha.id },
      });
    }

    // verifica se ainda tem divergência pendente; se não, fecha
    await this.atualizarStatusGlobal(input.fechamentoId);

    return atualizada;
  }

  private async atualizarStatusGlobal(fechamentoId: string) {
    const pendentes = await this.prisma.fechamentoLinha.count({
      where: {
        fechamentoId,
        status: { in: ["DIVERGENCIA", "FALTANDO", "EXTRA"] },
      },
    });
    const novoStatus =
      pendentes === 0 ? StatusFechamento.CONFERIDO : StatusFechamento.AGUARDANDO_REVISAO;
    await this.prisma.fechamento.update({
      where: { id: fechamentoId },
      data: { status: novoStatus },
    });
  }

  async reprocessar(
    fechamentoId: string,
    usuarioId: string,
    tipos?: ("VIAGEM" | "PEDAGIO" | "COMBUSTIVEL")[],
  ) {
    const f = await this.prisma.fechamento.findUnique({ where: { id: fechamentoId } });
    if (!f) throw new NotFoundException("Fechamento não encontrado");
    void this.processor.processar(fechamentoId, usuarioId, tipos).catch(() => {});
    return { ok: true, tipos: tipos ?? "todos" };
  }

  /**
   * Hard delete. Bloqueado se há envio com status ENVIADO. Envios em GERADO
   * são apagados junto (com seus arquivos do MinIO). FechamentoLinha sai
   * cascade. O arquivo original também é apagado do MinIO.
   */
  async excluir(fechamentoId: string) {
    const f = await this.prisma.fechamento.findUnique({
      where: { id: fechamentoId },
      include: { envios: { select: { id: true, status: true, arquivoGeradoKey: true } } },
    });
    if (!f) throw new NotFoundException("Fechamento não encontrado");
    const enviados = f.envios.filter((e) => e.status === "ENVIADO");
    if (enviados.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: tem ${enviados.length} envio${enviados.length === 1 ? "" : "s"} já marcado${enviados.length === 1 ? "" : "s"} como ENVIADO. Desfaça o envio primeiro.`,
      );
    }
    // Apaga arquivos dos envios em GERADO
    await Promise.all(
      f.envios.map((e) => this.uploads.removeObject(e.arquivoGeradoKey)),
    );
    // Apaga arquivo original do fechamento
    if (f.arquivoOriginalKey) {
      await this.uploads.removeObject(f.arquivoOriginalKey);
    }
    // FechamentoLinha + EnvioFechamento saem cascade
    await this.prisma.fechamento.delete({ where: { id: fechamentoId } });
    return { ok: true };
  }
}
