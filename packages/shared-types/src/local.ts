import { z } from "zod";
import { TipoLocal } from "./enums";

export const CriarLocalInput = z.object({
  nome: z.string().min(2).max(120),
  logradouro: z.string().min(2).max(160),
  numero: z.string().max(20).optional(),
  bairro: z.string().max(120).optional(),
  cidade: z.string().min(2).max(120),
  uf: z.string().length(2),
  cep: z.string().regex(/^\d{5}-?\d{3}$/).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  pontoReferencia: z.string().max(200).optional(),
  tipo: z.nativeEnum(TipoLocal),
  clienteIds: z.array(z.string().uuid()).default([]),
  apelidos: z.array(z.string().min(1).max(60)).max(20).default([]),
});
export type CriarLocalInput = z.infer<typeof CriarLocalInput>;

export const CriarLocalRapidoInput = z.object({
  nome: z.string().min(2).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Precisão (accuracy em metros) do GPS no momento que o motorista estava no
  // local e tocou "Estou no local". Auditoria de quão confiável é a coordenada.
  precisao: z.number().nonnegative().max(100000).optional(),
  tipo: z.nativeEnum(TipoLocal),
  clienteIds: z.array(z.string().uuid()).default([]),
});
export type CriarLocalRapidoInput = z.infer<typeof CriarLocalRapidoInput>;

export type LocalProximo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  tipo: TipoLocal;
  lat: number | null;
  lng: number | null;
  nivelConfianca: string;
  clienteIds: string[];
  distanciaMetros: number;
  vezesUsadoMotorista: number;
};
