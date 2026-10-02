"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat } from "lucide-react";
import { UNIDADE_PEDIDO_LABEL, type UnidadePedidoTipo } from "@ronan/shared-types";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Solicitacao = {
  id: string;
  data: string;
  quantidade: string;
  unidade: UnidadePedidoTipo;
  observacao: string | null;
  criadoEm: string;
  cliente: { id: string; nome: string; empresa: { nome: string } };
  encarregado: { nome: string; telefone: string };
  material: { nome: string } | null;
  pedidosDaObra: {
    id: string;
    numero: number;
    unidade: UnidadePedidoTipo;
    material: string | null;
    restante: string | null;
  }[];
};

type MotoristaOpcao = { id: string; nome: string; veiculoDefault: { id: string; placa: string } | null };

function diaBR(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function qtd(s: Solicitacao): string {
  const n = Number(s.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return `${n} ${UNIDADE_PEDIDO_LABEL[s.unidade]}`;
}

/**
 * Os pedidos de caminhão que as obras fizeram pelo portal. Ficam aqui, na
 * programação, porque é aqui que se decide quem vai: confirmar programa as
 * viagens no dia pedido (sem publicar — o motorista só é avisado no Publicar).
 */
export function PedidosDasObras({
  motoristas,
  onProgramou,
}: {
  motoristas: MotoristaOpcao[];
  onProgramou: (dia: string) => void;
}) {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["solicitacoes-obra", "PENDENTE"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Solicitacao[]>("/admin/solicitacoes-obra?status=PENDENTE", { token: token! }),
  });

  if (!q.data || q.data.length === 0) return null;

  return (
    <Card className="space-y-3 border-l-4 border-l-blue-500 p-4">
      <div>
        <p className="flex items-center gap-2 font-semibold">
          <HardHat className="h-4 w-4" /> Pedidos das obras ({q.data.length})
        </p>
        <p className="text-sm text-muted-foreground">
          O encarregado pediu pelo celular. Confirme pra programar, ou recuse dizendo o porquê — a obra lê a resposta.
        </p>
      </div>
      <ul className="space-y-2">
        {q.data.map((s) => (
          <ItemSolicitacao key={s.id} s={s} motoristas={motoristas} onProgramou={onProgramou} />
        ))}
      </ul>
    </Card>
  );
}

function ItemSolicitacao({
  s,
  motoristas,
  onProgramou,
}: {
  s: Solicitacao;
  motoristas: MotoristaOpcao[];
  onProgramou: (dia: string) => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [modo, setModo] = React.useState<"ver" | "confirmar" | "recusar">("ver");
  const [pedidoId, setPedidoId] = React.useState(s.pedidosDaObra.length === 1 ? s.pedidosDaObra[0]!.id : "");
  const [viagens, setViagens] = React.useState(s.unidade === "VIAGENS" ? String(Math.round(Number(s.quantidade))) : "");
  const [motoristaId, setMotoristaId] = React.useState("");
  const [janela, setJanela] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  async function enviar(acao: "confirmar" | "recusar") {
    if (!token) return;
    setErro(null);
    let body: Record<string, unknown>;
    if (acao === "confirmar") {
      const n = Number(viagens);
      if (!Number.isInteger(n) || n < 1) return setErro("Diga quantas viagens programar.");
      const m = motoristas.find((x) => x.id === motoristaId);
      body = {
        pedidoId: pedidoId || null,
        viagens: n,
        motoristaId: motoristaId || null,
        veiculoId: m?.veiculoDefault?.id ?? null,
        janelaInicio: janela || null,
      };
    } else {
      if (motivo.trim().length < 3) return setErro("Diga o motivo — a obra vai ler.");
      body = { motivo: motivo.trim() };
    }
    setOcupado(true);
    try {
      await fetchApi(`/admin/solicitacoes-obra/${s.id}/${acao}`, { token, method: "POST", body: JSON.stringify(body) });
      await qc.invalidateQueries({ queryKey: ["solicitacoes-obra"] });
      // `data` vem como ISO completo (DateTime @db.Date): o quadro quer só o dia.
      if (acao === "confirmar") onProgramou(s.data.slice(0, 10));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="font-medium">
            {s.cliente.nome} <span className="font-normal text-muted-foreground">· {s.cliente.empresa.nome}</span>
          </p>
          <p>
            <span className="font-semibold">{qtd(s)}</span>
            {s.material ? ` de ${s.material.nome}` : ""} pra <span className="font-semibold">{diaBR(s.data)}</span>
          </p>
          <p className="text-xs text-muted-foreground">Pedido por {s.encarregado.nome} (encarregado)</p>
          {s.observacao && <p className="mt-1 text-xs italic text-muted-foreground">“{s.observacao}”</p>}
        </div>
        {modo === "ver" && (
          <Permitido chave="programacao.editar">
            <div className="flex gap-2">
              <Button size="sm" variant="success" onClick={() => setModo("confirmar")}>
                Confirmar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setModo("recusar")}>
                Recusar
              </Button>
            </div>
          </Permitido>
        )}
      </div>

      {modo === "confirmar" && (
        <div className="space-y-3 rounded-md bg-muted/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`sol-ped-${s.id}`}>Encaixar no pedido</Label>
              <Select id={`sol-ped-${s.id}`} value={pedidoId} onChange={(e) => setPedidoId(e.target.value)}>
                <option value="">Criar pedido novo com o que a obra pediu</option>
                {s.pedidosDaObra.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.numero}
                    {p.material ? ` · ${p.material}` : ""}
                    {p.restante != null ? ` · faltam ${p.restante} ${UNIDADE_PEDIDO_LABEL[p.unidade]}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`sol-via-${s.id}`}>Quantas viagens programar</Label>
              <Input
                id={`sol-via-${s.id}`}
                inputMode="numeric"
                value={viagens}
                onChange={(e) => setViagens(e.target.value.replace(/\D/g, ""))}
                placeholder={s.unidade === "TONELADAS" ? "Ex.: 3" : undefined}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`sol-mot-${s.id}`}>Motorista (opcional)</Label>
              <Select id={`sol-mot-${s.id}`} value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)}>
                <option value="">Decidir depois no quadro</option>
                {motoristas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                    {m.veiculoDefault ? ` · ${m.veiculoDefault.placa}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`sol-jan-${s.id}`}>A partir de (opcional)</Label>
              <Input id={`sol-jan-${s.id}`} type="time" value={janela} onChange={(e) => setJanela(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            As viagens entram no quadro de {diaBR(s.data)} sem publicar: o motorista só fica sabendo no Publicar.
          </p>
          {erro && <p className="text-sm text-red-700">{erro}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => setModo("ver")}>
              Voltar
            </Button>
            <Button size="sm" variant="success" disabled={ocupado} onClick={() => enviar("confirmar")}>
              Confirmar e programar
            </Button>
          </div>
        </div>
      )}

      {modo === "recusar" && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <Label htmlFor={`sol-mot-rec-${s.id}`}>Por que não dá? (a obra vai ler)</Label>
          <Input
            id={`sol-mot-rec-${s.id}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: sem caminhão livre nesse dia — podemos no dia seguinte."
            maxLength={300}
          />
          {erro && <p className="text-sm text-red-700">{erro}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => setModo("ver")}>
              Voltar
            </Button>
            <Button size="sm" variant="destructive" disabled={ocupado} onClick={() => enviar("recusar")}>
              Recusar pedido
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
