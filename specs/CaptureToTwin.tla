--------------------------- MODULE CaptureToTwin ---------------------------
(* The whole chain, linked: phone capture -> feed server -> simulation app (the twin).

     phone:  pick a room of the plan, send frames tagged with that room
     server: holds the plan (room list) and the newest frame for each room; Gemini reads a frame
             and the server publishes an Observation (head count, maybe "fire")
     twin:   the presenter's page. It owns the layout. An Observation for one of its rooms sets
             that room's head count before the fire; an Observation with "fire" starts the fire.
     viewer: a second copy of the twin page that someone else opens to watch.

   Everything is asynchronous: the presenter can load another layout while frames are on the
   way, a viewer can open at any time, and Observations arrive late.

   Fixed = FALSE: the system as first wired.  TLC finds 2 faults.
   Fixed = TRUE : the system now. *)
EXTENDS Naturals, FiniteSets

CONSTANTS Rooms,     \* all room names that exist in any layout
          Layouts,   \* the layouts the presenter can load: a set of sets of rooms
          Default,   \* the layout a freshly opened twin page starts with
          None, Fixed

VARIABLES twinRooms,   \* rooms of the presenter's layout
          plan,        \* rooms the server offers to phones
          phoneRoom,   \* room the phone tags its frames with, or None
          phoneSays,   \* what the phone tells its user after a send: "none", "ok", "pickAgain"
          sendWasGood, \* history: at the last send, was the phone's room on the presenter's layout?
          inbox,       \* rooms with a frame the server has not read yet (newest frame wins)
          wire,        \* Observations published and not yet handled by the twin: [room, fire]
          fire,        \* the twin's fire has started
          fireRoom,    \* room where a camera started the fire, or None
          counted,     \* rooms whose head count came from a camera
          frozen       \* history: `counted` at the moment the fire started

vars == <<twinRooms, plan, phoneRoom, phoneSays, sendWasGood, inbox, wire, fire, fireRoom, counted, frozen>>

Init == /\ twinRooms = Default /\ plan = Default
        /\ phoneRoom = None /\ phoneSays = "none" /\ sendWasGood = TRUE
        /\ inbox = {} /\ wire = {} /\ fire = FALSE /\ fireRoom = None /\ counted = {} /\ frozen = {}

(* Presenter loads a layout: a new sim, and the page sends the new plan to the server. *)
LoadLayout(S) ==
    /\ S \in Layouts
    /\ twinRooms' = S /\ plan' = S
    /\ fire' = FALSE /\ fireRoom' = None /\ counted' = {} /\ frozen' = {}
    /\ UNCHANGED <<phoneRoom, phoneSays, sendWasGood, inbox, wire>>

(* Someone opens a second copy of the twin page. As first wired, every copy sent its own
   default layout to the server. Now only the presenter's page does. *)
ViewerOpens ==
    /\ plan' = IF Fixed THEN plan ELSE Default
    /\ UNCHANGED <<twinRooms, phoneRoom, phoneSays, sendWasGood, inbox, wire, fire, fireRoom, counted, frozen>>

PhonePick(r) ==
    /\ r \in plan
    /\ phoneRoom' = r /\ phoneSays' = "none"
    /\ UNCHANGED <<twinRooms, plan, sendWasGood, inbox, wire, fire, fireRoom, counted, frozen>>

(* The phone sends a frame. The server's answer says if the room is still on the plan.
   As first wired, the phone always said "ok". *)
PhoneSend ==
    /\ phoneRoom # None
    /\ inbox' = inbox \cup {phoneRoom}
    /\ sendWasGood' = (phoneRoom \in twinRooms)
    /\ phoneSays' = IF Fixed /\ phoneRoom \notin plan THEN "pickAgain" ELSE "ok"
    /\ UNCHANGED <<twinRooms, plan, phoneRoom, wire, fire, fireRoom, counted, frozen>>

(* Gemini reads the newest frame of a room. It may or may not see fire. *)
ServerReads(r, sawFire) ==
    /\ r \in inbox
    /\ inbox' = inbox \ {r}
    /\ wire' = wire \cup {[room |-> r, fire |-> sawFire]}
    /\ UNCHANGED <<twinRooms, plan, phoneRoom, phoneSays, sendWasGood, fire, fireRoom, counted, frozen>>

(* The twin handles an Observation. Not one of its rooms: ignore. Before the fire: take the head
   count. Sees fire and no fire yet: start the fire in that room. *)
TwinHandles(o) ==
    /\ o \in wire
    /\ wire' = wire \ {o}
    /\ IF o.room \notin twinRooms \/ fire
       THEN UNCHANGED <<fire, fireRoom, counted, frozen>>
       ELSE /\ counted' = counted \cup {o.room}
            /\ fire' = o.fire
            /\ fireRoom' = IF o.fire THEN o.room ELSE None
            /\ frozen' = IF o.fire THEN counted' ELSE frozen
    /\ UNCHANGED <<twinRooms, plan, phoneRoom, phoneSays, sendWasGood, inbox>>

(* A person clicks the map to start the fire. *)
ClickFire ==
    /\ ~fire
    /\ fire' = TRUE /\ frozen' = counted
    /\ UNCHANGED <<twinRooms, plan, phoneRoom, phoneSays, sendWasGood, inbox, wire, fireRoom, counted>>

Next == \/ \E S \in Layouts : LoadLayout(S)
        \/ ViewerOpens
        \/ \E r \in Rooms : PhonePick(r)
        \/ PhoneSend
        \/ \E r \in Rooms, f \in BOOLEAN : ServerReads(r, f)
        \/ \E o \in wire : TwinHandles(o)
        \/ ClickFire

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* What must always be true. *)

\* 1. Phones choose from the presenter's rooms: the server's plan is the presenter's layout.
PlanIsThePresenters == plan = twinRooms

\* 2. The phone never says "ok" for a frame the twin will throw away.
PhoneToldTheTruth == phoneSays = "ok" => sendWasGood

\* 3. A camera can only start a fire in a room of the layout on screen.
FireRoomIsOnScreen == fireRoom # None => fireRoom \in twinRooms

\* 4. Head counts do not change after the fire starts (the same fire must replay the same way).
CountsFrozenInFire == fire => counted = frozen

\* 5. A camera count only goes to a room of the layout on screen.
CountsAreOnScreen == counted \subseteq twinRooms
=============================================================================
