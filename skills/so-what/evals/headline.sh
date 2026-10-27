#!/usr/bin/env bash
# Extract the headline view of one output: the part that carries the whole message.
#   headline.sh <file>
# Prints, in order, whichever exist:
#   Title:       first non-blank line (HTML comment lines skipped); for a PR
#                body (it has `## Impact`) there is no title, so it says so
#   Impact:      first sentence of the PR `## Impact` section, of the commit
#                `Impact:` line, or (free-form text) of the first paragraph
#                after the first line
#   Worst case:  PR `Worst case:` line
#   Risk:        commit `Risk:` line, first sentence (none for free-form text)
#   Decision: / Needs:  first such line
#   Map:         first ```text or ```mermaid fence, or any fence directly under
#                `## Impact map`; else the first run of 4-space-indented lines
#                holding an arrow (-->, ==>, ->) or a [node]
# Labels may be bold (**Decision:**); wrapped lines are joined up to a blank
# line, another label line, a heading or a fence.
set -euo pipefail

[ $# -eq 1 ] && [ -r "$1" ] || { printf 'usage: %s <file>\n' "${0##*/}" >&2; exit 2; }

LC_ALL=C awk '
  # first sentence: cut at . ! ? followed by space or end, not after e.g / i.e
  function first_sentence(s,   i, c, nx, pre) {
    for (i = 1; i <= length(s); i++) {
      c = substr(s, i, 1)
      if (c != "." && c != "!" && c != "?") continue
      nx = substr(s, i + 1, 1)
      if (nx != "" && nx != " ") continue
      pre = tolower(substr(s, (i > 3 ? i - 3 : 1), (i > 3 ? 4 : i)))
      if (pre ~ /(e\.g|i\.e|etc|vs)\.$/ && nx != "") continue
      return substr(s, 1, i)
    }
    return s
  }
  function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
  function plain(s) { gsub(/\*\*/, "", s); return s }
  # a label line such as "Why:" or "Worst case:"
  function is_label(s) { return plain(s) ~ /^[A-Za-z][A-Za-z -]*:/ }
  # text after the colon on line k, plus wrapped continuation lines
  function joined(k,   s, j) {
    s = plain(line[k]); sub(/^[^:]*:/, "", s); s = trim(s)
    for (j = k + 1; j <= n && line[j] !~ /^[ \t]*$/ && line[j] !~ /^#/ && line[j] !~ /^```/ && !is_label(line[j]); j++) s = s " " trim(plain(line[j]))
    return s
  }
  function find(re,   i) {
    for (i = 1; i <= n; i++) if (plain(line[i]) ~ re) return i
    return 0
  }
  function has_arrow(s) {
    if (index(s, "-->") || index(s, "==>") || index(s, "->")) return 1
    return index(s, "[") && index(s, "]") > index(s, "[")
  }
  { sub(/\r$/, ""); line[++n] = $0 }
  END {
    kind = ""
    for (i = 1; i <= n; i++) if (line[i] ~ /^##[ \t]+Impact[ \t]*$/) { src = i; kind = "pr"; break }
    if (!kind) { src = find("^Impact:"); if (src) kind = "commit" }

    t = 0
    for (i = 1; i <= n; i++) {
      if (line[i] ~ /^[ \t]*$/ || line[i] ~ /^[ \t]*<!--.*-->[ \t]*$/) continue
      t = i; break
    }
    # a PR output may lead with its title ("Title: ..." or a bare line)
    if (kind == "pr" && t && t < src && line[t] !~ /^#/) {
      s = plain(line[t]); sub(/^Title:[ \t]*/, "", s); printf "Title: %s\n", trim(s)
    }
    else if (kind == "pr") print "Title: (none, PR body only)"
    else if (t && kind != "pr" && line[t] !~ /^Impact:/) printf "Title: %s\n", trim(line[t])

    imp = ""
    if (kind == "commit") imp = joined(src)
    else if (kind == "pr") {
      for (j = src + 1; j <= n && line[j] ~ /^[ \t]*$/; j++) ;
      if (j <= n && line[j] !~ /^#/ && !is_label(line[j])) { imp = trim(line[j]); j++ }
      while (imp !~ /[.!?]([ ]|$)/ && j <= n && line[j] !~ /^[ \t]*$/ && line[j] !~ /^#/ && line[j] !~ /^```/ && !is_label(line[j])) { imp = imp " " trim(line[j]); j++ }
    } else if (t) {
      for (j = t + 1; j <= n && line[j] ~ /^[ \t]*$/; j++) ;
      if (j <= n) {
        imp = trim(line[j]); j++
        while (imp !~ /[.!?]([ ]|$)/ && j <= n && line[j] !~ /^[ \t]*$/) { imp = imp " " trim(line[j]); j++ }
      }
    }
    if (imp != "") printf "Impact: %s\n", first_sentence(imp)

    if (kind == "pr") { k = find("^Worst case:"); if (k) printf "Worst case: %s\n", joined(k) }
    if (kind == "commit") { k = find("^Risk:"); if (k) printf "Risk: %s\n", first_sentence(joined(k)) }
    k = find("^Decision:"); if (k) printf "Decision: %s\n", joined(k)
    k = find("^Needs:"); if (k) printf "Needs: %s\n", joined(k)

    # map: accepted fence, else indented run with an arrow or node
    infence = 0; prev = ""; s0 = 0
    for (i = 1; i <= n; i++) {
      if (line[i] ~ /^```/) {
        if (infence) { infence = 0 }
        else {
          infence = 1
          if (line[i] ~ /^```(text|mermaid)[ \t]*$/ || prev ~ /^##[ \t]+Impact map[ \t]*$/) { s0 = i; break }
        }
      }
      if (!infence && line[i] !~ /^[ \t]*$/ && line[i] !~ /^```/) prev = line[i]
    }
    if (s0) {
      for (e = s0 + 1; e <= n && line[e] !~ /^```[ \t]*$/; e++) ;
      print "Map:"
      for (i = s0; i <= (e <= n ? e : n); i++) print line[i]
    } else {
      infence = 0
      for (i = 1; i <= n && !s0; i++) {
        if (line[i] ~ /^```/) { infence = !infence; continue }
        if (infence || line[i] !~ /^    [^ \t]/ || line[i] ~ /^    (- |\* )/) continue
        for (e = i; e <= n && line[e] ~ /^    /; e++) if (has_arrow(line[e])) hit = 1
        if (hit) s0 = i; else i = e
        if (hit) { hit = 0; break }
      }
      if (s0) { print "Map:"; for (i = s0; i < e; i++) print line[i] }
    }
  }
' "$1"
