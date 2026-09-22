"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LinksLoja } from "@/components/links-loja";
import {
  Barra,
  CAMINHO_PRIMEIROS_PASSOS,
  ListaDePassos,
  Ofertas,
  contar,
  type Passo,
} from "@/components/primeiros-passos";
import { fetchApi, useAuthToken } from "@/lib/client-api";

/**
 * A primeira tela de quem acabou de criar a conta.
 *
 * É CONTEÚDO DE PÁGINA, não modal: quem chega precisa poder ler, sair pra
 * cadastrar e voltar, e um diálogo por cima disso só atrapalha. A home inteira
 * de uma conta nova é uma grade de números zerados, e zero não ensina nada —
 * então aqui os números dão lugar ao caminho, e voltam assim que houver o quê
 * contar.
 *
 * Quem decide se isto aparece é a home (ver `page.tsx`): conta crua, pessoa que
 * não dispensou, e ninguém da plataforma visitando.
 */
export function Chegada({
  passos,
  ofertas,
  onVerPainel,
}: {
  passos: Passo[];
  ofertas: Passo[];
  /** Quem esconde a chegada é a home, que é quem tem os números pra mostrar
   *  no lugar. Guardar esse estado aqui dentro deixaria a tela em branco. */
  onVerPainel: () => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();

  const dispensar = useMutation({
    mutationFn: () =>
      fetchApi<void>("/admin/onboarding/dispensar", { method: "POST", token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [CAMINHO_PRIMEIROS_PASSOS] }),
  });

  const { feitos, total } = contar(passos);

  return (
    <div className="space-y-6">
      <Card className="space-y-5 p-6">
        <div className="space-y-1">
          {/* Sem saudação aqui: o cabeçalho da página logo acima já diz
              "Olá, Fulano", e cumprimentar duas vezes na mesma tela soa como
              e-mail de mala direta. O título diz o que fazer. */}
          <h2 className="text-xl font-semibold tracking-tight">Comece por aqui</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            O motorista lança a viagem pelo celular, na hora da carga, e ela chega aqui pronta
            pra você conferir e fechar o mês. Estes são os passos até a primeira.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Primeiros passos
            </h3>
            <span className="text-sm text-muted-foreground">
              {feitos} de {total}
            </span>
          </div>
          <Barra feitos={feitos} total={total} />
          <ListaDePassos passos={passos} />
          <Ofertas itens={ofertas} />
        </div>

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Mande o app pro motorista</p>
          <LinksLoja />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        {/* Só esconde os blocos desta sessão. Não persiste nada: ver os números
            zerados uma vez não é uma decisão que mereça ser lembrada. */}
        <Button variant="outline" size="sm" onClick={onVerPainel}>
          Ver o painel mesmo assim
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={dispensar.isPending}
          onClick={() => dispensar.mutate()}
        >
          Já entendi, tirar isto da home
        </Button>
        <span className="text-xs text-muted-foreground">
          O caminho completo continua em <strong>Começar</strong>, no menu.
        </span>
      </div>
    </div>
  );
}

