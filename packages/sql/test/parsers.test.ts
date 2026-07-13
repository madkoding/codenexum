import { test, expect } from "bun:test"
import { pyParse } from "../src/parsers/python"
import { jsParse, tsParse } from "../src/parsers/javascript"
import { goParse } from "../src/parsers/go"
import { rsParse } from "../src/parsers/rust"
import { javaParse } from "../src/parsers/java"
import { rbParse } from "../src/parsers/ruby"
import { phpParse } from "../src/parsers/php"
import { cppParse } from "../src/parsers/cpp"
import { csParse } from "../src/parsers/csharp"
import { cssParse, htmlParse, dataParse, sqlParse, mdParse } from "../src/parsers/formats"
import { PARSERS } from "../src/parsers"

// === Python ===
test("pyParse: extracts function", () => {
  const chunks = pyParse("def hello(name):\n  return name", "test.py")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("hello")
  expect(chunks[0].type).toBe("function")
  expect(chunks[0].line).toBe(1)
})

test("pyParse: extracts class", () => {
  const chunks = pyParse("class MyClass:\n  pass", "test.py")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("MyClass")
  expect(chunks[0].type).toBe("class")
})

test("pyParse: extracts async function", () => {
  const chunks = pyParse("async def fetch():\n  return data", "test.py")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("fetch")
})

test("pyParse: extracts decorator", () => {
  const chunks = pyParse("@app.route('/')\ndef index():\n  return 'ok'", "test.py")
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  const decorators = chunks.filter(c => c.type === "decorator")
  expect(decorators.length).toBeGreaterThanOrEqual(1)
})

test("pyParse: empty file returns empty", () => {
  expect(pyParse("", "empty.py")).toEqual([])
})

// === JavaScript / TypeScript ===
test("jsParse: extracts function", () => {
  const chunks = jsParse("function greet(name) {\n  return `Hello ${name}`\n}", "test.js")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("greet")
  expect(chunks[0].type).toBe("function")
})

test("jsParse: extracts arrow function assigned to const", () => {
  const chunks = jsParse("const add = (a, b) => a + b", "test.js")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("add")
})

test("jsParse: extracts class", () => {
  const chunks = jsParse("class Animal {\n  constructor(name) { this.name = name }\n}", "test.js")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("Animal")
  expect(chunks[0].type).toBe("class")
})

test("tsParse: extracts interface", () => {
  const chunks = tsParse("interface User {\n  name: string\n  age: number\n}", "test.ts")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("User")
  expect(chunks[0].type).toBe("interface")
})

test("tsParse: extracts type alias", () => {
  const chunks = tsParse("type Point = { x: number; y: number }", "test.ts")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("Point")
  expect(chunks[0].type).toBe("type")
})

test("tsParse: extracts enum", () => {
  const chunks = tsParse("enum Color { Red, Green, Blue }", "test.ts")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("Color")
  expect(chunks[0].type).toBe("enum")
})

test("tsParse: extracts export", () => {
  const chunks = tsParse("export const VERSION = '1.0'", "test.ts")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].type).toBe("export")
})

// === Go ===
test("goParse: extracts function", () => {
  const chunks = goParse("func Hello(w http.ResponseWriter, r *http.Request) {\n  w.Write([]byte(\"Hello\"))\n}", "test.go")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("Hello")
  expect(chunks[0].type).toBe("function")
})

test("goParse: extracts struct", () => {
  const chunks = goParse("type Config struct {\n  Port int\n  Host string\n}", "test.go")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("Config")
  expect(chunks[0].type).toBe("class")
})

// === Rust ===
test("rsParse: extracts function", () => {
  const chunks = rsParse("fn calculate(x: i32, y: i32) -> i32 {\n  x + y\n}", "test.rs")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("calculate")
  expect(chunks[0].type).toBe("function")
})

test("rsParse: extracts struct", () => {
  const chunks = rsParse("struct Point {\n  x: f64,\n  y: f64,\n}", "test.rs")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("Point")
  expect(chunks[0].type).toBe("class")
})

test("rsParse: extracts impl block", () => {
  const chunks = rsParse("impl Point {\n  fn new(x: f64, y: f64) -> Self { Self { x, y } }\n}", "test.rs")
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  const cls = chunks.find(c => c.type === "class")
  expect(cls).toBeDefined()
  expect(cls!.name).toBe("Point")
})

// === Java ===
test("javaParse: extracts class", () => {
  const chunks = javaParse("public class HelloWorld {\n  public static void main(String[] args) {}\n}", "Test.java")
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  const cls = chunks.find(c => c.type === "class")
  expect(cls).toBeDefined()
  expect(cls!.name).toBe("HelloWorld")
})

test("javaParse: extracts method", () => {
  const chunks = javaParse("public class Service {\n  public String getName() { return \"name\"; }\n}", "Service.java")
  expect(chunks.length).toBeGreaterThanOrEqual(2)
  const method = chunks.find(c => c.type === "function")
  expect(method).toBeDefined()
  expect(method!.name).toContain("getName")
})

// === Ruby ===
test("rbParse: extracts method", () => {
  const chunks = rbParse("def hello(name)\n  \"Hello, #{name}\"\nend", "test.rb")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("hello")
  expect(chunks[0].type).toBe("function")
})

test("rbParse: extracts class", () => {
  const chunks = rbParse("class MyClass\n  def method\n    puts \"hi\"\n  end\nend", "test.rb")
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  const cls = chunks.find(c => c.type === "class")
  expect(cls).toBeDefined()
  expect(cls!.name).toBe("MyClass")
})

// === PHP ===
test("phpParse: extracts function", () => {
  const chunks = phpParse("<?php\nfunction hello($name) {\n  return \"Hello $name\";\n}", "test.php")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("hello")
  expect(chunks[0].type).toBe("function")
})

test("phpParse: extracts class", () => {
  const chunks = phpParse("<?php\nclass MyClass {\n  public function method() {}\n}", "test.php")
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  const cls = chunks.find(c => c.type === "class")
  expect(cls).toBeDefined()
  expect(cls!.name).toBe("MyClass")
})

// === C++ ===
test("cppParse: extracts function", () => {
  const chunks = cppParse("int add(int a, int b) {\n  return a + b;\n}", "test.cpp")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("add")
  expect(chunks[0].type).toBe("function")
})

test("cppParse: extracts class", () => {
  const chunks = cppParse("class MyClass {\n  int x;\npublic:\n  MyClass() : x(0) {}\n};", "test.cpp")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("MyClass")
  expect(chunks[0].type).toBe("class")
})

// === C# ===
test("csParse: extracts class", () => {
  const chunks = csParse("public class MyClass {\n  public int Add(int a, int b) { return a + b; }\n}", "test.cs")
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  const cls = chunks.find(c => c.type === "class")
  expect(cls).toBeDefined()
  expect(cls!.name).toBe("MyClass")
})

test("csParse: extracts method", () => {
  const chunks = csParse("public class Service {\n  public string GetName() { return \"name\"; }\n}", "Service.cs")
  expect(chunks.length).toBeGreaterThanOrEqual(2)
  const method = chunks.find(c => c.type === "function")
  expect(method).toBeDefined()
  expect(method!.name).toContain("GetName")
})

// === CSS ===
test("cssParse: extracts selector", () => {
  const chunks = cssParse(".container {\n  display: flex;\n}", "test.css")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe(".container")
  expect(chunks[0].type).toBe("selector")
})

test("cssParse: extracts keyframe", () => {
  const chunks = cssParse("@keyframes slide {\n  from { left: 0; }\n  to { left: 100px; }\n}", "test.css")
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  expect(chunks[0].name).toBe("@keyframes")
})

// === HTML ===
test("htmlParse: extracts component", () => {
  const chunks = htmlParse("<template id=\"my-component\">\n  <div>Hello</div>\n</template>", "test.html")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("my-component")
  expect(chunks[0].type).toBe("component")
})

// === Data formats ===
test("dataParse: extracts top-level keys from JSON", () => {
  const chunks = dataParse('{\n  "name": "test",\n  "version": "1.0"\n}', "test.json")
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  expect(chunks[0].type).toBe("config")
})

test("sqlParse: extracts table", () => {
  const chunks = sqlParse("CREATE TABLE users (\n  id INT PRIMARY KEY,\n  name TEXT\n);", "test.sql")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("users")
  expect(chunks[0].type).toBe("table")
})

test("mdParse: extracts heading", () => {
  const chunks = mdParse("# Introduction\n\nHello world\n\n## Details\n\nMore info", "test.md")
  expect(chunks.length).toBeGreaterThanOrEqual(2)
  expect(chunks[0].name).toBe("Introduction")
  expect(chunks[0].type).toBe("heading")
  expect(chunks[1].name).toBe("Details")
})

// === PARSERS registry ===
test("PARSERS has entries for all supported languages", () => {
  expect(PARSERS[".py"]).toBeDefined()
  expect(PARSERS[".js"]).toBeDefined()
  expect(PARSERS[".ts"]).toBeDefined()
  expect(PARSERS[".go"]).toBeDefined()
  expect(PARSERS[".rs"]).toBeDefined()
  expect(PARSERS[".java"]).toBeDefined()
  expect(PARSERS[".rb"]).toBeDefined()
  expect(PARSERS[".php"]).toBeDefined()
  expect(PARSERS[".cpp"]).toBeDefined()
  expect(PARSERS[".cs"]).toBeDefined()
  expect(PARSERS[".css"]).toBeDefined()
  expect(PARSERS[".html"]).toBeDefined()
  expect(PARSERS[".json"]).toBeDefined()
  expect(PARSERS[".sql"]).toBeDefined()
  expect(PARSERS[".md"]).toBeDefined()
})

test("PARSERS returns undefined for unknown extension", () => {
  expect(PARSERS[".xyz"]).toBeUndefined()
})
