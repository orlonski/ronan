"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { PATH, useConfigPonto } from "../_lib";

/**
 * AS REGRAS DE PONTO da empresa — e, antes de tudo, o fundamento.
 *
 * ⚠️ O bloco "O que este módulo não faz" fica NA TELA, não num contrato que
 * ninguém lê. O cliente precisa saber, antes de vender internamente, que isto
 * não é REP-P certificado e que depende do acordo coletivo dele. Descobrir
 * isso numa fiscalização seria descobrir tarde.
 */
export default function ConfigPontoPage() {
  return (
    <RequerTela chave="config-ponto.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const config = useConfigPonto();

  const [form, setForm] = useState({
    razaoSocial: "",
    cnpj: "",
    fundamentoReferencia: "",
    temFundamento: false,
    diaFechamento: 30,
    identificacaoRep: "",
    diasRetencaoLocalizacao: 90,
    mesesAcessoAposDesligamento: 12,
    avisoLgpdTexto: "",
  });

  useEffect(() => {
    const c = config.data;
    if (!c) return;
    setForm({
      razaoSocial: c.razaoSocial,
      cnpj: c.cnpj,
      fundamentoReferencia: c.fundamentoReferencia ?? "",
      temFundamento: c.fundamento === "ACORDO_COLETIVO",
      diaFechamento: c.diaFechamento,
      identificacaoRep: c.identificacaoRep,
      diasRetencaoLocalizacao: c.diasRetencaoLocalizacao,
      mesesAcessoAposDesligamento: c.mesesAcessoAposDesligamento,
      avisoLgpdTexto: c.avisoLgpdTexto,
    });
  }, [config.data]);

  const salvar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/config`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          razaoSocial: form.razaoSocial,
          cnpj: form.cnpj.replace(/\D/g, ""),
          fundamento: form.temFundamento ? "ACORDO_COLETIVO" : undefined,
          fundamentoReferencia: form.fundamentoReferencia || undefined,
          diaFechamento: form.diaFechamento,
          identificacaoRep: form.identificacaoRep,
          diasRetencaoLocalizacao: form.diasRetencaoLocalizacao,
          mesesAcessoAposDesligamento: form.mesesAcessoAposDesligamento,
          avisoLgpdTexto: form.avisoLgpdTexto,
        }),
      }),
    onSuccess: () => {
      toast.success("Regras salvas.");
      void qc.invalidateQueries({ queryKey: [PATH, "config"] });
    },
    onError: (e: Error) => toast.error("Não consegui salvar", { description: e.message }),
  });

  const podeEditar = temPermissao("config-ponto.editar");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <SlidersHorizontal className="h-6 w-6 text-muted-foreground" />
          Regras de ponto
        </h1>
        <p className="text-sm text-muted-foreground">
          Como o controle de jornada desta empresa funciona.
        </p>
      </div>

      <Card className="space-y-3 p-4">
        <div>
          <p className="font-medium">Por que o controle desta empresa vale</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            O registro por aplicativo, sem equipamento certificado, depende de previsão em
            convenção ou acordo coletivo da categoria. Sem isso as telas de cadastro, jornada e
            fechamento ficam fechadas — mas a marcação pelo app nunca é bloqueada.
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            disabled={!podeEditar}
            checked={form.temFundamento}
            onChange={(e) => setForm({ ...form, temFundamento: e.target.checked })}
          />
          <span>
            Existe convenção ou acordo coletivo prevendo o controle eletrônico de jornada nesta
            empresa.
          </span>
        </label>
        {form.temFundamento && (
          <div>
            <Label htmlFor="cfg-ref">Qual acordo</Label>
            <Input
              id="cfg-ref"
              disabled={!podeEditar}
              placeholder="ex: CCT SINDIPETRO 2026/2027, cláusula 14"
              value={form.fundamentoReferencia}
              onChange={(e) => setForm({ ...form, fundamentoReferencia: e.target.value })}
            />
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <p className="font-medium">O empregador no comprovante</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="cfg-razao">Razão social</Label>
            <Input
              id="cfg-razao"
              disabled={!podeEditar}
              value={form.razaoSocial}
              onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="cfg-cnpj">CNPJ</Label>
            <Input
              id="cfg-cnpj"
              disabled={!podeEditar}
              value={form.cnpj}
              onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              O do estabelecimento, que pode não ser o do cadastro comercial.
            </p>
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <p className="font-medium">Competência e privacidade</p>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label htmlFor="cfg-fech">Dia de fechamento</Label>
            <Input
              id="cfg-fech"
              type="number"
              min={1}
              max={31}
              disabled={!podeEditar}
              value={form.diaFechamento}
              onChange={(e) => setForm({ ...form, diaFechamento: Number(e.target.value) })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Não muda depois que uma competência é fechada: o mês seguinte ficaria com dias fora
              de qualquer competência.
            </p>
          </div>
          <div>
            <Label htmlFor="cfg-ret">Guardar a localização por (dias)</Label>
            <Input
              id="cfg-ret"
              type="number"
              min={0}
              max={180}
              disabled={!podeEditar}
              value={form.diasRetencaoLocalizacao}
              onChange={(e) =>
                setForm({ ...form, diasRetencaoLocalizacao: Number(e.target.value) })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              0 = não guarda nenhuma. Depois do prazo, some sozinha — o registro de ponto fica.
            </p>
          </div>
          <div>
            <Label htmlFor="cfg-acesso">Acesso após desligamento (meses)</Label>
            <Input
              id="cfg-acesso"
              type="number"
              min={1}
              max={60}
              disabled={!podeEditar}
              value={form.mesesAcessoAposDesligamento}
              onChange={(e) =>
                setForm({ ...form, mesesAcessoAposDesligamento: Number(e.target.value) })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Por quanto tempo quem saiu ainda abre o próprio espelho.
            </p>
          </div>
        </div>
      </Card>

      {/* ⚠️ Na tela, não no contrato. O cliente precisa saber os limites antes
          de vender isto internamente — descobrir na fiscalização é tarde. */}
      <Card className="space-y-2 border-amber-500/40 bg-amber-500/5 p-4">
        <p className="font-medium">O que este módulo não faz</p>
        <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            Não é REP-P certificado. Não gera AFD nem AEJ, e não tem Atestado Técnico — por isso o
            controle depende do seu acordo coletivo.
          </li>
          <li>
            Não calcula hora extra, adicional noturno, DSR nem banco de horas. Entrega horas
            trabalhadas, previstas e saldo; o cálculo da folha é de quem faz a folha.
          </li>
          <li>Não integra com eSocial.</li>
          <li>
            Não substitui o controle de quem não usa o aplicativo: quem não tem celular precisa do
            lançamento do escritório, com motivo escrito.
          </li>
        </ul>
      </Card>

      {podeEditar && (
        <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending ? "Salvando…" : "Salvar regras"}
        </Button>
      )}
    </div>
  );
}
