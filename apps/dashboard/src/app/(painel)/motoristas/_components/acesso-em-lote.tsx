"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CAPACIDADES_APP, type CapacidadeApp } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi, useAuthToken } from "@/lib/client-api";

export type PerfilOpcao = { id: string; nome: string; ativo: boolean };

// O que a empresa pode dar ou tirar pela ficha do MOTORISTA: o ponto mora no
// cadastro de funcionário, e ferramenta da plataforma não é da empresa.
const CAPACIDADES_LOTE = CAPACIDADES_APP.filter((c) => c.vinculo !== "FUNCIONARIO" && c.tipo !== "PLATAFORMA");

/**
 * A barra que aparece quando há motoristas marcados na lista: a mesma exceção
 * (ou o mesmo perfil fixado) pra todos, com UM motivo e UM recálculo.
 *
 * Só existe com a empresa nas regras — no espelho, a ficha de cada um manda.
 */
export function AcessoEmLote({
  selecionados,
  perfis,
  onLimpar,
}: {
  selecionados: string[];
  perfis: PerfilOpcao[];
  onLimpar: () => void;
}) {
  const [abrindo, setAbrindo] = useState<"excecao" | "fixar" | null>(null);
  if (selecionados.length === 0) return null;
  const n = selecionados.length;

  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3 shadow-sm">
      <span className="text-sm font-medium">
        {n === 1 ? "1 motorista marcado" : `${n} motoristas marcados`}
      </span>
      <span className="text-sm text-muted-foreground">· acesso ao app:</span>
      <Button size="sm" variant="outline" onClick={() => setAbrindo("excecao")}>
        Dar ou tirar um acesso
      </Button>
      <Button size="sm" variant="outline" onClick={() => setAbrindo("fixar")}>
        Fixar perfil
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onLimpar}>
        Desmarcar
      </Button>
      {abrindo === "excecao" && (
        <DialogExcecao ids={selecionados} onFechar={() => setAbrindo(null)} onFeito={onLimpar} />
      )}
      {abrindo === "fixar" && (
        <DialogFixar ids={selecionados} perfis={perfis} onFechar={() => setAbrindo(null)} onFeito={onLimpar} />
      )}
    </div>
  );
}

function useAplicar(onFeito: () => void, onFechar: () => void) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [salvando, setSalvando] = useState(false);
  async function aplicar(url: string, body: unknown, sucesso: (aplicadas: number) => string) {
    setSalvando(true);
    try {
      const r = await fetchApi<{ aplicadas: number }>(url, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      toast.success(sucesso(r.aplicadas));
      void qc.invalidateQueries();
      onFeito();
      onFechar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
  return { salvando, aplicar };
}

function DialogExcecao({ ids, onFechar, onFeito }: { ids: string[]; onFechar: () => void; onFeito: () => void }) {
  const [capacidade, setCapacidade] = useState<CapacidadeApp | "">("");
  const [efeito, setEfeito] = useState<"CONCEDER" | "NEGAR" | "">("");
  const [motivo, setMotivo] = useState("");
  const [ate, setAte] = useState("");
  const { salvando, aplicar } = useAplicar(onFeito, onFechar);
  const def = CAPACIDADES_LOTE.find((c) => c.chave === capacidade);
  const pronto = !!capacidade && !!efeito && motivo.trim().length >= 10;

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Acesso de {ids.length === 1 ? "1 motorista" : `${ids.length} motoristas`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>O quê</Label>
            <Select value={capacidade} onChange={(e) => setCapacidade(e.target.value as CapacidadeApp)}>
              <option value="">Escolha…</option>
              {CAPACIDADES_LOTE.map((c) => (
                <option key={c.chave} value={c.chave}>
                  {c.grupo} · {c.label}
                  {c.custa ? " (custa)" : ""}
                </option>
              ))}
            </Select>
            {def && <p className="mt-1 text-xs text-muted-foreground">{def.efeito}</p>}
          </div>
          <div>
            <Label>Pra eles</Label>
            {/* Sem pré-seleção: dar e tirar são opostos, e o padrão errado passa despercebido. */}
            <Select value={efeito} onChange={(e) => setEfeito(e.target.value as "CONCEDER" | "NEGAR")}>
              <option value="">Escolha…</option>
              <option value="CONCEDER">Dar, mesmo que o perfil não dê</option>
              <option value="NEGAR">Tirar, mesmo que o perfil dê</option>
            </Select>
          </div>
          <div>
            <Label>Motivo</Label>
            <Textarea
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Quem ler daqui a seis meses precisa entender por que eles são diferentes"
            />
          </div>
          <div>
            <Label>Vale até (opcional)</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">
              Sem data, vale até alguém tirar. Quem já tinha exceção nesse item fica com esta no lugar.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant={efeito === "NEGAR" ? "warning" : "default"}
            disabled={salvando || !pronto}
            onClick={() =>
              aplicar(
                "/admin/acesso-app/excecoes/lote",
                {
                  motoristaIds: ids,
                  capacidade,
                  efeito,
                  motivo,
                  expiraEm: ate ? new Date(`${ate}T23:59:59-03:00`).toISOString() : null,
                },
                (n) => `Pronto: ${n} pessoa(s). Chega no app na próxima vez que abrirem com sinal.`,
              )
            }
          >
            {efeito === "NEGAR" ? `Tirar de ${ids.length}` : `Dar pra ${ids.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SOLTAR = "__regras__";

export function DialogFixar({
  ids,
  perfis,
  titulo,
  onFechar,
  onFeito,
}: {
  ids: string[];
  perfis: PerfilOpcao[];
  titulo?: string;
  onFechar: () => void;
  onFeito: () => void;
}) {
  const [perfilId, setPerfilId] = useState("");
  const [motivo, setMotivo] = useState("");
  const { salvando, aplicar } = useAplicar(onFeito, onFechar);
  const soltar = perfilId === SOLTAR;

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo ?? `Perfil de ${ids.length === 1 ? "1 motorista" : `${ids.length} motoristas`}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Perfil fixado vence as regras: se amanhã a regra mudar, quem está fixado não muda junto.
            Use pra quem as regras não descrevem bem.
          </p>
          <div>
            <Label>Perfil</Label>
            <Select value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
              <option value="">Escolha…</option>
              {perfis
                .filter((p) => p.ativo)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              <option value={SOLTAR}>Nenhum: voltar a seguir as regras</option>
            </Select>
          </div>
          <div>
            <Label>Motivo</Label>
            <Textarea
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por que as regras não servem pra eles"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant="warning"
            disabled={salvando || !perfilId || motivo.trim().length < 10}
            onClick={() =>
              aplicar(
                "/admin/acesso-app/fixar",
                { motoristaIds: ids, perfilId: soltar ? null : perfilId, motivo },
                (n) => (soltar ? `${n} pessoa(s) voltaram a seguir as regras.` : `Perfil fixado em ${n} pessoa(s).`),
              )
            }
          >
            {ids.length === 1
              ? soltar
                ? "Voltar às regras"
                : "Fixar perfil"
              : soltar
                ? `Devolver ${ids.length} às regras`
                : `Fixar em ${ids.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
