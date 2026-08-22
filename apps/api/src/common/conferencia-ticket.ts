/**
 * O "cara-crachá": compara o que o motorista DECLAROU com o que foi lido da
 * foto do ticket.
 *
 * Regra que governa este arquivo: **a IA só lê; quem julga é este código.** A
 * leitura entra como dado bruto e sai daqui como veredito — e por isso a
 * decisão é testável sem rede, sem banco e sem token, e o limiar se ajusta sem
 * mexer em prompt.
 *
 * A segunda regra, que vale mais que todas as tolerâncias juntas: **na dúvida,
 * humano decide — nunca o motorista é cobrado.** Erro de OCR acusando motorista
 * honesto é o pior desfecho possível deste projeto, porque a confiança dele não
 * se recupera com deploy.
 */

/** Campos que se confere num ticket de pesagem. */
export type CampoConferido =
  | "toneladas"
  | "ticket"
  | "placa"
  | "data"
  | "cliente"
  | "material";

/**
 * ALTA é o que vira dinheiro ou troca a viagem de caminhão. MEDIA é o que
 * merece um olho humano mas não justifica incomodar quem está na estrada.
 */
export type Gravidade = "ALTA" | "MEDIA";

export type Divergencia = {
  campo: CampoConferido;
  declarado: string;
  lido: string;
  gravidade: Gravidade;
  /** Frase pronta, escrita pra quem confere. */
  detalhe: string;
};

/**
 * Campo cuja leitura não dá pra confiar (provável erro de OCR) — nunca vira
 * divergência, sempre vira revisão humana.
 */
export type Incerteza = {
  campo: CampoConferido;
  declarado: string;
  lido: string;
  motivo: string;
};

export type Veredito =
  | "BATE"
  | "DIVERGE"
  | "INCERTO"
  /**
   * A foto não dá pra ler. Desfecho próprio porque a saída é outra: nenhum
   * conferente resolve olhando a mesma foto borrada — quem resolve é o
   * motorista mandando outra, e pra isso já existe caminho pronto no app.
   */
  | "ILEGIVEL"
  | "NAO_APLICAVEL";

/**
 * O parecer da IA, campo a campo.
 *
 * Existe porque comparar NOME é problema semântico, não de string. "BRONZE
 * PAVIMENTAÇÕES LTDA" e "Construtora Bronze" são a mesma empresa; "C.B.U.Q." e
 * "MASSA DE ASFALTO" são o mesmo material; e qual número identifica o documento
 * depende de ele ser ticket de balança ou nota fiscal. Nenhuma regra de texto
 * cobre isso — cada heurística que se acrescenta abre um buraco novo, e foi
 * exatamente o que aconteceu aqui, rodada após rodada.
 *
 * Então quem julga semântica é o modelo, que entende do assunto. O código fica
 * com o que é objetivo (o número do peso) e com as travas de segurança — que é
 * o que ele faz bem e de forma auditável.
 */
export type JulgamentoIa = Partial<
  Record<
    "numeroDocumento" | "toneladas" | "data" | "placa" | "cliente" | "material",
    { confere: "sim" | "nao" | "incerto"; porque: string }
  >
>;

export type Declarado = {
  toneladas?: number | null;
  ticket?: string | null;
  placa?: string | null;
  /** Data da viagem (só o dia importa). */
  data?: Date | string | null;
  clienteNome?: string | null;
  materialNome?: string | null;
  /**
   * Placas cadastradas na empresa. Sem esta lista não dá pra distinguir "o
   * ticket é de OUTRO caminhão da frota" (grave) de "não reconheci a placa"
   * (que costuma ser a carreta, ou leitura ruim).
   */
  placasConhecidas?: string[];
  /**
   * `false` quando não há peso pra conferir: viagem AGUARDANDO_PESO (o romaneio
   * sai no fim do dia), diária medida por período, material sem ticket.
   * Sem isto, `declarado: null` × `lido: 32` viraria DIVERGE e o sistema
   * cobraria TODO motorista que lançou sem romaneio.
   */
  pesoConferivel?: boolean;
};

export type Lido = {
  /** "ticket_balanca" | "nota_fiscal" | "romaneio" | "outro". */
  tipoDocumento?: string | null;
  toneladas?: number | null;
  ticket?: string | null;
  placa?: string | null;
  data?: string | null;
  clienteNome?: string | null;
  materialNome?: string | null;
  confianca: number;
};

export type LimiaresConferencia = {
  /** Abaixo disto a leitura não serve pra nada: vira revisão. */
  confiancaMinima: number;
  /** Só acima disto uma divergência ALTA pode chegar ao motorista. */
  confiancaParaAvisar: number;
  /** Diferença absoluta de peso tolerada, em toneladas. */
  toleranciaToneladas: number;
  /** Diferença relativa de peso tolerada (0.005 = 0,5%). */
  toleranciaPesoPct: number;
};

export const LIMIARES_PADRAO: LimiaresConferencia = {
  confiancaMinima: 0.6,
  confiancaParaAvisar: 0.8,
  // A balança imprime com precisão de dezena de quilo; 20 kg cobre
  // arredondamento sem deixar passar diferença que valha dinheiro.
  toleranciaToneladas: 0.02,
  toleranciaPesoPct: 0.003,
};

export type ResultadoConferencia = {
  veredito: Veredito;
  divergencias: Divergencia[];
  incertezas: Incerteza[];
  /** Campos que deu pra conferir de fato (os dois lados presentes). */
  conferidos: CampoConferido[];
};

// ─── normalização ────────────────────────────────────────────────────────────

/** Tira acento, pontuação e caixa. "C.B.U.Q FAIXA C" → "cbuqfaixac". */
export function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Rótulos que vêm grudados no número no ticket impresso, e que o motorista às
 * vezes digita junto: "Nº 3174", "TICKET 3174", "ROMANEIO 3174".
 *
 * Só são removidos quando o que sobra é todo numérico — ticket que
 * legitimamente começa com letra ("A-3174", "NF1234") não é tocado.
 */
const ROTULOS_TICKET = /^(NUMERO|NUM|ROMANEIO|TICKET|CONTROLE|SEQ|NO|N)(?=\d)/;

/**
 * Número de ticket comparável: sem pontuação, sem rótulo, sem zeros à esquerda.
 * "000-3174", "Nº 3.174" e "3174" são o mesmo ticket impresso de três jeitos.
 */
export function normalizarTicket(s: string): string {
  let limpo = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Uma passada só: "NO3174" perde o NO, e não faz sentido reaplicar.
  limpo = limpo.replace(ROTULOS_TICKET, "");
  return limpo.replace(/^0+(?=.)/, "");
}

/**
 * O NÚMERO do ticket, sem a série/prefixo que a balança imprime.
 *
 * "TKB-043625" e "043625" são o mesmo ticket: o motorista digita o número e a
 * impressora acrescenta a sigla do posto. Comparar as strings inteiras marcava
 * divergência em todo ticket de balança que usa prefixo — que é a maioria.
 *
 * Zeros à esquerda também saem: "043625" e "43625" são o mesmo número.
 */
export function nucleoNumericoTicket(s: string): string {
  const digitos = s.replace(/\D/g, "").replace(/^0+(?=.)/, "");
  return digitos;
}

/**
 * A parte alfabética do ticket — a série que a balança imprime ("TKB-043625").
 *
 * Serve pra saber se dá pra ignorar: quando só um dos lados tem série, ela foi
 * omitida na digitação. Quando os dois têm e são diferentes, é outro ticket.
 */
export function serieTicket(s: string): string {
  const letras = s.toUpperCase().replace(/[^A-Z]/g, "");
  return letras.replace(ROTULOS_TICKET_LETRAS, "");
}

/** Rótulo puro ("TICKET 043625") não é série — é etiqueta. */
const ROTULOS_TICKET_LETRAS = /^(NUMERO|NUM|ROMANEIO|TICKET|CONTROLE|SEQ|NO|N)$/;

/** Placa comparável: "ABC-1234", "abc 1234" e "ABC1234" viram o mesmo. */
export function normalizarPlaca(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Distância de edição, com corte cedo: só interessa saber se é 0, 1 ou "mais
 * que isso" — não vale percorrer a matriz inteira pra descobrir que são 9.
 */
export function distanciaEdicao(a: string, b: string, teto = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > teto) return teto + 1;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let melhorNaLinha = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
      atual.push(v);
      if (v < melhorNaLinha) melhorNaLinha = v;
    }
    // Nenhuma célula da linha ficou dentro do teto: não tem como melhorar.
    if (melhorNaLinha > teto) return teto + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

const soDia = (d: Date | string): string =>
  (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

const diasEntre = (a: string, b: string): number =>
  Math.abs(
    Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000),
  );

const fmtPeso = (n: number) => `${n.toFixed(2).replace(".", ",")} t`;

/**
 * Dois nomes que descrevem a mesma coisa? Serve pra dizer que o campo FOI
 * verificado, não pra acusar diferença.
 *
 * Um contido no outro cobre razão social ("CASTILHO" dentro de "CONSTRUTORA
 * CASTILHO") e qualificador de faixa ("CBUQ" dentro de "CBUQ FAIXA C").
 */
export function nomesCompativeis(a: string, b: string): boolean {
  const x = normalizarTexto(a);
  const y = normalizarTexto(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y));
}

// ─── peso ────────────────────────────────────────────────────────────────────

/**
 * Duas armadilhas que valem mais que o resto do arquivo, porque são a diferença
 * entre "o sistema pegou um erro" e "o sistema acusou um motorista honesto".
 *
 * O próprio prompt de leitura documenta que o erro recorrente do modelo é pegar
 * o peso BRUTO ou a TARA no lugar do líquido — e ticket de balança mostra os
 * três números lado a lado. Quando a razão entre lido e declarado cai na faixa
 * típica de bruto/líquido, isso é leitura ruim, não carga diferente.
 *
 * A outra é unidade: kg lido como tonelada erra por exatamente mil vezes.
 */
export function explicarPesoSuspeito(declarado: number, lido: number): string | null {
  if (declarado <= 0 || lido <= 0) return null;
  const razao = lido / declarado;

  if (razao > 100) return "a leitura parece estar em quilos, não em toneladas";
  if (razao < 0.01) return "a leitura parece estar em toneladas onde o declarado está em quilos";
  // Caminhão carregado pesa entre 1,3x e 2,2x a carga líquida — é a assinatura
  // de ter lido o bruto no lugar do líquido.
  if (razao >= 1.3 && razao <= 2.2) return "a leitura provavelmente pegou o peso bruto, não o líquido";
  // Tara costuma ficar entre 30% e 60% do líquido em carga cheia.
  if (razao >= 0.3 && razao <= 0.6) return "a leitura provavelmente pegou a tara, não o líquido";
  return null;
}

// ─── a comparação ────────────────────────────────────────────────────────────

export function compararDeclaradoComLido(
  declarado: Declarado,
  lido: Lido,
  limiares: LimiaresConferencia = LIMIARES_PADRAO,
): ResultadoConferencia {
  const divergencias: Divergencia[] = [];
  const incertezas: Incerteza[] = [];
  const conferidos: CampoConferido[] = [];

  // ── peso ──
  const podeConferirPeso =
    declarado.pesoConferivel !== false &&
    typeof declarado.toneladas === "number" &&
    typeof lido.toneladas === "number";

  if (podeConferirPeso) {
    const dec = declarado.toneladas as number;
    const lid = lido.toneladas as number;
    conferidos.push("toneladas");

    const tolerado = Math.max(limiares.toleranciaToneladas, dec * limiares.toleranciaPesoPct);
    if (Math.abs(dec - lid) > tolerado) {
      const suspeita = explicarPesoSuspeito(dec, lid);
      if (suspeita) {
        incertezas.push({
          campo: "toneladas",
          declarado: fmtPeso(dec),
          lido: fmtPeso(lid),
          motivo: suspeita,
        });
      } else {
        divergencias.push({
          campo: "toneladas",
          declarado: fmtPeso(dec),
          lido: fmtPeso(lid),
          gravidade: "ALTA",
          detalhe: `O ticket mostra ${fmtPeso(lid)} e a viagem foi lançada com ${fmtPeso(dec)}.`,
        });
      }
    }
  }

  // ── ticket ──
  if (declarado.ticket && lido.ticket) {
    conferidos.push("ticket");
    const dec = normalizarTicket(declarado.ticket);
    const lid = normalizarTicket(lido.ticket);

    // O número bate? Prefixo de série ("TKB-"), rótulo e zero à esquerda são
    // jeito de imprimir, não outro ticket.
    //
    // MAS: comparar só os dígitos abre um falso negativo — "A-3174" e "B-3174"
    // passariam por iguais, e aí o conferente deixa passar ticket trocado, que
    // é justamente o que ele existe pra pegar. Então a série só é ignorada
    // quando UM dos lados a omite (o motorista digitou só o número). Se os dois
    // trazem série e elas diferem, é outro ticket.
    const nDec = nucleoNumericoTicket(declarado.ticket);
    const nLid = nucleoNumericoTicket(lido.ticket);
    const sDec = serieTicket(declarado.ticket);
    const sLid = serieTicket(lido.ticket);
    const seriesCompativeis = !sDec || !sLid || sDec === sLid;
    const mesmoNumero = nDec.length >= 3 && nDec === nLid && seriesCompativeis;

    if (!mesmoNumero && dec !== lid) {
      // Um caractere de diferença em número longo é 0/O, 1/7, 5/S, 8/B — o pão
      // de cada dia de OCR. Não dá pra chamar o motorista de errado por isso.
      const perto = dec.length >= 4 && distanciaEdicao(dec, lid, 1) <= 1;
      if (perto) {
        incertezas.push({
          campo: "ticket",
          declarado: declarado.ticket,
          lido: lido.ticket,
          motivo: "diferença de um caractere — provável erro de leitura",
        });
      } else {
        divergencias.push({
          campo: "ticket",
          declarado: declarado.ticket,
          lido: lido.ticket,
          gravidade: "ALTA",
          detalhe: `O número no ticket é ${lido.ticket} e a viagem foi lançada como ${declarado.ticket}.`,
        });
      }
    }
  }

  // ── placa ──
  if (declarado.placa && lido.placa) {
    conferidos.push("placa");
    const dec = normalizarPlaca(declarado.placa);
    const lid = normalizarPlaca(lido.placa);
    if (dec !== lid) {
      const perto = distanciaEdicao(dec, lid, 1) <= 1;

      // Só é "viagem no caminhão errado" se a placa lida for de OUTRO veículo
      // da frota. Placa que não bate com ninguém costuma ser a carreta (o
      // ticket registra o reboque, o motorista lança o cavalo) ou leitura ruim
      // — e nenhum dos dois é motivo pra cobrar alguém.
      const conhecidas = (declarado.placasConhecidas ?? []).map(normalizarPlaca);
      const ehDeOutroVeiculo = conhecidas.length > 0 && conhecidas.includes(lid);

      if (perto || !ehDeOutroVeiculo) {
        incertezas.push({
          campo: "placa",
          declarado: declarado.placa,
          lido: lido.placa,
          motivo: perto
            ? "diferença de um caractere — provável erro de leitura"
            : conhecidas.length === 0
              ? "placa diferente da lançada"
              : "placa não é de nenhum veículo da frota — provável carreta ou leitura ruim",
        });
      } else {
        divergencias.push({
          campo: "placa",
          declarado: declarado.placa,
          lido: lido.placa,
          gravidade: "ALTA",
          detalhe: `O ticket é do veículo ${lido.placa}, que é outro caminhão da frota, e a viagem foi lançada no ${declarado.placa}.`,
        });
      }
    }
  }

  // ── data ──
  if (declarado.data && lido.data) {
    conferidos.push("data");
    const dec = soDia(declarado.data);
    const lid = soDia(lido.data);
    const dias = diasEntre(dec, lid);
    // Um dia de diferença é rotina: pesagem às 23h lançada no dia seguinte, ou
    // ticket com data de emissão diferente da data da viagem.
    if (dias >= 2) {
      divergencias.push({
        campo: "data",
        declarado: dec,
        lido: lid,
        gravidade: "MEDIA",
        detalhe: `O ticket é de ${lid} e a viagem foi lançada em ${dec} (${dias} dias de diferença).`,
      });
    }
  }

  // ── cliente e material: INFORMATIVOS, nunca divergência ──
  //
  // Aprendido na marra: numa rodada real, 100 de 103 viagens saíram
  // divergentes, e a maior parte era isto aqui. O ticket de balança quase nunca
  // usa o mesmo nome do cadastro —
  //
  //   cadastro "CASTILHO"          ticket "CONSTRUTORA CASTILHO"
  //   cadastro "MASSA DE ASFALTO"  ticket "C.B.U.Q. FAIXA C"
  //
  // — e as duas linhas estão CERTAS. A primeira é razão social, a segunda é o
  // nome técnico do mesmo produto. Comparar esses nomes como se fossem chave
  // gera ruído, e conferente que aponta tudo não poupa trabalho nenhum.
  //
  // Quem manda no vínculo é o cadastro que o motorista escolheu, não o texto
  // impresso. Então estes campos aparecem no card pra quem confere olhar, e
  // ficam fora do veredito.
  for (const campo of ["cliente", "material"] as const) {
    const dec = campo === "cliente" ? declarado.clienteNome : declarado.materialNome;
    const lid = campo === "cliente" ? lido.clienteNome : lido.materialNome;
    if (!dec || !lid) continue;
    if (nomesCompativeis(dec, lid)) conferidos.push(campo);
  }

  return {
    veredito: decidirVeredito(divergencias, incertezas, conferidos, lido.confianca, limiares),
    divergencias,
    incertezas,
    conferidos,
  };
}


/**
 * Decide a partir do parecer da IA, mantendo as travas que o código faz melhor.
 *
 * Divisão de trabalho: o modelo julga semântica (nome de empresa, nome de
 * material, qual número identifica o documento) porque isso não cabe em regra
 * de texto. O código guarda três coisas que não se delega:
 *
 *   1. o PESO é conferido no número, aqui, porque é aritmética e é o que vira
 *      dinheiro — e as armadilhas de bruto/tara e de unidade são conhecidas;
 *   2. leitura fraca invalida qualquer conclusão, inclusive a de que está tudo
 *      certo;
 *   3. só peso e documento podem chegar ao motorista. Nome de cliente e de
 *      material, mesmo com "nao" da IA, param na revisão humana — errar aí é
 *      barato pra nós e caro pra ele.
 */
export function conferirComJulgamento(
  declarado: Declarado,
  lido: Lido,
  julgamento: JulgamentoIa,
  limiares: LimiaresConferencia = LIMIARES_PADRAO,
): ResultadoConferencia {
  const divergencias: Divergencia[] = [];
  const incertezas: Incerteza[] = [];
  const conferidos: CampoConferido[] = [];

  // ── peso: número, e portanto do código ──
  const podeConferirPeso =
    declarado.pesoConferivel !== false &&
    typeof declarado.toneladas === "number" &&
    typeof lido.toneladas === "number";

  if (podeConferirPeso) {
    const dec = declarado.toneladas as number;
    const lid = lido.toneladas as number;
    conferidos.push("toneladas");
    const tolerado = Math.max(limiares.toleranciaToneladas, dec * limiares.toleranciaPesoPct);

    if (Math.abs(dec - lid) > tolerado) {
      const suspeita = explicarPesoSuspeito(dec, lid);
      if (suspeita) {
        incertezas.push({ campo: "toneladas", declarado: fmtPeso(dec), lido: fmtPeso(lid), motivo: suspeita });
      } else if (julgamento.toneladas?.confere === "sim") {
        // A IA viu o papel e diz que confere apesar do número. Pode ter lido
        // uma linha diferente da que usou pra julgar — não é o bastante pra
        // acusar, mas também não é pra ignorar.
        incertezas.push({
          campo: "toneladas",
          declarado: fmtPeso(dec),
          lido: fmtPeso(lid),
          motivo: julgamento.toneladas.porque || "a leitura diz que confere, mas os números não fecham",
        });
      } else {
        divergencias.push({
          campo: "toneladas",
          declarado: fmtPeso(dec),
          lido: fmtPeso(lid),
          gravidade: "ALTA",
          detalhe: `O documento mostra ${fmtPeso(lid)} e a viagem foi lançada com ${fmtPeso(dec)}.`,
        });
      }
    }
  }

  // ── os demais campos: parecer da IA ──
  const mapa: { campo: CampoConferido; chave: keyof JulgamentoIa; dec?: string | null; lid?: string | null; grave: boolean }[] = [
    { campo: "ticket", chave: "numeroDocumento", dec: declarado.ticket, lid: lido.ticket, grave: true },
    { campo: "placa", chave: "placa", dec: declarado.placa, lid: lido.placa, grave: false },
    { campo: "data", chave: "data", dec: declarado.data ? soDia(declarado.data) : null, lid: lido.data, grave: false },
    { campo: "cliente", chave: "cliente", dec: declarado.clienteNome, lid: lido.clienteNome, grave: false },
    { campo: "material", chave: "material", dec: declarado.materialNome, lid: lido.materialNome, grave: false },
  ];

  for (const { campo, chave, dec, lid, grave } of mapa) {
    const parecer = julgamento[chave];
    if (!parecer || !dec) continue;
    conferidos.push(campo);

    if (parecer.confere === "sim") continue;

    const registro = { campo, declarado: dec, lido: lid ?? "—" };
    if (parecer.confere === "nao" && grave) {
      divergencias.push({
        ...registro,
        gravidade: "ALTA",
        detalhe: parecer.porque || `O documento não corresponde ao que foi lançado em ${campo}.`,
      });
    } else {
      // "nao" em campo não-grave também para aqui: nome de cliente ou material
      // é onde a leitura mais erra, e onde acusar sai mais caro que conferir.
      incertezas.push({ ...registro, motivo: parecer.porque || "não deu pra confirmar" });
    }
  }

  return {
    veredito: decidirVeredito(divergencias, incertezas, conferidos, lido.confianca, limiares),
    divergencias,
    incertezas,
    conferidos,
  };
}

/**
 * A faixa de confiança, escrita como função.
 *
 * Só um caso chega ao motorista: divergência ALTA lida com confiança alta. Todo
 * o resto — inclusive divergência MEDIA com leitura ótima — para na revisão
 * humana do painel.
 */
export function decidirVeredito(
  divergencias: Divergencia[],
  incertezas: Incerteza[],
  conferidos: CampoConferido[],
  confianca: number,
  limiares: LimiaresConferencia = LIMIARES_PADRAO,
): Veredito {
  // Nada pra conferir não é sucesso nem falha: é uma viagem que não tinha o que
  // comparar (diária, material sem ticket, foto que não é ticket).
  //
  // Foto ilegível NÃO passa por aqui: quem detecta isso é o leitor, e o
  // desfecho é outro (pedir foto nova). Ver `Veredito`.
  if (conferidos.length === 0) return "NAO_APLICAVEL";

  // Leitura ruim invalida qualquer conclusão, inclusive a de que está tudo bem.
  if (confianca < limiares.confiancaMinima) return "INCERTO";

  if (incertezas.length > 0) return "INCERTO";

  const temAlta = divergencias.some((d) => d.gravidade === "ALTA");
  if (temAlta) {
    return confianca >= limiares.confiancaParaAvisar ? "DIVERGE" : "INCERTO";
  }

  // Sobrou só MEDIA: alguém olha, mas não se cobra o motorista por isso.
  if (divergencias.length > 0) return "INCERTO";

  return "BATE";
}

/**
 * Vale pagar uma segunda leitura, num modelo melhor, antes de concluir?
 *
 * Só quando o dinheiro está em jogo (peso) ou quando a leitura foi fraca. É o
 * que impede acusar motorista por causa de uma leitura ruim — e o que segura o
 * custo, porque a segunda opinião custa 5x a primeira.
 */
export function precisaSegundaOpiniao(
  r: ResultadoConferencia,
  confianca: number,
  limiares: LimiaresConferencia = LIMIARES_PADRAO,
): boolean {
  if (r.veredito === "NAO_APLICAVEL") return false;
  const pesoEmJogo =
    r.divergencias.some((d) => d.campo === "toneladas") ||
    r.incertezas.some((i) => i.campo === "toneladas");
  return pesoEmJogo || confianca < limiares.confiancaParaAvisar;
}

/** Frase única pro chat da viagem e pro painel. */
export function resumirConferencia(r: ResultadoConferencia): string {
  if (r.veredito === "BATE") {
    return `Confere com o ticket (${r.conferidos.length} campo(s) verificado(s)).`;
  }
  if (r.veredito === "NAO_APLICAVEL") return "Não havia o que conferir nesta viagem.";
  const partes = [
    ...r.divergencias.map((d) => d.detalhe),
    ...r.incertezas.map((i) => `${i.campo}: ${i.motivo} (ticket: ${i.lido}, lançado: ${i.declarado}).`),
  ];
  return partes.join(" ");
}
