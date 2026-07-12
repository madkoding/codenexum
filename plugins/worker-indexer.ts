import { indexProject } from "../src/indexer"

interface Input {
  root: string
  maxFiles: number
}

self.onmessage = (e: MessageEvent<Input>) => {
  try {
    const { root, maxFiles } = e.data
    const result = indexProject(root, maxFiles)
    ;(self as any).postMessage({ ok: true, ...result })
  } catch (err) {
    ;(self as any).postMessage({ ok: false, error: String(err) })
  }
}
