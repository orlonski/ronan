import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { CalendarDays, Check, CloudOff, MapPin, TriangleAlert } from "lucide-react-native";
import { usePendingPresencaObra } from "@/hooks/use-pending-presenca-obra";
import { useObraDeHoje } from "@/lib/queries";
import { desfazerPresencaObra, enqueuePresencaObra } from "@/lib/sync";

/**
 * O bloco de quem está numa obra: um botão, e o que aconteceu com ele.
 *
 * Vai no TOPO da home, antes de tudo. O público deste fluxo tem pouquíssima
 * familiaridade com tecnologia e, muitas vezes, dificuldade de leitura — então
 * a primeira coisa da tela tem que ser a única que ele precisa fazer hoje.
 *
 * ⚠️ ELE JÁ SUBSTITUIU A HOME INTEIRA, E ISSO ESTAVA ERRADO. O argumento era
 * que um botão entre catorze blocos seria invisível — mas isso vale pra mais
 * um item na pilha, não pro PRIMEIRO elemento da tela. Substituir cobrou caro:
 * o motorista perdeu de uma vez o acesso a Pendentes (cujo único caminho no
 * app é um botão daquela home), a viagens, ao resumo e ao resto, e o app
 * mudava de forma conforme o dado — o que ninguém entende. Prominência se
 * ganha com tamanho e posição, não amputando o resto.
 *
 * ⚠️ A PRIMEIRA VERSÃO ERROU, e o erro vale ficar escrito. Eu segui "zero
 * leitura" ao pé da letra e entreguei um nome de obra, um botão escrito
 * CHEGUEI e mais nada: quem abriu não entendeu o que a tela fazia, e depois de
 * tocar não havia sinal de que estava resolvido. Zero leitura não é zero
 * explicação — é UMA frase curta, não um parágrafo. E "sem confirmação antes,
 * desfazer depois" só vale se o desfazer existir na tela; na primeira versão
 * ele existia só no estado.
 *
 * Regras que não podem cair numa refatoração:
 * - UM toque pra marcar. Sem diálogo antes; o desfazer fica visível depois.
 * - Nenhuma escolha, nenhuma lista, nenhum campo: obra e caminhão vêm da
 *   alocação, que só permite uma por vez exatamente pra isso.
 * - Tocar de novo devolve a mesma tela verde. Nunca alerta, nunca duplicata.
 * - Sem GPS e sem rede funciona igual: entra no outbox e sobe depois.
 * - NÃO é ponto. Não existe horário esperado, atraso nem falta: o que se
 *   registra é o caminhão presente na obra num dia.
 */

/** Alvo gigante de propósito: dedão grosso, dentro do caminhão, no sol. */
const ALTURA_BOTAO = 220;

/** Janela pra desfazer. Curta porque arrependimento acontece em segundos. */
const MINUTOS_PRA_DESFAZER = 10;

export function BlocoObra() {
  const router = useRouter();
  const { data } = useObraDeHoje();
  const [tocadoEm, setTocadoEm] = useState<number | null>(null);
  const [desfeito, setDesfeito] = useState(false);
  const [desfazendo, setDesfazendo] = useState(false);
  const [avisoDesfazer, setAvisoDesfazer] = useState<string | null>(null);

  // O item DESTE dia ainda no outbox. Sem isto o verde otimista mente: o
  // motorista toca, a tela pinta, o envio falha e ninguém fica sabendo até a
  // conferência do fim do mês — quando já não dá pra resolver.
  const naFila = usePendingPresencaObra();
  const pendenteDeHoje = naFila.find((i) => i.payload.data === data?.hoje?.data);
  const falhou = pendenteDeHoje?.status === "error";

  const registradoHoje = (data?.hoje?.registrado === true || tocadoEm !== null) && !desfeito;
  const podeDesfazer =
    tocadoEm !== null && !desfeito && Date.now() - tocadoEm < MINUTOS_PRA_DESFAZER * 60_000;

  // Fecha a janela de desfazer sozinha, pra o botão não ficar o dia inteiro
  // na tela convidando a desmarcar um dia legítimo.
  const [, forcarRender] = useState(0);
  useEffect(() => {
    if (!tocadoEm) return;
    const t = setTimeout(() => forcarRender((n) => n + 1), MINUTOS_PRA_DESFAZER * 60_000);
    return () => clearTimeout(t);
  }, [tocadoEm]);

  if (!data?.alocacao || !data.hoje) return null;

  async function marcar() {
    if (!data?.alocacao || !data.hoje) return;
    // Otimista: o verde aparece no toque, não quando a rede responde. Esperar
    // o servidor deixaria o motorista olhando um spinner no pátio.
    setTocadoEm(Date.now());
    setDesfeito(false);

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

    await enqueuePresencaObra({
      alocacaoId: data.alocacao.id,
      data: data.hoje.data,
      ...coords,
    });
  }

  async function desfazer() {
    if (!data?.alocacao || !data.hoje) return;
    setDesfazendo(true);
    const r = await desfazerPresencaObra({
      alocacaoId: data.alocacao.id,
      data: data.hoje.data,
    });
    setDesfazendo(false);
    if (r.confirmado) {
      setDesfeito(true);
      setTocadoEm(null);
      setAvisoDesfazer(null);
      return;
    }
    // Sem rede o servidor não foi avisado. Dizer isso é melhor do que mostrar
    // o botão de novo e deixar ele achar que desfez — e pior, tocar outra vez.
    setAvisoDesfazer("Sem internet agora. Tente desfazer quando o sinal voltar.");
  }

  return (
    <View className="gap-3 rounded-2xl border-2 border-[#DF7234]/40 bg-card p-4">
      <View>
        <Text className="text-xl font-bold text-foreground" numberOfLines={1}>
          {data.alocacao.obra}
        </Text>
        <Text className="text-base text-muted-foreground">
          Você está nesta obra · {data.alocacao.placa}
        </Text>
      </View>
        {registradoHoje ? (
          <>
            <View
              className="items-center justify-center rounded-3xl bg-emerald-600"
              style={{ height: ALTURA_BOTAO }}
            >
              <Check size={80} color="#fff" strokeWidth={3} />
              <Text className="mt-2 text-4xl font-bold text-white">HOJE OK</Text>
            </View>

            {/* O verde é otimista, então ele precisa dizer em que pé está.
                Três estados, e a diferença importa: enviado é fim; esperando
                é normal e some sozinho; falhou exige gente. */}
            {falhou ? (
              <View className="gap-2 rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-4">
                <View className="flex-row items-center gap-2">
                  <TriangleAlert size={24} color="#dc2626" />
                  <Text className="text-lg font-bold text-destructive">
                    Não consegui enviar
                  </Text>
                </View>
                {/* O MOTIVO aqui, não numa tela adiante. Mandar procurar em
                    outro lugar é pedir um passo a mais de quem já está
                    travado — e o texto do servidor é escrito pra humano. */}
                <Text className="text-base text-foreground">
                  {pendenteDeHoje?.errorMsg ?? "Seu dia está guardado no celular, mas não subiu."}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/pendentes")}
                  className="mt-1 items-center rounded-xl border-2 border-destructive/50 py-3"
                >
                  <Text className="text-lg font-semibold text-destructive">Ver o que travou</Text>
                </Pressable>
              </View>
            ) : pendenteDeHoje ? (
              <View className="flex-row items-center justify-center gap-2">
                <CloudOff size={22} color="#a16207" />
                <Text className="text-center text-lg font-medium text-amber-700">
                  Guardado. Sobe sozinho quando tiver sinal.
                </Text>
              </View>
            ) : (
              <Text className="text-center text-xl font-medium text-foreground">
                Seu dia na obra foi marcado.{"\n"}Não precisa fazer mais nada hoje.
              </Text>
            )}

            {podeDesfazer && (
              <Pressable
                accessibilityRole="button"
                disabled={desfazendo}
                onPress={() => void desfazer()}
                className="items-center justify-center rounded-2xl border-2 border-border py-4"
              >
                <Text className="text-lg font-semibold text-muted-foreground">
                  {desfazendo ? "Desfazendo…" : "Marquei sem querer"}
                </Text>
              </Pressable>
            )}

            {avisoDesfazer && (
              <Text className="text-center text-base text-amber-700">{avisoDesfazer}</Text>
            )}
          </>
        ) : (
          <>
            {/* UMA frase, antes do botão. O rótulo sozinho não diz o que a
                tela faz pra quem nunca viu. */}
            <Text className="text-center text-xl font-medium text-foreground">
              Chegou na obra hoje? Toque no botão.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cheguei na obra"
              onPress={() => void marcar()}
              className="items-center justify-center rounded-3xl bg-[#DF7234] active:opacity-80"
              style={{ height: ALTURA_BOTAO }}
            >
              <MapPin size={80} color="#fff" strokeWidth={2.5} />
              <Text className="mt-2 text-5xl font-bold text-white">CHEGUEI</Text>
            </Pressable>
          </>
        )}

        {/* A porta pros Pendentes. Precisa existir AQUI porque esta tela
            SUBSTITUI a home — e o único caminho pra tela de Pendentes no app
            inteiro era um botão da home da empresa. Ao trocar a home eu cortei
            o acesso à única tela que mostra item travado, e o motorista ficou
            sem como descobrir que o dia dele não subiu. */}
        {naFila.length > 0 && !falhou && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/pendentes")}
            className="flex-row items-center justify-center gap-3 rounded-2xl border-2 border-amber-500/40 py-4"
          >
            <CloudOff size={24} color="#a16207" />
            <Text className="text-lg font-semibold text-amber-700">
              {naFila.length === 1 ? "1 dia esperando enviar" : `${naFila.length} dias esperando enviar`}
            </Text>
          </Pressable>
        )}

        {/* O caminho pro mês. Pra quem é pago por diária, "quantos dias eu já
            fiz" é a pergunta que mais importa — e sem esta porta ele só
            conseguia responder de cabeça. Alvo grande, uma linha, sem menu. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/meus-dias-obra")}
          className="flex-row items-center justify-center gap-3 rounded-2xl border-2 border-border py-5"
        >
          <CalendarDays size={28} />
          <Text className="text-xl font-semibold text-foreground">Ver meus dias do mês</Text>
        </Pressable>

        {/* Os dias em branco. Não se chamam falta e não acusam ninguém: são
            dias que ninguém marcou, e só ele pode dizer se esteve lá. */}
        {data.pendentes.length > 0 && (
          <View className="rounded-2xl border-2 border-amber-500/40 bg-card p-4">
            <Text className="text-lg font-bold text-foreground">
              {data.pendentes.length === 1
                ? "1 dia sem marcar"
                : `${data.pendentes.length} dias sem marcar`}
            </Text>
            <Text className="mt-1 text-base text-muted-foreground">
              Se você esteve na obra nesses dias, avise o escritório.
            </Text>
          </View>
        )}

      <Text className="text-center text-sm text-muted-foreground">
        Funciona sem internet. O que você marcar sobe sozinho quando o sinal voltar.
      </Text>
    </View>
  );
}
