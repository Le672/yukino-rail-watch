"""Extract an urban-rail snapshot from complete Geofabrik regional files.

Requires osmium (PyPI). No city whitelist; closed/proposed lines are subsequently
excluded by update-urban-rail.mjs. This only extracts map geometry, not train data.
Usage: python scripts/extract-urban-pbf.py output.json china.osm.pbf [taiwan.osm.pbf]
"""
from pathlib import Path
import sys, json, re
from datetime import datetime, timezone

root = Path(__file__).resolve().parent.parent
temporary_libraries = root / '.rail-art-work/urban/python-libs'
if temporary_libraries.is_dir():
    sys.path.insert(0, str(temporary_libraries))
import osmium

elements, needed_nodes, needed_ways, platform_ways, route_ways = {}, set(), set(), {}, set()
route_types = {'subway', 'light_rail', 'tram', 'monorail', 'funicular', 'maglev'}
def eligible(tags):
    if tags.get('type') != 'route': return False
    mode = tags.get('route')
    return mode in route_types or (mode == 'train' and (
        tags.get('passenger') in {'urban', 'suburban', 'local'} or tags.get('service') == 'commuter'
        or re.search(r'磁|maglev|\bAPM\b', tags.get('name', '') + tags.get('network', ''), re.I)))

class Routes(osmium.SimpleHandler):
    def relation(self, relation):
        tags = dict(relation.tags)
        if not eligible(tags): return
        members = [{'type': {'n': 'node', 'w': 'way', 'r': 'relation'}[m.type], 'ref': m.ref, 'role': m.role} for m in relation.members]
        elements[f'relation/{relation.id}'] = {'type': 'relation', 'id': relation.id, 'tags': tags, 'members': members}
        for m in relation.members:
            if m.type == 'n': needed_nodes.add(m.ref)
            elif m.type == 'w':
                route_ways.add(m.ref)
                if re.match(r'^(stop|platform)(_|$)', m.role): needed_ways.add(m.ref)

class Platforms(osmium.SimpleHandler):
    def way(self, way):
        if way.id in route_ways and way.tags.get('railway') in {'monorail', 'maglev', 'funicular', 'tram', 'light_rail'}:
            elements[f'way/{way.id}'] = {'type': 'way', 'id': way.id, 'tags': dict(way.tags)}
        if way.id not in needed_ways: return
        nodes = [n.ref for n in way.nodes]; needed_nodes.update(nodes)
        platform_ways[way.id] = {'type': 'way', 'id': way.id, 'tags': dict(way.tags), 'nodes': nodes}

class Stops(osmium.SimpleHandler):
    def node(self, node):
        if node.id not in needed_nodes and node.tags.get('railway') != 'station' and node.tags.get('place') != 'city': return
        if not node.location.valid(): return
        elements[f'node/{node.id}'] = {'type': 'node', 'id': node.id, 'lat': node.location.lat, 'lon': node.location.lon, 'tags': dict(node.tags)}

files = [Path(value).resolve() for value in sys.argv[2:]]
source_dates = []
for filename in files:
    with osmium.io.Reader(str(filename)) as reader:
        source_dates.append(reader.header().get('osmosis_replication_timestamp'))
    print(f'Routes: {filename.name}', flush=True); Routes().apply_file(str(filename))
for filename in files:
    print(f'Platforms: {filename.name}', flush=True); Platforms().apply_file(str(filename))
for filename in files:
    print(f'Stations: {filename.name}', flush=True); Stops().apply_file(str(filename))
for way in platform_ways.values():
    coords = [elements.get(f'node/{ref}') for ref in way['nodes']]
    coords = [node for node in coords if node is not None]
    if len(coords) != len(way['nodes']) or not coords: continue
    way['center'] = {'lat': sum(n['lat'] for n in coords)/len(coords), 'lon': sum(n['lon'] for n in coords)/len(coords)}
    del way['nodes']; elements[f'way/{way["id"]}'] = way
payload = {'osm3s': {'timestamp_osm_base': min(filter(None, source_dates), default='unknown')}, 'elements': list(elements.values())}
Path(sys.argv[1]).write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'routes': sum(e['type'] == 'relation' for e in elements.values()), 'elements': len(elements), 'sourceDate': payload['osm3s']['timestamp_osm_base']}), flush=True)
