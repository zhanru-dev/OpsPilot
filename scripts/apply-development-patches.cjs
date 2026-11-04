// Only development tools depend on deepmerge. Production --omit=dev installs do
// not contain patch-package or the vulnerable package; do not add either there.
const { spawnSync } = require("node:child_process");
let executable;
try {
  executable = require.resolve("patch-package/index.js");
} catch (error) {
  if (error.code === "MODULE_NOT_FOUND") process.exit(0);
  throw error;
}
const result = spawnSync(process.execPath, [executable, "--error-on-fail"], {
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
