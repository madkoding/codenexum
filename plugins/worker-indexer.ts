import { indexProject } from "../src/indexer"

interface Input {
  root: string
  maxFiles: number
}

self.onmessage = (e: MessageEvent<Input>) => {
  const { root, maxFiles } = e.data
  const result = indexProject(root, maxFiles)
  // Strip non-serializable content from edges to safely post from worker.
  ;(self as any).postMessage({
    files: result.files,
    chunks: result.chunks,
    fileHashes: result.fileHashes,
    edges: result.edges,
    capped: result.capped,
  })
}
