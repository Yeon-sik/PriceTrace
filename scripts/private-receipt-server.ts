import { createServer } from "node:http";
import { loadPrivateReceiptProjections } from "./private-receipt-source";

const host = "127.0.0.1";
const port = Number(process.env.PRIVATE_RECEIPT_PORT ?? "3210");
const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (origin && !allowedOrigin.test(origin)) {
    response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "로컬 앱에서만 접근할 수 있습니다." }));
    return;
  }

  if (request.method !== "GET" || requestUrl.pathname !== "/receipts") {
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const result = await loadPrivateReceiptProjections();
    const responseHeaders = {
      "Access-Control-Allow-Origin": origin ?? `http://${host}`,
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (requestUrl.searchParams.get("revision") === result.revision) {
      response.writeHead(204, responseHeaders);
      response.end();
      return;
    }
    response.writeHead(200, {
      ...responseHeaders,
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "private-data를 읽지 못했습니다." }));
  }
});

server.listen(port, host, () => {
  console.log(`Private receipt projection server: http://${host}:${port}/receipts`);
});
