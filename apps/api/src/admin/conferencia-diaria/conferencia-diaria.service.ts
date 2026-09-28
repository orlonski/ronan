import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import {
  descreverRegraConferencia,
  type AtualizarConfigConferenciaDiaria,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { contaIdAtual } from "../../common/conta/conta-context";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { modulosDaConta } from "../../common/conta/teto-da-conta";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { feriadoAlcanca } from "../../common/ponto-espelho";
import { diaDaSemanaEmSaoPaulo, horaEmSaoPaulo, inicioDoDiaData } from "../../common/timezone";
import { VINCULO_VIVO } from "../../common/vinculo";
import {
  avaliarConferenciaDiaria,
  hojeYmd,
  type ConfigRegraConferencia,
  type EvidenciasConferencia,
  type MotoristaParaConferencia,
} from "../../common/conferencia-diaria";

type Config = Awaited<ReturnType<ConferenciaDiariaService["config"]>>;

export type ItemConferencia = {
  motoristaId: string;
  nome: string;
  deveriaPerguntar: boolean;
  motivo: string;
  evidencias: EvidenciasConferencia;
};

/** Quanto do histórico de viagens/perguntas o cálculo carrega. */
const JANELA_VIAGENS_DIAS = 65;
const JANELA_PERGUNTAS_DIAS = 35;

const dataParaYmd = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Conferência diária de viagens — FASE 1, MODO SOMBRA.
 *
 * O job identifica quem provavelmente deixou de lançar viagem e REGISTRA quem
 * seria perguntado. ⚠️ Nada é enviado: este serviço não injeta
 * `EnvioWhatsappService` de propósito. `modo = ENVIANDO` existe no enum pra
 * fase seguinte, mas aqui é tratado como SOMBRA — mesmo se alguém setar.
 */
@Injectable()
export class ConferenciaDiariaService {
  private readonly log = new Logger("ConferenciaDiariaService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
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

  /** O que o job já gravou hoje: quem seria perguntado e quem foi poupado, com o porquê. */
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
      itens: linhas.map((l) => ({
        motoristaId: l.motoristaId,
        nome: l.motorista.nome,
        deveriaPerguntar: l.estado === "SOMBRA",
        motivo: l.motivo,
        evidencias: (l.snapshot as { evidencias?: EvidenciasConferencia } | null)?.evidencias ?? null,
      })),
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

  /** Público pra teste. Devolve quantas linhas gravou (0 = não era a vez). */
  async rodarDaVez(contaId: string, agora: Date): Promise<number> {
    const modulos = await modulosDaConta(this.prisma, contaId);
    if (!modulos.has("conferencia")) return 0;

    const cfg = await this.prisma.configuracaoConferenciaDiaria.findFirst();
    if (!cfg || !cfg.ativo) return 0;
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

    // ⚠️ SOMBRA sempre, mesmo com `cfg.modo === "ENVIANDO"`: a Fase 1 não envia.
    const regra = this.descricao(cfg);
    const { count } = await this.prisma.conferenciaDiaria.createMany({
      skipDuplicates: true,
      data: itens.map((i) => ({
        contaId,
        motoristaId: i.motoristaId,
        dia,
        estado: i.deveriaPerguntar ? ("SOMBRA" as const) : ("SUPRIMIDA" as const),
        motivo: i.motivo,
        snapshot: {
          modoConfigurado: cfg.modo,
          nadaEnviado: true,
          regraEmVigor: regra,
          config: this.configDaRegra(cfg),
          evidencias: i.evidencias,
        } as unknown as Prisma.InputJsonValue,
      })),
    });
    this.log.log(
      `Conferência diária (sombra) conta ${contaId}: ${count} motoristas avaliados, ${
        itens.filter((i) => i.deveriaPerguntar).length
      } seriam perguntados.`,
    );
    return count;
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

    // Elegíveis: vínculo vivo, aprovado, com WhatsApp e sem opt-out. Quem
    // entra (todos ou só certas modalidades/transportadoras) é escolha da empresa.
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
        telefone: { not: null },
        aceitaWhatsapp: true,
        receberConferenciaDiaria: true,
        ...filtroQuem,
      },
      select: { id: true, nome: true, criadoEm: true },
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
          estado: "SOMBRA",
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
      return { motoristaId: m.id, nome: m.nome, ...r };
    });
  }
}
