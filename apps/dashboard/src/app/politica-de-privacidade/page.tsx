import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — Schaba",
  description:
    "Política de privacidade do app e painel Schaba — tracking de viagens em logística B2B.",
};

export default function PoliticaPrivacidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800">
      <header className="mb-8 border-b pb-6">
        <h1 className="text-3xl font-bold text-slate-900">Política de Privacidade</h1>
        <p className="mt-2 text-sm text-slate-500">
          Última atualização: 6 de maio de 2026
        </p>
      </header>

      <section className="space-y-8 text-base leading-relaxed">
        <P>
          Esta política descreve como o aplicativo <strong>Schaba</strong> e o
          painel web <strong>Schaba</strong> tratam dados pessoais e operacionais
          dos motoristas e operadores que utilizam o sistema. O Schaba é uma
          ferramenta de uso interno empresarial, fornecida por uma transportadora
          aos seus motoristas para registro e rastreamento de viagens
          comerciais.
        </P>

        <H2>1. Quais dados coletamos</H2>
        <P>
          <strong>Dados de cadastro do motorista:</strong> nome, telefone, login,
          veículo associado.
        </P>
        <P>
          <strong>Dados das viagens:</strong> data, ticket, toneladas
          transportadas, quilometragem, material, obra de origem e destino,
          observações, foto do ticket de pesagem, valor de pedágio (opcional).
        </P>
        <P>
          <strong>Localização (GPS):</strong>
        </P>
        <Bullets>
          <li>
            <strong>Ponto de lançamento:</strong> latitude e longitude no momento
            em que o motorista registra cada viagem.
          </li>
          <li>
            <strong>Trajeto (opcional):</strong> sequência de pontos GPS captados
            durante a viagem quando o motorista ativa a função &quot;Iniciar
            viagem com GPS&quot;. A captura ocorre apenas durante o tracking
            ativo e é interrompida ao finalizar a viagem.
          </li>
          <li>
            <strong>Posição de busca de endereço:</strong> usada apenas em tempo
            real para priorizar resultados próximos no autocomplete de endereços.
            Não é armazenada.
          </li>
        </Bullets>
        <P>
          <strong>Pedágios:</strong> data, praça de pedágio, valor pago, veículo
          utilizado.
        </P>

        <H2>2. Para que usamos seus dados</H2>
        <Bullets>
          <li>
            Operação interna da transportadora (controle de viagens, conferência
            com clientes, fechamento mensal).
          </li>
          <li>
            Cálculo da quilometragem oficial entre pontos de carga e descarga,
            usando serviços de roteamento (OSRM auto-hospedado / OpenStreetMap).
          </li>
          <li>
            Comprovação do trajeto efetuado para fins de cobrança e auditoria.
          </li>
          <li>
            Geração de planilhas de fechamento enviadas às empresas-cliente
            contratantes da transportadora.
          </li>
        </Bullets>

        <H2>3. Quem tem acesso</H2>
        <Bullets>
          <li>
            <strong>Operadora da transportadora</strong> (perfil ADMIN/OPERADOR):
            acesso completo a todas as viagens dos motoristas vinculados.
          </li>
          <li>
            <strong>O próprio motorista</strong> (perfil MOTORISTA): acesso
            apenas às próprias viagens e pedágios.
          </li>
          <li>
            <strong>Empresa-cliente contratante:</strong> acesso indireto, apenas
            aos dados consolidados em planilha mensal exportada pela
            transportadora (toneladas, datas, tickets, quilometragem).
          </li>
        </Bullets>

        <H2>4. Compartilhamento com terceiros</H2>
        <P>
          Não compartilhamos dados pessoais com terceiros para fins
          publicitários, comerciais ou de análise externa.
        </P>
        <P>
          Os seguintes serviços são utilizados estritamente para funcionamento
          técnico:
        </P>
        <Bullets>
          <li>
            <strong>Google Maps Platform</strong> (Places API e Maps SDK): usado
            para autocomplete de endereços e renderização de mapas. Apenas a
            consulta de busca e a posição GPS no momento da consulta são
            enviadas, sem identificação do motorista.
          </li>
          <li>
            <strong>OpenStreetMap / OSRM</strong> (servidor próprio): usado para
            cálculo de rota. Recebe apenas as coordenadas de origem e destino,
            sem nenhum dado do motorista.
          </li>
          <li>
            <strong>Expo / EAS</strong>: plataforma de distribuição do aplicativo
            (atualizações via OTA). Não recebe dados pessoais nem de viagens.
          </li>
        </Bullets>

        <H2>5. Localização em segundo plano</H2>
        <P>
          Quando o motorista ativa a função <strong>&quot;Iniciar viagem com
          GPS&quot;</strong>, o app captura a localização em segundo plano (com
          o app fechado ou bloqueado) durante toda a duração da viagem. Isto
          requer a permissão Android &quot;Permitir o tempo todo&quot; ou iOS
          &quot;Sempre permitir&quot;.
        </P>
        <P>
          A captura é interrompida automaticamente quando o motorista toca em
          &quot;Finalizar viagem&quot; ou descarta o tracking. Os pontos
          capturados são armazenados localmente no celular até serem enviados ao
          servidor da transportadora junto com o registro da viagem.
        </P>
        <P>
          O motorista pode revogar essa permissão a qualquer momento nas
          configurações do sistema operacional. Sem ela, o tracking deixa de
          funcionar mas o aplicativo segue operacional para registro manual.
        </P>

        <H2>6. Armazenamento</H2>
        <P>
          Todos os dados ficam armazenados em servidor próprio da transportadora
          (não em serviços de terceiros). Backups são feitos pela própria
          transportadora.
        </P>
        <P>
          Fotos de tickets ficam armazenadas em sistema de objetos
          auto-hospedado (MinIO).
        </P>

        <H2>7. Tempo de retenção</H2>
        <P>
          Os dados ficam armazenados enquanto o vínculo entre o motorista e a
          transportadora estiver ativo, e por até 5 (cinco) anos após o
          encerramento, para fins de auditoria fiscal e contábil exigidos por
          legislação brasileira.
        </P>

        <H2>8. Seus direitos (LGPD)</H2>
        <P>
          De acordo com a Lei Geral de Proteção de Dados Pessoais (Lei
          13.709/2018), você pode solicitar a qualquer momento:
        </P>
        <Bullets>
          <li>Confirmação de existência de tratamento de dados pessoais;</li>
          <li>Acesso aos dados;</li>
          <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>Anonimização, bloqueio ou eliminação de dados desnecessários;</li>
          <li>Portabilidade dos dados a outro fornecedor de serviço;</li>
          <li>Eliminação dos dados pessoais tratados com seu consentimento.</li>
        </Bullets>
        <P>
          Para exercer qualquer um desses direitos, entre em contato pelo email
          abaixo.
        </P>

        <H2>9. Segurança</H2>
        <P>
          Dados em trânsito são criptografados via HTTPS/TLS. Senhas são
          armazenadas com hash bcrypt. Tokens de autenticação ficam armazenados
          de forma segura (SecureStore no app, cookies HttpOnly no painel web).
        </P>

        <H2>10. Crianças e adolescentes</H2>
        <P>
          O Schaba é uma ferramenta corporativa destinada exclusivamente a
          motoristas profissionais maiores de 18 anos vinculados a empresas
          transportadoras. Não coletamos dados de menores de idade.
        </P>

        <H2>11. Alterações nesta política</H2>
        <P>
          Esta política pode ser atualizada periodicamente. Quando houver
          alterações relevantes, comunicaremos via aplicativo e/ou painel.
        </P>

        <H2>12. Contato</H2>
        <P>
          Para dúvidas, solicitações ou exercício de direitos previstos na LGPD,
          entre em contato com a transportadora responsável pelo seu vínculo, ou
          pelo email:{" "}
          <a
            href="mailto:contato@schaba.com.br"
            className="text-blue-600 underline"
          >
            contato@schaba.com.br
          </a>
          .
        </P>
      </section>
    </main>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 text-xl font-semibold text-slate-900">{children}</h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function Bullets({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6">{children}</ul>;
}
