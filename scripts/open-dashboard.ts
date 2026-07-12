import { Database } from "bun:sqlite"
import { join } from "path"
import { startDashboard, getDashboardState } from "../src/dashboard"
import { initSchema } from "../src/store"

const dbPath = join(process.env.HOME || "/tmp", ".cache/opencode/context-manager.sqlite")
const db = new Database(dbPath)
initSchema(db)

async function main() {
  let dash = getDashboardState()
  if (!dash.ready) {
    dash = await startDashboard(db)
  }
  if (!dash.ready) {
    console.error("dashboard failed:", dash.error)
    process.exit(1)
  }
  console.log("dashboard:", dash.url)
  const open = await import("open").catch(() => null)
  if (open?.default) {
    await open.default(dash.url)
  } else {
    const { exec } = await import("child_process")
    exec(`open "${dash.url}"`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
