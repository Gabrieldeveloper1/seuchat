import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Avatar, { DEFAULT_AVATAR, DEFAULT_GROUP_AVATAR } from "./Avatar";

describe("imagens de grupos", () => {
  it("mostra a imagem padrão quando o grupo não tem logo", () => {
    expect(renderToStaticMarkup(<Avatar name="Equipe" seed="1" group />)).toContain(`src="${DEFAULT_GROUP_AVATAR}"`);
  });
  it("usa a logo salva em vez da imagem padrão", () => {
    expect(renderToStaticMarkup(<Avatar name="Equipe" seed="1" group src="data:image/jpeg;base64,YWJj" />)).toContain('src="data:image/jpeg;base64,YWJj"');
  });
  it("mantém a imagem padrão separada para contatos", () => {
    expect(renderToStaticMarkup(<Avatar name="Ana" seed="2" />)).toContain(`src="${DEFAULT_AVATAR}"`);
  });
});
