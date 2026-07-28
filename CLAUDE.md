# CLAUDE.md

Escape Work is a code-first PlayCanvas CRPG. `ARCHITECTURE.md` owns the map of
the code and the one rule (content is data, code is systems). This file owns
the process rules — chiefly: how design intent gets discovered, recorded, and
promoted to doctrine.

## Intent is discovered, not presumed

The failure mode this file exists to prevent: a plan document needs a design
answer, guesses one, labels the guess a "design decision" — and from then on
every later document and every implementation cites it as settled doctrine.
The designer never said it. Nobody asked.

Every design decision in a plan doc is one of three things, and the doc must
say which:

- **`[stated]`** — the designer said it. Cite where (task text, issue, PR
  comment) and keep their wording nearby; don't paraphrase intent into
  something stronger than what was said.
- **`[ratified]`** — the doc proposed it and the designer explicitly approved
  that proposal (a comment, an answer to a question, "yes, do that"). Merging
  a PR ratifies what the PR *does*; it does not ratify every presumption in a
  plan doc that rode along in the same diff.
- **`[proposed]`** — the doc's best guess, awaiting a verdict. A proposal is a
  question wearing a decision's clothes: it must name the question it stands
  in for and what changes in the plan if the real answer differs.

Untagged decisions in the pre-existing plan docs are `[proposed]`, unless the
shipped, played game already embodies them.

## Ask first, and ask well

Before writing or materially extending a plan doc, work out which questions
would change the plan's *shape* — scope, feel, what v1 must prove, what gets
cut — and put them to the designer.

- **Interactive session:** ask up front, before the plan hardens around
  guesses. Batch them once — roughly 3–6 questions, not a drip.
- **Autonomous session (nobody to ask mid-task):** don't block, and don't
  silently decide either. Write the plan with the guesses tagged
  `[proposed]`, and surface the questions in a **"Questions for the
  designer"** section at the TOP of the plan doc *and* at the top of the
  reply / PR description. Bottom-of-doc questions never get answered.

The quality bar for a question:

- Ask only what the code, the shipped game, and the existing
  `[stated]`/`[ratified]` record cannot answer.
- Ask what changes the design's shape. Don't ask preference trivia with a
  cheap, reversible default — pick the default, tag it `[proposed]`, move on.
- Every question carries options, the consequence of each, and a
  recommendation first. "What do you want here?" is not a question;
  "A or B — A costs X, B costs Y, I'd pick A because Z" is.

## Inheriting decisions across documents

When a plan cites a decision from another plan, it inherits the *status*, not
just the conclusion. A `[proposed]` decision elsewhere is still a question —
re-surface it; don't launder it into doctrine by citation. Two docs agreeing
with each other is not the designer agreeing with either.

When implementing, check status before enforcing. `[stated]` and `[ratified]`
are load-bearing: implement them faithfully, or raise a flag if they've become
wrong. `[proposed]` bends: if the designer's visible direction — comments,
recent asks, the things they keep changing — fights a proposal, the proposal
loses. Re-open it; don't defend it.

## The ratification loop

When the designer answers a question or reacts to a proposal, close the loop
in the doc, not just in the chat:

- Flip the tag (`[proposed]` → `[ratified]`) and record the answer in the
  designer's terms, citing where they said it.
- When they contradict a proposal, rewrite the decision — don't argue the
  doc's case. The doc serves the design; it is not precedent to defend.
- "Risks and open questions" stays for engineering unknowns. Intent questions
  live in "Questions for the designer" until answered, then move into the
  decisions table wearing their new tag.
