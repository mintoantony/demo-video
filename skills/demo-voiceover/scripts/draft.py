"""Wording rules for the draft narration (stdlib only). Everything here is deterministic:
the same results.json always gives the same draft, and every line is shortened to fit its slot
(by dropping clauses) before it is allowed to overflow."""
import re

WORDS_PER_SEC = 2.5
SOFT = {"the", "a", "an", "this", "these", "those", "it", "each", "every", "both", "all", "your",
        "their", "there", "its", "nothing", "no"}
VERBISH = re.compile(
    r"\b(is|are|was|were|be|appears?|opens?|shows?|says?|goes|go|moves?|turns?|reaches|holds?|lists?|"
    r"displays?|returns?|stays?|becomes?|has|have|can|will|sends?|waits?|reads?|changes?|switches|gets?|"
    r"gains?|loads?|updates?|contains?|remains?|looks?|lands?|signed|submitted|sent|saved)\b", re.I)
MIDDLE = ["Next", "Now", "Then"]


def words(s):
    return len(re.findall(r"\S+", s))


def fits(text, budget):
    return words(text) / WORDS_PER_SEC <= budget


def max_words(budget):
    """Word budget for a slot of budgetSec seconds at 2.5 words/s."""
    return int(budget * WORDS_PER_SEC + 1e-9)


def lower_first(s):
    """Lower the first letter only for plain words (The, A, It...), never for names or product terms."""
    w = s.split(" ", 1)[0]
    return s[:1].lower() + s[1:] if w.lower() in SOFT else s


def lower_verb(s):
    """The label starts with a capitalised imperative verb; lower it unless it looks like a name or acronym."""
    w = s.split(" ", 1)[0]
    if len(w) > 1 and w[1:].islower():
        return s[:1].lower() + s[1:]
    return s


def sentence(s):
    s = s.strip().rstrip(".!?").strip()
    return (s[:1].upper() + s[1:] + ".") if s else ""


def cut_clauses(text, budget):
    """Last resort: drop trailing sentences, then trailing clauses, then trailing words."""
    sents = [x for x in re.split(r"(?<=\.)\s+", text.strip()) if x]
    while len(sents) > 1 and not fits(" ".join(sents), budget):
        sents.pop()
    t = " ".join(sents)
    cl = [c for c in re.split(r"(?<=[,;:])\s+|\s+(?=(?:and|but|so|because|while|which|to show)\b)", t.rstrip(".")) if c]
    while len(cl) > 1 and not fits(" ".join(cl).rstrip(",;:") + ".", budget):
        cl.pop()
    t = " ".join(cl).rstrip(",;:. ") + "."
    if not fits(t, budget):
        t = " ".join(t.rstrip(".").split()[:max(max_words(budget), 1)]).rstrip(",;:") + "."
    return t


def fit(cands, budget):
    """First candidate that fits the slot, else the shortest one cut down by dropping clauses."""
    cands = [re.sub(r"\s+", " ", c).strip() for c in cands if c and c.strip()]
    for c in cands:
        if fits(c, budget):
            return c
    return cut_clauses(min(cands, key=words), budget)


def action_text(s):
    """The label is an imperative ('Open the sign-in screen'); 'we' takes the same verb form."""
    label = s["label"].strip().rstrip(".")
    return sentence("We " + lower_verb(label)) if label else ""


def expect_text(s):
    e = s["expect"].strip().rstrip(".")
    if not e:
        return ""
    if VERBISH.search(e):
        return sentence(e)
    return sentence("We see " + lower_first(e))      # a fragment such as "A list of people"


def step_text(s, budget, style="plain"):
    label = s["label"].strip().rstrip(".")
    seen = (s.get("seen") or "").strip().rstrip(".")
    act, exp = action_text(s), expect_text(s)
    st = s["status"]
    if st == "PASS":
        c = [act + " " + exp, exp, act] if style == "plain" else [exp, act]
    elif st == "DIFFERENT":
        e0 = lower_first(s["expect"].strip().rstrip("."))
        c = [f"{act} It did not go as expected. We expected {e0}, but we saw: {seen}.",
             f"We expected {e0}, but we saw: {seen}.",
             f"Not as expected. We saw: {seen}.", f"Not as expected: {seen}."]
    elif st == "COULD NOT DO":
        c = [f"We could not {lower_verb(label)}. {seen}.", f"We could not do this. {seen}.",
             "We could not do this step."]
    else:
        c = [f"{act} {seen or exp}"]
    return fit(c, budget)


def drop_object(title):
    """'Sign in as George' -> 'Sign in'."""
    return re.sub(r"\s+(as|with|for|from|into|on)\s+[A-Z][\w' -]*$", "", title)


def lead_text(ci, n, ch, prev_actor, budget, style="plain"):
    conn = "First" if ci == 1 else ("Finally" if ci == n and n > 2 else MIDDLE[(ci - 2) % len(MIDDLE)])
    title = ch["title"].strip().rstrip(".")
    short = title if not title[:1].isupper() else title[:1].lower() + title[1:]
    if re.match(r"[A-Z][A-Z0-9]", title):     # acronym or product name: keep as written
        short = title
    last = re.sub(r"\W+$", "", short.split()[-1]) if short.split() else short
    c = [f"{conn}, {short}.", f"{conn}, {drop_object(short)}.", f"{conn}, the {last}.", f"{conn}, {last}."]
    text = fit(c, budget)
    actor = ch.get("actor")
    if style == "plain" and actor and prev_actor is not None and actor != prev_actor:
        name = re.sub(r"\s*\(.*?\)\s*", "", actor).strip()
        if fits(text + f" As {name}.", budget):
            text += f" As {name}."
    return text


def intro_text(title, sub, budget):
    t = title.strip().rstrip(".").replace(": ", ", ")
    s1 = re.split(r"(?<=[.!?])\s+", sub.strip())[0].rstrip(".") if sub.strip() else ""
    c = [f"{t}. {s1}." if s1 else f"{t}.", f"{t}."]
    return fit(c, budget)


def closing_text(title, n, bad, passed, budget):
    t = title.strip().rstrip(".").replace(": ", ", ")
    if bad:
        c = [f"That completes {t}. {passed} of {n} steps went as expected, and {bad} did not.",
             f"That completes the walkthrough. {passed} of {n} steps went as expected, and {bad} did not.",
             f"{passed} of {n} steps went as expected, and {bad} did not.",
             f"{bad} of {n} steps did not go as expected."]
    else:
        c = [f"That completes {t}. All {n} steps went as expected.",
             f"That completes the walkthrough. All {n} steps went as expected.",
             f"All {n} steps went as expected.", "That completes the walkthrough."]
    return fit(c, budget)
