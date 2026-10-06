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

    const aoMudarSelecao = useCallback<NonNullable<TextInputProps["onSelectionChange"]>>(
      (e) => {
        onSelectionChange?.(e);
        const { start, end } = e.nativeEvent.selection;
        const n = texto.length;
        if (start !== n || end !== n) interno.current?.setSelection?.(n, n);
      },
      [texto, onSelectionChange],
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
        onChangeText={(t) => onChangeCentavos(proximoCentavos(texto, t, centavos))}
      />
    );
  },
);
InputDinheiro.displayName = "InputDinheiro";
