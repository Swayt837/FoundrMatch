"""
Generate the app icon set from a single definition.

The mark: two founder silhouettes standing together, the front one slightly
larger and separated from the one behind by a cut of background rather than an
outline — at 40x40 a stroke fills in and the pair reads as one blob.

The gold is a vertical gradient rather than a flat fill, which is most of what
makes it read as metal instead of mustard. It is painted through a mask, so the
gradient and the geometry stay independent.

Everything is drawn at 4x and downsampled: clean edges with no SVG rasteriser
and no native dependency.

Run: python scripts/make-icons.py
"""
from PIL import Image, ImageDraw

OUT = "assets/images"

GOLD_TOP = (236, 205, 110)     # lit edge
GOLD_BOTTOM = (186, 146, 38)   # shadowed base
INK = (9, 9, 11)               # theme.colors.surface #09090B

SS = 4                         # supersampling factor
GAP = 30                       # background-coloured cut between the figures

# Two figures in an arbitrary design space; the bounding box is measured below,
# so these numbers can be tuned without touching any of the fitting maths.
# Both share a baseline: the depth comes from the head and shoulder sizes, and
# offsetting the base as well left a visible step where the two bodies meet.
BASE_Y = 705

FIGURES = [
    # the one behind: smaller, head sits lower
    dict(cx=606, head_y=418, head_r=84, body_w=138, body_h=150, base_y=BASE_Y),
    # the one in front
    dict(cx=424, head_y=398, head_r=97, body_w=160, body_h=175, base_y=BASE_Y),
]


def shapes(fig, grow=0):
    """
    The two primitives making up a figure: head circle, shoulders dome.

    The body box is the *full* ellipse, centred on the baseline — `pieslice`
    puts the flat edge of a 180->360 slice at the box's vertical midpoint, not
    at its bottom. Sizing the box to the visible dome instead made every figure
    end at `base_y - body_h/2`, so two figures with different shoulder heights
    finished at different levels and left a step where they met.
    """
    g = grow
    head = [fig["cx"] - fig["head_r"] - g, fig["head_y"] - fig["head_r"] - g,
            fig["cx"] + fig["head_r"] + g, fig["head_y"] + fig["head_r"] + g]
    body = [fig["cx"] - fig["body_w"] - g, fig["base_y"] - fig["body_h"] - g,
            fig["cx"] + fig["body_w"] + g, fig["base_y"] + fig["body_h"] + g]
    return head, body


def mark_bounds():
    """
    Bounding box of what is actually visible, so fitting is never hand-tuned.

    The body box extends below the baseline by construction, but nothing is
    painted there — the bottom is clamped so the mark is not fitted around
    empty space.
    """
    xs, ys = [], []
    for fig in FIGURES:
        head, body = shapes(fig)
        xs += [head[0], head[2], body[0], body[2]]
        ys += [head[1], head[3], body[1], fig["base_y"]]
    return min(xs), min(ys), max(xs), max(ys)


def build_mask(size, fraction):
    """
    White where the mark is, black elsewhere.

    `fraction` is how much of the canvas the mark's longest side should span.
    Android crops the adaptive foreground to a shape of its choosing, so its
    value is much smaller than the one used for iOS.
    """
    x0, y0, x1, y1 = mark_bounds()
    k = size * fraction / max(x1 - x0, y1 - y0)
    ox = size / 2 - (x0 + (x1 - x0) / 2) * k
    oy = size / 2 - (y0 + (y1 - y0) / 2) * k

    def place(box):
        return [ox + box[0] * k, oy + box[1] * k, ox + box[2] * k, oy + box[3] * k]

    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)

    back, front = FIGURES
    for fig, grow, colour in (
        (back, 0, 255),          # figure behind
        (front, GAP, 0),         # cut it back out around the front figure
        (front, 0, 255),         # figure in front
    ):
        head, body = shapes(fig, grow)
        draw.ellipse(place(head), fill=colour)
        # pieslice 180->360 is the top half of an ellipse: shoulders, no bezier.
        draw.pieslice(place(body), 180, 360, fill=colour)

    return mask


def gradient(size):
    """Vertical gold ramp, drawn once and reused as the fill."""
    ramp = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(size - 1, 1)
        ramp.putpixel((0, y), tuple(
            round(a + (b - a) * t) for a, b in zip(GOLD_TOP, GOLD_BOTTOM)
        ))
    return ramp.resize((size, size))


def render(path, size, fraction, background):
    """`background` None means a transparent canvas."""
    big = size * SS
    mask = build_mask(big, fraction)
    fill = gradient(big)

    if background is None:
        img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        img.paste(fill, (0, 0), mask)
    else:
        img = Image.new("RGB", (big, big), background)
        img.paste(fill, (0, 0), mask)

    img.resize((size, size), Image.LANCZOS).save(path)
    print(f"  {path}  {size}x{size}  {'opaque' if background else 'transparent'}")


if __name__ == "__main__":
    print("Generating icons...")
    # App Store rejects any alpha channel on the marketing icon (ITMS-90717),
    # so this one is RGB with the background painted in rather than RGBA.
    render(f"{OUT}/icon.png", 1024, 0.62, INK)
    # Android crops the foreground; the mark must stay in the central safe zone,
    # and the canvas stays transparent so app.json's backgroundColor shows.
    render(f"{OUT}/adaptive-icon.png", 1024, 0.42, None)
    render(f"{OUT}/splash-image.png", 1024, 0.55, None)
    render(f"{OUT}/favicon.png", 256, 0.66, INK)
    print("Done.")
