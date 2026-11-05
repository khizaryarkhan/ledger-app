// The fetch used for any address a USER typed. Two things the SDK's default
// fetch would do that a user-controlled address must not be allowed to do:
//
//  1. follow a redirect (a public https endpoint answering 307 to an internal
//     address, with the body and key replayed), and
//  2. resolve the name a second time after we checked it (DNS rebinding).
//
// So the connection is made with node:https and a `lookup` that checks every
// address AT CONNECT TIME — the address that is checked is the address that is
// used — and any redirect is an error. Only port 443. Fixed provider addresses
// (ours to name) keep the default fetch.

import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Readable } from "node:stream";
import { isPrivateAddress } from "./providers";

/** Pure, so it is testable without a network: every resolved address must be public. */
export function assertResolvedPublic(addrs: readonly { address: string }[]): void {
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error("That address points at a private or local machine, which the server cannot reach safely.");
  }
}

function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, cb: (err: Error | null, address?: unknown, family?: number) => void): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as LookupAddress[];
    try { assertResolvedPublic(list); } catch (e) { return cb(e as Error); }
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

export const safeFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const req = new Request(input as RequestInfo, init);
  const url = new URL(req.url);
  if (url.protocol !== "https:") throw new Error("Only https endpoints are allowed.");
  if (url.port && url.port !== "443") throw new Error("Only the standard https port is allowed.");
  const body = req.body ? Buffer.from(await req.arrayBuffer()) : undefined;
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });

  return new Promise<Response>((resolve, reject) => {
    const r = https.request(
      { protocol: "https:", hostname: url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: req.method, headers, lookup: guardedLookup as never, signal: req.signal },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) { res.resume(); return reject(new Error("The endpoint tried to redirect, which is not allowed.")); }
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : v);
        const empty = status === 204 || status === 205;
        resolve(new Response(empty ? null : (Readable.toWeb(res) as unknown as ReadableStream), { status, statusText: res.statusMessage, headers: h }));
      },
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}) as typeof fetch;
