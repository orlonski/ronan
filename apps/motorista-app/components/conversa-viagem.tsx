import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { MessageSquare, Send } from "lucide-react-native";
import { Card } from "@/components/ui/card";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { fmtDataHora } from "@/lib/datetime";
import { useEnviarMensagemViagem, useMensagensViagem } from "@/lib/queries";

const ACAO_LABEL: Record<string, string> = {
  MARCOU_DIVERGENTE: "Marcou como divergente",
  CORRIGIU_KM: "Respondeu o km",
  ESCOLHEU_ROTA: "Registrou a estrada",
  INFORMOU_PEDAGIO: "Informou o pedágio",
  ENVIOU_FOTO: "Enviou foto nova",
  // Material que não gera documento: a viagem entra aprovada por regra.
  DISPENSOU_CONFERENCIA: "Sem conferência (material)",
  // As duas abaixo o backend já gravava, e não estavam aqui — mensagem com
  // `acao` fora desta lista simplesmente não renderiza selo. A conferência
  // automática vinha aparecendo sem nenhum.
  CONFERIU: "Conferido pela IA",
  CORRIGIU_TICKET: "Corrigiu o ticket",
};

/**
 * Chat da viagem (motorista <-> operação). As mensagens do motorista ficam à
 * direita; da operação à esquerda. Cada uma com nome + data/hora + selo quando
 * veio de uma ação. Online-only (sem sinal, avisa e mantém no cache).
 */
export function ConversaViagem({ viagemId }: { viagemId: string }) {
  const mensagens = useMensagensViagem(viagemId);
  const enviar = useEnviarMensagemViagem();
  const [texto, setTexto] = useState("");

  const lista = mensagens.data ?? [];

  async function mandar() {
    const t = texto.trim();
    if (t.length === 0 || enviar.isPending) return;
    try {
      await enviar.mutateAsync({ viagemId, texto: t });
      setTexto("");
    } catch (err) {
      void showAlert({ title: "Não enviou", message: humanizeApiError(err) });
    }
  }

  return (
    <Card>
      <View className="flex-row items-center gap-2">
        <MessageSquare size={18} color="#334155" />
        <Text className="text-base font-bold text-foreground">Conversa</Text>
      </View>

      <View className="mt-3 gap-2">
        {mensagens.isLoading ? (
          <ActivityIndicator />
        ) : lista.length === 0 ? (
          <Text className="text-sm text-muted-foreground">
            Nenhuma mensagem ainda.
          </Text>
        ) : (
          lista.map((m) => {
            const meu = m.autor === "MOTORISTA";
            return (
              <View
                key={m.id}
                className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  meu
                    ? "self-end rounded-br-sm bg-primary/10"
                    : "self-start rounded-bl-sm bg-muted"
                }`}
              >
                <View className="flex-row items-baseline gap-2">
                  <Text className="text-xs font-bold text-foreground">
                    {m.autorNome}
                  </Text>
                  <Text className="text-[10px] text-muted-foreground">
                    {fmtDataHora(m.criadoEm)}
                  </Text>
                </View>
                {m.acao && ACAO_LABEL[m.acao] ? (
                  <Text className="mt-0.5 text-[10px] font-medium text-warning">
                    {ACAO_LABEL[m.acao]}
                  </Text>
                ) : null}
                <Text className="mt-0.5 text-sm text-foreground">{m.texto}</Text>
              </View>
            );
          })
        )}
      </View>

      <View className="mt-3 flex-row items-end gap-2">
        <TextInput
          value={texto}
          onChangeText={setTexto}
          placeholder="Escrever pra operação…"
          multiline
          maxLength={1000}
          className="min-h-[44px] flex-1 rounded-2xl border border-input bg-white px-3 py-2 text-base text-foreground"
        />
        <Pressable
          onPress={mandar}
          disabled={texto.trim().length === 0 || enviar.isPending}
          className={`h-11 w-11 items-center justify-center rounded-full ${
            texto.trim().length === 0 || enviar.isPending ? "bg-muted" : "bg-primary"
          }`}
        >
          {enviar.isPending ? (
            <ActivityIndicator color="white" />
          ) : (
            <Send size={20} color="white" />
          )}
        </Pressable>
      </View>
    </Card>
  );
}
