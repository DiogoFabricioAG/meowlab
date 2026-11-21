const TOKEN_KEY = "meowlab_session_token";
const CAPACITOR_TOKEN_KEY = TOKEN_KEY;

type SecureStoragePlugin = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

type BrowserPlugin = {
  open(options: { url: string }): Promise<void>;
};

type AppPlugin = {
  addListener(event: "backButton", cb: (info: { canGoBack: boolean }) => void): Promise<{ remove: () => Promise<void> }>;
  exitApp(): Promise<void>;
};

type NetworkPlugin = {
  getStatus(): Promise<{ connected: boolean }>;
  addListener(event: "networkStatusChange", cb: (status: { connected: boolean }) => void): Promise<{ remove: () => Promise<void> }>;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: {
    SecureStorage?: SecureStoragePlugin;
    Browser?: BrowserPlugin;
    App?: AppPlugin;
    Network?: NetworkPlugin;
  };
};

function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").trim().replace(/\/$/, "");

export function isNativeApp(): boolean {
  return getCapacitor()?.isNativePlatform?.() === true;
}

export function apiUrl(path: string, origin: string = API_ORIGIN): string {
  const cleanOrigin = origin.trim().replace(/\/$/, "");
  if (!cleanOrigin || !path.startsWith("/")) return path;
  return `${cleanOrigin}${path}`;
}

let memoryToken: string | null = null;

export function getAuthTokenSync(): string | null {
  return memoryToken;
}

export async function readAuthToken(): Promise<string | null> {
  if (!isNativeApp()) return null;
  if (memoryToken) return memoryToken;
  const plugin = getCapacitor()?.Plugins?.SecureStorage;
  if (!plugin) return memoryToken;
  try {
    const result = await plugin.get({ key: CAPACITOR_TOKEN_KEY });
    memoryToken = result?.value?.trim() || null;
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export async function saveAuthToken(token: string): Promise<void> {
  const clean = token.trim();
  if (!clean) return;
  memoryToken = clean;
  if (!isNativeApp()) return;
  const plugin = getCapacitor()?.Plugins?.SecureStorage;
  if (!plugin) return;
  try {
    await plugin.set({ key: CAPACITOR_TOKEN_KEY, value: clean });
  } catch {
    // Keep in-memory token if Keystore write fails transiently.
  }
}

export async function clearAuthToken(): Promise<void> {
  memoryToken = null;
  if (!isNativeApp()) return;
  const plugin = getCapacitor()?.Plugins?.SecureStorage;
  if (!plugin) return;
  try {
    await plugin.remove({ key: CAPACITOR_TOKEN_KEY });
  } catch {
    // Best-effort removal from Keystore.
  }
}

export function openExternalUrl(url: string): void {
  const browser = isNativeApp() ? getCapacitor()?.Plugins?.Browser : undefined;
  if (browser) {
    void browser.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function createApiFetch(deps: {
  origin?: string;
  native?: () => boolean;
  getToken?: () => Promise<string | null>;
  saveToken?: (token: string) => Promise<void>;
  clearToken?: () => Promise<void>;
  fetchImpl?: typeof fetch;
} = {}) {
  const origin = deps.origin ?? API_ORIGIN;
  const native = deps.native ?? isNativeApp;
  const getToken = deps.getToken ?? readAuthToken;
  const saveToken = deps.saveToken ?? saveAuthToken;
  const clearToken = deps.clearToken ?? clearAuthToken;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async function apiFetchImpl(input: string, init: RequestInit = {}): Promise<Response> {
    const url = apiUrl(input, origin);
    if (!native()) {
      return fetchImpl(url, { credentials: "same-origin", ...init });
    }

    const token = await getToken();
    const headers = new Headers(init.headers);
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetchImpl(url, {
      ...init,
      credentials: "omit",
      headers,
    });

    const nextToken = response.headers.get("set-auth-token");
    if (nextToken) {
      await saveToken(nextToken);
    } else if (response.status === 401 && token) {
      await clearToken();
    }

    return response;
  };
}

export const apiFetch = createApiFetch();

export function installNativeListeners(onNetworkChange: (connected: boolean) => void): () => void {
  if (!isNativeApp()) return () => {};
  const cap = getCapacitor();
  const cleanups: Array<() => void> = [];

  if (cap?.Plugins?.App) {
    let atRoot = () => window.location.pathname === "/" && !window.location.hash;
    void Promise.resolve(cap.Plugins.App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack && !atRoot()) {
        window.history.back();
      } else {
        void cap.Plugins?.App?.exitApp();
      }
    })).then((handle) => {
      if (handle && typeof handle.remove === "function") cleanups.push(() => void handle.remove());
    });
  }

  if (cap?.Plugins?.Network) {
    void Promise.resolve(cap.Plugins.Network.getStatus()).then((status) => {
      if (status) onNetworkChange(status.connected);
    });
    void Promise.resolve(cap.Plugins.Network.addListener("networkStatusChange", (status) => onNetworkChange(status.connected)))
      .then((handle) => {
        if (handle && typeof handle.remove === "function") cleanups.push(() => void handle.remove());
      });
  }

  const onLinkClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement | null)?.closest("a");
    if (!target) return;
    const href = target.getAttribute("href")?.trim();
    if (!href) return;
    if (href.startsWith("https://wa.me/") || href.startsWith("whatsapp://") || target.hasAttribute("download") || target.target === "_blank") {
      event.preventDefault();
      openExternalUrl(apiUrl(href));
    }
  };
  document.addEventListener("click", onLinkClick);
  cleanups.push(() => document.removeEventListener("click", onLinkClick));

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
