from pathlib import Path

import pandas as pd


DATA_DIR = Path(__file__).resolve().parent / "datasets"


def _read(filename, columns=None):
    path = DATA_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Required dataset file not found: {path}")
    return pd.read_csv(path, usecols=columns)


races = _read("races.csv", ["raceId", "year", "round", "name", "circuitId"])
season_year = int(races["year"].max())
SEASON_YEAR = season_year
season_races = races[races["year"].eq(season_year)].sort_values(["round", "raceId"])

results = _read("results.csv", ["raceId", "driverId", "constructorId", "points", "positionOrder"])
season_results = results.merge(races[["raceId", "year", "round"]], on="raceId")
season_results = season_results[season_results["year"].eq(season_year)]
latest_round = int(season_results["round"].max())
latest_results = season_results[season_results["round"].eq(latest_round)]
latest_race_id = int(latest_results["raceId"].iloc[0])

source_drivers = _read("drivers.csv", ["driverId", "code", "forename", "surname", "nationality"])
source_constructors = _read("constructors.csv", ["constructorId", "name"])
standings = _read("driver_standings.csv", ["raceId", "driverId", "points"])
standings = standings.merge(races[["raceId", "year", "round"]], on="raceId")
standings = standings[
    standings["year"].eq(season_year) & standings["round"].eq(latest_round)
].drop_duplicates("driverId", keep="last")
max_driver_points = max(float(standings["points"].max()), 1.0)
driver_points = standings.set_index("driverId")["points"].to_dict()

latest_grid = latest_results[["driverId", "constructorId"]].drop_duplicates("driverId")
latest_grid = latest_grid.merge(source_drivers, on="driverId")
latest_grid = latest_grid.merge(source_constructors, on="constructorId")
DRIVERS = {}
DRIVER_NATIONALITY = {}
for row in latest_grid.itertuples():
    code = str(row.code).strip().upper()
    if not code or code == "NAN":
        continue
    name = f"{row.forename} {row.surname}".strip()
    if "\ufffd" in name:
        name = code
    points = float(driver_points.get(row.driverId, 0.0))
    rating = 66.0 + 28.0 * (points / max_driver_points) ** 0.5
    DRIVERS[code] = (name, rating)
    DRIVER_NATIONALITY[code] = str(getattr(row, "nationality", "") or "")

constructor_standings = _read("constructor_standings.csv", ["raceId", "constructorId", "points"])
constructor_standings = constructor_standings.merge(
    races[["raceId", "year", "round"]], on="raceId"
)
constructor_standings = constructor_standings[
    constructor_standings["year"].eq(season_year)
    & constructor_standings["round"].eq(latest_round)
].drop_duplicates("constructorId", keep="last")
constructor_points = constructor_standings.set_index("constructorId")["points"].to_dict()
max_constructor_points = max(float(constructor_standings["points"].max()), 1.0)
constructor_reliability = (
    season_results.assign(classified=season_results["positionOrder"].gt(0))
    .groupby("constructorId")["classified"]
    .mean()
    .to_dict()
)
team_drivers = latest_grid.groupby("constructorId").apply(
    lambda rows: sorted(str(code).strip().upper() for code in rows["code"]),
    include_groups=False,
).to_dict()
TEAMS = {}
for row in latest_grid[["constructorId", "name"]].drop_duplicates().itertuples():
    points = max(float(constructor_points.get(row.constructorId, 0.0)), 0.0)
    car = 62.0 + 33.0 * (points / max_constructor_points) ** 0.5
    reliability = 75.0 + 25.0 * constructor_reliability.get(row.constructorId, 0.8)
    TEAMS[row.name] = {
        "drivers": team_drivers[row.constructorId],
        "car": car,
        "reliability": reliability,
        "style": 0.5,
    }

circuit_rows = _read("circuits.csv", ["circuitId", "circuitRef", "country"])
circuit_refs = circuit_rows.set_index("circuitId")["circuitRef"].to_dict()
sprint_rows = _read("sprint_results.csv", ["raceId"])
sprint_race_ids = set(
    sprint_rows.merge(races[["raceId", "year"]], on="raceId")
    .loc[lambda frame: frame["year"].eq(season_year), "raceId"]
)

# Historical wins at each circuit (hybrid era onward) -> small specialist edge in the sim
_win_rows = results.loc[results["positionOrder"].eq(1), ["raceId", "driverId"]]
_win_rows = _win_rows.merge(races[["raceId", "year", "circuitId"]], on="raceId")
_win_rows = _win_rows[_win_rows["year"].ge(2014)]
_win_rows = _win_rows.merge(source_drivers[["driverId", "code"]], on="driverId")
_win_rows["code"] = _win_rows["code"].astype(str).str.strip().str.upper()
TRACK_WINS = {}
for circuit_id, group in _win_rows.groupby("circuitId"):
    ref = circuit_refs.get(int(circuit_id))
    if not ref:
        continue
    counts = group["code"].value_counts().to_dict()
    TRACK_WINS[ref] = {str(code): int(n) for code, n in counts.items() if code and code != "NAN"}

# Nationality -> home circuitRefs (minor confidence boost only)
HOME_CIRCUITS = {
    "British": {"silverstone"},
    "Dutch": {"zandvoort"},
    "Monegasque": {"monaco"},
    "Italian": {"monza", "imola"},
    "Spanish": {"catalunya", "valencia", "jerez"},
    "Mexican": {"rodriguez"},
    "Brazilian": {"interlagos"},
    "Australian": {"albert_park"},
    "Japanese": {"suzuka"},
    "Canadian": {"villeneuve"},
    "American": {"miami", "vegas", "americas"},
    "Austrian": {"red_bull_ring"},
    "Belgian": {"spa"},
    "French": {"paul_ricard", "magny_cours"},
    "German": {"nurburgring", "hockenheimring"},
    "Chinese": {"shanghai"},
    "Hungarian": {"hungaroring"},
    "Thai": set(),
    "Danish": set(),
    "Finnish": set(),
    "New Zealander": set(),
    "Argentine": set(),
}

high_downforce = {"monaco", "hungaroring", "zandvoort", "marina_bay"}
low_downforce = {"monza", "baku", "vegas", "spa", "jeddah"}
high_wear = {"bahrain", "catalunya", "silverstone", "suzuka"}
low_wear = {"monaco", "baku", "vegas", "marina_bay"}
CALENDAR = []
for race in season_races.itertuples():
    circuit = circuit_refs.get(race.circuitId, "")
    downforce = 0.9 if circuit in high_downforce else 0.1 if circuit in low_downforce else 0.5
    tyre_wear = 0.85 if circuit in high_wear else 0.35 if circuit in low_wear else 0.6
    # Ergast sometimes appends venue notes ("Bahrain Grand Prix in Malaysia")
    name = str(race.name).split(" in ")[0].strip()
    CALENDAR.append({
        "name": name,
        "circuit": circuit,
        "downforce": downforce,
        "wet": 0.12,
        "tyre_wear": tyre_wear,
        "chaos": 0.25,
        "sprint": race.raceId in sprint_race_ids,
    })

PRINCIPALS = {
    "Andrea Stella": (88, 82),
    "Toto Wolff": (90, 84),
    "Fred Vasseur": (82, 80),
    "Christian Horner": (87, 79),
    "James Vowles": (80, 86),
    "Mike Krack": (77, 78),
    "Ayao Komatsu": (78, 81),
    "Alessandro Alunni Bravi": (76, 80),
    "Graeme Lowdon": (75, 83),
    "Flavio Briatore": (79, 77),
    "Guenther Steiner": (74, 74),
}

# Compatibility data used by the enhanced simulator UI.
DRIVERS_2026 = DRIVERS
# ── All-driver name/nationality lookup (for historical draft cards) ──
ALL_DRIVER_NAMES = {}
ALL_DRIVER_NATIONALITY = {}
for _row in source_drivers.itertuples():
    _c = str(_row.code).strip().upper()
    if _c and _c != "NAN":
        _n = f"{_row.forename} {_row.surname}".strip()
        if "\ufffd" in _n:
            _n = _c
        ALL_DRIVER_NAMES[_c] = _n
        ALL_DRIVER_NATIONALITY[_c] = str(getattr(_row, "nationality", "") or "")

# ── Per-year driver & team ratings (for the versioned draft system) ──
DRIVER_YEAR_RATINGS = {}   # {code: {year: overall_rating}}
DRIVER_YEAR_TEAMS = {}     # {code: {year: team_name}}
TEAM_YEAR_RATINGS = {}     # {team_name: {year: car_rating}}

try:
    _all_st = _read("driver_standings.csv", ["raceId", "driverId", "points"])
    _all_st = _all_st.merge(races[["raceId", "year", "round"]], on="raceId")

    # Videogame ratings: use latest file per year for blending
    _vg_files = {
        2020: "f1_2020_videogame_driver_ratings_jan2021.csv",
        2021: "f1_2021_videogame_driver_ratings_jan2022.csv",
        2022: "f1_22_videogame_driver_ratings_initial.csv",
        2023: "F1_23_videogame_driver_ratings_dec2023.csv",
    }
    _vg = {}
    for _yr, _fn in _vg_files.items():
        _p = DATA_DIR / _fn
        if _p.exists():
            _vdf = pd.read_csv(_p)
            _rc = "RTG" if "RTG" in _vdf.columns else "Rating"
            _vg[_yr] = {}
            for _, _r in _vdf.iterrows():
                _vg[_yr][str(_r["Driver"]).strip()] = float(_r[_rc])

    _all_cst = _read("constructor_standings.csv", ["raceId", "constructorId", "points"])
    _all_cst = _all_cst.merge(races[["raceId", "year", "round"]], on="raceId")

    for _yr in range(2018, season_year + 1):
        _yr_races = races[races["year"].eq(_yr)]
        if _yr_races.empty:
            continue
        _max_rnd = int(_yr_races["round"].max())

        # ── Driver ratings for this year ──
        _yr_st = _all_st[
            _all_st["year"].eq(_yr) & _all_st["round"].eq(_max_rnd)
        ].drop_duplicates("driverId", keep="last")
        if not _yr_st.empty:
            _max_pts = max(float(_yr_st["points"].max()), 1.0)
            _yr_res = results[results["raceId"].isin(_yr_races["raceId"])]
            _yr_lat = _yr_res.sort_values("raceId").drop_duplicates("driverId", keep="last")
            _yr_tmap = (
                _yr_lat[["driverId", "constructorId"]]
                .merge(source_constructors, on="constructorId")
                .set_index("driverId")["name"].to_dict()
            )
            _yr_vg = _vg.get(_yr, {})
            for _, _row in _yr_st.iterrows():
                _did = int(_row["driverId"])
                _dr = source_drivers[source_drivers["driverId"].eq(_did)]
                if _dr.empty:
                    continue
                _dr = _dr.iloc[0]
                _code = str(_dr["code"]).strip().upper()
                if not _code or _code == "NAN":
                    continue
                _pts = float(_row["points"])
                _rating = 66.0 + 28.0 * (_pts / _max_pts) ** 0.5
                _sn = str(_dr["surname"]).strip()
                for _vn, _vr in _yr_vg.items():
                    if _sn in _vn:
                        _rating = 0.35 * _rating + 0.65 * _vr
                        break
                DRIVER_YEAR_RATINGS.setdefault(_code, {})[_yr] = round(float(_rating), 1)
                DRIVER_YEAR_TEAMS.setdefault(_code, {})[_yr] = str(_yr_tmap.get(_did, "Unknown"))

        # ── Constructor/car ratings for this year ──
        _yr_cst = _all_cst[
            _all_cst["year"].eq(_yr) & _all_cst["round"].eq(_max_rnd)
        ].drop_duplicates("constructorId", keep="last")
        if not _yr_cst.empty:
            _max_cpts = max(float(_yr_cst["points"].max()), 1.0)
            for _, _row in _yr_cst.iterrows():
                _cid = int(_row["constructorId"])
                _cr = source_constructors[source_constructors["constructorId"].eq(_cid)]
                if _cr.empty:
                    continue
                _tname = str(_cr.iloc[0]["name"])
                _cpts = float(_row["points"])
                _car = 62.0 + 33.0 * (_cpts / _max_cpts) ** 0.5
                TEAM_YEAR_RATINGS.setdefault(_tname, {})[_yr] = round(float(_car), 1)

except Exception:
    DRIVER_YEAR_RATINGS = DRIVER_YEAR_RATINGS or {}
    DRIVER_YEAR_TEAMS = DRIVER_YEAR_TEAMS or {}
    TEAM_YEAR_RATINGS = TEAM_YEAR_RATINGS or {}

ERA_DRIVERS = {}
TRACK_FLAVOUR = {}
INCIDENT_COMMENTARY = ["The safety car bunches up the field."]
PENALTY_COMMENTARY = ["{driver} receives a time penalty."]
DNF_COMMENTARY = ["{driver} retires from the {team}."]
WIN_COMMENTARY = ["{driver} wins for {team}."]
CHAMPIONSHIP_UPDATE = [
    "{leader} leads {chaser} by {gap} points with {n} races remaining."
]
