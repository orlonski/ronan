import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminInboxService } from "../inbox/inbox.service";
import { comoSistema, contaIdAtual } from "../../common/conta/conta-context";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { modulosDaConta } from "../../common/conta/teto-da-conta";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import {
  avaliarViagem,
  decidirAlerta,
  dentroDaJanelaDaTorre,
  limiteDeAtrasoMin,
  medianaMinutos,
  valorDaEstadia,
  LIMIARES_TORRE_PADRAO,
  type AlertaDetectado,
  type LimiaresTorre,
  type ViagemEmCurso,
} from "../../common/torre";

export type AtualizarConfigTorreInput = {
  paradaLongaMin?: number;
  paradaLongaAltaMin?: number;
  viagemEsquecidaMin?: number;
  semSinalMin?: number;
  horaInicio?: number;
  horaFim?: number;
  notificaDomingo?: boolean;
  fecharAbandonadaHoras?: number;
};

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
   * Varre as viagens em curso, mantém os alertas em dia e avisa UMA vez.
   *
   * A cada 5 minutos, que é o intervalo em que um supervisor consegue reagir —
   * mais curto vira ruído, mais longo e o alerta chega quando já não adianta.
   */
  @Cron("0 */5 * * * *", { name: "torre-alertas", timeZone: "America/Sao_Paulo" })
  async varrer(): Promise<void> {
    try {
      await comLockDeCron(this.prisma, "torre-alertas", async () => {
        await paraCadaConta(this.prisma, (contaId) => this.varrerDaVez(contaId));
      });
    } catch (e) {
      this.log.error(`falha na varredura da torre: ${(e as Error).message}`);
    }
  }

  /**
   * A régua desta conta, pra tela de configuração. Lazy-create no primeiro
   * acesso, igual às outras configs — nasce com os números que estavam
   * chumbados no código, então abrir a tela não muda nada por si só.
   */
  async config() {
    return this.prisma.configuracaoTorre.upsert({
      where: { contaId: contaIdAtual() },
      update: {},
      create: {},
    });
  }

  async atualizarConfig(input: AtualizarConfigTorreInput, usuarioId: string) {
    if (input.paradaLongaAltaMin != null && input.paradaLongaMin != null) {
      if (input.paradaLongaAltaMin < input.paradaLongaMin) {
        throw new BadRequestException(
          "O tempo pra virar urgente não pode ser menor que o tempo do primeiro aviso.",
        );
      }
    }
    if (input.viagemEsquecidaMin != null && input.paradaLongaAltaMin != null) {
      if (input.viagemEsquecidaMin <= input.paradaLongaAltaMin) {
        throw new BadRequestException(
          "O teto de idade tem que ser maior que o tempo pra virar urgente — senão nenhum alerta chega a ser urgente.",
        );
      }
    }
    if (input.horaInicio != null && input.horaFim != null && input.horaInicio === input.horaFim) {
      throw new BadRequestException("A janela de aviso não pode começar e terminar na mesma hora.");
    }
    return this.prisma.configuracaoTorre.upsert({
      where: { contaId: contaIdAtual() },
      update: { ...input, alteradoPorId: usuarioId },
      create: { ...input, alteradoPorId: usuarioId },
    });
  }

  /** Os números desta conta. Sem linha na tabela, valem os defaults do código. */
  async limiares(): Promise<LimiaresTorre> {
    const c = await this.prisma.configuracaoTorre.findFirst();
    if (!c) return LIMIARES_TORRE_PADRAO;
    return {
      paradaLongaMin: c.paradaLongaMin,
      paradaLongaAltaMin: c.paradaLongaAltaMin,
      viagemEsquecidaMin: c.viagemEsquecidaMin,
      semSinalMin: c.semSinalMin,
      horaInicio: c.horaInicio,
      horaFim: c.horaFim,
      notificaDomingo: c.notificaDomingo,
    };
  }

  private async varrerDaVez(contaId: string): Promise<void> {
    // Conta que não contratou a torre não tem torre: varrer geraria alerta que
    // ninguém pode ver, e — pior — notificação de uma tela que some do menu.
    const modulos = await modulosDaConta(this.prisma, contaId);
    if (!modulos.has("torre")) return;

    const agora = new Date();
    const limiares = await this.limiares();

    // Alerta de viagem que já não está em andamento morre aqui. Antes disso,
    // NADA resolvia alerta sozinho: a viagem era finalizada, o cron parava de
    // gerar novos, e os antigos ficavam na tela pra sempre.
    await this.prisma.alertaOperacional.updateMany({
      where: { resolvidoEm: null, viagem: { status: { not: "EM_ANDAMENTO" } } },
      data: { resolvidoEm: agora, resolvidoAuto: true },
    });

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

    // Os alertas que já estão vivos, numa consulta só. Antes era um findFirst
    // por alerta — e, antes ainda, um `create` cego confiando num índice que
    // não deduplicava nada.
    const vivos = await this.prisma.alertaOperacional.findMany({
      where: { resolvidoEm: null, viagemId: { in: emCurso.map((v) => v.id) } },
      select: { id: true, viagemId: true, tipo: true, severidade: true, notificadoEm: true },
    });
    const vivoPorChave = new Map(vivos.map((a) => [`${a.viagemId}|${a.tipo}`, a]));

    const aindaVale = new Set<string>();
    const paraNotificar: AlertaDetectado[] = [];
    // Memo do par de locais: `limiteDoPar` é uma consulta de 30 viagens e a
    // frota inteira costuma rodar meia dúzia de trajetos.
    const memoLimite = new Map<string, number | null>();

    for (const v of emCurso) {
      const chavePar = `${v.localCargaId ?? ""}|${v.localDescargaId ?? ""}`;
      let limite = memoLimite.get(chavePar);
      if (limite === undefined) {
        limite = await this.limiteDoPar(v.localCargaId, v.localDescargaId);
        memoLimite.set(chavePar, limite);
      }

      const dados: ViagemEmCurso = {
        id: v.id,
        motoristaId: v.motoristaId,
        motoristaNome: v.motorista?.nome ?? "Motorista",
        iniciadoEm: v.iniciadoEm ?? agora,
        localCargaNome: v.localCarga?.nome ?? null,
        localDescargaNome: v.localDescarga?.nome ?? null,
        ultimoEventoEm: v.eventosViagem[0]?.ocorridoEm ?? null,
        ultimaPosicaoEm: posPorMotorista.get(v.motoristaId) ?? null,
      };

      for (const a of avaliarViagem(dados, {
        limiteAtrasoMin: limite,
        temTracking,
        limiares,
        agora,
      })) {
        const chave = `${a.viagemId}|${a.tipo}`;
        aindaVale.add(chave);
        const vivo = vivoPorChave.get(chave) ?? null;
        const { acao, notificar } = decidirAlerta(a, vivo);
        const carimbo = notificar
          ? { notificadoEm: agora, severidadeNotificada: a.severidade }
          : {};

        // ATUALIZA a linha viva em vez de criar outra. O desenho antigo tinha
        // o `create` como única escrita, então nem deduplicava (o índice não
        // funcionava) nem conseguia escalar a severidade.
        let alertaId: string;
        if (acao === "criar") {
          const criado = await this.prisma.alertaOperacional.create({
            data: {
              tipo: a.tipo,
              severidade: a.severidade,
              viagemId: a.viagemId,
              motoristaId: a.motoristaId,
              titulo: a.titulo,
              detalhe: a.detalhe,
              dados: a.dados,
              ...carimbo,
            },
          });
          alertaId = criado.id;
        } else {
          await this.prisma.alertaOperacional.update({
            where: { id: vivo!.id },
            data: {
              severidade: a.severidade,
              titulo: a.titulo,
              detalhe: a.detalhe,
              dados: a.dados,
              ...carimbo,
            },
          });
          alertaId = vivo!.id;
        }

        if (notificar) {
          paraNotificar.push({ ...a, dados: { ...(a.dados as object), alertaId } });
        }
      }
    }

    // A condição passou: o motorista voltou a registrar evento, o GPS voltou, a
    // viagem entrou na média. O alerta some da torre sozinho — deixar o card
    // ali obrigaria o supervisor a "resolver" na mão um problema que acabou.
    const venceram = vivos.filter((a) => !aindaVale.has(`${a.viagemId}|${a.tipo}`));
    if (venceram.length > 0) {
      await this.prisma.alertaOperacional.updateMany({
        where: { id: { in: venceram.map((a) => a.id) } },
        data: { resolvidoEm: agora, resolvidoAuto: true },
      });
    }

    await this.notificar(paraNotificar, limiares, agora);
  }

  /**
   * Uma notificação por varredura, não uma por viagem.
   *
   * Três caminhões parados ao mesmo tempo são um recado só ("3 viagens
   * precisam de atenção"), porque o supervisor vai abrir a mesma tela pros
   * três. Fora da janela operacional não sai nada: o alerta já está na torre
   * pra quem chegar, e ninguém precisa ser acordado às 3 da manhã por um
   * caminhão parado.
   */
  private async notificar(
    alertas: AlertaDetectado[],
    limiares: LimiaresTorre,
    agora: Date,
  ): Promise<void> {
    if (alertas.length === 0) return;
    if (!dentroDaJanelaDaTorre(agora, limiares)) return;

    const primeiro = alertas[0]!;
    const unico = alertas.length === 1;

    try {
      await this.inbox.disparar({
        // Era `nova-viagem` — o único tipo que existia na união quando a torre
        // nasceu. O sininho dizia "Nova viagem" pra um caminhão parado há três
        // dias, com ícone de lançamento, e o clique levava pra uma tela que não
        // tem ação nenhuma pra resolver alerta.
        tipo: "alerta-torre",
        titulo: unico
          ? primeiro.titulo
          : `${alertas.length} viagens precisam de atenção na torre`,
        corpo: unico
          ? primeiro.detalhe
          : alertas
              .slice(0, 3)
              .map((a) => a.titulo)
              .join(" · "),
        dados: unico
          ? { viagemId: primeiro.viagemId, ...(primeiro.dados as object) }
          : { viagemIds: alertas.map((a) => a.viagemId) },
        // Alerta operacional é trabalho de quem opera a torre. Mandar pro
        // financeiro é ruído por construção — e ele nem consegue abrir a tela.
        permissao: "programacao.ver",
      });
    } catch (e) {
      this.log.warn(`torre: notificação não saiu: ${(e as Error).message}`);
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

  /**
   * Alerta resolvido também vence.
   *
   * Mantém o histórico recente (é ele que explica o atraso de hoje) e larga o
   * resto. A tabela nasceu sem expurgo e, com o dedup quebrado, acumulou
   * centenas de linhas por viagem esquecida.
   */
  @Cron("0 30 4 * * *", { name: "expurgo-alertas-torre", timeZone: "America/Sao_Paulo" })
  async expurgarAlertas(): Promise<void> {
    try {
      await comLockDeCron(this.prisma, "expurgo-alertas-torre", async () => {
        const corte = new Date(Date.now() - 90 * 86_400_000);
        const { count } = await comoSistema(() =>
          this.prisma.alertaOperacional.deleteMany({
            where: { resolvidoEm: { not: null, lt: corte } },
          }),
        );
        if (count > 0) this.log.log(`expurgo da torre: ${count} alertas resolvidos apagados`);
      });
    } catch (e) {
      this.log.error(`falha no expurgo de alertas: ${(e as Error).message}`);
    }
  }
}
