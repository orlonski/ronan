"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat, Plus } from "lucide-react";
import { toast } from "sonner";
import { ClienteCombobox, MotoristaCombobox, VeiculoCombobox } from "@/components/fk-comboboxes";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EstadoVazio } from "@/components/estado-vazio";
import { Combobox } from "@/components/ui/combobox";
import { fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { formatarBRL } from "@/lib/numero";
import { usePermissoes } from "@/lib/permissoes";

type Alocacao = {
  id: string;
  ativa: boolean;
  inicio: string;
  fim: string | null;
  valorDiaria: string | null;
  cliente: { id: string; nome: string };
  motorista: { id: string; nome: string; cpf: string };
  veiculo: { id: string; placa: string };
};

type LinhaGrade = {
  alocacao: { id: string; obra: string; motorista: string; placa: string };
  dias: { data: string; origem: "APP" | "PAINEL" }[];
  total: number;
};

type LinhaEspelho = {
  alocacaoId: string;
  obra: string;
  motorista: string;
  placa: string;
  diaCorte: number;
  de: string;
  ate: string;
  espelho: {
    esperados: string[];
    registrados: string[];
    emBranco: string[];
    foraDoCalendario: string[];
    diasNoContrato: number;
    diasMarcadosPeloMotorista: number;
  };
  /** O que os dias registrados valem. `unitario` some se houve reajuste no meio. */
  valor: { total: string; unitario: string | null; motivo: string | null };
};

const PATH = "/admin/mensal";

/**
 * "2026-09-19" → "19/09". O ano some: a grade já é de um mês só.
 *
 * Corta em 10 caracteres antes de partir porque a mesma função recebe as duas
 * formas: as regras do espelho devolvem "AAAA-MM-DD", mas coluna Date do
 * Prisma serializa em ISO completo. Sem o corte, `split("-")` deixava o resto
 * grudado e a tela mostrava "desde 20T00:00:00.000Z/09".
 */
function diaMes(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** Primeiro e último dia do mês, em AAAA-MM-DD. */
function limitesDoMes(ym: string): { de: string; ate: string } {
  const [a, m] = ym.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return { de: `${ym}-01`, ate: `${ym}-${String(ultimo).padStart(2, "0")}` };
}

function mesAtual(): string {
  return hojeSP().slice(0, 7);
}

/**
 * O mensal: quem está em qual obra, e quem marcou presença em cada dia.
 *
 * A grade é a razão da tela existir. Hoje a medição chega do contratante no
 * dia 20 preenchida à mão, e a transportadora não tem base própria pra
 * conferir — ela pergunta no grupo de WhatsApp e espera. Com a grade, a
 * conferência é olhar duas colunas.
 *
 * ⚠️ Não é controle de jornada. Não existe horário esperado, atraso nem falta:
 * o que se mostra é em que dias o caminhão esteve na obra. O motorista é
 * parceiro autônomo, e a diferença entre as duas coisas é a diferença entre um
 * contrato de transporte e uma ação trabalhista.
 */
export default function ObrasPage() {
  return (
    <RequerTela chave="alocacoes.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const { temPermissao } = usePermissoes();
  const [criando, setCriando] = useState(false);
  const [mes, setMes] = useState(mesAtual());

  const alocacoes = useQuery({
    queryKey: [PATH, "alocacoes"],
    enabled: !!token,
    queryFn: () => fetchApi<Alocacao[]>(`${PATH}/alocacoes?ativas=true`, { token }),
  });

  const { de, ate } = useMemo(() => limitesDoMes(mes), [mes]);

  const grade = useQuery({
    queryKey: [PATH, "presenca", de, ate],
    enabled: !!token && temPermissao("presenca.ver"),
    queryFn: () => fetchApi<LinhaGrade[]>(`${PATH}/presenca?de=${de}&ate=${ate}`, { token }),
  });

  const espelho = useQuery({
    queryKey: [PATH, "espelho", mes],
    enabled: !!token && temPermissao("espelhos.ver"),
    queryFn: () =>
      fetchApi<{ competencia: string | null; linhas: LinhaEspelho[]; total: string }>(
        `${PATH}/espelho?competencia=${mes}`,
        { token },
      ),
  });

  const diasDoMes = useMemo(() => {
    const out: string[] = [];
    const fim = new Date(`${ate}T00:00:00.000Z`).getTime();
    for (let t = new Date(`${de}T00:00:00.000Z`).getTime(); t <= fim; t += 86_400_000) {
      out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }, [de, ate]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <HardHat className="h-6 w-6 text-muted-foreground" />
            Obras e diárias
          </h1>
          <p className="text-sm text-muted-foreground">
            Quem está em qual obra, e em que dias o caminhão esteve lá. É o que você leva pra
            conferir a medição.
          </p>
        </div>
        {temPermissao("alocacoes.criar") && (
          <Button onClick={() => setCriando(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Alocar em obra
          </Button>
        )}
      </div>

      <Card className="p-4">
        <p className="font-medium">Alocações ativas</p>
        {alocacoes.data?.length === 0 ? (
          <EstadoVazio
            titulo="Ninguém alocado ainda"
            descricao="Aloque um motorista numa obra pra ele passar a marcar presença pelo app."
          />
        ) : (
          <div className="mt-3 space-y-2">
            {(alocacoes.data ?? []).map((a) => (
              <LinhaAlocacao key={a.id} a={a} />
            ))}
          </div>
        )}
      </Card>

      {temPermissao("presenca.ver") && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-medium">Dias na obra</p>
              <p className="text-sm text-muted-foreground">
                Verde = o motorista marcou pelo app. Azul = lançado aqui no painel.
              </p>
            </div>
            <div className="w-44">
              <Label>Mês</Label>
              <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
            </div>
          </div>

          {grade.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum dia marcado neste mês.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 bg-background p-2 text-left">Motorista</th>
                    {diasDoMes.map((d) => (
                      <th key={d} className="p-1 text-center font-normal text-muted-foreground">
                        {d.slice(-2)}
                      </th>
                    ))}
                    <th className="p-2 text-right">Dias</th>
                  </tr>
                </thead>
                <tbody>
                  {(grade.data ?? []).map((linha) => {
                    const porDia = new Map(linha.dias.map((x) => [x.data, x.origem]));
                    return (
                      <tr key={linha.alocacao.id} className="border-b">
                        <td className="sticky left-0 bg-background p-2">
                          <span className="font-medium">{linha.alocacao.motorista}</span>
                          <span className="block text-muted-foreground">
                            {linha.alocacao.obra} · {linha.alocacao.placa}
                          </span>
                        </td>
                        {diasDoMes.map((d) => {
                          const origem = porDia.get(d);
                          return (
                            <td key={d} className="p-1 text-center">
                              <span
                                title={
                                  origem === "APP"
                                    ? `${diaMes(d)} — marcado pelo motorista`
                                    : origem === "PAINEL"
                                      ? `${diaMes(d)} — lançado no painel`
                                      : undefined
                                }
                                className={`inline-block h-4 w-4 rounded-sm ${
                                  origem === "APP"
                                    ? "bg-emerald-500"
                                    : origem === "PAINEL"
                                      ? "bg-sky-500"
                                      : "bg-muted"
                                }`}
                              />
                            </td>
                          );
                        })}
                        <td className="p-2 text-right font-semibold">{linha.total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {temPermissao("espelhos.ver") && (espelho.data?.linhas.length ?? 0) > 0 && (
        <Card className="space-y-3 p-4">
          <div>
            <p className="font-medium">Espelho da competência</p>
            <p className="text-sm text-muted-foreground">
              O que o contrato esperava contra o que aconteceu. É o que você leva pra conferir a
              medição — o período vem do dia de corte de cada contratante.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Motorista / obra</th>
                  <th className="p-2">Período</th>
                  <th className="p-2 text-right">Esperados</th>
                  <th className="p-2 text-right">No contrato</th>
                  <th className="p-2 text-right">Em branco</th>
                  <th className="p-2 text-right">Fora do calendário</th>
                  <th className="p-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(espelho.data?.linhas ?? []).map((l) => (
                  <tr key={l.alocacaoId} className="border-b align-top">
                    <td className="p-2">
                      <span className="font-medium">{l.motorista}</span>
                      <span className="block text-xs text-muted-foreground">
                        {l.obra} · {l.placa}
                      </span>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {diaMes(l.de)} a {diaMes(l.ate)}
                      <span className="block">corte dia {l.diaCorte}</span>
                    </td>
                    <td className="p-2 text-right">{l.espelho.esperados.length}</td>
                    <td className="p-2 text-right font-semibold">
                      {l.espelho.diasNoContrato}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {l.espelho.diasMarcadosPeloMotorista} pelo motorista
                      </span>
                    </td>
                    {/* Em branco NÃO é falta: é dia que ninguém marcou. Pode
                        ser que o caminhão não foi, pode ser que ele esqueceu
                        de tocar — o sistema não sabe e não finge que sabe. */}
                    <td className="p-2 text-right">
                      {l.espelho.emBranco.length > 0 ? (
                        <span
                          className="text-amber-700 dark:text-amber-400"
                          title={l.espelho.emBranco.map(diaMes).join(", ")}
                        >
                          {l.espelho.emBranco.length}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {/* Separado do total de propósito: somado, a transportadora
                        cobraria um dia que o contrato não previa e descobriria
                        na recusa da medição; escondido, o motorista teria
                        trabalhado de graça. */}
                    <td className="p-2 text-right">
                      {l.espelho.foraDoCalendario.length > 0 ? (
                        <span
                          className="text-sky-700 dark:text-sky-400"
                          title={l.espelho.foraDoCalendario.map(diaMes).join(", ")}
                        >
                          {l.espelho.foraDoCalendario.length}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {/* O dinheiro. Sem esta coluna a conversa do dia 20 é
                        "eu tenho 22 e vocês têm 20" — contar sem valorar deixa
                        a transportadora sem a única frase que resolve a mesa. */}
                    <td className="p-2 text-right">
                      {l.valor.motivo ? (
                        <span
                          className="text-xs text-muted-foreground"
                          title="Cadastre um preço com base 'Por diária de obra' para esta empresa."
                        >
                          sem preço
                        </span>
                      ) : (
                        <>
                          <span className="font-semibold">{formatarBRL(Number(l.valor.total))}</span>
                          <span className="block text-xs text-muted-foreground">
                            {l.valor.unitario
                              ? `${formatarBRL(Number(l.valor.unitario))} / dia`
                              : "preço mudou no período"}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {espelho.data?.total && espelho.data.total !== "0.00" ? (
                <tfoot>
                  <tr className="border-t-2">
                    <td className="p-2 font-medium" colSpan={6}>
                      Total da competência
                    </td>
                    <td className="p-2 text-right font-semibold">
                      {formatarBRL(Number(espelho.data.total))}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            &ldquo;Em branco&rdquo; é dia que ninguém marcou — pode ser que o caminhão não foi, pode
            ser que o motorista esqueceu. Confira antes de contestar.
          </p>
        </Card>
      )}

      {temPermissao("espelhos.ver") && <ConferirMedicao mes={mes} />}

      {temPermissao("espelhos.ver") && <ConfigContratante />}

      {criando && (
        <DialogNovaAlocacao
          onFechar={() => setCriando(false)}
          onCriada={() => {
            setCriando(false);
            void alocacoes.refetch();
          }}
        />
      )}
    </div>
  );
}

function LinhaAlocacao({ a }: { a: Alocacao }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [encerrando, setEncerrando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const encerrar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/alocacoes/${a.id}/encerrar`, {
        token,
        method: "POST",
        body: JSON.stringify({ motivo }),
      }),
    onSuccess: () => {
      toast.success("Alocação encerrada.", {
        description: "Os dias já registrados continuam valendo.",
      });
      setEncerrando(false);
      void qc.invalidateQueries({ queryKey: [PATH, "alocacoes"] });
    },
    onError: (e: Error) => toast.error("Não consegui encerrar", { description: e.message }),
  });

  return (
    <div className="rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {a.motorista.nome} <span className="text-muted-foreground">em</span> {a.cliente.nome}
          </p>
          <p className="text-sm text-muted-foreground">
            {a.veiculo.placa} · desde {diaMes(a.inicio)}
            {a.valorDiaria ? ` · diária R$ ${a.valorDiaria}` : ""}
          </p>
        </div>
        {temPermissao("alocacoes.encerrar") && !encerrando && (
          <Button variant="outline" size="sm" onClick={() => setEncerrando(true)}>
            Encerrar
          </Button>
        )}
      </div>

      {/* Confirmação inline, não modal: o motivo é obrigatório e um diálogo
          aqui só empilharia janela sobre janela. */}
      {encerrando && (
        <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm">
            Para de contar diária nesta obra. Os dias já registrados continuam valendo, e o
            motorista volta a ver a home normal no app.
          </p>
          <Input
            className="mt-2"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por que está encerrando?"
          />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEncerrando(false)}>
              Voltar
            </Button>
            <Button
              size="sm"
              disabled={motivo.trim().length < 3 || encerrar.isPending}
              onClick={() => encerrar.mutate()}
            >
              Encerrar alocação
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Alocar é o cadastro que faz a tela do motorista não perguntar nada.
 *
 * Toda pergunta que NÃO for respondida aqui vira uma pergunta no app dele — e
 * é exatamente isso que o público do mensal não atravessa.
 */
function DialogNovaAlocacao({
  onFechar,
  onCriada,
}: {
  onFechar: () => void;
  onCriada: () => void;
}) {
  const token = useAuthToken();
  const [clienteId, setClienteId] = useState<string>();
  const [motoristaId, setMotoristaId] = useState<string>();
  const [veiculoId, setVeiculoId] = useState<string>();
  const [inicio, setInicio] = useState(hojeSP());
  const [valor, setValor] = useState("");

  const criar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/alocacoes`, {
        token,
        method: "POST",
        body: JSON.stringify({
          clienteId,
          motoristaId,
          veiculoId,
          inicio,
          valorDiariaCentavos: valor
            ? Math.round(Number(valor.replace(/\./g, "").replace(",", ".")) * 100)
            : undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Alocado na obra.", {
        description: "O motorista já vê o botão de marcar presença no app.",
      });
      onCriada();
    },
    onError: (e: Error) => toast.error("Não consegui alocar", { description: e.message }),
  });

  const podeSalvar = !!clienteId && !!motoristaId && !!veiculoId && !!inicio;

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alocar em obra</DialogTitle>
          <DialogDescription>
            O motorista passa a marcar presença num toque. Ele fica em uma obra por vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Obra</Label>
            <ClienteCombobox value={clienteId} onChange={setClienteId} placeholder="Escolha a obra…" />
          </div>
          <div>
            <Label>Motorista</Label>
            <MotoristaCombobox
              value={motoristaId}
              onChange={setMotoristaId}
              placeholder="Escolha o motorista…"
            />
          </div>
          <div>
            <Label>Caminhão</Label>
            <VeiculoCombobox value={veiculoId} onChange={setVeiculoId} placeholder="Escolha a placa…" />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-44">
              <Label>Começa em</Label>
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div className="w-40">
              <Label>Diária do motorista</Label>
              <Input
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="opcional"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Sem valor aqui, vale a régua da modalidade dele.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={!podeSalvar || criar.isPending} onClick={() => criar.mutate()}>
            {criar.isPending ? "Alocando…" : "Alocar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


const DIAS_SEMANA = [
  { n: 0, label: "Dom" },
  { n: 1, label: "Seg" },
  { n: 2, label: "Ter" },
  { n: 3, label: "Qua" },
  { n: 4, label: "Qui" },
  { n: 5, label: "Sex" },
  { n: 6, label: "Sáb" },
];

type ConfigMensal = { diaCorte: number; diasEsperadosSemana: number[] };

/**
 * O combinado com cada contratante: quando a medição chega e quais dias o
 * contrato espera o caminhão na obra.
 *
 * Existe porque nada disso pode ser constante no código — são vários
 * contratantes, cada um com o seu combinado, e o próximo cliente não pode
 * precisar de deploy pra começar a operar. É também o que transforma "o mês
 * tem 30 dias" em "eram 26 diárias": sem o calendário não existe divergência,
 * só uma lista de dias soltos.
 */
function ConfigContratante() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [empresaId, setEmpresaId] = useState<string>();
  const empresas = useResourceOptions<{ id: string; nome: string }>("/admin/empresas");

  const [corte, setCorte] = useState<string>("");
  const [dias, setDias] = useState<number[] | null>(null);

  const config = useQuery({
    queryKey: [PATH, "config", empresaId],
    enabled: !!token && !!empresaId,
    queryFn: async () => {
      const c = await fetchApi<ConfigMensal>(`${PATH}/config/${empresaId}`, { token });
      // Só semeia os campos na primeira carga: sobrescrever a cada revalidação
      // apagaria o que a pessoa está digitando.
      setCorte(String(c.diaCorte));
      setDias(c.diasEsperadosSemana);
      return c;
    },
  });

  const salvar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/config/${empresaId}`, {
        token,
        method: "PUT",
        body: JSON.stringify({ diaCorte: Number(corte), diasEsperadosSemana: dias ?? [] }),
      }),
    onSuccess: () => {
      toast.success("Combinado salvo.", {
        description: "O espelho passa a usar esse período no próximo cálculo.",
      });
      void qc.invalidateQueries({ queryKey: [PATH, "espelho"] });
    },
    onError: (e: Error) => toast.error("Não consegui salvar", { description: e.message }),
  });

  const podeSalvar =
    !!empresaId && Number(corte) >= 1 && Number(corte) <= 31 && (dias?.length ?? 0) > 0;

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="font-medium">Combinado com o contratante</p>
        <p className="text-sm text-muted-foreground">
          Quando a medição chega e quais dias o contrato espera o caminhão na obra. É daqui que
          sai o período do espelho.
        </p>
      </div>

      <div className="w-72">
        <Label>Contratante</Label>
        <Combobox
          value={empresaId}
          onChange={setEmpresaId}
          placeholder="Escolha o contratante…"
          options={(empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome }))}
        />
      </div>

      {empresaId && !config.isLoading && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Label>Medição chega dia</Label>
              <Input
                inputMode="numeric"
                value={corte}
                onChange={(e) => setCorte(e.target.value.replace(/\D/g, "").slice(0, 2))}
              />
            </div>
            <p className="pb-2 text-xs text-muted-foreground">
              Corte 20 apura de 21 do mês passado a 20 deste.
            </p>
          </div>

          <div>
            <Label>Dias que o contrato espera</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {DIAS_SEMANA.map((d) => {
                const ligado = dias?.includes(d.n) ?? false;
                return (
                  <button
                    key={d.n}
                    type="button"
                    onClick={() =>
                      setDias((atual) =>
                        (atual ?? []).includes(d.n)
                          ? (atual ?? []).filter((x) => x !== d.n)
                          : [...(atual ?? []), d.n],
                      )
                    }
                    className={`rounded-md border px-3 py-2 text-sm ${
                      ligado ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            {/* Domingo fora não é julgamento sobre ninguém: é o combinado do
                contrato. Dia trabalhado fora do calendário não some — aparece
                separado no espelho. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Dia registrado fora desses aparece separado no espelho, nunca sumido.
            </p>
          </div>

          {temPermissao("espelhos.configurar") && (
            <Button disabled={!podeSalvar || salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Salvando…" : "Salvar combinado"}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}


type LinhaDivergencia = {
  chave: string;
  motorista?: string;
  obra?: string;
  placa?: string;
  modo: "POR_DIA" | "SO_TOTAL";
  soNosso: string[];
  soDeles: string[];
  totalNosso: number;
  totalDeles: number;
  diferenca: number;
  semContraparte: "NOSSO" | "DELES" | null;
  bate: boolean;
  /** Quanto a diferença vale. Null quando não há preço que sustente o número. */
  valorDiferenca: string | null;
};

type Conferencia = {
  competencia: string;
  lancada: boolean;
  lancadaEm: string | null;
  espelho: { alocacaoId: string; motorista: string; obra: string; placa: string }[];
  /** O que registramos no período, em R$. */
  nosso: string;
  divergencias: LinhaDivergencia[];
  resumo: {
    linhas: number;
    batem: number;
    diasAMenos: number;
    diasAMais: number;
    aContestar: number;
    semContraparte: number;
    /** Soma do que está a menos na medição deles. É o pedido de ajuste. */
    valorAContestar: string;
  };
};

/**
 * A conferência do dia 20: o nosso registro contra o que o contratante mediu.
 *
 * Hoje isso é feito no olho, obra por obra, sem base própria — e quando acha
 * um erro, a discussão é de memória. Aqui você digita o que a medição diz e a
 * diferença sai na hora, com o dia na mão quando a planilha vem dia a dia.
 *
 * O lançamento é MANUAL de propósito, e não por falta de vontade de ler
 * Excel: o formato da planilha varia por contratante e muda sem avisar, e um
 * importador escrito contra um arquivo imaginado quebra no primeiro cliente
 * diferente. Digitar um número por motorista, uma vez por mês, entrega a
 * divergência hoje — e o importador entra depois sobre esta mesma base.
 */
function ConferirMedicao({ mes }: { mes: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const [empresaId, setEmpresaId] = useState<string>();
  const [totais, setTotais] = useState<Record<string, string>>({});
  const empresas = useResourceOptions<{ id: string; nome: string }>("/admin/empresas");

  const conferencia = useQuery({
    queryKey: [PATH, "medicao", empresaId, mes],
    enabled: !!token && !!empresaId,
    queryFn: async () => {
      const r = await fetchApi<Conferencia>(
        `${PATH}/medicao?empresaId=${empresaId}&competencia=${mes}`,
        { token },
      );
      // Semeia os campos com o que já foi lançado, uma vez por carga.
      const semente: Record<string, string> = {};
      for (const d of r.divergencias) {
        if (r.lancada) semente[d.chave] = String(d.totalDeles);
      }
      setTotais(semente);
      return r;
    },
  });

  const salvar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/medicao`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          empresaId,
          competencia: mes,
          linhas: (conferencia.data?.espelho ?? [])
            .filter((e) => totais[e.alocacaoId] !== undefined && totais[e.alocacaoId] !== "")
            .map((e) => ({
              alocacaoId: e.alocacaoId,
              totalDias: Number(totais[e.alocacaoId]),
            })),
        }),
      }),
    onSuccess: () => {
      toast.success("Medição lançada.", { description: "A diferença já está calculada abaixo." });
      void qc.invalidateQueries({ queryKey: [PATH, "medicao"] });
    },
    onError: (e: Error) => toast.error("Não consegui lançar", { description: e.message }),
  });

  const d = conferencia.data;

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="font-medium">Conferir a medição</p>
        <p className="text-sm text-muted-foreground">
          Digite quantos dias a medição do contratante diz, por motorista. A diferença contra o
          nosso registro sai na hora.
        </p>
      </div>

      <div className="w-72">
        <Label>Contratante</Label>
        <Combobox
          value={empresaId}
          onChange={setEmpresaId}
          placeholder="Escolha o contratante…"
          options={(empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome }))}
        />
      </div>

      {empresaId && d && d.espelho.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma alocação desse contratante neste mês.
        </p>
      )}

      {empresaId && d && d.espelho.length > 0 && (
        <>
          {/* O resumo primeiro: quem abre isso quer saber se tem briga, não
              ler uma tabela. */}
          {d.lancada && (
            <div className="flex flex-wrap gap-4 rounded border p-3 text-sm">
              <span>
                <strong>{d.resumo.batem}</strong> de {d.resumo.linhas} batem
              </span>
              {d.resumo.diasAMenos > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  <strong>{d.resumo.diasAMenos}</strong> dia(s) que registramos e eles não
                  contaram
                  {/* O número que resolve a mesa. "Faltam 2 diárias" vira
                      "faltam R$ 2.200", que é o que se pede por escrito. */}
                  {Number(d.resumo.valorAContestar) > 0 && (
                    <strong> · {formatarBRL(Number(d.resumo.valorAContestar))}</strong>
                  )}
                </span>
              )}
              {d.resumo.diasAMais > 0 && (
                <span className="text-sky-700 dark:text-sky-400">
                  <strong>{d.resumo.diasAMais}</strong> dia(s) que eles contaram e não temos
                </span>
              )}
              {d.resumo.semContraparte > 0 && (
                <span className="text-destructive">
                  <strong>{d.resumo.semContraparte}</strong> linha(s) só de um lado
                </span>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Motorista / obra</th>
                  <th className="p-2 text-right">Nosso registro</th>
                  <th className="p-2 text-right">A medição diz</th>
                  <th className="p-2 text-right">Diferença</th>
                  <th className="p-2 text-right">Em R$</th>
                </tr>
              </thead>
              <tbody>
                {d.espelho.map((e) => {
                  const div = d.divergencias.find((x) => x.chave === e.alocacaoId);
                  const dif = div?.diferenca ?? 0;
                  return (
                    <tr key={e.alocacaoId} className="border-b">
                      <td className="p-2">
                        <span className="font-medium">{e.motorista}</span>
                        <span className="block text-xs text-muted-foreground">
                          {e.obra} · {e.placa}
                        </span>
                      </td>
                      <td className="p-2 text-right font-semibold">{div?.totalNosso ?? 0}</td>
                      <td className="p-2 text-right">
                        <Input
                          inputMode="numeric"
                          className="ml-auto w-20 text-right"
                          value={totais[e.alocacaoId] ?? ""}
                          onChange={(ev) =>
                            setTotais((t) => ({
                              ...t,
                              [e.alocacaoId]: ev.target.value.replace(/\D/g, "").slice(0, 2),
                            }))
                          }
                        />
                      </td>
                      <td className="p-2 text-right">
                        {!d.lancada || totais[e.alocacaoId] === undefined ? (
                          "—"
                        ) : dif === 0 ? (
                          <span className="text-emerald-700 dark:text-emerald-400">bate</span>
                        ) : dif > 0 ? (
                          <span className="font-semibold text-amber-700 dark:text-amber-400">
                            +{dif} nosso
                          </span>
                        ) : (
                          <span className="font-semibold text-sky-700 dark:text-sky-400">
                            {-dif} só deles
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {!d.lancada || !div?.valorDiferenca ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={
                              dif > 0
                                ? "font-semibold text-amber-700 dark:text-amber-400"
                                : "font-semibold text-sky-700 dark:text-sky-400"
                            }
                          >
                            {formatarBRL(Math.abs(Number(div.valorDiferenca)))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {temPermissao("espelhos.configurar") && (
            <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Lançando…" : "Lançar medição e comparar"}
            </Button>
          )}

          <p className="text-xs text-muted-foreground">
            A medição é guardada como o contratante mandou, sem correção nossa — é ela que
            sustenta o pedido de ajuste.
          </p>
        </>
      )}
    </Card>
  );
}
