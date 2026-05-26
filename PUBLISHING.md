# Publishing `@perhapxin/dddk` to npm

Operational runbook for cutting and shipping a release of the `@perhapxin/dddk`
package on npm. Everything here is reversible up to step 7 (the `npm publish`
call) — after that, the version is taken on npm forever and you can only ship
a NEW version to fix it.

## One-time setup

Already done — skip ahead unless you're rotating accounts or onboarding a new
maintainer.

### 1. npm organisation

`perhapxin` is registered on npm. The package name `@perhapxin/dddk` is taken
by this org. New maintainers need to be invited via:

```bash
npm org set perhapxin <username> developer
```

(or `admin` for senior maintainers — admins can publish, edit org settings,
invite others).

### 2. Automation token

Persistent CI / scripted publishes use an **Automation** token (not a
"Publish" token — Automation tokens skip 2FA, which is what you want for
scripts; Publish tokens require an interactive 2FA code per call).

Generate at <https://www.npmjs.com/settings/perhapxin/tokens> → "Generate New
Token" → **Automation** → name it `dddk-publish-auto` (or similar) → copy.

Then in your shell — **once** — write it into `~/.npmrc`:

```bash
echo "//registry.npmjs.org/:_authToken=npm_XXXXXXXXXXXXXXXXXXXXXXXX" >> ~/.npmrc
```

(Replace `npm_XXX...` with the actual token. The leading `//registry.npmjs.org/:` matters — that's npm's auth-scope marker.)

Verify with:

```bash
npm whoami
# → should print: perhapxin
```

If it prints a different user, your global `~/.npmrc` already has a conflicting
token at the top — move yours up.

### 3. `publishConfig.access: "public"`

Already in `package.json`. Without this, `npm publish` on a scoped package
defaults to `restricted` (private — only paying npm Pro accounts) and fails
with a 402. We pin it to `public` so the package is freely installable.

```json
"publishConfig": {
  "access": "public"
}
```

Do NOT remove this. If you ever DO want a private package, change to
`"restricted"` and bump the org plan.

## Pre-publish checklist (every release)

Run from `dddk/` (the package directory), NOT the workspace root.

### 1. Working tree is clean

```bash
git status
# should print: nothing to commit, working tree clean
```

If you have uncommitted changes, commit them first. `npm publish` packs from
the working tree, so any forgotten edit ships to users.

### 2. You're on `main` and pulled

```bash
git checkout main
git pull
```

Releases come off `main`. Branch releases are possible but generally a sign
something's wrong with your branching model — fix that first.

### 3. Version is bumped

```bash
# Look at what users CURRENTLY have:
npm view @perhapxin/dddk version

# Compare to local:
node -p "require('./package.json').version"
```

Local must be strictly greater. Use [semver](https://semver.org):

| Change | Bump | Example |
|---|---|---|
| Bug fix, no behaviour change to public API | patch | `0.1.0` → `0.1.1` |
| New feature, additive only | minor | `0.1.0` → `0.2.0` |
| Removed API, renamed export, behaviour-breaking | major | `0.1.0` → `1.0.0` |
| Pre-1.0 with risky breakage | minor (treat 0.x as "still moving") | `0.1.0` → `0.2.0` |

Bump in `package.json`, or use:

```bash
npm version patch    # bumps + commits + tags in one shot
npm version minor
npm version major
```

`npm version` writes a commit + git tag `v0.1.1` automatically. If you'd
rather control the commit message yourself, edit `package.json` by hand and
commit manually.

### 4. README is current

```bash
# Eyeball the README:
cat README.md | head -50
```

It's what users see on npm.js. Screenshots / version-pinned URLs that have
moved will look broken on the public listing.

### 5. Type-check + build

```bash
pnpm typecheck
# → no output = pass

pnpm build
# → writes dist/
```

Open `dist/index.js` for a sanity peek — make sure tsup actually produced
something sensible (not empty, not 50KB when you expected 500KB).

### 6. Dry run the publish

```bash
npm publish --dry-run
```

Reads `package.json`'s `files` field, builds the tarball, prints what would
ship — but DOES NOT upload. Look for:

- `📦 @perhapxin/dddk@0.1.0` — the version is what you expect
- File list — should be `dist/**`, `README.md`, `LICENSE`. NO `src/`, NO
  `.env`, NO `node_modules`.
- `package size` and `unpacked size` — sanity check (should be tens to low
  hundreds of KB, not multi-MB unless you're shipping bundled assets).

If something unexpected is in the tarball, fix `files` in `package.json` or
add a `.npmignore`. Don't ship secrets.

## Publishing

```bash
npm publish
```

That's it. If you wired the automation token correctly, no prompts, no 2FA.

Output looks like:

```
+ @perhapxin/dddk@0.1.0
```

Verify the release landed:

```bash
npm view @perhapxin/dddk
# → prints registry metadata: version, license, deps, etc.
```

And the package page goes live at <https://www.npmjs.com/package/@perhapxin/dddk>
(may take 30-60s for CDN to refresh).

## Post-publish

### 1. Push the version commit + tag

If you used `npm version` it already created a commit + tag, just push:

```bash
git push
git push --tags
```

If you edited `package.json` by hand:

```bash
git add package.json
git commit -m "Release v0.1.1"
git tag v0.1.1
git push
git push --tags
```

### 2. Cut a GitHub release

Either via web UI (`https://github.com/PerhapxinLab/dotdotduck/releases/new`) or
CLI:

```bash
gh release create v0.1.1 \
  --title "v0.1.1" \
  --notes "## Fixes\n- Web Speech IME on Edge\n- Dwell cross-page leak"
```

Use the GitHub release notes for **human-readable** changelog. The npm tarball
itself doesn't have one — users read the release notes when they bump.

### 3. Bump the demo site

`dddk-frontend` is a workspace dependency (`@perhapxin/dddk: workspace:^`) —
it always tracks local source. No version bump needed there for the demo to
pick up the new code.

For OTHER consumers (your own non-workspace apps, customers), they pin a
real version. Tell them to:

```bash
pnpm up @perhapxin/dddk@latest
# or pin a specific minor:
pnpm up @perhapxin/dddk@^0.2.0
```

## Troubleshooting

### `403 Forbidden — You do not have permission to publish`

Either:
- `npm whoami` returns the wrong user → fix `~/.npmrc`
- You're not in the `perhapxin` org → ask an admin to invite you
- The exact version `X.Y.Z` is already taken → bump and retry

### `402 Payment Required`

`publishConfig.access` defaults to `restricted` for scoped packages → npm
treats it as a private package and demands a Pro subscription. Set
`"access": "public"` in `package.json` (already done) or pass
`--access public` on the command line.

### `npm ERR! code E404`

Usually means the package doesn't exist on the registry yet AND you're trying
to do an op (deprecate, unpublish, view) that needs a published version.
Publish first.

### `code EBUSY` / `EPERM` on Windows

Some other process (dev server, vite watch, antivirus scan) is holding files
in `dist/`. Stop it and retry. If it persists, `rm -rf dist && pnpm build`.

### Accidentally published a broken version

Within 72 hours you can unpublish:

```bash
npm unpublish @perhapxin/dddk@0.1.1
```

After 72 hours it's permanent — the only recourse is to publish a fixed
version (`0.1.2`) and add a `deprecated` note to the broken one:

```bash
npm deprecate @perhapxin/dddk@0.1.1 "Broken — please upgrade to 0.1.2+"
```

Either way, tell users in the GitHub release notes / Discussions.

## Notes

- We do NOT use `prepublishOnly` / `prepack` hooks intentionally — those run
  builds automatically and have surprised people with "I committed a stale
  dist". The flow above does the build manually so you SEE it pass.
- The `files` field in `package.json` is the source of truth for what gets
  packed. `.npmignore` is supported but adds an extra place to look — we
  prefer the allowlist style.
- `peerDependencies` for `react` is marked optional — the SDK works without
  React. Don't move it to `dependencies` "for convenience"; that would force
  the install on every consumer including Vue / Svelte / vanilla.

---

Source of truth for this doc: `dddk/PUBLISHING.md`. If the runbook drifts from
reality, update this file in the same PR that changed the build / publish
pipeline.
