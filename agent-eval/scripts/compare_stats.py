# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "pandas>=2.2",
#   "statsmodels>=0.14",
#   "matplotlib>=3.9",
# ]
# ///
"""Statistics stage of `pnpm results:compare`.

Reads dataset.csv + manifest.json from the staging directory given as argv[1];
writes estimates.csv/json, report.md, and curves/ back into it. Deterministic:
no seeds, no wall-clock values outside the manifest provenance block.
Spec: docs/superpowers/specs/2026-08-10-agentic-ref-analysis-pipeline-design.md
"""

import csv
import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels
import statsmodels.formula.api as smf
from statsmodels.stats.multitest import multipletests

ALPHA = 0.05


def fmt(value):
    """Canonical cell for CSV/JSON: repr for floats, '' for None."""
    if value is None:
        return ""
    if isinstance(value, float):
        return repr(value)
    return str(value)


def transform_series(series, transform):
    """Apply the registry transform; returns (values, anomaly_mask)."""
    if transform == "log":
        anomalies = series.notna() & (series <= 0)
        values = np.where(series > 0, np.log(series.where(series > 0)), np.nan)
        return pd.Series(values, index=series.index), anomalies
    if transform == "log0":
        values = np.where(series == 0, 0.0, np.log(series.where(series > 0)))
        return pd.Series(values, index=series.index), series.notna() & (series < 0)
    return series, pd.Series(False, index=series.index)


def fit_pair(frame, control, treatment, pooled):
    """OLS with HC3 on control+treatment rows; returns the treatment term stats."""
    formula = f'y ~ C(case, Treatment(reference="{control}"))'
    if pooled:
        formula += " + C(workflow)"
    fit = smf.ols(formula, frame).fit(cov_type="HC3")
    term = f'C(case, Treatment(reference="{control}"))[T.{treatment}]'
    ci_low, ci_high = fit.conf_int(alpha=ALPHA).loc[term]
    return {
        "beta": float(fit.params[term]),
        "se": float(fit.bse[term]),
        "ciLow": float(ci_low),
        "ciHigh": float(ci_high),
        "p": float(fit.pvalues[term]),
    }


def analyze(manifest, data):
    control = manifest["spec"]["control"]["shortName"]
    treatments = [t["shortName"] for t in manifest["spec"]["treatments"]]
    workflows = manifest["spec"]["workflows"]
    pooled = manifest["spec"]["mode"] == "aggregate"
    rows, skipped = [], []

    for metric in manifest["metrics"]:
        series, anomalies = transform_series(data[metric["key"]], metric["transform"])
        frame = pd.DataFrame(
            {"y": series, "case": data["case"], "workflow": data["workflow"]}
        ).dropna(subset=["y"])
        for treatment in treatments:
            pair = frame[frame["case"].isin([control, treatment])]
            n_control = int((pair["case"] == control).sum())
            n_treatment = int((pair["case"] == treatment).sum())
            if n_control < 2 or n_treatment < 2:
                skipped.append(
                    {
                        "metric": metric["key"],
                        "treatment": treatment,
                        "reason": f"needs >=2 values per arm, have control={n_control}, treatment={n_treatment}",
                    }
                )
                continue
            stats = fit_pair(pair, control, treatment, pooled)
            rows.append(
                {
                    "metric": metric["key"],
                    "treatment": treatment,
                    "scope": "pooled" if pooled else workflows[0],
                    "context": False,
                    "nControl": n_control,
                    "nTreatment": n_treatment,
                    **stats,
                    "pctChange": (
                        math.exp(stats["beta"]) - 1
                        if metric["transform"] in ("log", "log0")
                        else None
                    ),
                    "q": None,
                    "verdict": None,
                    "direction": metric["direction"],
                    "transform": metric["transform"],
                    "anomalies": int(anomalies[data["case"].isin([control, treatment])].sum()),
                }
            )
            if pooled:
                for workflow in workflows:
                    sub = pair[pair["workflow"] == workflow]
                    if (sub["case"] == control).sum() < 2 or (sub["case"] == treatment).sum() < 2:
                        continue
                    context_stats = fit_pair(sub, control, treatment, pooled=False)
                    rows.append(
                        {
                            "metric": metric["key"],
                            "treatment": treatment,
                            "scope": workflow,
                            "context": True,
                            "nControl": int((sub["case"] == control).sum()),
                            "nTreatment": int((sub["case"] == treatment).sum()),
                            **context_stats,
                            "pctChange": (
                                math.exp(context_stats["beta"]) - 1
                                if metric["transform"] in ("log", "log0")
                                else None
                            ),
                            "q": None,
                            "verdict": None,
                            "direction": metric["direction"],
                            "transform": metric["transform"],
                            "anomalies": None,
                        }
                    )

    headline = [row for row in rows if not row["context"]]
    if headline:
        _, q_values, _, _ = multipletests(
            [row["p"] for row in headline], alpha=ALPHA, method="fdr_bh"
        )
        for row, q in zip(headline, q_values):
            row["q"] = float(q)
            row["verdict"] = "significant" if q <= ALPHA else "not-significant"
    return rows, skipped


ESTIMATE_FIELDS = [
    "metric", "treatment", "scope", "context", "nControl", "nTreatment",
    "beta", "se", "ciLow", "ciHigh", "pctChange", "p", "q", "verdict",
    "direction", "transform", "anomalies",
]


def write_estimates(out_dir, rows):
    with open(out_dir / "estimates.csv", "w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(ESTIMATE_FIELDS)
        for row in rows:
            writer.writerow([fmt(row[field]) if not isinstance(row[field], bool) else str(row[field]).lower() for field in ESTIMATE_FIELDS])
    (out_dir / "estimates.json").write_text(json.dumps(rows, indent=2) + "\n")


def draw_curves(out_dir, manifest, data, rows):
    plt.rcParams["svg.hashsalt"] = "agentic-ref"
    curves_dir = out_dir / "curves"
    curves_dir.mkdir(exist_ok=True)
    control = manifest["spec"]["control"]["shortName"]
    treatments = [t["shortName"] for t in manifest["spec"]["treatments"]]
    for metric in manifest["metrics"]:
        for workflow in manifest["spec"]["workflows"]:
            fig, ax = plt.subplots(figsize=(7, 4.5))
            plotted = False
            has_zero = False
            for case in [control, *treatments]:
                values = data[(data["case"] == case) & (data["workflow"] == workflow)][
                    metric["key"]
                ].dropna()
                if values.empty:
                    continue
                plotted = True
                has_zero = has_zero or bool((values <= 0).any())
                xs = np.sort(values.to_numpy())
                ys = np.arange(1, len(xs) + 1) / len(xs)
                ax.step(
                    xs, ys, where="post",
                    label=f"{case} (n={len(xs)}, med={fmt(float(np.median(xs)))})",
                )
            if not plotted:
                plt.close(fig)
                continue
            if metric["transform"] in ("log", "log0") and not has_zero:
                ax.set_xscale("log")
            ax.set_title(f'{metric["label"]} — {workflow}')
            ax.set_ylabel("ECDF")
            ax.legend(loc="lower right", fontsize=8)
            verdicts = [
                f'{row["treatment"]}: q={fmt(row["q"])} {row["verdict"]}'
                for row in rows
                if row["metric"] == metric["key"] and not row["context"] and row["q"] is not None
            ]
            if verdicts:
                ax.text(
                    0.02, 0.98, "\n".join(verdicts), transform=ax.transAxes,
                    va="top", fontsize=8, family="monospace",
                )
            fig.tight_layout()
            base = curves_dir / f'{metric["key"]}@{workflow}'
            fig.savefig(f"{base}.svg", metadata={"Date": None})
            fig.savefig(f"{base}.png", metadata={"Software": None})
            plt.close(fig)


def write_report(out_dir, manifest, rows, skipped):
    spec = manifest["spec"]
    lines = [
        f'# Comparison: {spec["control"]["shortName"]} vs {"+".join(t["shortName"] for t in spec["treatments"])}',
        "",
        f'Workflows: {", ".join(spec["workflows"])} — mode: {spec["mode"]}, min runs: {spec["minRuns"]}, batches: {"all" if spec["allBatches"] else "latest"}.',
        "",
        "## Verdicts",
        "",
        "| Metric | Treatment | β | 95% CI | % change | p | q | Verdict |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        if row["context"]:
            continue
        arrow = "↓" if row["beta"] < 0 else "↑"
        lines.append(
            f'| {row["metric"]} | {row["treatment"]} | {fmt(row["beta"])} {arrow} '
            f'| [{fmt(row["ciLow"])}, {fmt(row["ciHigh"])}] | {fmt(row["pctChange"])} '
            f'| {fmt(row["p"])} | {fmt(row["q"])} | {row["verdict"]} |'
        )
    if any(row["transform"] == "log0" and not row["context"] for row in rows):
        lines += ["", "% change is approximate for log0 metrics (log(0) is mapped to 0)."]
    context_rows = [row for row in rows if row["context"]]
    if context_rows:
        lines += ["", "## Per-workflow context (not FDR-tested)", "",
                  "| Metric | Treatment | Workflow | β | p |", "|---|---|---|---|---|"]
        for row in context_rows:
            lines.append(
                f'| {row["metric"]} | {row["treatment"]} | {row["scope"]} | {fmt(row["beta"])} | {fmt(row["p"])} |'
            )
    if skipped:
        lines += ["", "## Skipped metrics", ""]
        lines += [f'- {s["metric"]} × {s["treatment"]}: {s["reason"]}' for s in skipped]
    if manifest.get("excludedRuns"):
        lines += ["", "## Excluded runs", ""]
        lines += [f'- `{e["path"]}` — {e["reason"]}' for e in manifest["excludedRuns"]]
    lines += ["", "## Cells", "", "| Case | Workflow | Batch | Usable | Passed | Failed | Unanalyzed | Stale |", "|---|---|---|---|---|---|---|---|"]
    for cell in manifest["cells"]:
        lines.append(
            f'| {cell["case"]} | {cell["workflow"]} | {cell["batch"]} | {cell["usableRuns"]} '
            f'| {cell["passed"]} | {cell["failed"]} | {cell["unanalyzed"]} | {cell["stale"]} |'
        )
    lines += ["", "Curves: see `curves/<metric>@<workflow>.svg`.", ""]
    (out_dir / "report.md").write_text("\n".join(lines))


def main():
    out_dir = Path(sys.argv[1])
    manifest = json.loads((out_dir / "manifest.json").read_text())
    data = pd.read_csv(out_dir / "dataset.csv", dtype={"case": str, "workflow": str, "batch": str})
    rows, skipped = analyze(manifest, data)
    write_estimates(out_dir, rows)
    draw_curves(out_dir, manifest, data, rows)
    write_report(out_dir, manifest, rows, skipped)
    manifest["provenance"] = {
        **manifest.get("provenance", {}),
        "python": sys.version.split()[0],
        "pandas": pd.__version__,
        "statsmodels": statsmodels.__version__,
        "matplotlib": matplotlib.__version__,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    significant = sum(1 for row in rows if row["verdict"] == "significant")
    headline = sum(1 for row in rows if not row["context"])
    print(f"{headline} headline tests, {significant} significant at FDR 5%.")


if __name__ == "__main__":
    main()
