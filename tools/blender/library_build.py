# PORTAL X — the library room (Hanukkah game, room 1), built in Blender from code.
#
#   blender -b --factory-startup --python tools/blender/library_build.py -- <out.glb> [preview.png]
#
# Builds the room's furniture and architecture (bookcases full of books, stone pilasters and arches, a stone portal
# around the door, the antique desk with its separate drawer, a sideboard, a lectern, a chest, a map table, candelabra,
# an oil lamp, books, scrolls, ink and quill), bakes tileable PBR textures from procedural materials (wood, stone floor,
# stone, book spines; colour and normal maps) and exports one GLB for Three.js.
#
# Coordinates: everything is placed relative to the room centre at floor level, in the game's units (metres).
# The game uses Three.js axes (x right, y up, z toward the entrance); Blender is z-up, so a game point (x, y, z) is the
# Blender point (x, -z, y). glTF export converts back (+Y up).
#
# Objects the game needs by name:
#   Drawer   — the drawer front with its tray, pull and keyhole; origin at the centre of the front. The game attaches it to
#              the existing drawer mechanism (open/close and the key inside stay as they are).
#   GlobeStand, OilLamp — placed where the game's globe and lamp flame are.
#   Everything else is static decoration.

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'library.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None
TEX_SIZE = 1024
random.seed(7)

HALF_W, HALF_D, WALL_H = 8.0, 7.0, 6.5
DOOR_W, DOOR_H = 2.4, 3.4


def G(x, y, z):
    """A game point (Three.js axes) as a Blender point."""
    return Vector((x, -z, y))


# ------------------------------------------------------------------------------------------------ scene

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
COL = bpy.data.collections.new('Library')
scene.collection.children.link(COL)


def link(obj):
    COL.objects.link(obj)
    return obj


# ------------------------------------------------------------------------------------------------ textures (baked)

def _torus(nt, u_cycles, v_cycles):
    """A 4D point on a torus from the UV — noise sampled on it tiles seamlessly in both directions."""
    uv = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs[0])
    outs = []
    for axis, cycles in ((0, u_cycles), (1, v_cycles)):
        ang = nt.nodes.new('ShaderNodeMath'); ang.operation = 'MULTIPLY'; ang.inputs[1].default_value = 2 * math.pi
        nt.links.new(sep.outputs[axis], ang.inputs[0])
        for fn in ('COSINE', 'SINE'):
            m = nt.nodes.new('ShaderNodeMath'); m.operation = fn
            nt.links.new(ang.outputs[0], m.inputs[0])
            r = nt.nodes.new('ShaderNodeMath'); r.operation = 'MULTIPLY'; r.inputs[1].default_value = cycles / (2 * math.pi)
            nt.links.new(m.outputs[0], r.inputs[0])
            outs.append(r.outputs[0])
    vec = nt.nodes.new('ShaderNodeCombineXYZ')
    for k in range(3):
        nt.links.new(outs[k], vec.inputs[k])
    return vec.outputs[0], outs[3]


def _noise4(nt, u_cycles, v_cycles, detail=6.0, rough=0.55, distort=0.0):
    vec, w = _torus(nt, u_cycles, v_cycles)
    n = nt.nodes.new('ShaderNodeTexNoise'); n.noise_dimensions = '4D'
    n.inputs['Scale'].default_value = 1.0
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    n.inputs['Distortion'].default_value = distort
    nt.links.new(vec, n.inputs['Vector']); nt.links.new(w, n.inputs['W'])
    return n.outputs['Fac']


def _voronoi4(nt, u_cycles, v_cycles, feature='F1'):
    vec, w = _torus(nt, u_cycles, v_cycles)
    v = nt.nodes.new('ShaderNodeTexVoronoi'); v.voronoi_dimensions = '4D'; v.feature = feature
    v.inputs['Scale'].default_value = 1.0
    nt.links.new(vec, v.inputs['Vector']); nt.links.new(w, v.inputs['W'])
    return v.outputs['Distance']


def _ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    el = r.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], (*stops[0][1], 1)
    el[1].position, el[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = el.new(pos); e.color = (*col, 1)
    nt.links.new(fac, r.inputs['Fac'])
    return r.outputs['Color']


def _math(nt, op, a, b):
    m = nt.nodes.new('ShaderNodeMath'); m.operation = op
    for i, v in enumerate((a, b)):
        if isinstance(v, (int, float)): m.inputs[i].default_value = v
        else: nt.links.new(v, m.inputs[i])
    return m.outputs[0]


def _mix(nt, fac, a, b, blend='MIX'):
    m = nt.nodes.new('ShaderNodeMix'); m.data_type = 'RGBA'; m.blend_type = blend
    for slot, v in ((0, fac), (6, a), (7, b)):
        if isinstance(v, (int, float)): m.inputs[slot].default_value = v
        elif isinstance(v, tuple): m.inputs[slot].default_value = (*v, 1)
        else: nt.links.new(v, m.inputs[slot])
    return m.outputs[2]


def _brick(nt, width, height, mortar, rows_offset=0.5):
    """Brick texture laid out so the UV square holds a whole number of bricks (it tiles)."""
    uv = nt.nodes.new('ShaderNodeTexCoord')
    b = nt.nodes.new('ShaderNodeTexBrick')
    b.offset = rows_offset; b.offset_frequency = 2; b.squash = 1.0; b.squash_frequency = 2
    b.inputs['Scale'].default_value = 1.0
    b.inputs['Mortar Size'].default_value = mortar
    b.inputs['Mortar Smooth'].default_value = 0.15
    b.inputs['Brick Width'].default_value = width
    b.inputs['Row Height'].default_value = height
    b.inputs['Color1'].default_value = (1, 1, 1, 1)
    b.inputs['Color2'].default_value = (0, 0, 0, 1)
    b.inputs['Mortar'].default_value = (0, 0, 0, 1)
    nt.links.new(uv.outputs['UV'], b.inputs['Vector'])
    return b


BAKE_PLANE = None


def bake(name, build, size=TEX_SIZE, normal=False):
    """Bakes a procedural material on a flat UV square: its colour (emission) or a tangent-space normal map from its height."""
    global BAKE_PLANE
    if BAKE_PLANE is None:
        bpy.ops.mesh.primitive_plane_add(size=1)
        BAKE_PLANE = bpy.context.active_object
        BAKE_PLANE.name = '_bake'
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color' if normal else 'sRGB'
    mat = bpy.data.materials.new('_bake_' + name); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.nodes.active = tex
    value = build(nt)
    if normal:
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 1.0; bump.inputs['Distance'].default_value = 0.004
        nt.links.new(value, bump.inputs['Height'])
        bsdf = nt.nodes.new('ShaderNodeBsdfDiffuse')
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    else:
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(value, em.inputs['Color'])
        nt.links.new(em.outputs[0], out.inputs['Surface'])
    BAKE_PLANE.data.materials.clear(); BAKE_PLANE.data.materials.append(mat)
    for o in bpy.context.view_layer.objects: o.select_set(False)
    BAKE_PLANE.select_set(True); bpy.context.view_layer.objects.active = BAKE_PLANE
    scene.cycles.samples = 1
    bpy.ops.object.bake(type='NORMAL' if normal else 'EMIT', margin=0, use_clear=True,
                        normal_space='TANGENT')
    img.pack()
    return img


# -- wood: long grain with growth rings and fine pores (u = across the grain, v = along it)
def wood_height(nt):
    rings = _noise4(nt, 18, 2, detail=3, rough=0.5, distort=1.2)
    waves = _math(nt, 'MULTIPLY', rings, 24.0)
    waves = _math(nt, 'SINE', waves, 0)
    fine = _noise4(nt, 120, 6, detail=8, rough=0.7)
    return _math(nt, 'ADD', _math(nt, 'MULTIPLY', waves, 0.35), fine)


def wood_color(dark):
    def build(nt):
        h = wood_height(nt)
        stops = [(0.0, (0.05, 0.022, 0.010)), (0.45, (0.11, 0.050, 0.020)), (1.0, (0.22, 0.110, 0.045))] if dark else \
                [(0.0, (0.10, 0.050, 0.020)), (0.45, (0.24, 0.12, 0.050)), (1.0, (0.42, 0.24, 0.11))]
        col = _ramp(nt, _math(nt, 'MULTIPLY', _math(nt, 'ADD', h, 0.6), 0.6), stops)
        grime = _noise4(nt, 4, 4, detail=4)
        return _mix(nt, _math(nt, 'MULTIPLY', grime, 0.35), col, (0.02, 0.012, 0.006), 'MULTIPLY')
    return build


# -- stone floor: large flags with worn edges and dirt in the joints
def floor_parts(nt):
    b = _brick(nt, 0.5, 0.25, 0.012)
    n = _noise4(nt, 8, 8, detail=7, rough=0.6)
    v = _voronoi4(nt, 14, 14)
    return b, n, v


def floor_color(nt):
    b, n, v = floor_parts(nt)
    base = _ramp(nt, n, [(0.3, (0.075, 0.062, 0.050)), (0.55, (0.15, 0.125, 0.095)), (0.75, (0.22, 0.18, 0.14))])
    spots = _ramp(nt, v, [(0.0, (0.6, 0.6, 0.6)), (0.4, (1, 1, 1))])
    stone = _mix(nt, 0.6, base, spots, 'MULTIPLY')
    return _mix(nt, b.outputs['Fac'], stone, (0.05, 0.04, 0.03))


def floor_height(nt):
    b, n, v = floor_parts(nt)
    return _math(nt, 'ADD', _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', 1.0, b.outputs['Fac']), 0.8), _math(nt, 'MULTIPLY', n, 0.25))


# -- dressed stone (pilasters, arches, portal, plinths): ashlar courses
def stone_parts(nt):
    b = _brick(nt, 0.5, 0.25, 0.01)
    n = _noise4(nt, 10, 10, detail=8, rough=0.65)
    return b, n


def stone_color(nt):
    b, n = stone_parts(nt)
    base = _ramp(nt, n, [(0.3, (0.24, 0.21, 0.18)), (0.55, (0.42, 0.37, 0.31)), (0.8, (0.55, 0.49, 0.41))])
    return _mix(nt, b.outputs['Fac'], base, (0.10, 0.09, 0.08))


def stone_height(nt):
    b, n = stone_parts(nt)
    return _math(nt, 'ADD', _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', 1.0, b.outputs['Fac']), 0.7), _math(nt, 'MULTIPLY', n, 0.35))


# -- book spine detail (multiplied by each book's colour): worn leather with two gilded bands at each end
def spine_color(nt):
    uv = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(uv.outputs['UV'], sep.inputs[0])
    v = sep.outputs[1]
    bands = None
    for c in (0.08, 0.13, 0.87, 0.92):
        d = _math(nt, 'ABSOLUTE', _math(nt, 'SUBTRACT', v, c), 0)
        band = _math(nt, 'LESS_THAN', d, 0.012)
        bands = band if bands is None else _math(nt, 'MAXIMUM', bands, band)
    leather = _ramp(nt, _noise4(nt, 6, 40, detail=8, rough=0.7), [(0.35, (0.55, 0.55, 0.55)), (0.65, (0.95, 0.95, 0.95))])
    return _mix(nt, bands, leather, (2.2, 1.6, 0.7))


print('baking textures...')
T_WOOD_DARK = bake('wood_dark', wood_color(True))
T_WOOD = bake('wood_light', wood_color(False))
N_WOOD = bake('wood_normal', wood_height, normal=True)
T_FLOOR = bake('floor_color', floor_color)
N_FLOOR = bake('floor_normal', floor_height, normal=True)
T_STONE = bake('stone_color', stone_color)
N_STONE = bake('stone_normal', stone_height, normal=True)
T_SPINE = bake('spine', spine_color, size=512)
bpy.data.objects.remove(BAKE_PLANE)


# ------------------------------------------------------------------------------------------------ materials

def material(name, color=(0.8, 0.8, 0.8), metal=0.0, rough=0.7, tex=None, normal=None, emit=None, alpha=None, vcol=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if tex is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = tex
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if normal is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = normal
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.0
        nt.links.new(t.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = 3.0
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m


M = {
    'wood': material('LibWood', tex=T_WOOD, normal=N_WOOD, rough=0.55),
    'woodDark': material('LibWoodDark', tex=T_WOOD_DARK, normal=N_WOOD, rough=0.62),
    'stone': material('LibStone', tex=T_STONE, normal=N_STONE, rough=0.88),
    'floor': material('LibFloor', tex=T_FLOOR, normal=N_FLOOR, rough=0.8),
    'brass': material('LibBrass', color=(0.78, 0.55, 0.24), metal=1.0, rough=0.3),
    'iron': material('LibIron', color=(0.09, 0.085, 0.08), metal=0.85, rough=0.45),
    'book': material('LibBook', tex=T_SPINE, rough=0.68),
    'paper': material('LibPaper', color=(0.86, 0.76, 0.56), rough=0.92),
    'wax': material('LibWax', color=(0.93, 0.88, 0.74), rough=0.5),
    'ink': material('LibInk', color=(0.02, 0.02, 0.03), rough=0.2),
    'feather': material('LibFeather', color=(0.92, 0.9, 0.86), rough=0.8),
    'cloth': material('LibCloth', color=(0.33, 0.05, 0.05), rough=0.95),
    'glass': material('LibGlass', color=(0.85, 0.92, 1.0), rough=0.05, alpha=0.25),
}


# ------------------------------------------------------------------------------------------------ geometry helpers

def finish(obj, mat, uv_scale=1.0, bevel=0.0, segments=2, smooth=False):
    """Applies an optional bevel, box-projects UVs in world space (texture size stays the same everywhere) and assigns."""
    if bevel > 0:
        mod = obj.modifiers.new('bevel', 'BEVEL'); mod.width = bevel; mod.segments = segments; mod.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    box_uv(obj, uv_scale)
    obj.data.materials.clear(); obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons: p.use_smooth = True
    return obj


def box_uv(obj, scale):
    me = obj.data
    uvl = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    mw = obj.matrix_world
    for poly in me.polygons:
        n = (mw.to_3x3() @ poly.normal)
        ax = max(range(3), key=lambda k: abs(n[k]))
        for li in poly.loop_indices:
            p = mw @ me.vertices[me.loops[li].vertex_index].co
            u, v = [(p.y, p.z), (p.x, p.z), (p.x, p.y)][ax]
            uvl.data[li].uv = (u * scale, v * scale)


def cube(name, size, at, mat=None, uv=0.5, bevel=0.0, rot_z=0.0):
    """A box of size (game x, y, z) centred at a game point."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((size[0], size[2], size[1])), verts=bm.verts)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj = link(bpy.data.objects.new(name, me))
    obj.location = G(*at)
    obj.rotation_euler.z = rot_z
    bpy.context.view_layer.update()
    if mat is not None: finish(obj, mat, uv, bevel)
    return obj


def lathe(name, profile, at, mat, segments=24, uv=1.0):
    """A turned shape from (radius, height) pairs, standing on a game point."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, h)) for r, h in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=segments, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj = link(bpy.data.objects.new(name, me))
    obj.location = G(*at)
    bpy.context.view_layer.update()
    return finish(obj, mat, uv, smooth=True)


def arch(name, span, thickness, depth, spring_y, at_x, at_z, along_x, mat, segments=16, keystone=True):
    """A semicircular stone arch (with a keystone) standing in a wall: along x (back wall) or along z (side walls)."""
    r_in, r_out = span / 2, span / 2 + thickness
    bm = bmesh.new()
    rings = []
    for k in range(segments + 1):
        a = math.pi * k / segments
        ring = []
        for r in (r_in, r_out):
            for d in (-depth / 2, depth / 2):
                ring.append(bm.verts.new((math.cos(a) * r, d, math.sin(a) * r)))
        rings.append(ring)
    for k in range(segments):
        a0, a1 = rings[k], rings[k + 1]
        for i, j in ((0, 1), (1, 3), (3, 2), (2, 0)):
            bm.faces.new((a0[i], a1[i], a1[j], a0[j]))
    bm.faces.new((rings[0][0], rings[0][1], rings[0][3], rings[0][2]))
    bm.faces.new((rings[-1][2], rings[-1][3], rings[-1][1], rings[-1][0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj = link(bpy.data.objects.new(name, me))
    if along_x:
        obj.location = G(at_x, spring_y, at_z)
    else:
        obj.location = G(at_x, spring_y, at_z)
        obj.rotation_euler.z = math.pi / 2
    bpy.context.view_layer.update()
    finish(obj, mat, 0.5, bevel=0.015, segments=1)
    parts = [obj]
    if keystone:
        ks = cube(name + 'Key', (0.32, thickness + 0.22, depth + 0.08) if along_x else (depth + 0.08, thickness + 0.22, 0.32),
                  (at_x, spring_y + r_in + thickness / 2, at_z), mat, 0.5, bevel=0.02)
        parts.append(ks)
    return parts


def join(name, objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


# ------------------------------------------------------------------------------------------------ bookcases and books

BOOK_TONES = [(0.42, 0.06, 0.05), (0.12, 0.22, 0.10), (0.08, 0.12, 0.30), (0.32, 0.18, 0.07), (0.20, 0.10, 0.05),
              (0.45, 0.30, 0.12), (0.10, 0.07, 0.06), (0.30, 0.05, 0.12), (0.16, 0.20, 0.22), (0.50, 0.40, 0.25)]


def books_row(bm, colors, x0, x1, y, depth, z_back, max_h):
    """Fills one shelf with books of varied size, colour and lean (game axes, a bookcase facing +z at the origin)."""
    x = x0 + random.uniform(0.0, 0.05)
    while x < x1 - 0.04:
        if random.random() < 0.06:                 # a small gap now and then
            x += random.uniform(0.05, 0.18)
            continue
        w = random.uniform(0.035, 0.085)
        h = random.uniform(0.62, 0.95) * max_h
        d = random.uniform(0.7, 0.95) * depth
        lean = random.uniform(-0.12, 0.12) if random.random() < 0.12 else 0.0
        if x + w > x1: break
        geom = bmesh.ops.create_cube(bm, size=1.0)
        vs = geom['verts']
        bmesh.ops.scale(bm, vec=Vector((w, d, h)), verts=vs)
        m = Matrix.Translation(Vector((x + w / 2, -(z_back + d / 2), y + h / 2))) @ Matrix.Rotation(lean, 4, 'Y')
        bmesh.ops.transform(bm, matrix=m, verts=vs)
        col = random.choice(BOOK_TONES)
        shade = random.uniform(0.75, 1.2)
        for f in {f for v in vs for f in v.link_faces}:
            colors[f.index] = tuple(min(1.0, c * shade) for c in col)
        x += w + (abs(math.sin(lean)) * h if lean else 0.004)


def bookcase(name, width, height, depth, shelves, at, rot_y):
    """A tall carved bookcase full of books. at = game point of the base centre on the wall, rot_y = facing (game)."""
    parts = []
    t = 0.07
    parts.append(cube('side', (t, height, depth), (-width / 2 + t / 2, height / 2, depth / 2)))
    parts.append(cube('side', (t, height, depth), (width / 2 - t / 2, height / 2, depth / 2)))
    parts.append(cube('back', (width, height, 0.03), (0, height / 2, 0.015)))
    parts.append(cube('plinth', (width + 0.08, 0.16, depth + 0.06), (0, 0.08, depth / 2 + 0.03)))
    # crown moulding: stepped boards
    for k, (dw, dd, hh) in enumerate(((0.06, 0.04, 0.08), (0.14, 0.09, 0.06), (0.22, 0.14, 0.10))):
        parts.append(cube('crown', (width + dw, hh, depth + dd), (0, height - 0.12 + k * 0.08, (depth + dd) / 2)))
    # fluted pilasters on the face of the sides
    for sx in (-1, 1):
        parts.append(cube('pil', (0.1, height - 0.3, 0.04), (sx * (width / 2 - 0.05), height / 2, depth + 0.02)))
    gap = (height - 0.35) / shelves
    for k in range(shelves + 1):
        y = 0.16 + k * gap
        parts.append(cube('shelf', (width - 2 * t, 0.035, depth - 0.03), (0, y, depth / 2)))
    case = join(name, parts)
    finish(case, M['woodDark'], 1.0, bevel=0.006, segments=1)

    bm = bmesh.new()
    colors = {}
    for k in range(shelves):
        y = 0.16 + k * gap + 0.018
        books_row(bm, colors, -width / 2 + t + 0.01, width / 2 - t - 0.01, y, depth - 0.08, 0.04, gap - 0.06)
    me = bpy.data.meshes.new(name + 'Books'); bm.to_mesh(me); bm.free()
    books = link(bpy.data.objects.new(name + 'Books', me))
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        c = colors.get(poly.index, (0.3, 0.2, 0.1))
        for li in poly.loop_indices:
            attr.data[li].color = (*c, 1.0)
    # spine UVs: the spine face (facing the room) gets the whole texture height; other faces a small leather patch
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        zs = [me.vertices[me.loops[li].vertex_index].co.z for li in poly.loop_indices]
        z0, z1 = min(zs), max(zs)
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if poly.normal.y < -0.5:   # facing the room (game +z = Blender -y)
                xs = [me.vertices[me.loops[l].vertex_index].co.x for l in poly.loop_indices]
                uvl.data[li].uv = ((co.x - min(xs)) / max(1e-4, max(xs) - min(xs)), (co.z - z0) / max(1e-4, z1 - z0))
            else:
                uvl.data[li].uv = (0.5 + co.x * 0.2, 0.5)
    books.data.materials.append(M['book'])
    for o in (case, books):
        o.matrix_world = Matrix.Translation(G(*at)) @ Matrix.Rotation(rot_y, 4, 'Z') @ o.matrix_world
    return [case, books]


# ------------------------------------------------------------------------------------------------ the room

print('building the room...')
statics = []

# floor of large stone flags (above the shell's floor), with a stone border step along the walls
# kept below the rug (0.012) so the two never flicker against each other
floor = cube('Floor', (HALF_W * 2 - 0.02, 0.005, HALF_D * 2 - 0.02), (0, 0.0025, 0))
finish(floor, M['floor'], 0.4)
statics.append(floor)

# bookcases: two on the left wall, three on the right wall, one on the back wall left of the door, two on the entrance wall
CASE_W, CASE_H, CASE_D = 2.4, 4.7, 0.55
for z in (-4.6, -1.8):
    statics += bookcase('CaseL', CASE_W, CASE_H, CASE_D, 6, (-HALF_W + 0.02, 0, z), math.pi / 2)
for z in (-4.6, -1.8, 1.0):
    statics += bookcase('CaseR', CASE_W, CASE_H, CASE_D, 6, (HALF_W - 0.02, 0, z), -math.pi / 2)
statics += bookcase('CaseB', CASE_W, CASE_H, CASE_D, 6, (-4.6, 0, -HALF_D + 0.02), 0.0)
# and two on the entrance wall, facing the desk
for x in (-4.6, 4.6):
    statics += bookcase('CaseF', CASE_W, CASE_H, CASE_D, 6, (x, 0, HALF_D - 0.02), math.pi)

# a rolling library ladder on the right wall
lad = []
for sx in (-1, 1):
    rail = cube('rail', (0.05, 4.4, 0.05), (sx * 0.22, 2.2, 0))
    lad.append(rail)
for k in range(11):
    lad.append(cube('rung', (0.44, 0.04, 0.04), (0, 0.35 + k * 0.38, 0)))
ladder = join('Ladder', lad)
finish(ladder, M['wood'], 1.0, bevel=0.008, segments=1)
ladder.matrix_world = Matrix.Translation(G(HALF_W - 0.75, 0, -1.2)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Rotation(-0.16, 4, 'X') @ ladder.matrix_world
statics.append(ladder)
statics.append(finish(cube('LadderRail', (0.04, 0.04, 6.2), (HALF_W - 0.62, 4.45, -1.8)), M['brass'], 1.0))

# stone pilasters between the bookcases, with bases and capitals, and semicircular arches above the bookcases
PIL_Z = (-6.35, -3.2, -0.4)
for side in (-1, 1):
    for z in PIL_Z + ((2.45,) if side > 0 else (0.9,)):
        x = side * (HALF_W - 0.14)
        statics.append(cube('Pilaster', (0.28, WALL_H, 0.48), (x, WALL_H / 2, z), M['stone'], 0.5, bevel=0.015))
        statics.append(cube('PilBase', (0.36, 0.3, 0.58), (x, 0.15, z), M['stone'], 0.5, bevel=0.02))
        statics.append(cube('PilCap', (0.38, 0.22, 0.6), (x, 4.95, z), M['stone'], 0.5, bevel=0.02))
    spans = ((-6.35, -3.2), (-3.2, -0.4)) + (((-0.4, 2.45),) if side > 0 else ())
    for z0, z1 in spans:
        statics += arch('Arch', abs(z1 - z0) - 0.48, 0.32, 0.36, 5.06, side * (HALF_W - 0.18), (z0 + z1) / 2, False, M['stone'])
# stone cornice along the top of the walls and a low stone plinth
for side in (-1, 1):
    statics.append(cube('Cornice', (0.3, 0.26, HALF_D * 2), (side * (HALF_W - 0.15), WALL_H - 0.13, 0), M['stone'], 0.5, bevel=0.02))
statics.append(cube('CorniceB', (HALF_W * 2, 0.26, 0.3), (0, WALL_H - 0.13, -HALF_D + 0.15), M['stone'], 0.5, bevel=0.02))

# the portal around the door to the workshop: pilasters, a round arch with keystone, steps of the frame
for sx in (-1, 1):
    statics.append(cube('PortalPil', (0.42, DOOR_H + 0.2, 0.42), (sx * (DOOR_W / 2 + 0.33), (DOOR_H + 0.2) / 2, -HALF_D + 0.21), M['stone'], 0.5, bevel=0.02))
    statics.append(cube('PortalBase', (0.52, 0.32, 0.5), (sx * (DOOR_W / 2 + 0.33), 0.16, -HALF_D + 0.25), M['stone'], 0.5, bevel=0.02))
    statics.append(cube('PortalCap', (0.56, 0.2, 0.52), (sx * (DOOR_W / 2 + 0.33), DOOR_H + 0.3, -HALF_D + 0.26), M['stone'], 0.5, bevel=0.02))
statics += arch('PortalArch', DOOR_W + 0.24, 0.4, 0.42, DOOR_H + 0.4, 0, -HALF_D + 0.21, True, M['stone'])

# -------------------------------------------------------------------- the antique desk (same footprint as before)
DESK_W, DESK_D, DESK_Z = 5.2, 1.6, -1.3
desk = []
desk.append(cube('top', (DESK_W, 0.07, DESK_D), (0, 0.965, DESK_Z)))
desk.append(cube('topEdge', (DESK_W + 0.06, 0.04, DESK_D + 0.06), (0, 0.915, DESK_Z)))
for sz in (-1, 1):
    desk.append(cube('apron', (DESK_W - 0.3, 0.16, 0.04), (0, 0.81, DESK_Z + sz * (DESK_D / 2 - 0.14))))
for sx in (-1, 1):
    desk.append(cube('apronS', (0.04, 0.16, DESK_D - 0.3), (sx * (DESK_W / 2 - 0.14), 0.81, DESK_Z)))
    desk.append(cube('stretcher', (0.06, 0.06, DESK_D - 0.3), (sx * (DESK_W / 2 - 0.15), 0.16, DESK_Z)))
desk.append(cube('stretcherL', (DESK_W - 0.3, 0.06, 0.06), (0, 0.16, DESK_Z)))
# the drawer pedestal under the desk (the drawer itself is a separate object)
desk.append(cube('pedestal', (1.04, 0.42, 0.56), (0.4, 0.62, -1.2)))
deskObj = join('Desk', desk)
finish(deskObj, M['wood'], 1.2, bevel=0.008, segments=2)
statics.append(deskObj)
LEG = [(0.0, 0.0), (0.07, 0.0), (0.075, 0.04), (0.05, 0.08), (0.045, 0.2), (0.065, 0.3), (0.05, 0.4), (0.04, 0.55), (0.055, 0.66),
       (0.065, 0.72), (0.06, 0.76), (0.07, 0.79), (0.07, 0.9), (0.0, 0.9)]
for sx in (-1, 1):
    for sz in (-1, 1):
        statics.append(lathe('DeskLeg', LEG, (sx * (DESK_W / 2 - 0.15), 0, DESK_Z + sz * (DESK_D / 2 - 0.15)), M['wood'], 16))

# the drawer: front with a raised panel, a brass ring pull and keyhole, and a tray behind it (origin = front centre)
dr = []
dr.append(cube('front', (0.9, 0.3, 0.05), (0, 0, 0)))
dr.append(cube('panel', (0.74, 0.18, 0.02), (0, 0, 0.03)))
dr.append(cube('trayL', (0.02, 0.2, 0.44), (-0.41, -0.03, -0.24)))
dr.append(cube('trayR', (0.02, 0.2, 0.44), (0.41, -0.03, -0.24)))
dr.append(cube('trayB', (0.84, 0.2, 0.02), (0, -0.03, -0.45)))
dr.append(cube('trayF', (0.84, 0.02, 0.44), (0, -0.12, -0.24)))
drawer = join('Drawer', dr)
finish(drawer, M['wood'], 1.2, bevel=0.004, segments=1)
pull = lathe('DrawerPull', [(0.0, 0.0), (0.035, 0.0), (0.035, 0.01), (0.012, 0.02), (0.012, 0.045), (0.0, 0.05)], (0, 0, 0), M['brass'], 16)
pull.rotation_euler.x = -math.pi / 2; pull.location = G(0, -0.04, 0.04)
keyhole = cube('Keyhole', (0.05, 0.08, 0.012), (0, 0.06, 0.045), M['brass'], 1.0, bevel=0.01)
drawer = join('Drawer', [drawer, pull, keyhole])
DRAWER_AT = (0.4, 0.62, -0.93)
drawer.location = G(*DRAWER_AT)

# -------------------------------------------------------------------- things on and around the desk
def book(name, w, h, d, at, color, lean=0.0, lying=False):
    b = cube(name, (w, h, d), (0, 0, 0))
    finish(b, M['book'], 2.0, bevel=0.008, segments=2)
    me = b.data
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for li in range(len(me.loops)): attr.data[li].color = (*color, 1)
    uvl = me.uv_layers['UVMap']
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co.x / w + 0.5, co.z / h + 0.5)
    if lying: b.rotation_euler.y = math.pi / 2
    b.rotation_euler.x = lean
    b.location = G(*at)
    return b


# the three books of the desk (red, green, blue) where the game's "שלושה ספרים" are
for col, x in (((0.42, 0.05, 0.05), -2.9), ((0.07, 0.25, 0.10), -2.6), ((0.07, 0.13, 0.35), -2.3)):
    statics.append(book('DeskBook', 0.2, 0.32, 0.27, (x, 1.16, -1.6), col))
# a stack of large books and an open folio
for k, (w, d, col) in enumerate(((0.5, 0.36, (0.25, 0.12, 0.05)), (0.44, 0.32, (0.35, 0.06, 0.06)), (0.4, 0.3, (0.1, 0.08, 0.06)))):
    b = cube('Stack', (w, 0.07, d), (-1.9 + k * 0.02, 1.035 + k * 0.07, -1.85))
    finish(b, M['woodDark'] if k == 2 else M['book'], 2.0, bevel=0.01)
    statics.append(b)
folio = cube('Folio', (0.62, 0.02, 0.42), (2.1, 1.01, -1.05), M['paper'], 1.0, bevel=0.005)
statics.append(folio)
# ink pot and quill
statics.append(lathe('Inkwell', [(0, 0), (0.05, 0), (0.055, 0.03), (0.04, 0.06), (0.02, 0.07), (0.022, 0.09), (0, 0.09)], (1.05, 1.0, -1.85), M['ink'], 20))
quill = lathe('Quill', [(0, 0), (0.006, 0.0), (0.02, 0.12), (0.025, 0.25), (0.012, 0.33), (0, 0.34)], (0, 0, 0), M['feather'], 8)
quill.rotation_euler = (0.45, 0.35, 0); quill.location = G(1.05, 1.05, -1.85)
statics.append(quill)
# scrolls on the desk
for k, (x, z, a) in enumerate(((-0.95, -1.75, 0.3), (2.35, -1.75, -0.4))):
    s = lathe('Scroll', [(0, -0.22), (0.035, -0.22), (0.035, 0.22), (0, 0.22)], (0, 0, 0), M['paper'], 16)
    s.rotation_euler = (0, math.pi / 2, a); s.location = G(x, 1.04, z)
    statics.append(s)

# brass candlesticks on the desk (the game adds their flames and light)
CANDLESTICK = [(0, 0), (0.08, 0), (0.08, 0.02), (0.03, 0.05), (0.025, 0.2), (0.045, 0.22), (0.02, 0.24), (0.02, 0.28), (0.04, 0.3), (0.04, 0.32), (0, 0.32)]
for x, z in ((-1.55, -1.95), (2.45, -1.95)):
    statics.append(lathe('Candlestick', CANDLESTICK, (x, 1.0, z), M['brass'], 20))
    statics.append(lathe('Candle', [(0, 0), (0.03, 0), (0.03, 0.18), (0.02, 0.19), (0, 0.19)], (x, 1.32, z), M['wax'], 12))

# the oil lamp where the game's lamp flame is (1.6, 1.0, -1.6): a brass lamp on a small foot
lamp_profile = [(0, 0), (0.05, 0), (0.05, 0.01), (0.02, 0.03), (0.02, 0.05), (0.09, 0.07), (0.11, 0.1), (0.09, 0.13), (0.03, 0.15), (0.035, 0.17), (0, 0.17)]
oil = lathe('OilLamp', lamp_profile, (1.6, 1.0, -1.6), M['brass'], 24)
spout = cube('Spout', (0.16, 0.03, 0.04), (1.68, 1.11, -1.6), M['brass'], 1.0, bevel=0.01)
handle_ = cube('LampHandle', (0.03, 0.08, 0.02), (1.47, 1.13, -1.6), M['brass'], 1.0, bevel=0.008)
oil = join('OilLamp', [oil, spout, handle_])
statics.append(oil)

# the globe's floor stand (the game keeps its turning globe at (3.4, 1.0, -3.2))
gs = []
for k in range(3):
    a = k * 2 * math.pi / 3
    leg = cube('gleg', (0.05, 0.7, 0.05), (3.4 + math.cos(a) * 0.22, 0.33, -3.2 + math.sin(a) * 0.22))
    leg.rotation_euler = (math.sin(a) * 0.3, -math.cos(a) * 0.3, 0)
    gs.append(leg)
gs.append(cube('gring', (0.9, 0.03, 0.9), (3.4, 0.62, -3.2)))
globe_stand = join('GlobeStand', gs)
finish(globe_stand, M['woodDark'], 1.0, bevel=0.006)
statics.append(globe_stand)
statics.append(lathe('GlobeFoot', [(0, 0), (0.06, 0), (0.06, 0.04), (0.03, 0.06), (0.03, 0.57), (0, 0.57)], (3.4, 0.05, -3.2), M['brass'], 16))

# the sideboard under the small hanukkiah (same place and top height as before: top at 1.1)
sb = [cube('body', (1.6, 0.98, 0.6), (4.6, 0.55, -6.4)), cube('top', (1.7, 0.05, 0.66), (4.6, 1.075, -6.37)),
      cube('foot', (1.66, 0.1, 0.62), (4.6, 0.05, -6.39))]
for k in range(3):
    sb.append(cube('drw', (0.46, 0.26, 0.03), (4.6 + (k - 1) * 0.5, 0.84, -6.09)))
for sx in (-1, 1):
    sb.append(cube('door', (0.7, 0.48, 0.03), (4.6 + sx * 0.38, 0.38, -6.09)))
side = join('Sideboard', sb)
finish(side, M['woodDark'], 1.2, bevel=0.008)
statics.append(side)
for k in range(3):
    statics.append(lathe('Knob', [(0, 0), (0.02, 0), (0.02, 0.015), (0, 0.025)], (0, 0, 0), M['brass'], 10))
    statics[-1].rotation_euler.x = -math.pi / 2; statics[-1].location = G(4.6 + (k - 1) * 0.5, 0.84, -6.075)

# the map table by the left wall (where "מפות ומגילות" is), round, with maps and scrolls
mt = [cube('mtop', (1.2, 0.06, 0.8), (-6.6, 0.98, 2.5)), cube('mbar', (1.0, 0.05, 0.05), (-6.6, 0.25, 2.5))]
mtable = join('MapTable', mt)
finish(mtable, M['wood'], 1.2, bevel=0.01)
statics.append(mtable)
for sx in (-1, 1):
    statics.append(lathe('MapLeg', [(0, 0), (0.05, 0), (0.04, 0.2), (0.05, 0.5), (0.035, 0.8), (0.05, 0.95), (0, 0.95)], (-6.6 + sx * 0.5, 0, 2.5), M['wood'], 12))
statics.append(cube('Map', (0.9, 0.006, 0.6), (-6.55, 1.015, 2.5), M['paper'], 1.0))
for k, (z, a) in enumerate(((2.3, 0.4), (2.7, -0.3))):
    s = lathe('MapScroll', [(0, -0.3), (0.04, -0.3), (0.04, 0.3), (0, 0.3)], (0, 0, 0), M['paper'], 16)
    s.rotation_euler = (0, math.pi / 2, a); s.location = G(-6.65, 1.06, z)
    statics.append(s)

# a lectern with a great open book (right side, near the entrance)
lec = [cube('lbase', (0.6, 0.06, 0.5), (5.6, 0.03, 3.6)), cube('lpost', (0.12, 1.05, 0.12), (5.6, 0.55, 3.6)),
       cube('ldesk', (0.62, 0.04, 0.48), (5.6, 1.12, 3.6))]
lectern = join('Lectern', lec)
lectern.rotation_euler.x = 0.0
finish(lectern, M['woodDark'], 1.2, bevel=0.01)
statics.append(lectern)
for sx in (-1, 1):
    pg = cube('LecternPage', (0.27, 0.025, 0.36), (5.6 + sx * 0.14, 1.16, 3.6), M['paper'], 1.0, bevel=0.004)
    pg.rotation_euler.y = sx * 0.08
    statics.append(pg)

# an iron-bound chest by the left wall
chest = [cube('cbody', (1.0, 0.5, 0.6), (-7.05, 0.25, 0.95)), cube('clid', (1.02, 0.14, 0.62), (-7.05, 0.57, 0.95))]
ch = join('Chest', chest)
finish(ch, M['woodDark'], 1.2, bevel=0.012)
statics.append(ch)
for x in (-7.4, -6.7):
    statics.append(cube('Band', (0.06, 0.66, 0.64), (x, 0.33, 0.95), M['iron'], 1.0))
statics.append(cube('Lock', (0.1, 0.12, 0.04), (-7.05, 0.5, 0.65), M['brass'], 1.0, bevel=0.01))

# tall standing candelabra on both sides of the portal (the game lights their candles)
CANDELABRUM = [(0, 0), (0.18, 0), (0.18, 0.03), (0.06, 0.08), (0.035, 0.3), (0.06, 0.34), (0.03, 0.4), (0.03, 1.4), (0.07, 1.46),
               (0.03, 1.5), (0.03, 1.62), (0, 1.62)]
for sx in (-1, 1):
    x = sx * 2.55
    statics.append(lathe('Candelabrum', CANDELABRUM, (x, 0, -6.35), M['brass'], 20))
    arms = cube('CandArms', (0.62, 0.04, 0.04), (x, 1.62, -6.35), M['brass'], 1.0, bevel=0.01)
    statics.append(arms)
    for dx in (-0.3, 0.0, 0.3):
        statics.append(lathe('CandCup', [(0, 0), (0.035, 0), (0.045, 0.04), (0, 0.04)], (x + dx, 1.64, -6.35), M['brass'], 12))
        statics.append(lathe('CandWax', [(0, 0), (0.025, 0), (0.025, 0.2), (0, 0.2)], (x + dx, 1.68, -6.35), M['wax'], 10))

# small things on the shelves are already in the book rows; brass bookends and jars on a few shelves
for z, y in ((-4.6, 2.86), (1.0, 1.36)):
    statics.append(lathe('Jar', [(0, 0), (0.07, 0), (0.09, 0.08), (0.06, 0.16), (0.04, 0.18), (0, 0.18)], (HALF_W - 0.32, y, z + 0.9), M['brass'], 16))

# ------------------------------------------------------------------------------------------------ preview render

if PREVIEW:
    print('rendering the preview...')
    world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.01, 0.008, 0.006, 1)
    for x, y, z, e in ((1.6, 1.4, -1.6, 60), (-1.55, 1.6, -1.95, 40), (2.45, 1.6, -1.95, 40), (0, 4.6, 1.5, 300), (-2.55, 1.9, -6.35, 60),
                       (2.55, 1.9, -6.35, 60), (-6, 4, 0, 120), (6, 4, 0, 120)):
        L = bpy.data.lights.new('l', 'POINT'); L.energy = e; L.color = (1.0, 0.72, 0.45); L.shadow_soft_size = 0.2
        o = bpy.data.objects.new('l', L); o.location = G(x, y, z); scene.collection.objects.link(o)
    cam = bpy.data.cameras.new('cam'); cam.lens = 18
    co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co)
    co.location = G(0, 1.75, 5.6)
    co.rotation_euler = (math.radians(86), 0, 0)
    scene.camera = co
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.filepath = PREVIEW
    # Cycles needs the books' vertex colours wired in; the GLB keeps the plain material (Three.js applies COLOR_0 itself)
    nt = M['book'].node_tree
    bsdf = nt.nodes['Principled BSDF']; img = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Col'
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
    nt.links.new(img.outputs['Color'], mul.inputs[6]); nt.links.new(ca.outputs['Color'], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs['Base Color'])
    bpy.ops.render.render(write_still=True)
    nt.nodes.remove(mul); nt.nodes.remove(ca)
    nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])

# ------------------------------------------------------------------------------------------------ export

print('exporting', OUT)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_apply=True,
                          export_image_format='JPEG', export_jpeg_quality=82, export_vertex_color='ACTIVE',
                          export_lights=False, export_cameras=False, export_yup=True)
print('done', os.path.getsize(OUT), 'bytes')
