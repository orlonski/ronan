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
  PADRAO_HORAS_TOLERANCIA_ENVIO,
  PADRAO_LEMBRETE_HORA_MAX,
  PADRAO_LEMBRETE_HORA_MIN,
  PADRAO_MAX_REENVIOS_POR_PERGUNTA,
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
import { montarCalendarioConferencia, ultimoDiaDoMes } from "../../common/conferencia-calendario";
import { anexarTrilha } from "../../common/conferencia-trilha";
import { diaDaPerguntaDeTeste, ehPerguntaDeTeste, mascararTelefone, motivoDiaDeTesteInvalido } from "../../common/conferencia-teste";
import { MOTIVO_RELIGAR_MIN, ORIGEM_TESTE_PAINEL } from "@ronan/shared-types";
import type {
  EstadoConferenciaMotorista,
  ResultadoPerguntaDeTeste,
  ResultadoReenvioPergunta,
} from "@ronan/shared-types";

type Config = Awaited<ReturnType<ConferenciaDiariaService["config"]>>;

/** Por que a regra diz "pergunte" mas não há como perguntar. É o "sem canal" da lista. */
export type SemCanal = "SEM_TELEFONE" | "NAO_ACEITA_WHATSAPP" | "PAROU" | "DESLIGADA_PAINEL" | "INALCANCAVEL";

export type ItemConferencia = {
  motoristaId: string;
  nome: string;
  deveriaPerguntar: boolean;
  motivo: string;
  evidencias: EvidenciasConferencia;
  /** Preenchido quando o motorista não pode receber a pergunta pelo WhatsApp. */
  semCanal: SemCanal | null;
  /**
   * Barrado pela regra de atividade (parado há mais de N dias): não recebe mensagem e
   * vai pra lista do escritório. Nunca é "sem canal" — é outra fila, com outra decisão.
   */
  semMovimento: boolean;
  /** Só nos `semMovimento`: pro escritório reconhecer o parceiro sem ver o número inteiro. */
  telefoneMascarado?: string | null;
};

/** `suprimidaPor` da linha poupada pela regra de atividade. Não é canal: o calendário e a fila de "sem canal" a ignoram. */
export const SUPRIMIDA_SEM_MOVIMENTO = "SEM_MOVIMENTO";

/** Estados em que a pergunta CONTA como feita (entra no intervalo mínimo e no máximo semanal). */
const ESTADOS_PERGUNTADOS = ["SOMBRA", "PENDENTE", "ENVIADA", "RESPONDIDA", "EXPIRADA"] as const;

/** Por que o motorista não pode receber a pergunta, em frase de quem opera ("Fulano <frase>"). */
const POR_QUE_SEM_CANAL: Record<SemCanal, string> = {
  SEM_TELEFONE: "não tem telefone cadastrado",
  NAO_ACEITA_WHATSAPP: "desligou as mensagens no WhatsApp",
  PAROU: "pediu pra parar de receber a pergunta",
  DESLIGADA_PAINEL: "está com a conferência desligada pela empresa",
  INALCANCAVEL: "está com o WhatsApp sem entregar (número suspeito)",
};

/**
 * NOTA (não é constante de regra): a tolerância de envio, a janela do lembrete e o teto de
 * reenvios/testes por linha vêm da config da empresa (`horasToleranciaEnvio`, `lembreteHoraMin/Max`,
 * `maxReenviosPorPergunta`). Onde não há config carregada, valem os `PADRAO_*` do shared-types,
 * que são só o seed inicial (os mesmos DEFAULT das colunas).
 */
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
    if (depois.lembreteHoraMin >= depois.lembreteHoraMax) {
      throw new BadRequestException("A hora final do lembrete tem que ser depois da hora inicial.");
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
    // O N do título do grupo "sem movimento" é o da config de HOJE (só leitura; nada é criado).
    const cfg = await this.prisma.configuracaoConferenciaDiaria.findFirst({ select: { janelaAtividadeDias: true } });
    const linhas = await this.prisma.conferenciaDiaria.findMany({
      where: { dia },
      include: { motorista: { select: { nome: true, telefone: true } } },
      orderBy: { motorista: { nome: "asc" } },
    });
    return {
      dia: dataParaYmd(dia),
      rodou: linhas.length > 0,
      janelaAtividadeDias: cfg?.janelaAtividadeDias ?? 0,
      itens: linhas.map((l) => {
        const snap = l.snapshot as { evidencias?: EvidenciasConferencia; deveriaPerguntar?: boolean } | null;
        const semMovimento = l.suprimidaPor === SUPRIMIDA_SEM_MOVIMENTO;
        // SEM_MOVIMENTO mora no mesmo campo, mas NÃO é canal: nunca vira a marca "sem canal".
        const semCanal = semMovimento ? null : ((l.suprimidaPor as SemCanal | null) ?? null);
        return {
          motoristaId: l.motoristaId,
          nome: l.motorista.nome,
          semMovimento,
          ...(semMovimento
            ? { telefoneMascarado: l.motorista.telefone ? mascararTelefone(l.motorista.telefone) : null }
            : {}),
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

  /**
   * O calendário do mês na ficha do motorista: só LEITURA, duas consultas.
   * A montagem (dia perguntado, retroativo) é da regra pura em `conferencia-calendario`.
   * Quem chama já conferiu o escopo do motorista (404 fora dele).
   */
  async calendarioDoMotorista(
    motoristaId: string,
    mes?: string,
    agora: Date = new Date(),
    /** "Dados técnicos" (wamid, trilha…) só saem pra quem tem `conferencia-diaria.decidir`. */
    incluirTecnico = false,
  ) {
    const alvo = mes ?? hojeYmd(agora).slice(0, 7);
    const primeiro = `${alvo}-01`;
    const ultimo = ultimoDiaDoMes(alvo);
    const emData = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
    const [viagens, linhas] = await Promise.all([
      this.prisma.viagem.findMany({
        where: { motoristaId, data: { gte: emData(primeiro), lte: emData(ultimo) } },
        select: { data: true, sincronizadoEm: true, criadoOfflineEm: true },
      }),
      // A pergunta é gravada DEPOIS do dia sobre o qual fala (fim de semana, feriado):
      // folga de 10 dias no fim da janela; a regra pura descarta o que cai fora do mês.
      this.prisma.conferenciaDiaria.findMany({
        where: { motoristaId, dia: { gte: emData(somarDias(primeiro, 1)), lte: emData(somarDias(ultimo, 10)) } },
        select: {
          dia: true,
          estado: true,
          suprimidaPor: true,
          enviadaEm: true,
          respondidaEm: true,
          opcao: true,
          criadoEm: true,
          snapshot: true,
          // A trilha sempre vem: dela se reconstroem as perguntas anteriores zeradas por teste.
          trilha: true,
          ...(incluirTecnico ? { id: true, wamid: true, respostaTexto: true, erroEnvio: true, reenvios: true } : {}),
        },
      }),
    ]);
    return montarCalendarioConferencia({
      mes: alvo,
      agora,
      incluirTecnico,
      viagens: viagens.filter((v) => v.data).map((v) => ({ ...v, data: dataParaYmd(v.data!) })),
      linhas: linhas.map((l) => ({ ...l, dia: dataParaYmd(l.dia) })),
    });
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
      janelaAtividadeDias: cfg.janelaAtividadeDias ?? 0,
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

  /**
   * Linhas do dia gravadas em SOMBRA viram PENDENTE quando o envio foi ligado
   * depois, ainda na hora do job. Recalcula antes: quem lançou viagem (ou perdeu o
   * canal) entre a gravação e agora continua em SOMBRA e não é perguntado.
   */
  private async promoverSombraDoDia(cfg: Config, dia: Date, agora: Date): Promise<number> {
    const pode = await this.podeEnviar(cfg);
    if (!pode.ok) return 0;
    const sombra = await this.prisma.conferenciaDiaria.findMany({
      where: { dia, estado: "SOMBRA" },
      select: { id: true, motoristaId: true, snapshot: true },
    });
    if (sombra.length === 0) return 0;

    const itens = await this.calcular(cfg, agora);
    const aindaPerguntar = new Set(
      itens.filter((i) => i.deveriaPerguntar && !i.semCanal).map((i) => i.motoristaId),
    );
    let promovidas = 0;
    for (const l of sombra) {
      if (!aindaPerguntar.has(l.motoristaId)) continue;
      const { semEnvioPorque: _descartado, ...resto } = (l.snapshot ?? {}) as Record<string, unknown>;
      // Condicional: só sai de SOMBRA se ainda for SOMBRA (nenhuma gravação rebaixa uma linha que andou).
      const { count } = await this.prisma.conferenciaDiaria.updateMany({
        where: { id: l.id, estado: "SOMBRA" },
        data: {
          estado: "PENDENTE",
          snapshot: {
            ...resto,
            modoConfigurado: cfg.modo,
            nadaEnviado: false,
            promovidaDeSombra: true,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      if (count > 0) promovidas++;
    }
    if (promovidas > 0) {
      this.log.log(`Conferência diária: ${promovidas} linha(s) de sombra do dia promovidas a PENDENTE (envio ligado depois).`);
    }
    return promovidas;
  }

  private async gravarODia(cfg: Config, contaId: string, agora: Date): Promise<number> {
    // Janela: a HORA configurada inteira (o cron tem 6 batidas nela). Se a
    // primeira falhar (deploy no minuto), a seguinte cobre — a idempotência
    // abaixo impede rodar duas vezes.
    if (horaEmSaoPaulo(agora) !== cfg.horaEnvio) return 0;
    if (!cfg.diasDoJob.includes(diaDaSemanaEmSaoPaulo(agora))) return 0;

    const dia = inicioDoDiaData(agora);
    // Linha de TESTE do painel não conta: senão testar de manhã cedo faria o job
    // pular o dia inteiro de todos os outros motoristas.
    const [noDia, testesNoDia] = await Promise.all([
      this.prisma.conferenciaDiaria.count({ where: { dia } }),
      this.prisma.conferenciaDiaria.count({ where: { dia, snapshot: { path: ["origem"], equals: ORIGEM_TESTE_PAINEL } } }),
    ]);
    const jaRodou = noDia - testesNoDia;
    if (jaRodou > 0) {
      // O dia já foi gravado — mas talvez em SOMBRA, e a empresa ligou o envio
      // depois (dentro da hora do job). Sem isto o envio só valeria amanhã.
      await this.promoverSombraDoDia(cfg, dia, agora);
      return 0;
    }

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
          suprimidaPor: i.semMovimento ? SUPRIMIDA_SEM_MOVIMENTO : semCanal,
          motivo: i.motivo,
          snapshot: {
            modoConfigurado: cfg.modo,
            nadaEnviado: !pode.ok,
            ...(pode.ok ? {} : { semEnvioPorque: pode.motivo }),
            deveriaPerguntar: i.deveriaPerguntar,
            semCanal: i.semCanal,
            ...(i.semMovimento ? { semMovimento: true } : {}),
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
      } a perguntar, ${itens.filter((i) => i.deveriaPerguntar && i.semCanal).length} sem canal, ${
        itens.filter((i) => i.semMovimento).length
      } sem movimento.`,
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
   * Grava o resultado de um envio NA LINHA, sem nunca rebaixá-la.
   *
   * O envio é lento (HTTP na Meta) e a mensagem pode chegar — e o motorista tocar —
   * antes de este update rodar. Por isso todo update é CONDICIONAL a `PENDENTE`:
   * se a linha já andou (RESPONDIDA/EXPIRADA…), o `count` volta 0, a resposta
   * gravada é preservada e só completamos o `wamid`/`enviadaEm` que faltam.
   * Devolve `true` quando a linha ficou ENVIADA por este envio.
   */
  private async registrarEnvio(
    linha: { id: string; contaId: string },
    r: Awaited<ReturnType<ConferenciaDiariaService["pergunta"]>>,
    etapa: string,
  ): Promise<boolean> {
    const alvo = { id: linha.id, contaId: linha.contaId };
    if (r.enviado) {
      const enviadaEm = new Date();
      const { count } = await this.prisma.conferenciaDiaria.updateMany({
        where: { id: linha.id, estado: "PENDENTE" },
        data: { estado: "ENVIADA", wamid: r.idExterno, enviadaEm, erroEnvio: null },
      });
      if (count === 0) {
        // A linha mudou entre o envio e agora (toque chegou antes do update). Não
        // sobrescreve o estado; só guarda o wamid pra o toque poder ser conferido.
        await this.prisma.conferenciaDiaria.updateMany({
          where: { id: linha.id, wamid: null },
          data: { wamid: r.idExterno, enviadaEm },
        });
        this.log.warn(
          `Conferência ${linha.id}: a linha já não estava PENDENTE quando o envio foi gravado (${etapa}); estado preservado, wamid ${r.idExterno} guardado.`,
        );
      }
      await anexarTrilha(this.prisma, alvo, "ENVIO", {
        etapa,
        enviado: true,
        wamid: r.idExterno,
        count,
        ...(count === 0 ? { motivo: "linha já não estava PENDENTE; estado preservado" } : {}),
      });
      return count > 0;
    }
    const erro = `${r.erro?.codigo ?? "?"}: ${r.erro?.detalhe ?? ""}`.slice(0, 500);
    if (r.erro?.tipo === "TRANSPORTE" && etapa === "enviarPendentes") {
      // Meta fora do ar: continua PENDENTE e tenta na batida seguinte.
      await this.prisma.conferenciaDiaria.updateMany({
        where: { id: linha.id, estado: "PENDENTE" },
        data: { erroEnvio: erro },
      });
    } else {
      await this.prisma.conferenciaDiaria.updateMany({
        where: { id: linha.id, estado: "PENDENTE" },
        data: { estado: "FALHOU", erroEnvio: erro },
      });
    }
    await anexarTrilha(this.prisma, alvo, "ENVIO", { etapa, enviado: false, erro });
    return false;
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

    const pendentesDoDia = await this.prisma.conferenciaDiaria.findMany({
      where: { dia, estado: "PENDENTE" },
      select: {
        id: true,
        contaId: true,
        snapshot: true,
        dia: true,
        motorista: {
          select: {
            id: true,
            telefone: true,
            aceitaWhatsapp: true,
            receberConferenciaDiaria: true,
            conferenciaDesligadaOrigem: true,
            whatsappInalcancavelEm: true,
          },
        },
      },
      orderBy: { criadoEm: "asc" },
      take: 500,
    });
    // Teste do painel é enviado na hora, por quem pediu; o job nunca o pega (evita envio em dobro).
    const pendentes = pendentesDoDia.filter((p) => !ehPerguntaDeTeste(p.snapshot));
    if (pendentes.length === 0) return 0;

    if (hora > cfg.horaEnvio + (cfg.horasToleranciaEnvio ?? PADRAO_HORAS_TOLERANCIA_ENVIO)) {
      await this.prisma.conferenciaDiaria.updateMany({
        where: { id: { in: pendentes.map((p) => p.id) }, estado: "PENDENTE" },
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
        await this.prisma.conferenciaDiaria.updateMany({
          where: { id: p.id, estado: "PENDENTE" },
          data: { estado: "SUPRIMIDA", suprimidaPor: semCanal ?? "SEM_TELEFONE" },
        });
        continue;
      }
      vagas--;
      const r = await this.pergunta(p, m.telefone);
      if (await this.registrarEnvio(p, r, "enviarPendentes")) enviadas++;
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
    const paraExpirar = await this.prisma.conferenciaDiaria.findMany({
      where: { estado: "ENVIADA", enviadaEm: { lt: limiteExpirar } },
      select: { id: true, contaId: true },
    });
    const { count: expiradas } =
      paraExpirar.length === 0
        ? { count: 0 }
        : await this.prisma.conferenciaDiaria.updateMany({
            where: { id: { in: paraExpirar.map((l) => l.id) }, estado: "ENVIADA" },
            data: { estado: "EXPIRADA" },
          });
    for (const l of paraExpirar) {
      await anexarTrilha(this.prisma, l, "EXPIRADA", { horasParaExpirar: cfg.horasParaExpirar });
    }

    let lembretes = 0;
    const hora = horaEmSaoPaulo(agora);
    if (
      !cfg.reenviar ||
      hora < (cfg.lembreteHoraMin ?? PADRAO_LEMBRETE_HORA_MIN) ||
      hora > (cfg.lembreteHoraMax ?? PADRAO_LEMBRETE_HORA_MAX) ||
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
        contaId: true,
        snapshot: true,
        dia: true,
        enviadaEm: true,
        motorista: {
          select: {
            id: true,
            telefone: true,
            aceitaWhatsapp: true,
            receberConferenciaDiaria: true,
            conferenciaDesligadaOrigem: true,
            whatsappInalcancavelEm: true,
          },
        },
      },
      take: 500,
    });
    let vagas = candidatos.length > 0 ? await this.vagasNestaHora(agora) : 0;
    for (const c of candidatos) {
      if (vagas <= 0) break;
      // Teste do painel: sem lembrete (ninguém pediu uma segunda mensagem). Só expira.
      if (ehPerguntaDeTeste(c.snapshot)) continue;
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
      await anexarTrilha(this.prisma, c, "LEMBRETE", {
        enviado: r.enviado,
        ...(r.enviado ? { lembreteWamid: r.idExterno } : { erro: `${r.erro?.codigo ?? "?"}: ${r.erro?.detalhe ?? ""}`.slice(0, 300) }),
      });
      if (r.enviado) lembretes++;
    }
    return { expiradas, lembretes };
  }

  private semCanalDe(m: {
    telefone: string | null;
    aceitaWhatsapp: boolean;
    receberConferenciaDiaria: boolean;
    /** "PAINEL" = a empresa desligou; qualquer outra coisa (inclusive nulo, linha antiga) = o motorista. */
    conferenciaDesligadaOrigem?: string | null;
    whatsappInalcancavelEm: Date | null;
  }): SemCanal | null {
    if (!m.telefone) return "SEM_TELEFONE";
    if (!m.aceitaWhatsapp) return "NAO_ACEITA_WHATSAPP";
    if (!m.receberConferenciaDiaria) return m.conferenciaDesligadaOrigem === "PAINEL" ? "DESLIGADA_PAINEL" : "PAROU";
    if (m.whatsappInalcancavelEm) return "INALCANCAVEL";
    return null;
  }

  // ─── Reenviar a pergunta de hoje ───────────────────────────────────────

  /**
   * Ferramenta de operação e de teste: zera a linha de HOJE do motorista e manda
   * a pergunta de novo, AGORA, pelo mesmo caminho do job (`pergunta()`).
   *
   * Só a linha de hoje (São Paulo). Exige conferência ativa em modo ENVIANDO, Meta
   * disponível e motorista com canal. O histórico não some: o que a linha tinha
   * (estado, resposta, wamid) vai pra trilha antes de zerar. Freios: teto por hora
   * global, no máximo `maxReenviosPorPergunta` (config da empresa) por linha e nunca SUPRIMIDA/SOMBRA
   * (a regra mandou não perguntar). Auditoria com quem pediu.
   */
  async reenviarPerguntaDeHoje(
    motoristaId: string,
    usuarioId: string,
    agora: Date = new Date(),
  ): Promise<ResultadoReenvioPergunta> {
    const dia = inicioDoDiaData(agora);
    const linha = await this.prisma.conferenciaDiaria.findFirst({
      where: { motoristaId, dia },
      select: {
        id: true,
        contaId: true,
        estado: true,
        suprimidaPor: true,
        opcao: true,
        wamid: true,
        enviadaEm: true,
        respondidaEm: true,
        respostaTexto: true,
        reenvios: true,
        snapshot: true,
        dia: true,
        motorista: {
          select: {
            id: true,
            nome: true,
            telefone: true,
            aceitaWhatsapp: true,
            receberConferenciaDiaria: true,
            conferenciaDesligadaOrigem: true,
            whatsappInalcancavelEm: true,
          },
        },
      },
    });
    if (!linha) {
      throw new NotFoundException(
        "Não há pergunta de hoje para este motorista. A pergunta de hoje só existe depois que a conferência roda no horário configurado e a regra manda perguntar.",
      );
    }
    if (linha.estado === "SUPRIMIDA" || linha.estado === "SOMBRA") {
      throw new ConflictException(
        linha.estado === "SOMBRA"
          ? "A conferência de hoje rodou em modo sombra: nada foi enviado a este motorista e nada será reenviado."
          : linha.suprimidaPor === SUPRIMIDA_SEM_MOVIMENTO
            ? "Este motorista está sem movimento há mais tempo que a janela de atividade da empresa, então a conferência não o perguntou. Se quiser mesmo assim, use a pergunta de teste na ficha dele."
            : "Hoje a regra não mandou perguntar a este motorista (ou ele está sem canal). Não dá pra reenviar.",
      );
    }
    const cfg = await this.config();
    if (!cfg.ativo) throw new ConflictException("A conferência diária está desligada.");
    if (cfg.modo !== "ENVIANDO") {
      throw new ConflictException("A conferência está em modo sombra: só registra, não envia mensagem.");
    }
    const disp = await this.envio.disponivel("CONFERENCIA_DIARIA");
    if (!disp.ok) {
      throw new ConflictException(`O envio por WhatsApp não está disponível agora: ${(disp.motivo ?? "sem motivo informado").replace(/[.\s]+$/, "")}.`);
    }
    const m = linha.motorista;
    const semCanal = this.semCanalDe(m);
    if (semCanal || !m.telefone) {
      throw new ConflictException(`${m.nome} ${POR_QUE_SEM_CANAL[semCanal ?? "SEM_TELEFONE"]}. Não dá pra mandar a pergunta.`);
    }
    const maxReenvios = cfg.maxReenviosPorPergunta ?? PADRAO_MAX_REENVIOS_POR_PERGUNTA;
    if (linha.reenvios >= maxReenvios) {
      throw new ConflictException(
        `A pergunta de hoje já foi reenviada ${maxReenvios} vezes. Volte amanhã: o limite é por dia.`,
      );
    }
    if ((await this.vagasNestaHora(agora)) <= 0) {
      throw new ConflictException("O limite de envios por hora foi atingido. Tente de novo daqui a pouco.");
    }

    // Zera a linha. Condicional ao número de reenvios lido: dois cliques ao mesmo
    // tempo não passam os dois do teto.
    const { count } = await this.prisma.conferenciaDiaria.updateMany({
      where: { id: linha.id, reenvios: linha.reenvios },
      data: {
        estado: "PENDENTE",
        opcao: null,
        respondidaEm: null,
        respostaTexto: null,
        wamid: null,
        enviadaEm: null,
        lembreteWamid: null,
        lembreteEnviadoEm: null,
        erroEnvio: null,
        reenvios: { increment: 1 },
      },
    });
    if (count === 0) {
      throw new ConflictException("Esta pergunta acabou de ser mexida por outra pessoa. Recarregue e tente de novo.");
    }
    const n = linha.reenvios + 1;
    await anexarTrilha(this.prisma, linha, "REENVIO", {
      pedidoPor: usuarioId,
      reenvio: n,
      antes: {
        estado: linha.estado,
        opcao: linha.opcao,
        wamid: linha.wamid,
        enviadaEm: linha.enviadaEm?.toISOString() ?? null,
        respondidaEm: linha.respondidaEm?.toISOString() ?? null,
        respostaTexto: linha.respostaTexto,
      },
    });

    const r = await this.pergunta(linha, m.telefone);
    await this.registrarEnvio(linha, r, "reenvio");
    const final = await this.prisma.conferenciaDiaria.findUnique({
      where: { id: linha.id },
      select: { estado: true, erroEnvio: true, wamid: true },
    });
    const estadoFinal = final?.estado ?? (r.enviado ? "ENVIADA" : "FALHOU");

    // A mensagem já saiu: falha de auditoria não pode esconder o resultado de quem clicou.
    await this.auditoria
      .log({
        usuarioId,
        entidade: "ConferenciaDiaria",
        entidadeId: linha.id,
        acao: "CONFERENCIA_PERGUNTA_REENVIADA",
        campo: "estado",
        valorAntes: linha.estado,
        valorDepois: estadoFinal,
        motivo: "Pergunta de hoje reenviada pelo painel.",
        metadata: {
          motoristaId,
          reenvio: n,
          wamidAnterior: linha.wamid,
          wamidNovo: r.enviado ? r.idExterno : null,
          enviado: r.enviado,
        },
      })
      .catch((e) => this.log.error(`auditoria do reenvio da conferência ${linha.id} falhou: ${(e as Error).message}`));
    return {
      enviado: r.enviado,
      estado: estadoFinal,
      erro: r.enviado ? null : (final?.erroEnvio ?? "A Meta recusou o envio."),
      reenvios: n,
    };
  }

  // ─── Pergunta de teste ─────────────────────────────────────────────────

  /**
   * "Enviar pergunta de teste": manda a pergunta a ESTE motorista agora, sem
   * depender do job, da hora certa nem de a regra pegá-lo. É como o gestor confere
   * que o WhatsApp de um motorista de teste (ou de quem já combinou) funciona.
   *
   * O texto é o mesmo template real (`pergunta()`), com os mesmos botões. O que
   * muda em relação ao job:
   *  - NÃO exige a conferência ligada nem o modo ENVIANDO (é justamente o teste);
   *    o módulo `conferencia` é exigido pelo guard da rota;
   *  - se não existe a linha de hoje, cria SÓ a deste motorista (PENDENTE → ENVIADA),
   *    marcada `origem: TESTE_PAINEL` no snapshot. Se existe, zera e reenvia como
   *    o reenvio, e conta como reenvio (teto `maxReenviosPorPergunta` da config, por linha/dia);
   *  - linha SUPRIMIDA/SOMBRA não bloqueia (é teste) — vira teste e não conta como
   *    "pergunta feita"; o que a linha tinha vai pra trilha;
   *  - a linha de teste não entra no intervalo mínimo nem no máximo semanal;
   *  - com `diaEscolhido` a pergunta fala DAQUELE dia (a linha do job segue sendo a de
   *    HOJE, por causa do @@unique [conta, motorista, dia]; o dia perguntado mora em
   *    `evidencias.diasEsperadosVerificados`). Se a linha de hoje já falava de outro
   *    dia, o dia antigo fica na trilha (`antes.diaPerguntado`) e em
   *    `snapshot.diasPerguntadosAntes` e (com o estado: resposta, hora)
   *    `snapshot.perguntasAnteriores`. A linha aponta pro dia mais recente; o
   *    calendário mostra os antigos como "teste anterior" e NÃO perde o que o
   *    motorista já respondeu (ver `perguntasAnterioresDaLinha`);
   *  - fail-closed: sem Meta, sem canal ou acima do teto por hora, recusa com motivo
   *    e não grava nada.
   */
  async enviarPerguntaDeTeste(
    motoristaId: string,
    usuarioId: string,
    agora: Date = new Date(),
    /** "Perguntar sobre este dia": AAAA-MM-DD escolhido no calendário. Sem ele, o último dia útil. */
    diaEscolhido?: string,
  ): Promise<ResultadoPerguntaDeTeste> {
    // Fail-closed antes de qualquer consulta ou envio: dia inválido/hoje/futuro/velho demais = 400.
    if (diaEscolhido != null) {
      const invalido = motivoDiaDeTesteInvalido(diaEscolhido, hojeYmd(agora));
      if (invalido) throw new BadRequestException(invalido);
    }
    const m = await this.prisma.motorista.findFirst({
      where: { id: motoristaId },
      select: {
        id: true,
        nome: true,
        telefone: true,
        aceitaWhatsapp: true,
        receberConferenciaDiaria: true,
        conferenciaDesligadaOrigem: true,
        whatsappInalcancavelEm: true,
      },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado.");

    const disp = await this.envio.disponivel("CONFERENCIA_DIARIA");
    if (!disp.ok) {
      throw new ConflictException(`O envio por WhatsApp não está disponível agora: ${(disp.motivo ?? "sem motivo informado").replace(/[.\s]+$/, "")}.`);
    }
    const semCanal = this.semCanalDe(m);
    if (semCanal || !m.telefone) {
      throw new ConflictException(`${m.nome} ${POR_QUE_SEM_CANAL[semCanal ?? "SEM_TELEFONE"]}. Não dá pra mandar a pergunta de teste.`);
    }
    const telefone = m.telefone;

    const dia = inicioDoDiaData(agora);
    const hoje = hojeYmd(agora);
    const linha = await this.prisma.conferenciaDiaria.findFirst({
      where: { motoristaId, dia },
      select: {
        id: true,
        contaId: true,
        estado: true,
        opcao: true,
        wamid: true,
        enviadaEm: true,
        respondidaEm: true,
        respostaTexto: true,
        reenvios: true,
        suprimidaPor: true,
        snapshot: true,
        dia: true,
      },
    });
    // Sem configuração a empresa nunca ligou a conferência: vale "ontem". Nada é criado aqui.
    const cfg = await this.prisma.configuracaoConferenciaDiaria.findFirst();
    const maxReenvios = cfg?.maxReenviosPorPergunta ?? PADRAO_MAX_REENVIOS_POR_PERGUNTA;
    if (linha && linha.reenvios >= maxReenvios) {
      throw new ConflictException(
        `A pergunta de hoje deste motorista já foi enviada ${maxReenvios} vezes além da primeira. Volte amanhã: o limite é por dia.`,
      );
    }
    if ((await this.vagasNestaHora(agora)) <= 0) {
      throw new ConflictException("O limite de envios por hora foi atingido. Tente de novo daqui a pouco.");
    }

    const feriados = cfg?.ignorarFeriados ? await this.feriadosNacionais(dia) : null;
    const snapAtual = (linha?.snapshot ?? null) as { evidencias?: { diasEsperadosVerificados?: string[] } } | null;
    // O dia sobre o qual a linha de hoje já falava (o que o calendário mostra hoje).
    const diaAnterior = linha ? (snapAtual?.evidencias?.diasEsperadosVerificados?.[0] ?? somarDias(hoje, -1)) : null;
    const linhaEhDeTeste = !!linha && ehPerguntaDeTeste(linha.snapshot);
    const daRegraSemEnvio = linha?.estado === "SUPRIMIDA" || linha?.estado === "SOMBRA";
    // Pergunta de verdade do job, sem dia escolhido: mantém o dia dela (comportamento de sempre).
    const diaPerguntado =
      diaEscolhido ?? (linha && !linhaEhDeTeste && !daRegraSemEnvio ? diaAnterior! : diaDaPerguntaDeTeste(hoje, cfg, feriados));
    const marca = { origem: ORIGEM_TESTE_PAINEL, testePedidoPor: usuarioId, testePedidoEm: agora.toISOString() };
    const antes = linha
      ? {
          estado: linha.estado,
          opcao: linha.opcao,
          wamid: linha.wamid,
          enviadaEm: linha.enviadaEm?.toISOString() ?? null,
          respondidaEm: linha.respondidaEm?.toISOString() ?? null,
          respostaTexto: linha.respostaTexto,
          diaPerguntado: diaAnterior,
        }
      : null;

    let alvo: { id: string; contaId: string; snapshot: Prisma.JsonValue; dia: Date };
    let reenvios: number;
    if (!linha) {
      try {
        const criada = await this.prisma.conferenciaDiaria.create({
          data: {
            contaId: contaIdAtual(),
            motoristaId,
            dia,
            estado: "PENDENTE",
            motivo: "Pergunta de teste pedida pelo painel.",
            snapshot: {
              ...marca,
              nadaEnviado: false,
              deveriaPerguntar: false,
              semCanal: null,
              regraEmVigor: cfg ? this.descricao(cfg) : "Sem regra configurada: a pergunta de teste fala do dia de ontem.",
              ...(cfg ? { config: this.configDaRegra(cfg) } : {}),
              evidencias: { hoje, diasEsperadosVerificados: [diaPerguntado] },
            } as unknown as Prisma.InputJsonValue,
          },
          select: { id: true, contaId: true, snapshot: true, dia: true },
        });
        alvo = criada;
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") {
          throw new ConflictException("A pergunta de hoje deste motorista acabou de ser criada. Tente de novo.");
        }
        throw e;
      }
      reenvios = 0;
    } else {
      // Linha que a regra NÃO mandou enviar (SUPRIMIDA/SOMBRA) vira teste: marca a
      // origem (não conta como pergunta feita) e aponta o dia perguntado. Linha
      // que já foi pergunta de verdade continua sendo (o contador dela não muda).
      const snap = (linha.snapshot ?? {}) as Record<string, unknown>;
      // Reescreve o dia perguntado quando a linha é de teste/sem envio (o teste anterior
      // pode ter falado de outro dia) ou quando o gestor escolheu um dia diferente.
      const mudaODia = diaAnterior !== diaPerguntado;
      const reescreve = daRegraSemEnvio || linhaEhDeTeste || (diaEscolhido != null && mudaODia);
      const antigos = Array.isArray(snap.diasPerguntadosAntes) ? (snap.diasPerguntadosAntes as string[]) : [];
      const snapshotNovo = reescreve
        ? ({
            ...snap,
            ...(daRegraSemEnvio ? marca : {}),
            ...(mudaODia && diaAnterior ? { diasPerguntadosAntes: [...antigos, diaAnterior].slice(-20) } : {}),
            // Cópia durável do que a linha JÁ tinha perguntado/recebido sobre o dia antigo (a trilha
            // só guarda 20 eventos): o calendário lê daqui pra não perder a resposta. Uma por dia.
            ...(mudaODia && diaAnterior && antes && ["ENVIADA", "RESPONDIDA", "EXPIRADA"].includes(antes.estado)
              ? {
                  perguntasAnteriores: [
                    ...(Array.isArray(snap.perguntasAnteriores) ? (snap.perguntasAnteriores as Array<{ dia?: string }>) : []).filter(
                      (p) => p?.dia !== diaAnterior,
                    ),
                    {
                      dia: diaAnterior,
                      estado: antes.estado,
                      opcao: antes.opcao,
                      wamid: antes.wamid,
                      enviadaEm: antes.enviadaEm,
                      respondidaEm: antes.respondidaEm,
                      respostaTexto: antes.respostaTexto,
                      zeradaEm: agora.toISOString(),
                    },
                  ].slice(-31),
                }
              : {}),
            evidencias: { ...((snap.evidencias as object | undefined) ?? {}), hoje, diasEsperadosVerificados: [diaPerguntado] },
          } as unknown as Prisma.InputJsonValue)
        : undefined;
      const { count } = await this.prisma.conferenciaDiaria.updateMany({
        where: { id: linha.id, reenvios: linha.reenvios },
        data: {
          estado: "PENDENTE",
          opcao: null,
          respondidaEm: null,
          respostaTexto: null,
          wamid: null,
          enviadaEm: null,
          lembreteWamid: null,
          lembreteEnviadoEm: null,
          erroEnvio: null,
          suprimidaPor: null,
          reenvios: { increment: 1 },
          ...(snapshotNovo ? { snapshot: snapshotNovo } : {}),
        },
      });
      if (count === 0) {
        throw new ConflictException("Esta pergunta acabou de ser mexida por outra pessoa. Recarregue e tente de novo.");
      }
      alvo = {
        id: linha.id,
        contaId: linha.contaId,
        dia: linha.dia,
        snapshot: (snapshotNovo ?? linha.snapshot) as Prisma.JsonValue,
      };
      reenvios = linha.reenvios + 1;
    }

    await anexarTrilha(this.prisma, alvo, "TESTE", {
      pedidoPor: usuarioId,
      origem: ORIGEM_TESTE_PAINEL,
      linhaCriada: !linha,
      diaPerguntado,
      diaEscolhido: diaEscolhido != null,
      reenvio: reenvios,
      telefone: mascararTelefone(telefone),
      ...(antes ? { antes } : {}),
    });

    const r = await this.pergunta(alvo, telefone);
    await this.registrarEnvio(alvo, r, "teste");
    const final = await this.prisma.conferenciaDiaria.findUnique({
      where: { id: alvo.id },
      select: { estado: true, erroEnvio: true, wamid: true },
    });
    const estadoFinal = final?.estado ?? (r.enviado ? "ENVIADA" : "FALHOU");

    // A mensagem já saiu: falha de auditoria não pode esconder o resultado de quem clicou.
    await this.auditoria
      .log({
        usuarioId,
        entidade: "ConferenciaDiaria",
        entidadeId: alvo.id,
        acao: "CONFERENCIA_PERGUNTA_TESTE",
        campo: "estado",
        valorAntes: linha?.estado ?? null,
        valorDepois: estadoFinal,
        motivo: "Pergunta de teste pedida pelo painel.",
        metadata: {
          motoristaId,
          linhaCriada: !linha,
          diaPerguntado,
          dia: diaEscolhido ?? null,
          telefone: mascararTelefone(telefone),
          wamid: r.enviado ? r.idExterno : null,
          enviado: r.enviado,
        },
      })
      .catch((e) => this.log.error(`auditoria da pergunta de teste ${alvo.id} falhou: ${(e as Error).message}`));
    return {
      enviado: r.enviado,
      estado: estadoFinal,
      erro: r.enviado ? null : (final?.erroEnvio ?? "A Meta recusou o envio."),
      reenvios,
      telefoneMascarado: mascararTelefone(telefone),
      wamid: r.enviado ? (final?.wamid ?? r.idExterno) : null,
      diaPerguntado,
      linhaCriada: !linha,
    };
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

  /**
   * Liga/desliga a conferência de UM motorista pelo painel.
   *
   * ⚠️ Vale SÓ pra este vínculo: é decisão da empresa sobre o próprio cadastro.
   * Diferente do "Parar perguntas" do motorista no WhatsApp, que vale em TODOS os
   * vínculos da mesma pessoa (ver `ConferenciaRespostaService.pararPerguntas`).
   *
   * Regras: desligar sempre vale (fica quem e quando). Religar exige MOTIVO
   * escrito quando quem desligou foi o próprio motorista (o painel está passando
   * por cima de um pedido dele); se foi o painel, não exige. Repetir o estado
   * atual é 200 sem tocar em nada nem duplicar auditoria. O envio em si não muda:
   * o job só lê `receberConferenciaDiaria`.
   */
  async definirRecebimento(
    motoristaId: string,
    usuario: Pick<AuthAdminUser, "id">,
    body: { recebe: boolean; motivo?: string },
    agora: Date = new Date(),
  ): Promise<EstadoConferenciaMotorista> {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: {
        id: true,
        receberConferenciaDiaria: true,
        conferenciaDesligadaEm: true,
        conferenciaDesligadaOrigem: true,
        conferenciaDesligadaPorId: true,
        conferenciaDesligadaMotivo: true,
        conferenciaDesligadaPor: { select: { id: true, nome: true } },
      },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado");
    const motivo = body.motivo?.trim() || null;
    const estado = (r: typeof m): EstadoConferenciaMotorista => ({
      motoristaId: r.id,
      receberConferenciaDiaria: r.receberConferenciaDiaria,
      conferenciaDesligadaEm: r.conferenciaDesligadaEm?.toISOString() ?? null,
      conferenciaDesligadaOrigem: r.receberConferenciaDiaria
        ? null
        : r.conferenciaDesligadaOrigem === "PAINEL"
          ? "PAINEL"
          : "MOTORISTA",
      conferenciaDesligadaPor: r.receberConferenciaDiaria ? null : r.conferenciaDesligadaPor,
      conferenciaDesligadaMotivo: r.receberConferenciaDiaria ? null : r.conferenciaDesligadaMotivo,
    });

    // Idempotente: já está no estado pedido.
    if (m.receberConferenciaDiaria === body.recebe) return estado(m);

    const foiDoMotorista = m.conferenciaDesligadaOrigem !== "PAINEL";
    if (body.recebe && foiDoMotorista && (motivo?.length ?? 0) < MOTIVO_RELIGAR_MIN) {
      throw new BadRequestException(
        `O motorista pediu pra parar de receber a conferência. Pra religar, escreva o motivo (mínimo de ${MOTIVO_RELIGAR_MIN} letras), por exemplo: "a pedido do motorista".`,
      );
    }

    const data: Prisma.MotoristaUpdateInput = body.recebe
      ? {
          receberConferenciaDiaria: true,
          conferenciaDesligadaEm: null,
          conferenciaDesligadaOrigem: null,
          conferenciaDesligadaPor: { disconnect: true },
          conferenciaDesligadaMotivo: null,
        }
      : {
          receberConferenciaDiaria: false,
          conferenciaDesligadaEm: agora,
          conferenciaDesligadaOrigem: "PAINEL",
          conferenciaDesligadaPor: { connect: { id: usuario.id } },
          conferenciaDesligadaMotivo: motivo,
        };
    const novo = await this.prisma.motorista.update({
      where: { id: motoristaId },
      data,
      select: {
        id: true,
        receberConferenciaDiaria: true,
        conferenciaDesligadaEm: true,
        conferenciaDesligadaOrigem: true,
        conferenciaDesligadaPorId: true,
        conferenciaDesligadaMotivo: true,
        conferenciaDesligadaPor: { select: { id: true, nome: true } },
      },
    });
    await this.auditoria.log({
      usuarioId: usuario.id,
      entidade: "Motorista",
      entidadeId: motoristaId,
      acao: body.recebe ? "CONFERENCIA_MOTORISTA_RELIGADA" : "CONFERENCIA_MOTORISTA_DESLIGADA",
      campo: "receberConferenciaDiaria",
      valorAntes: m.receberConferenciaDiaria,
      valorDepois: body.recebe,
      motivo,
      metadata: {
        origem: "painel",
        desligadaAntesPor: m.receberConferenciaDiaria ? null : foiDoMotorista ? "MOTORISTA" : "PAINEL",
        desligadaAntesEm: m.conferenciaDesligadaEm?.toISOString() ?? null,
      },
    });
    return estado(novo);
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
        conferenciaDesligadaOrigem: true,
        whatsappInalcancavelEm: true,
      },
      orderBy: { nome: "asc" },
    });
    return linhas.map((m) => ({
      motoristaId: m.id,
      nome: m.nome,
      parou: !m.receberConferenciaDiaria,
      /** Quem desligou: nulo enquanto está ligada. Linha antiga (sem origem) conta como do motorista. */
      desligadaPor: m.receberConferenciaDiaria ? null : m.conferenciaDesligadaOrigem === "PAINEL" ? "PAINEL" : "MOTORISTA",
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
      janelaAtividadeDias: c.janelaAtividadeDias ?? 0,
    };
  }

  private descricao(c: Config): string {
    return descreverRegraConferencia({
      ...this.configDaRegra(c),
      horaEnvio: c.horaEnvio,
      diasDoJob: c.diasDoJob,
      lembreteNoApp: c.lembreteNoApp,
      lembreteParaQuem: c.lembreteParaQuem,
      diasParaLembreteNoApp: c.diasParaLembreteNoApp,
      reenviar: c.reenviar,
      horasToleranciaEnvio: c.horasToleranciaEnvio,
      lembreteHoraMin: c.lembreteHoraMin,
      lembreteHoraMax: c.lembreteHoraMax,
    });
  }

  /**
   * Feriados NACIONAIS dos últimos ~70 dias. Só nacional: estadual e municipal
   * dependem de onde cada motorista roda, e esta fase não tem essa informação.
   */
  private async feriadosNacionais(hojeData: Date): Promise<Set<string>> {
    const feriadosDb = await this.prisma.feriadoPonto.findMany({
      where: {
        abrangencia: "NACIONAL",
        data: { gte: new Date(hojeData.getTime() - 70 * 86_400_000), lt: hojeData },
      },
      select: { data: true, abrangencia: true, uf: true, municipioIbge: true },
    });
    return new Set(
      feriadosDb
        .map((f) => ({ ...f, data: dataParaYmd(f.data) }))
        .filter((f) => feriadoAlcanca(f))
        .map((f) => f.data),
    );
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
        conferenciaDesligadaOrigem: true,
        whatsappInalcancavelEm: true,
      },
      orderBy: { nome: "asc" },
    });
    if (motoristas.length === 0) return [];
    const ids = motoristas.map((m) => m.id);

    const desde = new Date(hojeData.getTime() - JANELA_VIAGENS_DIAS * 86_400_000);
    const [viagens, ultimas, perguntasBrutas, feriados] = await Promise.all([
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
        select: { motoristaId: true, dia: true, snapshot: true },
      }),
      this.feriadosNacionais(hojeData),
    ]);

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
    // Pergunta de TESTE do painel não conta pro intervalo mínimo nem pro máximo semanal.
    const perguntas = perguntasBrutas.filter((p) => !ehPerguntaDeTeste(p.snapshot));
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
      const semMovimento = r.semMovimento === true;
      return {
        motoristaId: m.id,
        nome: m.nome,
        ...r,
        semMovimento,
        // Quem foi poupado pela atividade não é "sem canal": é outra lista, sem mensagem.
        semCanal: semMovimento ? null : this.semCanalDe(m),
        ...(semMovimento ? { telefoneMascarado: m.telefone ? mascararTelefone(m.telefone) : null } : {}),
      };
    });
  }
}
