# ADR 0003: Model Media in v1.0 and Process It in v1.1

- Status: Accepted
- Date: 2026-08-13

## Context

Audio and video are central to the work-history story and the event-readiness model. A production upload and transcoding pipeline would significantly expand storage, queue, worker, security and observability scope.

Removing media from v1.0 would make the product generic. Implementing a fake file upload and presenting it as processing would make the portfolio claim unreliable.

## Decision

v1.0 implements the operational media contract:

- workspace ownership;
- audio and video kinds;
- lifecycle and failure states;
- dimensions, size and duration metadata;
- safe preview URLs for CC0 seed media;
- attachment only for ready assets;
- readiness recalculation after attachment;
- a visibly labelled deterministic retry adapter for the seeded failure.

v1.1 will implement the real processing boundary:

- object storage and signed upload URLs;
- allow-listed keys, size and content types;
- FFprobe metadata extraction;
- FFmpeg worker profiles;
- BullMQ retries and dead-letter visibility;
- idempotent commands and webhook outbox delivery.

## Consequences

The v1 product retains meaningful media operations and a demonstrable failure workflow. The documentation must consistently label the adapter as a demo and avoid claiming that v1 transcodes user uploads.
