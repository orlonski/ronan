import { router } from "expo-router";
import { Text, View } from "react-native";
import { AlertTriangle, CheckCircle2, FileText } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useCapacidadeNova } from "@/lib/acessos-app";
import { CAP_ETAPAS } from "@/lib/etapas";
import { etapasAbertas, useEstadoEtapas, type EtapaAberta } from "@/lib/etapas-local";

export function abrirEtapa(viagemClientId: string, modeloId: string): void {
  router.push({ pathname: "/etapa", params: { viagemClientId, modeloId } });
}

/** O formulário está fechado: tudo feito, ou concluído com "mandar o resto depois". */
export function etapaConcluida(e: EtapaAberta): boolean {
  const { feitos, total, faltando } = e.contagem;
  return (faltando.length === 0 && feitos === total) || !!e.rascunho?.concluidaEm;
}

/**
 * Um formulário da viagem: "Documentos da carga — 5 de 7", o que falta e o botão.
 *
 * `botao` muda só o peso do botão, nunca o que ele faz:
 * - "principal": é o próximo passo da viagem guiada (cartão "Agora") — botão
 *   grande laranja. Rótulo curto de propósito: "Preencher documentos" cabe numa
 *   linha num Android de 360dp; o nome do formulário já está no título.
 * - "contorno": está na tela, mas outro passo vem antes.
 * - omitido: como sempre foi (detalhe da viagem).
 */
export function CartaoEtapa({
  e,
  botao,
  destaque,
}: {
  e: EtapaAberta;
  botao?: "principal" | "contorno";
  /** Borda laranja: é o "Agora" da viagem guiada. */
  destaque?: boolean;
}) {
  const { feitos, total, faltando } = e.contagem;
  const completo = faltando.length === 0 && (feitos === total || !!e.rascunho?.concluidaEm);
  const naoSeguir = faltando.filter((i) => i.seFaltar === "NAO_SEGUIR");
  const pct = total > 0 ? Math.round((feitos / total) * 100) : 0;
  const nunca = !e.rascunho;

  return (
    <View
      className={`gap-3 rounded-2xl border-2 p-4 ${
        naoSeguir.length > 0
          ? "border-warning bg-warning/10"
          : destaque
            ? "border-primary/40 bg-card"
            : "border-border bg-card"
      }`}
    >
      <View className="flex-row items-center gap-2">
        {completo ? <CheckCircle2 size={20} color="#16a34a" /> : <FileText size={20} color="#ea580c" />}
        <Text className="flex-1 text-base font-extrabold text-foreground" numberOfLines={2}>
          {e.modelo.nome}
        </Text>
        <Text className="text-base font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
          {feitos} de {total}
        </Text>
      </View>
      <View className="h-2.5 overflow-hidden rounded-full bg-muted">
        <View className="h-2.5 rounded-full bg-success" style={{ width: `${pct}%` }} />
      </View>
      {faltando.length > 0 ? (
        <Text className="text-sm text-muted-foreground" numberOfLines={3}>
          Falta: {faltando.map((i) => i.rotulo).join(" · ")}
        </Text>
      ) : null}
      {naoSeguir.length > 0 ? (
        <View className="flex-row items-start gap-2">
          <AlertTriangle size={18} color="#b45309" style={{ marginTop: 1 }} />
          <Text className="flex-1 text-sm font-semibold text-foreground">
            O escritório precisa antes de seguir: {naoSeguir.map((i) => i.rotulo).join(" · ")}
          </Text>
        </View>
      ) : null}
      {completo ? (
        <Button variant="outline" onPress={() => abrirEtapa(e.viagem.viagemClientId, e.modelo.id)}>
          <FileText size={20} color="#0f172a" />
          <Text className="text-base font-semibold text-foreground">Ver documentos</Text>
        </Button>
      ) : botao === "principal" ? (
        <Button size="lg" onPress={() => abrirEtapa(e.viagem.viagemClientId, e.modelo.id)}>
          <FileText size={22} color="white" />
          <Text
            className="shrink text-lg font-bold text-primary-foreground"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {nunca ? "Preencher documentos" : "Continuar documentos"}
          </Text>
        </Button>
      ) : botao === "contorno" ? (
        <Button variant="outline" onPress={() => abrirEtapa(e.viagem.viagemClientId, e.modelo.id)}>
          <FileText size={20} color="#0f172a" />
          <Text className="shrink text-base font-semibold text-foreground" numberOfLines={1}>
            {nunca ? "Preencher documentos" : "Continuar documentos"}
          </Text>
        </Button>
      ) : (
        <Button onPress={() => abrirEtapa(e.viagem.viagemClientId, e.modelo.id)}>
          <FileText size={20} color="white" />
          <Text className="text-base font-semibold text-primary-foreground">
            {nunca ? "Abrir documentos" : "Continuar documentos"}
          </Text>
        </Button>
      )}
    </View>
  );
}

/**
 * Os documentos de UMA viagem (viagem guiada e detalhe da viagem). Função
 * desligada ou viagem sem formulário = não desenha nada (app como antes).
 */
export function CartaoEtapasViagem({ viagemClientId }: { viagemClientId: string }) {
  const ligado = useCapacidadeNova(CAP_ETAPAS);
  const estado = useEstadoEtapas();
  if (!ligado || !estado) return null;
  const etapas = etapasAbertas(estado, viagemClientId);
  if (etapas.length === 0) return null;
  return (
    <View className="gap-3">
      <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Documentos da viagem
      </Text>
      {etapas.map((e) => (
        <CartaoEtapa key={e.modelo.id} e={e} />
      ))}
    </View>
  );
}
