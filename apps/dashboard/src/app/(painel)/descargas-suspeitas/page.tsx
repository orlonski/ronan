"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type LocalRef = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  distanciaMetros: number | null;
};

type Suspeita = {
  viagemId: string;
  ticket: string;
  data: string;
  motorista: { id: string; nome: string } | null;
  bloqueada: boolean;
  localAtual: LocalRef | null;
  sugestao: LocalRef;
};

type Resposta = {
  raioInicialM: number;
  total: number;
  itens: Suspeita[];
};

const PATH = "/admin/viagens/descargas-suspeitas";

function fmtData(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function fmtDist(m: number | null): string {
  return m == null ? "sem coordenadas" : `${m}m do GPS`;
}

export default function DescargasSuspeitasPage() {
  const { data: session } = useSession();
  const token = useAuthToken();
  const qc = useQueryClient();
  const [ignorados, setIgnorados] = useState<Set<string>>(new Set());

  const perfil = session?.user?.perfil;
  const podeVer = perfil === "ADMIN" || perfil === "OPERADOR";

  const lista = useQuery({
    queryKey: [PATH, token],
    enabled: !!token && podeVer,
    queryFn: () => fetchApi<Resposta>(PATH, { token }),
  });

  const corrigir = useMutation({
    mutationFn: (v: { viagemId: string; localDescargaId: string }) =>
      fetchApi(`/admin/viagens/${v.viagemId}`, {
        method: "PATCH",
        body: JSON.stringify({ localDescargaId: v.localDescargaId }),
        token,
      }),
    onSuccess: (_data, v) => {
      toast.success("Local de descarga corrigido.");
      setIgnorados((s) => new Set(s).add(v.viagemId));
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
    onError: (err) => {
      toast.error("Não foi possível corrigir", {
        description: (err as Error).message,
      });
    },
  });

  function ignorar(viagemId: string) {
    setIgnorados((s) => new Set(s).add(viagemId));
  }

  if (!podeVer) {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">Acesso restrito.</p>
      </div>
    );
  }

  const itens = (lista.data?.itens ?? []).filter((i) => !ignorados.has(i.viagemId));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Revisar descargas suspeitas</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Viagens onde o GPS do motorista no lançamento ficou longe do local de
          descarga escolhido, mas existe outro local cadastrado bem mais perto —
          provável engano do raio de busca antigo (maior). A sugestão é o local
          mais próximo do GPS real (dentro de {lista.data?.raioInicialM ?? 50}m).
          Confira e corrija uma a uma; nada muda sem você clicar.
        </p>
      </div>

      {lista.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}

      {lista.isError && (
        <p className="text-sm text-destructive">
          Erro ao carregar: {(lista.error as Error).message}
        </p>
      )}

      {lista.data && (
        <p className="text-sm text-muted-foreground">
          {itens.length === 0
            ? "Nenhuma descarga suspeita no momento. 🎉"
            : `${itens.length} ${itens.length === 1 ? "viagem" : "viagens"} pra revisar` +
              (lista.data.total > lista.data.itens.length
                ? ` (mostrando ${lista.data.itens.length} de ${lista.data.total})`
                : "")}
        </p>
      )}

      <div className="space-y-3">
        {itens.map((s) => (
          <Card key={s.viagemId} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">Ticket {s.ticket}</span>
                  <span className="text-muted-foreground">· {fmtData(s.data)}</span>
                  {s.motorista && (
                    <span className="text-muted-foreground">· {s.motorista.nome}</span>
                  )}
                  {s.bloqueada && (
                    <Badge className="border-amber-400 text-amber-600">No fechamento</Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-destructive" />
                    <span>
                      <span className="text-muted-foreground">Atual:</span>{" "}
                      <span className="font-medium">
                        {s.localAtual ? s.localAtual.nome : "—"}
                      </span>
                      {s.localAtual && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({s.localAtual.cidade}/{s.localAtual.uf}) ·{" "}
                          {fmtDist(s.localAtual.distanciaMetros)}
                        </span>
                      )}
                    </span>
                  </div>

                  <ArrowRight className="h-4 w-4 text-muted-foreground" />

                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-success" />
                    <span>
                      <span className="text-muted-foreground">Sugerido:</span>{" "}
                      <span className="font-medium">{s.sugestao.nome}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        ({s.sugestao.cidade}/{s.sugestao.uf}) ·{" "}
                        {fmtDist(s.sugestao.distanciaMetros)}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link href={`/viagens/${s.viagemId}`} target="_blank">
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="mr-1.5 h-4 w-4" />
                    Abrir
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={() => ignorar(s.viagemId)}>
                  Ignorar
                </Button>
                <Button
                  size="sm"
                  disabled={s.bloqueada || corrigir.isPending}
                  onClick={() =>
                    corrigir.mutate({
                      viagemId: s.viagemId,
                      localDescargaId: s.sugestao.id,
                    })
                  }
                  title={
                    s.bloqueada
                      ? "Viagem já vinculada a fechamento — desfaça o match primeiro"
                      : undefined
                  }
                >
                  Trocar p/ sugerido
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
