#!/usr/bin/env python3
"""Μαζεύει όλο τον κώδικα του 3D coach σε ένα markdown για επικόλληση σε άλλη AI."""
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
files = ['js/ik.js', 'js/motions.js', 'js/avatar.js', 'js/skinned.js', 'js/equipment.js']
out = ['# GymTrAIner — 3D coach code bundle\n', 'Τα αρχεία του 3D coach. Δες `docs/3d-coach-handoff.md` για το prompt.\n']
for f in files:
    out.append(f'\n## {f}\n\n```javascript\n{(root / f).read_text()}\n```\n')
(root / 'docs/3d-coach-code-bundle.md').write_text(''.join(out))
print('OK', root / 'docs/3d-coach-code-bundle.md')
