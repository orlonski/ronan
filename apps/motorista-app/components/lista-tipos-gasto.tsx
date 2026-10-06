import { router } from "expo-router";
import { ChevronRight, Fuel, Route } from "lucide-react-native";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { IconeTipo } from "@/components/gastos";
import { usePermite } from "@/lib/acessos-app";
import { useTiposDespesa } from "@/lib/gastos";
import { useMe } from "@/lib/queries";

/**
 * "O que você pagou?" — LISTA DE NAVEGAÇÃO, não seletor: um toque escolhe e
 * já abre o formulário certo. Nada destacado ao abrir, ordem fixa do painel
 * (nunca por uso), "Outro" sempre por último.
 *
 * Mora em dois lugares com o MESMO código:
 * - a aba Gastos (`voltar: "1"`): o formulário fecha e cai de volta na aba;
 * - a tela `/gasto-viagem` (`voltar: "2"`): fecha o formulário E a lista.
 *
 * `contexto` = os dados da viagem quando aberta de dentro dela. Aí só os
 * tipos da empresa: pedágio já é o campo da tela anterior e abastecimento
 * não tem viagem.
 */
export function ListaTiposGasto({
  voltar,
  contexto,
}: {
  voltar: "1" | "2";
  contexto?: { viagemClientId?: string; viagemRotulo?: string; veiculoId?: string };
}) {
  const daViagem = !!contexto?.viagemClientId;
  const me = useMe();
  const tipos = useTiposDespesa();
  const permitePedagio = usePermite("app.pedagio.lancar");
  const permiteAbastecimento = usePermite("app.abastecimento.lancar");
  const pedagio = !daViagem && (me.data?.podeLancarPedagio ?? false) && permitePedagio;
  const abastecimento =
    !daViagem && (me.data?.podeLancarAbastecimento ?? false) && permiteAbastecimento;

  const ctx: Record<string, string> = { voltar };
  if (contexto?.viagemClientId) ctx.viagemClientId = contexto.viagemClientId;
  if (contexto?.viagemRotulo) ctx.viagemRotulo = contexto.viagemRotulo;
  if (contexto?.veiculoId) ctx.veiculoId = contexto.veiculoId;

  return (
    <View className="gap-4">
      {pedagio || abastecimento ? (
        <Grupo>
          {pedagio ? (
            <Linha
              icone={<IconeSistema Icone={Route} />}
              nome="Pedágio"
              onPress={() => router.push("/novo-pedagio")}
            />
          ) : null}
          {pedagio && abastecimento ? <Divisor /> : null}
          {abastecimento ? (
            <Linha
              icone={<IconeSistema Icone={Fuel} />}
              nome="Abastecimento"
              onPress={() => router.push("/novo-abastecimento")}
            />
          ) : null}
        </Grupo>
      ) : null}

      {!tipos.chegaram ? (
        <View className="gap-3 rounded-2xl border-2 border-dashed border-border p-4">
          <Text className="text-base text-foreground">
            Os tipos de gasto do escritório ainda não chegaram neste celular. Quando pegar sinal,
            eles aparecem aqui.
          </Text>
          <Button variant="outline" onPress={tipos.tentarAgora} loading={tipos.carregando}>
            Tentar agora
          </Button>
        </View>
      ) : tipos.daEmpresa.length > 0 ? (
        <Grupo>
          {tipos.daEmpresa.map((t, i) => (
            <View key={t.id}>
              {i > 0 ? <Divisor /> : null}
              <Linha
                icone={<IconeTipo icone={t.icone} slug={t.slug} />}
                nome={t.nome}
                sub={t.reembolsa ? undefined : "Por sua conta"}
                onPress={() =>
                  router.push({ pathname: "/gasto-novo", params: { ...ctx, tipoId: t.id } })
                }
              />
            </View>
          ))}
        </Grupo>
      ) : null}
    </View>
  );
}

function Grupo({ children }: { children: React.ReactNode }) {
  return (
    <View className="overflow-hidden rounded-2xl border-2 border-border bg-card">{children}</View>
  );
}

function Divisor() {
  return <View className="ml-[72px] h-px bg-border" />;
}

function IconeSistema({ Icone }: { Icone: typeof Route }) {
  return (
    <View className="h-10 w-10 items-center justify-center rounded-xl bg-sky-100">
      <Icone size={22} color="#13316b" strokeWidth={2.2} />
    </View>
  );
}

function Linha({
  icone,
  nome,
  sub,
  onPress,
}: {
  icone: React.ReactNode;
  nome: string;
  sub?: string;
  onPress: ComponentProps<typeof Pressable>["onPress"];
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-4 px-4 active:bg-muted"
      style={{ minHeight: 64 }}
    >
      {icone}
      <View className="flex-1 py-2">
        <Text className="text-lg font-semibold text-foreground">{nome}</Text>
        {sub ? <Text className="text-[13px] text-muted-foreground">{sub}</Text> : null}
      </View>
      <ChevronRight size={22} color="#64748b" />
    </Pressable>
  );
}
