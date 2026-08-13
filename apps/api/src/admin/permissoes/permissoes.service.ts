import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  CATALOGO_PERMISSOES,
  PERMISSOES_OPERADOR,
  TODAS_AS_CHAVES,
} from "@ronan/shared-types";
import { comoSistema, contaIdAtual } from "../../common/conta/conta-context";
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
   * Papéis embutidos. Administrador sempre = TODAS as permissões (re-sincroniza
   * pra pegar chaves novas). Operador só na criação (preserva edições do admin).
   */
  async seedPapeisSistema() {
    // O nome do papel só é único DENTRO da conta — duas empresas têm cada uma o
    // seu "Administrador" —, então o upsert precisa da chave composta.
    const contaId = contaIdAtual();
    await this.prisma.papel.upsert({
      where: { contaId_nome: { contaId, nome: PAPEL_ADMIN } },
      create: {
        nome: PAPEL_ADMIN,
        descricao: "Acesso total ao sistema.",
        permissoes: TODAS_AS_CHAVES,
        sistema: true,
      },
      update: { permissoes: TODAS_AS_CHAVES, sistema: true },
    });
    await this.prisma.papel.upsert({
      where: { contaId_nome: { contaId, nome: PAPEL_OPERADOR } },
      create: {
        nome: PAPEL_OPERADOR,
        descricao: "Operação e cadastros, sem o módulo Sistema.",
        permissoes: PERMISSOES_OPERADOR,
        sistema: true,
      },
      update: { sistema: true },
    });
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
