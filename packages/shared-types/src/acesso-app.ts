import { z } from "zod";

/**
 * O QUE O MOTORISTA PODE FAZER NO APP — o catálogo, num lugar só.
 *
 * ⚠️ Existe porque hoje quem cadastra um motorista responde TREZE perguntas de
 * sim/não, uma por uma, pra cada pessoa. Ninguém responde treze perguntas com
 * atenção: responde no automático. E foi assim que três tabelas de padrão
 * passaram a discordar entre si — o banco dizendo que nasce desligado, o
 * painel entregando ligado, o app assumindo um terceiro valor.
 *
 * O catálogo aqui é a espinha: o painel monta a tela a partir dele, o perfil
 * guarda os valores, e flag nova aparece nos dois lugares sozinha. Sem isto,
 * acrescentar um acesso é lembrar de três arquivos.
 *
 * ⚠️ O que NÃO entra aqui: `aceitaPush`, `aceitaWhatsapp` e
 * `receberResumoDiario`. Aquilo é escolha DA PESSOA sobre ser incomodada, não
 * acesso que a empresa concede — e misturar as duas coisas numa tela só faria
 * o escritório decidir, por perfil, se o motorista quer receber notificação.
 */

/** Uma capacidade do app. A chave é a coluna no `Motorista`. */
export type AcessoAppDef = {
  /** A chave é a coluna no `Motorista` e no `PerfilAcessoApp`. */
  chave: AcessoAppChave;
  /** Como o escritório chama isso. Nunca o nome da coluna. */
  label: string;
  /** O que muda NO APP DELE quando está ligado. Aparece embaixo do rótulo. */
  efeito: string;
  grupo: "Lançar" | "Viagem guiada" | "Conveniências" | "Convívio" | "Diária";
  /**
   * Custa dinheiro por uso.
   *
   * ⚠️ Marcado porque o OCR chama IA a cada foto, e o painel antigo o entregava
   * LIGADO por omissão — o operador acendia um custo recorrente sem ver.
   */
  custa?: boolean;
};

const DEFS = [
  {
    chave: "podeLancarViagem",
    label: "Lançar viagem",
    efeito: "Sem isto ele não registra viagem nenhuma pelo app.",
    grupo: "Lançar",
  },
  {
    chave: "podeLancarAbastecimento",
    label: "Lançar abastecimento",
    efeito: "Registrar litros, valor e odômetro no posto.",
    grupo: "Lançar",
  },
  {
    chave: "podeLancarPedagio",
    label: "Lançar pedágio",
    efeito: "Registrar o pedágio pago na estrada, pra entrar no acerto.",
    grupo: "Lançar",
  },
  {
    chave: "podeViagemLifecycle",
    label: "Viagem guiada",
    efeito:
      "O app acompanha a viagem do início ao fim, e é o que alimenta a torre de controle.",
    grupo: "Viagem guiada",
  },
  {
    chave: "podeIniciarViagem",
    // ⚠️ Chamava "Navegação ao vivo", e não é: no app este acesso liga o botão
    // "Iniciar viagem com GPS" (o acompanhamento clássico). A navegação por
    // voz não depende dele. O escritório ligava achando que dava mapa e voz.
    label: "Iniciar viagem com GPS",
    efeito: "Botão pra começar a viagem com o GPS acompanhando o trajeto até o fim.",
    grupo: "Viagem guiada",
  },
  {
    chave: "podeUsarOcrTicket",
    label: "Ler o ticket por foto",
    efeito:
      "A foto do ticket já vem preenchida pra ele conferir, em vez de digitar tudo.",
    grupo: "Conveniências",
    custa: true,
  },
  {
    chave: "podeReferenciaKm",
    label: "Mostrar o km de sempre",
    efeito:
      "Ao escolher carga e descarga, o app mostra o que a frota costuma rodar nesse trajeto.",
    grupo: "Conveniências",
  },
  {
    chave: "podeVerTodosLocais",
    label: "Buscar local pelo nome",
    efeito:
      "Além dos locais perto do GPS, ele acha qualquer um digitando o nome.",
    grupo: "Conveniências",
  },
  {
    chave: "podeTelemetria",
    label: "Gravar o uso da tela",
    efeito:
      "Registra o que ele tocou na tela de lançamento — serve pra investigar erro de uso, não pra vigiar.",
    grupo: "Conveniências",
  },
  {
    chave: "podeChat",
    label: "Conversar com os outros motoristas",
    efeito: "A aba de conversas do app.",
    grupo: "Convívio",
  },
  {
    chave: "podeVerStories",
    label: "Ver e postar stories",
    efeito: "A barra de fotos de 24h na tela inicial dele.",
    grupo: "Convívio",
  },
  {
    chave: "podeDiaria",
    label: "Lançar diária",
    efeito:
      "Escolher o modo por período e marcar entrada e saída em vez de peso. Com um modo de serviço só cadastrado, o app nem pergunta.",
    grupo: "Diária",
  },
  {
    chave: "podeVerValorDiaria",
    label: "Ver quanto vale a diária dele",
    efeito: "O valor em R$ aparece na conta de diárias do app.",
    grupo: "Diária",
  },
] as const;

export type AcessoAppChave = (typeof DEFS)[number]["chave"];

/**
 * ⚠️ Exportado JÁ TIPADO, e não como `as const` cru: sem isto, o elemento que
 * não declara `custa` não tem a propriedade no tipo, e a tela não consegue nem
 * PERGUNTAR se aquele acesso custa dinheiro — que é exatamente o aviso que
 * precisa aparecer.
 */
export const ACESSOS_APP: readonly AcessoAppDef[] = DEFS;

export const ACESSOS_APP_CHAVES = DEFS.map((a) => a.chave) as AcessoAppChave[];

/** Os grupos na ordem em que a tela mostra. */
export const ACESSOS_APP_GRUPOS = ["Lançar", "Viagem guiada", "Conveniências", "Convívio", "Diária"] as const;

/** O conjunto de acessos — o que um perfil guarda e o que um motorista tem. */
export type AcessosApp = Record<AcessoAppChave, boolean>;

const acessosShape = Object.fromEntries(
  ACESSOS_APP_CHAVES.map((c) => [c, z.boolean()]),
) as Record<AcessoAppChave, z.ZodBoolean>;

export const AcessosAppSchema = z.object(acessosShape);

export const SalvarPerfilAcessoInput = z.object({
  nome: z.string().trim().min(2).max(60),
  descricao: z.string().trim().max(200).optional().nullable(),
  /**
   * Regime que este perfil costuma servir. **Só sugere no cadastro.**
   *
   * ⚠️ Nunca decide. O regime é sobre PAGAMENTO (diária/produção × folha), e o
   * motorista CLT da própria transportadora dirige e lança viagem — é o caso
   * mais comum de quem compra o módulo de ponto. Amarrar "empregado logo não
   * lança" trancaria a porta dele.
   */
  sugeridoPara: z.enum(["PARCEIRO", "EMPREGADO"]).optional().nullable(),
  acessos: AcessosAppSchema,
});
export type SalvarPerfilAcessoInput = z.infer<typeof SalvarPerfilAcessoInput>;

/**
 * As diferenças entre o que a pessoa tem e o que o perfil dela manda.
 *
 * ⚠️ É a peça que impede a exceção de virar regra por acidente. Sem mostrar
 * isto, em seis meses ninguém sabe mais por que o João tem um acesso que os
 * outros do mesmo perfil não têm — e aí ninguém mexe em nada, com medo.
 */
export function diferencasDoPerfil(
  pessoa: Partial<AcessosApp>,
  perfil: Partial<AcessosApp> | null | undefined,
): { chave: AcessoAppChave; label: string; pessoa: boolean; perfil: boolean }[] {
  if (!perfil) return [];
  const out: { chave: AcessoAppChave; label: string; pessoa: boolean; perfil: boolean }[] = [];
  for (const def of ACESSOS_APP) {
    const p = pessoa[def.chave] ?? false;
    const base = perfil[def.chave] ?? false;
    if (p !== base) out.push({ chave: def.chave, label: def.label, pessoa: p, perfil: base });
  }
  return out;
}
