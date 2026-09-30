import { useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { CAMPOS_DIVERGENTES, ROTULO_CAMPO_DIVERGENTE, type CampoDivergente } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { useCatalogos, useCorrigirDadosDivergentes, type ViagemDetalhe } from "@/lib/queries";

/**
 * Card de DADOS_DIVERGENTES: um campo pra cada dado que a conferência apontou,
 * já preenchido com o que foi lançado. O motorista troca o que estiver
 * diferente do ticket; se estiver tudo certo, explica.
 *
 * Só vai pro servidor o que ele de fato mudou. Corrigido, a viagem volta
 * sozinha pra conferência automática — por isso o texto não fala em "aguardar
 * revisão".
 *
 * As listas (placa, obra, material) vêm do catálogo offline, então o card
 * funciona sem sinal; o envio precisa de rede, como nos outros cards.
 */
export function CardCorrigirDados({ viagem }: { viagem: ViagemDetalhe }) {
  const catalogos = useCatalogos();
  const corrigir = useCorrigirDadosDivergentes();

  // A ordem da tela é a do catálogo, não a de quem marcou.
  const campos = useMemo(
    () => CAMPOS_DIVERGENTES.filter((c) => (viagem.camposDivergentes ?? []).includes(c)),
    [viagem.camposDivergentes],
  );

  const tonAtual = viagem.toneladas != null && viagem.toneladas !== "" ? Number(viagem.toneladas) : null;
  const diaAtual = viagem.data ? viagem.data.slice(0, 10) : "";

  const [ticket, setTicket] = useState(viagem.ticket ?? "");
  const [toneladas, setToneladas] = useState(tonAtual != null ? tonAtual.toFixed(2).replace(".", ",") : "");
  const [data, setData] = useState(diaAtual);
  const [veiculoId, setVeiculoId] = useState(viagem.veiculo?.id ?? "");
  const [clienteId, setClienteId] = useState(viagem.cliente?.id ?? "");
  const [materialId, setMaterialId] = useState(viagem.material?.id ?? "");
  const [justificativa, setJustificativa] = useState("");

  const opcoes = useMemo(() => {
    const c = catalogos.data;
    const veiculos: SelectOption[] = (c?.veiculos ?? []).map((v) => ({ value: v.id, label: v.placa }));
    const clientes: SelectOption[] = (c?.clientes ?? []).map((cl) => ({ value: cl.id, label: cl.nome }));
    const materiais: SelectOption[] = (c?.materiais ?? []).map((m) => ({ value: m.id, label: m.nome }));
    return { veiculos, clientes, materiais };
  }, [catalogos.data]);

  async function enviar() {
    const corpo: Parameters<typeof corrigir.mutateAsync>[0] = { viagemId: viagem.id };

    if (campos.includes("ticket")) {
      const t = ticket.trim().toUpperCase();
      if (t && t !== (viagem.ticket ?? "")) corpo.ticket = t;
    }
    if (campos.includes("toneladas") && toneladas.trim()) {
      const n = Number(toneladas.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(n) || n <= 0 || n > 9999) {
        void showAlert({ title: "Confira as toneladas", message: "Digite o peso líquido do ticket, ex.: 32,50." });
        return;
      }
      if (tonAtual == null || Math.abs(n - tonAtual) > 0.0005) corpo.toneladas = n;
    }
    if (campos.includes("data") && data && data !== diaAtual) corpo.data = data;
    if (campos.includes("placa") && veiculoId && veiculoId !== viagem.veiculo?.id) corpo.veiculoId = veiculoId;
    if (campos.includes("cliente") && clienteId && clienteId !== viagem.cliente?.id) corpo.clienteId = clienteId;
    if (campos.includes("material") && materialId && materialId !== viagem.material?.id) {
      corpo.materialId = materialId;
    }

    const mudou = Object.keys(corpo).length > 1;
    const explicacao = justificativa.trim();
    if (!mudou && explicacao.length < 5) {
      void showAlert({
        title: "Nada mudou",
        message: "Corrija o que estiver diferente do ticket. Se estiver tudo certo, explique em poucas palavras.",
      });
      return;
    }
    if (explicacao) corpo.justificativa = explicacao;

    try {
      await corrigir.mutateAsync(corpo);
      void showAlert({
        title: "Obrigado!",
        message: mudou
          ? "Correção enviada. A viagem volta pra conferência."
          : "Explicação enviada. A operação vai olhar a viagem.",
      });
    } catch (err) {
      void showAlert({ title: "Não deu pra enviar", message: humanizeApiError(err) });
    }
  }

  return (
    <Card className="border-2 border-orange-500 bg-orange-50">
      <View className="flex-row items-start gap-3">
        <AlertTriangle size={20} color="#ea580c" />
        <View className="flex-1">
          <Text className="text-base font-bold text-orange-900">Confira com o ticket</Text>
          <Text className="mt-1 text-sm text-orange-900">
            {campos.length === 1
              ? `${ROTULO_CAMPO_DIVERGENTE[campos[0]]} parece diferente do ticket.`
              : `Estes dados parecem diferentes do ticket: ${campos
                  .map((c) => ROTULO_CAMPO_DIVERGENTE[c].toLowerCase())
                  .join(", ")}.`}{" "}
            Se for isso, corrija abaixo. Se estiver certo, é só explicar.
          </Text>
          {viagem.motivoStatus ? (
            <Text className="mt-2 text-sm text-orange-800">{viagem.motivoStatus}</Text>
          ) : null}

          {campos.map((campo) => (
            <View key={campo} className="mt-3">
              <Text className="text-sm font-medium text-foreground">{ROTULO_CAMPO_DIVERGENTE[campo]}</Text>
              <View className="mt-1">{renderCampo(campo)}</View>
            </View>
          ))}

          <Text className="mt-3 text-sm font-medium text-foreground">
            Quer explicar algo? (obrigatório se não mudar nada)
          </Text>
          <TextInput
            value={justificativa}
            onChangeText={setJustificativa}
            placeholder="Ex.: digitei errado / o ticket está certo, a foto cortou"
            multiline
            maxLength={500}
            className="mt-1 min-h-16 rounded-md border border-input bg-white px-3 py-2 text-base text-foreground"
          />

          <Button
            variant="success"
            className="mt-3"
            loading={corrigir.isPending}
            disabled={corrigir.isPending}
            onPress={() => void enviar()}
          >
            Enviar correção
          </Button>
        </View>
      </View>
    </Card>
  );

  function renderCampo(campo: CampoDivergente) {
    const inputClass =
      "rounded-md border border-input bg-white px-3 py-3 text-base text-foreground";
    if (campo === "ticket") {
      return (
        <TextInput
          value={ticket}
          onChangeText={setTicket}
          autoCapitalize="characters"
          maxLength={50}
          placeholder="Número do ticket"
          className={inputClass}
        />
      );
    }
    if (campo === "toneladas") {
      return (
        <TextInput
          value={toneladas}
          onChangeText={setToneladas}
          keyboardType="decimal-pad"
          maxLength={9}
          placeholder="0,00"
          className={inputClass}
        />
      );
    }
    if (campo === "data") return <DateField value={data} onChange={setData} />;
    if (campo === "placa") {
      return (
        <Select value={veiculoId} onChange={setVeiculoId} options={opcoes.veiculos} title="Placa" searchable />
      );
    }
    if (campo === "cliente") {
      return (
        <Select value={clienteId} onChange={setClienteId} options={opcoes.clientes} title="Obra" searchable />
      );
    }
    return (
      <Select value={materialId} onChange={setMaterialId} options={opcoes.materiais} title="Material" searchable />
    );
  }
}
