import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { paginate } from "../common/pagination/paginate.helper";
import { SEM_ESCOPO } from "../common/escopo/escopo";
import type { ListLeadsParams } from "./prospeccao.schema";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { sufixoTelefone } from "../sdr/lead-inbound";
import { LeadChatwootService } from "./lead-chatwoot.service";
import { conversasDosLeads, type LeadParaConversa } from "./conversa-lead";
import type { PrazosFollowup } from "../sdr/followup.regua";

/**
 * Leitura e manutenção da base de captação.
 *
 * Tudo em `comoSistema`: Lead, InteracaoLead e SupressaoContato são da
 * plataforma e não têm `contaId`.
 */
@Injectable()
export class ProspeccaoService {
  private readonly log = new Logger("Prospeccao");

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatwoot: LeadChatwootService,
  ) {}

  async resumo() {
    return comoSistema(async () => {
      const [total, porStatus, porUf, comTelefone, comEmail, suprimidos] = await Promise.all([
        this.prisma.lead.count(),
        this.prisma.lead.groupBy({ by: ["status"], _count: true }),
        this.prisma.lead.groupBy({
          by: ["uf"],
          _count: true,
          orderBy: { _count: { uf: "desc" } },
          take: 10,
        }),
        this.prisma.lead.count({ where: { telefone: { not: null } } }),
        this.prisma.lead.count({ where: { email: { not: null } } }),
        this.prisma.supressaoContato.count(),
      ]);

      return {
        total,
        // O que falta pra base virar acionável: lead sem contato não dá pra abordar.
        comTelefone,
        comEmail,
        semContatoNenhum: total - (await this.contarComContato()),
        porStatus: porStatus.map((s) => ({ status: s.status, total: s._count })),
        porUf: porUf.map((u) => ({ uf: u.uf ?? "—", total: u._count })),
        suprimidos,
      };
    });
  }

  /** Quantos dá pra trabalhar hoje: tem telefone OU e-mail. */
  private async contarComContato(): Promise<number> {
    return this.prisma.lead.count({
      where: { OR: [{ telefone: { not: null } }, { email: { not: null } }] },
    });
  }

  /**
   * Listagem de trabalho. Usa o `paginate` padrão do projeto, então a tela
   * ganha ordenação, busca e paginação com o mesmo contrato de todas as
   * outras — nada de formato próprio só pra esta tela.
   */
  async listar(params: ListLeadsParams) {
    const where: Prisma.LeadWhereInput = {
      // Quem pediu pra sair nunca aparece numa lista de trabalho. O filtro mora
      // aqui, no ponto único de leitura, e não na tela — tela se esquece.
      optOut: false,
    };

    if (params.uf) where.uf = params.uf.toUpperCase();
    if (params.municipio) where.municipio = { contains: params.municipio, mode: "insensitive" };
    if (params.status) where.status = params.status;
    if (params.origem) where.origem = params.origem;
    if (typeof params.scoreMinimo === "number") where.score = { gte: params.scoreMinimo };

    if (params.comContato === true) {
      where.OR = [{ telefone: { not: null } }, { email: { not: null } }];
    }
    if (params.comContato === false) {
      where.AND = [{ telefone: null }, { email: null }];
    }

    return comoSistema(async () => {
      const pagina = await paginate<Record<string, unknown>, ListLeadsParams>(this.prisma.lead, {
        params,
        where: where as Record<string, unknown>,
        // Lead é da plataforma e não tem coluna de frota: não há recorte por
        // transportadora a fazer. Quem não pode ver a tela não tem a chave.
        escopo: SEM_ESCOPO,
        searchFields: ["empresa", "nomeFantasia", "municipio", "cnpj", "socio"],
        sortable: {
          score: "score",
          empresa: "empresa",
          municipio: "municipio",
          registradoEm: "registradoEm",
          criadoEm: "criadoEm",
        },
        defaultSort: { field: "score", order: "desc" },
        include: { _count: { select: { interacoes: true } } },
      });

      // O estado da conversa entra DEPOIS da paginação, e de uma vez só pra
      // página inteira: é o que permite a tela mostrar quem está parado sem
      // uma consulta por linha.
      const linhas = (pagina as { data?: unknown[] }).data ?? [];
      const conversas = await conversasDosLeads(
        this.prisma,
        linhas as LeadParaConversa[],
        await this.prazosDoFollowup(),
      );
      for (const linha of linhas as { id: string; conversa?: unknown }[]) {
        linha.conversa = conversas.get(linha.id) ?? null;
      }
      return pagina;
    });
  }

  /**
   * Os prazos que classificam uma conversa como parada.
   *
   * Lidos da mesma linha que o varredor vai usar — se a tela tivesse os
   * próprios números, ela chamaria de "parada" algo que o robô ainda considera
   * cedo, e ninguém entenderia por que o follow-up não saiu.
   */
  private async prazosDoFollowup(): Promise<PrazosFollowup> {
    const cfg = await this.prisma.configuracaoPlataforma.findUnique({
      where: { id: "singleton" },
      select: {
        sdrFollowupHoras: true,
        sdrFollowupMax: true,
        sdrFollowupIntervaloHoras: true,
        sdrEncerrarAposHoras: true,
        sdrFollowupHoraInicio: true,
        sdrFollowupHoraFim: true,
      },
    });
    return {
      followupHoras: cfg?.sdrFollowupHoras ?? 4,
      followupMax: cfg?.sdrFollowupMax ?? 2,
      followupIntervaloHoras: cfg?.sdrFollowupIntervaloHoras ?? 18,
      encerrarAposHoras: cfg?.sdrEncerrarAposHoras ?? 48,
      horaInicio: cfg?.sdrFollowupHoraInicio ?? 9,
      horaFim: cfg?.sdrFollowupHoraFim ?? 19,
    };
  }

  /**
   * Apaga um lead de vez — com a conversa inteira junto.
   *
   * Existe pro lixo que toda base acumula: o lead criado pra testar o fluxo, o
   * número digitado errado. Marcar esse tipo de coisa como `PERDEU` seria
   * mentir na métrica — "perdemos" conta decisão comercial, e teste não é
   * decisão nenhuma. Some da contagem de leads, do funil e da conta do
   * follow-up, porque nunca deveria ter entrado.
   *
   * `InteracaoLead` e `MensagemLead` têm `onDelete: Cascade` no schema, então
   * a transcrição vai junto. Isso é destrutivo e não tem desfazer: quem chama
   * é uma tela que pergunta antes, com o nome da empresa na frente.
   *
   * A supressão NÃO é tocada: quem pediu pra não ser contatado continua
   * suprimido mesmo que o lead suma, senão a próxima carga do RNTRC o traria
   * de volta e voltaríamos a escrever pra quem pediu silêncio.
   */
  async excluir(id: string) {
    return comoSistema(async () => {
      const lead = await this.prisma.lead.findUnique({
        where: { id },
        select: { id: true, empresa: true },
      });
      if (!lead) throw new NotFoundException("Lead não encontrado");
      await this.prisma.lead.delete({ where: { id } });
      this.log.log(`Lead ${lead.empresa} (${id}) excluído junto com a conversa.`);
      return { ok: true, empresa: lead.empresa };
    });
  }

  /**
   * Normaliza telefone pra dígitos e e-mail pra minúsculas — sem isso o mesmo
   * contato entra duas vezes e a supressão falha justamente quando importa.
   */
  static normalizarContato(bruto: string): { contato: string; tipo: "TELEFONE" | "EMAIL" } {
    const limpo = bruto.trim();
    if (limpo.includes("@")) {
      return { contato: limpo.toLowerCase(), tipo: "EMAIL" };
    }
    return { contato: limpo.replace(/\D/g, ""), tipo: "TELEFONE" };
  }

  /**
   * Supressão global: vale pra todos os canais e sobrevive à próxima carga do
   * RNTRC. Marca também os leads que já têm esse contato.
   */
  async registrarOptOut(bruto: string, motivo?: string, fonte?: string) {
    if (!bruto?.trim()) throw new BadRequestException("Informe o telefone ou e-mail");

    const { contato, tipo } = ProspeccaoService.normalizarContato(bruto);
    if (!contato) throw new BadRequestException("Contato inválido");

    return comoSistema(async () => {
      await this.prisma.supressaoContato.upsert({
        where: { contato },
        create: { contato, tipo, motivo, fonte },
        update: { motivo, fonte },
      });

      // Telefone casa pelos últimos 8 dígitos, não por igualdade: o MESMO
      // número está na base como "4399912345" (Receita, sem o nono dígito) e
      // chega do WhatsApp como "554399912345". Com `equals`, quem pedia pra
      // sair marcava ZERO leads e seguia na lista — o pior jeito de falhar.
      const { count } = await this.prisma.lead.updateMany({
        where:
          tipo === "EMAIL"
            ? { email: contato }
            : { telefone: { endsWith: sufixoTelefone(contato) } },
        data: { optOut: true, optOutEm: new Date() },
      });

      this.log.log(`Opt-out registrado (${tipo}) — ${count} lead(s) marcado(s)`);
      return { contato, tipo, leadsMarcados: count };
    });
  }

  /**
   * Ficha completa, com o histórico de toques.
   *
   * O `chatwootUrl` sai montado daqui e não dos ids crus: a URL do Chatwoot é
   * env da API, e mandar os três números pro painel remontar criaria um
   * segundo lugar pra desatualizar.
   */
  async detalhe(id: string) {
    const lead = await comoSistema(async () =>
      this.prisma.lead.findUnique({
        where: { id },
        include: { interacoes: { orderBy: { criadoEm: "desc" }, take: 50 } },
      }),
    );
    if (!lead) return null;
    return { ...lead, chatwootUrl: this.chatwoot.linkDaConversa(lead) };
  }

  /**
   * Registra um toque.
   *
   * Desfecho `PEDIU_OPT_OUT` dispara a supressão sozinho: quem anota "pediu pra
   * não ligar mais" está pedindo o opt-out, e depender de a pessoa lembrar de
   * clicar num segundo botão é como esse tipo de pedido se perde.
   */
  async registrarInteracao(
    leadId: string,
    dados: { canal: string; desfecho: string; resumo?: string },
    autor?: string,
  ) {
    return comoSistema(async () => {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, telefone: true, email: true },
      });
      if (!lead) throw new NotFoundException("Lead não encontrado");

      const interacao = await this.prisma.interacaoLead.create({
        data: { leadId, canal: dados.canal, desfecho: dados.desfecho, resumo: dados.resumo, autor },
      });

      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          ultimoContato: new Date(),
          ...(dados.desfecho === "RESPONDEU" ? { status: "EM_CONTATO" } : {}),
        },
      });

      if (dados.desfecho === "PEDIU_OPT_OUT") {
        const contato = lead.telefone ?? lead.email;
        if (contato) {
          await this.registrarOptOut(contato, dados.resumo ?? "pediu no contato", dados.canal);
        } else {
          // Sem contato conhecido não há o que suprimir globalmente, mas o lead
          // some da lista do mesmo jeito.
          await this.prisma.lead.update({
            where: { id: leadId },
            data: { optOut: true, optOutEm: new Date() },
          });
        }
      }

      // O atendimento precisa saber, e precisa saber ANTES de responder: um
      // "pediu pra não contatar" registrado aqui tem que aparecer na tela de
      // quem tem o dedo no gatilho de mandar mensagem.
      void this.chatwoot.sincronizar(leadId);

      return interacao;
    });
  }

  async atualizar(id: string, dados: Record<string, unknown>) {
    const lead = await comoSistema(async () =>
      this.prisma.lead.update({ where: { id }, data: dados }),
    );
    // Sem `await`: a ficha do Chatwoot é enfeite pro atendente, e o painel não
    // pode ficar esperando um HTTP de fora pra confirmar que salvou.
    void this.chatwoot.sincronizar(id);
    return lead;
  }

  /**
   * Um contato está suprimido? Consulte ANTES de qualquer envio.
   *
   * Mesma régua do opt-out: telefone pelos últimos 8 dígitos. Procurar por
   * igualdade faria a supressão gravada com o nono dígito não valer pro mesmo
   * número guardado sem ele.
   */
  async estaSuprimido(bruto: string): Promise<boolean> {
    const { contato, tipo } = ProspeccaoService.normalizarContato(bruto);
    if (!contato) return false;
    const achado = await comoSistema(async () =>
      tipo === "EMAIL"
        ? this.prisma.supressaoContato.findUnique({ where: { contato } })
        : this.prisma.supressaoContato.findFirst({
            where: { contato: { endsWith: sufixoTelefone(contato) } },
          }),
    );
    return achado !== null;
  }
}
