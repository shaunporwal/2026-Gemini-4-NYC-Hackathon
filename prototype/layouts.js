/* Preset layouts. Data only. Schema: see sim.js. The first preset loads at start. */
(function (root) {
  'use strict';

  /* The Malin Chelsea, 270 7th Ave (the hackathon venue). Rectangles traced by hand from the
   * public floor plan; 1 cell = about 1 m (not surveyed). Exit positions follow the street doors on
   * the plan. LOCKED exits and all head counts are ASSUMPTIONS for the demo, not facts about the venue. */
  const malin = {
    name: 'The Malin Chelsea (approx.)',
    width: 81, height: 46,
    rooms: [
      { name: 'Entry',            x: 0,  y: 5,  w: 6,  h: 16, people: 2 },
      { name: 'Reception',        x: 5,  y: 5,  w: 8,  h: 17, people: 14 },
      { name: 'Offices 8–10',     x: 12, y: 5,  w: 7,  h: 13, people: 10 },
      { name: 'Desks',            x: 18, y: 5,  w: 7,  h: 13, people: 12 },
      { name: 'Offices 11–15',    x: 24, y: 0,  w: 7,  h: 18, people: 14 },
      { name: 'Corridor',         x: 12, y: 17, w: 40, h: 5,  people: 8 },
      { name: 'Knickerbocker',    x: 13, y: 21, w: 8,  h: 5,  people: 10 },
      { name: 'Bathrooms',        x: 20, y: 21, w: 10, h: 5,  people: 4 },
      { name: 'Commons',          x: 29, y: 21, w: 23, h: 7,  people: 30 },
      { name: 'Meeting 3–5',      x: 36, y: 27, w: 13, h: 5,  people: 14 },
      { name: 'Passage',          x: 48, y: 27, w: 4,  h: 5,  people: 0 },
      { name: 'Phonebooths',      x: 36, y: 31, w: 16, h: 4,  people: 5 },
      { name: 'Event Lobby',      x: 51, y: 17, w: 11, h: 10, people: 15 },
      { name: 'Event Bar',        x: 61, y: 17, w: 16, h: 9,  people: 30 },
      { name: 'Event Hall',       x: 61, y: 25, w: 20, h: 14, people: 150 },
      { name: '26th St Foyer',    x: 58, y: 38, w: 23, h: 8,  people: 15 }
    ],
    doors: [
      { id: 'D1',  x: 5,  y: 9,  w: 1, h: 2 },
      { id: 'D2',  x: 12, y: 18, w: 1, h: 2 },
      { id: 'D3',  x: 15, y: 17, w: 1, h: 1 },
      { id: 'D4',  x: 21, y: 17, w: 2, h: 1 },
      { id: 'D5',  x: 27, y: 17, w: 1, h: 1 },
      { id: 'D6',  x: 24, y: 10, w: 1, h: 2 },
      { id: 'D7',  x: 16, y: 21, w: 2, h: 1 },
      { id: 'D8',  x: 24, y: 21, w: 1, h: 1 },
      { id: 'D9',  x: 33, y: 21, w: 3, h: 1 },
      { id: 'D10', x: 45, y: 21, w: 3, h: 1 },
      { id: 'D11', x: 41, y: 27, w: 2, h: 1 },
      { id: 'D12', x: 49, y: 27, w: 2, h: 1 },
      { id: 'D13', x: 49, y: 31, w: 2, h: 1 },
      { id: 'D14', x: 51, y: 18, w: 1, h: 2 },
      { id: 'D15', x: 51, y: 23, w: 1, h: 2 },
      { id: 'D16', x: 61, y: 20, w: 1, h: 2 },
      { id: 'D17', x: 66, y: 25, w: 4, h: 1 },
      { id: 'D18', x: 64, y: 38, w: 2, h: 1 },
      { id: 'D19', x: 76, y: 38, w: 2, h: 1 },
      { id: 'D20', x: 18, y: 10, w: 1, h: 2 }
    ],
    exits: [
      { id: 'W1', name: '7th Ave entrance',          x: 0,  y: 8,  w: 1, h: 2 },
      { id: 'S1', name: '26th St west door',         x: 61, y: 45, w: 2, h: 1 },
      { id: 'S2', name: '26th St east door',         x: 73, y: 45, w: 2, h: 1 },
      { id: 'X1', name: 'Event Bar service door (assumed)', x: 70, y: 17, w: 2, h: 1, locked: true },
      { id: 'X2', name: 'Office wing stair (assumed)',    x: 27, y: 0,  w: 1, h: 1, locked: true }
    ]
  };

  /* Simple generic venue. Also the format example in the Gemini prompt. */
  const demo = {
    name: 'Generic venue (demo)',
    width: 64, height: 40,
    rooms: [
      { name: 'Main Hall',  x: 0,  y: 0,  w: 40, h: 26, people: 160 },
      { name: 'Breakout A', x: 39, y: 0,  w: 25, h: 13, people: 30 },
      { name: 'Breakout B', x: 39, y: 12, w: 25, h: 14, people: 30 },
      { name: 'Corridor',   x: 0,  y: 25, w: 64, h: 7,  people: 6 },
      { name: 'Kitchen',    x: 0,  y: 31, w: 22, h: 9,  people: 6 },
      { name: 'Storage',    x: 21, y: 31, w: 20, h: 9,  people: 2 },
      { name: 'Restrooms',  x: 40, y: 31, w: 24, h: 9,  people: 6 }
    ],
    doors: [
      { id: 'H1', x: 10, y: 25, w: 2, h: 1 },
      { id: 'H2', x: 28, y: 25, w: 2, h: 1 },
      { id: 'A1', x: 39, y: 6,  w: 1, h: 2 },
      { id: 'B1', x: 39, y: 18, w: 1, h: 2 },
      { id: 'B2', x: 52, y: 25, w: 2, h: 1 },
      { id: 'K1', x: 10, y: 31, w: 2, h: 1 },
      { id: 'S1', x: 30, y: 31, w: 1, h: 1 },
      { id: 'R1', x: 50, y: 31, w: 2, h: 1 }
    ],
    exits: [
      { id: 'E1', name: 'Main entrance',     x: 0,  y: 27, w: 1, h: 3 },
      { id: 'E2', name: 'East exit',         x: 63, y: 27, w: 1, h: 3 },
      { id: 'E3', name: 'North fire exit',   x: 19, y: 0,  w: 2, h: 1, locked: true },
      { id: 'E4', name: 'Kitchen back door', x: 0,  y: 35, w: 1, h: 2, locked: true }
    ]
  };

  /* The Malin Chelsea as Gemini read it from docs/The_Malin_Chelsea_Floor_Plan.pdf (gemini-4-hydrogen,
   * 2026-11-21, about 105 s). Not edited. Stage fallback for the live floor plan step. Exits E3, E4 and
   * all head counts are Gemini's reading: NOT checked against the building. */
  const malinGemini = {
    name: "The Malin Chelsea (Gemini, from the floor plan PDF)",
    width: 80, height: 46,
    rooms: [
      {"name": "Reception & West Lounge", "x": 0, "y": 4, "w": 12, "h": 17, "people": 18},
      {"name": "Bricken Office (10)", "x": 11, "y": 4, "w": 7, "h": 5, "people": 4},
      {"name": "Abbott Office (9)", "x": 11, "y": 8, "w": 7, "h": 5, "people": 4},
      {"name": "Blum Office (8)", "x": 11, "y": 12, "w": 7, "h": 6, "people": 5},
      {"name": "West Booth Lounge", "x": 17, "y": 4, "w": 7, "h": 14, "people": 16},
      {"name": "Arsenal Office (11)", "x": 23, "y": 0, "w": 7, "h": 4, "people": 3},
      {"name": "Lurye Office (12)", "x": 23, "y": 3, "w": 7, "h": 5, "people": 3},
      {"name": "Weller Office (13)", "x": 23, "y": 7, "w": 7, "h": 4, "people": 3},
      {"name": "Bradley Office (14)", "x": 23, "y": 10, "w": 7, "h": 4, "people": 3},
      {"name": "Wurts Office (15)", "x": 23, "y": 13, "w": 7, "h": 5, "people": 3},
      {"name": "West-Central Corridor", "x": 11, "y": 17, "w": 24, "h": 5, "people": 4},
      {"name": "Knickerbocker Room (2)", "x": 11, "y": 21, "w": 8, "h": 5, "people": 10},
      {"name": "Upper Bathrooms (17)", "x": 18, "y": 21, "w": 9, "h": 5, "people": 4},
      {"name": "South Bathroom & Core (17)", "x": 26, "y": 21, "w": 5, "h": 10, "people": 2},
      {"name": "Central Lounge & Dedicated Desks", "x": 34, "y": 17, "w": 14, "h": 12, "people": 24},
      {"name": "Lefcourt Room (3)", "x": 35, "y": 28, "w": 4, "h": 5, "people": 6},
      {"name": "Adler Room (4)", "x": 38, "y": 28, "w": 5, "h": 5, "people": 6},
      {"name": "Kahn Room (5)", "x": 42, "y": 28, "w": 6, "h": 5, "people": 8},
      {"name": "Kitchen & Bistro Lounge (16)", "x": 47, "y": 17, "w": 5, "h": 16, "people": 12},
      {"name": "Phonebooths & South Lounge (19)", "x": 35, "y": 32, "w": 17, "h": 5, "people": 10},
      {"name": "East Offices West", "x": 51, "y": 17, "w": 6, "h": 7, "people": 6},
      {"name": "East Offices East", "x": 56, "y": 17, "w": 7, "h": 7, "people": 6},
      {"name": "East Corridor", "x": 51, "y": 23, "w": 12, "h": 5, "people": 2},
      {"name": "Wellness Room (18)", "x": 51, "y": 27, "w": 6, "h": 4, "people": 1},
      {"name": "Event Bar & Pre-Function", "x": 62, "y": 17, "w": 18, "h": 11, "people": 20},
      {"name": "Event Auditorium", "x": 60, "y": 27, "w": 20, "h": 12, "people": 80},
      {"name": "Carnegie Room (6)", "x": 59, "y": 38, "w": 8, "h": 8, "people": 10},
      {"name": "South Event Foyer", "x": 66, "y": 38, "w": 7, "h": 6, "people": 8},
      {"name": "Penn Room (7)", "x": 72, "y": 38, "w": 8, "h": 8, "people": 12}
    ],
    doors: [
      {"id": "D1", "x": 17, "y": 6, "w": 1, "h": 1, "locked": false},
      {"id": "D2", "x": 17, "y": 10, "w": 1, "h": 1, "locked": false},
      {"id": "D3", "x": 17, "y": 14, "w": 1, "h": 1, "locked": false},
      {"id": "D4", "x": 26, "y": 3, "w": 1, "h": 1, "locked": false},
      {"id": "D5", "x": 23, "y": 5, "w": 1, "h": 1, "locked": false},
      {"id": "D6", "x": 23, "y": 8, "w": 1, "h": 1, "locked": false},
      {"id": "D7", "x": 23, "y": 11, "w": 1, "h": 1, "locked": false},
      {"id": "D8", "x": 23, "y": 15, "w": 1, "h": 1, "locked": false},
      {"id": "D9", "x": 11, "y": 18, "w": 1, "h": 2, "locked": false},
      {"id": "D10", "x": 19, "y": 17, "w": 2, "h": 1, "locked": false},
      {"id": "D11", "x": 14, "y": 21, "w": 2, "h": 1, "locked": false},
      {"id": "D12", "x": 21, "y": 21, "w": 2, "h": 1, "locked": false},
      {"id": "D13", "x": 28, "y": 21, "w": 1, "h": 1, "locked": false},
      {"id": "D14", "x": 34, "y": 18, "w": 1, "h": 2, "locked": false},
      {"id": "D15", "x": 36, "y": 28, "w": 1, "h": 1, "locked": false},
      {"id": "D16", "x": 40, "y": 28, "w": 1, "h": 1, "locked": false},
      {"id": "D17", "x": 44, "y": 28, "w": 1, "h": 1, "locked": false},
      {"id": "D18", "x": 47, "y": 20, "w": 1, "h": 4, "locked": false},
      {"id": "D19", "x": 49, "y": 32, "w": 1, "h": 1, "locked": false},
      {"id": "D20", "x": 51, "y": 24, "w": 1, "h": 2, "locked": false},
      {"id": "D21", "x": 53, "y": 23, "w": 1, "h": 1, "locked": false},
      {"id": "D22", "x": 59, "y": 23, "w": 1, "h": 1, "locked": false},
      {"id": "D23", "x": 53, "y": 27, "w": 1, "h": 1, "locked": false},
      {"id": "D24", "x": 62, "y": 24, "w": 1, "h": 2, "locked": false},
      {"id": "D25", "x": 68, "y": 27, "w": 4, "h": 1, "locked": false},
      {"id": "D26", "x": 68, "y": 38, "w": 3, "h": 1, "locked": false},
      {"id": "D27", "x": 66, "y": 40, "w": 1, "h": 2, "locked": false},
      {"id": "D28", "x": 72, "y": 40, "w": 1, "h": 2, "locked": false}
    ],
    exits: [
      {"id": "E1", "name": "7th Ave Entrance", "x": 0, "y": 10, "w": 1, "h": 2, "locked": false},
      {"id": "E2", "name": "26th St Entrance", "x": 68, "y": 43, "w": 3, "h": 1, "locked": false},
      {"id": "E3", "name": "NW Stair Exit", "x": 0, "y": 6, "w": 1, "h": 2, "locked": false},
      {"id": "E4", "name": "Central Core Fire Exit", "x": 27, "y": 30, "w": 2, "h": 1, "locked": false}
    ],
    notes: [
      "Main west entrance and reception desk (1) located along 7th Ave.",
      "Private offices (8-15) flank the central booth lounge in the northwest wing.",
      "Dedicated desks, meeting rooms (3-5), kitchen (16), and phonebooths (19) occupy the center.",
      "Four small private offices west of the event space were merged into two rooms.",
      "Large event auditorium, bar area, Carnegie (6), and Penn (7) rooms form the east wing.",
      "South entrance onto 26th St sits between Carnegie Room (6) and Penn Room (7)."
    ]
  };

  const api = { malin, malinGemini, demo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FireLayouts = api;
})(typeof window !== 'undefined' ? window : globalThis);
