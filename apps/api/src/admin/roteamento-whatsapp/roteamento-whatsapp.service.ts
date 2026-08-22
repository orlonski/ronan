import { Injectable } from "@nestjs/common";
import {
  CHAVES_ROTA_WHATSAPP,
  provedorAtendeRota,
  ROTAS_DA_PLATAFORMA,
  ROTAS_WHATSAPP,
  TEMPLATES_WHATSAPP,
  templateWhatsapp,
  type AtualizarRoteamentoWhatsappInput,
  type ProvedorWhatsapp,
} from "@ronan/shared-types";
import { comoSistema, contaIdAtual } from "../../common/conta/conta-context";
import { inicioDoDiaData } from "../../common/timezone";
import { PrismaService } from "../../prisma/prisma.service";
import { MetaProvedor } from "../../whatsapp/envio/meta.provedor";

/** Mesmo padrão que o roteador aplica — a tela não pode discordar dele. */
const PADRAO: ProvedorWhatsapp = "meta";
import { RoteamentoWhatsappService as Roteador } from "../../whatsapp/envio/roteamento.service";

@Injectable()
export class AdminRoteamentoWhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roteador: Roteador,
    private readonly meta: MetaProvedor,
  ) {}

  /**
   * O payload que CADA rota mandaria pra Meta, montado com os exemplos do
   * catálogo e sem sair do servidor.
   *
   * Existe por causa da assimetria mais cara desta migração: um template
   * recém-aprovado só é exercitado de verdade quando o cron das 20h roda, ou
   * quando um motorista pede um código. Descobrir ali que a contagem de
   * parâmetros não bate é descobrir tarde e no cliente.
   *
   * Pega tudo que é erro de montagem. NÃO pega o que só a Meta sabe: se o
   * template existe lá com aquele nome e naquele idioma.
   */
  async payloads(telefone: string) {
    const rotas = [];
    for (const r of ROTAS_WHATSAPP) {
      const t = templateWhatsapp(r.chave);
      const { provedor, motivo } = await this.roteador.resolver({
        rota: r.chave,
        destinoEhGrupo: r.chave === "AVISO_GRUPO",
        telefone,
      });

      rotas.push({
        chave: r.chave,
        rotulo: r.rotulo,
        provedor,
        motivo,
        template: t ? { nome: t.nome, idioma: t.idioma } : null,
        // Só faz sentido simular o que iria pela Meta: o Evolution manda o
        // texto cru, e não existe montagem que possa dar errado nele.
        simulacao:
          provedor === "meta"
            ? this.meta.simular({
                destino: { tipo: "TELEFONE", numero: telefone },
                rota: r.chave,
                texto: `[simulação] ${r.rotulo}`,
                params: t ? [...t.exemplo] : undefined,
              })
            : null,
      });
    }
    return { telefone, metaConfigurada: this.meta.configurado(), rotas };
  }

  /**
   * O que a tela mostra: o catálogo inteiro com o provedor de cada rota, pra o
   * painel não precisar saber qual é o padrão do código.
   */
  async pegar() {
    const cfg = await this.prisma.configuracaoRoteamentoWhatsapp.upsert({
      where: { contaId: contaIdAtual() },
      create: {},
      update: {},
    });
    const escolhas = (cfg.rotas as Record<string, ProvedorWhatsapp> | null) ?? {};
    const daPlataforma = await this.rotasDaPlataforma();

    return {
      telefonesTeste: cfg.telefonesTeste,
      alteradoEm: cfg.alteradoEm,
      /**
       * Se o servidor tem credencial da Meta AGORA.
       *
       * A tela precisa disso pra não mentir. Apontar uma rota pra Meta com o
       * servidor sem token não desvia a mensagem — ela simplesmente não sai, e
       * quem configurou merece ver isso na hora, não descobrir pelo motorista
       * que não recebeu o código.
       */
      metaConfigurada: this.meta.configurado(),
      rotas: ROTAS_WHATSAPP.map((r) => ({
        chave: r.chave,
        rotulo: r.rotulo,
        descricao: r.descricao,
        categoria: r.categoria,
        critica: r.critica,
        /** Provedores que esta rota aceita — o painel desabilita o resto. */
        provedores: r.provedores,
        /**
         * De quem é a decisão. Rota de plataforma vale pra todas as empresas —
         * a tela precisa disso pra não oferecer um seletor que não manda em
         * nada. Ver o comentário de `escopo` no catálogo.
         */
        escopo: r.escopo,
        /** O que está valendo. */
        provedor:
          r.escopo === "plataforma"
            ? (daPlataforma[r.chave] ?? PADRAO)
            : (escolhas[r.chave] ?? PADRAO),
        /** Se veio de escolha explícita ou do padrão do código. */
        explicito:
          r.escopo === "plataforma" ? !!daPlataforma[r.chave] : !!escolhas[r.chave],
      })),
    };
  }

  async salvar(input: AtualizarRoteamentoWhatsappInput, userId: string) {
    const atual = await this.prisma.configuracaoRoteamentoWhatsapp.upsert({
      where: { contaId: contaIdAtual() },
      create: {},
      update: {},
    });

    const data: { rotas?: Record<string, ProvedorWhatsapp>; telefonesTeste?: string[] } = {};

    if (input.rotas) {
      const anterior = (atual.rotas as Record<string, ProvedorWhatsapp> | null) ?? {};
      const merged = { ...anterior, ...input.rotas };
      // Só entra chave que existe no catálogo e provedor que a rota aceita —
      // senão dava pra gravar "aviso de grupo pela Meta" por API, que a Cloud
      // API não consegue entregar.
      data.rotas = Object.fromEntries(
        Object.entries(merged).filter(
          ([chave, prov]) =>
            (CHAVES_ROTA_WHATSAPP as string[]).includes(chave) && provedorAtendeRota(chave, prov),
        ),
      ) as Record<string, ProvedorWhatsapp>;
    }
    if (input.telefonesTeste) data.telefonesTeste = input.telefonesTeste;

    const salvo = await this.prisma.configuracaoRoteamentoWhatsapp.update({
      where: { contaId: contaIdAtual() },
      data: { ...data, alteradoPorId: userId },
    });
    // Sem isto a mudança só valeria depois do cache de 30s — e quem acabou de
    // virar uma rota vai testar na hora.
    this.roteador.invalidar(contaIdAtual());
    return { ...(await this.pegar()), alteradoEm: salvo.alteradoEm };
  }

  /**
   * Quanto esta empresa mandou (e custou) por tipo de mensagem, nos últimos N
   * dias.
   *
   * Só olha SAIDA: o inbound é do motorista e não custa. O custo é a ESTIMATIVA
   * congelada no envio — a conta que vale é a da Meta, e enquanto tudo sai pelo
   * Evolution ela é zero de propósito.
   */
  private async rotasDaPlataforma(): Promise<Record<string, ProvedorWhatsapp>> {
    const linha = await comoSistema(() =>
      this.prisma.configuracaoRoteamentoPlataforma.upsert({
        where: { id: "singleton" },
        create: {},
        update: {},
      }),
    );
    return (linha.rotas as Record<string, ProvedorWhatsapp> | null) ?? {};
  }

  /**
   * Troca o provedor de uma rota de plataforma. Vale pra todas as empresas de
   * uma vez — que é o ponto: são as mensagens sobre a pessoa, e a pessoa pode
   * estar em várias transportadoras com uma senha só.
   */
  async salvarPlataforma(rotas: Record<string, ProvedorWhatsapp>, userId: string) {
    const limpas = Object.fromEntries(
      Object.entries(rotas).filter(
        ([chave, prov]) =>
          (ROTAS_DA_PLATAFORMA as string[]).includes(chave) && provedorAtendeRota(chave, prov),
      ),
    );
    const anterior = await this.rotasDaPlataforma();
    await comoSistema(() =>
      this.prisma.configuracaoRoteamentoPlataforma.update({
        where: { id: "singleton" },
        data: { rotas: { ...anterior, ...limpas }, alteradoPorId: userId },
      }),
    );
    // Vale pra todas as contas, então o cache de todas precisa cair.
    this.roteador.invalidarPlataforma();
    return this.pegar();
  }

  /**
   * O que a Meta tem cadastrado, confrontado com o que o código espera.
   *
   * A comparação é o ponto: nome igual com idioma diferente é justamente o que
   * produz 132001, e é invisível olhando as duas listas separadas.
   */
  async templatesMeta(wabaId: string) {
    const r = (await this.meta.listarTemplates(wabaId)) as {
      ok?: boolean;
      resposta?: { data?: { name: string; language: string; status: string }[] };
    };
    const naMeta = r.resposta?.data ?? [];
    const esperados = Object.entries(TEMPLATES_WHATSAPP).map(([rota, def]) => {
      const achado = naMeta.find((t) => t.name === def!.nome);
      return {
        rota,
        esperado: `${def!.nome} / ${def!.idioma}`,
        naMeta: achado ? `${achado.name} / ${achado.language} (${achado.status})` : "NÃO EXISTE",
        bate: !!achado && achado.language === def!.idioma && achado.status === "APPROVED",
      };
    });
    return { bruto: r, esperados };
  }

  /** O que a Meta diz sobre o número configurado no servidor. */
  statusNumero() {
    return this.meta.statusNumero();
  }

  /**
   * Registra o número na Cloud API.
   *
   * Sem conta no contexto e sem gravar nada: é operação sobre o número da
   * plataforma, não sobre dados de empresa. O PIN só atravessa este método.
   */
  registrarNumero(pin: string) {
    return this.meta.registrarNumero(pin);
  }

  /**
   * Os últimos envios que NÃO saíram, com o motivo cru do provedor.
   *
   * A fachada já gravava tudo isso em `whatsapp_mensagens` desde agosto, e nada
   * lia. O resultado era ter a resposta exata da Meta no banco e mesmo assim
   * depender de log de container pra descobrir por que um código não chegou —
   * ou pior, adivinhar.
   *
   * O telefone sai mascarado: quem depura roteamento precisa saber que houve
   * falha e qual foi, não o número de quem não recebeu.
   */
  async falhas(limite = 20) {
    const linhas = await this.prisma.whatsappMensagem.findMany({
      where: {
        direcao: "SAIDA",
        // Sem id do provedor = não houve aceite. É o mesmo critério que a
        // fachada usa pra decidir se lança 503.
        idExterno: null,
      },
      orderBy: { criadoEm: "desc" },
      take: Math.min(Math.max(limite, 1), 100),
      select: {
        criadoEm: true,
        rota: true,
        provedor: true,
        telefone: true,
        statusEntrega: true,
        erroCodigo: true,
        metadata: true,
      },
    });

    return linhas.map((l) => ({
      criadoEm: l.criadoEm,
      rota: l.rota,
      provedor: l.provedor,
      telefone: mascarar(l.telefone),
      statusEntrega: l.statusEntrega,
      erroCodigo: l.erroCodigo,
      erro: (l.metadata as { erro?: string } | null)?.erro ?? null,
    }));
  }

  async consumo(dias = 30) {
    const desde = new Date(inicioDoDiaData().getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
    const linhas = await this.prisma.whatsappMensagem.groupBy({
      by: ["rota", "provedor"],
      where: { direcao: "SAIDA", criadoEm: { gte: desde } },
      _count: { _all: true },
      _sum: { custoEstimado: true },
    });

    const porRota = linhas.map((l) => ({
      rota: l.rota,
      provedor: l.provedor,
      mensagens: l._count._all,
      custoEstimado: Number(l._sum.custoEstimado ?? 0),
    }));

    return {
      dias,
      desde,
      total: porRota.reduce((a, l) => a + l.mensagens, 0),
      custoEstimado: porRota.reduce((a, l) => a + l.custoEstimado, 0),
      porRota: porRota.sort((a, b) => b.mensagens - a.mensagens),
    };
  }
}

/** 5544998887766 → 55 44 9****-7766. Nunca o número inteiro num diagnóstico. */
function mascarar(t: string): string {
  const d = t.replace(/\D/g, "");
  if (d.length < 8) return "***";
  return `${d.slice(0, 4)} ${d.slice(4, 5)}****-${d.slice(-4)}`;
}
