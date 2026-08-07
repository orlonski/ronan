import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Mic, Pause, Play } from "lucide-react-native";
import { API_URL } from "@/lib/api-url";
import { loadTokens } from "@/lib/auth";
import { fmtDuracao, usePlayerChat } from "@/lib/audio-chat";

/** Quanto tempo depois de gravado ainda vale dizer que está transcrevendo. */
const JANELA_TRANSCRICAO_MS = 3 * 60 * 1000;

/**
 * Bolha de áudio: play/pause, duração e — o que faz esta feature valer a pena
 * — a transcrição logo abaixo.
 *
 * A transcrição é o ponto todo: o motorista manda áudio porque está dirigindo
 * e não dá pra digitar; quem recebe também está dirigindo e não dá pra ouvir.
 * O texto embaixo resolve os dois lados, e ainda torna o áudio pesquisável.
 */
export function BolhaAudio({
  mensagemId,
  meu,
  duracaoSegundos,
  transcricao,
  disponivel,
  autorNome,
  mostrarAutor,
  horario,
  criadoEm,
  onLongPress,
}: {
  mensagemId: string;
  meu: boolean;
  duracaoSegundos: number | null;
  transcricao: string | null;
  disponivel: boolean;
  autorNome: string;
  mostrarAutor: boolean;
  horario: string;
  /** ISO — usado só pra saber se ainda faz sentido dizer "transcrevendo". */
  criadoEm: string;
  onLongPress: () => void;
}) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    void loadTokens().then((t) => setToken(t?.accessToken ?? null));
  }, []);

  // Só monta o player com o token pronto: sem isso a primeira requisição sai
  // sem auth, toma 401 e o player guarda o erro — o play some sem explicação.
  // Auth por query param, mesmo motivo das fotos de story.
  const fonte =
    token && disponivel
      ? { uri: `${API_URL}/m/chat/mensagens/${mensagemId}/audio?access_token=${token}` }
      : null;
  const player = usePlayerChat(fonte);

  // "Transcrevendo…" só enquanto ainda é plausível. O Whisper leva segundos;
  // passados alguns minutos sem texto, foi falha ou a chave não está
  // configurada — e aí a bolha ficaria mentindo pra sempre.
  const transcricaoAindaPodeVir =
    Date.now() - new Date(criadoEm).getTime() < JANELA_TRANSCRICAO_MS;

  const total = duracaoSegundos ?? 0;
  const restante = player.tocando ? Math.max(0, total - player.posicaoSeg) : total;

  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      className={`max-w-[82%] rounded-2xl px-3 py-2 ${
        meu ? "self-end rounded-br-md bg-primary" : "self-start rounded-bl-md bg-muted"
      }`}
    >
      {mostrarAutor ? (
        <Text className="mb-0.5 text-xs font-bold text-primary">{autorNome}</Text>
      ) : null}

      <View className="flex-row items-center gap-3">
        {disponivel ? (
          <Pressable
            onPress={() => void player.alternar()}
            hitSlop={10}
            accessibilityLabel={player.tocando ? "Pausar áudio" : "Tocar áudio"}
            className={`h-11 w-11 items-center justify-center rounded-full ${
              meu ? "bg-white/25" : "bg-primary/15"
            }`}
          >
            {!player.carregado && player.tocando ? (
              <ActivityIndicator color={meu ? "#fff" : "#ea580c"} />
            ) : player.tocando ? (
              <Pause size={20} color={meu ? "#fff" : "#ea580c"} fill={meu ? "#fff" : "#ea580c"} />
            ) : (
              <Play size={20} color={meu ? "#fff" : "#ea580c"} fill={meu ? "#fff" : "#ea580c"} />
            )}
          </Pressable>
        ) : (
          <View
            className={`h-11 w-11 items-center justify-center rounded-full ${
              meu ? "bg-white/15" : "bg-muted-foreground/10"
            }`}
          >
            <Mic size={18} color={meu ? "rgba(255,255,255,0.6)" : "#94a3b8"} />
          </View>
        )}

        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Mic size={13} color={meu ? "rgba(255,255,255,0.85)" : "#64748b"} />
            <Text
              className={`text-sm font-semibold ${
                meu ? "text-primary-foreground" : "text-foreground"
              }`}
            >
              {disponivel ? fmtDuracao(restante) : "Áudio expirado"}
            </Text>
          </View>
          {!disponivel ? (
            <Text
              className={`text-[11px] ${
                meu ? "text-primary-foreground/70" : "text-muted-foreground"
              }`}
            >
              Áudio antigo — só o texto ficou
            </Text>
          ) : null}
        </View>
      </View>

      {transcricao ? (
        <Text
          className={`mt-2 border-t pt-2 text-sm ${
            meu
              ? "border-white/25 text-primary-foreground"
              : "border-border text-foreground"
          }`}
        >
          {transcricao}
        </Text>
      ) : disponivel && transcricaoAindaPodeVir ? (
        <Text
          className={`mt-2 text-[11px] italic ${
            meu ? "text-primary-foreground/60" : "text-muted-foreground"
          }`}
        >
          Transcrevendo…
        </Text>
      ) : null}

      <Text
        className={`mt-0.5 self-end text-[10px] ${
          meu ? "text-primary-foreground/70" : "text-muted-foreground"
        }`}
      >
        {horario}
      </Text>
    </Pressable>
  );
}
