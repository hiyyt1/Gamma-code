import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type ProductProject = { name: string; path: string }

export async function productRequest<T>(
  server: ServerConnection.HttpBase,
  path: string,
  body?: object,
  signal?: AbortSignal,
  keepalive = false,
): Promise<T> {
  const response = await fetch(`${server.url.replace(/\/$/, "")}/product/${path}`, {
    signal,
    keepalive,
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(server.password
        ? {
            Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((error: unknown) => {
    if (signal?.aborted) throw error
    throw new Error("network_error", { cause: error })
  })
  if (response.status === 401 || response.status === 403) throw new Error(`http_${response.status}`)
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("invalid_response")
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.code === "string" ? error.code : `http_${response.status}`)
  }
  return response.json().catch(() => {
    throw new Error("invalid_response")
  })
}
