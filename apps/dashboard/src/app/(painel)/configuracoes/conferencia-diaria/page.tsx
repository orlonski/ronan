"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Play, Save, Send } from "lucide-react";
import { toast } from "sonner";
import {
  MENSAGEM_AO_PARAR_PADRAO,
  JANELA_ATIVIDADE_VALIDACAO_MAX_DIAS,
  TOLERANCIA_ENVIO_VALIDACAO_MAX_HORAS,
  MAX_REENVIOS_VALIDACAO_MAX,
  descreverRegraConferencia,
  type ConfigConferenciaDiaria,
  type RegraConferenciaDiaria,
  type QuemEntraConferenciaDiaria,
  type LembreteAppParaQuem,
  textoLembreteLancamento,
} from "@ronan/shared-types";
import { RequerTela } from "@/components/requer-tela";
import { AbasDaTela } from "@/components/abas-da-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ComboboxMulti } from "@/components/ui/combobox-multi";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ListaConferencia, type RespostaConferencia } from "@/components/conferencia-diaria-lista";
import { fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

const PATH = "/admin/conferencia-diaria/config";
const PATH_SIMULAR = "/admin/conferencia-diaria/simular";

const DIAS = [
  { n: 1, curto: "Seg" },
  { n: 2, curto: "Ter" },
  { n: 3, curto: "Qua" },
  { n: 4, curto: "Qui" },
  { n: 5, curto: "Sex" },
  { n: 6, curto: "Sáb" },
  { n: 0, curto: "Dom" },
];
const UTEIS = [1, 2, 3, 4, 5];
const TODOS = [0, 1, 2, 3, 4, 5, 6];

type ModoDias = "UTEIS" | "TODOS" | "PERSONALIZADO";

function modoDosDias(dias: number[]): ModoDias {
  const s = new Set(dias);
  if (s.size === 5 && UTEIS.every((d) => s.has(d))) return "UTEIS";
  if (s.size === 7) return "TODOS";
  return "PERSONALIZADO";
}

export default function ConferenciaDiariaConfigPage() {
  return (
    <RequerTela chave="config-conferencia-diaria.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeEditar = temPermissao("config-conferencia-diaria.editar");

  const cfg = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigConferenciaDiaria>(PATH, { token }),
  });

  const [form, setForm] = useState<ConfigConferenciaDiaria | null>(null);
  const [modoDiasEsperados, setModoDiasEsperados] = useState<ModoDias>("UTEIS");
  useEffect(() => {
    if (cfg.data && !form) {
      setForm(cfg.data);
      setModoDiasEsperados(modoDosDias(cfg.data.diasConsiderados));
    }
  }, [cfg.data, form]);

  const modalidades = useResourceOptions<{ id: string; nome: string }>("/admin/modalidades", {
    enabled: !!token && !!form && form.quemEntra === "SO_MODALIDADES",
  });
  const transportadoras = useResourceOptions<{ id: string; nome: string }>("/admin/transportadoras", {
    enabled: !!token && !!form && form.quemEntra === "SO_MODALIDADES",
  });

  const salvar = useMutation({
    mutationFn: (body: Partial<ConfigConferenciaDiaria>) =>
      fetchApi<ConfigConferenciaDiaria>(PATH, { method: "PUT", body: JSON.stringify(body), token }),
    onSuccess: (novo) => {
      toast.success("Regra da conferência salva.");
      setForm(novo);
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não deu pra salvar."),
  });

  const [simulacao, setSimulacao] = useState<(RespostaConferencia & { regraEmVigor: string }) | null>(null);
  const simular = useMutation({
    mutationFn: () =>
      fetchApi<RespostaConferencia & { regraEmVigor: string }>(PATH_SIMULAR, { method: "POST", token }),
    onSuccess: setSimulacao,
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não deu pra simular."),
  });

  const regraEmVigor = useMemo(
    () => (form ? descreverRegraConferencia(form) : ""),
    [form],
  );
  const alterado = !!form && !!cfg.data && JSON.stringify(form) !== JSON.stringify(cfg.data);

  if (!form) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function set<K extends keyof ConfigConferenciaDiaria>(k: K, v: ConfigConferenciaDiaria[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }
  function alternarDia(campo: "diasDoJob" | "diasConsiderados", dia: number) {
    setForm((f) => {
      if (!f) return f;
      const atual = f[campo];
      const novo = atual.includes(dia) ? atual.filter((d) => d !== dia) : [...atual, dia];
      return { ...f, [campo]: novo.sort((a, b) => a - b) };
    });
  }
  function escolherModoDias(m: ModoDias) {
    setModoDiasEsperados(m);
    if (m === "UTEIS") set("diasConsiderados", [...UTEIS]);
    if (m === "TODOS") set("diasConsiderados", [...TODOS]);
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form) return;
    const { id: _id, ...body } = form;
    await salvar.mutateAsync(body);
  }

  return (
    <div className="space-y-6">
      <AbasDaTela grupo="viagens" />
      <div>
        <h1 className="text-2xl font-bold">Quando perguntar se esqueceu de lançar</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Parceiro que fica sem lançar viagem num dia em que era esperado provavelmente esqueceu. Aqui você
          escolhe quando o sistema confere, o que conta como falta e quantas vezes no máximo ele pergunta.
        </p>
      </div>

      {cfg.data?.modo === "ENVIANDO" && cfg.data.ativo ? (
        <div className="flex items-start gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <Send className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Enviando de verdade.</strong> O sistema manda a pergunta pelo WhatsApp pra quem a regra
            apontar. Se o WhatsApp não estiver pronto, ele só registra e avisa aqui.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Só registrando: nada é enviado.</strong> O sistema anota quem seria perguntado, pra você
            conferir se a regra acerta antes de ligar o envio.
          </p>
        </div>
      )}

      <Card className="space-y-2 border-primary/40 bg-primary/5 p-5" data-testid="regra-em-vigor">
        <h2 className="text-base font-semibold">Regra em vigor</h2>
        <p className="max-w-prose text-sm leading-relaxed">{regraEmVigor}</p>
        <p className="text-xs text-muted-foreground">
          {form.ativo ? "Ligada" : "Desligada"} ·{" "}
          {form.modo === "ENVIANDO" ? "envia a pergunta pelo WhatsApp." : "só registra (nada é enviado)."}
          {alterado && " Você mudou o formulário — salve pra valer."}
        </p>
      </Card>

      <form onSubmit={submit} className="space-y-4">
        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Ligar a conferência</h2>
          <Field
            label="Conferência ligada"
            help="Nasce desligada. Ligada, o sistema confere todo dia quem provavelmente esqueceu de lançar."
          >
            <Toggle value={form.ativo} onChange={(v) => set("ativo", v)} disabled={!podeEditar} />
          </Field>
          <Field
            label="O que fazer com quem esqueceu"
            help="'Só registrar' anota quem seria perguntado, sem mandar nada — bom pra conferir se a regra acerta. 'Perguntar pelo WhatsApp' manda a pergunta com quatro botões de resposta."
          >
            <Select
              value={form.modo}
              onChange={(e) => set("modo", e.target.value as ConfigConferenciaDiaria["modo"])}
              disabled={!podeEditar}
              className="max-w-xs"
            >
              <option value="SOMBRA">Só registrar (não enviar nada)</option>
              <option value="ENVIANDO">Perguntar pelo WhatsApp</option>
            </Select>
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Quando roda</h2>
          <Field label="Hora (Brasília)">
            <Select
              value={String(form.horaEnvio)}
              onChange={(e) => set("horaEnvio", Number(e.target.value))}
              disabled={!podeEditar}
              className="max-w-[120px]"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dias da semana em que roda">
            <DiasChips valor={form.diasDoJob} onToggle={(d) => alternarDia("diasDoJob", d)} disabled={!podeEditar} />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">O que conta como esquecimento</h2>
          <Field label="Regra">
            <Select
              value={form.regra}
              onChange={(e) => set("regra", e.target.value as RegraConferenciaDiaria)}
              disabled={!podeEditar}
              className="max-w-md"
            >
              <option value="SEM_VIAGEM_NO_DIA_ANTERIOR">Não lançou viagem no dia esperado anterior</option>
              <option value="SEM_VIAGEM_HA_N_DIAS">Ficou vários dias esperados seguidos sem lançar</option>
            </Select>
          </Field>
          {form.regra === "SEM_VIAGEM_HA_N_DIAS" && (
            <Field label="Quantos dias esperados seguidos sem viagem">
              <NumInput value={form.diasSemViagem} onChange={(v) => set("diasSemViagem", v)} min={1} max={30} disabled={!podeEditar} />
            </Field>
          )}
          <Field label="Quais dias contam como dia de viagem">
            <Select
              value={modoDiasEsperados}
              onChange={(e) => escolherModoDias(e.target.value as ModoDias)}
              disabled={!podeEditar}
              className="max-w-xs"
            >
              <option value="UTEIS">Só dias úteis (segunda a sexta)</option>
              <option value="TODOS">Todos os dias</option>
              <option value="PERSONALIZADO">Personalizado</option>
            </Select>
            {modoDiasEsperados === "PERSONALIZADO" && (
              <div className="pt-2">
                <DiasChips valor={form.diasConsiderados} onToggle={(d) => alternarDia("diasConsiderados", d)} disabled={!podeEditar} />
              </div>
            )}
          </Field>
          <Field label="Ignorar feriados nacionais" help="Feriado nacional não conta como dia esperado. Estadual e municipal não entram nesta etapa.">
            <Toggle value={form.ignorarFeriados} onChange={(v) => set("ignorarFeriados", v)} disabled={!podeEditar} />
          </Field>
          <Field label="Incluir quem nunca lançou nenhuma viagem" help="Parceiro aprovado que ainda não lançou nada também entra na lista.">
            <Toggle value={form.incluirQueNuncaLancou} onChange={(v) => set("incluirQueNuncaLancou", v)} disabled={!podeEditar} />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Sem incomodar demais</h2>
          <Field
            label="Só perguntar a quem lançou viagem nos últimos (dias). 0 = todos"
            help="Quem está parado há mais tempo não recebe mensagem: aparece numa lista para o escritório decidir se ainda trabalha aqui. Protege o número de WhatsApp de mandar pergunta a quem já saiu."
          >
            <NumInput
              value={form.janelaAtividadeDias ?? 0}
              onChange={(v) => set("janelaAtividadeDias", v)}
              min={0}
              max={JANELA_ATIVIDADE_VALIDACAO_MAX_DIAS}
              disabled={!podeEditar}
            />
          </Field>
          <Field label="No máximo 1 pergunta a cada (dias)">
            <NumInput value={form.intervaloMinimoDias} onChange={(v) => set("intervaloMinimoDias", v)} min={1} max={30} disabled={!podeEditar} />
          </Field>
          <Field label="No máximo por semana (por parceiro)">
            <NumInput value={form.maxPerguntasPorSemana} onChange={(v) => set("maxPerguntasPorSemana", v)} min={1} max={7} disabled={!podeEditar} />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Quando o parceiro não responde</h2>
          <Field
            label="Mandar um lembrete"
            help="Um único lembrete, com a mesma pergunta e os mesmos botões. Não sai de madrugada nem pra quem já lançou viagem depois da pergunta."
          >
            <Toggle value={form.reenviar} onChange={(v) => set("reenviar", v)} disabled={!podeEditar} />
          </Field>
          {form.reenviar && (
            <>
              <Field label="Lembrar depois de quantas horas">
                <NumInput value={form.horasParaLembrar} onChange={(v) => set("horasParaLembrar", v)} min={1} max={48} disabled={!podeEditar} />
              </Field>
              <Field
                label="Lembrete só entre (hora inicial e final)"
                help="Fora desse intervalo o lembrete não sai. Horário de Brasília."
              >
                <div className="flex items-center gap-2">
                  <NumInput value={form.lembreteHoraMin} onChange={(v) => set("lembreteHoraMin", v)} min={0} max={23} disabled={!podeEditar} />
                  <span className="text-sm text-muted-foreground">h e</span>
                  <NumInput value={form.lembreteHoraMax} onChange={(v) => set("lembreteHoraMax", v)} min={1} max={24} disabled={!podeEditar} />
                  <span className="text-sm text-muted-foreground">h</span>
                </div>
              </Field>
            </>
          )}
          <Field
            label="Dar a pergunta por encerrada depois de quantas horas"
            help="Se ele responder depois, a resposta ainda vale."
          >
            <NumInput value={form.horasParaExpirar} onChange={(v) => set("horasParaExpirar", v)} min={2} max={72} disabled={!podeEditar} />
          </Field>
          <Field
            label="Cancelar a pergunta que não saiu depois de quantas horas"
            help="Se a pergunta não saiu no horário (por exemplo, o WhatsApp ficou fora do ar), ela ainda pode sair até essa hora depois. Passou disso, é cancelada e não sai mais. 0 = só na hora marcada."
          >
            <NumInput
              value={form.horasToleranciaEnvio}
              onChange={(v) => set("horasToleranciaEnvio", v)}
              min={0}
              max={TOLERANCIA_ENVIO_VALIDACAO_MAX_HORAS}
              disabled={!podeEditar}
            />
          </Field>
          <Field
            label="No máximo quantos reenvios ou testes por pergunta, por dia"
            help="Vale para o botão de reenviar e para a pergunta de teste na ficha do parceiro. Amanhã o limite zera."
          >
            <NumInput
              value={form.maxReenviosPorPergunta}
              onChange={(v) => set("maxReenviosPorPergunta", v)}
              min={1}
              max={MAX_REENVIOS_VALIDACAO_MAX}
              disabled={!podeEditar}
            />
          </Field>
          <Field
            label="Resumo das 20h"
            help="Quem recebeu a pergunta hoje não recebe o resumo genérico do dia (ele já conversou com a gente). Se tiver viagem sem peso ou com problema, o resumo sai do mesmo jeito."
          >
            <Toggle
              value={form.suprimirResumoQuemRecebeuPergunta}
              onChange={(v) => set("suprimirResumoQuemRecebeuPergunta", v)}
              disabled={!podeEditar}
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Quando ele pede pra parar</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            O botão &ldquo;Parar perguntas&rdquo; só corta esta pergunta, em todas as empresas em que ele
            trabalha — não desliga código de acesso nem aviso de viagem sem peso. Cada empresa é avisada aqui.
            A resposta abaixo é o que ele lê depois de tocar.
          </p>
          <Field label="Mensagem de orientação" help="Use {empresa} pro nome da empresa e {contato} pro contato abaixo. Deixe em branco pra usar o texto padrão.">
            <Textarea
              value={form.mensagemAoParar ?? ""}
              onChange={(e) => set("mensagemAoParar", e.target.value || null)}
              placeholder={MENSAGEM_AO_PARAR_PADRAO}
              rows={4}
              maxLength={600}
              disabled={!podeEditar}
            />
          </Field>
          <Field label="Como falar com a empresa" help="Telefone ou e-mail. Aparece no lugar de {contato}. Opcional.">
            <Input
              value={form.contatoEmpresa ?? ""}
              onChange={(e) => set("contatoEmpresa", e.target.value || null)}
              placeholder="ex.: (42) 99999-0000"
              maxLength={120}
              disabled={!podeEditar}
              className="max-w-sm"
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Lembrete dentro do app</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Quem pediu pra parar as perguntas no WhatsApp continua sabendo, pelo app, que viagem não lançada não
            entra no acerto. Quando o parceiro fica alguns dias esperados sem lançar, aparece um aviso discreto na
            tela inicial do app dele, com o botão &ldquo;Lançar viagem&rdquo; e a opção &ldquo;Agora não&rdquo;
            (que some só por aquele dia). O aviso desaparece assim que ele lança uma viagem. Só funciona com a
            conferência ativa (ligada lá em cima).
          </p>
          <Field label="Mostrar o lembrete no app" help="Desligado por padrão: nada muda no app dos parceiros até você ligar.">
            <Toggle value={form.lembreteNoApp} onChange={(v) => set("lembreteNoApp", v)} disabled={!podeEditar} />
          </Field>
          {form.lembreteNoApp && (
            <>
              <Field label="Pra quem">
                <Select
                  value={form.lembreteParaQuem}
                  onChange={(e) => set("lembreteParaQuem", e.target.value as LembreteAppParaQuem)}
                  disabled={!podeEditar}
                  className="max-w-xs"
                >
                  <option value="SO_QUEM_SAIU">Só quem pediu pra parar as perguntas</option>
                  <option value="TODOS_QUE_ATRASARAM">Todos que ficaram sem lançar</option>
                </Select>
              </Field>
              <Field
                label="Depois de quantos dias esperados sem lançar"
                help="Conta os mesmos dias esperados e feriados da regra acima."
              >
                <NumInput
                  value={form.diasParaLembreteNoApp}
                  onChange={(v) => set("diasParaLembreteNoApp", v)}
                  min={1}
                  max={30}
                  disabled={!podeEditar}
                />
              </Field>
              <div className="max-w-prose rounded-xl border bg-muted/40 p-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">O parceiro vai ver</p>
                <p className="mt-1 text-sm">{textoLembreteLancamento(form.diasParaLembreteNoApp)}</p>
              </div>
            </>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Número que parece não receber</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Se o WhatsApp de um parceiro deixa de entregar, o sistema para de perguntar a ele e te avisa pra
            contatar por outro meio. Não muda nada no cadastro dele.
          </p>
          <Field label="Mensagens seguidas sem entrega pra desconfiar">
            <NumInput value={form.mensagensParaSuspeitar} onChange={(v) => set("mensagensParaSuspeitar", v)} min={2} max={10} disabled={!podeEditar} />
          </Field>
          <Field label="Olhando os últimos (dias)">
            <NumInput value={form.diasParaSuspeitar} onChange={(v) => set("diasParaSuspeitar", v)} min={2} max={30} disabled={!podeEditar} />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Quem entra</h2>
          <p className="text-sm text-muted-foreground">
            Só é perguntado parceiro aprovado, com telefone, que aceita WhatsApp e não pediu pra parar. Quem não
            tem como receber continua sendo conferido e aparece na lista marcado como &ldquo;sem canal&rdquo;.
          </p>
          <Field label="Quais parceiros">
            <Select
              value={form.quemEntra}
              onChange={(e) => set("quemEntra", e.target.value as QuemEntraConferenciaDiaria)}
              disabled={!podeEditar}
              className="max-w-xs"
            >
              <option value="TODOS_APROVADOS">Todos</option>
              <option value="SO_MODALIDADES">Só algumas modalidades ou transportadoras</option>
            </Select>
          </Field>
          {form.quemEntra === "SO_MODALIDADES" && (
            <>
              <Field label="Modalidades">
                <ComboboxMulti
                  value={form.modalidadeIds}
                  onChange={(v) => set("modalidadeIds", v)}
                  options={(modalidades.data ?? []).map((m) => ({ value: m.id, label: m.nome }))}
                  loading={modalidades.isLoading}
                  placeholder="Nenhuma modalidade escolhida"
                />
              </Field>
              <Field label="Transportadoras">
                <ComboboxMulti
                  value={form.transportadoraIds}
                  onChange={(v) => set("transportadoraIds", v)}
                  options={(transportadoras.data ?? []).map((t) => ({ value: t.id, label: t.nome }))}
                  loading={transportadoras.isLoading}
                  placeholder="Nenhuma transportadora escolhida"
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                Entra quem estiver em qualquer uma das modalidades ou das transportadoras escolhidas.
              </p>
            </>
          )}
        </Card>

        {podeEditar && (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="success" disabled={salvar.isPending || !alterado}>
              <Save className="h-4 w-4" />
              {salvar.isPending ? "Salvando…" : "Salvar regra"}
            </Button>
          </div>
        )}
      </form>

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold">Quem seria perguntado hoje</h2>
        <p className="text-sm text-muted-foreground">
          Calcula agora, com a regra que está salva, e não grava nada.
          {alterado && " Você tem mudanças não salvas — salve antes pra simular com elas."}
        </p>
        {podeEditar && (
          <Button type="button" onClick={() => simular.mutate()} disabled={simular.isPending}>
            <Play className="h-4 w-4" />
            {simular.isPending ? "Simulando…" : "Simular agora"}
          </Button>
        )}
        {simulacao && (
          <div className="space-y-3">
            <ListaConferencia dados={simulacao} />
          </div>
        )}
      </Card>
    </div>
  );
}

function DiasChips({
  valor,
  onToggle,
  disabled,
}: {
  valor: number[];
  onToggle: (d: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DIAS.map((d) => {
        const on = valor.includes(d.n);
        return (
          <button
            key={d.n}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onToggle(d.n)}
            className={`h-9 min-w-[3rem] rounded-md border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
              on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
            }`}
          >
            {d.curto}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {help && <p className="max-w-prose text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  return (
    <Input
      type="number"
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
      min={min}
      max={max}
      disabled={disabled}
      className="max-w-[200px]"
    />
  );
}

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
        value ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          value ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
