# Image fixtures

Each file is a solid-colour image generated on 2026-10-09 with `sharp@0.34.4` (libvips) from a throwaway script outside this repository, then measured by an independent oracle, `image-size@2.0.2`. Neither package is a dependency of `@effected/images`; they were installed only in a scratch directory to produce and check these files.

`expected.json` records the facts the oracle reported. Every image is non-square with distinct dimensions so a width/height swap or a cross-format mix-up fails a test.

| File | Format | Size | Encoder call | Notes |
| --- | --- | --- | --- | --- |
| `png.png` | png | 3×2 | `png()` | |
| `baseline.jpg` | jpeg | 5×3 | `jpeg({ progressive: false })` | SOF0 (`FF C0`) |
| `progressive.jpg` | jpeg | 7×4 | `jpeg({ progressive: true })` | SOF2 (`FF C2`) |
| `gif.gif` | gif | 9×5 | `gif()` | |
| `lossy.webp` | webp | 11×6 | `webp({ lossless: false })` | `VP8 ` chunk |
| `lossless.webp` | webp | 13×7 | `webp({ lossless: true })` | `VP8L` chunk |
| `alpha.webp` | webp | 15×8 | `webp({ lossless: false })` with an alpha channel | `VP8X` chunk |
| `avif.avif` | avif | 17×9 | `avif()` | `ispe` box |

To regenerate: install `sharp` and `image-size` at the versions above in an empty scratch directory, encode each row's image at its size, and confirm the oracle agrees before committing.
