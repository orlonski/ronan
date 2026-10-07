import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z, type ZodRawShape } from "zod";
import { EscopoIntegracaoSchema } from "@ronan/shared-types";

extendZodWithOpenApi(z);

/**
 * Os contratos da API pública: o que entra e o que sai da `/v1`.
 *
 * Moram na API, e não no shared-types, porque só ela os usa e porque a
 * documentação sai daqui (`.openapi()`). Regras:
 *
 * - todo objeto é ESTRITO, em todos os níveis (`objeto()`): campo desconhecido
 *   é 400, nunca descartado calado — o integrador que manda `valor` achando que
 *   gravou recebe o erro, não um 200 mentiroso. Há teste que varre a árvore;
 * - dia é "AAAA-MM-DD", sem hora: "2026-10-31T22:30-03:00" convertido pra UTC
 *   cairia em 01/11, no mês e no fechamento errados;
 * - número que é dinheiro ou medida SAI como texto decimal ("12.500"): o
 *   JavaScript do integrador perde casa com número;
 * - o vocabulário é o do cliente: "obra" (o nosso `Cliente`), não o do banco.
 */

/** `z.object(...).strict()`. Use SEMPRE este, nunca `z.object` direto, aqui. */
export function objeto<T extends ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

const Dia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD (só o dia, sem hora).")
  // 2026-02-30 passa na regex; a volta pela data de verdade é que denuncia.
  .refine((s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
    const t = Date.parse(`${s}T12:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, "Data que não existe.")
  .openapi({ example: "2026-10-07", description: "Dia da viagem (data da carga), sem hora." });

const IdExterno = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .openapi({ description: "O número deste registro no sistema de vocês.", example: "PED-88231" });

const Uuid = z.string().uuid();

const Decimal = z.string().openapi({ description: "Número em texto decimal, com ponto.", example: "32.450" });

/** Referência a um cadastro: pelo nosso id OU pelo número de vocês OU pela chave natural. */
function referencia<N extends string>(natural: N, naturalSchema: z.ZodTypeAny, descricao: string) {
  return objeto({
    id: Uuid.optional().openapi({ description: "Id do Movatruck." }),
    externo: IdExterno.optional(),
    [natural]: naturalSchema.optional(),
  } as Record<"id" | "externo" | N, z.ZodTypeAny>)
    .refine((r) => Object.values(r).filter((v) => v !== undefined).length === 1, {
      message: `Informe exatamente um: id, externo ou ${natural}.`,
    })
    .openapi({ description: descricao });
}

/**
 * Local só por id ou pelo número de vocês: nome de lugar se repete ("Pedreira",
 * "Usina") e casar por nome parecido seria o sistema afirmando o que não sabe.
 */
function referenciaLocal(descricao: string) {
  return objeto({ id: Uuid.optional(), externo: IdExterno.optional() })
    .refine((r) => (r.id ? 1 : 0) + (r.externo ? 1 : 0) === 1, "Informe id ou externo.")
    .openapi({ description: `${descricao} Crie antes por PUT /locais/externo/{idExterno}.` });
}

const Cpf = z
  .string()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((s) => s.length === 11, "CPF tem 11 dígitos.");
const Placa = z
  .string()
  .transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  .refine((s) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(s), "Placa no formato ABC1D23 ou ABC1234.");
const Nome = z.string().trim().min(1).max(200);

// ---------------------------------------------------------------- viagens --

export const CriarViagemV1 = objeto({
  externo: IdExterno.optional().openapi({
    description:
      "O número da viagem no sistema de vocês. Recomendado: mandar de novo com o mesmo número ATUALIZA em vez de duplicar.",
  }),
  data: Dia,
  motorista: referencia("cpf", Cpf, "Quem dirigiu. Obrigatório e precisa existir (crie antes por PUT /motoristas/externo/{idExterno})."),
  veiculo: referencia("placa", Placa, "O caminhão. Obrigatório e precisa existir."),
  localCarga: referenciaLocal("Onde carregou.").optional(),
  localDescarga: referenciaLocal("Onde descarregou.").optional(),
  material: objeto({ id: Uuid.optional(), nome: Nome.optional() })
    .refine((r) => (r.id ? 1 : 0) + (r.nome ? 1 : 0) === 1, "Informe id ou nome.")
    .optional()
    .openapi({ description: "O que foi transportado. Achado pelo nome exato do cadastro." }),
  obra: objeto({ id: Uuid.optional(), nome: Nome.optional() })
    .refine((r) => (r.id ? 1 : 0) + (r.nome ? 1 : 0) === 1, "Informe id ou nome.")
    .optional()
    .openapi({ description: "A obra (e, por ela, o cliente que paga). Achada pelo nome exato do cadastro." }),
  toneladas: z.number().positive().max(200).optional().openapi({
    description: "Peso. Sem peso, a viagem entra como AGUARDANDO_PESO e fica fora de fechamento e faturamento até ter.",
    example: 32.45,
  }),
  km: z.number().positive().max(5000).optional().openapi({ description: "Km do trajeto segundo o sistema de vocês.", example: 48.2 }),
  ticket: z.string().trim().min(1).max(60).optional().openapi({ description: "Número do ticket de balança / romaneio." }),
  observacao: z.string().trim().max(500).optional(),
});
export type CriarViagemV1 = z.infer<typeof CriarViagemV1>;

/** No PUT por número externo o número vai no caminho, não no corpo. */
export const AtualizarViagemV1 = CriarViagemV1.omit({ externo: true });
export type AtualizarViagemV1 = z.infer<typeof AtualizarViagemV1>;

export const ParamIdExterno = objeto({ idExterno: IdExterno });
export const ParamId = objeto({ id: Uuid });

const RefSaida = (extra: ZodRawShape = {}) =>
  objeto({ id: z.string(), nome: z.string().nullable(), externo: z.string().nullable(), ...extra });

export const SITUACOES_VIAGEM = [
  "EM_ANDAMENTO",
  "AGUARDANDO_PESO",
  "INCOMPLETA",
  "A_CONFERIR",
  "COM_DIVERGENCIA",
  "CONFERIDA",
] as const;

export const ViagemV1 = objeto({
  id: z.string(),
  externo: z.string().nullable(),
  situacao: z.enum(SITUACOES_VIAGEM).openapi({
    description:
      "EM_ANDAMENTO, AGUARDANDO_PESO e INCOMPLETA são viagens que ainda NÃO podem ser faturadas. A_CONFERIR espera uma pessoa conferir; CONFERIDA já passou.",
  }),
  origem: z.enum(["APP", "PAINEL", "INTEGRACAO"]).openapi({
    description: "Quem criou. Só viagem criada por esta integração pode ser alterada por ela.",
  }),
  data: z.string().nullable(),
  motorista: RefSaida(),
  veiculo: objeto({ id: z.string(), placa: z.string(), externo: z.string().nullable() }),
  localCarga: RefSaida().nullable(),
  localDescarga: RefSaida().nullable(),
  material: objeto({ id: z.string(), nome: z.string() }).nullable(),
  obra: objeto({ id: z.string(), nome: z.string() }).nullable(),
  toneladas: Decimal.nullable(),
  km: Decimal.nullable().openapi({ description: "Km que vale pro faturamento (pode ter sido corrigido no painel)." }),
  kmSistemaOrigem: Decimal.nullable().openapi({ description: "O km que o sistema de vocês mandou, guardado como veio." }),
  ticket: z.string().nullable(),
  pendencias: z.array(objeto({ motivo: z.string(), detalhe: z.string() })).openapi({
    description: "O que falta pra viagem poder ser conferida (ex.: material não achado).",
  }),
  criadoEm: z.string(),
  alteradoEm: z.string(),
});
export type ViagemV1 = z.infer<typeof ViagemV1>;

const Aviso = objeto({ codigo: z.string(), mensagem: z.string() });

export const RespostaGravarViagemV1 = objeto({
  criada: z.boolean().openapi({ description: "false = já existia (mesmo número ou mesma Idempotency-Key) e foi atualizada ou devolvida." }),
  viagem: ViagemV1,
  avisos: z.array(Aviso).openapi({ description: "O que entrou diferente do mandado (ex.: material não achado)." }),
});

// -------------------------------------------------------------- cadastros --

export const PutMotoristaV1 = objeto({
  nome: Nome,
  cpf: Cpf,
  telefone: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((s) => s.length >= 10 && s.length <= 13, "Telefone com DDD.")
    .optional(),
});
export const PutVeiculoV1 = objeto({
  placa: Placa,
  modelo: z.string().trim().max(80).optional(),
});
export const PutLocalV1 = objeto({
  nome: Nome,
  tipo: z.enum(["CARGA", "DESCARGA", "AMBOS"]),
  logradouro: z.string().trim().max(200).optional(),
  numero: z.string().trim().max(20).optional(),
  bairro: z.string().trim().max(100).optional(),
  cidade: z.string().trim().min(1).max(100),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "UF com 2 letras."),
  cep: z.string().transform((s) => s.replace(/\D/g, "")).refine((s) => s.length === 8, "CEP com 8 dígitos.").optional(),
  lat: z.number().min(-34).max(6).optional(),
  lng: z.number().min(-74).max(-28).optional(),
});

const RespostaCadastro = (nome: string, item: z.ZodTypeAny) =>
  objeto({
    criado: z.boolean(),
    alterado: z.boolean(),
    [nome]: item,
    avisos: z.array(Aviso),
  });

export const MotoristaV1 = objeto({ id: z.string(), nome: z.string(), externo: z.string().nullable() });
export const VeiculoV1 = objeto({ id: z.string(), placa: z.string(), modelo: z.string().nullable(), externo: z.string().nullable() });
export const LocalV1 = objeto({
  id: z.string(),
  nome: z.string(),
  tipo: z.string(),
  cidade: z.string(),
  uf: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  externo: z.string().nullable(),
});
export const RespostaMotoristaV1 = RespostaCadastro("motorista", MotoristaV1);
export const RespostaVeiculoV1 = RespostaCadastro("veiculo", VeiculoV1);
export const RespostaLocalV1 = RespostaCadastro("local", LocalV1);

// -------------------------------------------------------------------- eu --

export const EuV1 = objeto({
  integracao: objeto({ id: z.string(), nome: z.string(), sistema: z.string() }),
  empresa: objeto({ nome: z.string() }),
  escopos: z.array(EscopoIntegracaoSchema),
});

// ------------------------------------------------------------------- erro --

export const ErroV1 = objeto({
  erro: objeto({
    codigo: z.string().openapi({ example: "VALIDACAO" }),
    mensagem: z.string(),
    detalhes: z.array(objeto({ campo: z.string(), codigo: z.string(), mensagem: z.string() })).optional(),
    requisicaoId: z.string().openapi({ example: "req_3f9a0c1d2e4b5a6c7d8e" }),
  }),
}).openapi("Erro");
