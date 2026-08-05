---
status: auditing
source_type: idea | notes | draft-prompt | existing-prompt
---

# Agent Domain Framing Record

## Source Material

The original agent idea, notes, request, or prompt being analyzed.

## Source Summary

- Apparent task:
- Apparent operational role:
- Object of work:
- Intended transformation:
- Apparent end state:
- Intended users or stakeholders:
- Known constraints:
- Existing terminology:
- Implementation context:
- Explicit user requirements:

## Initial Audit

### Current Interpretation

A concise account of what the source appears to describe.

### Material Ambiguities

Questions whose answers could change the agent's role, domain, scope,
workflow, completion state, or vocabulary.

### Embedded Assumptions

Assumptions currently being made but not yet established by the user or
external evidence.

### Terminology Requiring Verification

Terms that may be vague, overloaded, noncanonical, platform-specific, or
incorrectly applied.

## Research Log

| ID | Research question | Source | Finding | Confidence | Effect on framing |
|----|-------------------|--------|---------|------------|-------------------|

Research belongs here when it changes the interpretation, candidate framings,
or vocabulary. General background collected without consequence should be
excluded.

## Candidate Framings

### F-01: Candidate Name

**Status:** active | revised | rejected | approved

**Framing sentence:**  
The agent [standing responsibility] over [object of work] within
[primary domain], using [relevant methods], until [goal state].

**Primary domain:**  
...

**Supporting domains:**  
...

**Operational role:**  
...

**Object of work:**  
...

**Transformation:**  
...

**Goal state:**  
...

**Canonical concepts:**  
...

**Implementation context:**  
...

**Scope boundaries:**  
...

**Assumptions:**  
...

**Why this framing fits:**  
...

**Risks or tradeoffs:**  
...

**Discriminating questions:**  
...

## Question and Answer Log

| ID | Question | Reason for asking | User answer | Effect on framing |
|----|----------|-------------------|-------------|-------------------|

## Vocabulary Register

| Term | Class | Working definition | Status | Evidence or approval |
|------|-------|--------------------|--------|----------------------|
| ... | canonical-domain | ... | verified | ... |
| ... | method-or-pattern | ... | verified | ... |
| ... | implementation-specific | ... | verified | ... |
| ... | project-specific | ... | proposed | awaiting user approval |

### Vocabulary Classes

- `canonical-domain`: established language from the primary or supporting domain
- `method-or-pattern`: a recognized strategy, process, algorithm, or pattern
- `implementation-specific`: terminology belonging to a framework, library, or platform
- `project-specific`: locally defined language introduced for this project

### Vocabulary Statuses

- `proposed`
- `verified`
- `user-approved`
- `rejected`
- `superseded`

## Framing Approval Packet

### Recommended Framing

- Primary domain:
- Supporting domains:
- Operational role:
- Object of work:
- Transformation:
- Purpose:
- Goal:
- Scope boundaries:
- Canonical vocabulary:
- Project-specific vocabulary requiring confirmation:
- Remaining accepted uncertainties:

### Approval State

- `awaiting-approval`
- `approved`
- `revision-requested`
- `rejected`

### User Approval Record

The user's explicit approval, requested revisions, or rejection.

## Prompt Mapping

| Accepted framing element | System-prompt section | How it is represented |
|--------------------------|-----------------------|-----------------------|
| Operational role | `purpose` | ... |
| End state | `goal` | ... |
| Domain states | `state_structure` | ... |
| Domain operations | `workflow` | ... |
| Known failures | `error_handling` | ... |
| Completion tests | `success_criteria` | ... |
| Domain invariants | `rules` | ... |

## Final System Prompt

The generated system prompt after framing approval.

## Decision Log

| Decision | Reason | Source | Status |
|----------|--------|--------|--------|

Rejected candidates and superseded decisions remain recorded rather than being
deleted.