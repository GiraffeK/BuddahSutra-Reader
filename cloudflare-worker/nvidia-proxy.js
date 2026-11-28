/**
 * Cloudflare Worker: 極簡 NVIDIA NIM CORS 代理（不儲存任何 API Key）
 * 部署步驟：
 * 1. 登入 https://dash.cloudflare.com -> Workers & Pages -> Create -> Start with Hello World!
 * 2. 命名為 nvidia-nim-proxy -> Deploy -> Edit code
 * 3. 將本檔案全部內容貼上並覆蓋原本程式碼 -> 點右上角 Deploy
 * 4. 複製產生的網址（例如 https://nvidia-nim-proxy.你的帳號.workers.dev）貼回佛經閱讀器的「NVIDIA 代理網址」欄位即可！
 */

const ALLOWED_ORIGINS = new Set([
  "https://buddahsutra-reader.web.app",
  "https://buddahsutra-reader.firebaseapp.com",

]);

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://buddahsutra-reader.web.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response(
        JSON.stringify({ error: { message: "Only POST /v1/chat/completions is supported." } }),
        { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: { message: "Missing Authorization Bearer token." } }),
        { status: 401, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": auth,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: await request.text(),
    });

    const respBody = await upstream.text();
    return new Response(respBody, {
      status: upstream.status,
      headers: {
        ...headers,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      },
    });
  },
};
