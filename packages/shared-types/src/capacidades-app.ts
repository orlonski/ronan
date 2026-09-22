import { z } from "zod";
import type { AcessoAppChave } from "./acesso-app";
import type { ModuloChave } from "./modulos";

/**
 * O QUE EXISTE NO APP DO MOTORISTA — o catálogo de capacidades.
 *
 * ⚠️ A divisão que sustenta o desenho inteiro:
 *   - AQUI (código) mora o SIGNIFICADO: o que é "bater ponto", que endpoint
 *     isso abre, em que vínculo faz sentido, de que módulo é.
 *   - NO BANCO (dado, editável pelo escritório) mora QUEM RECEBE: perfil,
 *     regra de quem recebe qual perfil, exceção com motivo.
 * Constante aqui nunca decide quem vê o quê. Ela só diz o que a coisa é.
 *
 * ⚠️ Toda chave começa com `app.` porque o painel já tem `acertos.ver` e
 * `programacao.ver` com outro sentido ("o operador vê os acertos") — sem o
 * prefixo, qualquer função que derive módulo pelo prefixo misturaria os dois.
 * Pelo mesmo motivo o módulo é EXPLÍCITO em cada linha: `moduloDaChave("app.x")`
 * devolveria `undefined`, e chave sem módulo passa pelo teto da conta.
 *
 * Substitui aos poucos o `acesso-app.ts` (as 13 colunas `pode*`), que continua
 * vivo como ponte: `colunaLegada` diz qual coluna cada capacidade espelha.
 */

export const CAPACIDADES_APP_CHAVES = [
  "app.viagem.lancar",
  "app.viagem.guiada",
  "app.viagem.gpsClassico",
  "app.navegacao.aoVivo",
  "app.ticket.ocr",
  "app.km.referencia",
  "app.locais.verTodos",
  "app.pedagio.lancar",
  "app.abastecimento.lancar",
  "app.diaria.lancar",
  "app.diaria.verValor",
  "app.obra.presenca",
  "app.posicao.compartilhar",
  "app.programacao.ver",
  "app.acertos.ver",
  "app.chat.usar",
  "app.stories.ver",
  "app.stories.publicar",
  "app.ponto.bater",
  "app.ponto.espelho",
  "app.ponto.corrigir",
  "app.documentos.enviar",
  "app.telemetria",
] as const;

export type CapacidadeApp = (typeof CAPACIDADES_APP_CHAVES)[number];

export const GRUPOS_CAPACIDADE_APP = [
  "Viagens",
  "Gastos",
  "Obra e diária",
  "Operação",
  "Dinheiro",
  "Convívio",
  "Ponto",
  "Documentos",
  "Plataforma",
] as const;
export type GrupoCapacidadeApp = (typeof GRUPOS_CAPACIDADE_APP)[number];

/** Em que cadastro a capacidade MORA. É estrutural, não preferência. */
export type VinculoCapacidade = "MOTORISTA" | "FUNCIONARIO" | "QUALQUER";

export type CapacidadeAppDef = {
  chave: CapacidadeApp;
  /** Como o escritório chama isso. */
  label: string;
  /** O que muda NO APP DELE quando está ligado. */
  efeito: string;
  grupo: GrupoCapacidadeApp;
  /**
   * EMPRESA: a empresa decide.
   * ROLLOUT: em liberação gradual — é da plataforma dizer em que empresa vale.
   * PLATAFORMA: é da Movatruck (diagnóstico), nunca do cliente.
   */
  tipo: "EMPRESA" | "ROLLOUT" | "PLATAFORMA";
  /**
   * Onde mora. Ponto só existe pra quem tem `Funcionario`; lançar viagem só pra
   * quem tem `Motorista`. Uma exceção não cria vínculo: o CLT sem cadastro de
   * motorista não "lança viagem" de mentira porque alguém marcou a caixa.
   */
  vinculo: VinculoCapacidade;
  /**
   * Guarda-corpo jurídico — SÓ onde muda alguma coisa. Empregado não recebe
   * diária, obra nem acerto: somar pagamento por diária e folha na mesma
   * pessoa desenha vínculo dentro do produto.
   */
  regimesProibidos?: ("EMPREGADO" | "PARCEIRO")[];
  /** Módulo contratado de que depende. Sempre explícito. */
  modulo: ModuloChave;
  /** Só vale junto de ALGUMA destas. */
  dependeDe?: CapacidadeApp[];
  /**
   * Quem barra de verdade:
   *   SERVIDOR — o endpoint recusa;
   *   FILTRO — o servidor filtra o dado;
   *   SO_TELA — só esconde na tela (o painel diz isso com todas as letras).
   */
  gate: "SERVIDOR" | "FILTRO" | "SO_TELA";
  /** Custa dinheiro por uso. */
  custa?: boolean;
  /**
   * Item que chegou do outbox DEPOIS de a pessoa perder o acesso:
   * VALA = aceita, carimba e manda pra conferência (lançamento nunca é recusado);
   * RECUSAR = não há o que conferir (ver stories, conversar).
   */
  aoPerder: "VALA" | "RECUSAR";
  /** O trabalhador tem direito aos registros dele mesmo com o módulo cancelado. */
  sobreviveCancelamento?: boolean;
  /**
   * A coluna `pode*` do `Motorista` que esta capacidade espelha enquanto as
   * colunas existirem. `espelha: false` = deriva da coluna mas não a escreve
   * (duas capacidades nascidas de uma coluna só).
   */
  colunaLegada?: { coluna: AcessoAppChave; espelha: boolean };
};

const DEFS: CapacidadeAppDef[] = [
  {
    chave: "app.viagem.lancar",
    label: "Lançar viagem",
    efeito: "O botão \"Nova viagem\" na tela inicial.",
    grupo: "Viagens",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "operacao",
    gate: "SERVIDOR",
    aoPerder: "VALA",
    colunaLegada: { coluna: "podeLancarViagem", espelha: true },
  },
  {
    chave: "app.viagem.guiada",
    label: "Viagem guiada",
    efeito: "O app acompanha a viagem do início ao fim, e é o que alimenta a torre de controle.",
    grupo: "Viagens",
    tipo: "ROLLOUT",
    vinculo: "MOTORISTA",
    modulo: "operacao",
    dependeDe: ["app.viagem.lancar"],
    gate: "SERVIDOR",
    aoPerder: "VALA",
    colunaLegada: { coluna: "podeViagemLifecycle", espelha: true },
  },
  {
    chave: "app.viagem.gpsClassico",
    label: "Iniciar viagem com GPS",
    efeito: "Botão pra começar a viagem com o GPS acompanhando o trajeto até o fim.",
    grupo: "Viagens",
    tipo: "ROLLOUT",
    vinculo: "MOTORISTA",
    modulo: "operacao",
    gate: "SERVIDOR",
    aoPerder: "VALA",
    colunaLegada: { coluna: "podeIniciarViagem", espelha: true },
  },
  {
    chave: "app.navegacao.aoVivo",
    label: "Navegação por voz",
    efeito: "Mapa e voz guiando até o destino durante a viagem.",
    grupo: "Viagens",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "operacao",
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
  },
  {
    chave: "app.ticket.ocr",
    label: "Ler o ticket por foto",
    efeito: "A foto do ticket já vem preenchida pra ele conferir, em vez de digitar tudo.",
    grupo: "Viagens",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "conferencia",
    dependeDe: ["app.viagem.lancar", "app.viagem.guiada"],
    gate: "SERVIDOR",
    custa: true,
    aoPerder: "RECUSAR",
    colunaLegada: { coluna: "podeUsarOcrTicket", espelha: true },
  },
  {
    chave: "app.km.referencia",
    label: "Mostrar o km de sempre",
    efeito: "Ao escolher carga e descarga, o app mostra o que a frota costuma rodar nesse trajeto.",
    grupo: "Viagens",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "operacao",
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
    colunaLegada: { coluna: "podeReferenciaKm", espelha: true },
  },
  {
    chave: "app.locais.verTodos",
    label: "Buscar local pelo nome",
    efeito: "Além dos locais perto do GPS, ele acha qualquer um digitando o nome.",
    grupo: "Viagens",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "operacao",
    gate: "SO_TELA",
    aoPerder: "RECUSAR",
    colunaLegada: { coluna: "podeVerTodosLocais", espelha: true },
  },
  {
    chave: "app.pedagio.lancar",
    label: "Lançar pedágio",
    efeito: "Registrar o pedágio pago na estrada, pra entrar no acerto.",
    grupo: "Gastos",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "operacao",
    gate: "SERVIDOR",
    aoPerder: "VALA",
    colunaLegada: { coluna: "podeLancarPedagio", espelha: true },
  },
  {
    chave: "app.abastecimento.lancar",
    label: "Lançar abastecimento",
    efeito: "Registrar litros, valor e odômetro no posto.",
    grupo: "Gastos",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "operacao",
    gate: "SERVIDOR",
    aoPerder: "VALA",
    colunaLegada: { coluna: "podeLancarAbastecimento", espelha: true },
  },
  {
    chave: "app.diaria.lancar",
    label: "Lançar diária",
    efeito: "Escolher o modo por período e marcar entrada e saída em vez de peso.",
    grupo: "Obra e diária",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    regimesProibidos: ["EMPREGADO"],
    modulo: "mensal",
    gate: "SERVIDOR",
    aoPerder: "VALA",
    colunaLegada: { coluna: "podeDiaria", espelha: true },
  },
  {
    chave: "app.diaria.verValor",
    label: "Ver quanto vale a diária dele",
    efeito: "O valor em R$ aparece na conta de diárias do app.",
    grupo: "Obra e diária",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    regimesProibidos: ["EMPREGADO"],
    modulo: "mensal",
    gate: "FILTRO",
    aoPerder: "RECUSAR",
    colunaLegada: { coluna: "podeVerValorDiaria", espelha: true },
  },
  {
    chave: "app.obra.presenca",
    label: "Marcar presença na obra",
    efeito: "O \"cheguei\" da obra e a lista de dias dele.",
    grupo: "Obra e diária",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    regimesProibidos: ["EMPREGADO"],
    modulo: "mensal",
    gate: "SERVIDOR",
    aoPerder: "VALA",
  },
  {
    chave: "app.posicao.compartilhar",
    label: "Compartilhar a posição",
    efeito: "O app manda a posição durante o trabalho, pro mapa do painel.",
    grupo: "Operação",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "operacao",
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
  },
  {
    chave: "app.programacao.ver",
    label: "Ver a programação",
    efeito: "\"Minha programação\": as viagens planejadas pra ele.",
    grupo: "Operação",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "torre",
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
  },
  {
    chave: "app.acertos.ver",
    label: "Ver os acertos",
    efeito: "\"Meus acertos\": quanto ele tem a receber no período.",
    grupo: "Dinheiro",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    regimesProibidos: ["EMPREGADO"],
    modulo: "financeiro",
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
  },
  {
    chave: "app.chat.usar",
    label: "Conversar com os outros motoristas",
    efeito: "A aba de conversas do app.",
    grupo: "Convívio",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "comunicacao",
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
    colunaLegada: { coluna: "podeChat", espelha: true },
  },
  {
    chave: "app.stories.ver",
    label: "Ver stories",
    efeito: "A barra de fotos de 24h na tela inicial dele.",
    grupo: "Convívio",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "comunicacao",
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
    colunaLegada: { coluna: "podeVerStories", espelha: true },
  },
  {
    chave: "app.stories.publicar",
    label: "Postar stories",
    efeito: "O \"+\" da barra de stories.",
    grupo: "Convívio",
    tipo: "EMPRESA",
    vinculo: "MOTORISTA",
    modulo: "comunicacao",
    dependeDe: ["app.stories.ver"],
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
    // Hoje ver e postar são uma coluna só. Nasce igual a ela e passa a poder
    // divergir — mas quem escreve a coluna é o "ver".
    colunaLegada: { coluna: "podeVerStories", espelha: false },
  },
  {
    chave: "app.ponto.bater",
    label: "Bater ponto",
    efeito: "A aba Ponto, com o botão de marcar.",
    grupo: "Ponto",
    tipo: "EMPRESA",
    vinculo: "FUNCIONARIO",
    modulo: "ponto",
    gate: "SERVIDOR",
    aoPerder: "VALA",
  },
  {
    chave: "app.ponto.espelho",
    label: "Ver o espelho do ponto",
    efeito: "\"Meu espelho\": as batidas e o saldo do mês.",
    grupo: "Ponto",
    tipo: "EMPRESA",
    vinculo: "FUNCIONARIO",
    modulo: "ponto",
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
    sobreviveCancelamento: true,
  },
  {
    chave: "app.ponto.corrigir",
    label: "Pedir correção de ponto",
    efeito: "Pedir pra corrigir uma batida esquecida ou errada.",
    grupo: "Ponto",
    tipo: "EMPRESA",
    vinculo: "FUNCIONARIO",
    modulo: "ponto",
    gate: "SERVIDOR",
    aoPerder: "VALA",
  },
  {
    chave: "app.documentos.enviar",
    label: "Mandar documentos",
    efeito: "\"Meus documentos\": o que a empresa pede e o que já foi entregue.",
    grupo: "Documentos",
    tipo: "EMPRESA",
    vinculo: "QUALQUER",
    modulo: "admissao",
    gate: "SERVIDOR",
    aoPerder: "VALA",
  },
  {
    chave: "app.telemetria",
    label: "Gravar o uso da tela",
    efeito: "Registra o que ele tocou na tela de lançamento — serve pra investigar erro de uso, não pra vigiar.",
    grupo: "Plataforma",
    tipo: "PLATAFORMA",
    vinculo: "QUALQUER",
    modulo: "plataforma",
    gate: "SERVIDOR",
    aoPerder: "RECUSAR",
    colunaLegada: { coluna: "podeTelemetria", espelha: true },
  },
];

/** O catálogo, na ordem das chaves. */
export const CAPACIDADES_APP: readonly CapacidadeAppDef[] = CAPACIDADES_APP_CHAVES.map((c) => {
  const d = DEFS.find((x) => x.chave === c);
  if (!d) throw new Error(`Capacidade sem definição: ${c}`);
  return d;
});

export const CAPACIDADE_POR_CHAVE: Readonly<Record<CapacidadeApp, CapacidadeAppDef>> =
  Object.fromEntries(CAPACIDADES_APP.map((d) => [d.chave, d])) as Record<
    CapacidadeApp,
    CapacidadeAppDef
  >;

export function ehCapacidadeApp(chave: string): chave is CapacidadeApp {
  return (CAPACIDADES_APP_CHAVES as readonly string[]).includes(chave);
}

/**
 * As camadas que CORTAM acesso por cima do perfil.
 *
 * ⚠️ Toda empresa começa com as que MUDARIAM O PRESENTE em sombra: calculam,
 * mostram "quem perderia o quê" e não cortam nada. Passar uma camada a valer
 * numa empresa é decisão do dono, empresa por empresa, vendo a lista nominal
 * antes — empresa em produção não perde funcionalidade por efeito automático.
 * APROVACAO já nasce valendo porque já vale hoje: cadastro em análise ou
 * inativo não entra no app.
 */
export const CAMADAS_CORTE = [
  "APROVACAO",
  "DEPENDENCIA",
  "REGIME",
  "PLATAFORMA",
  "CONTRATO",
] as const;
export type CamadaCorte = (typeof CAMADAS_CORTE)[number];

// ─── Entradas do painel ─────────────────────────────────────────────────────

const CapacidadeAppSchema = z.enum(CAPACIDADES_APP_CHAVES);

export const SalvarPerfilAppInput = z.object({
  nome: z.string().trim().min(2).max(60),
  descricao: z.string().trim().max(200).optional().nullable(),
  capacidades: z.array(CapacidadeAppSchema).max(CAPACIDADES_APP_CHAVES.length),
});
export type SalvarPerfilAppInput = z.infer<typeof SalvarPerfilAppInput>;

export const RegraAcessoAppInput = z.object({
  id: z.string().uuid().optional().nullable(),
  nome: z.string().trim().min(2).max(80),
  ativo: z.boolean(),
  vinculo: z.enum(["QUALQUER", "MOTORISTA", "FUNCIONARIO"]),
  regime: z.enum(["QUALQUER", "PARCEIRO", "EMPREGADO", "NAO_DECLARADO"]),
  modalidadeId: z.string().uuid().optional().nullable(),
  transportadoraId: z.string().uuid().optional().nullable(),
  perfilId: z.string().uuid(),
});
export type RegraAcessoAppInput = z.infer<typeof RegraAcessoAppInput>;

/** A lista inteira, na ordem em que é avaliada. */
export const SalvarRegrasAppInput = z.object({ regras: z.array(RegraAcessoAppInput).max(50) });
export type SalvarRegrasAppInput = z.infer<typeof SalvarRegrasAppInput>;

export const PadraoAcessoAppInput = z.object({
  perfilPadraoMotoristaId: z.string().uuid().nullable(),
  perfilPadraoFuncionarioId: z.string().uuid().nullable(),
});
export type PadraoAcessoAppInput = z.infer<typeof PadraoAcessoAppInput>;

export const CriarExcecaoAppInput = z
  .object({
    motoristaId: z.string().uuid().optional(),
    funcionarioId: z.string().uuid().optional(),
    capacidade: CapacidadeAppSchema,
    efeito: z.enum(["CONCEDER", "NEGAR"]),
    // Motivo de verdade, como no km: "teste" não explica nada daqui a seis meses.
    motivo: z.string().trim().min(10, "Escreva o motivo em pelo menos 10 caracteres.").max(300),
    expiraEm: z.coerce.date().optional().nullable(),
  })
  .refine((v) => !!v.motoristaId !== !!v.funcionarioId, {
    message: "Informe o motorista OU o funcionário.",
  });
export type CriarExcecaoAppInput = z.infer<typeof CriarExcecaoAppInput>;

/** A mesma exceção pra várias pessoas de uma vez (seleção na lista). */
export const ExcecaoLoteAppInput = z.object({
  motoristaIds: z.array(z.string().uuid()).min(1).max(500),
  capacidade: CapacidadeAppSchema,
  efeito: z.enum(["CONCEDER", "NEGAR"]),
  motivo: z.string().trim().min(10, "Escreva o motivo em pelo menos 10 caracteres.").max(300),
  expiraEm: z.coerce.date().optional().nullable(),
});
export type ExcecaoLoteAppInput = z.infer<typeof ExcecaoLoteAppInput>;

/**
 * Fixar um perfil em quem as regras não descrevem bem — ou, com `perfilId`
 * nulo, devolver a pessoa às regras. Fixar é exceção de perfil inteiro, então
 * pede motivo como qualquer exceção.
 */
export const FixarPerfilAppInput = z.object({
  motoristaIds: z.array(z.string().uuid()).min(1).max(500),
  perfilId: z.string().uuid().nullable(),
  motivo: z.string().trim().min(10, "Escreva o motivo em pelo menos 10 caracteres.").max(300),
});
export type FixarPerfilAppInput = z.infer<typeof FixarPerfilAppInput>;

export const RevogarExcecaoAppInput = z.object({
  motivo: z.string().trim().min(10, "Escreva o motivo em pelo menos 10 caracteres.").max(300),
});
export type RevogarExcecaoAppInput = z.infer<typeof RevogarExcecaoAppInput>;

/**
 * Rascunho pra SIMULAR antes de salvar: o que muda pra quem. Só o que vier
 * preenchido substitui o que está no banco.
 */
export const SimularAcessoAppInput = z.object({
  perfil: z
    .object({ id: z.string().uuid().nullable(), capacidades: z.array(CapacidadeAppSchema), ativo: z.boolean() })
    .optional(),
  regras: z.array(RegraAcessoAppInput).max(50).optional(),
  padrao: PadraoAcessoAppInput.optional(),
  camadasEmSombra: z.array(z.enum(CAMADAS_CORTE)).optional(),
  rolloutsApp: z.array(CapacidadeAppSchema).optional(),
});
export type SimularAcessoAppInput = z.infer<typeof SimularAcessoAppInput>;

export const ConfigPlataformaAcessoAppInput = z.object({
  camadasEmSombra: z.array(z.enum(CAMADAS_CORTE)),
  rolloutsApp: z.array(CapacidadeAppSchema),
});
export type ConfigPlataformaAcessoAppInput = z.infer<typeof ConfigPlataformaAcessoAppInput>;

/**
 * Cadastro de motorista ainda não salvo: com que perfil ele entraria. O CPF
 * vale porque a pessoa pode já ser registrada (CLT) nesta empresa.
 */
export const PreviaCadastroAppInput = z.object({
  cpf: z.string().optional().nullable(),
  modalidadeId: z.string().uuid().optional().nullable(),
  transportadoraId: z.string().uuid().optional().nullable(),
});
export type PreviaCadastroAppInput = z.infer<typeof PreviaCadastroAppInput>;

/**
 * O que o APP recebe: as capacidades calculadas da pessoa em cada empresa
 * onde ela tem vínculo vivo. Uma entrada por empresa — a mesma pessoa pode ser
 * registrada numa e parceira noutra, e cada uma decide o dela.
 */
export type AcessoAppDaConta = {
  contaId: string;
  contaNome: string;
  capacidades: CapacidadeApp[];
  /** Quando o resolvedor gravou este resultado. */
  calculadoEm: string;
};

/**
 * O que o APP decide com o acesso calculado: esta capacidade vale, não vale,
 * ou ainda não se sabe (`undefined`). Função pura, pra ser testada fora do app.
 *
 * - O que mora no cadastro de FUNCIONÁRIO (o ponto) se decide na empresa onde
 *   a pessoa é registrada, que pode não ser a da sessão (parceira na A,
 *   registrada na B). O resto, na empresa da sessão; sem sessão, na do vínculo
 *   de registrado.
 * - Sem resposta pra essa empresa → `undefined`. O app lê como "não sei" e
 *   segue como antes; nunca como "não pode".
 */
export function capacidadeNaConta(
  acessos: readonly AcessoAppDaConta[] | null | undefined,
  contas: { sessao: string | null; registrado: string | null },
  chave: CapacidadeApp,
): boolean | undefined {
  const conta =
    CAPACIDADE_POR_CHAVE[chave]?.vinculo === "FUNCIONARIO"
      ? (contas.registrado ?? contas.sessao)
      : (contas.sessao ?? contas.registrado);
  if (!conta || !acessos) return undefined;
  const daConta = acessos.find((a) => a.contaId === conta);
  if (!daConta) return undefined;
  return daConta.capacidades.includes(chave);
}

/** Uma pessoa que muda numa simulação. */
export type MudancaAcessoApp = {
  cpf: string;
  nome: string;
  motoristaId: string | null;
  funcionarioId: string | null;
  ganhou: CapacidadeApp[];
  perdeu: CapacidadeApp[];
};
