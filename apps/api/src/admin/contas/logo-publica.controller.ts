import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../../auth/decorators/public.decorator";
import { ContasService } from "./contas.service";

/**
 * Serve a logo da empresa pro `<img>` do painel.
 *
 * É pública porque tem que ser: o navegador não manda header de autenticação
 * numa tag de imagem, e a alternativa (baixar por fetch e virar blob) só
 * complicaria a vida por nada. Logo de empresa é marca — feita pra ser vista.
 *
 * O que NÃO é público aqui: descobrir que empresas existem. A rota exige o id
 * exato e devolve 404 pra qualquer coisa que não seja uma logo já enviada, sem
 * dizer se a conta existe.
 */
@ApiTags("publico")
@Controller("publico/contas")
export class LogoPublicaController {
  constructor(private readonly service: ContasService) {}

  @Public()
  @Get(":id/logo")
  async logo(@Param("id") id: string, @Res() res: Response) {
    const logo = await this.service.logoBuffer(id);
    if (!logo) throw new NotFoundException("Sem logo.");
    res.set("Content-Type", logo.contentType);
    // Cache longo é seguro: a URL carrega um `v` que muda a cada troca de logo.
    res.set("Cache-Control", "public, max-age=86400");
    res.send(logo.buffer);
  }
}
