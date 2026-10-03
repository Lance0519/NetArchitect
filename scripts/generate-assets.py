import os
from PIL import Image
import numpy as np

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
ANDROID_RES_DIR = os.path.join(BASE_DIR, 'android', 'app', 'src', 'main', 'res')

LOGO_PATH = os.path.join(ASSETS_DIR, 'NetArchitect_Logo.png')
BG_COLOR = (12, 27, 60) # #0C1B3C

def main():
    print(f"Loading logo from {LOGO_PATH}...")
    orig_logo = Image.open(LOGO_PATH).convert('RGBA')
    width, height = orig_logo.size
    
    # 1. Extract pure emblem (hexagon grid + shield) with transparent background
    arr = np.array(orig_logo, dtype=float)
    bg_np = np.array(BG_COLOR, dtype=float)
    
    y, x = np.ogrid[:height, :width]
    center_x, center_y = width / 2.0, height / 2.0
    dist_center = np.sqrt((x - center_x)**2 + (y - center_y)**2)
    
    diff = np.sqrt(np.sum((arr[:, :, :3] - bg_np)**2, axis=-1))
    inside_mask = (dist_center <= (width * 0.43)) # inside the circle
    
    # Soft alpha for clean anti-aliasing
    alpha = np.clip((diff - 25) / 30.0, 0, 1) * inside_mask
    
    emblem_arr = np.zeros_like(arr, dtype=np.uint8)
    emblem_arr[:, :, :3] = np.clip(arr[:, :, :3], 0, 255).astype(np.uint8)
    emblem_arr[:, :, 3] = (alpha * 255).astype(np.uint8)
    emblem_img = Image.fromarray(emblem_arr, 'RGBA')
    
    # Monochrome version of emblem (pure white with alpha)
    mono_arr = np.zeros_like(arr, dtype=np.uint8)
    mono_arr[:, :, :3] = 255 # Pure white
    mono_arr[:, :, 3] = (alpha * 255).astype(np.uint8)
    mono_img = Image.fromarray(mono_arr, 'RGBA')

    # 2. assets/icon.png (1024x1024 RGBA)
    # Flawless solid brand background #0C1B3C with glowing emblem centered
    icon_1024 = Image.new('RGBA', (1024, 1024), BG_COLOR + (255,))
    emblem_660 = emblem_img.resize((660, 660), Image.Resampling.LANCZOS)
    icon_1024.paste(emblem_660, ((1024 - 660) // 2, (1024 - 660) // 2), emblem_660)
    icon_path = os.path.join(ASSETS_DIR, 'icon.png')
    icon_1024.save(icon_path, 'PNG')
    print(f"Generated {icon_path}")

    # 3. assets/splash-icon.png (1024x1024 RGBA)
    splash_1024 = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    emblem_500 = emblem_img.resize((500, 500), Image.Resampling.LANCZOS)
    splash_1024.paste(emblem_500, ((1024 - 500) // 2, (1024 - 500) // 2), emblem_500)
    splash_path = os.path.join(ASSETS_DIR, 'splash-icon.png')
    splash_1024.save(splash_path, 'PNG')
    print(f"Generated {splash_path}")

    # 4. assets/android-icon-foreground.png (512x512 RGBA)
    # Sized for Android adaptive icon safe zone (341px diameter)
    fg_512 = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    emblem_330 = emblem_img.resize((330, 330), Image.Resampling.LANCZOS)
    fg_512.paste(emblem_330, ((512 - 330) // 2, (512 - 330) // 2), emblem_330)
    fg_path = os.path.join(ASSETS_DIR, 'android-icon-foreground.png')
    fg_512.save(fg_path, 'PNG')
    print(f"Generated {fg_path}")

    # 5. assets/android-icon-background.png (512x512 RGBA)
    bg_512 = Image.new('RGBA', (512, 512), BG_COLOR + (255,))
    bg_path = os.path.join(ASSETS_DIR, 'android-icon-background.png')
    bg_512.save(bg_path, 'PNG')
    print(f"Generated {bg_path}")

    # 6. assets/android-icon-monochrome.png (432x432 RGBA)
    mono_432 = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
    mono_270 = mono_img.resize((270, 270), Image.Resampling.LANCZOS)
    mono_432.paste(mono_270, ((432 - 270) // 2, (432 - 270) // 2), mono_270)
    mono_path = os.path.join(ASSETS_DIR, 'android-icon-monochrome.png')
    mono_432.save(mono_path, 'PNG')
    print(f"Generated {mono_path}")

    # 7. assets/favicon.png (48x48 RGBA)
    fav_48 = orig_logo.resize((48, 48), Image.Resampling.LANCZOS)
    fav_path = os.path.join(ASSETS_DIR, 'favicon.png')
    fav_48.save(fav_path, 'PNG')
    print(f"Generated {fav_path}")

    # 8. Android native drawable splashscreen_logo.png
    drawable_sizes = {
        'drawable-mdpi': 288,
        'drawable-hdpi': 432,
        'drawable-xhdpi': 576,
        'drawable-xxhdpi': 864,
        'drawable-xxxhdpi': 1152
    }
    for folder, size in drawable_sizes.items():
        out_dir = os.path.join(ANDROID_RES_DIR, folder)
        os.makedirs(out_dir, exist_ok=True)
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        emblem_sub = emblem_img.resize((int(size * 0.60), int(size * 0.60)), Image.Resampling.LANCZOS)
        offset = (size - emblem_sub.size[0]) // 2
        img.paste(emblem_sub, (offset, offset), emblem_sub)
        p = os.path.join(out_dir, 'splashscreen_logo.png')
        img.save(p, 'PNG')
        print(f"Generated {p}")

    # 9. Android native mipmap icons
    mipmap_densities = {
        'mipmap-mdpi': {'launcher': 48, 'adaptive': 108},
        'mipmap-hdpi': {'launcher': 72, 'adaptive': 162},
        'mipmap-xhdpi': {'launcher': 96, 'adaptive': 216},
        'mipmap-xxhdpi': {'launcher': 144, 'adaptive': 324},
        'mipmap-xxxhdpi': {'launcher': 192, 'adaptive': 432},
    }
    for folder, dims in mipmap_densities.items():
        out_dir = os.path.join(ANDROID_RES_DIR, folder)
        if not os.path.exists(out_dir):
            continue
        
        # Clean up any conflicting webp files that cause AAPT2 duplicate resource errors
        for stem in ['ic_launcher', 'ic_launcher_round', 'ic_launcher_background', 'ic_launcher_foreground', 'ic_launcher_monochrome']:
            webp_file = os.path.join(out_dir, f'{stem}.webp')
            if os.path.exists(webp_file):
                os.remove(webp_file)

        # ic_launcher.png (legacy square/rounded launcher icon)
        l_size = dims['launcher']
        ic_launcher = Image.new('RGBA', (l_size, l_size), BG_COLOR + (255,))
        l_emb = emblem_img.resize((int(l_size * 0.70), int(l_size * 0.70)), Image.Resampling.LANCZOS)
        l_off = (l_size - l_emb.size[0]) // 2
        ic_launcher.paste(l_emb, (l_off, l_off), l_emb)
        ic_launcher.save(os.path.join(out_dir, 'ic_launcher.png'), 'PNG')
        
        # ic_launcher_round.png (legacy circular launcher icon)
        round_logo = orig_logo.resize((l_size, l_size), Image.Resampling.LANCZOS)
        round_logo.save(os.path.join(out_dir, 'ic_launcher_round.png'), 'PNG')
        
        # ic_launcher_background.png
        a_size = dims['adaptive']
        bg_png = Image.new('RGBA', (a_size, a_size), BG_COLOR + (255,))
        bg_png.save(os.path.join(out_dir, 'ic_launcher_background.png'), 'PNG')
        
        # ic_launcher_foreground.png
        fg_png = Image.new('RGBA', (a_size, a_size), (0, 0, 0, 0))
        fg_sub = emblem_img.resize((int(a_size * 0.65), int(a_size * 0.65)), Image.Resampling.LANCZOS)
        fg_off = (a_size - fg_sub.size[0]) // 2
        fg_png.paste(fg_sub, (fg_off, fg_off), fg_sub)
        fg_png.save(os.path.join(out_dir, 'ic_launcher_foreground.png'), 'PNG')
        
        # ic_launcher_monochrome.png
        mono_png = Image.new('RGBA', (a_size, a_size), (0, 0, 0, 0))
        mono_sub = mono_img.resize((int(a_size * 0.65), int(a_size * 0.65)), Image.Resampling.LANCZOS)
        mono_off = (a_size - mono_sub.size[0]) // 2
        mono_png.paste(mono_sub, (mono_off, mono_off), mono_sub)
        mono_png.save(os.path.join(out_dir, 'ic_launcher_monochrome.png'), 'PNG')
        
        print(f"Generated {folder} assets")

if __name__ == '__main__':
    main()
