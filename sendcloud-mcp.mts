import type { Config, Context } from "@netlify/functions";

const SENDCLOUD_BASE_URL = "https://panel.sendcloud.sc/api/v2";

type RpcRequest = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
};

const response = (id: RpcRequest["id"], result: unknown, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
    status,
    headers: { "content-type": "application/json" },
  });

const error = (id: RpcRequest["id"], code: number, message: string, status = 400) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

function authorised(request: Request) {
  const token = Netlify.env.get("MCP_AUTH_TOKEN");
  return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
}

async function sendcloud(path: string) {
  const publicKey = Netlify.env.get("SENDCLOUD_PUBLIC_KEY");
  const secretKey = Netlify.env.get("SENDCLOUD_SECRET_KEY");
  if (!publicKey || !secretKey) throw new Error("Les clés Sendcloud ne sont pas configurées.");

  const basic = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const result = await fetch(`${SENDCLOUD_BASE_URL}${path}`, {
    headers: { authorization: `Basic ${basic}`, accept: "application/json" },
  });
  if (!result.ok) throw new Error(`Sendcloud a répondu ${result.status}.`);
  return result.json();
}

const tools = [
  {
    name: "list_sendcloud_parcels",
    description: "Liste les colis Sendcloud récents, pour vérifier ce qui est déjà expédié.",
    inputSchema: {
      type: "object",
      properties: { page: { type: "integer", minimum: 1, default: 1 } },
    },
  },
  {
    name: "get_sendcloud_parcel",
    description: "Récupère le détail d'un colis Sendcloud à partir de son identifiant.",
    inputSchema: {
      type: "object",
      required: ["parcel_id"],
      properties: { parcel_id: { type: "integer" } },
    },
  },
];

export default async (request: Request, _context: Context) => {
  if (request.method === "GET") return new Response("Sendcloud MCP is running.");
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });

  let rpc: RpcRequest;
  try { rpc = await request.json() as RpcRequest; }
  catch { return error(null, -32700, "JSON invalide."); }

  if (rpc.method === "initialize") {
    return response(rpc.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "sendcloud-mcp", version: "0.1.0" },
    });
  }
  if (rpc.method === "tools/list") return response(rpc.id, { tools });
  if (rpc.method !== "tools/call") return error(rpc.id, -32601, "Méthode inconnue.");

  try {
    const name = rpc.params?.name;
    const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
    let data: unknown;
    if (name === "list_sendcloud_parcels") data = await sendcloud(`/parcels?page=${Number(args.page ?? 1)}`);
    else if (name === "get_sendcloud_parcel") data = await sendcloud(`/parcels/${Number(args.parcel_id)}`);
    else return error(rpc.id, -32602, "Outil inconnu.");
    return response(rpc.id, { content: [{ type: "text", text: JSON.stringify(data) }] });
  } catch (err) {
    return error(rpc.id, -32000, err instanceof Error ? err.message : "Erreur Sendcloud.", 502);
  }
};

export const config: Config = { path: "/mcp" };
