# Comparisons

`CompareRunModal.tsx` builds a shared workload configuration for multiple platform
implementations. It selects at least two platforms plus a scenario, model settings, and
experiment. It does not require a common environment because Anesu owns a
computer environment while server platforms own server deployments.

The modal keeps each implementation's environment or server local. It does
not flatten those concerns into an artificial common runtime or display a comparison
result before real runs exist.
