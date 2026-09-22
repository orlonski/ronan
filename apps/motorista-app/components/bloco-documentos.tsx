import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, FileText } from "lucide-react-native";
import { useDocumentosDaObra } from "@/lib/queries";
import { usePendingDocumentos } from "@/hooks/use-pending-documentos";
import { usePermite } from "@/lib/acessos-app";

/**
 * A porta pros documentos, na home.
 *
 * ⚠️ Ele mostra um NÚMERO, não um botão — e isso não é preferência de estilo.
 * É a lição que custou três versões no bloco da obra (ver o histórico em
 * `components/home-obra.tsx`): as que morreram mostravam uma AÇÃO A FAZER, e o
 * motorista olhava sem saber o que era. A que funcionou responde a pergunta
 * antes de ser tocada. Aqui a pergunta é "falta alguma coisa minha?".
 *
 * As outras três regras que vieram da mesma cicatriz:
 *
 * - **Some sozinho quando zera.** Bloco que fica pra sempre na home empurra o
 *   app inteiro pra baixo todo dia por uma tarefa que acabou. Documento de
 *   admissão termina; a conta de diárias não.
 * - **Altura fixa, nunca cresce com a lista.** 12 documentos não podem virar
 *   12 linhas na home.
 * - **Nunca vermelho.** Vermelho na home está reservado pro "o dia de hoje não
 *   entrou na conta", que é erro real e urgente. Documento faltando é rotina.
 *
 * Fica ANTES do bloco da obra de propósito: é uma coisa que acaba, e quem
 * ainda tem documento faltando ainda não entrou na obra direito.
 */

const ALTURA = 96;

export function BlocoDocumentos() {
  const router = useRouter();
  const { data } = useDocumentosDaObra();
  const verDocumentos = usePermite("app.documentos.enviar");
  /**
   * ⚠️ A fila do aparelho entra na conta, pelo mesmo motivo da tela de dentro:
   * `faltamDele` vem da API, e a API só sabe do arquivo depois que ele SUBIU.
   * Num 4G ruim isso são minutos com o número parado na home — e quem acabou
   * de mandar a foto lê isso como "não foi".
   */
  const naFila = usePendingDocumentos();
  const subindo = new Set(
    naFila.filter((i) => i.status !== "error" && i.attempts < 8).map((i) => i.clientId),
  );

  // Sem exigência nenhuma, ou tudo entregue: a home não fala do assunto.
  // `data` nulo (primeira abertura, ainda sem cache) também não mostra nada —
  // piscar um bloco e sumir é pior do que não mostrar.
  if (!verDocumentos || !data || data.total === 0) return null;
  const faltam = data.documentos.filter((d) => {
    if (subindo.has(d.id)) return false;
    if (!d.recebido) return true;
    if (d.recusado) return true;
    return d.precisaAssinar && d.comoAssinar === "NO_APP" && d.assinado !== true;
  }).length;
  if (faltam <= 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ver seus documentos. ${faltam} de ${data.total} ainda não chegaram.`}
      onPress={() => router.push("/documentos-da-obra")}
      className="mb-3 flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card px-4 active:opacity-80"
      style={{ height: ALTURA }}
    >
      <View className="h-14 w-14 items-center justify-center rounded-full bg-muted">
        <FileText size={28} color="#6b7280" />
      </View>

      <View className="flex-1">
        <View className="flex-row items-end gap-1.5">
          <Text className="text-3xl font-bold leading-none text-foreground">{faltam}</Text>
          <Text className="pb-0.5 text-lg text-muted-foreground">
            {faltam === 1 ? "documento falta" : "documentos faltam"}
          </Text>
        </View>
        <Text className="mt-1 text-base text-muted-foreground" numberOfLines={1}>
          {/* Quem pediu, quando dá pra dizer: é o que faz a lista deixar de ser
              burocracia e virar "a obra está esperando isso".

              Sem "pela obra" na frente: o nome do cliente quase sempre já
              começa com "Obra", e saía "Pedidos pela obra Obra Contorno". */}
          {data.obra ? `Pedidos por ${data.obra}` : "Pedidos pelo escritório"}
        </Text>
      </View>

      <ChevronRight size={24} color="#9ca3af" />
    </Pressable>
  );
}
