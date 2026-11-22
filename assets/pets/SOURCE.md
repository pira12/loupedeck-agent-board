# Codex pet artwork

`codex.png` is **not** part of this repository. It is the built-in "Codex" terminal pet from
OpenAI's Codex CLI, © OpenAI. `install.sh` (or `npm run fetch-pets`) downloads it from OpenAI's
public CDN and converts it to PNG:

    https://persistent.oaistatic.com/codex/pets/v1/codex-spritesheet-v4.webp

Sheet layout: 8 columns × 9 rows of 192×208 cells. Rows: 0 idle, 1 run-right, 2 run-left,
3 waving, 4 jumping, 5 failed, 6 waiting, 7 running, 8 review.

If the file is missing, Codex sessions fall back to the Claude mascot.
