import { z } from "zod";
import { RESOURCE_DEFS_PUBLICO } from "./permissoes";

/**
 * MÓDULOS: o que a empresa contratou.
 *
 * Isto NÃO é controle de acesso — o RBAC já faz isso e continua fazendo. É
 * contrato: "essa empresa paga por Fiscal e Financeiro, não por Frota".
 *
 * Antes disto existiam quatro mecanismos paralelos pra responder "o que essa
 * conta tem": permissão por papel, teto por conta (`permissoesPermitidas`),
 * flags booleanas na Conta (iaLeituraTicket…) e flags no Motorista. Nenhum deles
 * é contrato, porque falta a todos as três coisas que um módulo tem: nome,
 * alcance fora do painel e data de início.
 *
 * O módulo entra POR CIMA do RBAC, nunca ao lado: vira mais um fator no
 * `tetoDaConta()`. Assim, módulo cancelado já tem poda automática escrita e
 * testada, e nada mais do RBAC precisa mudar.
 *
 * ⚠️ O módulo é dono de RECURSOS, não de chaves. `recurso` (`viagens`,
 * `fechamentos`) já é a unidade do catálogo de permissões, então quando alguém
 * adicionar `viagens.arquivar` amanhã, a chave entra no módulo sozinha. É
 * exatamente o que falta hoje no teto, que é uma lista plana que envelhece.
 */

export const MODULOS_CHAVES = [
  "operacao",
  "conferencia",
  "fechamento",
  "comercial",
  "financeiro",
  "manutencao",
  "torre",
  "fiscal",
  "comunicacao",
  "admissao",
  "ponto",
  "plataforma",
] as const;
export const ModuloChaveSchema = z.enum(MODULOS_CHAVES);
export type ModuloChave = z.infer<typeof ModuloChaveSchema>;

export type ModuloDef = {
  chave: ModuloChave;
  /** O nome que vai na proposta comercial. */
  nome: string;
  /** O que o cliente compra, na voz de quem vende. */
  pitch: string;
  /**
   * Núcleo não se desliga: sem ele não existe produto. Desligar Operação seria
   * vender um sistema de viagens que não registra viagem.
   */
  nucleo?: boolean;
  /**
   * Custa dinheiro por uso (IA, WhatsApp). Só a PLATAFORMA liga — o dono da
   * empresa não paga essa conta. Mesma régua do RECURSOS_PLATAFORMA.
   */
  medido?: boolean;
  /**
   * Vendido à parte. Não entra no conjunto que a conta nova recebe: quem assina
   * o adicional é decisão comercial, e ligar sozinho daria de graça o que se
   * pretende cobrar.
   *
   * Diferente de `medido`, que é "gasta dinheiro da plataforma por uso" — um
   * adicional pode não custar nada por documento e ainda assim ser vendido.
   */
  adicional?: boolean;
  /** Recursos do catálogo RBAC que este módulo traz. */
  recursos: string[];
};

export const MODULOS: ModuloDef[] = [
  {
    chave: "operacao",
    nome: "Operação",
    pitch: "O motorista lança, o painel confere. Viagens, pedágio, abastecimento e o app.",
    nucleo: true,
    recursos: [
      "viagens",
      // A tela "Ao vivo" era `viagens.ver` — fica no núcleo, onde já estava:
      // mandá-la pra "torre" tiraria o ao vivo de quem não contratou a torre.
      "ao-vivo",
      "abastecimentos",
      // O molde de acessos do app é do núcleo: quem tem motorista tem app, e
      // quem tem app precisa dizer o que cada tipo de pessoa faz nele.
      "perfis-acesso",
      // ⚠️ Estava em "Comunicação", junto de chat e WhatsApp. Não é
      // comunicação nenhuma: é o raio que o app usa pra achar o local de
      // descarga. Uma empresa que não comprasse o módulo de conversa ficava
      // sem regular a busca de local do próprio motorista.
      "config-busca-locais",
      "motoristas",
      "veiculos",
      "transportadoras",
      "clientes",
      "empresas",
      "locais",
      "materiais",
      "tipos-servico",
      "modalidades",
      "tipos-evento-viagem",
      "notificacoes",
      "lancamentos-resgatados",
      "relatorios",
      "usuarios",
      "permissoes",
      "minha-empresa",
      "mapa",
      "importacao",
      // Vieram de "Frota" em 24/09/2026: rastreamento e praças de pedágio são
      // do dia a dia de todo cliente, não de quem compra manutenção.
      "config-tracking",
      "pedagios",
    ],
  },
  {
    chave: "conferencia",
    nome: "Conferência",
    pitch: "Descarga suspeita, km atípico e a leitura do ticket por IA.",
    medido: true,
    recursos: ["conferencia-ticket", "config-km-atipico", "config-ia"],
  },
  {
    chave: "fechamento",
    nome: "Fechamento e conciliação",
    pitch:
      "Sobe a planilha do tomador, a IA acha as colunas e casa linha a linha com o que foi lançado.",
    recursos: ["fechamentos", "envios", "config-campos-layout"],
  },
  {
    chave: "comercial",
    nome: "Comercial",
    pitch: "Tabela de preço por cliente, mínimos por faixa e o faturamento do mês.",
    recursos: ["tabelas-preco", "regras-minimo"],
  },
  {
    chave: "financeiro",
    nome: "Financeiro",
    pitch: "O acerto do motorista e do agregado: o que ele ganhou, adiantou e deve.",
    recursos: ["acertos", "financeiro", "fornecedores", "custos-veiculo"],
  },
  {
    // Era "Frota" até 24/09/2026 (junto com rastreamento e pedágio, que foram
    // pro núcleo). Separado pra poder ser vendido: preço só depois do piloto.
    chave: "manutencao",
    nome: "Manutenção e vencimentos",
    pitch:
      "Revisão por km ou data, o aviso do motorista virando conserto, documentos e multas com prazo, e quanto custa cada caminhão.",
    recursos: ["manutencao", "pneus", "multas", "documentos-veiculo"],
  },
  {
    chave: "torre",
    nome: "Torre de controle",
    pitch: "Pedido do cliente, programação do dia e a viagem acompanhada ao vivo.",
    recursos: ["pedidos", "programacao", "torre", "config-torre"],
  },
  {
    chave: "fiscal",
    nome: "Fiscal",
    adicional: true,
    pitch:
      "O CT-e sai daqui, com os dados da viagem que já estão no sistema. Acaba a digitação dupla no emissor.",
    recursos: ["cte", "config-cte"],
  },
  {
    chave: "comunicacao",
    nome: "Comunicação",
    pitch: "Chat dos motoristas, avisos e o WhatsApp da operação.",
    medido: true,
    recursos: ["chat", "whatsapp", "config-agente"],
  },
  {
    // Juntar os papéis que a empresa exige antes de o motorista rodar.
    chave: "admissao",
    nome: "Admissão de motorista",
    pitch:
      "Um link que o motorista ou o dono do caminhão abre pra mandar os documentos, e o painel dizendo quem falta.",
    recursos: ["documentos-exigidos", "coletas"],
  },
  {
    // Controle de jornada de FUNCIONÁRIO REGISTRADO EM CARTEIRA.
    //
    // Aqui é empregado e a jornada é o assunto; o parceiro autônomo não bate
    // ponto. A mesma pessoa não pode ser as duas coisas, e quem garante isso é
    // o banco (`RegimeVigente`), não a boa vontade de quem cadastra.
    chave: "ponto",
    nome: "Ponto eletrônico",
    pitch:
      "Quem é registrado em carteira bate o ponto num toque, mesmo sem sinal, e recebe o comprovante. Você fecha o mês com o espelho pronto e cada correção com autor e motivo.",
    adicional: true,
    recursos: [
      "ponto",
      "funcionarios",
      "jornadas",
      "espelho-ponto",
      "correcoes-ponto",
      "fechamento-ponto",
      "config-ponto",
    ],
  },
  {
    chave: "plataforma",
    nome: "Ferramentas da plataforma",
    pitch: "O que é da Movatruck, não do cliente: erros, diagnóstico, captação, Instagram.",
    recursos: [
      "erros",
      "diagnosticos",
      "demandas",
      "prospeccao",
      "marketing",
      "config-forca-atualizacao",
    ],
  },
];

export const MODULOS_POR_CHAVE: Record<ModuloChave, ModuloDef> = Object.fromEntries(
  MODULOS.map((m) => [m.chave, m]),
) as Record<ModuloChave, ModuloDef>;

/** Recurso → módulo. É a tradução que faz o módulo viver por cima do RBAC. */
export const MODULO_DO_RECURSO: Record<string, ModuloChave> = Object.fromEntries(
  MODULOS.flatMap((m) => m.recursos.map((r) => [r, m.chave])),
);

export function moduloDoRecurso(recurso: string): ModuloChave | undefined {
  return MODULO_DO_RECURSO[recurso];
}

/** Módulo de uma chave de permissão ("viagens.editar" → "operacao"). */
export function moduloDaChave(chave: string): ModuloChave | undefined {
  return moduloDoRecurso(chave.split(".")[0] ?? "");
}

/** Os módulos que toda conta nova recebe. Núcleo + o que não custa por uso. */
export const MODULOS_PADRAO: ModuloChave[] = MODULOS.filter(
  (m) => m.nucleo || (!m.medido && !m.adicional && m.chave !== "plataforma"),
).map((m) => m.chave);

/**
 * Recursos do catálogo que não pertencem a módulo nenhum.
 *
 * Usado pelo teste de invariante: recurso órfão significa que alguém criou uma
 * tela e esqueceu de dizer o que o cliente está comprando — e aí ela ficaria
 * fora de qualquer contrato, visível pra todo mundo ou pra ninguém, conforme o
 * humor do guard. É esse teste, e não a disciplina de ninguém, que mantém o
 * catálogo honesto daqui a vinte módulos.
 */
export function recursosOrfaos(): string[] {
  return RESOURCE_DEFS_PUBLICO.map((r) => r.recurso).filter((r) => !MODULO_DO_RECURSO[r]);
}

/** Recursos declarados em mais de um módulo — ambiguidade de contrato. */
export function recursosDuplicados(): string[] {
  const vistos = new Set<string>();
  const dup = new Set<string>();
  for (const m of MODULOS) {
    for (const r of m.recursos) {
      if (vistos.has(r)) dup.add(r);
      vistos.add(r);
    }
  }
  return [...dup];
}

/** Código de erro do 403 de módulo. Separado do 403 comum de propósito. */
export const CODIGO_MODULO_NAO_CONTRATADO = "MODULO_NAO_CONTRATADO";

/**
 * A UI precisa distinguir "você não pode" de "a empresa não contratou": a
 * primeira manda falar com o administrador, a segunda manda falar com a gente.
 * Sem código próprio, as duas viram a mesma tela cinza e a segunda nunca vira
 * conversa comercial.
 */
export type ErroModuloNaoContratado = {
  code: typeof CODIGO_MODULO_NAO_CONTRATADO;
  modulo: ModuloChave;
  nomeModulo: string;
  pitch: string;
};
