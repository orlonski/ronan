import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  itensDaDefinicao,
  lerDefinicaoEtapa,
  type AcaoEtapaPainel,
  type AcaoPendenciaTipo,
  type AnexarEtapaInput,
  type ComparacaoTarifa,
  type DispensarEtapaInput,
  type DocumentosDaViagemPainel,
  type EtapaDaViagemPainel,
  type MarcaRespostaEtapa,
  type ModeloEtapaPainel,
  type MotivoSeguirSem,
  type SalvarModeloEtapaInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";
import { contaIdAtual } from "../../common/conta/conta-context";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { checarArquivoEnviado, MIMES_DOCUMENTO } from "../../common/arquivo-enviado";
import { ETAPA_ARQUIVO_MAX_BYTES } from "@ronan/shared-types";
import { EtapasNucleoService } from "../../etapas/etapas-nucleo.service";

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const MODELO_SELECT = {
  id: true,
  nome: true,
  momento: true,
  tipoEventoId: true,
  tipoEvento: { select: { nome: true } },
  janelaDias: true,
  ordem: true,
  ativo: true,
  criadoEm: true,
  alteradoEm: true,
  versaoAtual: { select: { id: true, versao: true, publicadaEm: true, definicao: true } },
} satisfies Prisma.ModeloEtapaSelect;
type ModeloLinha = Prisma.ModeloEtapaGetPayload<{ select: typeof MODELO_SELECT }>;

function paraPainel(m: ModeloLinha): ModeloEtapaPainel {
  return {
    id: m.id,
    nome: m.nome,
    momento: m.momento,
    tipoEventoId: m.tipoEventoId,
    tipoEventoNome: m.tipoEvento?.nome ?? null,
    janelaDias: m.janelaDias,
    ordem: m.ordem,
    ativo: m.ativo,
    versao: m.versaoAtual?.versao ?? null,
    versaoId: m.versaoAtual?.id ?? null,
    publicadaEm: iso(m.versaoAtual?.publicadaEm),
    definicao: lerDefinicaoEtapa(m.versaoAtual?.definicao),
    criadoEm: m.criadoEm.toISOString(),
    alteradoEm: m.alteradoEm.toISOString(),
  };
}

/** JSON com as chaves ordenadas: o jsonb devolve as chaves em outra ordem que a do Zod. */
export function jsonCanonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Mesmo formulário? (Só aí salvar NÃO publica versão nova.) */
const mesmaDefinicao = (a: unknown, b: unknown) => jsonCanonico(a) === jsonCanonico(b);

/**
 * Etapas da viagem no painel: montar/publicar os formulários (aba ⚙
 * "Documentos da viagem") e a seção "Documentos" da ficha da viagem, com
 * "Anexar pelo escritório" e "Dispensar com motivo".
 *
 * O módulo é cobrado pelo teto da conta (as chaves `etapas-*` somem do papel
 * sem o módulo), então aqui não há checagem extra.
 */
@Injectable()
export class EtapasAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly nucleo: EtapasNucleoService,
  ) {}

  // ─── Modelos ───────────────────────────────────────────────────────────────

  async listarModelos(): Promise<ModeloEtapaPainel[]> {
    const linhas = await this.prisma.modeloEtapa.findMany({
      select: MODELO_SELECT,
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    });
    return linhas.map(paraPainel);
  }

  private async conferirTipoEvento(input: SalvarModeloEtapaInput): Promise<string | null> {
    if (input.momento !== "EVENTO") return null;
    const t = await this.prisma.tipoEventoViagem.findUnique({
      where: { id: input.tipoEventoId! },
      select: { id: true, ehCarga: true, ehDescarga: true },
    });
    if (!t) throw new BadRequestException("Essa parada não existe mais. Escolha outra.");
    // Carga e descarga são bookends do app e nunca viram evento na guiada.
    if (t.ehCarga || t.ehDescarga) {
      throw new BadRequestException(
        "Carga e descarga já têm momento próprio: use \"Ao começar a viagem\" ou \"Ao finalizar a viagem\".",
      );
    }
    return t.id;
  }

  /** Cria o modelo JÁ PUBLICADO (versão 1). O rascunho mora na tela, não no servidor. */
  async criarModelo(input: SalvarModeloEtapaInput, userId: string): Promise<ModeloEtapaPainel> {
    const tipoEventoId = await this.conferirTipoEvento(input);
    const ultimo = await this.prisma.modeloEtapa.aggregate({ _max: { ordem: true } });
    const id = await this.prisma.$transaction(async (tx) => {
      const m = await tx.modeloEtapa.create({
        data: {
          nome: input.nome,
          momento: input.momento,
          tipoEventoId,
          janelaDias: input.janelaDias,
          ativo: input.ativo,
          ordem: (ultimo._max.ordem ?? 0) + 1,
          criadoPorId: userId,
        },
        select: { id: true },
      });
      const v = await tx.modeloEtapaVersao.create({
        data: {
          modeloId: m.id,
          versao: 1,
          definicao: input.definicao as unknown as Prisma.InputJsonValue,
          publicadaPorId: userId,
        },
        select: { id: true },
      });
      await tx.modeloEtapa.update({ where: { id: m.id }, data: { versaoAtualId: v.id } });
      return m.id;
    });
    return paraPainel(await this.prisma.modeloEtapa.findUniqueOrThrow({ where: { id }, select: MODELO_SELECT }));
  }

  /**
   * Salva o modelo. Mudou o formulário → publica a PRÓXIMA versão (a antiga
   * fica: é o que as viagens em andamento e as respostas viram). Só nome,
   * momento, janela ou ativo → não mexe em versão.
   */
  async atualizarModelo(id: string, input: SalvarModeloEtapaInput, userId: string): Promise<ModeloEtapaPainel> {
    const atual = await this.prisma.modeloEtapa.findUnique({
      where: { id },
      select: { id: true, versaoAtual: { select: { versao: true, definicao: true } } },
    });
    if (!atual) throw new NotFoundException("Formulário não encontrado.");
    const tipoEventoId = await this.conferirTipoEvento(input);
    await this.prisma.$transaction(async (tx) => {
      let versaoAtualId: string | undefined;
      if (!atual.versaoAtual || !mesmaDefinicao(atual.versaoAtual.definicao, input.definicao)) {
        const ultima = await tx.modeloEtapaVersao.aggregate({ where: { modeloId: id }, _max: { versao: true } });
        const v = await tx.modeloEtapaVersao.create({
          data: {
            modeloId: id,
            versao: (ultima._max.versao ?? 0) + 1,
            definicao: input.definicao as unknown as Prisma.InputJsonValue,
            publicadaPorId: userId,
          },
          select: { id: true },
        });
        versaoAtualId = v.id;
      }
      await tx.modeloEtapa.update({
        where: { id },
        data: {
          nome: input.nome,
          momento: input.momento,
          tipoEventoId,
          janelaDias: input.janelaDias,
          ativo: input.ativo,
          ...(versaoAtualId ? { versaoAtualId } : {}),
        },
      });
    });
    return paraPainel(await this.prisma.modeloEtapa.findUniqueOrThrow({ where: { id }, select: MODELO_SELECT }));
  }

  async reordenar(ids: string[]): Promise<ModeloEtapaPainel[]> {
    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.modeloEtapa.updateMany({ where: { id }, data: { ordem: i + 1 } })),
    );
    return this.listarModelos();
  }

  // ─── Documentos da viagem ──────────────────────────────────────────────────

  private async viagemNoEscopo(viagemId: string, escopo: EscopoAdmin) {
    const v = await this.prisma.viagem.findFirst({
      where: { id: viagemId, ...filtroEscopo(escopo) },
      select: {
        id: true,
        clientId: true,
        status: true,
        motoristaId: true,
        etapasAplicaveis: true,
        valor: { select: { base: true, precoUnitario: true } },
      },
    });
    if (!v) throw new NotFoundException("Viagem não encontrada");
    return v;
  }

  async documentosDaViagem(viagemId: string, escopo: EscopoAdmin): Promise<DocumentosDaViagemPainel> {
    const v = await this.viagemNoEscopo(viagemId, escopo);
    const modulo = await this.nucleo.contaTemModulo(contaIdAtual());
    const estado = (await this.nucleo.estadoDasViagens([v])).get(v.id) ?? { etapas: [], documentosFaltando: 0 };
    if (!estado.etapas.length) return { viagemId: v.id, modulo, etapas: [], documentosFaltando: 0 };

    const [respostas, acoes, versoes] = await Promise.all([
      this.prisma.respostaEtapa.findMany({
        where: { viagemClientId: v.clientId },
        include: {
          motorista: { select: { nome: true } },
          itens: {
            include: {
              arquivos: { orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] },
              historico: { orderBy: { em: "desc" }, take: 10 },
            },
          },
        },
      }),
      this.prisma.etapaPendenciaAcao.findMany({
        where: { viagemClientId: v.clientId },
        include: { motorista: { select: { nome: true } } },
        orderBy: { ocorridoEm: "desc" },
      }),
      this.nucleo.carregarVersoes(estado.etapas.map((e) => e.versaoId)),
    ]);

    const precoTonelada =
      v.valor && v.valor.base === "TONELADA" ? v.valor.precoUnitario.toNumber() : null;

    const etapas: EtapaDaViagemPainel[] = estado.etapas.map((e) => {
      const versao = versoes.get(e.versaoId);
      const definicao = versao?.definicao ?? lerDefinicaoEtapa(null);
      const r = respostas.find((x) => x.modeloId === e.modeloId) ?? null;
      const tarifas: ComparacaoTarifa[] = [];
      for (const it of itensDaDefinicao(definicao)) {
        if (it.tipo !== "VALOR" || !it.valor.comparaTabelaPorTonelada) continue;
        const informada = num(r?.itens.find((i) => i.itemChave === it.chave)?.valor ?? null);
        if (informada == null) continue;
        tarifas.push({
          itemChave: it.chave,
          informada,
          tabela: precoTonelada,
          diferente: precoTonelada == null ? null : Math.abs(precoTonelada - informada) >= 0.005,
        });
      }
      return {
        modeloId: e.modeloId,
        nome: e.nome,
        momento: e.momento,
        versaoId: e.versaoId,
        versao: versao?.versao ?? null,
        definicao,
        estado: e,
        resposta: r
          ? {
              id: r.id,
              motoristaNome: r.motorista?.nome ?? null,
              placa: r.placa,
              iniciadaEm: iso(r.iniciadaEm),
              concluidaEm: iso(r.concluidaEm),
              recebidoEm: r.recebidoEm.toISOString(),
              atualizadoEm: r.atualizadoEm.toISOString(),
              criadoOfflineEm: iso(r.criadoOfflineEm),
              lat: r.lat,
              lng: r.lng,
              precisao: r.precisao,
              marcas: r.marcas as MarcaRespostaEtapa[],
              itens: r.itens.map((i) => {
                const arquivos = i.arquivos.map((a) => ({
                  id: a.id,
                  mime: a.mime,
                  nome: a.nome,
                  tamanho: a.tamanho,
                  url: `/admin/etapas/arquivos/${a.id}`,
                  enviadoEm: a.criadoEm.toISOString(),
                  removidoEm: iso(a.removidoEm),
                }));
                return {
                  chave: i.itemChave,
                  simNao: i.simNao,
                  texto: i.texto,
                  numero: num(i.numero),
                  valor: num(i.valor),
                  comentario: i.comentario,
                  assinatura: i.assinaturaSvg,
                  assinanteNome: i.assinanteNome,
                  respondidoEm: i.respondidoEm.toISOString(),
                  corrigidoEm: iso(i.corrigidoEm),
                  arquivos: arquivos
                    .filter((a) => !a.removidoEm)
                    .map((a) => ({ id: a.id, storageKey: "", mime: a.mime, nome: a.nome, url: a.url })),
                  arquivosPainel: arquivos,
                  historico: i.historico.map((h) => ({
                    em: h.em.toISOString(),
                    antes: (h.antes ?? {}) as Record<string, unknown>,
                  })),
                };
              }),
            }
          : null,
        acoes: acoes
          .filter((a) => a.modeloId === e.modeloId)
          .map(
            (a): AcaoEtapaPainel => ({
              id: a.id,
              tipo: a.tipo as AcaoPendenciaTipo,
              itemChave: a.itemChave,
              motivoCodigo: (a.motivoCodigo as MotivoSeguirSem | null) ?? null,
              motivo: a.motivo,
              autor: a.motorista?.nome ?? a.autorNome,
              porMotorista: !!a.motoristaId && !a.autorUserId,
              em: a.ocorridoEm.toISOString(),
              lat: a.lat,
              lng: a.lng,
              arquivo: a.storageKey
                ? {
                    id: a.id,
                    mime: a.mime ?? "application/octet-stream",
                    nome: a.nomeArquivo,
                    tamanho: a.tamanho,
                    url: `/admin/etapas/arquivos/${a.id}`,
                    enviadoEm: a.recebidoEm.toISOString(),
                    removidoEm: null,
                  }
                : null,
              desfeitoEm: iso(a.desfeitoEm),
            }),
          ),
        tarifas,
      };
    });
    return { viagemId: v.id, modulo, etapas, documentosFaltando: estado.documentosFaltando };
  }

  /** O item existe na versão que vale pra esta viagem? (E qual é.) */
  private async itemDaViagem(viagemId: string, modeloId: string, itemChave: string | null, escopo: EscopoAdmin) {
    const v = await this.viagemNoEscopo(viagemId, escopo);
    const estado = (await this.nucleo.estadoDasViagens([v])).get(v.id);
    const etapa = estado?.etapas.find((e) => e.modeloId === modeloId);
    if (!etapa) throw new BadRequestException("Esse formulário não vale pra esta viagem.");
    if (itemChave == null) return { v, etapa, item: null };
    const versoes = await this.nucleo.carregarVersoes([etapa.versaoId]);
    const item = itensDaDefinicao(versoes.get(etapa.versaoId)?.definicao ?? lerDefinicaoEtapa(null)).find(
      (i) => i.chave === itemChave,
    );
    if (!item) throw new BadRequestException("Esse documento não está no formulário desta viagem.");
    return { v, etapa, item };
  }

  async dispensar(
    viagemId: string,
    input: DispensarEtapaInput,
    user: { id: string; nome: string },
    escopo: EscopoAdmin,
  ): Promise<DocumentosDaViagemPainel> {
    const { v } = await this.itemDaViagem(viagemId, input.modeloId, input.itemChave ?? null, escopo);
    await this.prisma.etapaPendenciaAcao.create({
      data: {
        tipo: "DISPENSADO",
        modeloId: input.modeloId,
        itemChave: input.itemChave ?? null,
        viagemClientId: v.clientId,
        viagemId: v.id,
        motivo: input.motivo,
        autorUserId: user.id,
        autorNome: user.nome,
      },
    });
    return this.documentosDaViagem(viagemId, escopo);
  }

  async anexar(
    viagemId: string,
    input: AnexarEtapaInput,
    arquivo: { buffer: Buffer; mimetype: string; size?: number; originalname?: string } | undefined,
    user: { id: string; nome: string },
    escopo: EscopoAdmin,
  ): Promise<DocumentosDaViagemPainel> {
    checarArquivoEnviado(arquivo, {
      mimes: MIMES_DOCUMENTO,
      maxBytes: ETAPA_ARQUIVO_MAX_BYTES,
      comoDizer: "Mande uma foto ou um PDF.",
    });
    const { v, item } = await this.itemDaViagem(viagemId, input.modeloId, input.itemChave, escopo);
    if (!item?.escritorioPodeAnexar) {
      throw new BadRequestException(
        "Este documento é do motorista. Marque \"O escritório também pode anexar\" no formulário pra anexar daqui.",
      );
    }
    const up = await this.uploads.putEtapaAnexoEscritorio(arquivo.buffer, arquivo.mimetype, v.id);
    await this.prisma.etapaPendenciaAcao.create({
      data: {
        tipo: "ANEXADO_ESCRITORIO",
        modeloId: input.modeloId,
        itemChave: input.itemChave,
        viagemClientId: v.clientId,
        viagemId: v.id,
        motivo: input.observacao?.trim() || null,
        autorUserId: user.id,
        autorNome: user.nome,
        storageKey: up.storageKey,
        mime: up.mime,
        nomeArquivo: arquivo.originalname?.slice(0, 200) ?? null,
        tamanho: up.tamanho,
        sha256: up.sha256,
      },
    });
    return this.documentosDaViagem(viagemId, escopo);
  }

  /** Desfaz uma dispensa ou anexo feito por engano. "Seguiu sem" é do motorista: não se desfaz. */
  async desfazer(acaoId: string, user: { id: string; nome: string }, escopo: EscopoAdmin) {
    const a = await this.prisma.etapaPendenciaAcao.findUnique({
      where: { id: acaoId },
      select: { id: true, tipo: true, viagemId: true, desfeitoEm: true },
    });
    if (!a || !a.viagemId) throw new NotFoundException("Ação não encontrada.");
    await this.viagemNoEscopo(a.viagemId, escopo);
    if (a.tipo === "SEGUIU_SEM") throw new BadRequestException("O motivo do motorista não se apaga.");
    if (!a.desfeitoEm) {
      await this.prisma.etapaPendenciaAcao.update({
        where: { id: a.id },
        data: { desfeitoEm: new Date(), desfeitoPorId: user.id, desfeitoPorNome: user.nome },
      });
    }
    return this.documentosDaViagem(a.viagemId, escopo);
  }

  /** O arquivo (do motorista ou do escritório), conferindo que a viagem está no escopo. */
  async arquivo(id: string, escopo: EscopoAdmin) {
    if (escopo) {
      const doMotorista = await this.prisma.respostaEtapaArquivo.findFirst({
        where: { id },
        select: { item: { select: { resposta: { select: { viagemId: true } } } } },
      });
      const daAcao = doMotorista
        ? null
        : await this.prisma.etapaPendenciaAcao.findFirst({ where: { id }, select: { viagemId: true } });
      const viagemId = doMotorista?.item.resposta.viagemId ?? daAcao?.viagemId ?? null;
      if (!viagemId) throw new NotFoundException("Arquivo não encontrado");
      await this.viagemNoEscopo(viagemId, escopo);
    }
    return this.nucleo.arquivo(id);
  }
}
