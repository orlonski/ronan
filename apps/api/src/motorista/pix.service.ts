import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { AcaoAuditoria } from "@prisma/client";
import { randomInt } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";

const CODIGO_TTL_MIN = 10;
const MAX_TENTATIVAS = 5;
const REENVIO_COOLDOWN_S = 60;

/**
 * O parceiro troca a chave Pix onde recebe, pelo app. É dinheiro: a troca só
 * vale com o código que chega no WhatsApp DO NÚMERO DO CADASTRO — celular
 * destravado na mão de outro não basta pra desviar o pagamento. Depois da
 * troca: auditoria, sininho pro escritório e o carimbo `chavePixAlteradaEm`
 * (o acerto mostra "chave alterada em DD/MM").
 */
@Injectable()
export class PixMotoristaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EnvioWhatsappService,
    private readonly auditoria: AuditoriaService,
    private readonly inbox: AdminInboxService,
  ) {}

  async atual(motoristaId: string) {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { chavePix: true, chavePixAlteradaEm: true, telefone: true },
    });
    const pendente = await this.prisma.trocaPixPendente.findUnique({
      where: { motoristaId },
      select: { expiraEm: true },
    });
    return {
      chavePix: m?.chavePix ?? null,
      alteradaEm: m?.chavePixAlteradaEm ?? null,
      // Só os 4 últimos: pra ele saber pra qual número foi o código.
      telefoneFinal: m?.telefone ? m.telefone.replace(/\D/g, "").slice(-4) : null,
      aguardandoCodigo: pendente != null && pendente.expiraEm > new Date(),
    };
  }

  async solicitar(motoristaId: string, chavePix: string) {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { telefone: true, status: true },
    });
    if (m?.status !== "APROVADO") throw new ForbiddenException("Seu cadastro ainda está em análise.");
    if (!m.telefone) {
      throw new BadRequestException("Seu cadastro não tem telefone. Peça pro escritório trocar a chave Pix.");
    }
    const anterior = await this.prisma.trocaPixPendente.findUnique({ where: { motoristaId } });
    if (anterior && Date.now() - anterior.enviadoEm.getTime() < REENVIO_COOLDOWN_S * 1000) {
      throw new HttpException(
        "Espere um minuto pra pedir outro código.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    // Envia ANTES de gravar: código que não chegou não pode ficar valendo.
    await this.envio.enviarOuFalhar({
      destino: { tipo: "TELEFONE", numero: SessaoService.normalizar(m.telefone) },
      rota: "OTP_PIX",
      texto: `Seu código pra trocar a chave Pix no Movatruck é ${codigo}. Vale por ${CODIGO_TTL_MIN} minutos. Se não foi você, ignore e avise o escritório.`,
      params: [codigo, String(CODIGO_TTL_MIN)],
    });
    const dados = {
      chavePix,
      codigo,
      expiraEm: new Date(Date.now() + CODIGO_TTL_MIN * 60_000),
      tentativas: 0,
      enviadoEm: new Date(),
    };
    await this.prisma.trocaPixPendente.upsert({
      where: { motoristaId },
      create: { motoristaId, ...dados },
      update: dados,
    });
    return { ok: true as const, expiraEmSegundos: CODIGO_TTL_MIN * 60 };
  }

  async confirmar(motoristaId: string, codigo: string) {
    const p = await this.prisma.trocaPixPendente.findUnique({ where: { motoristaId } });
    if (!p || p.expiraEm < new Date()) {
      throw new BadRequestException("O código venceu. Peça um novo.");
    }
    if (p.tentativas >= MAX_TENTATIVAS) {
      throw new BadRequestException("Tentativas demais. Peça um novo código.");
    }
    if (p.codigo !== codigo) {
      await this.prisma.trocaPixPendente.update({
        where: { motoristaId },
        data: { tentativas: { increment: 1 } },
      });
      throw new BadRequestException("Código errado. Confira no WhatsApp.");
    }

    const antes = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { chavePix: true, nome: true },
    });
    const agora = new Date();
    await this.prisma.$transaction([
      this.prisma.motorista.update({
        where: { id: motoristaId },
        data: { chavePix: p.chavePix, chavePixAlteradaEm: agora },
      }),
      this.prisma.trocaPixPendente.delete({ where: { motoristaId } }),
    ]);
    await this.auditoria.log({
      entidade: "Motorista",
      entidadeId: motoristaId,
      acao: AcaoAuditoria.UPDATE,
      campo: "chavePix",
      valorAntes: antes?.chavePix ?? null,
      valorDepois: p.chavePix,
      motivo: "O motorista trocou a chave Pix pelo app (confirmada com código no WhatsApp).",
    });
    void this.inbox
      .disparar({
        tipo: "motorista-cadastro",
        titulo: `${antes?.nome ?? "Um motorista"} trocou a chave Pix`,
        corpo: `Nova chave: ${p.chavePix}. Confirmada com código no WhatsApp do cadastro.`,
        dados: { motoristaId },
        permissao: "motoristas.ver",
      })
      .catch(() => {});
    return { chavePix: p.chavePix, alteradaEm: agora };
  }
}
