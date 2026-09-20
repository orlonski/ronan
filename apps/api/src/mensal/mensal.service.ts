import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  CriarAlocacaoInput,
  EditarAlocacaoInput,
  LancarPresencaPainelInput,
  RegistrarPresencaInput,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { inicioDoDiaBR, ymdSaoPaulo } from "../common/timezone";
import { competenciaDe, montarEspelho, type Espelho } from "../common/espelho-mensal";

/** "2026-09-19" → Date de meia-noite UTC, que é como coluna Date se compara. */
function dia(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Date de coluna Date → "2026-09-19", sem passar pelo fuso do container. */
export function paraYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * O mensal: o caminhão à disposição de uma obra, pago por diária.
 *
 * ⚠️ Antes de mexer aqui, leia o cabeçalho de `shared-types/src/mensal.ts`.
 * Não existe ponto, jornada, falta nem atraso neste módulo — nem no código,
 * nem em texto de tela. O motorista é parceiro autônomo e o que se registra é
 * a presença do CAMINHÃO na obra num dia.
 */
@Injectable()
export class MensalService {
  private readonly log = new Logger(MensalService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------- alocação ---

  async listarAlocacoes(filtros: { clienteId?: string; ativas?: boolean }) {
    return this.prisma.alocacaoObra.findMany({
      where: {
        ...(filtros.clienteId ? { clienteId: filtros.clienteId } : {}),
        ...(filtros.ativas === undefined ? {} : { ativa: filtros.ativas }),
      },
      include: {
        cliente: { select: { id: true, nome: true } },
        motorista: { select: { id: true, nome: true, cpf: true } },
        veiculo: { select: { id: true, placa: true } },
      },
      orderBy: [{ ativa: "desc" }, { inicio: "desc" }],
    });
  }

  /**
   * Cria a alocação — e é ela que faz o app do motorista não perguntar nada.
   *
   * A trava de UMA obra por vez mora no banco (índice único sobre `vigenteDe`),
   * mas a checagem acontece aqui antes pra que o erro seja uma frase que a
   * pessoa entende, e não uma violação de constraint.
   */
  async criarAlocacao(dados: CriarAlocacaoInput, usuarioId: string) {
    const [cliente, motorista, veiculo] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: dados.clienteId }, select: { id: true, nome: true } }),
      this.prisma.motorista.findFirst({
        where: { id: dados.motoristaId },
        select: { id: true, nome: true, status: true },
      }),
      this.prisma.veiculo.findFirst({ where: { id: dados.veiculoId }, select: { id: true, placa: true } }),
    ]);
    if (!cliente) throw new NotFoundException("Obra não encontrada.");
    if (!motorista) throw new NotFoundException("Motorista não encontrado.");
    if (!veiculo) throw new NotFoundException("Caminhão não encontrado.");

    if (dados.fim && dados.fim < dados.inicio) {
      throw new BadRequestException("O fim não pode ser antes do início.");
    }

    const viva = await this.prisma.alocacaoObra.findFirst({
      where: { motoristaId: dados.motoristaId, ativa: true },
      include: { cliente: { select: { nome: true } } },
    });
    if (viva) {
      // Mensagem com o nome da obra de propósito: "já tem alocação ativa" faria
      // a pessoa abrir outra tela pra descobrir qual.
      throw new ConflictException(
        `${motorista.nome} já está alocado na obra ${viva.cliente.nome}. Encerre aquela alocação antes de criar outra.`,
      );
    }

    return this.prisma.alocacaoObra.create({
      data: {
        clienteId: dados.clienteId,
        motoristaId: dados.motoristaId,
        veiculoId: dados.veiculoId,
        inicio: dia(dados.inicio),
        fim: dados.fim ? dia(dados.fim) : null,
        valorDiaria:
          dados.valorDiariaCentavos === undefined ? null : dados.valorDiariaCentavos / 100,
        // Enquanto viva, a chave é o motorista: é isto que o índice único usa
        // pra garantir uma obra por vez sem proibir histórico.
        vigenteDe: dados.motoristaId,
        criadoPorId: usuarioId,
      },
    });
  }

  async editarAlocacao(id: string, dados: EditarAlocacaoInput) {
    const a = await this.buscarAlocacao(id);
    if (!a.ativa) throw new ConflictException("Alocação encerrada não se edita.");
    if (dados.fim && dia(dados.fim) < a.inicio) {
      throw new BadRequestException("O fim não pode ser antes do início.");
    }
    return this.prisma.alocacaoObra.update({
      where: { id },
      data: {
        ...(dados.fim === undefined ? {} : { fim: dia(dados.fim) }),
        ...(dados.valorDiariaCentavos === undefined
          ? {}
          : { valorDiaria: dados.valorDiariaCentavos / 100 }),
      },
    });
  }

  /**
   * Encerrar NÃO apaga: os dias registrados apontam pra alocação, e o espelho
   * de um mês fechado tem que continuar legível daqui a um ano.
   *
   * `vigenteDe` vira nulo no MESMO update que `ativa: false` — é isso que
   * libera a próxima alocação sem quebrar o índice único.
   */
  async encerrarAlocacao(id: string, motivo: string) {
    const a = await this.buscarAlocacao(id);
    if (!a.ativa) return a;
    return this.prisma.alocacaoObra.update({
      where: { id },
      data: { ativa: false, vigenteDe: null, encerradaEm: new Date(), encerradaMotivo: motivo },
    });
  }

  private async buscarAlocacao(id: string) {
    const a = await this.prisma.alocacaoObra.findFirst({ where: { id } });
    if (!a) throw new NotFoundException("Alocação não encontrada.");
    return a;
  }

  // ----------------------------------------------------------- presença ---

  /**
   * A obra de hoje, do ponto de vista do motorista. É o que decide se ele vê o
   * botão gigante ou a home normal.
   *
   * Devolve também os dias em branco do período aberto: são eles que viram a
   * pendência na tela dele. Dia em branco NÃO é falta — é dia que ninguém
   * marcou, e só ele pode dizer se esteve lá.
   */
  async obraDeHoje(motoristaId: string) {
    const a = await this.prisma.alocacaoObra.findFirst({
      where: { motoristaId, ativa: true },
      include: { cliente: { select: { id: true, nome: true } }, veiculo: { select: { placa: true } } },
    });
    if (!a) return { alocacao: null, hoje: null, pendentes: [] as string[] };

    const [ano, mes, d] = ymdSaoPaulo();
    const hojeYmd = `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    const desde = a.inicio > dia(`${ano}-${String(mes).padStart(2, "0")}-01`)
      ? a.inicio
      : dia(`${ano}-${String(mes).padStart(2, "0")}-01`);

    const registros = await this.prisma.registroPresenca.findMany({
      where: { alocacaoId: a.id, data: { gte: desde, lte: dia(hojeYmd) } },
      select: { data: true },
    });
    const marcados = new Set(registros.map((r) => paraYmd(r.data)));

    return {
      alocacao: {
        id: a.id,
        obra: a.cliente.nome,
        placa: a.veiculo.placa,
      },
      hoje: { data: hojeYmd, registrado: marcados.has(hojeYmd) },
      pendentes: this.diasEntre(desde, dia(hojeYmd)).filter(
        (x) => x !== hojeYmd && !marcados.has(x),
      ),
    };
  }

  /** Todos os dias de um intervalo, inclusive, em "AAAA-MM-DD". */
  private diasEntre(de: Date, ate: Date): string[] {
    const out: string[] = [];
    for (let t = de.getTime(); t <= ate.getTime(); t += 86_400_000) {
      out.push(paraYmd(new Date(t)));
    }
    return out;
  }

  /**
   * O toque. Um dia, uma linha.
   *
   * Idempotente por construção e em dois níveis: o `clientId` do outbox é
   * determinístico e o banco tem unique em (alocação, dia). Tocar cinco vezes
   * com 4G ruim continua sendo um dia, e a segunda tentativa devolve 200 com o
   * registro que já existe — nunca 409 na cara do motorista, que não teria o
   * que fazer com um conflito.
   */
  async registrarPresenca(motoristaId: string, dados: RegistrarPresencaInput) {
    const a = await this.prisma.alocacaoObra.findFirst({
      where: { motoristaId, ativa: true },
      select: { id: true, inicio: true, fim: true },
    });
    // 4xx, nunca 500: erro de servidor trava o outbox em loop, e um 4xx manda o
    // item pra tela de Pendentes, onde alguém resolve.
    if (!a) throw new BadRequestException("Você não está alocado em nenhuma obra.");

    const d = dia(dados.data);
    if (d < a.inicio) throw new BadRequestException("Esse dia é anterior ao início na obra.");
    if (a.fim && d > a.fim) throw new BadRequestException("Esse dia é posterior ao fim na obra.");
    if (d.getTime() > inicioDoDiaBR(paraYmd(new Date())).getTime() + 86_400_000) {
      throw new BadRequestException("Não dá pra marcar presença em dia futuro.");
    }

    const existente = await this.prisma.registroPresenca.findFirst({
      where: { alocacaoId: a.id, data: d },
    });
    if (existente) return existente;

    return this.prisma.registroPresenca.create({
      data: {
        alocacaoId: a.id,
        data: d,
        origem: "APP",
        clientId: dados.clientId,
        latitude: dados.latitude ?? null,
        longitude: dados.longitude ?? null,
        precisao: dados.precisao ?? null,
      },
    });
  }

  /**
   * O motorista desmarcando o próprio dia.
   *
   * Não contradiz a regra de que o PAINEL não apaga dia marcado no app: ali o
   * escritório apagaria prova de outra pessoa sem ela saber. Aqui é ele
   * mesmo, sobre o registro dele — e existir esse caminho é o que torna
   * honesto não ter diálogo de confirmação antes do toque. Sem desfazer, um
   * toque errado seria definitivo, e aí a tela precisaria perguntar "tem
   * certeza?" a cada dia, todo dia.
   *
   * Só mexe no que veio do APP: dia lançado pelo escritório tem motivo escrito
   * e história própria, e some só por lá.
   */
  async desmarcarPresenca(motoristaId: string, dataYmd: string) {
    const a = await this.prisma.alocacaoObra.findFirst({
      where: { motoristaId, ativa: true },
      select: { id: true },
    });
    if (!a) throw new BadRequestException("Você não está alocado em nenhuma obra.");

    const r = await this.prisma.registroPresenca.findFirst({
      where: { alocacaoId: a.id, data: dia(dataYmd) },
    });
    // Nada a desfazer não é erro: o app pode estar desfazendo algo que nunca
    // chegou a subir, e devolver 404 faria a tela mostrar falha num sucesso.
    if (!r) return { desmarcado: true };

    if (r.origem !== "APP") {
      throw new ForbiddenException(
        "Esse dia foi lançado pelo escritório. Fale com eles para corrigir.",
      );
    }

    await this.prisma.registroPresenca.delete({ where: { id: r.id } });
    return { desmarcado: true };
  }

  /**
   * Os dias do mês, do ponto de vista do motorista.
   *
   * Pra quem é pago por diária, "quantos dias eu já fiz" é a pergunta do mês
   * inteiro — e até agora ele só conseguia responder de cabeça. O escritório
   * tem a grade; ele não tinha nada.
   *
   * Vale pra QUALQUER alocação dele no mês, não só a ativa: obra que terminou
   * dia 10 e outra que começou dia 11 são dois contratos e um mês só, e somar
   * errado aqui é discutir pagamento com número errado.
   *
   * O que este método NÃO devolve: valor em dinheiro. Isso é conversa do
   * acerto, e misturar transformaria uma tela de conferência numa tela de
   * cobrança. Existe a flag `podeVerValorDiaria` pra quando for a hora.
   */
  async meusDias(motoristaId: string, mesRotulo: string) {
    const [ano, mes] = mesRotulo.split("-").map(Number);
    if (!ano || !mes) throw new BadRequestException("Mês inválido.");
    const primeiro = new Date(Date.UTC(ano, mes - 1, 1));
    const ultimo = new Date(Date.UTC(ano, mes, 0));

    const alocacoes = await this.prisma.alocacaoObra.findMany({
      where: {
        motoristaId,
        inicio: { lte: ultimo },
        OR: [{ fim: null }, { fim: { gte: primeiro } }],
      },
      include: { cliente: { select: { nome: true } } },
    });
    if (alocacoes.length === 0) return { mes: mesRotulo, total: 0, dias: [], obras: [] };

    const registros = await this.prisma.registroPresenca.findMany({
      where: {
        alocacaoId: { in: alocacoes.map((a) => a.id) },
        data: { gte: primeiro, lte: ultimo },
      },
      select: { data: true, origem: true },
      orderBy: { data: "asc" },
    });
    const marcados = new Map(registros.map((r) => [paraYmd(r.data), r.origem]));

    // Um dia "vazio" só existe se ele estava alocado naquele dia E o dia já
    // passou. Cobrar dia futuro seria inventar dívida; cobrar dia fora da
    // vigência seria cobrar de quem nem estava lá.
    const [ay, am, ad] = ymdSaoPaulo();
    const hoje = `${ay}-${String(am).padStart(2, "0")}-${String(ad).padStart(2, "0")}`;
    const alocadoEm = (d: string) =>
      alocacoes.some((a) => d >= paraYmd(a.inicio) && (!a.fim || d <= paraYmd(a.fim)));

    const dias = this.diasEntre(primeiro, ultimo)
      .filter((d) => alocadoEm(d))
      .map((d) => ({
        data: d,
        marcado: marcados.has(d),
        origem: marcados.get(d) ?? null,
        futuro: d > hoje,
      }));

    return {
      mes: mesRotulo,
      total: registros.length,
      dias,
      obras: [...new Set(alocacoes.map((a) => a.cliente.nome))],
    };
  }

  /** A grade do período, por alocação. É a base do espelho da Fase 2. */
  async grade(clienteId: string | undefined, de: string, ate: string) {
    const registros = await this.prisma.registroPresenca.findMany({
      where: {
        data: { gte: dia(de), lte: dia(ate) },
        ...(clienteId ? { alocacao: { clienteId } } : {}),
      },
      include: {
        alocacao: {
          include: {
            cliente: { select: { id: true, nome: true } },
            motorista: { select: { id: true, nome: true } },
            veiculo: { select: { placa: true } },
          },
        },
      },
      orderBy: [{ data: "asc" }],
    });

    const porAlocacao = new Map<string, { alocacao: unknown; dias: { data: string; origem: string }[] }>();
    for (const r of registros) {
      const atual = porAlocacao.get(r.alocacaoId) ?? {
        alocacao: {
          id: r.alocacao.id,
          obra: r.alocacao.cliente.nome,
          motorista: r.alocacao.motorista.nome,
          placa: r.alocacao.veiculo.placa,
        },
        dias: [],
      };
      atual.dias.push({ data: paraYmd(r.data), origem: r.origem });
      porAlocacao.set(r.alocacaoId, atual);
    }

    return [...porAlocacao.values()].map((x) => ({ ...x, total: x.dias.length }));
  }

  // ------------------------------------------------------------ espelho ---

  /**
   * O espelho da competência: o que o contrato esperava contra o que
   * aconteceu, alocação por alocação.
   *
   * É o documento que a transportadora leva pra conversa do dia 20. Hoje ela
   * chega sem nada e pergunta no grupo de WhatsApp.
   *
   * O calendário e o dia de corte vêm da configuração DO CONTRATANTE, nunca do
   * código: são vários, cada um com o seu combinado.
   */
  async espelho(competenciaRotulo: string, filtros: { clienteId?: string; empresaId?: string }) {
    const alocacoes = await this.prisma.alocacaoObra.findMany({
      where: {
        ...(filtros.clienteId ? { clienteId: filtros.clienteId } : {}),
        ...(filtros.empresaId ? { cliente: { empresaId: filtros.empresaId } } : {}),
      },
      include: {
        cliente: { select: { id: true, nome: true, empresaId: true } },
        motorista: { select: { id: true, nome: true, cpf: true } },
        veiculo: { select: { placa: true } },
      },
      orderBy: [{ ativa: "desc" }],
    });
    if (alocacoes.length === 0) return { competencia: null, linhas: [] };

    // Uma consulta de config por contratante, não por alocação: 45 obras do
    // mesmo contratante não podem virar 45 idas ao banco.
    const empresaIds = [...new Set(alocacoes.map((a) => a.cliente.empresaId))];
    const configs = await this.prisma.configMensalContratante.findMany({
      where: { empresaId: { in: empresaIds } },
    });
    const configPorEmpresa = new Map(configs.map((c) => [c.empresaId, c]));

    const linhas: {
      alocacaoId: string;
      obra: string;
      motorista: string;
      placa: string;
      diaCorte: number;
      de: string;
      ate: string;
      espelho: Espelho;
    }[] = [];

    for (const a of alocacoes) {
      const cfg = configPorEmpresa.get(a.cliente.empresaId);
      // Contratante sem configuração ainda usa a semente. É o que faz a tela
      // abrir no primeiro dia, antes de alguém configurar nada.
      const diaCorte = cfg?.diaCorte ?? 20;
      const diasEsperadosSemana = cfg?.diasEsperadosSemana ?? [1, 2, 3, 4, 5, 6];
      const competencia = competenciaDe(competenciaRotulo, diaCorte);

      const registros = await this.prisma.registroPresenca.findMany({
        where: {
          alocacaoId: a.id,
          data: { gte: dia(competencia.de), lte: dia(competencia.ate) },
        },
        select: { data: true, origem: true },
      });

      const espelho = montarEspelho({
        competencia,
        diasEsperadosSemana,
        inicio: paraYmd(a.inicio),
        fim: a.fim ? paraYmd(a.fim) : null,
        registrados: registros.map((r) => ({ data: paraYmd(r.data), origem: r.origem })),
      });

      // Alocação que não tem nada a ver com o período não polui o documento.
      if (espelho.esperados.length === 0 && espelho.registrados.length === 0) continue;

      linhas.push({
        alocacaoId: a.id,
        obra: a.cliente.nome,
        motorista: a.motorista.nome,
        placa: a.veiculo.placa,
        diaCorte,
        de: competencia.de,
        ate: competencia.ate,
        espelho,
      });
    }

    return { competencia: competenciaRotulo, linhas };
  }

  /** O combinado com um contratante: dia de corte e calendário da obra. */
  async configDoContratante(empresaId: string) {
    const cfg = await this.prisma.configMensalContratante.findFirst({ where: { empresaId } });
    return cfg ?? { empresaId, diaCorte: 20, diasEsperadosSemana: [1, 2, 3, 4, 5, 6] };
  }

  async salvarConfigDoContratante(
    empresaId: string,
    dados: { diaCorte: number; diasEsperadosSemana: number[] },
  ) {
    const empresa = await this.prisma.empresa.findFirst({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException("Contratante não encontrado.");
    return this.prisma.configMensalContratante.upsert({
      where: { empresaId },
      create: { empresaId, ...dados },
      update: dados,
    });
  }

  /**
   * O escritório lançando no lugar do motorista. Exige motivo escrito.
   *
   * Fica com `origem: PAINEL` porque o espelho precisa distinguir: a prova que
   * vale contra a medição do contratante é a que veio do aparelho dele.
   */
  async lancarPelaPainel(dados: LancarPresencaPainelInput, usuarioId: string) {
    const a = await this.buscarAlocacao(dados.alocacaoId);
    const d = dia(dados.data);
    if (d < a.inicio) throw new BadRequestException("Esse dia é anterior ao início na obra.");
    if (a.fim && d > a.fim) throw new BadRequestException("Esse dia é posterior ao fim na obra.");

    const existente = await this.prisma.registroPresenca.findFirst({
      where: { alocacaoId: a.id, data: d },
    });
    if (existente) throw new ConflictException("Esse dia já está registrado.");

    this.log.log(`Presença lançada pelo painel: alocação ${a.id}, dia ${dados.data}.`);
    return this.prisma.registroPresenca.create({
      data: {
        alocacaoId: a.id,
        data: d,
        origem: "PAINEL",
        motivoPainel: dados.motivo,
        criadoPorId: usuarioId,
      },
    });
  }

  /**
   * Remover um dia lançado errado. Só o que o PAINEL lançou.
   *
   * O registro do motorista não se apaga pelo escritório: ele é a prova dele, e
   * apagar prova de alguém sem que ele saiba é o tipo de poder que o sistema
   * não deve ter. Dia marcado errado pelo motorista vira discussão no espelho,
   * que é onde ele pode responder.
   */
  async removerPresenca(id: string, motivo: string) {
    const r = await this.prisma.registroPresenca.findFirst({ where: { id } });
    if (!r) throw new NotFoundException("Dia não encontrado.");
    if (r.origem === "APP") {
      throw new ForbiddenException(
        "Este dia foi marcado pelo motorista e não se apaga pelo painel. Trate a divergência no espelho.",
      );
    }
    this.log.log(`Presença ${id} removida pelo painel: ${motivo}`);
    await this.prisma.registroPresenca.delete({ where: { id } });
    return { removido: true };
  }
}
