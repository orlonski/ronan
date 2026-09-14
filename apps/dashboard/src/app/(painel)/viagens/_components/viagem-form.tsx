"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  ClienteCombobox,
  LocalCombobox,
  VeiculoCombobox,
} from "@/components/fk-comboboxes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";
import { isoDeInputDataHoraSP, paraInputDataHoraSP } from "@/lib/datetime-br";
import { formatarDuracao } from "@ronan/shared-types";
import { numeroInvalido, numeroOuNull } from "@/lib/numero";
import { AvisoNumero } from "@/components/aviso-numero";
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";

type Material = { id: string; nome: string };
type Motorista = { id: string; nome: string };

export type ViagemEditavel = {
  id: string;
  // Null quando a viagem está AGUARDANDO_PESO (lançada sem o peso). Admin
  // preenche aqui e o backend transiciona pra ENVIADA.
  toneladas: string | null;
  data: string;
  ticket: string | null;
  // Null quando o modo de serviço não exige km (diária à disposição).
  km: string | null;
  kmCalculado: string | null;
  /** O km que o MOTORISTA informou — a lei. Alterar exige motivo escrito. */
  kmMotorista?: string | null;
  observacao: string | null;
  nfeChave: string | null;
  nfeNumero: string | null;
  cteChave: string | null;
  cteNumero: string | null;
  mdfeChave: string | null;
  recebedorNome: string | null;
  recebedorDoc: string | null;
  valorPedagioTotal: string | null;
  status: string;
  // Coordenadas capturadas pelo motorista no momento do lançamento (opcional —
  // null se ele negou GPS). Usado pra sugerir local de descarga próximo.
  lat: number | null;
  lng: number | null;
  veiculo: { id: string; placa: string; modelo: string | null };
  motorista: Motorista;
  // Ausentes pra quem não tem `viagens.ver-comercial` — o backend omite.
  cliente?: { id: string; nome: string } | null;
  // Nulos quando o modo de serviço não os exige (diária à disposição).
  material: { id: string; nome: string } | null;
  localCarga: { id: string; nome: string; cidade: string; uf: string };
  localDescarga: { id: string; nome: string; cidade: string; uf: string } | null;
  /** Modo de serviço. null = frete por tonelada (histórico e app antigo). */
  tipoServico: { id: string; nome: string; medicao: "PESO" | "PERIODO" } | null;
  entradaEm: string | null;
  saidaEm: string | null;
  matchesFechamento?: { id: string }[];
};

type FormState = {
  data: string;
  ticket: string;
  toneladas: string;
  km: string;
  /** Por que o km do motorista está sendo alterado. Só viaja quando o km muda. */
  motivoKm: string;
  valorPedagioTotal: string;
  observacao: string;
  nfeChave: string;
  nfeNumero: string;
  cteChave: string;
  cteNumero: string;
  mdfeChave: string;
  recebedorNome: string;
  recebedorDoc: string;
  veiculoId: string;
  clienteId: string;
  materialId: string;
  localCargaId: string;
  localDescargaId: string;
  // Serviço medido por período (diária). "YYYY-MM-DDTHH:mm" em hora de Brasília.
  entradaEm: string;
  saidaEm: string;
};

/**
 * Campos numéricos desta tela. O `id` existe pra poder focar o campo culpado
 * quando o número não dá pra ler — validação que não leva o olho até o campo
 * não serve pra formulário deste tamanho.
 */
const CAMPOS_NUMERICOS = [
  { chave: "toneladas", id: "viagem-toneladas", rotulo: "Toneladas" },
  { chave: "km", id: "viagem-km", rotulo: "Km" },
  { chave: "valorPedagioTotal", id: "viagem-pedagio", rotulo: "Valor do pedágio" },
] as const;

// Converte ISO/Date pra "YYYY-MM-DD" pra input type="date"
function toDateInput(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function ViagemForm({ initial }: { initial: ViagemEditavel }) {
  const router = useRouter();
  const token = useAuthToken();
  const qc = useQueryClient();

  // Veículo, cliente e local usam autocomplete server-side (sem teto de 200).
  // Material é catálogo pequeno — segue carregando tudo.
  const materiais = useResourceOptions<Material>("/admin/materiais");

  const [form, setForm] = useState<FormState>({
    data: toDateInput(initial.data),
    ticket: initial.ticket ?? "",
    toneladas:
      initial.toneladas != null
        ? String(initial.toneladas).replace(".", ",")
        : "",
    // Modo sem km (diária à disposição) chega null — sem a guarda o campo
    // exibiria a string "null".
    km: initial.km != null ? String(initial.km).replace(".", ",") : "",
    motivoKm: "",
    valorPedagioTotal:
      initial.valorPedagioTotal != null
        ? String(initial.valorPedagioTotal).replace(".", ",")
        : "",
    observacao: initial.observacao ?? "",
    nfeChave: initial.nfeChave ?? "",
    nfeNumero: initial.nfeNumero ?? "",
    cteChave: initial.cteChave ?? "",
    cteNumero: initial.cteNumero ?? "",
    mdfeChave: initial.mdfeChave ?? "",
    recebedorNome: initial.recebedorNome ?? "",
    recebedorDoc: initial.recebedorDoc ?? "",
    veiculoId: initial.veiculo.id,
    clienteId: initial.cliente?.id ?? "",
    materialId: initial.material?.id ?? "",
    localCargaId: initial.localCarga.id,
    localDescargaId: initial.localDescarga?.id ?? "",
    entradaEm: paraInputDataHoraSP(initial.entradaEm),
    saidaEm: paraInputDataHoraSP(initial.saidaEm),
  });

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo(form);
  useAvisarSeSujo(sujo);

  const ehPeriodo = initial.tipoServico?.medicao === "PERIODO";

  // Permanência recalculada enquanto o admin digita — ele vê o resultado antes
  // de salvar, em vez de descobrir depois que errou o dia.
  const duracaoPreview = useMemo(() => {
    if (!ehPeriodo) return null;
    const entrada = isoDeInputDataHoraSP(form.entradaEm);
    const saida = isoDeInputDataHoraSP(form.saidaEm);
    if (!entrada || !saida) return "em aberto";
    const minutos = Math.round(
      (new Date(saida).getTime() - new Date(entrada).getTime()) / 60000,
    );
    if (minutos <= 0) return "saída antes da entrada";
    return formatarDuracao(minutos);
  }, [ehPeriodo, form.entradaEm, form.saidaEm]);

  const materialOptions = useMemo(
    () => (materiais.data ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [materiais.data],
  );

  // Opções iniciais (o que já está selecionado) pra o autocomplete mostrar o
  // nome no trigger antes de qualquer busca.
  const veiculoInicial = {
    value: initial.veiculo.id,
    label: initial.veiculo.placa,
    sublabel: initial.veiculo.modelo ?? undefined,
  };
  const clienteInicial = initial.cliente
    ? { value: initial.cliente.id, label: initial.cliente.nome }
    : undefined;
  const localCargaInicial = {
    value: initial.localCarga.id,
    label: initial.localCarga.nome,
    sublabel: `${initial.localCarga.cidade}/${initial.localCarga.uf}`,
  };
  const localDescargaInicial = initial.localDescarga
    ? {
        value: initial.localDescarga.id,
        label: initial.localDescarga.nome,
        sublabel: `${initial.localDescarga.cidade}/${initial.localDescarga.uf}`,
      }
    : undefined;

  // Sugere o local mais próximo do lat/lng capturado pelo motorista no
  // lançamento (raio 500m). Útil pra corrigir viagens onde motorista
  // selecionou local errado mas o GPS estava certo. Server-side agora (antes
  // varria a lista completa carregada, que sumiu com o autocomplete).
  const temGps = initial.lat != null && initial.lng != null;
  const sugestao = useQuery({
    queryKey: ["local-proximo", initial.id, form.localDescargaId],
    enabled: !!token && temGps,
    queryFn: () =>
      fetchApi<{ id: string; nome: string; cidade: string; uf: string; dist: number } | null>(
        `/admin/locais/proximo?lat=${initial.lat}&lng=${initial.lng}&raioM=500&excluirId=${form.localDescargaId}`,
        { token },
      ),
  });
  const sugestaoDescarga = sugestao.data ?? null;

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchApi<{ id: string }>(`/admin/viagens/${initial.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      toast.success("Viagem atualizada.");
      void qc.invalidateQueries({ queryKey: ["viagem-admin", initial.id] });
      void qc.invalidateQueries({ queryKey: ["viagem-historico", initial.id] });
      void qc.invalidateQueries({ queryKey: ["/admin/viagens"] });
      router.push(`/viagens/${initial.id}`);
    },
    onError: (err) => {
      toast.error("Não foi possível salvar", {
        description: (err as Error).message,
      });
    },
  });

  function buildDiff(): Record<string, unknown> {
    const diff: Record<string, unknown> = {};

    if (form.data && form.data !== toDateInput(initial.data)) {
      diff.data = new Date(form.data + "T00:00:00.000Z").toISOString();
    }
    // Ticket vazio vira null (material que não exige ticket).
    const ticketNorm = form.ticket.trim() || null;
    if (ticketNorm !== (initial.ticket ?? null)) diff.ticket = ticketNorm;
    if (form.veiculoId !== initial.veiculo.id) diff.veiculoId = form.veiculoId;
    if (form.clienteId !== (initial.cliente?.id ?? "")) diff.clienteId = form.clienteId;
    if (form.materialId !== (initial.material?.id ?? "")) diff.materialId = form.materialId;
    if (form.localCargaId !== initial.localCarga.id)
      diff.localCargaId = form.localCargaId;
    if (form.localDescargaId !== (initial.localDescarga?.id ?? ""))
      diff.localDescargaId = form.localDescargaId;

    // Diária: as horas viajam como instante ISO. O backend recalcula a duração
    // e promove a viagem pra ENVIADA quando a saída entra.
    if (ehPeriodo) {
      const entradaNova = isoDeInputDataHoraSP(form.entradaEm);
      const saidaNova = isoDeInputDataHoraSP(form.saidaEm);
      if (entradaNova !== (initial.entradaEm ?? null)) diff.entradaEm = entradaNova;
      if (saidaNova !== (initial.saidaEm ?? null)) diff.saidaEm = saidaNova;
    }

    const tonNum = numeroOuNull(form.toneladas);
    if (tonNum != null && tonNum !== Number(initial.toneladas)) {
      diff.toneladas = tonNum;
    }
    const kmNum = numeroOuNull(form.km);
    if (kmNum != null && kmNum !== Number(initial.km)) {
      diff.km = kmNum;
      // O km do motorista é lei: quando cede, vai junto o porquê (o backend
      // recusa a alteração sem isso).
      if (form.motivoKm.trim()) diff.motivoKm = form.motivoKm.trim();
    }

    const pedagioNovo = numeroOuNull(form.valorPedagioTotal);
    const pedagioAntigo =
      initial.valorPedagioTotal != null ? Number(initial.valorPedagioTotal) : null;
    if (pedagioNovo !== pedagioAntigo) {
      diff.valorPedagioTotal = pedagioNovo;
    }

    const obsNovo = form.observacao.trim() === "" ? null : form.observacao;
    const obsAntigo = initial.observacao;
    if (obsNovo !== obsAntigo) {
      diff.observacao = obsNovo;
    }

    // Campos fiscais e do recebedor: texto puro, vazio vira null. As chaves vão
    // só com os números — quem cola do DACTE traz espaço e ponto, e a mesma
    // chave virando dois valores no banco é o que quebra a conferência depois.
    const textos = [
      "nfeChave",
      "nfeNumero",
      "cteChave",
      "cteNumero",
      "mdfeChave",
      "recebedorNome",
      "recebedorDoc",
    ] as const;
    for (const campo of textos) {
      const bruto = form[campo].trim();
      const novo = bruto === "" ? null : campo.endsWith("Chave") ? bruto.replace(/\D/g, "") : bruto;
      if (novo !== initial[campo]) diff[campo] = novo;
    }

    return diff;
  }

  // O km que o motorista informou é lei: mexer nele exige motivo escrito. A
  // mesma regra vale no backend (400 sem motivo) — aqui é só pra não deixar o
  // conferente descobrir isso depois de digitar tudo.
  const campoNumericoRuim = CAMPOS_NUMERICOS.find((c) => numeroInvalido(form[c.chave]));

  const kmNovo = numeroOuNull(form.km);
  const kmMudou = kmNovo != null && kmNovo !== Number(initial.km);
  const exigeMotivoKm = kmMudou && initial.kmMotorista != null;
  const motivoKmCurto = form.motivoKm.trim().length < 10;

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    // Número que não dá pra ler ("12,5,0") era descartado como se o campo
    // estivesse vazio: a tela dizia "Viagem atualizada", o km ficava o antigo e,
    // porque o km "não mudou", a trava do motivo nem disparava. Agora é erro.
    if (campoNumericoRuim) {
      toast.error(`${campoNumericoRuim.rotulo}: não entendi esse número`, {
        description: "Use vírgula só uma vez, sem letra. Ex.: 12,5",
      });
      document.getElementById(campoNumericoRuim.id)?.focus();
      return;
    }
    if (exigeMotivoKm && motivoKmCurto) {
      toast.error("Explique por que está alterando o km", {
        description:
          "O km foi informado pelo motorista. Escreva o motivo (pelo menos 10 caracteres) — ele vai pro histórico e pro celular dele.",
      });
      document.getElementById("motivo-km")?.focus();
      return;
    }
    const body = buildDiff();
    if (Object.keys(body).length === 0) {
      toast.info("Nada pra salvar.");
      return;
    }
    await mutation.mutateAsync(body);
  }

  const saving = mutation.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-5">
        {initial.status === "AGUARDANDO_SAIDA" && (
          <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900">
            <strong>Diária aberta.</strong> O motorista marcou a entrada e ainda não
            marcou a saída, então essa viagem não entra em fechamento. Preencha a hora
            de saída e salve — ela passa pra “Aguardando conferência” automaticamente.
          </div>
        )}
        {initial.status === "AGUARDANDO_PESO" && (
          <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
            <strong>Aguardando peso.</strong> Essa viagem foi lançada sem o peso
            (romaneio no fim do dia) e não entra em fechamento. Preencha as
            toneladas (e o ticket) e salve — ela passa pra “Aguardando
            conferência” automaticamente.
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="viagemform-data">Data</Label>
            <Input id="viagemform-data"
              type="date"
              required
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="viagemform-ticket">Ticket</Label>
            <Input id="viagemform-ticket"
              value={form.ticket}
              onChange={(e) => setForm({ ...form, ticket: e.target.value })}
              maxLength={50}
              placeholder="deixe vazio se o material não exige"
            />
          </div>
          <div className="space-y-2">
            <Label>Placa do veículo</Label>
            <VeiculoCombobox
              value={form.veiculoId}
              onChange={(v) => setForm({ ...form, veiculoId: v ?? "" })}
              initialOption={veiculoInicial}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <ClienteCombobox
              value={form.clienteId}
              onChange={(v) => setForm({ ...form, clienteId: v ?? "" })}
              initialOption={clienteInicial}
            />
          </div>
          <div className="space-y-2">
            <Label>Material</Label>
            <Combobox
              value={form.materialId}
              onChange={(v) => setForm({ ...form, materialId: v ?? "" })}
              options={materialOptions}
              placeholder={ehPeriodo ? "Sem material" : "Selecione"}
            />
          </div>
          {/* Serviço medido por período não tem peso: o campo de toneladas dá
              lugar às horas, que é o que se cobra. */}
          {ehPeriodo ? (
            <div className="space-y-2">
              <Label htmlFor="viagemform-entrada">Entrada</Label>
              <Input id="viagemform-entrada"
                type="datetime-local"
                required
                value={form.entradaEm}
                onChange={(e) => setForm({ ...form, entradaEm: e.target.value })}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="viagem-toneladas">Toneladas</Label>
              <Input
                id="viagem-toneladas"
                required
                inputMode="decimal"
                aria-invalid={numeroInvalido(form.toneladas) || undefined}
                value={form.toneladas}
                onChange={(e) => setForm({ ...form, toneladas: e.target.value })}
              />
              <AvisoNumero valor={form.toneladas} />
            </div>
          )}
        </div>

        {ehPeriodo && (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="viagemform-saida">Saída</Label>
              <Input id="viagemform-saida"
                type="datetime-local"
                value={form.saidaEm}
                onChange={(e) => setForm({ ...form, saidaEm: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Deixe vazio enquanto o caminhão ainda estiver lá. A duração é
                calculada sozinha, inclusive quando o turno vira a noite.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Permanência</Label>
              <p className="pt-2 text-sm font-medium tabular-nums">
                {duracaoPreview ?? "—"}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Local de carga</Label>
            <LocalCombobox
              value={form.localCargaId}
              onChange={(v) => setForm({ ...form, localCargaId: v ?? "" })}
              initialOption={localCargaInicial}
            />
          </div>
          <div className="space-y-2">
            <Label>Local de descarga</Label>
            {sugestaoDescarga && (
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({ ...f, localDescargaId: sugestaoDescarga.id }))
                }
                className="w-full rounded border border-blue-300 bg-blue-50 px-3 py-2 text-left text-xs text-blue-900 hover:bg-blue-100"
                title="Usa o lat/lng que o motorista capturou no lançamento"
              >
                📍 Usar lugar do lançamento:{" "}
                <strong>{sugestaoDescarga.nome}</strong> (
                {Math.round(sugestaoDescarga.dist)}m)
              </button>
            )}
            <LocalCombobox
              value={form.localDescargaId}
              onChange={(v) => setForm({ ...form, localDescargaId: v ?? "" })}
              initialOption={localDescargaInicial}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="viagem-km">Km</Label>
            <Input
              id="viagem-km"
              required
              inputMode="decimal"
              aria-invalid={numeroInvalido(form.km) || undefined}
              value={form.km}
              onChange={(e) => setForm({ ...form, km: e.target.value })}
            />
            <AvisoNumero valor={form.km} />
            {initial.kmMotorista != null && (
              <p className="text-xs text-muted-foreground">
                Informado pelo motorista:{" "}
                <strong>{String(initial.kmMotorista).replace(".", ",")} km</strong> —
                esse valor é lei.
              </p>
            )}
          </div>
        </div>

        {/* O km do motorista só cede com o porquê escrito. O texto vai pro
            histórico (registro "Conferente alterou o km") e pro celular dele. */}
        {exigeMotivoKm && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <Label htmlFor="motivo-km" className="text-amber-900">
              Por que está alterando o km do motorista?
            </Label>
            <p className="text-xs text-amber-900">
              Ele informou {String(initial.kmMotorista).replace(".", ",")} km e você
              está pondo {form.km} km. O motivo aparece no histórico da viagem e chega
              pra ele no celular.
            </p>
            <Textarea
              id="motivo-km"
              maxLength={300}
              placeholder="Ex.: motorista digitou 640 em vez de 64 — confirmado com ele por telefone."
              value={form.motivoKm}
              onChange={(e) => setForm({ ...form, motivoKm: e.target.value })}
            />
            {motivoKmCurto && (
              <p className="text-xs text-amber-900">
                Faltam pelo menos {10 - form.motivoKm.trim().length} caracteres.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="viagem-pedagio">Valor pedágio (R$)</Label>
            <Input
              id="viagem-pedagio"
              inputMode="decimal"
              placeholder="Vazio = sem pedágio"
              aria-invalid={numeroInvalido(form.valorPedagioTotal) || undefined}
              value={form.valorPedagioTotal}
              onChange={(e) =>
                setForm({ ...form, valorPedagioTotal: e.target.value })
              }
            />
            <AvisoNumero valor={form.valorPedagioTotal} dinheiro />
          </div>
          <div className="space-y-2">
            <Label htmlFor="viagemform-observacao">Observação</Label>
            <Input id="viagemform-observacao"
              maxLength={500}
              value={form.observacao}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            />
          </div>
        </div>

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Documentos e comprovante de entrega
          </summary>
          <div className="mt-3 space-y-4">
            <p className="text-xs text-muted-foreground">
              O sistema não emite documento fiscal — guarda o que você já emite em outro lugar,
              pra não ter que procurar depois nem digitar a viagem duas vezes.
            </p>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="cte-chave">Chave do CT-e</Label>
                <Input
                  id="cte-chave"
                  inputMode="numeric"
                  placeholder="44 números"
                  value={form.cteChave}
                  onChange={(e) => setForm({ ...form, cteChave: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cte-numero">Número</Label>
                <Input
                  id="cte-numero"
                  value={form.cteNumero}
                  onChange={(e) => setForm({ ...form, cteNumero: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="nfe-chave">Chave da NF-e da carga</Label>
                <Input
                  id="nfe-chave"
                  inputMode="numeric"
                  placeholder="44 números"
                  value={form.nfeChave}
                  onChange={(e) => setForm({ ...form, nfeChave: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nfe-numero">Número</Label>
                <Input
                  id="nfe-numero"
                  value={form.nfeNumero}
                  onChange={(e) => setForm({ ...form, nfeNumero: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mdfe-chave">Chave do MDF-e</Label>
              <Input
                id="mdfe-chave"
                inputMode="numeric"
                placeholder="44 números"
                value={form.mdfeChave}
                onChange={(e) => setForm({ ...form, mdfeChave: e.target.value })}
              />
            </div>

            <div className="grid gap-4 border-t pt-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="recebedor-nome">Quem recebeu a carga</Label>
                <Input
                  id="recebedor-nome"
                  placeholder="nome de quem assinou"
                  value={form.recebedorNome}
                  onChange={(e) => setForm({ ...form, recebedorNome: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="recebedor-doc">Documento (CPF/RG)</Label>
                <Input
                  id="recebedor-doc"
                  value={form.recebedorDoc}
                  onChange={(e) => setForm({ ...form, recebedorDoc: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Com o GPS e a foto que a viagem já tem, isto fecha os quatro requisitos do
              comprovante de entrega eletrônico.
            </p>
          </div>
        </details>

        <div className="flex justify-end gap-2 pt-2">
          <BotaoCancelar href={`/viagens/${initial.id}`} sujo={sujo} />
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
