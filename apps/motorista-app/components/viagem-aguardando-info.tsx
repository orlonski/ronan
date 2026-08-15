import { ArrowDown, ArrowUp, Clock, MessageSquare } from "lucide-react-native";
import { Text, View } from "react-native";
import { Badge } from "@/components/ui/badge";
import { fmtDataBR, fmtDataHoraCurta } from "@/lib/datetime";
import { fmtNum } from "@/lib/format";
import type { Viagem } from "@/lib/queries";

/** "Local — Cidade/UF" (ou só o nome quando não tem cidade). */
function localComCidade(l?: {
  nome?: string;
  cidade?: string | null;
  uf?: string | null;
} | null): { nome: string; cidade: string } {
  const nome = l?.nome ?? "—";
  const cidade = l?.cidade ? `${l.cidade}${l.uf ? `/${l.uf}` : ""}` : "";
  return { nome, cidade };
}

/**
 * Bloco de detalhes de uma viagem aguardando peso — pensado pro motorista bater
 * o olho e reconhecer a viagem na hora: cliente + material, trajeto origem →
 * destino (com cidade), km, data, placa e quando foi lançada. Reusado na lista
 * (`aguardando-peso`) e na tela de completar (`completar-peso`).
 */
export function ViagemAguardandoInfo({ viagem: v }: { viagem: Viagem }) {
  const carga = localComCidade(v.localCarga);
  const descarga = localComCidade(v.localDescarga);
  const placa = v.veiculo?.placa ?? "";
  const modelo = v.veiculo?.modelo ? ` · ${v.veiculo.modelo}` : "";

  return (
    <View className="flex-1 gap-2">
      {/* Cliente + material */}
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-lg font-bold text-foreground" numberOfLines={1}>
          {v.cliente?.nome ?? "Viagem"}
        </Text>
        {v.material?.nome ? (
          <Badge variant="secondary">{v.material.nome}</Badge>
        ) : null}
      </View>

      {/* Trajeto: origem → destino */}
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <ArrowUp size={16} color="#16a34a" />
          <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={1}>
            {carga.nome}
            {carga.cidade ? (
              <Text className="text-sm font-normal text-muted-foreground">
                {"  "}
                {carga.cidade}
              </Text>
            ) : null}
          </Text>
        </View>
        {/* Modo de serviço sem local de descarga (diária à disposição) não
            tem a segunda linha — mostrar "—" com seta vermelha pareceria erro. */}
        {v.localDescarga ? (
          <View className="flex-row items-center gap-2">
            <ArrowDown size={16} color="#dc2626" />
            <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={1}>
              {descarga.nome}
              {descarga.cidade ? (
                <Text className="text-sm font-normal text-muted-foreground">
                  {"  "}
                  {descarga.cidade}
                </Text>
              ) : null}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Stats: km · data · placa */}
      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        {/* Diária pode não ter km (caminhão à disposição): "0,00 km" seria ruído. */}
        {v.km && Number(v.km) > 0 ? (
          <>
            <Stat>{fmtNum(v.km, 2)} km</Stat>
            <Dot />
          </>
        ) : null}
        <Stat>{v.data ? fmtDataBR(v.data) : "—"}</Stat>
        {placa ? (
          <>
            <Dot />
            <Stat>
              {placa}
              {modelo}
            </Stat>
          </>
        ) : null}
      </View>

      {/* Lançada */}
      {v.sincronizadoEm ? (
        <View className="flex-row items-center gap-1.5">
          <Clock size={13} color="#94a3b8" />
          <Text className="text-xs text-muted-foreground">
            Lançada {fmtDataHoraCurta(v.sincronizadoEm)}
          </Text>
        </View>
      ) : null}

      {/* Observação, se houver */}
      {v.observacao ? (
        <View className="mt-0.5 flex-row items-start gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1.5">
          <MessageSquare size={14} color="#64748b" style={{ marginTop: 2 }} />
          <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={3}>
            {v.observacao}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ children }: { children: React.ReactNode }) {
  return (
    <Text
      className="text-sm font-semibold text-foreground"
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {children}
    </Text>
  );
}

function Dot() {
  return <Text className="text-sm text-muted-foreground">·</Text>;
}
