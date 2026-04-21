# Style reference: flat-faceless-navy

The original Storyset/Freepik-adjacent flat vector style with faceless characters and a navy-slate palette. This is the **default** style reference for the `gemini-generate-illustration` skill — invoke it explicitly with `--style-ref flat-faceless-navy` if you want to be explicit.

## Character rules

When the subject includes a person (or `--character` is passed):

- Characters are **faceless** — NO eyes, NO mouth, NO nose
- Blank smooth skin-coloured face with only a dark hair silhouette shape
- Natural elegant proportions, slightly elongated limbs
- Like Freepik / Storyset faceless flat vector
- One character at a time unless explicitly requested otherwise

## Composition rules

- Clean background, generous negative space
- Centred composition, no clutter
- **No plants, no leaves, no decorative foliage** unless explicitly requested
- No text in the image

## Prompt template

Build the Gemini prompt as:

```
[SUBJECT DESCRIPTION]. The character has NO facial features —
completely blank smooth face with only dark hair silhouette.
[STYLE_DESCRIPTION]. Clean [BACKGROUND_COLOR] background.
No plants, no leaves. No text.

CHARACTER STYLE: [FACELESS_DESCRIPTION]
COLOR PALETTE (strict): [PALETTE_COLORS]
```

## Style description (default — `flat-faceless`)

> Modern flat vector illustration, faceless characters with no facial features, clean minimal style, smooth shapes, elegant poses, generous white space.

Other style sub-presets that may be selected via `--sub-style`:

- `textured-flat` — Textured flat editorial illustration with risograph grain overlay. Bold simplified geometric shapes, no realistic detail, no outlines. Generous negative space.
- `flat` — Simple flat vector illustration. Geometric shapes, solid bold colours, no shadows, no gradients, clean edges, minimal detail.
- `isometric` — Isometric vector illustration in 30-degree axonometric projection. Geometric precision, clean lines, bright colours.
- `line-art` — Clean line art illustration, outline only, no fill, single stroke weight, minimalist.
- `3d-rendered` — 3D rendered illustration with smooth stylised surfaces, soft shadows, matte plastic material, studio lighting.
- `claymation` — Claymation style 3D. Soft clay material, rounded playful forms, warm pastel colours, soft studio lighting.
- `duotone` — Duotone illustration using two colours only. High contrast, graphic poster style.
- `neubrutalist` — Thick black outlines, loud clashing bright colours, raw unpolished aesthetic, chunky offset drop shadows.

## Palette: navy-slate (default)

| Token | Hex |
|---|---|
| Deep Navy | `#001F3F` |
| Navy | `#002B45` |
| Muted Slate Blue | `#6B8EA4` |
| Soft Wash | `#D6E4ED` |
| Cool Cream background | `#EFF4F8` |
| Slate | `#64748B` |
| Pale Slate | `#94A3B8` |
| Harvest Gold (accents) | `#E8B64A` |

## Other selectable palettes

Pass `--palette <name>` to override the default `navy-slate`:

- **ocean** — Deep Ocean `#0B1D3A`, Marine `#1E3A5F`, Sky `#5B9BD5`, Seafoam `#A8D8EA`, Ice `#E8F4FD`, Coral accent `#FF6B6B`
- **sunset** — Deep Purple `#2D1B69`, Magenta `#E91E8C`, Coral `#FF6B6B`, Peach `#FFB088`, Gold `#FFD93D`
- **forest** — Deep Forest `#1B3A2D`, Pine `#2D5F3E`, Sage `#7D9B7A`, Moss `#A8C69F`, Amber `#D4A843`
- **monochrome** — Black `#1A1A1A`, Dark `#333`, Mid `#666`, Gray `#999`, Light `#CCC`, Accent `#3B82F6`
- **pastel** — Blush `#FFB5B5`, Lavender `#C4B5FD`, Mint `#A7F3D0`, Sky `#BAE6FD`, Butter `#FDE68A`

## Character variant attributes (vary for diversity)

- **Hair**: Short dark, long dark, short white/gray, bob cut white/gray, curly, bun
- **Clothing top**: Muted slate blue shirt, darker sweater, cardigan, t-shirt
- **Clothing bottom**: Dark navy pants, trousers
- **Accessories**: Glasses (thin dark frames on faceless face), none
- **Pose**: Standing, sitting, walking, arms crossed, holding object, pointing

## Examples

```
/gemini-generate-illustration "person holding a glowing lightbulb" --style-ref flat-faceless-navy --character

/gemini-generate-illustration "fish hook piercing an email envelope on a laptop" --style-ref flat-faceless-navy --sub-style textured-flat --aspect 4:3

/gemini-generate-illustration "older woman with white bob hair in welcoming pose" --style-ref flat-faceless-navy --character
```
