import type { Plugin } from "@opencode-ai/plugin"
import ContextManagerPlugin from "../src/plugin"

const plugin: Plugin = async (input, options) => ContextManagerPlugin(input, options)
export default plugin
