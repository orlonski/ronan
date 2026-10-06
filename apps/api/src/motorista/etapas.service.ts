import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CODIGOS_ERRO_ETAPA,
  itensDaDefinicao,
  lerDefinicaoEtapa,
  type EstadoEtapasViagem,
  type EtapasDoMotoristaResposta,
  type ModeloEtapaCatalogo,
  type PendenciasEtapaMotoristaResposta,
  type PendenciasViagemMotorista,
  type ResponderEtapaInput,
  type ResponderEtapaResposta,
  type RespostaEtapaDoMotorista,
  type SeguiuSemEtapaInput,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { contaIdAtual } from "../common/conta/conta-context";
import { ItemInexistenteException } from "../common/item-inexistente";
import {
  dadosDaChaveEtapa,
  fimDaViagem,
  foraDaJanela,
  marcasDaResposta,
  mesclarItem,
  type ItemGravado,
} from "../common/etapa-regras";
import { EtapasNucleoService } from "../etapas/etapas-nucleo.service";
import { resumoDaViagem } from "./despesas.service";

const RESPOSTA_INCLUDE = {
  itens: {
    include: { arquivos: { orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }] } },
    orderBy: { criadoEm: "asc" },
  },
} satisfies Prisma.RespostaEtapaInclude;
type RespostaCompleta = Prisma.RespostaEtapaGetPayload<{ include: typeof RESPOSTA_INCLUDE }>;

const VIAGEM_SELECT = {
  id: true,
  clientId: true,
  motoristaId: true,
  status: true,
  data: true,
  sincronizadoEm: true,
  veiculoId: true,
  etapasAplicaveis: true,
  veiculo: { select: { placa: true } },
  localCarga: { select: { nome: true } },
  localDescarga: { select: { nome: true } },
} satisfies Prisma.ViagemSelect;

/** Até onde o app olha pra trás ao listar o que falta (a janela máxima de um modelo é 180). */
const DIAS_RECENTES = 60;

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());

export function respostaParaMotorista(r: RespostaCompleta): RespostaEtapaDoMotorista {
  return {
    id: r.id,
    clientId: r.clientId,
    viagemClientId: r.viagemClientId,
    viagemId: r.viagemId,
    modeloId: r.modeloId,
    versaoId: r.versaoId,
    modeloNome: r.modeloNome,
    momento: r.momento,
    concluida: r.concluida,
    concluidaEm: r.concluidaEm ? r.concluidaEm.toISOString() : null,
    recebidoEm: r.recebidoEm.toISOString(),
    atualizadoEm: r.atualizadoEm.toISOString(),
    itens: r.itens.map((i) => ({
      chave: i.itemChave,
      simNao: i.simNao,
      texto: i.texto,
      numero: num(i.numero),
      valor: num(i.valor),
      comentario: i.comentario,
      assinatura: i.assinaturaSvg,
      assinanteNome: i.assinanteNome,
      respondidoEm: i.respondidoEm.toISOString(),
      corrigidoEm: i.corrigidoEm ? i.corrigidoEm.toISOString() : null,
      arquivos: i.arquivos
        .filter((a) => !a.removidoEm)
        .map((a) => ({
          id: a.id,
          storageKey: a.storageKey,
          mime: a.mime,
          nome: a.nome,
          url: `/m/etapas/arquivos/${a.id}`,
        })),
    })),
  };
}

/**
 * Etapas da viagem do lado do motorista (/m/etapas).
 *
 * As portas (cadastro aprovado) ficam no controller. Aqui mora a regra da
 * casa: NUNCA recusar por configuração. Sem o módulo, modelo desativado,
 * versão antiga, fora da janela — aceita e carimba. Só 4xx de verdade: arquivo
 * que não é dele, modelo que não existe nesta conta, viagem de outro motorista.
 */
@Injectable()
export class EtapasMotoristaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nucleo: EtapasNucleoService,
  ) {}

  /** Catálogo: sem o módulo `etapas`, vazio (o app fica exatamente como hoje). */
  async modelos(): Promise<ModeloEtapaCatalogo[]> {
    if (!(await this.nucleo.contaTemModulo(contaIdAtual()))) return [];
    return this.nucleo.catalogo();
  }

  async responder(motoristaId: string, input: ResponderEtapaInput): Promise<ResponderEtapaResposta> {
    const contaId = contaIdAtual();
    // Arquivo que não é dele (outra conta, outro motorista, chave inventada):
    // 4xx — vai pros Pendentes do app em vez de entrar em loop.
    const mimeDaChave = new Map<string, { sha256: string | null; mime: string }>();
    for (const it of input.itens) {
      for (const a of it.arquivos) {
        const d = dadosDaChaveEtapa(a.storageKey, contaId, motoristaId);
        if (d === false) {
          throw new BadRequestException({
            code: CODIGOS_ERRO_ETAPA.ARQUIVO_INVALIDO,
            campo: it.chave,
            message: "Um dos arquivos deste documento não foi enviado por este celular. Tire a foto de novo.",
          });
        }
        mimeDaChave.set(a.storageKey, d);
      }
    }

    const modelo = await this.prisma.modeloEtapa.findUnique({
      where: { id: input.modeloId },
      select: { id: true, nome: true, momento: true, ativo: true, janelaDias: true, versaoAtualId: true },
    });
    if (!modelo) {
      throw new ItemInexistenteException(
        "modeloEtapaId",
        "Esse formulário de documentos não existe mais no escritório. Fale com o escritório.",
      );
    }
    // A versão que ele viu; se não for deste modelo (cache torto), a atual.
    const versaoVista = await this.prisma.modeloEtapaVersao.findUnique({
      where: { id: input.versaoId },
      select: { id: true, modeloId: true, definicao: true },
    });
    const versao =
      versaoVista && versaoVista.modeloId === modelo.id
        ? versaoVista
        : modelo.versaoAtualId
          ? await this.prisma.modeloEtapaVersao.findUnique({
              where: { id: modelo.versaoAtualId },
              select: { id: true, modeloId: true, definicao: true },
            })
          : null;
    if (!versao) throw new ItemInexistenteException("modeloEtapaId", "Esse formulário ainda não foi publicado pelo escritório.");
    const itensDef = new Map(itensDaDefinicao(lerDefinicaoEtapa(versao.definicao)).map((i) => [i.chave, i]));

    const viagem = await this.prisma.viagem.findUnique({
      where: { clientId: input.viagemClientId },
      select: VIAGEM_SELECT,
    });
    if (viagem && viagem.motoristaId !== motoristaId) {
      throw new ConflictException({
        code: CODIGOS_ERRO_ETAPA.VIAGEM_DE_OUTRO_MOTORISTA,
        message: "Essa viagem não é sua. Os documentos não foram guardados nela.",
      });
    }

    const moduloContratado = await this.nucleo.contaTemModulo(contaId);
    const agora = new Date();
    const fora = viagem
      ? foraDaJanela({
          finalizada: viagem.status !== "EM_ANDAMENTO",
          fim: fimDaViagem(viagem),
          janelaDias: modelo.janelaDias,
          agora,
        })
      : false;

    const chave = {
      contaId_viagemClientId_modeloId: { contaId, viagemClientId: input.viagemClientId, modeloId: modelo.id },
    };
    let resposta = await this.prisma.respostaEtapa.findUnique({ where: chave, select: { id: true, marcas: true, concluida: true } });
    const marcas = marcasDaResposta({
      moduloContratado,
      modeloAtivo: modelo.ativo,
      versaoEhAtual: versao.id === modelo.versaoAtualId,
      foraDaJanela: fora,
      anteriores: resposta?.marcas,
    });
    const comum = {
      versaoId: versao.id,
      viagemId: viagem?.id ?? null,
      ...(viagem ? { veiculoId: viagem.veiculoId, placa: viagem.veiculo?.placa ?? null } : {}),
      marcas,
      ...(input.lat != null && input.lng != null
        ? { lat: input.lat, lng: input.lng, precisao: input.precisao ?? null }
        : {}),
    };
    if (!resposta) {
      try {
        resposta = await this.prisma.respostaEtapa.create({
          data: {
            ...comum,
            clientId: input.clientId,
            modeloId: modelo.id,
            modeloNome: modelo.nome,
            momento: modelo.momento,
            viagemClientId: input.viagemClientId,
            motoristaId,
            iniciadaEm: input.iniciadaEm ?? null,
            concluida: input.concluida === true,
            concluidaEm: input.concluida ? (input.concluidaEm ?? agora) : null,
            criadoOfflineEm: input.criadoOfflineEm ?? null,
          },
          select: { id: true, marcas: true, concluida: true },
        });
      } catch (e) {
        // Dois envios ao mesmo tempo (ou outro celular) batendo no unique: é a
        // MESMA resposta — segue mesclando, nunca 409/500.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        resposta = await this.prisma.respostaEtapa.findUnique({ where: chave, select: { id: true, marcas: true, concluida: true } });
        if (!resposta) throw e;
      }
    } else {
      await this.prisma.respostaEtapa.update({
        where: { id: resposta.id },
        data: {
          ...comum,
          ...(input.concluida && !resposta.concluida ? { concluida: true, concluidaEm: input.concluidaEm ?? agora } : {}),
        },
      });
    }

    const respostaId = resposta.id;
    await this.prisma.$transaction(async (tx) => {
      for (const it of input.itens) {
        const def = itensDef.get(it.chave);
        const atual = await tx.respostaEtapaItem.findUnique({
          where: { respostaId_itemChave: { respostaId, itemChave: it.chave } },
          include: { arquivos: { select: { storageKey: true, removidoEm: true } } },
        });
        const gravado: ItemGravado | null = atual
          ? {
              simNao: atual.simNao,
              texto: atual.texto,
              numero: num(atual.numero),
              valor: num(atual.valor),
              comentario: atual.comentario,
              assinatura: atual.assinaturaSvg,
              assinanteNome: atual.assinanteNome,
              respondidoEm: atual.respondidoEm,
              arquivos: atual.arquivos.map((a) => ({ storageKey: a.storageKey, removido: !!a.removidoEm })),
            }
          : null;
        const plano = mesclarItem(gravado, it);
        if (plano.acao === "NADA") continue;
        const v = plano.valores;
        const escalares = {
          ...("simNao" in v ? { simNao: v.simNao } : {}),
          ...("texto" in v ? { texto: v.texto } : {}),
          ...("numero" in v ? { numero: v.numero == null ? null : new Prisma.Decimal(v.numero) } : {}),
          ...("valor" in v ? { valor: v.valor == null ? null : new Prisma.Decimal(v.valor.toFixed(2)) } : {}),
          ...("comentario" in v ? { comentario: v.comentario } : {}),
          ...("assinatura" in v ? { assinaturaSvg: v.assinatura } : {}),
          ...("assinanteNome" in v ? { assinanteNome: v.assinanteNome } : {}),
        };
        let itemId: string;
        if (!atual) {
          const criado = await tx.respostaEtapaItem.create({
            data: {
              respostaId,
              itemChave: it.chave,
              rotulo: def?.rotulo ?? it.chave,
              area: def?.area ?? null,
              tipo: def?.tipo ?? "DESCONHECIDO",
              obrigatorio: def?.obrigatorio ?? false,
              respondidoEm: plano.respondidoEm,
              ...escalares,
            },
            select: { id: true },
          });
          itemId = criado.id;
        } else {
          itemId = atual.id;
          if (plano.antes) {
            await tx.respostaEtapaItemHistorico.create({
              data: { itemId, antes: plano.antes as Prisma.InputJsonValue },
            });
          }
          await tx.respostaEtapaItem.update({
            where: { id: itemId },
            data: {
              ...escalares,
              respondidoEm: plano.respondidoEm,
              ...(plano.antes ? { corrigidoEm: agora } : {}),
            },
          });
        }
        if (plano.adicionar.length) {
          const base = atual?.arquivos.length ?? 0;
          await tx.respostaEtapaArquivo.createMany({
            data: plano.adicionar.map((a, i) => ({
              itemId,
              storageKey: a.storageKey,
              mime: mimeDaChave.get(a.storageKey)?.mime ?? "image/jpeg",
              nome: a.nome,
              sha256: mimeDaChave.get(a.storageKey)?.sha256 ?? null,
              ordem: base + i,
            })),
            skipDuplicates: true,
          });
        }
        if (plano.remover.length) {
          await tx.respostaEtapaArquivo.updateMany({
            where: { itemId, storageKey: { in: plano.remover }, removidoEm: null },
            data: { removidoEm: agora },
          });
        }
      }
    });

    let estado: EstadoEtapasViagem | null = null;
    if (viagem) {
      await this.nucleo.incluirVersaoNaViagem(viagem.id, modelo.id, versao.id);
      const v = await this.prisma.viagem.findUnique({
        where: { id: viagem.id },
        select: { id: true, clientId: true, status: true, etapasAplicaveis: true },
      });
      if (v) estado = (await this.nucleo.estadoDasViagens([v])).get(v.id) ?? null;
    }
    const completa = await this.prisma.respostaEtapa.findUniqueOrThrow({ where: { id: respostaId }, include: RESPOSTA_INCLUDE });
    return { resposta: respostaParaMotorista(completa), estado };
  }

  /** "Seguir sem isso": uma linha por item, idempotente por (clientId, item). */
  async seguiuSem(motoristaId: string, input: SeguiuSemEtapaInput): Promise<{ ok: true; registrados: number }> {
    const modelo = await this.prisma.modeloEtapa.findUnique({ where: { id: input.modeloId }, select: { id: true } });
    if (!modelo) throw new ItemInexistenteException("modeloEtapaId", "Esse formulário de documentos não existe mais no escritório.");
    const viagem = await this.prisma.viagem.findUnique({
      where: { clientId: input.viagemClientId },
      select: { id: true, motoristaId: true },
    });
    if (viagem && viagem.motoristaId !== motoristaId) {
      throw new ConflictException({
        code: CODIGOS_ERRO_ETAPA.VIAGEM_DE_OUTRO_MOTORISTA,
        message: "Essa viagem não é sua.",
      });
    }
    const r = await this.prisma.etapaPendenciaAcao.createMany({
      data: [...new Set(input.itens)].map((itemChave) => ({
        tipo: "SEGUIU_SEM" as const,
        clientId: input.clientId,
        modeloId: modelo.id,
        itemChave,
        viagemClientId: input.viagemClientId,
        viagemId: viagem?.id ?? null,
        motivoCodigo: input.motivoCodigo,
        motivo: input.motivoTexto?.trim() || null,
        acaoMotorista: input.acao,
        motoristaId,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        precisao: input.precisao ?? null,
        ocorridoEm: input.ocorridoEm,
      })),
      skipDuplicates: true,
    });
    return { ok: true, registrados: r.count };
  }

  /** O que ele já mandou + o que falta. Com `viagemClientId`, só daquela viagem. */
  async listar(motoristaId: string, viagemClientId?: string): Promise<EtapasDoMotoristaResposta> {
    await this.nucleo.amarrarPendentes(motoristaId);
    const desde = new Date(Date.now() - DIAS_RECENTES * 86_400_000);
    const respostas = await this.prisma.respostaEtapa.findMany({
      where: viagemClientId ? { motoristaId, viagemClientId } : { motoristaId, atualizadoEm: { gte: desde } },
      include: RESPOSTA_INCLUDE,
      orderBy: { recebidoEm: "desc" },
      take: 200,
    });
    const pend = await this.pendencias(motoristaId, viagemClientId, true);
    return { respostas: respostas.map(respostaParaMotorista), pendencias: pend.viagens };
  }

  /**
   * As viagens recentes com algo a fazer. É o que a barreira revalida com
   * sinal antes de parar o motorista ("o escritório já anexou?") e o número do
   * bloco da tela inicial.
   */
  async pendencias(
    motoristaId: string,
    viagemClientId?: string,
    jaAmarrou = false,
  ): Promise<PendenciasEtapaMotoristaResposta> {
    if (!jaAmarrou) await this.nucleo.amarrarPendentes(motoristaId);
    const desde = new Date(Date.now() - DIAS_RECENTES * 86_400_000);
    const viagens = await this.prisma.viagem.findMany({
      where: viagemClientId
        ? { motoristaId, clientId: viagemClientId }
        : {
            motoristaId,
            OR: [{ status: "EM_ANDAMENTO" }, { sincronizadoEm: { gte: desde } }, { data: { gte: desde } }],
            AND: [{ OR: [{ etapasAplicaveis: { isEmpty: false } }, { respostasEtapa: { some: {} } }] }],
          },
      select: VIAGEM_SELECT,
      orderBy: { sincronizadoEm: "desc" },
      take: 100,
    });
    const estados = await this.nucleo.estadoDasViagens(viagens);
    const janelas = new Map(
      (
        await this.prisma.modeloEtapa.findMany({ select: { id: true, janelaDias: true } })
      ).map((m) => [m.id, m.janelaDias]),
    );
    const agora = new Date();
    const lista: PendenciasViagemMotorista[] = [];
    let total = 0;
    for (const v of viagens) {
      const estado = estados.get(v.id);
      if (!estado || !estado.etapas.length) continue;
      const finalizada = v.status !== "EM_ANDAMENTO";
      // Passada a janela de um formulário, o app não oferece mais — sai da
      // lista DELE (o escritório continua vendo na viagem).
      const etapas = viagemClientId
        ? estado.etapas
        : estado.etapas.filter(
            (e) =>
              !foraDaJanela({ finalizada, fim: fimDaViagem(v), janelaDias: janelas.get(e.modeloId) ?? 30, agora }),
          );
      const temAlgo = etapas.some((e) => e.situacao === "FALTANDO" || (e.situacao === "AINDA_NAO" && e.faltando.length > 0));
      if (!viagemClientId && !temAlgo) continue;
      const documentosFaltando = etapas
        .filter((e) => e.situacao === "FALTANDO")
        .reduce((s, e) => s + e.faltando.length, 0);
      total += documentosFaltando;
      lista.push({
        viagemClientId: v.clientId,
        viagemId: v.id,
        resumo: resumoDaViagem(v),
        finalizada,
        estado: { etapas, documentosFaltando },
      });
    }
    return { viagens: lista, total };
  }

  arquivo(motoristaId: string, id: string) {
    return this.nucleo.arquivo(id, motoristaId);
  }
}
