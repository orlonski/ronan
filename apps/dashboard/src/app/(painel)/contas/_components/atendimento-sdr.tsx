"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, BotOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Provider = "anthropic" | "gemini" | "minimax";

/** Situação de uma IA: tem chave? veio de onde? */
type SituacaoChave = {
  /** `sk-ant…K9fA`, ou null quando não há chave nenhuma. */
  apelido: string | null;
  /** "tela" = digitada aqui · "servidor" = variável de ambiente · null = não tem. */
  origem: "tela" | "servidor" | null;
  variavel: string;
};

type Config = {
  sdrAtivo: boolean;
  sdrProvider: Provider;
  sdrModeloAnthropic: string;
  sdrModeloGemini: string;
  sdrModeloMinimax: string;
  sdrLinkCadastro: string;
  /** A IA escolhida tem chave? Sem ela o SDR fica mudo em silêncio. */
  sdrProviderTemChave: boolean;
  /** Prefixo e fim da chave em uso (`sk-ant…K9fA`). Nunca a chave. */
  sdrChaveApelido: string | null;
  sdrChaveVariavel: string;
  /** A situação de CADA IA, pra dar pra escolher sabendo o que está pronto. */
  sdrChaves: Record<Provider, SituacaoChave>;
};

const NOME_IA: Record<Provider, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  minimax: "MiniMax",
};

/**
 * O que dá pra ESCREVER, que não é o mesmo que dá pra ler: as chaves entram
 * por aqui e nunca voltam no `Config`.
 */
type ConfigEscrita = Partial<Config> & {
  sdrChaveAnthropic?: string;
  sdrChaveGemini?: string;
  sdrChaveMinimax?: string;
};

/** Em que campo a chave daquela IA é gravada. String vazia apaga. */
const CAMPO_CHAVE: Record<Provider, keyof ConfigEscrita> = {
  anthropic: "sdrChaveAnthropic",
  gemini: "sdrChaveGemini",
  minimax: "sdrChaveMinimax",
};

const PATH = "/admin/contas/configuracao";

/**
 * O atendimento comercial automático no WhatsApp.
 *
 * Fica na tela de Empresas, e não na matriz de permissões, porque é recurso da
 * casa: quem paga a conta de IA de cada conversa é a Movatruck, não o cliente.
 * Pela mesma razão o provider e o modelo se escolhem aqui — o SDR não herda a
 * escolha de nenhuma empresa.
 *
 * Ele só fala com quem já está na base de leads. Número solto continua indo
 * direto pra fila humana, ligado ou desligado.
 */
export function AtendimentoSdr() {
  const token = useAuthToken();
  const [modelo, setModelo] = useState("");
  const [link, setLink] = useState("");
  const [salvando, setSalvando] = useState(false);
  // O campo de chave nasce SEMPRE vazio: a chave gravada não volta do servidor
  // (só o apelido), então não há o que pré-preencher. Vazio aqui significa
  // "não mexi", nunca "apague".
  const [chave, setChave] = useState("");

  const { data, refetch } = useQuery({
    queryKey: [PATH, "sdr"],
    enabled: !!token,
    queryFn: () => fetchApi<Config>(PATH, { token }),
  });

  const modeloSalvo =
    data &&
    (data.sdrProvider === "gemini"
      ? data.sdrModeloGemini
      : data.sdrProvider === "minimax"
        ? data.sdrModeloMinimax
        : data.sdrModeloAnthropic);

  useEffect(() => {
    if (!data) return;
    setModelo(modeloSalvo ?? "");
    setLink(data.sdrLinkCadastro);
  }, [data, modeloSalvo]);

  async function salvar(mudanca: ConfigEscrita, aviso: string) {
    setSalvando(true);
    try {
      await fetchApi<Config>(PATH, {
        method: "PATCH",
        token,
        body: JSON.stringify(mudanca),
      });
      toast.success(aviso);
      void refetch();
    } catch (e) {
      toast.error("Não foi possível salvar", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSalvando(false);
    }
  }

  if (!data) return null;
  const ligado = data.sdrAtivo;
  const semChave = !data.sdrProviderTemChave;

  return (
    <Card className="flex flex-wrap items-end justify-between gap-4 p-4">
      <div className="flex items-start gap-3">
        {ligado ? (
          <Bot className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        ) : (
          <BotOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div>
          <p className="font-medium">
            Atendimento automático de vendas: {ligado ? "ligado" : "desligado"}
          </p>
          <p className="text-sm text-muted-foreground">
            {ligado
              ? "Quem está na lista de captação e manda mensagem é atendido na hora: preço, dúvida e link do teste."
              : "Toda mensagem de quem não é motorista vai direto pra fila humana."}
          </p>
          {/* O aviso que faltava: sem chave ele não responde e a tela seguia
              dizendo "ligado", o que manda a pessoa caçar bug no WhatsApp. */}
          {semChave ? (
            <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-500">
              A {NOME_IA[data.sdrProvider]} não tem chave configurada — ligado assim, ele não
              responde ninguém. Cole a chave ao lado ou troque a IA.
            </p>
          ) : (
            /* Qual IA responde, com qual modelo e por qual chave. Sem isto a
               tela dizia só "tem chave: sim", e não dava pra saber de qual
               conta saía a fatura sem abrir o servidor. */
            <p className="mt-1 text-sm text-muted-foreground">
              Responde pela{" "}
              <span className="font-medium text-foreground">{NOME_IA[data.sdrProvider]}</span> ·
              modelo <span className="font-medium text-foreground">{modeloSalvo}</span> · chave{" "}
              <span className="font-mono text-foreground">{data.sdrChaveApelido}</span>{" "}
              <span className="text-xs">
                (
                {data.sdrChaves?.[data.sdrProvider]?.origem === "tela"
                  ? "guardada na tela, cifrada"
                  : `${data.sdrChaveVariavel}, no servidor`}
                )
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <Label className="text-xs">IA</Label>
          <Select
            value={data.sdrProvider}
            onChange={(e) => {
              const v = e.target.value as Config["sdrProvider"];
              setChave("");
              void salvar({ sdrProvider: v }, `Agora usando ${NOME_IA[v]}.`);
            }}
          >
            {(["anthropic", "gemini", "minimax"] as const).map((p) => (
              <option key={p} value={p}>
                {NOME_IA[p]}
                {data.sdrChaves?.[p]?.origem ? "" : " (sem chave)"}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-52">
          <Label htmlFor="modeloSdr" className="text-xs">
            Modelo
          </Label>
          <Input
            id="modeloSdr"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            onBlur={() => {
              const v = modelo.trim();
              // Campo em branco significa "desisti de editar", não "apague o
              // modelo" — um modelo vazio deixaria o SDR mudo em produção.
              if (!v || v === modeloSalvo) {
                setModelo(modeloSalvo ?? "");
                return;
              }
              void salvar(
                data.sdrProvider === "gemini"
                  ? { sdrModeloGemini: v }
                  : data.sdrProvider === "minimax"
                    ? { sdrModeloMinimax: v }
                    : { sdrModeloAnthropic: v },
                `Modelo do atendimento: ${v}.`,
              );
            }}
          />
        </div>

        {/* A chave da IA escolhida.
            Entra por aqui e não volta: o servidor devolve só o apelido, então
            o campo nasce vazio e vazio significa "não mexi". Pra remover, existe
            o botão — um campo que apaga ao ficar em branco apagaria a chave de
            produção com um backspace distraído. */}
        <div className="w-64">
          <Label htmlFor="chaveSdr" className="text-xs">
            Chave da {NOME_IA[data.sdrProvider]}
          </Label>
          <Input
            id="chaveSdr"
            type="password"
            autoComplete="off"
            placeholder={
              data.sdrChaves?.[data.sdrProvider]?.apelido
                ? `${data.sdrChaves[data.sdrProvider].apelido} — cole outra pra trocar`
                : "cole a chave aqui"
            }
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            onBlur={() => {
              const v = chave.trim();
              if (!v) return;
              void salvar(
                { [CAMPO_CHAVE[data.sdrProvider]]: v },
                `Chave da ${NOME_IA[data.sdrProvider]} guardada.`,
              ).then(() => setChave(""));
            }}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {data.sdrChaves?.[data.sdrProvider]?.origem === "tela" ? (
              <>
                Guardada aqui, cifrada.{" "}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() =>
                    void salvar(
                      { [CAMPO_CHAVE[data.sdrProvider]]: "" },
                      `Chave removida — voltou a valer a do servidor.`,
                    )
                  }
                >
                  Remover
                </button>
              </>
            ) : data.sdrChaves?.[data.sdrProvider]?.origem === "servidor" ? (
              `Vindo de ${data.sdrChaves[data.sdrProvider].variavel}, no servidor.`
            ) : (
              "Nenhuma chave — esta IA não responde."
            )}
          </p>
        </div>

        <div className="w-72">
          <Label htmlFor="linkSdr" className="text-xs">
            Link do teste que ele manda
          </Label>
          <Input
            id="linkSdr"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onBlur={() => {
              const v = link.trim();
              if (!v || v === data.sdrLinkCadastro) {
                setLink(data.sdrLinkCadastro);
                return;
              }
              void salvar({ sdrLinkCadastro: v }, "Link do teste atualizado.");
            }}
          />
        </div>

        {/* Ligar é ação de rotina (azul do painel); desligar é recuo (contorno).
            Mesmo par do card da porta de cadastro, logo acima. */}
        <Button
          variant={ligado ? "outline" : "default"}
          disabled={salvando}
          onClick={() =>
            void salvar(
              { sdrAtivo: !ligado },
              ligado
                ? "Atendimento automático desligado."
                : "Atendimento automático LIGADO. Ele já responde os leads no WhatsApp.",
            )
          }
        >
          {ligado ? "Desligar atendimento" : "Ligar atendimento"}
        </Button>
      </div>
    </Card>
  );
}
