"""Pochettes SVG de la demo, style B de `01-pochettes-options.html` (option validee le 2026-10-25).

Port de `coverB` : hash FNV-1a 32 bits sur les points de code, generateur mulberry32,
memes formules par motif. Seule la sortie change : chaque nombre calcule est ecrit a deux
decimales fixes, pour un rendu identique d'un enregistrement a l'autre.
"""

import math
from functools import reduce
from typing import TYPE_CHECKING, Final, assert_never

from demo_catalogue import Motif

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

    from demo_catalogue import DemoTrack, Release

_UINT32: Final = 0xFFFFFFFF
_FNV_OFFSET: Final = 2166136261
_FNV_PRIME: Final = 16777619
_MULBERRY_INCREMENT: Final = 0x6D2B79F5
_TWO_POW_32: Final = 4294967296
_FONT: Final = 'font-family="Inter, system-ui, sans-serif"'


def render_cover(release: Release, title: str) -> str:
    """Motif du label, variation et teinte tirees de la reference et du titre."""
    label = release.label
    random = _mulberry32(_fnv1a(release.reference + title))
    hue = (label.hue + next(random) * 30 - 15 + 360) % 360
    accent = f"hsl({_number(hue)} 75% 62%)"
    shade = f"hsl({_number((hue + 25) % 360)} 55% 38%)"
    body = _motif(label.motif, random, accent, shade)
    return (
        '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">'
        f'<rect width="200" height="200" fill="{label.background}"/>{body}'
        f'<text x="188" y="190" font-size="8" text-anchor="end" fill="{label.foreground}"'
        f' opacity=".6" {_FONT}>{release.reference}</text></svg>'
    )


def cover_name(release: Release) -> str:
    """Nom du fichier de la pochette d'une sortie, sous `artworks/`."""
    return f"{release.reference}.svg"


def render_covers(tracks: Sequence[DemoTrack]) -> dict[str, str]:
    """Une pochette par sortie, par `cover_name` ; un morceau sans sortie n'en a pas."""
    return {
        cover_name(release): render_cover(release, track.title)
        for track in tracks
        if (release := track.release) is not None
    }


def _fnv1a(text: str) -> int:
    return reduce(
        lambda hashed, char: ((hashed ^ ord(char)) * _FNV_PRIME) & _UINT32, text, _FNV_OFFSET
    )


def _mulberry32(seed: int) -> Iterator[float]:
    """Arithmetique 32 bits non signee : memes bits que les `Math.imul` et `>>>` du JavaScript."""
    state = seed
    while True:
        state = (state + _MULBERRY_INCREMENT) & _UINT32
        mixed = ((state ^ (state >> 15)) * (1 | state)) & _UINT32
        mixed = ((mixed + (((mixed ^ (mixed >> 7)) * (61 | mixed)) & _UINT32)) & _UINT32) ^ mixed
        yield (mixed ^ (mixed >> 14)) / _TWO_POW_32


def _number(value: float) -> str:
    return f"{value:.2f}"


def _motif(motif: Motif, random: Iterator[float], accent: str, shade: str) -> str:
    match motif:
        case Motif.RINGS:
            return _rings(random, accent, shade)
        case Motif.WAVES:
            return _waves(random, accent, shade)
        case Motif.GRID:
            return _grid(random, accent, shade)
        case Motif.DOTS:
            return _dots(random, accent, shade)
        case _:
            assert_never(motif)


def _rings(random: Iterator[float], accent: str, shade: str) -> str:
    cx = _number(50 + next(random) * 100)
    cy = _number(50 + next(random) * 100)
    return "".join(
        f'<circle cx="{cx}" cy="{cy}" r="{i * 11}" fill="none"'
        f' stroke="{shade if i % 3 else accent}" stroke-width="{1 if i % 3 else 2.5}"'
        f' opacity="{_number(1 - i / 20)}"/>'
        for i in range(1, 17)
    )


def _waves(random: Iterator[float], accent: str, shade: str) -> str:
    frequency = 0.02 + next(random) * 0.04
    amplitude = 6 + next(random) * 14
    phase = next(random) * 6

    def path(k: int) -> str:
        points = "".join(
            ("L" if x else "M")
            + f"{x} "
            + _number(
                20
                + k * 11
                + math.sin(x * frequency + phase + k * 0.35) * amplitude * (0.4 + k / 16)
            )
            for x in range(0, 201, 5)
        )
        return (
            f'<path d="{points}" fill="none" stroke="{shade if k % 4 else accent}"'
            f' stroke-width="{1 if k % 4 else 2}"/>'
        )

    return "".join(path(k) for k in range(16))


def _grid(random: Iterator[float], accent: str, shade: str) -> str:
    first_angle = next(random) * 30 - 15
    second_angle = first_angle + 3 + next(random) * 6

    def lines(angle: float, color: str, width: str) -> str:
        strokes = "".join(
            f'<line x1="-60" x2="260" y1="{-60 + i * 8}" y2="{-60 + i * 8}"'
            f' stroke="{color}" stroke-width="{width}"/>'
            for i in range(42)
        )
        return f'<g transform="rotate({_number(angle)} 100 100)">{strokes}</g>'

    return lines(first_angle, shade, "1.2") + lines(second_angle, accent, "1")


def _dots(random: Iterator[float], accent: str, shade: str) -> str:
    cx = 60 + next(random) * 80
    cy = 60 + next(random) * 80

    def dot(x: int, y: int) -> str:
        distance = math.hypot(x - cx, y - cy)
        radius = _number(max(0.6, 5 - distance / 28))
        fill = accent if distance < 50 else shade
        return f'<circle cx="{x}" cy="{y}" r="{radius}" fill="{fill}"/>'

    return "".join(dot(x, y) for y in range(10, 200, 12) for x in range(10, 200, 12))
