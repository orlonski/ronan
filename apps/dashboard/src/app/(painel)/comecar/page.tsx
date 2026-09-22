"use client";

import { CheckCircle2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LinksLoja } from "@/components/links-loja";
import { LoadingCard } from "@/components/loading";
import { Barra, ListaDePassos, usePrimeirosPassos } from "@/components/primeiros-passos";
import { usePermissoes } from "@/lib/permissoes";

/**
 * O caminho até a primeira viagem, num lugar que não some.
 *
 * O card da home some quando o último passo fecha — o que é certo pra home e
 * errado pro produto: quem contrata um auxiliar em março não tem pra onde
 * mandá-lo, e quem dispensou a chegada no primeiro dia perdia a única bússola
 * que tinha. Aqui a lista fica, cumprida ou não.
 *
 * Sem permissão no menu, como a tela de Contrato: é a tela que explica o
 * caminho, e exigir uma chave pra vê-la calaria justamente quem ainda não tem
 * papel configurado. Os passos, esses sim, já vêm podados pelo que a pessoa
 * consegue fazer.
 */
export default function ComecarPage() {
  const { data, isLoading } = usePrimeirosPassos();
  const { temPermissao } = usePermissoes();

  const feitos = data?.passos.filter((p) => p.cumprido).length ?? 0;
  const total = data?.passos.length ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Começar</h1>
        <p className="text-sm text-muted-foreground">
          O caminho até a primeira viagem chegar no painel.
        </p>
      </header>

      {isLoading && <LoadingCard label="Carregando seu caminho..." />}

      {data && (
        <>
          {temPermissao("importacao.executar") && (
            <Card className="flex flex-wrap items-center gap-3 p-5">
              <Upload className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">O caminho mais curto: a sua planilha</p>
                <p className="text-sm text-muted-foreground">
                  Motoristas, caminhões, locais e até o histórico de viagens entram de uma vez,
                  com os valores. Subir de novo atualiza, não duplica.
                </p>
              </div>
              <Button asChild size="sm">
                <a href="/importacao">Importar planilha</a>
              </Button>
            </Card>
          )}

          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Primeiros passos</h2>
              <span className="text-sm text-muted-foreground">
                {feitos} de {total}
              </span>
            </div>
            <Barra feitos={feitos} total={total} />

            {data.concluido ? (
              <div className="flex items-start gap-3 rounded-md border border-emerald-600/30 bg-emerald-600/5 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                <div>
                  <p className="text-sm font-medium">Está tudo de pé.</p>
                  <p className="text-sm text-muted-foreground">
                    Seu caminho está completo. Esta tela fica aqui pra quando entrar gente nova
                    no time — é por ela que você começa a explicar.
                  </p>
                </div>
              </div>
            ) : null}

            <ListaDePassos passos={data.passos} />
          </Card>

          <Card className="space-y-3 p-5">
            <div>
              <h2 className="text-lg font-semibold">O app do motorista</h2>
              <p className="text-sm text-muted-foreground">
                É ele quem lança a viagem, na hora da carga — inclusive sem internet.
              </p>
            </div>
            <LinksLoja />
          </Card>
        </>
      )}
    </div>
  );
}
