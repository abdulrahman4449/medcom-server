# assets/

The source images Capacitor's asset generator builds every app icon and launch
screen from, for both platforms:

```
npm install -D @capacitor/assets
npx capacitor-assets generate
```

That writes the iOS `AppIcon.appiconset`, the Android mipmaps and adaptive
icons, and the launch screens. Run `npx cap sync` afterwards.

## Why these files and not the ones in public/brand/

`public/brand/pulseops-1024.png` is the artwork with **transparent corners** —
right for a web page, wrong for an app icon. iOS requires an icon with no
alpha channel at all, and a transparent corner renders as black on a home
screen. `icon.png` here is the same artwork flattened onto the plate navy
(#091E3D), fully opaque, with the rounded corners filled in so the mask each
platform applies has something to cut.

Regenerate it from the brand file with Pillow:

```python
from PIL import Image
src = Image.open('public/brand/pulseops-1024.png').convert('RGBA')
plate = Image.new('RGBA', src.size, (9, 30, 61, 255))
plate.alpha_composite(src)
plate.convert('RGB').save('assets/icon.png', 'PNG')   # convert() drops the alpha
```
