import { useSyncExternalStore } from "react";
import { acessosAppSync, assinarAcessosApp } from "@/lib/acessos-app";
import { assinarVinculoRegistrado, vinculoRegistradoSync } from "@/lib/vinculo-registrado";

/**
 * Esta pessoa é funcionária registrada (de alguma empresa)?
 *
 * ⚠️ A resposta vem do que o SERVIDOR mandou e o aparelho guardou — nunca de
 * um erro HTTP. Antes saía do 403 de `/m/ponto/hoje`: no primeiro boot sem
 * sinal a resposta era "não é" e a aba de jornada sumia de quem precisa dela,
 * e qualquer erro de rede virava resposta de negócio.
 *
 * Duas fontes, as duas do perfil (`GET /m/eu`), guardadas no aparelho:
 *   - o vínculo de registrado (empresa e admissão);
 *   - o acesso calculado: `app.ponto.bater` só existe pra quem tem cadastro
 *     de funcionário, então tê-lo em alguma empresa é ser registrado nela.
 * Quando discordam, vale quem disse SIM: esconder a aba deixa a pessoa sem
 * registrar a jornada, e é o erro caro dos dois.
 */
export function useEhFuncionario(): boolean {
  const guardado = useSyncExternalStore(
    assinarVinculoRegistrado,
    vinculoRegistradoSync,
    () => undefined,
  );
  const pelosAcessos = useSyncExternalStore(
    assinarAcessosApp,
    () => !!acessosAppSync()?.some((a) => a.capacidades.includes("app.ponto.bater")),
    () => false,
  );
  return !!guardado || pelosAcessos;
}
