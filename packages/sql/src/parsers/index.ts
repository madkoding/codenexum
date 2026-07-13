import type { Chunk } from "../types"
import { pyParse } from "./python"
import { jsParse, tsParse } from "./javascript"
import { goParse } from "./go"
import { rsParse } from "./rust"
import { javaParse } from "./java"
import { rbParse } from "./ruby"
import { phpParse } from "./php"
import { cppParse } from "./cpp"
import { csParse } from "./csharp"
import { cssParse, htmlParse, dataParse, sqlParse, mdParse } from "./formats"

export { pyParse, jsParse, tsParse, goParse, rsParse, javaParse, rbParse, phpParse, cppParse, csParse, cssParse, htmlParse, dataParse, sqlParse, mdParse }

export const PARSERS: Record<string, (c: string, f: string) => Chunk[]> = {
  ".py": pyParse, ".js": jsParse, ".jsx": jsParse, ".ts": tsParse, ".tsx": tsParse,
  ".go": goParse, ".rs": rsParse, ".java": javaParse,
  ".rb": rbParse, ".php": phpParse,
  ".c": cppParse, ".h": cppParse, ".cpp": cppParse, ".hpp": cppParse, ".cs": csParse,
  ".css": cssParse, ".scss": cssParse,
  ".html": htmlParse, ".hbs": htmlParse, ".ejs": htmlParse,
  ".json": dataParse, ".yaml": dataParse, ".yml": dataParse, ".toml": dataParse,
  ".sql": sqlParse, ".md": mdParse,
}