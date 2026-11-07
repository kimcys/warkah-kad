#!/usr/bin/env python3
"""Drops the rules of src/style.css (and cards.css) whose class names no script can produce.
Usage: python3 scripts/prune-css.py [--write]   (without --write it only reports)
A class counts as used when it appears as a word inside any string of src/**/*.js, or when a string ends with a prefix of it (class names built
from pieces, like "cd-pv-" + state). Rules with no class (element, :root, @font-face, ids) are always kept; @keyframes are kept when a kept rule names them."""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
js = "\n".join(p.read_text() for p in (root / "src").rglob("*.js"))
js += "\n" + (root / "index.html").read_text()
words = set(re.findall(r"[A-Za-z_][\w-]*", js))
prefixes = {w for w in words if w.endswith("-") and len(w) >= 3}
def used(c): return c in words or any(c.startswith(p) for p in prefixes)

def split_top(css):
    """Top-level chunks: comments, at-rules with blocks, rules, and at-rules without blocks."""
    out, i, n = [], 0, len(css)
    while i < n:
        if css.startswith("/*", i):
            j = css.index("*/", i) + 2; out.append(("comment", css[i:j])); i = j; continue
        if css[i].isspace(): i += 1; continue
        j = i; depth = 0
        while j < n:
            ch = css[j]
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0: j += 1; break
            elif ch == ";" and depth == 0: j += 1; break
            elif css.startswith("/*", j): j = css.index("*/", j) + 1
            j += 1
        out.append(("rule", css[i:j].strip())); i = j
    return out

def keep_rule(text):
    head = text[:text.index("{")] if "{" in text else text
    if head.lstrip().startswith("@"):
        return True
    selectors = [s for s in re.split(r",(?![^()]*\))", head) if s.strip()]
    for s in selectors:
        classes = re.findall(r"\.([A-Za-z_][\w-]*)", re.sub(r"\[[^\]]*\]|\"[^\"]*\"|\([^)]*\)", "", s))
        if all(used(c) for c in classes): return True
    return False

def prune(css):
    kept, dropped = [], 0
    for kind, text in split_top(css):
        if kind == "comment": kept.append(text); continue
        head = text[:text.index("{")] if "{" in text else text
        m = re.match(r"@(media|supports|layer)\b", head.strip())
        if m and "{" in text:
            inner = text[text.index("{") + 1: text.rindex("}")]
            body, d = prune(inner); dropped += d
            if body.strip(): kept.append(head.strip() + " {\n" + body + "\n}")
            else: dropped += 1
        elif keep_rule(text): kept.append(text)
        else: dropped += 1
    return "\n".join(kept), dropped

def tidy(css):
    css = re.sub(r"\n{3,}", "\n\n", css)
    # drop comments that now sit in front of another comment or at the end (their rules were removed)
    parts = re.split(r"(/\*.*?\*/)", css, flags=re.S)
    return css

def drop_unused_keyframes(css):
    names = set(re.findall(r"animation(?:-name)?\s*:[^;{}]*", css))
    used_names = set(re.findall(r"[A-Za-z_][\w-]*", " ".join(names)))
    def sub(m):
        return m.group(0) if m.group(1) in used_names else ""
    return re.sub(r"@keyframes\s+([\w-]+)\s*\{(?:[^{}]|\{[^{}]*\})*\}", sub, css)

total_before = total_after = 0
for name in ["style.css", "cards.css"]:
    p = root / "src" / name
    before = p.read_text()
    after, dropped = prune(before)
    after = drop_unused_keyframes(after)
    after = re.sub(r"(/\*(?:(?!\*/).)*\*/)\s*(?=/\*|\Z)", "", after, flags=re.S)   # a comment left with nothing after it
    after = tidy(after).strip() + "\n"
    print(f"{name}: {len(before.splitlines())} -> {len(after.splitlines())} lines, {dropped} rules dropped")
    total_before += len(before); total_after += len(after)
    if "--write" in sys.argv: p.write_text(after)
print(f"{total_before//1024} KB -> {total_after//1024} KB")
