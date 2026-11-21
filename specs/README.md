# specs/

State-machine models, checked with the TLA+ model checker (TLC). A model checker tries every order of
events, so it finds faults that need unlucky timing: a tap during a permission prompt, a stop during an upload.

| Spec | Models | Result |
|---|---|---|
| `PhoneCamera.tla` | The phone page `server/camera.html`: pick room, start camera, send frames, stop, change room | As first written (`Fixed = FALSE`): 3 faults. With the session number (`Fixed = TRUE`): no fault in 36,560 states |

## Faults found in the first version (2026-11-21)

| Invariant broken | Shortest way to do it | Effect |
|---|---|---|
| `NoFrameWithoutRoom` | Tap Start, tap the room name (change room) before the permission prompt is answered, then allow the camera | Frames go to the server with no room (`/frame/null`): a ghost camera, and paid Gemini calls |
| `OneSender` | Tap Start 2 times before the permission prompt is answered, then allow | 2 frame loops: double the frames and double the API cost |
| `PickerIsQuiet` | Same start as fault 1 | The camera runs while the room picker is on screen |

Fix: a session number in `camera.html`. Each start and each stop makes a new session. A permission answer,
a frame or a sound clip from an old session is dropped.

## Not modelled

The server workers, the WebSocket, the twin page, and the simulator. The model is the page's control flow, not its code:
a change to `camera.html` needs the same change in the spec.

## Run

```bash
java -cp tla2tools.jar tlc2.TLC -config PhoneCamera_fixed.cfg PhoneCamera.tla   # expect: no error
java -cp tla2tools.jar tlc2.TLC -config PhoneCamera_asis.cfg  PhoneCamera.tla   # expect: invariant violated
```
`tla2tools.jar`: https://github.com/tlaplus/tlaplus/releases . It needs Java.
