"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DoorClosed, DoorOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Config = {
  autoCadastroAberto: boolean;
  diasTesteGratis: number;
  /** Teto de códigos por hora — cada um é uma mensagem de WhatsApp paga. */
  maxCodigosPorHora: number;
};

const PATH = "/admin/contas/configuracao";

/**
 * A porta pública: qualquer transportadora pode abrir a própria conta pelo site
 * e testar por alguns dias, sem falar com ninguém.
 *
 * Fica no topo da tela de Empresas porque é a decisão que muda de onde vêm as
 * empresas da lista abaixo. E os dois valores são dado, não código: fechar o
 * cadastro num dia ruim ou esticar o teste não pode depender de deploy.
 */
export function PortaCadastro() {
  const token = useAuthToken();
  const [dias, setDias] = useState("14");
  const [maxHora, setMaxHora] = useState("30");
  const [salvando, setSalvando] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<Config>(PATH, { token }),
  });

  useEffect(() => {
    if (!data) return;
    setDias(String(data.diasTesteGratis));
    setMaxHora(String(data.maxCodigosPorHora));
  }, [data]);

  async function salvar(mudanca: Partial<Config>) {
    setSalvando(true);
    try {
      const novo = await fetchApi<Config>(PATH, {
        method: "PATCH",
        token,
        body: JSON.stringify(mudanca),
      });
      toast.success(
        mudanca.maxCodigosPorHora !== undefined
          ? `Teto de ${novo.maxCodigosPorHora} códigos por hora.`
          : mudanca.autoCadastroAberto === undefined
          ? `Teste grátis agora é de ${novo.diasTesteGratis} dias.`
          : novo.autoCadastroAberto
            ? "Cadastro pelo site ABERTO. Qualquer transportadora pode criar conta agora."
            : "Cadastro pelo site fechado.",
      );
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
  const aberto = data.autoCadastroAberto;

  return (
    <Card className="flex flex-wrap items-end justify-between gap-4 p-4">
      <div className="flex items-start gap-3">
        {aberto ? (
          <DoorOpen className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        ) : (
          <DoorClosed className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div>
          <p className="font-medium">
            Cadastro pelo site: {aberto ? "aberto" : "fechado"}
          </p>
          <p className="text-sm text-muted-foreground">
            {aberto
              ? "Qualquer transportadora cria a conta dela sozinha e começa o teste."
              : "Só você cria empresa. Quem tentar pelo site é mandado pro WhatsApp."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28">
          <Label htmlFor="dias" className="text-xs">
            Dias de teste
          </Label>
          <Input
            id="dias"
            inputMode="numeric"
            value={dias}
            onChange={(e) => setDias(e.target.value.replace(/\D/g, ""))}
            onBlur={() => {
              const n = Number(dias);
              if (!n || n === data.diasTesteGratis) {
                setDias(String(data.diasTesteGratis));
                return;
              }
              void salvar({ diasTesteGratis: n });
            }}
          />
        </div>
        <div className="w-32">
          <Label htmlFor="maxHora" className="text-xs">
            Códigos por hora
          </Label>
          <Input
            id="maxHora"
            inputMode="numeric"
            title="Teto de gasto: cada código é uma mensagem de WhatsApp paga."
            value={maxHora}
            onChange={(e) => setMaxHora(e.target.value.replace(/\D/g, ""))}
            onBlur={() => {
              const n = Number(maxHora);
              if (!n || n === data.maxCodigosPorHora) {
                setMaxHora(String(data.maxCodigosPorHora));
                return;
              }
              void salvar({ maxCodigosPorHora: n });
            }}
          />
        </div>
        {/* Verde abre, contorno fecha — o padrão do semáforo: abrir a porta é a
            ação afirmativa, fechar é o recuo. */}
        <Button
          variant={aberto ? "outline" : "default"}
          disabled={salvando}
          onClick={() => void salvar({ autoCadastroAberto: !aberto })}
        >
          {aberto ? "Fechar cadastro" : "Abrir cadastro"}
        </Button>
      </div>
    </Card>
  );
}
