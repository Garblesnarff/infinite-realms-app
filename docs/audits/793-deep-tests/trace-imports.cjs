const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const baseline = path.resolve(process.argv[2]);
const app = path.join(baseline, "ai-adventure-scribe-main");
const candidate = path.resolve(process.argv[3]);
const ts = require(path.join(app, "node_modules/typescript"));
const files = cp
  .execFileSync("git", ["ls-files"], { cwd: app, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => /\.[cm]?[jt]sx?$/.test(f));
const all = new Set(files.map((f) => path.resolve(app, f)));
const graph = new Map(),
  unresolved = [],
  nonliteral = [];
const options = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  allowJs: true,
  jsx: ts.JsxEmit.ReactJSX,
  baseUrl: app,
  paths: { "@/*": ["src/*"] },
};
const rel = (f) => path.relative(app, f);
const isTest = (f) =>
  /(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:test|spec|vitest)\.[jt]sx?$/.test(
    rel(f),
  );
function resolve(spec, source) {
  if (spec === "node:async_hooks" && rel(source).startsWith("src/"))
    return path.join(app, "src/lib/stubs/async-hooks.ts");
  let hit = ts.resolveModuleName(spec, source, options, ts.sys).resolvedModule
    ?.resolvedFileName;
  if (hit && all.has(path.resolve(hit))) return path.resolve(hit);
  if (spec.startsWith(".") || spec.startsWith("@/")) {
    const base = spec.startsWith("@/")
      ? path.join(app, "src", spec.slice(2))
      : path.resolve(path.dirname(source), spec);
    for (const file of [
      base,
      base.replace(/\.[cm]?jsx?$/, ".ts"),
      base.replace(/\.[cm]?jsx?$/, ".tsx"),
      base + ".ts",
      base + ".tsx",
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ])
      if (all.has(file)) return file;
    if (
      !/\.(?:json|css|svg|png|webp|jpe?g|woff2?|html|mp3|ogg|wasm)(?:\?|$)/.test(
        spec,
      )
    )
      unresolved.push({ source: rel(source), spec });
  }
}
for (const file of all) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const edges = new Set();
  graph.set(file, edges);
  function add(value) {
    const dest = resolve(value, file);
    if (dest) edges.add(dest);
  }
  function visit(n) {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteralLike(n.moduleSpecifier)
    )
      add(n.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(n) &&
      ts.isLiteralTypeNode(n.argument) &&
      ts.isStringLiteralLike(n.argument.literal)
    )
      add(n.argument.literal.text);
    if (
      ts.isImportEqualsDeclaration(n) &&
      ts.isExternalModuleReference(n.moduleReference) &&
      n.moduleReference.expression &&
      ts.isStringLiteralLike(n.moduleReference.expression)
    )
      add(n.moduleReference.expression.text);
    if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === "require"))
    ) {
      if (n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]))
        add(n.arguments[0].text);
      else
        nonliteral.push({ source: rel(file), expression: n.getText(source) });
    }
    if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "URL" &&
      n.arguments?.[0] &&
      ts.isStringLiteralLike(n.arguments[0]) &&
      /\.[jt]sx?$/.test(n.arguments[0].text)
    )
      add(n.arguments[0].text);
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(source).startsWith("import.meta.glob")
    )
      nonliteral.push({ source: rel(file), expression: n.getText(source) });
    ts.forEachChild(n, visit);
  }
  visit(source);
}
const roots = [
  "src/main.tsx",
  "src/blog-client.ts",
  "src/landing-client.ts",
  "src/workers/vision-worker.ts",
  "src/workers/kokoro-worker.ts",
  "server-bun/src/index.ts",
  "cli/src/index.ts",
].map((f) => path.join(app, f));
const seen = new Set();
function walk(f) {
  if (seen.has(f)) return;
  seen.add(f);
  for (const q of graph.get(f) || []) walk(q);
}
roots.forEach(walk);
const baselineSha = cp
  .execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: baseline,
    encoding: "utf8",
  })
  .trim();
const deleted = cp
  .execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=D", baselineSha],
    { cwd: candidate, encoding: "utf8" },
  )
  .trim()
  .split("\n")
  .filter((f) => f.startsWith("ai-adventure-scribe-main/"))
  .map((f) => f.slice("ai-adventure-scribe-main/".length));
const deletionAudit = deleted.map((f) => {
  const full = path.join(app, f);
  return {
    file: f,
    isTest: isTest(full),
    reachable: seen.has(full),
    inbound: [...graph]
      .filter(([, edges]) => edges.has(full))
      .map(([p]) => ({
        file: rel(p),
        isTest: isTest(p),
        reachable: seen.has(p),
      })),
  };
});
const data = {
  baseline: baselineSha,
  roots: roots.map(rel),
  files: all.size,
  reachable: seen.size,
  deletions: deletionAudit,
  productionNonliteral: nonliteral.filter(
    (x) => !isTest(path.join(app, x.source)),
  ),
  productionUnresolved: unresolved.filter(
    (x) => !isTest(path.join(app, x.source)),
  ),
};
console.log(JSON.stringify(data, null, 2));
