import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import type { TextInput, TextInputProps } from "react-native";
import { Input } from "./input";
import { fmtReais, proximoCentavos } from "@/lib/gastos";

type Props = Omit<TextInputProps, "value" | "onChangeText" | "keyboardType" | "selection"> & {
  className?: string;
  error?: boolean;
  /** Valor em centavos (0 = vazio, mostra o placeholder). */
  centavos: number;
  onChangeCentavos: (centavos: number) => void;
};

/**
 * Campo de dinheiro com máscara "de maquininha": o número entra pela direita e
 * o backspace tira o último dígito.
 *
 * O cursor fica SEMPRE no fim. Não é `selection` controlado: no Android, a
 * seleção chegando antes do texto novo estoura `setSpan … beyond length`, e no
 * iOS ela pisca. Quando ele toca no meio do número, o `onSelectionChange` manda
 * o cursor de volta pro fim (`setSelection`, imperativo). E mesmo no instante
 * em que o cursor está no meio, `proximoCentavos` não lê a posição: apagar tira
 * o último dígito, digitar põe no fim.
 */
export const InputDinheiro = forwardRef<TextInput, Props>(
  ({ centavos, onChangeCentavos, onSelectionChange, ...props }, ref) => {
    const interno = useRef<TextInput>(null);
    useImperativeHandle(ref, () => interno.current as TextInput);
    const texto = centavos > 0 ? fmtReais(centavos / 100) : "";
    // O tamanho do texto que está NA TELA agora. O evento de seleção pode chegar
    // antes da renderização com o texto novo (ao apagar, o nativo já encolheu e
    // a closure ainda tem o texto antigo, maior). Mandar o cursor pra além do fim
    // estoura no Android — por isso o ajuste espera um frame e lê daqui.
    const tamanhoAtual = useRef(texto.length);
    tamanhoAtual.current = texto.length;
    // Enquanto ele digita/apaga, o cursor não importa (`proximoCentavos` ignora a
    // posição) e o texto nativo pode estar um passo atrás: não mexe na seleção.
    // A correção só serve pro toque no meio do número.
    const digitando = useRef(false);

    const aoMudarSelecao = useCallback<NonNullable<TextInputProps["onSelectionChange"]>>(
      (e) => {
        onSelectionChange?.(e);
        const { start, end } = e.nativeEvent.selection;
        if (digitando.current) return;
        if (start === tamanhoAtual.current && end === tamanhoAtual.current) return;
        requestAnimationFrame(() => {
          const n = tamanhoAtual.current;
          interno.current?.setSelection?.(n, n);
        });
      },
      [onSelectionChange],
    );

    return (
      <Input
        ref={interno}
        {...props}
        value={texto}
        keyboardType="number-pad"
        // Colar/selecionar trecho não faz sentido num número que cresce pela direita.
        contextMenuHidden
        onSelectionChange={aoMudarSelecao}
        onChangeText={(t) => {
          digitando.current = true;
          onChangeCentavos(proximoCentavos(texto, t, centavos));
          // Dois frames: o texto novo já foi pra tela antes de voltar a corrigir.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              digitando.current = false;
            }),
          );
        }}
      />
    );
  },
);
InputDinheiro.displayName = "InputDinheiro";
