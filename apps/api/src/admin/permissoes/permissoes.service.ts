import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  CATALOGO_PERMISSOES,
  PERMISSOES_ADMIN_EMPRESA,
  PERMISSOES_OPERADOR,
  TODAS_AS_CHAVES,
} from "@ronan/shared-types";
import { comoSistema, contaIdAtual } from "../../common/conta/conta-context";
import { ehContaDaPlataforma } from "../../common/conta/eh-plataforma";
import { tetoDaConta, tetoPadrao } from "../../common/conta/teto-da-conta";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { PrismaService } from "../../prisma/prisma.service";

export const PAPEL_ADMIN = "Administrador";
export const PAPEL_OPERADOR = "Operador";

@Injectable()
export class PermissoesService implements OnModuleInit {
  private readonly log = new Logger(PermissoesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      // O catálogo de chaves é da plataforma (uma linha por chave, sem dono).
      await comoSistema(() => this.seedCatalogo());
      // O teto padrão nasce igual à constante e vira dado a partir daí.
      await comoSistema(() => this.seedTetoPadrao());
      // Papéis e usuários são de cada empresa: toda conta precisa do seu
      // "Administrador" com o catálogo em dia.
      await paraCadaConta(this.prisma, async () => {
        await this.seedPapeisSistema();
        await this.backfillUsuarios();
      });
    } catch (err) {
      this.log.warn(`Falha ao semear RBAC: ${(err as Error).message}`);
    }
  }

  /** Catálogo de permissões (idempotente, com controle de drift de título). */
  async seedCatalogo() {
    for (const p of CATALOGO_PERMISSOES) {
      await this.prisma.permissao.upsert({
        where: { chave: p.chave },
        create: {
          chave: p.chave,
          modulo: p.modulo,
          titulo: p.titulo,
          descricao: p.descricao,
          ordem: p.ordem,
          sistema: true,
        },
        update: { modulo: p.modulo, titulo: p.titulo, descricao: p.descricao, ordem: p.ordem },
      });
    }
    // Poda chaves que saíram do catálogo (ex.: o antigo módulo "Resumo diário",
    // que virou preferência por usuário). Mantém a tabela = código.
    const removidas = await this.prisma.permissao.deleteMany({
      where: { chave: { notIn: TODAS_AS_CHAVES } },
    });
    // Limpa também referências órfãs nos papéis (chaves que não existem mais).
    if (removidas.count > 0) {
      const papeis = await this.prisma.papel.findMany({ select: { id: true, permissoes: true } });
      const validas = new Set(TODAS_AS_CHAVES);
      for (const pap of papeis) {
        const limpas = pap.permissoes.filter((c) => validas.has(c));
        if (limpas.length !== pap.permissoes.length) {
          await this.prisma.papel.update({ where: { id: pap.id }, data: { permissoes: limpas } });
        }
      }
    }
    this.log.log(
      `Catálogo de permissões sincronizado (${CATALOGO_PERMISSOES.length}; ${removidas.count} removidas).`,
    );
  }

  /**
   * O teto padrão das empresas nasce igual a `PERMISSOES_ADMIN_EMPRESA` e, a
   * partir daí, é dado: quem manda é o painel.
   *
   * Semeia UMA vez (a flag `semeado`). Sem ela, "lista vazia" seria ambíguo —
   * nunca configurado, ou configurado como "nenhuma tela"? — e um deploy
   * reescreveria por cima da decisão de quem configurou.
   */
  async seedTetoPadrao() {
    const existente = await this.prisma.configuracaoPermissoes.findUnique({
      where: { id: "singleton" },
      select: { semeado: true },
    });
    if (existente?.semeado) return;

    await this.prisma.configuracaoPermissoes.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", tetoPadrao: [...PERMISSOES_ADMIN_EMPRESA], semeado: true },
      update: { tetoPadrao: [...PERMISSOES_ADMIN_EMPRESA], semeado: true },
    });
    this.log.log(`Teto padrão das empresas semeado com ${PERMISSOES_ADMIN_EMPRESA.length} chaves.`);
  }

  /** O teto padrão de hoje, pra tela mostrar e editar. */
  async lerTetoPadrao(): Promise<{ permissoes: string[] }> {
    return { permissoes: await comoSistema(() => tetoPadrao(this.prisma)) };
  }

  /**
   * Troca o teto padrão. Vale pra toda empresa que não tem teto próprio, e a
   * poda do próximo boot (ou de um salvamento por empresa) aplica o que ficou
   * de fora.
   */
  async definirTetoPadrao(permissoes: string[]): Promise<{ permissoes: string[] }> {
    const validas = new Set(TODAS_AS_CHAVES);
    const chaves = [...new Set(permissoes.filter((c) => validas.has(c)))];

    await comoSistema(() =>
      this.prisma.configuracaoPermissoes.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", tetoPadrao: chaves, semeado: true },
        update: { tetoPadrao: chaves, semeado: true },
      }),
    );

    // Aplica na hora em todas as empresas sem teto próprio: quem acabou de
    // fechar uma tela espera que ela feche agora, não no próximo restart.
    await paraCadaConta(this.prisma, async () => {
      await this.seedPapeisSistema();
    });

    this.log.log(`Teto padrão das empresas: ${chaves.length} chave(s).`);
    return { permissoes: chaves };
  }

  /**
   * Papéis embutidos. Administrador sempre = TODAS as permissões (re-sincroniza
   * pra pegar chaves novas). Operador só na criação (preserva edições do admin).
   */
  async seedPapeisSistema() {
    // O nome do papel só é único DENTRO da conta — duas empresas têm cada uma o
    // seu "Administrador" —, então o upsert precisa da chave composta.
    const contaId = contaIdAtual();

    // O "Administrador" de uma empresa CLIENTE não é o mesmo que o da conta da
    // plataforma. Ele manda na empresa dele — não no WhatsApp compartilhado, nem
    // nas chaves de IA que a plataforma paga, nem na versão do app que ela
    // publica nas lojas. A conta marcada `ehPlataforma` continua com tudo.
    const daPlataforma = await ehContaDaPlataforma(this.prisma, contaId);
    // O teto da empresa, não a constante: a plataforma pode ter liberado ou
    // fechado telas pra este cliente específico, e o Administrador dele tem que
    // refletir isso. Pra quem não foi customizado, `tetoDaConta` devolve
    // exatamente `PERMISSOES_ADMIN_EMPRESA` — nada muda.
    const teto = await tetoDaConta(this.prisma, contaId);
    const permissoesAdmin = TODAS_AS_CHAVES.filter((c) => teto.has(c));
    // O Operador segue a mesma régua: `PERMISSOES_OPERADOR` é montado por módulo
    // (Operação + Cadastros), e "Pedágios (rodovias)" mora em Cadastros — então
    // sem esta poda o operador de uma empresa cliente herdaria a base de praças,
    // que é compartilhada entre todas.
    const permissoesOperador = PERMISSOES_OPERADOR.filter((c) => teto.has(c));

    await this.prisma.papel.upsert({
      where: { contaId_nome: { contaId, nome: PAPEL_ADMIN } },
      create: {
        nome: PAPEL_ADMIN,
        descricao: daPlataforma ? "Acesso total ao sistema." : "Administra esta empresa.",
        permissoes: permissoesAdmin,
        sistema: true,
      },
      // Re-sincroniza a cada boot pra pegar chave nova do catálogo. Pra empresa
      // cliente isso também PODA o que virou de plataforma depois.
      update: { permissoes: permissoesAdmin, sistema: true },
    });
    await this.prisma.papel.upsert({
      where: { contaId_nome: { contaId, nome: PAPEL_OPERADOR } },
      create: {
        nome: PAPEL_OPERADOR,
        descricao: "Operação e cadastros, sem o módulo Sistema.",
        permissoes: permissoesOperador,
        sistema: true,
      },
      update: { sistema: true },
    });

    if (!daPlataforma) await this.podarAcimaDoTeto(teto);
  }

  /**
   * Tira das mãos de uma empresa qualquer chave acima do teto dela.
   *
   * Não basta cuidar do papel Administrador na criação: o Operador é montado por
   * MÓDULO (Operação + Cadastros) e "Pedágios (rodovias)" mora em Cadastros;
   * além disso a empresa pode ter criado papéis próprios antes de a chave virar
   * exclusiva — ou antes de a plataforma fechar o teto dela. Roda a cada boot,
   * então promover um recurso a "de plataforma", ou apertar o teto de um
   * cliente, limpa o passado sozinho.
   */
  private async podarAcimaDoTeto(teto: Set<string>): Promise<void> {
    const papeis = await this.prisma.papel.findMany({
      select: { id: true, nome: true, permissoes: true },
    });
    for (const papel of papeis) {
      const limpas = papel.permissoes.filter((c) => teto.has(c));
      if (limpas.length === papel.permissoes.length) continue;
      await this.prisma.papel.update({ where: { id: papel.id }, data: { permissoes: limpas } });
      this.log.log(
        `Papel "${papel.nome}": removidas ${papel.permissoes.length - limpas.length} permissão(ões) acima do teto da empresa.`,
      );
    }
  }

  /** Rede de segurança: usuário sem papel cai no Operador (a migração inicial
   * já atribuiu os papéis pelos perfis antigos). */
  async backfillUsuarios() {
    const operador = await this.prisma.papel.findFirst({
      where: { nome: PAPEL_OPERADOR },
      select: { id: true },
    });
    if (operador) {
      await this.prisma.user.updateMany({
        where: { papelId: null },
        data: { papelId: operador.id },
      });
    }
  }

  listarCatalogo() {
    return this.prisma.permissao.findMany({ orderBy: [{ modulo: "asc" }, { ordem: "asc" }] });
  }
}
