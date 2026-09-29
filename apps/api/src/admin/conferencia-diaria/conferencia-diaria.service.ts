import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import {
  BOTOES_CONFERENCIA_DIARIA,
  descreverRegraConferencia,
  payloadConferencia,
  type AtualizarConfigConferenciaDiaria,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import type { AuthAdminUser } from "../../auth/types";
import { comoSistema, contaIdAtual } from "../../common/conta/conta-context";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { modulosDaConta } from "../../common/conta/teto-da-conta";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { feriadoAlcanca } from "../../common/ponto-espelho";
import { diaDaSemanaEmSaoPaulo, horaEmSaoPaulo, inicioDoDiaData } from "../../common/timezone";
import { VINCULO_VIVO } from "../../common/vinculo";
import { diaTextoConferencia, textoPerguntaConferencia } from "../../common/conferencia-resposta";
import { EnvioWhatsappService } from "../../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../../whatsapp/sessao.service";
import { MotoristasService } from "../motoristas/motoristas.service";
import { SugestoesGestorService } from "./sugestoes-gestor.service";
import {
  avaliarConferenciaDiaria,
  hojeYmd,
  somarDias,
  type ConfigRegraConferencia,
  type EvidenciasConferencia,
  type MotoristaParaConferencia,
} from "../../common/conferencia-diaria";

type Config = Awaited<ReturnType<ConferenciaDiariaService["config"]>>;

/** Por que a regra diz "pergunte" mas não há como perguntar. É o "sem canal" da lista. */
export type SemCanal = "SEM_TELEFONE" | "NAO_ACEITA_WHATSAPP" | "PAROU" | "INALCANCAVEL";

export type ItemConferencia = {
  motoristaId: string;
  nome: string;
  deveriaPerguntar: boolean;
  motivo: string;
  evidencias: EvidenciasConferencia;
  /** Preenchido quando o motorista não pode receber a pergunta pelo WhatsApp. */
  semCanal: SemCanal | null;
};

/** Estados em que a pergunta CONTA como feita (entra no intervalo mínimo e no máximo semanal). */
const ESTADOS_PERGUNTADOS = ["SOMBRA", "PENDENTE", "ENVIADA", "RESPONDIDA", "EXPIRADA"] as const;

/** Depois de quantas horas do horário configurado uma pergunta que não saiu deixa de sair. */
const HORAS_DE_TOLERANCIA_ENVIO = 3;
/** Lembrete só em horário de gente acordada. */
const LEMBRETE_HORA_MIN = 7;
const LEMBRETE_HORA_MAX = 21;
/** O teto de envios por hora quando a linha da plataforma ainda não existe. */
const TETO_HORA_PADRAO = 60;

/** Quanto do histórico de viagens/perguntas o cálculo carrega. */
const JANELA_VIAGENS_DIAS = 65;
const JANELA_PERGUNTAS_DIAS = 35;

const dataParaYmd = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Conferência diária de viagens.
 *
 * O job identifica quem provavelmente deixou de lançar viagem. Em modo SOMBRA só
 * REGISTRA quem seria perguntado. Em modo ENVIANDO (e conferência ativa) manda a
 * pergunta pelo WhatsApp — template da Meta com quatro botões — e guarda o `wamid`.
 * A resposta é tratada em `ConferenciaRespostaService`.
 *
 * ⚠️ Nada aqui inativa motorista. Inativar vínculo só acontece em
 * `aprovarSugestao`, com usuário humano (há teste de invariante lendo este arquivo).
 */
@Injectable()
export class ConferenciaDiariaService {
  private readonly log = new Logger("ConferenciaDiariaService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly envio: EnvioWhatsappService,
    private readonly sugestoes: SugestoesGestorService,
    private readonly motoristas: MotoristasService,
  ) {}

  // ─── Config ────────────────────────────────────────────────────────────

  async config() {
    return this.prisma.configuracaoConferenciaDiaria.upsert({
      where: { contaId: contaIdAtual() },
      update: {},
      create: {},
    });
  }

  async atualizarConfig(input: AtualizarConfigConferenciaDiaria, usuarioId: string) {
    const antes = await this.config();
    const depois = { ...antes, ...input };

    if (depois.quemEntra === "SO_MODALIDADES") {
      if (depois.modalidadeIds.length === 0 && depois.transportadoraIds.length === 0) {
        throw new BadRequestException(
          "Você escolheu perguntar só a algumas modalidades ou transportadoras — escolha pelo menos uma.",
        );
      }
    }
    if (depois.intervaloMinimoDias > 7 && depois.maxPerguntasPorSemana > 1) {
      // Intervalo maior que a semana já limita a 1 por semana: o "máximo por
      // semana" maior que 1 viraria promessa falsa na tela.
      throw new BadRequestException(
        "Com intervalo maior que 7 dias, cada motorista recebe no máximo 1 pergunta por semana. Ajuste o máximo por semana para 1.",
      );
    }
    if (depois.reenviar && depois.horasParaLembrar >= depois.horasParaExpirar) {
      throw new BadRequestException(
        "O lembrete tem que sair antes de a pergunta expirar: aumente as horas pra expirar ou diminua as horas pro lembrete.",
      );
    }
    if (depois.diasDoJob.length === 0 || depois.diasConsiderados.length === 0) {
      throw new BadRequestException("Escolha pelo menos um dia em que roda e um dia esperado de viagem.");
    }
    if (input.modalidadeIds?.length) {
      const n = await this.prisma.modalidadeMotorista.count({ where: { id: { in: input.modalidadeIds } } });
      if (n !== new Set(input.modalidadeIds).size) {
        throw new BadRequestException("Alguma modalidade escolhida não existe nesta empresa.");
      }
    }
    if (input.transportadoraIds?.length) {
      const n = await this.prisma.transportadora.count({ where: { id: { in: input.transportadoraIds } } });
      if (n !== new Set(input.transportadoraIds).size) {
        throw new BadRequestException("Alguma transportadora escolhida não existe nesta empresa.");
      }
    }

    const dados = {
      ...input,
      ...(input.mensagemAoParar !== undefined ? { mensagemAoParar: input.mensagemAoParar?.trim() || null } : {}),
      ...(input.contatoEmpresa !== undefined ? { contatoEmpresa: input.contatoEmpresa?.trim() || null } : {}),
      ...(input.diasDoJob ? { diasDoJob: [...input.diasDoJob].sort((a, b) => a - b) } : {}),
      ...(input.diasConsiderados
        ? { diasConsiderados: [...input.diasConsiderados].sort((a, b) => a - b) }
        : {}),
      alteradoPorId: usuarioId,
    };
    const salvo = await this.prisma.configuracaoConferenciaDiaria.update({
      where: { id: antes.id },
      data: dados,
    });

    const campos = (c: Config | typeof salvo): Record<string, unknown> => {
      const { id: _id, contaId: _c, alteradoEm: _e, alteradoPorId: _p, ...resto } = c;
      return resto;
    };
    await this.auditoria.logDiff(
      {
        usuarioId,
        entidade: "ConfiguracaoConferenciaDiaria",
        entidadeId: salvo.id,
        acao: "CONFERENCIA_CONFIG_ALTERADA",
      },
      campos(antes),
      campos(salvo),
    );
    return salvo;
  }

  // ─── Lista e simulação ─────────────────────────────────────────────────

  /** O que o job já gravou hoje: quem seria (ou foi) perguntado e quem foi poupado, com o porquê. */
  async listaDoDia() {
    const dia = inicioDoDiaData(new Date());
    const linhas = await this.prisma.conferenciaDiaria.findMany({
      where: { dia },
      include: { motorista: { select: { nome: true } } },
      orderBy: { motorista: { nome: "asc" } },
    });
    return {
      dia: dataParaYmd(dia),
      rodou: linhas.length > 0,
      itens: linhas.map((l) => {
        const snap = l.snapshot as { evidencias?: EvidenciasConferencia; deveriaPerguntar?: boolean } | null;
        const semCanal = (l.suprimidaPor as SemCanal | null) ?? null;
        return {
          motoristaId: l.motoristaId,
          nome: l.motorista.nome,
          // SUPRIMIDA sem canal ainda é "a regra mandou perguntar": a lista mostra
          // com a marca pra contatar por outro meio.
          deveriaPerguntar: l.estado === "SUPRIMIDA" ? snap?.deveriaPerguntar === true && semCanal != null : true,
          estado: l.estado,
          opcao: l.opcao,
          semCanal,
          erroEnvio: l.erroEnvio,
          motivo: l.motivo,
          evidencias: snap?.evidencias ?? null,
        };
      }),
    };
  }

  /** Calcula AGORA com a regra salva, sem gravar nada. */
  async simular() {
    const cfg = await this.config();
    const agora = new Date();
    const itens = await this.calcular(cfg, agora);
    return {
      dia: hojeYmd(agora),
      gravado: false,
      regraEmVigor: this.descricao(cfg),
      itens,
    };
  }

  // ─── Job ───────────────────────────────────────────────────────────────

  /** A cada 10 minutos; a hora, o dia e a idempotência decidem se a conta roda. */
  @Cron("0 */10 * * * *", { name: "conferencia-diaria", timeZone: "America/Sao_Paulo" })
  async varrer(): Promise<void> {
    await comLockDeCron(this.prisma, "conferencia-diaria", async () => {
      await paraCadaConta(this.prisma, async (contaId) => {
        await this.rodarDaVez(contaId, new Date());
      });
    });
  }

  /**
   * Uma batida da conta: grava o dia (se for a vez), manda o que ficou pendente,
   * lembra/expira e mantém a fila do gestor. Público pra teste. Devolve quantas
   * linhas gravou no dia (0 = não era a vez).
   */
  async rodarDaVez(contaId: string, agora: Date): Promise<number> {
    const modulos = await modulosDaConta(this.prisma, contaId);
    if (!modulos.has("conferencia")) return 0;

    const cfg = await this.prisma.configuracaoConferenciaDiaria.findFirst();
    if (!cfg) return 0;

    let gravadas = 0;
    if (cfg.ativo) gravadas = await this.gravarODia(cfg, contaId, agora);

    // Cada etapa isolada: uma falha (Meta fora do ar) não pode impedir a
    // expiração nem a fila do gestor.
    const etapas: [string, () => Promise<unknown>][] = [
      ["envio dos pendentes", () => this.enviarPendentes(cfg, agora)],
      ["lembrete e expiração", () => this.lembrarEExpirar(cfg, agora)],
      ["fila do gestor", () => this.sugestoes.manter(agora)],
    ];
    for (const [nome, fn] of etapas) {
      try {
        await fn();
      } catch (e) {
        this.log.error(`Conferência diária conta ${contaId}: falha em ${nome}: ${(e as Error).message}`);
      }
    }
    return gravadas;
  }

  /** O envio real só acontece com a conferência ativa, em modo ENVIANDO e com a Meta configurada. */
  private async podeEnviar(cfg: Config): Promise<{ ok: boolean; motivo?: string }> {
    if (!cfg.ativo) return { ok: false, motivo: "conferência desligada" };
    if (cfg.modo !== "ENVIANDO") return { ok: false, motivo: "modo sombra" };
    const d = await this.envio.disponivel("CONFERENCIA_DIARIA");
    return d.ok ? { ok: true } : { ok: false, motivo: d.motivo };
  }

  private async gravarODia(cfg: Config, contaId: string, agora: Date): Promise<number> {
    // Janela: a HORA configurada inteira (o cron tem 6 batidas nela). Se a
    // primeira falhar (deploy no minuto), a seguinte cobre — a idempotência
    // abaixo impede rodar duas vezes.
    if (horaEmSaoPaulo(agora) !== cfg.horaEnvio) return 0;
    if (!cfg.diasDoJob.includes(diaDaSemanaEmSaoPaulo(agora))) return 0;

    const dia = inicioDoDiaData(agora);
    const jaRodou = await this.prisma.conferenciaDiaria.count({ where: { dia } });
    if (jaRodou > 0) return 0;

    const itens = await this.calcular(cfg, agora);
    if (itens.length === 0) return 0;

    const pode = await this.podeEnviar(cfg);
    const regra = this.descricao(cfg);
    const { count } = await this.prisma.conferenciaDiaria.createMany({
      skipDuplicates: true,
      data: itens.map((i) => {
        const semCanal = i.deveriaPerguntar ? i.semCanal : null;
        const estado = !i.deveriaPerguntar || semCanal
          ? ("SUPRIMIDA" as const)
          : pode.ok
            ? ("PENDENTE" as const)
            : ("SOMBRA" as const);
        return {
          contaId,
          motoristaId: i.motoristaId,
          dia,
          estado,
          suprimidaPor: semCanal,
          motivo: i.motivo,
          snapshot: {
            modoConfigurado: cfg.modo,
            nadaEnviado: !pode.ok,
            ...(pode.ok ? {} : { semEnvioPorque: pode.motivo }),
            deveriaPerguntar: i.deveriaPerguntar,
            semCanal: i.semCanal,
            regraEmVigor: regra,
            config: this.configDaRegra(cfg),
            evidencias: i.evidencias,
          } as unknown as Prisma.InputJsonValue,
        };
      }),
    });
    this.log.log(
      `Conferência diária (${pode.ok ? "enviando" : "sombra"}) conta ${contaId}: ${count} motoristas avaliados, ${
        itens.filter((i) => i.deveriaPerguntar && !i.semCanal).length
      } a perguntar, ${itens.filter((i) => i.deveriaPerguntar && i.semCanal).length} sem canal.`,
    );
    return count;
  }

  // ─── Envio ─────────────────────────────────────────────────────────────

  /**
   * Quantos envios ainda cabem nesta hora pelo TETO GLOBAL (todas as empresas
   * juntas) — o freio de custo, no molde do `maxCodigosPorHora`. Conta as
   * mensagens da rota que saíram na última hora, inclusive as que falharam.
   */
  private async vagasNestaHora(agora: Date): Promise<number> {
    const plataforma = await comoSistema(() =>
      this.prisma.configuracaoPlataforma.findUnique({
        where: { id: "singleton" },
        select: { maxConferenciasPorHora: true },
      }),
    );
    const teto = plataforma?.maxConferenciasPorHora ?? TETO_HORA_PADRAO;
    const usadas = await comoSistema(() =>
      this.prisma.whatsappMensagem.count({
        where: {
          rota: "CONFERENCIA_DIARIA",
          direcao: "SAIDA",
          criadoEm: { gte: new Date(agora.getTime() - 3_600_000) },
        },
      }),
    );
    return Math.max(0, teto - usadas);
  }

  /** O que a linha precisa pra montar a pergunta (ou o lembrete). */
  private async pergunta(
    conferencia: { id: string; snapshot: Prisma.JsonValue; dia: Date },
    telefone: string,
  ) {
    const snap = conferencia.snapshot as { evidencias?: EvidenciasConferencia } | null;
    const ymdDia = dataParaYmd(conferencia.dia);
    // O dia perguntado é o último dia ESPERADO sem viagem; sem isso, ontem.
    const ref = snap?.evidencias?.diasEsperadosVerificados?.[0] ?? somarDias(ymdDia, -1);
    const diaTxt = diaTextoConferencia(ref);
    return this.envio.tentarEnviar({
      destino: { tipo: "TELEFONE", numero: SessaoService.normalizar(telefone) },
      rota: "CONFERENCIA_DIARIA",
      texto: textoPerguntaConferencia(diaTxt),
      params: [diaTxt],
      payloads: BOTOES_CONFERENCIA_DIARIA.map((b) => payloadConferencia(conferencia.id, b.opcao)),
    });
  }

  /**
   * Manda as perguntas que ficaram PENDENTES hoje (o dia acabou de ser gravado,
   * o teto por hora segurou, ou a Meta oscilou). Retoma na batida seguinte; passada
   * a tolerância, a linha vira FALHOU — perguntar "ontem você não teve viagens" às
   * 15h seria estranho.
   */
  async enviarPendentes(cfg: Config, agora: Date): Promise<number> {
    if (cfg.modo !== "ENVIANDO" || !cfg.ativo) return 0;
    const dia = inicioDoDiaData(agora);
    const hora = horaEmSaoPaulo(agora);
    if (hora < cfg.horaEnvio) return 0;

    const pendentes = await this.prisma.conferenciaDiaria.findMany({
      where: { dia, estado: "PENDENTE" },
      select: {
        id: true,
        snapshot: true,
        dia: true,
        motorista: {
          select: {
            id: true,
            telefone: true,
            aceitaWhatsapp: true,
            receberConferenciaDiaria: true,
            whatsappInalcancavelEm: true,
          },
        },
      },
      orderBy: { criadoEm: "asc" },
      take: 500,
    });
    if (pendentes.length === 0) return 0;

    if (hora > cfg.horaEnvio + HORAS_DE_TOLERANCIA_ENVIO) {
      await this.prisma.conferenciaDiaria.updateMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        data: { estado: "FALHOU", erroEnvio: "Não saiu no horário (teto de envios por hora ou Meta indisponível)." },
      });
      return 0;
    }

    const pode = await this.podeEnviar(cfg);
    if (!pode.ok) return 0;
    let vagas = await this.vagasNestaHora(agora);
    let enviadas = 0;

    for (const p of pendentes) {
      if (vagas <= 0) break;
      const m = p.motorista;
      // A situação do motorista pode ter mudado desde que a linha foi gravada
      // (tocou "Parar" à noite, o número passou a falhar): confere de novo.
      const semCanal = this.semCanalDe(m);
      if (semCanal || !m.telefone) {
        await this.prisma.conferenciaDiaria.update({
          where: { id: p.id },
          data: { estado: "SUPRIMIDA", suprimidaPor: semCanal ?? "SEM_TELEFONE" },
        });
        continue;
      }
      vagas--;
      const r = await this.pergunta(p, m.telefone);
      if (r.enviado) {
        await this.prisma.conferenciaDiaria.update({
          where: { id: p.id },
          data: { estado: "ENVIADA", wamid: r.idExterno, enviadaEm: new Date(), erroEnvio: null },
        });
        enviadas++;
      } else if (r.erro?.tipo === "TRANSPORTE") {
        // Meta fora do ar: continua PENDENTE e tenta na batida seguinte.
        await this.prisma.conferenciaDiaria.update({
          where: { id: p.id },
          data: { erroEnvio: `${r.erro.codigo}: ${r.erro.detalhe}`.slice(0, 500) },
        });
      } else {
        await this.prisma.conferenciaDiaria.update({
          where: { id: p.id },
          data: { estado: "FALHOU", erroEnvio: `${r.erro?.codigo ?? "?"}: ${r.erro?.detalhe ?? ""}`.slice(0, 500) },
        });
      }
    }
    if (enviadas > 0) this.log.log(`Conferência diária: ${enviadas} pergunta(s) enviada(s).`);
    return enviadas;
  }

  /**
   * Expira a pergunta sem resposta e, se a empresa quis, manda UM lembrete.
   * O lembrete é a mesma pergunta com os mesmos botões (o payload é o mesmo id).
   */
  async lembrarEExpirar(cfg: Config, agora: Date): Promise<{ expiradas: number; lembretes: number }> {
    const limiteExpirar = new Date(agora.getTime() - cfg.horasParaExpirar * 3_600_000);
    const { count: expiradas } = await this.prisma.conferenciaDiaria.updateMany({
      where: { estado: "ENVIADA", enviadaEm: { lt: limiteExpirar } },
      data: { estado: "EXPIRADA" },
    });

    let lembretes = 0;
    const hora = horaEmSaoPaulo(agora);
    if (
      !cfg.reenviar ||
      hora < LEMBRETE_HORA_MIN ||
      hora > LEMBRETE_HORA_MAX ||
      !(await this.podeEnviar(cfg)).ok
    ) {
      return { expiradas, lembretes };
    }
    const limiteLembrar = new Date(agora.getTime() - cfg.horasParaLembrar * 3_600_000);
    const candidatos = await this.prisma.conferenciaDiaria.findMany({
      where: {
        estado: "ENVIADA",
        lembreteEnviadoEm: null,
        enviadaEm: { lte: limiteLembrar, gt: limiteExpirar },
      },
      select: {
        id: true,
        snapshot: true,
        dia: true,
        enviadaEm: true,
        motorista: {
          select: {
            id: true,
            telefone: true,
            aceitaWhatsapp: true,
            receberConferenciaDiaria: true,
            whatsappInalcancavelEm: true,
          },
        },
      },
      take: 500,
    });
    let vagas = candidatos.length > 0 ? await this.vagasNestaHora(agora) : 0;
    for (const c of candidatos) {
      if (vagas <= 0) break;
      const m = c.motorista;
      if (this.semCanalDe(m) || !m.telefone) continue;
      // Já lançou desde a pergunta? Então o lembrete só incomodaria.
      const lancou = await this.prisma.viagem.findFirst({
        where: { motoristaId: m.id, sincronizadoEm: { gt: c.enviadaEm ?? c.dia } },
        select: { id: true },
      });
      if (lancou) continue;
      vagas--;
      const r = await this.pergunta(c, m.telefone);
      // Marca sempre: UM lembrete só, mesmo que o envio falhe (não insiste).
      await this.prisma.conferenciaDiaria.update({
        where: { id: c.id },
        data: {
          lembreteEnviadoEm: new Date(),
          ...(r.enviado ? { lembreteWamid: r.idExterno } : {}),
        },
      });
      if (r.enviado) lembretes++;
    }
    return { expiradas, lembretes };
  }

  private semCanalDe(m: {
    telefone: string | null;
    aceitaWhatsapp: boolean;
    receberConferenciaDiaria: boolean;
    whatsappInalcancavelEm: Date | null;
  }): SemCanal | null {
    if (!m.telefone) return "SEM_TELEFONE";
    if (!m.aceitaWhatsapp) return "NAO_ACEITA_WHATSAPP";
    if (!m.receberConferenciaDiaria) return "PAROU";
    if (m.whatsappInalcancavelEm) return "INALCANCAVEL";
    return null;
  }

  // ─── Fila do gestor ────────────────────────────────────────────────────

  /** As sugestões, abertas primeiro. `status` vazio = só as abertas. */
  async listarSugestoes(filtro: { status?: string; tipo?: string }) {
    const linhas = await this.prisma.sugestaoGestor.findMany({
      where: {
        status: (filtro.status as Prisma.SugestaoGestorWhereInput["status"]) ?? "ABERTA",
        ...(filtro.tipo ? { tipo: filtro.tipo as Prisma.SugestaoGestorWhereInput["tipo"] } : {}),
      },
      orderBy: { criadaEm: "desc" },
      take: 200,
      include: { motorista: { select: { id: true, nome: true, ativo: true } } },
    });
    // Acerto ABERTO do motorista: o aviso antes de inativar (não bloqueia).
    const inativar = linhas.filter((l) => l.tipo === "INATIVAR_VINCULO" && l.motoristaId);
    const comAcertoAberto = new Set<string>();
    if (inativar.length > 0) {
      const acertos = await this.prisma.acertoMotorista.findMany({
        where: { motoristaId: { in: inativar.map((l) => l.motoristaId!) }, status: "ABERTO" },
        select: { motoristaId: true },
      });
      for (const a of acertos) comAcertoAberto.add(a.motoristaId);
    }
    return linhas.map((l) => ({
      id: l.id,
      tipo: l.tipo,
      status: l.status,
      resumo: l.resumo,
      evidencia: l.evidencia,
      criadaEm: l.criadaEm,
      decididaEm: l.decididaEm,
      motivoDecisao: l.motivoDecisao,
      motorista: l.motorista ? { id: l.motorista.id, nome: l.motorista.nome, ativo: l.motorista.ativo } : null,
      acertoAberto: l.motoristaId ? comAcertoAberto.has(l.motoristaId) : false,
    }));
  }

  /** Quem saiu da conferência (parou) ou não tem canal (número que não entrega). */
  async listarSemCanal() {
    const linhas = await this.prisma.motorista.findMany({
      where: {
        ...VINCULO_VIVO,
        status: "APROVADO",
        OR: [{ receberConferenciaDiaria: false }, { whatsappInalcancavelEm: { not: null } }],
      },
      select: {
        id: true,
        nome: true,
        receberConferenciaDiaria: true,
        whatsappInalcancavelEm: true,
      },
      orderBy: { nome: "asc" },
    });
    return linhas.map((m) => ({
      motoristaId: m.id,
      nome: m.nome,
      parou: !m.receberConferenciaDiaria,
      inalcancavelDesde: m.whatsappInalcancavelEm,
    }));
  }

  /**
   * Aprova a sugestão. ⚠️ ÚNICO ponto do módulo em que um vínculo é inativado, e
   * só com usuário humano: exige `conferencia-diaria.decidir` (o controller) E
   * `motoristas.editar` (aqui), e passa pelo `MotoristasService.update` — a
   * regra de escopo e o resto do cadastro continuam valendo.
   */
  async aprovarSugestao(id: string, usuario: AuthAdminUser, motivo?: string) {
    const s = await this.sugestaoAberta(id);
    if (s.tipo === "INATIVAR_VINCULO") {
      if (!usuario.permissoes.includes("motoristas.editar")) {
        throw new ForbiddenException(
          "Pra inativar o vínculo você também precisa da permissão de editar motoristas.",
        );
      }
      if (!s.motoristaId) throw new BadRequestException("Sugestão sem motorista.");
      await this.motoristas.update(s.motoristaId, { ativo: false }, usuario.escopo, usuario.id);
    }
    return this.decidir(s.id, "APROVADA", usuario.id, motivo);
  }

  async recusarSugestao(id: string, usuario: AuthAdminUser, motivo?: string) {
    const s = await this.sugestaoAberta(id);
    return this.decidir(s.id, "RECUSADA", usuario.id, motivo);
  }

  private async sugestaoAberta(id: string) {
    const s = await this.prisma.sugestaoGestor.findUnique({ where: { id } });
    if (!s) throw new NotFoundException("Sugestão não encontrada.");
    if (s.status !== "ABERTA") throw new ConflictException("Esta sugestão já foi decidida.");
    return s;
  }

  private async decidir(id: string, status: "APROVADA" | "RECUSADA", usuarioId: string, motivo?: string) {
    const { count } = await this.prisma.sugestaoGestor.updateMany({
      where: { id, status: "ABERTA" },
      data: { status, chaveViva: null, decididaEm: new Date(), decididaPorId: usuarioId, motivoDecisao: motivo?.trim() || null },
    });
    if (count === 0) throw new ConflictException("Esta sugestão já foi decidida.");
    await this.auditoria.log({
      usuarioId,
      entidade: "SugestaoGestor",
      entidadeId: id,
      acao: "CONFERENCIA_SUGESTAO_DECIDIDA",
      campo: "status",
      valorAntes: "ABERTA",
      valorDepois: status,
      motivo: motivo?.trim() || null,
    });
    return { id, status };
  }

  // ─── Cálculo ───────────────────────────────────────────────────────────

  private configDaRegra(c: Config): ConfigRegraConferencia {
    return {
      regra: c.regra,
      diasSemViagem: c.diasSemViagem,
      diasConsiderados: c.diasConsiderados,
      ignorarFeriados: c.ignorarFeriados,
      incluirQueNuncaLancou: c.incluirQueNuncaLancou,
      intervaloMinimoDias: c.intervaloMinimoDias,
      maxPerguntasPorSemana: c.maxPerguntasPorSemana,
    };
  }

  private descricao(c: Config): string {
    return descreverRegraConferencia({ ...this.configDaRegra(c), horaEnvio: c.horaEnvio, diasDoJob: c.diasDoJob });
  }

  /** Avalia todos os motoristas elegíveis da conta da vez. Não grava nada. */
  private async calcular(cfg: Config, agora: Date): Promise<ItemConferencia[]> {
    const hoje = hojeYmd(agora);
    const hojeData = inicioDoDiaData(agora);

    // Avaliados: vínculo vivo e aprovado. Quem NÃO tem canal (sem telefone, parou,
    // número inalcançável) continua sendo avaliado — a detecção não depende do
    // consentimento de receber a pergunta — e aparece na lista com a marca
    // "sem canal". Quem entra (todos ou só certas modalidades/transportadoras) é
    // escolha da empresa.
    const filtroQuem: Prisma.MotoristaWhereInput =
      cfg.quemEntra === "SO_MODALIDADES"
        ? {
            OR: [
              ...(cfg.modalidadeIds.length ? [{ modalidadeId: { in: cfg.modalidadeIds } }] : []),
              ...(cfg.transportadoraIds.length ? [{ transportadoraId: { in: cfg.transportadoraIds } }] : []),
            ],
          }
        : {};
    const motoristas = await this.prisma.motorista.findMany({
      where: {
        ...VINCULO_VIVO,
        status: "APROVADO",
        ...filtroQuem,
      },
      select: {
        id: true,
        nome: true,
        criadoEm: true,
        telefone: true,
        aceitaWhatsapp: true,
        receberConferenciaDiaria: true,
        whatsappInalcancavelEm: true,
      },
      orderBy: { nome: "asc" },
    });
    if (motoristas.length === 0) return [];
    const ids = motoristas.map((m) => m.id);

    const desde = new Date(hojeData.getTime() - JANELA_VIAGENS_DIAS * 86_400_000);
    const [viagens, ultimas, perguntas, feriadosDb] = await Promise.all([
      // QUALQUER status conta (inclusive EM_ANDAMENTO/AGUARDANDO_PESO/INCOMPLETA):
      // aqui a pergunta é "ele lançou algo?", não "entra no fechamento?".
      this.prisma.viagem.findMany({
        where: { motoristaId: { in: ids }, OR: [{ data: { gte: desde } }, { data: null }] },
        select: { motoristaId: true, data: true, iniciadoEm: true, status: true },
      }),
      this.prisma.viagem.groupBy({
        by: ["motoristaId"],
        where: { motoristaId: { in: ids }, data: { not: null } },
        _max: { data: true },
      }),
      this.prisma.conferenciaDiaria.findMany({
        where: {
          motoristaId: { in: ids },
          estado: { in: [...ESTADOS_PERGUNTADOS] },
          dia: { gte: new Date(hojeData.getTime() - JANELA_PERGUNTAS_DIAS * 86_400_000), lt: hojeData },
        },
        select: { motoristaId: true, dia: true },
      }),
      this.prisma.feriadoPonto.findMany({
        where: {
          abrangencia: "NACIONAL",
          data: { gte: new Date(hojeData.getTime() - 70 * 86_400_000), lt: hojeData },
        },
        select: { data: true, abrangencia: true, uf: true, municipioIbge: true },
      }),
    ]);

    // Só feriado NACIONAL: estadual e municipal dependem de onde cada motorista
    // roda, e esta fase não tem essa informação por motorista.
    const feriados = new Set(
      feriadosDb
        .map((f) => ({ ...f, data: dataParaYmd(f.data) }))
        .filter((f) => feriadoAlcanca(f))
        .map((f) => f.data),
    );

    const diasPorMotorista = new Map<string, string[]>();
    const emAndamento = new Set<string>();
    for (const v of viagens) {
      if (v.status === "EM_ANDAMENTO") emAndamento.add(v.motoristaId);
      const dia = v.data ? dataParaYmd(v.data) : v.iniciadoEm ? hojeYmd(v.iniciadoEm) : null;
      if (!dia) continue;
      const l = diasPorMotorista.get(v.motoristaId) ?? [];
      l.push(dia);
      diasPorMotorista.set(v.motoristaId, l);
    }
    // O histórico inteiro entra pelo último dia: quem lançou há 90 dias não é
    // "nunca lançou".
    for (const u of ultimas) {
      const d = u._max.data;
      if (!d) continue;
      const l = diasPorMotorista.get(u.motoristaId) ?? [];
      l.push(dataParaYmd(d));
      diasPorMotorista.set(u.motoristaId, l);
    }
    const perguntasPor = new Map<string, string[]>();
    for (const p of perguntas) {
      const l = perguntasPor.get(p.motoristaId) ?? [];
      l.push(dataParaYmd(p.dia));
      perguntasPor.set(p.motoristaId, l);
    }

    const regra = this.configDaRegra(cfg);
    return motoristas.map((m) => {
      const entrada: MotoristaParaConferencia = {
        motoristaId: m.id,
        diasComViagem: diasPorMotorista.get(m.id) ?? [],
        temViagemEmAndamento: emAndamento.has(m.id),
        cadastradoEm: hojeYmd(m.criadoEm),
        perguntasAnteriores: perguntasPor.get(m.id) ?? [],
      };
      const r = avaliarConferenciaDiaria(regra, entrada, feriados, agora);
      return { motoristaId: m.id, nome: m.nome, ...r, semCanal: this.semCanalDe(m) };
    });
  }
}
