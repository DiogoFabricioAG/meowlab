import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaWhatsAppClient } from "../src/adapters/whatsapp/meta-client";

describe("MetaWhatsAppClient image messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a public image link with its caption", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.image-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new MetaWhatsAppClient(
      { accessToken: "meta-token", graphApiVersion: "v25.0" },
      () => undefined,
    );
    const result = await client.sendImage(
      "51999999999",
      "https://tienda.example/api/design/design-1/image?token=token-1",
      "Ver propuesta: https://tienda.example/?designId=design-1&token=token-1",
      "1266091906580349",
    );

    expect(result).toEqual({ status: "sent", metaMessageId: "wamid.image-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v25.0/1266091906580349/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "51999999999",
          type: "image",
          image: {
            link: "https://tienda.example/api/design/design-1/image?token=token-1",
            caption: "Ver propuesta: https://tienda.example/?designId=design-1&token=token-1",
          },
        }),
      }),
    );
  });

  it("marks the incoming message as read and shows the typing indicator", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new MetaWhatsAppClient(
      { accessToken: "meta-token", graphApiVersion: "v25.0" },
      () => undefined,
    );
    const result = await client.sendTypingIndicator(
      "wamid.incoming-1",
      "1266091906580349",
    );

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v25.0/1266091906580349/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: "wamid.incoming-1",
          typing_indicator: { type: "text" },
        }),
      }),
    );
  });

  it("sends up to three reply buttons with stable ids", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.buttons-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new MetaWhatsAppClient(
      { accessToken: "meta-token", graphApiVersion: "v25.0" },
      () => undefined,
    );
    const result = await client.sendButtons(
      "51999999999",
      "¿Qué deseas hacer?",
      [
        { id: "store_modify_design", title: "Modificar diseño" },
        { id: "store_approve_design", title: "Aprobar diseño" },
        { id: "store_view_store", title: "Ver en tienda" },
      ],
      "1266091906580349",
    );

    expect(result).toEqual({ status: "sent", metaMessageId: "wamid.buttons-1" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "¿Qué deseas hacer?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "store_modify_design", title: "Modificar diseño" } },
            { type: "reply", reply: { id: "store_approve_design", title: "Aprobar diseño" } },
            { type: "reply", reply: { id: "store_view_store", title: "Ver en tienda" } },
          ],
        },
      },
    });
  });

  it("sends list messages for catalog selections", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.list-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new MetaWhatsAppClient(
      { accessToken: "meta-token", graphApiVersion: "v25.0" },
      () => undefined,
    );
    const result = await client.sendList(
      "51999999999",
      "Elige un color",
      "Ver colores",
      [{
        title: "Colores",
        rows: [{ id: "store_color_negro", title: "Negro", description: "Disponible" }],
      }],
      "1266091906580349",
    );

    expect(result).toEqual({ status: "sent", metaMessageId: "wamid.list-1" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Elige un color" },
        action: {
          button: "Ver colores",
          sections: [{
            title: "Colores",
            rows: [{ id: "store_color_negro", title: "Negro", description: "Disponible" }],
          }],
        },
      },
    });
  });
});
