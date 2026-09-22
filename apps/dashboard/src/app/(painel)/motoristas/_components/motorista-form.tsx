"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  cpfDigits,
  isCpfValid,
  isTelefoneValid,
  maskTelefone,
  telefoneDigits,
  REMUNERACAO_LABEL,
  TIPOS_REMUNERACAO,
  type TipoDocumentoMotorista,
  type TipoRemuneracaoTipo,
} from "@ronan/shared-types";
import {
  ModalidadeCombobox,
  modalidadeOption,
  TransportadoraCombobox,
  transportadoraOption,
} from "@/components/fk-comboboxes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateResource, useUpdateResource, useAuthToken, fetchApi } from "@/lib/client-api";
import { StatusToggle } from "@/components/status-toggle";
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";

type Veiculo = { id: string; placa: string; modelo: string | null };
type DocumentoResumo = { tipo: TipoDocumentoMotorista; validade: string | null };
export type Motorista = {
  id: string;
  nome: string;
  cpf: string;
  /**
   * Como esta pessoa é paga nesta empresa. Vem da listagem e da ficha.
   *
   * `null` é resposta de verdade e a mais comum: o registro só nasce com
   * alocação em obra ou com contratação. Opcional porque o formulário é
   * reaproveitado em telas que não pedem esse dado.
   */
  regime?: { tipo: "PARCEIRO" | "EMPREGADO"; desde: string } | null;
  telefone: string | null;
  email: string | null;
  ativo: boolean;
  transportadoraId: string | null;
  modalidadeId: string | null;
  modalidade?: { id: string; nome: string } | null;
  transportadora: { id: string; nome: string } | null;
  veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
  veiculos: Veiculo[];
  documentos: DocumentoResumo[];
  podeLancarViagem: boolean;
  podeIniciarViagem: boolean;
  podeViagemLifecycle: boolean;
  podeLancarPedagio: boolean;
  podeLancarAbastecimento: boolean;
  podeUsarOcrTicket: boolean;
  podeVerStories: boolean;
  podeVerValorDiaria: boolean;
  podeVerTodosLocais: boolean;
  podeReferenciaKm: boolean;
  podeTelemetria: boolean;
  podeChat: boolean;
  podeDiaria: boolean;
  receberResumoDiario: boolean;
  tipoRemuneracao: TipoRemuneracaoTipo | null;
  percentualFrete: string | null;
  valorPorViagem: string | null;
  valorPorTonelada: string | null;
  valorPorKm: string | null;
  valorDiaria: string | null;
  chavePix: string | null;
};

const PATH = "/admin/motoristas";

type PlacaRow = { placa: string; modelo: string };
type FormShape = {
  nome: string;
  cpf: string;
  senha: string;
  chavePix: string;
  /** "" = herda a régua da modalidade. */
  tipoRemuneracao: TipoRemuneracaoTipo | "";
  valorRemuneracao: string;
  valorDiaria: string;
  telefone: string;
  email: string;
  placas: PlacaRow[];
  transportadoraId: string | undefined;
  modalidadeId: string | undefined;
  /** Placa string (não id). Backend resolve. */
  placaDefault: string | null;
};

const empty: FormShape = {
  nome: "",
  cpf: "",
  senha: "",
  chavePix: "",
  tipoRemuneracao: "",
  valorRemuneracao: "",
  valorDiaria: "",
  telefone: "",
  email: "",
  placas: [],
  transportadoraId: undefined,
  modalidadeId: undefined,
  placaDefault: null,
};

const placaRegex = /^[A-Z]{3}-?\d[A-Z\d]\d{2}$/i;

/** "12,5" → 12.5. Vazio ou inválido → null. */
function parseValorBR(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

type Props = { initial?: Motorista; acessoPorRegras?: boolean };

type PreviaAcesso = {
  fonte: "COLUNAS" | "REGRAS";
  base: { perfilNome: string; via: "FIXADO" | "REGRA" | "PADRAO"; regraNome?: string } | null;
  efetivo: string[];
  jaExiste: boolean;
};

type AcessosState = {
  podeLancarViagem: boolean;
  podeIniciarViagem: boolean;
  podeViagemLifecycle: boolean;
  podeLancarPedagio: boolean;
  podeLancarAbastecimento: boolean;
  podeUsarOcrTicket: boolean;
  podeVerStories: boolean;
  podeVerValorDiaria: boolean;
  podeVerTodosLocais: boolean;
  podeReferenciaKm: boolean;
  podeTelemetria: boolean;
  podeChat: boolean;
  podeDiaria: boolean;
  receberResumoDiario: boolean;
};

export function MotoristaForm({ initial, acessoPorRegras = false }: Props) {
  const router = useRouter();
  const create = useCreateResource<Record<string, unknown>, Motorista>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, Motorista>(PATH, PATH);

  const [acessos, setAcessos] = useState<AcessosState>({
    podeLancarViagem: initial?.podeLancarViagem ?? true,
    podeIniciarViagem: initial?.podeIniciarViagem ?? true,
    podeViagemLifecycle: initial?.podeViagemLifecycle ?? false,
    podeLancarPedagio: initial?.podeLancarPedagio ?? true,
    podeLancarAbastecimento: initial?.podeLancarAbastecimento ?? true,
    podeUsarOcrTicket: initial?.podeUsarOcrTicket ?? true,
    podeVerStories: initial?.podeVerStories ?? true,
    // Nasce desligada: é o dono que decide mostrar dinheiro pro motorista.
    podeVerValorDiaria: initial?.podeVerValorDiaria ?? false,
    podeVerTodosLocais: initial?.podeVerTodosLocais ?? false,
    podeReferenciaKm: initial?.podeReferenciaKm ?? false,
    podeTelemetria: initial?.podeTelemetria ?? false,
    podeChat: initial?.podeChat ?? true,
    podeDiaria: initial?.podeDiaria ?? true,
    receberResumoDiario: initial?.receberResumoDiario ?? true,
  });
  const token = useAuthToken();
  const qc = useQueryClient();

  const acessosMutation = useMutation({
    mutationFn: (body: Partial<AcessosState>) =>
      fetchApi<AcessosState>(`${PATH}/${initial?.id}/acessos`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
  });
  function alterarAcesso(flag: keyof AcessosState, value: boolean) {
    setAcessos((a) => ({ ...a, [flag]: value }));
    if (initial) acessosMutation.mutate({ [flag]: value });
  }

  const temTelefone = !!initial?.telefone;
  const enviarResumo = useMutation({
    mutationFn: () =>
      fetchApi<{ enviado: boolean; motivo?: string }>(
        `${PATH}/${initial?.id}/enviar-resumo`,
        { method: "POST", token },
      ),
    onSuccess: (r) => {
      if (r.enviado) {
        toast.success("Resumo enviado", { description: `WhatsApp de ${initial?.nome ?? "motorista"}.` });
      } else {
        toast.error("Não enviado", { description: r.motivo ?? "Motivo desconhecido." });
      }
    },
    onError: (err: Error) => {
      toast.error("Falha ao enviar", { description: err.message });
    },
  });

  const [form, setForm] = useState<FormShape>(
    initial
      ? {
          nome: initial.nome,
          cpf: maskCpf(initial.cpf),
          senha: "",
          telefone: maskTelefone(initial.telefone ?? ""),
          email: initial.email ?? "",
          placas: initial.veiculos.map((v) => ({ placa: v.placa, modelo: v.modelo ?? "" })),
          transportadoraId: initial.transportadoraId ?? undefined,
          modalidadeId: initial.modalidadeId ?? undefined,
          chavePix: initial.chavePix ?? "",
          tipoRemuneracao: initial.tipoRemuneracao ?? "",
          valorRemuneracao:
            initial.percentualFrete ??
            initial.valorPorViagem ??
            initial.valorPorTonelada ??
            initial.valorPorKm ??
            "",
          valorDiaria: initial.valorDiaria ?? "",
          placaDefault: initial.veiculoDefault?.placa ?? null,
        }
      : empty,
  );

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo(form);
  useAvisarSeSujo(sujo);

  /**
   * O CPF já tem cadastro em OUTRA empresa?
   *
   * O mesmo motorista pode rodar pra mais de uma, e a senha é da PESSOA, não do
   * cadastro: ele entra em todas com a mesma. Então aqui a senha não é pedida —
   * inventar uma segunda deixaria uma delas parando de funcionar na primeira
   * troca. Onde mais ela tem cadastro não se diz: não é assunto de quem cadastra.
   */
  const [cpfEmOutraEmpresa, setCpfEmOutraEmpresa] = useState(false);
  /**
   * Ela usa o app — então isto aqui não é um cadastro, é um CONVITE.
   *
   * Quem está do outro lado com o app na mão decide se entra: o vínculo nasce
   * esperando o sim dela. Não existe "cadastrar aqui e convidar depois" — é a
   * mesma ação, e o formulário de sempre já a resolve.
   */
  const [usaOApp, setUsaOApp] = useState(false);
  const [erroValidacao, setErroValidacao] = useState<string | null>(null);
  const cpfDigitado = cpfDigits(form.cpf);
  useEffect(() => {
    if (initial || cpfDigitado.length !== 11 || !token) {
      setCpfEmOutraEmpresa(false);
      return;
    }
    let vivo = true;
    void fetchApi<{ existeEmOutraEmpresa: boolean; usaOApp: boolean }>(
      `${PATH}/checar-cpf?cpf=${cpfDigitado}`,
      { token },
    )
      .then((r) => {
        if (!vivo) return;
        setCpfEmOutraEmpresa(r.existeEmOutraEmpresa);
        setUsaOApp(r.usaOApp);
      })
      .catch(() => {
        // Falhou a checagem: mostra o campo de senha (comportamento de sempre).
        if (vivo) {
          setCpfEmOutraEmpresa(false);
          setUsaOApp(false);
        }
      });
    return () => {
      vivo = false;
    };
  }, [cpfDigitado, initial, token]);

  /**
   * "Vai entrar como…": com a empresa nas regras, quem cadastra não escolhe
   * acesso nenhum — o perfil sai das regras. Mostrar ANTES de salvar é o que
   * evita o "cadastrei e ele ficou sem nada" (ou com o que não devia).
   */
  const [previaAcesso, setPreviaAcesso] = useState<PreviaAcesso | null>(null);
  useEffect(() => {
    if (initial || !token) return;
    let vivo = true;
    const t = setTimeout(() => {
      void fetchApi<PreviaAcesso>("/admin/acesso-app/previa-cadastro", {
        method: "POST",
        token,
        body: JSON.stringify({
          cpf: cpfDigitado.length === 11 ? cpfDigitado : null,
          modalidadeId: form.modalidadeId ?? null,
          transportadoraId: form.transportadoraId ?? null,
        }),
      })
        .then((r) => vivo && setPreviaAcesso(r))
        // Sem a prévia o cadastro segue igual: é aviso, não trava.
        .catch(() => vivo && setPreviaAcesso(null));
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [initial, token, cpfDigitado, form.modalidadeId, form.transportadoraId]);

  /**
   * D5: registrado em carteira aqui? E este cadastro o pagaria por produção?
   * Perguntado enquanto se preenche, pra pedir o motivo ANTES de salvar.
   */
  const [vinculoEmprego, setVinculoEmprego] = useState<{
    registradoDesde: string | null;
    pagoPorProducao: boolean;
  } | null>(null);
  const [motivoRegistrado, setMotivoRegistrado] = useState("");
  useEffect(() => {
    if (!token || cpfDigitado.length !== 11) {
      setVinculoEmprego(null);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({
        cpf: cpfDigitado,
        ...(form.modalidadeId ? { modalidadeId: form.modalidadeId } : {}),
        ...(form.tipoRemuneracao ? { tipoRemuneracao: form.tipoRemuneracao } : {}),
      });
      void fetchApi<{ registradoDesde: string | null; pagoPorProducao: boolean }>(
        `${PATH}/vinculo-emprego?${qs}`,
        { token },
      )
        .then((r) => vivo && setVinculoEmprego(r))
        // Sem a resposta, o cadastro segue: o servidor confere de novo no salvar.
        .catch(() => vivo && setVinculoEmprego(null));
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [token, cpfDigitado, form.modalidadeId, form.tipoRemuneracao]);

  function addPlaca() {
    setForm((f) => ({ ...f, placas: [...f.placas, { placa: "", modelo: "" }] }));
  }
  function removePlaca(idx: number) {
    setForm((f) => {
      const removida = f.placas[idx]?.placa.toUpperCase();
      const novas = f.placas.filter((_, i) => i !== idx);
      const novoDefault =
        removida && f.placaDefault === removida ? null : f.placaDefault;
      return { ...f, placas: novas, placaDefault: novoDefault };
    });
  }
  function updatePlaca(idx: number, key: keyof PlacaRow, value: string) {
    setForm((f) => {
      const novas = f.placas.map((p, i) => (i === idx ? { ...p, [key]: value } : p));
      const original = f.placas[idx];
      let novoDefault = f.placaDefault;
      if (key === "placa" && original && f.placaDefault === original.placa.toUpperCase()) {
        novoDefault = value.toUpperCase();
      }
      return { ...f, placas: novas, placaDefault: novoDefault };
    });
  }
  function setDefault(placa: string) {
    setForm((f) => ({ ...f, placaDefault: placa.toUpperCase() }));
  }

  /**
   * Erro de validação era `alert()` do navegador: bloqueia a thread, não fica no
   * campo, não move o foco e some ao fechar — o usuário voltava pro formulário
   * sem saber qual dos vinte campos estava errado.
   */
  function reprovar(mensagem: string, idCampo?: string) {
    setErroValidacao(mensagem);
    if (idCampo) document.getElementById(idCampo)?.focus();
    else document.getElementById("mot-erro")?.scrollIntoView({ block: "center" });
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErroValidacao(null);
    const cpfDigitos = cpfDigits(form.cpf);
    if (!isCpfValid(cpfDigitos)) {
      return reprovar("CPF inválido. Confira os dígitos.", "mot-cpf");
    }
    const telDigitos = telefoneDigits(form.telefone);
    if (telDigitos && !isTelefoneValid(telDigitos)) {
      return reprovar("Telefone precisa ter DDD + número (10 ou 11 dígitos).", "mot-telefone");
    }
    const emailTrim = form.email.trim();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      return reprovar("E-mail inválido. Confira se tem @ e o domínio.", "mot-email");
    }
    const placasLimpas = form.placas
      .map((p) => ({ placa: p.placa.trim().toUpperCase(), modelo: p.modelo.trim() }))
      .filter((p) => p.placa !== "");
    for (const p of placasLimpas) {
      if (!placaRegex.test(p.placa)) {
        return reprovar(`Placa "${p.placa}" inválida. Use ABC1D23 (Mercosul) ou ABC1234 (antigo).`);
      }
    }
    const placasSet = new Set(placasLimpas.map((p) => p.placa));
    if (placasSet.size !== placasLimpas.length) {
      return reprovar("Tem placa repetida na lista. Remova a duplicada.");
    }
    let placaDefault = form.placaDefault;
    if (placaDefault && !placasSet.has(placaDefault)) placaDefault = null;
    if (!placaDefault && placasLimpas.length === 1) {
      placaDefault = placasLimpas[0]!.placa;
    }
    const placasPayload = placasLimpas.map((p) => ({
      placa: p.placa,
      modelo: p.modelo || undefined,
    }));

    // A régua própria do motorista vence a da modalidade, e é tudo-ou-nada: só
    // o campo do tipo escolhido vai, os outros vão null. Mandar os dois deixaria
    // valor órfão que reaparece se alguém trocar a régua depois.
    const valorRem = parseValorBR(form.valorRemuneracao);
    const remuneracao = {
      tipoRemuneracao: form.tipoRemuneracao || null,
      percentualFrete: form.tipoRemuneracao === "PERCENTUAL_FRETE" ? valorRem : null,
      valorPorViagem: form.tipoRemuneracao === "VALOR_POR_VIAGEM" ? valorRem : null,
      valorPorTonelada: form.tipoRemuneracao === "VALOR_POR_TONELADA" ? valorRem : null,
      valorPorKm: form.tipoRemuneracao === "VALOR_POR_KM" ? valorRem : null,
      valorDiaria: parseValorBR(form.valorDiaria),
      chavePix: form.chavePix.trim() || null,
      ...(motivoRegistrado.trim() ? { motivoPagamentoRegistrado: motivoRegistrado.trim() } : {}),
    };

    if (initial) {
      const body: Record<string, unknown> = {
        ...remuneracao,
        nome: form.nome,
        cpf: cpfDigitos,
        telefone: telDigitos || undefined,
        email: emailTrim || undefined,
        placas: placasPayload,
        transportadoraId: form.transportadoraId ?? null,
        modalidadeId: form.modalidadeId ?? null,
        placaDefault,
      };
      if (form.senha) body.novaSenha = form.senha;
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync({
        ...remuneracao,
        nome: form.nome,
        cpf: cpfDigitos,
        // Sem senha quando a pessoa já existe na plataforma — o backend pendura o
        // cadastro na identidade dela (e ignora qualquer senha mandada aqui).
        senha: cpfEmOutraEmpresa ? undefined : form.senha,
        telefone: telDigitos || undefined,
        email: emailTrim || undefined,
        placas: placasPayload,
        transportadoraId: form.transportadoraId ?? null,
        modalidadeId: form.modalidadeId ?? null,
        placaDefault,
      });
      if (usaOApp) {
        // Sem isto o admin "cadastra" e não encontra ninguém na lista: quem
        // ainda não aceitou vive na aba de convites, não entre os motoristas.
        toast.success("Convite enviado", {
          description:
            "Ele entra na sua equipe quando aceitar no app. Até lá, fica em “Convites enviados”.",
        });
        router.push("/motoristas?aceite=PENDENTE");
        return;
      }
    }
    router.push("/motoristas");
  }

  const saving = create.isPending || update.isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {erroValidacao && (
        <p
          id="mot-erro"
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {erroValidacao}
        </p>
      )}
      <Card className="space-y-4 p-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="mot-nome">Nome</Label>
            <Input
              id="mot-nome"
              required
              autoFocus
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mot-cpf">CPF (login)</Label>
            <Input
              id="mot-cpf"
              required
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={form.cpf}
              onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })}
            />
          </div>
          {cpfEmOutraEmpresa ? (
            <div className="space-y-2">
              <Label>Senha</Label>
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {usaOApp ? (
                  <>
                    Essa pessoa já usa o Movatruck, então isto aqui vira um{" "}
                    <strong>convite</strong>: ela recebe no app e entra na sua equipe quando
                    aceitar. Até lá ela não aparece na lista — fica em “Convites enviados”. O
                    nome, o celular e a senha são os dela.
                  </>
                ) : (
                  <>
                    Essa pessoa já tem cadastro na plataforma. Ela entra com a senha que já
                    tem — não precisa definir nenhuma aqui.
                  </>
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>{initial ? "Nova senha (opcional)" : "Senha"}</Label>
              <Input
                type="password"
                minLength={initial ? 0 : 6}
                required={!initial}
                value={form.senha}
                onChange={(e) => setForm({ ...form, senha: e.target.value })}
              />
              {initial ? (
                <p className="text-xs text-muted-foreground">
                  A senha é do motorista, não do cadastro: trocar aqui vale pra todas as
                  empresas em que ele roda.
                </p>
              ) : null}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="mot-telefone">Telefone</Label>
            <Input
              id="mot-telefone"
              inputMode="tel"
              placeholder="(00) 00000-0000"
              value={form.telefone}
              onChange={(e) => setForm({ ...form, telefone: maskTelefone(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mot-email">Email</Label>
            <Input
              id="mot-email"
              type="email"
              placeholder="motorista@email.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Transportadora</Label>
            <TransportadoraCombobox
              value={form.transportadoraId}
              onChange={(v) => setForm({ ...form, transportadoraId: v })}
              triggerClassName="sm:w-full"
              initialOption={
                initial?.transportadora
                  ? transportadoraOption(initial.transportadora)
                  : undefined
              }
            />
            <p className="text-xs text-muted-foreground">
              Transportadora dona do motorista — é ela que carimba cada viagem, pedágio e
              abastecimento que ele lança.{" "}
              {initial && !initial.transportadoraId
                ? "Ao definir agora, o histórico dele que ainda está sem dono é adotado."
                : "Trocar depois não muda o que ele já lançou."}
            </p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Modalidade</Label>
            <ModalidadeCombobox
              value={form.modalidadeId}
              onChange={(v) => setForm({ ...form, modalidadeId: v })}
              triggerClassName="sm:w-full"
              initialOption={
                initial?.modalidade ? modalidadeOption(initial.modalidade) : undefined
              }
            />
            <p className="text-xs text-muted-foreground">
              O vínculo dele (próprio, agregado, terceiro…). É o que decide quais fotos
              o app pede no abastecimento e como ele é pago. Sem modalidade, nada muda pra ele.
            </p>
          </div>
        </div>

        {vinculoEmprego?.registradoDesde && !vinculoEmprego.pagoPorProducao && (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Registrado em carteira aqui desde{" "}
            {new Date(vinculoEmprego.registradoDesde).toLocaleDateString("pt-BR", { timeZone: "UTC" })}. O
            cadastro de motorista serve pra ele dirigir e lançar viagem; o pagamento dele segue pela
            folha.
          </p>
        )}
        {vinculoEmprego?.pagoPorProducao && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p>
              <strong>Esta pessoa é registrada em carteira aqui</strong>, e este cadastro a paga por
              produção, como parceiro. Pode ser o caso (quem agrega fora do horário, por exemplo),
              mas precisa estar escrito: o motivo fica registrado.
            </p>
            <Textarea
              rows={2}
              value={motivoRegistrado}
              onChange={(e) => setMotivoRegistrado(e.target.value)}
              placeholder="Por que ele recebe por produção além da carteira"
              className="bg-background text-foreground"
            />
          </div>
        )}

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <Label className="text-base">Pagamento</Label>
            <p className="text-xs text-muted-foreground">
              Por padrão vale a regra da modalidade. Preencha aqui só se este motorista
              negociou diferente — é o caso comum com agregado.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="motoristaf-regra-deste-motorista">Regra deste motorista</Label>
              <Select id="motoristaf-regra-deste-motorista"
                value={form.tipoRemuneracao}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tipoRemuneracao: e.target.value as TipoRemuneracaoTipo | "",
                  })
                }
              >
                <option value="">Usar a regra da modalidade</option>
                {TIPOS_REMUNERACAO.map((t) => (
                  <option key={t} value={t}>
                    {REMUNERACAO_LABEL[t].nome}
                  </option>
                ))}
              </Select>
            </div>

            {form.tipoRemuneracao && REMUNERACAO_LABEL[form.tipoRemuneracao].campo && (
              <div className="space-y-2">
                <Label>
                  {form.tipoRemuneracao === "PERCENTUAL_FRETE"
                    ? "Porcentagem (%)"
                    : "Valor (R$)"}
                </Label>
                <Input
                  inputMode="decimal"
                  placeholder={form.tipoRemuneracao === "PERCENTUAL_FRETE" ? "ex: 12" : "ex: 120,00"}
                  value={form.valorRemuneracao}
                  onChange={(e) => setForm({ ...form, valorRemuneracao: e.target.value })}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="motoristaf-valor-da-diaria-r">Valor da diária (R$)</Label>
              <Input id="motoristaf-valor-da-diaria-r"
                inputMode="decimal"
                placeholder="herda da modalidade"
                value={form.valorDiaria}
                onChange={(e) => setForm({ ...form, valorDiaria: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chave-pix">Chave PIX</Label>
            <Input
              id="chave-pix"
              placeholder="CPF, telefone, e-mail ou chave aleatória"
              value={form.chavePix}
              onChange={(e) => setForm({ ...form, chavePix: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Aparece no acerto, na hora de pagar. Guardada exatamente como você digitar.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Placas</Label>
            <Button type="button" variant="outline" size="sm" onClick={addPlaca}>
              <Plus className="h-3.5 w-3.5" /> Adicionar placa
            </Button>
          </div>
          {form.placas.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
              Nenhuma placa cadastrada. Clique em &quot;Adicionar placa&quot; pra incluir.
            </p>
          ) : (
            <div className="space-y-2">
              {form.placas.map((p, idx) => {
                const placaUpper = p.placa.toUpperCase();
                const ehPadrao = placaUpper !== "" && form.placaDefault === placaUpper;
                return (
                  <div
                    key={idx}
                    className="flex items-start gap-2 rounded-md border bg-background p-2"
                  >
                    <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input
                        placeholder="ABC1D23"
                        value={p.placa}
                        maxLength={8}
                        onChange={(e) =>
                          updatePlaca(idx, "placa", e.target.value.toUpperCase())
                        }
                        className="font-mono"
                      />
                      <Input
                        placeholder="Modelo (opcional)"
                        value={p.modelo}
                        maxLength={80}
                        onChange={(e) => updatePlaca(idx, "modelo", e.target.value)}
                      />
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {form.placas.length > 1 && placaUpper && (
                        <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                          <input
                            type="radio"
                            name="placa-default"
                            checked={ehPadrao}
                            onChange={() => setDefault(placaUpper)}
                            className="h-3 w-3 accent-blue-600"
                          />
                          padrão
                        </label>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePlaca(idx)}
                        title="Remover placa"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Nas regras, os interruptores somem: quem manda é o perfil, e a
            diferença de uma pessoa só é exceção com motivo (card lá em cima). */}
        {initial && !acessoPorRegras && (
          <div className="space-y-3 border-t pt-4">
            <div>
              <Label className="text-base">Acessos do app</Label>
              <p className="text-xs text-muted-foreground">
                Cada toggle controla se o motorista vê o botão correspondente
                no app. Desligar não afeta histórico — ele continua vendo o
                que já lançou.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <AcessoRow
                label="Nova viagem"
                active={acessos.podeLancarViagem}
                onChange={(v) => alterarAcesso("podeLancarViagem", v)}
              />
              <AcessoRow
                label="Iniciar viagem com GPS"
                active={acessos.podeIniciarViagem}
                onChange={(v) => alterarAcesso("podeIniciarViagem", v)}
              />
              <AcessoRow
                label="Viagem guiada (início → eventos → fim)"
                active={acessos.podeViagemLifecycle}
                onChange={(v) => alterarAcesso("podeViagemLifecycle", v)}
              />
              <AcessoRow
                label="Lançar pedágio"
                active={acessos.podeLancarPedagio}
                onChange={(v) => alterarAcesso("podeLancarPedagio", v)}
              />
              <AcessoRow
                label="Lançar abastecimento"
                active={acessos.podeLancarAbastecimento}
                onChange={(v) => alterarAcesso("podeLancarAbastecimento", v)}
              />
              <AcessoRow
                label="Ler ticket com IA (OCR da foto)"
                active={acessos.podeUsarOcrTicket}
                onChange={(v) => alterarAcesso("podeUsarOcrTicket", v)}
              />
              <AcessoRow
                label="Stories (foto do trecho, estilo Instagram)"
                active={acessos.podeVerStories}
                onChange={(v) => alterarAcesso("podeVerStories", v)}
              />
              <AcessoRow
                label="Buscar todos os locais de descarga (por nome)"
                active={acessos.podeVerTodosLocais}
                onChange={(v) => alterarAcesso("podeVerTodosLocais", v)}
              />
              <AcessoRow
                label="Sugestão de km do trajeto (o que a frota já rodou)"
                active={acessos.podeReferenciaKm}
                onChange={(v) => alterarAcesso("podeReferenciaKm", v)}
              />
              <AcessoRow
                label="Telemetria de diagnóstico (grava o que ele buscou/selecionou na Nova viagem)"
                active={acessos.podeTelemetria}
                onChange={(v) => alterarAcesso("podeTelemetria", v)}
              />
              <AcessoRow
                label="Chat com os outros motoristas (aba Conversas no app)"
                active={acessos.podeChat}
                onChange={(v) => alterarAcesso("podeChat", v)}
              />
              <AcessoRow
                label="Escolher o modo de serviço no lançamento (diária). Desligue só pra quem não pode lançar diária — quando a empresa tem um modo só, o campo nem aparece pro motorista."
                active={acessos.podeDiaria}
                onChange={(v) => alterarAcesso("podeDiaria", v)}
              />
              <AcessoRow
                label="Ver em R$ quanto as diárias de obra do mês valem pra ele (tela Minhas diárias). Ligue só quando o combinado com ele for claro — o valor mostrado é o dele, nunca o que a obra paga."
                active={acessos.podeVerValorDiaria}
                onChange={(v) => alterarAcesso("podeVerValorDiaria", v)}
              />
            </div>

            <div className="border-t pt-4">
              <Label className="text-base">Resumo diário no WhatsApp</Label>
              <p className="text-xs text-muted-foreground">
                Toda noite às 20h, um resumo curto do dia dele (viagens, toneladas,
                km e pendências). Só envia se ele teve movimento ou tem pendência.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <AcessoRow
                  label="Receber resumo diário"
                  active={acessos.receberResumoDiario}
                  onChange={(v) => alterarAcesso("receberResumoDiario", v)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => enviarResumo.mutate()}
                  disabled={!temTelefone || enviarResumo.isPending}
                  title={temTelefone ? "Enviar o resumo agora pra testar" : "Motorista sem telefone"}
                >
                  <Send className="h-3.5 w-3.5" />
                  {enviarResumo.isPending ? "Enviando…" : "Enviar resumo agora"}
                </Button>
              </div>
              {!temTelefone && (
                <p className="mt-1 text-xs text-amber-600">
                  Cadastre um telefone pra poder enviar o resumo.
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      {!initial && previaAcesso?.fonte === "REGRAS" && !previaAcesso.jaExiste && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {previaAcesso.base ? (
            <>
              No app, ele entra no grupo{" "}
              <strong className="text-foreground">{previaAcesso.base.perfilNome}</strong>.
            </>
          ) : (
            <>Ele entra sem nenhum grupo: só o básico do app.</>
          )}{" "}
          Os grupos ficam em{" "}
          <Link href="/acesso-app" className="underline">
            Acesso ao app
          </Link>
          .
        </p>
      )}

      <div className="flex justify-end gap-2">
        <BotaoCancelar href="/motoristas" sujo={sujo} />
        <Button type="submit" disabled={saving}>
          {!initial && usaOApp ? "Enviar convite" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

function AcessoRow({
  label,
  active,
  onChange,
}: {
  label: string;
  active: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <StatusToggle active={active} onChange={onChange} size="sm" label />
    </div>
  );
}

