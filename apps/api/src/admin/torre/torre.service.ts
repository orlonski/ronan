import { randomUUID } from "node:crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminInboxService } from "../inbox/inbox.service";
import { comoSistema } from "../../common/conta/conta-context";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import {
  avaliarViagem,
  limiteDeAtrasoMin,
  medianaMinutos,
  valorDaEstadia,
  type ViagemEmCurso,
} from "../../common/torre";

@Injectable()
export class TorreService {
  private readonly log = new Logger(TorreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: AdminInboxService,
  ) {}

  /**
   * A fila de exceções: o que está fora do esperado agora, ordenado por
   * gravidade e não por hora.
   *
   * Sem nada errado, devolve lista vazia — e a tela mostra "tudo no esperado",
   * que é o estado que o supervisor quer ver.
   */
  async alertas(escopo: EscopoAdmin) {
    const alertas = await this.prisma.alertaOperacional.findMany({
      where: {
        resolvidoEm: null,
        ...(escopo ? { motorista: filtroEscopo(escopo) as Prisma.MotoristaWhereInput } : {}),
      },
      include: {
        motorista: { select: { id: true, nome: true, telefone: true } },
        viagem: {
          select: {
            id: true,
            iniciadoEm: true,
            localCarga: { select: { nome: true } },
            localDescarga: { select: { nome: true } },
            cliente: { select: { nome: true } },
          },
        },
      },
      orderBy: [{ severidade: "asc" }, { detectadoEm: "asc" }],
      take: 100,
    });

    // "ALTA" vem antes de "BAIXA" e "MEDIA" no alfabeto — ordenar por string
    // colocaria BAIXA no meio. A ordem certa é a de urgência, não a do dicionário.
    const peso: Record<string, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
    alertas.sort(
      (a, b) =>
        (peso[a.severidade] ?? 9) - (peso[b.severidade] ?? 9) ||
        a.detectadoEm.getTime() - b.detectadoEm.getTime(),
    );

    const ocorrencias = await this.prisma.eventoViagem.findMany({
      where: {
        terminouEm: null,
        iniciouEm: { not: null },
        tipoEvento: { ehOcorrencia: true },
        ...(escopo
          ? { viagem: { ...(filtroEscopo(escopo) as Prisma.ViagemWhereInput) } }
          : {}),
      },
      include: {
        tipoEvento: { select: { nome: true, severidade: true, geraCobranca: true, valorHora: true } },
        viagem: {
          select: {
            id: true,
            motorista: { select: { id: true, nome: true } },
            cliente: { select: { nome: true } },
          },
        },
        local: { select: { nome: true } },
      },
      orderBy: { iniciouEm: "asc" },
      take: 50,
    });

    // Quem atende a ligação precisa do tipo e da viagem na mesma tela pra abrir
    // a ocorrência — mandar buscar em outro endpoint (sob outra permissão) é o
    // que faz o supervisor desistir e anotar no caderno.
    const [tipos, emCurso] = await Promise.all([
      this.prisma.tipoEventoViagem.findMany({
        where: { ehOcorrencia: true, ativo: true },
        select: { id: true, nome: true, severidade: true, temDuracao: true },
        orderBy: { nome: "asc" },
      }),
      this.prisma.viagem.findMany({
        where: {
          status: "EM_ANDAMENTO",
          ...(escopo ? (filtroEscopo(escopo) as Prisma.ViagemWhereInput) : {}),
        },
        select: {
          id: true,
          motorista: { select: { nome: true } },
          cliente: { select: { nome: true } },
          localDescarga: { select: { nome: true } },
        },
        orderBy: { iniciadoEm: "asc" },
        take: 200,
      }),
    ]);

    return {
      alertas,
      tiposOcorrencia: tipos,
      viagensEmCurso: emCurso.map((v) => ({
        id: v.id,
        rotulo: [v.motorista?.nome, v.localDescarga?.nome ?? v.cliente?.nome]
          .filter(Boolean)
          .join(" → "),
      })),
      ocorrencias: ocorrencias.map((o) => ({
        id: o.id,
        tipo: o.tipoEvento.nome,
        severidade: o.tipoEvento.severidade,
        viagemId: o.viagemId,
        motorista: o.viagem?.motorista ?? null,
        cliente: o.viagem?.cliente?.nome ?? null,
        local: o.local?.nome ?? null,
        iniciouEm: o.iniciouEm,
        observacao: o.observacao,
        // Separado de `estadia` de propósito: tipo que cobra mas está SEM
        // valor/hora devolve estadia nula, e sem esta flag a tela ficaria muda
        // justamente na fila de 4 horas que ninguém configurou o preço.
        geraCobranca: o.tipoEvento.geraCobranca,
        // Ocorrência aberta que gera cobrança tem o valor CORRENDO na tela: é o
        // que faz alguém ir cobrar a estadia em vez de descobrir no fechamento.
        estadia: o.tipoEvento.geraCobranca
          ? valorDaEstadia({
              iniciouEm: o.iniciouEm!,
              terminouEm: null,
              valorHora: o.tipoEvento.valorHora,
            })
          : null,
      })),
    };
  }

  async resolverAlerta(id: string, usuarioId: string) {
    const a = await this.prisma.alertaOperacional.findUnique({ where: { id } });
    if (!a) throw new NotFoundException("Alerta não encontrado");
    // Desativa, não apaga: saber que o caminhão ficou 3h parado ontem é o dado
    // que explica o atraso de hoje.
    return this.prisma.alertaOperacional.update({
      where: { id },
      data: { resolvidoEm: new Date(), resolvidoPorId: usuarioId },
    });
  }

  /** O painel registra uma ocorrência que chegou por telefone. */
  async registrarOcorrencia(args: {
    viagemId: string;
    tipoEventoId: string;
    observacao?: string | null;
    usuarioId: string;
  }) {
    const [viagem, tipo] = await Promise.all([
      this.prisma.viagem.findUnique({
        where: { id: args.viagemId },
        select: { id: true },
      }),
      this.prisma.tipoEventoViagem.findUnique({ where: { id: args.tipoEventoId } }),
    ]);
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    if (!tipo) throw new NotFoundException("Tipo de evento não encontrado");

    return this.prisma.eventoViagem.create({
      data: {
        // `EventoViagem.id` não tem default: ele é o clientId que o app gera
        // pra idempotência do outbox. Registrando pelo painel, geramos um —
        // com prefixo, pra dar pra saber de onde veio olhando o banco.
        id: `painel-${randomUUID()}`,
        viagemId: args.viagemId,
        tipoEventoId: tipo.id,
        tipoSlug: tipo.slug,
        ocorridoEm: new Date(),
        // Ocorrência com duração começa a contar agora; o encerramento é outro
        // ato, feito por quem resolveu.
        ...(tipo.temDuracao ? { iniciouEm: new Date() } : {}),
        observacao: args.observacao ?? null,
      },
    });
  }

  async encerrarOcorrencia(id: string, usuarioId: string) {
    const o = await this.prisma.eventoViagem.findUnique({
      where: { id },
      include: { tipoEvento: { select: { valorHora: true, geraCobranca: true } } },
    });
    if (!o) throw new NotFoundException("Ocorrência não encontrada");
    if (o.terminouEm) return o;

    const atualizado = await this.prisma.eventoViagem.update({
      where: { id },
      data: { terminouEm: new Date(), encerradoPorId: usuarioId },
    });

    return {
      ...atualizado,
      estadia:
        o.tipoEvento.geraCobranca && o.iniciouEm
          ? valorDaEstadia({
              iniciouEm: o.iniciouEm,
              terminouEm: atualizado.terminouEm,
              valorHora: o.tipoEvento.valorHora,
            })
          : null,
    };
  }

  /**
   * Varre as viagens em curso e cria os alertas.
   *
   * A cada 5 minutos, que é o intervalo em que um supervisor consegue reagir —
   * mais curto vira ruído, mais longo e o alerta chega quando já não adianta.
   */
  @Cron("0 */5 * * * *", { name: "torre-alertas", timeZone: "America/Sao_Paulo" })
  async varrer(): Promise<void> {
    try {
      await comLockDeCron(this.prisma, "torre-alertas", async () => {
        await paraCadaConta(this.prisma, () => this.varrerDaVez());
      });
    } catch (e) {
      this.log.error(`falha na varredura da torre: ${(e as Error).message}`);
    }
  }

  private async varrerDaVez(): Promise<void> {
    const emCurso = await this.prisma.viagem.findMany({
      where: { status: "EM_ANDAMENTO" },
      select: {
        id: true,
        motoristaId: true,
        iniciadoEm: true,
        localCargaId: true,
        localDescargaId: true,
        motorista: { select: { nome: true } },
        localCarga: { select: { nome: true } },
        localDescarga: { select: { nome: true } },
        eventosViagem: { orderBy: { ocorridoEm: "desc" }, take: 1, select: { ocorridoEm: true } },
      },
    });
    if (emCurso.length === 0) return;

    const config = await this.prisma.configuracaoTracking.findFirst({
      select: { id: true },
    });
    const temTracking = Boolean(config);

    // Última posição de cada motorista em uma consulta só.
    const posicoes = await this.prisma.motoristaPosicao.groupBy({
      by: ["motoristaId"],
      where: { motoristaId: { in: emCurso.map((v) => v.motoristaId) } },
      _max: { capturadoEm: true },
    });
    const posPorMotorista = new Map(
      posicoes.map((p) => [p.motoristaId, p._max?.capturadoEm ?? null]),
    );

    for (const v of emCurso) {
      const limite = await this.limiteDoPar(v.localCargaId, v.localDescargaId);
      const dados: ViagemEmCurso = {
        id: v.id,
        motoristaId: v.motoristaId,
        motoristaNome: v.motorista?.nome ?? "Motorista",
        iniciadoEm: v.iniciadoEm ?? new Date(),
        localCargaNome: v.localCarga?.nome ?? null,
        localDescargaNome: v.localDescarga?.nome ?? null,
        ultimoEventoEm: v.eventosViagem[0]?.ocorridoEm ?? null,
        ultimaPosicaoEm: posPorMotorista.get(v.motoristaId) ?? null,
      };

      for (const a of avaliarViagem(dados, { limiteAtrasoMin: limite, temTracking })) {
        // `create` com o único parcial: se já existe alerta vivo do mesmo tipo
        // pra mesma viagem, o índice recusa e não empilha. É o que evita doze
        // avisos do mesmo problema por hora.
        try {
          const criado = await this.prisma.alertaOperacional.create({
            data: {
              tipo: a.tipo,
              severidade: a.severidade,
              viagemId: a.viagemId,
              motoristaId: a.motoristaId,
              titulo: a.titulo,
              detalhe: a.detalhe,
              dados: a.dados,
            },
          });
          // Só o que é grave vira sininho. Alerta de baixa severidade fica na
          // torre pra quem for olhar — notificar tudo é como se ensina alguém a
          // ignorar notificação.
          if (a.severidade === "ALTA") {
            await this.inbox.disparar({
              tipo: "nova-viagem",
              titulo: a.titulo,
              corpo: a.detalhe,
              dados: { viagemId: a.viagemId, alertaId: criado.id },
            });
          }
        } catch {
          // Já existia. É o caminho normal a cada 5 minutos.
        }
      }
    }
  }

  /**
   * Quanto a frota costuma levar naquele par de locais.
   *
   * Sai das viagens já finalizadas do mesmo trajeto — a régua é a operação real,
   * não um número inventado.
   */
  private async limiteDoPar(
    localCargaId: string | null,
    localDescargaId: string | null,
  ): Promise<number | null> {
    if (!localCargaId || !localDescargaId) return null;

    // A Viagem não guarda quando FOI finalizada — só quando foi iniciada. O
    // marco de fim que existe de verdade é o último evento registrado nela, que
    // é o que o motorista fez por último antes de fechar.
    const anteriores = await this.prisma.viagem.findMany({
      where: {
        localCargaId,
        localDescargaId,
        iniciadoEm: { not: null },
        status: { in: ["ENVIADA", "OK", "AJUSTADA"] },
      },
      select: {
        iniciadoEm: true,
        eventosViagem: { orderBy: { ocorridoEm: "desc" }, take: 1, select: { ocorridoEm: true } },
      },
      orderBy: { data: "desc" },
      take: 30,
    });

    const duracoes = anteriores
      .map((v) => {
        const fim = v.eventosViagem[0]?.ocorridoEm;
        return v.iniciadoEm && fim
          ? Math.floor((fim.getTime() - v.iniciadoEm.getTime()) / 60_000)
          : null;
      })
      // Acima de 24h não é viagem, é viagem esquecida aberta — e usar isso na
      // mediana levantaria o limite a ponto de nunca mais alertar ninguém.
      .filter((d): d is number => d != null && d > 0 && d < 24 * 60);

    return limiteDeAtrasoMin(medianaMinutos(duracoes), duracoes.length);
  }
}
