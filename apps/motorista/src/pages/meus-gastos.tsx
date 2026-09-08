import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CloudOff, Plus, Trash2 } from "lucide-react";
import {
  ROTULO_LANCAMENTO_PESSOAL,
  TIPOS_LANCAMENTO_PESSOAL,
  ehGanho,
  type LancamentoPessoal,
  type ResumoMesPessoal,
  type TipoLancamentoPessoal,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import {
  cacheDoMes,
  carregarMes,
  carregarResumo,
  drenar,
  hojeISO,
  lancar,
  mesAtual,
} from "@/lib/pessoal";

type Item = LancamentoPessoal & { pendente?: boolean };

const dinheiro = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * O caderninho do motorista: o que ele gastou e recebeu, do bolso dele.
 *
 * Vale com ou sem empresa — é dele. Nenhuma transportadora vê isto, e é por
 * isso que a tela fala "seu" e não "da empresa". Ver
 * docs/identidade-motorista.md.
 */
export default function MeusGastosPage() {
  const navigate = useNavigate();
  const [mes] = useState(mesAtual());
  // Cache primeiro: a lista aparece na hora, mesmo sem sinal, e o servidor
  // corrige por trás. Igual ao resto do app.
  const [itens, setItens] = useState<Item[]>(() => cacheDoMes(mes));
  const [resumo, setResumo] = useState<ResumoMesPessoal | null>(null);
  const [form, setForm] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      setItens(await carregarMes(mes));
      setResumo(await carregarResumo(mes));
    } catch {
      /* sem sinal: fica o que já está na tela */
    }
  }, [mes]);

  useEffect(() => {
    void drenar().then(recarregar);
  }, [recarregar]);

  async function apagar(item: Item) {
    if (item.pendente) return;
    if (!confirm("Apagar este lançamento?")) return;
    await api.apagarLancamentoPessoal(item.id).catch(() => {});
    await recarregar();
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background">
      <div className="bg-brand px-6 pb-6 pt-safe">
        <div className="flex items-center gap-3 pt-12">
          <button type="button" onClick={() => navigate(-1)} aria-label="Voltar">
            <ArrowLeft className="h-6 w-6 text-white" />
          </button>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white">Meus gastos</h1>
            <p className="text-sm font-medium text-white/80">
              Só seu — nenhuma empresa vê isto
            </p>
          </div>
        </div>

        {resumo && (
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Resumo rotulo="Recebi" valor={resumo.ganhos} />
            <Resumo rotulo="Gastei" valor={resumo.gastos} />
            <Resumo rotulo="Sobrou" valor={resumo.saldo} destaque />
          </div>
        )}
        {resumo?.precoMedioLitro != null && (
          <p className="mt-3 text-sm font-medium text-white/80">
            Combustível: {dinheiro(resumo.precoMedioLitro)}/litro em{" "}
            {resumo.litros.toLocaleString("pt-BR")} litros
          </p>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 px-6 py-6">
        {form ? (
          <Formulario
            onCancelar={() => setForm(false)}
            onPronto={async () => {
              setForm(false);
              setItens(cacheDoMes(mes));
              await recarregar();
            }}
          />
        ) : (
          <Button size="lg" className="w-full" onClick={() => setForm(true)}>
            <Plus className="h-5 w-5" /> Lançar
          </Button>
        )}

        {itens.length === 0 && !form && (
          <div className="rounded-2xl border-2 border-dashed border-border p-6 text-center">
            <p className="text-base font-medium text-foreground">Nada lançado neste mês</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Anote o diesel, o pedágio, a refeição — e o que você recebeu. Serve pra você
              saber quanto sobrou no fim do mês.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {itens.map((i) => (
            <div
              key={i.clientId}
              className="flex items-center gap-3 rounded-2xl border-2 border-border bg-card p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-foreground">
                    {ROTULO_LANCAMENTO_PESSOAL[i.tipo]}
                  </p>
                  {i.pendente && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      <CloudOff className="h-3 w-3" /> Vai subir depois
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {i.data.split("-").reverse().join("/")}
                  {i.descricao ? ` · ${i.descricao}` : ""}
                  {i.litros ? ` · ${i.litros} L` : ""}
                </p>
              </div>
              <p
                className={`shrink-0 text-lg font-bold tabular-nums ${
                  ehGanho(i.tipo) ? "text-green-700" : "text-foreground"
                }`}
              >
                {ehGanho(i.tipo) ? "+" : "−"} {dinheiro(i.valor)}
              </p>
              {!i.pendente && (
                <button type="button" onClick={() => void apagar(i)} aria-label="Apagar">
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${destaque ? "bg-white/20" : "bg-white/10"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-white/70">{rotulo}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-white">{dinheiro(valor)}</p>
    </div>
  );
}

function Formulario({ onCancelar, onPronto }: { onCancelar: () => void; onPronto: () => void }) {
  const [tipo, setTipo] = useState<TipoLancamentoPessoal>("ABASTECIMENTO");
  const [valor, setValor] = useState("");
  const [litros, setLitros] = useState("");
  const [data, setData] = useState(hojeISO());
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const valorNum = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!valorNum || valorNum <= 0) return setErro("Informe o valor.");
    setSalvando(true);
    try {
      await lancar({
        clientId: crypto.randomUUID(),
        tipo,
        data,
        valor: valorNum,
        litros:
          tipo === "ABASTECIMENTO" && litros
            ? Number(litros.replace(",", "."))
            : undefined,
        descricao: descricao.trim() || undefined,
      });
      onPronto();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-4 rounded-2xl border-2 border-border bg-card p-4">
      <div className="grid grid-cols-2 gap-2">
        {TIPOS_LANCAMENTO_PESSOAL.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className={`rounded-xl border-2 p-3 text-sm font-bold ${
              tipo === t
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            {ROTULO_LANCAMENTO_PESSOAL[t]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="valor">Valor (R$)</Label>
        <Input
          id="valor"
          value={valor}
          onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))}
          inputMode="decimal"
          placeholder="0,00"
          autoFocus
        />
      </div>

      {tipo === "ABASTECIMENTO" && (
        <div className="space-y-2">
          <Label htmlFor="litros">Litros (opcional)</Label>
          <Input
            id="litros"
            value={litros}
            onChange={(e) => setLitros(e.target.value.replace(/[^\d.,]/g, ""))}
            inputMode="decimal"
            placeholder="0"
          />
          <p className="text-xs text-muted-foreground">
            Com os litros dá pra ver quanto você está pagando por litro no mês.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="data">Dia</Label>
        <Input id="data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="descricao">Observação (opcional)</Label>
        <Input
          id="descricao"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder={tipo === "ABASTECIMENTO" ? "Posto, cidade…" : "O que foi"}
        />
      </div>

      {erro && (
        <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
          <p className="text-base font-medium text-destructive">{erro}</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700" disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
