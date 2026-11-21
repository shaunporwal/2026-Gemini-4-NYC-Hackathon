------------------------------ MODULE AppFlow ------------------------------
(* The screens a person can be on, and every tap that moves between them. Used to prove
   there is NO DEAD END: from every state a person can reach, every screen and every main
   result can still be reached (see no_dead_ends.py, which checks the full state graph).

   Phone:   "pick" (floor plan + room list) -> "camera" (live camera, one photo) <-> "twin"
   Twin:    the simulation, on the phone copy or the presenter's laptop: 3 views, start a fire,
            the run ends, reset, replay, find a fix, apply it.

   Fixed = FALSE: as first built. The camera page had no way to the twin, and the twin had
                  no way to the camera.
   Fixed = TRUE : with the Camera / Twin switch, and the phone remembers the chosen room. *)
EXTENDS Naturals

CONSTANT Fixed

VARIABLES page,    \* "pick", "camera", "twin"
          sel,     \* a room is highlighted on the picker
          room,    \* a room was chosen (the phone remembers it)
          cam,     \* "off", "asking" (permission prompt), "live", "blocked"
          view,    \* twin view: "2d", "3d", "live"
          sim,     \* "idle", "running", "done"
          fix      \* a fix was found and can be applied

vars == <<page, sel, room, cam, view, sim, fix>>

Init == /\ page \in {"pick", "twin"}          \* the 2 links people get: /camera and /app/
        /\ sel = FALSE /\ room = FALSE /\ cam = "off"
        /\ view = "2d" /\ sim = "idle" /\ fix = FALSE

Twin0 == view' = "2d" /\ sim' = "idle" /\ fix' = FALSE   \* a page load starts a fresh twin

\* ---- Picker
Select == page = "pick" /\ sel' = TRUE /\ UNCHANGED <<page, room, cam, view, sim, fix>>
Use    == page = "pick" /\ sel /\ page' = "camera" /\ room' = TRUE /\ cam' = "asking"
          /\ UNCHANGED <<sel, view, sim, fix>>

\* ---- Camera
Allow  == cam = "asking" /\ cam' = "live" /\ UNCHANGED <<page, sel, room, view, sim, fix>>
Deny   == cam = "asking" /\ cam' = "blocked" /\ UNCHANGED <<page, sel, room, view, sim, fix>>
Start  == page = "camera" /\ cam \in {"off", "blocked"} /\ cam' = "asking"
          /\ UNCHANGED <<page, sel, room, view, sim, fix>>
Stop   == page = "camera" /\ cam = "live" /\ cam' = "off" /\ UNCHANGED <<page, sel, room, view, sim, fix>>
ChangeRoom == page = "camera" /\ page' = "pick" /\ cam' = "off" /\ room' = FALSE /\ sel' = FALSE
              /\ UNCHANGED <<view, sim, fix>>

\* ---- Page switch (new). Leaving a page stops its camera.
ToTwin   == Fixed /\ page \in {"pick", "camera"} /\ page' = "twin" /\ cam' = "off" /\ Twin0
            /\ UNCHANGED <<sel, room>>
ToCamera == Fixed /\ page = "twin" /\ page' = (IF room THEN "camera" ELSE "pick") /\ cam' = "off"
            /\ UNCHANGED <<sel, room, view, sim, fix>>

\* ---- Twin
SetView(v) == page = "twin" /\ view' = v /\ UNCHANGED <<page, sel, room, cam, sim, fix>>
StartFire  == page = "twin" /\ sim = "idle" /\ view \in {"2d", "3d"} /\ sim' = "running"
              /\ UNCHANGED <<page, sel, room, cam, view, fix>>
FireEnds   == page = "twin" /\ sim = "running" /\ sim' = "done" /\ UNCHANGED <<page, sel, room, cam, view, fix>>
Reset      == page = "twin" /\ sim' = "idle" /\ UNCHANGED <<page, sel, room, cam, view, fix>>
Replay     == page = "twin" /\ sim # "idle" /\ sim' = "running" /\ UNCHANGED <<page, sel, room, cam, view, fix>>
FindFix    == page = "twin" /\ sim # "idle" /\ fix' \in BOOLEAN /\ UNCHANGED <<page, sel, room, cam, view, sim>>
ApplyFix   == page = "twin" /\ fix /\ sim' = "running" /\ UNCHANGED <<page, sel, room, cam, view, fix>>

Next == \/ Select \/ Use \/ Allow \/ Deny \/ Start \/ Stop \/ ChangeRoom
        \/ ToTwin \/ ToCamera
        \/ \E v \in {"2d", "3d", "live"} : SetView(v)
        \/ StartFire \/ FireEnds \/ Reset \/ Replay \/ FindFix \/ ApplyFix

Spec == Init /\ [][Next]_vars

\* The camera is never left on behind another page.
CameraOnlyOnItsPage == cam # "off" => page = "camera"
=============================================================================
