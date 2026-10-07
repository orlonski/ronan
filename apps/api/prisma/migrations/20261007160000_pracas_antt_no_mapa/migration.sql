-- Completa o mapa de praças (até aqui só OpenStreetMap) com as praças das
-- concessões federais que a ANTT publica e o mapa não tinha — quase todas de
-- concessões novas (Rota Verde Goiás, Nova 381, EPR Paraná, RioSP, Via Brasil).
-- Fonte: ANTT, Dados Abertos, conjunto 'praca-de-pedagio' (CSV de 28/07/2026),
-- licença Creative Commons Atribuição. Ver common/tag-pedagio/antt-pracas.ts.
--
-- Ficaram de fora, de propósito:
--  * praça com coordenada arredondada (2 casas, até 1 km de erro: a detecção
--    de "praça na rota" usa 150 m) — Itaguaí e Paraty (RJ);
--  * praça a até 8 km de uma que o mapa já tem: provavelmente a MESMA com a
--    coordenada diferente, e duas viram pedágio em dobro na rota do app.
--    A trava abaixo (NOT EXISTS a ~8 km) repete essa regra no banco, então
--    a migration é idempotente e não duplica em ambiente que já tenha a praça.
-- Rodovia só com o número na ANTT (lotes do Paraná) vai com as duas siglas.

INSERT INTO "pedagios_rodovia" ("id", "nome", "concessionaria", "rodovia", "cidade", "uf", "lat", "lng", "ativo", "fonte", "alteradoEm")
SELECT gen_random_uuid()::text, v.nome, v.concessionaria, v.rodovia, v.cidade, v.uf, v.lat, v.lng, true, 'antt', CURRENT_TIMESTAMP
FROM (VALUES
  ('P01 FREEFLOW SANTA LUCIA - NORTE (Epr Iguaçu) — BR-163 km 154,0', 'EPR IGUAÇU', 'BR-163', 'Santa Lúcia', 'PR', -25.359202, -53.575788),
  ('P9 FREEFLOW VITORINO (Epr Iguaçu) — PR-280 km 234,3', 'EPR IGUAÇU', 'PR-280;BR-280', 'Vitorino', 'PR', -26.204017, -52.845956),
  ('P8 FREEFLOW AMPERE (Epr Iguaçu) — PR-182 km 517,4', 'EPR IGUAÇU', 'PR-182;BR-182', 'Ampére', 'PR', -25.988737, -53.382903),
  ('Free Flow Jataizinho - P08 Decrescente (Epr Paraná) — BR-369 km 126,0', 'EPR PARANÁ', 'BR-369', 'Jataizinho', 'PR', -23.283089, -50.9555),
  ('P07 QUATIGUÁ (Litoral Pioneiro) — PR-092 km 286,74', 'LITORAL PIONEIRO', 'PR-092;BR-092', 'Siqueira Campos', 'PR', -24.643739, -49.840669),
  ('P02 SENGES (Litoral Pioneiro) — PR-151 km 187,7', 'LITORAL PIONEIRO', 'PR-151;BR-151', 'Sengés', 'PR', -24.123056, -49.543889),
  ('FREE FLOW P2 MAUÁ DA SERRA (Motiva Paraná) — BR-376 km 294,8', 'MOTIVA PARANÁ', 'BR-376', 'Mauá da Serra', 'PR', -23.905773, -51.199273),
  ('Free Flow Pimenta Bueno2 - P07 (Nova 364) — BR-364 km 122,2', 'NOVA 364', 'BR-364', 'Pimenta Bueno', 'RO', -12.110803, -60.746925),
  ('Free Flow Belo Oriente - P04 (Nova 381) — BR-381 km 227,5', 'NOVA 381', 'BR-381', 'Belo Oriente', 'MG', -19.348242, -42.433175),
  ('Free Flow Caeté - P01 (Nova 381) — BR-381 km 411,85', 'NOVA 381', 'BR-381', 'Caeté', 'MG', -19.743897, -43.615283),
  ('Free Flow Jaguaraçú - P03 (Nova 381) — BR-381 km 280,15', 'NOVA 381', 'BR-381', 'Jaguaraçu', 'MG', -19.609967, -42.766233),
  ('Free Flow João Monlevade - P02 (Nova 381) — BR-381 km 342,27', 'NOVA 381', 'BR-381', 'João Monlevade', 'MG', -19.853947, -43.132689),
  ('Free Flow Governador Valadares - P05 (Nova 381) — BR-381 km 176,55', 'NOVA 381', 'BR-381', 'Governador Valadares', 'MG', -19.028744, -42.147708),
  ('Free Flow Mangaratiba (Riosp) — BR-101 km 447,3', 'RIOSP', 'BR-101', 'Mangaratiba', 'RJ', -23.00632, -44.099135),
  ('Free Flow PFE004 - PFS003 Sul (Riosp) — BR-116 km 227,0', 'RIOSP', 'BR-116', 'São Paulo', 'SP', -23.497507, -46.560039),
  ('Free Flow PFE005 - BAIRRO Norte (Riosp) — BR-116 km 231,3', 'RIOSP', 'BR-116', 'São Paulo', 'SP', -23.526095, -46.588329),
  ('Free Flow PFE002 - PFS002 Sul (Riosp) — BR-116 km 219,0', 'RIOSP', 'BR-116', 'Guarulhos', 'SP', -23.463679, -46.495578),
  ('Free Flow PFE007 - BAIRRO Norte (Riosp) — BR-116 km 223,35', 'RIOSP', 'BR-116', 'Guarulhos', 'SP', -23.479177, -46.530417),
  ('Free Flow Bom Jesus de Goiás - P06 (Rota Verde Goiás) — BR-452 km 99,85', 'ROTA VERDE GOIÁS', 'BR-452', 'Bom Jesus de Goiás', 'GO', -18.114585, -50.039087),
  ('Free Flow Bom Jesus de Goiás - P07 (Rota Verde Goiás) — BR-452 km 147,59', 'ROTA VERDE GOIÁS', 'BR-452', 'Bom Jesus de Goiás', 'GO', -18.276646, -49.631116),
  ('Free Flow Abadia de Goiás - P01A (Rota Verde Goiás) — BR-60 km 172,0', 'ROTA VERDE GOIÁS', 'BR-60', 'Abadia de Goiás', 'GO', -16.747265, -49.422998),
  ('Free Flow Abadia de Goiás - P01B (Rota Verde Goiás) — BR-60 km 182,595', 'ROTA VERDE GOIÁS', 'BR-60', 'Abadia de Goiás', 'GO', -16.792644, -49.505717),
  ('Free Flow Acreuna - P04A (Rota Verde Goiás) — BR-60 km 326,0', 'ROTA VERDE GOIÁS', 'BR-60', 'Acreúna', 'GO', -17.542722, -50.508903),
  ('Free Flow Indiara - P02A (Rota Verde Goiás) — BR-60 km 233,75', 'ROTA VERDE GOIÁS', 'BR-60', 'Indiara', 'GO', -17.082876, -49.837071),
  ('Free Flow Jandaia - P03A (Rota Verde Goiás) — BR-60 km 281,6', 'ROTA VERDE GOIÁS', 'BR-60', 'Jandaia', 'GO', -17.263997, -50.229512),
  ('Free Flow Santa Helena de Goiás - P05 (Rota Verde Goiás) — BR-452 km 44,9', 'ROTA VERDE GOIÁS', 'BR-452', 'Santa Helena de Goiás', 'GO', -17.944974, -50.517476),
  ('P2 - Guarantã do Norte (Via Brasil) — BR-163 km 1089,45', 'VIA BRASIL', 'BR-163', 'Terra Nova do Norte', 'MT', -9.756473, -54.89443),
  ('Praça 05 - Ibiá - Free Flow (Way 262) — BR-262 km 665,1', 'WAY 262', 'BR-262', 'Ibiá', 'MG', -19.55027, -46.850368),
  ('Praça 02 - Nova Serrana - Free Flow (Way 262) — BR-262 km 452,95', 'WAY 262', 'BR-262', 'Nova Serrana', 'MG', -19.812626, -45.103461)
) AS v(nome, concessionaria, rodovia, cidade, uf, lat, lng)
WHERE NOT EXISTS (
  SELECT 1 FROM "pedagios_rodovia" p
  WHERE p."ativo" AND abs(p."lat" - v.lat) < 0.08 AND abs(p."lng" - v.lng) < 0.08
);
