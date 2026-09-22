import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { comConta, comoSistema, contaIdAtual } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminInboxService } from "../inbox/inbox.service";

/**
 * Número comercial da Movatruck. Env primeiro para não exigir deploy quando o
 * número mudar; o literal é só o valor conhecido hoje, o mesmo que o site usa.
 */
const WHATSAPP_PADRAO = "5542991563750";

export type PassoParaTela = {
  id: string;
  /** `data-coach` do elemento. Nulo = balão centralizado, sem furo. */
  alvo: string | null;
  titulo: string;
  corpo: string;
};

export type TourParaTela = {
  chave: string;
  automatico: boolean;
  visto: boolean;
  passos: PassoParaTela[];
};

@Injectable()
export class OnboardingService {
  private readonly log = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: AdminInboxService,
    private readonly config: ConfigService,
  ) {}

  /**
   * O que ESTA pessoa já dispensou. Uma linha por usuário, criada só quando ele
   * interage — conta nova não nasce com uma linha por gente que nunca entrou.
   */
  async estado(usuarioId: string): Promise<{ chegadaDispensada: boolean; toursVistos: string[] }> {
    const linha = await this.prisma.onboardingUsuario.findUnique({
      where: { usuarioId },
      select: { chegadaDispensadaEm: true, toursVistos: true },
    });
    return {
      chegadaDispensada: linha?.chegadaDispensadaEm != null,
      toursVistos: linha?.toursVistos ?? [],
    };
  }

  /**
   * O tour que vale para esta rota, já podado e já sabendo se a pessoa viu.
   *
   * A rota casa por PREFIXO, com o mais específico primeiro — a mesma regra do
   * `permDaRota` do painel, onde "/ponto/competencia" tem que ganhar de
   * "/ponto". O "/" é caso à parte: prefixo de tudo, então só casa exato,
   * senão o tour da home abriria em cima de qualquer tela.
   */
  async tourDaRota(
    rota: string,
    usuario: { id: string; permissoes: string[]; plataforma: boolean },
  ): Promise<TourParaTela | null> {
    const [tours, estado] = await Promise.all([
      comoSistema(() =>
        this.prisma.tourPainel.findMany({
          where: { ativo: true },
          include: { passos: { orderBy: { ordem: "asc" } } },
        }),
      ),
      this.estado(usuario.id),
    ]);

    const candidatos = tours
      .filter((t) => (t.rota === "/" ? rota === "/" : rota.startsWith(t.rota)))
      .sort((a, b) => b.rota.length - a.rota.length);

    const tour = candidatos[0];
    if (!tour) return null;

    // Passo de um botão que a pessoa não tem não existe pra ela — mesma poda do
    // checklist. Operador da plataforma enxerga tudo: é ele quem revisa o texto.
    const permissoes = new Set(usuario.permissoes);
    const passos = tour.passos.filter(
      (p) => !p.permissao || usuario.plataforma || permissoes.has(p.permissao),
    );
    // Sobrou só o "bem-vindo" e o "é isso"? Dois balões centrais sem nada no
    // meio não ensinam onde fica nada: melhor não abrir.
    if (passos.filter((p) => p.alvo).length === 0) return null;

    return {
      chave: tour.chave,
      automatico: tour.automatico,
      visto: estado.toursVistos.includes(tour.chave),
      passos: passos.map((p) => ({
        id: p.id,
        alvo: p.alvo,
        titulo: p.titulo,
        corpo: p.corpo,
      })),
    };
  }

  /**
   * Marca o tour como visto. Idempotente, e guarda a CHAVE (com a versão
   * dentro): publicar "home.v2" volta a aparecer sem apagar histórico.
   */
  async marcarTourVisto(usuarioId: string, chave: string): Promise<void> {
    const atual = await this.prisma.onboardingUsuario.findUnique({
      where: { usuarioId },
      select: { toursVistos: true },
    });
    if (atual?.toursVistos.includes(chave)) return;

    await this.prisma.onboardingUsuario.upsert({
      where: { usuarioId },
      create: { usuarioId, toursVistos: [chave] },
      update: { toursVistos: { push: chave } },
    });
  }

  /** Faz o tour aparecer de novo pra esta pessoa — o "rever" do botão de ajuda. */
  async esquecerTour(usuarioId: string, chave: string): Promise<void> {
    const atual = await this.prisma.onboardingUsuario.findUnique({
      where: { usuarioId },
      select: { toursVistos: true },
    });
    if (!atual) return;
    await this.prisma.onboardingUsuario.update({
      where: { usuarioId },
      data: { toursVistos: atual.toursVistos.filter((c) => c !== chave) },
    });
  }

  /**
   * "Já entendi, tira isto da home."
   *
   * Só esconde a CHEGADA (o bloco grande de boas-vindas). O checklist continua
   * na home enquanto houver passo pendente, e segue inteiro em /comecar: quem
   * dispensou disse que sabe por onde ir, não que terminou.
   */
  async dispensarChegada(usuarioId: string): Promise<void> {
    await this.prisma.onboardingUsuario.upsert({
      where: { usuarioId },
      create: { usuarioId, chegadaDispensadaEm: new Date() },
      update: { chegadaDispensadaEm: new Date() },
    });
  }

  /**
   * "Quero continuar" — o caminho de volta de quem chegou ao fim do teste.
   *
   * Não abre checkout de propósito: com o ticket que a Movatruck cobra, quem
   * fecha é conversa, e tirar o vendedor do meio é perder dinheiro, não ganhar
   * tempo. O que este método faz é juntar as duas pontas — avisa a casa com o
   * que ela precisa pra ligar sabendo de tudo, e devolve ao cliente o WhatsApp
   * já com o recado escrito.
   *
   * O aviso vai pro sininho da CASA, nunca pro da empresa: `disparar()` faz
   * fan-out no contexto de conta corrente, então sem o `comConta` da plataforma
   * quem receberia "esta empresa quer assinar" seria a própria empresa.
   */
  async quereroContinuar(usuarioNome: string): Promise<{ whatsappUrl: string }> {
    const contaId = contaIdAtual();

    const [conta, viagens] = await Promise.all([
      comoSistema(() =>
        this.prisma.conta.findUnique({
          where: { id: contaId },
          select: { nome: true, trialExpiraEm: true, somenteLeitura: true },
        }),
      ),
      this.prisma.viagem.count(),
    ]);

    const nomeEmpresa = conta?.nome ?? "Empresa";

    // Best-effort: o cliente não pode ficar sem o link porque o sininho falhou.
    void this.avisarCasa(nomeEmpresa, usuarioNome, viagens).catch((e: unknown) =>
      this.log.warn(`Aviso de "quero continuar" falhou: ${String(e)}`),
    );

    const numero = (this.config.get<string>("PLATAFORMA_WHATSAPP") ?? WHATSAPP_PADRAO).replace(
      /\D/g,
      "",
    );
    const recado = encodeURIComponent(
      `Oi! Sou da ${nomeEmpresa} e quero continuar usando o Movatruck depois do teste.`,
    );
    return { whatsappUrl: `https://wa.me/${numero}?text=${recado}` };
  }

  private async avisarCasa(empresa: string, quem: string, viagens: number): Promise<void> {
    const casa = await comoSistema(() =>
      this.prisma.conta.findFirst({ where: { ehPlataforma: true }, select: { id: true } }),
    );
    if (!casa) return;

    await comConta(casa.id, () =>
      this.inbox.disparar({
        tipo: "onboarding-quer-continuar",
        titulo: `${empresa} quer continuar depois do teste`,
        // O número de viagens é o que diz se a conversa é "fechar" ou "resgatar":
        // quem já lançou centenas está comprando; quem tem zero precisa de ajuda
        // antes de precisar de boleto.
        corpo: `${quem} pediu contato · ${viagens} viagem(ns) lançada(s)`,
        permissao: "diagnosticos.ver",
      }),
    );
  }
}
