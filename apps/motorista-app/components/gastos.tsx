/**
 * Peças de tela do GASTO DE VIAGEM (módulo `despesas`) usadas em mais de um
 * lugar: ícone do tipo, status, linha da lista, o card da home, o bloco
 * "Gastos desta viagem" e a faixa verde de "gasto guardado".
 *
 * Tom: ele é parceiro. "Pra receber de volta", "o escritório confere" — nunca
 * "a empresa exige", "recusado" ou vermelho em status de gasto.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  BedDouble,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Coffee,
  Droplets,
  Ellipsis,
  Fuel,
  Hammer,
  Link,
  ListChecks,
  Package,
  Plus,
  Receipt,
  ReceiptText,
  Route,
  Ship,
  SquareParking,
  Utensils,
  Wrench,
  type LucideIcon,
} from "lucide-react-native";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { VerDePerto } from "@/components/miniatura-documento";
import { API_URL } from "@/lib/api-url";
import { caminhoFotoDespesa } from "@/lib/despesas";
import { motoristaAtivoId, tokensDe } from "@/lib/sessoes";
import { onSyncChange } from "@/lib/sync";
import { listPendingAbastecimentos, listPendingDespesas, listPendingPedagios } from "@/db/database";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen-header";
import { Lock } from "lucide-react-native";
import {
  diaFalado,
  diaSP,
  fmtReais,
  gastosSemViagem,
  horaSP,
  pegarAvisoGastoSalvo,
  resumirGastos,
  useAbaGastos,
  useDespesasAtualizadasEm,
  useGastos,
  useModuloDespesas,
  type AvisoGastoSalvo,
  type CorStatus,
  type GastoVisto,
  type StatusExibido,
} from "@/lib/gastos";

// ---------------------------------------------------------------------------
// Botão de ação com ícone
// ---------------------------------------------------------------------------

type VarianteAcao = "default" | "outline" | "success" | "warning" | "destructive";

const COR_ACAO: Record<VarianteAcao, { icone: string; texto: string }> = {
  default: { icone: "#ffffff", texto: "text-primary-foreground" },
  outline: { icone: "#0f172a", texto: "text-foreground" },
  success: { icone: "#ffffff", texto: "text-success-foreground" },
  warning: { icone: "#0f172a", texto: "text-warning-foreground" },
  destructive: { icone: "#ffffff", texto: "text-destructive-foreground" },
};

/**
 * Toda AÇÃO do módulo de gasto é botão de verdade, com ícone e verbo. O
 * motorista não reconhece texto colorido como coisa que se toca — o dono
 * testou e o "link" passou batido. Nada de texto-link nestas telas.
 */
export function BotaoAcao({
  Icone,
  children,
  onPress,
  variant = "outline",
  size = "default",
  className,
  disabled,
  loading,
  accessibilityLabel,
}: {
  Icone: LucideIcon;
  children: string;
  onPress: () => void;
  variant?: VarianteAcao;
  size?: "default" | "sm";
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  const cor = COR_ACAO[variant];
  const sm = size === "sm";
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onPress={onPress}
      disabled={disabled}
      loading={loading}
      accessibilityLabel={accessibilityLabel ?? children}
    >
      {loading ? null : <Icone size={sm ? 16 : 20} color={cor.icone} strokeWidth={2.2} />}
      <Text
        className={`${sm ? "text-sm" : "text-base"} font-semibold ${cor.texto}`}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {children}
      </Text>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Ícone do tipo
// ---------------------------------------------------------------------------

/**
 * O painel guarda um nome curto de ícone ("pneu", "comida"...). Nome que o app
 * não conhece cai no recibo — nunca quebra.
 */
const ICONES: Record<string, LucideIcon> = {
  pneu: CircleDot,
  borracharia: CircleDot,
  comida: Utensils,
  alimentacao: Utensils,
  refeicao: Utensils,
  cafe: Coffee,
  pernoite: BedDouble,
  hospedagem: BedDouble,
  cama: BedDouble,
  descarga: Package,
  chapa: Package,
  caixa: Package,
  lavagem: Droplets,
  agua: Droplets,
  estacionamento: SquareParking,
  balsa: Ship,
  barco: Ship,
  peca: Wrench,
  conserto: Wrench,
  ferramenta: Hammer,
  pedagio: Route,
  combustivel: Fuel,
  diesel: Fuel,
  outro: Ellipsis,
  outros: Ellipsis,
};

export function iconeDoTipo(icone: string | null | undefined, slug?: string | null): LucideIcon {
  const k = (icone ?? "").toLowerCase();
  return ICONES[k] ?? ICONES[(slug ?? "").toLowerCase()] ?? Receipt;
}

export function IconeTipo({
  icone,
  slug,
  tamanho = 40,
}: {
  icone: string | null | undefined;
  slug?: string | null;
  tamanho?: number;
}) {
  const Icone = iconeDoTipo(icone, slug);
  return (
    <View
      className="items-center justify-center rounded-xl bg-sky-100"
      style={{ width: tamanho, height: tamanho }}
    >
      <Icone size={Math.round(tamanho * 0.55)} color="#13316b" strokeWidth={2.2} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Status (cinza, azul-claro, verde, âmbar — vermelho NUNCA)
// ---------------------------------------------------------------------------

const COR_BOLINHA: Record<CorStatus, string> = {
  cinza: "bg-slate-400",
  azul: "bg-sky-400",
  verde: "bg-success",
  ambar: "bg-amber-500",
};

const COR_TEXTO: Record<CorStatus, string> = {
  cinza: "text-muted-foreground",
  azul: "text-sky-800",
  verde: "text-green-800",
  ambar: "text-amber-800",
};

export function StatusGasto({ status, grande }: { status: StatusExibido; grande?: boolean }) {
  return (
    <View className="gap-0.5">
      <View className="flex-row items-center gap-2">
        {status.cor === "ambar" ? (
          <Text className={`${grande ? "text-base" : "text-sm"} ${COR_TEXTO.ambar}`}>▲</Text>
        ) : status.texto === "Guardado no celular" ? (
          <View className="h-2.5 w-2.5 rounded-full border-2 border-slate-400" />
        ) : (
          <View className={`h-2.5 w-2.5 rounded-full ${COR_BOLINHA[status.cor]}`} />
        )}
        <Text className={`${grande ? "text-base" : "text-sm"} font-semibold ${COR_TEXTO[status.cor]}`}>
          {status.texto}
        </Text>
      </View>
      {status.motivo ? (
        <Text className="ml-4 text-sm italic text-muted-foreground" numberOfLines={2}>
          “{status.motivo}”
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Linha de um gasto (Meus gastos, Gastos desta viagem)
// ---------------------------------------------------------------------------

export function LinhaGasto({
  g,
  onPress,
  compacta,
}: {
  g: GastoVisto;
  onPress?: () => void;
  compacta?: boolean;
}) {
  const quando = compacta ? horaSP(g.data) : diaFalado(g.dia);
  const onde = compacta
    ? null
    : g.detalhe
      ? g.detalhe
      : g.viagemRotulo
      ? g.viagemRotulo
      : g.naoFoiEmViagem
        ? "fora de viagem"
        : g.semResposta
          ? "sem viagem"
          : null;
  const semComprovante =
    !compacta &&
    ((g.servidor && g.servidor.fotos.length === 0 && g.servidor.semComprovanteMotivo) ||
      (g.pendente && g.pendente.fotos.length === 0 && g.pendente.payload.semComprovanteMotivo));
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      className="flex-row items-start gap-3 px-4 py-3 active:bg-muted"
      style={{ minHeight: compacta ? 56 : 72 }}
    >
      <IconeTipo icone={g.tipoIcone} tamanho={36} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-start justify-between gap-2">
          <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={1}>
            {g.tipoNome}
          </Text>
          <Text className="text-base font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
            {g.valorTexto ?? fmtReais(g.valorInformado)}
          </Text>
        </View>
        <Text className="text-sm text-muted-foreground" numberOfLines={1}>
          {[quando, onde, semComprovante ? "sem comprovante" : null].filter(Boolean).join(" · ")}
        </Text>
        <StatusGasto status={g.status} />
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Aba Gastos: "Pra receber de volta" (compacto, no topo)
// ---------------------------------------------------------------------------

function fmtHoraLocal(ts: number): string {
  return horaSP(new Date(ts).toISOString());
}

/**
 * O topo da aba Gastos: quanto volta pra ele e as duas portas — "Ver meus
 * gastos" SEMPRE (mesmo com R$ 0,00: quem lançou só pedágio acha ele lá) e
 * "Ligar à viagem (N)" só quando há gasto sem viagem. Compacto de propósito:
 * a lista "O que você pagou?" vem logo abaixo e o valor não pode cair
 * abaixo da dobra (12-qa-portas, achado 1).
 */
export function ResumoPraReceber({ podeLigar }: { podeLigar: boolean }) {
  const { gastos, query } = useGastos();
  const resumo = useMemo(() => resumirGastos(gastos), [gastos]);
  const atualizadoEm = useDespesasAtualizadasEm();
  const semViagem = podeLigar ? resumo.semViagem : 0;
  const desatualizado =
    atualizadoEm != null && (query.isError || Date.now() - atualizadoEm > 5 * 60_000);
  return (
    <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
      <View>
        <Text className="text-sm font-semibold text-muted-foreground">Pra receber de volta</Text>
        <Text className="text-3xl font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
          {fmtReais(resumo.total)}
        </Text>
        {desatualizado ? (
          <Text className="text-xs text-muted-foreground">Atualizado às {fmtHoraLocal(atualizadoEm!)}</Text>
        ) : null}
        {resumo.aprovado > 0 ? (
          <View className="mt-1 flex-row items-start gap-2">
            <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-success" />
            <Text className="flex-1 text-[15px] text-foreground">
              {fmtReais(resumo.aprovado)} aprovado — entra no próximo acerto
            </Text>
          </View>
        ) : null}
        {resumo.comEscritorio > 0 ? (
          <View className="mt-1 flex-row items-start gap-2">
            <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-sky-400" />
            <Text className="flex-1 text-[15px] text-foreground">
              {fmtReais(resumo.comEscritorio)} com o escritório
            </Text>
          </View>
        ) : null}
      </View>
      <BotaoAcao Icone={ListChecks} onPress={() => router.push("/meus-reembolsos")}>
        Ver meus gastos
      </BotaoAcao>
      {semViagem > 0 ? (
        <BotaoAcao
          Icone={Link}
          onPress={() => router.push("/gastos-sem-viagem")}
          accessibilityLabel={`Ligar à viagem: ${semViagem} ${semViagem === 1 ? "gasto sem viagem" : "gastos sem viagem"}`}
        >
          {`Ligar à viagem (${semViagem})`}
        </BotaoAcao>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// "Gastos desta viagem" (Finalizar viagem e Lançar viagem feita)
// ---------------------------------------------------------------------------

/**
 * Compacto de propósito: a tela da viagem já é longa. Uma linha fechado,
 * nunca obrigatório. Os gastos ficam amarrados ao `clientId` da viagem, que
 * pode nem ter subido ainda.
 *
 * "+ Adicionar gasto" abre a lista como TELA EMPILHADA (não Modal): o
 * formulário da viagem fica preservado embaixo.
 */
export function GastosDaViagem({
  viagemClientId,
  viagemRotulo,
  veiculoId,
  perguntaPonte,
}: {
  viagemClientId: string;
  viagemRotulo?: string | null;
  veiculoId?: string | null;
  /** Ao fechar a viagem: "Você tem N gastos de hoje sem viagem. São desta?" */
  perguntaPonte?: boolean;
}) {
  const { gastos } = useGastos();
  const [aberto, setAberto] = useState(false);
  const [ponteVista, setPonteVista] = useState(false);
  const daViagem = useMemo(
    () => gastos.filter((g) => g.viagemClientId === viagemClientId),
    [gastos, viagemClientId],
  );
  const total = daViagem.reduce((s, g) => s + g.valorInformado, 0);
  const hoje = diaSP(Date.now());
  const soltosHoje = useMemo(
    () => gastosSemViagem(gastos).filter((g) => g.dia === hoje),
    [gastos, hoje],
  );
  const totalSoltos = soltosHoje.reduce((s, g) => s + g.valorInformado, 0);

  function adicionar() {
    router.push({
      pathname: "/gasto-viagem",
      params: {
        viagemClientId,
        ...(viagemRotulo ? { viagemRotulo } : {}),
        ...(veiculoId ? { veiculoId } : {}),
        voltar: "2",
      },
    });
  }

  return (
    <View className="rounded-2xl border-2 border-border bg-card">
      <FaixaGastoSalvo />
      {daViagem.length === 0 ? (
        <View className="min-h-[64px] flex-row items-center justify-between gap-3 px-4 py-2">
          <Text className="text-base font-semibold text-foreground">Gastos desta viagem</Text>
          <Button variant="outline" size="sm" onPress={adicionar}>
            <Plus size={16} color="#0f172a" />
            <Text className="text-sm font-semibold text-foreground">Adicionar gasto</Text>
          </Button>
        </View>
      ) : (
        <View className="gap-2 p-4">
          <Pressable
            onPress={() => setAberto((a) => !a)}
            className="flex-row items-center justify-between active:opacity-75"
            accessibilityRole="button"
            accessibilityLabel={aberto ? "Fechar gastos desta viagem" : "Abrir gastos desta viagem"}
          >
            <Text className="text-base font-semibold text-foreground">Gastos desta viagem</Text>
            <View className="flex-row items-center gap-1">
              <Text className="text-base text-muted-foreground">{daViagem.length} ·</Text>
              {aberto ? <ChevronDown size={18} color="#475569" /> : <ChevronRight size={18} color="#475569" />}
            </View>
          </Pressable>
          <Text className="text-lg font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
            {fmtReais(total)}
          </Text>
          {aberto ? (
            <View className="-mx-4 border-t border-border">
              {daViagem.map((g) => (
                <LinhaGasto
                  key={g.chave}
                  g={g}
                  compacta
                  onPress={() => abrirGasto(g)}
                />
              ))}
            </View>
          ) : null}
          <Button variant="outline" onPress={adicionar}>
            <Plus size={18} color="#0f172a" />
            <Text className="text-base font-semibold text-foreground">Adicionar gasto</Text>
          </Button>
        </View>
      )}

      {/* Pergunta-ponte: uma vez, nunca liga sozinho. */}
      {perguntaPonte && soltosHoje.length > 0 && !ponteVista ? (
        <View className="mx-4 mb-4 gap-2 rounded-xl bg-sky-50 p-3">
          <Text className="text-base text-foreground">
            Você tem {soltosHoje.length}{" "}
            {soltosHoje.length === 1 ? "gasto de hoje sem viagem" : "gastos de hoje sem viagem"} (
            {fmtReais(totalSoltos)}). {soltosHoje.length === 1 ? "É desta?" : "São desta?"}
          </Text>
          <Button
            variant="outline"
            onPress={() => {
              setPonteVista(true);
              router.push({
                pathname: "/gastos-sem-viagem",
                params: {
                  dia: hoje,
                  viagemClientId,
                  ...(viagemRotulo ? { viagemRotulo } : {}),
                },
              });
            }}
          >
            Ver e ligar
          </Button>
        </View>
      ) : null}
    </View>
  );
}

/** Tem pra onde ir ao tocar? (sem isso a linha não finge ser botão) */
export function gastoAbre(g: GastoVisto): boolean {
  if (g.categoria === "pedagio" || g.categoria === "abastecimento") return g.origem === "celular" && !!g.clientId;
  return (g.origem === "celular" && !!g.clientId && !!g.tipoId) || !!g.despesaId;
}

/** Toque num gasto: no celular abre o formulário pra corrigir; enviado, o detalhe. */
export function abrirGasto(g: GastoVisto): void {
  // Pedágio e abastecimento: só o que ainda está no celular abre (pra corrigir
  // no formulário de sempre); o enviado é só linha de consulta.
  if (g.categoria === "pedagio" || g.categoria === "abastecimento") {
    if (g.origem === "celular" && g.clientId) {
      router.push({
        pathname: g.categoria === "pedagio" ? "/novo-pedagio" : "/novo-abastecimento",
        params: { editarClientId: g.clientId },
      });
    }
    return;
  }
  if (g.origem === "celular" && g.clientId && g.tipoId) {
    router.push({ pathname: "/gasto-novo", params: { tipoId: g.tipoId, editarClientId: g.clientId } });
    return;
  }
  if (g.despesaId) router.push({ pathname: "/gasto-detalhe", params: { id: g.despesaId } });
}

// ---------------------------------------------------------------------------
// Faixa verde depois de salvar (8 s)
// ---------------------------------------------------------------------------

const NOME_DO_AVISO: Record<NonNullable<AvisoGastoSalvo["tipo"]>, string> = {
  despesa: "Gasto",
  pedagio: "Pedágio",
  abastecimento: "Abastecimento",
};

/**
 * O item do aviso ainda está na fila do celular? Cada tipo tem a SUA fila no
 * outbox. `null` = ainda não sei (a fila não carregou) — e aí a faixa diz
 * "guardado", nunca "enviado": dizer enviado sem ter enviado é mentir.
 */
function useAindaNaFila(aviso: AvisoGastoSalvo | null): boolean | null {
  const [naFila, setNaFila] = useState<boolean | null>(null);
  useEffect(() => {
    setNaFila(null);
    if (!aviso) return;
    let vivo = true;
    const listar =
      aviso.tipo === "pedagio"
        ? listPendingPedagios
        : aviso.tipo === "abastecimento"
          ? listPendingAbastecimentos
          : listPendingDespesas;
    const conferir = async () => {
      try {
        const l = await listar();
        if (vivo) setNaFila(l.some((p) => p.clientId === aviso.clientId));
      } catch {
        /* storage indisponível: fica "não sei" */
      }
    };
    void conferir();
    const off = onSyncChange(conferir);
    return () => {
      vivo = false;
      off();
    };
  }, [aviso]);
  return naFila;
}

/**
 * "Gasto guardado…" ou "Gasto enviado…" (ou Pedágio/Abastecimento) — e só
 * diz "enviado" quando o item saiu mesmo da fila CERTA do celular.
 *
 * `semBotoes` (aba Gastos): só a frase — o "lançar outro" é a lista logo
 * abaixo e o "ver" é o "Pra receber de volta" logo acima. Dentro da viagem
 * continua com os botões.
 */
export function FaixaGastoSalvo({ semBotoes = false }: { semBotoes?: boolean }) {
  const modulo = useModuloDespesas();
  const [aviso, setAviso] = useState<AvisoGastoSalvo | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      const a = pegarAvisoGastoSalvo();
      if (a) {
        setAviso(a);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setAviso(null), 8_000);
      }
      return undefined;
    }, []),
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const naFila = useAindaNaFila(aviso);

  if (!aviso) return null;
  const nome = NOME_DO_AVISO[aviso.tipo ?? "despesa"];
  return (
    <View
      className={`${semBotoes ? "mx-4 mt-3" : "m-3"} gap-3 rounded-xl bg-green-50 px-4 py-3`}
    >
      <View className="flex-row items-center gap-3">
        <Check size={20} color="#15803d" />
        <Text className="flex-1 text-base font-semibold text-green-900">
          {naFila === false
            ? `${nome} enviado pro escritório.`
            : `${nome} guardado. Vai pro escritório quando tiver sinal.`}
        </Text>
      </View>
      {semBotoes ? null : (
        <View className="flex-row gap-2">
          {modulo.acompanhar ? (
            <BotaoAcao
              Icone={ListChecks}
              size="sm"
              className="flex-1 px-2"
              onPress={() => {
                setAviso(null);
                router.push("/meus-reembolsos");
              }}
            >
              Ver meus gastos
            </BotaoAcao>
          ) : null}
          <BotaoAcao
            Icone={Plus}
            size="sm"
            className="flex-1 px-2"
            onPress={() => {
              setAviso(null);
              router.push({ pathname: "/gasto-viagem", params: aviso.params });
            }}
          >
            Lançar outro
          </BotaoAcao>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Guarda das telas (abrem também por link ou por pilha antiga)
// ---------------------------------------------------------------------------

/**
 * PORTA DUPLA: na empresa com o módulo, o caderno pessoal continua existindo
 * (no Perfil) — e é fácil anotar ali o gasto que deveria voltar no acerto.
 * Este aviso fica no topo do caderno e do "Anotar gasto" pessoal. Sem o
 * módulo, não aparece: lá não há outro lugar pra mandar.
 */
export function AvisoCadernoSoSeu() {
  if (!useAbaGastos()) return null;
  return (
    <View className="gap-3 rounded-2xl border-2 border-warning bg-warning/10 p-4">
      <Text className="text-base font-semibold text-foreground">
        Isto é só seu: o escritório não vê. Pra receber de volta no acerto, lance em Gastos.
      </Text>
      <BotaoAcao Icone={ReceiptText} onPress={() => router.dismissTo("/gastos")}>
        Ir pra Gastos
      </BotaoAcao>
    </View>
  );
}

export function SemGastoDeViagem({ titulo }: { titulo: string }) {
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={titulo} />
      <EmptyState
        icon={Lock}
        title="Isso não está no seu app nesta empresa"
        description="Se você precisa disso, fale com o escritório da empresa."
      />
      <View className="px-6">
        <Button
          variant="outline"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        >
          Voltar
        </Button>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Foto do comprovante (detalhe do gasto)
// ---------------------------------------------------------------------------

/**
 * A foto do gasto: a do celular (ainda na fila) ou a do servidor, que vem
 * pela API com o token. ⚠️ `<Image>` com header de auth só monta com o token
 * PRONTO — montar antes faz o Fresco cachear o 401 e a imagem fica preta.
 * Tocar abre grande na própria tela (nunca em aba nova).
 */
export function FotoDaDespesa({
  despesaId,
  fotoId,
  uriLocal,
  titulo,
}: {
  despesaId?: string | null;
  fotoId?: string | null;
  uriLocal?: string | null;
  titulo: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [falhou, setFalhou] = useState(false);
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    if (uriLocal || !despesaId || !fotoId) return;
    let vivo = true;
    void (async () => {
      const dono = await motoristaAtivoId();
      const t = dono ? await tokensDe(dono) : null;
      if (vivo) setToken(t?.accessToken ?? null);
    })();
    return () => {
      vivo = false;
    };
  }, [uriLocal, despesaId, fotoId, tentativa]);

  const remota =
    despesaId && fotoId
      ? `${API_URL}${caminhoFotoDespesa(despesaId, fotoId)}${tentativa ? `?t=${tentativa}` : ""}`
      : null;
  const source = uriLocal
    ? { uri: uriLocal }
    : remota && token
      ? { uri: remota, headers: { Authorization: `Bearer ${token}` } }
      : null;

  if (!uriLocal && !remota) return null;
  if (falhou) {
    return (
      <View className="items-center justify-center gap-3 rounded-xl border-2 border-border bg-muted p-6" style={{ height: 240 }}>
        <Text className="text-center text-base text-foreground">Não deu pra abrir a foto.</Text>
        <Button
          variant="outline"
          onPress={() => {
            setFalhou(false);
            setTentativa((t) => t + 1);
          }}
        >
          Tentar de novo
        </Button>
      </View>
    );
  }
  return (
    <>
      <Pressable
        onPress={() => setAberta(true)}
        accessibilityRole="button"
        accessibilityLabel="Ver a foto de perto"
        className="overflow-hidden rounded-xl border-2 border-border bg-muted active:opacity-80"
        style={{ height: 240 }}
      >
        {source ? (
          <Image
            source={source}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
            onError={() => (tentativa === 0 && !uriLocal ? setTentativa(1) : setFalhou(true))}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        )}
      </Pressable>
      <VerDePerto titulo={titulo} aberta={aberta} fechar={() => setAberta(false)} source={source} />
    </>
  );
}
