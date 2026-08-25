import { StatusViagem } from "@prisma/client";

/**
 * Quem decide se uma viagem já entra APROVADA, sem passar por conferência.
 *
 * O caso que motivou: concreto não gera ticket de pesagem. O material já tinha
 * `temComprovanteFoto = false`, então a foto não era cobrada — mas a viagem
 * nascia `ENVIADA` e ficava parada na fila de conferência humana esperando um
 * aval que ninguém tem motivo pra dar. Não há papel, não há o que conferir.
 *
 * Vale registrar o que NÃO era o problema: o conferente automático já ignorava
 * essas viagens (`porQueNaoConferir` recusa "sem foto de ticket" antes de tudo).
 * O robô nunca leu concreto e nunca custou nada. Quem segurava era o contador
 * "a conferir" do painel, que conta `revisadoEm: null`.
 *
 * Aritmética pura, sem Prisma e sem Nest, no mesmo espírito de `exige-foto.ts` —
 * e como lá, **nunca lança**: entrada estranha vira "não dispensa", que é o
 * comportamento de sempre.
 */

export type ContextoDispensaConferencia = {
  /** `Material.dispensaConferencia` — false/ausente = conferir como sempre. */
  materialDispensa?: boolean | null;
  /**
   * O status que a viagem teria se esta regra não existisse. É o guarda-corpo:
   * só uma viagem que ia ficar COMPLETA e esperando conferência pode ser
   * dispensada.
   */
  statusDesejado: StatusViagem;
};

/**
 * Status em que dispensar seria errado, cada um por um motivo diferente.
 *
 * - `INCOMPLETA`: o servidor aceitou o lançamento faltando dado essencial (km,
 *   local de descarga, cliente, cadastro que sumiu) e carimbou o que falta em
 *   `ViagemDivergencia`. É EXATAMENTE o caso que precisa de gente olhando —
 *   aprovar aqui esconderia o buraco dentro do faturamento.
 * - `AGUARDANDO_PESO` / `AGUARDANDO_SAIDA`: a viagem ainda não terminou. A
 *   aprovação vem quando ela se completar, pelos caminhos de `completarPeso` e
 *   `encerrarDiaria` — que passam por aqui de novo.
 * - `EM_ANDAMENTO`: lifecycle guiado aberto, metade dos campos pode estar nula.
 * - `DIVERGENTE` / `OK` / `AJUSTADA` / `EM_CONFERENCIA`: já houve decisão sobre
 *   a viagem. Robô não passa por cima de gente.
 */
const SO_DISPENSA_SE_DESEJADO_FOR = StatusViagem.ENVIADA;

/**
 * A viagem pode entrar aprovada?
 *
 * Precisa das DUAS coisas: o material dispensar, e a viagem estar completa. A
 * segunda condição é o que impede a flag de virar um atalho para dado faltando
 * entrar no fechamento sem ninguém ver.
 */
export function dispensaConferencia(ctx: ContextoDispensaConferencia): boolean {
  if (ctx.materialDispensa !== true) return false;
  if (ctx.statusDesejado !== SO_DISPENSA_SE_DESEJADO_FOR) return false;
  return true;
}

/**
 * Os campos que a viagem recebe quando é dispensada.
 *
 * `revisadoEm` é o que tira a viagem do contador "a conferir" E o que faz o
 * `FechamentoProcessor` preservar o status em vez de sobrescrever no match.
 * É deliberado — e é o campo mais sensível do projeto.
 *
 * Vem sempre com `conferenciaDispensadaEm` ao lado, pela mesma razão que a
 * conferência automática escreve `conferidoPorIaEm`: sozinho, `revisadoEm` diria
 * "alguém revisou" sem dizer quem, o que é pior que não aprovar. E
 * `revisadoPorId` NUNCA é preenchido — não há User por trás disto.
 */
export function carimbosDaDispensa(agora: Date) {
  return {
    status: StatusViagem.OK,
    revisadoEm: agora,
    conferenciaDispensadaEm: agora,
  } as const;
}

/** O texto que vai pro chat da viagem. O motorista lê isto no app dele. */
export function textoDispensa(materialNome: string | null | undefined): string {
  const nome = materialNome?.trim() || "Este material";
  return (
    `${nome} não gera ticket de pesagem, então esta viagem não precisa de ` +
    "conferência — foi aceita direto. Não falta nada da sua parte."
  );
}
