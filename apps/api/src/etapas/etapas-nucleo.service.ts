import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  calcularEstadoEtapas,
  lerDefinicaoEtapa,
  type AcaoPendenciaTipo,
  type DefinicaoEtapa,
  type EntradaEstadoEtapas,
  type EstadoEtapasViagem,
  type EstadoRespostaItem,
  type ModeloEtapaCatalogo,
  type MomentoEtapa,
  type MotivoSeguirSem,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { modulosDaConta } from "../common/conta/teto-da-conta";

/** O mínimo da viagem que a pendência precisa. */
export type ViagemParaEtapas = {
  id: string;
  clientId: string;
  status: string;
  etapasAplicaveis: string[];
};

type VersaoCarregada = {
  id: string;
  modeloId: string;
  versao: number;
  definicao: DefinicaoEtapa;
  modelo: { nome: string; momento: MomentoEtapa; tipoEventoId: string | null };
};

/** Os campos que valem como "resposta" de um item, já em número. */
export function estadoDoItemGravado(i: {
  simNao: boolean | null;
  texto: string | null;
  numero: { toNumber(): number } | null;
  valor: { toNumber(): number } | null;
  comentario: string | null;
  assinaturaSvg: string | null;
  assinanteNome: string | null;
  arquivos: { removidoEm: Date | null }[];
}): EstadoRespostaItem {
  return {
    simNao: i.simNao,
    texto: i.texto,
    numero: i.numero ? i.numero.toNumber() : null,
    valor: i.valor ? i.valor.toNumber() : null,
    comentario: i.comentario,
    assinatura: i.assinaturaSvg,
    assinanteNome: i.assinanteNome,
    arquivos: i.arquivos.filter((a) => !a.removidoEm).length,
  };
}

/**
 * O que o lado do motorista (/m/etapas) e o do painel fazem igual: saber se a
 * conta tem o módulo, montar o catálogo, fixar os modelos que valem pra uma
 * viagem, calcular o que falta e servir o arquivo.
 *
 * ⚠️ O que falta NUNCA é gravado: sai de `calcularEstadoEtapas` (shared-types)
 * a cada leitura, com o que está no banco. Nada vai pra ViagemDivergencia.
 */
@Injectable()
export class EtapasNucleoService {
  private readonly log = new Logger(EtapasNucleoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async contaTemModulo(contaId: string): Promise<boolean> {
    return (await modulosDaConta(this.prisma, contaId)).has("etapas");
  }

  /** Os modelos ATIVOS com versão publicada, na ordem do painel. */
  async catalogo(): Promise<ModeloEtapaCatalogo[]> {
    const modelos = await this.prisma.modeloEtapa.findMany({
      where: { ativo: true, versaoAtualId: { not: null } },
      select: {
        id: true,
        nome: true,
        momento: true,
        tipoEventoId: true,
        janelaDias: true,
        ordem: true,
        versaoAtual: { select: { id: true, versao: true, definicao: true } },
      },
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    });
    return modelos
      .filter((m) => m.versaoAtual)
      .map((m) => ({
        id: m.id,
        nome: m.nome,
        momento: m.momento,
        tipoEventoId: m.tipoEventoId,
        janelaDias: m.janelaDias,
        ordem: m.ordem,
        versaoId: m.versaoAtual!.id,
        versao: m.versaoAtual!.versao,
        definicao: lerDefinicaoEtapa(m.versaoAtual!.definicao),
      }));
  }

  /** O motorista tem `app.viagem.etapas` efetiva AGORA? (Sem linha calculada = não.) */
  async motoristaTemCapacidade(motoristaId: string): Promise<boolean> {
    const ef = await this.prisma.acessoEfetivoApp.findUnique({
      where: { motoristaId },
      select: { capacidades: true },
    });
    return !!ef?.capacidades.includes("app.viagem.etapas");
  }

  /**
   * Fotografa, na viagem que acabou de nascer, os formulários que valem pra
   * ela: só com o módulo na conta E a capacidade efetiva no motorista. Roda
   * uma vez (etapasFixadasEm). Também amarra respostas e ações que chegaram
   * antes da viagem (offline) e põe as versões delas na lista.
   *
   * Best-effort: chamado depois de a viagem estar gravada; falhar aqui nunca
   * derruba o lançamento.
   */
  async fixarNaViagem(viagemId: string, motoristaId: string, contaId: string): Promise<void> {
    try {
      const v = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        select: { id: true, clientId: true, etapasFixadasEm: true, etapasAplicaveis: true },
      });
      if (!v) return;
      await this.amarrarViagem(v.id, v.clientId, motoristaId);
      if (v.etapasFixadasEm) return;
      const vale = (await this.contaTemModulo(contaId)) && (await this.motoristaTemCapacidade(motoristaId));
      const versoes = vale ? (await this.catalogo()).map((m) => m.versaoId) : [];
      const jaRespondidas = await this.prisma.respostaEtapa.findMany({
        where: { viagemClientId: v.clientId },
        select: { versaoId: true, modeloId: true },
      });
      const lista = await this.unirVersoes([...v.etapasAplicaveis, ...versoes], jaRespondidas);
      await this.prisma.viagem.update({
        where: { id: v.id },
        data: { etapasAplicaveis: lista, etapasFixadasEm: new Date() },
      });
    } catch (e) {
      this.log.warn(`fixarNaViagem(${viagemId}): ${(e as Error).message}`);
    }
  }

  /**
   * Junta versões numa lista com UMA versão por modelo: a resposta manda (é a
   * versão que ele viu); senão, a primeira da lista.
   */
  private async unirVersoes(
    ids: string[],
    respondidas: { versaoId: string; modeloId: string }[],
  ): Promise<string[]> {
    const unicos = [...new Set([...ids, ...respondidas.map((r) => r.versaoId)])];
    if (!unicos.length) return [];
    const versoes = await this.prisma.modeloEtapaVersao.findMany({
      where: { id: { in: unicos } },
      select: { id: true, modeloId: true },
    });
    const modeloDe = new Map(versoes.map((x) => [x.id, x.modeloId]));
    const porModelo = new Map<string, string>();
    for (const r of respondidas) porModelo.set(r.modeloId, r.versaoId);
    for (const id of unicos) {
      const m = modeloDe.get(id);
      if (m && !porModelo.has(m)) porModelo.set(m, id);
    }
    return [...porModelo.values()];
  }

  /** Garante que a versão respondida está na lista da viagem (ele preencheu, então vale). */
  async incluirVersaoNaViagem(viagemId: string, modeloId: string, versaoId: string): Promise<void> {
    const v = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: { etapasAplicaveis: true, clientId: true },
    });
    if (!v || v.etapasAplicaveis.includes(versaoId)) return;
    const lista = await this.unirVersoes(v.etapasAplicaveis, [{ versaoId, modeloId }]);
    await this.prisma.viagem.update({ where: { id: viagemId }, data: { etapasAplicaveis: lista } });
  }

  /** Liga respostas e ações que apontavam só pro clientId da viagem. */
  async amarrarViagem(viagemId: string, viagemClientId: string, motoristaId: string): Promise<void> {
    await this.prisma.respostaEtapa.updateMany({
      where: { viagemClientId, viagemId: null, motoristaId },
      data: { viagemId },
    });
    await this.prisma.etapaPendenciaAcao.updateMany({
      where: { viagemClientId, viagemId: null },
      data: { viagemId },
    });
  }

  /** Amarra o que estiver solto deste motorista (leitura do app). */
  async amarrarPendentes(motoristaId: string): Promise<void> {
    try {
      const soltas = await this.prisma.respostaEtapa.findMany({
        where: { motoristaId, viagemId: null },
        select: { viagemClientId: true },
        take: 200,
      });
      if (!soltas.length) return;
      const viagens = await this.prisma.viagem.findMany({
        where: { clientId: { in: [...new Set(soltas.map((s) => s.viagemClientId))] }, motoristaId },
        select: { id: true, clientId: true },
      });
      for (const v of viagens) await this.amarrarViagem(v.id, v.clientId, motoristaId);
    } catch (e) {
      this.log.warn(`amarrarPendentes: ${(e as Error).message}`);
    }
  }

  /**
   * O que falta em cada viagem. Lê tudo em lote (versões, respostas, ações,
   * eventos) e chama a regra pura uma vez por viagem.
   */
  async estadoDasViagens(viagens: ViagemParaEtapas[]): Promise<Map<string, EstadoEtapasViagem>> {
    const resultado = new Map<string, EstadoEtapasViagem>();
    if (!viagens.length) return resultado;
    const clientIds = viagens.map((v) => v.clientId);
    const [respostas, acoes] = await Promise.all([
      this.prisma.respostaEtapa.findMany({
        where: { viagemClientId: { in: clientIds } },
        select: {
          viagemClientId: true,
          modeloId: true,
          versaoId: true,
          concluida: true,
          itens: {
            select: {
              itemChave: true,
              simNao: true,
              texto: true,
              numero: true,
              valor: true,
              comentario: true,
              assinaturaSvg: true,
              assinanteNome: true,
              arquivos: { select: { removidoEm: true } },
            },
          },
        },
      }),
      this.prisma.etapaPendenciaAcao.findMany({
        where: { viagemClientId: { in: clientIds }, desfeitoEm: null },
        select: {
          viagemClientId: true,
          modeloId: true,
          itemChave: true,
          tipo: true,
          motivo: true,
          motivoCodigo: true,
          ocorridoEm: true,
        },
      }),
    ]);
    const versaoIds = new Set<string>();
    for (const v of viagens) v.etapasAplicaveis.forEach((id) => versaoIds.add(id));
    respostas.forEach((r) => versaoIds.add(r.versaoId));
    if (!versaoIds.size) {
      for (const v of viagens) resultado.set(v.id, { etapas: [], documentosFaltando: 0 });
      return resultado;
    }
    const versoes = await this.carregarVersoes([...versaoIds]);
    const precisaEvento = [...versoes.values()].some((x) => x.modelo.momento === "EVENTO");
    const eventos = precisaEvento
      ? await this.prisma.eventoViagem.findMany({
          where: { viagemId: { in: viagens.map((v) => v.id) } },
          select: { viagemId: true, tipoEventoId: true },
        })
      : [];

    for (const v of viagens) {
      const resp = respostas.filter((r) => r.viagemClientId === v.clientId);
      const porModelo = new Map<string, VersaoCarregada>();
      for (const r of resp) {
        const x = versoes.get(r.versaoId);
        if (x) porModelo.set(x.modeloId, x);
      }
      for (const id of v.etapasAplicaveis) {
        const x = versoes.get(id);
        if (x && !porModelo.has(x.modeloId)) porModelo.set(x.modeloId, x);
      }
      const entrada: EntradaEstadoEtapas = {
        viagem: {
          finalizada: v.status !== "EM_ANDAMENTO",
          tiposEventoRegistrados: eventos.filter((e) => e.viagemId === v.id).map((e) => e.tipoEventoId),
        },
        modelos: [...porModelo.values()].map((x) => ({
          modeloId: x.modeloId,
          nome: x.modelo.nome,
          momento: x.modelo.momento,
          tipoEventoId: x.modelo.tipoEventoId,
          versaoId: x.id,
          definicao: x.definicao,
        })),
        respostas: resp.map((r) => ({
          modeloId: r.modeloId,
          concluida: r.concluida,
          itens: Object.fromEntries(r.itens.map((i) => [i.itemChave, estadoDoItemGravado(i)])),
        })),
        acoes: acoes
          .filter((a) => a.viagemClientId === v.clientId)
          .map((a) => ({
            modeloId: a.modeloId,
            itemChave: a.itemChave,
            tipo: a.tipo as AcaoPendenciaTipo,
            motivo: a.motivo,
            motivoCodigo: (a.motivoCodigo as MotivoSeguirSem | null) ?? null,
            em: a.ocorridoEm.toISOString(),
          })),
      };
      resultado.set(v.id, calcularEstadoEtapas(entrada));
    }
    return resultado;
  }

  async carregarVersoes(ids: string[]): Promise<Map<string, VersaoCarregada>> {
    const linhas = await this.prisma.modeloEtapaVersao.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        modeloId: true,
        versao: true,
        definicao: true,
        modelo: { select: { nome: true, momento: true, tipoEventoId: true } },
      },
    });
    return new Map(linhas.map((l) => [l.id, { ...l, definicao: lerDefinicaoEtapa(l.definicao) }]));
  }

  /**
   * O arquivo de um documento, pela API (o bucket nunca tem domínio público).
   * Procura nos dois lugares: o que o motorista mandou e o que o escritório
   * anexou. `motoristaId` restringe ao que é dele (rota do app).
   */
  async arquivo(id: string, motoristaId?: string): Promise<{ buffer: Buffer; contentType: string; nome: string | null }> {
    const doMotorista = await this.prisma.respostaEtapaArquivo.findFirst({
      where: { id, ...(motoristaId ? { item: { resposta: { motoristaId } } } : {}) },
      select: { storageKey: true, mime: true, nome: true },
    });
    if (doMotorista) {
      return {
        buffer: await this.uploads.getObjectBuffer(doMotorista.storageKey),
        contentType: doMotorista.mime,
        nome: doMotorista.nome,
      };
    }
    if (!motoristaId) {
      const anexo = await this.prisma.etapaPendenciaAcao.findFirst({
        where: { id, storageKey: { not: null } },
        select: { storageKey: true, mime: true, nomeArquivo: true },
      });
      if (anexo?.storageKey) {
        return {
          buffer: await this.uploads.getObjectBuffer(anexo.storageKey),
          contentType: anexo.mime ?? "application/octet-stream",
          nome: anexo.nomeArquivo,
        };
      }
    }
    throw new NotFoundException("Arquivo não encontrado");
  }
}
