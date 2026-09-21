import { usePontoHoje } from "@/lib/queries";
import { hojeISO } from "@/lib/datetime";

/**
 * Esta pessoa é funcionária registrada desta empresa?
 *
 * Sai do próprio `/m/ponto/hoje`: quem não é leva 403, a query não repete
 * (`retry: false`) e o resultado fica em cache — uma requisição por abertura
 * do app, e só. Criar um endpoint só pra perguntar isso seria uma chamada a
 * mais em 4G ruim pra saber o que a primeira já responde.
 */
export function useEhFuncionario(): boolean {
  const { data } = usePontoHoje(hojeISO());
  return !!data?.funcionario && !data.funcionario.desligado;
}
