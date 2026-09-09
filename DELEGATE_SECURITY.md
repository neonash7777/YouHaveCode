# Delegate Security

YouHaveCode models delegate permissions through named capability profiles. The
policy model exists now; loading and executing user delegate modules is not yet
implemented.

## Built-in profiles

- `restricted`: Unicode lookup, raster input, and YouHaveCode setting reads.
- `workspace-read`: restricted capabilities plus profile-storage reads, active
  selection reads, and workspace text reads.
- `full-access`: every capability, including command execution and process
  spawning. This is trusted extension-host execution, not a sandbox.

Custom profiles in `youhavecode.delegateProfiles` extend a built-in profile and
then apply `allow` and `deny` lists. Deny rules win.

```json
"youhavecode.delegateProfiles": {
  "local-writer": {
    "extends": "workspace-read",
    "allow": ["storage.profile.write"],
    "deny": ["workspace.text.read"],
    "limits": {
      "timeoutMs": 750,
      "memoryMb": 32,
      "maxOutputCells": 20000
    }
  }
}
```

## Execution design

Restricted delegates should run in a disposable worker backed by an isolate
such as QuickJS/WASM. The worker receives immutable input and can only request
operations from an extension-host capability broker. It must not receive the
`vscode` module, Node built-ins, `require`, dynamic imports, environment
variables, or direct filesystem/network/process handles.

The broker must validate every request against the resolved profile, enforce
Workspace Trust, cap input/output sizes, and terminate the worker at its time or
memory limit. Profile changes and delegate-module hash changes should require
fresh user confirmation.

`full-access` delegates necessarily run as trusted code with the extension's
authority. A Node worker or `vm` context does not make that authority safe; the
UI must clearly distinguish trusted full access from isolated capability-based
execution.