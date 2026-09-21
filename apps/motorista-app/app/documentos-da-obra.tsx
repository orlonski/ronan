import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Clock, CloudOff, FileText, Paperclip, PenLine, X } from "lucide-react-native";
import { PhotoCapture } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { enqueueDocumentoAdmissao } from "@/lib/sync";
import { escolherArquivo, podeEscolherArquivo } from "@/lib/escolher-arquivo";
import { usePendingDocumentos } from "@/hooks/use-pending-documentos";
import { MiniaturaDocumento } from "@/components/miniatura-documento";
import { useDocumentosDaObra, type DocumentoDaObra } from "@/lib/queries";

/**
 * O que falta pra ficha dele fechar.
 *
 * Nasceu de uma frase do dono: o motorista tem que ver o que falta "pra que ele
 * não perca tempo com isso" — hoje ele descobre na portaria da obra, ou depois
 * de dirigir até o escritório.
 *
 * DESENHO, e cada item aqui é uma lição já paga em outra tela deste app:
 *
 * 1. **Número primeiro, não barra de progresso nem porcentagem.** Mesma
 *    gramática da conta de diárias (`components/home-obra.tsx`): "faltam 4" ele
 *    entende sem ninguém explicar.
 * 2. **Nada some da lista.** A tela pública de coleta escondia o que já tinha
 *    sido enviado "por privacidade", e a pessoa mandava sete arquivos sem saber
 *    qual entrou (ver o comentário em `apps/dashboard/src/app/coleta/[token]`).
 *    O que falta vem primeiro; o que chegou continua visível embaixo.
 * 3. **"Falta" é CINZA, não vermelho.** Doze itens vermelhos é uma parede de
 *    sangue por algo que ele ainda não teve chance de fazer. Vermelho fica
 *    reservado pro que está vencido — o único caso em que algo deu errado.
 * 4. **O título é o que o CONTRATANTE escreveu**, e a ajuda também. O sistema
 *    não nomeia documento nem inventa explicação: sem ajuda cadastrada, a tela
 *    manda falar com o escritório em vez de chutar.
 * 5. **Nenhuma palavra de cobrança.** Não existe pendência, irregular,
 *    bloqueado nem prazo correndo. A frase de consequência é sobre o processo
 *    ("sem eles o escritório não fecha seu cadastro"), nunca sobre ele.
 *
 * Esta versão é SÓ LEITURA: mandar a foto e assinar vêm nas próximas. Ele já
 * sai ganhando a informação, que é o que evita a viagem perdida.
 */

function dataBR(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Vencido, vencendo ou em dia — só pra documento que tem validade. */
function estadoValidade(validade: string | null): "VENCIDO" | "VENCENDO" | null {
  if (!validade) return null;
  const hoje = new Date();
  const v = new Date(`${validade.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(v.getTime())) return null;
  const dias = Math.floor((v.getTime() - hoje.getTime()) / 86_400_000);
  if (dias < 0) return "VENCIDO";
  if (dias <= 30) return "VENCENDO";
  return null;
}

/**
 * A ordem da lista: o que ele resolve primeiro.
 *
 * Vencido → falta → falta assinar → chegou. Ele não pode ter que rolar oito
 * vistos verdes pra achar os dois que importam.
 */
function peso(d: DocumentoDaObra): number {
  // Recusado primeiro: é o único em que alguém já gastou tempo e o tempo foi
  // perdido. Depois o que falta, depois o que espera o escritório, e por
  // último o que está resolvido.
  if (d.recusado) return 0;
  if (d.recebido && estadoValidade(d.validade) === "VENCIDO") return 1;
  if (!d.recebido && d.obrigatorio) return 2;
  if (!d.recebido) return 3;
  if (d.precisaAssinar && !d.assinado) return 4;
  if (d.conferido !== true) return 5;
  return 6;
}

export default function DocumentosDaObraScreen() {
  const router = useRouter();
  const { data, isLoading, refetch } = useDocumentosDaObra();
  // RefreshControl só no gesto: recarga automática prende o spinner no iOS.
  const [puxando, setPuxando] = useState(false);

  // ⚠️ O número é o que ELE resolve, não "total - prontos". O que está
  // esperando o escritório olhar não é tarefa dele: contar como falta manda
  // resolver o que não tem como resolver, e contar como pronto foi o defeito
  // que zerava a tela assim que o arquivo chegava.
  /**
   * ⚠️ A ORDEM É CONGELADA ENQUANTO A TELA ESTÁ ABERTA.
   *
   * Ordenar por urgência ajuda a abrir a tela — o que ele resolve primeiro
   * aparece primeiro. Mas REORDENAR com a tela aberta é horrível: ele manda a
   * foto, o item deixa de ser urgência, e a lista inteira se reorganiza
   * embaixo do dedo. O próximo toque cai no documento errado.
   *
   * Então a ordem é decidida UMA VEZ, na primeira vez que os dados chegam, e
   * mantida. Documento que aparecer depois entra no fim. Fechar e abrir a tela
   * reordena — aí ele está olhando de novo, não no meio de uma ação.
   */
  const ordemFixa = useRef<string[] | null>(null);
  const lista = useMemo(() => {
    const docs = data?.documentos ?? [];
    if (docs.length === 0) return docs;
    if (!ordemFixa.current) {
      ordemFixa.current = [...docs].sort((a, b) => peso(a) - peso(b)).map((d) => d.id);
    }
    const posicao = new Map(ordemFixa.current.map((id, i) => [id, i]));
    return [...docs].sort(
      (a, b) => (posicao.get(a.id) ?? 999) - (posicao.get(b.id) ?? 999),
    );
  }, [data]);

  /**
   * O que está na fila do aparelho, por exigência.
   *
   * Sem isto a tela ficaria mentindo enquanto não há sinal: ele tira a foto, o
   * servidor ainda não sabe de nada, e o item continuaria dizendo "ainda não
   * chegou" — que é exatamente o jeito de fazer alguém tirar a mesma foto
   * quatro vezes.
   */
  const naFila = usePendingDocumentos();
  const filaPor = new Map(naFila.map((i) => [i.clientId, i]));

  /**
   * O QUE ELE MANDOU NESTA SESSÃO manda na tela. Sem prazo, sem hash.
   *
   * ⚠️ Esta é a terceira tentativa de matar a piscada, e as duas primeiras
   * erraram pelo mesmo motivo: tentaram adivinhar QUANDO parar de desenhar a
   * foto local. "Saiu da fila" é cedo demais — nesse instante a tela monta a
   * URL do servidor com o hash antigo e recebe a foto antiga. "Quando o hash
   * mudar" parece certo e não é: reenviar o MESMO arquivo dá o mesmo hash, e
   * aí a tela fica esperando uma mudança que nunca vem.
   *
   * Então não se espera nada. Se ele mandou a foto nesta sessão, a foto dele é
   * o que aparece — é o arquivo que o servidor recebeu, então não há o que
   * corrigir. Some quando ele fecha a tela, aí sim a miniatura vem do servidor.
   *
   * De quebra: zero download. A tela dele fica instantânea e não gasta o 4G.
   */
  const [mandadasAgora, setMandadasAgora] = useState<Record<string, string>>({});

  /**
   * ⚠️ A CONTAGEM SAI DAQUI, e não do servidor.
   *
   * `faltamDele` vem da API, e a API só sabe do arquivo depois que ele SUBIU.
   * Enquanto o upload acontece — que num 4G ruim são minutos — o número do
   * topo continuava idêntico, e pra quem acabou de mandar a foto isso lê como
   * "não aconteceu nada". Ele manda de novo.
   *
   * Descontando a fila local, o número cai NO TOQUE e o que está subindo
   * aparece separado, como o que é: em andamento, não pendência.
   */
  const comErro = (id: string) => {
    const f = filaPor.get(id);
    return f !== undefined && (f.status === "error" || f.attempts >= 8);
  };
  const naFilaSemErro = (id: string) => filaPor.get(id) !== undefined && !comErro(id);
  /**
   * Já saiu do aparelho nesta sessão.
   *
   * ⚠️ Tapa o buraco entre o upload terminar e a resposta nova chegar. Nesse
   * intervalo o item já não está na fila e o servidor ainda responde o que
   * sabia antes — e o número do topo SUBIA de volta. Ele acabava de mandar a
   * foto e via "faltam 5" virar 4 e voltar pra 5.
   */
  const mandouAgora = (id: string) =>
    mandadasAgora[id] !== undefined && filaPor.get(id) === undefined && !comErro(id);
  const faltaDele = (d: DocumentoDaObra) => {
    if (comErro(d.id)) return true; // na fila com erro: só ele resolve
    if (naFilaSemErro(d.id) || mandouAgora(d.id)) return false;
    if (!d.recebido) return true;
    if (d.recusado) return true;
    return d.precisaAssinar && d.comoAssinar === "NO_APP" && d.assinado !== true;
  };
  const faltam = lista.filter(faltaDele).length;
  const subindo = lista.filter((d) => naFilaSemErro(d.id)).length;
  const comOEscritorio = lista.filter((d) => {
    if (naFilaSemErro(d.id) || comErro(d.id)) return false;
    // Depois que o servidor sabe do arquivo, é ele quem diz. `mandouAgora` só
    // cobre a janela em que ele ainda não sabe.
    if (d.recebido) return !d.recusado && d.conferido !== true;
    return mandouAgora(d.id);
  }).length;

  /** Qual documento está com a tela de envio aberta. */
  const [capturando, setCapturando] = useState<DocumentoDaObra | null>(null);

  /**
   * A ÚNICA porta de envio, pras duas origens (câmera/galeria e arquivo).
   *
   * ⚠️ Era isto o defeito: a tela tinha duas chamadas de envio e só uma delas
   * lembrava da foto. O caminho da câmera — o que o motorista usa — não
   * lembrava, e a correção da piscada simplesmente não valia pra ele.
   */
  const mandar = async (alvo: DocumentoDaObra, arq: { uri: string; mime: string; nome?: string }) => {
    const local = await enqueueDocumentoAdmissao({
      exigenciaId: alvo.id,
      titulo: alvo.titulo,
      uri: arq.uri,
      mime: arq.mime,
      nome: arq.nome,
    });
    setMandadasAgora((p) => ({ ...p, [alvo.id]: local }));
  };

  /**
   * Este build consegue abrir os ARQUIVOS do celular?
   *
   * `expo-document-picker` é módulo nativo: chega num build de loja, não por
   * OTA. Enquanto não chegar, o botão não aparece — em vez de aparecer e
   * falhar, ou pior, derrubar o app. Ver `lib/escolher-arquivo.ts`.
   */
  const [temArquivos, setTemArquivos] = useState(false);
  useEffect(() => {
    let vivo = true;
    void podeEscolherArquivo().then((ok) => {
      if (vivo) setTemArquivos(ok);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="bg-brand px-5 pb-6 pt-14">
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="text-2xl font-bold text-white">Seus documentos</Text>
            <Text className="mt-0.5 text-base text-white/80" numberOfLines={1}>
              {/* Quem está pedindo. Nunca nome de empresa chumbado. */}
              {data?.obra ? `Pedidos por ${data.obra}` : "O que o escritório pediu"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={() => router.back()}
            className="p-2"
          >
            <X size={26} color="#fff" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={puxando}
            onRefresh={async () => {
              setPuxando(true);
              try {
                await refetch();
              } finally {
                setPuxando(false);
              }
            }}
          />
        }
      >
        {isLoading && !data ? (
          <Text className="text-center text-base text-muted-foreground">Carregando…</Text>
        ) : !data || data.total === 0 ? (
          <View className="items-center rounded-2xl border-2 border-border bg-card p-8">
            <Check size={40} color="#16a34a" />
            <Text className="mt-3 text-center text-lg font-semibold text-foreground">
              Não tem documento pedido pra você.
            </Text>
            <Text className="mt-1 text-center text-base text-muted-foreground">
              Se pedirem algum, aparece aqui.
            </Text>
          </View>
        ) : (
          <>
            <Contagem
              faltam={faltam}
              total={data.total}
              comOEscritorio={comOEscritorio}
              subindo={subindo}
            />
            <View className="mt-4 gap-3">
              {lista.map((d) => (
                <ItemDocumento
                  key={d.id}
                  doc={d}
                  fila={filaPor.get(d.id)}
                  mandadaAgora={mandadasAgora[d.id]}
                  onMandar={() => setCapturando(d)}
                  onAssinar={() =>
                    router.push({
                      pathname: "/assinar-documento",
                      params: { id: d.id, titulo: d.titulo, mimetype: d.mimetype ?? "" },
                    })
                  }
                />
              ))}
            </View>
            <Text className="mt-6 text-center text-sm text-muted-foreground">
              Se algum papel só existe em arquivo de computador, mande pelo link que o
              escritório passa.
            </Text>
          </>
        )}
      </ScrollView>

      {/* Mandar o arquivo.

          ⚠️ NÃO abre a câmera direto (`autoOpen`), e isso é a mesma lição que a
          tela pública de coleta já pagou: forçar a câmera esconde a galeria, e
          é NA GALERIA que mora o print que o contratante mandou por WhatsApp —
          metade dos papéis chega assim. As duas portas ficam lado a lado, e o
          título em cima diz qual documento ele está mandando: sem isso, quem
          tocou no botão errado só descobre depois. */}
      <Modal
        visible={capturando !== null}
        animationType="slide"
        onRequestClose={() => setCapturando(null)}
      >
        {/* ⚠️ `SafeAreaProvider` PRÓPRIO: `Modal` do RN abre uma janela
            separada, e os insets do provider do app não chegam lá dentro. Sem
            isto o título fica atrás da Dynamic Island — que foi exatamente o
            que apareceu ao abrir esta tela no iPhone. */}
        <SafeAreaProvider>
          <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
            {capturando ? (
            <View className="flex-1 p-5">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-2xl font-bold text-foreground">{capturando.titulo}</Text>
                  {capturando.ajuda ? (
                    <Text className="mt-1 text-base text-muted-foreground">
                      {capturando.ajuda}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fechar"
                  onPress={() => setCapturando(null)}
                  className="p-2"
                >
                  <X size={26} color="#13316b" />
                </Pressable>
              </View>

              <Text className="mt-4 text-base text-foreground">
                Tire uma foto agora ou use uma que já está no celular.
              </Text>

              <View className="mt-5">
                <PhotoCapture
                  value={null}
                  onChange={async (foto) => {
                    const alvo = capturando;
                    setCapturando(null);
                    if (!foto || !alvo) return;
                    await mandar(alvo, { uri: foto.uri, mime: foto.mime });
                  }}
                  onCancel={() => {
                    /* fechar a câmera volta pra esta tela, não pra lista */
                  }}
                />
              </View>

              {/* O terceiro caminho: o papel que chegou em PDF, por e-mail ou
                  WhatsApp. A galeria do celular NÃO mostra PDF, então sem este
                  botão "manda pelo app" quebra na metade da lista — eSocial,
                  certificado de NR e contrato chegam assim. */}
              {temArquivos ? (
                <Button
                  variant="outline"
                  size="lg"
                  className="mt-4"
                  onPress={async () => {
                    const alvo = capturando;
                    const arq = await escolherArquivo();
                    if (!arq || !alvo) return;
                    setCapturando(null);
                    await mandar(alvo, { uri: arq.uri, mime: arq.mime, nome: arq.nome });
                  }}
                  accessibilityLabel="Escolher um arquivo do celular"
                >
                  <Paperclip size={20} color="#13316b" />
                  <Text className="ml-2 text-base font-semibold text-foreground">
                    Mandar um arquivo (PDF)
                  </Text>
                </Button>
              ) : null}

              <Text className="mt-5 text-sm text-muted-foreground">
                {temArquivos
                  ? "Fica guardado no celular e vai pro escritório sozinho quando tiver sinal. Você não precisa esperar aqui."
                  : "A foto fica guardada no celular e vai pro escritório sozinha quando tiver sinal. Se o papel for um PDF, mande pelo link que o escritório passa."}
              </Text>
            </View>
            ) : null}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}

/** O número. É ele que responde a pergunta antes de qualquer leitura. */
function Contagem({
  faltam,
  total,
  comOEscritorio,
  subindo,
}: {
  faltam: number;
  total: number;
  comOEscritorio: number;
  /** Fotos que ele já mandou e estão subindo agora. Não são pendência dele. */
  subindo: number;
}) {
  if (faltam === 0) {
    // ⚠️ "Está tudo lá" ≠ "está tudo certo". Enquanto houver papel esperando
    // alguém olhar, dizer que acabou é prometer em nome do escritório — e ele
    // ia pra obra achando que estava resolvido.
    const esperando = comOEscritorio > 0 || subindo > 0;
    return (
      <View
        className={
          esperando
            ? "rounded-2xl border-2 border-warning bg-card p-5"
            : "rounded-2xl border-2 border-success bg-success/10 p-5"
        }
      >
        <View className="flex-row items-center gap-3">
          {/* Relógio, não nuvem cortada: nuvem cortada é "sem internet", e a
              mensagem aqui é "está conferindo". Ícone que contradiz o texto faz
              o motorista procurar problema de sinal onde não tem. */}
          {esperando ? (
            <Clock size={32} color="#d97706" />
          ) : (
            <Check size={32} color="#16a34a" />
          )}
          <View className="flex-1">
            <Text className="text-xl font-bold text-foreground">
              {esperando ? "Você já mandou tudo." : "Está tudo certo."}
            </Text>
            <Text className="mt-0.5 text-base text-muted-foreground">
              {subindo > 0
                ? `${subindo === 1 ? "1 foto está indo" : `${subindo} fotos estão indo`} pro escritório agora. Pode fechar o app.`
                : esperando
                  ? `O escritório está conferindo ${comOEscritorio === 1 ? "1 papel" : `${comOEscritorio} papéis`}. Se faltar alguma coisa, eles avisam por aqui.`
                  : `Os ${total} documentos foram conferidos.`}
            </Text>
          </View>
        </View>
      </View>
    );
  }
  return (
    <View className="rounded-2xl border-2 border-border bg-card p-5">
      <View className="flex-row items-end gap-2">
        <Text className="text-5xl font-bold leading-none text-foreground">{faltam}</Text>
        <Text className="pb-1 text-xl text-muted-foreground">
          {faltam === 1 ? "falta" : "faltam"}
        </Text>
      </View>
      <Text className="mt-1 text-base text-muted-foreground">
        de {total} que pediram pra você.
      </Text>
      <Text className="mt-3 text-base text-foreground">
        Sem eles o escritório não consegue fechar seu cadastro.
      </Text>

      {/* O que está subindo aparece AQUI, separado do que falta: some do
          número de cima no toque, e ele vê que a foto foi. Sem esta linha, o
          topo ficava igual durante o upload inteiro e quem acabou de mandar
          lia isso como "não aconteceu nada". */}
      {subindo > 0 ? (
        <Text className="mt-2 text-base text-muted-foreground">
          {subindo === 1
            ? "1 foto está indo pro escritório agora."
            : `${subindo} fotos estão indo pro escritório agora.`}
        </Text>
      ) : null}
    </View>
  );
}

function ItemDocumento({
  doc,
  fila,
  mandadaAgora,
  onMandar,
  onAssinar,
}: {
  doc: DocumentoDaObra;
  fila?: { status: string; attempts: number; errorMsg?: string; arquivoUri?: string };
  /** O arquivo que ele mandou nesta sessão. Vence a imagem do servidor. */
  mandadaAgora?: string;
  onMandar: () => void;
  onAssinar: () => void;
}) {
  const validade = estadoValidade(doc.validade);
  const vencido = doc.recebido && validade === "VENCIDO";
  const vencendo = doc.recebido && validade === "VENCENDO";
  const faltaAssinar = doc.recebido && doc.precisaAssinar && !doc.assinado;
  const recusado = doc.recusado === true;
  // Na fila do aparelho: "guardado" enquanto tenta, "deu erro" quando o
  // servidor recusou de verdade e só ele pode resolver.
  const deuErro = fila?.status === "error" || (fila?.attempts ?? 0) >= 8;
  const esperandoSinal = fila !== undefined && !deuErro;
  /**
   * Saiu do aparelho nesta sessão: o servidor respondeu 2xx, senão o item
   * continuaria na fila.
   *
   * ⚠️ Sem isto o item dizia "Ainda não chegou" com a foto que ele mandou
   * desenhada do lado — o texto contradizendo o pixel. É a mesma janela em que
   * o servidor ainda responde o que sabia antes do envio.
   */
  const jaFoi = mandadaAgora !== undefined && fila === undefined && !deuErro;
  const chegou = doc.recebido || jaFoi;
  // ⚠️ "Chegou" não é "está certo": enquanto ninguém do escritório olhar, o
  // item fica em espera, não em verde. O sistema não vê o que tem na foto.
  const esperandoConferencia = chegou && !recusado && doc.conferido !== true;
  const pronto = doc.recebido && doc.conferido === true && !faltaAssinar && !vencido;

  /**
   * Qual foto desenhar: a DELE, se ele mandou alguma nesta sessão.
   *
   * Vale enquanto a tela estiver aberta, sem prazo e sem comparar hash — ver o
   * comentário de `mandadasAgora`. O que está na fila vem primeiro só porque é
   * o caminho já copiado pro aparelho; os dois apontam pro mesmo arquivo.
   */
  const uriDaFoto = deuErro ? undefined : (fila?.arquivoUri ?? mandadaAgora);

  const borda = vencido || recusado
    ? "border-destructive"
    : faltaAssinar || vencendo || esperandoConferencia
      ? "border-warning"
      : pronto
        ? "border-success/60"
        : "border-border";

  return (
    <View className={`rounded-2xl border-2 bg-card p-4 ${borda}`}>
      <View className="flex-row items-start gap-3">
        {/* ⚠️ Quando o arquivo existe, o lugar do ícone é DELE.
            
            A lista dizia "Chegou no escritório" e não mostrava nada: ele
            tirava a foto, o app confirmava, e ele ficava sem saber qual das
            tentativas entrou — nem se mandou a CNH no lugar do comprovante.
            Miniatura ruim é melhor que nada; ela não precisa dar pra LER o
            documento, precisa dar pra RECONHECER qual é. */}
        {/* A foto na fila vence a do servidor: ele acabou de escolher, e ver a
            antiga aqui faria ele mandar de novo achando que não foi. */}
        {uriDaFoto ? (
          <MiniaturaDocumento
            exigenciaId={doc.id}
            /**
             * ⚠️ O tipo sai do ARQUIVO LOCAL, não do que o servidor sabe.
             *
             * `doc.mimetype` é nulo enquanto nada chegou lá — ou seja, no
             * PRIMEIRO envio de cada documento. Como "nulo não é imagem", a
             * tela desenhava o quadradinho de PDF no lugar da foto que ele
             * tinha acabado de tirar. Ele mandava a CNH e via um ícone de
             * arquivo: parecia que o app tinha mandado outra coisa.
             */
            mimetype={uriDaFoto.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"}
            titulo={doc.titulo}
            uriLocal={uriDaFoto}
            // Spinner só enquanto está SUBINDO. Na janela entre o upload
            // terminar e o servidor confirmar, a foto fica lá, parada e
            // correta — sem selo, porque não há nada acontecendo que ele
            // precise saber.
            enviando={fila?.status === "syncing"}
            semSelo={fila === undefined}
          />
        ) : doc.recebido && !esperandoSinal ? (
          <MiniaturaDocumento
            exigenciaId={doc.id}
            mimetype={doc.mimetype ?? null}
            titulo={doc.titulo}
            versao={doc.versao}
          />
        ) : (
          <Icone
            pronto={pronto}
            vencido={vencido || recusado}
            faltaAssinar={faltaAssinar || esperandoConferencia}
          />
        )}
        <View className="flex-1">
          <Text className="text-lg font-semibold text-foreground">{doc.titulo}</Text>

          {/* A explicação vem de quem PEDIU. O app não inventa nome nem
              descrição de documento. */}
          {doc.ajuda ? (
            <Text className="mt-0.5 text-base text-muted-foreground">{doc.ajuda}</Text>
          ) : null}

          {/* "Só se você tiver" vem ANTES da situação, junto do que o papel é:
              lendo na ordem, ele precisa saber que o documento é opcional
              antes de ler que não chegou — senão a primeira coisa que ele lê
              sobre um papel que talvez nem exista é uma cobrança. */}
          {!doc.recebido && !doc.obrigatorio ? (
            <Text className="mt-0.5 text-base text-muted-foreground">Só se você tiver.</Text>
          ) : null}

          <Text
            className={`mt-2 text-base ${
              vencido || recusado ? "font-semibold text-destructive" : "text-muted-foreground"
            }`}
          >
            {/* A fila do aparelho vence o que o servidor diz: ele acabou de
                tirar a foto, e dizer "ainda não chegou" faria ele tirar de
                novo. */}
            {esperandoSinal ? (
              fila?.status === "syncing"
                ? "Mandando agora…"
                : "Guardado aqui. Chega no escritório quando o sinal voltar."
            ) : deuErro ? (
              fila?.errorMsg || "Essa não deu. Tire outra foto."
            ) : recusado ? (
              // O MOTIVO aqui, não numa tela adiante: mandar procurar em outro
              // lugar é pedir um passo a mais de quem já está travado.
              <>Precisa mandar de novo. {doc.recusaMotivo || "O escritório pediu outra foto."}</>
            ) : esperandoConferencia && !faltaAssinar ? (
              "Chegou. O escritório vai conferir."
            ) : (
              <Situacao
                doc={doc}
                pronto={pronto}
                vencido={vencido}
                vencendo={vencendo}
                faltaAssinar={faltaAssinar}
              />
            )}
          </Text>

          {doc.soComCertificado && !doc.assinado ? (
            <Text className="mt-2 text-sm text-muted-foreground">
              Este aqui não dá pra assinar pelo celular. O escritório te explica como fazer.
            </Text>
          ) : null}

          {/* A AÇÃO. Um alvo por item, e o botão é o alvo — a linha inteira não
              é pressionável: ação destrutiva ou de câmera aninhada dentro de
              outro toque, num caminhão sacudindo, é acidente esperando.

              Todos laranja (rotina). Verde aparece UMA vez só, no botão final
              da tela de assinar — doze botões verdes numa lista destroem o
              significado de verde no app inteiro. */}
          {/* Quem assina FORA não tem botão de assinar aqui: o que ele faz é
              mandar o papel já assinado. Oferecer "ler e assinar" seria
              oferecer um aceite que o contratante não aceita. */}
          {!doc.recebido && doc.comoAssinar === "JA_ASSINADO" ? (
            <>
              <Text className="mt-2 text-base text-muted-foreground">
                {doc.soComCertificado
                  ? "Assine pelo gov.br e mande o arquivo assinado. A foto do papel não serve pra este."
                  : "Assine no papel (cartório) ou pelo gov.br, e mande aqui."}
              </Text>
              <Button
                size="lg"
                className="mt-3"
                onPress={onMandar}
                accessibilityLabel={`Mandar ${doc.titulo} assinado`}
              >
                <Camera size={20} color="#fff" />
                <Text className="ml-2 text-base font-bold text-white">
                  Mandar o papel assinado
                </Text>
              </Button>
            </>
          ) : faltaAssinar && !doc.soComCertificado ? (
            <Button size="lg" className="mt-3" onPress={onAssinar} accessibilityLabel={`Ler e assinar ${doc.titulo}`}>
              <PenLine size={20} color="#fff" />
              <Text className="ml-2 text-base font-bold text-white">Ler e assinar</Text>
            </Button>
          ) : esperandoSinal ? null : !chegou || vencido || deuErro || recusado ? (
            <Button
              size="lg"
              className="mt-3"
              variant={doc.obrigatorio || vencido || deuErro || recusado ? "default" : "outline"}
              onPress={onMandar}
              accessibilityLabel={`Mandar foto de ${doc.titulo}`}
            >
              <Camera
                size={20}
                color={doc.obrigatorio || vencido || deuErro || recusado ? "#fff" : "#13316b"}
              />
              <Text
                className={`ml-2 text-base font-bold ${
                  doc.obrigatorio || vencido || deuErro || recusado
                    ? "text-white"
                    : "text-foreground"
                }`}
              >
                {deuErro || recusado
                  ? "Tirar outra foto"
                  : vencido
                    ? "Mandar o novo"
                    : "Mandar foto"}
              </Text>
            </Button>
          ) : doc.precisaAssinar ? (
            // Documento que exige assinatura é papel do ESCRITÓRIO (contrato,
            // ordem de serviço, ficha de EPI): ele não manda, ele assina. E
            // trocar o arquivo DERRUBA a assinatura — oferecer "mandar outra"
            // aqui seria oferecer desfazer o que ele acabou de fazer, sem que
            // nada na tela diga isso.
            null
          ) : (
            /* ⚠️ BOTÃO, não texto sublinhado.
            
               Isto era um link cinza, e pra quem tem pouca familiaridade com
               celular um texto sublinhado não é um alvo: é uma frase. Quem
               quisesse trocar a foto não tinha como saber que dava. Alvo de
               44px, borda visível, verbo do que acontece — o mesmo padrão dos
               outros botões da tela, só que secundário porque o documento já
               está lá. */
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onPress={onMandar}
              accessibilityLabel={`Trocar a foto de ${doc.titulo}`}
            >
              <Camera size={18} color="#13316b" />
              <Text className="ml-2 text-base font-semibold text-foreground">Trocar a foto</Text>
            </Button>
          )}
        </View>
      </View>
    </View>
  );
}

function Icone({
  pronto,
  vencido,
  faltaAssinar,
}: {
  pronto: boolean;
  vencido: boolean;
  faltaAssinar: boolean;
}) {
  if (vencido) return <CloudOff size={24} color="#dc2626" />;
  if (faltaAssinar) return <PenLine size={24} color="#d97706" />;
  if (pronto) return <Check size={24} color="#16a34a" />;
  // "Falta" é cinza: ele ainda não teve chance de fazer nada de errado.
  return <FileText size={24} color="#9ca3af" />;
}

function Situacao({
  doc,
  pronto,
  vencido,
  vencendo,
  faltaAssinar,
}: {
  doc: DocumentoDaObra;
  pronto: boolean;
  vencido: boolean;
  vencendo: boolean;
  faltaAssinar: boolean;
}) {
  const venc = dataBR(doc.validade);
  if (vencido) return <>Venceu dia {venc}. Precisa mandar o novo.</>;
  if (faltaAssinar) return <>Chegou. Agora falta você assinar.</>;
  // Quem assina fora nem chega em "falta assinar": pra ele, mandar o papel
  // assinado É a assinatura. O que falta é o arquivo.
  if (!doc.recebido && doc.comoAssinar === "JA_ASSINADO") {
    return <>Precisa estar assinado. Ainda não chegou.</>;
  }
  if (vencendo) return <>Vence dia {venc}. Vai precisar mandar o novo.</>;
  if (pronto) {
    const quando = dataBR(doc.assinadoEm ?? doc.recebidoEm);
    if (doc.assinado) return <>Assinado{quando ? ` em ${quando}` : ""}. Conferido.</>;
    // "Conferido" e não "chegou": chegar é o aparelho; conferir é uma pessoa
    // do escritório dizendo que olhou. Confundir os dois foi o defeito.
    return <>Conferido{quando ? `, mandado em ${quando}` : ""}.</>;
  }
  return <>Ainda não chegou.</>;
}
