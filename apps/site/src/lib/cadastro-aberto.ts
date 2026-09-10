import { useEffect, useState } from "react";
import { API_URL } from "./api";

/**
 * O cadastro pelo site está aberto?
 *
 * O site é estático e não tem como saber sozinho. Sem perguntar, ele ofereceria
 * "criar conta grátis" com a porta fechada — e a pessoa só descobriria depois
 * de preencher o formulário inteiro, que é o pior momento possível.
 *
 * Enquanto a resposta não chega, devolve `null`: quem usa deve mostrar o
 * caminho do WhatsApp, que funciona sempre. Piscar um botão que some é pior do
 * que ele aparecer um instante depois.
 */
/**
 * Uma consulta por carregamento de página, não uma por componente.
 *
 * Três lugares perguntam a mesma coisa (topo, hero e chamada final), e sem isto
 * seriam três requisições idênticas — o dobro em desenvolvimento, por causa do
 * StrictMode. A promessa é guardada aqui e reaproveitada.
 */
let emVoo: Promise<{ aberto: boolean; dias: number }> | null = null;

function consultar(): Promise<{ aberto: boolean; dias: number }> {
  emVoo ??= fetch(`${API_URL}/publico/cadastro/aberto`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { aberto?: boolean; diasTesteGratis?: number } | null) => ({
      aberto: d?.aberto ?? false,
      dias: d?.diasTesteGratis ?? 14,
    }))
    .catch(() => {
      // API fora do ar não pode quebrar o site institucional: fica no caminho
      // do WhatsApp, que não depende de nada.
      emVoo = null; // deixa tentar de novo numa próxima montagem
      return { aberto: false, dias: 14 };
    });
  return emVoo;
}

export function useCadastroAberto(): { aberto: boolean | null; dias: number } {
  const [estado, setEstado] = useState<{ aberto: boolean | null; dias: number }>({
    aberto: null,
    dias: 14,
  });

  useEffect(() => {
    let vivo = true;
    void consultar().then((r) => {
      if (vivo) setEstado(r);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return estado;
}
