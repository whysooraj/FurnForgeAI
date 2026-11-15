import cv2
import numpy as np
from pathlib import Path

out_dir = Path("backend/sample_sketches")
out_dir.mkdir(parents=True, exist_ok=True)

def create_sketch_canvas():
    # 512x512 canvas with subtle paper texture
    img = np.ones((512, 512, 3), dtype=np.uint8) * 255
    return img

def draw_chair():
    canvas = create_sketch_canvas()
    line_col = (40, 40, 45) # charcoal pencil
    thickness = 3

    # Backrest (curved organic lounge chair)
    pts_back = np.array([
        [180, 120], [256, 100], [332, 120],
        [340, 240], [320, 270], [192, 270], [172, 240]
    ], np.int32)
    cv2.polylines(canvas, [pts_back], isClosed=True, color=line_col, thickness=thickness, lineType=cv2.LINE_AA)
    
    # Internal cushion contour lines
    cv2.ellipse(canvas, (256, 175), (55, 60), 0, 0, 360, line_col, 2, cv2.LINE_AA)

    # Seat cushion (curved horizontal)
    pts_seat = np.array([
        [150, 260], [362, 260],
        [370, 320], [340, 335], [172, 335], [142, 320]
    ], np.int32)
    cv2.polylines(canvas, [pts_seat], isClosed=True, color=line_col, thickness=thickness, lineType=cv2.LINE_AA)
    
    # Front cushion edge line
    cv2.line(canvas, (160, 295), (352, 295), line_col, 2, cv2.LINE_AA)

    # Armrests
    cv2.line(canvas, (172, 220), (145, 270), line_col, 3, cv2.LINE_AA)
    cv2.line(canvas, (145, 270), (155, 310), line_col, 2, cv2.LINE_AA)
    
    cv2.line(canvas, (340, 220), (367, 270), line_col, 3, cv2.LINE_AA)
    cv2.line(canvas, (367, 270), (357, 310), line_col, 2, cv2.LINE_AA)

    # Legs (tapered mid-century wooden/metal legs)
    # Front-left leg
    cv2.line(canvas, (180, 335), (150, 440), line_col, 4, cv2.LINE_AA)
    # Front-right leg
    cv2.line(canvas, (332, 335), (362, 440), line_col, 4, cv2.LINE_AA)
    # Back-left leg
    cv2.line(canvas, (205, 330), (185, 415), line_col, 3, cv2.LINE_AA)
    # Back-right leg
    cv2.line(canvas, (307, 330), (327, 415), line_col, 3, cv2.LINE_AA)

    # Cross stretcher
    cv2.line(canvas, (168, 385), (344, 385), line_col, 2, cv2.LINE_AA)

    cv2.imwrite(str(out_dir / "chair_sketch.png"), canvas)

def draw_sofa():
    canvas = create_sketch_canvas()
    line_col = (40, 40, 45)
    thickness = 3

    # Main curved backrest
    pts_back = np.array([
        [90, 200], [256, 175], [422, 200],
        [435, 280], [77, 280]
    ], np.int32)
    cv2.polylines(canvas, [pts_back], isClosed=True, color=line_col, thickness=thickness, lineType=cv2.LINE_AA)

    # Armrests (pillowy modern rounded)
    cv2.ellipse(canvas, (95, 275), (28, 45), 0, 0, 360, line_col, thickness, cv2.LINE_AA)
    cv2.ellipse(canvas, (417, 275), (28, 45), 0, 0, 360, line_col, thickness, cv2.LINE_AA)

    # Deep seat cushions (3 cushions)
    pts_seat = np.array([
        [95, 280], [417, 280],
        [420, 360], [92, 360]
    ], np.int32)
    cv2.polylines(canvas, [pts_seat], isClosed=True, color=line_col, thickness=thickness, lineType=cv2.LINE_AA)

    # Cushion vertical dividers
    cv2.line(canvas, (202, 200), (202, 360), line_col, 2, cv2.LINE_AA)
    cv2.line(canvas, (310, 200), (310, 360), line_col, 2, cv2.LINE_AA)

    # Horizontal seat crease
    cv2.line(canvas, (92, 320), (420, 320), line_col, 2, cv2.LINE_AA)

    # Minimalist recessed block / cylindrical legs
    cv2.line(canvas, (115, 360), (115, 400), line_col, 5, cv2.LINE_AA)
    cv2.line(canvas, (256, 360), (256, 400), line_col, 5, cv2.LINE_AA)
    cv2.line(canvas, (397, 360), (397, 400), line_col, 5, cv2.LINE_AA)

    cv2.imwrite(str(out_dir / "sofa_sketch.png"), canvas)

def draw_table():
    canvas = create_sketch_canvas()
    line_col = (40, 40, 45)
    thickness = 3

    # Oval / Elliptical tabletop in perspective
    cv2.ellipse(canvas, (256, 210), (180, 55), 0, 0, 360, line_col, thickness, cv2.LINE_AA)
    # Tabletop bevel thickness
    cv2.ellipse(canvas, (256, 222), (180, 55), 0, 0, 180, line_col, thickness, cv2.LINE_AA)
    cv2.line(canvas, (76, 210), (76, 222), line_col, thickness, cv2.LINE_AA)
    cv2.line(canvas, (436, 210), (436, 222), line_col, thickness, cv2.LINE_AA)

    # Sculptural pedestal base / fluted central column
    cv2.line(canvas, (215, 222), (205, 375), line_col, thickness, cv2.LINE_AA)
    cv2.line(canvas, (297, 222), (307, 375), line_col, thickness, cv2.LINE_AA)
    # Fluting lines
    cv2.line(canvas, (235, 222), (233, 375), line_col, 2, cv2.LINE_AA)
    cv2.line(canvas, (256, 222), (256, 375), line_col, 2, cv2.LINE_AA)
    cv2.line(canvas, (277, 222), (279, 375), line_col, 2, cv2.LINE_AA)

    # Base footprint ring
    cv2.ellipse(canvas, (256, 375), (75, 20), 0, 0, 360, line_col, thickness, cv2.LINE_AA)

    cv2.imwrite(str(out_dir / "table_sketch.png"), canvas)

def draw_bed():
    canvas = create_sketch_canvas()
    line_col = (40, 40, 45)
    thickness = 3

    # Tall upholstered headboard with vertical channels
    cv2.rectangle(canvas, (110, 110), (402, 260), line_col, thickness)
    for x in range(145, 400, 35):
        cv2.line(canvas, (x, 110), (x, 260), line_col, 2, cv2.LINE_AA)

    # Pillows
    cv2.rectangle(canvas, (130, 225), (240, 275), line_col, 2)
    cv2.rectangle(canvas, (272, 225), (382, 275), line_col, 2)

    # Mattress & Duvet in 3D perspective
    pts_mattress = np.array([
        [110, 260], [402, 260],
        [430, 395], [82, 395]
    ], np.int32)
    cv2.polylines(canvas, [pts_mattress], isClosed=True, color=line_col, thickness=thickness, lineType=cv2.LINE_AA)

    # Duvet fold / throw blanket
    cv2.line(canvas, (92, 335), (420, 335), line_col, 2, cv2.LINE_AA)

    # Low platform bed frame & feet
    cv2.line(canvas, (82, 395), (82, 425), line_col, 5, cv2.LINE_AA)
    cv2.line(canvas, (430, 395), (430, 425), line_col, 5, cv2.LINE_AA)
    cv2.line(canvas, (82, 425), (430, 425), line_col, 3, cv2.LINE_AA)

    cv2.imwrite(str(out_dir / "bed_sketch.png"), canvas)

def draw_cabinet():
    canvas = create_sketch_canvas()
    line_col = (40, 40, 45)
    thickness = 3

    # Main rectangular credenza / sideboard frame
    cv2.rectangle(canvas, (95, 170), (417, 355), line_col, thickness)
    
    # Beveled top counter
    cv2.line(canvas, (85, 160), (427, 160), line_col, thickness, cv2.LINE_AA)
    cv2.line(canvas, (85, 160), (95, 170), line_col, 2, cv2.LINE_AA)
    cv2.line(canvas, (427, 160), (417, 170), line_col, 2, cv2.LINE_AA)

    # Door / Drawer dividers (3 sections)
    cv2.line(canvas, (202, 170), (202, 355), line_col, 2, cv2.LINE_AA)
    cv2.line(canvas, (310, 170), (310, 355), line_col, 2, cv2.LINE_AA)

    # Horizontal shelf / drawer lines in central unit
    cv2.line(canvas, (202, 230), (310, 230), line_col, 2, cv2.LINE_AA)
    cv2.line(canvas, (202, 290), (310, 290), line_col, 2, cv2.LINE_AA)

    # Minimalist sleek door handles / pulls
    cv2.line(canvas, (185, 245), (185, 275), line_col, 3, cv2.LINE_AA)
    cv2.line(canvas, (327, 245), (327, 275), line_col, 3, cv2.LINE_AA)
    cv2.line(canvas, (246, 200), (266, 200), line_col, 3, cv2.LINE_AA)
    cv2.line(canvas, (246, 260), (266, 260), line_col, 3, cv2.LINE_AA)
    cv2.line(canvas, (246, 320), (266, 320), line_col, 3, cv2.LINE_AA)

    # Architectural sled metal legs
    cv2.line(canvas, (120, 355), (120, 420), line_col, 4, cv2.LINE_AA)
    cv2.line(canvas, (392, 355), (392, 420), line_col, 4, cv2.LINE_AA)
    cv2.line(canvas, (110, 420), (402, 420), line_col, 3, cv2.LINE_AA)

    cv2.imwrite(str(out_dir / "cabinet_sketch.png"), canvas)

draw_chair()
draw_sofa()
draw_table()
draw_bed()
draw_cabinet()
print("Sample sketches generated successfully.")

