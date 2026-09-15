# Comparisons

`CompareRunModal.tsx` builds a shared workload configuration for multiple platform
implementations. It selects at least two platforms plus a scenario, model settings, and
experiment. It does not require a common environment because Computer Native owns a
computer environment while backend platforms own backend deployment profiles.

The modal keeps each implementation's environment or server local. It does
not flatten those concerns into an artificial common runtime or display a comparison
result before real runs exist.
