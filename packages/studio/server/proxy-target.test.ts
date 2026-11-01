import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { createStudioApi } from "./studio-api";

/**
 * The studio middleware on a bare HTTP server, in front of a recording server
 * that stands in for both the Prompt service and an attacker's host. Raw
 * sockets send each request line as written: fetch would normalize it first.
 */
const TOKEN = "fixture-token";
const seen: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
let recorder: Server;
let studio: Server;
let recorderHost: string;
let studioHost: string;

const listen = async (server: Server) => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `127.0.0.1:${(server.address() as { port: number }).port}`;
};

beforeAll(async () => {
  recorder = createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    res.writeHead(200, { "content-type": "text/plain" }).end("upstream");
  });
  recorderHost = await listen(recorder);
  const api = createStudioApi({ workspace: tmpdir(), service: async () => ({ url: `http://${recorderHost}`, token: TOKEN }) });
  // Vite's SPA fallback answers 200 for any path the middleware passes on.
  studio = createServer((req, res) => api(req, res, () => res.writeHead(200).end("spa")));
  studioHost = await listen(studio);
});

afterAll(() => {
  recorder.close();
  studio.close();
});

async function send(target: string): Promise<{ status: number; body: string }> {
  const [host, port] = studioHost.split(":");
  const raw = await new Promise<string>((done, fail) => {
    const socket = connect(Number(port), host, () => socket.write(`GET ${target} HTTP/1.1\r\nHost: ${studioHost}\r\nConnection: close\r\n\r\n`));
    let text = "";
    socket.on("data", (chunk) => (text += chunk));
    socket.on("end", () => done(text));
    socket.on("error", fail);
  });
  return { status: Number(raw.split(" ")[1]), body: raw.slice(raw.indexOf("\r\n\r\n") + 4) };
}

test("the proxy sends the service token only to the service's own origin and routes", async () => {
  // Control: a real route reaches the service, with the token.
  seen.length = 0;
  expect(await send("/api/events")).toMatchObject({ status: 200, body: expect.stringContaining("upstream") });
  expect(seen.map(({ url, headers }) => ({ url, authorization: headers.authorization }))).toEqual([{ url: "/api/events", authorization: `Bearer ${TOKEN}` }]);

  for (const target of [`//${recorderHost}/api/events`, "/api/events/../x", `http://${recorderHost}/api/events`, "/api/annotations/%2e%2e/resolve"]) {
    seen.length = 0;
    const response = await send(target);
    expect({ target, status: response.status }).toEqual({ target, status: 404 });
    expect(response.body).not.toContain(TOKEN);
    expect({ target, seen }).toEqual({ target, seen: [] });
  }
});
