import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  Injectable,
  Logger,
  type OnModuleInit,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import {
  CODIGO_UF_IBGE,
  motivoMunicipioNaoBate,
  TODAS_AS_CHAVES,
  type AtualizarIaConfigInput,
} from "@ronan/shared-types";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { MOTIVO_TESTE_TERMINOU } from "../../common/conta/estado-da-conta";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthService } from "../../auth/auth.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { UploadsService } from "../../uploads/uploads.service";
import { CamposLayoutService } from "../campos-layout/campos-layout.service";
import { PermissoesService, PAPEL_ADMIN } from "../permissoes/permissoes.service";
import { MODULOS_PADRAO } from "@ronan/shared-types";
import {
  MATERIAIS_INICIAIS,
  MODALIDADES_INICIAIS,
  TIPOS_EVENTO_INICIAIS,
  TIPOS_SERVICO_INICIAIS,
} from "./kit-inicial";
import { gerarCodigoConvite } from "./codigo-convite";
import { identificarChave } from "../../common/identificar-chave";
import { cifrar, decifrar } from "../../common/cripto";
import { segredoDeCripto } from "../../common/segredo-cripto";

/**
 * O que a tela de Empresas pode mudar na casa. Todo campo é opcional: ela
 * manda só o que o super admin mexeu, e o que não vem fica como estava.
 */
export type ConfiguracaoPlataformaInput = {
  autoCadastroAberto?: boolean;
  diasTesteGratis?: number;
  maxCodigosPorHora?: number;
  sdrAtivo?: boolean;
  sdrProvider?: string;
  sdrModeloAnthropic?: string;
  sdrModeloGemini?: string;
  sdrModeloMinimax?: string;
  sdrLinkCadastro?: string;
  /** Chave digitada na tela. String vazia apaga e devolve a vez pra env. */
  sdrChaveAnthropic?: string;
  sdrChaveGemini?: string;
  sdrChaveMinimax?: string;
};

type DelegateComDelete = {
  deleteMany?: (args: { where: { contaId: string } }) => Promise<unknown>;
};

/**
 * Todo model que pertence a uma empresa, tirado do schema em tempo de boot.
 * É o que a exclusão varre — sem lista à mão pra ficar desatualizada.
 */
const MODELS_COM_CONTA: string[] = Prisma.dmmf.datamodel.models
  .filter((m) => m.fields.some((f) => f.name === "contaId"))
  .map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1));

export type CriarContaInput = {
  nome: string;
  slug?: string;
  cnpj?: string;
  /** Primeiro usuário do painel — quem recebe o acesso. */
  adminNome: string;
  adminEmail: string;
  adminSenha: string;
  /**
   * Hash pronto, pra quem já cobrou a senha antes (o auto-cadastro guarda ela
   * hasheada no pendente e não tem a original de volta). Vence `adminSenha`.
   */
  senhaHashPronta?: string;
  /**
   * Veio do site, sem ninguém da plataforma no meio. Muda três coisas, todas
   * de segurança ou de custo — ver os usos abaixo.
   */
  origemPublica?: boolean;
  /** Quando o período de teste acaba. `null`/ausente = não é teste. */
  trialExpiraEm?: Date | null;
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
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.garantirContaDaPlataforma();
    await this.garantirOperadorDaPlataforma();
    await this.garantirCodigosDeConvite();
  }

  /**
   * Rede de segurança pra `Conta.ehPlataforma`.
   *
   * A migration marca a conta mais antiga, mas ela roda com a tabela vazia num
   * banco criado do zero — e restaurar um dump anterior à coluna deixa todo
   * mundo `false`. Sem nenhuma conta marcada, ninguém pode conceder as chaves de
   * `CHAVES_PLATAFORMA` e a casa fica sem as próprias telas.
   *
   * Nunca troca de dono: se já houver uma marcada, não faz nada.
   */
  private async garantirContaDaPlataforma(): Promise<void> {
    try {
      await comoSistema(async () => {
        if ((await this.prisma.conta.count({ where: { ehPlataforma: true } })) > 0) return;

        const primeira = await this.prisma.conta.findFirst({
          orderBy: { criadaEm: "asc" },
          select: { id: true, nome: true },
        });
        if (!primeira) return;

        await this.prisma.conta.update({
          where: { id: primeira.id },
          data: { ehPlataforma: true },
        });
        this.log.log(`Conta da plataforma definida: "${primeira.nome}".`);
      });
    } catch (err) {
      this.log.warn(`Falha ao definir a conta da plataforma: ${(err as Error).message}`);
    }
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

        const contaDaCasa = await this.prisma.conta.findFirst({
          where: { ehPlataforma: true },
          select: { id: true, nome: true },
        });
        if (!contaDaCasa) return;

        // Administradores da casa. Se não houver papel nenhum atribuído, cai
        // pro usuário mais antigo — melhor alguém que ninguém.
        const admins = await this.prisma.user.findMany({
          where: {
            contaId: contaDaCasa.id,
            ativo: true,
            papel: { nome: PAPEL_ADMIN },
          },
          select: { id: true, email: true },
        });
        const alvos =
          admins.length > 0
            ? admins
            : await this.prisma.user.findMany({
                where: { contaId: contaDaCasa.id, ativo: true },
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
            `(administradores de ${contaDaCasa.nome}). Pra fixar quem manda, use PLATAFORMA_EMAILS.`,
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
        // A casa. A tela usa pra avisar que o teto não vale pra ela.
        ehPlataforma: true,
        permiteAutoCadastro: true,
        iaLeituraTicket: true,
        iaConferenciaTicket: true,
        logoUrl: true,
        codigoConvite: true,
        // Vazio = conjunto padrão. A tela precisa saber pra abrir o editor de
        // teto já no estado certo.
        permissoesPermitidas: true,
        permissoesExtras: true,
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

    const senhaHash = input.senhaHashPronta ?? (await AuthService.hashPassword(input.adminSenha));
    const codigoConvite = await this.codigoInedito(input.nome);

    const conta = await comoSistema(async () => {
      // A primeira empresa a existir é a casa. Num banco criado do zero a
      // migration passou com a tabela vazia, então é aqui que a plataforma ganha
      // dono — e sem dono ninguém concede as chaves de `CHAVES_PLATAFORMA`.
      // Num caminho PÚBLICO isto é sempre falso, nunca calculado. Decidir a
      // casa por "o banco está vazio" num endpoint aberto significa que, num
      // ambiente recém-restaurado, o primeiro estranho que se cadastrar vira
      // dono da plataforma e ganha o catálogo inteiro de permissões.
      const primeiraDoSistema = input.origemPublica
        ? false
        : (await this.prisma.conta.count()) === 0;

      return this.prisma.conta.create({
        data: {
          nome: input.nome.trim(),
          slug,
          cnpj: input.cnpj?.replace(/\D/g, "") || null,
          codigoConvite,
          ehPlataforma: primeiraDoSistema,
          trialExpiraEm: input.trialExpiraEm ?? null,
          // A leitura de ticket por IA custa por uso e a conta é da plataforma.
          // No painel ela nasce ligada porque tem alguém decidindo; numa porta
          // pública, seria toda conta nova gastando sem ninguém ter escolhido.
          ...(input.origemPublica ? { iaLeituraTicket: false } : {}),
          // Auto-cadastro nasce DESLIGADO: o app publicado não pergunta a empresa,
          // então duas contas ligadas fariam o signup não saber onde cadastrar.
          permiteAutoCadastro: false,
        },
      });
    });

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

        await this.prisma.modalidadeMotorista.createMany({
          data: MODALIDADES_INICIAIS.map((m) => ({ ...m, contaId: conta.id })),
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

        // Os módulos que a empresa nova recebe: o núcleo e o que não custa por
        // uso. Conferência por IA e WhatsApp ficam de fora até alguém da
        // plataforma ligar — são recursos que gastam dinheiro de quem opera o
        // produto, não de quem assina.
        await this.prisma.moduloContratado.createMany({
          data: MODULOS_PADRAO.map((chave) => ({
            contaId: conta.id,
            chave,
            ativo: true,
            vigenteDe: new Date(),
            observacao: "Módulo padrão de conta nova",
          })),
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
  /** Config da própria conta pra tela "Minha empresa". */
  async minhaEmpresa(contaId: string) {
    return this.prisma.conta.findUniqueOrThrow({
      where: { id: contaId },
      select: {
        id: true,
        nome: true,
        exigeFotoViagem: true,
        exigeFotoAbastecimento: true,
        // A identidade fiscal. Sai daqui porque é da EMPRESA — o CT-e é o
        // primeiro a usar, mas o MDF-e e o que vier depois usam a mesma coisa.
        cnpj: true,
        razaoSocial: true,
        inscricaoEstadual: true,
        inscricaoMunicipal: true,
        crt: true,
        logradouro: true,
        numero: true,
        complemento: true,
        bairro: true,
        cep: true,
        municipio: true,
        codigoMunicipioIbge: true,
        uf: true,
        telefoneFiscal: true,
        telefoneParaMotoristas: true,
        rntrc: true,
        tipoTransportador: true,
      },
    });
  }

  /**
   * A transportadora ajustando as regras dela mesma (tela "Minha empresa").
   * O `contaId` vem do usuário logado — nunca da URL, senão um admin trocaria a
   * config de outra conta só mudando o id no endereço.
   */
  async atualizarMinhaEmpresa(
    contaId: string,
    data: Record<string, unknown>,
  ) {
    // Campo vazio na tela significa "não tenho", e vazio no banco é null — não
    // string vazia, que passaria por preenchida em toda checagem de pendência.
    const limpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      limpo[k] = typeof v === "string" && v.trim() === "" ? null : v;
    }

    // O código IBGE começa com o código da UF. Conferir na hora de salvar é de
    // graça, e evita descobrir isso numa rejeição da SEFAZ semanas depois.
    const uf = limpo.uf as string | null | undefined;
    const ibge = limpo.codigoMunicipioIbge as string | null | undefined;
    if (uf && ibge && CODIGO_UF_IBGE[uf] && !ibge.startsWith(CODIGO_UF_IBGE[uf]!)) {
      throw new BadRequestException(
        motivoMunicipioNaoBate(ibge, uf),
      );
    }

    try {
      await this.prisma.conta.update({ where: { id: contaId }, data: limpo });
      return await this.minhaEmpresa(contaId);
    } catch (e) {
      // CNPJ é único entre contas: dizer isso é melhor que devolver o erro cru
      // do Postgres, que ninguém entende.
      if ((e as { code?: string }).code === "P2002") {
        throw new BadRequestException("Esse CNPJ já está cadastrado em outra empresa.");
      }
      throw e;
    }
  }

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
        await this.limparConteudo(contaId);
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
   * A empresa virou cliente: acabou o teste, mas para cima.
   *
   * A assimetria é de propósito, e é a razão deste método existir:
   * **religar é automático, cortar é humano.** `AssinaturasService` não encosta
   * em `Conta` (decisão do dono em 14/09/2026 — a régua avisa e NUNCA corta), e
   * isso estava certo para um lado só. Sem isto, a empresa cujo teste venceu na
   * sexta e que assina na segunda continuava em somente leitura **para sempre**:
   * o cron liga o flag e ninguém desliga, e `estadoDaConta` recalcula a cada
   * requisição a partir de um `trialExpiraEm` que ninguém limpa.
   *
   * `trialExpiraEm: null` é o que o schema já documenta como "não é teste, é
   * cliente".
   *
   * Destrava mesmo quando o bloqueio não veio do teste: quem manda assinar é
   * gente da plataforma, olhando a conta, e a alternativa (adivinhar o motivo
   * pelo texto de `motivoBloqueio`) erraria em silêncio. O que estava lá fica
   * na auditoria.
   *
   * Idempotente: conta que já é cliente sai daqui sem UPDATE e sem auditoria.
   */
  async virouCliente(contaId: string, usuarioId?: string | null): Promise<void> {
    const antes = await comoSistema(() =>
      this.prisma.conta.findUnique({
        where: { id: contaId },
        select: { nome: true, trialExpiraEm: true, somenteLeitura: true, motivoBloqueio: true },
      }),
    );
    if (!antes) return;
    if (antes.trialExpiraEm === null && !antes.somenteLeitura) return;

    await comoSistema(() =>
      this.prisma.conta.update({
        where: { id: contaId },
        data: { trialExpiraEm: null, somenteLeitura: false, motivoBloqueio: null },
      }),
    );

    // Dentro da conta: `AuditLog` é escopado, e gravar em `comoSistema` deixaria
    // a linha com o contaId de ninguém.
    await comConta(contaId, () =>
      this.auditoria.log({
        usuarioId: usuarioId ?? null,
        entidade: "Conta",
        entidadeId: contaId,
        acao: "UPDATE",
        campo: "somenteLeitura",
        valorAntes: {
          trialExpiraEm: antes.trialExpiraEm,
          somenteLeitura: antes.somenteLeitura,
          motivoBloqueio: antes.motivoBloqueio,
        },
        valorDepois: { trialExpiraEm: null, somenteLeitura: false, motivoBloqueio: null },
        motivo: "Virou cliente: assinatura ativa",
      }),
    ).catch((e: unknown) => this.log.warn(`Auditoria de virouCliente falhou: ${String(e)}`));

    this.log.log(`${antes.nome} virou cliente — teste encerrado e escrita liberada.`);
  }

  /**
   * Prorroga (ou encerra) o período de teste de uma empresa.
   *
   * Não existia: `trialExpiraEm` só era escrito na criação da conta, e nada
   * limpava `somenteLeitura` — prorrogar um teste era UPDATE no banco à mão.
   *
   * `dias` conta a partir de HOJE, não da data antiga: prorrogar uma conta que
   * já venceu há uma semana somando na data velha devolveria um teste que já
   * nasce vencido. `dias = 0` encerra agora (e a conta cai em somente leitura
   * na hora, porque `estadoDaConta` não espera o cron).
   */
  async definirTeste(id: string, dias: number, usuarioId?: string | null) {
    const antes = await comoSistema(() =>
      this.prisma.conta.findUnique({
        where: { id },
        select: { nome: true, trialExpiraEm: true, somenteLeitura: true },
      }),
    );
    if (!antes) throw new BadRequestException("Empresa não encontrada.");

    const expira = new Date(Date.now() + dias * 86_400_000);
    const atualizada = await comoSistema(() =>
      this.prisma.conta.update({
        where: { id },
        data: {
          trialExpiraEm: expira,
          // Prorrogar sem destravar seria prorrogar no papel: a conta seguiria
          // sem poder escrever até o cron da madrugada seguinte.
          somenteLeitura: dias <= 0,
          motivoBloqueio: dias <= 0 ? MOTIVO_TESTE_TERMINOU : null,
        },
        select: { id: true, nome: true, trialExpiraEm: true, somenteLeitura: true },
      }),
    );

    await comConta(id, () =>
      this.auditoria.log({
        usuarioId: usuarioId ?? null,
        entidade: "Conta",
        entidadeId: id,
        acao: "UPDATE",
        campo: "trialExpiraEm",
        valorAntes: { trialExpiraEm: antes.trialExpiraEm, somenteLeitura: antes.somenteLeitura },
        valorDepois: {
          trialExpiraEm: atualizada.trialExpiraEm,
          somenteLeitura: atualizada.somenteLeitura,
        },
        motivo: dias <= 0 ? "Teste encerrado pela plataforma" : `Teste ajustado para ${dias} dias`,
      }),
    ).catch((e: unknown) => this.log.warn(`Auditoria de definirTeste falhou: ${String(e)}`));

    return atualizada;
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

  /**
   * Liga/desliga os recursos de IA de ticket de uma empresa.
   *
   * Mora aqui, e não na matriz de permissões, porque quem paga a chamada é a
   * plataforma: um administrador de empresa não pode ganhar essa chave por
   * engano num papel e sair gastando. Mesma família de `ativa` e
   * `permiteAutoCadastro`.
   *
   * Os dois campos são opcionais e aplicados só quando vêm — assim a tela pode
   * mexer num sem mandar o valor do outro e sobrescrever sem querer.
   */
  async definirRecursosIa(
    id: string,
    recursos: { iaLeituraTicket?: boolean; iaConferenciaTicket?: boolean },
  ) {
    const data: { iaLeituraTicket?: boolean; iaConferenciaTicket?: boolean } = {};
    if (recursos.iaLeituraTicket !== undefined) data.iaLeituraTicket = recursos.iaLeituraTicket;
    if (recursos.iaConferenciaTicket !== undefined) {
      data.iaConferenciaTicket = recursos.iaConferenciaTicket;
    }

    return comoSistema(() =>
      this.prisma.conta.update({
        where: { id },
        data,
        select: {
          id: true,
          nome: true,
          iaLeituraTicket: true,
          iaConferenciaTicket: true,
        },
      }),
    );
  }

  /**
   * Os modelos de IA da empresa (`ConfiguracaoIa`). Era uma tela de Ajustes que
   * só a plataforma enxergava; mora aqui porque quem paga a IA é a plataforma,
   * e é ela quem escolhe o modelo de cada cliente.
   *
   * Roda DENTRO da conta (`comConta`): o model é escopado, e a trava preenche o
   * `contaId` do upsert. A existência da conta é conferida antes — senão um id
   * errado na URL criaria configuração pra conta que não existe.
   */
  async lerIaConfig(contaId: string) {
    await this.exigirConta(contaId);
    return comConta(contaId, async () => {
      const cfg = await this.prisma.configuracaoIa.upsert({
        where: { contaId },
        update: {},
        create: {},
      });
      return { ...cfg, historicoSugestoes: await this.historicoSugestoesIa() };
    });
  }

  async definirIaConfig(contaId: string, input: AtualizarIaConfigInput, usuarioId: string) {
    await this.exigirConta(contaId);
    // Os caches de modelo (IaService e o worker da conferência) são por conta e
    // duram 30s: a troca vale nas próximas chamadas sem precisar invalidar.
    return comConta(contaId, () =>
      this.prisma.configuracaoIa.upsert({
        where: { contaId },
        update: { ...input, alteradoPorId: usuarioId },
        create: { ...input, alteradoPorId: usuarioId },
      }),
    );
  }

  /**
   * Últimas N sugestões da IA no fechamento, só a `confidence` — alimenta o
   * simulador do limiar na tela. Nada da viagem sai daqui.
   */
  private async historicoSugestoesIa(): Promise<number[]> {
    const linhas = await this.prisma.fechamentoLinha.findMany({
      where: { sugestaoIa: { not: null as unknown as undefined } },
      select: { sugestaoIa: true },
      orderBy: { id: "desc" },
      take: 100,
    });
    const out: number[] = [];
    for (const l of linhas) {
      const s = l.sugestaoIa as { confidence?: number } | null;
      if (s && typeof s.confidence === "number" && Number.isFinite(s.confidence)) {
        out.push(s.confidence);
      }
    }
    return out;
  }

  private async exigirConta(contaId: string): Promise<void> {
    const conta = await comoSistema(() =>
      this.prisma.conta.findUnique({ where: { id: contaId }, select: { id: true } }),
    );
    if (!conta) throw new NotFoundException("Empresa não encontrada.");
  }

  /**
   * Os interruptores da casa: porta de auto-cadastro, dias de teste e o SDR.
   *
   * Os valores abaixo repetem os `@default` do schema só pra tela ter o que
   * mostrar antes de a linha existir. Quem manda é sempre o banco — assim que
   * a linha é criada, nenhum número daqui é consultado de novo.
   */
  async lerConfiguracao() {
    const cfg = await comoSistema(() =>
      this.prisma.configuracaoPlataforma.findUnique({ where: { id: "singleton" } }),
    );
    return {
      autoCadastroAberto: cfg?.autoCadastroAberto ?? false,
      diasTesteGratis: cfg?.diasTesteGratis ?? 14,
      maxCodigosPorHora: cfg?.maxCodigosPorHora ?? 30,
      sdrAtivo: cfg?.sdrAtivo ?? false,
      sdrProvider: cfg?.sdrProvider ?? "anthropic",
      sdrModeloAnthropic: cfg?.sdrModeloAnthropic ?? "claude-sonnet-4-6",
      sdrModeloGemini: cfg?.sdrModeloGemini ?? "gemini-2.5-flash",
      sdrModeloMinimax: cfg?.sdrModeloMinimax ?? "MiniMax-M3",
      sdrLinkCadastro: cfg?.sdrLinkCadastro ?? "https://app.movatruck.com.br/cadastro",
      // A IA escolhida tem chave no ambiente?
      //
      // Sem isso, ligar o SDR com o provider errado dá uma falha MUDA: ele não
      // responde, a conversa cai na fila humana e a tela segue dizendo
      // "ligado". A tela precisa poder avisar antes de alguém ir caçar bug no
      // WhatsApp. Só o SIM/NÃO sai daqui — chave nunca atravessa a fronteira.
      sdrProviderTemChave: this.temChaveDeIa(cfg?.sdrProvider ?? "anthropic", cfg),
      // QUAL chave está rodando — não a chave.
      //
      // "Tem chave: sim" não responde o que quem paga a conta pergunta: de qual
      // conta é a chave que está gastando ali, se é a mesma que eu troquei
      // semana passada. Prefixo e quatro dígitos finais dão pra conferir contra
      // o painel do provedor e não dão pra assinar uma chamada. O valor segue
      // só no ambiente.
      sdrChaveApelido: identificarChave(this.chaveDeIa(cfg?.sdrProvider ?? "anthropic", cfg)),
      // O nome da variável, pra quem for configurar saber onde mexer sem
      // precisar abrir o código.
      sdrChaveVariavel: nomeDaChave(cfg?.sdrProvider ?? "anthropic"),
      /**
       * A situação de CADA IA, pra tela poder dizer o que está pronto antes de
       * alguém trocar e descobrir no WhatsApp que não estava.
       *
       * O que sai daqui é apelido e procedência — o valor da chave não
       * atravessa este endpoint em nenhuma hipótese.
       */
      sdrChaves: Object.fromEntries(
        (["anthropic", "gemini", "minimax"] as const).map((nome) => {
          const daTela = chaveDaTela(nome, cfg, segredoDeCripto(this.config));
          const chave = daTela || this.config.get<string>(nomeDaChave(nome))?.trim() || "";
          return [
            nome,
            {
              apelido: identificarChave(chave),
              origem: chave ? (daTela ? "tela" : "servidor") : null,
              variavel: nomeDaChave(nome),
            },
          ];
        }),
      ),
    };
  }

  /** A chave em uso: a da tela quando existe, senão a do ambiente. */
  private chaveDeIa(provider: string, cfg: ChavesGravadas): string | undefined {
    return (
      chaveDaTela(provider, cfg, segredoDeCripto(this.config)) ||
      this.config.get<string>(nomeDaChave(provider))
    );
  }

  private temChaveDeIa(provider: string, cfg: ChavesGravadas): boolean {
    return Boolean(this.chaveDeIa(provider, cfg)?.trim());
  }

  /**
   * Abre ou fecha a porta pública, define quanto dura o teste e liga o SDR.
   *
   * Mora aqui, e não em variável de ambiente, porque fechar o cadastro num dia
   * ruim ou esticar o teste de 14 pra 30 dias são decisões comerciais — e
   * decisão comercial que exige deploy é decisão que não se toma.
   */
  async definirConfiguracao(input: ConfiguracaoPlataformaInput) {
    // Só o que veio no corpo é escrito: a tela mexe num campo por vez, e
    // montar o update com os ausentes gravaria o default por cima do que
    // alguém já tinha configurado.
    // `null` entra no tipo porque apagar uma chave é gravar null — o
    // `Object.fromEntries` sozinho inferiria só os tipos que vieram do corpo.
    const mudancas: Record<string, string | number | boolean | null> = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    );

    // As chaves de IA nunca entram no banco como vieram.
    //
    // String vazia é o pedido de APAGAR — vira `null` e o servidor volta a usar
    // a variável de ambiente. Qualquer outro valor é cifrado aqui, no único
    // ponto por onde ele entra.
    const segredo = segredoDeCripto(this.config);
    for (const campo of ["sdrChaveAnthropic", "sdrChaveGemini", "sdrChaveMinimax"] as const) {
      if (!(campo in mudancas)) continue;
      const valor = String(mudancas[campo] ?? "").trim();
      mudancas[campo] = valor ? cifrar(valor, segredo) : null;
    }

    const cfg = await comoSistema(() =>
      this.prisma.configuracaoPlataforma.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...mudancas },
        update: mudancas,
      }),
    );
    this.log.log(
      `Auto-cadastro ${cfg.autoCadastroAberto ? "ABERTO" : "fechado"}, ` +
        `teste de ${cfg.diasTesteGratis} dias, SDR ${cfg.sdrAtivo ? "LIGADO" : "desligado"}.`,
    );
    return this.lerConfiguracao();
  }

  /**
   * Apaga o conteúdo de uma empresa — todas as tabelas que têm dono.
   *
   * A lista sai do próprio schema, e não escrita à mão, porque à mão ela
   * envelhece: a primeira versão listava as tabelas "de uma conta nova" e
   * bastou cadastrar um motorista pra travar, porque a ação gerou uma linha de
   * auditoria que a lista não previa. Tabela nova no schema entra aqui sozinha.
   *
   * A ordem vem por tentativa e erro em vez de topologia: apaga o que dá,
   * repete com o que sobrou, e para quando uma passada inteira não apaga nada.
   * Duas ou três passadas resolvem qualquer encadeamento de chave estrangeira,
   * e o que não resolver o `conta.delete` denuncia logo em seguida.
   */
  private async limparConteudo(contaId: string): Promise<void> {
    let restantes = MODELS_COM_CONTA;

    for (let passada = 0; passada < 5 && restantes.length > 0; passada++) {
      const sobraram: string[] = [];
      for (const model of restantes) {
        const delegate = (this.prisma as unknown as Record<string, DelegateComDelete>)[model];
        if (!delegate?.deleteMany) continue;
        try {
          // `contaId` explícito no where: isto roda em `comoSistema`, onde a
          // trava não injeta filtro nenhum.
          await delegate.deleteMany({ where: { contaId } });
        } catch {
          sobraram.push(model); // depende de outra tabela; tenta na próxima volta
        }
      }
      if (sobraram.length === restantes.length) break;
      restantes = sobraram;
    }
  }

  /**
   * Apaga uma empresa de teste — de vez, com os dados dela.
   *
   * Existe porque testar o cadastro público sujava a base pra sempre: não havia
   * como remover empresa nenhuma, e o e-mail, o CNPJ e o identificador usados
   * ficavam presos.
   *
   * Duas travas fazem disto uma ferramenta de limpeza e não um botão de destruir
   * cliente: a casa nunca é apagada, e empresa que já LANÇOU VIAGEM também não.
   * Viagem é histórico de operação real — cadastro se refaz, viagem não. Quem
   * quiser tirar do ar uma empresa que já rodou usa suspender, que é reversível.
   */
  async excluir(contaId: string) {
    const conta = await comoSistema(() =>
      this.prisma.conta.findUnique({
        where: { id: contaId },
        select: { id: true, nome: true, ehPlataforma: true },
      }),
    );
    if (!conta) throw new BadRequestException("Empresa não encontrada.");
    if (conta.ehPlataforma) {
      throw new BadRequestException("A empresa da plataforma não pode ser excluída.");
    }

    const viagens = await comConta(contaId, () => this.prisma.viagem.count());
    if (viagens > 0) {
      throw new BadRequestException(
        `${conta.nome} já tem ${viagens} viagem(ns) lançada(s) e não pode ser excluída. ` +
          "Use Suspender, que tira o acesso sem apagar o histórico.",
      );
    }

    try {
      await comoSistema(async () => {
        await this.limparConteudo(contaId);
        await this.prisma.conta.delete({ where: { id: contaId } });
      });
    } catch (erro) {
      // FK de alguma tabela que a lista não cobre: a empresa tem dado que este
      // caminho não sabe apagar, e apagar pela metade seria pior.
      this.log.warn(`Exclusão de ${conta.nome} barrada: ${(erro as Error).message}`);
      throw new BadRequestException(
        `${conta.nome} tem dados que não dá pra apagar por aqui. Use Suspender. ` +
          "(Se isto se repetir, o log do servidor diz qual tabela travou.)",
      );
    }

    this.log.warn(`Empresa EXCLUÍDA: ${conta.nome} (${contaId}).`);
    return { id: contaId, nome: conta.nome };
  }

  /**
   * O teto de uma empresa: o que o administrador dela pode conceder aos papéis
   * que criar.
   *
   * Lista vazia devolve ao padrão do código (`PERMISSOES_ADMIN_EMPRESA`) — é o
   * "voltar ao normal", e não "tirar tudo". Quem interpreta isso é `tetoDaConta`.
   *
   * Apertar o teto tem efeito retroativo no boot seguinte: `podarAcimaDoTeto`
   * varre os papéis da empresa e remove o que passou a ser proibido. Isso é
   * proposital — teto que só vale pra papel novo não é teto.
   */
  async definirTeto(id: string, permissoes: string[], extras?: string[]) {
    const validas = new Set(TODAS_AS_CHAVES);
    const chaves = [...new Set(permissoes.filter((c) => validas.has(c)))];
    const extrasValidas =
      extras === undefined ? undefined : [...new Set(extras.filter((c) => validas.has(c)))];

    const conta = await comoSistema(() =>
      this.prisma.conta.update({
        where: { id },
        data: {
          permissoesPermitidas: chaves,
          ...(extrasValidas !== undefined ? { permissoesExtras: extrasValidas } : {}),
        },
        select: { id: true, nome: true, permissoesPermitidas: true, permissoesExtras: true },
      }),
    );

    // Aplica na hora, em vez de esperar o próximo boot: quem acabou de fechar
    // uma tela pra um cliente espera que ela feche agora.
    await comConta(id, () => this.permissoes.seedPapeisSistema());
    this.log.log(
      `Teto de "${conta.nome}": ${chaves.length > 0 ? `${chaves.length} chave(s)` : "padrão"}.`,
    );
    return conta;
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

/** Onde a chave de cada provider mora no ambiente. */
function nomeDaChave(provider: string): string {
  if (provider === "gemini") return "GEMINI_API_KEY";
  if (provider === "minimax") return "MINIMAX_API_KEY";
  return "ANTHROPIC_API_KEY";
}

/** Só as colunas de chave — o que estas funções precisam enxergar da linha. */
type ChavesGravadas = {
  sdrChaveAnthropic?: string | null;
  sdrChaveGemini?: string | null;
  sdrChaveMinimax?: string | null;
} | null | undefined;

/**
 * A chave digitada na tela, já decifrada — ou "" quando ninguém digitou.
 *
 * Decifra que falha vira "": o efeito é o servidor voltar a usar a env, que é
 * degradar pro estado anterior em vez de deixar o SDR mudo com uma chave
 * ilegível.
 */
function chaveDaTela(provider: string, cfg: ChavesGravadas, segredo: string): string {
  const bruto =
    provider === "gemini"
      ? cfg?.sdrChaveGemini
      : provider === "minimax"
        ? cfg?.sdrChaveMinimax
        : cfg?.sdrChaveAnthropic;
  return decifrar(bruto, segredo) ?? "";
}
