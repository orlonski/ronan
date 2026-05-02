import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class LocaisMotoristaService {
  constructor(private readonly prisma: PrismaService) {}

  criar(input: {
    nome: string;
    logradouro: string;
    numero?: string;
    bairro?: string;
    cidade: string;
    uf: string;
    cep?: string;
    pontoReferencia?: string;
    tipo: "CARGA" | "DESCARGA" | "AMBOS";
    obraId?: string;
    lat?: number;
    lng?: number;
  }) {
    return this.prisma.local.create({
      data: {
        nome: input.nome,
        logradouro: input.logradouro,
        numero: input.numero,
        bairro: input.bairro,
        cidade: input.cidade,
        uf: input.uf.toUpperCase(),
        cep: input.cep,
        pontoReferencia: input.pontoReferencia,
        tipo: input.tipo,
        obraId: input.obraId,
        lat: input.lat,
        lng: input.lng,
      },
      select: {
        id: true,
        nome: true,
        logradouro: true,
        numero: true,
        bairro: true,
        cidade: true,
        uf: true,
        pontoReferencia: true,
        tipo: true,
        obraId: true,
      },
    });
  }
}
