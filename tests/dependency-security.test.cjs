const { test } = require("node:test");
const assert = require("node:assert/strict");
const merge = require("deepmerge");

test("deepmerge backport preserves ordinary merges without target or source prototype poisoning", () => {
  assert.deepEqual(
    merge({ a: [1], b: { one: 1 } }, { a: [2], b: { two: 2 } }),
    { a: [1, 2], b: { one: 1, two: 2 } },
  );
  for (const [target, source] of [
    [JSON.parse('{"__proto__":{"inheritedMarker":true}}'), {}],
    [Object.create(null), JSON.parse('{"__proto__":{"inheritedMarker":true}}')],
    [{}, { nested: JSON.parse('{"__proto__":{"inheritedMarker":true}}') }],
  ]) {
    const result = merge(target, source);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.inheritedMarker, undefined);
    if (result.nested) {
      assert.equal(Object.getPrototypeOf(result.nested), Object.prototype);
      assert.equal(result.nested.inheritedMarker, undefined);
    }
  }
  assert.equal({}.inheritedMarker, undefined);
});

test("modern glob/minimatch consumers resolve patched releases; legacy API stays intact", () => {
  const { createRequire } = require("node:module");
  const api = createRequire(
    require("node:path").resolve(__dirname, "../apps/api/package.json"),
  );
  const cli = createRequire(api.resolve("@nestjs/cli/package.json"));
  const glob = createRequire(cli.resolve("glob/package.json"));
  assert.equal(cli("glob/package.json").version, "14.0.3");
  assert.equal(glob("minimatch/package.json").version, "11.0.4");
  // Older ESLint/plugins need the callable v3 API. It has no optimizationLevel>=2
  // preprocessing at the centre of GHSA-g3hv-75wg-m249; do not force a breaking alias.
  const eslint = createRequire(api.resolve("eslint/package.json"));
  const legacy = eslint("minimatch");
  assert.equal(typeof legacy, "function");
  assert.equal(
    typeof legacy.Minimatch.prototype.firstPhasePreProcess,
    "undefined",
  );
  assert.equal(legacy("src/one.ts", "src/*.ts"), true);
});
