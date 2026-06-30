# Roadmap

This roadmap tracks the highest-value follow-up work after `v0.1.0`.

## Next

- interactive end-to-end validation of auto-continuation in a real Pi session
- configurable evaluator model selection and timeout policy
- cleaner UX around internal goal tool calls and goal-related status output
- more robust duplicate-continuation guards during resume/reentry flows

## Soon

- better `/goal status` presentation with richer evaluator telemetry
- issue templates and contribution docs
- optional export/import or inspection helpers for goal history
- stronger test coverage for compaction and resume edge cases

## Later

- separate `/loop` package or companion feature for interval-based scheduling
- multi-goal queues or goal stacks
- GUI affordances in `pi-gui` for creating, viewing, and controlling goals
- richer policy controls for auto-complete vs. manual confirmation
