"use client";

import { AlertTriangle, CheckCircle2, Clock, Instagram, PauseCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiQuery, useAuthToken, fetchApi, apiBaseUrl } from "@/lib/client-api";
import { NovoPost } from "./_components/novo-post";
import { usePermissoes } from "@/lib/permissoes";
import { Button } from "@/components/ui/button";
import { RequerTela } from "@/components/requer-tela";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";

type Post = {
  id: string;
  peca: string;
  legenda: string;
  status: string;
  publicarEm: string | null;
  publicadoEm: string | null;
  permalink: string | null;
  tentativas: number;
  erro: string | null;
  erroCodigo: number | null;
  criadoEm: string;
  criadoPor: { nome: string } | null;
};

type Estado = {
  credencialConfigurada: boolean;
  modoSombra: boolean;
  ativo: boolean;
  maxPorDia: number;
  publicadosUltimas24h: number;
};

const APARENCIA: Record<string, { rotulo: string; classe: string }> = {
  RASCUNHO: { rotulo: "Rascunho", classe: "bg-muted text-muted-foreground" },
  AGENDADO: { rotulo: "Agendado", classe: "bg-blue-100 text-blue-800" },
  PUBLICANDO: { rotulo: "Publicando", classe: "bg-amber-100 text-amber-900" },
  PUBLICADO: { rotulo: "Publicado", classe: "bg-green-100 text-green-800" },
  FALHOU: { rotulo: "Falhou", classe: "bg-red-100 text-red-800" },
  CANCELADO: { rotulo: "Cancelado", classe: "bg-muted text-muted-foreground" },
  INDETERMINADO: { rotulo: "Indeterminado", classe: "bg-orange-100 text-orange-900" },
  DESCARTADA: { rotulo: "Descartado", classe: "bg-muted text-muted-foreground" },
};

export default function MarketingPage() {
  return (
    <RequerTela chave="marketing.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const { temPermissao } = usePermissoes();
  const { data: estado } = useApiQuery<Estado>("/admin/marketing/instagram/estado", {
    refetchInterval: 30_000,
  });
  const { data: posts, isLoading } = useApiQuery<Post[]>("/admin/marketing/instagram", {
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Instagram className="h-6 w-6" />
          Instagram da Movatruck
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A fila de posts do @movatruck. É a plataforma divulgando a si mesma — nada aqui sai no
          perfil de cliente nenhum.
        </p>
      </div>

      {estado ? <Estado estado={estado} /> : null}

      {temPermissao("marketing.criar") ? <NovoPost apiUrl={apiBaseUrl} /> : null}

      <Card className="divide-y">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
        ) : !posts || posts.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            Nenhum post na fila. Eles entram pela API, junto da arte já em JPEG.
          </p>
        ) : (
          posts.map((p) => <Linha key={p.id} post={p} />)
        )}
      </Card>
    </div>
  );
}

/**
 * O estado dos dois interruptores.
 *
 * São independentes de propósito: a credencial diz que dá pra publicar, e o
 * "ativo" diz que pode. Mostrar os dois separados evita a pergunta "por que
 * nada sai?" quando um está ligado e o outro não.
 */
function Estado({ estado }: { estado: Estado }) {
  const parado = !estado.credencialConfigurada || !estado.ativo;
  const { temPermissao } = usePermissoes();
  const token = useAuthToken();
  const qc = useQueryClient();

  const alternar = useMutation({
    mutationFn: (ativo: boolean) =>
      fetchApi("/admin/marketing/instagram/config", {
        method: "PATCH",
        body: JSON.stringify({ ativo }),
        token,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["/admin/marketing/instagram/estado"] }),
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Indicador
          ok={estado.credencialConfigurada}
          rotulo="Credencial da Meta"
          sim="configurada"
          nao="ausente (INSTAGRAM_ACCESS_TOKEN)"
        />
        <Indicador ok={estado.ativo} rotulo="Publicação" sim="ligada" nao="desligada" />
        <div className="text-sm">
          <span className="text-muted-foreground">Hoje: </span>
          <span className="font-medium tabular-nums">
            {estado.publicadosUltimas24h} de {estado.maxPorDia}
          </span>
        </div>

        {temPermissao("marketing.publicar") ? (
          <Button
            className="ml-auto"
            variant={estado.ativo ? "outline" : "default"}
            disabled={alternar.isPending || (!estado.ativo && !estado.credencialConfigurada)}
            onClick={() => alternar.mutate(!estado.ativo)}
          >
            {alternar.isPending
              ? "Salvando…"
              : estado.ativo
                ? "Desligar publicação"
                : "Ligar publicação"}
          </Button>
        ) : null}
      </div>

      {alternar.isError ? (
        <p className="mt-3 text-sm text-red-700">
          {(alternar.error as Error).message}
        </p>
      ) : null}

      {estado.modoSombra && estado.credencialConfigurada ? (
        <p className="mt-4 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Modo sombra.</strong> O post é montado na Meta e não é publicado — serve pra ver
            a integração funcionando sem nada aparecer no feed. Desligue com{" "}
            <code className="rounded bg-amber-100 px-1">INSTAGRAM_MODO_SOMBRA=false</code>.
          </span>
        </p>
      ) : null}

      {parado ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Enquanto os dois não estiverem ligados, os posts ficam na fila esperando — nada é perdido.
        </p>
      ) : null}
    </Card>
  );
}

function Indicador({
  ok,
  rotulo,
  sim,
  nao,
}: {
  ok: boolean;
  rotulo: string;
  sim: string;
  nao: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : (
        <XCircle className="h-4 w-4 text-muted-foreground" />
      )}
      <span className="text-muted-foreground">{rotulo}:</span>
      <span className="font-medium">{ok ? sim : nao}</span>
    </div>
  );
}

function Linha({ post }: { post: Post }) {
  const ap = APARENCIA[post.status] ?? { rotulo: post.status, classe: "bg-muted" };
  const quando = post.publicadoEm ?? post.publicarEm;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{post.peca}</span>
          <Badge className={ap.classe}>{ap.rotulo}</Badge>
          {post.tentativas > 1 ? (
            <span className="text-xs text-muted-foreground">{post.tentativas} tentativas</span>
          ) : null}
        </div>

        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.legenda}</p>

        {post.erro ? (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {post.erro}
              {post.erroCodigo ? ` (código ${post.erroCodigo})` : ""}
            </span>
          </p>
        ) : null}

        {post.status === "INDETERMINADO" ? (
          <p className="mt-2 text-sm text-orange-800">
            O processo caiu no meio da publicação e não dá pra saber se o post saiu. Não vai
            retentar sozinho: a reconciliação da madrugada pergunta à Meta e decide.
          </p>
        ) : null}
      </div>

      <div className="shrink-0 text-right text-sm">
        {quando ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="tabular-nums">{fmtDataHoraBR(quando)}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">sem hora marcada</span>
        )}
        {post.permalink ? (
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-primary underline-offset-2 hover:underline"
          >
            ver no Instagram
          </a>
        ) : null}
      </div>
    </div>
  );
}
