# optimize-images

Batch convert and optimize images in a project for web performance.

## Usage

```
/optimize-images [path] [--format webp|avif|png] [--quality 80] [--max-width 1200]
```

## Instructions

### 1. Scan for images

If no path given, scan the current project's `public/` directory. Find all `.jpg`, `.jpeg`, `.png` files.

### 2. Convert using sharp

Run this Node.js script (sharp is commonly available in Node projects):

```javascript
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dir = '<TARGET_DIR>';
const format = '<FORMAT>'; // webp, avif, or png
const quality = <QUALITY>; // 60-95, default 80

const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));

(async () => {
  let totalOld = 0, totalNew = 0;
  for (const f of files) {
    const src = path.join(dir, f);
    const ext = format === 'avif' ? '.avif' : format === 'png' ? '.png' : '.webp';
    const dst = path.join(dir, f.replace(/\.(jpg|jpeg|png)$/i, ext));
    const oldSize = fs.statSync(src).size;

    const img = sharp(src);
    if (format === 'webp') await img.webp({ quality }).toFile(dst);
    else if (format === 'avif') await img.avif({ quality }).toFile(dst);
    else await img.png({ quality }).toFile(dst);

    const newSize = fs.statSync(dst).size;
    totalOld += oldSize;
    totalNew += newSize;
    console.log(`${f}: ${(oldSize/1024).toFixed(0)}KB → ${(newSize/1024).toFixed(0)}KB (${((1-newSize/oldSize)*100).toFixed(0)}% savings)`);
  }
  console.log(`\nTotal: ${(totalOld/1024/1024).toFixed(1)}MB → ${(totalNew/1024/1024).toFixed(1)}MB (${((1-totalNew/totalOld)*100).toFixed(0)}% savings)`);
})();
```

### 3. Update references

After conversion, search the codebase for references to the old file extensions and update them:

```bash
grep -r "\.jpg\|\.jpeg\|\.png" --include="*.ts" --include="*.tsx" --include="*.css" --include="*.md" src/ app/ lib/ components/
```

Replace `.jpg` / `.png` references with the new format in all code files.

### 4. Clean up

Remove the original files after confirming the new ones work:
```bash
rm -f <DIR>/*.jpg <DIR>/*.jpeg <DIR>/*.png
```

### 5. Report

Tell the user:
- Number of images converted
- Total size before and after
- Percentage savings
- Files that reference old extensions (if any remain)

## Format Recommendations

| Format | Best For | Typical Savings vs JPG |
|--------|----------|----------------------|
| WebP | General use, broadest support | 80-97% |
| AVIF | Maximum compression, modern browsers | 85-98% |
| PNG | Screenshots, diagrams with text | Varies |

Default to **WebP quality 80** — best balance of compatibility and compression.
