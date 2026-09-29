import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import { modulosDaConta } from "../../common/conta/teto-da-conta";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { VINCULO_VIVO } from "../../common/vinculo";
import { falhaEhDeAlcance, numeroSilencioso } from "../../common/whatsapp-alcance";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { SessaoService } from "../../whatsapp/sessao.service";
import { SugestoesGestorService } from "./sugestoes-gestor.service";

/** Telefones como o Motorista pode tê-los gravado: com e sem DDI, com e sem o nono dígito. */
export function telefonesParaBusca(telefoneRaw: string): string[] {
  const v = SessaoService.variantes(telefoneRaw);
  return [...new Set([...v, ...v.map((t) => t.replace(/^55/, ""))])];
}

/**
 * Alcance do WhatsApp de cada número — o que a Meta diz sobre a entrega, virado
 * em "este motorista recebe o que a gente manda?".
 *
 * Só a conferência diária consulta isto. NUNCA mexe em `ativo`, `status`,
 * `bloqueadoAte` nem `aceitaWhatsapp`, e não bloqueia OTP/reset/aviso de peso.
 *
 * Os métodos `ao*` rodam a partir do webhook (sem conta no contexto → `comoSistema`,
 * porque o número é da PESSOA e pode ter vínculo em várias empresas).
 */
@Injectable()
export class ConferenciaAlcanceService {
  private readonly log = new Logger("ConferenciaAlcance");

  constructor(
    private readonly prisma: PrismaService,
    private readonly sugestoes: SugestoesGestorService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** A Meta confirmou entrega (delivered/read): o número é alcançável. */
  async aoEntregar(telefone: string): Promise<void> {
    await this.recuperar(telefone, true);
  }

  /** O motorista escreveu pra gente: está vivo, mesmo que a Meta não confirme entregas. */
  async aoResponder(telefone: string): Promise<void> {
    await this.recuperar(telefone, false);
  }

  private async recuperar(telefone: string, entrega: boolean): Promise<void> {
    const agora = new Date();
    const telefones = telefonesParaBusca(telefone);
    const alvos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: { telefone: { in: telefones } },
        select: { id: true, contaId: true, whatsappInalcancavelEm: true, whatsappFalhasSeguidas: true },
      }),
    );
    for (const m of alvos) {
      const precisa = entrega || m.whatsappInalcancavelEm || m.whatsappFalhasSeguidas > 0;
      if (!precisa) continue;
      await comConta(m.contaId, async () => {
        await this.prisma.motorista.update({
          where: { id: m.id },
          data: {
            whatsappFalhasSeguidas: 0,
            whatsappSemEntregaDesde: null,
            whatsappInalcancavelEm: null,
            ...(entrega ? { whatsappUltimaEntregaEm: agora } : {}),
          },
        });
        if (m.whatsappInalcancavelEm) {
          await this.sugestoes.encerrar(
            { motoristaId: m.id, tipo: "WHATSAPP_INALCANCAVEL" },
            "RESOLVIDA_SOZINHA",
            entrega ? "A Meta voltou a confirmar entrega." : "O motorista respondeu.",
          );
        }
      });
    }
  }

  /**
   * Falha de entrega. Só conta se o código está na allowlist de "destinatário não
   * alcançável" — falha nossa (template, limite, token, pagamento) NÃO conta.
   */
  async aoFalhar(telefone: string, codigo: string | number | null | undefined): Promise<boolean> {
    if (!falhaEhDeAlcance(codigo)) return false;
    const agora = new Date();
    const telefones = telefonesParaBusca(telefone);
    await comoSistema(async () => {
      await this.prisma.motorista.updateMany({
        where: { telefone: { in: telefones } },
        data: { whatsappFalhasSeguidas: { increment: 1 } },
      });
      await this.prisma.motorista.updateMany({
        where: { telefone: { in: telefones }, whatsappSemEntregaDesde: null },
        data: { whatsappSemEntregaDesde: agora },
      });
    });
    return true;
  }

  // ─── Cron: o silencioso e o contador ─────────────────────────────────────

  /** Todo dia, de manhã cedo, antes de a conferência rodar. */
  @Cron("0 30 6 * * *", { name: "conferencia-alcance", timeZone: "America/Sao_Paulo" })
  async varrer(): Promise<void> {
    await comLockDeCron(this.prisma, "conferencia-alcance", async () => {
      await paraCadaConta(this.prisma, async (contaId) => {
        await this.varrerConta(contaId, new Date());
      });
    });
  }

  /** Público pra teste. Devolve os motoristas que passaram a SUSPEITOS agora. */
  async varrerConta(contaId: string, agora: Date): Promise<string[]> {
    const modulos = await modulosDaConta(this.prisma, contaId);
    if (!modulos.has("conferencia")) return [];
    const cfg = await this.prisma.configuracaoConferenciaDiaria.findFirst();
    if (!cfg?.ativo) return [];

    const n = cfg.mensagensParaSuspeitar;
    const desde = new Date(agora.getTime() - cfg.diasParaSuspeitar * 86_400_000);
    const motoristas = await this.prisma.motorista.findMany({
      where: { ...VINCULO_VIVO, status: "APROVADO", telefone: { not: null }, whatsappInalcancavelEm: null },
      select: {
        id: true,
        nome: true,
        telefone: true,
        whatsappFalhasSeguidas: true,
        whatsappSemEntregaDesde: true,
        whatsappUltimaEntregaEm: true,
        whatsappReverificadoEm: true,
      },
    });

    const novos: { id: string; nome: string; motivo: string }[] = [];
    for (const m of motoristas) {
      let motivo: string | null = null;
      if (m.whatsappFalhasSeguidas >= n) {
        motivo = `${m.whatsappFalhasSeguidas} envios seguidos que a Meta disse não conseguir entregar nesse número.`;
      } else {
        const numeros = SessaoService.variantes(m.telefone!);
        const mensagens = await this.prisma.whatsappMensagem.findMany({
          where: {
            direcao: "SAIDA",
            provedor: "meta",
            telefone: { in: numeros },
            criadoEm: { gte: desde },
          },
          orderBy: { criadoEm: "desc" },
          take: n + 5,
          select: { statusEntrega: true, idExterno: true, criadoEm: true },
        });
        const depoisDe = [m.whatsappReverificadoEm, m.whatsappUltimaEntregaEm]
          .filter((d): d is Date => !!d)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        if (numeroSilencioso(mensagens, n, agora, { depoisDe })) {
          motivo = `Os últimos ${n} envios pela Meta, nos últimos ${cfg.diasParaSuspeitar} dias, não tiveram entrega confirmada.`;
        }
      }
      if (!motivo) continue;

      await this.prisma.motorista.update({
        where: { id: m.id },
        data: {
          whatsappInalcancavelEm: agora,
          whatsappSemEntregaDesde: m.whatsappSemEntregaDesde ?? agora,
        },
      });
      await this.sugestoes.abrir({
        tipo: "WHATSAPP_INALCANCAVEL",
        motoristaId: m.id,
        resumo: `${m.nome}: o WhatsApp parece não chegar. Contate por outro meio e, se o número estiver certo, use "reverificar" no cadastro.`,
        evidencia: {
          motivo,
          falhasSeguidas: m.whatsappFalhasSeguidas,
          ultimaEntregaEm: m.whatsappUltimaEntregaEm?.toISOString() ?? null,
        },
      });
      novos.push({ id: m.id, nome: m.nome, motivo });
    }

    if (novos.length > 0) {
      // UMA notificação por varredura, não uma por motorista: o sino não é lista.
      await this.sugestoes.notificar(
        novos.length === 1
          ? "Um motorista parece sem WhatsApp"
          : `${novos.length} motoristas parecem sem WhatsApp`,
        `${novos
          .slice(0, 3)
          .map((x) => x.nome)
          .join(", ")}${novos.length > 3 ? "…" : ""}: a conferência diária parou de perguntar a eles. Veja em "Esqueceu de lançar?".`,
        { motoristaId: novos[0]!.id },
      );
    }
    return novos.map((x) => x.id);
  }

  // ─── Reverificar (botão do cadastro) ─────────────────────────────────────

  /** Limpa a suspeita: o gestor sabe que o número está certo. Mensagens antigas deixam de contar. */
  async reverificar(motoristaId: string, usuarioId: string): Promise<void> {
    const antes = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { id: true, whatsappInalcancavelEm: true, whatsappFalhasSeguidas: true },
    });
    if (!antes) return;
    await this.prisma.motorista.update({
      where: { id: motoristaId },
      data: {
        whatsappInalcancavelEm: null,
        whatsappFalhasSeguidas: 0,
        whatsappSemEntregaDesde: null,
        whatsappReverificadoEm: new Date(),
      },
    });
    await this.sugestoes.encerrar(
      { motoristaId, tipo: "WHATSAPP_INALCANCAVEL" },
      "RECUSADA",
      "O gestor mandou reverificar o número.",
    );
    await this.auditoria.log({
      usuarioId,
      entidade: "Motorista",
      entidadeId: motoristaId,
      acao: "CONFERENCIA_SUGESTAO_DECIDIDA",
      campo: "whatsappInalcancavelEm",
      valorAntes: antes.whatsappInalcancavelEm,
      valorDepois: null,
      motivo: "Reverificar WhatsApp",
    });
  }
}
