import { Injectable } from "@nestjs/common";
import type { AutorMensagem } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type MensagemViagem = {
  id: string;
  autor: AutorMensagem;
  autorNome: string;
  texto: string;
  acao: string | null;
  criadoEm: Date;
};

export type CriarMensagemInput = {
  viagemId: string;
  autor: AutorMensagem;
  autorNome: string;
  texto: string;
  /** null = mensagem livre; senão ação estruturada (MARCOU_DIVERGENTE, etc). */
  acao?: string | null;
  usuarioId?: string | null;
  motoristaId?: string | null;
};

/**
 * Chat por viagem. Uma linha por mensagem (admin ou motorista), com autor +
 * nome + data. Reusado pelas ações de divergência (que também viram mensagem)
 * e pelo envio livre dos dois lados.
 */
@Injectable()
export class ViagemMensagensService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(input: CriarMensagemInput) {
    return this.prisma.viagemMensagem.create({
      data: {
        viagemId: input.viagemId,
        autor: input.autor,
        autorNome: input.autorNome,
        texto: input.texto,
        acao: input.acao ?? null,
        usuarioId: input.autor === "ADMIN" ? (input.usuarioId ?? null) : null,
        motoristaId: input.autor === "MOTORISTA" ? (input.motoristaId ?? null) : null,
      },
    });
  }

  async listar(viagemId: string): Promise<MensagemViagem[]> {
    const rows = await this.prisma.viagemMensagem.findMany({
      where: { viagemId },
      orderBy: { criadoEm: "asc" },
      select: { id: true, autor: true, autorNome: true, texto: true, acao: true, criadoEm: true },
    });
    return rows;
  }
}
