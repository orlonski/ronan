import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Check, CloudOff, TriangleAlert } from "lucide-react-native";
import { usePendingPresencaObra } from "@/hooks/use-pending-presenca-obra";
import { contarDiariaLocal, useObraDeHoje } from "@/lib/queries";
import { desfazerPresencaObra, enqueuePresencaObra } from "@/lib/sync";

/**
 * O bloco de quem está numa obra: a CONTA do mês, e o que ela tem a ver com
 * hoje.
 *
 * ⚠️ Este bloco já foi reescrito três vezes, e cada versão morreu do mesmo
 * jeito: o motorista olhava e não sabia o que aquilo era. Vale registrar por
 * quê, porque a tentação de voltar atrás é grande.
 *
 * 1. Substituiu a home inteira. Prominência se ganha com tamanho e posição,
 *    não amputando o resto — e custou o acesso a Pendentes.
 * 2. Virou um botão escrito CHEGUEI e nada mais. "Zero leitura" não é zero
 *    explicação.
 * 3. Ficou no TOPO da home, acima dos stories, com um alvo de 220px. O dono
 *    olhou e disse que estava uma bosta — e estava: um bloco daquele tamanho
 *    empurrava o app inteiro pra baixo todo dia, pra uma ação de um toque.
 *
 * O que mudou de verdade nesta versão não é o layout, é O ASSUNTO. As três
 * anteriores mostravam um BOTÃO (uma ação a fazer); esta mostra um NÚMERO
 * (quantas diárias já entraram na conta do mês) e trata o dia de hoje como
 * uma linha dessa conta. É o que o motorista já acompanha de cabeça e o que
 * ele vai conferir no dia 20 — "somar o dia" ele entende sem ninguém
 * explicar; "marcar presença" ele lê como ponto de firma, que ele não é.
 *
 * VOCABULÁRIO, e isto é regra: diária · conta · somar · dia · escritório ·
 * contratante · em branco. NUNCA: ponto, bater, presença, chegada, jornada,
 * hora, falta, atraso. Ele é parceiro autônomo, não funcionário — e a palavra
 * errada aqui muda a natureza do que o app está registrando.
 *
 * Regras que não podem cair numa refatoração:
 * - UM toque pra somar. Sem diálogo antes; o "tirar" fica visível depois.
 * - Nenhuma escolha, nenhuma lista, nenhum campo: obra e caminhão vêm da
 *   alocação, que só permite uma por vez exatamente pra isso.
 * - Tocar de novo devolve a mesma tela. Nunca alerta, nunca duplicata.
 * - Sem GPS e sem rede funciona igual: entra no outbox e sobe depois.
 * - O número sobe NO TOQUE e sobrevive a fechar o app (ver
 *   `contarDiariaLocal`). Número que só mexe com rede faz ele tocar duas
 *   vezes.
 */

/** Alvo do dedão grosso, dentro do caminhão, no sol — sem ocupar a home toda. */
const ALTURA_BOTAO = 96;

const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const NOMES_DIA = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado",
];

/** hsl() não existe em prop `color` de React Native — os tokens viram hex aqui. */
const COR_OK = "#1DA54F";
const COR_AVISO = "#B4501A";
const COR_ERRO = "#EB1414";

export function BlocoObra() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useObraDeHoje();

  /**
   * Estado do ENVIO desta sessão. Só existe porque o outbox demora alguns
   * milissegundos entre o toque e o item aparecer na fila — e nessa janela a
   * tela diria "está na conta do escritório" sem nada ter saído do celular.
   */
  const [envioLocal, setEnvioLocal] = useState<"guardado" | "enviado" | null>(null);
  const [tirado, setTirado] = useState(false);
  const [confirmandoTirar, setConfirmandoTirar] = useState(false);
  const [tirando, setTirando] = useState(false);
  const [avisoTirar, setAvisoTirar] = useState<string | null>(null);

  // O item DESTE dia ainda no outbox. Sem isto o número mente: o motorista
  // soma, a tela conta, o envio falha e ninguém fica sabendo até a
  // conferência do fim do mês — quando já não dá pra resolver.
  const naFila = usePendingPresencaObra();
  const pendenteDeHoje = naFila.find((i) => i.payload.data === data?.hoje?.data);
  const falhou = pendenteDeHoje?.status === "error";

  // Promove "guardado" → "enviado" só depois de ter VISTO o item na fila.
  // Sem essa memória, o intervalo entre o toque e a gravação no outbox seria
  // lido como "já subiu".
  const viNaFila = useRef(false);
  useEffect(() => {
    if (pendenteDeHoje) {
      viNaFila.current = true;
      return;
    }
    if (viNaFila.current && envioLocal === "guardado") {
      viNaFila.current = false;
      setEnvioLocal("enviado");
    }
  }, [pendenteDeHoje, envioLocal]);

  if (!data?.alocacao || !data.hoje) return null;

  const dia = data.hoje.data;
  const contado = !tirado && (envioLocal !== null || data.hoje.registrado === true);

  // Falhou = não entrou na conta do escritório, então não pode entrar no
  // número. O cache já somou no toque; aqui a soma é desfeita na exibição.
  const total = Math.max(0, (data.mes?.total ?? 0) - (falhou && contado ? 1 : 0));
  const temNumero = data.mes !== undefined;

  const [ano, mes, numeroDoDia] = dia.split("-").map(Number);
  const nomeDoMes = NOMES_MES[(mes ?? 1) - 1] ?? "";
  const nomeDoDia = NOMES_DIA[new Date(Date.UTC(ano!, (mes ?? 1) - 1, numeroDoDia ?? 1)).getUTCDay()];

  async function somar() {
    if (!data?.alocacao || !data.hoje) return;
    // O número sobe NO TOQUE, não quando a rede responde. Esperar o servidor
    // deixaria o motorista olhando o mesmo número no pátio — e tocando de novo.
    setEnvioLocal("guardado");
    setTirado(false);
    setAvisoTirar(null);
    const novo = await contarDiariaLocal(dia, 1);
    if (novo) qc.setQueryData(["obra-hoje"], novo);
    void qc.invalidateQueries({ queryKey: ["meus-dias-obra"] });

    // GPS é EVIDÊNCIA, nunca porteiro: lê a permissão que já existe, nunca
    // pede na hora, e sem coordenada registra igual. Sinal de obra é ruim e
    // isso não pode custar o dia dele.
    let coords: { latitude: number; longitude: number; precisao?: number } | undefined;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          precisao: pos.coords.accuracy ?? undefined,
        };
      }
    } catch {
      /* sem GPS o registro vale do mesmo jeito */
    }

    await enqueuePresencaObra({ alocacaoId: data.alocacao.id, data: dia, ...coords });
  }

  async function tirar() {
    if (!data?.alocacao || !data.hoje) return;
    setTirando(true);
    const r = await desfazerPresencaObra({ alocacaoId: data.alocacao.id, data: dia });
    setTirando(false);
    setConfirmandoTirar(false);
    if (r.confirmado) {
      setTirado(true);
      setEnvioLocal(null);
      viNaFila.current = false;
      setAvisoTirar(null);
      const novo = await contarDiariaLocal(dia, -1);
      if (novo) qc.setQueryData(["obra-hoje"], novo);
      void qc.invalidateQueries({ queryKey: ["meus-dias-obra"] });
      return;
    }
    // Sem rede o servidor não foi avisado. Dizer isso é melhor do que tirar da
    // tela e deixar ele achar que resolveu — e pior, somar outra vez depois.
    setAvisoTirar("Sem internet agora. Tente tirar quando o sinal voltar.");
  }

  return (
    <View className="gap-4 rounded-2xl border-2 border-[#DF7234]/40 bg-card p-4">
      <Text className="text-sm text-muted-foreground" numberOfLines={1}>
        {data.alocacao.obra} · {data.alocacao.placa}
      </Text>

      {/* O NÚMERO é o bloco, e é a porta pra tela do mês. Antes essa porta era
          um botão escrito "ver meus dias"; o número é maior, aparece sozinho e
          responde a pergunta antes de ser tocado. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${temNumero ? total : "—"} ${total === 1 ? "diária" : "diárias"} em ${nomeDoMes}. Abrir a conta do mês.`}
        onPress={() => router.push("/meus-dias-obra")}
        className="active:opacity-70"
      >
        <View className="flex-row items-baseline gap-3">
          <Text className="text-6xl font-bold text-foreground">{temNumero ? total : "—"}</Text>
          <Text className="text-2xl font-bold text-foreground">
            {total === 1 ? "diária" : "diárias"}
          </Text>
        </View>
        <Text className="text-sm text-muted-foreground">em {nomeDoMes}</Text>
      </Pressable>

      {/* Uma frase dizendo PRA QUE serve o número. Sem ela o motorista vê uma
          contagem e não sabe se é lembrete, cobrança ou conta de dinheiro. */}
      <Text className="text-base text-foreground">
        É esta conta que o escritório confere com o contratante.
      </Text>

      {/* Três caminhos, e o falhou vem ANTES do contado de propósito: na
          versão anterior a condição de "contado" já incluía o item com erro,
          e a tela de falha nunca aparecia — o dia sumia em silêncio. */}
      {falhou ? (
        <View className="gap-2 rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-4">
          <View className="flex-row items-center gap-2">
            <TriangleAlert size={24} color={COR_ERRO} />
            <Text className="text-lg font-bold text-destructive">
              O dia de hoje não entrou na conta.
            </Text>
          </View>
          {/* O MOTIVO aqui, não numa tela adiante: mandar procurar em outro
              lugar é pedir um passo a mais de quem já está travado. */}
          <Text className="text-base text-foreground">
            {pendenteDeHoje?.errorMsg ?? "Está guardado no celular, mas não subiu."}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/pendentes")}
            className="mt-1 items-center rounded-xl border-2 border-destructive/50 py-3"
          >
            <Text className="text-lg font-semibold text-destructive">Resolver agora</Text>
          </Pressable>
        </View>
      ) : contado ? (
        <View className="gap-3">
          {pendenteDeHoje || envioLocal === "guardado" ? (
            <View className="flex-row items-center gap-3 rounded-2xl border-2 border-warning/60 bg-warning/10 p-4">
              <CloudOff size={26} color={COR_AVISO} />
              <Text className="flex-1 text-base font-medium text-foreground">
                Contada aqui. Chega no escritório quando o sinal voltar.
              </Text>
            </View>
          ) : (
            <View className="flex-row items-center gap-3 rounded-2xl border-2 border-success/50 bg-success/10 p-4">
              <Check size={26} color={COR_OK} strokeWidth={3} />
              <Text className="flex-1 text-base font-medium text-foreground">
                A diária de hoje está na conta.
              </Text>
            </View>
          )}

          {/* Confirmação INLINE, nunca showConfirm: dentro de um Modal de tela
              cheia o alerta abre atrás. E "Manter o dia" no lugar de "Deixar",
              que pode ser lido como "deixar de contar". */}
          {confirmandoTirar ? (
            <View className="gap-2 rounded-2xl border-2 border-border p-4">
              <Text className="text-base font-semibold text-foreground">
                Tirar o dia de hoje da conta?
              </Text>
              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  disabled={tirando}
                  onPress={() => setConfirmandoTirar(false)}
                  className="h-14 flex-1 items-center justify-center rounded-xl border-2 border-border"
                >
                  <Text className="text-base font-semibold text-foreground">Manter o dia</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={tirando}
                  onPress={() => void tirar()}
                  className="h-14 flex-1 items-center justify-center rounded-xl bg-destructive"
                >
                  <Text className="text-base font-semibold text-destructive-foreground">
                    {tirando ? "Tirando…" : "Tirar"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirmandoTirar(true)}
              className="self-start py-2"
            >
              <Text className="text-base font-semibold text-muted-foreground underline">
                Tirar hoje
              </Text>
            </Pressable>
          )}

          {avisoTirar && <Text className="text-base text-[#B4501A]">{avisoTirar}</Text>}
        </View>
      ) : (
        <View className="gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Somar o dia de hoje na conta"
            onPress={() => void somar()}
            className="flex-row items-center justify-center gap-4 rounded-2xl bg-[#DF7234] active:opacity-80"
            style={{ height: ALTURA_BOTAO }}
          >
            {/* O ícone é o próprio "+1". Mapa, relógio e calendário todos
                puxam a leitura pra ponto e localização, que é o que este
                registro NÃO é. */}
            <View className="h-14 w-14 items-center justify-center rounded-full bg-white">
              <Text className="text-2xl font-bold text-[#DF7234]">+1</Text>
            </View>
            <Text className="text-2xl font-bold text-white">Somar o dia de hoje</Text>
          </Pressable>
          <Text className="text-center text-sm text-muted-foreground">
            Hoje, {nomeDoDia} {numeroDoDia}. Conta igual, cedo ou tarde.
          </Text>
        </View>
      )}

      {/* Os dias em branco. Não se chamam falta e não acusam ninguém: são dias
          que ninguém somou, e só ele pode dizer se esteve lá. Cinza, não
          âmbar — âmbar num bloco que ele vê todo dia vira alarme de fundo. */}
      {data.pendentes.length > 0 && (
        <Text className="text-sm text-muted-foreground">
          {data.pendentes.length === 1
            ? "1 dia deste mês ficou em branco."
            : `${data.pendentes.length} dias deste mês ficaram em branco.`}
        </Text>
      )}
    </View>
  );
}
