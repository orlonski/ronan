import React, { Component } from "react";
import { Pressable, Text, View } from "react-native";
import { reportarErro } from "@/lib/error-reporter";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * ErrorBoundary global. Captura erros de render do React, manda
 * pro backend, e mostra tela de fallback com botão pra tentar de novo.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void reportarErro(error, {
      extra: { componentStack: info.componentStack },
    });
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <View
          className="flex-1 items-center justify-center bg-background p-6"
          style={{ paddingTop: 80 }}
        >
          <Text className="mb-2 text-2xl font-bold text-foreground">
            Algo deu errado
          </Text>
          <Text className="mb-6 text-center text-base text-muted-foreground">
            O erro foi reportado pra equipe. Toque pra tentar de novo.
          </Text>
          <Pressable
            onPress={() => this.setState({ error: null })}
            className="rounded-xl bg-primary px-6 py-3 active:opacity-85"
          >
            <Text className="text-base font-bold text-primary-foreground">
              Tentar novamente
            </Text>
          </Pressable>
          {__DEV__ && (
            <Text className="mt-6 text-xs text-muted-foreground">
              {this.state.error.message}
            </Text>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}
