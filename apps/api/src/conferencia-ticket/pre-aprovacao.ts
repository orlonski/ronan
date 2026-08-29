/**
 * A segunda opinião do sistema antes de aprovar uma viagem sozinho.
 *
 * A conferência de ticket olha o PAPEL: o que está impresso bate com o que foi
 * lançado. Isso responde "a carga é essa?" — e não responde "a viagem é essa?".
 * Um ticket perfeitamente legível continua compatível com um km fora de
 * qualquer padrão do trajeto ou com um pedágio que ninguém lançou; nenhum dos
 * dois aparece no documento.
 *
 * Então quem aprova sozinho olha os dois lados. Este arquivo é o segundo: a
 * viagem em si, comparada com o que a frota já rodou no mesmo par de locais.
 *
 * Como no resto da conferência, a decisão é FUNÇÃO PURA: entra o que foi
 * medido, sai o veredito. Dá pra testar toda calibragem sem banco, sem rede e
 * sem token — e mudar a régua não passa perto de prompt nenhum.
 *
 * A regra que governa o arquivo: **não saber é motivo pra NÃO aprovar.** Aqui
 * o silêncio custa caro — aprovar errado passa dinheiro adiante e ninguém
 * revisa o que já está aprovado. Quando falta referência, a viagem só deixa de
 * ser aprovada sozinha: ela continua na fila de quem confere, exatamente onde
 * já estaria se nada disso existisse.
 */

export type SinaisKm = {
  /**
   * O carimbo `Viagem.kmForaDoPadrao`. `null` NÃO é "está tudo bem": é "não deu
   * pra avaliar" (sem par de locais, com trechos, sem amostra e sem OSRM, km
   * abaixo do mínimo avaliado ou detecção desligada).
   */
  foraDoPadrao: boolean | null;
  /** `kmAceitoEm`: um humano já olhou este km e disse que está certo. */
  aceitoPorHumano: boolean;
  desvioPct: number | null;
  referencia: number | null;
};

export type SinaisPedagio = {
  /**
   * Quantas praças a rota desta viagem atravessa. `null` = não deu pra saber
   * (sem geometria, sem roteador) — que é diferente de `0` = checou e não passa
   * por nenhuma.
   */
  pracas: number | null;
  /** `Viagem.valorPedagioTotal`. */
  valorInformado: number | null;
  /** Mediana do valor lançado nas outras viagens do mesmo par. */
  mediana: number | null;
  amostra: number;
};

export type SinaisPreAprovacao = { km: SinaisKm; pedagio: SinaisPedagio };

export type LimiaresPreAprovacao = {
  exigirKmNoPadrao: boolean;
  exigirPedagioCoerente: boolean;
  /** Régua de desvio do valor de pedágio contra a mediana do par, em %. */
  desvioPedagioPct: number;
  /** Abaixo disto a mediana de pedágio não é afirmável — e não bloqueia. */
  amostraMinimaPedagio: number;
};

export type PreAprovacao = {
  aprova: boolean;
  /** Por que NÃO aprovou. Vai pro log, pra dar pra calibrar depois. */
  motivo: string | null;
  /** O que foi verificado, em frases prontas pro chat da viagem. */
  resumo: string[];
};

const fmtKm = (n: number): string => `${n.toFixed(1).replace(".", ",")} km`;

const fmtReal = (n: number): string => `R$ ${n.toFixed(2).replace(".", ",")}`;

const fmtPct = (n: number): string => `${Math.abs(n).toFixed(0)}%`;

const pracas = (n: number): string => (n === 1 ? "1 praça" : `${n} praças`);

/**
 * A viagem em si sustenta uma aprovação automática?
 *
 * Cada checagem tem chave própria pra ser desligada sozinha: uma empresa que
 * não cadastrou praça de pedágio nenhuma não pode ficar sem aprovar nada por
 * causa disso — mas quem desliga faz isso de propósito, não por descuido.
 */
export function avaliarPreAprovacao(
  s: SinaisPreAprovacao,
  limiares: LimiaresPreAprovacao,
): PreAprovacao {
  const resumo: string[] = [];
  const recusar = (motivo: string): PreAprovacao => ({ aprova: false, motivo, resumo });

  if (limiares.exigirKmNoPadrao && !s.km.aceitoPorHumano) {
    if (s.km.foraDoPadrao === true) {
      const quanto =
        s.km.desvioPct != null && s.km.referencia != null
          ? ` (${fmtPct(s.km.desvioPct)} ${s.km.desvioPct > 0 ? "acima" : "abaixo"} dos ${fmtKm(s.km.referencia)} de referência)`
          : "";
      return recusar(`km fora do padrão do trajeto${quanto}`);
    }
    if (s.km.foraDoPadrao === null) {
      // Sem referência não dá pra dizer que o km está na média — e dizer que
      // está sem ter comparado é justamente o erro que não se pode cometer aqui.
      return recusar("km sem referência pra comparar neste trajeto");
    }
    resumo.push(
      s.km.referencia != null
        ? `Km na média do trajeto (referência ${fmtKm(s.km.referencia)}).`
        : "Km dentro do padrão do trajeto.",
    );
  }

  if (limiares.exigirPedagioCoerente) {
    const { pracas: n, valorInformado, mediana, amostra } = s.pedagio;

    if (n === null) return recusar("não deu pra saber se a rota passa por praça de pedágio");

    if (n === 0) {
      resumo.push("A rota não passa por praça de pedágio.");
    } else if (valorInformado == null || valorInformado <= 0) {
      return recusar(`a rota passa por ${pracas(n)} e a viagem está sem valor de pedágio`);
    } else if (mediana != null && mediana > 0 && amostra >= limiares.amostraMinimaPedagio) {
      const desvio = ((valorInformado - mediana) / mediana) * 100;
      if (Math.abs(desvio) > limiares.desvioPedagioPct) {
        return recusar(
          `pedágio de ${fmtReal(valorInformado)} foge da média do trajeto ` +
            `(${fmtReal(mediana)} em ${amostra} viagens)`,
        );
      }
      resumo.push(
        `Pedágio de ${fmtReal(valorInformado)}, na média do trajeto ` +
          `(${fmtReal(mediana)} em ${amostra} viagens).`,
      );
    } else {
      // Sem amostra a mediana não afirma nada — e o que importava (passou por
      // praça, tem valor lançado) já está verificado.
      resumo.push(`Pedágio de ${fmtReal(valorInformado)} lançado para ${pracas(n)} na rota.`);
    }
  }

  return { aprova: true, motivo: null, resumo };
}
