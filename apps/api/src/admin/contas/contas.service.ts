import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  type OnModuleInit,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { UploadsService } from "../../uploads/uploads.service";
import { CamposLayoutService } from "../campos-layout/campos-layout.service";
import { PermissoesService, PAPEL_ADMIN } from "../permissoes/permissoes.service";
import { MATERIAIS_INICIAIS, TIPOS_EVENTO_INICIAIS, TIPOS_SERVICO_INICIAIS } from "./kit-inicial";
import { gerarCodigoConvite } from "./codigo-convite";

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
export class ContasService implements OnModuleInit {
  private readonly log = new Logger(ContasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissoes: PermissoesService,
    private readonly camposLayout: CamposLayoutService,
    private readonly uploads: UploadsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.garantirOperadorDaPlataforma();
    await this.garantirCodigosDeConvite();
  }

  /**
   * Quem opera a plataforma (vê a tela de empresas).
   *
   * A coluna `plataforma` nasce `false` pra todo mundo, o que está certo — mas
   * cria um ovo e galinha: o sistema sobe sem nenhum operador e a única tela que
   * criaria o primeiro já exige ser um.
   *
   * Duas saídas, nesta ordem:
   *
   * 1. `PLATAFORMA_EMAILS` (lista separada por vírgula) — a forma EXPLÍCITA, e a
   *    que resolve na prática. Reaplica a cada boot, então serve pra recuperar o
   *    acesso sem mexer no banco: basta corrigir a variável e reiniciar.
   * 2. Sem a variável e sem nenhum operador, promove os ADMINISTRADORES da conta
   *    mais antiga — não só o usuário mais antigo, que foi o que deixou o dono de
   *    fora quando havia um cadastro anterior ao dele (um seed, um teste).
   *
   * Nunca REMOVE o acesso de ninguém: se você despromover alguém pelo banco, o
   * boot não desfaz — só a variável adiciona.
   */
  private async garantirOperadorDaPlataforma(): Promise<void> {
    try {
      await comoSistema(async () => {
        const emails = (process.env.PLATAFORMA_EMAILS ?? "")
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);

        if (emails.length > 0) {
          const { count } = await this.prisma.user.updateMany({
            where: { email: { in: emails }, plataforma: false },
            data: { plataforma: true },
          });
          const achados = await this.prisma.user.count({ where: { email: { in: emails } } });
          if (achados < emails.length) {
            this.log.warn(
              `PLATAFORMA_EMAILS tem ${emails.length} e-mail(s) e só ${achados} existe(m) no banco — ` +
                `confira se escreveu certo: ${emails.join(", ")}`,
            );
          }
          if (count > 0) this.log.log(`${count} usuário(s) promovido(s) a operador da plataforma.`);
          if (achados > 0) return;
        }

        const jaExiste = await this.prisma.user.count({ where: { plataforma: true } });
        if (jaExiste > 0) return;

        const contaMaisAntiga = await this.prisma.conta.findFirst({
          orderBy: { criadaEm: "asc" },
          select: { id: true, nome: true },
        });
        if (!contaMaisAntiga) return;

        // Administradores da conta 1. Se não houver papel nenhum atribuído, cai
        // pro usuário mais antigo — melhor alguém que ninguém.
        const admins = await this.prisma.user.findMany({
          where: {
            contaId: contaMaisAntiga.id,
            ativo: true,
            papel: { nome: PAPEL_ADMIN },
          },
          select: { id: true, email: true },
        });
        const alvos =
          admins.length > 0
            ? admins
            : await this.prisma.user.findMany({
                where: { contaId: contaMaisAntiga.id, ativo: true },
                orderBy: { criadoEm: "asc" },
                take: 1,
                select: { id: true, email: true },
              });
        if (alvos.length === 0) return;

        await this.prisma.user.updateMany({
          where: { id: { in: alvos.map((a) => a.id) } },
          data: { plataforma: true },
        });
        this.log.warn(
          `Nenhum operador de plataforma existia. Promovi ${alvos.map((a) => a.email).join(", ")} ` +
            `(administradores de ${contaMaisAntiga.nome}). Pra fixar quem manda, use PLATAFORMA_EMAILS.`,
        );
      });
    } catch (erro) {
      this.log.error(
        `Falhou ao garantir o operador de plataforma: ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );
    }
  }

  /**
   * Código de convite que ainda não existe. O sufixo é aleatório e o índice na
   * coluna é único, então a colisão é o próprio banco quem denuncia — tentar de
   * novo é mais simples (e mais correto) do que confiar na aleatoriedade.
   */
  private async codigoInedito(nomeEmpresa: string): Promise<string> {
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      const candidato = gerarCodigoConvite(nomeEmpresa);
      const existe = await comoSistema(() =>
        this.prisma.conta.findUnique({ where: { codigoConvite: candidato }, select: { id: true } }),
      );
      if (!existe) return candidato;
    }
    throw new Error("Não consegui gerar um código de convite único.");
  }

  /** Empresa que já existia (criada antes do código) ganha o dela no boot. */
  private async garantirCodigosDeConvite(): Promise<void> {
    try {
      const semCodigo = await comoSistema(() =>
        this.prisma.conta.findMany({ where: { codigoConvite: null }, select: { id: true, nome: true } }),
      );
      for (const conta of semCodigo) {
        const codigo = await this.codigoInedito(conta.nome);
        await comoSistema(() =>
          this.prisma.conta.update({ where: { id: conta.id }, data: { codigoConvite: codigo } }),
        );
        this.log.log(`Código de convite de ${conta.nome}: ${codigo}`);
      }
    } catch (erro) {
      this.log.error(
        `Falhou ao gerar códigos de convite: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }

  /** Troca o código — pra quando a empresa achar que ele circulou demais. */
  async trocarCodigoConvite(contaId: string) {
    const conta = await comoSistema(() =>
      this.prisma.conta.findUnique({ where: { id: contaId }, select: { nome: true } }),
    );
    if (!conta) throw new BadRequestException("Empresa não encontrada.");
    const codigo = await this.codigoInedito(conta.nome);
    return comoSistema(() =>
      this.prisma.conta.update({
        where: { id: contaId },
        data: { codigoConvite: codigo },
        select: { id: true, nome: true, codigoConvite: true },
      }),
    );
  }

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
        logoUrl: true,
        codigoConvite: true,
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
    const codigoConvite = await this.codigoInedito(input.nome);

    const conta = await comoSistema(() =>
      this.prisma.conta.create({
        data: {
          nome: input.nome.trim(),
          slug,
          cnpj: input.cnpj?.replace(/\D/g, "") || null,
          codigoConvite,
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

        await this.prisma.tipoServico.createMany({
          data: TIPOS_SERVICO_INICIAIS.map((t) => ({ ...t, contaId: conta.id })),
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
   * Troca a logo da empresa. Devolve a URL já com um `v` novo — sem isso o
   * navegador continuaria mostrando a logo velha do cache.
   *
   * A chave do objeto não vira a URL: quem serve é `/publico/contas/:id/logo`,
   * pra a imagem poder ser usada em `<img src>` (o navegador não manda o header
   * de autenticação numa tag de imagem).
   */
  async definirLogo(contaId: string, buffer: Buffer, mimetype: string) {
    return comoSistema(async () => {
      const atual = await this.prisma.conta.findUnique({
        where: { id: contaId },
        select: { logoKey: true },
      });
      const key = await this.uploads.putLogoConta(buffer, mimetype, contaId);
      const conta = await this.prisma.conta.update({
        where: { id: contaId },
        data: { logoKey: key, logoUrl: `/publico/contas/${contaId}/logo?v=${key.slice(-12)}` },
        select: { id: true, nome: true, logoUrl: true },
      });
      if (atual?.logoKey) await this.uploads.removerObjeto(atual.logoKey);
      return conta;
    });
  }

  /** Volta pra marca da plataforma. */
  async removerLogo(contaId: string) {
    return comoSistema(async () => {
      const atual = await this.prisma.conta.findUnique({
        where: { id: contaId },
        select: { logoKey: true },
      });
      const conta = await this.prisma.conta.update({
        where: { id: contaId },
        data: { logoKey: null, logoUrl: null },
        select: { id: true, nome: true, logoUrl: true },
      });
      if (atual?.logoKey) await this.uploads.removerObjeto(atual.logoKey);
      return conta;
    });
  }

  /** Bytes da logo, pra rota pública que a serve. */
  async logoBuffer(contaId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const conta = await comoSistema(() =>
      this.prisma.conta.findUnique({ where: { id: contaId }, select: { logoKey: true } }),
    );
    if (!conta?.logoKey) return null;
    const buffer = await this.uploads.getObjectBuffer(conta.logoKey);
    const ext = conta.logoKey.split(".").pop();
    const contentType =
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { buffer, contentType };
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
