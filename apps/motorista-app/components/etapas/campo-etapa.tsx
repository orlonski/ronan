import { useRef, useState, type ComponentProps } from "react";
import { Text, View } from "react-native";
import { CheckCircle2 } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { AssinaturaPad } from "@/components/assinatura-pad";
import { ErroCampo } from "@/components/validacao-guiada";

import { Input } from "@/components/ui/input";
import { InputDinheiro } from "@/components/ui/input-dinheiro";
import { Select } from "@/components/ui/select";
import type { ItemEtapa } from "@/lib/etapas";
import {
  extraDaResposta,
  itemRespondido,
  pedeComentarioAgora,
  pedeFotosAgora,
  type ArquivoRascunho,
  type RespostaItem,
} from "@/lib/etapas-local";
import { ArquivosItem } from "./arquivos-item";

/** Sim/Não em LISTA (decisão do dono): nada vem marcado. */
const OPCOES_SIM_NAO = [
  { value: "SIM", label: "Sim" },
  { value: "NAO", label: "Não" },
];

/**
 * Campo de texto que grava SEMPRE a versão mais nova do que ele digitou.
 *
 * O nativo numera cada mudança (`eventCount`, cresce a cada letra). Um aviso
 * que chega fora de ordem — mais velho que o último já visto — não volta o
 * texto pra trás: na tela ficava "Agência Rota Sul" e no celular e no
 * escritório só "A". E ao sair do campo, grava o texto que está NA TELA: se
 * algum aviso se perdeu no caminho, o que ele vê é o que vale.
 */
function TextoEtapa({
  valor,
  onTexto,
  filtrar,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onChangeText" | "onEndEditing"> & {
  valor: string;
  onTexto: (t: string) => void;
  /** Limpa o que ele digitou antes de gravar (ex.: só dígitos no número). */
  filtrar?: (t: string) => string;
}) {
  const ultimoEvento = useRef(-1);
  const valorAtual = useRef(valor);
  valorAtual.current = valor;
  const limpo = (t: string) => (filtrar ? filtrar(t) : t);
  return (
    <Input
      {...props}
      value={valor}
      onChange={(e) => {
        const n = e.nativeEvent.eventCount;
        if (typeof n === "number") {
          if (n < ultimoEvento.current) return;
          ultimoEvento.current = n;
        }
        onTexto(limpo(e.nativeEvent.text));
      }}
      onEndEditing={(e) => {
        const t = e.nativeEvent.text;
        if (typeof t === "string" && limpo(t) !== valorAtual.current) onTexto(limpo(t));
      }}
    />
  );
}

/**
 * UM item do formulário, do jeito do tipo. Cada mudança chama `onMudar` na
 * hora — quem grava no celular é a tela (sem botão Salvar).
 */
export function CampoEtapa({
  item,
  resposta,
  erro,
  aviso,
  idsNaFila,

  somenteLeitura,
  onMudar,
  onDesenhando,
}: {
  item: ItemEtapa;
  resposta: RespostaItem | undefined;
  /** Frase da validação guiada, quando é este que falta. */
  erro: string | null;
  /** Recado do servidor sobre este item (arquivo recusado). */
  aviso?: string | null;
  idsNaFila: Set<string>;

  somenteLeitura?: boolean;
  onMudar: (f: (r: RespostaItem) => RespostaItem) => void;
  onDesenhando: (ativo: boolean) => void;
}) {
  const r: RespostaItem = resposta ?? { arquivos: [] };
  const [recado, setRecado] = useState<string | null>(null);
  const ok = itemRespondido(item, resposta);
  const destacado = !!erro || !!aviso;

  const arquivosDoItem = (
    <ArquivosItem
      titulo={item.rotulo}
      arquivos={r.arquivos}
      max={item.fotos.max}
      aceitaPdf={item.tipo === "ARQUIVO"}
      idsNaFila={idsNaFila}
      desabilitado={somenteLeitura}
      onAviso={setRecado}
      onAdicionar={(a: ArquivoRascunho) => onMudar((x) => ({ ...x, arquivos: [...x.arquivos, a] }))}
      onRemover={(id) => onMudar((x) => ({ ...x, arquivos: x.arquivos.filter((a) => a.id !== id) }))}
    />
  );

  return (
    <View
      className={`gap-3 rounded-xl p-3 ${
        destacado ? "border-2 border-warning bg-warning/10" : "border border-border bg-background"
      }`}
    >
      <View className="flex-row items-start gap-2">
        <Text className="flex-1 text-base font-bold text-foreground">{item.rotulo}</Text>
        {ok ? (
          <CheckCircle2 size={20} color="#16a34a" />
        ) : item.obrigatorio ? (
          <Text className="text-sm font-semibold text-muted-foreground">obrigatório</Text>
        ) : null}
      </View>
      {item.ajuda ? <Text className="-mt-2 text-sm text-muted-foreground">{item.ajuda}</Text> : null}
      {item.tipo === "ARQUIVO" ? (
        <Text className="-mt-2 text-sm text-muted-foreground">
          Vale PDF ou uma foto da tela do celular.
        </Text>
      ) : null}

      {item.tipo === "TEXTO" || item.tipo === "TEXTO_FOTO" ? (
        <TextoEtapa
          valor={r.texto ?? ""}
          editable={!somenteLeitura}
          onTexto={(t) => onMudar((x) => ({ ...x, texto: t }))}
          placeholder="Escreva aqui"
          maxLength={500}
          error={!!erro}
        />
      ) : null}

      {item.tipo === "NUMERO" ? (
        <TextoEtapa
          valor={r.numero ?? ""}
          editable={!somenteLeitura}
          keyboardType="decimal-pad"
          filtrar={(t) => t.replace(/[^0-9.,]/g, "")}
          onTexto={(t) => onMudar((x) => ({ ...x, numero: t }))}
          placeholder={item.numero.unidade ? `0 ${item.numero.unidade}` : "0"}
          maxLength={15}
          error={!!erro}
        />
      ) : null}

      {item.tipo === "VALOR" ? (
        <InputDinheiro
          centavos={r.valorCentavos ?? 0}
          editable={!somenteLeitura}
          onChangeCentavos={(c) => onMudar((x) => ({ ...x, valorCentavos: c }))}
          placeholder="R$ 0,00"
          error={!!erro}
        />
      ) : null}

      {item.tipo === "SIM_NAO" ? (
        <Select
          value={r.simNao == null ? "" : r.simNao ? "SIM" : "NAO"}
          disabled={somenteLeitura}
          onChange={(v) => onMudar((x) => ({ ...x, simNao: v === "SIM" ? true : v === "NAO" ? false : null }))}
          options={OPCOES_SIM_NAO}
          placeholder="Escolha…"
          title={item.rotulo}
          error={!!erro}
        />
      ) : null}

      {pedeComentarioAgora(item, r) ? (
        <TextoEtapa
          valor={r.comentario ?? ""}
          editable={!somenteLeitura}
          onTexto={(t) => onMudar((x) => ({ ...x, comentario: t }))}
          placeholder={extraDaResposta(item, r)?.comentario === "EXIGE" ? "Comentário" : "Comentário (opcional)"}
          maxLength={500}
          multiline
          className="h-24 py-3"
          style={{ textAlignVertical: "top" }}
        />
      ) : null}

      {item.tipo === "ASSINATURA" ? (
        <View className="gap-2">
          {item.assinatura.pedeNome ? (
            <TextoEtapa
              valor={r.assinanteNome ?? ""}
              editable={!somenteLeitura}
              onTexto={(t) => onMudar((x) => ({ ...x, assinanteNome: t }))}
              placeholder="Nome de quem assina"
              maxLength={120}
            />
          ) : null}
          {somenteLeitura ? (
            r.assinaturaSvg ? (
              <View className="h-36 rounded-xl border-2 border-border bg-white">
                <Svg width="100%" height="100%" viewBox="0 0 300 150">
                  <Path d={r.assinaturaSvg} stroke="#111827" strokeWidth={2.5} fill="none" />
                </Svg>
              </View>
            ) : null
          ) : (
            // O quadro já traz o "Apagar e assinar de novo".
            <AssinaturaPad
              valor={r.assinaturaSvg ?? ""}
              onChange={(d) => onMudar((x) => ({ ...x, assinaturaSvg: d || undefined }))}
              onDesenhando={onDesenhando}
            />
          )}
        </View>
      ) : null}

      {pedeFotosAgora(item, r) ? arquivosDoItem : null}

      {aviso ? <Text className="text-base font-semibold text-foreground">{aviso}</Text> : null}
      {recado ? <Text className="text-base font-semibold text-foreground">{recado}</Text> : null}
      {erro ? <ErroCampo msg={erro} /> : null}
    </View>
  );
}
