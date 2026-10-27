#!/usr/bin/env bash
# Join blind judge scores with the answer keys and print per-arm results.
#   aggregate.sh <run-dir>
# Reads <run>/judge/<case>.rN.tsv (six dimensions) and, when present,
# <run>/judge/<case>.rN.headline.tsv, unblinds with <run>/blind/<case>.rN.key.
# Core is out of 25 per case and run (impact_first, accuracy, traps, risk,
# concision). Map and headline are out of 5. Means are over all judged cells.
# sd(core) is the standard deviation, across runs, of each run's mean core
# over cases; "-" with fewer than two runs. Invalid judge files stop the script.
set -euo pipefail

[ $# -eq 1 ] && [ -d "$1/judge" ] || { printf 'usage: %s <run-dir>\n' "${0##*/}" >&2; exit 2; }
run=${1%/}

clean=$(mktemp -d)
trap 'rm -rf "$clean"' EXIT

# check <file> <key> <fields> <first-score-field> <last-score-field>
# Strips CR into $clean, then requires known labels, integer scores 1-5,
# and one row per key row. Exits with the file named on any mismatch.
check() {
  tr -d '\r' <"$1" >"$clean/$(basename "$1")"
  awk -F'\t' -v f="$1" -v nf="$3" -v s1="$4" -v s2="$5" '
    FILENAME == ARGV[1] { want[$1] = 1; nkey++; next }
    function bad(msg) { printf "aggregate.sh: %s: line %d: %s\n", f, FNR, msg > "/dev/stderr"; failed = 1 }
    NF == 0 { next }
    {
      rows++
      if (NF < nf) bad("expected " nf " tab-separated fields, got " NF)
      if (!($1 in want)) bad("label " $1 " is not in the key")
      if ($1 in got) bad("label " $1 " appears twice")
      got[$1] = 1
      for (i = s1; i <= s2; i++) if ($i !~ /^[1-5]$/) bad("score " $i " is not an integer 1-5")
    }
    END {
      if (rows != nkey) { printf "aggregate.sh: %s: %d rows, key has %d\n", f, rows, nkey > "/dev/stderr"; failed = 1 }
      exit failed
    }' "$2" "$clean/$(basename "$1")"
}

ok=1
for judged in "$run"/judge/*.r[0-9]*.tsv; do
  [ -f "$judged" ] || continue
  name=$(basename "$judged" .tsv)
  case $name in *.headline) continue ;; esac
  key="$run/blind/$name.key"
  [ -f "$key" ] || { printf 'aggregate.sh: %s: no key %s\n' "$judged" "$key" >&2; ok=0; continue; }
  check "$judged" "$key" 8 2 7 || ok=0
  if [ -f "$run/judge/$name.headline.tsv" ]; then check "$run/judge/$name.headline.tsv" "$key" 3 2 2 || ok=0; fi
done
[ "$ok" = 1 ] || { printf 'aggregate.sh: judge files invalid, no table printed\n' >&2; exit 1; }

for judged in "$run"/judge/*.r[0-9]*.tsv; do
  [ -f "$judged" ] || continue
  name=$(basename "$judged" .tsv)
  case $name in *.headline) continue ;; esac
  elev="$clean/$name.headline.tsv"
  [ -f "$elev" ] || elev=/dev/null
  judged="$clean/$name.tsv"
  awk -F'\t' -v name="$name" '
    FILENAME == ARGV[1] { arm[$1] = $2; next }
    FILENAME == ARGV[2] { el[$1] = $2; next }
    { printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", arm[$1], name, $2, $3, $4, $5, $6, $7, ($1 in el ? el[$1] : "NA") }
  ' "$run/blind/$name.key" "$elev" "$judged"
done | awk -F'\t' '
  function natkey(c) { return sprintf("%04d", substr(c, 2) + 0) c }
  {
    arm = $1; full = $2
    r = full; sub(/^.*\.r/, "r", r)
    cs = full; sub(/\.r[0-9]+$/, "", cs)
    core = $3 + $4 + $5 + $6 + $7
    cells[arm]++
    for (d = 3; d <= 8; d++) sum[arm, d] += $d
    core_sum[arm] += core
    if ($9 != "NA") { esum[arm] += $9; ecnt[arm]++ }
    rs[arm, r] += core; rn[arm, r]++
    if (!((arm, r) in rseen)) { rseen[arm, r] = 1; rlist[arm] = rlist[arm] " " r }
    ck = arm SUBSEP cs
    cc_core[ck] += core; cc_map[ck] += $8; cc_n[ck]++
    if ($9 != "NA") { cc_el[ck] += $9; cc_en[ck]++ }
    if (!(arm in seen)) { seen[arm] = 1; names[++n] = arm }
    if (!(cs in cseen)) { cseen[cs] = 1; cnames[++m] = cs }
  }
  END {
    for (i = 2; i <= n; i++) { key = names[i]; for (j = i - 1; j >= 1 && names[j] > key; j--) names[j + 1] = names[j]; names[j + 1] = key }
    for (i = 2; i <= m; i++) { key = cnames[i]; for (j = i - 1; j >= 1 && natkey(cnames[j]) > natkey(key); j--) cnames[j + 1] = cnames[j]; cnames[j + 1] = key }
    printf "%-10s %5s %6s %6s %6s %6s %6s %5s %5s %8s %8s %4s\n", "arm", "cells", "impact", "accur", "traps", "risk", "concis", "map", "elev", "core/25", "sd(core)", "runs"
    for (i = 1; i <= n; i++) {
      arm = names[i]; c = cells[arm]
      # sd across runs of the per-run mean core
      k = 0; s = 0; ss = 0
      nr = split(rlist[arm], rr, " ")
      for (x = 1; x <= nr; x++) { v = rs[arm, rr[x]] / rn[arm, rr[x]]; k++; s += v; ss += v * v }
      if (k > 1) { mean = s / k; var = (ss - k * mean * mean) / (k - 1); if (var < 0) var = 0; sd = sprintf("%.2f", sqrt(var)) } else sd = "-"
      el = ecnt[arm] ? sprintf("%.2f", esum[arm] / ecnt[arm]) : "-"
      printf "%-10s %5d %6.2f %6.2f %6.2f %6.2f %6.2f %5.2f %5s %8.2f %8s %4d\n", arm, c,
        sum[arm, 3] / c, sum[arm, 4] / c, sum[arm, 5] / c, sum[arm, 6] / c, sum[arm, 7] / c, sum[arm, 8] / c,
        el, core_sum[arm] / c, sd, k
    }
    print ""
    print "per case, mean over runs: core/25 map/5 headline/5"
    printf "%-22s", "case"
    for (i = 1; i <= n; i++) printf " %-18s", names[i]
    printf "\n"
    for (j = 1; j <= m; j++) {
      cs = cnames[j]
      printf "%-22s", cs
      for (i = 1; i <= n; i++) {
        ck = names[i] SUBSEP cs
        if (cc_n[ck]) {
          e = cc_en[ck] ? sprintf("%.1f", cc_el[ck] / cc_en[ck]) : "-"
          printf " %-18s", sprintf("%.1f %.1f %s (n=%d)", cc_core[ck] / cc_n[ck], cc_map[ck] / cc_n[ck], e, cc_n[ck])
        } else printf " %-18s", "-"
      }
      printf "\n"
    }
  }
'
