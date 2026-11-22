#!/usr/bin/env python3
"""Μαζεύει όλο τον κώδικα του 3D coach σε ένα markdown για επικόλληση σε άλλη AI."""
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
files = ['js/ik.js', 'js/motions.js', 'js/avatar.js', 'js/skinned.js', 'js/equipment.js', 'js/hair.js', 'gallery.html']
out = ['# GymTrAIner — 3D coach code bundle\n', 'Τα αρχεία του 3D coach. Δες `docs/3d-coach-round4.md` για το prompt του τρέχοντος γύρου.\n']
for f in files:
    lang = 'html' if f.endswith('.html') else 'javascript'
    out.append(f'\n## {f}\n\n```{lang}\n{(root / f).read_text()}\n```\n')
(root / 'docs/3d-coach-code-bundle.md').write_text(''.join(out))
print('OK', root / 'docs/3d-coach-code-bundle.md')
