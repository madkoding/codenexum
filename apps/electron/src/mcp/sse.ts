import type { ServerResponse } from "http"

export interface SseClient {
  id: string
  res: ServerResponse
}

const sseClients = new Map<string, SseClient>()

export function sseAddClient(client: SseClient): void {
  sseClients.set(client.id, client)
}

export function sseRemoveClient(id: string): void {
  sseClients.delete(id)
}

export function sseGetClients(): SseClient[] {
  return Array.from(sseClients.values())
}

export function sseClientCount(): number {
  return sseClients.size
}

export function sseWrite(res: ServerResponse, event: string, data: any): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function sseBroadcast(event: string, data: any): void {
  for (const client of sseClients.values()) {
    try { sseWrite(client.res, event, data) } catch {}
  }
}
