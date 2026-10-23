# s4tools

Browser tools for the Torso S-4. Open the page in Chrome or Edge, plug the S-4 in over USB, and:

- **Live**: play the S-4 from your computer. Four lanes for the four tracks, a tile per device, knobs in an inspector. Teach it any MIDI controller with a right-click (**Learn**), and keep a control map per controller.
- **Record** the S-4's main out to WAV files, or start a take on a threshold or after a pre-click, on the computer or on the S-4.
- **Build**: make S-4 projects from your own samples. A Library to browse folders, 128 scene pads, lanes with tempo and key handling, effects, sends and modulators in the S-4's own units. Preview it in the browser or play it through the S-4 itself, then write the project straight onto the S-4's drive. Projects from the S-4 open back up for editing.

Six colour themes, or System to follow your computer: Paper and Night, Mono and Chalk in shades of grey, Slate and Meadow.

The [guide](docs/GUIDE.md) explains setup, each view, recording, building, and what to do when something goes wrong.

## Running your own copy

It is a static page with no build step. Web MIDI needs https or `localhost`, so serve the folder locally:

```bash
python -m http.server 8765
```

and open http://localhost:8765/. Any https host works too.

## The S-4 project format

[schema/S4-PROJECT.md](schema/S4-PROJECT.md) describes every field of an S-4 `project.json` (meaning, values, units, defaults, MIDI CC), and [schema/s4project.schema.json](schema/s4project.schema.json) has the same as a JSON Schema. Both come from `tools/make_schema.py`. [schema/S4-CC.md](schema/S4-CC.md) lists what every MIDI CC sets on the S-4 across 0-127, measured on the hardware, and [schema/s4cc.json](schema/s4cc.json) has all 128 values of each (from `tools/make_ccref.js`). To check a project:

```bash
python tools/check_schema.py "PROJECTS/MY SONG.s4project/project.json"
```

## Measurements

Units, modes, defaults and the export format were measured on an S-4: test projects with known material, recorded over its ten USB channels and analysed, plus readings from its screen. [VERIFY.md](VERIFY.md) lists the results and `tools/` holds the scripts (`tools/devserver.py` is a local server that also accepts their uploads). [S4-TODO.md](S4-TODO.md) tracks what is still open.

## Testing

`tools/selftest.js` runs through the whole app in the browser against a fake S-4, a fake MIDI controller and a generated audio input, and checks what goes out over MIDI, what lands in the project and what the screen shows, in every theme. It replaces the Build project, so run it in a browser profile without work in it. It imports `tools/uploads/S4T_VERIFY5.zip` (made by `tools/verify5_build.js`) and browses the folders `tools/devserver.py` serves under `/ext/`. Serve the folder with `tools/devserver.py`, open the page, and in the console:

```js
await (0, eval)(await (await fetch('/tools/selftest.js')).text())
```

## Support

s4tools is free. If it helps you, there's a [Ko-fi](https://ko-fi.com/slywriter).

## License

MIT, see [LICENSE](LICENSE). s4tools is independent and not affiliated with Torso Electronics.
