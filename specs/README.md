# specs/

State-machine models, checked with the TLA+ model checker (TLC). A model checker tries every order of
events, so it finds faults that need unlucky timing: a tap during a permission prompt, a stop during an upload.

| Spec | Models | Result |
|---|---|---|
| `PhoneCamera.tla` | The phone page `server/camera.html`: pick room, start camera, send frames, stop, change room | As first written (`Fixed = FALSE`): 3 faults. With the session number (`Fixed = TRUE`): no fault in 36,560 states |
| `CaptureToTwin.tla` | The whole chain, linked: phone capture -> feed server -> simulation app, with a presenter who can change the layout and viewers who open copies of the page | As first wired (`Fixed = FALSE`): 2 faults. Now (`Fixed = TRUE`): no fault in 111,812 states |

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

Also checked, and true in both versions: a camera can only start a fire in a room on screen; head counts do not change after the fire starts; a camera count only goes to a room on screen.

The first fault was seen by hand first (a viewer copy cleared the server's key and plan); the model confirms the fix closes it.
a frame or a sound clip from an old session is dropped.

## Not modelled

Gemini's answers (the model lets it say anything), the network's timing beyond "late", and the simulator's physics. The model is the page's control flow, not its code:
a change to `camera.html` needs the same change in the spec.

## Run

```bash
java -cp tla2tools.jar tlc2.TLC -config PhoneCamera_fixed.cfg PhoneCamera.tla   # expect: no error
java -cp tla2tools.jar tlc2.TLC -config PhoneCamera_asis.cfg  PhoneCamera.tla   # expect: invariant violated
java -cp tla2tools.jar tlc2.TLC -config CaptureToTwin_fixed.cfg CaptureToTwin.tla   # expect: no error
```
`tla2tools.jar`: https://github.com/tlaplus/tlaplus/releases . It needs Java.
