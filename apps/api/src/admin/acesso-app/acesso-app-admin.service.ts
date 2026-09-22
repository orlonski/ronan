import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CAMADAS_CORTE,
  ehCapacidadeApp,
  type ConfigPlataformaAcessoAppInput,
  type CriarExcecaoAppInput,
  type ExcecaoLoteAppInput,
  type FixarPerfilAppInput,
  type PadraoAcessoAppInput,
  type RevogarExcecaoAppInput,
  type SalvarPerfilAppInput,
  type SalvarRegrasAppInput,
} from "@ronan/shared-types";
import { AcessoAppService, ondeExcecaoViva } from "../../common/acesso-app/acesso-app.service";
import { contaIdAtual } from "../../common/conta/conta-context";
import { type EscopoAdmin, filtroEscopo } from "../../common/escopo/escopo";
import { soDigitos } from "../../common/regime-vigente";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * A TELA "ACESSO AO APP": perfis, quem recebe qual perfil, exceções.
 *
 * ⚠️ Enquanto a empresa estiver no ESPELHO (`fonte: COLUNAS`), a ficha de cada
 * motorista manda e o espelho reescreve perfis e exceções herdadas de hora em
 * hora. Editar aqui nesse estado seria escrever num lugar que o cron apaga —
 * então as escritas recusam com 409 e a tela oferece passar pras regras (que
 * é conferido e não muda nada pra ninguém).
 *
 * ⚠️ Perfil, regra e padrão valem pra EMPRESA INTEIRA: exigem acesso global.
 * Exceção é por pessoa, então respeita o escopo de frota.
 */
const SETE_DIAS = 7 * 86_400_000;

@Injectable()
export class AcessoAppAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: AcessoAppService,
  ) {}

  private exigirGlobal(escopo: EscopoAdmin) {
    if (escopo) {
      throw new ForbiddenException(
        "Isto vale pra empresa inteira, e o seu acesso é restrito a algumas transportadoras. Peça pra quem tem acesso a todas.",
      );
    }
  }

  private async config() {
    await this.acesso.sincronizarSeNuncaRodou();
    return this.prisma.configuracaoAcessoApp.findUniqueOrThrow({ where: { contaId: contaIdAtual() } });
  }

  private async exigirRegras() {
    const cfg = await this.config();
    if (cfg.fonte !== "REGRAS") {
      throw new ConflictException(
        "Esta empresa ainda segue a ficha de cada motorista. Passe pras regras primeiro — não muda nada pra ninguém.",
      );
    }
    return cfg;
  }

  private async log(tipo: string, autorId: string, extra: { alvoId?: string; cpf?: string; motivo?: string; causa?: string } = {}) {
    await this.prisma.logAcessoApp.create({ data: { tipo, autorId, ...extra } });
  }

  // ─── leitura ─────────────────────────────────────────────────────────────

  async painel(plataforma: boolean) {
    const cfg = await this.config();
    const contaId = contaIdAtual();
    const [conta, perfis, regras, efetivos, excecoes, vencendo, modalidades, transportadoras] =
      await Promise.all([
        this.prisma.conta.findUniqueOrThrow({ where: { id: contaId }, select: { rolloutsApp: true } }),
        this.prisma.perfilAcessoApp.findMany({
          orderBy: [{ ativo: "desc" }, { nome: "asc" }],
          select: { id: true, nome: true, descricao: true, ativo: true, capacidades: true },
        }),
        this.prisma.regraAcessoApp.findMany({ orderBy: { ordem: "asc" } }),
        this.prisma.acessoEfetivoApp.findMany({
          select: { capacidades: true, capacidadesSombra: true, explicacao: true },
        }),
        this.prisma.excecaoAcessoApp.groupBy({
          by: ["origem"],
          where: ondeExcecaoViva(),
          _count: { _all: true },
        }),
        this.prisma.excecaoAcessoApp.count({
          where: {
            revogadaEm: null,
            expiraEm: { gt: new Date(), lte: new Date(Date.now() + SETE_DIAS) },
          },
        }),
        this.prisma.modalidadeMotorista.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
        this.prisma.transportadora.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
      ]);

    // Quantas pessoas caem em cada perfil hoje, e o que a sombra tiraria.
    const pessoasPorPerfil = new Map<string, number>();
    const perderiam = new Map<string, number>();
    for (const e of efetivos) {
      const base = (e.explicacao as { base?: Record<string, { perfilId?: string } | null> }).base ?? {};
      const vistos = new Set<string>();
      for (const b of Object.values(base)) {
        if (b?.perfilId && !vistos.has(b.perfilId)) {
          vistos.add(b.perfilId);
          pessoasPorPerfil.set(b.perfilId, (pessoasPorPerfil.get(b.perfilId) ?? 0) + 1);
        }
      }
      const sombra = new Set(e.capacidadesSombra);
      for (const c of e.capacidades) {
        if (!sombra.has(c)) perderiam.set(c, (perderiam.get(c) ?? 0) + 1);
      }
    }

    return {
      fonte: cfg.fonte,
      versao: cfg.versao,
      camadasEmSombra: cfg.camadasEmSombra,
      espelho: {
        em: cfg.espelhadoEm,
        divergencias: cfg.espelhoDivergencias,
      },
      perfilPadraoMotoristaId: cfg.perfilPadraoMotoristaId,
      perfilPadraoFuncionarioId: cfg.perfilPadraoFuncionarioId,
      perfis: perfis.map((p) => ({ ...p, pessoas: pessoasPorPerfil.get(p.id) ?? 0 })),
      regras,
      pessoas: efetivos.length,
      excecoes: Object.fromEntries(excecoes.map((e) => [e.origem, e._count._all])),
      // Aviso, não prazo imposto: só a exceção que alguém abriu com data vence.
      // As herdadas da ficha não vencem (decisão do dono).
      excecoesVencendo: vencendo,
      sombra: [...perderiam.entries()]
        .map(([capacidade, n]) => ({ capacidade, pessoas: n }))
        .sort((a, b) => b.pessoas - a.pessoas),
      rolloutsApp: conta.rolloutsApp,
      opcoes: { modalidades, transportadoras },
      plataforma,
    };
  }

  async explicarMotorista(id: string, escopo: EscopoAdmin) {
    const m = await this.prisma.motorista.findFirst({
      where: { id, ...filtroEscopo(escopo) },
      select: { cpf: true },
    });
    if (!m) throw new NotFoundException("Motorista não encontrado");
    return this.acesso.explicar(m.cpf);
  }

  async explicarFuncionario(id: string) {
    const f = await this.prisma.funcionario.findFirst({ where: { id }, select: { cpf: true } });
    if (!f) throw new NotFoundException("Funcionário não encontrado");
    return this.acesso.explicar(f.cpf);
  }

  async listarExcecoes(
    filtro: { origem?: string; cpf?: string; prazo?: string },
    escopo: EscopoAdmin,
  ) {
    const agora = new Date();
    const prazo =
      filtro.prazo === "vencendo"
        ? { expiraEm: { gt: agora, lte: new Date(agora.getTime() + SETE_DIAS) } }
        : filtro.prazo === "sem"
          ? { expiraEm: null }
          : {};
    const excecoes = await this.prisma.excecaoAcessoApp.findMany({
      where: {
        AND: [ondeExcecaoViva(agora), prazo],
        ...(filtro.origem ? { origem: filtro.origem } : {}),
        ...(filtro.cpf ? { cpf: soDigitos(filtro.cpf) } : {}),
      },
      orderBy: { criadoEm: "desc" },
      take: 1000,
    });
    const cpfs = [...new Set(excecoes.map((e) => e.cpf))];
    const [motoristas, funcionarios] = await Promise.all([
      this.prisma.motorista.findMany({
        where: { cpf: { in: cpfs }, ...filtroEscopo(escopo) },
        select: { id: true, cpf: true, nome: true },
      }),
      escopo
        ? Promise.resolve([] as { id: string; cpf: string; nome: string }[])
        : this.prisma.funcionario.findMany({
            where: { cpf: { in: cpfs } },
            select: { id: true, cpf: true, nome: true },
          }),
    ]);
    const pessoa = new Map<string, { nome: string; motoristaId?: string; funcionarioId?: string }>();
    for (const f of funcionarios) pessoa.set(f.cpf, { nome: f.nome, funcionarioId: f.id });
    for (const m of motoristas) pessoa.set(m.cpf, { ...pessoa.get(m.cpf), nome: m.nome, motoristaId: m.id });
    // Restrito só vê exceção de quem ele enxerga.
    return excecoes
      .filter((e) => pessoa.has(e.cpf))
      .map((e) => ({ ...e, pessoa: pessoa.get(e.cpf)! }));
  }

  // ─── perfis ──────────────────────────────────────────────────────────────

  async criarPerfil(dados: SalvarPerfilAppInput, autorId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    await this.exigirRegras();
    await this.recusarNomeRepetido(dados.nome, null);
    const p = await this.prisma.perfilAcessoApp.create({
      data: { nome: dados.nome, descricao: dados.descricao?.trim() || null, capacidades: dados.capacidades },
    });
    await this.log("PERFIL_CRIADO", autorId, { alvoId: p.id, causa: dados.nome });
    return { id: p.id };
  }

  async editarPerfil(id: string, dados: SalvarPerfilAppInput, autorId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    await this.exigirRegras();
    const atual = await this.prisma.perfilAcessoApp.findFirst({ where: { id } });
    if (!atual) throw new NotFoundException("Perfil não encontrado.");
    await this.recusarNomeRepetido(dados.nome, id);
    await this.prisma.perfilAcessoApp.update({
      where: { id },
      data: { nome: dados.nome, descricao: dados.descricao?.trim() || null, capacidades: dados.capacidades },
    });
    const antes = new Set(atual.capacidades);
    const depois = new Set<string>(dados.capacidades);
    await this.prisma.logAcessoApp.create({
      data: {
        tipo: "PERFIL_EDITADO",
        autorId,
        alvoId: id,
        ganhou: [...depois].filter((c) => !antes.has(c)),
        perdeu: [...antes].filter((c) => !depois.has(c)),
        causa: dados.nome,
      },
    });
    return this.acesso.recalcular(`PERFIL_EDITADO:${id}`);
  }

  /**
   * Desliga o perfil. Quem caía nele passa pra próxima regra (ou pro padrão).
   * O padrão da empresa não pode ser desligado: "todo o resto" ficaria sem
   * nada, e isso é tirar acesso de gente em massa por um clique.
   */
  async desligarPerfil(id: string, autorId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    const cfg = await this.exigirRegras();
    if (id === cfg.perfilPadraoMotoristaId || id === cfg.perfilPadraoFuncionarioId) {
      throw new ConflictException("Este é o perfil de quem nenhuma regra alcança. Escolha outro padrão antes de desligá-lo.");
    }
    const atual = await this.prisma.perfilAcessoApp.findFirst({ where: { id } });
    if (!atual) throw new NotFoundException("Perfil não encontrado.");
    await this.prisma.perfilAcessoApp.update({ where: { id }, data: { ativo: false } });
    await this.log("PERFIL_DESLIGADO", autorId, { alvoId: id, causa: atual.nome });
    return this.acesso.recalcular(`PERFIL_DESLIGADO:${id}`);
  }

  async religarPerfil(id: string, autorId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    await this.exigirRegras();
    const atual = await this.prisma.perfilAcessoApp.findFirst({ where: { id } });
    if (!atual) throw new NotFoundException("Perfil não encontrado.");
    await this.prisma.perfilAcessoApp.update({ where: { id }, data: { ativo: true } });
    await this.log("PERFIL_RELIGADO", autorId, { alvoId: id, causa: atual.nome });
    return this.acesso.recalcular(`PERFIL_RELIGADO:${id}`);
  }

  private async recusarNomeRepetido(nome: string, ignorarId: string | null) {
    const existe = await this.prisma.perfilAcessoApp.findFirst({
      where: { nome, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
      select: { id: true },
    });
    if (existe) throw new BadRequestException(`Já existe um perfil chamado "${nome}".`);
  }

  // ─── quem recebe ─────────────────────────────────────────────────────────

  async salvarRegras(dados: SalvarRegrasAppInput, autorId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    await this.exigirRegras();
    const ids = [...new Set(dados.regras.map((r) => r.perfilId))];
    const perfis = await this.prisma.perfilAcessoApp.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (perfis.length !== ids.length) throw new BadRequestException("Uma regra aponta pra um perfil que não existe.");

    await this.prisma.$transaction(async (tx) => {
      await tx.regraAcessoApp.deleteMany({});
      if (dados.regras.length) {
        await tx.regraAcessoApp.createMany({
          data: dados.regras.map((r, ordem) => ({
            ordem,
            nome: r.nome,
            ativo: r.ativo,
            vinculo: r.vinculo,
            regime: r.regime,
            modalidadeId: r.modalidadeId ?? null,
            transportadoraId: r.transportadoraId ?? null,
            perfilId: r.perfilId,
            criadoPorId: autorId,
            alteradoPorId: autorId,
          })),
        });
      }
      await tx.logAcessoApp.create({
        data: { tipo: "REGRAS_SALVAS", autorId, causa: dados.regras.map((r) => r.nome).join(" → ") },
      });
    });
    return this.acesso.recalcular("REGRAS_SALVAS");
  }

  async salvarPadrao(dados: PadraoAcessoAppInput, autorId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    await this.exigirRegras();
    for (const id of [dados.perfilPadraoMotoristaId, dados.perfilPadraoFuncionarioId]) {
      if (!id) continue;
      const p = await this.prisma.perfilAcessoApp.findFirst({ where: { id, ativo: true }, select: { id: true } });
      if (!p) throw new BadRequestException("O perfil padrão tem que existir e estar ligado.");
    }
    await this.prisma.configuracaoAcessoApp.update({ where: { contaId: contaIdAtual() }, data: dados });
    await this.log("PADRAO_ALTERADO", autorId);
    return this.acesso.recalcular("PADRAO_ALTERADO");
  }

  async passarParaRegras(autorId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    const cfg = await this.config();
    if (cfg.fonte === "REGRAS") return { pessoas: 0 };
    return this.acesso.passarParaRegras(autorId);
  }

  // ─── exceções ────────────────────────────────────────────────────────────

  async criarExcecao(dados: CriarExcecaoAppInput, autorId: string, escopo: EscopoAdmin) {
    await this.exigirRegras();
    let cpf: string;
    if (dados.motoristaId) {
      const m = await this.prisma.motorista.findFirst({
        where: { id: dados.motoristaId, ...filtroEscopo(escopo) },
        select: { cpf: true },
      });
      if (!m) throw new NotFoundException("Motorista não encontrado");
      cpf = soDigitos(m.cpf);
    } else {
      // Funcionário não tem frota: quem é restrito não mexe nele.
      this.exigirGlobal(escopo);
      const f = await this.prisma.funcionario.findFirst({ where: { id: dados.funcionarioId! }, select: { cpf: true } });
      if (!f) throw new NotFoundException("Funcionário não encontrado");
      cpf = soDigitos(f.cpf);
    }
    if (dados.expiraEm && dados.expiraEm.getTime() <= Date.now()) {
      throw new BadRequestException("A validade tem que ser no futuro.");
    }

    await this.prisma.$transaction((tx) => this.gravarExcecao(tx, cpf, dados, autorId));
    return this.acesso.recalcular(`EXCECAO:${cpf}`);
  }

  /**
   * Uma exceção viva por pessoa e capacidade: a nova substitui a anterior, e a
   * anterior fica no histórico com o porquê.
   */
  private async gravarExcecao(
    tx: Prisma.TransactionClient,
    cpf: string,
    dados: Pick<CriarExcecaoAppInput, "capacidade" | "efeito" | "motivo" | "expiraEm">,
    autorId: string,
  ) {
    await tx.excecaoAcessoApp.updateMany({
      where: { cpf, capacidade: dados.capacidade, revogadaEm: null },
      data: {
        revogadaEm: new Date(),
        revogadaPorId: autorId,
        chaveViva: null,
        motivoRevogacao: "Substituída por outra exceção.",
      },
    });
    await tx.excecaoAcessoApp.create({
      data: {
        cpf,
        capacidade: dados.capacidade,
        efeito: dados.efeito,
        motivo: dados.motivo,
        expiraEm: dados.expiraEm ?? null,
        origem: "MANUAL",
        criadoPorId: autorId,
        chaveViva: `${cpf}:${dados.capacidade}`,
      },
    });
    await tx.logAcessoApp.create({
      data: {
        tipo: `EXCECAO_${dados.efeito}`,
        autorId,
        cpf,
        motivo: dados.motivo,
        ...(dados.efeito === "CONCEDER" ? { ganhou: [dados.capacidade] } : { perdeu: [dados.capacidade] }),
      },
    });
  }

  /** Os motoristas selecionados que este usuário alcança — todos, ou 404. */
  private async motoristasDoLote(ids: string[], escopo: EscopoAdmin) {
    const unicos = [...new Set(ids)];
    const ms = await this.prisma.motorista.findMany({
      where: { id: { in: unicos }, ...filtroEscopo(escopo) },
      select: { id: true, cpf: true },
    });
    // Tudo ou nada: aplicar em parte da seleção sem dizer em quem seria pior
    // do que recusar.
    if (ms.length !== unicos.length) {
      throw new NotFoundException("Algum dos motoristas selecionados não foi encontrado.");
    }
    return ms;
  }

  async criarExcecaoEmLote(dados: ExcecaoLoteAppInput, autorId: string, escopo: EscopoAdmin) {
    await this.exigirRegras();
    if (dados.expiraEm && dados.expiraEm.getTime() <= Date.now()) {
      throw new BadRequestException("A validade tem que ser no futuro.");
    }
    const ms = await this.motoristasDoLote(dados.motoristaIds, escopo);
    const cpfs = [...new Set(ms.map((m) => soDigitos(m.cpf)))];
    await this.prisma.$transaction(
      async (tx) => {
        for (const cpf of cpfs) await this.gravarExcecao(tx, cpf, dados, autorId);
      },
      { timeout: 60_000 },
    );
    const r = await this.acesso.recalcular(`EXCECAO_LOTE:${cpfs.length}`);
    return { ...r, aplicadas: cpfs.length };
  }

  /**
   * Fixa um perfil (ou devolve às regras, com `perfilId` nulo). A coluna é a
   * mesma `perfilAcessoId` que o molde antigo usava; nas regras, ela passa a
   * querer dizer "fixado": vence qualquer regra e o padrão.
   */
  async fixarPerfil(dados: FixarPerfilAppInput, autorId: string, escopo: EscopoAdmin) {
    await this.exigirRegras();
    if (dados.perfilId) {
      const p = await this.prisma.perfilAcessoApp.findFirst({
        where: { id: dados.perfilId, ativo: true },
        select: { id: true },
      });
      if (!p) throw new BadRequestException("O perfil tem que existir e estar ligado.");
    }
    const ms = await this.motoristasDoLote(dados.motoristaIds, escopo);
    await this.prisma.$transaction(async (tx) => {
      await tx.motorista.updateMany({
        where: { id: { in: ms.map((m) => m.id) } },
        data: { perfilAcessoId: dados.perfilId },
      });
      await tx.logAcessoApp.createMany({
        data: ms.map((m) => ({
          tipo: dados.perfilId ? "PERFIL_FIXADO" : "PERFIL_SOLTO",
          autorId,
          cpf: soDigitos(m.cpf),
          alvoId: dados.perfilId,
          motivo: dados.motivo,
        })),
      });
    });
    const r = await this.acesso.recalcular(dados.perfilId ? "PERFIL_FIXADO" : "PERFIL_SOLTO");
    return { ...r, aplicadas: ms.length };
  }

  async revogarExcecao(id: string, dados: RevogarExcecaoAppInput, autorId: string, escopo: EscopoAdmin) {
    await this.exigirRegras();
    const e = await this.prisma.excecaoAcessoApp.findFirst({ where: { id, revogadaEm: null } });
    if (!e) throw new NotFoundException("Exceção não encontrada.");
    if (escopo) {
      const alcanca = await this.prisma.motorista.findFirst({
        where: { cpf: e.cpf, ...filtroEscopo(escopo) },
        select: { id: true },
      });
      if (!alcanca) throw new NotFoundException("Exceção não encontrada.");
    }
    await this.prisma.$transaction([
      this.prisma.excecaoAcessoApp.update({
        where: { id },
        data: { revogadaEm: new Date(), revogadaPorId: autorId, chaveViva: null, motivoRevogacao: dados.motivo },
      }),
      this.prisma.logAcessoApp.create({
        data: { tipo: "EXCECAO_REVOGADA", autorId, cpf: e.cpf, alvoId: id, motivo: dados.motivo },
      }),
    ]);
    return this.acesso.recalcular(`EXCECAO_REVOGADA:${e.cpf}`);
  }

  // ─── plataforma ──────────────────────────────────────────────────────────

  /**
   * As camadas que cortam e os rollouts — decisão da PLATAFORMA, empresa por
   * empresa. Tirar uma camada da sombra é o momento em que alguém pode perder
   * acesso; a tela mostra a lista nominal antes (pelo `simular`).
   */
  async salvarConfigPlataforma(dados: ConfigPlataformaAcessoAppInput, autorId: string) {
    const invalidas = dados.rolloutsApp.filter((c) => !ehCapacidadeApp(c));
    if (invalidas.length) throw new BadRequestException(`Capacidade desconhecida: ${invalidas.join(", ")}`);
    const contaId = contaIdAtual();
    const cfg = await this.config();
    await this.prisma.$transaction([
      this.prisma.configuracaoAcessoApp.update({
        where: { contaId },
        data: { camadasEmSombra: dados.camadasEmSombra.filter((c) => (CAMADAS_CORTE as readonly string[]).includes(c)) },
      }),
      this.prisma.conta.update({ where: { id: contaId }, data: { rolloutsApp: dados.rolloutsApp } }),
      this.prisma.logAcessoApp.create({
        data: {
          tipo: "PLATAFORMA_ALTEROU",
          autorId,
          causa: `sombra: [${cfg.camadasEmSombra.join(", ")}] → [${dados.camadasEmSombra.join(", ")}]; rollouts: [${dados.rolloutsApp.join(", ")}]`,
        },
      }),
    ]);
    return this.acesso.sincronizar("PLATAFORMA_ALTEROU");
  }
}
