"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { RequerTela } from "@/components/requer-tela";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EstadoVazio } from "@/components/estado-vazio";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { hojeSP } from "@/lib/datetime-br";
import { ComecarPonto, PATH, PrecisaFundamento, useConfigPonto } from "./_lib";

type LinhaDia = {
  funcionarioId: string;
  nome: string;
  cargo: string | null;
  marcacoes: { id: string; numeroRegistro: number; hora: string }[];
};

/**
 * O PONTO DO DIA: quem bateu, e quem não bateu.
 *
 * É a tela que o escritório abre de manhã, e o desenho serve a isso: uma
 * linha por pessoa, as batidas em ordem, e nada mais. Não diz "atrasado" nem
 * "faltou" — quem bateu às 8h10 numa jornada de 8h pode ter combinado isso, e
 * o julgamento é de gente. O que a tela faz é mostrar o fato.
 */
export default function PontoDiaPage() {
  return (
    <RequerTela chave="ponto.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const [data, setData] = useState(hojeSP);
  const config = useConfigPonto();

  const dia = useQuery({
    queryKey: [PATH, "dia", data],
    enabled: !!token,
    queryFn: () => fetchApi<{ data: string; linhas: LinhaDia[] }>(`${PATH}/dia?data=${data}`, { token }),
  });

  if (config.data && !config.data.fundamento) return <PrecisaFundamento />;

  const { temPermissao } = usePermissoes();
  const podeVerOnde = temPermissao("ponto.ver-localizacao");
  const [onde, setOnde] = useState<{ id: string; nome: string; hora: string } | null>(null);
  const linhas = dia.data?.linhas ?? [];
  const bateram = linhas.filter((l) => l.marcacoes.length > 0).length;

  return (
    <div className="space-y-4">
      <ComecarPonto />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Clock className="h-6 w-6 text-muted-foreground" />
            Ponto do dia
          </h1>
          <p className="text-sm text-muted-foreground">
            O que foi registrado hoje, na ordem em que aconteceu.
          </p>
        </div>
        <div>
          <Label htmlFor="ponto-dia">Dia</Label>
          <Input
            id="ponto-dia"
            type="date"
            className="w-44"
            value={data}
            max={hojeSP()}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
      </div>

      {linhas.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {bateram} de {linhas.length} registraram alguma batida.
        </p>
      )}

      {linhas.length === 0 ? (
        <EstadoVazio
          titulo="Ninguém cadastrado ainda"
          descricao="Cadastre quem bate ponto em Quem bate ponto."
        />
      ) : (
        <Card className="divide-y p-0">
          {linhas.map((l) => (
            <div key={l.funcionarioId} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-48 flex-1">
                <Link
                  href={`/ponto/espelho/${l.funcionarioId}`}
                  className="font-medium hover:underline"
                >
                  {l.nome}
                </Link>
                {l.cargo && <span className="block text-xs text-muted-foreground">{l.cargo}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {l.marcacoes.length === 0 ? (
                  <span className="text-sm text-muted-foreground">sem registro</span>
                ) : (
                  l.marcacoes.map((m) =>
                    podeVerOnde ? (
                      <button
                        key={m.id}
                        type="button"
                        title={`registro nº ${m.numeroRegistro} — ver onde`}
                        onClick={() => setOnde({ id: m.id, nome: l.nome, hora: m.hora })}
                        className="flex items-center gap-1 rounded border px-2 py-1 font-mono text-sm hover:bg-accent"
                      >
                        {m.hora}
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                      </button>
                    ) : (
                      <span
                        key={m.id}
                        title={`registro nº ${m.numeroRegistro}`}
                        className="rounded border px-2 py-1 font-mono text-sm"
                      >
                        {m.hora}
                      </span>
                    ),
                  )
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {onde && <OndeBateu marcacao={onde} onFechar={() => setOnde(null)} />}

      <p className="text-xs text-muted-foreground">
        A tela mostra a batida, não o julgamento: quem chegou 8h10 numa jornada de 8h pode ter
        combinado isso. Atraso e saldo aparecem no espelho, depois da apuração.
      </p>
    </div>
  );
}

/**
 * Onde a pessoa estava quando bateu.
 *
 * ⚠️ Busca sob demanda, uma batida por vez, e a busca deixa rastro no
 * histórico (`PONTO_VIU_LOCALIZACAO`). O dado não vem junto com a listagem
 * de propósito: localização de empregado que chega na tela sem ninguém pedir
 * é coleta exibida, não consulta.
 */
function OndeBateu({
  marcacao,
  onFechar,
}: {
  marcacao: { id: string; nome: string; hora: string };
  onFechar: () => void;
}) {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["ponto-localizacao", marcacao.id],
    enabled: !!token,
    // Sem cache: cada abertura é uma consulta, e cada consulta tem que ser
    // registrada. Servir do cache esconderia a segunda olhada.
    gcTime: 0,
    staleTime: 0,
    queryFn: () =>
      fetchApi<{
        numeroRegistro: number;
        localizacao: { latitude: number; longitude: number; precisao: number | null } | null;
      }>(`${PATH}/marcacoes/${marcacao.id}/localizacao`, { token }),
  });
  const loc = q.data?.localizacao;

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {marcacao.nome} — batida das {marcacao.hora}
          </DialogTitle>
        </DialogHeader>

        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Buscando…</p>
        ) : loc ? (
          <div className="space-y-3 text-sm">
            <p className="font-mono">
              {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
            </p>
            {loc.precisao != null && (
              <p className="text-muted-foreground">
                O aparelho informou margem de cerca de {loc.precisao} m. A coordenada é evidência
                do registro, não prova de endereço.
              </p>
            )}
            <a
              className="inline-block text-primary hover:underline"
              href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Abrir no mapa
            </a>
          </div>
        ) : (
          /* Não achar é NORMAL, e a tela precisa dizer por quê — senão vira
             suspeita sobre a pessoa. O GPS desiste em 3s, a permissão pode
             estar negada e a empresa pode ter desligado a coleta. */
          <p className="text-sm text-muted-foreground">
            Esta batida não tem localização guardada. Isso não invalida o registro: o aparelho
            pode estar sem sinal de GPS, sem a permissão concedida, ou a empresa pode ter
            desligado a coleta em Regras de ponto.
          </p>
        )}

        <p className="border-t pt-3 text-xs text-muted-foreground">
          Esta consulta ficou registrada no histórico com o seu nome.
        </p>
      </DialogContent>
    </Dialog>
  );
}
