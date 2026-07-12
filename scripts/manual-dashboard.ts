import { Database } from "bun:sqlite"
import { join } from "path"
import { startDashboard, getDashboardState } from "../src/dashboard"
import { initSchema } from "../src/store"

const db = new Database(join(process.env.HOME || "/tmp", ".cache/opencode/context-manager.sqlite"))
initSchema(db)

async function main() {
  let dash = getDashboardState()
  if (!dash.ready) {
    dash = await startDashboard(db, "manual-test")
  }
  console.log("dashboard state:", dash)
}

main().catch((e) => { console.error(e); process.exit(1) })
