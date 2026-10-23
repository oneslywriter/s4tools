# Using s4tools

s4tools runs in your browser and works with a Torso S-4 connected over USB. **Live** plays the S-4 from your computer and records it. **Build** makes S-4 projects out of your own samples and puts them on the S-4.

It is a free, independent project. Torso Electronics didn't make it and doesn't support it.

## Contents

1. [Getting set up](#1-getting-set-up)
2. [Playing the S-4 live](#2-playing-the-s-4-live)
3. [Learning your controller](#3-learning-your-controller)
4. [Recording](#4-recording)
5. [Building a project](#5-building-a-project)
6. [The Library](#6-the-library)
7. [Hearing it on the S-4](#7-hearing-it-on-the-s-4)
8. [Moving projects](#8-moving-projects)
9. [Settings](#9-settings)
10. [When things go wrong](#10-when-things-go-wrong)
11. [What it can't do](#11-what-it-cant-do)

---

## 1. Getting set up

Use **Chrome or Edge on a computer**. s4tools needs Web MIDI, folder access and audio input, and other browsers lack at least one of them.

Connect the S-4 with a USB cable. On Windows it appears twice: as **MIDI function** for MIDI and as **Source/Sink** for audio.

In the S-4's MIDI settings, switch these on:

| On the S-4 | Why |
|---|---|
| CC CONTROL | so knobs in Live reach it |
| PROGRAM CHANGE | so picking a scene in Live changes it |
| SYNC OUT | so s4tools sees its tempo and knows it heard start / stop |
| START STOP | only if Settings › Start / stop is set to MIDI start / stop |

The browser asks before s4tools may use:

- **MIDI**: needed for everything in Live;
- **the microphone**: the S-4's USB audio counts as one. Only the recorder and the lists of audio outputs need it;
- **a folder's files**: only when you export to the S-4's drive or open a project from it.

Open s4tools and allow MIDI. At the top right, **Connected** with a green dot means it found the S-4.

**Your work stays in this browser.** Build projects, samples and control maps are kept for this web address in this browser. Clearing the site's data removes them, and they don't follow you to another computer. **Project › Back up for s4tools…** saves a copy you can keep.

---

## 2. Playing the S-4 live

Live shows the S-4's four tracks as four coloured lanes.

**Along the top:**

- **Scene**: the arrows step through the scenes, and the number opens all 128 as pads. Picking one sends the S-4 a program change.
- **Master**: MAIN and COMPRESS.
- **Macros**: shows M1–M8 as knobs and M9–M12 as buttons, held while you press them.
- In the header: **play** starts and stops the S-4 (or press **Space**), **Rec** is the S-4's main recording, and the tempo appears while the S-4 plays.

**Each lane:**

- **M** mutes the track and **S** solos it. Under them, the track's own start / stop, record and monitor.
- Six tiles: MATERIAL, GRANULAR, FILTER, COLOR, SPACE and MODS. The little bars on a tile are its knobs at a glance. A tile turns pale when the device is switched off.
- At the end: the track's LVL, PAN and FLTR from the S-4's mixer.

**The inspector** on the right holds the knobs of the tile you clicked (keys **1–4** jump between tracks).

- Its name is a menu. Set it to the device your S-4 really has in that slot, since MIDI can't tell s4tools, or change it on the S-4. For MODS, the menu sets each modulator's type (WAVE, RANDOM, FOLLOW, ADSR).
- The three buttons switch the device off, put its knobs back to their defaults, and roll random values. Switching off turns its WET (or LEVEL) down to zero and remembers where it was, because MIDI has no bypass.

**What the knobs show.** The S-4 never reports its knobs, so Live shows what s4tools last sent. When you pick a scene, **Follow the project** (on by default) moves the knobs to that scene's values in the Build project, so open your S-4's project in Build first. The mixer and the macros belong to the whole project, not to a scene, so Live takes them once: on the first scene you pick after exporting or opening a project. After that they stay as you set them, as they do on the S-4. **Settings › Resend** goes the other way and sends every value to the S-4.

### Knobs

- Drag up or down. Hold **Shift** for small steps.
- Scroll the mouse wheel, or use the arrow keys; **Home** and **End** jump to the ends.
- Double-click a knob to reset it to the S-4's own default (what a fresh device has).
- Where the value is underlined when you point at it, click it and type.

---

## 3. Learning your controller

Plug your MIDI controller in and tick it under **Settings › Controllers**.

**One control:** right-click anything in Live (a knob, a button, a scene pad) and choose **Learn from controller**. Then move a knob or press a pad on your controller. That's it.

**Many controls:** press **Learn** in the header (or **L**). Click a control on screen, move one on your controller, and carry on with the next. **Esc** or **Done** ends it. Learned controls get a small blue dot.

To unlearn, right-click the control and choose **Forget**.

### Control maps

Everything you learn goes into a **control map**: one per controller, or one per song. The **Control maps** menu switches between them, makes new ones, copies, renames and deletes them, and saves them to a file or loads them back.

**Edit this map…** lists every learned control. For each one you can:

- set the encoder type: **Absolute**, or **Relative 1–3** for endless encoders. s4tools guesses it while learning;
- **Invert** it;
- limit how far it reaches: drag either end of its range (double-click for the whole range);
- for buttons, choose **Toggle** (press on, press off) or **Hold** (on only while held).

Three switches at the bottom:

| | |
|---|---|
| **Catch** | A knob takes over only once it reaches the value on screen, so nothing jumps. A message tells you where to turn it. |
| **Play notes on the S-4** | Keys and pads you haven't learned play the track picked in Live, which is handy for POLY. |
| **Scenes from program changes** | Program changes from your controller pick the S-4's scene: program 1 is scene 1. |

---

## 4. Recording

The bar at the bottom of Live listens to the **S-4's main out**. Chrome only hands a page the main pair of the S-4's ten USB channels, so a single track is recorded by soloing it.

Click the meter to start listening (the browser asks for the microphone the first time). The arrow beside it chooses another input.

### Record to PC

Press **Record to PC**, then **Stop**. The take downloads as a 24-bit, 48 kHz WAV with the date and time in its name.

### Threshold

The take starts by itself when something plays.

1. Choose **Threshold**.
2. Set the **Threshold** knob a little above the noise floor. The line on the meter shows it.
3. Choose where it goes (the **→** button): **PC** for a WAV here, **T1–T4** for the S-4 to record that track, or **MAIN** for the S-4's main recording.
4. Set **Stops after**: seconds of quiet, or 0 to stop it yourself.
5. Press **Arm** and play.

A take on the PC starts half a second before the sound, so the attack is never cut.

A take on the S-4 needs a few things:

- The S-4 records only while it plays, so **Arm** starts it if needed.
- Set its TRACK RECORD (or MAIN RECORD) quantisation to **NONE**, or it waits for the beat.
- The sound must reach the main out, so turn the track's monitor on (the bar shows a **MON** button for it).
- The sound travels to the computer and the record command travels back, so **the S-4 misses about the first 45 ms**. For drums, record to the PC.

### Pre-click

The take starts after a pre-click of one or two bars, in time with the S-4.

1. Choose **Pre-click**.
2. In its menu, pick **1 or 2 bars** and where the **click** plays: **here** (any output on this computer; choose speakers or headphones, not the S-4), **on the S-4** (out of its main out; nothing to set up there), or **no click** (the button counts down).
3. Choose where the take goes, and its **Length** in bars (0: until you stop it).
4. Stop the S-4 and press **Pre-click**.

The tempo is the Build project's. On the first beat the S-4 starts (and records, for an S-4 take). Both commands are sent ahead of time so they land on the beat, and a take with a length ends on the bar (a take on the PC runs a moment longer, so the bar's end is all there). With the click on the S-4, its bar 1 lands within a few milliseconds of the click's beat.

---

## 5. Building a project

Build makes a complete S-4 project: up to 128 scenes of four tracks each.

**The toolbar** under the header holds the **Project** menu, the name, the tempo (click to type, scroll to change), the **Key**, play and **Loop** for the preview, **Play on S-4** and **Export**.

### Scenes

The pads show the 128 scenes; coloured marks show which tracks have something in them.

- **Click** a pad to work on that scene. While the preview plays, it changes over when the time comes.
- **Double-click** to name it.
- **Right-click** for **Chain** and **Lock** (the S-4's own), rename, copy or clear.
- **New** jumps to the next empty scene; **Copy** and **Clear** act on the selected one.
- The sliders button sets **Scene changes**: the S-4's RULE, CHANCE and QUANTIZE (exported), and when the preview here switches.
- The arrow folds the pads to the selected scene's row.

### Tracks

Each lane is one track of the selected scene.

- The **material** under the track number: DISC, TAPE, POLY, or BYPASS for live input.
- **Drop** audio on the lane, drag it from the [Library](#6-the-library), or click the empty lane to pick a file. Drop several files or a folder and the first one loads; the rest go to the Library.
- Under the waveform, the **tempo** tag: ● from the file name or set by you, ≈ detected from the audio, ~ guessed from its length. Click it to double, halve, detect again or type a tempo.
- The **key** tag: the sample's key (≈ when detected), or **No key** for drums and other unpitched sounds, which are never shifted. Click it to detect a key, set one, or tune the sample to A440.
- **M** mutes the track in every scene, on the S-4 too. **S** solos it here, in the preview.
- **LVL, PAN, FLTR** at the end are the project's mixer: the same in every scene, like the S-4's MIX page.

### The inspector

Click a lane, then use the tabs on the right.

**Sample:**

- **Tempo:** *Sync* plays the sample at the project tempo by changing its speed (the pitch moves with it). *Stretch* keeps the pitch; **Warp** chooses how: BEATS for drums, TONES for single notes and bass, COMPLEX for chords and full mixes, or S-4 to let the S-4 stretch it (DISC, whole semitones only). *As recorded* leaves it alone.
- **Key:** with a project key set in the toolbar, loops whose key is known move into it. Only Stretch can change pitch without changing tempo, so tracks switch to it when they need to. **Leave** keeps a track out of it.
- The material's knobs and switches (REVERSE, FREEZE, LOOP, MONITOR), with **Reset** and **Randomize**.
- **Trim and fades:** drag **IN** and **OUT** on the waveform, set the fades, and **Audition** the track by itself. The expand button opens the editor in place of the lanes.

**Effects:** MOSAIC, RING, DEFORM and VAST, each **On** or **Bypass**. The values are in the S-4's own units; where a name has a dotted line, click it to change the S-4's mode for that knob. Moving a knob switches the effect on.

**Sends:** how much of this track feeds tracks 1–4, per scene.

**Mods:** the track's four modulators in this scene: type, values, and where each one goes (**Add a target**).

### Previewing

**Space** plays the selected scene here. With **Loop** on it repeats; off, the next scene follows. The preview plays samples, tempo, key, trims, fades and the mixer. It doesn't imitate the S-4's effects, sends or modulators; for those, [play it on the S-4](#7-hearing-it-on-the-s-4).

### The Project menu

| | |
|---|---|
| Export to the S-4 · Open a project from the S-4… · Choose the S-4 folder… | Write to and read from the S-4's drive. See [Moving projects](#8-moving-projects). |
| New project | Starts over. Export or back up first if you want to keep the current one. |
| Project settings… | The S-4 project's own settings, written into the export: inputs, MIC GAIN, track MIDI channels, record quantisation, what keeps running, POST RECORD ACTION, scene changes, KEEP SAMPLE / PARAMS, which tracks play on load, and the names of the PERFORM macros. |
| Perform: macros and modulators… | Macro values, what each macro moves, and the four Perform modulators. |
| Mix modulators… | The four modulators that move the mixer. |
| Import an S-4 project folder… · Import a project zip… | Bring in an S-4 project, a zip of one, or an s4tools backup. |
| Export as a zip for the S-4… · Back up for s4tools… | Download the project. |
| Clear out unused samples | Removes stored samples that no scene uses. |

---

## 6. The Library

The Library on the left of Build is for finding samples.

- **Folder…** picks a folder on your computer; dropping a folder onto the Library works too.
- Type in **Search** to narrow the list.
- **Click** a file to listen. Click it again, or press **Esc**, to stop.
- **Drag** a file onto a lane to load it, or point at it and use the **1–4** buttons.

Browsers don't let a page keep a folder open between visits, so you choose it again next time. The library button at its top folds the panel away.

---

## 7. Hearing it on the S-4

**Play on S-4** sends the preview through the S-4 itself, so you hear its real effects and mixer.

1. On the S-4, set the MATERIAL of all four tracks to **BYPASS**. A track in BYPASS plays whatever arrives on its USB input.
2. Open **Play on S-4** in the toolbar and choose **Play on the S-4**.
3. Under **Sound goes to**, choose the S-4 (the browser asks for the microphone once, just to show device names).
4. Press play.

Nothing? Use **Beep on T1…T4** to check each track. If the beeps land on the wrong tracks, switch how the browser numbers the S-4's USB inputs in the same menu.

**Also send each scene's effect settings over MIDI** sends GRANULAR, FILTER, COLOR and SPACE to the S-4 whenever a scene starts.

If the S-4 is your computer's default output, system sounds go there too, and a sound that stops abruptly can leave the S-4 buzzing on track 1. Keep your speakers as the default and choose the S-4 under Sound goes to.

---

## 8. Moving projects

### Onto the S-4

1. Put the S-4 in **USB storage mode**; it shows up as a drive.
2. Press **Export** in the toolbar.
3. The first time, choose the S-4's **PROJECTS** folder and let the browser edit it. s4tools remembers it.
4. The project is written as `NAME.s4project`. Names are up to 12 capitals, digits, spaces, `_` or `-`. An existing project is never overwritten; you are asked for another name.
5. Eject the drive, leave USB storage mode, and open the project on the S-4.

Samples are written as 48 kHz, 24-bit WAV. TAPE and POLY tracks share the S-4's 36 sample buffers per project, and the export warns you if the project needs more.

### Off the S-4

**Project › Open a project from the S-4…** lists the projects on the drive and brings in the one you choose, samples included. Some of a project isn't shown in Build (its MIDI and audio settings, routings and more). Those parts stay in the project, and Export puts them back exactly as they were.

### Files

- **Export as a zip for the S-4…** downloads a zipped `NAME.s4project` folder. Unzip it into the S-4's PROJECTS folder.
- **Back up for s4tools…** downloads the project with its samples, for **Import a project zip…** here or on another computer.

---

## 9. Settings

The sliders button at the top right.

| | |
|---|---|
| **Theme** | The colours: Paper (light), Night (dark), Mono and Chalk (shades of grey), Slate and Meadow. System picks Paper or Night to match your computer. |
| **S-4 output / S-4 input** | The MIDI ports. Left alone, s4tools finds the S-4 by name ("MIDI function" on Windows). |
| **Controllers** | The inputs Learn and your control maps listen to. |
| **Scene channel** | The channel for program changes (16 unless you changed it on the S-4). |
| **Start / stop** | Note C0 on channel 16 (the default), or MIDI start / stop. |
| **Follow the project** | Picking a scene in Live shows its values from the Build project. |
| **Resend** | Sends every value in Live to the S-4. |
| **Guide** | This page. |
| **MIDI monitor** | What went out and came in, newest first. |

**Keys:** **Space** starts and stops the S-4 in Live and the preview in Build. In Live, **L** toggles Learn and **1–4** pick a track. **Esc** ends Learn and closes menus and windows.

---

## 10. When things go wrong

**Not connected.** The S-4 isn't plugged in, or another program holds its MIDI port. Close your DAW and other MIDI software, check the cable, and if needed choose the port under **Settings › S-4 output**.

**No MIDI.** The browser blocked MIDI. Allow it in the site settings (the icon left of the address), then press **Try again** in Settings. Firefox and Safari have no Web MIDI.

**No reply.** The S-4 didn't answer a start or stop. This happens after it has dropped off USB: the browser can hold on to a dead connection that still looks alive. s4tools reopens MIDI by itself, so try once more; if it still fails, reload the page. Otherwise make sure the S-4 isn't in USB storage mode, plug it in again, or restart the browser.

**Knobs do nothing.** Switch on CC CONTROL on the S-4, and check that the inspector names the device the S-4 really has.

**Scenes don't change.** Switch on PROGRAM CHANGE on the S-4, and check the scene channel in Settings.

**No tempo in the header.** Switch on SYNC OUT on the S-4. The tempo shows while it plays.

**The meter stays flat.** Allow the microphone for the page, and check the input (the arrow by the meter). A track that only listens to its input needs its monitor on to reach the main out.

**No click in the pre-click.** The default output may be the S-4 itself. Choose your speakers or headphones in the pre-click menu, or the click on the S-4.

**Play on S-4 is silent.** The tracks' MATERIAL must be in BYPASS and the output must be the S-4. Use the beeps to check each track.

**A sample says Missing.** This browser no longer has the file, because the site data was cleared or the project came from somewhere else. Drop the file on its lane again.

**Export can't find the S-4.** Put it in USB storage mode, then use **Project › Choose the S-4 folder…** and pick PROJECTS again.

---

## 11. What it can't do

- **Read the S-4's knobs.** MIDI only goes one way for knobs, so Live shows what was sent, or the Build project's values with Follow the project on.
- **Follow MAIN.** An S-4 project doesn't store it, so it stays where Live last set it.
- **Change devices, modulator types or routings over MIDI**, or truly bypass a device. Build writes all of these into the project file instead.
- **Record a single track.** Chrome passes on only the main pair of the S-4's USB channels.
- **Catch the very start on the S-4.** A take on the S-4 started by sound begins about 45 ms late; record to the PC to keep everything.
- **Sound exactly like the S-4 in the browser.** The preview leaves out the effects, sends and modulators. Play on S-4 adds the effects (sent over MIDI); sends and modulators need the export.
- **Keep your work outside this browser** unless you back it up.

---

s4tools is free and open source under the MIT license.
