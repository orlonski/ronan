import { createHash } from "node:crypto";
import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import {
  ACESSOS_APP_CHAVES,
  CAMADAS_CORTE,
  CAPACIDADE_POR_CHAVE,
  CAPACIDADES_APP,
  type AcessoAppChave,
  type CamadaCorte,
  type CapacidadeApp,
  type MudancaAcessoApp,
  type PreviaCadastroAppInput,
  type SimularAcessoAppInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { contaIdAtual } from "../conta/conta-context";
import { paraCadaConta } from "../conta/para-cada-conta";
import { modulosDaConta } from "../conta/teto-da-conta";
import { comLockDeCron } from "../cron-exclusivo";
import { soDigitos } from "../regime-vigente";
import {
  MOTIVO_ESPELHO,
  PERFIL_HERDADO_FUNCIONARIO,
  PERFIL_HERDADO_MOTORISTA,
  capacidadesDoRegistradoHerdado,
  planejarEspelho,
  type ColunasAcesso,
} from "./espelho-colunas";
import {
  resolverAcessoApp,
  type ContaAcessoCtx,
  type ExcecaoAcessoCtx,
  type PessoaAcesso,
  type ResultadoAcesso,
} from "./resolver";

type Tx = Prisma.TransactionClient;

/**
 * O padrão de quem nasce sem perfil nenhum, tirado dos `@default` das colunas
 * `pode*` do `Motorista`. Só vale como SEMENTE pra empresa que ainda não tem
 * motorista nenhum — o spec confere que bate com o schema.
 */
export const PADRAO_DO_BANCO: ColunasAcesso = {
  podeLancarViagem: true,
  podeIniciarViagem: false,
  podeViagemLifecycle: false,
  podeLancarPedagio: false,
  podeLancarAbastecimento: true,
  podeUsarOcrTicket: false,
  podeVerStories: true,
  podeVerTodosLocais: false,
  podeReferenciaKm: false,
  podeTelemetria: false,
  podeChat: true,
  podeDiaria: true,
  podeVerValorDiaria: false,
};

const SOMBRA_INICIAL: CamadaCorte[] = ["DEPENDENCIA", "REGIME", "PLATAFORMA", "CONTRATO"];

const SELECT_COLUNAS = Object.fromEntries(ACESSOS_APP_CHAVES.map((c) => [c, true])) as Record<
  AcessoAppChave,
  true
>;

function colunasDe(o: Record<string, unknown>): ColunasAcesso {
  return Object.fromEntries(ACESSOS_APP_CHAVES.map((c) => [c, o[c] === true])) as ColunasAcesso;
}

/**
 * Exceção VIVA no banco: não revogada e dentro do prazo. A que venceu não é
 * revogada por ninguém (o resolvedor só para de contá-la), então filtrar só
 * por `revogadaEm` contaria gente que já voltou ao perfil.
 */
export function ondeExcecaoViva(agora = new Date()) {
  return { revogadaEm: null, OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] };
}

/** A divergência que o portão achou: o cálculo não reproduziu a ficha. */
export type DivergenciaEspelho = {
  motoristaId: string;
  faltou: string[];
  sobrou: string[];
};

class PortaoDoEspelho extends Error {
  constructor(readonly divergencias: DivergenciaEspelho[]) {
    super(`Espelho não reproduziu a ficha de ${divergencias.length} pessoa(s).`);
  }
}

/**
 * O ACESSO DO APP, CALCULADO E GRAVADO — escritor único do `AcessoEfetivoApp`.
 *
 * Duas pontas:
 *   - `recalcular`: roda o resolvedor pra todo mundo da empresa e grava o
 *     efetivo, com o log de quem ganhou e perdeu o quê.
 *   - `espelharDasColunas`: enquanto a empresa estiver em `fonte: COLUNAS`, a
 *     ficha manda. Isto deriva dela o perfil padrão e as exceções, CONFERE que
 *     o cálculo reproduz a ficha de cada um, e só então grava. Divergência =
 *     nada escrito, e o motivo fica na configuração pra alguém olhar.
 *
 * ⚠️ Nesta fase ninguém LÊ o efetivo pra decidir nada: app, guards e WHERE do
 * chat seguem nas colunas `pode*`. É a espinha que roda invisível até provar
 * que reproduz o presente.
 */
@Injectable()
export class AcessoAppService {
  private readonly log = new Logger(AcessoAppService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron("0 17 * * * *", { name: "acesso-app-espelho", timeZone: "America/Sao_Paulo" })
  async cronEspelho(): Promise<void> {
    await comLockDeCron(this.prisma, "acesso-app-espelho", async () => {
      await paraCadaConta(this.prisma, async () => {
        const r = await this.sincronizar("CRON");
        if (r.divergencias > 0) {
          this.log.warn(
            `Espelho do acesso não reproduziu a ficha de ${r.divergencias} pessoa(s) na conta ${contaIdAtual()} — nada foi escrito.`,
          );
        }
      });
    });
  }

  /** Espelha (fonte COLUNAS) ou recalcula (fonte REGRAS), conforme a empresa. */
  async sincronizar(causa: string): Promise<{ pessoas: number; mudaram: number; divergencias: number }> {
    const config = await this.garantirConfig();
    if (config.fonte === "COLUNAS") return this.espelharDasColunas(causa);
    const r = await this.recalcular(causa);
    return { ...r, divergencias: 0 };
  }

  /**
   * Na primeira vez que alguém abre a tela, a empresa pode ainda não ter
   * passado pelo cron: espelha agora pra tela não nascer vazia.
   */
  async sincronizarSeNuncaRodou(): Promise<void> {
    const cfg = await this.garantirConfig();
    if (cfg.fonte === "COLUNAS" && !cfg.espelhadoEm) await this.espelharDasColunas("PRIMEIRA_VISITA");
  }

  private async garantirConfig() {
    const contaId = contaIdAtual();
    return this.prisma.configuracaoAcessoApp.upsert({
      where: { contaId },
      create: { contaId, camadasEmSombra: SOMBRA_INICIAL },
      update: {},
    });
  }

  // ─── contexto ────────────────────────────────────────────────────────────

  private async carregarContexto(tx: Tx | PrismaService, agora: Date) {
    const contaId = contaIdAtual();
    const [config, conta, perfis, regras, modulos, motoristas, funcionarios, regimes, excecoes] =
      await Promise.all([
        tx.configuracaoAcessoApp.findUniqueOrThrow({ where: { contaId } }),
        tx.conta.findUniqueOrThrow({ where: { id: contaId }, select: { rolloutsApp: true } }),
        tx.perfilAcessoApp.findMany({
          select: { id: true, nome: true, ativo: true, capacidades: true },
        }),
        tx.regraAcessoApp.findMany({ orderBy: { ordem: "asc" } }),
        modulosDaConta(tx as PrismaService, contaId, agora),
        tx.motorista.findMany({
          select: {
            id: true,
            cpf: true,
            nome: true,
            ativo: true,
            status: true,
            modalidadeId: true,
            transportadoraId: true,
            perfilAcessoId: true,
            ...SELECT_COLUNAS,
          },
        }),
        tx.funcionario.findMany({
          select: { id: true, cpf: true, nome: true, ativo: true, perfilAcessoId: true },
        }),
        tx.regimeVigente.findMany({
          where: { chaveViva: { not: null } },
          select: { cpf: true, regime: true },
        }),
        tx.excecaoAcessoApp.findMany({
          where: { revogadaEm: null },
          select: {
            id: true,
            cpf: true,
            capacidade: true,
            efeito: true,
            motivo: true,
            expiraEm: true,
            revogadaEm: true,
          },
        }),
      ]);

    const sombra = new Set(
      config.camadasEmSombra.filter((c): c is CamadaCorte =>
        (CAMADAS_CORTE as readonly string[]).includes(c),
      ),
    );
    const ctx: ContaAcessoCtx = {
      modulos,
      rolloutsApp: new Set(conta.rolloutsApp),
      perfis: new Map(perfis.map((p) => [p.id, p])),
      regras,
      perfilPadraoMotoristaId: config.perfilPadraoMotoristaId,
      perfilPadraoFuncionarioId: config.perfilPadraoFuncionarioId,
      camadasEmSombra: sombra,
    };

    const regimePorCpf = new Map(regimes.map((r) => [soDigitos(r.cpf), r.regime]));
    const pessoas = new Map<string, PessoaAcesso>();
    const pessoa = (cpfBruto: string) => {
      const cpf = soDigitos(cpfBruto);
      let p = pessoas.get(cpf);
      if (!p) {
        p = { cpf, regime: regimePorCpf.get(cpf) ?? null, motorista: null, funcionario: null };
        pessoas.set(cpf, p);
      }
      return p;
    };
    for (const m of motoristas) {
      pessoa(m.cpf).motorista = {
        id: m.id,
        ativo: m.ativo,
        aprovado: m.status === "APROVADO",
        modalidadeId: m.modalidadeId,
        transportadoraId: m.transportadoraId,
        perfilFixadoId: m.perfilAcessoId,
      };
    }
    for (const f of funcionarios) {
      pessoa(f.cpf).funcionario = { id: f.id, ativo: f.ativo, perfilFixadoId: f.perfilAcessoId };
    }

    const excecoesPorCpf = new Map<string, ExcecaoAcessoCtx[]>();
    for (const e of excecoes) {
      const cpf = soDigitos(e.cpf);
      const lista = excecoesPorCpf.get(cpf) ?? [];
      lista.push(e);
      excecoesPorCpf.set(cpf, lista);
    }

    const nomes = new Map<string, string>();
    for (const f of funcionarios) nomes.set(soDigitos(f.cpf), f.nome);
    for (const m of motoristas) nomes.set(soDigitos(m.cpf), m.nome);

    return { config, ctx, pessoas, excecoesPorCpf, motoristas, nomes };
  }

  /**
   * Aplica um rascunho da tela sobre o contexto carregado — é o que permite
   * mostrar "37 pessoas mudam" ANTES de salvar, com o mesmo resolvedor.
   */
  private aplicarRascunho(ctx: ContaAcessoCtx, r: SimularAcessoAppInput): ContaAcessoCtx {
    const perfis = new Map(ctx.perfis);
    let padraoM = ctx.perfilPadraoMotoristaId;
    let padraoF = ctx.perfilPadraoFuncionarioId;
    if (r.perfil) {
      const id = r.perfil.id ?? "__rascunho__";
      const atual = perfis.get(id);
      perfis.set(id, {
        id,
        nome: atual?.nome ?? "Rascunho",
        ativo: r.perfil.ativo,
        capacidades: r.perfil.capacidades,
      });
    }
    if (r.padrao) {
      padraoM = r.padrao.perfilPadraoMotoristaId;
      padraoF = r.padrao.perfilPadraoFuncionarioId;
    }
    return {
      ...ctx,
      perfis,
      regras: r.regras
        ? r.regras.map((x, i) => ({
            id: x.id ?? `__nova_${i}`,
            ordem: i,
            nome: x.nome,
            ativo: x.ativo,
            vinculo: x.vinculo,
            regime: x.regime,
            modalidadeId: x.modalidadeId ?? null,
            transportadoraId: x.transportadoraId ?? null,
            perfilId: x.perfilId,
          }))
        : ctx.regras,
      perfilPadraoMotoristaId: padraoM,
      perfilPadraoFuncionarioId: padraoF,
      camadasEmSombra: r.camadasEmSombra ? new Set(r.camadasEmSombra) : ctx.camadasEmSombra,
      rolloutsApp: r.rolloutsApp ? new Set(r.rolloutsApp) : ctx.rolloutsApp,
    };
  }

  /**
   * As colunas `pode*` que o resolvedor escreve quando a empresa está nas
   * regras. Calculadas com APROVACAO em sombra: a aprovação já é cobrada à
   * parte (login e guard), e zerar as colunas de quem está em análise faria o
   * motorista aprovado agora ficar sem nada até o próximo recálculo.
   */
  private colunasDoResolvedor(
    pessoas: Map<string, PessoaAcesso>,
    ctx: ContaAcessoCtx,
    excecoesPorCpf: Map<string, ExcecaoAcessoCtx[]>,
    agora: Date,
  ): Map<string, ColunasAcesso> {
    const ctxColunas = { ...ctx, camadasEmSombra: new Set([...ctx.camadasEmSombra, "APROVACAO" as const]) };
    const out = new Map<string, ColunasAcesso>();
    for (const [cpf, p] of pessoas) {
      if (!p.motorista) continue;
      const efetivo = new Set<string>(
        resolverAcessoApp(p, ctxColunas, excecoesPorCpf.get(cpf) ?? [], agora).efetivo,
      );
      const colunas: ColunasAcesso = {};
      for (const def of CAPACIDADES_APP) {
        if (def.colunaLegada?.espelha) colunas[def.colunaLegada.coluna] = efetivo.has(def.chave);
      }
      out.set(cpf, colunas);
    }
    return out;
  }

  private calcular(
    pessoas: Map<string, PessoaAcesso>,
    ctx: ContaAcessoCtx,
    excecoesPorCpf: Map<string, ExcecaoAcessoCtx[]>,
    agora: Date,
  ): Map<string, ResultadoAcesso> {
    const out = new Map<string, ResultadoAcesso>();
    for (const [cpf, p] of pessoas) {
      out.set(cpf, resolverAcessoApp(p, ctx, excecoesPorCpf.get(cpf) ?? [], agora));
    }
    return out;
  }

  // ─── gravação ────────────────────────────────────────────────────────────

  private async gravar(
    tx: Tx,
    pessoas: Map<string, PessoaAcesso>,
    resultados: Map<string, ResultadoAcesso>,
    causa: string,
    agora: Date,
    colunas?: { alvo: Map<string, ColunasAcesso>; atuais: { id: string; cpf: string }[] & Record<string, unknown>[] },
  ): Promise<number> {
    const contaId = contaIdAtual();
    if (colunas) await this.escreverColunas(tx, colunas.alvo, colunas.atuais);
    const atuais = await tx.acessoEfetivoApp.findMany({
      select: { cpf: true, hash: true, capacidades: true },
    });
    const porCpf = new Map(atuais.map((a) => [a.cpf, a]));

    let mudaram = 0;
    for (const [cpf, r] of resultados) {
      const p = pessoas.get(cpf)!;
      const hash = createHash("sha1")
        .update(
          JSON.stringify({
            e: r.efetivo,
            s: r.sombra,
            x: r.explicacao,
            m: p.motorista?.id ?? null,
            f: p.funcionario?.id ?? null,
          }),
        )
        .digest("hex");
      const atual = porCpf.get(cpf);
      if (atual?.hash === hash) continue;

      const dados = {
        motoristaId: p.motorista?.id ?? null,
        funcionarioId: p.funcionario?.id ?? null,
        capacidades: r.efetivo,
        capacidadesSombra: r.sombra,
        explicacao: { base: r.base, capacidades: r.explicacao } as unknown as Prisma.InputJsonValue,
        hash,
        proximaMudanca: r.proximaMudanca,
        calculadoEm: agora,
      };
      await tx.acessoEfetivoApp.upsert({
        where: { contaId_cpf: { contaId, cpf } },
        create: { cpf, ...dados },
        update: dados,
      });

      const antes = new Set(atual?.capacidades ?? []);
      const depois = new Set<string>(r.efetivo);
      const ganhou = [...depois].filter((c) => !antes.has(c));
      const perdeu = [...antes].filter((c) => !depois.has(c));
      if (atual && (ganhou.length || perdeu.length)) {
        mudaram++;
        await tx.logAcessoApp.create({
          data: { tipo: "EFETIVO_MUDOU", cpf, ganhou, perdeu, causa },
        });
      } else if (!atual) {
        mudaram++;
        // Pessoa nova numa empresa que já tinha acessos calculados (cadastro,
        // contratação): o que ela ganhou ao entrar também é rastro. Só a
        // PRIMEIRA carga da empresa inteira fica de fora — seria uma linha
        // por pessoa dizendo "ganhou tudo o que já tinha".
        if (atuais.length > 0) {
          await tx.logAcessoApp.create({
            data: { tipo: "EFETIVO_NASCEU", cpf, ganhou, perdeu: [], causa },
          });
        }
      }
    }

    // Quem saiu da empresa (cadastro apagado) não fica com linha órfã.
    const vivos = [...resultados.keys()];
    await tx.acessoEfetivoApp.deleteMany({ where: { cpf: { notIn: vivos } } });

    if (mudaram > 0) {
      await tx.configuracaoAcessoApp.update({
        where: { contaId },
        data: { versao: { increment: 1 } },
      });
    }
    return mudaram;
  }

  /**
   * O ESPELHO AO CONTRÁRIO: com a empresa nas regras, as colunas `pode*` viram
   * reflexo do resolvedor — é o que mantém app, guards e o WHERE do chat
   * funcionando sem mudar uma linha enquanto eles ainda leem as colunas.
   * Só escreve quem mudou.
   */
  private async escreverColunas(
    tx: Tx,
    alvo: Map<string, ColunasAcesso>,
    atuais: Record<string, unknown>[],
  ): Promise<void> {
    for (const m of atuais) {
      const quer = alvo.get(soDigitos(String(m.cpf)));
      if (!quer) continue;
      const diff: ColunasAcesso = {};
      for (const [c, v] of Object.entries(quer) as [AcessoAppChave, boolean][]) {
        if (m[c] !== v) diff[c] = v;
      }
      if (Object.keys(diff).length) {
        await tx.motorista.update({ where: { id: String(m.id) }, data: diff });
      }
    }
  }

  /** Recalcula e grava o efetivo de todo mundo da empresa. */
  async recalcular(causa: string): Promise<{ pessoas: number; mudaram: number }> {
    await this.garantirConfig();
    const agora = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        const { config, ctx, pessoas, excecoesPorCpf, motoristas } = await this.carregarContexto(
          tx,
          agora,
        );
        const resultados = this.calcular(pessoas, ctx, excecoesPorCpf, agora);
        // Só nas regras o resolvedor manda nas colunas. No espelho, a ficha manda.
        const colunas =
          config.fonte === "REGRAS"
            ? {
                alvo: this.colunasDoResolvedor(pessoas, ctx, excecoesPorCpf, agora),
                atuais: motoristas as unknown as { id: string; cpf: string }[] & Record<string, unknown>[],
              }
            : undefined;
        const mudaram = await this.gravar(tx, pessoas, resultados, causa, agora, colunas);
        return { pessoas: pessoas.size, mudaram };
      },
      { timeout: 60_000 },
    );
  }

  /**
   * Recalcula já, sem prender quem chamou — pra depois de cadastrar, aprovar,
   * contratar. No espelho não há o que fazer (a ficha manda). Falha aqui é
   * logada e o cron de 2 minutos cobre.
   */
  agendarRecalculo(causa: string): void {
    void (async () => {
      const cfg = await this.prisma.configuracaoAcessoApp.findUnique({
        where: { contaId: contaIdAtual() },
        select: { fonte: true },
      });
      if (cfg?.fonte !== "REGRAS") return;
      await this.recalcular(causa);
    })().catch((e) =>
      this.log.error(`Recalcular acesso (${causa}) falhou: ${e instanceof Error ? e.message : e}`),
    );
  }

  @Cron("0 */2 * * * *", { name: "acesso-app-regras", timeZone: "America/Sao_Paulo" })
  async cronRegras(): Promise<void> {
    await comLockDeCron(this.prisma, "acesso-app-regras", async () => {
      await paraCadaConta(this.prisma, async () => {
        const cfg = await this.prisma.configuracaoAcessoApp.findUnique({
          where: { contaId: contaIdAtual() },
          select: { fonte: true },
        });
        if (cfg?.fonte === "REGRAS") await this.recalcular("CRON");
      });
    });
  }

  // ─── leitura pro painel ──────────────────────────────────────────────────

  /**
   * O que muda pra quem, se o rascunho for salvo. Compara o cálculo de hoje
   * com o cálculo com o rascunho — os dois pelo mesmo resolvedor.
   */
  async simular(rascunho: SimularAcessoAppInput): Promise<{ total: number; mudam: MudancaAcessoApp[] }> {
    await this.garantirConfig();
    const agora = new Date();
    const { ctx, pessoas, excecoesPorCpf, nomes } = await this.carregarContexto(this.prisma, agora);
    const antes = this.calcular(pessoas, ctx, excecoesPorCpf, agora);
    const depois = this.calcular(pessoas, this.aplicarRascunho(ctx, rascunho), excecoesPorCpf, agora);
    const mudam: MudancaAcessoApp[] = [];
    for (const [cpf, a] of antes) {
      const d = depois.get(cpf)!;
      const sa = new Set(a.efetivo);
      const sd = new Set(d.efetivo);
      const ganhou = d.efetivo.filter((c) => !sa.has(c));
      const perdeu = a.efetivo.filter((c) => !sd.has(c));
      if (!ganhou.length && !perdeu.length) continue;
      const p = pessoas.get(cpf)!;
      mudam.push({
        cpf,
        nome: nomes.get(cpf) ?? cpf,
        motoristaId: p.motorista?.id ?? null,
        funcionarioId: p.funcionario?.id ?? null,
        ganhou,
        perdeu,
      });
    }
    mudam.sort((x, y) => y.perdeu.length - x.perdeu.length || x.nome.localeCompare(y.nome));
    return { total: mudam.length, mudam: mudam.slice(0, 500) };
  }

  /**
   * Com que perfil um motorista AINDA NÃO SALVO entraria — o "vai entrar como"
   * do cadastro. Mesmo resolvedor, com um cadastro hipotético já aprovado
   * (é assim que o painel cria). Se o CPF já é alguém da empresa (o CLT que
   * passa a dirigir), o regime e o cadastro de funcionário dele entram na conta.
   */
  async previaCadastro(dados: PreviaCadastroAppInput) {
    await this.garantirConfig();
    const agora = new Date();
    const { config, ctx, pessoas, excecoesPorCpf } = await this.carregarContexto(this.prisma, agora);
    const cpf = soDigitos(dados.cpf ?? "");
    const existente = cpf.length === 11 ? pessoas.get(cpf) : undefined;
    const pessoa: PessoaAcesso = {
      cpf: cpf || "__novo__",
      regime: existente?.regime ?? null,
      funcionario: existente?.funcionario ?? null,
      motorista: {
        id: "__novo__",
        ativo: true,
        aprovado: true,
        modalidadeId: dados.modalidadeId ?? null,
        transportadoraId: dados.transportadoraId ?? null,
        perfilFixadoId: null,
      },
    };
    const r = resolverAcessoApp(pessoa, ctx, existente ? (excecoesPorCpf.get(cpf) ?? []) : [], agora);
    return {
      fonte: config.fonte,
      base: r.base.motorista,
      efetivo: r.efetivo,
      jaExiste: !!existente?.motorista,
    };
  }

  /** O acesso de UMA pessoa, calculado agora, com o porquê de cada item. */
  async explicar(cpfBruto: string) {
    await this.garantirConfig();
    const agora = new Date();
    const cpf = soDigitos(cpfBruto);
    const { config, ctx, pessoas, excecoesPorCpf, nomes } = await this.carregarContexto(
      this.prisma,
      agora,
    );
    const pessoa = pessoas.get(cpf);
    if (!pessoa) return null;
    const resultado = resolverAcessoApp(pessoa, ctx, excecoesPorCpf.get(cpf) ?? [], agora);
    const excecoes = await this.prisma.excecaoAcessoApp.findMany({
      where: { cpf, revogadaEm: null },
      orderBy: { criadoEm: "desc" },
    });
    return {
      cpf,
      nome: nomes.get(cpf) ?? cpf,
      fonte: config.fonte,
      regime: pessoa.regime,
      vinculos: {
        motorista: pessoa.motorista ? { id: pessoa.motorista.id, aprovado: pessoa.motorista.aprovado, ativo: pessoa.motorista.ativo } : null,
        funcionario: pessoa.funcionario ? { id: pessoa.funcionario.id, ativo: pessoa.funcionario.ativo } : null,
      },
      ...resultado,
      excecoes,
    };
  }

  /**
   * Passa a empresa do espelho da ficha pras regras.
   *
   * ⚠️ Não muda nada pra ninguém, e é conferido: espelha a ficha uma última
   * vez (com o portão), vira a chave e recalcula — as colunas que o resolvedor
   * escreve são as mesmas que já estavam lá. Se o portão reprovar, não vira.
   */
  async passarParaRegras(autorId: string): Promise<{ pessoas: number }> {
    const r = await this.espelharDasColunas("PASSAR_PARA_REGRAS");
    if (r.divergencias > 0) {
      throw new ConflictException(
        `O cálculo não reproduziu a ficha de ${r.divergencias} pessoa(s) — nada mudou. Isso é defeito nosso, não da configuração.`,
      );
    }
    const contaId = contaIdAtual();
    await this.prisma.$transaction(async (tx) => {
      await tx.configuracaoAcessoApp.update({ where: { contaId }, data: { fonte: "REGRAS" } });
      await tx.logAcessoApp.create({
        data: { tipo: "FONTE_REGRAS", autorId, causa: "A empresa passou a configurar o acesso pelas regras." },
      });
    });
    const rec = await this.recalcular("PASSAR_PARA_REGRAS");
    return { pessoas: rec.pessoas };
  }

  // ─── espelho das colunas ─────────────────────────────────────────────────

  /**
   * Deriva perfil padrão e exceções da ficha de cada motorista, confere e grava.
   *
   * Tudo numa transação só: se o portão reprova, NADA do que foi escrito nesta
   * rodada fica (perfis, exceções, efetivo). O resultado — ok ou não — fica
   * em `ConfiguracaoAcessoApp.espelho*`, fora da transação.
   */
  async espelharDasColunas(
    causa: string,
  ): Promise<{ pessoas: number; mudaram: number; divergencias: number }> {
    const contaId = contaIdAtual();
    await this.garantirConfig();
    const agora = new Date();
    try {
      const r = await this.prisma.$transaction(
        async (tx) => {
          const perfisAntes = await tx.perfilAcessoApp.findMany({
            select: { id: true, nome: true, ...SELECT_COLUNAS },
          });
          const motoristas = await tx.motorista.findMany({
            select: { id: true, cpf: true, perfilAcessoId: true, ...SELECT_COLUNAS },
          });
          const plano = planejarEspelho(
            motoristas.map((m) => ({
              id: m.id,
              cpf: soDigitos(m.cpf),
              perfilAcessoId: m.perfilAcessoId,
              colunas: colunasDe(m),
            })),
            perfisAntes
              .filter((p) => p.nome !== PERFIL_HERDADO_MOTORISTA && p.nome !== PERFIL_HERDADO_FUNCIONARIO)
              .map((p) => ({ id: p.id, colunas: colunasDe(p) })),
            PADRAO_DO_BANCO,
          );

          // Perfis de verdade: as capacidades espelham as colunas deles.
          for (const [id, caps] of plano.perfis) {
            await tx.perfilAcessoApp.update({ where: { id }, data: { capacidades: caps } });
          }
          // Os dois perfis herdados.
          const herdadoM = await this.perfilHerdado(tx, PERFIL_HERDADO_MOTORISTA, plano.padrao,
            "O que a maioria dos motoristas tinha na ficha. Editável como qualquer perfil.");
          const herdadoF = await this.perfilHerdado(tx, PERFIL_HERDADO_FUNCIONARIO,
            capacidadesDoRegistradoHerdado(),
            "O que todo registrado em carteira tem no app: o ponto e os documentos que a empresa pedir.");
          await tx.configuracaoAcessoApp.update({
            where: { contaId },
            data: { perfilPadraoMotoristaId: herdadoM, perfilPadraoFuncionarioId: herdadoF },
          });

          // Quem foi posto num perfil pela tela antiga fica FIXADO nele.
          await tx.motorista.updateMany({
            where: { perfilAcessoId: { not: null }, perfilFixadoMotivo: null },
            data: { perfilFixadoMotivo: "Posto neste perfil pela tela de perfis." },
          });

          await this.sincronizarExcecoesDoEspelho(tx, plano.excecoes, agora);

          // O PORTÃO: perfil + exceções têm que reproduzir a ficha de cada
          // aprovado ativo. Confere com as camadas de corte TODAS em sombra
          // (menos aprovação): o que o portão prova é o espelho, não as
          // travas. Uma trava que a plataforma ligou corta o efetivo gravado —
          // é decisão dela — mas não pode reprovar o espelho.
          const { ctx, pessoas, excecoesPorCpf } = await this.carregarContexto(tx, agora);
          const ctxPortao = {
            ...ctx,
            camadasEmSombra: new Set<CamadaCorte>(CAMADAS_CORTE.filter((c) => c !== "APROVACAO")),
          };
          const conferido = this.calcular(pessoas, ctxPortao, excecoesPorCpf, agora);
          const resultados = this.calcular(pessoas, ctx, excecoesPorCpf, agora);
          const divergencias: DivergenciaEspelho[] = [];
          for (const m of motoristas) {
            const p = pessoas.get(soDigitos(m.cpf))!;
            if (!p.motorista?.ativo || !p.motorista.aprovado) continue;
            const quer = new Set(plano.desejado.get(m.id)!);
            const tem = new Set(
              conferido
                .get(p.cpf)!
                .efetivo.filter((c) => CAPACIDADE_POR_CHAVE[c].vinculo !== "FUNCIONARIO"),
            );
            const faltou = [...quer].filter((c) => !tem.has(c));
            const sobrou = [...tem].filter((c) => !quer.has(c as CapacidadeApp));
            if (faltou.length || sobrou.length) divergencias.push({ motoristaId: m.id, faltou, sobrou });
          }
          if (divergencias.length) throw new PortaoDoEspelho(divergencias);

          const mudaram = await this.gravar(tx, pessoas, resultados, `ESPELHO:${causa}`, agora);
          return { pessoas: pessoas.size, mudaram };
        },
        { timeout: 120_000 },
      );
      await this.prisma.configuracaoAcessoApp.update({
        where: { contaId },
        data: { espelhadoEm: agora, espelhoDivergencias: 0, espelhoDetalhe: Prisma.DbNull },
      });
      return { ...r, divergencias: 0 };
    } catch (e) {
      if (!(e instanceof PortaoDoEspelho)) throw e;
      await this.prisma.configuracaoAcessoApp.update({
        where: { contaId },
        data: {
          espelhadoEm: agora,
          espelhoDivergencias: e.divergencias.length,
          espelhoDetalhe: e.divergencias.slice(0, 50) as unknown as Prisma.InputJsonValue,
        },
      });
      return { pessoas: 0, mudaram: 0, divergencias: e.divergencias.length };
    }
  }

  private async perfilHerdado(
    tx: Tx,
    nome: string,
    capacidades: CapacidadeApp[],
    descricao: string,
  ): Promise<string> {
    const existe = await tx.perfilAcessoApp.findFirst({ where: { nome }, select: { id: true } });
    if (existe) {
      await tx.perfilAcessoApp.update({ where: { id: existe.id }, data: { capacidades, ativo: true } });
      return existe.id;
    }
    const p = await tx.perfilAcessoApp.create({
      data: { nome, descricao, capacidades },
      select: { id: true },
    });
    return p.id;
  }

  /**
   * Deixa vivas EXATAMENTE as exceções que o espelho pede. Só mexe nas de
   * origem MIGRACAO: exceção que alguém lançou à mão nunca é tocada aqui.
   */
  private async sincronizarExcecoesDoEspelho(
    tx: Tx,
    planejadas: { cpf: string; capacidade: string; efeito: "CONCEDER" | "NEGAR" }[],
    agora: Date,
  ): Promise<void> {
    const vivas = await tx.excecaoAcessoApp.findMany({
      where: { revogadaEm: null, origem: "MIGRACAO" },
      select: { id: true, cpf: true, capacidade: true, efeito: true },
    });
    const chave = (e: { cpf: string; capacidade: string; efeito: string }) =>
      `${e.cpf}:${e.capacidade}:${e.efeito}`;
    const quer = new Set(planejadas.map(chave));
    const tem = new Set(vivas.map(chave));

    const sair = vivas.filter((e) => !quer.has(chave(e))).map((e) => e.id);
    if (sair.length) {
      await tx.excecaoAcessoApp.updateMany({
        where: { id: { in: sair } },
        data: {
          revogadaEm: agora,
          chaveViva: null,
          motivoRevogacao: "A ficha dele passou a bater com o perfil.",
        },
      });
    }
    // Exceção viva de qualquer origem pra mesma pessoa e capacidade ocupa a
    // vaga (`chaveViva`): a lançada à mão vence o espelho.
    const ocupadas = new Set(
      (
        await tx.excecaoAcessoApp.findMany({
          where: { revogadaEm: null, origem: { not: "MIGRACAO" } },
          select: { cpf: true, capacidade: true },
        })
      ).map((e) => `${e.cpf}:${e.capacidade}`),
    );
    const entrar = planejadas.filter(
      (e) => !tem.has(chave(e)) && !ocupadas.has(`${e.cpf}:${e.capacidade}`),
    );
    if (entrar.length) {
      await tx.excecaoAcessoApp.createMany({
        data: entrar.map((e) => ({
          cpf: e.cpf,
          capacidade: e.capacidade,
          efeito: e.efeito,
          motivo: MOTIVO_ESPELHO,
          origem: "MIGRACAO",
          chaveViva: `${e.cpf}:${e.capacidade}`,
        })),
      });
    }
  }
}
