# specs/

State-machine models, checked with the TLA+ model checker (TLC). A model checker tries every order of
events, so it finds faults that need unlucky timing: a tap during a permission prompt, a stop during an upload.

| Spec | Models | Result |
|---|---|---|
| `PhoneCamera.tla` | The phone page `server/camera.html`: pick room, start camera, send frames, stop, change room | As first written (`Fixed = FALSE`): 3 faults. With the session number (`Fixed = TRUE`): no fault in 36,560 states |
| `CaptureToTwin.tla` | The whole chain, linked: phone capture -> feed server -> simulation app, with a presenter who can change the layout and viewers who open copies of the page | As first wired (`Fixed = FALSE`): 2 faults. Now (`Fixed = TRUE`), with the Freeze button: no fault in 375,368 states |
| `AppFlow.tla` + `no_dead_ends.py` | Every screen and every tap on the phone and the twin. The script reads TLC's full state graph and checks that every goal (11: each page, each view, camera live, fire running, run complete, fix ready, fresh sim) can be reached from EVERY reachable state | As first built: dead ends for all 11 goals (the camera page could not reach the twin; the twin could not reach the camera). Now: no dead end in 162 states |

## Faults found in the first version (2026-11-21)

| Invariant broken | Shortest way to do it | Effect |
|---|---|---|
| `NoFrameWithoutRoom` | Tap Start, tap the room name (change room) before the permission prompt is answered, then allow the camera | Frames go to the server with no room (`/frame/null`): a ghost camera, and paid Gemini calls |
| `OneSender` | Tap Start 2 times before the permission prompt is answered, then allow | 2 frame loops: double the frames and double the API cost |
| `PickerIsQuiet` | Same start as fault 1 | The camera runs while the room picker is on screen |

Fix: a session number in `camera.html`. Each start and each stop makes a new session. A permission answer,

## Faults found in the linked chain (2026-11-21)

| Invariant broken | Shortest way to do it | Effect | Fix |
|---|---|---|---|
| `PlanIsThePresenters` | The presenter loads a layout; then anyone opens a second copy of the twin page | The copy sends its own default layout to the server: phones now pick from the wrong rooms | Only the presenter's page configures the server (`feed.js`) |
| `PhoneToldTheTruth` | A phone picks a room; the presenter loads another layout; the phone sends a frame | The phone says the frame was sent, and the twin throws it away | The server's answer says if the room is on the plan; the phone says "pick again" (`app.py`, `camera.html`) |

Added with the Freeze button: `FrozenTwinIsStill`. While the twin is frozen, no phone frame changes it, frames already on the way included.

Also checked, and true in both versions: a camera can only start a fire in a room on screen; head counts do not change after the fire starts; a camera count only goes to a room on screen.

The first fault was seen by hand first (a viewer copy cleared the server's key and plan); the model confirms the fix closes it.
a frame or a sound clip from an old session is dropped.

## Dead ends found (2026-11-21)

`AppFlow` with `Fixed = FALSE`: a person who opened the camera link could never reach the twin (18 of 24 states), and a person who opened the twin could never reach the camera (6 of 24). Shaun found this by hand on his phone; the check now fails if it comes back.

Fix: a Camera / Twin switch on both pages. The phone remembers the chosen room, so Twin -> Camera returns to that room's camera, not to the picker.

A dead end here means "no sequence of taps gets there". It does not measure how easy the path is to find.

That gap showed at once: after Stop, the camera page was a black box with a lone button. A path existed, and the person was lost. So `AppFlow` now also states what each screen tells the person to do next (`Hint`) and checks `EveryScreenSaysWhatNext`. As first built it fails after pick room -> Use -> allow -> Stop (the exact taps Shaun made). Now: after a recording the page keeps the last frame, says what was sent and what Gemini counted, and offers "See it on the Twin" and "Record again".

`Hint` is a claim about the page written by hand: the model checks that no state is left without one, not that the words are good.

## Not modelled

Gemini's answers (the model lets it say anything), the network's timing beyond "late", and the simulator's physics. The model is the page's control flow, not its code:
a change to `camera.html` needs the same change in the spec.

## Run

```bash
java -cp tla2tools.jar tlc2.TLC -config PhoneCamera_fixed.cfg PhoneCamera.tla   # expect: no error
java -cp tla2tools.jar tlc2.TLC -config PhoneCamera_asis.cfg  PhoneCamera.tla   # expect: invariant violated
java -cp tla2tools.jar tlc2.TLC -config CaptureToTwin_fixed.cfg CaptureToTwin.tla   # expect: no error
java -cp tla2tools.jar tlc2.TLC -config AppFlow_fixed.cfg -dump dot,actionlabels flow.dot AppFlow.tla
python3 no_dead_ends.py flow.dot                                                   # expect: ok on every line, exit 0
```
`tla2tools.jar`: https://github.com/tlaplus/tlaplus/releases . It needs Java.
