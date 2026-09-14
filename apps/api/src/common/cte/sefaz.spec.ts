import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { lerCertificado, type Certificado } from "./assinatura";
import { ClienteSefaz, desembrulhar, enderecoDoServico } from "./sefaz";
import { validarContraXsd } from "./xsd";

/**
 * O cliente da SEFAZ é provado contra um servidor local que EXIGE certificado
 * de cliente — a mesma exigência que derruba a conexão com a SEFAZ de verdade
 * (conferido: ela anuncia a lista de ACs aceitas e fecha a conexão sem o A1).
 *
 * Isso prova tudo o que dá pra provar sem credenciamento: o certificado é
 * apresentado no handshake, o envelope SOAP está certo, o corpo é válido
 * segundo o XSD oficial, e a resposta é desembrulhada.
 */

const SENHA = "t";
let servidor: Server;
let base: string;
let cert: Certificado;
let pfx: Buffer;
let caServidor: Buffer;
/** O que o servidor recebeu — pra conferir o que foi realmente mandado. */
let ultimoCorpo = "";
let apresentouCertificado = false;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "sefaz-"));
  const p = (n: string) => join(dir, n);

  // Uma "raiz" própria que assina servidor e cliente — é o papel que a
  // ICP-Brasil faz de verdade.
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", p("ca.key"),
    "-out", p("ca.pem"), "-days", "2", "-subj", "/CN=RAIZ DE TESTE"], { stdio: "ignore" });

  for (const [nome, cn] of [["srv", "localhost"], ["cli", "TRANSPORTES AURORA LTDA:34238864000168"]]) {
    execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", p(`${nome}.key`),
      "-out", p(`${nome}.csr`), "-subj", `/CN=${cn}`], { stdio: "ignore" });
    execFileSync("openssl", ["x509", "-req", "-in", p(`${nome}.csr`), "-CA", p("ca.pem"),
      "-CAkey", p("ca.key"), "-CAcreateserial", "-out", p(`${nome}.pem`), "-days", "2"], { stdio: "ignore" });
  }
  execFileSync("openssl", ["pkcs12", "-export", "-out", p("cli.pfx"), "-inkey", p("cli.key"),
    "-in", p("cli.pem"), "-passout", `pass:${SENHA}`], { stdio: "ignore" });

  caServidor = readFileSync(p("ca.pem"));
  pfx = readFileSync(p("cli.pfx"));
  cert = lerCertificado(pfx, SENHA);

  servidor = createServer(
    {
      key: readFileSync(p("srv.key")),
      cert: readFileSync(p("srv.pem")),
      ca: caServidor,
      // A exigência que a SEFAZ faz: sem certificado de cliente, não atende.
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req, res) => {
      apresentouCertificado = Boolean(
        (req.socket as unknown as { getPeerCertificate?: () => { subject?: unknown } })
          .getPeerCertificate?.()?.subject,
      );
      const partes: Buffer[] = [];
      req.on("data", (d) => partes.push(d));
      req.on("end", () => {
        ultimoCorpo = Buffer.concat(partes).toString("utf8");
        const resposta =
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
          `<cteResultMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeStatusServicoV4">` +
          `<retConsStatServCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">` +
          `<tpAmb>2</tpAmb><verAplic>PR-4.00</verAplic><cStat>107</cStat>` +
          `<xMotivo>Servico em Operacao</xMotivo><cUF>41</cUF>` +
          `<dhRecbto>2026-09-14T10:00:00-03:00</dhRecbto>` +
          `</retConsStatServCTe></cteResultMsg></soap:Body></soap:Envelope>`;
        res.writeHead(200, { "content-type": "application/soap+xml" });
        res.end(resposta);
      });
    },
  );
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  base = `https://localhost:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => servidor?.close());

function cliente() {
  return new ClienteSefaz(cert, pfx, SENHA, [caServidor], base);
}

describe("endereços dos autorizadores", () => {
  it("o Paraná tem autorizador próprio, e homologação é outro endereço", () => {
    expect(enderecoDoServico("PR", "CTeStatusServicoV4", 2)).toBe(
      "https://homologacao.cte.fazenda.pr.gov.br/cte4/CTeStatusServicoV4",
    );
    expect(enderecoDoServico("PR", "CTeRecepcaoSincV4", 1)).toBe(
      "https://cte.fazenda.pr.gov.br/cte4/CTeRecepcaoSincV4",
    );
  });

  it("UF que ainda não sei atender diz isso, e diz quais eu sei", () => {
    // São 8 autorizadores no país; começamos pelo do primeiro cliente.
    expect(() => enderecoDoServico("SP", "CTeStatusServicoV4", 2)).toThrow(/Hoje o sistema fala com: PR/);
  });
});

describe("conversa com o serviço", () => {
  it("apresenta o certificado no handshake e lê a resposta", async () => {
    const r = await cliente().statusDoServico("PR", 2);
    expect(apresentouCertificado).toBe(true);
    expect(r.httpStatus).toBe(200);
    expect(r.cStat).toBe("107");
    expect(r.xMotivo).toBe("Servico em Operacao");
  });

  it("o corpo enviado é válido segundo o XSD oficial", async () => {
    await cliente().statusDoServico("PR", 2);
    const corpo = desembrulhar(ultimoCorpo).replace(
      /<cteDadosMsg[^>]*>|<\/cteDadosMsg>/g,
      "",
    );
    // Contra o schema do PEDIDO DE STATUS, não o do CT-e: cada mensagem tem o
    // seu, e usar o errado faria a conferência passar por acidente.
    const r = await validarContraXsd(`<?xml version="1.0" encoding="UTF-8"?>${corpo}`, {
      mensagem: "statusServico",
    });
    expect(r.erros.map((e) => e.mensagem)).toEqual([]);
    expect(corpo).toContain("<xServ>STATUS</xServ>");
  });

  it("o envelope é SOAP 1.2 com o namespace do serviço chamado", async () => {
    await cliente().statusDoServico("PR", 2);
    expect(ultimoCorpo).toContain("http://www.w3.org/2003/05/soap-envelope");
    expect(ultimoCorpo).toContain("wsdl/CTeStatusServicoV4");
    expect(ultimoCorpo).toContain("<cteDadosMsg");
  });

  it("sem apresentar certificado, o servidor recusa — como a SEFAZ faz", async () => {
    // A prova de que a exigência existe e de que é ela que estamos atendendo.
    const semCert = new ClienteSefaz(cert, Buffer.alloc(0), "", [caServidor], base);
    await expect(semCert.statusDoServico("PR", 2)).rejects.toThrow();
  });
});

describe("desembrulhar", () => {
  it("tira a casca do SOAP seja qual for o prefixo", () => {
    const x = desembrulhar(
      `<s:Envelope xmlns:s="x"><s:Body><retCTe versao="4.00"><cStat>100</cStat></retCTe></s:Body></s:Envelope>`,
    );
    expect(x).toBe('<retCTe versao="4.00"><cStat>100</cStat></retCTe>');
  });

  it("também tira a tag de resultado que alguns serviços acrescentam", () => {
    const x = desembrulhar(
      `<Envelope><Body><cteResultMsg><retCTe><cStat>100</cStat></retCTe></cteResultMsg></Body></Envelope>`,
    );
    expect(x).toBe("<retCTe><cStat>100</cStat></retCTe>");
  });
});
