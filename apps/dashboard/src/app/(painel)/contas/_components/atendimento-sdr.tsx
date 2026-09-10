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

type Config = {
  sdrAtivo: boolean;
  sdrProvider: "anthropic" | "gemini";
  sdrModeloAnthropic: string;
  sdrModeloGemini: string;
  sdrLinkCadastro: string;
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

  const { data, refetch } = useQuery({
    queryKey: [PATH, "sdr"],
    enabled: !!token,
    queryFn: () => fetchApi<Config>(PATH, { token }),
  });

  const modeloSalvo =
    data && (data.sdrProvider === "gemini" ? data.sdrModeloGemini : data.sdrModeloAnthropic);

  useEffect(() => {
    if (!data) return;
    setModelo(modeloSalvo ?? "");
    setLink(data.sdrLinkCadastro);
  }, [data, modeloSalvo]);

  async function salvar(mudanca: Partial<Config>, aviso: string) {
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
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <Label className="text-xs">IA</Label>
          <Select
            value={data.sdrProvider}
            onChange={(e) => {
              const v = e.target.value as Config["sdrProvider"];
              void salvar(
                { sdrProvider: v },
                v === "gemini" ? "Agora usando Gemini." : "Agora usando Claude.",
              );
            }}
          >
            <option value="anthropic">Claude</option>
            <option value="gemini">Gemini</option>
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
                  : { sdrModeloAnthropic: v },
                `Modelo do atendimento: ${v}.`,
              );
            }}
          />
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
