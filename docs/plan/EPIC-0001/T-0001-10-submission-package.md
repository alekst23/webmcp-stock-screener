# T-0001-10: Submission package

**Epic**: EPIC-0001 (WebMCP Pattern Research Workbench)
**Status**: Superseded by #14
**Depends on**: — (was T-0001-9)
**Blocks**: —
**Issue**: #1

> **Superseded by issue #14** on 2026-09-01. Written against the
> 2026-09-03 hackathon deadline, which is no longer the objective. The
> deliverables (public repo + license, written description, demo video on
> real data, live verification) carry over to #14; the deadline-bound
> submission-field filing does not. Left here rather than deleted so
> EPIC-0001's history stays readable — do not implement from this file.

## Description

The hackathon requires specific deliverables beyond the working app
itself: a public repository with an open-source license, a text
description of the project, and a short demo video. This ticket produces
those deliverables and performs the final pre-submission checks.

## User Story

As the project owner,
I want a complete, compliant submission package,
so that the project can actually be entered in the hackathon before the
deadline.

## Acceptance Criteria

1. The project's source code repository is public and contains an
   open-source license file.
2. A written description explains why this approach fits the underlying
   technology, how it improves on a traditional approach, what new
   collaboration it enables, and how it was implemented.
3. A demo video under the required length limit, with audio, is published
   somewhere publicly viewable and demonstrates the working app end to end
   using real (not mock) data.
4. The live, deployed app is verified working from a fresh session on the
   actual target browser/platform shortly before submission.
5. All required submission fields are completed and the submission is
   confirmed filed before the deadline.

## Design References

- `docs/reference/webmcp-challenge.md` — exact submission requirements, judging
  criteria, deadline

## Solution Approach

No code — this ticket is a checklist against
`docs/reference/webmcp-challenge.md`'s stated requirements: flip the
GitHub repo from private to public and add an OSS license file (LICENSE);
write the text description covering WebMCP fit, UX improvement, novel
human-agent collaboration, and implementation approach; record a ≤3-minute
narrated demo video on YouTube using the real data from T-0001-9 (not the
mock panel); do a final live check of the deployed app on the actual
target browser/platform used throughout the epic (recorded in T-0001-2);
complete and submit the Devpost form before the deadline.

**Contracts introduced:** none.

**Config vars introduced:** none.

## Out of Scope

Any further feature work — this ticket is about packaging and submitting
what already exists.

Resolves #1
