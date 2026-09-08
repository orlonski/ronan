import { useSyncExternalStore } from "react";
import { assinarIdentidade, temIdentidadeSync } from "./identidade";
import { assinarSessoes, semEmpresaSync } from "./sessoes";

/**
 * Qual app ele vê: o do trabalho por conta própria ou o da transportadora.
 *
 * **Precisa ser hook, e não função.** A identidade é lida do Keychain no boot,
 * então nos primeiros frames a resposta é "ainda não sei" — e uma função pura
 * devolveria `false` (a visão da empresa) sem nunca mais ser reavaliada: a tela
 * ficava na versão errada até o app ser fechado e aberto de novo. Foi assim que
 * o "Iniciar frete" sumiu da home de quem não tem empresa.
 *
 * Assina as DUAS fontes: a identidade (que diz que ele tem cadastro) e a lista
 * de sessões (que diz se ele entrou em alguma empresa). Aceitar um convite muda
 * a segunda, e a tela precisa acompanhar na hora.
 */
export function useSemEmpresa(): boolean {
  const identidade = useSyncExternalStore(
    assinarIdentidade,
    temIdentidadeSync,
    () => null,
  );
  const empresas = useSyncExternalStore(
    assinarSessoes,
    () => semEmpresaSync(temIdentidadeSync()),
    () => false,
  );
  // `identidade` entra só pra forçar o recálculo quando ela carrega — quem
  // decide é `semEmpresaSync`, que olha as duas coisas.
  return identidade === true && empresas;
}
