"""Generate the static landing illustration from the same boundaries as the games.
Run from the repository root: python3 scripts/generate-landing-art.py
The shipped SVG needs no JavaScript, WebGL context, or map-data request.
"""
import json
import math
from pathlib import Path

RADIUS = 250
CENTER = 300
lat0, lon0 = map(math.radians, [14, 12])


def project(point):
    lon, lat = map(math.radians, point)
    lon -= lon0
    x = math.cos(lat) * math.sin(lon)
    y = math.cos(lat0) * math.sin(lat) - math.sin(lat0) * math.cos(lat) * math.cos(lon)
    z = math.sin(lat0) * math.sin(lat) + math.cos(lat0) * math.cos(lat) * math.cos(lon)
    return (x, y, z)


def coord(point):
    return f'{CENTER + RADIUS * point[0]:.1f},{CENTER - RADIUS * point[1]:.1f}'


def ring_path(ring):
    points = [project(p) for p in ring]
    if not any(p[2] >= 0 for p in points):
        return ''
    clipped = []
    for a, b in zip(points, points[1:] + points[:1]):
        if a[2] >= 0:
            clipped.append(a)
        if (a[2] >= 0) != (b[2] >= 0):
            t = a[2] / (a[2] - b[2])
            x, y = a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])
            length = math.hypot(x, y)
            clipped.append((x / length, y / length, 0))
    if len(clipped) < 3:
        return ''
    path = ['M' + coord(clipped[0])]
    previous = clipped[0]
    for p in clipped[1:] + clipped[:1]:
        if p[2] == 0 and previous[2] == 0:
            a, b = math.atan2(previous[1], previous[0]), math.atan2(p[1], p[0])
            diff = (b - a + math.pi) % (2 * math.pi) - math.pi
            path.append(f'A{RADIUS},{RADIUS} 0 0,{0 if diff > 0 else 1} {coord(p)}')
        elif math.hypot(p[0] - previous[0], p[1] - previous[1]) * RADIUS < 0.65:
            continue
        else:
            path.append('L' + coord(p))
        previous = p
    return ''.join(path) + 'Z'


features = json.loads(Path('public/assets/world-map.json').read_text())
parts = ['''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" fill="none">
<defs>
<radialGradient id="ocean" cx=".32" cy=".25" r=".8"><stop stop-color="#416c59"/><stop offset=".7" stop-color="#254c3e"/><stop offset="1" stop-color="#17382e"/></radialGradient>
<radialGradient id="shade" cx=".3" cy=".2" r=".85"><stop offset=".3" stop-color="#f5ebbe" stop-opacity=".07"/><stop offset=".76" stop-color="#09261e" stop-opacity=".1"/><stop offset="1" stop-color="#09261e" stop-opacity=".65"/></radialGradient>
<linearGradient id="land" x2=".6" y2="1"><stop stop-color="#e4e5bd"/><stop offset="1" stop-color="#9bb387"/></linearGradient>
</defs>
<circle cx="300" cy="300" r="279" stroke="#809a80" stroke-opacity=".28"/>
<circle cx="300" cy="300" r="270" stroke="#809a80" stroke-opacity=".4" stroke-dasharray="1 7"/>
<circle cx="300" cy="300" r="250" fill="url(#ocean)"/>
<g fill="url(#land)" stroke="#2e5843" stroke-width=".6" stroke-linejoin="round">''']
for f in features:
    geom = f['geometry']
    polygons = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    path = ''.join(ring_path(r) for poly in polygons for r in poly)
    if path:
        parts.append(f'<path d="{path}" fill-rule="evenodd"/>')
parts.append('</g><g stroke="#deebcd" stroke-opacity=".14" stroke-width=".7">')
for line in ([[[lon, lat] for lon in range(-180, 181, 2)] for lat in range(-60, 61, 30)] +
             [[[lon, lat] for lat in range(-90, 91, 2)] for lon in range(-180, 180, 30)]):
    drawing = False
    path = ''
    for point in line:
        p = project(point)
        if p[2] >= 0:
            path += ('L' if drawing else 'M') + coord(p)
            drawing = True
        else:
            drawing = False
    parts.append(f'<path d="{path}"/>')
parts.append('''</g><circle cx="300" cy="300" r="250" fill="url(#shade)"/>
<path d="M168 201 Q331 92 396 337" stroke="#eabb7b" stroke-width="1.8" stroke-dasharray="4 6"/>
<g fill="#edbc7c" stroke="#224536" stroke-width="3"><circle cx="168" cy="201" r="6"/><circle cx="396" cy="337" r="6"/></g>
<g stroke="#8d9c7c" stroke-width="1"><path d="M300 8v17m0 550v17M8 300h17m550 0h17"/></g>
</svg>''')
Path('public/assets/landing/atlas-globe.svg').write_text('\n'.join(parts))
print('Generated atlas-globe.svg:', Path('public/assets/landing/atlas-globe.svg').stat().st_size, 'bytes')
