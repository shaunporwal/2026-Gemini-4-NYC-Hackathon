---------------------------- MODULE PhoneCamera ----------------------------
(* State machine of the phone page (server/camera.html): pick a room, start the camera,
   send frames, stop, change room. It models the asynchronous parts that a test by hand
   can miss: the permission prompt (the user can tap again before it answers) and the frame
   loop (it is in the middle of an upload when the user stops or changes room).

   Fixed = FALSE: the page as it was first written.  TLC finds 3 faults.
   Fixed = TRUE : the page with a session number.  Each start and each stop makes a new
                  session; a permission answer or a frame from an old session is dropped. *)
EXTENDS Naturals, FiniteSets

CONSTANTS Rooms,      \* room names of the twin
          None,       \* "no room"
          Fixed,      \* which version of the page to check
          MaxStarts   \* bound on camera starts, to keep the model finite

VARIABLES screen,     \* "pick" (map + list) or "cam" (camera view)
          selected,   \* room highlighted on the picker, or None
          cam,        \* room that frames are tagged with, or None
          running,    \* the page's `running` flag: the Start/Stop button shows Stop
          session,    \* session number (used only when Fixed)
          asking,     \* permission prompts not answered yet: [id, session]
          loops,      \* frame loops that exist: [id, session, room, pc]
          posted,     \* room tags of all frames sent to the server
          starts      \* count of camera starts

vars == <<screen, selected, cam, running, session, asking, loops, posted, starts>>

Init == /\ selected = None /\ running = FALSE /\ session = 0
        /\ asking = {} /\ loops = {} /\ posted = {} /\ starts = 0
        /\ \/ screen = "pick" /\ cam = None                 \* opened /camera
           \/ screen = "cam" /\ cam \in Rooms               \* opened /camera?id=<room>

(* start(): ask for the camera. The answer comes later (Grant or Deny). *)
StartCamera ==
    /\ starts < MaxStarts
    /\ starts' = starts + 1
    /\ session' = IF Fixed THEN session + 1 ELSE session
    /\ asking' = asking \cup {[id |-> starts + 1, session |-> session']}

(* stop(): the flag goes down. A loop sees that only at its next turn. *)
StopCamera == /\ running' = FALSE
              /\ session' = IF Fixed THEN session + 1 ELSE session

Select(r) == /\ screen = "pick" /\ selected' = r
             /\ UNCHANGED <<screen, cam, running, session, asking, loops, posted, starts>>

Use == /\ screen = "pick" /\ selected # None
       /\ cam' = selected /\ screen' = "cam"
       /\ StartCamera
       /\ UNCHANGED <<selected, running, loops, posted>>

TapStart == /\ screen = "cam" /\ ~running
            /\ StartCamera
            /\ UNCHANGED <<screen, selected, cam, running, loops, posted>>

TapStop == /\ screen = "cam" /\ running
           /\ StopCamera
           /\ UNCHANGED <<screen, selected, cam, asking, loops, posted, starts>>

ChangeRoom == /\ screen = "cam"
              /\ StopCamera
              /\ cam' = None /\ screen' = "pick"
              /\ UNCHANGED <<selected, asking, loops, posted, starts>>

(* The user allows the camera. The old page always starts a loop here. *)
Grant(a) ==
    /\ a \in asking
    /\ asking' = asking \ {a}
    /\ IF Fixed /\ (a.session # session \/ cam = None)
       THEN UNCHANGED <<running, loops>>                    \* old session: release the camera
       ELSE /\ running' = TRUE
            /\ loops' = loops \cup {[id |-> a.id, session |-> a.session, room |-> cam, pc |-> "top"]}
    /\ UNCHANGED <<screen, selected, cam, session, posted, starts>>

Deny(a) == /\ a \in asking /\ asking' = asking \ {a}
           /\ UNCHANGED <<screen, selected, cam, running, session, loops, posted, starts>>

Current(l) == Fixed => l.session = session

(* Top of the loop: `while (running)`. Take a frame, or end. *)
LoopTop(l) ==
    /\ l \in loops /\ l.pc = "top"
    /\ loops' = IF running /\ Current(l) THEN (loops \ {l}) \cup {[l EXCEPT !.pc = "post"]}
                ELSE loops \ {l}
    /\ UNCHANGED <<screen, selected, cam, running, session, asking, posted, starts>>

(* The upload. The old page reads the global room here; the fixed page uses the room of
   its session and sends nothing if the session is over. *)
LoopPost(l) ==
    /\ l \in loops /\ l.pc = "post"
    /\ posted' = IF Fixed THEN (IF l.session = session THEN posted \cup {l.room} ELSE posted)
                 ELSE posted \cup {cam}
    /\ loops' = (loops \ {l}) \cup {[l EXCEPT !.pc = "top"]}
    /\ UNCHANGED <<screen, selected, cam, running, session, asking, starts>>

Next == \/ \E r \in Rooms : Select(r)
        \/ Use \/ TapStart \/ TapStop \/ ChangeRoom
        \/ \E a \in asking : Grant(a) \/ Deny(a)
        \/ \E l \in loops : LoopTop(l) \/ LoopPost(l)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* What must always be true. *)

\* 1. No frame goes to the server without a room.
NoFrameWithoutRoom == None \notin posted

\* 2. At most 1 loop can send frames (2 loops = double the frames and the API cost).
OneSender == Cardinality({l \in loops : Current(l)}) <= 1

\* 3. The picker is quiet: with the map on screen, the camera flag is down.
PickerIsQuiet == screen = "pick" => ~running

\* 4. A running camera always has a room.
RunningHasRoom == running => cam # None

\* 5. The camera screen always has a room (its title and the "change room" button name it).
CameraScreenHasRoom == screen = "cam" => cam # None
=============================================================================
