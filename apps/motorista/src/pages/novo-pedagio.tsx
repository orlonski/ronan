import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { CriarPedagioInput } from "@ronan/shared-types";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { humanizeZodError } from "@/lib/validation";
import { fmtDataBR, hojeISO } from "@/lib/datetime";
import { useCatalogos, useCriarPedagio, useMe } from "@/lib/queries";
import { gerarClientId } from "@/lib/utils";
import { atualizarPedagioPendente } from "@/lib/sync";
import { listPendingPedagios } from "@/db/dexie";

export default function NovoPedagioPage() {
  const navigate = useNavigate();
  // A mesma tela corrige um pedágio preso nos pendentes (rota /novo-pedagio/:clientId).
  const params = useParams<{ clientId?: string }>();
  const editando = !!params.clientId;
  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarPedagio();

  const [veiculoId, setVeiculoId] = useState("");
  const [data, setData] = useState(hojeISO());
  const [pracaPedagio, setPracaPedagio] = useState("");
  const [valor, setValor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // No modo correção quem manda é o que já estava lançado, não o padrão.
    if (!editando && me.data?.veiculoDefaultId && !veiculoId) {
      setVeiculoId(me.data.veiculoDefaultId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data]);

  // Carrega o pedágio pendente pra editar e preenche os campos.
  useEffect(() => {
    if (!params.clientId) return;
    let vivo = true;
    void (async () => {
      const item = (await listPendingPedagios()).find(
        (x) => x.clientId === params.clientId,
      );
      if (!vivo || !item) return;
      const p = item.payload as Record<string, unknown>;
      if (p.veiculoId) setVeiculoId(String(p.veiculoId));
      if (p.data) setData(String(p.data).slice(0, 10));
      if (p.pracaPedagio) setPracaPedagio(String(p.pracaPedagio));
      if (p.valor != null) setValor(String(p.valor).replace(".", ","));
    })();
    return () => {
      vivo = false;
    };
  }, [params.clientId]);

  const veiculoOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.veiculos ?? []).map((v) => ({
        value: v.id,
        label: v.placa,
        sublabel: v.modelo ?? undefined,
      })),
    [cat.data?.veiculos],
  );

  async function salvar() {
    setErro(null);
    if (!veiculoId) return setErro("Escolha a placa.");
    if (!pracaPedagio.trim()) return setErro("Informe a praça do pedágio.");
    if (!valor.trim()) return setErro("Informe o valor.");

    const valorNum = parseFloat(valor.replace(",", "."));
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      return setErro("Valor inválido.");
    }

    let dataFinal = data;
    if (dataFinal !== hojeISO()) {
      const escolha = await showAlert({
        title: "Data diferente de hoje",
        message: `O pedágio está marcado como ${fmtDataBR(dataFinal)}. Hoje é ${fmtDataBR(hojeISO())}. Tem certeza?`,
        variant: "warning",
        buttons: [
          { label: "Cancelar", value: "cancel", style: "cancel" },
          { label: "Marcar hoje", value: "today" },
          { label: "Confirmar", value: "ok" },
        ],
      });
      if (escolha === "cancel" || escolha === null) return;
      if (escolha === "today") {
        dataFinal = hojeISO();
        setData(dataFinal);
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        // Editando: mantém o MESMO clientId (idempotência no servidor).
        clientId: params.clientId ?? gerarClientId(),
        veiculoId,
        data: dataFinal,
        pracaPedagio: pracaPedagio.trim(),
        valor: valorNum,
      };

      const parsed = CriarPedagioInput.safeParse(payload);
      if (!parsed.success) {
        setErro(humanizeZodError(parsed.error));
        setSubmitting(false);
        return;
      }

      if (editando) {
        const res = await atualizarPedagioPendente({
          clientId: params.clientId!,
          payload,
        });
        if (res.removed) {
          void showAlert({
            title: "Já sincronizado",
            message: "Esse pedágio já tinha sido enviado. Nada a corrigir.",
            variant: "default",
          });
        }
      } else {
        await criar(payload);
      }
      navigate(-1);
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background pb-20">
      <ScreenHeader title={editando ? "Corrigir pedágio" : "Novo pedágio"} />

      {(cat.isLoading || me.isLoading) && !cat.data && !me.data && (
        <div className="py-8 text-center text-sm text-muted-foreground">Carregando dados...</div>
      )}

      {cat.data && (
        <div className="space-y-4 p-4 pb-32">
          <div className="space-y-2">
            <Label>Placa</Label>
            <Select
              value={veiculoId}
              onChange={setVeiculoId}
              options={veiculoOptions}
              placeholder="Escolha a placa"
              searchable
              title="Placa"
            />
          </div>

          <div className="space-y-2">
            <Label>Data</Label>
            <DateField value={data} onChange={setData} disabled={submitting} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="praca">Praça do pedágio</Label>
            <Input
              id="praca"
              value={pracaPedagio}
              onChange={(e) => setPracaPedagio(e.target.value)}
              placeholder='ex: "Praça Reg. Norte BR-376"'
              autoCapitalize="words"
              disabled={submitting}
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="valor">Valor (R$)</Label>
            <Input
              id="valor"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              disabled={submitting}
              maxLength={10}
            />
            <p className="text-xs text-muted-foreground">Em R$</p>
          </div>

          {erro && (
            <p className="rounded-xl border-2 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive whitespace-pre-line">
              {erro}
            </p>
          )}
        </div>
      )}

      {cat.data && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background p-4 pb-safe">
          <Button onClick={salvar} size="xl" className="w-full" loading={submitting}>
            <Check size={20} />
            {submitting ? "Salvando..." : editando ? "Salvar correção" : "Salvar pedágio"}
          </Button>
        </div>
      )}
    </div>
  );
}
