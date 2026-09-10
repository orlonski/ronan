import { Injectable, Logger } from "@nestjs/common";
import type { CriarLeadInput, RegistrarEventoSiteInput } from "@ronan/shared-types";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";

/**
 * Captação de lead pelo site institucional.
 *
 * Tudo aqui roda em `comoSistema`: lead e evento são da plataforma, não de uma
 * empresa, e a requisição chega sem token nenhum — não há conta no contexto pra
 * trava usar. Ver `MODELS_GLOBAIS` em common/conta/trava-conta.ts.
 */
@Injectable()
export class CaptacaoService {
  private readonly log = new Logger("Captacao");

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: AdminInboxService,
  ) {}

  /**
   * Avisa a plataforma no sininho que alguém pediu contato.
   *
   * Sem isto o lead ficava esperando alguém abrir a tela de Captação e filtrar
   * por "novo" — quem preencheu o formulário de manhã podia só ser descoberto
   * dias depois. Um pedido de contato tem prazo de validade curto.
   *
   * Vai pra conta da CASA porque o lead é da plataforma, não de empresa
   * nenhuma. Best-effort: o site não pode falhar porque o aviso não saiu.
   */
  private avisarPlataforma(lead: {
    id: string;
    nome: string | null;
    empresa: string | null;
    municipio: string | null;
  }): void {
    void (async () => {
      const casa = await comoSistema(() =>
        this.prisma.conta.findFirst({ where: { ehPlataforma: true }, select: { id: true } }),
      );
      if (!casa) return;
      const onde = lead.municipio ? ` · ${lead.municipio}` : "";
      await comConta(casa.id, () =>
        this.inbox.disparar({
          tipo: "lead-novo",
          titulo: `Pedido de contato: ${lead.empresa ?? "sem empresa"}`,
          corpo: `${lead.nome ?? "sem nome"}${onde}`,
          dados: { leadId: lead.id },
        }),
      );
    })().catch((e: unknown) => this.log.warn(`Aviso de lead novo falhou: ${String(e)}`));
  }

  /**
   * Grava o pedido de contato.
   *
   * Nunca lança por duplicidade: a mesma pessoa mandando duas vezes é gente
   * ansiosa, não erro — e recusar o segundo envio faria o site parecer quebrado.
   * Deduplicar é trabalho de quem atende, não do formulário.
   */
  async registrarLead(input: CriarLeadInput, ip: string | null) {
    // `cidade` no formulário, `municipio` no banco: a tela fala a língua de quem
    // preenche, a coluna fala a língua do RNTRC, que é de onde vem o resto da base.
    const { website, cidade, ...dados } = input;

    // Isca de robô preenchida: descarta em silêncio. O controller responde 200
    // assim mesmo — dizer "recusado" ensina o robô qual campo evitar.
    if (website && website.trim().length > 0) {
      this.log.warn(`Honeypot preenchido, lead descartado (ip=${ip ?? "?"})`);
      return { descartado: true as const };
    }

    const lead = await comoSistema(async () =>
      this.prisma.lead.create({
        data: {
          ...dados,
          municipio: cidade,
          // Quem preencheu o formulário é o próprio titular. É a origem mais
          // forte que existe e a que dispensa qualquer discussão de base legal.
          origemDado: "Formulário do site — preenchido pelo próprio titular",
          coletadoEm: new Date(),
          ipCriacao: ip,
        },
        select: { id: true, nome: true, empresa: true, municipio: true },
      }),
    );

    this.log.log(
      `Lead novo: ${lead.empresa} (${lead.nome}${lead.municipio ? `, ${lead.municipio}` : ""}) id=${lead.id}`,
    );
    this.avisarPlataforma(lead);

    return { descartado: false as const, id: lead.id };
  }

  /**
   * Grava um evento de navegação.
   *
   * Falha em silêncio de propósito: analytics não pode derrubar a página de
   * ninguém. Se o banco estiver fora, perdemos a contagem — e só.
   */
  async registrarEvento(input: RegistrarEventoSiteInput) {
    try {
      await comoSistema(async () => this.prisma.eventoSite.create({ data: input }));
    } catch (erro) {
      this.log.warn(`Evento de site não gravado: ${(erro as Error).message}`);
    }
  }
}
