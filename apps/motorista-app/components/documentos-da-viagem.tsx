import { DocumentosDoPedido } from "@/components/documentos-pedido";
import { usePermite } from "@/lib/acessos-app";
import { anexosDe, programacaoDaViagem, useMinhaProgramacao } from "@/lib/anexos-pedido";

/**
 * Os documentos do pedido DURANTE a viagem guiada — é na portaria da obra,
 * com o caminhão carregado, que ele precisa da autorização de entrada.
 *
 * Usa a programação do cache (cache-first): no meio da estrada, sem sinal,
 * ainda abre. Só aparece quando dá pra dizer com segurança de qual pedido a
 * viagem é (`programacaoDaViagem`); na dúvida, não mostra nada.
 */
export function DocumentosDaViagem({
  viagem,
}: {
  viagem: { iniciadoEm: string; clienteId?: string | null; localCargaId?: string | null };
}) {
  const verProgramacao = usePermite("app.programacao.ver");
  const verAnexos = usePermite("app.pedido.anexos");
  const lista = useMinhaProgramacao(verProgramacao && verAnexos);
  if (!verProgramacao || !verAnexos || !lista.data) return null;
  const p = programacaoDaViagem(lista.data, viagem);
  if (!p) return null;
  return <DocumentosDoPedido anexos={anexosDe(p)} />;
}
