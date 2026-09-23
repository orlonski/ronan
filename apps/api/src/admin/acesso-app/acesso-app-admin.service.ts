import { randomUUID } from "node:crypto";
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
  type SalvarTabelaAppInput,
  type CapacidadeApp,
  type TravasServidorAppInput,
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
      colunas: await this.colunasDaTabela(),
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
      capacidadesTravadas: cfg.capacidadesTravadas,
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

  // ─── a tabela ────────────────────────────────────────────────────────────

  /**
   * AS COLUNAS DA TABELA: uma por modalidade da empresa (tela Vínculos do
   * motorista), mais "sem modalidade" e "só bate ponto".
   *
   * O tipo de cada pessoa sai do cadastro: a modalidade do motorista; quem só
   * é funcionário, "só bate ponto". Nada disso é regra no código — as
   * modalidades são dado da empresa, e o que cada uma vê também.
   *
   * Por baixo, a modalidade com configuração própria é um perfil + uma regra
   * ("motorista da modalidade X → perfil X"). Modalidade sem configuração
   * ainda recebe o mesmo que "sem modalidade" (`herda: true`), que é o que
   * acontece hoje.
   */
  async colunasDaTabela() {
    const cfg = await this.config();
    const [modalidades, perfis, regras, porModalidade, funcionarios, cpfsMotoristas] = await Promise.all([
      this.prisma.modalidadeMotorista.findMany({
        where: { ativo: true },
        select: { id: true, nome: true },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      }),
      this.prisma.perfilAcessoApp.findMany({ select: { id: true, capacidades: true } }),
      this.prisma.regraAcessoApp.findMany({ where: { ativo: true }, orderBy: { ordem: "asc" } }),
      this.prisma.motorista.groupBy({
        by: ["modalidadeId"],
        where: { ativo: true, aceite: { not: "PENDENTE" } },
        _count: { _all: true },
      }),
      this.prisma.funcionario.findMany({ where: { ativo: true }, select: { cpf: true } }),
      this.prisma.motorista.findMany({ where: { ativo: true }, select: { cpf: true } }),
    ]);
    const capsDe = (id: string | null) => perfis.find((p) => p.id === id)?.capacidades ?? [];
    const pessoas = (mod: string | null) => porModalidade.find((g) => g.modalidadeId === mod)?._count._all ?? 0;
    const temMotorista = new Set(cpfsMotoristas.map((m) => soDigitos(m.cpf)));
    const regraDa = (modalidadeId: string) =>
      regras.find(
        (r) => r.vinculo === "MOTORISTA" && r.regime === "QUALQUER" && r.modalidadeId === modalidadeId && !r.transportadoraId,
      );
    return [
      {
        chave: "SEM_MODALIDADE",
        nome: "Sem modalidade",
        quem: "Motorista que ainda não tem modalidade.",
        capacidades: capsDe(cfg.perfilPadraoMotoristaId),
        herda: false,
        pessoas: pessoas(null),
      },
      ...modalidades.map((m) => {
        const regra = regraDa(m.id);
        return {
          chave: m.id,
          nome: m.nome,
          quem: `Motorista com a modalidade ${m.nome}.`,
          capacidades: regra ? capsDe(regra.perfilId) : capsDe(cfg.perfilPadraoMotoristaId),
          herda: !regra,
          pessoas: pessoas(m.id),
        };
      }),
      {
        chave: "SO_PONTO",
        nome: "Só bate ponto",
        quem: "CLT sem cadastro de motorista (mecânico, escritório).",
        capacidades: capsDe(cfg.perfilPadraoFuncionarioId),
        herda: false,
        pessoas: funcionarios.filter((f) => !temMotorista.has(soDigitos(f.cpf))).length,
      },
    ];
  }

  /**
   * O que muda se estas colunas forem salvas — o mesmo cálculo de verdade,
   * com a tabela em rascunho. Modalidade que ainda não tem configuração ganha
   * um perfil e uma regra de rascunho.
   */
  async simularTabela(dados: SalvarTabelaAppInput) {
    const cfg = await this.exigirRegras();
    const regras = await this.prisma.regraAcessoApp.findMany({ orderBy: { ordem: "asc" } });
    const perfis: { id: string; capacidades: CapacidadeApp[]; ativo: boolean }[] = [];
    // O rascunho de regras vai como a tela as mandaria (id opcional, sem ordem).
    const novasRegras: Record<string, unknown>[] = regras.map(
      ({ ordem: _o, criadoEm: _c, alteradoEm: _a, criadoPorId: _p, alteradoPorId: _q, contaId: _t, ...r }) => r,
    );
    for (const c of dados.colunas) {
      const alvo = await this.alvoDaColuna(c.chave, cfg, regras);
      if (alvo.perfilId) {
        perfis.push({ id: alvo.perfilId, capacidades: c.capacidades, ativo: true });
      } else if (alvo.modalidadeId) {
        const id = randomUUID();
        perfis.push({ id, capacidades: c.capacidades, ativo: true });
        novasRegras.push(this.regraDaModalidade(alvo.modalidadeId, alvo.nome, id));
      }
    }
    return this.acesso.simular({ perfis, regras: novasRegras as never });
  }

  async salvarTabela(dados: SalvarTabelaAppInput, autorId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    const cfg = await this.exigirRegras();
    const regras = await this.prisma.regraAcessoApp.findMany({ orderBy: { ordem: "asc" } });
    await this.prisma.$transaction(async (tx) => {
      let proximaOrdem = regras.length ? Math.max(...regras.map((r) => r.ordem)) + 1 : 0;
      for (const c of dados.colunas) {
        const alvo = await this.alvoDaColuna(c.chave, cfg, regras);
        const depois = new Set<string>(c.capacidades);
        if (alvo.perfilId) {
          const atual = await tx.perfilAcessoApp.findFirstOrThrow({ where: { id: alvo.perfilId } });
          const antes = new Set(atual.capacidades);
          const ganhou = [...depois].filter((x) => !antes.has(x));
          const perdeu = [...antes].filter((x) => !depois.has(x));
          if (!ganhou.length && !perdeu.length) continue;
          await tx.perfilAcessoApp.update({ where: { id: alvo.perfilId }, data: { capacidades: [...depois], ativo: true } });
          await tx.logAcessoApp.create({
            data: { tipo: "TABELA_SALVA", autorId, alvoId: alvo.perfilId, ganhou, perdeu, causa: alvo.nome },
          });
        } else if (alvo.modalidadeId) {
          // A modalidade ganha a configuração própria: um perfil com o nome
          // dela (ou com "(app)" se o nome já é de outro perfil) e a regra.
          const livre = !(await tx.perfilAcessoApp.findFirst({ where: { nome: alvo.nome }, select: { id: true } }));
          const perfil = await tx.perfilAcessoApp.create({
            data: {
              nome: livre ? alvo.nome : `${alvo.nome} (app)`,
              descricao: `Motorista com a modalidade ${alvo.nome}.`,
              capacidades: [...depois],
            },
          });
          await tx.regraAcessoApp.create({
            data: {
              ...this.regraDaModalidade(alvo.modalidadeId, alvo.nome, perfil.id),
              ordem: proximaOrdem++,
              criadoPorId: autorId,
              alteradoPorId: autorId,
            },
          });
          await tx.logAcessoApp.create({
            data: { tipo: "TABELA_SALVA", autorId, alvoId: perfil.id, ganhou: [...depois], causa: alvo.nome },
          });
        }
      }
    });
    return this.acesso.recalcular("TABELA_SALVA");
  }

  private regraDaModalidade(modalidadeId: string, nome: string, perfilId: string) {
    return {
      nome: `Modalidade ${nome}`.slice(0, 80),
      ativo: true,
      vinculo: "MOTORISTA" as const,
      regime: "QUALQUER" as const,
      modalidadeId,
      transportadoraId: null,
      perfilId,
    };
  }

  /** Qual perfil (ou modalidade ainda sem perfil) uma coluna da tabela edita. */
  private async alvoDaColuna(
    chave: string,
    cfg: { perfilPadraoMotoristaId: string | null; perfilPadraoFuncionarioId: string | null },
    regras: { vinculo: string; regime: string; modalidadeId: string | null; transportadoraId: string | null; perfilId: string; ativo: boolean }[],
  ): Promise<{ perfilId: string | null; modalidadeId: string | null; nome: string }> {
    if (chave === "SEM_MODALIDADE") {
      if (!cfg.perfilPadraoMotoristaId) throw new ConflictException("A tabela desta empresa ainda está sendo montada.");
      return { perfilId: cfg.perfilPadraoMotoristaId, modalidadeId: null, nome: "Sem modalidade" };
    }
    if (chave === "SO_PONTO") {
      if (!cfg.perfilPadraoFuncionarioId) throw new ConflictException("A tabela desta empresa ainda está sendo montada.");
      return { perfilId: cfg.perfilPadraoFuncionarioId, modalidadeId: null, nome: "Só bate ponto" };
    }
    const mod = await this.prisma.modalidadeMotorista.findFirst({ where: { id: chave }, select: { id: true, nome: true } });
    if (!mod) throw new BadRequestException("Modalidade não encontrada.");
    const regra = regras.find(
      (r) => r.ativo && r.vinculo === "MOTORISTA" && r.regime === "QUALQUER" && r.modalidadeId === mod.id && !r.transportadoraId,
    );
    return { perfilId: regra?.perfilId ?? null, modalidadeId: mod.id, nome: mod.nome };
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
   * QUEM O SERVIDOR TERIA BARRADO nos últimos 14 dias, por capacidade: o que o
   * `CapacidadeAppGuard` gravou em sombra. É a lista nominal que a plataforma
   * olha antes de travar uma capacidade nesta empresa.
   */
  async sombraDoServidor() {
    const desde = new Date(Date.now() - 14 * 86_400_000);
    const logs = await this.prisma.logAcessoApp.findMany({
      where: { tipo: "CAPACIDADE_SOMBRA", criadoEm: { gte: desde } },
      select: { cpf: true, perdeu: true, causa: true, criadoEm: true },
      orderBy: { criadoEm: "desc" },
      take: 5000,
    });
    const cpfs = [...new Set(logs.map((l) => l.cpf).filter((c): c is string => !!c))];
    const [motoristas, funcionarios] = await Promise.all([
      this.prisma.motorista.findMany({ where: { cpf: { in: cpfs } }, select: { cpf: true, nome: true } }),
      this.prisma.funcionario.findMany({ where: { cpf: { in: cpfs } }, select: { cpf: true, nome: true } }),
    ]);
    const nome = new Map<string, string>();
    for (const f of funcionarios) nome.set(soDigitos(f.cpf), f.nome);
    for (const m of motoristas) nome.set(soDigitos(m.cpf), m.nome);

    type Pessoa = { cpf: string; nome: string; vezes: number; ultima: Date; rotas: Set<string> };
    const porCap = new Map<string, Map<string, Pessoa>>();
    for (const l of logs) {
      if (!l.cpf) continue;
      for (const cap of l.perdeu) {
        const pessoas = porCap.get(cap) ?? new Map<string, Pessoa>();
        const p = pessoas.get(l.cpf) ?? {
          cpf: l.cpf,
          nome: nome.get(l.cpf) ?? l.cpf,
          vezes: 0,
          ultima: l.criadoEm,
          rotas: new Set<string>(),
        };
        p.vezes++;
        if (l.causa) p.rotas.add(l.causa);
        pessoas.set(l.cpf, p);
        porCap.set(cap, pessoas);
      }
    }
    return [...porCap.entries()].map(([capacidade, pessoas]) => ({
      capacidade,
      pessoas: [...pessoas.values()]
        .map((p) => ({ ...p, rotas: [...p.rotas] }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    }));
  }

  /**
   * Trava (ou destrava) capacidades no servidor desta empresa. Travar é o
   * momento em que alguém pode passar a ouvir "isso não está no seu app": a
   * tela mostra antes a lista da sombra, e fica o rastro de quem travou.
   */
  async salvarTravasServidor(dados: TravasServidorAppInput, autorId: string) {
    const contaId = contaIdAtual();
    const cfg = await this.config();
    const antes = new Set(cfg.capacidadesTravadas);
    const depois = new Set<string>(dados.capacidadesTravadas);
    await this.prisma.$transaction([
      this.prisma.configuracaoAcessoApp.update({
        where: { contaId },
        data: { capacidadesTravadas: [...depois] },
      }),
      this.prisma.logAcessoApp.create({
        data: {
          tipo: "SERVIDOR_TRAVAS",
          autorId,
          // "perdeu" aqui é o que passou a ser barrado; "ganhou", o que foi solto.
          perdeu: [...depois].filter((c) => !antes.has(c)),
          ganhou: [...antes].filter((c) => !depois.has(c)),
          causa: "A plataforma mudou o que o servidor barra no app desta empresa.",
        },
      }),
    ]);
    return { capacidadesTravadas: [...depois] };
  }

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
