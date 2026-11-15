"""
FurnForge AI - 3D Furniture Mesh Generator.
Synthesizes clean parametric 3D polygonal meshes (.obj and .mtl)
for Chair, Sofa, Table, Bed, and Cabinet matching the user's
Primary Material, Designer Palette color, Style, and Finish.
"""
from pathlib import Path
from typing import Dict, List, Tuple
from app.config import OUTPUT_DIR

# Hex to RGB mapping for 12 Designer Palette colors
PALETTE_RGB = {
    "Warm Walnut": (0.32, 0.22, 0.15),
    "Charcoal Gray": (0.17, 0.18, 0.19),
    "Deep Emerald": (0.12, 0.25, 0.17),
    "Cognac Brown": (0.55, 0.27, 0.07),
    "Cream Boucle": (0.92, 0.89, 0.85),
    "Matte Black": (0.09, 0.09, 0.09),
    "Champagne Gold": (0.83, 0.69, 0.22),
    "Navy Blue": (0.11, 0.15, 0.23),
    "Terracotta": (0.78, 0.39, 0.27),
    "Scandinavian Birch": (0.85, 0.80, 0.66),
    "Sage Green": (0.51, 0.57, 0.50),
    "White": (0.96, 0.96, 0.97),
}


class Furniture3DMeshBuilder:
    """Parametric 3D Box & Cylinder polygonal mesh assembler."""

    def __init__(self):
        self.vertices: List[Tuple[float, float, float]] = []
        self.normals: List[Tuple[float, float, float]] = []
        self.texcoords: List[Tuple[float, float]] = []
        self.faces: List[List[Tuple[int, int, int]]] = []

    def add_box(self, cx: float, cy: float, cz: float, dx: float, dy: float, dz: float):
        """Add an axis-aligned 3D box with normals and UVs."""
        hx, hy, hz = dx / 2.0, dy / 2.0, dz / 2.0
        v_start = len(self.vertices) + 1
        n_start = len(self.normals) + 1
        t_start = len(self.texcoords) + 1

        # 8 corners
        corners = [
            (cx - hx, cy - hy, cz - hz),
            (cx + hx, cy - hy, cz - hz),
            (cx + hx, cy + hy, cz - hz),
            (cx - hx, cy + hy, cz - hz),
            (cx - hx, cy - hy, cz + hz),
            (cx + hx, cy - hy, cz + hz),
            (cx + hx, cy + hy, cz + hz),
            (cx - hx, cy + hy, cz + hz),
        ]
        self.vertices.extend(corners)

        # 6 face normals
        norms = [
            (0.0, 0.0, -1.0),
            (0.0, 0.0, 1.0),
            (-1.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
            (0.0, -1.0, 0.0),
            (0.0, 1.0, 0.0),
        ]
        self.normals.extend(norms)

        # 4 UV coordinates
        uvs = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
        self.texcoords.extend(uvs)

        # 6 quad faces (triangulated)
        # (v_idx, t_idx, n_idx)
        quads = [
            # Front (z-)
            [(v_start + 0, t_start + 0, n_start + 0), (v_start + 3, t_start + 3, n_start + 0), (v_start + 2, t_start + 2, n_start + 0)],
            [(v_start + 0, t_start + 0, n_start + 0), (v_start + 2, t_start + 2, n_start + 0), (v_start + 1, t_start + 1, n_start + 0)],
            # Back (z+)
            [(v_start + 5, t_start + 0, n_start + 1), (v_start + 6, t_start + 3, n_start + 1), (v_start + 7, t_start + 2, n_start + 1)],
            [(v_start + 5, t_start + 0, n_start + 1), (v_start + 7, t_start + 2, n_start + 1), (v_start + 4, t_start + 1, n_start + 1)],
            # Left (x-)
            [(v_start + 4, t_start + 0, n_start + 2), (v_start + 7, t_start + 3, n_start + 2), (v_start + 3, t_start + 2, n_start + 2)],
            [(v_start + 4, t_start + 0, n_start + 2), (v_start + 3, t_start + 2, n_start + 2), (v_start + 0, t_start + 1, n_start + 2)],
            # Right (x+)
            [(v_start + 1, t_start + 0, n_start + 3), (v_start + 2, t_start + 3, n_start + 3), (v_start + 6, t_start + 2, n_start + 3)],
            [(v_start + 1, t_start + 0, n_start + 3), (v_start + 6, t_start + 2, n_start + 3), (v_start + 5, t_start + 1, n_start + 3)],
            # Bottom (y-)
            [(v_start + 4, t_start + 0, n_start + 4), (v_start + 0, t_start + 3, n_start + 4), (v_start + 1, t_start + 2, n_start + 4)],
            [(v_start + 4, t_start + 0, n_start + 4), (v_start + 1, t_start + 2, n_start + 4), (v_start + 5, t_start + 1, n_start + 4)],
            # Top (y+)
            [(v_start + 3, t_start + 0, n_start + 5), (v_start + 7, t_start + 3, n_start + 5), (v_start + 6, t_start + 2, n_start + 5)],
            [(v_start + 3, t_start + 0, n_start + 5), (v_start + 6, t_start + 2, n_start + 5), (v_start + 2, t_start + 1, n_start + 5)],
        ]
        self.faces.extend(quads)

    def add_cylinder(self, cx: float, cy: float, cz: float, radius: float, height: float, segments: int = 12):
        """Add an upright polygonal cylinder (legs/posts)."""
        import math
        v_start = len(self.vertices) + 1
        n_start = len(self.normals) + 1
        t_start = len(self.texcoords) + 1
        hy = height / 2.0

        # Ring vertices (bottom and top)
        for i in range(segments):
            angle = (2.0 * math.pi * i) / segments
            x = cx + radius * math.cos(angle)
            z = cz + radius * math.sin(angle)
            self.vertices.append((x, cy - hy, z))
            self.vertices.append((x, cy + hy, z))
            self.normals.append((math.cos(angle), 0.0, math.sin(angle)))
            self.texcoords.append((i / segments, 0.0))
            self.texcoords.append((i / segments, 1.0))

        # Side quads
        for i in range(segments):
            next_i = (i + 1) % segments
            b1 = v_start + i * 2
            t1 = v_start + i * 2 + 1
            b2 = v_start + next_i * 2
            t2 = v_start + next_i * 2 + 1

            n1 = n_start + i
            n2 = n_start + next_i

            self.faces.append([(b1, t_start, n1), (t1, t_start, n1), (t2, t_start, n2)])
            self.faces.append([(b1, t_start, n1), (t2, t_start, n2), (b2, t_start, n2)])


def generate_furniture_3d_mesh(
    category: str = "Chair",
    material: str = "Wood",
    color: str = "Warm Walnut",
    style: str = "Modern",
    finish: str = "Matte",
) -> Tuple[Path, Path]:
    """
    Synthesize 3D OBJ & MTL geometry files matching the selected furniture parameters.
    Returns (obj_path, mtl_path).
    """
    builder = Furniture3DMeshBuilder()
    cat = category.strip().capitalize()

    if cat == "Chair":
        # Seat cushion
        builder.add_box(0.0, 1.4, 0.0, 1.6, 0.25, 1.6)
        # Backrest
        builder.add_box(0.0, 2.3, -0.72, 1.5, 1.6, 0.18)
        # Left & right armrests
        builder.add_box(-0.84, 1.95, -0.05, 0.16, 0.12, 1.4)
        builder.add_box(0.84, 1.95, -0.05, 0.16, 0.12, 1.4)
        # 4 Legs
        builder.add_cylinder(-0.65, 0.68, -0.65, 0.04, 1.35)
        builder.add_cylinder(0.65, 0.68, -0.65, 0.04, 1.35)
        builder.add_cylinder(-0.65, 0.68, 0.65, 0.04, 1.35)
        builder.add_cylinder(0.65, 0.68, 0.65, 0.04, 1.35)

    elif cat == "Sofa":
        # Base platform
        builder.add_box(0.0, 0.9, 0.0, 3.6, 0.45, 1.8)
        # 3 Seat cushions & back cushions
        for i in (-1, 0, 1):
            builder.add_box(i * 1.16, 1.25, 0.05, 1.12, 0.25, 1.6)
            builder.add_box(i * 1.16, 1.85, -0.72, 1.12, 1.1, 0.35)
        # Armrests
        builder.add_box(-1.85, 1.35, 0.0, 0.35, 0.9, 1.85)
        builder.add_box(1.85, 1.35, 0.0, 0.35, 0.9, 1.85)
        # Legs
        for x, z in ((-1.6, -0.75), (1.6, -0.75), (-1.6, 0.75), (1.6, 0.75)):
            builder.add_cylinder(x, 0.33, z, 0.06, 0.65)

    elif cat == "Table":
        # Table top
        builder.add_box(0.0, 2.2, 0.0, 3.4, 0.16, 2.0)
        # Apron
        builder.add_box(0.0, 2.06, 0.0, 3.0, 0.12, 1.6)
        # 4 Legs
        for x, z in ((-1.4, -0.75), (1.4, -0.75), (-1.4, 0.75), (1.4, 0.75)):
            builder.add_cylinder(x, 1.05, z, 0.06, 2.05)

    elif cat == "Bed":
        # Platform base
        builder.add_box(0.0, 0.55, 0.0, 3.0, 0.35, 3.4)
        # Headboard
        builder.add_box(0.0, 1.5, -1.6, 3.1, 1.8, 0.25)
        # Mattress
        builder.add_box(0.0, 0.95, 0.1, 2.75, 0.5, 3.1)
        # Pillows
        builder.add_box(-0.75, 1.28, -1.1, 1.0, 0.18, 0.65)
        builder.add_box(0.75, 1.28, -1.1, 1.0, 0.18, 0.65)
        # 4 Corner legs
        for x, z in ((-1.35, -1.55), (1.35, -1.55), (-1.35, 1.55), (1.35, 1.55)):
            builder.add_box(x, 0.19, z, 0.12, 0.38, 0.12)

    elif cat == "Cabinet":
        # Main body
        builder.add_box(0.0, 1.65, 0.0, 3.4, 1.6, 1.4)
        # 3 Front doors
        for i in (-1, 0, 1):
            builder.add_box(i * 1.11, 1.65, 0.72, 1.08, 1.52, 0.04)
            builder.add_cylinder(i * 1.11 + 0.42, 1.65, 0.77, 0.015, 0.28)
        # 4 Legs
        for x, z in ((-1.5, -0.55), (1.5, -0.55), (-1.5, 0.55), (1.5, 0.55)):
            builder.add_cylinder(x, 0.42, z, 0.04, 0.85)

    else:
        builder.add_box(0.0, 1.4, 0.0, 1.6, 0.25, 1.6)

    # File naming
    slug = f"model_{cat.lower()}_{material.lower()}_{color.lower().replace(' ', '_')}_{finish.lower()}"
    obj_path = OUTPUT_DIR / f"{slug}.obj"
    mtl_path = OUTPUT_DIR / f"{slug}.mtl"

    rgb = PALETTE_RGB.get(color, (0.4, 0.3, 0.2))

    # Write MTL (Material Library)
    with open(mtl_path, "w", encoding="utf-8") as fm:
        fm.write("# FurnForge AI - Material Library\n")
        fm.write(f"newmtl FurnForge_{cat}Material\n")
        fm.write(f"Kd {rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f}\n")
        fm.write("Ka 0.2 0.2 0.2\n")
        if "glossy" in finish.lower():
            fm.write("Ks 0.9 0.9 0.9\nNs 120.0\n")
        elif "polished" in finish.lower():
            fm.write("Ks 0.6 0.6 0.6\nNs 80.0\n")
        elif "metal" in material.lower():
            fm.write("Ks 0.8 0.8 0.8\nNs 90.0\n")
        else:
            fm.write("Ks 0.2 0.2 0.2\nNs 20.0\n")
        fm.write("illum 2\n")

    # Write OBJ (Polygonal Mesh)
    with open(obj_path, "w", encoding="utf-8") as fo:
        fo.write(f"# FurnForge AI 3D Mesh - {cat} ({material}, {color}, {finish})\n")
        fo.write(f"mtllib {mtl_path.name}\n")
        fo.write(f"o FurnForge_{cat}\n\n")

        for v in builder.vertices:
            fo.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")
        fo.write("\n")

        for vn in builder.normals:
            fo.write(f"vn {vn[0]:.4f} {vn[1]:.4f} {vn[2]:.4f}\n")
        fo.write("\n")

        for vt in builder.texcoords:
            fo.write(f"vt {vt[0]:.4f} {vt[1]:.4f}\n")
        fo.write("\n")

        fo.write(f"usemtl FurnForge_{cat}Material\n")
        fo.write("s 1\n")
        for face in builder.faces:
            fo.write(f"f {face[0][0]}/{face[0][1]}/{face[0][2]} {face[1][0]}/{face[1][1]}/{face[1][2]} {face[2][0]}/{face[2][1]}/{face[2][2]}\n")

    return obj_path, mtl_path
