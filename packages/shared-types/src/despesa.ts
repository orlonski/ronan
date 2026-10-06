import { z } from "zod";

/**
 * GASTO DE VIAGEM — o que o motorista paga na estrada e o escritório devolve.
 *
 * Módulo `despesas` (adicional, depende do Financeiro). Pedágio e abastecimento
 * NÃO são tipo de gasto: têm entidade e fluxo próprios, e virar tipo aqui seria
 * a terceira fonte de pedágio (dinheiro em dobro). Ver docs/despesas-viagem/.
 *
 * Desenho (09-modelo-dinamico.md): o que mexe com dinheiro é COLUNA do tipo
 * (devolve, aprova sozinho, devolve no máximo); o que só desenha o formulário é
 * `campos`, um JSON versionado, lido SEMPRE por `lerConfigCampos` (que nunca
 * lança — cache velho do celular e JSON lixo viram o padrão).
 */

// ─── Configuração de campos do tipo ──────────────────────────────────────────

/** Foto do comprovante: o celular nem mostra / mostra / exige (ou o motivo). */
export const MODOS_FOTO = ["NAO_PEDE", "PEDE", "EXIGE"] as const;
export type ModoFoto = (typeof MODOS_FOTO)[number];

/** Campo do formulário: some / fica em "Mais detalhes" / aparece e é exigido. */
export const MODOS_CAMPO = ["OCULTO", "OPCIONAL", "OBRIGATORIO"] as const;
export type ModoCampo = (typeof MODOS_CAMPO)[number];

/**
 * Os campos que o sistema SABE guardar (constante do produto). O que é da
 * empresa é o modo de cada um. Valor e data não são configuráveis: sem eles não
 * é gasto. A ordem desta lista é a ordem no celular (o motorista aprende o
 * formulário uma vez — a ordem não é configurável de propósito).
 */
export const CAMPOS_DESPESA = ["descricao", "placa", "litros", "odometro", "onde"] as const;
export type CampoDespesa = (typeof CAMPOS_DESPESA)[number];

export const CAMPO_DESPESA_LABEL: Record<CampoDespesa, string> = {
  descricao: "O que foi feito",
  placa: "Caminhão (placa)",
  litros: "Litros",
  odometro: "Odômetro",
  onde: "Onde foi",
};

/** Pergunta padrão que o celular mostra quando a empresa não escreveu a dela. */
export const CAMPO_DESPESA_PERGUNTA_PADRAO: Record<CampoDespesa, string> = {
  descricao: "O que foi feito?",
  placa: "Caminhão",
  litros: "Litros",
  odometro: "Odômetro",
  onde: "Onde foi?",
};

export type ConfigCampo = { modo: ModoCampo; pergunta?: string; exemplo?: string };

/** A configuração JÁ RESOLVIDA (todos os campos presentes, modos válidos). */
export type CamposDoTipo = {
  v: 1;
  foto: ModoFoto;
  campos: Record<CampoDespesa, ConfigCampo>;
};

const ConfigCampoSchema = z
  .object({
    modo: z.enum(MODOS_CAMPO),
    pergunta: z.string().trim().max(80).optional(),
    exemplo: z.string().trim().max(120).optional(),
  })
  .strict();

/**
 * Zod ESTRITO pra escrita (painel). O leitor tolerante é só pra leitura —
 * gravar lixo e confiar no leitor seria esconder o erro de quem configura.
 */
export const CamposDoTipoInput = z
  .object({
    v: z.literal(1),
    foto: z.enum(MODOS_FOTO),
    campos: z
      .object({
        descricao: ConfigCampoSchema,
        placa: ConfigCampoSchema,
        litros: ConfigCampoSchema,
        odometro: ConfigCampoSchema,
        onde: ConfigCampoSchema,
      })
      .strict(),
  })
  .strict();
export type CamposDoTipoInput = z.infer<typeof CamposDoTipoInput>;

/** Tipo novo no painel: Foto = Pede, todo o resto "Não aparece" (10-telas §9.2). */
export const CAMPOS_PADRAO: CamposDoTipo = {
  v: 1,
  foto: "PEDE",
  campos: {
    descricao: { modo: "OCULTO" },
    placa: { modo: "OCULTO" },
    litros: { modo: "OCULTO" },
    odometro: { modo: "OCULTO" },
    onde: { modo: "OCULTO" },
  },
};

function textoCurto(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

/**
 * Leitor TOTAL da configuração: nunca lança, nunca devolve campo faltando.
 *
 * - forma desconhecida (`v` ≠ 1, não-objeto) → padrões;
 * - campo ausente ou modo inválido → padrão do campo;
 * - chave que este código não conhece → ignorada (app velho, campo novo).
 *
 * Mesmo papel do `regrasDoModo` (tipo-servico.ts): o cache do celular pode ser
 * de antes de um campo existir, e isso não pode virar tela quebrada no posto.
 */
export function lerConfigCampos(json: unknown): CamposDoTipo {
  const base: CamposDoTipo = {
    v: 1,
    foto: CAMPOS_PADRAO.foto,
    campos: { ...CAMPOS_PADRAO.campos },
  };
  if (!json || typeof json !== "object") return base;
  const j = json as Record<string, unknown>;
  if (j.v !== 1) return base;
  if (typeof j.foto === "string" && (MODOS_FOTO as readonly string[]).includes(j.foto)) {
    base.foto = j.foto as ModoFoto;
  }
  const campos = j.campos && typeof j.campos === "object" ? (j.campos as Record<string, unknown>) : {};
  for (const c of CAMPOS_DESPESA) {
    const bruto = campos[c];
    if (!bruto || typeof bruto !== "object") continue;
    const b = bruto as Record<string, unknown>;
    const modo =
      typeof b.modo === "string" && (MODOS_CAMPO as readonly string[]).includes(b.modo)
        ? (b.modo as ModoCampo)
        : CAMPOS_PADRAO.campos[c].modo;
    const cfg: ConfigCampo = { modo };
    const pergunta = textoCurto(b.pergunta, 80);
    const exemplo = textoCurto(b.exemplo, 120);
    if (pergunta) cfg.pergunta = pergunta;
    if (exemplo) cfg.exemplo = exemplo;
    base.campos[c] = cfg;
  }
  return base;
}

/** Slug do tipo "Outro": a válvula. Descrição sempre obrigatória, nunca desativa. */
export const SLUG_TIPO_OUTRO = "outro";

/**
 * O que o celular deve pedir pra ESTE tipo: a configuração lida + as regras que
 * não são opinião de quem configura.
 *
 * - "Também é manutenção" trava o caminhão em Obrigatório (sem placa, o gasto
 *   não tem pra qual histórico ir).
 * - "Outro" sempre pede a descrição ("Conte o que você pagou").
 *
 * Uma função só, usada pela API (carimbo), pelo painel (prévia) e pelo app
 * (formulário) — divergir faria o celular pedir uma coisa e o servidor cobrar
 * outra.
 */
export function resolverCamposDoTipo(tipo: {
  slug?: string | null;
  manutencao?: boolean | null;
  campos: unknown;
}): CamposDoTipo {
  const r = lerConfigCampos(tipo.campos);
  if (tipo.manutencao) r.campos.placa = { ...r.campos.placa, modo: "OBRIGATORIO" };
  if (tipo.slug === SLUG_TIPO_OUTRO) {
    r.campos.descricao = {
      ...r.campos.descricao,
      modo: "OBRIGATORIO",
      pergunta: r.campos.descricao.pergunta ?? "O que você pagou?",
    };
  }
  return r;
}

/**
 * Quais exigências do tipo o lançamento NÃO cumpriu. O servidor nunca recusa
 * por isso (app antigo não conhece a regra nova; lançamento nunca é recusado):
 * só carimba, e o escritório vê.
 */
export function camposExigidosAusentes(
  cfg: CamposDoTipo,
  valores: {
    temFoto: boolean;
    semComprovanteMotivo?: string | null;
    descricao?: string | null;
    veiculoId?: string | null;
    litros?: number | string | null;
    odometro?: number | null;
    onde?: string | null;
  },
): (CampoDespesa | "foto")[] {
  const faltam: (CampoDespesa | "foto")[] = [];
  if (cfg.foto === "EXIGE" && !valores.temFoto && !valores.semComprovanteMotivo?.trim()) {
    faltam.push("foto");
  }
  const vazio = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");
  const porCampo: Record<CampoDespesa, unknown> = {
    descricao: valores.descricao,
    placa: valores.veiculoId,
    litros: valores.litros,
    odometro: valores.odometro,
    onde: valores.onde,
  };
  for (const c of CAMPOS_DESPESA) {
    if (cfg.campos[c].modo === "OBRIGATORIO" && vazio(porCampo[c])) faltam.push(c);
  }
  return faltam;
}

// ─── Nome reservado ──────────────────────────────────────────────────────────

/**
 * Nomes que NÃO podem virar tipo de gasto: têm fluxo próprio (pedágio, diesel,
 * arla, abastecimento), cadastro próprio (multa) ou ficaram fora por decisão do
 * dono (estadia é cobrança ao cliente; diária foi removida em 22/09/2026).
 * Virar tipo aqui é pagar o mesmo dinheiro por dois caminhos.
 */
export const NOMES_RESERVADOS_TIPO_DESPESA = [
  "pedagio",
  "diesel",
  "arla",
  "abastecimento",
  "combustivel",
  "multa",
  "estadia",
  "diaria",
] as const;

export function normalizarNomeTipo(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O nome bate com uma palavra reservada? Compara palavra a palavra (com plural
 * simples), então "Pedágios", "ARLA 32" e "Diária do motorista" caem, e
 * "Alimentação" ou "Estacionamento" não.
 */
export function nomeReservadoTipoDespesa(nome: string): (typeof NOMES_RESERVADOS_TIPO_DESPESA)[number] | null {
  const palavras = normalizarNomeTipo(nome).split(" ").filter(Boolean);
  for (const p of palavras) {
    const singular = p.endsWith("s") ? p.slice(0, -1) : p;
    const achou = NOMES_RESERVADOS_TIPO_DESPESA.find((r) => r === p || r === singular);
    if (achou) return achou;
  }
  return null;
}

/** Slug a partir do nome (na criação; depois é imutável). */
export function slugDoNomeTipo(nome: string): string {
  return normalizarNomeTipo(nome).replace(/ /g, "-").slice(0, 60) || "tipo";
}

// ─── Ícones (lista fechada; desconhecido cai no genérico) ────────────────────

export const ICONES_TIPO_DESPESA = [
  { chave: "alimentacao", label: "Refeição", emoji: "🍽" },
  { chave: "pneu", label: "Pneu", emoji: "🛞" },
  { chave: "descarga", label: "Caixa / descarga", emoji: "📦" },
  { chave: "pernoite", label: "Cama / pernoite", emoji: "🛏" },
  { chave: "lavagem", label: "Lavagem", emoji: "🧽" },
  { chave: "estacionamento", label: "Estacionamento", emoji: "🅿" },
  { chave: "ferramenta", label: "Ferramenta / conserto", emoji: "🔧" },
  { chave: "balsa", label: "Balsa", emoji: "⛴" },
  { chave: "outro", label: "Outro", emoji: "•••" },
] as const;
export type IconeTipoDespesa = (typeof ICONES_TIPO_DESPESA)[number]["chave"];

// ─── Kit inicial (semeado quando o módulo LIGA numa conta) ───────────────────

export type TipoDespesaKit = {
  slug: string;
  nome: string;
  icone: IconeTipoDespesa;
  devolve: boolean;
  manutencao: boolean;
  podeCobrarCliente: boolean;
  campos: CamposDoTipo;
};

const c = (
  foto: ModoFoto,
  over: Partial<Record<CampoDespesa, ConfigCampo>> = {},
): CamposDoTipo => ({ v: 1, foto, campos: { ...CAMPOS_PADRAO.campos, ...over } });

/**
 * Constante só como SEED (nada chumbado: depois de semeado, é dado da empresa).
 * Ordem = ordem no celular; "Outro" sempre por último.
 */
export const KIT_TIPOS_DESPESA: TipoDespesaKit[] = [
  {
    slug: "alimentacao",
    nome: "Alimentação",
    icone: "alimentacao",
    devolve: true,
    manutencao: false,
    podeCobrarCliente: false,
    campos: c("PEDE", { onde: { modo: "OPCIONAL" } }),
  },
  {
    slug: "borracharia",
    nome: "Borracharia",
    icone: "pneu",
    devolve: true,
    manutencao: true,
    podeCobrarCliente: false,
    campos: c("EXIGE", {
      descricao: { modo: "OBRIGATORIO", pergunta: "O que foi feito?", exemplo: "ex.: remendo no pneu traseiro" },
      placa: { modo: "OBRIGATORIO" },
      odometro: { modo: "OPCIONAL" },
      onde: { modo: "OPCIONAL" },
    }),
  },
  {
    slug: "chapa-descarga",
    nome: "Chapa / descarga",
    icone: "descarga",
    devolve: true,
    manutencao: false,
    podeCobrarCliente: true,
    campos: c("PEDE", { descricao: { modo: "OPCIONAL", pergunta: "Onde descarregou?" }, onde: { modo: "OPCIONAL" } }),
  },
  {
    slug: "pernoite",
    nome: "Pernoite",
    icone: "pernoite",
    devolve: true,
    manutencao: false,
    podeCobrarCliente: false,
    campos: c("PEDE", { onde: { modo: "OPCIONAL" } }),
  },
  {
    slug: "lavagem",
    nome: "Lavagem",
    icone: "lavagem",
    devolve: true,
    manutencao: false,
    podeCobrarCliente: false,
    campos: c("PEDE", { placa: { modo: "OPCIONAL" } }),
  },
  {
    slug: "estacionamento",
    nome: "Estacionamento",
    icone: "estacionamento",
    devolve: true,
    manutencao: false,
    podeCobrarCliente: false,
    campos: c("PEDE", { onde: { modo: "OPCIONAL" } }),
  },
  {
    slug: SLUG_TIPO_OUTRO,
    nome: "Outro",
    icone: "outro",
    devolve: true,
    manutencao: false,
    podeCobrarCliente: false,
    campos: c("PEDE", {
      descricao: { modo: "OBRIGATORIO", pergunta: "O que você pagou?" },
      onde: { modo: "OPCIONAL" },
    }),
  },
];

// ─── Estados ─────────────────────────────────────────────────────────────────

/** O gasto nunca é "recusado": o escritório decide se DEVOLVE. */
export const STATUS_DESPESA = ["COM_ESCRITORIO", "APROVADA", "NAO_REEMBOLSADA"] as const;
export type StatusDespesa = (typeof STATUS_DESPESA)[number];

/**
 * Vínculo com viagem. "Sem resposta" ≠ "fora de viagem": o motorista que não
 * respondeu não afirmou nada (vai pra "Gastos sem viagem"); quem disse "não foi
 * em viagem" não é perguntado de novo.
 */
export const VINCULOS_DESPESA = ["SEM_RESPOSTA", "VIAGEM", "FORA_DE_VIAGEM"] as const;
export type VinculoDespesa = (typeof VINCULOS_DESPESA)[number];

/**
 * Marcas de atenção GRAVADAS (o servidor nunca recusa: carimba). "Sem viagem
 * com sugestão" não é gravada — é calculada na leitura da fila.
 */
export const MARCAS_DESPESA = [
  "SEM_COMPROVANTE",
  "CAMPO_EXIGIDO_AUSENTE",
  "ACIMA_DO_MAXIMO",
  "POSSIVEL_REPETIDO",
  "TIPO_INATIVO",
  "VIAGEM_NAO_ACHADA",
] as const;
export type MarcaDespesa = (typeof MARCAS_DESPESA)[number];

/** Por que parece repetido, do sinal mais forte pro mais fraco. */
export const SINAIS_REPETIDO = ["MESMA_CHAVE", "MESMA_FOTO", "PARECIDO"] as const;
export type SinalRepetido = (typeof SINAIS_REPETIDO)[number];

// ─── Rotas do motorista (/m/despesas) ────────────────────────────────────────

const Uuid = z.string().uuid();
const TextoOpcional = (max: number) => z.string().trim().max(max).optional().nullable();

/**
 * POST /m/despesas — idempotente por `clientId` (o mesmo clientId do mesmo
 * motorista devolve o que já existe, sem gravar de novo).
 *
 * Vínculo com viagem, uma das três situações:
 *   - `viagemId` OU `viagemClientId` (viagem ainda no celular) → VIAGEM;
 *   - `foraDeViagem: true` → "não foi em viagem";
 *   - nada → SEM_RESPOSTA (vai pra "Gastos sem viagem").
 */
export const CriarDespesaInput = z.object({
  clientId: Uuid,
  tipoDespesaId: Uuid,
  /** Quanto ELE pagou. Intocável depois (o escritório aprova outro valor à parte). */
  valor: z.number().positive().max(50_000),
  /** Instante do gasto (o dia civil é o de São Paulo). */
  data: z.coerce.date(),
  viagemId: Uuid.optional().nullable(),
  viagemClientId: Uuid.optional().nullable(),
  foraDeViagem: z.boolean().optional(),
  veiculoId: Uuid.optional().nullable(),
  descricao: TextoOpcional(500),
  litros: z.number().positive().max(5000).optional().nullable(),
  odometro: z.number().int().nonnegative().max(9_999_999).optional().nullable(),
  onde: TextoOpcional(160),
  // Precisão é float (feedback_erro_de_validacao_que_mente).
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  precisao: z.number().nonnegative().optional().nullable(),
  /** As `storageKey` devolvidas por POST /m/uploads/despesa. Até 3. */
  fotoKeys: z.array(z.string().min(1).max(400)).max(3).default([]),
  /** "Não tenho o comprovante" → o que aconteceu. */
  semComprovanteMotivo: TextoOpcional(300),
  /** Chave de 44 dígitos (QR da NFC-e). Só é guardada se o DV e o modelo (55/65) conferirem. */
  chaveFiscal: z.string().max(60).optional().nullable(),
  /** O app avisou "parece repetido" e ele tocou "É outro — salvar este". */
  confirmouQueEOutro: z.boolean().optional(),
  /** Revisão da configuração do tipo que o celular usou (`camposVersao` do catálogo). */
  camposVersao: z.number().int().positive().optional().nullable(),
  criadoOfflineEm: z.coerce.date().optional().nullable(),
});
export type CriarDespesaInput = z.infer<typeof CriarDespesaInput>;

/**
 * PATCH /m/despesas/:id — corrigir enquanto o escritório não decidiu. Mesmos
 * campos do POST, todos opcionais (clientId não muda). `null` limpa o campo.
 */
export const AtualizarDespesaInput = CriarDespesaInput.omit({ clientId: true }).partial();
export type AtualizarDespesaInput = z.infer<typeof AtualizarDespesaInput>;

/**
 * POST /m/despesas/vincular — em lote. `despesas` aceita o `id` do servidor OU
 * o `clientId` do celular (o que ele tiver à mão).
 *   acao VIAGEM → exige `viagemId` ou `viagemClientId`;
 *   acao FORA_DE_VIAGEM → "não foi em viagem";
 *   acao DESFAZER → volta a SEM_RESPOSTA (o "Desfazer" da faixa verde).
 */
export const VincularDespesasInput = z
  .object({
    despesas: z.array(Uuid).min(1).max(100),
    acao: z.enum(["VIAGEM", "FORA_DE_VIAGEM", "DESFAZER"]),
    viagemId: Uuid.optional().nullable(),
    viagemClientId: Uuid.optional().nullable(),
  })
  .refine((v) => v.acao !== "VIAGEM" || !!v.viagemId || !!v.viagemClientId, {
    message: "Diga qual viagem.",
    path: ["viagemId"],
  });
export type VincularDespesasInput = z.infer<typeof VincularDespesasInput>;

export const ListarDespesasMotoristaQuery = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes deve estar no formato YYYY-MM")
    .optional(),
  cursor: Uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListarDespesasMotoristaQuery = z.infer<typeof ListarDespesasMotoristaQuery>;

/** POST /m/uploads/despesa (multipart, campo `foto`) devolve isto. */
export type UploadDespesaResposta = { storageKey: string; sha256: string };

/** Um tipo no /m/catalogos (`tiposDespesa`). Só os ATIVOS, na ordem do painel. */
export type TipoDespesaCatalogo = {
  id: string;
  slug: string;
  nome: string;
  icone: string | null;
  ordem: number;
  /** false = "Por sua conta" (o celular avisa antes de lançar). */
  devolve: boolean;
  /** "Devolvido até R$ X" — linha cinza, nunca validação. Decimal em string. */
  devolveNoMaximo: string | null;
  manutencao: boolean;
  /** JSON cru — o app SEMPRE passa por `resolverCamposDoTipo(tipo)`. */
  campos: unknown;
  camposVersao: number;
};

/** Onde o gasto está, do ponto de vista do motorista (o texto da tela sai daqui). */
export const SITUACOES_DESPESA_MOTORISTA = [
  "COM_ESCRITORIO",
  "APROVADA",
  "APROVADA_OUTRO_VALOR",
  "NO_ACERTO",
  "PAGO",
  "NAO_REEMBOLSADA",
  "POR_SUA_CONTA",
  "PAGO_FORA_DO_ACERTO",
] as const;
export type SituacaoDespesaMotorista = (typeof SITUACOES_DESPESA_MOTORISTA)[number];

export const SITUACAO_DESPESA_TEXTO: Record<SituacaoDespesaMotorista, string> = {
  COM_ESCRITORIO: "Com o escritório",
  APROVADA: "Aprovado — entra no próximo acerto",
  APROVADA_OUTRO_VALOR: "Aprovado com outro valor",
  NO_ACERTO: "No acerto",
  PAGO: "Pago",
  NAO_REEMBOLSADA: "Não vai ser reembolsado",
  POR_SUA_CONTA: "Por sua conta",
  PAGO_FORA_DO_ACERTO: "Aprovado — o escritório paga fora do acerto",
};

/** Um gasto como o app recebe (POST, PATCH, vincular e GET devolvem isto). */
export type DespesaDoMotorista = {
  id: string;
  clientId: string;
  tipo: { id: string; slug: string; nome: string; icone: string | null };
  /** Decimais em string ("58.00"). */
  valorInformado: string;
  valorAprovado: string | null;
  data: string;
  status: StatusDespesa;
  situacao: SituacaoDespesaMotorista;
  /** Motivo escrito pelo escritório (outro valor / não reembolsar). */
  motivo: string | null;
  vinculo: VinculoDespesa;
  viagemId: string | null;
  viagemClientId: string | null;
  viagem: { id: string; clientId: string; data: string | null; resumo: string } | null;
  veiculo: { id: string; placa: string } | null;
  descricao: string | null;
  litros: string | null;
  odometro: number | null;
  onde: string | null;
  semComprovanteMotivo: string | null;
  fotos: { id: string }[];
  acerto: { id: string; periodoInicio: string; periodoFim: string; status: "ABERTO" | "FECHADO" | "PAGO"; pagoEm: string | null } | null;
  /** Entra no "pra receber de volta"? */
  somaPraReceber: boolean;
  /**
   * A régua dele (modalidade) não devolve gasto de viagem: vem com
   * `situacao: "POR_SUA_CONTA"` e isto `true`, pro app explicar "Não volta no
   * acerto (combinado da empresa)". App antigo ignora e mostra "Por sua conta".
   */
  naoVoltaNoAcerto?: boolean;
  /** Ainda dá pra corrigir/apagar pelo app. */
  editavel: boolean;
};

export type DespesasDoMotoristaResposta = {
  itens: DespesaDoMotorista[];
  nextCursor: string | null;
  /** Só na primeira página (sem cursor). Decimais em string. */
  resumo?: {
    praReceber: string;
    aprovado: string;
    comEscritorio: string;
    semViagem: number;
  };
};

// ─── Painel: tipos de gasto ──────────────────────────────────────────────────

const ValorOpcional = z.number().positive().max(100_000).optional().nullable();

export const CriarTipoDespesaInput = z.object({
  nome: z.string().trim().min(2).max(60),
  icone: z.string().trim().max(30).optional().nullable(),
  devolve: z.boolean().default(true),
  aprovaSozinhoAte: ValorOpcional,
  devolveNoMaximo: ValorOpcional,
  manutencao: z.boolean().default(false),
  podeCobrarCliente: z.boolean().default(false),
  campos: CamposDoTipoInput.optional(),
});
export type CriarTipoDespesaInput = z.infer<typeof CriarTipoDespesaInput>;

export const AtualizarTipoDespesaInput = z.object({
  nome: z.string().trim().min(2).max(60).optional(),
  icone: z.string().trim().max(30).optional().nullable(),
  ativo: z.boolean().optional(),
  devolve: z.boolean().optional(),
  aprovaSozinhoAte: ValorOpcional,
  devolveNoMaximo: ValorOpcional,
  manutencao: z.boolean().optional(),
  podeCobrarCliente: z.boolean().optional(),
  campos: CamposDoTipoInput.optional(),
});
export type AtualizarTipoDespesaInput = z.infer<typeof AtualizarTipoDespesaInput>;

export const ReordenarTiposDespesaInput = z.object({
  ids: z.array(Uuid).min(1).max(200),
});
export type ReordenarTiposDespesaInput = z.infer<typeof ReordenarTiposDespesaInput>;

// ─── Painel: conferência ─────────────────────────────────────────────────────

export const ListarDespesasAdminQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(STATUS_DESPESA).optional(),
  motoristaId: Uuid.optional(),
  veiculoId: Uuid.optional(),
  viagemId: Uuid.optional(),
  tipoDespesaId: Uuid.optional(),
  /** YYYY-MM-DD, dia de São Paulo, inclusivo. */
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  podeCobrarCliente: z.enum(["true", "false"]).optional(),
  /** Só sem ponto de atenção (o filtro da fila). */
  semAtencao: z.enum(["true", "false"]).optional(),
});
export type ListarDespesasAdminQuery = z.infer<typeof ListarDespesasAdminQuery>;

export const AprovarDespesaInput = z.object({
  /** Ausente = aprova o valor lançado. Presente e diferente = exige motivo. */
  valorAprovado: z.number().nonnegative().max(50_000).optional(),
  motivo: z.string().trim().max(300).optional(),
});
export type AprovarDespesaInput = z.infer<typeof AprovarDespesaInput>;

export const NaoReembolsarDespesaInput = z.object({
  motivo: z.string().trim().min(3, "Escreva o motivo — o motorista vai ler.").max(300),
});
export type NaoReembolsarDespesaInput = z.infer<typeof NaoReembolsarDespesaInput>;

export const AprovarDespesasLoteInput = z.object({
  ids: z.array(Uuid).min(1).max(200),
});
export type AprovarDespesasLoteInput = z.infer<typeof AprovarDespesasLoteInput>;

export const VincularDespesaAdminInput = z.object({
  /** null = desvincular (volta a "sem resposta"). */
  viagemId: Uuid.nullable(),
});
export type VincularDespesaAdminInput = z.infer<typeof VincularDespesaAdminInput>;

/** Ponto de atenção como a fila mostra (texto montado no painel). */
export type PontoAtencaoDespesa =
  | { tipo: "SEM_COMPROVANTE"; motivo: string | null }
  | { tipo: "FOTO_NAO_CHEGOU" }
  | { tipo: "ACIMA_DO_MAXIMO"; maximo: string }
  | { tipo: "POSSIVEL_REPETIDO"; despesaId: string | null; resumo: string | null; confirmouQueEOutro: boolean }
  | { tipo: "CAMPO_EXIGIDO_AUSENTE" }
  | { tipo: "TIPO_INATIVO" }
  | { tipo: "SEM_VIAGEM"; sugestao: { viagemId: string; resumo: string; janela: string } | null };
