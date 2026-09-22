import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { abrirRegime, encerrarRegime, soDigitos } from "../common/regime-vigente";
import { contaIdAtual } from "../common/conta/conta-context";
import { paraCadaConta } from "../common/conta/para-cada-conta";
import { ymdSaoPaulo } from "../common/timezone";
import {
  apurarPeriodo,
  type ApuracaoDia,
  type MarcacaoApurada,
} from "../common/ponto-jornada";
import {
  competenciaPonto,
  diasDoPeriodo,
  feriadoAlcanca,
  feriadosNacionais,
  jornadaDoDia,
  montarEspelhoPonto,
  resumoDaCompetencia,
  type FeriadoPuro,
  type VinculoPuro,
} from "../common/ponto-espelho";
import { createHash } from "node:crypto";
import { parseXlsx } from "../fechamentos/parsers/xlsx-parser";
import {
  lerFuncionariosDaPlanilha,
  montarModeloFuncionarios,
} from "./funcionarios-planilha";

/**
 * O lado do ESCRITÓRIO no módulo de ponto: quem bate, qual jornada, o espelho,
 * a correção e o fechamento.
 *
 * ⚠️ O que este serviço NUNCA faz: escrever em `ponto_marcacoes`. O registro é
 * do trabalhador e é append-only (tem trigger no banco). Lançamento de gestor
 * é `CorrecaoPonto` — linha nova, com autor e motivo escrito, exatamente como
 * a alteração de km do mensal.
 */
@Injectable()
export class PontoAdminService {
  private readonly log = new Logger(PontoAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────────────────────── primeiro acesso ───────────────────────────

  /**
   * A configuração da conta, semeada na primeira vez que alguém abre o módulo.
   *
   * Semeia junto os feriados nacionais dos dois anos em volta. Sem isso o
   * previsto conta 8h no dia 7 de setembro e o espelho do mês inteiro sai com
   * saldo negativo pra empresa toda — erro que aparece no primeiro mês,
   * atinge todo mundo ao mesmo tempo e destrói a confiança no número, que é a
   * única coisa que o módulo vende.
   */
  async config() {
    const existente = await this.prisma.configPonto.findFirst();
    if (existente) return existente;

    // ⚠️ `Conta` está em MODELS_GLOBAIS: a trava não injeta `contaId` nela, e
    // `findFirst` SEM `where` lança de propósito (`exigirAlvo`) — senão a
    // config do ponto de uma empresa nasceria com a razão social de outra.
    // Foi exatamente o 500 que apareceu no primeiro acesso à tela.
    const conta = await this.prisma.conta.findFirst({
      where: { id: contaIdAtual() },
      select: { nome: true, cnpj: true },
    });
    const criada = await this.prisma.configPonto.create({
      data: {
        // `contaId` é a PK aqui, então o tipo do Prisma exige explícito — a
        // trava injeta em runtime, mas o TypeScript não sabe disso.
        contaId: contaIdAtual(),
        razaoSocial: conta?.nome ?? "",
        cnpj: conta?.cnpj ?? "",
        identificacaoRep: "Movatruck Ponto",
        avisoLgpdTexto:
          "Ao bater o ponto, o aplicativo registra a data, a hora e — quando o aparelho informa — a sua localização naquele instante. A localização serve só como evidência do registro e é apagada depois do prazo configurado pela empresa.",
      },
    });
    await this.semearMotivos();
    await this.semearFeriados();
    return criada;
  }

  private async semearMotivos() {
    const semente = [
      { codigo: "ESQUECEU", descricao: "Esqueci de registrar", ordem: 1 },
      { codigo: "SEM_CELULAR", descricao: "Estava sem o celular", ordem: 2 },
      { codigo: "APP_FORA", descricao: "O aplicativo não abriu", ordem: 3 },
      { codigo: "ATESTADO", descricao: "Atestado médico", exigeAnexo: true, ordem: 4 },
      { codigo: "FOLGA", descricao: "Folga combinada", ordem: 5 },
      { codigo: "OUTRO", descricao: "Outro motivo", ordem: 9 },
    ];
    for (const m of semente) {
      await this.prisma.motivoCorrecaoPonto
        .create({ data: { codigo: m.codigo, descricao: m.descricao, exigeAnexo: m.exigeAnexo ?? false, ordem: m.ordem } })
        .catch(() => {});
    }
  }

  /** Nacionais dos dois anos em volta. Estadual e municipal são cadastro. */
  async semearFeriados(anoBase?: number) {
    const [ano] = ymdSaoPaulo();
    const base = anoBase ?? ano;
    for (const a of [base, base + 1]) {
      for (const f of feriadosNacionais(a)) {
        await this.prisma.feriadoPonto
          .create({
            data: {
              data: new Date(`${f.data}T00:00:00.000Z`),
              nome: f.nome,
              abrangencia: "NACIONAL",
            },
          })
          .catch(() => {});
      }
    }
  }

  /**
   * Em dezembro, gera o ano seguinte pra todas as contas.
   *
   * Sem isto o feriado acaba em janeiro e ninguém percebe até o espelho de
   * fevereiro sair errado.
   */
  @Cron("0 0 3 15 12 *", { name: "ponto-feriados-do-ano-seguinte", timeZone: "America/Sao_Paulo" })
  async cronFeriados(): Promise<void> {
    const [ano] = ymdSaoPaulo();
    await paraCadaConta(this.prisma, async () => {
      const tem = await this.prisma.configPonto.findFirst({ select: { contaId: true } });
      if (!tem) return;
      await this.semearFeriados(ano + 1);
    }).catch((e: unknown) => this.log.error(`feriados do ano seguinte: ${(e as Error).message}`));
  }

  /**
   * Apaga a localização das marcações antigas.
   *
   * ⚠️ Entra junto com a coleta, nunca depois: não se coleta geolocalização de
   * empregado prometendo apagar e deixando o "depois" pra uma fase futura.
   */
  @Cron("0 30 3 * * *", { name: "ponto-expurgo-localizacao", timeZone: "America/Sao_Paulo" })
  async cronExpurgoLocalizacao(): Promise<void> {
    await paraCadaConta(this.prisma, async () => {
      const cfg = await this.prisma.configPonto.findFirst({
        select: { diasRetencaoLocalizacao: true },
      });
      if (!cfg) return;
      const limite = new Date(Date.now() - cfg.diasRetencaoLocalizacao * 86_400_000);
      const r = await this.prisma.marcacaoLocalizacao.deleteMany({
        where: { criadoEm: { lt: limite } },
      });
      if (r.count > 0) this.log.log(`expurgo de localização de ponto: ${r.count} linha(s)`);
    }).catch((e: unknown) => this.log.error(`expurgo de localização: ${(e as Error).message}`));
  }

  async salvarConfig(dados: {
    razaoSocial?: string;
    cnpj?: string;
    fundamento?: "ACORDO_COLETIVO";
    fundamentoReferencia?: string;
    diaFechamento?: number;
    identificacaoRep?: string;
    diasRetencaoLocalizacao?: number;
    avisoLgpdTexto?: string;
    mesesAcessoAposDesligamento?: number;
    usuarioId?: string;
  }) {
    const atual = await this.config();

    // ⚠️ Trocar o dia de fechamento com competência FECHADA parte o
    // calendário: de 30 pra 5 faria os dias 01 a 05 do mês seguinte não
    // caírem em competência nenhuma — ou caírem em duas. No mensal isso
    // discute diária; aqui discute hora de CLT.
    if (dados.diaFechamento != null && dados.diaFechamento !== atual.diaFechamento) {
      const fechada = await this.prisma.fechamentoPonto.findFirst({
        where: { status: "FECHADO" },
        select: { competencia: true },
      });
      if (fechada) {
        throw new ConflictException(
          `Não dá pra mudar o dia de fechamento: a competência ${fechada.competencia} já está fechada e o calendário do mês seguinte ficaria com dias fora de qualquer competência. Reabra o que precisar ajustar, ou mude a partir de uma conta nova.`,
        );
      }
    }

    const registrouFundamento = dados.fundamento && !atual.fundamento;

    return this.prisma.configPonto.update({
      where: { contaId: atual.contaId },
      data: {
        ...(dados.razaoSocial !== undefined ? { razaoSocial: dados.razaoSocial } : {}),
        ...(dados.cnpj !== undefined ? { cnpj: soDigitos(dados.cnpj) } : {}),
        ...(dados.fundamento !== undefined ? { fundamento: dados.fundamento } : {}),
        ...(dados.fundamentoReferencia !== undefined
          ? { fundamentoReferencia: dados.fundamentoReferencia }
          : {}),
        ...(registrouFundamento
          ? { fundamentoRegistradoEm: new Date(), fundamentoRegistradoPorId: dados.usuarioId ?? null }
          : {}),
        ...(dados.diaFechamento !== undefined ? { diaFechamento: dados.diaFechamento } : {}),
        ...(dados.identificacaoRep !== undefined
          ? { identificacaoRep: dados.identificacaoRep }
          : {}),
        ...(dados.diasRetencaoLocalizacao !== undefined
          ? { diasRetencaoLocalizacao: dados.diasRetencaoLocalizacao }
          : {}),
        ...(dados.avisoLgpdTexto !== undefined ? { avisoLgpdTexto: dados.avisoLgpdTexto } : {}),
        ...(dados.mesesAcessoAposDesligamento !== undefined
          ? { mesesAcessoAposDesligamento: dados.mesesAcessoAposDesligamento }
          : {}),
      },
    });
  }

  // ─────────────────────────── funcionários ───────────────────────────

  listarFuncionarios(incluirInativos = false) {
    return this.prisma.funcionario.findMany({
      where: incluirInativos ? {} : { ativo: true },
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
      include: {
        jornadas: {
          where: { chaveViva: { not: null } },
          select: { modelo: { select: { id: true, nome: true } }, vigenteDe: true },
        },
      },
    });
  }

  /**
   * Contrata: cria o funcionário E registra que este CPF é EMPREGADO.
   *
   * As duas escritas na mesma transação, e o `await` dentro dela: separadas,
   * uma falha deixaria a outra de pé, e o furo seria exatamente o que a trava
   * existe pra impedir.
   */
  async contratar(dados: {
    nome: string;
    cpf: string;
    pis?: string;
    matricula?: string;
    cargo?: string;
    uf?: string;
    municipioIbge?: string;
    admitidoEm: string;
    modeloJornadaId?: string;
    usuarioId: string;
  }) {
    const cpf = soDigitos(dados.cpf);
    if (cpf.length !== 11) throw new BadRequestException("Informe um CPF válido.");

    const admitidoEm = new Date(`${dados.admitidoEm}T00:00:00.000Z`);

    return this.prisma.$transaction(async (tx) => {
      await abrirRegime(tx, {
        cpf,
        regime: "EMPREGADO",
        inicio: admitidoEm,
        criadoPorId: dados.usuarioId,
      });

      const identidade = await tx.motoristaIdentidade
        .findFirst({ where: { cpf }, select: { id: true } })
        .catch(() => null);

      const f = await tx.funcionario.create({
        data: {
          nome: dados.nome,
          cpf,
          pis: dados.pis ?? null,
          matricula: dados.matricula ?? null,
          cargo: dados.cargo ?? null,
          uf: dados.uf ?? null,
          municipioIbge: dados.municipioIbge ?? null,
          admitidoEm,
          identidadeId: identidade?.id ?? null,
          criadoPorId: dados.usuarioId,
        },
      });

      if (dados.modeloJornadaId) {
        await tx.vinculoJornada.create({
          data: {
            funcionarioId: f.id,
            modeloId: dados.modeloJornadaId,
            vigenteDe: admitidoEm,
            chaveViva: f.id,
            criadoPorId: dados.usuarioId,
          },
        });
      }
      return f;
    });
  }

  async editarFuncionario(id: string, dados: Record<string, unknown>) {
    const f = await this.prisma.funcionario.findFirst({ where: { id } });
    if (!f) throw new NotFoundException("Funcionário não encontrado.");
    // CPF não muda: é a chave da trava e do histórico. Trocar seria mudar de
    // pessoa mantendo o registro de ponto da anterior.
    const { cpf: _cpf, ...resto } = dados as Record<string, unknown> & { cpf?: string };
    return this.prisma.funcionario.update({ where: { id }, data: resto });
  }

  /** Desliga: encerra o acesso de escrita e libera o CPF da trava. */
  async desligar(id: string, dados: { desligadoEm: string; motivo: string }) {
    if (!dados.motivo?.trim()) throw new BadRequestException("Escreva o motivo do desligamento.");
    const f = await this.prisma.funcionario.findFirst({ where: { id }, select: { cpf: true } });
    if (!f) throw new NotFoundException("Funcionário não encontrado.");

    return this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.funcionario.update({
        where: { id },
        data: {
          desligadoEm: new Date(`${dados.desligadoEm}T00:00:00.000Z`),
          desligamentoMotivo: dados.motivo,
          ativo: false,
        },
      });
      // Fecha a jornada viva junto: deixar aberta faria o previsto continuar
      // contando depois da saída.
      await tx.vinculoJornada.updateMany({
        where: { funcionarioId: id, chaveViva: { not: null } },
        data: { chaveViva: null, vigenteAte: atualizado.desligadoEm },
      });
      // ⚠️ `regime: EMPREGADO` não é redundância: desligar um funcionário não
      // pode soltar a chave de um contrato de PARCEIRO. Funcionário legado
      // (importado antes da trava, sem regime) que depois ganhou alocação de
      // obra tem regime de PARCEIRO vivo — e o desligamento apagava ele.
      await encerrarRegime(tx, {
        cpf: f.cpf,
        motivo: `desligamento: ${dados.motivo}`,
        regime: "EMPREGADO",
      });
      return atualizado;
    });
  }

  // ─────────────────────────── importação ───────────────────────────

  async modeloFuncionarios(): Promise<Buffer> {
    const jornadas = await this.prisma.modeloJornada.findMany({
      where: { ativo: true },
      select: { nome: true },
      orderBy: { nome: "asc" },
    });
    return montarModeloFuncionarios(jornadas.map((j) => j.nome));
  }

  /**
   * Lê a planilha e devolve o que dá e o que não dá. NÃO grava.
   *
   * Separar leitura de gravação pelo mesmo motivo do importador de medição: o
   * que o parser não reconheceu tem que aparecer na tela antes, não sumir.
   * Aqui tem um caso a mais — CPF que já é parceiro autônomo. Esse não é erro
   * de planilha, é a trava fazendo o trabalho dela, e o texto tem que dizer
   * isso pra pessoa saber o que encerrar.
   */
  async previaFuncionarios(arquivo: Buffer, nome: string) {
    let abas;
    try {
      abas = (await parseXlsx(arquivo, nome)).abas;
    } catch {
      throw new BadRequestException("Não consegui abrir essa planilha. Envie o .xlsx do modelo.");
    }

    const leitura = lerFuncionariosDaPlanilha(abas);
    if (leitura.validas.length === 0 && leitura.invalidas.length === 0) {
      throw new BadRequestException("Não achei nenhum funcionário nessa planilha.");
    }

    const [jaExistem, regimes, jornadas] = await Promise.all([
      this.prisma.funcionario.findMany({
        where: { cpf: { in: leitura.validas.map((v) => v.cpf) } },
        select: { cpf: true },
      }),
      this.prisma.regimeVigente.findMany({
        where: { chaveViva: { in: leitura.validas.map((v) => v.cpf) } },
        select: { cpf: true, regime: true },
      }),
      this.prisma.modeloJornada.findMany({ where: { ativo: true }, select: { id: true, nome: true } }),
    ]);

    const existentes = new Set(jaExistem.map((f) => f.cpf));
    const parceiros = new Set(regimes.filter((r) => r.regime === "PARCEIRO").map((r) => r.cpf));
    const porNome = new Map(jornadas.map((j) => [j.nome.toLowerCase(), j.id]));

    const criar: typeof leitura.validas = [];
    const bloqueadas = [...leitura.invalidas];

    for (const v of leitura.validas) {
      if (existentes.has(v.cpf)) {
        bloqueadas.push({
          linha: v.linha,
          descricao: `${v.nome} · ${v.cpf}`,
          motivo: "Já está cadastrado como funcionário.",
        });
        continue;
      }
      if (parceiros.has(v.cpf)) {
        bloqueadas.push({
          linha: v.linha,
          descricao: `${v.nome} · ${v.cpf}`,
          motivo:
            "Este CPF tem contrato de parceiro autônomo ativo. Encerre a alocação dele antes — a mesma pessoa não pode estar nas duas situações.",
        });
        continue;
      }
      if (v.jornada && !porNome.has(v.jornada.toLowerCase())) {
        bloqueadas.push({
          linha: v.linha,
          descricao: `${v.nome} · ${v.cpf}`,
          motivo: `Jornada "${v.jornada}" não existe. Crie antes, ou deixe a coluna em branco.`,
        });
        continue;
      }
      criar.push(v);
    }

    return { criar, bloqueadas };
  }

  /** Cria o que a prévia aprovou. Um por vez: uma falha não derruba as outras. */
  async confirmarFuncionarios(
    linhas: { nome: string; cpf: string; cargo?: string; matricula?: string; admitidoEm?: string; jornada?: string }[],
    usuarioId: string,
  ) {
    const jornadas = await this.prisma.modeloJornada.findMany({
      where: { ativo: true },
      select: { id: true, nome: true },
    });
    const porNome = new Map(jornadas.map((j) => [j.nome.toLowerCase(), j.id]));
    const [ano, mes, diaHoje] = ymdSaoPaulo();
    const hoje = `${ano}-${String(mes).padStart(2, "0")}-${String(diaHoje).padStart(2, "0")}`;

    const criados: string[] = [];
    const falharam: { descricao: string; motivo: string }[] = [];

    for (const l of linhas) {
      try {
        const f = await this.contratar({
          nome: l.nome,
          cpf: l.cpf,
          cargo: l.cargo,
          matricula: l.matricula,
          admitidoEm: l.admitidoEm ?? hoje,
          modeloJornadaId: l.jornada ? porNome.get(l.jornada.toLowerCase()) : undefined,
          usuarioId,
        });
        criados.push(f.id);
      } catch (e) {
        falharam.push({ descricao: `${l.nome} · ${l.cpf}`, motivo: (e as Error).message });
      }
    }
    return { criados: criados.length, falharam };
  }

  // ─────────────────────────── jornadas ───────────────────────────

  listarModelos() {
    return this.prisma.modeloJornada.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      include: { dias: { orderBy: { posicao: "asc" } } },
    });
  }

  async salvarModelo(dados: {
    id?: string;
    nome: string;
    tipo: "SEMANAL" | "CICLO";
    cicloDias?: number;
    ancoraCiclo?: string;
    toleranciaPorMarcacaoMin: number;
    toleranciaDiariaMin: number;
    intervaloMinimoMin: number;
    preAssinalacaoIntervalo: boolean;
    preAssinalacaoMinutos?: number;
    maxDirecaoContinuaMin?: number;
    interjornadaMin?: number;
    descansoSemanalMin?: number;
    dias: {
      posicao: number;
      trabalha: boolean;
      entrada?: string;
      saida?: string;
      intervaloMin: number;
    }[];
  }) {
    // Teto legal da tolerância (art. 58 §1º): configura pra MENOS, nunca pra
    // mais. Acima disso o "tolerado" vira hora extra não paga.
    if (dados.toleranciaPorMarcacaoMin > 5 || dados.toleranciaDiariaMin > 10) {
      throw new BadRequestException(
        "A tolerância não pode passar de 5 minutos por marcação e 10 no dia — é o limite da lei. Configure para menos, se quiser.",
      );
    }

    const dias = dados.dias.map((d) => ({
      posicao: d.posicao,
      trabalha: d.trabalha,
      entrada: d.trabalha ? (d.entrada ?? null) : null,
      saida: d.trabalha ? (d.saida ?? null) : null,
      intervaloMin: d.intervaloMin,
      cargaMin: d.trabalha ? cargaDoDia(d.entrada, d.saida, d.intervaloMin) : 0,
    }));

    const base = {
      nome: dados.nome,
      tipo: dados.tipo,
      cicloDias: dados.tipo === "CICLO" ? (dados.cicloDias ?? 2) : null,
      ancoraCiclo: dados.ancoraCiclo ? new Date(`${dados.ancoraCiclo}T00:00:00.000Z`) : null,
      toleranciaPorMarcacaoMin: dados.toleranciaPorMarcacaoMin,
      toleranciaDiariaMin: dados.toleranciaDiariaMin,
      intervaloMinimoMin: dados.intervaloMinimoMin,
      preAssinalacaoIntervalo: dados.preAssinalacaoIntervalo,
      preAssinalacaoMinutos: dados.preAssinalacaoIntervalo
        ? (dados.preAssinalacaoMinutos ?? 60)
        : null,
      maxDirecaoContinuaMin: dados.maxDirecaoContinuaMin ?? null,
      interjornadaMin: dados.interjornadaMin ?? null,
      descansoSemanalMin: dados.descansoSemanalMin ?? null,
    };

    return this.prisma.$transaction(async (tx) => {
      const modelo = dados.id
        ? await tx.modeloJornada.update({ where: { id: dados.id }, data: base })
        : await tx.modeloJornada.create({ data: base });
      await tx.jornadaDiaModelo.deleteMany({ where: { modeloId: modelo.id } });
      for (const d of dias) {
        await tx.jornadaDiaModelo.create({ data: { ...d, modeloId: modelo.id } });
      }
      return modelo;
    });
  }

  /**
   * Troca a jornada da pessoa a partir de uma data.
   *
   * Fecha a anterior no MESMO `$transaction`. Sem isso dá pra ter dois
   * vínculos abertos, o previsto do dia fica ambíguo — e o saldo ambíguo é
   * congelado no fechamento, onde ninguém mais o corrige.
   */
  async definirJornada(funcionarioId: string, modeloId: string, vigenteDe: string, usuarioId: string) {
    const de = new Date(`${vigenteDe}T00:00:00.000Z`);
    return this.prisma.$transaction(async (tx) => {
      await tx.vinculoJornada.updateMany({
        where: { funcionarioId, chaveViva: { not: null } },
        data: { chaveViva: null, vigenteAte: new Date(de.getTime() - 86_400_000) },
      });
      return tx.vinculoJornada.create({
        data: { funcionarioId, modeloId, vigenteDe: de, chaveViva: funcionarioId, criadoPorId: usuarioId },
      });
    });
  }

  // ─────────────────────────── o dia e o espelho ───────────────────────────

  /** Quem bateu hoje, e quem não bateu. A tela que o escritório abre de manhã. */
  async dia(data: string) {
    const [funcionarios, marcacoes] = await Promise.all([
      this.prisma.funcionario.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, cargo: true },
        orderBy: { nome: "asc" },
      }),
      this.prisma.marcacao.findMany({
        where: { dia: data },
        orderBy: { marcadoEm: "asc" },
        select: { id: true, funcionarioId: true, numeroRegistro: true, marcadoEm: true },
      }),
    ]);
    const porFuncionario = new Map<string, typeof marcacoes>();
    for (const m of marcacoes) {
      porFuncionario.set(m.funcionarioId, [...(porFuncionario.get(m.funcionarioId) ?? []), m]);
    }
    return {
      data,
      linhas: funcionarios.map((f) => ({
        funcionarioId: f.id,
        nome: f.nome,
        cargo: f.cargo,
        marcacoes: (porFuncionario.get(f.id) ?? []).map((m) => ({
          id: m.id,
          numeroRegistro: m.numeroRegistro,
          hora: horaBR(m.marcadoEm),
        })),
      })),
    };
  }

  /**
   * A coordenada de UMA batida, sob demanda.
   *
   * ⚠️ Endpoint próprio, e não campo do `dia`/`espelho`, por três motivos:
   *
   * 1. A tela do dia lista a equipe inteira. Mandar lat/lon junto faria a
   *    localização de todo mundo trafegar toda manhã pra ninguém olhar.
   * 2. Só quem tem `ponto.ver-localizacao` chega aqui. Se viajasse no `dia`,
   *    a permissão seria a de ver o dia.
   * 3. Consulta deixa rastro. Embutido na listagem não existe "consulta" —
   *    não dá pra distinguir quem olhou de quem abriu a tela.
   *
   * Devolve `null` quando não há coordenada, e isso é um estado NORMAL, não
   * um erro: o GPS desiste em 3s, a permissão pode não estar dada e a empresa
   * pode ter posto a retenção em 0. Não achar a coordenada nunca invalida a
   * batida.
   */
  async localizacaoDaMarcacao(marcacaoId: string, usuarioId: string) {
    const m = await this.prisma.marcacao.findFirst({
      where: { id: marcacaoId },
      select: {
        id: true,
        numeroRegistro: true,
        marcadoEm: true,
        funcionario: { select: { id: true, nome: true } },
        localizacao: { select: { latitude: true, longitude: true, precisao: true } },
      },
    });
    if (!m) throw new NotFoundException("Batida não encontrada.");

    // O rastro é gravado pela TENTATIVA, não pelo achado. Abrir e não ter
    // coordenada também é uma consulta à localização de alguém.
    await this.auditoria
      .log({
        usuarioId,
        entidade: "Marcacao",
        entidadeId: m.id,
        acao: "PONTO_VIU_LOCALIZACAO",
        metadata: {
          funcionarioId: m.funcionario.id,
          numeroRegistro: m.numeroRegistro,
          havia: m.localizacao != null,
        },
      })
      .catch((e: unknown) => this.log.error(`auditoria de localização: ${(e as Error).message}`));

    return {
      numeroRegistro: m.numeroRegistro,
      hora: horaBR(m.marcadoEm),
      funcionario: m.funcionario.nome,
      localizacao: m.localizacao
        ? {
            latitude: Number(m.localizacao.latitude),
            longitude: Number(m.localizacao.longitude),
            precisao: m.localizacao.precisao,
          }
        : null,
    };
  }

  /** O espelho de UMA pessoa. É o documento que ela confere e assina. */
  async espelho(funcionarioId: string, competencia: string) {
    const cfg = await this.config();
    const periodo = competenciaPonto(competencia, cfg.diaFechamento);
    const dias = diasDoPeriodo(periodo.de, periodo.ate);

    const f = await this.prisma.funcionario.findFirst({ where: { id: funcionarioId } });
    if (!f) throw new NotFoundException("Funcionário não encontrado.");

    const apuracoes = await this.apurar(f, periodo.de, periodo.ate, dias);

    const espelho = montarEspelhoPonto({
      funcionarioId: f.id,
      nome: f.nome,
      competencia: periodo,
      admitidoEm: f.admitidoEm.toISOString().slice(0, 10),
      desligadoEm: f.desligadoEm ? f.desligadoEm.toISOString().slice(0, 10) : null,
      dias: apuracoes,
    });

    const [correcoes, ciencia, fechamento] = await Promise.all([
      this.prisma.correcaoPonto.findMany({
        where: { funcionarioId, dia: { gte: periodo.de, lte: periodo.ate } },
        orderBy: { criadoEm: "asc" },
      }),
      this.prisma.cienciaEspelho.findFirst({ where: { funcionarioId, competencia } }),
      this.prisma.fechamentoPonto.findFirst({ where: { competencia } }),
    ]);

    return {
      ...espelho,
      cpf: f.cpf,
      matricula: f.matricula,
      cargo: f.cargo,
      empresa: { razaoSocial: cfg.razaoSocial, cnpj: cfg.cnpj },
      correcoes,
      ciencia,
      fechado: fechamento?.status === "FECHADO",
      /** O hash do que está sendo mostrado. É o que a ciência carimba. */
      hash: hashEspelho(espelho.dias),
    };
  }

  /** A competência inteira: a visão que vem ANTES da de uma pessoa. */
  async competencia(rotulo: string) {
    const cfg = await this.config();
    const periodo = competenciaPonto(rotulo, cfg.diaFechamento);
    const dias = diasDoPeriodo(periodo.de, periodo.ate);

    const funcionarios = await this.prisma.funcionario.findMany({
      where: {
        OR: [{ ativo: true }, { desligadoEm: { gte: new Date(`${periodo.de}T00:00:00.000Z`) } }],
      },
      orderBy: { nome: "asc" },
    });

    const linhas = [];
    for (const f of funcionarios) {
      const apuracoes = await this.apurar(f, periodo.de, periodo.ate, dias);
      const espelho = montarEspelhoPonto({
        funcionarioId: f.id,
        nome: f.nome,
        competencia: periodo,
        admitidoEm: f.admitidoEm.toISOString().slice(0, 10),
        desligadoEm: f.desligadoEm ? f.desligadoEm.toISOString().slice(0, 10) : null,
        dias: apuracoes,
      });
      const pendentes = await this.prisma.correcaoPonto.count({
        where: { funcionarioId: f.id, status: "PENDENTE" },
      });
      linhas.push({
        ...espelho,
        // Dos dias DO CONTRATO (`espelho.dias`), nunca do período inteiro: o
        // período da competência começa antes da admissão quando o corte não
        // é dia 31, e aquele dia a mais não tem jornada nenhuma — contá-lo
        // deixaria "sem jornada" aceso pra sempre, travando o fechamento sem
        // nada pra consertar.
        semJornada: espelho.dias.some((d) => !d.futuro && d.nomeModelo === ""),
        correcoesPendentes: pendentes,
      });
    }

    const fechamento = await this.prisma.fechamentoPonto.findFirst({ where: { competencia: rotulo } });
    const cienciaPendente = await this.prisma.correcaoPonto.count({
      where: { cienciaEm: null, status: "APROVADA", dia: { gte: periodo.de, lte: periodo.ate } },
    });

    return {
      competencia: periodo,
      ...resumoDaCompetencia(linhas),
      fechamento,
      /** O que trava o fechamento, em uma lista só. */
      travas: {
        diasParaConferir: linhas.reduce((s, l) => s + l.diasParaConferir, 0),
        correcoesPendentes: linhas.reduce((s, l) => s + l.correcoesPendentes, 0),
        semJornada: linhas.filter((l) => l.semJornada).length,
        cienciaPendente,
        semFundamento: !cfg.fundamento,
      },
    };
  }

  /** Apura um período pra uma pessoa. É o miolo que as duas telas chamam. */
  private async apurar(
    f: { id: string; uf: string | null; municipioIbge: string | null },
    de: string,
    ate: string,
    dias: string[],
  ): Promise<ApuracaoDia[]> {
    // Puxa um dia a mais dos dois lados: jornada que atravessa a meia-noite
    // pertence ao dia de ABERTURA, então a marcação do dia seguinte fecha o
    // par do último dia do período.
    const inicio = new Date(`${de}T00:00:00.000Z`);
    const fim = new Date(`${ate}T23:59:59.999Z`);

    const [marcacoes, correcoes, vinculos, feriados] = await Promise.all([
      this.prisma.marcacao.findMany({
        where: {
          funcionarioId: f.id,
          marcadoEm: {
            gte: new Date(inicio.getTime() - 86_400_000),
            lte: new Date(fim.getTime() + 86_400_000),
          },
        },
        orderBy: { marcadoEm: "asc" },
        select: { id: true, numeroRegistro: true, marcadoEm: true, desvioRelogioSeg: true },
      }),
      this.prisma.correcaoPonto.findMany({
        where: { funcionarioId: f.id, status: "APROVADA", dia: { gte: de, lte: ate } },
      }),
      this.prisma.vinculoJornada.findMany({
        where: { funcionarioId: f.id },
        include: { modelo: { include: { dias: true } } },
        orderBy: { vigenteDe: "asc" },
      }),
      this.prisma.feriadoPonto.findMany({
        where: { data: { gte: inicio, lte: fim } },
      }),
    ]);

    const desconsideradas = new Set(
      correcoes.filter((c) => c.tipo === "DESCONSIDERACAO" && c.marcacaoId).map((c) => c.marcacaoId!),
    );

    const apuradas: MarcacaoApurada[] = marcacoes.map((m) => ({
      numero: m.numeroRegistro,
      marcadoEm: m.marcadoEm,
      desconsiderada: desconsideradas.has(m.id),
    }));

    // Inclusões aprovadas entram como marcação, com número negativo pra
    // ficarem distinguíveis do registro original no espelho.
    let i = 0;
    for (const c of correcoes) {
      if (c.tipo === "INCLUSAO" && c.instantePretendido) {
        apuradas.push({
          numero: -++i,
          marcadoEm: c.instantePretendido,
          desconsiderada: false,
          incluida: true,
        });
      }
    }

    const puros: VinculoPuro[] = vinculos.map((v) => ({
      vigenteDe: v.vigenteDe.toISOString().slice(0, 10),
      vigenteAte: v.vigenteAte ? v.vigenteAte.toISOString().slice(0, 10) : null,
      modeloNome: v.modelo.nome,
      tipo: v.modelo.tipo,
      cicloDias: v.modelo.cicloDias,
      ancoraCiclo: v.modelo.ancoraCiclo ? v.modelo.ancoraCiclo.toISOString().slice(0, 10) : null,
      tolerancia: {
        porMarcacaoMin: v.modelo.toleranciaPorMarcacaoMin,
        diariaMin: v.modelo.toleranciaDiariaMin,
      },
      intervaloMinimoMin: v.modelo.intervaloMinimoMin,
      preAssinalacaoMinutos: v.modelo.preAssinalacaoIntervalo
        ? v.modelo.preAssinalacaoMinutos
        : null,
      dias: v.modelo.dias.map((d) => ({
        posicao: d.posicao,
        trabalha: d.trabalha,
        entrada: d.entrada,
        saida: d.saida,
        intervaloMin: d.intervaloMin,
        cargaMin: d.cargaMin,
      })),
    }));

    const feriadosPuros: FeriadoPuro[] = feriados.map((x) => ({
      data: x.data.toISOString().slice(0, 10),
      abrangencia: x.abrangencia,
      uf: x.uf,
      municipioIbge: x.municipioIbge,
    }));
    const doDia = new Set(
      feriadosPuros
        .filter((x) => feriadoAlcanca(x, f.uf, f.municipioIbge))
        .map((x) => x.data),
    );

    const jornadaPorDia = new Map(dias.map((d) => [d, jornadaDoDia(d, puros)]));
    const desvioPorNumero = new Map(
      marcacoes.filter((m) => m.desvioRelogioSeg != null).map((m) => [m.numeroRegistro, m.desvioRelogioSeg!]),
    );

    const [ay, am, ad] = ymdSaoPaulo();
    const hoje = `${ay}-${String(am).padStart(2, "0")}-${String(ad).padStart(2, "0")}`;

    return apurarPeriodo({
      dias,
      marcacoes: apuradas,
      jornadaPorDia,
      feriados: doDia,
      desvioPorNumero,
      hoje,
    });
  }

  // ─────────────────────────── correções ───────────────────────────

  listarCorrecoes(status?: "PENDENTE" | "APROVADA" | "RECUSADA") {
    return this.prisma.correcaoPonto.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: "asc" }, { criadoEm: "desc" }],
      include: { funcionario: { select: { id: true, nome: true, cargo: true } } },
      take: 300,
    });
  }

  /**
   * O gestor lança uma correção em nome de alguém.
   *
   * Nasce APROVADA — o escritório não pede pra si mesmo — e com CIÊNCIA
   * PENDENTE. Ajuste que a pessoa não sabe que existe é o que mais anula
   * controle de jornada numa reclamatória: o sistema que registra o ajuste e
   * não avisa produz a prova de que a empresa sabia que tinha que avisar.
   */
  async lancarCorrecao(dados: {
    funcionarioId: string;
    dia: string;
    tipo: "INCLUSAO" | "DESCONSIDERACAO" | "ANOTACAO";
    marcacaoId?: string;
    instantePretendido?: string;
    motivoCodigo: string;
    motivo: string;
    usuarioId: string;
  }) {
    if (!dados.motivo?.trim()) {
      throw new BadRequestException("Escreva o motivo da correção.");
    }
    await this.exigirCompetenciaAberta(dados.dia);

    return this.prisma.correcaoPonto.create({
      data: {
        funcionarioId: dados.funcionarioId,
        dia: dados.dia,
        tipo: dados.tipo,
        marcacaoId: dados.marcacaoId ?? null,
        instantePretendido: dados.instantePretendido ? new Date(dados.instantePretendido) : null,
        motivoCodigo: dados.motivoCodigo,
        motivo: dados.motivo,
        pedidoPor: "GESTOR",
        pedidoPorUserId: dados.usuarioId,
        status: "APROVADA",
        decididoPorUserId: dados.usuarioId,
        decididoEm: new Date(),
      },
    });
  }

  async decidirCorrecao(
    id: string,
    decisao: "APROVADA" | "RECUSADA",
    usuarioId: string,
    motivoDecisao?: string,
  ) {
    const c = await this.prisma.correcaoPonto.findFirst({ where: { id } });
    if (!c) throw new NotFoundException("Correção não encontrada.");
    if (c.status !== "PENDENTE") {
      throw new ConflictException("Essa correção já foi decidida.");
    }
    // Recusar sem dizer por quê é negar sem resposta — e a pessoa não tem o
    // que fazer com isso além de pedir de novo.
    if (decisao === "RECUSADA" && !motivoDecisao?.trim()) {
      throw new BadRequestException("Escreva por que a correção não foi aceita.");
    }
    await this.exigirCompetenciaAberta(c.dia);

    return this.prisma.correcaoPonto.update({
      where: { id },
      data: {
        status: decisao,
        decididoPorUserId: usuarioId,
        decididoEm: new Date(),
        decisaoMotivo: motivoDecisao ?? null,
      },
    });
  }

  /**
   * A ciência colhida no papel, presencialmente.
   *
   * Existe porque quem o escritório mais lança correção é justamente quem não
   * tem o app ou estava sem celular. Sem um segundo caminho, a fila de
   * ciência pendente só cresce — e fica carimbada como "colhida
   * presencialmente", visivelmente diferente de "ciência no app".
   */
  async cienciaPresencial(id: string, usuarioId: string, observacao?: string) {
    const c = await this.prisma.correcaoPonto.findFirst({ where: { id } });
    if (!c) throw new NotFoundException("Correção não encontrada.");
    if (c.cienciaEm) return c;
    return this.prisma.correcaoPonto.update({
      where: { id },
      data: {
        cienciaEm: new Date(),
        cienciaPresencial: true,
        cienciaColhidaPorUserId: usuarioId,
        cienciaObservacao: observacao ?? null,
      },
    });
  }

  private async exigirCompetenciaAberta(dia: string) {
    const cfg = await this.config();
    const fechados = await this.prisma.fechamentoPonto.findMany({
      where: { status: "FECHADO" },
      select: { competencia: true, inicio: true, fim: true },
    });
    const bate = fechados.find(
      (f) => dia >= f.inicio.toISOString().slice(0, 10) && dia <= f.fim.toISOString().slice(0, 10),
    );
    if (bate) {
      throw new ConflictException(
        `A competência ${bate.competencia} está fechada. Reabra com motivo antes de corrigir esse dia.`,
      );
    }
    void cfg;
  }

  // ─────────────────────────── fechamento ───────────────────────────

  listarFechamentos() {
    return this.prisma.fechamentoPonto.findMany({ orderBy: { competencia: "desc" }, take: 24 });
  }

  /**
   * Fecha a competência e CONGELA a apuração.
   *
   * Mesma doutrina do `ViagemValor`: horas se somam, e o mês que já foi pra
   * folha não pode mudar porque alguém editou a jornada depois.
   */
  async fechar(rotulo: string, usuarioId: string) {
    const cfg = await this.config();
    const periodo = competenciaPonto(rotulo, cfg.diaFechamento);
    const dias = diasDoPeriodo(periodo.de, periodo.ate);

    const existente = await this.prisma.fechamentoPonto.findFirst({ where: { competencia: rotulo } });
    if (existente?.status === "FECHADO") {
      throw new ConflictException("Essa competência já está fechada.");
    }

    const funcionarios = await this.prisma.funcionario.findMany({
      where: {
        OR: [{ ativo: true }, { desligadoEm: { gte: new Date(`${periodo.de}T00:00:00.000Z`) } }],
      },
    });

    const apuracoesPorPessoa = new Map<string, ApuracaoDia[]>();
    for (const f of funcionarios) {
      apuracoesPorPessoa.set(f.id, await this.apurar(f, periodo.de, periodo.ate, dias));
    }

    return this.prisma.$transaction(async (tx) => {
      const fechamento = existente
        ? await tx.fechamentoPonto.update({
            where: { id: existente.id },
            data: {
              status: "FECHADO",
              fechadoEm: new Date(),
              fechadoPorId: usuarioId,
              inicio: new Date(`${periodo.de}T00:00:00.000Z`),
              fim: new Date(`${periodo.ate}T00:00:00.000Z`),
            },
          })
        : await tx.fechamentoPonto.create({
            data: {
              competencia: rotulo,
              inicio: new Date(`${periodo.de}T00:00:00.000Z`),
              fim: new Date(`${periodo.ate}T00:00:00.000Z`),
              status: "FECHADO",
              fechadoEm: new Date(),
              fechadoPorId: usuarioId,
            },
          });

      // Refechar depois de reabrir: as linhas antigas saem e as novas entram.
      await tx.apuracaoDiaPonto.deleteMany({ where: { fechamentoId: fechamento.id } });

      for (const f of funcionarios) {
        const admitido = f.admitidoEm.toISOString().slice(0, 10);
        const desligado = f.desligadoEm ? f.desligadoEm.toISOString().slice(0, 10) : null;
        for (const d of apuracoesPorPessoa.get(f.id) ?? []) {
          if (d.dia < admitido) continue;
          if (desligado && d.dia > desligado) continue;
          await tx.apuracaoDiaPonto.create({
            data: {
              fechamentoId: fechamento.id,
              funcionarioId: f.id,
              dia: d.dia,
              minutosPrevistos: d.minutosPrevistos,
              minutosTrabalhados: d.minutosTrabalhados,
              minutosConsiderados: d.minutosConsiderados,
              saldoMin: d.saldoMin,
              registrosNumero: d.pares.flatMap((p) => p.numeros).filter((n) => n > 0),
              correcoesIds: [],
              jornadaModeloNome: d.nomeModelo,
              alertas: d.alertas.map((a) => a.codigo),
            },
          });
        }
      }
      return fechamento;
    });
  }

  /**
   * Reabre a competência e APAGA as apurações congeladas.
   *
   * A regra tem que estar escrita, senão reabrir vira estado sem saída: você
   * reabre exatamente pra corrigir, e as linhas congeladas recusam a correção.
   * Elas são derivadas — o registro original segue intacto, e fechar de novo
   * materializa tudo outra vez.
   */
  async reabrir(id: string, usuarioId: string, motivo: string) {
    if (!motivo?.trim()) throw new BadRequestException("Escreva por que está reabrindo.");
    const f = await this.prisma.fechamentoPonto.findFirst({ where: { id } });
    if (!f) throw new NotFoundException("Competência não encontrada.");
    if (f.status !== "FECHADO") return f;

    return this.prisma.$transaction(async (tx) => {
      await tx.apuracaoDiaPonto.deleteMany({ where: { fechamentoId: id } });
      return tx.fechamentoPonto.update({
        where: { id },
        data: {
          status: "ABERTO",
          reabertoEm: new Date(),
          reabertoPorId: usuarioId,
          reaberturaMotivo: motivo,
        },
      });
    });
  }
}

/** Minutos entre "07:00" e "17:00", menos o intervalo. */
function cargaDoDia(entrada?: string, saida?: string, intervaloMin = 0): number {
  if (!entrada || !saida) return 0;
  const min = (h: string) => {
    const [a, b] = h.split(":").map(Number);
    return (a ?? 0) * 60 + (b ?? 0);
  };
  let dur = min(saida) - min(entrada);
  // Vira o dia: 22:00 → 06:00 são 8h, não -16h.
  if (dur < 0) dur += 24 * 60;
  return Math.max(0, dur - intervaloMin);
}

function horaBR(d: Date): string {
  const br = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return `${String(br.getUTCHours()).padStart(2, "0")}:${String(br.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * A impressão digital do espelho que a pessoa viu.
 *
 * Sem isto, reapurar depois faria a ciência apontar pra um documento diferente
 * do que ela conferiu — mesma doutrina do `AssinaturaDocumento.hashArquivo`.
 */
export function hashEspelho(dias: ApuracaoDia[]): string {
  const canonico = dias
    .map((d) => `${d.dia}|${d.minutosPrevistos}|${d.minutosConsiderados}|${d.pares.map((p) => `${p.entrada.toISOString()}-${p.saida?.toISOString() ?? ""}`).join(",")}`)
    .join("\n");
  return createHash("sha256").update(canonico).digest("hex");
}
