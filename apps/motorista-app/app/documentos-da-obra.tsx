import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Check, CloudOff, FileText, PenLine, X } from "lucide-react-native";
import { Pressable } from "react-native";
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
  if (d.recebido && estadoValidade(d.validade) === "VENCIDO") return 0;
  if (!d.recebido && d.obrigatorio) return 1;
  if (!d.recebido) return 2;
  if (d.precisaAssinar && !d.assinado) return 3;
  return 4;
}

export default function DocumentosDaObraScreen() {
  const router = useRouter();
  const { data, isLoading, refetch } = useDocumentosDaObra();
  // RefreshControl só no gesto: recarga automática prende o spinner no iOS.
  const [puxando, setPuxando] = useState(false);

  const faltam = data ? data.total - data.prontos : 0;
  const lista = [...(data?.documentos ?? [])].sort((a, b) => peso(a) - peso(b));

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
            <Contagem faltam={faltam} total={data.total} />
            <View className="mt-4 gap-3">
              {lista.map((d) => (
                <ItemDocumento key={d.id} doc={d} />
              ))}
            </View>
            <Text className="mt-6 text-center text-sm text-muted-foreground">
              Por enquanto os documentos são mandados pelo link que o escritório passa. Em
              breve dá pra mandar por aqui mesmo.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** O número. É ele que responde a pergunta antes de qualquer leitura. */
function Contagem({ faltam, total }: { faltam: number; total: number }) {
  if (faltam === 0) {
    return (
      <View className="rounded-2xl border-2 border-success bg-success/10 p-5">
        <View className="flex-row items-center gap-3">
          <Check size={32} color="#16a34a" />
          <View className="flex-1">
            <Text className="text-xl font-bold text-foreground">Está tudo lá.</Text>
            <Text className="mt-0.5 text-base text-muted-foreground">
              Os {total} documentos chegaram no escritório.
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
    </View>
  );
}

function ItemDocumento({ doc }: { doc: DocumentoDaObra }) {
  const validade = estadoValidade(doc.validade);
  const vencido = doc.recebido && validade === "VENCIDO";
  const vencendo = doc.recebido && validade === "VENCENDO";
  const faltaAssinar = doc.recebido && doc.precisaAssinar && !doc.assinado;
  const pronto = doc.recebido && !faltaAssinar && !vencido;

  const borda = vencido
    ? "border-destructive"
    : faltaAssinar || vencendo
      ? "border-warning"
      : pronto
        ? "border-success/60"
        : "border-border";

  return (
    <View className={`rounded-2xl border-2 bg-card p-4 ${borda}`}>
      <View className="flex-row items-start gap-3">
        <Icone pronto={pronto} vencido={vencido} faltaAssinar={faltaAssinar} />
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

          <Text className={`mt-2 text-base ${vencido ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
            <Situacao
              doc={doc}
              pronto={pronto}
              vencido={vencido}
              vencendo={vencendo}
              faltaAssinar={faltaAssinar}
            />
          </Text>

          {doc.soComCertificado && !doc.assinado ? (
            <Text className="mt-2 text-sm text-muted-foreground">
              Este aqui não dá pra assinar pelo celular. O escritório te explica como fazer.
            </Text>
          ) : null}
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
  if (vencendo) return <>Vence dia {venc}. Vai precisar mandar o novo.</>;
  if (pronto) {
    const quando = dataBR(doc.assinadoEm ?? doc.recebidoEm);
    if (doc.assinado) return <>Assinado{quando ? ` em ${quando}` : ""}.</>;
    return <>Chegou no escritório{quando ? ` em ${quando}` : ""}.</>;
  }
  return <>Ainda não chegou.</>;
}
