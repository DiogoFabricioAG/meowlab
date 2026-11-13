import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { AuthPage } from "../web/src/AuthPage";

describe("AuthPage - renderizado inicial y transiciones", () => {
  it("renderiza el toggle con Iniciar sesión seleccionado y píldora deslizante", () => {
    const html = renderToString(React.createElement(AuthPage, { config: { google: true, passwordReset: false } }));
    
    // Tablist con selector
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Tipo de acceso"');
    
    // Píldora deslizante en posición inicial (translate-x-0)
    expect(html).toContain("translate-x-0");
    expect(html).toContain("w-[calc(50%-4px)]");
    
    // Botones de pestañas
    expect(html).toContain("Iniciar sesión");
    expect(html).toContain("Crear cuenta");
    expect(html).toContain('aria-selected="true"');
    
    // Campo nombre colapsado para inicio de sesión
    expect(html).toContain("grid-rows-[0fr]");
    // Hidden sign-up parts are inert: out of the tab order and the accessibility tree.
    expect(html).toContain("inert=\"\"");
    
    // Botón de submit inicial
    expect(html).toContain("Entrar");
    
    // Google activado
    expect(html).toContain("Continuar con Google");
  });
});
