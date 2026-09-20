"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import Link from "next/link";
import { RequerTela } from "@/components/requer-tela";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EstadoVazio } from "@/components/estado-vazio";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { PATH, PrecisaFundamento, useConfigPonto } from "./_lib";

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

  const linhas = dia.data?.linhas ?? [];
  const bateram = linhas.filter((l) => l.marcacoes.length > 0).length;

  return (
    <div className="space-y-4">
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
                  l.marcacoes.map((m) => (
                    <span
                      key={m.id}
                      title={`registro nº ${m.numeroRegistro}`}
                      className="rounded border px-2 py-1 font-mono text-sm"
                    >
                      {m.hora}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        A tela mostra a batida, não o julgamento: quem chegou 8h10 numa jornada de 8h pode ter
        combinado isso. Atraso e saldo aparecem no espelho, depois da apuração.
      </p>
    </div>
  );
}
