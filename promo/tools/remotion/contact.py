"""Contact sheets from a folder of fNNNN.png stills: 5 per row, 2 rows, labelled with time.
Usage: contact.py <stills_dir> <out_dir> [words.json to mark sentence starts]"""
import sys, glob, os, json
from PIL import Image, ImageDraw, ImageFont
src, dst, fps = sys.argv[1], sys.argv[2], 60
starts = {}
if len(sys.argv) > 3:
    words = json.load(open(sys.argv[3]))
    starts = {round(s['start']*fps): s['index'] for s in words['sentences']}
files = sorted(glob.glob(f'{src}/f*.png'))
os.makedirs(dst, exist_ok=True)
f = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 26)
per, cols = 10, 5
for k in range(0, len(files), per):
    batch = files[k:k+per]
    w, h = Image.open(batch[0]).size
    sheet = Image.new('RGB', (cols*w, 2*(h+40)), 'white')
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(batch):
        fr = int(os.path.basename(p)[1:5]); x, y = (i % cols)*w, (i//cols)*(h+40)
        sheet.paste(Image.open(p).convert('RGB'), (x, y+40))
        tag = f't={fr/fps:.2f}s' + (f'  S{starts[fr]} start' if fr in starts else '')
        d.text((x+8, y+6), tag, fill='black', font=f)
        d.rectangle([x, y+40, x+w-1, y+40+h-1], outline='black')
    sheet.save(f'{dst}/sheet{k//per:02d}.png')
print(len(files), 'stills ->', (len(files)+per-1)//per, 'sheets')
