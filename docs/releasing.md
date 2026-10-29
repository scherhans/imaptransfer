# Releasing

1. Raise the version in `packages/core/package.json`, `packages/core/src/version.ts`, `packages/cli/package.json` and `apps/desktop/package.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The [release workflow](../.github/workflows/release.yml) builds the desktop app on macOS, Windows and Linux and uploads it to a **draft** GitHub release, publishes the command line to npm and the container image to `ghcr.io`.
4. Check the draft, write the notes, publish it. The desktop app finds the update on its next start.
5. Publishing starts the [website workflow](../.github/workflows/website.yml): it downloads the files of the release, builds imaptransfer.com with them and uploads it to mittwald. The download buttons and checksums then show the new version. See [apps/website/README.md](../apps/website/README.md#deploy).

## Secrets and variables

Without them the workflow still runs; the builds are then unsigned and nothing goes to npm.

| Name | Kind | Purpose |
| --- | --- | --- |
| `IMAPTRANSFER_MICROSOFT_CLIENT_ID` | variable | Microsoft sign-in, see [microsoft-oauth.md](microsoft-oauth.md) |
| `MAC_CERTIFICATE_BASE64`, `MAC_CERTIFICATE_PASSWORD` | secret | *Developer ID Application* certificate as base64 `.p12` |
| `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | secret | App Store Connect API key for notarization |
| `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD` | secret | Code signing certificate as base64 `.pfx` |
| `NPM_TOKEN` | secret | Publishing `imaptransfer` and `@imaptransfer/core` |

### Why signing matters

macOS refuses to open an unsigned, unnotarized app without a detour through the system settings, and Windows shows a warning for unsigned installers. For a tool meant to be easy, both are needed:

- **macOS:** an Apple Developer Program membership (99 USD a year) gives the Developer ID certificate and the API key for notarization.
- **Windows:** open-source projects can get free signing from the [SignPath Foundation](https://signpath.org). SignPath signs in its own pipeline step instead of through `CSC_LINK`; when the project is accepted, add their GitHub Action after the packaging step. A purchased certificate works with the secrets above.

## Local builds

```sh
pnpm build
pnpm --filter imaptransfer-desktop dist        # installers for the current system, in release/ at the root
pnpm --filter imaptransfer-desktop dist:dir    # unpacked app only, quicker
```
