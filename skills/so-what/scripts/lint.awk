function rank(level) { return level == "high" ? 3 : level == "medium" ? 2 : level == "low" ? 1 : 0 }
function fail(message) { printf "%s: %s\n", FILENAME, message; failures++ }
function trim(text) { gsub(/^[ \t]+|[ \t]+$/, "", text); return text }
function words(text,    parts) { return split(trim(text), parts, /[ \t]+/) }
function bare(token) { gsub(/^[][(`"']+|[])`"',.;:!?]+$/, "", token); return token }

# Label lines: "Label: value" or "**Label:** value". names is "A|B|C".
# Sets parsed_label and parsed_rest; returns 1 on a match.
function parse_label(line, names,    name, rest) {
  if (line ~ /^\*\*[A-Za-z ]+:\*\*/) { name = substr(line, 3); name = substr(name, 1, index(name, ":") - 1); rest = substr(line, index(line, ":**") + 3) }
  else if (match(line, /^[A-Za-z ]+:/)) { name = substr(line, 1, RLENGTH - 1); rest = substr(line, RLENGTH + 1) }
  else return 0
  if (!index("|" names "|", "|" name "|")) return 0
  parsed_label = name
  parsed_rest = rest
  sub(/^[ \t]+/, "", parsed_rest)
  return 1
}

# A field continues only on indented lines; any other line ends it.
function continues(line) { return line ~ /^[ \t]+[^ \t]/ }

function check_subject(subject) {
  if (subject !~ /^(feat|fix|docs|ci|build|chore|refactor|perf|test|style|revert)(\([a-z0-9._\/-]+\))?!?: [^ ]/)
    fail("subject must be '<type>(<scope>): <outcome>' with a conventional type and lowercase scope")
  if (length(subject) > 72) fail("subject is " length(subject) " bytes; limit is 72")
  if (subject ~ /\.$/) fail("subject must not end with a period")
  check_negatives("subject", subject)
}

function file_token(text,    tokens, count, i, token) {
  count = split(text, tokens, /[ \t]+/)
  for (i = 1; i <= count; i++) {
    token = bare(tokens[i])
    if (token ~ /^[A-Z][A-Za-z]*\.js$/) continue
    if (token ~ /\.(sh|bash|py|ts|tsx|js|mjs|cjs|jsx|yml|yaml|json|toml|md|mdx|tsv|csv|awk|txt|lock|cfg|ini|sql|html|css|go|rs|rb|java|kt|swift|env)$/) return token
    if (token ~ /^(Dockerfile|Makefile|Justfile)$/) return token
  }
  return ""
}

function check_impact(label, text,    opener, named) {
  text = trim(text)
  if (text == "") { fail(label " is missing or empty"); return }
  if (words(text) < minimum_words) fail(label " has " words(text) " words; write at least " minimum_words " about the consequence")
  if (words(text) > maximum_words) fail(label " has " words(text) " words; limit is " maximum_words ", cut to the consequence a reader needs to decide")
  lead = text
  sub(/[.!?]([ \t]|$).*/, "", lead)
  if (words(lead) > lead_words) fail(label " first sentence has " words(lead) " words; limit is " lead_words ", make it the whole point")
  opener = tolower(bare(substr(text, 1, index(text " ", " ") - 1)))
  check_negatives(label, text)
  if (opener in edit_verbs) fail(label " opens with an edit verb (" opener "); open with who or what is affected")
  named = file_token(text)
  if (named != "") fail(label " names a file (" named "); files are diff, impact is behavior")
}

# Forced negatives: contrast and negation framing instead of stating what is true now.
function check_negatives(label, text,    n, parts, i, sentence) {
  n = split(text, parts, /[.!?]+([ \t]|$)/)
  for (i = 1; i <= n; i++) {
    sentence = " " tolower(parts[i]) " "
    gsub(/[^a-z']+/, " ", sentence)
    if (sentence ~ / not .* but / || index(sentence, " not just ") || index(sentence, " not only ") ||
        index(sentence, " no longer ") || index(sentence, " instead of ") || index(sentence, " rather than ") ||
        index(sentence, " isn't ") || index(sentence, " it's not ") || sentence ~ /^ (no|not|never) /) {
      fail(label ": forced negative: state what is true now")
      return
    }
  }
}

function level_of(text,    level) {
  level = tolower(trim(text))
  sub(/[^a-z].*/, "", level)
  return level
}

function max_rank(a, b) { return a > b ? a : b }

# Label lines (Decision:, Needs:) share one limit: 25 words.
function check_label_words(label, text, limit) {
  text = trim(text)
  if (text == "") fail(label " is empty")
  else if (words(text) > limit) fail(label " has " words(text) " words; limit is " limit)
  check_negatives(label, text)
}

# At high risk a Decision or Needs of "none" hides a real decision.
function check_not_none(label, text, risk_rank) {
  if (risk_rank >= 3 && tolower(trim(text)) ~ /^none([^a-z]|$)/) fail(label " says none at high risk; state what the reader must decide")
}

function rollback_ok(text) {
  text = tolower(trim(text))
  sub(/\.$/, "", text)
  return text == "revert" || text ~ /^revert \+ [^ ]/ || text ~ /^irreversible: [^ ]/
}

function check_rollback(label, text) {
  if (trim(text) == "") fail(label " is required at high risk: revert, revert + <extra step>, or irreversible: <what is lost>")
  else if (!rollback_ok(text)) fail(label " must start with 'revert', 'revert + <extra step>', or 'irreversible: <what is lost>'")
}

function check_not_verified(label, text) {
  text = tolower(text)
  if (index(text, "not verified") && !index(text, "owner:")) fail(label " says not verified at high risk but names no 'owner:' who runs the check before merge")
}

function check_invariants(label, text,    i) {
  text = tolower(text)
  for (i = 1; i <= inv_count; i++)
    if (!index(text, tolower(inv_name[i]))) fail(label " must name the touched invariant '" inv_name[i] "'")
}

function check_level(label, text,    level) {
  level = level_of(text)
  if (rank(level) == 0) { fail(label " must start with low, medium, or high"); return }
  if (rank(level) < rank(floor)) fail(label " is " level " but facts.sh rates the change " floor "; never rate below the facts")
}

# ASCII impact map: who is affected, joined by arrows to what now differs.
# map_line[1..map_count] hold the raw lines; map_at[] the file line numbers.
function map_fail(message) { fail("impact map: " message) }

function map_char(row, col,    ch) {
  if (row < 1 || row > map_count) return " "
  ch = substr(map_line[row], col, 1)
  return ch == "" ? " " : ch
}

function count_nodes(text, re,    count) {
  count = 0
  while (match(text, re)) { count++; text = substr(text, RSTART + RLENGTH) }
  return count
}

function map_nodes(text) {
  return count_nodes(text, "\\[[^]]*[A-Za-z][^]]*\\]") + count_nodes(text, "\\([^)]*[A-Za-z][^)]*\\)") + count_nodes(text, "\\|[^|]*[A-Za-z][^|]*\\|")
}

function check_map(    row, col, ch, text, arrows, nodes, wide, opens, closes) {
  if (map_count < 2 || map_count > 12) map_fail("has " map_count " lines; use 2 to 12")
  for (row = 1; row <= map_count; row++) {
    text = map_line[row]
    if (text ~ /[^ -~]/) map_fail("line " map_at[row] " has a tab or non-ASCII character; use plain ASCII (+ - | > v) only")
    if (length(text) > 72) map_fail("line " map_at[row] " is " length(text) " characters; limit is 72")
    if (text ~ /(-+|=+)>/ || text ~ /^[ ]*v[ ]*$/) arrows++
    nodes += map_nodes(text)
    opens = gsub(/\[/, "[", text); closes = gsub(/\]/, "]", text)
    if (opens != closes) map_fail("line " map_at[row] " has unbalanced [ ]")
    opens = gsub(/\(/, "(", text); closes = gsub(/\)/, ")", text)
    if (opens != closes) map_fail("line " map_at[row] " has unbalanced ( )")
    for (col = 1; col <= length(map_line[row]); col++) {
      ch = substr(map_line[row], col, 1)
      if (ch == "|" && index("|+v^", map_char(row - 1, col)) == 0 && index("|+v^", map_char(row + 1, col)) == 0)
        map_fail("line " map_at[row] ", column " col ": '|' has nothing above or below it; box walls are misaligned")
      if (ch == "+" && (map_char(row, col - 1) ~ /[-=]/ || map_char(row, col + 1) ~ /[-=]/) &&
          index("|+v^", map_char(row - 1, col)) == 0 && index("|+v^", map_char(row + 1, col)) == 0)
        map_fail("line " map_at[row] ", column " col ": box corner '+' has no wall above or below it")
    }
  }
  if (arrows < 1) map_fail("needs at least one arrow (-->, ==>, ->, or v under |; '<- changed' alone is not one) showing cause and effect")
  if (nodes < 2) map_fail("needs at least 2 labeled nodes ([who], [what changes], or boxes) joined by an arrow")
  text = ""
  for (row = 1; row <= map_count; row++) text = text " " map_line[row]
  wide = file_token(text)
  if (wide != "") map_fail("names a file (" wide "); nodes name who or what behaves differently, not files")
}

# Mermaid impact map (pull requests only): mechanical checks; mmdc parses it when installed.
function check_mermaid(    row, text, all, arrows, shown, first_line, named) {
  shown = 0
  for (row = 1; row <= map_count; row++) {
    text = trim(map_line[row])
    if (text == "") continue
    shown++
    if (shown == 1) first_line = text
    all = all " " text
    if (text ~ /(-->|->>|---|==>)/) arrows++
    if (first_line ~ /^sequenceDiagram/ && shown > 1 && text ~ /:.*;/) map_fail("line " map_at[row] ": ';' inside sequence message text breaks the parser")
  }
  if (first_line !~ /^(sequenceDiagram|(flowchart|graph) (TD|TB|BT|RL|LR))[ \t]*;?$/)
    map_fail("mermaid must start with 'sequenceDiagram', 'flowchart <TD|TB|BT|RL|LR>', or 'graph <dir>'")
  if (shown < 2 || shown > 15) map_fail("mermaid has " shown " non-blank lines; use 2 to 15")
  if (arrows < 1) map_fail("mermaid needs at least one arrow (-->, ->>, -->>, ---, ==>)")
  named = file_token(all)
  if (named != "") map_fail("names a file (" named "); nodes name who or what behaves differently, not files")
}

BEGIN {
  failures = 0
  minimum_words = (kind == "pr" || kind == "plan") ? 20 : 8
  maximum_words = (kind == "pr" || kind == "plan") ? 70 : 45
  inv_count = split(ENVIRON["SO_WHAT_LINT_INVARIANTS"], inv_name, "\n")
  lead_words = 30
  start_marker = "<!-- so-what:start -->"
  end_marker = "<!-- so-what:end -->"
  verb_count = split("add adds added adding update updates updated updating change changes changed changing " \
    "modify modifies modified modifying edit edits edited editing bump bumps bumped bumping " \
    "touch touches touched touching tweak tweaks tweaked tweaking refactor refactors refactored refactoring " \
    "remove removes removed removing rename renames renamed renaming move moves moved moving " \
    "delete deletes deleted deleting create creates created creating introduce introduces introduced introducing " \
    "replace replaces replaced replacing implement implements implemented implementing " \
    "fix fixes fixed fixing drop drops dropped dropping enable enables enabled enabling " \
    "disable disables disabled disabling switch switches switched switching migrate migrates migrated migrating " \
    "convert converts converted converting extract extracts extracted extracting " \
    "rewrite rewrites rewrote rewritten rewriting adjust adjusts adjusted adjusting " \
    "improve improves improved improving enhance enhances enhanced enhancing", verb_list, " ")
  for (i = 1; i <= verb_count; i++) edit_verbs[verb_list[i]] = 1
}

{ sub(/\r$/, ""); lines[++count] = $0 }

END {
  if (count == 0) { fail("file is empty"); exit 1 }

  if (kind == "subject") { check_subject(lines[1]); exit (failures > 0) }

  if (kind == "commit") {
    check_subject(lines[1])
    if (count > 1 && lines[2] != "") fail("line 2 must be blank")
    current = ""
    for (i = 2; i <= count; i++) {
      if (length(lines[i]) > 72 && lines[i] !~ /https?:\/\//) fail("line " i " is " length(lines[i]) " bytes; wrap body at 72")
      if (lines[i] ~ /^[ \t]*```/) fail("line " i ": commits take an indented ASCII impact map, not a code fence or mermaid")
      if (parse_label(lines[i], "Why|Impact|Needs|Risk|Rollback")) {
        label = parsed_label
        if (label in field) fail(label ": appears twice")
        if (!("Impact" in field) && label != "Impact") fail(label ": appears before Impact:; Impact comes first")
        if (label == "Why" && ("Risk" in field)) fail("Why: appears after Risk:; order is Impact, Why, Risk")
        if (label == "Rollback" && !("Risk" in field)) fail("Rollback: appears before Risk:; it follows Risk:")
        field[label] = parsed_rest
        current = label
      } else if ((current == "Needs" || current == "Rollback") && !continues(lines[i])) {
        current = ""
        if (lines[i] == "") { if (map_count > 0) map_closed = 1 }
        else if (lines[i] ~ /^    [^ ]/ && !map_closed) { map_line[++map_count] = lines[i]; map_at[map_count] = i }
      } else if (lines[i] == "") {
        current = ""
        if (map_count > 0) map_closed = 1
      } else if (current == "" && lines[i] ~ /^    [^ ]/ && !map_closed) {
        map_line[++map_count] = lines[i]; map_at[map_count] = i
      } else if (current == "" && lines[i] ~ /^    /) {
        fail("line " i ": a second indented block; commits carry one impact map")
      } else if (current != "") {
        field[current] = field[current] " " trim(lines[i])
      }
    }
    declared = ("Risk" in field) ? level_of(field["Risk"]) : ""
    effective = max_rank(rank(floor), rank(declared))
    check_impact("Impact:", field["Impact"])
    if ("Needs" in field) {
      check_label_words("Needs:", field["Needs"], 25)
      check_not_none("Needs:", field["Needs"], effective)
    } else if (effective >= 3) fail("Needs: is required at high risk; state what the reader must decide or do")
    if (map_count > 0) check_map()
    else if (rank(floor) >= 2) fail("impact map: missing; at " floor " risk add an indented ASCII map after Risk:, after a blank line")
    if (rank(floor) >= 2 && trim(field["Why"]) == "") fail("Why: is required at " floor " risk")
    if ("Risk" in field) check_level("Risk:", field["Risk"])
    else if (rank(floor) >= 2) fail("Risk: is required at " floor " risk")
    if (effective >= 3) {
      check_rollback("Rollback:", field["Rollback"])
      check_not_verified("Risk:", field["Risk"])
    }
    check_invariants("Risk: or Rollback:", field["Risk"] " " field["Rollback"])
    exit (failures > 0)
  }

  first = 1; while (first <= count && trim(lines[first]) == "") first++
  last = count; while (last >= 1 && trim(lines[last]) == "") last--
  if (trim(lines[first]) != start_marker) fail("first line must be " start_marker)
  if (trim(lines[last]) != end_marker) fail("last line must be " end_marker)

  fence = ""
  section = ""
  in_details = 0
  for (i = first + 1; i < last; i++) {
    line = lines[i]
    if (trim(line) == start_marker || trim(line) == end_marker) fail("line " i ": markers must appear exactly once")
    if (line ~ /^[ \t]*```/) {
      if (fence == "") {
        if (section == "Impact map") {
          if (map_count > 0) fail("line " i ": ## Impact map holds one fenced diagram")
          fence = "map"
          if (line ~ /^[ \t]*```mermaid/) {
            map_mermaid = 1
            if (kind != "pr") fail("line " i ": mermaid impact maps are for pull requests; use a ```text fence")
          }
        } else fence = "code"
        body[section] = body[section] " " fence
      } else fence = ""
      continue
    }
    if (fence == "map") { map_line[++map_count] = line; map_at[map_count] = i; continue }
    if (fence == "code") continue
    # HTML tag lines (<details>, <summary>...</summary>, </details>) are not prose.
    if (line ~ /^[ \t]*<\/?[a-z]+[^>]*>([^<]*<\/[a-z]+>)?[ \t]*$/) {
      tag = trim(line)
      if (tag ~ /^<details/) {
        details_seen++
        if (in_details) fail("line " i ": nested <details>")
        in_details = 1
        section = ""
      } else if (tag ~ /^<\/details>/) {
        if (!in_details) fail("line " i ": </details> without an opening <details>")
        else if (trim(lines[i - 1]) != "") fail("line " i ": leave a blank line before </details> so GitHub renders the markdown")
        in_details = 0
        details_closed++
        section = ""
      } else if (tag ~ /^<summary/ && trim(lines[i + 1]) != "") {
        fail("line " i ": leave a blank line after </summary> so GitHub renders the markdown")
      }
      continue
    }
    if (line ~ /^## /) {
      section = trim(substr(line, 4))
      if (section ~ /^Risk:/) { risk_heading = substr(section, 6); section = "Risk" }
      if (section in position) fail("section '" section "' appears twice")
      position[section] = ++order
      inside[section] = in_details
      impact_field = ""
      in_rollback = 0
      in_item = 0
      continue
    }
    if (section == "Impact") {
      if (parse_label(line, "Decision|Worst case")) {
        impact_field = parsed_label
        if (parsed_label == "Decision") { decision_seen = 1; decision = parsed_rest; decision_order = ++label_order }
        else { worst_seen = 1; worst = parsed_rest; worst_order = ++label_order }
        prose_words += words(line)
        continue
      }
      if (impact_field != "" && continues(line)) {
        if (impact_field == "Decision") decision = decision " " trim(line)
        else worst = worst " " trim(line)
        prose_words += words(line)
        continue
      }
      impact_field = ""
      if (trim(line) != "" && worst_seen && !decision_seen) prose_since_worst = 1
    }
    if (section == "Risk") {
      if (parse_label(line, "Rollback")) { rollback_seen = 1; rollback = parsed_rest; in_rollback = 1 }
      else if (in_rollback && continues(line)) rollback = rollback " " trim(line)
      else in_rollback = 0
    }
    if (section != "") body[section] = body[section] " " trim(line)
    if (section == "Risk" && line ~ /^[ \t]*\|/ && line !~ /^[ \t]*\|[ \t:|-]*$/) {
      split(line, risk_cells, /\|/)
      area = trim(risk_cells[2]); level = trim(risk_cells[3]); consequence = trim(risk_cells[4])
      if (area != "" && level != "" && consequence != "") {
        if (tolower(area) == "area" && tolower(level) == "risk") risk_header = 1
        else risk_rows++
      }
    }
    if (section == "Verification" || section == "Verification plan") {
      if (line ~ /^[ \t]*[-*] [^ ]/) { verification_items++; ver_n++; ver_item[ver_n] = line; in_item = 1 }
      else if (in_item && trim(line) != "") ver_item[ver_n] = ver_item[ver_n] " " trim(line)
      else in_item = 0
    }
    if (line !~ /^[ \t]*\|/) prose_words += words(line)
  }
  if (fence != "") fail("code fence is not closed")
  if (in_details) fail("<details> is not closed; add </details> before the end marker")
  if (kind == "pr" && details_seen == 0) fail("missing <details>; Why, Risk, and Verification go inside <details><summary>Why, risk, verification</summary>")

  declared = ("Risk" in position) ? level_of(risk_heading) : ""
  effective = max_rank(rank(floor), rank(declared))

  if (kind == "plan") { required[1] = "Plan"; required[2] = "Risk"; required[3] = "Verification plan"; required_count = 3 }
  else required_count = split("Impact Why Risk Verification", required, " ")
  previous = 0
  for (i = 1; i <= required_count; i++) {
    name = required[i]
    if (!(name in position)) { fail("missing section '## " (name == "Risk" ? "Risk: <level>" : name) "'"); continue }
    if (position[name] < previous) fail("section '" name "' is out of order; required order is " (kind == "plan" ? "Plan, Risk, Verification plan" : "Impact, Why, Risk, Verification"))
    previous = position[name]
  }
  lead_name = kind == "plan" ? "Plan" : "Impact"
  if ((lead_name in position) && position[lead_name] != 1) fail("first section must be '## " lead_name "'")
  for (name in position) if (trim(body[name]) == "") fail("section '" name "' is empty; omit optional sections instead")
  if (prose_words > 200) fail("recap has " prose_words " words outside tables, code, diagrams, and HTML tag lines; limit is 200, aim for 120")
  if (("Risk" in position) && kind == "pr" && (!risk_header || risk_rows < 1)) fail("## Risk: needs a table with a header and at least one area row")
  if (verification_items < 1) fail("## " (kind == "plan" ? "Verification plan" : "Verification") " needs at least one '- ' item: a check and its result, or 'Not verified: ...'")
  if (("Impact map" in position) && map_count == 0) fail("impact map: ## Impact map needs a fenced diagram (```text ASCII by default)")
  if (map_count > 0) { if (map_mermaid) check_mermaid(); else check_map() }
  else if (kind == "pr" && rank(floor) >= 2) fail("impact map: missing; at " floor " risk add '## Impact map' with an ASCII diagram right after Impact")
  if (("Impact map" in position) && position["Impact map"] != 2) fail("## Impact map must come directly after ## " lead_name)
  if (lead_name in position) check_impact("## " lead_name, body[lead_name])
  if ("Risk" in position) check_level("## Risk:", risk_heading)

  if (kind == "pr") {
    for (name in position) {
      if (details_seen == 0) break
      if ((name == "Impact" || name == "Impact map") && inside[name]) fail("section '" name "' belongs above <details>, where the reader sees it first")
      if (name != "Impact" && name != "Impact map" && !inside[name]) fail("section '" name "' belongs inside <details>; only Impact and Impact map stay visible")
    }
    if (worst_seen) check_label_words("Worst case:", worst, 20)
    else if (effective >= 2) fail("Worst case: is required at " (effective >= 3 ? "high" : "medium") " risk; add a 'Worst case:' line directly before Decision:")
    if (worst_seen && decision_seen && (worst_order > decision_order || prose_since_worst)) fail("Worst case: must come directly before Decision:")
    if (decision_seen) { check_label_words("Decision:", decision, 25); check_not_none("Decision:", decision, effective) }
    else if (effective >= 2) fail("Decision: is required at " (effective >= 3 ? "high" : "medium") " risk; add a 'Decision:' line to ## Impact (what the reviewer must decide before merge)")
    if (effective >= 3) {
      if (rollback_seen) check_rollback("Rollback:", rollback)
      else fail("Rollback: is required at high risk; add a 'Rollback:' line to ## Risk")
      for (i = 1; i <= ver_n; i++) check_not_verified("Verification item " i, ver_item[i])
    }
    check_invariants("## Risk", body["Risk"])
  }
  exit (failures > 0)
}
