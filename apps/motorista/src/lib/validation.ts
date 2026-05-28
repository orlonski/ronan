import type { z } from "zod";

export type ZodIssueLite = {
  path: string;
  code: string;
  message: string;
};

const FIELD_LABELS: Record<string, string> = {
  nome: "Nome",
  logradouro: "Endereço",
  numero: "Número",
  bairro: "Bairro",
  cidade: "Cidade",
  uf: "Estado",
  cep: "CEP",
  pontoReferencia: "Ponto de referência",
  tipo: "Tipo",
  clientId: "ID do app",
  veiculoId: "Placa",
  clienteId: "Cliente",
  materialId: "Material",
  data: "Data",
  toneladas: "Toneladas",
  ticket: "Ticket",
  km: "Km",
  localCargaId: "Local de carga",
  localDescargaId: "Local de descarga",
  valorPedagioTotal: "Pedágio",
  pracaPedagio: "Praça de pedágio",
  valor: "Valor",
  litros: "Litros",
  valorTotal: "Valor total",
  odometro: "Odômetro",
  posto: "Posto",
  fotoKey: "Foto",
  lat: "Latitude",
  lng: "Longitude",
  observacao: "Observação",
};

export function labelDoCampo(path: string): string {
  if (!path) return "Campo";
  const root = path.split(".")[0] ?? path;
  return FIELD_LABELS[root] ?? path;
}

export function frasePorCodigo(code: string, message: string): string {
  switch (code) {
    case "too_small":
      return "muito curto / abaixo do mínimo";
    case "too_big":
      return "muito grande / acima do máximo";
    case "invalid_string":
    case "invalid_format":
      return "formato inválido";
    case "invalid_type":
      return "obrigatório (não foi enviado)";
    case "invalid_enum_value":
      return "valor inválido";
    case "invalid_date":
      return "data inválida";
    default:
      return message.length < 80 ? message : "inválido";
  }
}

export function humanizeZodIssues(issues: ZodIssueLite[]): string {
  return issues
    .map((i) => `${labelDoCampo(i.path)}: ${frasePorCodigo(i.code, i.message)}`)
    .join("\n");
}

export function humanizeZodError(err: z.ZodError): string {
  const issues: ZodIssueLite[] = err.issues.map((i) => ({
    path: i.path.map(String).join("."),
    code: i.code,
    message: i.message,
  }));
  return humanizeZodIssues(issues);
}
