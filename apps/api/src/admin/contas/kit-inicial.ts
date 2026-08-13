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
];
