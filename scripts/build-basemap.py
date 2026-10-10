"""
Builds src/data/basemap.ts, the free base map under the speed map: Singapore's coastline, the
ten expressways and town names from OpenStreetMap (© OpenStreetMap contributors, ODbL).
Pre-projected into the speed map's frame (MAP_BOUNDS in SpeedBandMap.tsx) and simplified, so it
ships with the app and needs no tile server at run time.

Run: python3 scripts/build-basemap.py   (fetches from the Overpass API, about a minute)
"""
import json, math, sys, time, urllib.parse, urllib.request

OVERPASS = 'https://overpass-api.de/api/interpreter'
UA = 'TrafficPulse-map-build/1.0 (github.com/Mikazukiangus/live-traffic)'
QUERIES = {
    'coast': '[out:json][timeout:120];way["natural"="coastline"](1.00,103.20,1.75,104.45);out geom;',
    'roads': '[out:json][timeout:120];area["ISO3166-1"="SG"][admin_level=2]->.sg;way["highway"="motorway"](area.sg);out tags geom;',
    'places': '[out:json][timeout:60];area["ISO3166-1"="SG"][admin_level=2]->.sg;node["place"~"^(town|suburb|city|quarter)$"](area.sg);out;',
}

def overpass(query):
    for attempt in range(4):
        req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({'data': query}).encode(),
                                     headers={'User-Agent': UA, 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)['elements']
        except Exception as e:  # Overpass is often busy; wait and retry
            print('Overpass busy, retrying:', e, file=sys.stderr)
            time.sleep(20 * (attempt + 1))
    sys.exit('Overpass did not answer')

B=dict(minLon=103.615,maxLon=104.0,minLat=1.25,maxLat=1.465); S=1000
X=lambda lon:(lon-B['minLon'])*S; Y=lambda lat:(B['maxLat']-lat)*S
W=(B['maxLon']-B['minLon'])*S; H=(B['maxLat']-B['minLat'])*S
def simplify(pts,tol):
    if len(pts)<3: return pts
    def rdp(a,b):
        (x1,y1),(x2,y2)=pts[a],pts[b]; dx,dy=x2-x1,y2-y1; L=math.hypot(dx,dy) or 1e-9
        best,idx=0,None
        for i in range(a+1,b):
            px,py=pts[i]; d=abs(dy*px-dx*py+x2*y1-y2*x1)/L if L>1e-9 else math.hypot(px-x1,py-y1)
            if d>best: best,idx=d,i
        if best>tol: return rdp(a,idx)[:-1]+rdp(idx,b)
        return [pts[a],pts[b]]
    import sys; sys.setrecursionlimit(100000)
    return rdp(0,len(pts)-1)
# coastline: chain ways
coast=overpass(QUERIES['coast']); time.sleep(5)
ways=[[(n['lon'],n['lat']) for n in w['geometry']] for w in coast]
chains=[]
ways=[w[:] for w in ways]
while ways:
    c=ways.pop()
    changed=True
    while changed:
        changed=False
        for i,w in enumerate(ways):
            if w[0]==c[-1]: c+=w[1:]; ways.pop(i); changed=True; break
            if w[-1]==c[0]: c=w+c[1:]; ways.pop(i); changed=True; break
    chains.append(c)
closed=[c for c in chains if c[0]==c[-1]]; opened=[c for c in chains if c[0]!=c[-1]]
print("coast chains", len(chains), "closed", len(closed), "open", len(opened))
# Close open chains (mainland Johor, land on the left = north) along the frame's north edge.
land=[]
def proj(c): return [(X(a),Y(b)) for a,b in c]
for c in closed:
    p=proj(c)
    xs=[q[0] for q in p]; ys=[q[1] for q in p]
    # Keep land a wide screen can show beside the frame
    if max(xs)<-260 or min(xs)>W+260 or max(ys)<-160 or min(ys)>H+160: continue
    area=sum(p[i][0]*p[i-1][1]-p[i-1][0]*p[i][1] for i in range(len(p)))/2
    inside = max(xs)>0 and min(xs)<W and max(ys)>0 and min(ys)<H
    # Skip tiny islets; land beyond the frame is only scenery, so it is drawn coarser.
    if abs(area) < (0.4 if inside else 4): continue
    land.append(simplify(p, 0.12 if inside else 0.6))
for c in opened:
    p=proj(c)
    # Endpoints sit far outside the frame; close over the top for Johor, under the bottom for the Riau islands.
    e,s=p[-1],p[0]
    edge=-600 if sum(b for a,b in c)/len(c) > B['minLat'] else H+600
    p=p+[(e[0],edge),(s[0],edge)]
    land.append(simplify(p,0.35))
# expressways
mw=overpass(QUERIES['roads']); time.sleep(5)
roads={}
for w in mw:
    ref=w['tags'].get('ref','').split(';')[0].strip()
    if not ref: continue
    pts=simplify(proj([(n['lon'],n['lat']) for n in w['geometry']]),0.08)
    roads.setdefault(ref,[]).append(pts)
# places
want=['Woodlands','Yishun','Sembawang','Punggol','Sengkang','Ang Mo Kio','Tampines','Pasir Ris','Bedok','Changi','Toa Payoh','Bukit Timah','Bukit Panjang','Choa Chu Kang','Jurong West','Jurong East','Clementi','Queenstown','Downtown Core','Geylang','Bishan','Tuas','Marine Parade','Paya Lebar','Seletar','Lim Chu Kang','Boon Lay','Bukit Batok']
pl=overpass(QUERIES['places'])
names={e['tags'].get('name:en',e['tags'].get('name')):(e['lon'],e['lat'],e['tags']['place']) for e in pl}
places=[]
for n in want:
    if n in names: lon,lat,_=names[n]; places.append((n,round(X(lon),1),round(Y(lat),1)))
    else: print('missing place',n)
fmt=lambda pts:'M'+'L'.join(f'{a:.1f} {b:.1f}' for a,b in pts)
out={'land':''.join(fmt(p)+'Z' for p in land),'roads':{k:''.join(fmt(p) for p in v) for k,v in sorted(roads.items())},'places':places}
ts = (
    '// Generated by scripts/build-basemap.py from OpenStreetMap data (© OpenStreetMap contributors, ODbL).\n'
    '// Coordinates are pre-projected into the speed map frame (see MAP_BOUNDS in SpeedBandMap.tsx).\n'
    f'export const BASEMAP_LAND = {json.dumps(out["land"])};\n\n'
    f'export const BASEMAP_ROADS: Record<string, string> = {json.dumps(out["roads"], indent=2)};\n\n'
    f'export const BASEMAP_PLACES: [name: string, x: number, y: number][] = {json.dumps(out["places"])};\n'
)
open('src/data/basemap.ts', 'w').write(ts)
print('land rings', len(land), 'bytes', len(ts))
