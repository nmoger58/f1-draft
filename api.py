from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import random
import uuid
import asyncio
import os
import copy
import re
import time

# Import simulator logic and data
from f1_data import (
    DRIVERS, TEAMS, PRINCIPALS, CALENDAR,
    DRIVER_YEAR_RATINGS, DRIVER_YEAR_TEAMS, TEAM_YEAR_RATINGS,
    ALL_DRIVER_NAMES, ALL_DRIVER_NATIONALITY, SEASON_YEAR,
    TRACK_FLAVOUR, INCIDENT_COMMENTARY, PENALTY_COMMENTARY,
    DNF_COMMENTARY, WIN_COMMENTARY, CHAMPIONSHIP_UPDATE
)
from f1_draft_sim import (
    Season, build_driver_pool, _parse_versioned, build_grid,
    make_driver_cards, make_car_cards, dname, load_ratings,
    rarity, RARITY_WEIGHT, draw_pack, _session_payload,
    RACE_PTS, SPRINT_PTS, FASTEST_LAP_POINT,
    LOSS_COMMENTARY, DNF_LOSS_COMMENTARY, POLE_LOSS_COMMENTARY, USER_LOSS_COMMENTARY
)

# Load the ML driver ratings
GLOBAL_DRIVERS, GLOBAL_TEAMS = load_ratings("driver_ratings.json", 0.40)

app = FastAPI(title="F1 Draft Sim Pro API", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("public", exist_ok=True)
app.mount("/static", StaticFiles(directory="public"), name="static")

@app.get("/", response_class=HTMLResponse)
def index():
    with open("public/index.html", "r", encoding="utf-8") as f:
        return f.read()

# In-memory session store
SESSIONS = {}

TEAM_PALETTE = {
    "Ferrari": "#EF4444",
    "Red Bull": "#3B82F6",
    "Mercedes": "#06B6D4",
    "McLaren": "#F97316",
    "Aston Martin": "#10B981",
    "Alpine": "#F43F5E",
    "Williams": "#38BDF8",
    "RB": "#818CF8",
    "Haas": "#94A3B8",
    "Audi": "#84CC16",
    "Cadillac": "#C084FC"
}

def resolve_team_color(team_name):
    for k, col in TEAM_PALETTE.items():
        if k.lower() in str(team_name).lower():
            return col
    return "#EAB308"

def strip_ansi(text):
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)

@app.get("/draft/config")
def get_config():
    return {
        "season_year": SEASON_YEAR,
        "modes": [
            {"id": "pack", "name": "Booster Pack Mode", "desc": "Open 5 random cards with weighted rarities"},
            {"id": "manual", "name": "Full Manual Board", "desc": "Browse & select from the entire available pool"}
        ],
        "eras": [
            {"id": "current", "name": "Current Grid", "desc": "2026 Season Lineup"},
            {"id": "legends", "name": "Era Legends", "desc": "Iconic drivers from F1 history"},
            {"id": "mixed", "name": "All Cards (Mixed)", "desc": "Modern drivers + historical versions & legends"}
        ],
        "default_parity": 0.45
    }

class CardRequest(BaseModel):
    step: int  # 1: Driver 1, 2: Driver 2, 3: Constructor, 4: Principal
    mode: str = "pack"  # "pack" or "manual"
    era: str = "mixed"
    d1: str | None = None
    d2: str | None = None
    constructor: str | None = None

@app.post("/draft/cards")
def get_cards(req: CardRequest):
    rng = random.Random()
    pool = build_driver_pool(GLOBAL_DRIVERS, req.era)
    
    blocked_driver_bases = set()
    if req.d1:
        blocked_driver_bases.add(_parse_versioned(req.d1)[0])
    if req.d2:
        blocked_driver_bases.add(_parse_versioned(req.d2)[0])
        
    blocked_team_bases = set()
    if req.constructor:
        blocked_team_bases.add(_parse_versioned(req.constructor)[0])

    if req.step in (1, 2):
        exclude = [req.d1] if req.d1 and req.step == 2 else []
        raw_drivers = make_driver_cards(pool, GLOBAL_TEAMS, exclude=exclude, blocked_bases=blocked_driver_bases)
        
        cards_data = []
        for k, l, r, b in raw_drivers:
            base, yr = _parse_versioned(k)
            d_obj = GLOBAL_DRIVERS.get(base, {})
            name = d_obj.get("name", ALL_DRIVER_NAMES.get(base, base))
            blurb = d_obj.get("era_blurb", "")
            nat = d_obj.get("nationality", ALL_DRIVER_NATIONALITY.get(base, ""))
            rar = rarity(r)
            team_label = "Free Agent"
            if yr:
                team_label = DRIVER_YEAR_TEAMS.get(base, {}).get(yr, "Unknown")
            else:
                for tname, tdata in GLOBAL_TEAMS.items():
                    if base in tdata.get("drivers", []):
                        team_label = tname
                        break
            
            cards_data.append({
                "key": k,
                "code": base,
                "name": name,
                "year": yr or SEASON_YEAR,
                "team": team_label,
                "rating": round(float(r), 1),
                "rarity": rar,
                "blocked": b,
                "nationality": nat,
                "blurb": blurb,
                "tyre_z": d_obj.get("tyre_z", 0.0),
                "consistency_z": d_obj.get("consistency_z", 0.0),
                "top_speed_z": d_obj.get("top_speed_z", 0.0)
            })
            
        if req.mode == "pack":
            pack_tuples = draw_pack(raw_drivers, rng, size=5)
            pack_keys = {c[0] for c in pack_tuples}
            # Maintain the drawn order
            drawn_cards = [c for c in cards_data if c["key"] in pack_keys]
            return {"step": req.step, "mode": "pack", "cards": drawn_cards}
        else:
            return {"step": req.step, "mode": "manual", "cards": sorted(cards_data, key=lambda x: (x["blocked"], -x["rating"]))}

    elif req.step == 3:
        raw_cars = make_car_cards(GLOBAL_TEAMS, blocked_bases=blocked_team_bases)
        cards_data = []
        for k, l, r, b in raw_cars:
            base, yr = _parse_versioned(k)
            t_obj = GLOBAL_TEAMS.get(base, {})
            rar = rarity(r)
            cards_data.append({
                "key": k,
                "code": base,
                "name": base,
                "year": yr or SEASON_YEAR,
                "rating": round(float(r), 1),
                "rarity": rar,
                "blocked": b,
                "reliability": t_obj.get("reliability", 80),
                "style": t_obj.get("style", 0.5)
            })
            
        if req.mode == "pack":
            pack_tuples = draw_pack(raw_cars, rng, size=5)
            pack_keys = {c[0] for c in pack_tuples}
            drawn_cards = [c for c in cards_data if c["key"] in pack_keys]
            return {"step": 3, "mode": "pack", "cards": drawn_cards}
        else:
            return {"step": 3, "mode": "manual", "cards": sorted(cards_data, key=lambda x: (x["blocked"], -x["rating"]))}

    elif req.step == 4:
        # Principals
        cards_data = []
        for p, (strat, dev) in PRINCIPALS.items():
            avg_r = (strat + dev) / 2
            cards_data.append({
                "key": p,
                "name": p,
                "rating": round(avg_r, 1),
                "strategy": strat,
                "development": dev,
                "rarity": rarity(avg_r),
                "blocked": False
            })
        cards_data.sort(key=lambda x: -x["rating"])
        if req.mode == "pack":
            rng.shuffle(cards_data)
            return {"step": 4, "mode": "pack", "cards": cards_data[:4]}
        return {"step": 4, "mode": "manual", "cards": cards_data}

    raise HTTPException(status_code=400, detail="Invalid step")

class DraftSubmitRequest(BaseModel):
    driver1: str
    driver2: str
    constructor: str
    principal: str
    parity: float = 0.45

@app.post("/draft/submit")
def submit_draft(req: DraftSubmitRequest):
    rng = random.Random()
    sess_drivers = copy.deepcopy(GLOBAL_DRIVERS)
    sess_teams = copy.deepcopy(GLOBAL_TEAMS)

    for d_key in [req.driver1, req.driver2]:
        base, yr = _parse_versioned(d_key)
        if yr is not None:
            yr_rating = DRIVER_YEAR_RATINGS.get(base, {}).get(yr, 80.0)
            if base not in sess_drivers:
                sess_drivers[base] = dict(
                    name=ALL_DRIVER_NAMES.get(base, base),
                    rating=yr_rating, tyre_z=0.0, consistency_z=0.0, top_speed_z=0.0,
                    era_blurb="", nationality=ALL_DRIVER_NATIONALITY.get(base, "")
                )
            else:
                sess_drivers[base]["rating"] = yr_rating

    user_ds = [_parse_versioned(req.driver1)[0], _parse_versioned(req.driver2)[0]]

    car_base, car_yr = _parse_versioned(req.constructor)
    if car_yr is not None and car_base in sess_teams:
        sess_teams[car_base]["car"] = TEAM_YEAR_RATINGS.get(car_base, {}).get(car_yr, sess_teams[car_base]["car"])

    grid = build_grid(sess_teams, user_ds, req.constructor, req.principal, rng)
    
    # Identify user team key in grid
    user_team_key = next((k for k, v in grid.items() if v.get("user")), "* Your Team")

    season = Season(grid, sess_drivers, rng, req.parity)

    # Periodic cleanup of stale sessions (> 2 hours old) to prevent memory leaks
    now = time.time()
    if len(SESSIONS) > 50:
        stale_sids = [sid for sid, s in list(SESSIONS.items()) if now - s.get("created_at", now) > 7200]
        for sid in stale_sids:
            SESSIONS.pop(sid, None)

    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {
        "season": season,
        "user_ds": user_ds,
        "user_team_key": user_team_key,
        "grid": grid,
        "rng": rng,
        "current_race": 0,
        "auto_running": False,
        "created_at": now,
        "last_accessed": now
    }

    grid_summary = []
    for tname, tdata in sorted(grid.items(), key=lambda kv: -kv[1]["car"]):
        grid_summary.append({
            "team": tname,
            "car_rating": round(float(tdata["car"]), 1),
            "drivers": [dname(sess_drivers, d) for d in tdata.get("drivers", [])],
            "principal": tdata.get("principal", ""),
            "is_user": bool(tdata.get("user"))
        })

    user_team_details = {
        "name": user_team_key,
        "car": round(float(grid[user_team_key]["car"]), 1),
        "principal": req.principal,
        "principal_stats": PRINCIPALS.get(req.principal, (80, 80)),
        "drivers": [
            {
                "code": d,
                "name": dname(sess_drivers, d),
                "rating": round(sess_drivers[d]["rating"], 1),
                "rarity": rarity(sess_drivers[d]["rating"])
            }
            for d in user_ds
        ]
    }

    return {
        "session_id": session_id,
        "user_team": user_team_details,
        "grid": grid_summary,
        "total_races": len(CALENDAR)
    }

def build_race_payload(sess, race_num):
    season = sess["season"]
    user_ds = sess["user_ds"]
    user_team_key = sess["user_team_key"]
    grid = sess["grid"]
    rng = sess["rng"]
    drivers = season.drv
    total = len(CALENDAR)
    
    track = CALENDAR[race_num - 1]
    log = season.race_weekend(track)
    
    fin_r, dnf_r, pen_r = _session_payload(log["results"], "Race")
    grid_order = log.get("grid_order") or log.get("grid_top5") or []
    grid_pos = {d: i + 1 for i, d in enumerate(grid_order)}
    finish_pos = {d: i + 1 for i, d in enumerate(fin_r)}
    
    # 1. Briefing & Notes
    weekend_notes = []
    for d, nat in log.get("home", []):
        weekend_notes.append({
            "type": "home",
            "driver": dname(drivers, d),
            "is_user": d in user_ds,
            "text": f"Home race boost for {dname(drivers, d)} - extra confidence on home soil ({nat})."
        })
    for d, wins, _edge in log.get("specialists", []):
        title = "Circuit king" if wins >= 5 else "Track specialist"
        weekend_notes.append({
            "type": "specialist",
            "driver": dname(drivers, d),
            "is_user": d in user_ds,
            "text": f"{title}: {dname(drivers, d)} has {wins} wins here - strong edge at this venue."
        })
        
    qualifying_top5 = [
        {
            "pos": i + 1,
            "code": d,
            "name": dname(drivers, d),
            "is_user": d in user_ds
        }
        for i, d in enumerate(log.get("grid_top5", [])[:5])
    ]
    
    # 2. Sprint results if applicable
    sprint_data = None
    if "Sprint" in log["results"]:
        fin_s, dnf_s, _pen_s = _session_payload(log["results"], "Sprint")
        sprint_data = {
            "top8": [
                {
                    "pos": i + 1,
                    "code": d,
                    "name": dname(drivers, d),
                    "pts": SPRINT_PTS[i],
                    "is_user": d in user_ds
                }
                for i, d in enumerate(fin_s[:8])
            ],
            "dnfs": [dname(drivers, d) for d in dnf_s]
        }
        
    # 3. Incidents
    incidents = []
    if log["sc"] and log["sc_lap"]:
        incidents.append({
            "badge": "SAFETY CAR",
            "type": "sc",
            "lap": log["sc_lap"],
            "text": f"LAP {log['sc_lap']}: {rng.choice(INCIDENT_COMMENTARY)}"
        })
    if log["vsc"] and log["vsc_lap"] and log["vsc_lap"] != log["sc_lap"]:
        incidents.append({
            "badge": "VSC",
            "type": "vsc",
            "lap": log["vsc_lap"],
            "text": f"LAP {log['vsc_lap']}: Virtual safety car deployed - marshals clearing debris."
        })
    for d in log["penalties"]:
        if d not in dnf_r:
            incidents.append({
                "badge": "PENALTY",
                "type": "penalty",
                "driver": dname(drivers, d),
                "is_user": d in user_ds,
                "text": rng.choice(PENALTY_COMMENTARY).format(driver=dname(drivers, d))
            })
    for d in log["dnfs"][:3]:
        incidents.append({
            "badge": "RETIREMENT",
            "type": "dnf",
            "driver": dname(drivers, d),
            "is_user": d in user_ds,
            "text": rng.choice(DNF_COMMENTARY).format(driver=dname(drivers, d), team=season.team_of.get(d, "Unknown"))
        })

    # 4. Mid-Race Snapshot (Lap 30)
    order = list(fin_r[:10])
    for _ in range(3):
        if len(order) > 1:
            i = rng.randrange(len(order) - 1)
            order[i], order[i + 1] = order[i + 1], order[i]
    lap30_snapshot = []
    gap = 0.0
    for i, d in enumerate(order, 1):
        if i == 1:
            interval = "LEADER"
        else:
            gap += rng.uniform(0.4, 2.8)
            interval = f"+{gap:.3f}s"
        lap30_snapshot.append({
            "pos": i,
            "code": d,
            "name": dname(drivers, d),
            "interval": interval,
            "is_user": d in user_ds
        })

    # 5. Chequered Flag
    winner = fin_r[0] if fin_r else None
    winner_quote = rng.choice(WIN_COMMENTARY).format(
        driver=dname(drivers, winner),
        team=season.team_of.get(winner, "Unknown")
    ) if winner else ""

    top10 = []
    for i, d in enumerate(fin_r[:10]):
        pts = RACE_PTS[i]
        top10.append({
            "pos": i + 1,
            "code": d,
            "name": dname(drivers, d),
            "team": season.team_of.get(d, "Unknown"),
            "pts": pts,
            "fl": d == log["fl"],
            "is_user": d in user_ds
        })

    # 6. Your Team Performance
    user_team_perf = []
    for d in user_ds:
        if d in fin_r:
            pos = fin_r.index(d) + 1
            pts = RACE_PTS[pos - 1] if pos <= len(RACE_PTS) else 0
            user_team_perf.append({
                "code": d,
                "name": dname(drivers, d),
                "pos": f"P{pos}",
                "pts": pts,
                "fl": d == log["fl"],
                "dnf": False
            })
        else:
            user_team_perf.append({
                "code": d,
                "name": dname(drivers, d),
                "pos": "DNF",
                "pts": 0,
                "fl": False,
                "dnf": True
            })

    # 7. Post-race reactions
    reactions = []
    pole = grid_order[0] if grid_order else None
    if pole and winner and pole != winner and grid_pos.get(pole, 99) == 1:
        reactions.append(rng.choice(POLE_LOSS_COMMENTARY).format(
            driver=dname(drivers, pole), winner=dname(drivers, winner)
        ))
    for d in list(user_ds) + list(grid_order[:6]):
        if len(reactions) >= 3:
            break
        g = grid_pos.get(d)
        if g is None:
            continue
        if d in dnf_r and g <= 10:
            msg = rng.choice(DNF_LOSS_COMMENTARY).format(driver=dname(drivers, d), grid=g)
            if d in user_ds:
                msg += " " + rng.choice(USER_LOSS_COMMENTARY).format(driver=dname(drivers, d))
            reactions.append(msg)
        elif d in finish_pos:
            drop = finish_pos[d] - g
            if drop >= 5 or (g <= 5 and finish_pos[d] > 10):
                msg = rng.choice(LOSS_COMMENTARY).format(driver=dname(drivers, d), grid=g, finish=finish_pos[d])
                if d in user_ds:
                    msg += " " + rng.choice(USER_LOSS_COMMENTARY).format(driver=dname(drivers, d))
                reactions.append(msg)

    # 8. Championship Standings
    ranked = season.ranked_drivers()
    leader = ranked[0]
    second = ranked[1] if len(ranked) > 1 else leader
    gap_pts = season.drv_pts[leader] - season.drv_pts[second]
    champ_msg = rng.choice(CHAMPIONSHIP_UPDATE).format(
        leader=dname(drivers, leader), chaser=dname(drivers, second),
        gap=gap_pts, n=total - race_num
    )

    user_wdc = [
        {
            "name": dname(drivers, d),
            "pos": ranked.index(d) + 1,
            "pts": season.drv_pts[d]
        }
        for d in user_ds
    ]

    mini_standings = None
    if race_num % 6 == 0 and race_num < total:
        mini_standings = {
            "drivers": [
                {
                    "pos": i + 1,
                    "name": dname(drivers, d),
                    "pts": season.drv_pts[d],
                    "wins": season.wins[d],
                    "is_user": d in user_ds
                }
                for i, d in enumerate(ranked[:8])
            ],
            "constructors": [
                {
                    "pos": i + 1,
                    "name": t,
                    "pts": season.team_pts[t],
                    "is_user": t == user_team_key
                }
                for i, t in enumerate(season.ranked_teams()[:5])
            ]
        }

    # 9. In-Race Lead Telemetry (Lead vs Lap for Top 5 + User's Drivers)
    focus_drivers = []
    for d in fin_r[:5]:
        if d not in focus_drivers:
            focus_drivers.append(d)
    for d in user_ds:
        if d not in focus_drivers:
            focus_drivers.append(d)

    total_laps = track.get("laps", 56) if isinstance(track, dict) else 56
    lap_checkpoints = [1, 15, 30, 45, total_laps]

    all_grid_drivers = list(grid_pos.keys())
    l1_scores = {d: grid_pos.get(d, 10) + rng.uniform(-0.6, 0.6) for d in all_grid_drivers}
    l1_sorted = sorted(all_grid_drivers, key=lambda d: l1_scores[d])
    l1_pos_map = {d: i + 1 for i, d in enumerate(l1_sorted)}

    l15_scores = {d: 0.6 * l1_pos_map.get(d, 10) + 0.4 * (finish_pos.get(d, 15) if d in fin_r else 19) + rng.uniform(-0.8, 0.8) for d in all_grid_drivers}
    l15_sorted = sorted(all_grid_drivers, key=lambda d: l15_scores[d])
    l15_pos_map = {d: i + 1 for i, d in enumerate(l15_sorted)}

    l30_pos_map = {car["code"]: car["pos"] for car in lap30_snapshot}
    for d in all_grid_drivers:
        if d not in l30_pos_map:
            l30_pos_map[d] = max(1, min(20, round(0.3 * l1_pos_map.get(d, 10) + 0.7 * (finish_pos.get(d, 15) if d in fin_r else 20))))

    l45_scores = {d: 0.2 * l30_pos_map.get(d, 10) + 0.8 * (finish_pos.get(d, 18) if d in fin_r else 21) + rng.uniform(-0.5, 0.5) for d in all_grid_drivers}
    l45_sorted = sorted(all_grid_drivers, key=lambda d: l45_scores[d])
    l45_pos_map = {d: i + 1 for i, d in enumerate(l45_sorted)}

    def calc_gap(p, lap_weight):
        if p == 1:
            return 0.0
        return round((p - 1) * lap_weight + rng.uniform(0.1, 0.6), 2)

    in_race_telemetry = {
        "laps": lap_checkpoints,
        "drivers": []
    }
    for d in focus_drivers:
        t_name = season.team_of.get(d, "Unknown")
        is_usr = d in user_ds
        col = resolve_team_color(t_name)
        if is_usr:
            col = "#FACC15" if d == user_ds[0] else "#38BDF8"

        p1 = l1_pos_map.get(d, grid_pos.get(d, 10))
        p15 = l15_pos_map.get(d, p1)
        p30 = l30_pos_map.get(d, p15)
        p45 = l45_pos_map.get(d, p30)
        p_end = finish_pos.get(d, "DNF")

        g1 = calc_gap(p1, 0.6)
        g15 = calc_gap(p15, 1.5)
        g30 = calc_gap(p30, 2.3)
        g45 = calc_gap(p45, 3.0)
        g_end = calc_gap(p_end, 3.6) if p_end != "DNF" else None

        in_race_telemetry["drivers"].append({
            "code": d,
            "name": dname(drivers, d),
            "team": t_name,
            "is_user": is_usr,
            "color": col,
            "final_pos": p_end,
            "positions": [p1, p15, p30, p45, p_end if p_end != "DNF" else 20],
            "gaps": [g1, g15, g30, g45, g_end if g_end is not None else 55.0]
        })

    # 10. Chronological Race Story & Commentary Feed
    race_commentary = []
    weather_str = "Rain falling, intermediate tyres fitted across the grid" if log["wet"] else "Dry and warm, soft and medium compounds selected"
    pole_d = grid_order[0] if grid_order else (fin_r[0] if fin_r else "")
    pole_name = dname(drivers, pole_d)

    race_commentary.append({
        "lap": 0,
        "badge": "FORMATION LAP",
        "type": "briefing",
        "title": "Grid Formation & Strategy",
        "text": f"22 machines line up on the grid. {weather_str}. Pole sitter {pole_name} leads the pack onto the starting grid.",
        "is_user": False
    })

    user_d1_name = dname(drivers, user_ds[0])
    user_d1_p1 = l1_pos_map.get(user_ds[0], 10)
    l1_lead_d = l1_sorted[0]
    l1_lead_name = dname(drivers, l1_lead_d)

    if l1_lead_d == pole_d:
        start_desc = f"{pole_name} gets a clean launch to hold the lead into Turn 1!"
    else:
        start_desc = f"Stunning launch from {l1_lead_name}! Sweeping around the outside to snatch P1 from {pole_name} into the opening corner!"

    user_start_desc = f"Your driver {user_d1_name} charges into P{user_d1_p1} after a wheel-to-wheel opening lap fight."
    race_commentary.append({
        "lap": 1,
        "badge": "LIGHTS OUT",
        "type": "start",
        "title": "Turn 1 Battle & Launch",
        "text": f"LIGHTS OUT AND AWAY WE GO! {start_desc} {user_start_desc}",
        "is_user": True
    })

    p2_d = l15_sorted[1] if len(l15_sorted) > 1 else l15_sorted[0]
    race_commentary.append({
        "lap": 8,
        "badge": "DRS ACTIVE",
        "type": "battle",
        "title": "High Speed Slipstream Duel",
        "text": f"DRS enabled! {dname(drivers, p2_d)} opens the rear wing and ducks out of the slipstream, hunting down the leader with 330 km/h top speed down the main straight.",
        "is_user": p2_d in user_ds
    })

    pit_lead = l15_sorted[0]
    race_commentary.append({
        "lap": 18,
        "badge": "PIT STOP",
        "type": "pit",
        "title": "Pit Window Opens: Undercut Strategy",
        "text": f"'BOX, BOX, BOX!' - {dname(drivers, pit_lead)} enters pit lane for fresh hard tyres. Crew nails a rapid 2.3s stationary stop to defend track position!",
        "is_user": pit_lead in user_ds
    })

    if log["sc"] and log["sc_lap"]:
        race_commentary.append({
            "lap": log["sc_lap"],
            "badge": "SAFETY CAR",
            "type": "sc",
            "title": "Safety Car Deployed",
            "text": f"SAFETY CAR! {rng.choice(INCIDENT_COMMENTARY)} Field bunches up nose-to-tail, erasing all built-up time gaps.",
            "is_user": False
        })
    elif log["vsc"] and log["vsc_lap"]:
        race_commentary.append({
            "lap": log["vsc_lap"],
            "badge": "VSC",
            "type": "vsc",
            "title": "Virtual Safety Car",
            "text": f"VSC deployed! Drivers restricted to delta times as marshals quickly recover debris.",
            "is_user": False
        })
    elif log["dnfs"]:
        dnf_d = log["dnfs"][0]
        race_commentary.append({
            "lap": 30,
            "badge": "RETIREMENT",
            "type": "dnf",
            "title": "Engine Failure Drama",
            "text": f"YELLOW FLAG! Smoke billows from {dname(drivers, dnf_d)}'s car as they coast into the escape road with terminal failure.",
            "is_user": dnf_d in user_ds
        })
    else:
        race_commentary.append({
            "lap": 30,
            "badge": "MID-RACE DUEL",
            "type": "battle",
            "title": "Wheel-To-Wheel Combat",
            "text": "Intense wheel-to-wheel combat in the front pack! Less than 1.5s covers the podium fight as tyres begin to blister.",
            "is_user": False
        })

    user_focus_d = user_ds[0]
    u_p = finish_pos.get(user_focus_d, 10)
    radio_quotes = [
        f"Radio from your pit wall: 'Keep this relentless pace {dname(drivers, user_focus_d)}, tyre degradation is looking great and we are fighting for P{u_p}!'",
        f"Radio from your pit wall: 'Target lap time 1:21.8 - bring the car home in the points!'",
        f"Radio to {dname(drivers, user_focus_d)}: 'Mode 6 on exit, maximum deploy down the back straight!'"
    ]
    race_commentary.append({
        "lap": 38,
        "badge": "TEAM RADIO",
        "type": "radio",
        "title": "Garage Intercom",
        "text": rng.choice(radio_quotes),
        "is_user": True
    })

    fl_d = log["fl"] if log["fl"] else (fin_r[0] if fin_r else None)
    if fl_d:
        race_commentary.append({
            "lap": 46,
            "badge": "PURPLE SECTOR",
            "type": "fl",
            "title": "Fastest Lap Charge",
            "text": f"{dname(drivers, fl_d)} lights up the timing screens with purple sectors in all three sectors to set the fastest lap of the race!",
            "is_user": fl_d in user_ds
        })

    winner_name = dname(drivers, winner) if winner else "Unknown"
    winner_t = season.team_of.get(winner, "Unknown")
    user_pts_race = sum(RACE_PTS[finish_pos[d] - 1] for d in user_ds if d in fin_r and finish_pos[d] <= len(RACE_PTS))
    race_commentary.append({
        "lap": total_laps,
        "badge": "CHEQUERED FLAG",
        "type": "finish",
        "title": f"{winner_name} Wins!",
        "text": f"CHEQUERED FLAG! {winner_name} powers across the finish line to take victory for {winner_t}! Your team secures +{user_pts_race} championship points this round.",
        "is_user": True
    })

    return {
        "round": race_num,
        "total_rounds": total,
        "track": track["name"],
        "circuit": track.get("circuit", ""),
        "total_laps": total_laps,
        "in_race_telemetry": in_race_telemetry,
        "race_commentary": race_commentary,
        "flavour": TRACK_FLAVOUR.get(track["name"], ""),
        "wet": bool(log["wet"]),
        "sprint": bool(track["sprint"]),
        "weekend_notes": weekend_notes,
        "qualifying_top5": qualifying_top5,
        "sprint_data": sprint_data,
        "incidents": incidents,
        "lap30_snapshot": lap30_snapshot,
        "chequered_flag": {
            "winner": dname(drivers, winner) if winner else "Unknown",
            "winner_team": season.team_of.get(winner, "Unknown") if winner else "",
            "winner_quote": winner_quote,
            "top10": top10,
            "dnfs": [dname(drivers, d) for d in dnf_r],
            "fastest_lap": dname(drivers, log["fl"]) if log["fl"] else None
        },
        "user_team_perf": user_team_perf,
        "reactions": reactions[:3],
        "championship": {
            "update_msg": champ_msg,
            "user_drivers": user_wdc
        },
        "mini_standings": mini_standings
    }

@app.websocket("/stream/{session_id}")
async def stream_season(websocket: WebSocket, session_id: str):
    await websocket.accept()
    if session_id not in SESSIONS:
        await websocket.close(code=1008, reason="Session not found")
        return

    sess = SESSIONS[session_id]
    sess["last_accessed"] = time.time()
    season = sess["season"]
    user_ds = sess["user_ds"]
    user_team_key = sess["user_team_key"]
    grid = sess["grid"]
    rng = sess["rng"]
    total = len(CALENDAR)

    try:
        while True:
            # Check if season completed
            if sess["current_race"] >= total:
                ranked = season.ranked_drivers()
                drivers_table = [
                    {
                        "pos": i + 1,
                        "name": dname(season.drv, d),
                        "pts": season.drv_pts[d],
                        "wins": season.wins[d],
                        "podiums": season.podiums[d],
                        "is_user": d in user_ds
                    }
                    for i, d in enumerate(ranked)
                ]
                constructors_table = [
                    {
                        "pos": i + 1,
                        "name": t,
                        "pts": season.team_pts[t],
                        "is_user": t == user_team_key
                    }
                    for i, t in enumerate(season.ranked_teams())
                ]
                
                champ_driver = dname(season.drv, ranked[0])
                champ_team = season.team_of.get(ranked[0], "Unknown")
                user_best_pos = min(ranked.index(d) + 1 for d in user_ds)
                user_team_pos = season.ranked_teams().index(user_team_key) + 1
                
                user_drivers_summary = [
                    {
                        "code": d,
                        "name": dname(season.drv, d),
                        "pos": ranked.index(d) + 1,
                        "pts": season.drv_pts[d],
                        "wins": season.wins[d],
                        "podiums": season.podiums[d],
                    }
                    for d in user_ds
                ]

                if user_best_pos == 1:
                    verdict = "CONGRATULATIONS - YOUR DRIVER IS THE 2026 WORLD CHAMPION!"
                elif user_team_pos == 1:
                    verdict = "CONSTRUCTORS' CHAMPIONS - YOUR TEAM TOOK THE CROWN!"
                elif user_best_pos <= 3 or user_team_pos <= 3:
                    verdict = "PODIUM CONTENDERS - Outstanding season battling at the very top."
                else:
                    verdict = "SEASON COMPLETE - Points on the board and solid foundation built."

                await websocket.send_json({
                    "type": "season_end",
                    "data": {
                        "drivers": drivers_table,
                        "constructors": constructors_table,
                        "champ_driver": champ_driver,
                        "champ_team": champ_team,
                        "champ_pts": season.drv_pts[ranked[0]],
                        "user_team_name": user_team_key,
                        "user_team_pts": season.team_pts.get(user_team_key, 0),
                        "user_best_pos": user_best_pos,
                        "user_team_pos": user_team_pos,
                        "user_drivers": user_drivers_summary,
                        "verdict": verdict
                    }
                })
                break

            # Mid-season Summer Break at race 12
            if sess["current_race"] == total // 2 and not sess.get("summer_break_done"):
                u_sorted = sorted(user_ds, key=lambda d: (-season.drv_pts[d], -season.wins[d]))
                best_d = u_sorted[0]
                worst_d = u_sorted[-1]
                ranked = season.ranked_drivers()

                await websocket.send_json({
                    "type": "summer_break_prompt",
                    "data": {
                        "round": sess["current_race"],
                        "best_driver": {
                            "code": best_d,
                            "name": dname(season.drv, best_d),
                            "pos": ranked.index(best_d) + 1,
                            "pts": season.drv_pts[best_d],
                            "rating": round(season.drv[best_d]["rating"], 1)
                        },
                        "worst_driver": {
                            "code": worst_d,
                            "name": dname(season.drv, worst_d),
                            "pos": ranked.index(worst_d) + 1,
                            "pts": season.drv_pts[worst_d],
                            "rating": round(season.drv[worst_d]["rating"], 1)
                        }
                    }
                })

                # Await user decision from client
                client_msg = await websocket.receive_json()
                action = client_msg.get("action")
                choice = client_msg.get("choice", 1)

                if choice == 1:
                    # Continue with existing
                    await websocket.send_json({
                        "type": "summer_break_result",
                        "data": {
                            "choice": 1,
                            "headline": "NO CHANGES MADE",
                            "message": "You decided to trust your lineup and car for the second half of the season."
                        }
                    })
                elif choice == 2:
                    # Make a change: sub-options 1, 2, or 3
                    sub_choice = client_msg.get("sub_choice", 1)
                    if sub_choice == 1:
                        # Driver Focus: Transfer 1-5 (rare 6-7) OVR
                        n = rng.choices([1, 2, 3, 4, 5, 6, 7], weights=[18, 18, 18, 18, 18, 7, 3])[0]
                        season.drv_str[worst_d] -= n
                        season.drv[worst_d]["rating"] -= n
                        season.drv_str[best_d] += n
                        season.drv[best_d]["rating"] += n
                        await websocket.send_json({
                            "type": "summer_break_result",
                            "data": {
                                "choice": 2,
                                "sub_choice": 1,
                                "roll": n,
                                "headline": f"DRIVER FOCUS: WHEEL LANDED ON {n}!",
                                "message": f"{dname(season.drv, worst_d)} loses -{n} OVR. {dname(season.drv, best_d)} gains +{n} OVR.",
                                "worst_rating": round(season.drv[worst_d]["rating"], 1),
                                "best_rating": round(season.drv[best_d]["rating"], 1)
                            }
                        })
                    elif sub_choice == 2:
                        # Car Focus: Sacrifice 10-100 WDC pts for car rating
                        pts_target = rng.choice([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
                        available = season.drv_pts[worst_d]
                        actual_taken = min(pts_target, available)
                        car_gain = pts_target // 10
                        
                        season.car_str[user_team_key] += car_gain
                        grid[user_team_key]["car"] += car_gain
                        season.drv_pts[worst_d] -= actual_taken
                        season.team_pts[user_team_key] -= actual_taken
                        
                        await websocket.send_json({
                            "type": "summer_break_result",
                            "data": {
                                "choice": 2,
                                "sub_choice": 2,
                                "roll": pts_target,
                                "car_gain": car_gain,
                                "actual_taken": actual_taken,
                                "headline": f"CAR UPGRADE: +{car_gain} CAR OVR!",
                                "message": f"Sacrificed {actual_taken} WDC points from {dname(season.drv, worst_d)}. Your car performance increased by +{car_gain} OVR!",
                                "new_car_rating": round(grid[user_team_key]["car"], 1)
                            }
                        })
                    elif sub_choice == 3:
                        # Take The Risk: Grid Roulette
                        best_pos = ranked.index(best_d) + 1
                        others = [d for d in ranked if d != best_d]
                        target_d = rng.choice(others)
                        target_pos = ranked.index(target_d) + 1
                        target_name = dname(season.drv, target_d)

                        if target_pos < best_pos:
                            gain = max(1, 11 - target_pos)
                            season.drv_str[best_d] += gain
                            season.drv[best_d]["rating"] += gain
                            await websocket.send_json({
                                "type": "summer_break_result",
                                "data": {
                                    "choice": 2,
                                    "sub_choice": 3,
                                    "target": target_name,
                                    "target_pos": target_pos,
                                    "success": True,
                                    "delta": gain,
                                    "headline": f"RISK SUCCESS: DREW {target_name} (P{target_pos})!",
                                    "message": f"They are ABOVE your best driver! {dname(season.drv, best_d)} surges with a massive +{gain} OVR boost!",
                                    "new_rating": round(season.drv[best_d]["rating"], 1)
                                }
                            })
                        else:
                            loss = max(1, target_pos - best_pos)
                            season.drv_str[best_d] -= loss
                            season.drv[best_d]["rating"] -= loss
                            await websocket.send_json({
                                "type": "summer_break_result",
                                "data": {
                                    "choice": 2,
                                    "sub_choice": 3,
                                    "target": target_name,
                                    "target_pos": target_pos,
                                    "success": False,
                                    "delta": -loss,
                                    "headline": f"RISK FAILED: DREW {target_name} (P{target_pos})!",
                                    "message": f"They are BELOW your best driver! {dname(season.drv, best_d)} suffers a setback of -{loss} OVR.",
                                    "new_rating": round(season.drv[best_d]["rating"], 1)
                                }
                            })

                sess["summer_break_done"] = True
                continue

            # Wait for client instruction or run automatically if auto_running
            if not sess.get("auto_running"):
                msg = await websocket.receive_json()
                action = msg.get("action")
                if action == "auto_play":
                    sess["auto_running"] = True
                    sess["auto_delay"] = max(1.0, min(10.0, float(msg.get("delay", 4.0))))
                elif action == "next_race":
                    pass
                elif action == "get_standings":
                    ranked = season.ranked_drivers()
                    await websocket.send_json({
                        "type": "current_standings",
                        "drivers": [
                            {"pos": i + 1, "name": dname(season.drv, d), "pts": season.drv_pts[d], "is_user": d in user_ds}
                            for i, d in enumerate(ranked)
                        ],
                        "constructors": [
                            {"pos": i + 1, "name": t, "pts": season.team_pts[t], "is_user": t == user_team_key}
                            for i, t in enumerate(season.ranked_teams())
                        ]
                    })
                    continue
                else:
                    continue

            # Execute race
            sess["current_race"] += 1
            race_payload = await asyncio.to_thread(
                build_race_payload, sess, sess["current_race"]
            )
            await websocket.send_json({
                "type": "race_result",
                "data": race_payload
            })

            if sess.get("auto_running"):
                total_delay = sess.get("auto_delay", 4.0)
                elapsed = 0.0
                while elapsed < total_delay and sess.get("auto_running"):
                    slice_time = min(0.25, total_delay - elapsed)
                    await asyncio.sleep(slice_time)
                    elapsed += slice_time
                    try:
                        incoming = await asyncio.wait_for(websocket.receive_json(), timeout=0.01)
                        if incoming.get("action") == "pause":
                            sess["auto_running"] = False
                            break
                        elif incoming.get("action") == "auto_play":
                            sess["auto_delay"] = max(1.0, min(10.0, float(incoming.get("delay", 4.0))))
                    except asyncio.TimeoutError:
                        pass

    except WebSocketDisconnect:
        pass
