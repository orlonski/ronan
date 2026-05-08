import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SessaoService } from "./sessao.service";

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I/L pra não confundir
const TAM_CODIGO = 6;
const VALIDADE_HORAS = 24;

/**
 * Gera/valida códigos de convite. Admin clica em "convite WhatsApp" no card
 * do motorista (ou user) → `gerarParaMotorista` → mostra código pra colar
 * no chat. Motorista cola → webhook chama `consumir` que cria a sessão.
 *
 * Códigos são curtos (6 chars sem ambiguidade visual) e expiram em 24h.
 * Se admin gerar um novo antes do anterior expirar, o anterior continua
 * válido — sem problemas, ambos funcionam até a primeira vinculação.
 */
@Injectable()
export class ConviteService {
  constructor(private readonly prisma: PrismaService) {}

  async gerarParaMotorista(motoristaId: string) {
    const motorista = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { id: true, ativo: true, whatsappSessao: { select: { telefone: true } } },
    });
    if (!motorista) throw new NotFoundException("Motorista não encontrado");
    if (!motorista.ativo) throw new ConflictException("Motorista inativo");
    if (motorista.whatsappSessao) {
      throw new ConflictException(
        `Motorista já vinculado ao número +${motorista.whatsappSessao.telefone}. Desvincule antes de gerar novo convite.`,
      );
    }

    const { codigo, expiraEm } = await this.criarRegistro({ motoristaId });
    return { codigo, expiraEm };
  }

  async gerarParaUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, ativo: true, whatsappSessao: { select: { telefone: true } } },
    });
    if (!user) throw new NotFoundException("Usuário não encontrado");
    if (!user.ativo) throw new ConflictException("Usuário inativo");
    if (user.whatsappSessao) {
      throw new ConflictException(
        `Usuário já vinculado ao número +${user.whatsappSessao.telefone}. Desvincule antes de gerar novo convite.`,
      );
    }

    const { codigo, expiraEm } = await this.criarRegistro({ userId });
    return { codigo, expiraEm };
  }

  /**
   * Consome um código durante o webhook: valida, cria sessão e marca como usado.
   * Throw com mensagem amigável se código inválido/expirado/já usado/destino com sessão.
   */
  async consumir(codigoRaw: string, telefoneRaw: string) {
    const codigo = codigoRaw.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(codigo)) {
      throw new BadRequestException("Código inválido");
    }
    const telefone = SessaoService.normalizar(telefoneRaw);

    const convite = await this.prisma.whatsappConvite.findUnique({
      where: { codigo },
    });
    if (!convite) throw new NotFoundException("Código não encontrado");
    if (convite.usadoEm) throw new ConflictException("Código já foi usado");
    if (convite.expiraEm < new Date()) throw new ConflictException("Código expirou");
    if (!convite.motoristaId && !convite.userId) {
      throw new BadRequestException("Convite sem destinatário");
    }

    // Telefone já vinculado a outra conta? Bloqueia.
    const sessaoExistente = await this.prisma.whatsappSessao.findUnique({
      where: { telefone },
    });
    if (sessaoExistente) {
      throw new ConflictException("Esse número já está vinculado a outra conta");
    }

    return this.prisma.$transaction(async (tx) => {
      const sessao = await tx.whatsappSessao.create({
        data: {
          telefone,
          motoristaId: convite.motoristaId,
          userId: convite.userId,
        },
        include: {
          motorista: { select: { nome: true } },
          user: { select: { nome: true, perfil: true } },
        },
      });
      await tx.whatsappConvite.update({
        where: { id: convite.id },
        data: { usadoEm: new Date() },
      });
      return sessao;
    });
  }

  private async criarRegistro(alvo: { motoristaId?: string; userId?: string }) {
    // Tenta até 5 vezes pra evitar colisão (código curto = colisões raras mas possíveis)
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const codigo = gerarCodigo();
      try {
        const reg = await this.prisma.whatsappConvite.create({
          data: {
            codigo,
            motoristaId: alvo.motoristaId,
            userId: alvo.userId,
            expiraEm: new Date(Date.now() + VALIDADE_HORAS * 60 * 60 * 1000),
          },
        });
        return { codigo: reg.codigo, expiraEm: reg.expiraEm };
      } catch (e: unknown) {
        // P2002 = unique constraint (código colidiu); tenta de novo
        if ((e as { code?: string }).code === "P2002") continue;
        throw e;
      }
    }
    throw new ConflictException("Não foi possível gerar código único, tente de novo");
  }
}

function gerarCodigo(): string {
  let s = "";
  for (let i = 0; i < TAM_CODIGO; i++) {
    s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return s;
}
