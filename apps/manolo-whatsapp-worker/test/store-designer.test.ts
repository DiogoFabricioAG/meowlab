import { describe, expect, it } from "vitest";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import type {
  StoreDesignClient,
  StoreDesignApprovalRequest,
  StoreDesignRequest,
} from "../src/store-designer/contracts";
import type { StoreCommerceClient } from "../src/store-commerce/contracts";
import { StoreDesignerRoleHandler } from "../src/roles/store-designer-role";
import type { RoleStateRepository } from "../src/roles/state";

const tenant: TenantContext = {
  tenantId: "manolo",
  phoneNumberId: "phone-1",
  roleKey: "store-designer",
  systemPrompt: "",
  aiProvider: "store-internal",
  aiModel: "",
  temperature: 0.2,
  maxTokens: 180,
};

class MemoryState implements RoleStateRepository {
  private readonly values = new Map<string, string>();

  async get(tenantId: string, contactId: number, roleKey: string) {
    return this.values.get(`${tenantId}:${contactId}:${roleKey}`) ?? null;
  }

  async set(tenantId: string, contactId: number, roleKey: string, stateJson: string) {
    this.values.set(`${tenantId}:${contactId}:${roleKey}`, stateJson);
    return true;
  }

  async clear() {
    return true;
  }
}

class FakeStoreClient implements StoreDesignClient {
  readonly requests: StoreDesignRequest[] = [];
  readonly approvalRequests: StoreDesignApprovalRequest[] = [];
  private version = 0;

  async generate(request: StoreDesignRequest) {
    this.requests.push(request);
    this.version += 1;
    return {
      ok: true as const,
      proposal: {
        designId: request.currentDesign?.designId ?? "design-1",
        accessToken: request.currentDesign?.accessToken ?? "token-1",
        version: this.version,
        brief: `Brief ${this.version}`,
        proposalUrl: "https://tienda.example/?designId=design-1&token=token-1",
        imageUrl: "https://tienda.example/api/design/design-1/image?version=1&token=token-1",
      },
    };
  }

  async approve(request: StoreDesignApprovalRequest) {
    this.approvalRequests.push(request);
    return {
      ok: true as const,
      approval: {
        designId: request.designId,
        version: request.version,
        proposalUrl: "https://tienda.example/?designId=design-1&token=token-1",
        alreadyApproved: this.approvalRequests.length > 1,
      },
    };
  }
}

class FakeStoreCommerceClient implements StoreCommerceClient {
  async getCatalog() {
    return {
      ok: true as const,
      catalog: {
        variants: [{
          id: "variant-polo-negro-m",
          tenantId: "default",
          productType: "polo",
          productName: "Polo",
          color: "negro",
          colorName: "Negro",
          size: "M",
          sizeName: "M",
          unitPrice: 50000,
          currencyId: "COP",
          availableQuantity: 10,
        }],
      },
    };
  }

  async createDraftOrder() {
    return {
      ok: true as const,
      order: {
        orderId: "order-1",
        status: "draft" as const,
        designId: "design-1",
        designVersion: 1,
        variantId: "variant-polo-negro-m",
        productType: "polo",
        productName: "Polo",
        color: "Negro",
        size: "M",
        quantity: 1,
        unitPrice: 50000,
        totalAmount: 50000,
        currencyId: "COP",
        alreadyExisting: false,
        confirmedAt: null,
        checkoutUrl: null,
      },
    };
  }

  async confirmDraftOrder() {
    const result = await this.createDraftOrder();
    return {
      ok: true as const,
      order: {
        ...result.order,
        status: "awaiting_payment" as const,
        checkoutUrl: "https://tienda.example/pago?orderId=order-1&token=checkout-token",
      },
    };
  }

  async cancelDraftOrder() {
    return this.createDraftOrder();
  }
}

function context(
  text: string,
  client: StoreDesignClient,
  state: RoleStateRepository,
  replies: string[],
  imageSends?: Array<{ imageUrl: string; caption: string }>,
  interactionId: string | null = null,
  buttonSends?: Array<{ body: string; buttons: readonly { id: string; title: string }[] }>,
  storeCommerce?: StoreCommerceClient,
  listSends?: Array<{ body: string; buttonText: string; sections: readonly { title?: string; rows: readonly { id: string; title: string; description?: string }[] }[] }>,
): RoleHandlerContext {
  return {
    message: {
      id: "message-1",
      interactionId,
      phoneNumberId: "phone-1",
      to: "51999999999",
      inputType: "text",
      audioMediaId: null,
      audioMimeType: null,
      text,
    },
    tenant,
    persisted: { duplicate: false, conversationId: "conversation-1", contactId: 7 },
    env: {} as Env,
    ai: null,
    finance: null,
    businessData: null,
    quoteNumberAllocator: null,
    roleState: state,
    storeDesigner: client,
    storeCommerce,
    history: [],
    reply: async (replyText) => {
      replies.push(replyText);
    },
    sendImage: imageSends
      ? async (imageUrl, caption) => {
          imageSends.push({ imageUrl, caption });
          return { status: "sent", metaMessageId: "image-1" };
        }
      : undefined,
    sendButtons: buttonSends
      ? async (body, buttons) => {
          buttonSends.push({ body, buttons });
          return { status: "sent", metaMessageId: "buttons-1" };
        }
      : undefined,
    sendList: listSends
      ? async (body, buttonText, sections) => {
          listSends.push({ body, buttonText, sections });
          return { status: "sent", metaMessageId: "list-1" };
        }
      : undefined,
    sendDocument: async () => ({ status: "sent", metaMessageId: "document-1" }),
    generateAiReply: async () => null,
    generateAiReplyWithHistory: async () => null,
    fallbackReply: "fallback",
    log: () => undefined,
  };
}

describe("store-designer role", () => {
  it("persists the active design and reuses it for a modification", async () => {
    const client = new FakeStoreClient();
    const state = new MemoryState();
    const replies: string[] = [];
    const handler = new StoreDesignerRoleHandler();

    await handler.handle(context("Un dragón para una camiseta", client, state, replies));
    await handler.handle(context("Cámbiale el fondo a azul", client, state, replies));

    expect(client.requests[0]?.currentDesign).toBeNull();
    expect(client.requests[1]?.currentDesign).toEqual({
      designId: "design-1",
      accessToken: "token-1",
    });
    expect(replies[0]).toContain("Preparé una propuesta");
    expect(replies[1]).toContain("Actualicé tu propuesta");
    expect(replies[1]).toContain("Versión 2");
  });

  it("sends the generated image with the proposal link as caption", async () => {
    const client = new FakeStoreClient();
    const state = new MemoryState();
    const replies: string[] = [];
    const imageSends: Array<{ imageUrl: string; caption: string }> = [];
    const handler = new StoreDesignerRoleHandler();

    await handler.handle(context("Un gato astronauta", client, state, replies, imageSends));

    expect(replies).toHaveLength(0);
    expect(imageSends).toEqual([
      {
        imageUrl: "https://tienda.example/api/design/design-1/image?version=1&token=token-1",
        caption: expect.stringContaining(
          "https://tienda.example/?designId=design-1&token=token-1",
        ),
      },
    ]);
  });

  it("handles button actions without sending a new design request", async () => {
    const client = new FakeStoreClient();
    const state = new MemoryState();
    const replies: string[] = [];
    const handler = new StoreDesignerRoleHandler();

    await handler.handle(
      context(
        "store_modify_design",
        client,
        state,
        replies,
        undefined,
        "store_modify_design",
      ),
    );

    expect(client.requests).toHaveLength(0);
    expect(replies[0]).toContain("Escríbeme el cambio");
  });

  it("sends modify, approve and store buttons with the proposal", async () => {
    const client = new FakeStoreClient();
    const state = new MemoryState();
    const replies: string[] = [];
    const buttonSends: Array<{ body: string; buttons: readonly { id: string; title: string }[] }> = [];
    const handler = new StoreDesignerRoleHandler();

    await handler.handle(context("Un estampado de olas", client, state, replies, undefined, null, buttonSends));

    expect(buttonSends[0]).toEqual({
      body: "¿Qué deseas hacer con esta propuesta?",
      buttons: [
        { id: "store_modify_design", title: "Modificar diseño" },
        { id: "store_approve_design", title: "Aprobar diseño" },
        { id: "store_view_store", title: "Ver en tienda" },
      ],
    });
  });

  it("approves the active version and is idempotent on repeated taps", async () => {
    const client = new FakeStoreClient();
    const state = new MemoryState();
    const replies: string[] = [];
    const handler = new StoreDesignerRoleHandler();
    const commerce = new FakeStoreCommerceClient();

    await handler.handle(context("Un diseño minimalista", client, state, replies, undefined, null, undefined, commerce));
    await handler.handle(
      context("store_approve_design", client, state, replies, undefined, "store_approve_design", undefined, commerce),
    );
    await handler.handle(
      context("store_approve_design", client, state, replies, undefined, "store_approve_design", undefined, commerce),
    );

    expect(client.approvalRequests).toHaveLength(1);
    expect(client.approvalRequests[0]).toMatchObject({
      designId: "design-1",
      accessToken: "token-1",
      version: 1,
    });
    expect(replies[1]).toContain("Diseño aprobado");
    expect(replies.some((reply) => reply.includes("ya está aprobado"))).toBe(true);
  });

  it("continues product configuration across separate WhatsApp messages", async () => {
    const client = new FakeStoreClient();
    const commerce = new FakeStoreCommerceClient();
    const state = new MemoryState();
    const replies: string[] = [];
    const buttonSends: Array<{ body: string; buttons: readonly { id: string; title: string }[] }> = [];
    const listSends: Array<{ body: string; buttonText: string; sections: readonly { title?: string; rows: readonly { id: string; title: string; description?: string }[] }[] }> = [];
    const handler = new StoreDesignerRoleHandler();

    await handler.handle(context("Un estampado de montaña", client, state, replies));
    await handler.handle(context("store_approve_design", client, state, replies, undefined, "store_approve_design", buttonSends, commerce, listSends));
    await handler.handle(context("store_product_polo", client, state, replies, undefined, "store_product_polo", undefined, commerce, listSends));
    await handler.handle(context("store_color_negro", client, state, replies, undefined, "store_color_negro", undefined, commerce, listSends));
    await handler.handle(context("store_size_M", client, state, replies, undefined, "store_size_M", undefined, commerce, listSends));
    await handler.handle(context("store_quantity_2", client, state, replies, undefined, "store_quantity_2", buttonSends, commerce, listSends));
    await handler.handle(context("store_confirm_order", client, state, replies, undefined, "store_confirm_order", undefined, commerce, listSends));

    expect(buttonSends.some((send) => send.buttons.some((button) => button.id === "store_product_polo"))).toBe(true);
    expect(listSends.map((send) => send.body)).toEqual([
      "Elige el color de tu prenda:",
      "Elige la talla:",
      "Selecciona la cantidad:",
    ]);
    expect(replies.some((reply) => reply.includes("Precio unitario"))).toBe(true);
    expect(replies.some((reply) => reply.includes("Pagar pedido: https://tienda.example/pago"))).toBe(true);
  });
});
