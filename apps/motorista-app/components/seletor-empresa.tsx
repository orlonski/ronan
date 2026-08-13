import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronDown, TriangleAlert, X } from "lucide-react-native";
import { assinarSessoes, sessaoAtivaSync, sessoesSync } from "@/lib/sessoes";
import {
  avaliarTroca,
  sessoesComPendentes,
  trocarEmpresa,
  type AvisoTroca,
} from "@/lib/troca-empresa";

type Linha = { motoristaId: string; contaNome: string; pendentes: number };

/**
 * Pra qual empresa ele está rodando AGORA.
 *
 * O motorista pode carregar de dia pra uma e de noite pra outra, e tudo que a
 * tela mostra — viagens, catálogo, pendentes — é da empresa selecionada aqui.
 * Por isso o seletor mora no topo, junto do nome: é o contexto de leitura de
 * todo o resto, não um ajuste escondido no perfil.
 *
 * Com uma empresa só (o caso de quase todo mundo), vira texto simples e não há
 * nada pra escolher.
 */
export function SeletorEmpresa() {
  const qc = useQueryClient();
  const [, setVersao] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [aviso, setAviso] = useState<AvisoTroca | null>(null);
  const [trocando, setTrocando] = useState<string | null>(null);

  useEffect(() => assinarSessoes(() => setVersao((v) => v + 1)), []);

  const ativa = sessaoAtivaSync();
  const total = sessoesSync().length;

  async function abrir() {
    const [comPendentes, av] = await Promise.all([sessoesComPendentes(), avaliarTroca()]);
    setLinhas(
      comPendentes.map((s) => ({
        motoristaId: s.motoristaId,
        contaNome: s.contaNome || "Empresa",
        pendentes: s.pendentes,
      })),
    );
    setAviso(av);
    setAberto(true);
  }

  async function escolher(motoristaId: string) {
    if (motoristaId === ativa?.motoristaId) {
      setAberto(false);
      return;
    }
    setTrocando(motoristaId);
    try {
      await trocarEmpresa(qc, motoristaId);
      setAberto(false);
    } finally {
      setTrocando(null);
    }
  }

  // Nome ainda vazio acontece no aparelho que acabou de migrar: a lista local
  // não sabia a empresa e o servidor ainda não respondeu. Não mostra rótulo
  // vazio nem "undefined" — some até chegar.
  if (!ativa || (!ativa.contaNome && total <= 1)) return null;

  if (total <= 1) {
    return (
      <View className="flex-row items-center gap-1.5">
        <Building2 size={14} color="rgba(255,255,255,0.7)" />
        <Text className="text-xs font-semibold uppercase tracking-wider text-white/70">
          {ativa.contaNome}
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={abrir}
        accessibilityRole="button"
        accessibilityLabel="Trocar de empresa"
        className="flex-row items-center gap-1.5 self-start rounded-full bg-white/15 px-3 py-1.5 active:opacity-70"
      >
        <Building2 size={14} color="#fff" />
        <Text className="text-sm font-bold text-white">{ativa.contaNome || "Empresa"}</Text>
        <ChevronDown size={16} color="#fff" />
      </Pressable>

      <Modal visible={aberto} animationType="slide" onRequestClose={() => setAberto(false)}>
        <SafeAreaProvider>
          <SafeAreaView className="flex-1 bg-background">
            <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
              <Text className="text-xl font-bold text-foreground">Você vai rodar pra quem?</Text>
              <Pressable onPress={() => setAberto(false)} className="p-2 active:opacity-60">
                <X size={24} color="#64748b" />
              </Pressable>
            </View>

            {/* Confirmação inline, nunca showConfirm: dentro de um Modal de tela
                cheia o alerta abre ATRÁS e o motorista não vê. */}
            {aviso?.viagemAberta && (
              <View className="m-4 flex-row gap-2 rounded-2xl border-2 border-warning/50 bg-warning/10 p-4">
                <TriangleAlert size={20} color="#b45309" />
                <Text className="flex-1 text-base text-foreground">
                  Você tem uma viagem em andamento aqui. Finalize antes de trocar — senão ela
                  fica pela metade.
                </Text>
              </View>
            )}

            <View className="gap-3 p-4">
              {linhas.map((l) => {
                const atual = l.motoristaId === ativa.motoristaId;
                return (
                  <Pressable
                    key={l.motoristaId}
                    onPress={() => void escolher(l.motoristaId)}
                    disabled={trocando !== null}
                    className={`flex-row items-center gap-3 rounded-2xl border-2 p-4 active:opacity-75 ${
                      atual ? "border-brand bg-brand/10" : "border-border bg-card"
                    }`}
                  >
                    <Building2 size={22} color={atual ? "#1e3a8a" : "#64748b"} />
                    <View className="flex-1">
                      <Text className="text-lg font-bold text-foreground">{l.contaNome}</Text>
                      {l.pendentes > 0 && (
                        <Text className="mt-0.5 text-sm font-medium text-warning-foreground">
                          {l.pendentes === 1
                            ? "1 lançamento esperando pra subir"
                            : `${l.pendentes} lançamentos esperando pra subir`}
                        </Text>
                      )}
                    </View>
                    {atual && <Check size={22} color="#1e3a8a" />}
                    {trocando === l.motoristaId && (
                      <Text className="text-sm text-muted-foreground">trocando…</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <Text className="px-5 text-sm text-muted-foreground">
              Cada empresa tem os lançamentos, os locais e os materiais dela. O que você faz numa
              não aparece na outra.
            </Text>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}
