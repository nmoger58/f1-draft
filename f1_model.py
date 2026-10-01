#!/usr/bin/env python3
"""
F1 Championship Prediction - Supervised ML Pipeline  (v2, balanced ratings)
===========================================================================
Trains SEVEN algorithms on lap/telemetry data, ensembles them, and writes
driver & team ratings read by f1_draft_sim.py.

Usage:
  python f1_model.py --data datasets/                 # folder of CSVs (+ Ergast)
  python f1_model.py --data laps.csv                  # single file
  python f1_model.py --data laps.csv --telemetry      # also parse telemetry JSON
  python f1_model.py --data datasets/ --sessions race,sprint
  python f1_model.py --data datasets/ --min-year 2018 # Ergast year floor

Data sources (auto-detected in --data folder):
  * OpenF1-style lap CSVs (compound / tyre_age / stint columns)
  * Ergast lap_times.csv + races/drivers/pit_stops (tyre age from pits)
  Season race-result / videogame CSVs are skipped for lap training
  (team mapping still uses Ergast constructors when present).

Columns expected (OpenF1-style):
  event_name, session_type, driver, lap_number, lap_duration (or lap_time),
  compound, tyre_age, stint_number
  [optional: season, circuit, telemetry (JSON array of {t,speed,throttle,...})]

ALGORITHMS
  1 HistGradientBoosting  2 GradientBoosting  3 RandomForest  4 ExtraTrees
  5 Ridge                 6 SVR (RBF)         7 MLP (128-64-32)

TARGET  delta_% = 100 * (lap - session_median) / session_median
        (negative = faster than median)

WHAT CHANGED vs v1 (all aimed at stopping one team / driver running away)
  * BUG FIX: clean_laps crashed (NameError: mask) when there was no lap_time column.
  * Session medians and CV folds are now per (season + event). v1 mixed seasons of
    the same event together, which leaks and distorts the target.
  * Ratings use a NARROWER scale  (cars 78 -/+ 5z, clip 62-92;
    drivers 80 -/+ 4z, clip 68-92)  and every z-score is clipped to +/-2.5.
  * Ensemble weights = (1/MAE)^4, and any model that fails to beat the naive
    baseline gets zero weight (v1: plain 1/MAE gave near-equal weights).
  * Driver pace shrinkage is meaningful now (n / (n + 150)); v1's n/(n+40) did nothing.
  * SVR is subsampled (O(n^2)) so large datasets don't hang.
  * Default ML blend in the simulator is 0.40 instead of 0.65 (prior data matters too).
"""

import argparse, glob, json, os, warnings
import numpy as np
import pandas as pd
from sklearn.preprocessing import OrdinalEncoder, OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (HistGradientBoostingRegressor, RandomForestRegressor,
                              ExtraTreesRegressor, GradientBoostingRegressor)
from sklearn.linear_model import Ridge
from sklearn.svm import SVR
from sklearn.neural_network import MLPRegressor
from sklearn.model_selection import GroupKFold, KFold
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

warnings.filterwarnings("ignore")

LAP_COLUMNS_REQUIRED = {
    "event_name", "session_type", "driver",
    "lap_number", "lap_duration", "compound", "tyre_age", "stint_number",
}
MAX_ROWS_PER_MODEL = {"SVR": 12000, "GBR": 60000, "MLP": 80000,
                      "RandomForest": 100000, "ExtraTrees": 100000}
Z_CLIP = 2.5

# rating scales (centre, spread per 1 z, lo, hi)
CAR_SCALE = (78.0, 5.0, 62.0, 92.0)
DRV_SCALE = (80.0, 4.0, 68.0, 92.0)


# ─────────────────────────────────────────────────────── data loading
def parse_laptime(s):
    """'1:23.456' -> 83.456   or   '83.456' -> 83.456"""
    try:
        s = str(s)
        if ":" in s:
            m, sec = s.split(":")
            return int(m) * 60 + float(sec)
        return float(s)
    except Exception:
        return np.nan


SESSION_ALIASES = {
    "r": "race", "race": "race",
    "s": "sprint", "sprint": "sprint",
    "q": "qualifying", "qualifying": "qualifying",
    "sq": "sprint_quali", "sprint_quali": "sprint_quali",
    "ss": "sprint_quali", "sprintshootout": "sprint_quali",
    "fp1": "fp1", "fp2": "fp2", "fp3": "fp3",
    "practice": "practice", "day_1": "practice",
}


def normalize_session_type(series):
    return (series.astype(str).str.strip().str.lower()
            .map(lambda s: SESSION_ALIASES.get(s, s)))


def _tyre_age_from_pits(laps, pits):
    """Derive tyre_age / stint_number from Ergast pit_stops (pit lap = in-lap)."""
    laps = laps.copy()
    laps["lap_number"] = pd.to_numeric(laps["lap_number"], errors="coerce")
    laps = laps.dropna(subset=["lap_number"])
    if pits is None or pits.empty:
        laps["tyre_age"] = laps["lap_number"].astype(float)
        laps["stint_number"] = 1.0
        return laps.drop(columns=["raceId", "driverId"], errors="ignore")

    stops = pits.rename(columns={"lap": "pit_lap"})[["raceId", "driverId", "pit_lap"]].copy()
    stops["pit_lap"] = pd.to_numeric(stops["pit_lap"], errors="coerce")
    stops = stops.dropna(subset=["pit_lap"])
    pit_map = (stops.groupby(["raceId", "driverId"])["pit_lap"]
                    .apply(lambda s: np.sort(s.to_numpy(dtype=np.int64)))
                    .to_dict())

    race_ids = laps["raceId"].to_numpy()
    drv_ids = laps["driverId"].to_numpy()
    lap_nums = laps["lap_number"].to_numpy(dtype=np.int64)

    order = np.lexsort((lap_nums, drv_ids, race_ids))
    ages_u = np.empty(len(laps), dtype=np.float64)
    stints_u = np.empty(len(laps), dtype=np.float64)
    i = 0
    n = len(order)
    while i < n:
        idx0 = order[i]
        r0, d0 = race_ids[idx0], drv_ids[idx0]
        j = i + 1
        while j < n:
            idx = order[j]
            if race_ids[idx] != r0 or drv_ids[idx] != d0:
                break
            j += 1
        pits_arr = pit_map.get((int(r0), int(d0)), np.empty(0, dtype=np.int64))
        p = 0
        last = 0
        stint = 1
        for k in range(i, j):
            lap = lap_nums[order[k]]
            while p < len(pits_arr) and pits_arr[p] < lap:
                last = int(pits_arr[p])
                stint += 1
                p += 1
            ages_u[order[k]] = float(lap - last)
            stints_u[order[k]] = float(stint)
        i = j

    laps["tyre_age"] = ages_u
    laps["stint_number"] = stints_u
    return laps.drop(columns=["raceId", "driverId"], errors="ignore")


def load_ergast_laps(path, min_year=2018, max_year=None, exclude_seasons=None):
    """Convert Ergast lap_times (+ races/drivers/pit_stops) into OpenF1-style rows."""
    needed = ["lap_times.csv", "races.csv", "drivers.csv"]
    if not all(os.path.exists(os.path.join(path, f)) for f in needed):
        return None

    print("  [ERGAST] Building laps from lap_times / races / drivers / pit_stops...")
    races = pd.read_csv(os.path.join(path, "races.csv"),
                        usecols=["raceId", "year", "name", "circuitId"])
    if min_year is not None:
        races = races[races["year"] >= int(min_year)]
    if max_year is not None:
        races = races[races["year"] <= int(max_year)]
    if exclude_seasons:
        races = races[~races["year"].isin(exclude_seasons)]
    if races.empty:
        print("  [ERGAST] No races in requested year window")
        return None

    race_ids = set(races["raceId"])
    # chunked read keeps memory reasonable on the full 880k-row file
    chunks = []
    usecols = ["raceId", "driverId", "lap", "milliseconds"]
    for chunk in pd.read_csv(os.path.join(path, "lap_times.csv"),
                             usecols=usecols, chunksize=250_000):
        chunk = chunk[chunk["raceId"].isin(race_ids)]
        if len(chunk):
            chunks.append(chunk)
    if not chunks:
        print("  [ERGAST] No lap_times rows for selected races")
        return None
    laps = pd.concat(chunks, ignore_index=True)

    drivers = pd.read_csv(os.path.join(path, "drivers.csv"),
                          usecols=["driverId", "code"])
    drivers["code"] = drivers["code"].astype(str).str.strip().str.upper()
    drivers = drivers[drivers["code"].ne("") & drivers["code"].ne("NAN")]

    circuits = None
    cpath = os.path.join(path, "circuits.csv")
    if os.path.exists(cpath):
        circuits = pd.read_csv(cpath, usecols=["circuitId", "name"]).rename(
            columns={"name": "circuit"})

    merged = (laps.merge(races, on="raceId")
                  .merge(drivers, on="driverId"))
    if circuits is not None:
        merged = merged.merge(circuits, on="circuitId", how="left")
    else:
        merged["circuit"] = np.nan

    pits = None
    ppath = os.path.join(path, "pit_stops.csv")
    if os.path.exists(ppath):
        pits = pd.read_csv(ppath, usecols=["raceId", "driverId", "lap", "stop"])
        pits = pits[pits["raceId"].isin(race_ids)]

    frame = pd.DataFrame({
        "season": merged["year"].astype(int),
        "event_name": merged["name"].astype(str),
        "circuit": merged["circuit"],
        "session_type": "race",
        "driver": merged["code"],
        "lap_number": merged["lap"].astype(float),
        "lap_duration": merged["milliseconds"].astype(float) / 1000.0,
        "compound": "UNKNOWN",
        "raceId": merged["raceId"].astype(int),
        "driverId": merged["driverId"].astype(int),
    })
    frame = _tyre_age_from_pits(frame, pits)
    print(f"  [LOAD] {'ergast lap_times':40s}  {len(frame):7,} rows  "
          f"(years {int(frame['season'].min())}-{int(frame['season'].max())})")
    return frame


def load_openf1_laps(path, telemetry=False):
    """Load CSVs that already have the OpenF1 / All-Laps schema."""
    files = sorted(glob.glob(os.path.join(path, "*.csv"))) if os.path.isdir(path) else [path]
    frames = []
    skipped = 0
    ergast_core = {
        "lap_times.csv", "races.csv", "drivers.csv", "pit_stops.csv",
        "results.csv", "qualifying.csv", "sprint_results.csv",
        "circuits.csv", "constructors.csv", "constructor_results.csv",
        "constructor_standings.csv", "driver_standings.csv",
        "seasons.csv", "status.csv",
    }
    for f in files:
        base = os.path.basename(f).lower()
        if base in ergast_core:
            continue
        cols = set(pd.read_csv(f, nrows=0).columns)
        if not LAP_COLUMNS_REQUIRED.issubset(cols):
            skipped += 1
            continue
        wanted = LAP_COLUMNS_REQUIRED | {"lap_time", "circuit", "season"}
        if telemetry:
            wanted.add("telemetry")
        frame = pd.read_csv(f, usecols=lambda c: c in wanted)
        if telemetry and "telemetry" not in frame.columns:
            frame["telemetry"] = np.nan
        frames.append(frame)
        print(f"  [LOAD] {os.path.basename(f):40s}  {len(frame):7,} rows")
    if skipped:
        print(f"  [SKIP] {skipped} non-lap CSVs (season results / ratings / calendars)")
    return frames


def load_laps(path, telemetry=False, min_year=2018, max_year=None):
    frames = load_openf1_laps(path, telemetry=telemetry)

    openf1_seasons = set()
    for fr in frames:
        if "season" in fr.columns:
            openf1_seasons |= set(pd.to_numeric(fr["season"], errors="coerce").dropna().astype(int))

    if os.path.isdir(path):
        ergast = load_ergast_laps(path, min_year=min_year, max_year=max_year,
                                  exclude_seasons=openf1_seasons or None)
        if ergast is not None and len(ergast):
            frames.append(ergast)

    if not frames:
        raise SystemExit("[ERROR] No usable lap data found (OpenF1 CSVs or Ergast lap_times).")
    df = pd.concat(frames, ignore_index=True)
    if "season" in df.columns and min_year is not None:
        season_num = pd.to_numeric(df["season"], errors="coerce")
        keep = season_num.isna() | (season_num >= int(min_year))
        if max_year is not None:
            keep &= season_num.isna() | (season_num <= int(max_year))
        df = df.loc[keep].reset_index(drop=True)
    print(f"  Total raw rows: {len(df):,}")
    return df


# ─────────────────────────────────────────────────────── cleaning
def clean_laps(df, sessions=None):
    df = df.copy()
    df = df.dropna(subset=["driver", "event_name", "session_type"])
    df["driver"] = df["driver"].astype(str).str.strip().str.upper()
    df["session_type"] = normalize_session_type(df["session_type"])

    # resolve lap_duration (fallback: parse lap_time)
    df["lap_duration"] = pd.to_numeric(df["lap_duration"], errors="coerce")
    if "lap_time" in df.columns:
        miss = df["lap_duration"].isna()
        if miss.any():
            df.loc[miss, "lap_duration"] = df.loc[miss, "lap_time"].map(parse_laptime)
    df["lap_duration"] = pd.to_numeric(df["lap_duration"], errors="coerce")
    df = df[df["lap_duration"] > 20].copy()

    if sessions:
        keep = {SESSION_ALIASES.get(s.strip().lower(), s.strip().lower()) for s in sessions}
        df = df[df["session_type"].isin(keep)].copy()

    # one key per real event (season + event) so repeated events don't mix
    season = df["season"].astype(str) if "season" in df.columns else pd.Series("", index=df.index)
    df["event_key"] = season + "|" + df["event_name"].astype(str)

    grp = ["event_key", "session_type"]
    # drop in/out/traffic laps: keep within 7% of the session's P20
    fast_ref = df.groupby(grp)["lap_duration"].transform(lambda s: s.quantile(0.2))
    df = df[df["lap_duration"] <= fast_ref * 1.07].copy()

    # target: delta % vs session median
    med = df.groupby(grp)["lap_duration"].transform("median")
    df["delta"] = 100.0 * (df["lap_duration"] - med) / med

    for c in ("tyre_age", "stint_number", "lap_number"):
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(float)
    df["compound"] = df["compound"].fillna("UNKNOWN").astype(str)

    counts = df["driver"].value_counts()
    df = df[df["driver"].isin(counts[counts >= 5].index)].reset_index(drop=True)

    print(f"\n  After cleaning: {len(df):,} laps | {df['driver'].nunique()} drivers | "
          f"{df['event_key'].nunique()} events")
    if len(df) < 200:
        print("  [WARN] very few laps - ratings will be noisy")
    return df


# ─────────────────────────────────────────────────────── telemetry
def parse_telemetry(df, max_laps=200):
    """Top speed and full-throttle share per driver from the JSON telemetry column."""
    if "telemetry" not in df.columns:
        return {}
    out = {}
    for driver, g in df.groupby("driver"):
        g = g.sample(min(len(g), max_laps), random_state=42)
        tops, full = [], []
        for raw in g["telemetry"].dropna():
            try:
                pts = json.loads(raw)
                if not pts:
                    continue
                tops.append(max(p.get("speed", 0) for p in pts))
                full.append(float(np.mean([p.get("throttle", 0) >= 98 for p in pts])))
            except Exception:
                continue
        if tops:
            out[driver] = {"top_speed": float(np.mean(tops)), "full_throttle": float(np.mean(full))}
    print(f"  Telemetry profiles: {len(out)} drivers")
    return out


# ─────────────────────────────────────────────────────── features
CATEGORICAL = ["driver", "event_name", "session_type", "compound"]
NUMERICAL = ["tyre_age", "stint_number", "lap_number", "tyre_age_sq", "lap_x_tyre"]


def engineer(df):
    df = df.copy()
    df["tyre_age_sq"] = df["tyre_age"] ** 2
    df["lap_x_tyre"] = df["lap_number"] * df["tyre_age"]
    return df


# ─────────────────────────────────────────────────────── model zoo
def make_models(n_rows=None):
    large = bool(n_rows and n_rows > 80_000)
    hgb_iter = 250 if large else 400
    tree_n = 120 if large else 200
    gbr_n = 150 if large else 300
    hgb = HistGradientBoostingRegressor(max_iter=hgb_iter, learning_rate=0.05, max_leaf_nodes=31,
                                        l2_regularization=0.8, min_samples_leaf=20, random_state=0)
    gbr = GradientBoostingRegressor(n_estimators=gbr_n, learning_rate=0.07, max_depth=4,
                                    subsample=0.8, min_samples_leaf=20, random_state=0)
    rf = RandomForestRegressor(n_estimators=tree_n, max_features=0.6, min_samples_leaf=15,
                               n_jobs=-1, random_state=0)
    et = ExtraTreesRegressor(n_estimators=tree_n, max_features=0.6, min_samples_leaf=15,
                             n_jobs=-1, random_state=0)
    ridge = Ridge(alpha=10.0)
    svr = SVR(kernel="rbf", C=5.0, epsilon=0.05, gamma="scale")
    mlp = MLPRegressor(hidden_layer_sizes=(128, 64, 32), activation="relu",
                       learning_rate_init=3e-3, max_iter=400, early_stopping=True,
                       n_iter_no_change=20, random_state=0)
    return {
        "HistGBT":      ("ordinal", hgb),
        "GBR":          ("ordinal", gbr),
        "RandomForest": ("ohe",     rf),
        "ExtraTrees":   ("ohe",     et),
        "Ridge":        ("scale",   ridge),
        "SVR":          ("scale",   svr),
        "MLP":          ("scale",   mlp),
    }


def _ohe():
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:                                  # older scikit-learn
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def make_preprocessor(mode, cat_cols, num_cols):
    if mode == "ordinal":
        enc = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)
    else:
        enc = _ohe()
    pre = ColumnTransformer([("cat", enc, cat_cols), ("num", "passthrough", num_cols)])
    if mode == "scale":
        return Pipeline([("pre", pre), ("scl", StandardScaler())])
    return pre


def _fit(name, est, Xt, y, rng):
    cap = MAX_ROWS_PER_MODEL.get(name)
    if cap and Xt.shape[0] > cap:
        idx = rng.choice(Xt.shape[0], cap, replace=False)
        Xt, y = Xt[idx], y[idx]
    est.fit(Xt, y)


# ─────────────────────────────────────────────────────── cross-validation
def cross_validate_all(df, models):
    """GroupKFold by event; returns {name: (oof_predictions, mae)} and naive MAE."""
    X = engineer(df)[CATEGORICAL + NUMERICAL]
    y = df["delta"].values
    groups = df["event_key"]
    rng = np.random.RandomState(0)

    n_ev = groups.nunique()
    n_splits = min(3 if len(df) > 80_000 else 5, max(2, n_ev))
    if n_ev >= 2:
        splits = list(GroupKFold(n_splits=n_splits).split(X, y, groups))
    else:
        splits = list(KFold(n_splits=min(5, n_splits), shuffle=True, random_state=42).split(X, y))

    print(f"\n  Cross-validation: {len(splits)} folds (grouped by event)")
    print(f"  {'Model':14}  {'CV MAE':>8}  {'CV RMSE':>8}  {'CV R2':>7}")
    print("  " + "-" * 44)

    oof_store = {}
    for name, (mode, est) in models.items():
        oof = np.zeros(len(df))
        for tr, te in splits:
            pre = make_preprocessor(mode, CATEGORICAL, NUMERICAL)
            Xtr = pre.fit_transform(X.iloc[tr])
            Xte = pre.transform(X.iloc[te])
            _fit(name, est, Xtr, y[tr], rng)
            oof[te] = est.predict(Xte)
        mae = mean_absolute_error(y, oof)
        rmse = mean_squared_error(y, oof) ** 0.5
        r2 = r2_score(y, oof)
        print(f"  {name:14}  {mae:8.4f}  {rmse:8.4f}  {r2:7.4f}")
        oof_store[name] = (oof, mae)

    naive_mae = mean_absolute_error(y, np.full_like(y, y.mean(), dtype=float))
    print(f"  {'Naive baseline':14}  {naive_mae:8.4f}")
    return oof_store, naive_mae


# ─────────────────────────────────────────────────────── ensemble
def train_ensemble(df, models, oof_store, naive_mae):
    X_full = engineer(df)[CATEGORICAL + NUMERICAL]
    y = df["delta"].values
    rng = np.random.RandomState(0)

    raw_w = {}
    for name, (_, mae) in oof_store.items():
        raw_w[name] = (1.0 / (mae + 1e-6)) ** 4 if mae < naive_mae else 0.0
    if sum(raw_w.values()) == 0:                       # nothing beat the baseline
        raw_w = {k: 1.0 for k in raw_w}
    total = sum(raw_w.values())
    weights = {k: v / total for k, v in raw_w.items()}

    fitted = {}
    for name, (mode, est) in models.items():
        if weights[name] == 0:
            continue
        pre = make_preprocessor(mode, CATEGORICAL, NUMERICAL)
        Xt = pre.fit_transform(X_full)
        _fit(name, est, Xt, y, rng)
        fitted[name] = (pre, est)

    print("\n  Ensemble weights:")
    for k, w in sorted(weights.items(), key=lambda x: -x[1]):
        print(f"    {k:14}  {w:.3f}")
    return fitted, weights


def ensemble_predict(Xdf, fitted, weights):
    Xe = engineer(Xdf)[CATEGORICAL + NUMERICAL]
    pred = np.zeros(len(Xe))
    for name, (pre, est) in fitted.items():
        pred += weights[name] * est.predict(pre.transform(Xe))
    return pred


# ─────────────────────────────────────────────────────── counterfactual pace
def counterfactual_pace(df, fitted, weights):
    """Score every driver in the IDENTICAL scenario (same events, compound, tyre age)."""
    drivers = sorted(df["driver"].unique())
    events = df[["event_name", "session_type"]].drop_duplicates()
    compound = "MEDIUM" if (df["compound"] == "MEDIUM").any() else df["compound"].mode()[0]

    def pace_at(age):
        rows = []
        for d in drivers:
            s = events.copy()
            s["driver"] = d
            s["compound"] = compound
            s["tyre_age"] = float(age)
            s["stint_number"] = 2.0
            s["lap_number"] = 10.0
            rows.append(s)
        big = pd.concat(rows, ignore_index=True)
        big["pred"] = ensemble_predict(big, fitted, weights)
        return big.groupby("driver")["pred"].mean()

    pace_fresh = pace_at(5)
    pace_old = pace_at(20)
    deg = (pace_old - pace_fresh) / 15.0               # % per lap

    n = df["driver"].value_counts().reindex(pace_fresh.index).fillna(0)
    shrink = n / (n + 150.0)
    pace_fresh = (pace_fresh - pace_fresh.mean()) * shrink + pace_fresh.mean()
    deg = (deg - deg.mean()) * shrink + deg.mean()
    return pace_fresh, deg


def consistency_scores(df, oof_store, weights):
    """Std of OOF residuals per driver (lower = more consistent)."""
    y = df["delta"].values
    oof_ens = np.zeros(len(df))
    for name, (oof, _) in oof_store.items():
        oof_ens += weights[name] * oof
    resid = pd.Series(y - oof_ens, index=df.index)
    return resid.groupby(df["driver"]).std()


# ─────────────────────────────────────────────────────── ratings
def zscore(s, clip=Z_CLIP):
    s = pd.Series(s, dtype=float)
    if s.empty:
        return s
    sd = s.std(ddof=0)
    z = (s - s.mean()) / (sd if sd > 1e-9 else 1.0)
    return z.clip(-clip, clip)


def build_ratings(df, pace, deg, consistency, tele, driver_teams, weights, naive_mae, oof_store):
    """
    Car rating    = team-mean pace z-score         (lower delta = faster car)
    Driver rating = within-team pace z-score       (driver vs. teammate; car removed)
    """
    tbl = pd.DataFrame({"pace": pace, "deg": deg, "consistency": consistency})
    tbl["team"] = [driver_teams.get(d) for d in tbl.index]
    known = tbl.dropna(subset=["team"]).copy()

    car_z = pd.Series(dtype=float)
    drv_z = pd.Series(dtype=float)
    team_pace = pd.Series(dtype=float)
    if len(known):
        team_pace = known.groupby("team")["pace"].mean()
        known["within"] = known["pace"] - known["team"].map(team_pace)
        car_z = zscore(team_pace)
        drv_z = zscore(known["within"])

    tyre_z = zscore(tbl["deg"])
    cons_z = zscore(-tbl["consistency"].fillna(tbl["consistency"].mean()))
    top_z = (zscore(pd.Series({d: v["top_speed"] for d, v in tele.items()}))
             if len(tele) > 2 else pd.Series(dtype=float))

    out = {"drivers": {}, "teams": {}, "model_info": {}}

    c0, cs, clo, chi = CAR_SCALE
    for team, z in car_z.items():
        out["teams"][team] = {
            "car_rating": float(np.clip(c0 - cs * z, clo, chi)),
            "raw_pace_pct": float(team_pace[team]),
        }

    d0, ds, dlo, dhi = DRV_SCALE
    n_laps = df["driver"].value_counts()
    for d, row in tbl.iterrows():
        out["drivers"][d] = {
            "driver_rating": float(np.clip(d0 - ds * drv_z.get(d, 0.0), dlo, dhi)),
            "tyre_z":        float(-tyre_z[d]),
            "consistency_z": float(cons_z.get(d, 0.0)),
            "top_speed_z":   float(top_z[d]) if d in top_z.index else 0.0,
            "raw_pace_pct":  float(row["pace"]),
            "deg_per_lap":   float(row["deg"]),
            "laps_in_data":  int(n_laps.get(d, 0)),
        }

    out["model_info"] = {
        "drivers_rated": len(out["drivers"]),
        "teams_rated":   len(out["teams"]),
        "total_laps":    int(len(df)),
        "ensemble_weights": {k: round(float(v), 4) for k, v in weights.items()},
        "cv_mae": {k: round(float(v[1]), 4) for k, v in oof_store.items()},
        "naive_mae": round(float(naive_mae), 4),
    }
    return out


# ─────────────────────────────────────────────────────── team mapping
def build_driver_teams(data_path):
    """f1_data.py lineup first, then optionally enrich from Ergast CSVs."""
    mapping = {}
    try:
        from f1_data import TEAMS
        mapping = {code: team for team, v in TEAMS.items() for code in v["drivers"]}
    except Exception as e:                              # missing datasets/ etc.
        print(f"  [INFO] f1_data not usable for team mapping ({type(e).__name__})")

    if not os.path.isdir(data_path):
        return mapping
    needed = ["races.csv", "results.csv", "drivers.csv", "constructors.csv"]
    if not all(os.path.exists(os.path.join(data_path, f)) for f in needed):
        return mapping

    races = pd.read_csv(os.path.join(data_path, "races.csv"), usecols=["raceId", "year", "round"])
    results = pd.read_csv(os.path.join(data_path, "results.csv"),
                          usecols=["raceId", "driverId", "constructorId"])
    drivers = pd.read_csv(os.path.join(data_path, "drivers.csv"), usecols=["driverId", "code"])
    cons = pd.read_csv(os.path.join(data_path, "constructors.csv"), usecols=["constructorId", "name"])

    merged = (results.merge(races, on="raceId").merge(drivers, on="driverId")
                     .merge(cons, on="constructorId"))
    merged = merged.dropna(subset=["code"]).sort_values(["year", "round"])
    latest = merged.drop_duplicates("code", keep="last")
    for r in latest.itertuples():                       # never override the current lineup
        mapping.setdefault(str(r.code).strip().upper(), r.name)
    print(f"  Team mapping: {len(mapping)} drivers")
    return mapping


# ─────────────────────────────────────────────────────── main
if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="F1 Championship ML - trains 7 algorithms on lap data")
    ap.add_argument("--data", default="datasets", help="CSV file or folder (default: datasets/)")
    ap.add_argument("--out", default="driver_ratings.json", help="Output JSON for the simulator")
    ap.add_argument("--telemetry", action="store_true", help="Parse telemetry JSON (slow)")
    ap.add_argument("--sessions", default=None,
                    help="Comma list of session types to keep, e.g. race,sprint (default: all)")
    ap.add_argument("--min-year", type=int, default=2018,
                    help="Earliest Ergast / season year to include (default: 2018)")
    ap.add_argument("--max-year", type=int, default=None,
                    help="Latest season year to include (default: no cap)")
    ap.add_argument("--ml-weight", type=float, default=0.40,
                    help="Suggested blend weight for ML vs prior ratings in the simulator")
    ap.add_argument("--skip-svr", action="store_true", help="Skip SVR (slow on big data)")
    a = ap.parse_args()

    print("=" * 60)
    print("  F1 CHAMPIONSHIP ML PIPELINE  (v2)")
    print("=" * 60)

    print("\n[1/6] Loading data...")
    raw = load_laps(a.data, a.telemetry, min_year=a.min_year, max_year=a.max_year)

    print("\n[2/6] Cleaning laps...")
    df = clean_laps(raw, a.sessions.split(",") if a.sessions else None)

    tele = {}
    if a.telemetry and "telemetry" in df.columns:
        print("\n  Parsing telemetry...")
        tele = parse_telemetry(df)

    models = make_models(n_rows=len(df))
    # SVR is O(n^2); auto-skip on the expanded multi-season corpus
    if a.skip_svr or len(df) > 40_000:
        if "SVR" in models:
            reason = "--skip-svr" if a.skip_svr else f"{len(df):,} laps"
            print(f"  [INFO] Skipping SVR ({reason})")
            del models["SVR"]

    print(f"\n[3/6] Cross-validating {len(models)} algorithms...")
    oof_store, naive_mae = cross_validate_all(df, models)

    print("\n[4/6] Training ensemble on full data...")
    fitted, weights = train_ensemble(df, models, oof_store, naive_mae)

    print("\n[5/6] Counterfactual driver scoring...")
    pace, deg = counterfactual_pace(df, fitted, weights)
    consistency = consistency_scores(df, oof_store, weights)

    print("\n[6/6] Building ratings & saving...")
    driver_teams = build_driver_teams(a.data)
    ratings = build_ratings(df, pace, deg, consistency, tele, driver_teams, weights, naive_mae, oof_store)
    with open(a.out, "w") as fh:
        json.dump(ratings, fh, indent=2)

    print("\n  DRIVER PACE TABLE (fastest -> slowest, lower delta% = faster)")
    tbl = pd.DataFrame({d: {"pace_%": v["raw_pace_pct"], "rating": v["driver_rating"],
                            "deg/lap": v["deg_per_lap"], "laps": v["laps_in_data"]}
                        for d, v in ratings["drivers"].items()}).T
    tbl = tbl.astype({"pace_%": float, "rating": float, "deg/lap": float, "laps": int})
    print(tbl.sort_values("pace_%").round(3).to_string())
    print("\n  TEAM CAR RATINGS")
    for team, v in sorted(ratings["teams"].items(), key=lambda x: -x[1]["car_rating"]):
        print(f"    {team:15}  {v['car_rating']:.1f}")
    print(f"\n  Saved -> {a.out}")
    print(f"  (simulator blends these with --ml-weight, suggested {a.ml_weight})")