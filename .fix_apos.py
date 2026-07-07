import re

with open('src/lib/prompts.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find lines inside EN template strings (single-quoted) with unescaped apostrophes
# An apostrophe is unescaped if it's not preceded by backslash
# and it's inside a single-quoted string

fixed = 0
for i, line in enumerate(lines):
    stripped = line.strip()
    # Only process lines that are inside a single-quoted string (start with spaces then content)
    if not stripped.startswith("'"):
        continue
    # Check for unescaped apostrophes
    new_line = re.sub(r"(?<!\\)'([a-z])", lambda m: "\\'" + m.group(1), line)
    if new_line != line:
        print(f"Line {i+1}: fixed unescaped apostrophe")
        lines[i] = new_line
        fixed += 1

print(f"Total fixes: {fixed}")

with open('src/lib/prompts.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)
