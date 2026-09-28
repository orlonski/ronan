import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { achatarParam } from "@ronan/shared-types";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { comLockDeCron } from "../common/cron-exclusivo";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { PrismaService } from "../prisma/prisma.service";
import { empresaConhecida } from "./lead-inbound";
import {
  deveEscalonar,
  mensagemDeRepasse,
  type HorarioAtendimento,
} from "./atendimento-humano.regua";

/** Quanto tempo um alerta sem resposta ainda merece escalonar. Depois disso é histórico. */
const JANELA_ESCALONAR_DIAS = 3;

/**
 * Quem avisa a equipe quando o robô entrega uma conversa.
 *
 * Antes daqui, "passar pra humano" era uma etiqueta no Chatwoot e nada mais.
 * Nas conversas de setembro/2026 o robô disse "alguém vai te chamar em breve"
 * a umas dez pessoas — uma delas pedindo demonstração cinco vezes — e ninguém
 * soube. A etiqueta estava lá; ninguém olhava a etiqueta.
 *
 * Três camadas, porque uma só já falhou:
 * - a conversa é atribuída ao time no Chatwoot (quem chama é o cliente, que
 *   já sabe fazer isso), e o app do Chatwoot notifica;
 * - o sininho do painel acende;
 * - o WhatsApp de quem atende recebe o aviso com o botão que abre a conversa.
 *
 * E se ninguém responder no prazo, o aviso sobe pro dono.
 */
@Injectable()
export class AtendimentoHumanoService {
  private readonly log = new Logger(AtendimentoHumanoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EnvioWhatsappService,
    private readonly inbox: AdminInboxService,
  ) {}

  private configuracao() {
    return comoSistema(() =>
      this.prisma.configuracaoPlataforma.findUnique({ where: { id: "singleton" } }),
    );
  }

  private horario(cfg: {
    atendimentoHoraInicio: number;
    atendimentoHoraFim: number;
    atendimentoDias: number[];
  }): HorarioAtendimento {
    return {
      inicio: cfg.atendimentoHoraInicio,
      fim: cfg.atendimentoHoraFim,
      dias: cfg.atendimentoDias.length > 0 ? cfg.atendimentoDias : [1, 2, 3, 4, 5, 6],
    };
  }

  /**
   * O que a pessoa lê quando passa pra gente — com nome e prazo.
   *
   * O nome é de quem atende VENDA. No número de operação quem responde é o
   * suporte, e prometer o Fernando pra um motorista com dúvida de viagem seria
   * trocar uma promessa vaga por uma errada.
   */
  async mensagemDeRepasse(canal: "comercial" | "operacao" = "comercial"): Promise<string> {
    const cfg = await this.configuracao();
    if (!cfg) return mensagemDeRepasse(null, { inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5, 6] });
    return mensagemDeRepasse(canal === "comercial" ? cfg.sdrAtendenteNome : null, this.horario(cfg));
  }

  /** Os nomes que, citados, pedem gente. Inclui quem atende. */
  async nomesDaEquipe(): Promise<string[]> {
    const cfg = await this.configuracao();
    if (!cfg) return [];
    return [...new Set([...(cfg.sdrNomesEquipe ?? []), cfg.sdrAtendenteNome ?? ""].filter(Boolean))];
  }

  /** O time do Chatwoot que recebe a conversa, pelo canal. `null` = só etiqueta. */
  async timeDoCanal(canal: "comercial" | "operacao"): Promise<number | null> {
    const cfg = await this.configuracao();
    return (canal === "comercial" ? cfg?.chatwootTimeComercialId : cfg?.chatwootTimeOperacaoId) ?? null;
  }

  /**
   * Avisa a equipe que um lead está esperando gente. **Uma vez por ciclo** —
   * cinco mensagens do lead não viram cinco avisos, e o `alertaHumanoEm` é a
   * memória disso.
   *
   * Nunca lança: é aviso, e aviso que falha não pode derrubar o repasse que o
   * prospect está esperando.
   */
  async avisar(leadId: string, motivo: string, ultimaFala: string, conversaId: number): Promise<void> {
    try {
      const lead = await comoSistema(() =>
        this.prisma.lead.findUnique({
          where: { id: leadId },
          select: { id: true, empresa: true, nome: true, telefone: true, alertaHumanoEm: true },
        }),
      );
      if (!lead || lead.alertaHumanoEm) return;

      // Marca ANTES de enviar: dois webhooks em paralelo não podem mandar dois
      // avisos. O `updateMany` com a condição é a trava — só um deles muda a
      // linha.
      const marcado = await comoSistema(() =>
        this.prisma.lead.updateMany({
          where: { id: leadId, alertaHumanoEm: null },
          data: { alertaHumanoEm: new Date() },
        }),
      );
      if (marcado.count === 0) return;

      const cfg = await this.configuracao();
      await this.enviar(cfg?.alertaComercialTelefones ?? [], lead, ultimaFala, motivo, conversaId);
      await this.sininho(lead, motivo);
    } catch (e) {
      this.log.warn(`aviso de atendimento falhou para o lead ${leadId}: ${String(e)}`);
    }
  }

  private quem(lead: { empresa: string; nome: string | null; telefone: string | null }): string {
    const empresa = empresaConhecida(lead.empresa);
    const pessoa = lead.nome ?? empresa ?? "Contato sem nome";
    const complemento = [empresa && empresa !== pessoa ? empresa : null, lead.telefone]
      .filter(Boolean)
      .join(" · ");
    return complemento ? `${pessoa} (${complemento})` : pessoa;
  }

  private async enviar(
    telefones: string[],
    lead: { empresa: string; nome: string | null; telefone: string | null },
    ultimaFala: string,
    situacao: string,
    conversaId: number,
  ): Promise<void> {
    if (telefones.length === 0) {
      this.log.warn("nenhum telefone de alerta comercial configurado — só o sininho e o Chatwoot avisam");
      return;
    }
    const params = [
      this.quem(lead),
      ultimaFala.slice(0, 200) || "(mandou áudio ou foto)",
      situacao,
      String(conversaId),
    ].map(achatarParam);
    const texto =
      `🔔 ${params[0]} está esperando atendimento no WhatsApp da Movatruck.\n\n` +
      `Última mensagem: ${params[1]}\n\n${params[2]}`;
    for (const numero of telefones) {
      const r = await this.envio.tentarEnviar({
        destino: { tipo: "TELEFONE", numero: numero.replace(/\D/g, "") },
        rota: "ALERTA_COMERCIAL",
        texto,
        params,
      });
      if (!r.enviado) this.log.warn(`alerta comercial não saiu para ${numero}: ${r.erro?.codigo ?? "?"} ${r.erro?.detalhe ?? ""}`);
    }
  }

  private async sininho(lead: { id: string; empresa: string; nome: string | null; telefone: string | null }, motivo: string) {
    const casa = await comoSistema(() =>
      this.prisma.conta.findFirst({ where: { ehPlataforma: true }, select: { id: true } }),
    );
    if (!casa) return;
    await comConta(casa.id, () =>
      this.inbox.disparar({
        tipo: "lead-precisa-humano",
        titulo: `Esperando atendimento: ${this.quem(lead)}`,
        corpo: motivo,
        dados: { leadId: lead.id },
      }),
    );
  }

  /**
   * Ninguém respondeu no prazo: o aviso sobe pro dono.
   *
   * Roda de 5 em 5 minutos, mas só FALA dentro do horário de atendimento — e
   * conta o prazo a partir da abertura, não da hora em que o lead escreveu.
   * Um aviso por lead, por ciclo (`alertaEscalonadoEm`).
   */
  @Cron("0 */5 * * * *", { name: "sdr-escalonar-atendimento", timeZone: "America/Sao_Paulo" })
  async escalonar(): Promise<void> {
    await comLockDeCron(this.prisma, "sdr-escalonar-atendimento", async () => {
      try {
        const cfg = await this.configuracao();
        if (!cfg || cfg.alertaEscalonarTelefones.length === 0) return;
        const h = this.horario(cfg);
        const desde = new Date(Date.now() - JANELA_ESCALONAR_DIAS * 86_400_000);

        const esperando = await comoSistema(() =>
          this.prisma.lead.findMany({
            where: {
              alertaHumanoEm: { gte: desde },
              alertaEscalonadoEm: null,
              primeiraRespostaHumanaEm: null,
              optOut: false,
            },
            select: {
              id: true,
              empresa: true,
              nome: true,
              telefone: true,
              alertaHumanoEm: true,
              chatwootConversaId: true,
            },
            take: 50,
          }),
        );

        for (const lead of esperando) {
          if (!lead.alertaHumanoEm || !lead.chatwootConversaId) continue;
          if (!deveEscalonar(lead.alertaHumanoEm, cfg.alertaEscalonarMinutos, h)) continue;
          const marcado = await comoSistema(() =>
            this.prisma.lead.updateMany({
              where: { id: lead.id, alertaEscalonadoEm: null },
              data: { alertaEscalonadoEm: new Date() },
            }),
          );
          if (marcado.count === 0) continue;
          const ultima = await comoSistema(() =>
            this.prisma.mensagemLead.findFirst({
              where: { leadId: lead.id, direcao: "ENTRADA" },
              orderBy: { criadoEm: "desc" },
              select: { conteudo: true },
            }),
          );
          await this.enviar(
            cfg.alertaEscalonarTelefones,
            lead,
            ultima?.conteudo ?? "",
            `Ninguém respondeu em ${cfg.alertaEscalonarMinutos} min.`,
            lead.chatwootConversaId,
          );
          this.log.log(`lead ${lead.id} sem resposta humana — escalonado`);
        }
      } catch (e) {
        this.log.error(`escalonamento falhou: ${(e as Error).message}`);
      }
    });
  }
}
