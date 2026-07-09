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
import { PARSERS } from "../src/parsers"

// === Python ===
test("pyParse: extracts function", () => {
  const chunks = pyParse("def hello(name):\n  return name", "test.py")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("hello")
  expect(chunks[0].type).toBe("function")
  expect(chunks[0].line).toBe(1)
})

test("pyParse: extracts class with inheritance", () => {
  const chunks = pyParse("class Dog(Animal):\n  pass", "test.py")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("Dog")
  expect(chunks[0].type).toBe("class")
})

test("pyParse: extracts typed function", () => {
  const chunks = pyParse("def add(a: int, b: int) -> int:\n  return a + b", "test.py")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].content).toContain("-> int")
})

// === JavaScript ===
test("jsParse: extracts function", () => {
  const chunks = jsParse("function foo(a, b) { return a + b }", "test.js")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("foo")
})

test("jsParse: extracts arrow function", () => {
  const chunks = jsParse("const bar = (x) => x * 2", "test.js")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("bar")
})

test("jsParse: extracts class", () => {
  const chunks = jsParse("class MyClass extends Base { }", "test.js")
  expect(chunks).toHaveLength(1)
  expect(chunks[0].name).toBe("MyClass")
  expect(chunks[0].type).toBe("class")
})

// === TypeScript ===
test("tsParse: extracts interface", () => {
  const chunks = tsParse("interface IUser { id: string }", "test.ts")
  expect(chunks.filter(c => c.type === "interface")).toHaveLength(1)
  expect(chunks.find(c => c.type === "interface")!.name).toBe("IUser")
})

test("tsParse: extracts type alias", () => {
  const chunks = tsParse("type Status = 'active' | 'inactive'", "test.ts")
  expect(chunks.filter(c => c.type === "type")).toHaveLength(1)
})

test("tsParse: extracts enum", () => {
  const chunks = tsParse("enum Color { Red, Green, Blue }", "test.ts")
  expect(chunks.filter(c => c.type === "enum")).toHaveLength(1)
})

// === Go ===
test("goParse: extracts function", () => {
  const chunks = goParse("func Add(a int, b int) int { return a + b }", "test.go")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks[0].name).toBe("Add")
})

test("goParse: extracts struct", () => {
  const chunks = goParse("type Point struct { X int }", "test.go")
  expect(chunks.filter(c => c.type === "class")).toHaveLength(1)
})

test("goParse: extracts interface", () => {
  const chunks = goParse("type Reader interface { Read() }", "test.go")
  expect(chunks.filter(c => c.type === "interface")).toHaveLength(1)
})

// === Rust ===
test("rsParse: extracts function", () => {
  const chunks = rsParse("pub fn calculate(x: i32) -> i32 { x }", "test.rs")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks[0].name).toBe("calculate")
})

test("rsParse: extracts struct", () => {
  const chunks = rsParse("pub struct Config { name: String }", "test.rs")
  expect(chunks.filter(c => c.type === "class")).toHaveLength(1)
})

test("rsParse: extracts trait", () => {
  const chunks = rsParse("pub trait Drawable { fn draw(&self); }", "test.rs")
  expect(chunks.filter(c => c.type === "interface")).toHaveLength(1)
})

// === Java ===
test("javaParse: extracts class", () => {
  const chunks = javaParse("public class User { }", "test.java")
  expect(chunks.filter(c => c.type === "class")).toHaveLength(1)
})

test("javaParse: extracts method", () => {
  const chunks = javaParse("public String getName() { return name; }", "test.java")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
})

test("javaParse: extracts interface", () => {
  const chunks = javaParse("public interface Repository { }", "test.java")
  expect(chunks.filter(c => c.type === "interface")).toHaveLength(1)
})

// === Ruby ===
test("rbParse: extracts function", () => {
  const chunks = rbParse("def hello(name)\n  puts name\nend", "test.rb")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks[0].name).toBe("hello")
})

test("rbParse: extracts class and module", () => {
  const chunks = rbParse("module Auth\nclass Session\nend\nend", "test.rb")
  expect(chunks.filter(c => c.type === "class")).toHaveLength(2)
})

test("rbParse: extracts method with ? suffix", () => {
  const chunks = rbParse("def valid?\n  true\nend", "test.rb")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks[0].name).toBe("valid")
})

// === PHP ===
test("phpParse: extracts function", () => {
  const chunks = phpParse("<?php\nfunction calculate($a, $b) { return $a + $b; }", "test.php")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
})

test("phpParse: extracts class and interface", () => {
  const chunks = phpParse("<?php\nclass User { }\ninterface Repo { }", "test.php")
  expect(chunks.filter(c => c.type === "class")).toHaveLength(1)
  expect(chunks.filter(c => c.type === "interface")).toHaveLength(1)
})

test("phpParse: extracts trait and enum", () => {
  const chunks = phpParse("<?php\ntrait Loggable { }\nenum Status: string { }", "test.php")
  expect(chunks.filter(c => c.type === "interface" && c.content.startsWith("trait"))).toHaveLength(1)
  expect(chunks.filter(c => c.type === "enum")).toHaveLength(1)
})

// === C/C++ ===
test("cppParse: extracts function", () => {
  const chunks = cppParse("int add(int a, int b) { return a + b; }", "test.c")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks[0].name).toBe("add")
})

test("cppParse: extracts struct", () => {
  const chunks = cppParse("struct Point { int x; int y; };", "test.c")
  expect(chunks.filter(c => c.type === "class")).toHaveLength(1)
})

test("cppParse: extracts namespace and enum class", () => {
  const chunks = cppParse("namespace Geometry {\nenum class Direction { UP };\n}", "test.cpp")
  expect(chunks.filter(c => c.type === "class" && c.content.startsWith("namespace"))).toHaveLength(1)
  expect(chunks.filter(c => c.type === "enum")).toHaveLength(1)
})

// === C# ===
test("csParse: extracts method", () => {
  const chunks = csParse("public void PrintName() { }", "test.cs")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
})

test("csParse: extracts class and struct", () => {
  const chunks = csParse("public class User { }\npublic struct Point { }", "test.cs")
  expect(chunks.filter(c => c.type === "class")).toHaveLength(2)
})

test("csParse: extracts interface with where constraint", () => {
  const chunks = csParse("public interface IRepo<T> where T : class { }", "test.cs")
  expect(chunks.filter(c => c.type === "interface")).toHaveLength(1)
})

// === PARSERS map ===
test("PARSERS: all extensions mapped", () => {
  const exts = [".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".java", ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs"]
  for (const ext of exts) {
    expect(PARSERS[ext]).toBeDefined()
  }
})