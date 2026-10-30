# Releasing

1. Raise the version in `packages/core/package.json`, `packages/core/src/version.ts`, `packages/cli/package.json` and `apps/desktop/package.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The [release workflow](../.github/workflows/release.yml) builds the desktop app on macOS, Windows and Linux and uploads it to a **draft** GitHub release, publishes the command line to npm and the container image to `ghcr.io`.
4. Check the draft, write the notes, publish it. The desktop app finds the update on its next start.
5. Publishing starts the [website workflow](../.github/workflows/website.yml): it downloads the files of the release, builds imaptransfer.com with them and uploads it to mittwald. The download buttons and checksums then show the new version. See [apps/website/README.md](../apps/website/README.md#deploy).

## Merging

Every commit on `main` carries GitHub's address without a mailbox, `48350772+sebastian-scherhans@users.noreply.github.com`; a ruleset on GitHub refuses any other. Commits made here get it from the global Git setting, and with *Keep my email addresses private* switched on a squash merge on GitHub uses it too:

```sh
gh pr merge <number> --squash --repo sebastian-scherhans/imaptransfer
```

## Secrets and variables

Without them the workflow still runs; the builds are then unsigned and nothing goes to npm.

| Name | Kind | Purpose |
| --- | --- | --- |
| `IMAPTRANSFER_MICROSOFT_CLIENT_ID` | variable | Microsoft sign-in, see [microsoft-oauth.md](microsoft-oauth.md) |
| `MAC_CERTIFICATE_BASE64`, `MAC_CERTIFICATE_PASSWORD` | secret | *Developer ID Application* certificate as base64 `.p12` |
| `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | secret | App Store Connect API key for notarization |
| `MICROSOFT_STORE_IDENTITY_NAME`, `MICROSOFT_STORE_PUBLISHER`, `MICROSOFT_STORE_PUBLISHER_NAME` | variable | *Package/Identity/Name*, *Package/Identity/Publisher* and *Package/Properties/PublisherDisplayName* from Partner Center, see [Microsoft Store](#microsoft-store) |
| `NPM_TOKEN` | secret | Publishing `imaptransfer` and `@imaptransfer/core` |

### Why signing matters

macOS refuses to open an unsigned, unnotarized app without a detour through the system settings, and Windows shows a warning for unsigned installers. For a tool meant to be easy, both are needed:

- **macOS:** an Apple Developer Program membership (99 USD a year) gives the Developer ID certificate and the API key for notarization.
- **Windows:** open-source projects can get free signing from the [SignPath Foundation](https://signpath.org). SignPath signs in its own pipeline step instead of through `CSC_LINK`; when the project is accepted, add their GitHub Action after the packaging step. A purchased certificate no longer comes as a file: since June 2023 the private key has to stay in hardware or a cloud service, so it would need that provider's own signing step too. A signature alone does not end the SmartScreen warning, that takes reputation.

## Microsoft Store

The Store signs its package itself, and Windows shows no warning for it. Set the three `MICROSOFT_STORE_*` variables, and every release tag also builds `.appx` packages for x64 and arm64. They do not go on the release: download them from the workflow run (artifact `microsoft-store`) and upload them in Partner Center.

The Store package updates through the Store. It never contacts GitHub, and it has no update setting. In Partner Center, choose *MSIX or PWA app*, not *EXE or MSI app*, and explain the `runFullTrust` capability as: a desktop app built with Electron that needs regular file and network access.

The tiles live in `apps/desktop/build/appx`; `pnpm --filter imaptransfer-desktop store-icons` draws them anew from the app icon.

## Local builds

```sh
pnpm build
pnpm --filter imaptransfer-desktop dist        # installers for the current system, in release/ at the root
pnpm --filter imaptransfer-desktop dist:dir    # unpacked app only, quicker
```
