import { useSyncExternalStore } from "react";
import { assinarIdentidade, temIdentidadeSync } from "./identidade";
import { assinarSessoes, semEmpresaSync } from "./sessoes";
import { assinarVinculoRegistrado, vinculoRegistradoSync } from "./vinculo-registrado";

/**
 * QUAL APP ELE VÊ. São três, não dois.
 *
 * - `empresa` — tem cadastro de motorista em alguma transportadora. Lança
 *   viagem, pedágio, abastecimento. É o app que existe desde o começo, e vale
 *   também pro motorista CLT da própria transportadora: ele dirige e bate
 *   ponto, então precisa das duas coisas.
 * - `registrado` — é empregado em carteira e NÃO tem cadastro de motorista:
 *   mecânico, escritório, ajudante. O que ele faz aqui é registrar jornada e
 *   mandar documento.
 * - `pessoal` — não está em empresa nenhuma. Trabalha por conta própria:
 *   calculadora de frete, caderno de gastos, comprovante.
 *
 * ⚠️ O terceiro caso existia e caía na casa errada. `useSemEmpresa` responde
 * "tem cadastro de MOTORISTA em alguma empresa?", e o funcionário registrado
 * responde não — então o app concluía "autônomo sem empresa" e entregava,
 * com convicção, uma calculadora de frete pra quem é empregado. Três das
 * cinco abas erradas, e nenhuma delas errada por acaso: estavam certas pra
 * outra pessoa.
 *
 * **Precisa ser hook, e não função.** As três fontes são lidas do disco no
 * boot, então nos primeiros frames a resposta é "ainda não sei" — e uma função
 * pura devolveria a casa errada sem nunca mais ser reavaliada. Foi assim que o
 * "Iniciar frete" sumiu da home de quem não tem empresa.
 */
export type Visao = "carregando" | "pessoal" | "empresa" | "registrado";

export function useVisao(): Visao {
  const identidade = useSyncExternalStore(assinarIdentidade, temIdentidadeSync, () => null);
  const semEmpresa = useSyncExternalStore(
    assinarSessoes,
    () => semEmpresaSync(temIdentidadeSync()),
    () => false,
  );
  const vinculo = useSyncExternalStore(
    assinarVinculoRegistrado,
    vinculoRegistradoSync,
    () => undefined,
  );

  if (identidade !== true) return "carregando";
  // Cadastro de motorista vence: quem dirige pra empresa usa o app da empresa,
  // seja ele parceiro ou registrado em carteira.
  if (!semEmpresa) return "empresa";
  // `undefined` é "ainda não li do disco" e NÃO é "não é registrado". Tratar os
  // dois como a mesma coisa faria a casa do autônomo piscar na frente de quem
  // é empregado, a cada abertura do app.
  if (vinculo === undefined) return "carregando";
  return vinculo ? "registrado" : "pessoal";
}

/**
 * Atalho pra quem só precisa saber se é a visão de trabalho por conta própria.
 *
 * ⚠️ Mudou de significado: antes era "não tem cadastro de motorista", e isso
 * incluía o funcionário registrado. Agora é só quem não tem vínculo nenhum.
 */
export function useSemEmpresa(): boolean {
  return useVisao() === "pessoal";
}
