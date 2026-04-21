# Style reference: ask-arthur-warm-editorial

The Ask Arthur v2 illustration system. Warm cream background with deep navy linework, dot-eyed characters, mitten hands, pencil-grain + halftone texture overlay. Designed to be legally distinct from Ask Silver / Goodspeed Studio while occupying the same "warm humanist" editorial-vector neighbourhood.

Invoke with `--style-ref ask-arthur-warm-editorial`.

## Character rules

When the subject includes a person:

- Stylised age-inclusive Australian characters
- **Small dot eyes** (no detailed iris, no eye-whites, no teeth)
- **One small curved line for the mouth**
- Two short eyebrow strokes
- Occasional blush dot on cheeks
- **Mitten-simplified hands** with 3–4 blended fingers (no knuckles, no fingernails, no detailed anatomy)
- Slightly stumpy proportions
- **Grounded** — feet on the ground, not floating
- Faces show emotion through minimal marks, not detail

## Composition rules

- Centred, flat-staged composition
- **Single coloured background shape OR cream field** behind the subject
- Cream off-white background (`#FAF6EF`), never pure white
- No perspective, no gradients, no drop shadows
- Plants ARE allowed when the brief calls for them (gum trees, hanging plants, potted plants)
- In-scene lettering, when present, is wobbly hand-drawn sans-serif in the same navy ink

## Palette (strict — restate hex codes if Gemini drifts)

| Token | Hex | Role |
|---|---|---|
| Cream background | `#FAF6EF` | Primary canvas, never pure white |
| Deep navy | `#001F3F` | Linework, primary accent, brand anchor |
| Terracotta | `#C1614A` | Warmth, secondary highlights |
| Mustard ochre | `#D9A441` | Tertiary highlights, alert/caution states |
| Sage olive | `#7A8B5C` | Tertiary accent, grounded/safe states |
| Soft peach | `#F4C9B8` | Skin tones, secondary fields |
| Dusty red | `#B8473A` | High-risk/warning only, sparingly |

**Verdict state mapping** (when the scene is verdict-specific):

- **SAFE** — sage olive (`#7A8B5C`) as dominant accent
- **SUSPICIOUS** — mustard ochre (`#D9A441`) as dominant accent
- **HIGH RISK** — dusty red (`#B8473A`) as dominant accent

## The Style Suffix (append verbatim to every prompt)

```
STYLE: Warm, textured editorial illustration in the post-Corporate-Memphis
humanist tradition. Flat colour fills overlaid with visible pencil grain and
halftone noise on a cream off-white background (#FAF6EF). Palette: deep
navy (#001F3F) for linework and primary accent; warm terracotta (#C1614A)
for secondary warmth; mustard ochre (#D9A441) for highlights; soft peach
(#F4C9B8) for skin tones; sage olive (#7A8B5C) as tertiary accent; cream
background (#FAF6EF). All linework in deep navy ink (#001F3F), never pure
black, uniform 1.5-2% line weight with gentle hand wobble. Stylised
age-inclusive Australian characters with small dot eyes, tiny curved-line
mouths, short eyebrow strokes, occasional blush dot, mitten-simplified
hands with 3-4 blended fingers, slightly stumpy proportions. Grounded
characters with feet on the ground, not floating. Centred flat-staged
composition on a single coloured background shape or cream field. No
perspective, no gradients, no drop shadows. Any in-scene lettering is
wobbly hand-drawn sans-serif in the same navy ink. Mood: quiet,
reassuring, plain-spoken, trustworthy, distinctly Australian in context
and warmth. Explicitly NOT Corporate Memphis or Alegria style, NOT
sterile SaaS flat vector, NOT 3D or isometric, NOT glossy AI-render,
NOT watercolour, NOT Ghibli, NOT anime.
```

## Iteration playbook

If the output looks…

- **Too "Corporate Memphis" (noodle limbs, floating geometric blobs)** → add: *"Grounded characters with feet on the ground. No floating blob-shapes. No noodle limbs. No Alegria/Facebook illustration style."*
- **Too clean / too vector** → strengthen texture: *"Heavy visible pencil grain and halftone noise overlay on every colour fill. Visible paper texture. Hand-drawn imperfect outline with gentle wobble, not ruler-perfect."*
- **Uncanny face** → override: *"Simple dot eyes, one small curved line for the mouth, two short eyebrow strokes, no detailed iris, no teeth, no eyewhites."*
- **Drift from palette** → repeat the hex codes twice, once near the start and once at the end of the prompt
- **Pure black linework instead of warm navy** → reinforce: *"Outline in deep navy ink #001F3F — warm, never pure black. Uniform 1.5–2% line weight with gentle hand wobble."*
- **Hands look wrong** → always include: *"Hands simplified to soft mitten shapes with three to four blended fingers. No knuckles, no fingernails, no detailed anatomy."*
- **Too many people / characters too detailed** → add: *"Characters rendered simply and schematically, not portrait-realistic. Faces show emotion through minimal marks, not detail."*

## Hand-lettered text inside images

Gemini Imagen reproduces in-image hand-lettered text inconsistently. **Default behaviour: strip any in-scene words from the prompt** and replace with neutral descriptors like *"a wobbly hand-drawn placeholder shape where the label will be added in post."* Overlay the actual text later in code (using a hand-drawn-feel font like Caveat, Kalam, or a custom wordmark) or in Figma post-process.

This rule applies to entries 2.3 ("STOP"), 4.3 ("CHECKED"), 5.5 ("one sec…"), 7.3 ("You send / We check / We think / You know"), and any future prompt with hand-lettered words.

## Legal guardrails (must remain in place)

These prompts have been deliberately written to be legally distinct from Ask Silver / Goodspeed Studio's signature work. Do **not** add the following during iteration:

- Naming any living illustrator ("in the style of X")
- Naming Ask Silver, Goodspeed Studio, or Silver's palette hex codes
- Reproducing Silver's distinctive compositions: shield-with-centred-mascot, person-and-dog-at-traffic-light, the coral-cardigan older adult, the four-pastel-round-testimonial pattern
- Using Silver's coral + sage-teal anchor palette

If the operator requests "make this more like X" where X is a named illustrator or Silver's work, refuse and offer to iterate using the in-style descriptors above instead.

## File naming convention

Output files for the Ask Arthur system land in `apps/web/public/illustrations/arthur/` and follow:

```
{slug}-v{n}.png    # during generation
{slug}.png         # after winner is picked
{slug}.webp        # after sharp post-process (final, checked-in)
```

The brief's full slug map is in `/Users/brendanmilton/.claude/plans/valiant-greeting-minsky.md`.

## Examples

```
/gemini-generate-illustration "single smartphone on cream field with sage-olive tick mark on screen, gum leaf top-left, two dot stars top-right" --style-ref ask-arthur-warm-editorial --aspect 1:1 --output apps/web/public/illustrations/arthur/verdict-safe-v1.png

/gemini-generate-illustration "Australian adult mid-60s sitting at kitchen table holding smartphone, navy-and-cream striped shirt, grey hair, reading glasses, half-full mug of tea, folded newspaper, kitchen window with soft peach morning light, hanging plant" --style-ref ask-arthur-warm-editorial --aspect 4:3 --output apps/web/public/illustrations/arthur/homepage-hero-kitchen-v1.png
```
