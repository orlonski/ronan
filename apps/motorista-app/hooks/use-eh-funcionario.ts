import { useSyncExternalStore } from "react";
import { usePontoHoje } from "@/lib/queries";
import { hojeISO } from "@/lib/datetime";
import { assinarVinculoRegistrado, vinculoRegistradoSync } from "@/lib/vinculo-registrado";

/**
 * Esta pessoa é funcionária registrada desta empresa?
 *
 * ⚠️ A resposta vem do PERFIL, guardado no aparelho — não mais de um erro HTTP.
 *
 * Antes saía do 403 de `/m/ponto/hoje`: quem não é funcionário levava 403, e o
 * app lia isso como "não é". Três defeitos num: no primeiro boot sem sinal a
 * resposta era "não é", e a aba de registro de jornada sumia justamente de
 * quem precisa dela num canteiro sem cobertura; qualquer erro de rede virava
 * resposta de negócio; e "quem é você" ficava dependendo de um endpoint de
 * outro assunto.
 *
 * O `/m/ponto/hoje` continua valendo como segunda fonte, pro aparelho que
 * ainda não guardou o perfil desta versão — cache antigo não tem o campo.
 * Quando as duas discordam, vale quem disse SIM: errar escondendo a aba deixa
 * a pessoa sem registrar a jornada dela, e é o erro caro dos dois.
 */
export function useEhFuncionario(): boolean {
  const guardado = useSyncExternalStore(
    assinarVinculoRegistrado,
    vinculoRegistradoSync,
    () => undefined,
  );
  const { data } = usePontoHoje(hojeISO());
  const peloPonto = !!data?.funcionario && !data.funcionario.desligado;
  return !!guardado || peloPonto;
}
