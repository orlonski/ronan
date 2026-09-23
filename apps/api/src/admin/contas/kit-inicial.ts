import type { Prisma } from "@prisma/client";

/**
 * O que uma empresa nova recebe no dia zero.
 *
 * Sem isto ela entraria numa tela vazia: sem papel não dá pra criar usuário, sem
 * tipo de evento o fluxo guiado de viagem não abre, sem campo de layout o
 * fechamento não monta. O kit é um ponto de partida editável — a empresa
 * renomeia, desativa e acrescenta o que quiser depois.
 *
 * Estes valores espelham o que a Schaba usa hoje, que é o desenho já validado em
 * produção. Materiais são os genéricos do ramo; os específicos de cliente
 * (marcas, siglas internas) ficam de fora de propósito.
 */

/**
 * As modalidades de motorista que toda empresa recebe (decisão do dono,
 * 22/09/2026): os três vínculos do mercado. São o ponto de partida da tela
 * "Permissões do app" — cada uma vira um tipo ali. Dado, não regra: a empresa
 * renomeia, desliga e cria as dela em Vínculos do motorista.
 *
 * Nascem SEM régua de pagamento e sem exigir foto (os padrões do banco): só o
 * rótulo. Pagamento e fotos são a empresa que configura.
 */
export const MODALIDADES_INICIAIS = [
  { slug: "autonomo-tac", nome: "Autônomo (TAC)", ordem: 1 },
  { slug: "agregado", nome: "Agregado", ordem: 2 },
  { slug: "empregado-clt", nome: "Empregado CLT", ordem: 3 },
] as const;

/** Materiais comuns de quem transporta agregado. */
export const MATERIAIS_INICIAIS = [
  "Areia",
  "Areia Média",
  "Brita 0",
  "Brita 1",
  "Pó de Pedra",
  "Saibro",
  "Terra",
  "Entulho",
] as const;

/**
 * As ocorrências — o que dá errado.
 *
 * A espinha acima só sabe contar o dia que correu bem. Nada respondia "fiquei
 * 3h na fila", "a obra recusou a carga" ou "quebrei na BR-376", que são
 * exatamente as conversas que a transportadora tem com o embarcador toda semana.
 *
 * `valorHora` nasce VAZIO de propósito nas que geram cobrança: o preço da hora
 * parada é combinado por contrato, e chutar um número aqui colocaria uma
 * cobrança inventada dentro de um fechamento real. O sistema conta as horas
 * desde já; o valor aparece quando alguém preencher.
 */
export const TIPOS_OCORRENCIA_INICIAIS: Prisma.TipoEventoViagemCreateManyContaInput[] = [
  {
    slug: "fila-carga",
    nome: "Fila para carregar",
    ordem: 20,
    repetivel: true,
    ehOcorrencia: true,
    severidade: "MEDIA",
    temDuracao: true,
    geraCobranca: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "fila-descarga",
    nome: "Fila para descarregar",
    ordem: 21,
    repetivel: true,
    ehOcorrencia: true,
    severidade: "MEDIA",
    temDuracao: true,
    geraCobranca: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "aguardando-liberacao",
    nome: "Aguardando liberação ou documento",
    ordem: 22,
    repetivel: true,
    ehOcorrencia: true,
    severidade: "MEDIA",
    temDuracao: true,
    geraCobranca: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "sem-produto",
    nome: "Sem produto no local",
    ordem: 23,
    repetivel: true,
    ehOcorrencia: true,
    severidade: "ALTA",
    temDuracao: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "carga-recusada",
    nome: "Carga recusada",
    ordem: 24,
    repetivel: true,
    ehOcorrencia: true,
    severidade: "ALTA",
    pedeGps: true,
    pedeFoto: true,
    pedeObservacao: true,
  },
  {
    slug: "quebra",
    nome: "Quebra do veículo",
    ordem: 25,
    repetivel: true,
    ehOcorrencia: true,
    severidade: "ALTA",
    temDuracao: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "pneu",
    nome: "Problema de pneu",
    ordem: 26,
    repetivel: true,
    ehOcorrencia: true,
    severidade: "MEDIA",
    temDuracao: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "acidente",
    nome: "Acidente",
    ordem: 27,
    repetivel: true,
    ehOcorrencia: true,
    severidade: "ALTA",
    pedeGps: true,
    pedeFoto: true,
    pedeObservacao: true,
  },
];

/**
 * A espinha da viagem guiada ("Iniciar viagem"). A ordem é a sequência que o
 * motorista vê, e `obrigatorio` trava o "Finalizar" enquanto não acontecer.
 */
export const TIPOS_EVENTO_INICIAIS: Prisma.TipoEventoViagemCreateManyContaInput[] = [
  {
    slug: "cheguei-carga",
    nome: "Cheguei no local de carga",
    ordem: 1,
    obrigatorio: true,
    ehCarga: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "carreguei",
    nome: "Carreguei",
    ordem: 2,
    obrigatorio: true,
    pedeGps: true,
    pedeFoto: true,
    pedeToneladas: true,
    pedeTicket: true,
    pedeObservacao: true,
  },
  {
    slug: "sai-carga",
    nome: "Saí do local de carga",
    ordem: 3,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "parada",
    nome: "Parei no caminho",
    ordem: 4,
    repetivel: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "paguei-pedagio",
    nome: "Paguei pedágio",
    ordem: 5,
    repetivel: true,
    pedeGps: true,
    pedeValor: true,
    pedeObservacao: true,
  },
  {
    slug: "cheguei-descarga",
    nome: "Cheguei no local de descarga",
    ordem: 6,
    obrigatorio: true,
    ehDescarga: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  {
    slug: "descarreguei",
    nome: "Descarreguei",
    ordem: 7,
    obrigatorio: true,
    pedeGps: true,
    pedeObservacao: true,
  },
  ...TIPOS_OCORRENCIA_INICIAIS,
];

/**
 * Modos de serviço (como a viagem é medida). O kit traz SÓ o frete por
 * tonelada, marcado como padrão.
 *
 * ⚠️ Isso é deliberado e é o que garante compatibilidade: com um único modo
 * cadastrado, o app nem mostra o seletor e a conta se comporta exatamente como
 * antes desta feature existir. Quem quiser diária cadastra o modo no painel.
 */
export const TIPOS_SERVICO_INICIAIS: Prisma.TipoServicoCreateManyContaInput[] = [
  {
    slug: "frete",
    nome: "Frete por tonelada",
    ordem: 1,
    padrao: true,
  },
];
