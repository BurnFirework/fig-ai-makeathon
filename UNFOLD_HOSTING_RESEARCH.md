# Unfold hosting and releases

## Deploy the website

| Address | Contents |
| --- | --- |
| `https://unfold.bezr.dev/` | Landing page with a board screenshot and desktop download links |
| `https://unfold.bezr.dev/app/` | Browser preview with local board storage |
| `https://unfold-downloads.bezr.dev/` | Host for versioned installer files linked from the landing page |

Run `pnpm build:site` from the repository root to build both web entry points into `output/site/`. The landing page builds at the root and Vite builds the browser app under `/app/`.

Sign in with `pnpm exec wrangler login`, then run `pnpm deploy`. [wrangler.jsonc](wrangler.jsonc) defines the Cloudflare Worker and custom domain. The Worker serves static assets. The browser uses sample conversations when its agent API is unavailable. After deploying, open the landing page and `/app/`, load a sample board, and check that it survives a reload. [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)

## Desktop releases

The [landing page](apps/landing/index.html) links directly to versioned files on the download host. Release commands build artifacts into `output/desktop-release/`. Upload the installers to the public download bucket and update the links to match the uploaded filenames. [Packaging script](apps/unfold/scripts/desktop-package.mjs) · [R2 custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)

### Apple Silicon

Use native Node.js on an Apple Silicon Mac with a Developer ID Application identity in Keychain. Configure a notarytool profile named `unfold-notary`. If multiple signing teams are available, set `CSC_NAME` to the release team's Team ID. [Apple distribution guide](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)

```sh
pnpm desktop:package:mac
```

Set `unfold_dmg` to the signed image produced by the build. The filename includes the version from the [app manifest](apps/unfold/package.json).

```sh
unfold_dmg=output/desktop-release/Unfold-0.1.1-arm64.dmg
xcrun notarytool submit "$unfold_dmg" --keychain-profile unfold-notary --wait
```

After Apple reports `Accepted`, staple the ticket and verify the image.

```sh
xcrun stapler staple "$unfold_dmg"
xcrun stapler validate "$unfold_dmg"
spctl --assess --type open --context context:primary-signature --verbose "$unfold_dmg"
```

### Linux x64

Run `pnpm desktop:package:linux` on x64 Linux with `binutils` and `xz-utils` installed. The command builds a Debian package and an AppImage. Install the Debian package with your package manager, or make the AppImage executable and run it directly.

Use the [desktop smoke checks](README.md#checks) to verify a packaged app. Check each public download URL after uploading an installer.
