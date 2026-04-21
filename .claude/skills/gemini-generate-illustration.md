# gemini-generate-illustration

Generate web illustrations using the Gemini MCP image generation tool (`mcp__gemini__gemini-generate-image`). Style is pluggable via reference files in `gemini-generate-illustration/styles/` so the same orchestrator can render anything from clean Storyset-flat to warm hand-drawn editorial without hard-coding either look into the skill itself.

## Usage

```
/gemini-generate-illustration <subject>
  [--style-ref <name>]      # default: flat-faceless-navy
  [--sub-style <name>]      # only for flat-faceless-navy: textured-flat | flat | isometric | …
  [--palette <name>]        # only for flat-faceless-navy: ocean | sunset | forest | …
  [--aspect <ratio>]        # default: 4:3
  [--output <path>]         # default: project's public/ dir, descriptive filename
  [--character]             # include a character (semantics defined by the chosen style ref)
  [--no-plants]             # exclude foliage (default behaviour for flat-faceless-navy)
  [--variants <n>]          # number of separate calls; default 1, max 4
```

## Available style references

Each style reference lives in `~/.claude/skills/gemini-generate-illustration/styles/<name>.md` and is fully self-contained — read it in isolation to understand its character rules, palette, prompt-construction template, and iteration playbook.

| Name | Use when… |
|---|---|
| `flat-faceless-navy` (default) | You want a Storyset/Freepik-adjacent faceless flat vector look — clean, generic SaaS, no plants by default, navy-slate palette. |
| `ask-arthur-warm-editorial` | You're producing assets for the Ask Arthur project's v2 illustration system — warm cream + deep navy, dot-eyed characters, mitten hands, pencil-grain + halftone texture, plants allowed. |

To add a third style, drop a new self-contained file into `gemini-generate-illustration/styles/` and reference it via `--style-ref <new-name>`.

## Instructions

### 1. Parse the input

Pull the subject from the user's free-form first argument. Parse the named flags. If `--style-ref` is omitted, default to `flat-faceless-navy`.

### 2. Load the chosen style reference

Read `~/.claude/skills/gemini-generate-illustration/styles/<style-ref>.md`. If the file doesn't exist, list the available references and abort.

### 3. Build the Gemini prompt

Follow the prompt-construction template in the loaded style reference. Most references will:

- Take the user's subject as the scene description
- Append a fixed Style Suffix (or equivalent) verbatim
- Insert palette hex codes if `--palette` was set
- Apply character / plant / composition rules per the reference

Pass the assembled string into `mcp__gemini__gemini-generate-image` as `prompt`. Do NOT use the `style` field — Gemini's `style` field is keyword-only (e.g. "watercolor"), and most of our references use multi-clause specifications that need to live in `prompt`.

### 4. Generate

Invoke `mcp__gemini__gemini-generate-image` with:

- `prompt`: assembled string from step 3
- `aspectRatio`: from `--aspect` (default `4:3`)
- `imageSize`: `"2K"` unless the style reference specifies otherwise (e.g. favicon work uses `"4K"`)

If `--variants n` is set with `n > 1`, invoke the tool `n` times sequentially with the same prompt — Gemini has no native variants parameter; multiple calls produce different outputs.

If the call returns 503 / UNAVAILABLE, the upstream Imagen model is overloaded. Surface the error to the user and offer to retry rather than silently looping.

### 5. Save

Save each variant to the requested `--output` path (or `<project>/public/illustrations/<descriptive-slug>-v{n}.png` if `--output` is omitted). Variants get `-v1`, `-v2`, … suffixes during generation; the winner gets renamed to drop the suffix at promotion time.

### 6. Post-process (WebP conversion)

After the user picks a winner, convert PNG → WebP using `sharp` (already a Next.js dependency in most of this user's projects):

```javascript
const sharp = require('sharp');
await sharp('input.png').webp({ quality: 85 }).toFile('output.webp');
```

For batch conversion, prefer invoking the `optimize-images` skill instead of inlining sharp — it handles directory scanning, size reporting, and codebase reference updates.

Delete the source `.png` once the `.webp` is verified to load.

### 7. Report

Tell the user:
- Path to each generated variant
- Approximate file size
- A reminder of which iteration tweak from the style reference's playbook to try if the output missed (e.g. "if it looks too clean, re-invoke with `--iteration too-clean` to add the texture-strengthening clause")

## Examples

```
# Default style (flat-faceless), 4:3 illustration of a faceless person
/gemini-generate-illustration "person holding a glowing lightbulb" --character

# Same skill, switched to the Ask Arthur warm editorial reference
/gemini-generate-illustration "single smartphone on cream field with sage-olive tick mark on screen, gum leaf top-left, two dot stars top-right" \
  --style-ref ask-arthur-warm-editorial \
  --aspect 1:1 \
  --output apps/web/public/illustrations/arthur/verdict-safe-v1.png

# Flat-faceless with a custom palette
/gemini-generate-illustration "fish hook piercing an email envelope on a laptop" \
  --style-ref flat-faceless-navy \
  --sub-style textured-flat \
  --palette forest \
  --aspect 4:3
```

## Why two style references?

The original incarnation of this skill baked one specific look (faceless / navy-slate / no-plants) into the orchestrator. That worked fine when every project wanted the same Storyset-adjacent feel. Once a project wants something genuinely different — like Ask Arthur's warm hand-drawn editorial style with eyes, plants, and a different palette — overriding the defaults inline becomes noisy and error-prone.

Splitting style into reference files means: (a) the skill itself stays small and focused on the Gemini call mechanics, (b) adding a new style is a single file drop with no orchestrator changes, and (c) the operator can read either reference in isolation to see exactly what conventions it enforces.
