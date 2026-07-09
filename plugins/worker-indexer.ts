import { indexProject } from "../src/indexer"

interface Input {
  root: string
  maxFiles: number
}

self.onmessage = (e: MessageEvent<Input>) => {
  const { root, maxFiles } = e.data
  const result = indexProject(root, maxFiles)
  ;(self as any).postMessage(result)
}
