import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { CamposLayoutService } from "../campos-layout/campos-layout.service";
import { PermissoesService, PAPEL_ADMIN } from "../permissoes/permissoes.service";
import { MATERIAIS_INICIAIS, TIPOS_EVENTO_INICIAIS } from "./kit-inicial";

export type CriarContaInput = {
  nome: string;
  slug?: string;
  cnpj?: string;
  /** Primeiro usuário do painel — quem recebe o acesso. */
  adminNome: string;
  adminEmail: string;
  adminSenha: string;
};

/**
 * Cadastro das empresas que usam o sistema. É a única parte do backend que
 * atravessa contas de propósito, e por isso mora atrás de `User.plataforma`.
 */
@Injectable()
export class ContasService {
  private readonly log = new Logger(ContasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissoes: PermissoesService,
    private readonly camposLayout: CamposLayoutService,
  ) {}

  /** `Conta` é model global (não tem dono), então a listagem não precisa de contexto. */
  async listar() {
    const contas = await this.prisma.conta.findMany({
      orderBy: { criadaEm: "asc" },
      select: {
        id: true,
        nome: true,
        slug: true,
        cnpj: true,
        ativa: true,
        permiteAutoCadastro: true,
        criadaEm: true,
        _count: { select: { users: true, motoristas: true, viagens: true } },
      },
    });
    return contas.map(({ _count, ...conta }) => ({
      ...conta,
      usuarios: _count.users,
      motoristas: _count.motoristas,
      viagens: _count.viagens,
    }));
  }

  /**
   * Cria a empresa e a deixa pronta pra uso no mesmo passo.
   *
   * Não é uma transação só: os seeds de papel e de campo de layout são
   * reaproveitados dos serviços que já existem, e eles usam o cliente deles.
   * Em compensação, falha no meio DESFAZ o que foi criado (`desfazer` abaixo) —
   * porque conta pela metade é pior que conta nenhuma: ninguém consegue entrar
   * pra consertar e o identificador já fica ocupado.
   */
  async criar(input: CriarContaInput) {
    const slug = normalizarSlug(input.slug ?? input.nome);
    if (!slug) throw new BadRequestException("Não consegui montar um identificador a partir do nome.");

    await comoSistema(async () => {
      const [slugEmUso, emailEmUso] = await Promise.all([
        this.prisma.conta.findUnique({ where: { slug }, select: { id: true } }),
        // E-mail é único no sistema TODO (não por conta): é o que deixa o login
        // não perguntar de qual empresa a pessoa é.
        this.prisma.user.findUnique({ where: { email: input.adminEmail }, select: { id: true } }),
      ]);
      if (slugEmUso) throw new ConflictException(`Já existe empresa com o identificador "${slug}".`);
      if (emailEmUso) throw new ConflictException("Esse e-mail já é usado por outro acesso.");
    });

    const senhaHash = await AuthService.hashPassword(input.adminSenha);

    const conta = await comoSistema(() =>
      this.prisma.conta.create({
        data: {
          nome: input.nome.trim(),
          slug,
          cnpj: input.cnpj?.replace(/\D/g, "") || null,
          // Auto-cadastro nasce DESLIGADO: o app publicado não pergunta a empresa,
          // então duas contas ligadas fariam o signup não saber onde cadastrar.
          permiteAutoCadastro: false,
        },
      }),
    );

    try {
      // Daqui pra baixo, tudo roda DENTRO da conta nova — a trava carimba sozinha.
      await comConta(conta.id, async () => {
        await this.permissoes.seedPapeisSistema();
        await this.camposLayout.seedCamposSistema();

        const papelAdmin = await this.prisma.papel.findFirst({
          where: { nome: PAPEL_ADMIN },
          select: { id: true },
        });

        await this.prisma.user.create({
          data: {
            nome: input.adminNome.trim(),
            email: input.adminEmail.trim().toLowerCase(),
            senhaHash,
            papelId: papelAdmin?.id ?? null,
            acessoGlobal: true,
          },
        });

        await this.prisma.material.createMany({
          data: MATERIAIS_INICIAIS.map((nome) => ({ nome, contaId: conta.id })),
          skipDuplicates: true,
        });

        await this.prisma.tipoEventoViagem.createMany({
          data: TIPOS_EVENTO_INICIAIS.map((t) => ({ ...t, contaId: conta.id })),
          skipDuplicates: true,
        });
      });
    } catch (erro) {
      await this.desfazer(conta.id);
      throw erro;
    }

    this.log.log(`Conta criada: ${conta.nome} (${conta.slug})`);
    return { id: conta.id, nome: conta.nome, slug: conta.slug, adminEmail: input.adminEmail };
  }

  /**
   * Desmonta uma conta que falhou no meio da criação.
   *
   * Só é chamado com uma conta recém-criada, então não há dado de ninguém em
   * risco — e a ordem segue as chaves estrangeiras, que são `Restrict` (o banco
   * recusa apagar a conta antes dos filhos). Se a limpeza também falhar, o
   * registro no log é o que permite terminar na mão.
   */
  private async desfazer(contaId: string): Promise<void> {
    try {
      await comoSistema(async () => {
        await this.prisma.tipoEventoViagem.deleteMany({ where: { contaId } });
        await this.prisma.material.deleteMany({ where: { contaId } });
        await this.prisma.campoLayout.deleteMany({ where: { contaId } });
        await this.prisma.user.deleteMany({ where: { contaId } });
        await this.prisma.papel.deleteMany({ where: { contaId } });
        await this.prisma.conta.delete({ where: { id: contaId } });
      });
    } catch (erro) {
      this.log.error(
        `Conta ${contaId} falhou ao ser criada E a limpeza não foi até o fim: ` +
          `${erro instanceof Error ? erro.message : String(erro)}. Precisa remover na mão.`,
      );
    }
  }

  /**
   * Liga/desliga a empresa. Desligada, ninguém dela entra — o `JwtStrategy`
   * recusa na hora, inclusive quem já estava com token válido no celular.
   * Os dados ficam intactos; é suspensão, não exclusão.
   */
  async definirAtiva(id: string, ativa: boolean) {
    return comoSistema(() =>
      this.prisma.conta.update({
        where: { id },
        data: { ativa },
        select: { id: true, nome: true, ativa: true },
      }),
    );
  }

  /**
   * Qual empresa recebe o auto-cadastro de motorista. Só uma por vez: o app das
   * lojas não pergunta a empresa, então duas ligadas deixariam o signup sem
   * saber onde cadastrar (e ele passaria a exigir o link com o identificador).
   */
  async definirAutoCadastro(id: string) {
    return comoSistema(async () => {
      await this.prisma.conta.updateMany({ data: { permiteAutoCadastro: false } });
      return this.prisma.conta.update({
        where: { id },
        data: { permiteAutoCadastro: true },
        select: { id: true, nome: true, permiteAutoCadastro: true },
      });
    });
  }
}

/** "Transportes Alex Ltda" → "transportes-alex-ltda" */
function normalizarSlug(bruto: string): string {
  return bruto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
