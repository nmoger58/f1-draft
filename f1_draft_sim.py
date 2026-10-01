#!/usr/bin/env python3
"""
F1 Draft Season Simulator  (v2 - balanced)
==========================================
Draft 2 DRIVERS + 1 CONSTRUCTOR + 1 TEAM PRINCIPAL, then watch a streamed,
race-by-race season with live-timing style commentary.

USAGE
  python f1_draft_sim.py                      # interactive draft + streamed season
  python f1_draft_sim.py --mode manual        # pick from full lists
  python f1_draft_sim.py --auto --fast        # instant simulation (testing)
  python f1_draft_sim.py --race-delay 5       # seconds per race (default 3)
  python f1_draft_sim.py --montecarlo 500     # title odds over 500 seasons
  python f1_draft_sim.py --parity 0.5         # flatter field (0 = raw ratings)
  python f1_draft_sim.py --seed 7             # reproducible season

WHY THIS VERSION DOESN'T HAND EVERYTHING TO ONE TEAM
  * --parity (default 0.45) pulls every driver / car strength toward the field
    average INSIDE the simulation (card ratings still show the real numbers).
    It also scales the tyre / top-speed / wet bonuses, which used to stack a
    second "car advantage" onto the quick team's drivers.
  * Driver weight in the performance score is 0.45 dry / 0.55 wet (was 0.40/0.60).
  * More race randomness (qualifying 3.0, sprint 4.5, race 7.0) and a smaller
    grid-position snowball.
  * Cars mean-revert harder and upgrade swings are bigger, so chasers catch up.
  * Bug fix: the top-speed bonus used max(0, -downforce), which was always 0.
  * Bug fix: more teams than principals no longer crashes.
"""

import argparse, copy, json, os, random, time
import numpy as np
from f1_data import (DRIVERS, DRIVERS_2026, ERA_DRIVERS, TEAMS, PRINCIPALS, CALENDAR,
                     TRACK_FLAVOUR, INCIDENT_COMMENTARY, PENALTY_COMMENTARY,
                     DNF_COMMENTARY, WIN_COMMENTARY, CHAMPIONSHIP_UPDATE)
try:
    from f1_data import (SEASON_YEAR, DRIVER_NATIONALITY, TRACK_WINS, HOME_CIRCUITS,
                         DRIVER_YEAR_RATINGS, DRIVER_YEAR_TEAMS, TEAM_YEAR_RATINGS,
                         ALL_DRIVER_NAMES, ALL_DRIVER_NATIONALITY)
except ImportError:
    SEASON_YEAR = 2026
    DRIVER_NATIONALITY, TRACK_WINS, HOME_CIRCUITS = {}, {}, {}
    DRIVER_YEAR_RATINGS, DRIVER_YEAR_TEAMS, TEAM_YEAR_RATINGS = {}, {}, {}
    ALL_DRIVER_NAMES, ALL_DRIVER_NATIONALITY = {}, {}

RACE_PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
SPRINT_PTS = [8, 7, 6, 5, 4, 3, 2, 1]
FASTEST_LAP_POINT = 0            # no bonus point under current rules; set 1 for the old rule
USER_TEAM = "* Your Team"

DEFAULT_PARITY = 0.45
DEFAULT_ML_WEIGHT = 0.40
QUALI_NOISE = 2.6
# Grid position must survive race noise: P1≈+9.0, P5≈+6.6, P10≈+3.6 vs ~5.5σ noise
SPRINT_BONUS, SPRINT_NOISE = 0.28, 3.8
RACE_BONUS, RACE_NOISE = 0.60, 5.5
TRACK_WIN_EDGE = 1.15         # base per historical win (diminishing after a few)
TRACK_WIN_CAP = 5.5           # 5+ wins ≈ serious podium pull vs race noise
HOME_RACE_EDGE = 0.85          # minor confidence bump only
DRY_DRIVER_WEIGHT = 0.40       # cars carry more weight in the dry
WET_DRIVER_WEIGHT = 0.52       # driver skill rises when it's wet

# ═══════════════════════════════════════════════════════════════════════
# TERMINAL COLOURS
# ═══════════════════════════════════════════════════════════════════════
R = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[91m"
GRN = "\033[92m"
YEL = "\033[93m"
BLU = "\033[94m"
MAG = "\033[95m"
CYN = "\033[96m"
WHT = "\033[97m"
GREY = "\033[90m"

RARITY_COL = {"LEGENDARY": YEL + BOLD, "EPIC": MAG + BOLD, "RARE": BLU + BOLD,
              "UNCOMMON": CYN, "COMMON": R}
RARITY_WEIGHT = {"LEGENDARY": 1, "EPIC": 2, "RARE": 5, "UNCOMMON": 9, "COMMON": 14}


def rarity(r):
    if r >= 91: return "LEGENDARY"
    if r >= 87: return "EPIC"
    if r >= 82: return "RARE"
    if r >= 77: return "UNCOMMON"
    return "COMMON"


def col(text, colour):
    return f"{colour}{text}{R}"


def colorize_rarity(text, r):
    return col(text, RARITY_COL[rarity(r)])


def _parse_versioned(key):
    """'HAM|2020' → ('HAM', 2020);  'HAM' → ('HAM', None)"""
    if "|" in str(key):
        base, yr = key.rsplit("|", 1)
        return base, int(yr)
    return str(key), None


# ═══════════════════════════════════════════════════════════════════════
# STREAMING ENGINE
# ═══════════════════════════════════════════════════════════════════════
class Streamer:
    """All terminal output with configurable pacing. fast=True skips every delay."""

    def __init__(self, fast=False, race_delay=3.0):
        self.fast = fast
        self.race_delay = race_delay
        self._race_start = None

    def begin_race(self):
        self._race_start = time.time()

    def _remaining(self):
        if self._race_start is None:
            return 0.0
        return max(0.0, self.race_delay - (time.time() - self._race_start))

    def line(self, text="", end="\n", colour=None, delay=0.0):
        if colour:
            text = col(text, colour)
        print(text, end=end, flush=True)
        if not self.fast and delay > 0:
            time.sleep(min(delay, self._remaining()))

    def stream_text(self, text, char_delay=0.018, colour=None):
        if self.fast:
            print(col(text, colour) if colour else text, flush=True)
            return
        if colour:
            print(colour, end="", flush=True)
        for ch in text:
            print(ch, end="", flush=True)
            time.sleep(char_delay)
        if colour:
            print(R, end="", flush=True)
        print()

    def banner(self, text, char="=", width=62, colour=BLU):
        bar = char * width
        self.line(f"\n{col(bar, colour)}")
        self.line(col("  " + text, colour + BOLD))
        self.line(col(bar, colour))

    def subhead(self, text, colour=GREY):
        self.line(f"\n{col('  -- ' + text + ' --', colour)}", delay=0.05)

    def race_pause(self, beats=1):
        if self.fast:
            return
        remaining = self._remaining()
        if remaining > 0.15:
            time.sleep(min(0.25 * beats, remaining * 0.4))

    def wait_race_budget(self):
        if self.fast:
            return
        leftover = self._remaining()
        if leftover > 0:
            time.sleep(leftover)


# ═══════════════════════════════════════════════════════════════════════
# RATINGS LOADER
# ═══════════════════════════════════════════════════════════════════════
def load_ratings(path, ml_weight=DEFAULT_ML_WEIGHT):
    drivers = {code: dict(name=name, rating=float(r), tyre_z=0.0, consistency_z=0.0,
                          top_speed_z=0.0, era_blurb="",
                          nationality=DRIVER_NATIONALITY.get(code, ""))
               for code, (name, r) in DRIVERS.items()}
    for code, (name, rating, yr, team, blurb) in ERA_DRIVERS.items():
        if code in drivers:
            drivers[code]["era_blurb"] = blurb

    teams = copy.deepcopy(TEAMS)

    if path and os.path.exists(path):
        with open(path) as fh:
            ml = json.load(fh)
        n_d = n_t = 0
        for code, v in ml.get("drivers", {}).items():
            if code in drivers:
                d = drivers[code]
                d["rating"] = (1 - ml_weight) * d["rating"] + ml_weight * v["driver_rating"]
                d["tyre_z"] = v.get("tyre_z", 0.0)
                d["consistency_z"] = v.get("consistency_z", 0.0)
                d["top_speed_z"] = v.get("top_speed_z", 0.0)
                n_d += 1
        for team, v in ml.get("teams", {}).items():
            if team in teams:
                teams[team]["car"] = (1 - ml_weight) * teams[team]["car"] + ml_weight * v["car_rating"]
                n_t += 1
        info = ml.get("model_info", {})
        print(col(f"[ML] {n_d} drivers, {n_t} teams updated - {info.get('total_laps', '?')} laps "
                  f"trained (weight {ml_weight:.0%})", GREY))
    else:
        print(col("[No driver_ratings.json - using built-in ratings. Run f1_model.py to add ML.]", GREY))
    return drivers, teams


# ═══════════════════════════════════════════════════════════════════════
# DRAFT SYSTEM
# ═══════════════════════════════════════════════════════════════════════
def build_driver_pool(drivers, era_mode):
    current = set(DRIVERS_2026.keys())
    era = set(ERA_DRIVERS.keys())
    if era_mode == "current":
        pool = {c: v for c, v in drivers.items() if c in current}
    elif era_mode == "legends":
        pool = {c: v for c, v in drivers.items() if c in era}
    else:
        pool = dict(drivers)
    if not pool:
        print(col("  [No cards for that --era in f1_data.py; using the current grid.]", GREY))
        pool = dict(drivers)
    return pool


def ask_int(prompt, lo, hi, default=None):
    while True:
        try:
            raw = input(prompt).strip()
        except EOFError:
            raw = ""
        if raw == "" and default is not None:
            return default
        if raw.isdigit() and lo <= int(raw) <= hi:
            return int(raw)
        print(f"    {col('enter a number ' + str(lo) + '-' + str(hi), GREY)}")


def draw_pack(cards, rng, size=5):
    weights = [RARITY_WEIGHT[rarity(c[2])] for c in cards]
    want = min(size, len(cards))
    pack, seen = [], set()
    for c in rng.choices(cards, weights=weights, k=min(500, len(cards) * 12)):
        if c[0] not in seen:
            pack.append(c)
            seen.add(c[0])
        if len(pack) == want:
            break
    return pack


def _current_team_label(code, teams):
    for t, v in teams.items():
        if code in v.get("drivers", []):
            return t
    if code in ERA_DRIVERS:
        return ERA_DRIVERS[code][3]
    return "Free Agent"


def make_driver_cards(pool, teams, exclude=(), blocked_bases=frozenset()):
    """Build draft cards including per-year versions.

    Returns list of (key, label, rating, is_blocked) tuples.
    key is 'CODE' for current-year or 'CODE|YEAR' for historical versions.
    """
    cards = []
    seen = set()
    excluded_bases = {_parse_versioned(e)[0] for e in exclude}

    # Current-year drivers from the pool
    for code, d in pool.items():
        if code in exclude:
            continue
        has_versions = bool(DRIVER_YEAR_RATINGS.get(code))
        yr_tag = f" ({SEASON_YEAR})" if has_versions else ""
        team_label = _current_team_label(code, teams)
        rating = d["rating"]
        is_blocked = code in blocked_bases

        ovr = col(f"ovr {rating:.0f}", GREY if is_blocked else WHT)
        if is_blocked:
            tag = col(" [BLOCKED]", RED + BOLD)
            label = f"{d['name']:22}{yr_tag} {ovr}  {tag}"
        else:
            team_txt = col(f"({team_label})", GREY)
            label = f"{d['name']:22}{yr_tag} {ovr}  {team_txt}"
            if d.get("era_blurb"):
                label += "\n           " + col(d["era_blurb"][:62], DIM)

        cards.append((code, label, rating, is_blocked))
        seen.add(code)

    # Historical year versions from DRIVER_YEAR_RATINGS
    for code, years in DRIVER_YEAR_RATINGS.items():
        for yr, yr_rating in sorted(years.items(), reverse=True):
            if yr == SEASON_YEAR and code in seen:
                continue  # current year already covered above
            key = f"{code}|{yr}"
            if key in seen:
                continue
            is_blocked = code in blocked_bases or key in exclude

            name = ALL_DRIVER_NAMES.get(code, code)
            team_yr = DRIVER_YEAR_TEAMS.get(code, {}).get(yr, "")
            yr_tag = f" ({yr})"

            ovr = col(f"ovr {yr_rating:.0f}", GREY if is_blocked else WHT)
            if is_blocked:
                tag = col(" [BLOCKED]", RED + BOLD)
                label = f"{name:22}{yr_tag} {ovr}  {tag}"
            else:
                team_txt = col(f"({team_yr})", GREY) if team_yr else ""
                label = f"{name:22}{yr_tag} {ovr}  {team_txt}"

            cards.append((key, label, yr_rating, is_blocked))
            seen.add(key)

    return cards


def make_car_cards(teams, blocked_bases=frozenset()):
    """Build draft cards for constructors including per-year versions.

    Returns list of (key, label, rating, is_blocked) tuples.
    """
    cards = []
    seen = set()

    # Current-year teams
    for t, v in teams.items():
        has_versions = bool(TEAM_YEAR_RATINGS.get(t))
        yr_tag = f" ({SEASON_YEAR})" if has_versions else ""
        is_blocked = t in blocked_bases
        car_val = v["car"]

        if is_blocked:
            tag = col(" [BLOCKED]", RED + BOLD)
            label = f"{t:17}{yr_tag} car {col(str(int(car_val)), GREY)}  rel {int(v['reliability'])}  {tag}"
        else:
            label = f"{t:17}{yr_tag} car {col(str(int(car_val)), WHT)}  rel {int(v['reliability'])}"

        cards.append((t, label, car_val, is_blocked))
        seen.add(t)

    # Historical year versions (only for teams currently on the grid)
    for t in list(teams.keys()):
        yr_data = TEAM_YEAR_RATINGS.get(t, {})
        for yr, car_val in sorted(yr_data.items(), reverse=True):
            if yr == SEASON_YEAR and t in seen:
                continue
            key = f"{t}|{yr}"
            if key in seen:
                continue
            is_blocked = t in blocked_bases
            yr_tag = f" ({yr})"

            if is_blocked:
                tag = col(" [BLOCKED]", RED + BOLD)
                label = f"{t:17}{yr_tag} car {col(str(int(car_val)), GREY)}  {tag}"
            else:
                label = f"{t:17}{yr_tag} car {col(str(int(car_val)), WHT)}"

            cards.append((key, label, car_val, is_blocked))
            seen.add(key)

    return cards


def pick_card(title, cards, rng, mode, auto, state):
    available = [c for c in cards if not c[3]]  # not blocked

    if auto:
        if not available:
            available = cards  # fallback
        inv = [1.0 / RARITY_WEIGHT[rarity(c[2])] for c in available]
        return rng.choices(available, weights=inv, k=1)[0][0]

    if mode == "manual":
        # Available first (by rating desc), then blocked
        avail_sorted = sorted([c for c in cards if not c[3]], key=lambda c: -c[2])
        blocked_sorted = sorted([c for c in cards if c[3]], key=lambda c: -c[2])
        pool_sorted = avail_sorted + blocked_sorted

        print("\n" + "=" * 62)
        print(col(f"  SELECT: {title}", BOLD))
        print("-" * 62)
        for i, (key, label, r, is_blk) in enumerate(pool_sorted, 1):
            if is_blk and i == len(avail_sorted) + 1:
                print("  " + col("--- BLOCKED (other version already picked) ---", RED))
            if is_blk:
                tag = col(f"[{'BLOCKED':10}]", RED)
            else:
                tag = col(f"[{rarity(r):10}]", RARITY_COL[rarity(r)])
            print(f"  {col(str(i).rjust(2), GREY)}. {tag} {label}")
        while True:
            n = ask_int(col("  Pick #: ", CYN), 1, len(pool_sorted))
            if pool_sorted[n - 1][3]:
                print(col("    BLOCKED - you already picked a version of this driver/team!", RED + BOLD))
                continue
            return pool_sorted[n - 1][0]

    while True:                                    # DRAFT MODE
        pack = draw_pack(available if available else cards, rng, size=5)
        print("\n" + "=" * 62)
        print(col(f"  DRAFT PACK  -  {title}", BOLD + YEL))
        print("-" * 62)
        for i, card in enumerate(pack, 1):
            r = card[2]
            tag = col(f"[{rarity(r):10}]", RARITY_COL[rarity(r)])
            print(f"  {col(str(i), WHT + BOLD)}. {tag} {card[1]}")
        if state["rerolls"] > 0:
            print(f"\n  {col('0', GREY)}. " + col(f"Reroll pack  ({state['rerolls']} left)", GREY))
        n = ask_int(col("  Pick #: ", CYN), 0 if state["rerolls"] > 0 else 1, len(pack))
        if n == 0:
            state["rerolls"] -= 1
            print(col("  Rerolling...", GREY))
            continue
        return pack[n - 1][0]


def build_user_team(drivers, teams, rng, mode, auto, era_mode):
    state = {"rerolls": 2}
    pool = build_driver_pool(drivers, era_mode)

    blocked_driver_bases = set()
    blocked_team_bases = set()

    # ── Draft Driver 1 ──
    d_cards = make_driver_cards(pool, teams, blocked_bases=blocked_driver_bases)
    d1_key = pick_card("DRIVER 1", d_cards, rng, mode, auto, state)
    d1_base, d1_year = _parse_versioned(d1_key)
    blocked_driver_bases.add(d1_base)
    if d1_year is not None:
        yr_rating = DRIVER_YEAR_RATINGS.get(d1_base, {}).get(d1_year, 80.0)
        yr_team = DRIVER_YEAR_TEAMS.get(d1_base, {}).get(d1_year, "")
        if d1_base not in drivers:
            drivers[d1_base] = dict(
                name=ALL_DRIVER_NAMES.get(d1_base, d1_base),
                rating=yr_rating, tyre_z=0.0, consistency_z=0.0,
                top_speed_z=0.0, era_blurb=f"{d1_year} season \u2014 {yr_team}",
                nationality=ALL_DRIVER_NATIONALITY.get(d1_base, ""))
        else:
            drivers[d1_base]["rating"] = yr_rating
            drivers[d1_base]["era_blurb"] = f"{d1_year} season"

    # ── Draft Driver 2 ──
    d_cards = make_driver_cards(pool, teams, exclude=[d1_key],
                                blocked_bases=blocked_driver_bases)
    d2_key = pick_card("DRIVER 2", d_cards, rng, mode, auto, state)
    d2_base, d2_year = _parse_versioned(d2_key)
    blocked_driver_bases.add(d2_base)
    if d2_year is not None:
        yr_rating = DRIVER_YEAR_RATINGS.get(d2_base, {}).get(d2_year, 80.0)
        yr_team = DRIVER_YEAR_TEAMS.get(d2_base, {}).get(d2_year, "")
        if d2_base not in drivers:
            drivers[d2_base] = dict(
                name=ALL_DRIVER_NAMES.get(d2_base, d2_base),
                rating=yr_rating, tyre_z=0.0, consistency_z=0.0,
                top_speed_z=0.0, era_blurb=f"{d2_year} season \u2014 {yr_team}",
                nationality=ALL_DRIVER_NATIONALITY.get(d2_base, ""))
        else:
            drivers[d2_base]["rating"] = yr_rating
            drivers[d2_base]["era_blurb"] = f"{d2_year} season"

    # ── Draft Constructor (with year versions + blocking) ──
    car_cards = make_car_cards(teams, blocked_bases=blocked_team_bases)
    car_key = pick_card("CONSTRUCTOR", car_cards, rng, mode, auto, state)
    car_base, car_year = _parse_versioned(car_key)
    if car_year is not None and car_base in teams:
        teams[car_base]["car"] = TEAM_YEAR_RATINGS.get(car_base, {}).get(
            car_year, teams[car_base]["car"])

    # ── Draft Principal (no versioning / no blocking) ──
    pr_cards = []
    for p, (s, dv) in PRINCIPALS.items():
        label = f"{p:24} strat {col(str(s), WHT)}  dev {col(str(dv), WHT)}"
        pr_cards.append((p, label, (s + dv) / 2, False))
    prin = pick_card("TEAM PRINCIPAL", pr_cards, rng, mode, auto, state)
    return [d1_base, d2_base], car_base, prin


def build_grid(teams, user_drivers, car_key, principal_key, rng):
    global USER_TEAM
    
    # Parse the versioned car key to make a nice team name
    if "|" in car_key:
        base, yr = car_key.rsplit("|", 1)
        USER_TEAM = f"* {base} ({yr})"
    else:
        USER_TEAM = f"* {car_key} (Your Team)"

    grid = {t: dict(v, drivers=list(v["drivers"])) for t, v in teams.items()}
    
    # Pop the base team off the grid
    base_team = car_key.split("|")[0] if "|" in car_key else car_key
    original = grid.pop(base_team)
    
    grid[USER_TEAM] = dict(original, principal=principal_key, drivers=list(user_drivers), user=True)

    ai_p = [p for p in PRINCIPALS if p != principal_key] or list(PRINCIPALS)
    rng.shuffle(ai_p)
    for i, t in enumerate(t for t in grid if t != USER_TEAM):
        grid[t]["principal"] = ai_p[i % len(ai_p)]      # never runs out of principals

    displaced = [d for d in original["drivers"] if d not in user_drivers]
    vacant = []
    for t, v in grid.items():
        if v.get("user"):
            continue
        v["drivers"] = [d for d in v["drivers"] if d not in user_drivers]
        vacant.extend([t] * (2 - len(v["drivers"])))
    rng.shuffle(displaced)
    for t, d in zip(vacant, displaced):
        grid[t]["drivers"].append(d)
    return grid


# ═══════════════════════════════════════════════════════════════════════
# SEASON ENGINE
# ═══════════════════════════════════════════════════════════════════════
class Season:
    def __init__(self, grid, drivers, rng, parity=DEFAULT_PARITY):
        self.grid = grid
        self.drv = drivers
        self.rng = rng
        self.k = 1.0 - min(max(parity, 0.0), 0.95)       # 1 = raw ratings, ~0 = everyone equal
        self.team_of = {d: t for t, v in grid.items() for d in v["drivers"]}

        on_grid = [d for d in self.team_of if d in drivers]
        self.d_mean = float(np.mean([drivers[d]["rating"] for d in on_grid])) if on_grid else 80.0
        self.c_mean = float(np.mean([float(v["car"]) for v in grid.values()]))
        self.drv_str = {d: self.d_mean + self.k * (drivers[d]["rating"] - self.d_mean)
                        if d in drivers else self.d_mean for d in self.team_of}
        self.car_str = {t: self.c_mean + self.k * (float(v["car"]) - self.c_mean)
                        for t, v in grid.items()}

        self.form = {d: 0.0 for d in self.team_of}
        self.drv_pts = {d: 0 for d in self.team_of}
        self.team_pts = {t: 0 for t in grid}
        self.wins = {d: 0 for d in self.team_of}
        self.podiums = {d: 0 for d in self.team_of}
        self.fastest = {d: 0 for d in self.team_of}
        # season track wins stacked on historical Ergast wins
        self.track_wins = {ref: dict(counts) for ref, counts in TRACK_WINS.items()}
        self.race_log = []

    def track_edge(self, driver, track):
        """Historical (and in-season) wins here → real but capped race-day pull.

        1 win ≈ +1.2, 2 ≈ +2.2, 3 ≈ +3.1, 5 ≈ +4.6, 8+ ≈ cap 5.5
        so a true circuit king is in the podium fight, not a footnote.
        """
        circuit = track.get("circuit") or ""
        n = int(self.track_wins.get(circuit, {}).get(driver, 0))
        if n <= 0:
            return 0.0, 0
        # concave: early wins matter, stacking still helps up to the cap
        raw = TRACK_WIN_EDGE * (n ** 0.85)
        # extra podium bias once they've properly owned the place
        if n >= 4:
            raw += 0.9
        if n >= 6:
            raw += 0.6
        return float(min(TRACK_WIN_CAP, raw)), n

    def home_edge(self, driver, track):
        circuit = track.get("circuit") or ""
        nat = self.drv.get(driver, {}).get("nationality", "")
        homes = HOME_CIRCUITS.get(nat, set()) or set()
        if circuit and circuit in homes:
            return HOME_RACE_EDGE, nat
        return 0.0, nat

    def base_score(self, driver, track, wet):
        team = self.team_of[driver]
        T, D, k = self.grid[team], self.drv.get(driver, {}), self.k
        w_drv = WET_DRIVER_WEIGHT if wet else DRY_DRIVER_WEIGHT
        df_fit = 3.5 * (1 - abs(T.get("style", 0.5) - track["downforce"]))
        spd = 2.5 * k * D.get("top_speed_z", 0.0) * max(0.0, 0.5 - track["downforce"])
        tyre = 1.8 * k * D.get("tyre_z", 0.0) * track["tyre_wear"]
        wet_b = 3.0 * k * D.get("consistency_z", 0.0) if wet else 0.0
        t_edge, _ = self.track_edge(driver, track)
        h_edge, _ = self.home_edge(driver, track)
        car_part = self.car_str[team] + df_fit + spd + tyre
        drv_part = self.drv_str[driver] + self.form[driver] + wet_b + t_edge + h_edge
        return (1 - w_drv) * car_part + w_drv * drv_part

    def weekend_notes(self, track, ds):
        """Minor edges called out in pre-race commentary."""
        home, specialists = [], []
        for d in ds:
            h, nat = self.home_edge(d, track)
            if h > 0:
                home.append((d, nat))
            edge, wins = self.track_edge(d, track)
            if wins >= 2:
                specialists.append((d, wins, edge))
        specialists.sort(key=lambda x: (-x[1], x[0]))
        return home, specialists[:3]

    def race_weekend(self, track):
        rng = self.rng
        ds = list(self.team_of)
        wet = rng.random() < track["wet"]
        base = {d: self.base_score(d, track, wet) for d in ds}
        cm = {d: float(np.clip(1.2 - 0.15 * self.drv.get(d, {}).get("consistency_z", 0.0), 0.70, 1.40))
              for d in ds}
        strat = {d: 1.4 - 0.65 * PRINCIPALS[self.grid[self.team_of[d]]["principal"]][0] / 100 for d in ds}
        home, specialists = self.weekend_notes(track, ds)

        # qualifying
        q_sc = {d: base[d] + rng.gauss(0, QUALI_NOISE * cm[d]) for d in ds}
        grid_order = sorted(ds, key=lambda x: -q_sc[x])
        grid_pos = {d: i + 1 for i, d in enumerate(grid_order)}

        # race-level events
        sc_event = rng.random() < 0.30 + 0.35 * track["chaos"]
        vsc_event = rng.random() < 0.20 * track["chaos"]
        sc_lap = rng.randint(5, 45) if sc_event else None
        vsc_lap = rng.randint(5, 45) if vsc_event else None

        def run_race(gp_bonus, noise0):
            scores = {}
            for d in ds:
                # full-grid start advantage (P1..P20), stronger than old top-12 only
                s = base[d] + gp_bonus * max(0, 21 - grid_pos[d])
                s += rng.gauss(0, (noise0 + 4 * track["chaos"] + (4 if wet else 0)) * cm[d] * strat[d])
                if sc_event:
                    s += rng.gauss(0, 3.0)
                if vsc_event:
                    s += rng.gauss(0, 1.5)
                if rng.random() < 0.05:
                    s -= rng.uniform(2, 6)
                scores[d] = s
            penalties = [d for d in ds if rng.random() < 0.08]
            for d in penalties:
                scores[d] -= rng.uniform(1, 4)
            dnf = []
            for d in ds:
                rel = self.grid[self.team_of[d]]["reliability"]
                p_dnf = 0.025 + 0.18 * (1 - rel / 100) + 0.05 * track["chaos"] + (0.025 if wet else 0)
                if rng.random() < p_dnf:
                    dnf.append(d)
            fin = sorted([d for d in ds if d not in dnf], key=lambda x: -scores[x])
            rng.shuffle(dnf)
            return fin, dnf, penalties

        results = {}
        if track["sprint"]:
            fin, dnf, pen = run_race(SPRINT_BONUS, SPRINT_NOISE)
            results["Sprint"] = (fin, dnf, pen)

        fin_r, dnf_r, pen_r = run_race(RACE_BONUS, RACE_NOISE)
        results["Race"] = (fin_r, dnf_r, pen_r)

        fl_driver = None
        if len(fin_r) >= 10:
            fl_driver = min(fin_r[:10], key=lambda d: rng.gauss(base[d], 0.5))

        for label, payload in results.items():
            fin, dnf, _pen = payload
            table = SPRINT_PTS if label == "Sprint" else RACE_PTS
            for i, d in enumerate(fin):
                if i < len(table):
                    self.drv_pts[d] += table[i]
                    self.team_pts[self.team_of[d]] += table[i]
                if label == "Race":
                    self.wins[d] += (i == 0)
                    self.podiums[d] += (i < 3)
        if fl_driver:
            self.drv_pts[fl_driver] += FASTEST_LAP_POINT
            self.team_pts[self.team_of[fl_driver]] += FASTEST_LAP_POINT
            self.fastest[fl_driver] += 1

        # remember this GP winner for future visits to the same circuit
        if fin_r:
            circuit = track.get("circuit") or ""
            if circuit:
                bucket = self.track_wins.setdefault(circuit, {})
                bucket[fin_r[0]] = bucket.get(fin_r[0], 0) + 1

        # between-race evolution: form, and car development with strong mean reversion
        for d in ds:
            self.form[d] = 0.65 * self.form[d] + rng.gauss(0, 1.5)
        for t, v in self.grid.items():
            dev = PRINCIPALS[v["principal"]][1]
            delta = rng.gauss((dev - 76) / 100 * 0.6 + (self.c_mean - self.car_str[t]) * 0.04, 1.2)
            self.car_str[t] = float(np.clip(self.car_str[t] + delta, 45, 99))

        log = dict(track=track, wet=wet, results=results, fl=fl_driver,
                   sc=sc_event, sc_lap=sc_lap, vsc=vsc_event, vsc_lap=vsc_lap,
                   dnfs=list(dnf_r), penalties=list(pen_r)[:3], grid_top5=grid_order[:5],
                   home=home, specialists=specialists, grid_order=grid_order)
        self.race_log.append(log)
        return log

    def ranked_drivers(self):
        return sorted(self.drv_pts, key=lambda d: (-self.drv_pts[d], -self.wins[d], -self.podiums[d]))

    def ranked_teams(self):
        return sorted(self.team_pts, key=lambda t: -self.team_pts[t])


# ═══════════════════════════════════════════════════════════════════════
# STREAMING COMMENTARY
# ═══════════════════════════════════════════════════════════════════════
def dname(drivers, code):
    d = drivers.get(code)
    if not d:
        return code
    parts = d["name"].split()
    last = parts[-1] if len(parts) > 1 else d["name"]
    return f"{last} ({code})"


def _session_payload(results, label):
    """Normalize (fin, dnf) or (fin, dnf, pen) tuples from race_weekend."""
    payload = results[label]
    if len(payload) == 2:
        fin, dnf = payload
        return fin, dnf, []
    return payload[0], payload[1], payload[2]


LOSS_COMMENTARY = [
    "Tough day for {driver} - started P{grid} but could only manage P{finish}.",
    "{driver} slides from P{grid} to P{finish}. That one will sting.",
    "A race to forget for {driver}: grid P{grid}, classified P{finish}.",
    "{driver} had the pace in quali (P{grid}) but the race got away - P{finish} at the flag.",
]
DNF_LOSS_COMMENTARY = [
    "Heartbreak for {driver} - lined up P{grid} and never saw the chequered flag.",
    "{driver} started P{grid} but retirement ends the afternoon early.",
    "All that quali work for nothing: {driver} (P{grid}) is out of the race.",
]
POLE_LOSS_COMMENTARY = [
    "Pole for {driver} doesn't convert - {winner} takes the win instead.",
    "{driver} locked out front row, but couldn't seal Sunday. Victory goes to {winner}.",
]
USER_LOSS_COMMENTARY = [
    "Not the result your garage wanted for {driver}.",
    "{driver} leaves empty-handed today - back to the drawing board.",
    "A bruising afternoon for {driver} in your colours.",
]


def commentary_race(s, log, race_num, total, user_ds, st):
    track, wet, results = log["track"], log["wet"], log["results"]
    fin_r, dnf_r, _pen_r = _session_payload(results, "Race")
    drivers, rng = s.drv, s.rng
    YOU = col("  <- YOU", YEL + BOLD)
    grid_order = log.get("grid_order") or log.get("grid_top5") or []
    grid_pos = {d: i + 1 for i, d in enumerate(grid_order)}

    st.begin_race()

    flags = []
    if track["sprint"]:
        flags.append(col("SPRINT WEEKEND", YEL + BOLD))
    if wet:
        flags.append(col("WET RACE", BLU + BOLD))
    flag_str = "  " + "  ".join(flags) if flags else ""
    rnd = col(f"R{race_num:02d}/{total}", GREY)
    st.line("\n" + "=" * 62, colour=CYN)
    st.line(f"  {rnd}  {col(track['name'].upper(), WHT + BOLD)}{flag_str}")
    st.line("=" * 62, colour=CYN)

    flavour = TRACK_FLAVOUR.get(track["name"], "")
    if flavour:
        st.stream_text(f"  > {flavour}", char_delay=0.012, colour=GREY)
    st.race_pause(1)

    # Pre-race briefing: home confidence + track specialists (minor edges)
    home = log.get("home") or []
    specialists = log.get("specialists") or []
    if home or specialists:
        st.subhead("WEEKEND NOTES", GREY)
        for d, nat in home:
            you = YOU if d in user_ds else ""
            st.stream_text(
                f"  Home race boost for {dname(drivers, d)} - extra confidence on home soil ({nat}).{you}",
                char_delay=0.010, colour=CYN)
            st.race_pause()
        for d, wins, _edge in specialists:
            you = YOU if d in user_ds else ""
            if wins >= 5:
                line = (f"  Circuit king: {dname(drivers, d)} has {wins} wins here - "
                        f"expect a strong podium push on Sunday.{you}")
            elif wins >= 3:
                line = (f"  Track specialist: {dname(drivers, d)} has {wins} wins here - "
                        f"a real edge toward the front.{you}")
            else:
                line = (f"  Track specialist: {dname(drivers, d)} has {wins} wins here - "
                        f"a small edge on race day.{you}")
            st.stream_text(line, char_delay=0.010, colour=CYN)
            st.race_pause()
        st.race_pause(1)

    st.subhead("QUALIFYING - TOP 5 ON THE GRID", CYN)
    for i, d in enumerate(log["grid_top5"]):
        you = YOU if d in user_ds else ""
        st.line(f"  P{i + 1}  {dname(drivers, d):28}{you}", delay=0.08)
    st.race_pause(1)

    # Grid → race edge called out before the race starts
    pole = log["grid_top5"][0] if log.get("grid_top5") else None
    if pole:
        front = ", ".join(dname(drivers, d) for d in log["grid_top5"][:3])
        st.stream_text(
            f"  Grid edge: {front} start up front - clean air and track position carry into the race.",
            char_delay=0.010, colour=GREY)
        st.race_pause(1)

    if "Sprint" in results:
        fin_s, dnf_s, _pen_s = _session_payload(results, "Sprint")
        st.subhead("SPRINT RACE RESULT", MAG)
        for i, d in enumerate(fin_s[:8]):
            pts = SPRINT_PTS[i]
            you = YOU if d in user_ds else ""
            st.line(f"  P{i + 1}  {dname(drivers, d):28} {col(f'+{pts}pts', GRN)}{you}", delay=0.07)
        if dnf_s:
            st.line("  " + col("DNF: " + ", ".join(dname(drivers, d) for d in dnf_s), RED), delay=0.05)
        st.race_pause(1)

    st.subhead("RACE INCIDENTS", YEL)
    had_incident = False
    if log["sc"] and log["sc_lap"]:
        st.stream_text(f"  SC  LAP {log['sc_lap']}: {rng.choice(INCIDENT_COMMENTARY)}",
                       char_delay=0.015, colour=YEL)
        st.race_pause(1)
        had_incident = True
    if log["vsc"] and log["vsc_lap"] and log["vsc_lap"] != log["sc_lap"]:
        st.stream_text(f"  VSC LAP {log['vsc_lap']}: Virtual safety car - marshals clearing an incident.",
                       char_delay=0.013, colour=YEL)
        st.race_pause()
        had_incident = True
    for d in log["penalties"]:
        if d not in dnf_r:
            msg = rng.choice(PENALTY_COMMENTARY).format(driver=dname(drivers, d))
            st.stream_text(f"  !   {msg}", char_delay=0.012, colour=MAG)
            st.race_pause()
            had_incident = True
    for d in log["dnfs"][:3]:
        msg = rng.choice(DNF_COMMENTARY).format(driver=dname(drivers, d), team=s.team_of.get(d, "Unknown"))
        st.stream_text(f"  X   {msg}", char_delay=0.012, colour=RED)
        st.race_pause()
        had_incident = True
    if not had_incident:
        st.line("  " + col("A clean race - no major incidents to report.", GREY), delay=0.1)

    # mid-race snapshot: finishing order with a few swaps so it isn't a spoiler
    st.subhead("LAP 30 - RACE SNAPSHOT")
    order = list(fin_r[:10])
    for _ in range(3):
        if len(order) > 1:
            i = rng.randrange(len(order) - 1)
            order[i], order[i + 1] = order[i + 1], order[i]
    gap = 0.0
    for i, d in enumerate(order, 1):
        you = col("  <- YOU", YEL + BOLD) if d in user_ds else ""
        if i == 1:
            gtxt, gcol = "LEADER", GRN
        else:
            gap += rng.uniform(0.4, 3.0)
            gtxt, gcol = f"+{gap:.3f}s", (GREY if i > 5 else R)
        st.line(f"  P{i:2}  {dname(drivers, d):28} {col(gtxt, gcol)}{you}", delay=0.06)
    st.race_pause(1)

    st.subhead("CHEQUERED FLAG", GRN)
    winner = fin_r[0]
    win_msg = rng.choice(WIN_COMMENTARY).format(driver=dname(drivers, winner),
                                                team=s.team_of.get(winner, "Unknown"))
    st.stream_text(f"  WIN {win_msg}", char_delay=0.015, colour=GRN + BOLD)
    st.race_pause(1)

    for i, d in enumerate(fin_r[:10]):
        pts = RACE_PTS[i]
        fl_mark = col("  FL", YEL) if d == log["fl"] else ""
        you = YOU if d in user_ds else ""
        pcolor = GRN if i == 0 else (YEL if i < 3 else R)
        st.line(f"  {col(f'P{i + 1:2}', pcolor)}  {dname(drivers, d):28} {col(f'+{pts}pts', GRN)}{fl_mark}{you}",
                delay=0.06)
    if dnf_r:
        st.line("\n  " + col("DNF: " + "  ".join(dname(drivers, d) for d in dnf_r), RED), delay=0.05)

    st.line("\n  " + col("> YOUR TEAM THIS RACE:", BOLD + CYN))
    def _user_sort_key(d):
        if d in fin_r:
            return (0, fin_r.index(d))
        return (1, 99)
    for d in sorted(user_ds, key=_user_sort_key):
        if d in fin_r:
            pos = fin_r.index(d) + 1
            pts = RACE_PTS[pos - 1] if pos <= len(RACE_PTS) else 0
            fl = "  FL" if d == log["fl"] else ""
            pc = GRN if pts > 10 else (YEL if pts > 0 else GREY)
            st.line(f"    {col(f'P{pos:<2}', pc)}  {dname(drivers, d):28} {col(f'+{pts}pts', pc)}{col(fl, YEL)}",
                    delay=0.05)
        else:
            st.line(f"    {col('DNF', RED)}  {dname(drivers, d)}", delay=0.05)

    # Post-race disappointment / dropped-places commentary
    finish_pos = {d: i + 1 for i, d in enumerate(fin_r)}
    reactions = []
    pole = grid_order[0] if grid_order else None
    winner = fin_r[0] if fin_r else None
    if pole and winner and pole != winner and grid_pos.get(pole, 99) == 1:
        reactions.append((
            rng.choice(POLE_LOSS_COMMENTARY).format(
                driver=dname(drivers, pole), winner=dname(drivers, winner)),
            YEL, pole in user_ds,
        ))

    # Prefer user drivers, then big drops from the top of the grid
    candidates = []
    for d in list(user_ds) + list(grid_order[:8]):
        if d in candidates:
            continue
        g = grid_pos.get(d)
        if g is None:
            continue
        if d in dnf_r and g <= 10:
            candidates.append(d)
        elif d in finish_pos:
            drop = finish_pos[d] - g
            if drop >= 5 or (g <= 5 and finish_pos[d] > 10):
                candidates.append(d)

    seen = {pole} if pole and pole != winner else set()
    for d in candidates:
        if d in seen:
            continue
        seen.add(d)
        g = grid_pos[d]
        if d in dnf_r:
            msg = rng.choice(DNF_LOSS_COMMENTARY).format(driver=dname(drivers, d), grid=g)
        else:
            msg = rng.choice(LOSS_COMMENTARY).format(
                driver=dname(drivers, d), grid=g, finish=finish_pos[d])
        if d in user_ds:
            msg = msg + " " + rng.choice(USER_LOSS_COMMENTARY).format(driver=dname(drivers, d))
        reactions.append((msg, RED if d in user_ds or d in dnf_r else GREY, d in user_ds))
        if len(reactions) >= 3:
            break

    if reactions:
        st.subhead("RACE REACTION", MAG)
        for msg, colour, _ in reactions:
            st.stream_text(f"  > {msg}", char_delay=0.011, colour=colour)
            st.race_pause()

    ranked = s.ranked_drivers()
    leader = ranked[0]
    second = ranked[1] if len(ranked) > 1 else leader
    gap_pts = s.drv_pts[leader] - s.drv_pts[second]
    msg = rng.choice(CHAMPIONSHIP_UPDATE).format(leader=dname(drivers, leader), chaser=dname(drivers, second),
                                                gap=gap_pts, n=total - race_num)
    st.race_pause(1)
    st.line("\n  " + col("-- CHAMPIONSHIP --", GREY))
    st.stream_text(f"  {msg}", char_delay=0.013, colour=CYN)
    for d in user_ds:
        pos = ranked.index(d) + 1
        pc = GRN if pos <= 3 else (YEL if pos <= 10 else GREY)
        st.line("  " + col(f"  {dname(drivers, d)}: P{pos} WDC  ({s.drv_pts[d]} pts)", pc), delay=0.04)

    st.wait_race_budget()


def print_mini_standings(s, user_ds, st, top_n=8):
    st.line("\n" + "=" * 62, colour=BLU)
    st.line(col("  STANDINGS AFTER THIS STINT", BOLD + BLU))
    st.line("-" * 62, colour=BLU)
    for i, d in enumerate(s.ranked_drivers()[:top_n], 1):
        you = col("  <- YOU", YEL + BOLD) if d in user_ds else ""
        pts = col(f"{s.drv_pts[d]} pts", WHT)
        st.line(f"  {str(i).rjust(2)}.  {dname(s.drv, d):28} {pts}  {s.wins[d]}W{you}", delay=0.04)
    st.line("\n  " + col("CONSTRUCTORS", GREY))
    for i, t in enumerate(s.ranked_teams()[:5], 1):
        you = col("  <- YOU", YEL + BOLD) if t == USER_TEAM else ""
        st.line(f"  {str(i).rjust(2)}.  {t:20} {col(str(s.team_pts[t]) + ' pts', WHT)}{you}", delay=0.03)


def print_final(s, user_ds, drivers, st):
    title = f"FINAL STANDINGS - {SEASON_YEAR} WORLD CHAMPIONSHIP"
    st.line("\n\n+" + "=" * 60 + "+", colour=YEL)
    st.line(col("|" + title.center(60) + "|", YEL + BOLD))
    st.line("+" + "=" * 60 + "+", colour=YEL)

    st.line(col("\n  DRIVERS' CHAMPIONSHIP", BOLD + WHT))
    st.line("-" * 62, colour=GREY)
    ranked = s.ranked_drivers()
    for i, d in enumerate(ranked):
        you = col("  <- YOU", YEL + BOLD) if d in user_ds else ""
        pc = GRN if i == 0 else (YEL if i < 3 else (R if i < 10 else GREY))
        name = col(f"{dname(drivers, d):28}", pc)
        pts = col(str(s.drv_pts[d]).rjust(4) + " pts", pc)
        st.line(f"  {i + 1:2}.  {name} {pts}  {s.wins[d]}W {s.podiums[d]}Pod{you}", delay=0.03)

    st.line(col("\n  CONSTRUCTORS' CHAMPIONSHIP", BOLD + WHT))
    st.line("-" * 62, colour=GREY)
    for i, t in enumerate(s.ranked_teams(), 1):
        you = col("  <- YOU", YEL + BOLD) if t == USER_TEAM else ""
        pc = GRN if i == 1 else (YEL if i <= 3 else R)
        st.line(f"  {i:2}.  {col(f'{t:20}', pc)}  {col(str(s.team_pts[t]) + ' pts', pc)}{you}", delay=0.03)

    champ, wcc = ranked[0], s.ranked_teams()[0]
    st.line("\n" + "=" * 62, colour=YEL)
    st.stream_text(f"  WDC: {drivers[champ]['name']} ({s.team_of[champ]}) - {s.drv_pts[champ]} pts",
                   colour=YEL + BOLD)
    st.stream_text(f"  WCC: {wcc} - {s.team_pts[wcc]} pts", colour=YEL + BOLD)

    best_pos = min(ranked.index(d) + 1 for d in user_ds if d in ranked)
    your_pos = s.ranked_teams().index(USER_TEAM) + 1
    st.line(f"\n  Your best driver: P{best_pos}  |  {USER_TEAM}: P{your_pos} constructors'", colour=CYN)
    if best_pos == 1:
        st.stream_text(f"  CONGRATULATIONS - YOUR DRIVER IS THE {SEASON_YEAR} WORLD CHAMPION!", colour=GRN + BOLD)
    elif best_pos <= 3:
        st.line(col("  Podium finish - excellent draft!", GRN))
    elif best_pos <= 10:
        st.line(col("  Points every race. Solid season.", YEL))
    else:
        st.line(col("  Tough season. Better luck next year.", GREY))


# ═══════════════════════════════════════════════════════════════════════
# MONTE CARLO
# ═══════════════════════════════════════════════════════════════════════
def monte_carlo(n, grid, drivers, rng, user_ds, st, parity=DEFAULT_PARITY):
    champs, team_champs = {}, {}
    user_wcc, pts_log = 0, []
    print(f"\n  Running {n} simulated seasons", end="", flush=True)
    for i in range(n):
        if i % 50 == 0:
            print(".", end="", flush=True)
        s = Season(copy.deepcopy(grid), drivers, rng, parity)
        for track in CALENDAR:
            s.race_weekend(track)
        c = s.ranked_drivers()[0]
        champs[c] = champs.get(c, 0) + 1
        w = s.ranked_teams()[0]
        team_champs[w] = team_champs.get(w, 0) + 1
        user_wcc += (w == USER_TEAM)
        pts_log.append(sum(s.drv_pts[d] for d in user_ds if d in s.drv_pts))
    print(" done.")

    st.banner("DRIVER TITLE ODDS", colour=YEL)
    for d, cnt in sorted(champs.items(), key=lambda x: -x[1])[:10]:
        you = col("  <- YOU", YEL + BOLD) if d in user_ds else ""
        pct = 100 * cnt / n
        pc = GRN if pct > 20 else (YEL if pct > 10 else GREY)
        bar = "#" * int(cnt / n * 40)
        st.line(f"  {d:6} {drivers[d]['name']:24} {col(f'{pct:5.1f}%', pc)} {col(bar, pc)}{you}")
    st.line("\n  " + col("CONSTRUCTOR TITLE ODDS", BOLD))
    for t, cnt in sorted(team_champs.items(), key=lambda x: -x[1])[:6]:
        you = col("  <- YOU", YEL + BOLD) if t == USER_TEAM else ""
        st.line(f"  {t:20} {100 * cnt / n:5.1f}%{you}")
    st.line(f"\n  Your team WCC odds:       {col(f'{100 * user_wcc / n:.1f}%', CYN)}")
    st.line(f"  Avg pts (your 2 drivers): {col(str(round(float(np.mean(pts_log)))), CYN)}  "
            f"(best {max(pts_log)}, worst {min(pts_log)})")


# ═══════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════
def do_summer_break(season, user_ds, grid, rng, st, auto):
    print("\n" + "=" * 62)
    print(col("  SUMMER BREAK - TEAM DECISIONS", BOLD + YEL))
    print("-" * 62)
    
    # Identify user's best and worst driver based on current WDC points
    u_sorted = sorted(user_ds, key=lambda d: (-season.drv_pts[d], -season.wins[d], -season.podiums[d]))
    best_d = u_sorted[0]
    worst_d = u_sorted[-1]
    
    best_name = dname(season.drv, best_d)
    worst_name = dname(season.drv, worst_d)
    
    ranked = season.ranked_drivers()
    best_pos = ranked.index(best_d) + 1
    worst_pos = ranked.index(worst_d) + 1
    
    print(f"  Your Team Status:")
    print(col(f"    Best Driver:  {best_name:20} (P{best_pos} WDC - {season.drv_pts[best_d]} pts)", GRN))
    print(col(f"    Worst Driver: {worst_name:20} (P{worst_pos} WDC - {season.drv_pts[worst_d]} pts)", RED))
    
    print("\n  Options:")
    print(f"  {col('1.', WHT)} Continue with existing team (No changes)")
    print(f"  {col('2.', WHT)} Make a change (Take a risk)")
    
    if auto:
        print(col("\n  Auto-simulating... continuing with no changes.", GREY))
        return
        
    while True:
        try:
            choice = ask_int(col("  Select option (1-2): ", CYN), 1, 2)
            break
        except Exception:
            pass
            
    if choice == 1:
        print(col("  You chose to continue with no changes.", GREY))
        return
        
    print("\n" + "-" * 62)
    print(col("  SELECT CHANGE TYPE", BOLD + CYN))
    print(f"  {col('1.', WHT)} {col('Driver Focus', GRN)}: Spin wheel to transfer 1-7 OVR from {worst_name} to {best_name}")
    print(f"  {col('2.', WHT)} {col('Car Focus', YEL)}: Sacrifice 10-100 WDC pts from {worst_name} for Car OVR (10 pts = +1 OVR)")
    print(f"  {col('3.', WHT)} {col('Take The Risk', RED)}: Spin against the grid. Beat them = huge gain, lose = huge loss.")
    
    change_choice = ask_int(col("  Select change (1-3): ", CYN), 1, 3)
    
    if change_choice == 1:
        # Wheel 1 to 5, rare 6-7
        n = rng.choices([1,2,3,4,5,6,7], weights=[18,18,18,18,18,7,3])[0]
        season.drv_str[worst_d] -= n
        season.drv[worst_d]["rating"] -= n
        season.drv_str[best_d] += n
        season.drv[best_d]["rating"] += n
        print(col(f"\n  [DRIVER FOCUS] The wheel landed on {n}!", GRN + BOLD))
        print(col(f"  {worst_name} loses -{n} OVR.", RED))
        print(col(f"  {best_name} gains +{n} OVR.", GRN))
        
    elif change_choice == 2:
        # Car focus
        pts_to_take = rng.choice([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
        available = season.drv_pts[worst_d]
        actual_taken = min(pts_to_take, available)
        
        car_gain = pts_to_take // 10
        
        # Apply to car rating
        season.car_str[USER_TEAM] += car_gain
        grid[USER_TEAM]["car"] += car_gain
        
        # Deduct points
        season.drv_pts[worst_d] -= actual_taken
        season.team_pts[USER_TEAM] -= actual_taken
        
        print(col(f"\n  [CAR FOCUS] The wheel landed on {pts_to_take} points.", YEL + BOLD))
        if actual_taken > 0:
            print(col(f"  Sacrificed {actual_taken} WDC points from {worst_name}.", RED))
        else:
            print(col(f"  {worst_name} had 0 points, so none were lost!", GRN))
        print(col(f"  Car upgraded by +{car_gain} OVR.", GRN))
        
    elif change_choice == 3:
        # The Risk
        others = [d for d in ranked if d != best_d]
        if not others:
            print(col("\n  [THE RISK] Your best driver is the only one on track?!", RED))
            return
            
        target_d = rng.choice(others)
        target_pos = ranked.index(target_d) + 1
        target_name = dname(season.drv, target_d)
        
        print(col(f"\n  [THE RISK] The wheel landed on {target_name} (P{target_pos} WDC)...", YEL + BOLD))
        st.race_pause(1.5)
        
        if target_pos < best_pos:
            gain = max(1, 11 - target_pos)
            season.drv_str[best_d] += gain
            season.drv[best_d]["rating"] += gain
            print(col(f"  SUCCESS! They are ABOVE your best driver in the standings.", GRN))
            print(col(f"  {best_name} gains +{gain} OVR!", GRN + BOLD))
        else:
            loss = target_pos - best_pos
            if loss <= 0: loss = 1
            season.drv_str[best_d] -= loss
            season.drv[best_d]["rating"] -= loss
            print(col(f"  FAILED! They are BELOW your best driver.", RED))
            print(col(f"  {best_name} loses -{loss} OVR.", RED + BOLD))

    print("=" * 62 + "\n")
    if not auto:
        input(col("  Press Enter to continue the season... ", GREY))

def main():
    ap = argparse.ArgumentParser(description="F1 Draft Season - Streaming Commentary")
    ap.add_argument("--ratings", default="driver_ratings.json")
    ap.add_argument("--ml-weight", type=float, default=DEFAULT_ML_WEIGHT)
    ap.add_argument("--parity", type=float, default=DEFAULT_PARITY,
                    help="0-0.9: compress driver/car gaps so no one dominates (0 = raw ratings)")
    ap.add_argument("--mode", choices=["draft", "manual"], default="draft")
    ap.add_argument("--auto", action="store_true")
    ap.add_argument("--fast", action="store_true", help="No delays - instant output")
    ap.add_argument("--race-delay", type=float, default=3.0, help="Minimum seconds per race")
    ap.add_argument("--montecarlo", type=int, default=0)
    ap.add_argument("--era", choices=["current", "legends", "mixed"], default="mixed",
                    help="Driver pool: current grid, era cards, or all")
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args()

    rng = random.Random(a.seed)
    st = Streamer(fast=a.fast or a.auto, race_delay=a.race_delay)
    drivers, teams = load_ratings(a.ratings, a.ml_weight)

    print("\n+" + "=" * 60 + "+", flush=True)
    print(col("|" + f"F1 DRAFT SEASON {SEASON_YEAR}".center(60) + "|", YEL + BOLD))
    print(col("|" + "Balanced Edition - Streaming Commentary".center(60) + "|", CYN))
    print("+" + "=" * 60 + "+", flush=True)

    if not a.auto:
        era_label = {"current": "Current Grid", "legends": "Era Legends", "mixed": "All Cards"}
        print(col(f"\n  Mode: {a.mode.upper()}  |  Driver pool: {era_label[a.era]}  |  Parity: {a.parity:.2f}", GREY))
        print(col("  Select: 2 Drivers - 1 Constructor - 1 Team Principal\n", GREY))

    user_ds, car_key, principal = build_user_team(drivers, teams, rng, a.mode, a.auto, a.era)
    grid = build_grid(teams, user_ds, car_key, principal, rng)

    print("\n" + "=" * 62)
    print(col("  YOUR TEAM", BOLD + CYN))
    print("-" * 62)
    for d in user_ds:
        r = drivers[d]["rating"]
        print(f"  D  {colorize_rarity(drivers[d]['name'], r):45}  {col(f'ovr {r:.0f}', WHT)}")
        if drivers[d].get("era_blurb"):
            print("     " + col(drivers[d]["era_blurb"][:60], DIM))
    user_car = grid[USER_TEAM]["car"]
    print(f"  C  {car_key:22} {col(f'car {user_car:.0f}', WHT)}")
    print(f"  P  {principal}")
    print("\n  FULL GRID")
    print("-" * 62)
    for t, v in sorted(grid.items(), key=lambda kv: -kv[1]["car"]):
        you = col("  <- YOU", YEL + BOLD) if t == USER_TEAM else ""
        car_txt = col(f"car {v['car']:.0f}", WHT)
        print(f"  {t:17} {car_txt}  [{col(', '.join(v['drivers']), GREY)}]{you}")
    print("=" * 62)

    if a.montecarlo:
        monte_carlo(a.montecarlo, grid, drivers, rng, user_ds, st, a.parity)
        return

    if not a.auto and not a.fast:
        input(col(f"\n  Press Enter to start the {SEASON_YEAR} season... ", CYN))

    season = Season(grid, drivers, rng, a.parity)
    total = len(CALENDAR)
    skip = a.auto or a.fast

    for race_num, track in enumerate(CALENDAR, 1):
        log = season.race_weekend(track)
        commentary_race(season, log, race_num, total, user_ds, st)

        if race_num % 6 == 0 and race_num < total:
            print_mini_standings(season, user_ds, st)
            
        if race_num == total // 2:
            do_summer_break(season, user_ds, grid, rng, st, skip)

        if not skip and race_num < total:
            try:
                cmd = input(col("\n  <enter> next race  |  [s] sim rest  |  [c] standings: ", GREY)).strip().lower()
                if cmd == "s":
                    skip = True
                    st = Streamer(fast=True)
                elif cmd == "c":
                    print_mini_standings(season, user_ds, st)
            except EOFError:
                skip = True
                st = Streamer(fast=True)

    print_final(season, user_ds, drivers, st)


if __name__ == "__main__":
    main()