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

test("pyParse: extracts class method linked to class", () => {
  const chunks = pyParse("class User:\n  def get_name(self):\n    return self.name", "test.py")
  expect(chunks.filter(c => c.type === "class")).toHaveLength(1)
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks.find(c => c.type === "function")!.name).toBe("User.get_name")
  expect(chunks.find(c => c.type === "function")!.content).toContain("method")
})

test("pyParse: top-level function and class method", () => {
  const chunks = pyParse("def helper():\n  pass\n\nclass Foo:\n  def bar(self):\n    pass", "test.py")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(2)
  expect(chunks.filter(c => c.type === "class")).toHaveLength(1)
  expect(chunks.some(c => c.name === "helper")).toBe(true)
  expect(chunks.some(c => c.name === "Foo.bar")).toBe(true)
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

test("jsParse: extracts class method", () => {
  const chunks = jsParse("class Foo {\n  bar(a, b) {\n    return a + b\n  }\n}", "test.js")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks.find(c => c.type === "function")!.name).toBe("bar")
  expect(chunks.find(c => c.type === "function")!.content).toContain("method")
})

test("jsParse: extracts async class method", () => {
  const chunks = jsParse("class Foo {\n  async fetchData(url) {\n    return await get(url)\n  }\n}", "test.js")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks.find(c => c.type === "function")!.name).toBe("fetchData")
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
  const chunks = rsParse("pub trait Drawable {\n  fn draw(&self);\n}", "test.rs")
  expect(chunks.filter(c => c.type === "interface")).toHaveLength(1)
})

test("rsParse: extracts impl method", () => {
  const chunks = rsParse("struct Foo { }\nimpl Foo {\n  fn bar(&self) { }\n}", "test.rs")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks.find(c => c.type === "function")!.name).toBe("Foo.bar")
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

test("javaParse: extracts method inside class", () => {
  const chunks = javaParse("public class User {\n  public String getName() { return name; }\n}", "test.java")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks.find(c => c.type === "function")!.name).toBe("User.getName")
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

test("rbParse: extracts class method", () => {
  const chunks = rbParse("class Greeter\n  def hello(name)\n    puts name\n  end\nend", "test.rb")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks.find(c => c.type === "function")!.name).toBe("Greeter.hello")
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

test("phpParse: extracts class method", () => {
  const chunks = phpParse("<?php\nclass User {\n  public function getName() { return $this->name; }\n}", "test.php")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks.find(c => c.type === "function")!.name).toBe("User.getName")
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

test("cppParse: extracts method inside class", () => {
  const chunks = cppParse("class Calculator {\n  int add(int a, int b) { return a + b; }\n}", "test.cpp")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks.find(c => c.type === "function")!.name).toBe("Calculator.add")
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

test("csParse: extracts method inside class", () => {
  const chunks = csParse("public class User {\n  public string GetName() { return name; }\n}", "test.cs")
  expect(chunks.filter(c => c.type === "function")).toHaveLength(1)
  expect(chunks.find(c => c.type === "function")!.name).toBe("User.GetName")
})

// === Import / Export ===
test("jsParse: extracts import and export statements", () => {
  const chunks = jsParse("import React from 'react'\nexport function Component() {}", "test.js")
  expect(chunks.filter(c => c.type === "import")).toHaveLength(1)
  expect(chunks.filter(c => c.type === "export")).toHaveLength(1)
  expect(chunks.find(c => c.type === "import")!.name).toBe("React")
  expect(chunks.find(c => c.type === "export")!.name).toBe("Component")
})

test("tsParse: extracts type exports", () => {
  const chunks = tsParse("export interface User { name: string }", "test.ts")
  expect(chunks.filter(c => c.type === "export")).toHaveLength(1)
})

test("pyParse: extracts import statement", () => {
  const chunks = pyParse("import json\nfrom pathlib import Path", "test.py")
  expect(chunks.filter(c => c.type === "import")).toHaveLength(2)
})

test("goParse: extracts import", () => {
  const chunks = goParse('import "fmt"', "test.go")
  expect(chunks.filter(c => c.type === "import")).toHaveLength(1)
})

test("rsParse: extracts use statement", () => {
  const chunks = rsParse("use std::collections::HashMap", "test.rs")
  expect(chunks.filter(c => c.type === "import")).toHaveLength(1)
  expect(chunks.find(c => c.type === "import")!.name).toBe("HashMap")
})

test("javaParse: extracts import", () => {
  const chunks = javaParse("import java.util.List;", "test.java")
  expect(chunks.filter(c => c.type === "import")).toHaveLength(1)
  expect(chunks.find(c => c.type === "import")!.name).toBe("List")
})

test("rbParse: extracts require", () => {
  const chunks = rbParse("require 'json'", "test.rb")
  expect(chunks.filter(c => c.type === "import")).toHaveLength(1)
})

test("phpParse: extracts use", () => {
  const chunks = phpParse("<?php\nuse App\\Models\\User;", "test.php")
  expect(chunks.filter(c => c.type === "import")).toHaveLength(1)
})

test("csParse: extracts using", () => {
  const chunks = csParse("using System.Collections.Generic;", "test.cs")
  expect(chunks.filter(c => c.type === "import")).toHaveLength(1)
})

test("cppParse: extracts include", () => {
  const chunks = cppParse('#include <vector>\n#include "local.h"', "test.cpp")
  expect(chunks.filter(c => c.type === "import")).toHaveLength(2)
})

// === Format parsers ===
test("cssParse: extracts selectors", () => {
  const chunks = cssParse(".container { color: red; }\n#header { }", "test.css")
  expect(chunks.filter(c => c.type === "selector").length).toBeGreaterThanOrEqual(2)
  expect(chunks.some(c => c.name === ".container")).toBe(true)
  expect(chunks.some(c => c.name === "#header")).toBe(true)
})

test("cssParse: extracts custom properties and at-rules", () => {
  const chunks = cssParse("--primary: blue;\n@media screen { }", "test.css")
  expect(chunks.some(c => c.name === "--primary")).toBe(true)
  expect(chunks.some(c => c.name === "@media")).toBe(true)
})

test("htmlParse: extracts components", () => {
  const chunks = htmlParse("<Header />\n<UserProfile name='a'>\n<div>plain</div>", "test.html")
  expect(chunks.filter(c => c.type === "component").length).toBeGreaterThanOrEqual(2)
  expect(chunks.some(c => c.name === "Header")).toBe(true)
  expect(chunks.some(c => c.name === "UserProfile")).toBe(true)
})

test("htmlParse: extracts data-testid", () => {
  const chunks = htmlParse('<div data-testid="submit-btn">', "test.html")
  expect(chunks.some(c => c.name === "submit-btn")).toBe(true)
})

test("dataParse: extracts JSON keys", () => {
  const chunks = dataParse('{\n  "name": "test",\n  "version": "1.0"\n}', "test.json")
  expect(chunks.filter(c => c.type === "config").length).toBeGreaterThanOrEqual(2)
  expect(chunks.some(c => c.name === "name")).toBe(true)
  expect(chunks.some(c => c.name === "version")).toBe(true)
})

test("dataParse: extracts YAML keys", () => {
  const chunks = dataParse("name: test\nversion: 1.0\n", "test.yaml")
  expect(chunks.some(c => c.name === "name")).toBe(true)
  expect(chunks.some(c => c.name === "version")).toBe(true)
})

test("dataParse: extracts TOML sections", () => {
  const chunks = dataParse("[package]\nname = 'test'\n[dependencies]\n", "test.toml")
  expect(chunks.some(c => c.name === "package")).toBe(true)
  expect(chunks.some(c => c.name === "dependencies")).toBe(true)
})

test("sqlParse: extracts CREATE TABLE", () => {
  const chunks = sqlParse("CREATE TABLE users (id INT);", "test.sql")
  expect(chunks.filter(c => c.type === "table").length).toBeGreaterThanOrEqual(1)
  expect(chunks.some(c => c.name === "users")).toBe(true)
})

test("sqlParse: extracts FROM clauses", () => {
  const chunks = sqlParse("SELECT * FROM orders", "test.sql")
  expect(chunks.some(c => c.name === "orders")).toBe(true)
})

test("mdParse: extracts headings", () => {
  const chunks = mdParse("# Title\n## Section\n### Subsection", "test.md")
  expect(chunks.filter(c => c.type === "heading").length).toBeGreaterThanOrEqual(3)
  expect(chunks.some(c => c.name === "Title")).toBe(true)
  expect(chunks.some(c => c.name === "Section")).toBe(true)
  expect(chunks.some(c => c.name === "Subsection")).toBe(true)
})

// === PARSERS map ===
test("PARSERS: all extensions mapped", () => {
  const exts = [".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".java", ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs"]
  for (const ext of exts) {
    expect(PARSERS[ext]).toBeDefined()
  }
})