You are writing a {{WHAT}} for a change in a git repository.

Repository: {{REPO}}
State: {{STATE}}

Rules:
- Work only inside {{REPO}}{{SKILL_DIR_NOTE}}. Do not read any other path on this machine.
- Base the text on the real diff. Do not run `gh`, do not commit, do not push.
- Write the final text, and nothing else, to {{OUT}}.
{{SKILL_STEPS}}
When {{OUT}} is written, reply with the single word: done
